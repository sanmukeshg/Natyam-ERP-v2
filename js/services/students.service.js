/**
 * NATYAM ERP 2.0 — Student service
 *
 * Every rule about what a student *is* lives here: how they are enrolled, how
 * they move between batches, when they may be promoted, what happens to their
 * fee book when they leave. Pages call these functions and render the result;
 * they never assemble a student record themselves.
 *
 * Guardian handling lives in this module too rather than in a separate
 * "parent" service. In this school a guardian has no independent existence —
 * there is no parent portal, no parent login, no parent record that outlives
 * the child's enrolment. Modelling them as their own entity would create a
 * second place for a phone number to be wrong. What parents *do* need is
 * treated properly: contact validation, sibling detection across the roll, and
 * a single household view.
 */

import { bus, EVENTS } from '../core/bus.js';
import { session } from '../core/session.js';
import { db, request } from '../core/db.js';
import { uid, sequenceNumber } from '../utils/id.js';
import { localDate, nowISO, academicYearOf, ageFrom, daysBetween, addDays } from '../utils/date.js';
import { STUDENT_STATUS, LEVELS, INVOICE_STATUS, levelLabel } from '../config/app.config.js';
import {
    students$, batches$, invoices$, payments$, attendance$, certificates$,
    documents$, programs$, settings$, AttendanceMath
} from '../data/repositories.js';
import { studentFeeSummary, raiseSchedule } from './fees.service.js';

/* ==========================================================================
   ENROLMENT
   ========================================================================== */

/**
 * Creates a student directly, without going through admissions.
 *
 * 1.0 had no such path at all: the only way onto the roll was an admission
 * application, so a walk-in on the first day of term had to have a fake
 * application typed for them. That is a workflow gap, not a safety feature.
 *
 * @param {object} data
 * @param {boolean} [options.raiseFees=true]  Bill the fee plan immediately.
 */
export async function enrol(data, { raiseFees = true } = {}) {
    session.require('student.edit', 'enrol a student');

    const batch = data.batchId ? await batches$.find(data.batchId) : null;
    assertBatchHasRoom(batch, await countInBatch(data.batchId));

    const year = academicYearOf().start;
    const seq = await settings$.nextSequence('admission');

    const student = await students$.create({
        ...normalise(data),
        admissionNo: data.admissionNo || sequenceNumber('NAT/ADM', year, seq),
        // A student created against a batch inherits that batch's branch and
        // level. Letting the two disagree is how 1.0 produced students who
        // appeared in no branch's list.
        branchId: batch?.branchId || data.branchId,
        level: batch?.level || data.level,
        status: data.status || STUDENT_STATUS.ACTIVE,
        joinedOn: data.joinedOn || localDate()
    });

    let billing = null;
    if (raiseFees && student.feePlanId) {
        billing = await raiseSchedule(student.id, { feePlanId: student.feePlanId, startDate: student.joinedOn });
    }

    bus.emit(EVENTS.STUDENT_CREATED, { student });
    return { student, billing };
}

/** Edits a student. Batch and level changes route through their own rules. */
export async function updateStudent(id, changes) {
    session.require('student.edit', 'edit a student');

    const existing = await students$.findOrFail(id);
    const { batchId, ...rest } = changes;

    let student = await students$.update(id, normalise(rest));
    if (batchId !== undefined && batchId !== existing.batchId) {
        student = await assignToBatch(id, batchId);
    }

    bus.emit(EVENTS.STUDENT_UPDATED, { student, before: existing });
    return student;
}

/**
 * Places a student in a batch, or removes them from one when `batchId` is
 * null. Capacity is enforced here and nowhere else.
 */
export async function assignToBatch(studentId, batchId) {
    session.require('student.edit', 'move a student between batches');

    const student = await students$.findOrFail(studentId);
    if (!batchId) {
        const cleared = await students$.update(studentId, { batchId: null });
        bus.emit(EVENTS.STUDENT_UPDATED, { student: cleared, before: student });
        return cleared;
    }

    const batch = await batches$.findOrFail(batchId);
    if (batch.status !== 'active') throw new Error(`${batch.name} is closed and cannot take students.`);
    assertBatchHasRoom(batch, await countInBatch(batchId, studentId));

    if (batch.level !== student.level) {
        throw new Error(
            `${student.name} is at ${levelLabel(student.level)} and ${batch.name} teaches ${levelLabel(batch.level)}. ` +
            'Promote the student first, or choose a batch at their level.'
        );
    }

    const updated = await students$.update(studentId, { batchId, branchId: batch.branchId });
    bus.emit(EVENTS.STUDENT_UPDATED, { student: updated, before: student });
    return updated;
}

/**
 * Moves a student up the curriculum ladder.
 *
 * The batch is deliberately cleared: a promoted student is not yet in a class
 * at the new level, and leaving them attached to their old batch would put
 * them on a roll call they no longer attend. They surface in the "awaiting
 * placement" queue, which is the correct next action for a registrar.
 */
export async function promote(studentId, { note = null } = {}) {
    session.require('student.edit', 'promote a student');

    const student = await students$.findOrFail(studentId);
    const index = LEVELS.findIndex((l) => l.value === student.level);
    if (index === -1) throw new Error(`${student.name} is at an unrecognised level.`);
    if (index === LEVELS.length - 1) {
        throw new Error(`${student.name} has completed ${LEVELS[index].label}, the final level. Issue a diploma certificate instead.`);
    }

    const next = LEVELS[index + 1];
    const updated = await students$.update(studentId, {
        level: next.value,
        batchId: null,
        promotedOn: localDate(),
        promotionNote: note?.trim() || null
    });

    bus.emit(EVENTS.STUDENT_UPDATED, { student: updated, before: student });
    return { student: updated, from: LEVELS[index], to: next };
}

/**
 * Marks a student as no longer attending.
 *
 * Their record is never deleted — attendance history, receipts and
 * certificates are all legal documents. Outstanding invoices are reported back
 * to the caller rather than silently cancelled: whether a leaver still owes
 * money is a decision for a person, not for this function.
 */
export async function setStatus(studentId, status, { reason = null } = {}) {
    session.require('student.edit', "change a student's status");

    if (!Object.values(STUDENT_STATUS).includes(status)) throw new Error('That is not a valid student status.');
    const student = await students$.findOrFail(studentId);
    if (student.status === status) return { student, outstanding: 0 };

    const leaving = status === STUDENT_STATUS.INACTIVE || status === STUDENT_STATUS.GRADUATED;
    if (leaving && !reason?.trim()) throw new Error('Record why the student is leaving — it is the only history of it.');

    const updated = await students$.update(studentId, {
        status,
        // A student who is not attending should not sit on a roll call.
        batchId: leaving ? null : student.batchId,
        statusReason: reason?.trim() || null,
        statusChangedOn: localDate(),
        ...(status === STUDENT_STATUS.GRADUATED ? { graduatedOn: localDate() } : {})
    });

    const open = await invoices$.forStudent(studentId);
    const outstanding = open.reduce((sum, i) => sum + (i.balance || 0), 0);

    bus.emit(EVENTS.STUDENT_UPDATED, { student: updated, before: student });
    return { student: updated, outstanding };
}

/** Archives a student. Refuses while money is outstanding. */
export async function archive(studentId) {
    session.require('student.delete', 'archive a student');

    const student = await students$.findOrFail(studentId);
    const outstanding = (await invoices$.forStudent(studentId)).reduce((s, i) => s + (i.balance || 0), 0);
    if (outstanding > 0) {
        throw new Error(`${student.name} has ₹${(outstanding / 100).toFixed(2)} outstanding. Settle or waive it before archiving.`);
    }

    await students$.remove(studentId);
    bus.emit(EVENTS.STUDENT_REMOVED, { student });
    return true;
}

export async function restore(studentId) {
    session.require('student.edit', 'restore a student');
    await students$.restore(studentId);
    const student = await students$.find(studentId);
    bus.emit(EVENTS.STUDENT_UPDATED, { student });
    return student;
}

/* ==========================================================================
   THE STUDENT DASHBOARD
   ========================================================================== */

/**
 * Everything the student profile shows, resolved in one call.
 *
 * Assembled here rather than in the page because five of these figures are
 * also quoted on the dashboard, in reports and on the printed progress sheet.
 * A page that computes its own attendance rate is a page that will eventually
 * disagree with the report.
 */
export async function profile(studentId) {
    const student = await students$.findOrFail(studentId);

    const [batch, fees, attendanceRows, certs, docs, allPrograms] = await Promise.all([
        student.batchId ? batches$.find(student.batchId) : null,
        studentFeeSummary(studentId),
        attendance$.forStudent(studentId),
        certificates$.forStudent(studentId),
        documents$.forOwner(studentId),
        programs$.all()
    ]);

    const since90 = addDays(localDate(), -90);
    const recent = attendanceRows.filter((r) => r.date >= since90);

    return {
        student,
        batch,
        age: student.dateOfBirth ? ageFrom(student.dateOfBirth) : null,
        tenureDays: student.joinedOn ? daysBetween(student.joinedOn, localDate()) : 0,
        level: LEVELS.find((l) => l.value === student.level) || null,
        guardian: guardianOf(student),
        fees,
        attendance: {
            rows: attendanceRows,
            rate: AttendanceMath.rateOf(attendanceRows),
            recentRate: AttendanceMath.rateOf(recent),
            breakdown: AttendanceMath.breakdownOf(attendanceRows),
            lastSeen: attendanceRows.find((r) => r.status !== 'absent')?.date || null
        },
        certificates: certs,
        documents: docs,
        programs: allPrograms.filter((p) => (p.participants || []).includes(studentId)),
        timeline: await timelineFor(student, fees, certs)
    };
}

/**
 * A single chronological record of everything that has happened to a student.
 * Built from the records themselves rather than from the audit log, because
 * the audit log answers "who changed what" and this answers "what happened to
 * this child" — different questions with different audiences.
 */
async function timelineFor(student, fees, certs) {
    const events = [
        { at: student.joinedOn, kind: 'joined', title: 'Joined the school', detail: levelLabel(student.level) }
    ];

    if (student.promotedOn) {
        events.push({ at: student.promotedOn, kind: 'promoted', title: `Promoted to ${levelLabel(student.level)}`, detail: student.promotionNote });
    }
    if (student.graduatedOn) {
        events.push({ at: student.graduatedOn, kind: 'graduated', title: 'Graduated', detail: student.statusReason });
    }

    for (const receipt of fees.receipts.slice(0, 12)) {
        events.push({
            at: receipt.paidOn,
            kind: 'payment',
            title: `Fee received — ${receipt.receiptNo}`,
            detail: receipt.mode,
            amount: receipt.amount
        });
    }
    for (const certificate of certs) {
        events.push({ at: certificate.issuedOn, kind: 'certificate', title: certificate.title, detail: certificate.serial });
    }

    return events
        .filter((e) => e.at)
        .sort((a, b) => b.at.localeCompare(a.at));
}

/* ==========================================================================
   GUARDIANS AND HOUSEHOLDS
   ========================================================================== */

/** The guardian view of a student, shaped for display. */
export function guardianOf(student) {
    return {
        name: student.guardianName || null,
        relation: student.guardianRelation || 'Guardian',
        phone: student.guardianPhone || null,
        alternatePhone: student.alternatePhone || null,
        email: student.guardianEmail || null,
        address: student.address || null,
        emergencyContact: student.emergencyContact || student.guardianPhone || null
    };
}

/**
 * Siblings — students sharing a guardian phone number.
 *
 * Worth having: it is how the front desk knows that chasing one family's dues
 * covers two children, and how a fee concession gets applied consistently.
 * Matching on the normalised phone rather than the name, because names are
 * spelled three ways and phone numbers are not.
 */
export async function household(studentId) {
    const student = await students$.findOrFail(studentId);
    if (!student.guardianPhone) return { guardian: guardianOf(student), members: [student] };

    const members = (await students$.all())
        .filter((s) => s.guardianPhone === student.guardianPhone)
        .sort((a, b) => (a.dateOfBirth || '').localeCompare(b.dateOfBirth || ''));

    const balances = await Promise.all(members.map(async (m) => {
        const invoices = await invoices$.forStudent(m.id);
        return invoices.reduce((sum, i) => sum + (i.balance || 0), 0);
    }));

    return {
        guardian: guardianOf(student),
        members: members.map((m, i) => ({ ...m, outstanding: balances[i] })),
        totalOutstanding: balances.reduce((a, b) => a + b, 0)
    };
}

/**
 * Contact sheet for a batch or branch — the list a teacher takes to a
 * performance venue. Emergency contact falls back to the guardian number so
 * the column is never blank when it matters most.
 */
export async function contactSheet({ batchId = null, branchId = null } = {}) {
    let rows = await students$.active(branchId);
    if (batchId) rows = rows.filter((s) => s.batchId === batchId);

    return rows
        .sort((a, b) => a.name.localeCompare(b.name, 'en-IN'))
        .map((s) => ({
            id: s.id,
            name: s.name,
            admissionNo: s.admissionNo,
            guardianName: s.guardianName,
            guardianPhone: s.guardianPhone,
            emergency: s.emergencyContact || s.guardianPhone,
            bloodGroup: s.bloodGroup || null,
            medicalNotes: s.medicalNotes || null
        }));
}

/** Students whose medical notes a teacher must read before class. */
export async function medicalAlerts(branchId = null) {
    return (await students$.active(branchId))
        .filter((s) => s.medicalNotes?.trim())
        .map((s) => ({ id: s.id, name: s.name, batchId: s.batchId, note: s.medicalNotes, bloodGroup: s.bloodGroup }));
}

/* ==========================================================================
   BULK OPERATIONS
   ========================================================================== */

/**
 * Moves a group of students to another batch in one transaction.
 *
 * Bulk actions need a different failure model from single ones: stopping at
 * the first invalid student would leave half the selection moved and give the
 * registrar no idea which half. Everything is validated first, and either the
 * whole move commits or none of it does.
 */
export async function bulkAssign(studentIds, batchId) {
    session.require('student.edit', 'move students between batches');

    const batch = await batches$.findOrFail(batchId);
    if (batch.status !== 'active') throw new Error(`${batch.name} is closed.`);

    const records = await Promise.all(studentIds.map((id) => students$.findOrFail(id)));
    const wrongLevel = records.filter((s) => s.level !== batch.level);
    if (wrongLevel.length) {
        throw new Error(
            `${wrongLevel.length} of the selected students are not at ${levelLabel(batch.level)}: ` +
            `${wrongLevel.slice(0, 3).map((s) => s.name).join(', ')}${wrongLevel.length > 3 ? '…' : ''}.`
        );
    }

    const incoming = records.filter((s) => s.batchId !== batchId).length;
    const current = await countInBatch(batchId);
    if (batch.capacity && current + incoming > batch.capacity) {
        throw new Error(`${batch.name} seats ${batch.capacity}. Moving ${incoming} students would make ${current + incoming}.`);
    }

    const at = nowISO();
    const actor = session.actorId();
    const updated = records.map((s) => ({ ...s, batchId, branchId: batch.branchId, updatedAt: at, updatedBy: actor }));

    await db.unit(['students', 'auditLog'], async (s) => {
        for (const record of updated) await request(s.students.put(record));
        await request(s.auditLog.put({
            id: uid('AUD'), entity: 'Student', entityId: null, action: 'bulkAssign',
            detail: { batchId, count: updated.length },
            actorId: actor, actorName: session.actorName(), at
        }));
    }, 'student:bulk-assign');

    for (const student of updated) bus.emit(EVENTS.STUDENT_UPDATED, { student });
    return updated.length;
}

/* ==========================================================================
   ANALYTICS
   ========================================================================== */

/** Roll composition — the figures behind the students page header. */
export async function rollSummary(branchId = null) {
    const all = (await students$.all()).filter((s) => !branchId || s.branchId === branchId);
    const active = all.filter((s) => s.status === STUDENT_STATUS.ACTIVE);

    const thisMonth = localDate().slice(0, 7);
    return {
        total: all.length,
        active: active.length,
        onLeave: all.filter((s) => s.status === STUDENT_STATUS.ON_LEAVE).length,
        inactive: all.filter((s) => s.status === STUDENT_STATUS.INACTIVE).length,
        graduated: all.filter((s) => s.status === STUDENT_STATUS.GRADUATED).length,
        unplaced: active.filter((s) => !s.batchId).length,
        joinedThisMonth: all.filter((s) => (s.joinedOn || '').startsWith(thisMonth)).length,
        byLevel: LEVELS.map((level) => ({
            level: level.value,
            label: level.label,
            count: active.filter((s) => s.level === level.value).length
        })),
        genderSplit: {
            female: active.filter((s) => s.gender === 'female').length,
            male: active.filter((s) => s.gender === 'male').length,
            other: active.filter((s) => s.gender && !['female', 'male'].includes(s.gender)).length
        }
    };
}

/**
 * Students at risk of dropping out: attendance below 70% over the last eight
 * weeks, or nothing marked for them in a month. Surfaced so a teacher can call
 * the family while it is still recoverable rather than reading about it in an
 * end-of-year report.
 */
export async function atRisk(branchId = null, { threshold = 70, days = 56 } = {}) {
    const students = await students$.active(branchId);
    const from = addDays(localDate(), -days);
    const rows = await attendance$.between(from, localDate(), branchId);

    const byStudent = new Map();
    for (const row of rows) {
        if (!byStudent.has(row.studentId)) byStudent.set(row.studentId, []);
        byStudent.get(row.studentId).push(row);
    }

    return students
        .map((student) => {
            const own = byStudent.get(student.id) || [];
            const rate = AttendanceMath.rateOf(own);
            const lastSeen = own
                .filter((r) => r.status !== 'absent')
                .sort((a, b) => b.date.localeCompare(a.date))[0]?.date || null;
            return { student, rate, sessions: own.length, lastSeen };
        })
        .filter((row) => {
            if (!row.sessions) return false;               // no classes scheduled — not a signal
            if (row.rate !== null && row.rate < threshold) return true;
            return row.lastSeen ? daysBetween(row.lastSeen, localDate()) > 30 : true;
        })
        .sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0));
}

/* ------------------------------------------------------------------ HELPERS */

function normalise(data) {
    const out = { ...data };
    if (out.name) out.name = String(out.name).trim().replace(/\s+/g, ' ');
    if (out.guardianEmail) out.guardianEmail = String(out.guardianEmail).trim().toLowerCase();
    return out;
}

async function countInBatch(batchId, excludeStudentId = null) {
    if (!batchId) return 0;
    const roster = await students$.byBatch(batchId);
    return roster.filter((s) => s.id !== excludeStudentId).length;
}

function assertBatchHasRoom(batch, currentCount) {
    if (!batch || !batch.capacity) return;
    if (currentCount >= batch.capacity) {
        throw new Error(`${batch.name} is full — ${currentCount} of ${batch.capacity} seats taken. Increase the capacity or choose another batch.`);
    }
}


export { LEVELS as levels };

/* ==========================================================================
   LISTING
   The roll, assembled for display. The page asks for a list and gets rows it
   can render directly; it never joins a batch name onto a student itself,
   because the moment two pages do that join they will disagree about what an
   unplaced student is called.
   ========================================================================== */

/**
 * @param {string|null} branchId
 * @param {object} options
 * @param {string} [options.status]        A STUDENT_STATUS value, or 'all'.
 * @param {string} [options.level]
 * @param {string} [options.batchId]
 * @param {'unplaced'|'overdue'|'at-risk'|null} [options.filter]
 * @param {boolean} [options.withFees=true]  Attach outstanding balances.
 */
export async function listStudents(branchId = null, {
    status = STUDENT_STATUS.ACTIVE,
    level = null,
    batchId = null,
    filter = null,
    withFees = true
} = {}) {
    const [all, batchRows] = await Promise.all([students$.all(), batches$.all()]);

    const batchOf = new Map(batchRows.map((b) => [b.id, b]));

    let rows = all.filter((s) => (!branchId || s.branchId === branchId));
    if (status && status !== 'all') rows = rows.filter((s) => s.status === status);
    if (level) rows = rows.filter((s) => s.level === level);
    if (batchId) rows = rows.filter((s) => s.batchId === batchId);
    if (filter === 'unplaced') rows = rows.filter((s) => !s.batchId);

    // One invoice sweep for the whole page rather than one per student: with
    // 87 students that is the difference between 1 read and 88.
    let owed = new Map();
    if (withFees) {
        const invoices = await invoices$.all();
        for (const invoice of invoices) {
            if (invoice.status === INVOICE_STATUS.CANCELLED) continue;
            const current = owed.get(invoice.studentId) || { outstanding: 0, overdue: 0 };
            current.outstanding += invoice.balance || 0;
            if ((invoice.balance || 0) > 0 && invoice.dueDate < localDate()) current.overdue += invoice.balance;
            owed.set(invoice.studentId, current);
        }
    }

    let assembled = rows.map((student) => {
        const batch = student.batchId ? batchOf.get(student.batchId) : null;
        const fees = owed.get(student.id) || { outstanding: 0, overdue: 0 };

        return {
            ...student,
            batchName: batch?.name || null,
            batchCode: batch?.code || null,
            levelLabel: levelLabel(student.level),
            guardianName: student.guardianName || null,
            guardianPhone: student.guardianPhone || null,
            outstanding: fees.outstanding,
            overdue: fees.overdue,
            feeState: fees.overdue > 0 ? 'overdue' : fees.outstanding > 0 ? 'due' : 'clear'
        };
    });

    if (filter === 'overdue') assembled = assembled.filter((s) => s.overdue > 0);

    if (filter === 'at-risk') {
        const risky = new Set((await atRisk(branchId)).map((r) => r.student?.id || r.id));
        assembled = assembled.filter((s) => risky.has(s.id));
    }

    return assembled.sort((a, b) => a.name.localeCompare(b.name, 'en-IN'));
}

/** Everything the list page's filter bar needs, so the page invents nothing. */
export async function listFilters(branchId = null) {
    const batchRows = await batches$.all();
    return {
        levels: LEVELS.map((l) => ({ value: l.value, label: l.label })),
        batches: batchRows
            .filter((b) => (!branchId || b.branchId === branchId) && b.status !== 'closed')
            .map((b) => ({ value: b.id, label: b.name })),
        statuses: Object.values(STUDENT_STATUS).map((value) => ({
            value,
            label: value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
        }))
    };
}

/* ==========================================================================
   HOUSEHOLDS
   --------------------------------------------------------------------------
   Guardians have no record of their own in this system, for the reasons set
   out at the top of this file. A household is therefore *derived*: the set of
   students who share a contact number. That derivation happens exactly once,
   here, so the student drawer's sibling list and the parents screen can never
   disagree about who lives with whom.
   ========================================================================== */

/** Every household on the roll, with contact details and combined balance. */
export async function households(branchId = null, { includeInactive = false } = {}) {
    const [all, batchRows, invoices] = await Promise.all([
        students$.all(), batches$.all(), invoices$.all()
    ]);

    const batchOf = new Map(batchRows.map((b) => [b.id, b]));

    const owed = new Map();
    for (const invoice of invoices) {
        if (invoice.status === INVOICE_STATUS.CANCELLED) continue;
        owed.set(invoice.studentId, (owed.get(invoice.studentId) || 0) + (invoice.balance || 0));
    }

    const scoped = all.filter((s) =>
        (!branchId || s.branchId === branchId)
        && (includeInactive || s.status === STUDENT_STATUS.ACTIVE));

    const groups = new Map();

    for (const student of scoped) {
        // Students with no number cannot be grouped with anyone; each becomes
        // their own household rather than collapsing into a single nameless
        // blob, which is what a naive groupBy would do.
        const key = student.guardianPhone
            ? String(student.guardianPhone).replace(/\D/g, '').slice(-10)
            : `solo:${student.id}`;

        if (!groups.has(key)) {
            groups.set(key, {
                key,
                guardianName: student.guardianName || 'Not recorded',
                guardianRelation: student.guardianRelation || 'Guardian',
                phone: student.guardianPhone || null,
                email: student.guardianEmail || null,
                alternatePhone: student.alternatePhone || null,
                address: student.address || null,
                branchId: student.branchId,
                children: [],
                outstanding: 0,
                contactable: Boolean(student.guardianPhone)
            });
        }

        const group = groups.get(key);
        const balance = owed.get(student.id) || 0;

        group.children.push({
            id: student.id,
            name: student.name,
            level: student.level,
            levelLabel: levelLabel(student.level),
            status: student.status,
            batchId: student.batchId,
            batchName: student.batchId ? (batchOf.get(student.batchId)?.name || null) : null,
            outstanding: balance
        });
        group.outstanding += balance;
        // A later record may carry an email the first one lacked.
        group.email = group.email || student.guardianEmail || null;
        group.alternatePhone = group.alternatePhone || student.alternatePhone || null;
    }

    return [...groups.values()]
        .map((group) => ({ ...group, size: group.children.length }))
        .sort((a, b) => b.size - a.size || a.guardianName.localeCompare(b.guardianName, 'en-IN'));
}

/** Headline numbers for the households screen. */
export async function householdSummary(branchId = null) {
    const groups = await households(branchId);
    return {
        households: groups.length,
        multiChild: groups.filter((g) => g.size > 1).length,
        missingPhone: groups.filter((g) => !g.contactable).length,
        missingEmail: groups.filter((g) => !g.email).length,
        owing: groups.filter((g) => g.outstanding > 0).length,
        totalOutstanding: groups.reduce((sum, g) => sum + g.outstanding, 0)
    };
}
