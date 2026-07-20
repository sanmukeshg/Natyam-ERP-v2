/**
 * NATYAM ERP 2.0 — Attendance service
 *
 * Roll call is the operation this product performs most often and the one 1.0
 * got most wrong. Three faults, all fixed here:
 *
 *  1. Saving the same roll call twice created a second set of rows, because
 *     the id was minted fresh each time. Every record now carries a composite
 *     `batchId|date|studentId` key on a unique index, so a re-save is an
 *     update by construction rather than by remembering to check.
 *  2. Rows were written one at a time in a loop of separate transactions. A
 *     failure halfway left a class half-marked. The whole roll call is now one
 *     transaction.
 *  3. Marking a date the school was closed produced a day of "absent" for
 *     everyone, which then dragged every attendance percentage down. Holidays
 *     and approved leave are checked before the register is even shown.
 */

import { bus, EVENTS } from '../core/bus.js';
import { session } from '../core/session.js';
import { db, request } from '../core/db.js';
import { uid } from '../utils/id.js';
import { localDate, nowISO, addDays, daysBetween, monthKey, dayName, startOfMonth, endOfMonth, lastMonths } from '../utils/date.js';
import { ATTENDANCE_STATUS } from '../config/app.config.js';
import {
    attendance$, students$, batches$, holidays$, leaves$, staff$, AttendanceMath
} from '../data/repositories.js';
import { notify } from './notifications.service.js';

const DAY_CODES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ==========================================================================
   PREPARING A REGISTER
   ========================================================================== */

/**
 * Builds the register a teacher sees: the roster, whatever was marked before,
 * and every reason a student might legitimately be away.
 *
 * Returns rather than throws when the batch does not meet on the given date.
 * Teachers do reach the wrong day, and a thrown error would put an exception
 * screen where a sentence is wanted.
 */
export async function openRegister(batchId, date = localDate()) {
    const batch = await batches$.findOrFail(batchId);
    const dayCode = DAY_CODES[new Date(`${date}T00:00:00`).getDay()];

    const [roster, existing, holiday] = await Promise.all([
        students$.byBatch(batchId),
        attendance$.forBatchOn(batchId, date),
        holidays$.on(date, batch.branchId)
    ]);

    const marked = new Map(existing.map((row) => [row.studentId, row]));
    const leaveByStudent = new Map();
    for (const student of roster) {
        const leave = await leaves$.coveringDate(student.id, date);
        if (leave) leaveByStudent.set(student.id, leave);
    }

    const entries = roster.map((student) => {
        const prior = marked.get(student.id);
        const leave = leaveByStudent.get(student.id);
        return {
            studentId: student.id,
            name: student.name,
            admissionNo: student.admissionNo,
            photo: student.photo || null,
            medicalNotes: student.medicalNotes || null,
            // Default: an approved leave pre-fills as excused so a teacher does
            // not have to remember which of thirty children has a note.
            status: prior?.status || (leave ? ATTENDANCE_STATUS.EXCUSED : ATTENDANCE_STATUS.PRESENT),
            note: prior?.note || (leave ? leave.reason : null),
            onLeave: Boolean(leave),
            previouslyMarked: Boolean(prior)
        };
    });

    return {
        batch,
        date,
        dayName: dayName(date),
        meetsToday: batch.days.includes(dayCode),
        holiday,
        alreadyMarked: existing.length > 0,
        markedAt: existing[0]?.updatedAt || null,
        entries,
        empty: roster.length === 0
    };
}

/** Every batch meeting on a date, with whether its register is done. */
export async function dayBoard(date = localDate(), branchId = null) {
    const [meeting, marked, holiday, teachers] = await Promise.all([
        batches$.meetingOn(date, branchId),
        attendance$.onDate(date, branchId),
        holidays$.on(date, branchId),
        staff$.teachers()
    ]);

    const byBatch = new Map();
    for (const row of marked) {
        if (!byBatch.has(row.batchId)) byBatch.set(row.batchId, []);
        byBatch.get(row.batchId).push(row);
    }

    const teacherName = new Map(teachers.map((t) => [t.id, t.name]));
    const rosterCounts = await Promise.all(meeting.map((b) => students$.byBatch(b.id)));

    return {
        date,
        holiday,
        batches: meeting.map((batch, index) => {
            const rows = byBatch.get(batch.id) || [];
            return {
                ...batch,
                teacherName: teacherName.get(batch.teacherId) || 'Unassigned',
                expected: rosterCounts[index].length,
                marked: rows.length,
                done: rows.length > 0,
                rate: AttendanceMath.rateOf(rows),
                breakdown: AttendanceMath.breakdownOf(rows)
            };
        })
    };
}

/* ==========================================================================
   POSTING
   ========================================================================== */

/**
 * Writes a roll call.
 *
 * One transaction, composite keys, and a read-before-write so that re-marking
 * preserves the original `createdAt` — the difference between "marked at 6:35
 * this morning" and "corrected at 4pm" is the sort of thing a parent dispute
 * turns on.
 *
 * @param {object} params
 * @param {string} params.batchId
 * @param {string} params.date
 * @param {Array<{studentId: string, status: string, note?: string}>} params.entries
 */
export async function postRegister({ batchId, date, entries }) {
    session.require('attendance.mark', 'mark attendance');

    const batch = await batches$.findOrFail(batchId);
    if (!date) throw new Error('Choose the date being marked.');
    if (date > localDate()) throw new Error('Attendance cannot be marked for a future date.');
    if (!Array.isArray(entries) || !entries.length) throw new Error('There is nobody in this batch to mark.');

    const valid = new Set(Object.values(ATTENDANCE_STATUS));
    for (const entry of entries) {
        if (!entry.studentId) throw new Error('An attendance row is missing its student.');
        if (!valid.has(entry.status)) throw new Error(`"${entry.status}" is not a valid attendance status.`);
    }

    // Backdating beyond a fortnight is almost always a mistyped date rather
    // than a genuine correction, so it is refused rather than absorbed.
    const age = daysBetween(date, localDate());
    if (age > 30) {
        throw new Error(`That date is ${age} days ago. Attendance can only be marked or corrected within 30 days.`);
    }

    const existing = await attendance$.forBatchOn(batchId, date);
    const priorByStudent = new Map(existing.map((row) => [row.studentId, row]));
    const at = nowISO();
    const actor = session.actorId();

    const records = entries.map((entry) => {
        const prior = priorByStudent.get(entry.studentId);
        return {
            id: prior?.id || uid('ATT'),
            batchDate: `${batchId}|${date}|${entry.studentId}`,
            studentId: entry.studentId,
            batchId,
            branchId: batch.branchId,
            date,
            status: entry.status,
            note: entry.note?.trim() || null,
            markedBy: actor,
            markedByName: session.actorName(),
            createdAt: prior?.createdAt || at,
            createdBy: prior?.createdBy || actor,
            updatedAt: at,
            updatedBy: actor,
            correctedFrom: prior && prior.status !== entry.status ? prior.status : null
        };
    });

    const corrections = records.filter((r) => r.correctedFrom).length;

    await db.unit(['attendance', 'auditLog'], async (s) => {
        for (const record of records) await request(s.attendance.put(record));
        await request(s.auditLog.put({
            id: uid('AUD'),
            entity: 'Attendance',
            entityId: batchId,
            action: existing.length ? 'correct' : 'mark',
            detail: { date, count: records.length, corrections },
            actorId: actor, actorName: session.actorName(), at
        }));
    }, 'attendance:post');

    const summary = {
        batchId, date,
        total: records.length,
        breakdown: AttendanceMath.breakdownOf(records),
        rate: AttendanceMath.rateOf(records),
        corrected: corrections,
        wasUpdate: existing.length > 0
    };

    bus.emit(EVENTS.ATTENDANCE_SAVED, summary);
    return summary;
}

/**
 * Marks a whole day as a holiday across every batch that would have met.
 *
 * Holiday rows are written rather than simply skipping the day: an absent
 * *record* means "nobody came and that is fine", while an absent *row* is
 * indistinguishable from a register nobody got round to.
 */
export async function declareHoliday({ date, name, branchId = null, mark = true }) {
    session.require('attendance.mark', 'declare a holiday');

    if (!date) throw new Error('Choose a date.');
    if (!name?.trim()) throw new Error('Give the holiday a name — it appears on the calendar.');

    const holiday = await holidays$.create({ date, name: name.trim(), branchId });

    let marked = 0;
    if (mark) {
        const batches = await batches$.meetingOn(date, branchId);
        for (const batch of batches) {
            const roster = await students$.byBatch(batch.id);
            if (!roster.length) continue;
            const result = await postRegister({
                batchId: batch.id,
                date,
                entries: roster.map((s) => ({ studentId: s.id, status: ATTENDANCE_STATUS.HOLIDAY, note: name.trim() }))
            });
            marked += result.total;
        }
    }

    bus.emit(EVENTS.HOLIDAY_CHANGED, { holiday, marked });
    return { holiday, marked };
}

export async function removeHoliday(id) {
    session.require('attendance.mark', 'remove a holiday');
    const holiday = await holidays$.findOrFail(id);
    await holidays$.remove(id);
    bus.emit(EVENTS.HOLIDAY_CHANGED, { holiday: null, removed: holiday });
    return true;
}

/* ==========================================================================
   LEAVE
   ========================================================================== */

export async function requestLeave({ studentId, fromDate, toDate, reason }) {
    const student = await students$.findOrFail(studentId);

    const request$ = await leaves$.create({
        studentId,
        studentName: student.name,
        branchId: student.branchId,
        batchId: student.batchId,
        fromDate,
        toDate,
        reason: reason?.trim(),
        status: 'pending',
        requestedOn: localDate()
    });

    await notify({
        kind: 'attendance',
        key: `leave:${request$.id}`,
        title: `Leave requested — ${student.name}`,
        body: `${fromDate} to ${toDate}: ${request$.reason}`,
        link: '#/attendance?tab=leave'
    });

    bus.emit(EVENTS.LEAVE_REQUESTED, { request: request$ });
    return request$;
}

/**
 * Approving leave rewrites any attendance already marked in the covered range
 * from absent to excused. Without that, a family who gave three weeks' notice
 * still shows a wall of red on the child's record.
 */
export async function decideLeave(id, approved, { note = null } = {}) {
    session.require('attendance.mark', 'decide a leave request');

    const leave = await leaves$.findOrFail(id);
    if (leave.status !== 'pending') throw new Error('This request has already been decided.');

    const updated = await leaves$.update(id, {
        status: approved ? 'approved' : 'declined',
        decidedOn: localDate(),
        decidedBy: session.actorId(),
        decisionNote: note?.trim() || null
    });

    let amended = 0;
    if (approved) {
        const rows = (await attendance$.forStudent(leave.studentId, { from: leave.fromDate, to: leave.toDate }))
            .filter((r) => r.status === ATTENDANCE_STATUS.ABSENT);

        if (rows.length) {
            const at = nowISO();
            const amendedRows = rows.map((r) => ({
                ...r,
                status: ATTENDANCE_STATUS.EXCUSED,
                note: leave.reason,
                correctedFrom: ATTENDANCE_STATUS.ABSENT,
                updatedAt: at,
                updatedBy: session.actorId()
            }));
            await db.putMany('attendance', amendedRows);
            amended = amendedRows.length;
            bus.emit(EVENTS.ATTENDANCE_SAVED, { batchId: leave.batchId, date: leave.fromDate, amended });
        }
    }

    bus.emit(EVENTS.LEAVE_DECIDED, { request: updated, amended });
    return { request: updated, amended };
}

/* ==========================================================================
   ANALYTICS
   ========================================================================== */

/** Attendance for one month, shaped as a calendar grid for the monthly view. */
export async function monthlyGrid({ batchId, month = monthKey() }) {
    const [year, mon] = month.split('-').map(Number);
    const from = `${month}-01`;
    const to = endOfMonth(new Date(year, mon - 1, 1));

    const [roster, rows, holidayRows, batch] = await Promise.all([
        students$.byBatch(batchId),
        attendance$.between(from, to),
        holidays$.inRange(from, to),
        batches$.findOrFail(batchId)
    ]);

    const mine = rows.filter((r) => r.batchId === batchId);
    const byKey = new Map(mine.map((r) => [`${r.studentId}|${r.date}`, r]));
    const holidays = new Set(holidayRows.map((h) => h.date));

    // Only days the batch actually meets become columns. Showing all 31 days
    // makes a grid that is 80% empty and unreadable on a laptop.
    const days = [];
    for (let d = new Date(year, mon - 1, 1); d.getMonth() === mon - 1; d.setDate(d.getDate() + 1)) {
        const date = localDate(d);
        if (date > localDate()) break;
        if (!batch.days.includes(DAY_CODES[d.getDay()])) continue;
        days.push({ date, day: d.getDate(), holiday: holidays.has(date) });
    }

    return {
        batch,
        month,
        days,
        rows: roster.map((student) => {
            const cells = days.map((d) => byKey.get(`${student.id}|${d.date}`)?.status || null);
            const present = cells.filter((c) => c && c !== ATTENDANCE_STATUS.ABSENT && c !== ATTENDANCE_STATUS.HOLIDAY).length;
            const counted = cells.filter((c) => c && c !== ATTENDANCE_STATUS.HOLIDAY).length;
            return {
                student,
                cells,
                present,
                counted,
                rate: counted ? Math.round((present / counted) * 100) : null
            };
        })
    };
}

/** Headline attendance figures for a range — used by dashboard and reports. */
export async function summary({ from, to, branchId = null, batchId = null }) {
    let rows = await attendance$.between(from, to, branchId);
    if (batchId) rows = rows.filter((r) => r.batchId === batchId);

    const breakdown = AttendanceMath.breakdownOf(rows);
    const sessions = new Set(rows.map((r) => `${r.batchId}|${r.date}`)).size;

    return {
        from, to,
        marks: rows.length,
        sessions,
        rate: AttendanceMath.rateOf(rows),
        breakdown,
        byDate: groupRate(rows, (r) => r.date),
        byBatch: groupRate(rows, (r) => r.batchId)
    };
}

/** Monthly attendance rate over the last n months, for the trend chart. */
export async function trend(months = 6, branchId = null) {
    const keys = lastMonths(months);
    const from = `${keys[0]}-01`;
    const rows = await attendance$.between(from, localDate(), branchId);

    return keys.map((key) => {
        const slice = rows.filter((r) => r.date.startsWith(key));
        return { period: key, rate: AttendanceMath.rateOf(slice), marks: slice.length };
    });
}

/** Per-teacher marking discipline — how many of their registers are done. */
export async function teacherCompliance({ from, to, branchId = null }) {
    const [teachers, batches, rows] = await Promise.all([
        staff$.teachers(branchId),
        batches$.active(branchId),
        attendance$.between(from, to, branchId)
    ]);

    const done = new Set(rows.map((r) => `${r.batchId}|${r.date}`));

    return teachers.map((teacher) => {
        const own = batches.filter((b) => b.teacherId === teacher.id);
        let expected = 0;
        let marked = 0;

        for (const batch of own) {
            for (let d = new Date(`${from}T00:00:00`); localDate(d) <= to; d.setDate(d.getDate() + 1)) {
                if (!batch.days.includes(DAY_CODES[d.getDay()])) continue;
                expected += 1;
                if (done.has(`${batch.id}|${localDate(d)}`)) marked += 1;
            }
        }

        return {
            teacher,
            batches: own.length,
            expected,
            marked,
            compliance: expected ? Math.round((marked / expected) * 100) : null
        };
    }).sort((a, b) => (a.compliance ?? 101) - (b.compliance ?? 101));
}

/** Registers that were never filled in — the follow-up list. */
export async function missingRegisters({ days = 14, branchId = null } = {}) {
    const from = addDays(localDate(), -days);
    const [batches, rows] = await Promise.all([
        batches$.active(branchId),
        attendance$.between(from, localDate(), branchId)
    ]);

    const done = new Set(rows.map((r) => `${r.batchId}|${r.date}`));
    const missing = [];

    for (const batch of batches) {
        for (let d = new Date(`${from}T00:00:00`); localDate(d) <= localDate(); d.setDate(d.getDate() + 1)) {
            const date = localDate(d);
            if (!batch.days.includes(DAY_CODES[d.getDay()])) continue;
            if (done.has(`${batch.id}|${date}`)) continue;
            if (await holidays$.on(date, batch.branchId)) continue;
            missing.push({ batch, date, age: daysBetween(date, localDate()) });
        }
    }

    return missing.sort((a, b) => b.age - a.age);
}

/* ------------------------------------------------------------------ HELPERS */

function groupRate(rows, keyOf) {
    const groups = new Map();
    for (const row of rows) {
        const key = keyOf(row);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    }
    return [...groups.entries()]
        .map(([key, group]) => ({ key, rate: AttendanceMath.rateOf(group), marks: group.length }))
        .sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

export { startOfMonth, endOfMonth };
