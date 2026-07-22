/**
 * NATYAM ERP 2.0 — Programme service
 *
 * Performances, workshops, competitions, examinations and rehearsals. In this
 * school these are not a side feature: the Annual Day rangapravesham is the
 * event the entire year is organised around, and a student's programme history
 * is what a certificate is issued against.
 *
 * "Events" and "programmes" are the same thing here and are modelled once.
 * Splitting them into two entities — as the original brief's separate
 * EventService and ProgramService would imply — would mean two participant
 * lists, two calendars and two places for a date to be wrong, to distinguish
 * things the school itself does not distinguish. What actually differs between
 * a workshop and a competition is a `type` field and which fields matter.
 */

import { bus, EVENTS } from '../core/bus.js';
import { session } from '../core/session.js';
import { localDate, daysBetween, formatDate, monthKey } from '../utils/date.js';
import { PROGRAM_TYPES, LEVELS, levelLabel } from '../config/app.config.js';
import { programs$, students$, staff$, branches$, certificates$ } from '../data/repositories.js';
import { notify } from './notifications.service.js';
import { postEntry } from './finance.service.js';

export const PROGRAM_STATUS = Object.freeze({
    SCHEDULED: 'scheduled',
    RUNNING:   'running',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled'
});

/* ==========================================================================
   LIFECYCLE
   ========================================================================== */

export async function schedule(data) {
    session.require('program.edit', 'schedule a programme');

    const record = normalise(data);
    assertShape(record);

    const program = await programs$.create({ ...record, status: PROGRAM_STATUS.SCHEDULED });

    if (daysBetween(localDate(), program.date) <= 60) {
        await notify({
            kind: 'program',
            key: `derived:program:${program.id}`,
            title: `${program.name} scheduled`,
            body: [formatDate(program.date), program.venue].filter(Boolean).join(' · '),
            link: `#/programs/${program.id}`
        });
    }

    bus.emit(EVENTS.PROGRAM_SCHEDULED, { program });
    return program;
}

export async function updateProgram(id, changes) {
    session.require('program.edit', 'edit a programme');

    const existing = await programs$.findOrFail(id);
    if (existing.status === PROGRAM_STATUS.COMPLETED && changes.date && changes.date !== existing.date) {
        throw new Error('This programme has already taken place. Its date cannot be changed.');
    }

    const record = normalise({ ...existing, ...changes, id });
    assertShape(record);

    const program = await programs$.update(id, record);
    bus.emit(EVENTS.PROGRAM_UPDATED, { program, before: existing });
    return program;
}

/**
 * Closes a programme out. Attendance, receipts and expenditure are all
 * recorded at this point rather than trickling in afterwards, because a
 * programme nobody closed is a programme whose costs never reach the ledger —
 * which is precisely how a school convinces itself its Annual Day broke even.
 */
export async function complete(id, { attendees = null, income = 0, expenditure = 0, notes = null } = {}) {
    session.require('program.edit', 'close a programme');

    const program = await programs$.findOrFail(id);
    if (program.status === PROGRAM_STATUS.COMPLETED) throw new Error('This programme is already closed.');
    if (program.status === PROGRAM_STATUS.CANCELLED) throw new Error('This programme was cancelled.');
    if (program.date > localDate()) throw new Error(`${program.name} has not happened yet — it is scheduled for ${formatDate(program.date)}.`);

    const earned = Math.round(Number(income) || 0);
    const spent = Math.round(Number(expenditure) || 0);

    const completed = await programs$.update(id, {
        status: PROGRAM_STATUS.COMPLETED,
        completedOn: localDate(),
        attendees: attendees !== null ? Number(attendees) : (program.participants?.length || null),
        income: earned,
        expenditure: spent,
        notes: notes?.trim() || null
    });

    /* Money flows to the ledger, not into the programme record alone. */
    if (earned > 0 && session.can('finance.edit')) {
        await postEntry({
            date: program.date,
            account: program.type === 'workshop' ? 'Workshop fees' : 'Programme tickets',
            type: 'income',
            amount: earned,
            narration: `${program.name} — receipts`,
            branchId: program.branchId,
            sourceType: 'program',
            sourceId: program.id
        });
    }
    if (spent > 0 && session.can('finance.edit')) {
        await postEntry({
            date: program.date,
            account: 'Venue hire',
            type: 'expense',
            amount: spent,
            narration: `${program.name} — costs`,
            branchId: program.branchId,
            sourceType: 'program',
            sourceId: program.id
        });
    }

    bus.emit(EVENTS.PROGRAM_COMPLETED, { program: completed });
    return completed;
}

export async function cancel(id, { reason }) {
    session.require('program.edit', 'cancel a programme');

    if (!reason?.trim()) throw new Error('Record why the programme was cancelled — families will ask.');
    const program = await programs$.findOrFail(id);
    if (program.status === PROGRAM_STATUS.COMPLETED) throw new Error('A completed programme cannot be cancelled.');

    const cancelled = await programs$.update(id, {
        status: PROGRAM_STATUS.CANCELLED,
        cancelledOn: localDate(),
        cancelReason: reason.trim()
    });

    await notify({
        kind: 'program',
        key: `program:cancelled:${id}`,
        title: `${program.name} cancelled`,
        body: reason.trim(),
        link: `#/programs/${id}`
    });

    bus.emit(EVENTS.PROGRAM_UPDATED, { program: cancelled });
    return cancelled;
}

/* ==========================================================================
   PARTICIPANTS
   ========================================================================== */

/**
 * Sets the participant list.
 *
 * Replaces rather than appends, and validates the whole list first: a
 * performance cast is edited as a set ("these fourteen girls"), not one name
 * at a time, and half-applying an edit is worse than rejecting it.
 */
export async function setParticipants(id, studentIds) {
    session.require('program.edit', 'change the participant list');

    const program = await programs$.findOrFail(id);
    if (program.status === PROGRAM_STATUS.CANCELLED) throw new Error('This programme was cancelled.');

    const ids = [...new Set(studentIds)];
    const students = await Promise.all(ids.map((sid) => students$.find(sid)));

    const missing = ids.filter((_, i) => !students[i]);
    if (missing.length) throw new Error(`${missing.length} of the selected students no longer exist. Refresh and try again.`);

    const inactive = students.filter((s) => s.status === 'inactive');
    if (inactive.length) {
        throw new Error(`${inactive.map((s) => s.name).join(', ')} ${inactive.length === 1 ? 'is' : 'are'} no longer active.`);
    }

    const updated = await programs$.update(id, {
        participants: ids,
        participantCount: ids.length
    });

    bus.emit(EVENTS.PROGRAM_UPDATED, { program: updated, before: program });
    return updated;
}

export async function addParticipants(id, studentIds) {
    const program = await programs$.findOrFail(id);
    return setParticipants(id, [...(program.participants || []), ...studentIds]);
}

export async function removeParticipant(id, studentId) {
    const program = await programs$.findOrFail(id);
    return setParticipants(id, (program.participants || []).filter((s) => s !== studentId));
}

/**
 * Students eligible for a programme, annotated with why.
 *
 * An examination is level-gated; a performance is not. Encoding that here
 * rather than in the picker means the rule is the same whether a cast is set
 * from the programme page, from a bulk action, or from a report.
 */
/**
 * Students who can take part in a programme.
 *
 * Programmes are open to the whole school. An earlier rule gated examinations
 * to a single level, which meant most of the roll arrived flagged ineligible
 * and could not be cast at all. Level is still reported so the picker can show
 * it, but it never excludes anyone.
 */
export async function eligibleStudents(programOrId) {
    const program = typeof programOrId === 'string' ? await programs$.findOrFail(programOrId) : programOrId;
    const roster = await students$.active(program.branchId);
    const chosen = new Set(program.participants || []);

    return roster
        .map((student) => ({
            ...student,
            selected: chosen.has(student.id),
            eligible: true,
            reason: null
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'en-IN'));
}

/* ==========================================================================
   VIEWS
   ========================================================================== */

/** The programme list, enriched for display. */
export async function listPrograms(branchId = null, { from = null, to = null, type = null, status = null } = {}) {
    let rows = (await programs$.all()).filter((p) => !branchId || p.branchId === branchId);

    if (from) rows = rows.filter((p) => p.date >= from);
    if (to) rows = rows.filter((p) => p.date <= to);
    if (type) rows = rows.filter((p) => p.type === type);
    if (status) rows = rows.filter((p) => p.status === status);

    const [allBranches, allStaff] = await Promise.all([branches$.all(), staff$.all()]);
    const branchName = new Map(allBranches.map((b) => [b.id, b.name]));
    const staffName = new Map(allStaff.map((s) => [s.id, s.name]));

    return rows
        .map((program) => ({
            ...program,
            typeLabel: PROGRAM_TYPES.find((t) => t.value === program.type)?.label || program.type,
            branchName: branchName.get(program.branchId) || '—',
            leadName: staffName.get(program.leadStaffId) || null,
            participantCount: program.participants?.length ?? program.participantCount ?? 0,
            daysAway: program.date >= localDate() ? daysBetween(localDate(), program.date) : null,
            isPast: program.date < localDate()
        }))
        .sort((a, b) => b.date.localeCompare(a.date));
}

/** Everything the programme detail view needs. */
export async function programDetail(id) {
    const program = await programs$.findOrFail(id);
    const [participants, branch, lead, certs] = await Promise.all([
        Promise.all((program.participants || []).map((sid) => students$.find(sid))),
        program.branchId ? branches$.find(program.branchId) : null,
        program.leadStaffId ? staff$.find(program.leadStaffId) : null,
        certificates$.all()
    ]);

    const cast = participants.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'en-IN'));

    return {
        program: {
            ...program,
            typeLabel: PROGRAM_TYPES.find((t) => t.value === program.type)?.label || program.type,
            daysAway: program.date >= localDate() ? daysBetween(localDate(), program.date) : null
        },
        branch,
        lead,
        participants: cast,
        byLevel: LEVELS
            .map((l) => ({ level: l.value, label: l.label, count: cast.filter((s) => s.level === l.value).length }))
            .filter((row) => row.count > 0),
        certificatesIssued: certs.filter((c) => c.programId === id).length,
        canIssueCertificates: program.status === PROGRAM_STATUS.COMPLETED && cast.length > 0,
        net: (program.income || 0) - (program.expenditure || 0)
    };
}

/** Calendar payload: programmes grouped by month, for the calendar widget. */
export async function calendar({ months = 3, branchId = null } = {}) {
    const rows = await listPrograms(branchId);
    const from = monthKey();
    const grouped = new Map();

    for (const program of rows) {
        const key = program.date.slice(0, 7);
        if (key < from) continue;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(program);
    }

    return [...grouped.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(0, months)
        .map(([period, items]) => ({ period, items: items.sort((a, b) => a.date.localeCompare(b.date)) }));
}

/** Headline programme figures. */
export async function programSummary(branchId = null) {
    const rows = await listPrograms(branchId);
    const year = localDate().slice(0, 4);
    const thisYear = rows.filter((p) => p.date.startsWith(year));

    return {
        upcoming: rows.filter((p) => !p.isPast && p.status === PROGRAM_STATUS.SCHEDULED).length,
        thisYear: thisYear.length,
        completed: thisYear.filter((p) => p.status === PROGRAM_STATUS.COMPLETED).length,
        cancelled: thisYear.filter((p) => p.status === PROGRAM_STATUS.CANCELLED).length,
        participantsEngaged: new Set(thisYear.flatMap((p) => p.participants || [])).size,
        byType: PROGRAM_TYPES
            .map((t) => ({ type: t.value, label: t.label, count: thisYear.filter((p) => p.type === t.value).length }))
            .filter((row) => row.count > 0),
        nextUp: rows.filter((p) => !p.isPast).sort((a, b) => a.date.localeCompare(b.date))[0] || null
    };
}

/* ------------------------------------------------------------------ HELPERS */

function normalise(data) {
    return {
        ...data,
        name: String(data.name || '').trim(),
        venue: data.venue?.trim() || null,
        description: data.description?.trim() || null,
        participants: Array.isArray(data.participants) ? [...new Set(data.participants)] : [],
        income: Math.round(Number(data.income) || 0),
        expenditure: Math.round(Number(data.expenditure) || 0)
    };
}

function assertShape(program) {
    if (!program.name) throw new Error('A programme needs a name.');
    if (!program.date) throw new Error('A programme needs a date.');
    if (!program.type) throw new Error('Choose a programme type.');
    if (!PROGRAM_TYPES.some((t) => t.value === program.type)) throw new Error(`"${program.type}" is not a recognised programme type.`);
    if (!program.branchId) throw new Error('Choose which branch is running this.');
    if (program.type === 'examination' && !program.level) throw new Error('An examination is held for a specific level.');
    if (program.income < 0 || program.expenditure < 0) throw new Error('Amounts cannot be negative.');
}

