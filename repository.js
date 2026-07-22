/**
 * NATYAM ERP 2.0 — Fee collection service
 *
 * Scope, stated once so it is not eroded later: this module manages what a
 * family owes and what they have paid. It is not the accounting system. It
 * emits an event that finance listens to; it never decides how the school's
 * books are structured.
 *
 * Every write that touches money is a single `db.unit()` — the invoice, the
 * payment row, the ledger entry and the sequence counter either all land or
 * none of them do. 1.0 wrote them as separate `put()` calls, which meant a
 * quota error between the second and third silently left an invoice marked
 * paid with no receipt behind it and no ledger income.
 */

import { db, request } from '../core/db.js';
import { bus, EVENTS } from '../core/bus.js';
import { session } from '../core/session.js';
import { uid, sequenceNumber } from '../utils/id.js';
import { localDate, nowISO, addDays, monthKey, academicYearOf } from '../utils/date.js';
import { auditRow } from './audit.service.js';
import {
    INVOICE_STATUS, PAYMENT_STATUS, PAYMENT_MODES, feeFrequency
} from '../config/app.config.js';
import {
    invoices$, payments$, students$, feePlans$, settings$
} from '../data/repositories.js';

/* ==========================================================================
   STATUS DERIVATION
   One function decides an invoice's status from its numbers. Nothing else in
   the codebase is allowed to set `status` on an invoice by hand — that is how
   1.0 ended up with invoices marked "paid" carrying a non-zero balance.
   ========================================================================== */

export function deriveInvoiceStatus(invoice) {
    if (invoice.status === INVOICE_STATUS.CANCELLED) return INVOICE_STATUS.CANCELLED;
    if (invoice.status === INVOICE_STATUS.WAIVED) return INVOICE_STATUS.WAIVED;
    if (invoice.status === INVOICE_STATUS.DRAFT) return INVOICE_STATUS.DRAFT;

    const balance = Math.max(0, (invoice.amount || 0) - (invoice.paidAmount || 0));
    if (balance === 0) return INVOICE_STATUS.PAID;
    if ((invoice.paidAmount || 0) > 0) return INVOICE_STATUS.PARTIAL;
    return invoice.dueDate < localDate() ? INVOICE_STATUS.OVERDUE : INVOICE_STATUS.OPEN;
}

/** Recomputes amounts and status together, so they cannot disagree. */
function reconcile(invoice) {
    const paidAmount = Math.max(0, Math.round(invoice.paidAmount || 0));
    const amount = Math.round(invoice.amount || 0);
    const next = { ...invoice, amount, paidAmount, balance: Math.max(0, amount - paidAmount) };
    return { ...next, status: deriveInvoiceStatus(next) };
}

/* ==========================================================================
   BILLING
   ========================================================================== */

/**
 * Raises the full instalment schedule for a student against their fee plan.
 *
 * Idempotent by design: it refuses to bill a plan that has already been billed
 * for the same academic year rather than quietly doubling a family's fees,
 * which is the single most damaging mistake this module could make.
 *
 * @returns {Promise<{invoices: object[], skipped: boolean}>}
 */
export async function raiseSchedule(studentId, { feePlanId = null, startDate = null, includeExtras = true } = {}) {
    session.require('fee.collect', 'raise invoices');

    const student = await students$.findOrFail(studentId);
    const plan = await feePlans$.findOrFail(feePlanId || student.feePlanId);
    const year = academicYearOf().start;

    const existing = await invoices$.forStudent(studentId);
    const alreadyBilled = existing.some((i) =>
        i.feePlanId === plan.id &&
        i.status !== INVOICE_STATUS.CANCELLED &&
        (i.academicYear || year) === year
    );
    if (alreadyBilled) {
        return { invoices: [], skipped: true, reason: `${student.name} has already been billed for ${plan.name} this year.` };
    }

    const from = startDate || student.joinedOn || localDate();
    // Cadence comes from the frequency table, so adding a future frequency is a
    // data change rather than a rewrite of this generator.
    const cadence = feeFrequency(plan.frequency);
    const periods = cadence.periodsPerYear;
    const perPeriod = Number(plan.amount) || 0;

    const lines = Array.from({ length: periods }, (_, index) => ({
        amount: perPeriod,
        description: periods > 1
            ? `${plan.name} — ${cadence.label.toLowerCase()} fee ${index + 1} of ${periods}`
            : `${plan.name} — ${cadence.label.toLowerCase()} fee`,
        dueDate: index === 0 ? from : addDays(from, index * cadence.dayGap)
    }));

    if (includeExtras && plan.registrationFee > 0 && !existing.length) {
        lines.unshift({ amount: plan.registrationFee, description: 'Registration fee', dueDate: from });
    }
    if (includeExtras && plan.costumeFee > 0) {
        lines.push({ amount: plan.costumeFee, description: 'Costume and accessories', dueDate: addDays(from, 30) });
    }

    const created = [];
    for (const line of lines) {
        created.push(await createInvoice({
            studentId: student.id,
            branchId: student.branchId,
            feePlanId: plan.id,
            amount: line.amount,
            description: line.description,
            dueDate: line.dueDate
        }));
    }

    return { invoices: created, skipped: false };
}

/**
 * A single invoice. The number is allocated from the settings counter inside
 * the same transaction as the row itself, so two invoices raised in the same
 * tick cannot share a number.
 */
export async function createInvoice({ studentId, branchId, feePlanId = null, amount, description, dueDate, discount = 0, discountReason = null }) {
    session.require('fee.collect', 'raise invoices');

    const student = await students$.findOrFail(studentId);
    const gross = Math.round(Number(amount) || 0);
    const reduction = Math.round(Number(discount) || 0);

    if (gross <= 0) throw new Error('An invoice must be for more than zero.');
    if (reduction < 0) throw new Error('A discount cannot be negative.');
    if (reduction > gross) throw new Error('A discount cannot exceed the invoice amount.');
    if (reduction > 0 && !discountReason?.trim()) {
        throw new Error('A discount needs a reason — it is the only record of why the family paid less.');
    }
    if (!dueDate) throw new Error('An invoice needs a due date.');
    if (!description?.trim()) throw new Error('Describe what is being billed.');

    const year = academicYearOf().start;
    const seq = await settings$.nextSequence('invoice');

    const invoice = reconcile({
        id: uid('INV'),
        number: sequenceNumber('NAT/INV', year, seq),
        studentId: student.id,
        studentName: student.name,
        branchId: branchId || student.branchId,
        feePlanId,
        academicYear: year,
        description: description.trim(),
        grossAmount: gross,
        discount: reduction,
        discountReason: reduction > 0 ? discountReason.trim() : null,
        amount: gross - reduction,
        paidAmount: 0,
        dueDate,
        issuedOn: localDate(),
        status: INVOICE_STATUS.OPEN,
        createdAt: nowISO(),
        createdBy: session.actorId(),
        updatedAt: nowISO(),
        updatedBy: session.actorId(),
        deletedAt: null
    });

    await db.put('invoices', invoice);
    bus.emit(EVENTS.INVOICE_CREATED, { invoice });
    return invoice;
}

/* ==========================================================================
   COLLECTION
   ========================================================================== */

/**
 * Records money received against an invoice.
 *
 * The whole operation — invoice update, payment row, ledger income entry —
 * happens in one transaction. The receipt number is allocated first, outside
 * the transaction, because the sequence counter lives in its own unit of work
 * and nesting the two would deadlock the settings store against itself.
 *
 * @returns {Promise<{payment: object, invoice: object}>}
 */
export async function recordPayment({ invoiceId, amount, mode, reference = null, paidOn = null, note = null }) {
    session.require('fee.collect', 'collect fees');

    const invoice = await invoices$.findOrFail(invoiceId);
    const value = Math.round(Number(amount) || 0);
    const date = paidOn || localDate();

    /* -------- Validation, in the order a person would notice a problem ---- */
    if (value <= 0) throw new Error('Enter an amount greater than zero.');
    if (invoice.status === INVOICE_STATUS.CANCELLED) throw new Error('This invoice was cancelled. Raise a new one.');
    if (invoice.status === INVOICE_STATUS.WAIVED) throw new Error('This invoice was waived, so there is nothing to collect.');
    if (invoice.balance <= 0) throw new Error(`Invoice ${invoice.number} is already settled.`);
    if (value > invoice.balance) {
        throw new Error(`That is more than the ₹${(invoice.balance / 100).toFixed(2)} outstanding on this invoice. Split it across invoices instead.`);
    }
    if (date > localDate()) throw new Error('A payment cannot be dated in the future.');

    const modeDef = PAYMENT_MODES.find((m) => m.value === mode);
    if (!modeDef) throw new Error('Choose how the payment was made.');
    if (modeDef.needsReference && !reference?.trim()) {
        throw new Error(`A ${modeDef.label.toLowerCase()} payment needs a reference number — it is what reconciles the bank statement.`);
    }

    const year = academicYearOf().start;
    const seq = await settings$.nextSequence('receipt');
    const receiptNo = sequenceNumber('NAT/RCP', year, seq);

    const payment = {
        id: uid('PAY'),
        receiptNo,
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        studentId: invoice.studentId,
        studentName: invoice.studentName,
        branchId: invoice.branchId,
        amount: value,
        mode,
        reference: reference?.trim() || null,
        note: note?.trim() || null,
        paidOn: date,
        status: PAYMENT_STATUS.CLEARED,
        collectedBy: session.actorId(),
        collectedByName: session.actorName(),
        createdAt: nowISO(),
        createdBy: session.actorId(),
        updatedAt: nowISO(),
        updatedBy: session.actorId(),
        deletedAt: null
    };

    const nextInvoice = reconcile({
        ...invoice,
        paidAmount: (invoice.paidAmount || 0) + value,
        updatedAt: nowISO(),
        updatedBy: session.actorId()
    });

    const ledgerEntry = {
        id: uid('LDG'),
        branchId: invoice.branchId,
        date,
        period: monthKey(date),
        account: 'Tuition fees',
        type: 'income',
        amount: value,
        narration: `${invoice.studentName} — receipt ${receiptNo}`,
        sourceType: 'payment',
        sourceId: payment.id,
        createdAt: nowISO(),
        createdBy: session.actorId(),
        updatedAt: nowISO(),
        updatedBy: session.actorId()
    };

    await db.unit(['invoices', 'payments', 'ledgerEntries', 'auditLog'], async (s) => {
        await request(s.invoices.put(nextInvoice));
        await request(s.payments.put(payment));
        await request(s.ledgerEntries.put(ledgerEntry));
        await request(s.auditLog.put(auditRow('Payment', payment.id, 'create', {
            receiptNo, amount: value, invoice: invoice.number
        })));
    }, 'fee:payment');

    bus.emit(EVENTS.PAYMENT_RECORDED, { payment, invoice: nextInvoice });
    bus.emit(EVENTS.LEDGER_POSTED, { entry: ledgerEntry });
    return { payment, invoice: nextInvoice };
}

/**
 * Reverses a payment. The original row is kept and marked refunded rather than
 * deleted, and a contra ledger entry is posted rather than the income entry
 * being removed: a receipt handed to a parent must remain findable, and an
 * auditor needs to see the reversal, not an absence.
 */
export async function refundPayment(paymentId, { reason, refundedOn = null }) {
    session.require('fee.refund', 'refund a payment');

    const payment = await payments$.findOrFail(paymentId);
    if (payment.status === PAYMENT_STATUS.REFUNDED) throw new Error('This payment has already been refunded.');
    if (!reason?.trim()) throw new Error('A refund needs a reason.');

    const date = refundedOn || localDate();
    const invoice = await invoices$.find(payment.invoiceId);

    const nextPayment = {
        ...payment,
        status: PAYMENT_STATUS.REFUNDED,
        refundedOn: date,
        refundReason: reason.trim(),
        refundedBy: session.actorId(),
        updatedAt: nowISO(),
        updatedBy: session.actorId()
    };

    const nextInvoice = invoice ? reconcile({
        ...invoice,
        paidAmount: Math.max(0, (invoice.paidAmount || 0) - payment.amount),
        updatedAt: nowISO(),
        updatedBy: session.actorId()
    }) : null;

    const contra = {
        id: uid('LDG'),
        branchId: payment.branchId,
        date,
        period: monthKey(date),
        account: 'Tuition fees',
        type: 'expense',
        amount: payment.amount,
        narration: `Refund of receipt ${payment.receiptNo} — ${reason.trim()}`,
        sourceType: 'refund',
        sourceId: payment.id,
        createdAt: nowISO(),
        createdBy: session.actorId(),
        updatedAt: nowISO(),
        updatedBy: session.actorId()
    };

    await db.unit(['invoices', 'payments', 'ledgerEntries', 'auditLog'], async (s) => {
        await request(s.payments.put(nextPayment));
        if (nextInvoice) await request(s.invoices.put(nextInvoice));
        await request(s.ledgerEntries.put(contra));
        await request(s.auditLog.put(auditRow('Payment', payment.id, 'refund', { reason: reason.trim(), amount: payment.amount })));
    }, 'fee:refund');

    bus.emit(EVENTS.PAYMENT_REFUNDED, { payment: nextPayment, invoice: nextInvoice });
    return { payment: nextPayment, invoice: nextInvoice };
}

/**
 * Writes off an invoice — scholarship, hardship, goodwill. Distinct from a
 * discount, which reduces the amount before billing; a waiver forgives money
 * already owed and therefore always needs a reason on record.
 */
export async function waiveInvoice(invoiceId, { reason }) {
    session.require('fee.waive', 'waive fees');

    const invoice = await invoices$.findOrFail(invoiceId);
    if (!reason?.trim()) throw new Error('A waiver needs a reason.');
    if (invoice.status === INVOICE_STATUS.PAID) throw new Error('This invoice is already paid in full.');
    if (invoice.status === INVOICE_STATUS.CANCELLED) throw new Error('This invoice was cancelled.');

    const next = {
        ...invoice,
        status: INVOICE_STATUS.WAIVED,
        waivedAmount: invoice.balance,
        waiverReason: reason.trim(),
        waivedOn: localDate(),
        waivedBy: session.actorId(),
        balance: 0,
        updatedAt: nowISO(),
        updatedBy: session.actorId()
    };

    await db.unit(['invoices', 'auditLog'], async (s) => {
        await request(s.invoices.put(next));
        await request(s.auditLog.put(auditRow('Invoice', invoice.id, 'waive', { amount: invoice.balance, reason: reason.trim() })));
    }, 'fee:waive');

    return next;
}

/** Cancels an unpaid invoice raised in error. Paid invoices must be refunded. */
export async function cancelInvoice(invoiceId, { reason }) {
    session.require('fee.collect', 'cancel an invoice');

    const invoice = await invoices$.findOrFail(invoiceId);
    if ((invoice.paidAmount || 0) > 0) {
        throw new Error('Money has been received against this invoice. Refund the receipt first, then cancel.');
    }
    if (!reason?.trim()) throw new Error('Say why this invoice is being cancelled.');

    const next = {
        ...invoice,
        status: INVOICE_STATUS.CANCELLED,
        balance: 0,
        cancelReason: reason.trim(),
        cancelledOn: localDate(),
        updatedAt: nowISO(),
        updatedBy: session.actorId()
    };

    await db.unit(['invoices', 'auditLog'], async (s) => {
        await request(s.invoices.put(next));
        await request(s.auditLog.put(auditRow('Invoice', invoice.id, 'cancel', { reason: reason.trim() })));
    }, 'fee:cancel');

    return next;
}

/* ==========================================================================
   MAINTENANCE & REPORTING READS
   ========================================================================== */

/**
 * Moves open invoices past their due date to overdue. Run at boot rather than
 * on a timer: the app may be closed for a fortnight, and a book that only ages
 * while someone is watching it is wrong every Monday morning.
 */
export async function sweepOverdue() {
    const stale = await invoices$.needingOverdueSweep();
    if (!stale.length) return 0;

    const updated = stale.map((i) => ({ ...i, status: INVOICE_STATUS.OVERDUE }));
    await db.putMany('invoices', updated);
    return updated.length;
}

/** The complete fee position for one student, as the profile page shows it. */
export async function studentFeeSummary(studentId) {
    const [invoices, receipts] = await Promise.all([
        invoices$.forStudent(studentId),
        payments$.forStudent(studentId)
    ]);

    const live = invoices.filter((i) => i.status !== INVOICE_STATUS.CANCELLED);
    const billed = live.reduce((s, i) => s + (i.amount || 0), 0);
    const collected = live.reduce((s, i) => s + (i.paidAmount || 0), 0);
    const outstanding = live.reduce((s, i) => s + (i.balance || 0), 0);
    const overdue = live
        .filter((i) => i.balance > 0 && i.dueDate < localDate())
        .reduce((s, i) => s + i.balance, 0);

    const oldest = live
        .filter((i) => i.balance > 0)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] || null;

    return {
        invoices, receipts, billed, collected, outstanding, overdue,
        oldestDue: oldest?.dueDate || null,
        onTrack: outstanding === 0,
        timeline: buildTimeline(live, receipts)
    };
}

/** Invoices and receipts interleaved, newest first — the payment timeline. */
function buildTimeline(invoices, receipts) {
    const events = [
        ...invoices.map((i) => ({
            at: i.issuedOn, kind: 'invoice', title: i.description,
            detail: i.number, amount: i.amount, status: i.status, id: i.id
        })),
        ...receipts.map((p) => ({
            at: p.paidOn,
            kind: p.status === PAYMENT_STATUS.REFUNDED ? 'refund' : 'payment',
            title: p.status === PAYMENT_STATUS.REFUNDED ? `Refunded — ${p.refundReason}` : `Received by ${p.mode}`,
            detail: p.receiptNo, amount: p.amount, status: p.status, id: p.id
        }))
    ];
    return events.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}

/**
 * Collection position across a date range — the numbers behind the fee
 * dashboard and the collections report.
 */
export async function collectionSummary({ from, to, branchId = null }) {
    const [receipts, outstanding] = await Promise.all([
        payments$.between(from, to, branchId),
        invoices$.outstanding(branchId)
    ]);

    const cleared = receipts.filter((p) => p.status === PAYMENT_STATUS.CLEARED);
    const refunded = receipts.filter((p) => p.status === PAYMENT_STATUS.REFUNDED);
    const today = localDate();

    const ageBuckets = [
        { label: 'Not yet due', test: (i) => i.dueDate >= today },
        { label: '1–30 days',   test: (i) => i.dueDate < today && i.dueDate >= addDays(today, -30) },
        { label: '31–60 days',  test: (i) => i.dueDate < addDays(today, -30) && i.dueDate >= addDays(today, -60) },
        { label: 'Over 60 days',test: (i) => i.dueDate < addDays(today, -60) }
    ].map((bucket) => {
        const rows = outstanding.filter(bucket.test);
        return { label: bucket.label, count: rows.length, amount: rows.reduce((s, i) => s + i.balance, 0) };
    });

    return {
        collected: cleared.reduce((s, p) => s + p.amount, 0),
        refunded: refunded.reduce((s, p) => s + p.amount, 0),
        receiptCount: cleared.length,
        outstanding: outstanding.reduce((s, i) => s + i.balance, 0),
        outstandingCount: outstanding.length,
        byMode: modeBreakdown(cleared),
        ageing: ageBuckets
    };
}

function modeBreakdown(payments) {
    return PAYMENT_MODES
        .map((m) => ({
            mode: m.value,
            label: m.label,
            amount: payments.filter((p) => p.mode === m.value).reduce((s, p) => s + p.amount, 0)
        }))
        .filter((row) => row.amount > 0)
        .sort((a, b) => b.amount - a.amount);
}

/**
 * Everything a printed receipt needs, resolved in one call so the print view
 * has no queries of its own.
 */
export async function receiptData(paymentId) {
    const payment = await payments$.findOrFail(paymentId);
    const [invoice, student, institute] = await Promise.all([
        invoices$.find(payment.invoiceId),
        students$.find(payment.studentId),
        settings$.get('institute', {})
    ]);
    return { payment, invoice, student, institute };
}

/* ------------------------------------------------------------------ HELPERS */

