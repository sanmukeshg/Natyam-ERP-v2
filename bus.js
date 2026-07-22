/**
 * NATYAM ERP 2.0 — Staff service
 *
 * Staff, teachers and the teacher dashboard. A dance school's staff record is
 * small but load-bearing: it decides who can be assigned to a batch, what the
 * salary run pays out, and whose name appears on a certificate.
 *
 * The rule worth stating: a teacher who leaves must not silently disappear
 * from the batches they were running. Deactivating a teacher reports the
 * batches left without one rather than orphaning them — which is what 1.0 did,
 * producing batches whose teacher field pointed at a record that no longer
 * resolved and a timetable column reading "undefined".
 */

import { bus, EVENTS } from '../core/bus.js';
import { session } from '../core/session.js';
import { localDate, monthKey, daysBetween, lastMonths, addDays } from '../utils/date.js';
import { staff$, batches$, students$, salaries$, attendance$, programs$, AttendanceMath } from '../data/repositories.js';
import { teacherSchedule } from './batches.service.js';

export const STAFF_ROLES = Object.freeze([
    { value: 'teacher',  label: 'Teacher',      teaches: true },
    { value: 'musician', label: 'Musician',     teaches: false },
    { value: 'admin',    label: 'Administration', teaches: false },
    { value: 'support',  label: 'Support',      teaches: false }
]);

/* ==========================================================================
   LIFECYCLE
   ========================================================================== */

export async function hire(data) {
    session.require('staff.edit', 'add a staff member');

    const record = normalise(data);
    assertShape(record);

    if (record.employeeNo) {
        const clash = (await staff$.all()).find((s) => s.employeeNo === record.employeeNo);
        if (clash) throw new Error(`Employee number ${record.employeeNo} already belongs to ${clash.name}.`);
    } else {
        record.employeeNo = await nextEmployeeNumber();
    }

    const member = await staff$.create(record);
    bus.emit(EVENTS.STAFF_CREATED, { staff: member });
    return member;
}

export async function updateStaff(id, changes) {
    session.require('staff.edit', 'edit a staff member');

    const existing = await staff$.findOrFail(id);
    const record = normalise({ ...existing, ...changes, id });
    assertShape(record);

    // Demoting a teacher out of a teaching role while they still run batches
    // would leave those batches unassignable through the normal UI.
    if (existing.role === 'teacher' && record.role !== 'teacher') {
        const owned = await batches$.byTeacher(id);
        if (owned.length) {
            throw new Error(`${existing.name} still teaches ${owned.length} batch${owned.length === 1 ? '' : 'es'}. Reassign them first.`);
        }
    }

    const member = await staff$.update(id, record);
    bus.emit(EVENTS.STAFF_UPDATED, { staff: member, before: existing });
    return member;
}

/**
 * Ends someone's employment. Batches they ran are reported back, optionally
 * reassigned in the same call, and never left pointing at an inactive person.
 */
export async function deactivate(id, { reason, lastDay = null, reassignTo = null } = {}) {
    session.require('staff.edit', 'deactivate a staff member');

    const member = await staff$.findOrFail(id);
    if (!reason?.trim()) throw new Error('Record why this staff member is leaving.');

    const owned = await batches$.byTeacher(id);
    if (owned.length && !reassignTo) {
        const err = new Error(`${member.name} teaches ${owned.length} batch${owned.length === 1 ? '' : 'es'}. Choose who takes them over.`);
        err.batches = owned;
        throw err;
    }

    if (owned.length && reassignTo) {
        const replacement = await staff$.findOrFail(reassignTo);
        if (replacement.role !== 'teacher' || replacement.status !== 'active') {
            throw new Error(`${replacement.name} is not an active teacher.`);
        }
        for (const batch of owned) {
            await batches$.update(batch.id, { teacherId: reassignTo });
        }
    }

    const updated = await staff$.update(id, {
        status: 'inactive',
        leftOn: lastDay || localDate(),
        leaveReason: reason.trim()
    });

    bus.emit(EVENTS.STAFF_UPDATED, { staff: updated, before: member });
    return { staff: updated, reassigned: owned.length };
}

export async function reactivate(id) {
    session.require('staff.edit', 'reactivate a staff member');
    const member = await staff$.update(id, { status: 'active', leftOn: null, leaveReason: null });
    bus.emit(EVENTS.STAFF_UPDATED, { staff: member });
    return member;
}

/* ==========================================================================
   VIEWS
   ========================================================================== */

/** The staff list with teaching load attached. */
export async function listStaff(branchId = null, { includeInactive = false } = {}) {
    const rows = includeInactive
        ? (await staff$.all()).filter((s) => !branchId || s.branchId === branchId)
        : await staff$.activeStaff(branchId);

    const [batches, students] = await Promise.all([batches$.active(), students$.active()]);
    const rosterCount = new Map();
    for (const student of students) {
        if (student.batchId) rosterCount.set(student.batchId, (rosterCount.get(student.batchId) || 0) + 1);
    }

    return rows
        .map((member) => {
            const own = batches.filter((b) => b.teacherId === member.id);
            return {
                ...member,
                roleLabel: STAFF_ROLES.find((r) => r.value === member.role)?.label || member.role,
                batchCount: own.length,
                studentCount: own.reduce((sum, b) => sum + (rosterCount.get(b.id) || 0), 0),
                weeklySessions: own.reduce((sum, b) => sum + (b.days?.length || 0), 0),
                tenureDays: member.joinedOn ? daysBetween(member.joinedOn, localDate()) : 0
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'en-IN'));
}

/**
 * The teacher dashboard: their week, their students, how reliably they mark
 * registers, and how their classes are attending.
 */
export async function teacherDashboard(staffId) {
    const member = await staff$.findOrFail(staffId);

    const [schedule, batches, salaryHistory, allPrograms] = await Promise.all([
        teacherSchedule(staffId),
        batches$.byTeacher(staffId),
        salaries$.forStaff(staffId),
        programs$.all()
    ]);

    const from = addDays(localDate(), -60);
    const marks = await attendance$.between(from, localDate());
    const mine = marks.filter((r) => batches.some((b) => b.id === r.batchId));

    const rosters = await Promise.all(batches.map((b) => students$.byBatch(b.id)));
    const students = rosters.flat();

    const perBatch = batches.map((batch, index) => {
        const rows = mine.filter((r) => r.batchId === batch.id);
        return {
            batch,
            enrolled: rosters[index].length,
            attendanceRate: AttendanceMath.rateOf(rows),
            sessionsMarked: new Set(rows.map((r) => r.date)).size
        };
    });

    return {
        staff: member,
        schedule,
        batches: perBatch,
        studentCount: students.length,
        attendanceRate: AttendanceMath.rateOf(mine),
        salaries: salaryHistory.slice(0, 12),
        lastPaid: salaryHistory.find((s) => s.status === 'paid') || null,
        programs: allPrograms
            .filter((p) => p.leadStaffId === staffId || (p.staffIds || []).includes(staffId))
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 8),
        atRisk: perBatch.filter((b) => b.attendanceRate !== null && b.attendanceRate < 75)
    };
}

/**
 * Teachers who can take a batch at a given level and time — the picker on the
 * batch form. Availability is computed rather than assumed, so a fully-booked
 * teacher is shown as such instead of being silently offered.
 */
export async function availableTeachers({ branchId = null, days = [], startTime = null, endTime = null, excludeBatchId = null } = {}) {
    const [teachers, batches] = await Promise.all([staff$.teachers(branchId), batches$.active()]);

    return teachers.map((teacher) => {
        const own = batches.filter((b) => b.teacherId === teacher.id && b.id !== excludeBatchId);
        const clash = (days.length && startTime && endTime)
            ? own.find((b) =>
                (b.days || []).some((d) => days.includes(d)) &&
                startTime < b.endTime && b.startTime < endTime)
            : null;

        return {
            ...teacher,
            load: own.length,
            weeklySessions: own.reduce((sum, b) => sum + (b.days?.length || 0), 0),
            available: !clash,
            clashWith: clash ? clash.name : null
        };
    }).sort((a, b) => Number(b.available) - Number(a.available) || a.load - b.load);
}

/** Payroll cost by month — used by finance and the staff page header. */
export async function payrollTrend(months = 6) {
    const keys = lastMonths(months);
    const rows = await Promise.all(keys.map((key) => salaries$.forPeriod(key)));

    return keys.map((period, index) => ({
        period,
        gross: rows[index].reduce((s, r) => s + (r.gross || 0), 0),
        net: rows[index].reduce((s, r) => s + (r.net || 0), 0),
        paid: rows[index].filter((r) => r.status === 'paid').length,
        pending: rows[index].filter((r) => r.status !== 'paid').length
    }));
}

/** Headline staff figures. */
export async function staffSummary(branchId = null) {
    const active = await staff$.activeStaff(branchId);
    const teachers = active.filter((s) => s.role === 'teacher');
    const period = monthKey();
    const salaries = await salaries$.forPeriod(period);

    return {
        total: active.length,
        teachers: teachers.length,
        others: active.length - teachers.length,
        monthlyWageBill: active.reduce((sum, s) => sum + (s.monthlySalary || 0), 0),
        payrollRun: salaries.length > 0,
        payrollPaid: salaries.filter((s) => s.status === 'paid').length,
        payrollPending: salaries.filter((s) => s.status !== 'paid').length
    };
}

/* ------------------------------------------------------------------ HELPERS */

function normalise(data) {
    return {
        ...data,
        name: String(data.name || '').trim().replace(/\s+/g, ' '),
        email: data.email?.trim().toLowerCase() || null,
        specialisation: data.specialisation?.trim() || null,
        monthlySalary: Math.round(Number(data.monthlySalary) || 0),
        status: data.status || 'active'
    };
}

function assertShape(member) {
    if (!member.name) throw new Error('A staff member needs a name.');
    if (!member.role) throw new Error('Choose a role.');
    if (!STAFF_ROLES.some((r) => r.value === member.role)) throw new Error(`"${member.role}" is not a recognised staff role.`);
    if (!member.branchId) throw new Error('Choose which branch they are based at.');
    if (!member.phone) throw new Error('A contact number is required.');
    if (member.monthlySalary < 0) throw new Error('Salary cannot be negative.');
    if (member.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(member.email)) throw new Error('That email address does not look right.');
    if (member.joinedOn && member.joinedOn > localDate()) throw new Error('The joining date cannot be in the future.');
}

async function nextEmployeeNumber() {
    const rows = await staff$.all({ includeDeleted: true });
    const highest = rows.reduce((max, s) => {
        const n = Number(String(s.employeeNo || '').split('/').pop());
        return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    return `NAT/EMP/${String(highest + 1).padStart(3, '0')}`;
}

