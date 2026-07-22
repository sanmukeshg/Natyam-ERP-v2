/**
 * NATYAM ERP 2.0 — Batch service
 *
 * A batch is where a level, a teacher, a room and a timetable meet, and almost
 * every conflict the school actually experiences is a collision between two of
 * those. This module enforces the ones that matter: a teacher cannot be in two
 * halls at once, a hall cannot hold two batches at once, and a batch cannot be
 * closed while students are still sitting in it.
 *
 * 1.0 had none of these checks. It was possible — and did happen — to schedule
 * two batches into Hall A on Saturday morning, which nobody discovered until
 * both sets of parents arrived.
 */

import { bus, EVENTS } from '../core/bus.js';
import { session } from '../core/session.js';
import { localDate, dayName, addDays } from '../utils/date.js';
import { LEVELS, levelLabel } from '../config/app.config.js';
import { batches$, students$, staff$, attendance$, AttendanceMath } from '../data/repositories.js';

const DAY_CODES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEK = Object.freeze(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);

/* ==========================================================================
   SCHEDULING RULES
   ========================================================================== */

/** Do two time ranges on the same day overlap? Touching ends do not count. */
function overlaps(a, b) {
    return a.startTime < b.endTime && b.startTime < a.endTime;
}

function sharesDay(a, b) {
    return (a.days || []).some((d) => (b.days || []).includes(d));
}

/**
 * Finds every scheduling conflict a proposed batch would create.
 *
 * Returns a list rather than throwing on the first, because a badly-timed new
 * batch typically clashes with the teacher *and* the room, and being told
 * about them one at a time is three round trips of frustration.
 */
export async function findConflicts(candidate) {
    const others = (await batches$.active()).filter((b) => b.id !== candidate.id && b.status === 'active');
    const conflicts = [];

    for (const other of others) {
        if (!sharesDay(candidate, other) || !overlaps(candidate, other)) continue;

        const days = (candidate.days || []).filter((d) => (other.days || []).includes(d));
        const when = `${days.join(', ')} ${other.startTime}–${other.endTime}`;

        if (candidate.teacherId && candidate.teacherId === other.teacherId) {
            conflicts.push({ type: 'teacher', batch: other, message: `The same teacher already takes ${other.name} on ${when}.` });
        }
        if (candidate.room && candidate.branchId === other.branchId && candidate.room === other.room) {
            conflicts.push({ type: 'room', batch: other, message: `${candidate.room} is occupied by ${other.name} on ${when}.` });
        }
    }

    return conflicts;
}

/* ==========================================================================
   LIFECYCLE
   ========================================================================== */

export async function createBatch(data, { allowConflicts = false } = {}) {
    session.require('student.edit', 'create a batch');

    const candidate = normalise(data);
    assertShape(candidate);

    const conflicts = await findConflicts(candidate);
    if (conflicts.length && !allowConflicts) {
        const err = new Error(`This clashes with an existing batch. ${conflicts[0].message}`);
        err.conflicts = conflicts;
        throw err;
    }

    const batch = await batches$.create(candidate);
    bus.emit(EVENTS.BATCH_CREATED, { batch });
    return { batch, conflicts };
}

export async function updateBatch(id, changes, { allowConflicts = false } = {}) {
    session.require('student.edit', 'edit a batch');

    const existing = await batches$.findOrFail(id);
    const candidate = normalise({ ...existing, ...changes, id });
    assertShape(candidate);

    /* Changing the level of a batch that has students in it would silently
       leave them at the wrong level for promotion and certification. */
    if (candidate.level !== existing.level) {
        const roster = await students$.byBatch(id);
        if (roster.length) {
            throw new Error(
                `${roster.length} student${roster.length === 1 ? ' is' : 's are'} enrolled at ${levelLabel(existing.level)} in this batch. ` +
                'Move them out before changing the level.'
            );
        }
    }

    const conflicts = await findConflicts(candidate);
    if (conflicts.length && !allowConflicts) {
        const err = new Error(`This clashes with an existing batch. ${conflicts[0].message}`);
        err.conflicts = conflicts;
        throw err;
    }

    const batch = await batches$.update(id, candidate);
    bus.emit(EVENTS.BATCH_UPDATED, { batch, before: existing });
    return { batch, conflicts };
}

/**
 * Closes a batch. Refuses while students remain, and offers the caller the
 * roster so the UI can propose moving them somewhere rather than just saying
 * no. A closed batch keeps its attendance history for reporting.
 */
export async function closeBatch(id, { reason = null, moveTo = null } = {}) {
    session.require('student.edit', 'close a batch');

    const batch = await batches$.findOrFail(id);
    const roster = await students$.byBatch(id);

    if (roster.length && !moveTo) {
        const err = new Error(`${batch.name} still has ${roster.length} student${roster.length === 1 ? '' : 's'}. Choose where they should go.`);
        err.roster = roster;
        throw err;
    }

    if (roster.length && moveTo) {
        const target = await batches$.findOrFail(moveTo);
        if (target.status !== 'active') throw new Error(`${target.name} is not active.`);
        if (target.level !== batch.level) throw new Error(`${target.name} teaches ${levelLabel(target.level)}, not ${levelLabel(batch.level)}.`);

        const existing = await students$.byBatch(moveTo);
        if (target.capacity && existing.length + roster.length > target.capacity) {
            throw new Error(`${target.name} seats ${target.capacity} and already has ${existing.length}. It cannot take ${roster.length} more.`);
        }
        for (const student of roster) {
            await students$.update(student.id, { batchId: moveTo, branchId: target.branchId });
        }
    }

    const closed = await batches$.update(id, {
        status: 'closed',
        closedOn: localDate(),
        closeReason: reason?.trim() || null
    });

    bus.emit(EVENTS.BATCH_CLOSED, { batch: closed, moved: roster.length });
    return { batch: closed, moved: roster.length };
}

export async function reopenBatch(id) {
    session.require('student.edit', 'reopen a batch');
    const batch = await batches$.update(id, { status: 'active', closedOn: null, closeReason: null });
    bus.emit(EVENTS.BATCH_UPDATED, { batch });
    return batch;
}

/* ==========================================================================
   VIEWS
   ========================================================================== */

/** The batch list, with occupancy, teacher name and recent attendance rate. */
export async function listBatches(branchId = null, { includeClosed = false } = {}) {
    const [withOccupancy, teachers, recent] = await Promise.all([
        batches$.withOccupancy(branchId),
        staff$.teachers(),
        attendance$.between(addDays(localDate(), -30), localDate(), branchId)
    ]);

    const teacherName = new Map(teachers.map((t) => [t.id, t.name]));
    const byBatch = new Map();
    for (const row of recent) {
        if (!byBatch.has(row.batchId)) byBatch.set(row.batchId, []);
        byBatch.get(row.batchId).push(row);
    }

    let rows = withOccupancy;
    if (includeClosed) {
        const all = (await batches$.all()).filter((b) => !branchId || b.branchId === branchId);
        const seen = new Set(rows.map((r) => r.id));
        rows = rows.concat(all.filter((b) => !seen.has(b.id)).map((b) => ({ ...b, enrolled: 0, seatsLeft: 0, occupancy: 0 })));
    }

    return rows
        .map((batch) => ({
            ...batch,
            teacherName: teacherName.get(batch.teacherId) || 'Unassigned',
            levelLabel: levelLabel(batch.level),
            schedule: describeSchedule(batch),
            attendanceRate: AttendanceMath.rateOf(byBatch.get(batch.id) || [])
        }))
        .sort((a, b) => a.levelOrder - b.levelOrder || a.name.localeCompare(b.name));
}

/** Everything the batch detail view shows. */
export async function batchDetail(id) {
    const batch = await batches$.findOrFail(id);
    const [roster, teacher, recent, conflicts] = await Promise.all([
        students$.byBatch(id),
        batch.teacherId ? staff$.find(batch.teacherId) : null,
        attendance$.between(addDays(localDate(), -60), localDate()),
        findConflicts(batch)
    ]);

    const mine = recent.filter((r) => r.batchId === id);
    const perStudent = new Map();
    for (const row of mine) {
        if (!perStudent.has(row.studentId)) perStudent.set(row.studentId, []);
        perStudent.get(row.studentId).push(row);
    }

    return {
        batch: {
            ...batch,
            levelLabel: levelLabel(batch.level),
            schedule: describeSchedule(batch),
            enrolled: roster.length,
            seatsLeft: batch.capacity ? Math.max(0, batch.capacity - roster.length) : null,
            occupancy: batch.capacity ? Math.round((roster.length / batch.capacity) * 100) : null
        },
        teacher,
        conflicts,
        attendanceRate: AttendanceMath.rateOf(mine),
        roster: roster.map((student) => ({
            ...student,
            attendanceRate: AttendanceMath.rateOf(perStudent.get(student.id) || [])
        })).sort((a, b) => (a.attendanceRate ?? 101) - (b.attendanceRate ?? 101))
    };
}

/**
 * The week's timetable, grouped by day and sorted by start time. This is the
 * view that makes a double-booking obvious at a glance, which is why it exists
 * as well as the conflict check.
 */
export async function timetable(branchId = null) {
    const [batches, teachers] = await Promise.all([batches$.active(branchId), staff$.teachers()]);
    const teacherName = new Map(teachers.map((t) => [t.id, t.name]));

    return WEEK.map((day) => ({
        day,
        label: dayName(nextDateFor(day)),
        sessions: batches
            .filter((b) => (b.days || []).includes(day))
            .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
            .map((b) => ({
                ...b,
                teacherName: teacherName.get(b.teacherId) || 'Unassigned',
                levelLabel: levelLabel(b.level)
            }))
    }));
}

/** A teacher's own week — the teacher dashboard's schedule panel. */
export async function teacherSchedule(teacherId) {
    const batches = await batches$.byTeacher(teacherId);
    const rosters = await Promise.all(batches.map((b) => students$.byBatch(b.id)));

    return WEEK.map((day) => ({
        day,
        sessions: batches
            .map((b, i) => ({ ...b, enrolled: rosters[i].length, levelLabel: levelLabel(b.level) }))
            .filter((b) => (b.days || []).includes(day))
            .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
    })).filter((d) => d.sessions.length);
}

/* ------------------------------------------------------------------ HELPERS */

function normalise(data) {
    const level = LEVELS.find((l) => l.value === data.level);
    return {
        ...data,
        name: String(data.name || '').trim(),
        code: String(data.code || '').trim().toUpperCase(),
        room: data.room?.trim() || null,
        days: Array.isArray(data.days) ? WEEK.filter((d) => data.days.includes(d)) : [],
        capacity: Number(data.capacity) || 0,
        levelOrder: level?.order || 99,
        status: data.status || 'active'
    };
}

function assertShape(batch) {
    if (!batch.name) throw new Error('A batch needs a name.');
    if (!batch.code) throw new Error('A batch needs a short code, e.g. HYD-PRA-A.');
    if (!batch.branchId) throw new Error('Choose which branch this batch runs at.');
    if (!batch.level) throw new Error('Choose the level this batch teaches.');
    if (!batch.days.length) throw new Error('Choose at least one day the batch meets.');
    if (!batch.startTime || !batch.endTime) throw new Error('Give the start and end time.');
    if (batch.endTime <= batch.startTime) throw new Error('The batch cannot end before it starts.');
    if (batch.capacity < 0) throw new Error('Capacity cannot be negative.');
}

function describeSchedule(batch) {
    if (!batch.days?.length) return 'Not scheduled';
    const days = WEEK.filter((d) => batch.days.includes(d)).join(', ');
    return `${days} · ${batch.startTime}–${batch.endTime}`;
}



/** The next calendar date falling on a given day code, for label formatting. */
function nextDateFor(dayCode) {
    const target = DAY_CODES.indexOf(dayCode);
    const d = new Date();
    while (d.getDay() !== target) d.setDate(d.getDate() + 1);
    return localDate(d);
}
