/**
 * NATYAM ERP 2.0 — Entity repositories
 *
 * One module, one export per entity. Each repository declares its store and
 * searchable fields and then adds only the queries that are genuinely specific
 * to it; everything else — id minting, stamping, soft delete, audit, search,
 * pagination — comes from the base class.
 *
 * The rule that keeps this layer honest: repositories answer questions about
 * *one* store. Anything that has to touch two stores atomically (a payment
 * updating an invoice and posting to the ledger) belongs in a service, not
 * here. 1.0 blurred that line and ended up with a payment path that could
 * leave the books unbalanced if the second write failed.
 */

import { Repository } from '../core/repository.js';
import { db, request } from '../core/db.js';
import { localDate, monthKey } from '../utils/date.js';
import {
    STUDENT_STATUS, ADMISSION_STATUS, INVOICE_STATUS,
    ATTENDANCE_STATUS, LEVELS, CURRICULUM_STATUS, DEFAULT_FEE_FREQUENCY, feeFrequency
} from '../config/app.config.js';

/* ==========================================================================
   BRANCHES
   ========================================================================== */

class BranchRepository extends Repository {
    constructor() {
        super({ store: 'branches', prefix: 'BRN', entity: 'Branch', searchFields: ['name', 'code'] });
    }

    validate(record) {
        if (!record.name?.trim()) throw new Error('A branch needs a name.');
        if (!record.code?.trim()) throw new Error('A branch needs a short code, e.g. HYD-C.');
    }

    beforeSave(record) {
        return { ...record, code: String(record.code || '').trim().toUpperCase(), status: record.status || 'active' };
    }

    async active() {
        return (await this.all()).filter((b) => b.status === 'active');
    }
}

/* ==========================================================================
   ACADEMIC YEARS
   ========================================================================== */

class AcademicYearRepository extends Repository {
    constructor() {
        super({ store: 'academicYears', prefix: 'AY', entity: 'Academic year', searchFields: ['label'] });
    }

    async current() {
        const rows = await this.all();
        return rows.find((y) => y.isCurrent === 1) || rows.sort((a, b) => b.startsOn.localeCompare(a.startsOn))[0] || null;
    }

    /**
     * Exactly one year may be current. Done as a single unit so a failure
     * cannot leave the school with two current years or none.
     */
    async makeCurrent(id) {
        const rows = await this.all();
        await db.unit(['academicYears'], (s) => Promise.all(
            rows
                .map((year) => ({ ...year, isCurrent: year.id === id ? 1 : 0 }))
                .filter((next, i) => next.isCurrent !== rows[i].isCurrent)
                .map((next) => request(s.academicYears.put(next)))
        ), 'academicYear:current');
        await this._audit('update', id, { fields: ['isCurrent'] });
        return this.find(id);
    }
}

/* ==========================================================================
   STUDENTS
   ========================================================================== */

class StudentRepository extends Repository {
    constructor() {
        super({
            store: 'students',
            prefix: 'STU',
            entity: 'Student',
            searchFields: ['name', 'admissionNo', 'guardianName', 'guardianPhone', 'level']
        });
    }

    beforeSave(record) {
        return {
            ...record,
            name: String(record.name || '').trim().replace(/\s+/g, ' '),
            status: record.status || STUDENT_STATUS.ACTIVE,
            guardianPhone: normalisePhone(record.guardianPhone),
            alternatePhone: normalisePhone(record.alternatePhone),
            emergencyContact: normalisePhone(record.emergencyContact)
        };
    }

    validate(record) {
        if (!record.name) throw new Error('A student needs a name.');
        if (!record.branchId) throw new Error('A student must belong to a branch.');
        if (!record.level) throw new Error('A student must be placed at a level.');
        if (!LEVELS.some((l) => l.value === record.level)) throw new Error(`"${record.level}" is not a recognised level.`);
        if (!record.guardianPhone) throw new Error('A guardian contact number is required.');
        if (record.dateOfBirth && record.dateOfBirth > localDate()) throw new Error('Date of birth cannot be in the future.');
    }

    async active(branchId = null) {
        const rows = await this.where('status', STUDENT_STATUS.ACTIVE);
        return branchId ? rows.filter((s) => s.branchId === branchId) : rows;
    }

    async byBatch(batchId) {
        return (await this.where('batchId', batchId))
            .filter((s) => s.status !== STUDENT_STATUS.INACTIVE)
            .sort((a, b) => a.name.localeCompare(b.name, 'en-IN'));
    }

    async byBranch(branchId) {
        return this.where('branchId', branchId);
    }

    /** Students with no batch — the queue a registrar has to clear. */
    async unassigned() {
        return (await this.active()).filter((s) => !s.batchId);
    }

    /** Birthdays falling inside the given calendar month (1–12). */
    async birthdaysIn(month) {
        const key = String(month).padStart(2, '0');
        return (await this.active()).filter((s) => (s.dateOfBirth || '').slice(5, 7) === key);
    }

    async countsByLevel(branchId = null) {
        const rows = (await this.active(branchId));
        return LEVELS.map((level) => ({
            level: level.value,
            label: level.label,
            count: rows.filter((s) => s.level === level.value).length
        }));
    }

    /**
     * Moving a student between batches is a two-field change that people get
     * wrong by editing only one of them, so it is a named operation.
     */
    async transfer(id, { batchId, branchId }) {
        const student = await this.findOrFail(id);
        return this.update(id, {
            batchId: batchId ?? student.batchId,
            branchId: branchId ?? student.branchId
        });
    }

    async promote(id) {
        const student = await this.findOrFail(id);
        const index = LEVELS.findIndex((l) => l.value === student.level);
        if (index === -1) throw new Error('This student is at an unrecognised level.');
        if (index === LEVELS.length - 1) throw new Error(`${student.name} is already at ${LEVELS[index].label}, the highest level.`);
        return this.update(id, { level: LEVELS[index + 1].value, batchId: null });
    }
}

/* ==========================================================================
   ADMISSIONS
   ========================================================================== */

class AdmissionRepository extends Repository {
    constructor() {
        super({
            store: 'admissions',
            prefix: 'ADM',
            entity: 'Admission',
            searchFields: ['name', 'applicationNo', 'guardianName', 'guardianPhone']
        });
    }

    beforeSave(record) {
        return {
            ...record,
            name: String(record.name || '').trim().replace(/\s+/g, ' '),
            status: record.status || ADMISSION_STATUS.SUBMITTED,
            guardianPhone: normalisePhone(record.guardianPhone),
            appliedOn: record.appliedOn || localDate()
        };
    }

    validate(record) {
        if (!record.name) throw new Error('The applicant needs a name.');
        if (!record.branchId) throw new Error('Choose the branch being applied to.');
        if (!record.guardianPhone) throw new Error('A parent or guardian contact number is required.');
        if (!record.level) throw new Error('Choose a starting level.');
    }

    async pending() {
        const rows = await this.all();
        return rows.filter((a) => [ADMISSION_STATUS.SUBMITTED, ADMISSION_STATUS.REVIEWING].includes(a.status));
    }

    async byStatus(status) {
        return this.where('status', status);
    }

    async recent(limit = 5) {
        return (await this.all())
            .sort((a, b) => (b.appliedOn || '').localeCompare(a.appliedOn || ''))
            .slice(0, limit);
    }

    /** Duplicate guard: same name and guardian phone, still in the pipeline. */
    async findLikeness({ name, guardianPhone }) {
        const phone = normalisePhone(guardianPhone);
        if (!phone) return null;
        const rows = await this.all();
        return rows.find((a) =>
            a.status !== ADMISSION_STATUS.REJECTED &&
            a.guardianPhone === phone &&
            a.name.toLowerCase() === String(name || '').trim().toLowerCase()
        ) || null;
    }
}

/* ==========================================================================
   ADMISSION DRAFTS
   --------------------------------------------------------------------------
   Deliberately not audited and never soft-deleted: a half-typed form is not a
   record of anything, and keeping tombstones of abandoned drafts would bloat
   the store the wizard reads on every keystroke.
   ========================================================================== */

class AdmissionDraftRepository extends Repository {
    constructor() {
        super({ store: 'admissionDrafts', prefix: 'DRF', entity: 'Admission draft', softDelete: false, audit: false });
    }

    async mine() {
        return (await this.all()).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    }

    /** Drops drafts older than the retention window. Called at boot. */
    async prune(days = 30) {
        const cutoff = new Date(Date.now() - days * 86400000).toISOString();
        const stale = (await this.all()).filter((d) => (d.updatedAt || '') < cutoff);
        if (stale.length) await db.removeMany('admissionDrafts', stale.map((d) => d.id));
        return stale.length;
    }
}

/* ==========================================================================
   BATCHES
   ========================================================================== */

const DAY_CODES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

class BatchRepository extends Repository {
    constructor() {
        super({ store: 'batches', prefix: 'BCH', entity: 'Batch', searchFields: ['name', 'code', 'level'] });
    }

    beforeSave(record) {
        return {
            ...record,
            code: String(record.code || '').trim().toUpperCase(),
            days: Array.isArray(record.days) ? record.days : [],
            status: record.status || 'active',
            capacity: Number(record.capacity) || 0
        };
    }

    validate(record) {
        if (!record.name?.trim()) throw new Error('A batch needs a name.');
        if (!record.code) throw new Error('A batch needs a code.');
        if (!record.branchId) throw new Error('A batch must belong to a branch.');
        if (!record.days.length) throw new Error('Choose at least one day the batch meets.');
        if (record.startTime && record.endTime && record.endTime <= record.startTime) {
            throw new Error('The batch cannot end before it starts.');
        }
    }

    async active(branchId = null) {
        const rows = (await this.all()).filter((b) => b.status === 'active');
        return branchId ? rows.filter((b) => b.branchId === branchId) : rows;
    }

    /** Batches meeting on a given calendar date, in start-time order. */
    async meetingOn(date = localDate(), branchId = null) {
        const code = DAY_CODES[new Date(`${date}T00:00:00`).getDay()];
        return (await this.active(branchId))
            .filter((b) => b.days.includes(code))
            .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
    }

    async byTeacher(teacherId) {
        return (await this.where('teacherId', teacherId)).filter((b) => b.status === 'active');
    }

    /**
     * Roster counts for every batch in one pass. Called by the batches table
     * and the dashboard; doing it per row would be N+1 queries against
     * IndexedDB, which is exactly how 1.0's batch list became slow.
     */
    async withOccupancy(branchId = null) {
        const [batches, students] = await Promise.all([this.active(branchId), students$.active()]);
        const counts = new Map();
        for (const student of students) {
            if (student.batchId) counts.set(student.batchId, (counts.get(student.batchId) || 0) + 1);
        }
        return batches.map((batch) => {
            const enrolled = counts.get(batch.id) || 0;
            return {
                ...batch,
                enrolled,
                seatsLeft: Math.max(0, (batch.capacity || 0) - enrolled),
                occupancy: batch.capacity ? Math.round((enrolled / batch.capacity) * 100) : 0
            };
        });
    }
}

/* ==========================================================================
   STAFF
   ========================================================================== */

class StaffRepository extends Repository {
    constructor() {
        super({ store: 'staff', prefix: 'STF', entity: 'Staff member', searchFields: ['name', 'employeeNo', 'role', 'specialisation', 'phone'] });
    }

    beforeSave(record) {
        return {
            ...record,
            name: String(record.name || '').trim().replace(/\s+/g, ' '),
            phone: normalisePhone(record.phone),
            status: record.status || 'active',
            monthlySalary: Number(record.monthlySalary) || 0
        };
    }

    validate(record) {
        if (!record.name) throw new Error('A staff member needs a name.');
        if (!record.role) throw new Error('Choose a role.');
        if (record.monthlySalary < 0) throw new Error('Salary cannot be negative.');
    }

    async teachers(branchId = null) {
        const rows = (await this.where('role', 'teacher')).filter((s) => s.status === 'active');
        return branchId ? rows.filter((s) => s.branchId === branchId) : rows;
    }

    async activeStaff(branchId = null) {
        const rows = (await this.all()).filter((s) => s.status === 'active');
        return branchId ? rows.filter((s) => s.branchId === branchId) : rows;
    }
}

/* ==========================================================================
   ATTENDANCE
   --------------------------------------------------------------------------
   Never soft-deleted: a roll call is corrected by changing its status, not by
   removing the row, and an absent day that vanishes is indistinguishable from
   a day nobody marked.
   ========================================================================== */

class AttendanceRepository extends Repository {
    constructor() {
        super({ store: 'attendance', prefix: 'ATT', entity: 'Attendance', softDelete: false, audit: false });
    }

    static key(batchId, date, studentId) { return `${batchId}|${date}|${studentId}`; }

    async forBatchOn(batchId, date) {
        return (await this.where('batchId', batchId)).filter((r) => r.date === date);
    }

    async forStudent(studentId, { from = null, to = null } = {}) {
        let rows = await this.where('studentId', studentId);
        if (from) rows = rows.filter((r) => r.date >= from);
        if (to) rows = rows.filter((r) => r.date <= to);
        return rows.sort((a, b) => b.date.localeCompare(a.date));
    }

    async onDate(date, branchId = null) {
        const rows = await this.where('date', date);
        return branchId ? rows.filter((r) => r.branchId === branchId) : rows;
    }

    async between(from, to, branchId = null) {
        const rows = await db.between('attendance', 'date', from, to);
        return branchId ? rows.filter((r) => r.branchId === branchId) : rows;
    }

    /** present + late + excused over total. The number the school quotes. */
    static rateOf(rows) {
        if (!rows.length) return null;
        const counted = rows.filter((r) => r.status !== ATTENDANCE_STATUS.HOLIDAY);
        if (!counted.length) return null;
        const attended = counted.filter((r) =>
            r.status === ATTENDANCE_STATUS.PRESENT ||
            r.status === ATTENDANCE_STATUS.LATE ||
            r.status === ATTENDANCE_STATUS.EXCUSED
        ).length;
        return Math.round((attended / counted.length) * 100);
    }

    static breakdownOf(rows) {
        const tally = { present: 0, absent: 0, late: 0, excused: 0, holiday: 0 };
        for (const row of rows) if (row.status in tally) tally[row.status] += 1;
        return tally;
    }
}

/* ==========================================================================
   HOLIDAYS & LEAVE
   ========================================================================== */

class HolidayRepository extends Repository {
    constructor() {
        super({ store: 'holidays', prefix: 'HOL', entity: 'Holiday', searchFields: ['name'] });
    }

    validate(record) {
        if (!record.name?.trim()) throw new Error('Give the holiday a name.');
        if (!record.date) throw new Error('Choose a date.');
    }

    async on(date, branchId = null) {
        const rows = await this.where('date', date);
        return rows.find((h) => !h.branchId || h.branchId === branchId) || null;
    }

    async inRange(from, to) {
        return (await this.all()).filter((h) => h.date >= from && h.date <= to);
    }
}

class LeaveRequestRepository extends Repository {
    constructor() {
        super({ store: 'leaveRequests', prefix: 'LVE', entity: 'Leave request', searchFields: ['studentName', 'reason'] });
    }

    beforeSave(record) {
        return { ...record, status: record.status || 'pending' };
    }

    validate(record) {
        if (!record.studentId) throw new Error('A leave request must name a student.');
        if (!record.fromDate || !record.toDate) throw new Error('Give the dates the student will be away.');
        if (record.toDate < record.fromDate) throw new Error('The end date cannot be before the start date.');
        if (!record.reason?.trim()) throw new Error('Give a reason — it is what the teacher sees.');
    }

    async pending() { return this.where('status', 'pending'); }

    async coveringDate(studentId, date) {
        return (await this.where('studentId', studentId))
            .find((l) => l.status === 'approved' && l.fromDate <= date && l.toDate >= date) || null;
    }
}

/* ==========================================================================
   FEE PLANS
   ========================================================================== */

class FeePlanRepository extends Repository {
    constructor() {
        super({ store: 'feePlans', prefix: 'FPL', entity: 'Fee plan', searchFields: ['name', 'level'] });
    }

    beforeSave(record) {
        // A plan stores what is due each period plus the period itself. Plans
        // written before the monthly change carried a yearly figure split into
        // instalments; those are read through here so an un-migrated record
        // still resolves to a sensible monthly amount.
        const frequency = record.frequency || DEFAULT_FEE_FREQUENCY;
        const legacyMonthly = record.annualAmount != null
            ? Math.round(Number(record.annualAmount) / 12)
            : 0;
        return {
            ...record,
            status: record.status || 'active',
            frequency,
            amount: Math.round(Number(record.amount ?? legacyMonthly) || 0),
            registrationFee: Math.round(Number(record.registrationFee) || 0),
            costumeFee: Math.round(Number(record.costumeFee) || 0)
        };
    }

    validate(record) {
        if (!record.name?.trim()) throw new Error('A fee plan needs a name.');
        if (record.amount <= 0) throw new Error('The monthly fee must be more than zero.');
        if (!feeFrequency(record.frequency)) throw new Error('That fee frequency is not recognised.');
    }

    async active() {
        return (await this.all()).filter((p) => p.status === 'active');
    }

    async forLevel(level) {
        return (await this.active()).find((p) => p.level === level) || null;
    }

    /** Plans in use, so the UI can warn before archiving one. */
    async usageCount(planId) {
        return (await students$.all()).filter((s) => s.feePlanId === planId).length;
    }
}

/* ==========================================================================
   INVOICES & PAYMENTS
   --------------------------------------------------------------------------
   Read-side only. Every write that changes money flows through
   services/fees.service.js so the invoice, the payment and the ledger move
   together or not at all.
   ========================================================================== */

class InvoiceRepository extends Repository {
    constructor() {
        super({ store: 'invoices', prefix: 'INV', entity: 'Invoice', searchFields: ['number', 'studentName', 'description'] });
    }

    async forStudent(studentId) {
        return (await this.where('studentId', studentId))
            .sort((a, b) => (b.dueDate || '').localeCompare(a.dueDate || ''));
    }

    async outstanding(branchId = null) {
        const rows = (await this.all()).filter((i) =>
            [INVOICE_STATUS.OPEN, INVOICE_STATUS.PARTIAL, INVOICE_STATUS.OVERDUE].includes(i.status));
        return branchId ? rows.filter((i) => i.branchId === branchId) : rows;
    }

    async overdue(branchId = null) {
        const today = localDate();
        return (await this.outstanding(branchId)).filter((i) => i.dueDate < today);
    }

    /**
     * Invoices whose due date has passed but whose status still says "open".
     * Statuses are recomputed at boot rather than by a timer, because an app
     * that is closed for a week must not show a stale book when it reopens.
     */
    async needingOverdueSweep() {
        const today = localDate();
        return (await this.all()).filter((i) => i.status === INVOICE_STATUS.OPEN && i.dueDate < today);
    }

    static totals(invoices) {
        return invoices.reduce((acc, i) => ({
            billed: acc.billed + (i.amount || 0),
            collected: acc.collected + (i.paidAmount || 0),
            outstanding: acc.outstanding + (i.balance || 0)
        }), { billed: 0, collected: 0, outstanding: 0 });
    }
}

class PaymentRepository extends Repository {
    constructor() {
        super({ store: 'payments', prefix: 'PAY', entity: 'Payment', searchFields: ['receiptNo', 'studentName', 'reference', 'mode'] });
    }

    async forStudent(studentId) {
        return (await this.where('studentId', studentId))
            .sort((a, b) => (b.paidOn || '').localeCompare(a.paidOn || ''));
    }

    async forInvoice(invoiceId) {
        return (await this.where('invoiceId', invoiceId))
            .sort((a, b) => (a.paidOn || '').localeCompare(b.paidOn || ''));
    }

    async onDate(date, branchId = null) {
        const rows = await this.where('paidOn', date);
        return branchId ? rows.filter((p) => p.branchId === branchId) : rows;
    }

    async between(from, to, branchId = null) {
        const rows = await db.between('payments', 'paidOn', from, to);
        return branchId ? rows.filter((p) => p.branchId === branchId) : rows;
    }

    async byReceipt(receiptNo) {
        return (await this.where('receiptNo', receiptNo))[0] || null;
    }

    /** Cleared money only — refunded and bounced receipts are not collection. */
    static collected(payments) {
        return payments
            .filter((p) => p.status === 'cleared')
            .reduce((sum, p) => sum + (p.amount || 0), 0);
    }

    static byMode(payments) {
        const tally = new Map();
        for (const p of payments.filter((x) => x.status === 'cleared')) {
            tally.set(p.mode, (tally.get(p.mode) || 0) + p.amount);
        }
        return [...tally.entries()].map(([mode, amount]) => ({ mode, amount }))
            .sort((a, b) => b.amount - a.amount);
    }
}

/* ==========================================================================
   FINANCE
   ========================================================================== */

class LedgerRepository extends Repository {
    constructor() {
        super({ store: 'ledgerEntries', prefix: 'LDG', entity: 'Ledger entry', searchFields: ['narration', 'account'], softDelete: false });
    }

    beforeSave(record) {
        return { ...record, period: record.period || monthKey(record.date), amount: Math.round(Number(record.amount) || 0) };
    }

    validate(record) {
        if (!record.date) throw new Error('A ledger entry needs a date.');
        if (!record.account) throw new Error('A ledger entry needs an account.');
        if (!['income', 'expense'].includes(record.type)) throw new Error('A ledger entry is either income or expense.');
        if (record.amount <= 0) throw new Error('A ledger entry must be more than zero.');
    }

    async forPeriod(period, branchId = null) {
        const rows = await this.where('period', period);
        return branchId ? rows.filter((e) => e.branchId === branchId) : rows;
    }

    async between(from, to, branchId = null) {
        const rows = await db.between('ledgerEntries', 'date', from, to);
        return branchId ? rows.filter((e) => e.branchId === branchId) : rows;
    }

    async bySource(sourceId) {
        return this.where('sourceId', sourceId);
    }

    static summarise(entries) {
        const income = entries.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0);
        const expense = entries.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
        return { income, expense, net: income - expense };
    }

    static byAccount(entries, type) {
        const tally = new Map();
        for (const e of entries.filter((x) => x.type === type)) {
            tally.set(e.account, (tally.get(e.account) || 0) + e.amount);
        }
        return [...tally.entries()]
            .map(([account, amount]) => ({ account, amount }))
            .sort((a, b) => b.amount - a.amount);
    }
}

class ExpenseRepository extends Repository {
    constructor() {
        super({ store: 'expenses', prefix: 'EXP', entity: 'Expense', searchFields: ['description', 'category', 'paidTo'] });
    }

    beforeSave(record) {
        return {
            ...record,
            date: record.date || localDate(),
            period: record.period || monthKey(record.date || localDate()),
            amount: Math.round(Number(record.amount) || 0),
            status: record.status || 'paid'
        };
    }

    validate(record) {
        if (!record.category) throw new Error('Choose an expense category.');
        if (!record.description?.trim()) throw new Error('Describe what this expense was for.');
        if (record.amount <= 0) throw new Error('The amount must be more than zero.');
        if (!record.branchId) throw new Error('An expense belongs to a branch.');
        if (record.date > localDate()) throw new Error('An expense cannot be dated in the future.');
    }

    async forPeriod(period, branchId = null) {
        const rows = await this.where('period', period);
        return branchId ? rows.filter((e) => e.branchId === branchId) : rows;
    }

    async between(from, to, branchId = null) {
        const rows = (await db.between('expenses', 'date', from, to)).filter((r) => !r.deletedAt);
        return branchId ? rows.filter((e) => e.branchId === branchId) : rows;
    }

    static byCategory(expenses) {
        const tally = new Map();
        for (const e of expenses) tally.set(e.category, (tally.get(e.category) || 0) + e.amount);
        return [...tally.entries()]
            .map(([category, amount]) => ({ category, amount }))
            .sort((a, b) => b.amount - a.amount);
    }
}

class SalaryRepository extends Repository {
    constructor() {
        super({ store: 'salaries', prefix: 'SAL', entity: 'Salary', searchFields: ['staffName', 'period'] });
    }

    beforeSave(record) {
        const gross = Math.round(Number(record.gross) || 0);
        const deductions = Math.round(Number(record.deductions) || 0);
        return { ...record, gross, deductions, net: gross - deductions, status: record.status || 'pending' };
    }

    validate(record) {
        if (!record.staffId) throw new Error('A salary line needs a staff member.');
        if (!/^\d{4}-\d{2}$/.test(record.period || '')) throw new Error('The pay period must be a month, e.g. 2026-07.');
        if (record.gross <= 0) throw new Error('Gross pay must be more than zero.');
        if (record.deductions > record.gross) throw new Error('Deductions cannot exceed gross pay.');
    }

    async forPeriod(period) { return this.where('period', period); }

    async forStaff(staffId) {
        return (await this.where('staffId', staffId)).sort((a, b) => b.period.localeCompare(a.period));
    }
}

/* ==========================================================================
   PROGRAMMES, CERTIFICATES, DOCUMENTS
   ========================================================================== */

class ProgramRepository extends Repository {
    constructor() {
        super({ store: 'programs', prefix: 'PRG', entity: 'Programme', searchFields: ['name', 'venue', 'type'] });
    }

    beforeSave(record) {
        return {
            ...record,
            status: record.status || (record.date < localDate() ? 'completed' : 'scheduled'),
            participants: Array.isArray(record.participants) ? record.participants : [],
            participantCount: Array.isArray(record.participants) ? record.participants.length : (record.participantCount || 0)
        };
    }

    validate(record) {
        if (!record.name?.trim()) throw new Error('A programme needs a name.');
        if (!record.date) throw new Error('A programme needs a date.');
        if (!record.type) throw new Error('Choose a programme type.');
        if (!record.branchId) throw new Error('A programme belongs to a branch.');
    }

    async upcoming(limit = 5, branchId = null) {
        const today = localDate();
        const rows = (await this.all())
            .filter((p) => p.date >= today && p.status !== 'cancelled')
            .sort((a, b) => a.date.localeCompare(b.date));
        return (branchId ? rows.filter((p) => p.branchId === branchId) : rows).slice(0, limit);
    }

    async past(branchId = null) {
        const today = localDate();
        const rows = (await this.all()).filter((p) => p.date < today).sort((a, b) => b.date.localeCompare(a.date));
        return branchId ? rows.filter((p) => p.branchId === branchId) : rows;
    }
}

class CertificateRepository extends Repository {
    constructor() {
        super({ store: 'certificates', prefix: 'CRT', entity: 'Certificate', searchFields: ['serial', 'studentName', 'title'] });
    }

    validate(record) {
        if (!record.studentId) throw new Error('A certificate must name a student.');
        if (!record.title?.trim()) throw new Error('A certificate needs a title.');
        if (!record.serial) throw new Error('A certificate needs a serial number.');
    }

    async forStudent(studentId) {
        return (await this.where('studentId', studentId)).sort((a, b) => b.issuedOn.localeCompare(a.issuedOn));
    }

    /** Public verification: serial in, certificate or null out. */
    async verify(serial) {
        const rows = await this.where('serial', String(serial || '').trim().toUpperCase());
        return rows[0] || null;
    }
}

class DocumentRepository extends Repository {
    constructor() {
        super({ store: 'documents', prefix: 'DOC', entity: 'Document', searchFields: ['name', 'kind'] });
    }

    validate(record) {
        if (!record.ownerId) throw new Error('A document must be attached to a record.');
        if (!record.name?.trim()) throw new Error('Give the document a name.');
    }

    async forOwner(ownerId) {
        return (await this.where('ownerId', ownerId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
}

/* ==========================================================================
   NOTIFICATIONS, AUDIT, SETTINGS, USERS
   ========================================================================== */

class NotificationRepository extends Repository {
    constructor() {
        super({ store: 'notifications', prefix: 'NTF', entity: 'Notification', softDelete: false, audit: false });
    }

    beforeSave(record) {
        return { ...record, read: record.read ? 1 : 0 };
    }

    async recent(limit = 30) {
        return (await this.all())
            .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
            .slice(0, limit);
    }

    async unreadCount() {
        return (await this.where('read', 0)).length;
    }

    async markRead(id) {
        const row = await this.find(id);
        if (!row || row.read) return row;
        return this.update(id, { read: 1 });
    }

    async markAllRead() {
        const unread = await this.where('read', 0);
        if (!unread.length) return 0;
        await db.putMany('notifications', unread.map((n) => ({ ...n, read: 1 })));
        return unread.length;
    }

    /** Keeps the store from growing without bound. Called at boot. */
    async prune(keep = 200) {
        const rows = (await this.all()).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        const excess = rows.slice(keep);
        if (excess.length) await db.removeMany('notifications', excess.map((n) => n.id));
        return excess.length;
    }
}

class AuditRepository extends Repository {
    constructor() {
        super({ store: 'auditLog', prefix: 'AUD', entity: 'Audit entry', softDelete: false, audit: false });
    }

    async recent(limit = 50) {
        return (await this.all())
            .sort((a, b) => (b.at || '').localeCompare(a.at || ''))
            .slice(0, limit);
    }

    async forEntity(entity, entityId) {
        return (await this.where('entity', entity))
            .filter((a) => !entityId || a.entityId === entityId)
            .sort((a, b) => b.at.localeCompare(a.at));
    }

    async between(from, to) {
        return (await this.all()).filter((a) => a.at >= from && a.at <= `${to}\uffff`);
    }
}

class UserRepository extends Repository {
    constructor() {
        super({ store: 'users', prefix: 'USR', entity: 'User', searchFields: ['name', 'email', 'role'] });
    }

    validate(record) {
        if (!record.name?.trim()) throw new Error('A user needs a name.');
        if (!record.role) throw new Error('Choose a role.');
    }

    async activeUsers() {
        return (await this.all()).filter((u) => u.status === 'active');
    }
}

/* ==========================================================================
   CURRICULUM & ACADEMIC STRUCTURE (Phase 2)
   Independent of batches. A curriculum owns its Level → Stage → Lesson tree
   in `structure`; the level vocabulary lives in its own store so it can be
   edited without code changes.
   ========================================================================== */

class CurriculumRepository extends Repository {
    constructor() {
        super({ store: 'curricula', prefix: 'CUR', entity: 'Curriculum', searchFields: ['name', 'code'] });
    }

    beforeSave(record) {
        return {
            ...record,
            code: String(record.code || '').trim().toUpperCase(),
            name: String(record.name || '').trim(),
            status: record.status || CURRICULUM_STATUS.ACTIVE,
            sortOrder: Number(record.sortOrder) || 0,
            structure: record.structure && typeof record.structure === 'object'
                ? { levels: Array.isArray(record.structure.levels) ? record.structure.levels : [] }
                : { levels: [] }
        };
    }

    validate(record) {
        if (!record.name) throw new Error('A curriculum needs a name.');
        if (!record.code) throw new Error('A curriculum needs a short code, e.g. KUCHI-FND.');
    }

    async active() {
        return (await this.all())
            .filter((c) => c.status === CURRICULUM_STATUS.ACTIVE)
            .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));
    }

    async ordered() {
        return (await this.all())
            .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));
    }
}

class CurriculumLevelRepository extends Repository {
    constructor() {
        super({ store: 'curriculumLevels', prefix: 'CLV', entity: 'Curriculum level', searchFields: ['name', 'code'] });
    }

    beforeSave(record) {
        return {
            ...record,
            code: String(record.code || '').trim().toUpperCase(),
            name: String(record.name || '').trim(),
            status: record.status || CURRICULUM_STATUS.ACTIVE,
            sortOrder: Number(record.sortOrder) || 0
        };
    }

    validate(record) {
        if (!record.name) throw new Error('A level needs a name.');
    }

    async active() {
        return (await this.all())
            .filter((l) => l.status === CURRICULUM_STATUS.ACTIVE)
            .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));
    }

    async ordered() {
        return (await this.all())
            .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));
    }
}

/**
 * Settings are key/value, not entities: no ids, no audit noise, no soft
 * delete. A thin wrapper rather than a Repository subclass, because none of
 * the base class's machinery applies.
 */
export const settings$ = {
    async get(key, fallback = null) {
        const row = await db.get('settings', key);
        return row ? row.value : fallback;
    },

    async set(key, value) {
        await db.put('settings', { key, value, updatedAt: new Date().toISOString() });
        return value;
    },

    async all() {
        const rows = await db.all('settings');
        return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    },

    /**
     * Atomic counter for human-facing numbers (NAT/INV/2026/0417). Read and
     * increment happen inside one transaction so two receipts written in the
     * same tick cannot collide — 1.0 read the count of existing rows, which
     * reused a number as soon as anything was deleted.
     */
    async nextSequence(name, count = 1) {
        let allocated = 0;
        await db.unit(['settings'], async (s) => {
            const row = await request(s.settings.get('sequences'));
            const map = { ...(row?.value || {}) };
            const current = Number(map[name]) || 0;
            allocated = current + 1;
            map[name] = current + count;
            await request(s.settings.put({ key: 'sequences', value: map, updatedAt: new Date().toISOString() }));
        }, 'settings:sequence');
        return allocated;
    }
};

/* ------------------------------------------------------------------ HELPERS */

/** Collapses whitespace and keeps only digits and a leading +. */
function normalisePhone(value) {
    if (!value) return null;
    const cleaned = String(value).replace(/[^\d+]/g, '');
    return cleaned || null;
}

/* ==========================================================================
   SINGLETONS
   One instance each. The `$` suffix marks a repository at the call site so a
   page never confuses `students$` (data access) with `students` (a local array).
   ========================================================================== */

export const branches$      = new BranchRepository();
export const academicYears$ = new AcademicYearRepository();
export const students$      = new StudentRepository();
export const admissions$    = new AdmissionRepository();
export const drafts$        = new AdmissionDraftRepository();
export const batches$       = new BatchRepository();
export const staff$         = new StaffRepository();
export const attendance$    = new AttendanceRepository();
export const holidays$      = new HolidayRepository();
export const leaves$        = new LeaveRequestRepository();
export const feePlans$      = new FeePlanRepository();
export const invoices$      = new InvoiceRepository();
export const payments$      = new PaymentRepository();
export const ledger$        = new LedgerRepository();
export const expenses$      = new ExpenseRepository();
export const salaries$      = new SalaryRepository();
export const programs$      = new ProgramRepository();
export const certificates$  = new CertificateRepository();
export const documents$     = new DocumentRepository();
export const notifications$ = new NotificationRepository();
export const audit$         = new AuditRepository();
export const users$         = new UserRepository();
export const curricula$        = new CurriculumRepository();
export const curriculumLevels$ = new CurriculumLevelRepository();

/** Static analysis helpers re-exported so pages import from one place. */
export const AttendanceMath = AttendanceRepository;
export const InvoiceMath = InvoiceRepository;
export const PaymentMath = PaymentRepository;
export const LedgerMath = LedgerRepository;
export const ExpenseMath = ExpenseRepository;
