/**
 * NATYAM ERP 2.0 — Dashboard service
 *
 * The executive view. Every figure on the dashboard is computed here, and
 * nothing on the dashboard page computes anything for itself.
 *
 * That rule is doing real work. In 1.0 the dashboard counted pending
 * admissions with `status === 'Pending Approval'` while the admissions module
 * wrote `'Pending approval'`. The dashboard read zero, forever, and nobody
 * noticed for months because a zero looks like an answer. Numbers must come
 * from one place, and this is that place.
 *
 * The panels are also assembled around what a school principal actually opens
 * this screen to find out — is anything on fire today, is money coming in, is
 * anyone slipping away — rather than around what happens to be easy to count.
 */

import { localDate, addDays, monthKey, startOfMonth, lastMonths, formatMonth, daysBetween } from '../utils/date.js';
import { STUDENT_STATUS } from '../config/app.config.js';
import {
    students$, batches$, admissions$, invoices$, payments$, programs$,
    attendance$, staff$, branches$, AttendanceMath, PaymentMath, InvoiceMath
} from '../data/repositories.js';
import { dayBoard, trend as attendanceTrend, missingRegisters } from './attendance.service.js';
import { collectionSummary } from './fees.service.js';
import { currentMonthPosition, monthlySeries } from './finance.service.js';
import { pipeline } from './admissions.service.js';
import { recentActivity } from './audit.service.js';

/* ==========================================================================
   THE WHOLE DASHBOARD
   ========================================================================== */

/**
 * Everything the dashboard shows, in one call.
 *
 * Panels are resolved in parallel and each is failure-isolated: a single
 * malformed programme date should degrade one card, not blank the entire
 * screen. A panel that fails returns `{ error }` and the page renders an
 * inline retry in its place.
 */
export async function overview({ branchId = null } = {}) {
    const panels = {
        headline: headline(branchId),
        today: today(branchId),
        money: money(branchId),
        admissions: admissionsPanel(branchId),
        attendance: attendancePanel(branchId),
        roll: rollPanel(branchId),
        programs: programsPanel(branchId),
        attention: needsAttention(branchId),
        activity: activityPanel(),
        branches: branchId ? Promise.resolve(null) : branchPanel()
    };

    const entries = await Promise.all(
        Object.entries(panels).map(async ([key, promise]) => {
            try {
                return [key, await promise];
            } catch (err) {
                console.error(`Dashboard panel "${key}" failed`, err);
                return [key, { error: err.message }];
            }
        })
    );

    return {
        generatedAt: new Date().toISOString(),
        branchId,
        ...Object.fromEntries(entries)
    };
}

/* ==========================================================================
   PANELS
   ========================================================================== */

/**
 * The four KPI cards. Each carries its own comparison, because a number
 * without a direction is decoration — "₹1.4L collected" means nothing until
 * you know last month was ₹1.9L.
 */
export async function headline(branchId = null) {
    const thisMonth = monthKey();
    const previous = lastMonths(2)[0];
    const monthStart = `${thisMonth}-01`;

    const [roll, collections, priorCollections, attendance, priorAttendance, applications] = await Promise.all([
        students$.active(branchId),
        collectionSummary({ from: monthStart, to: localDate(), branchId }),
        collectionSummary({ from: `${previous}-01`, to: `${previous}-31`, branchId }),
        attendance$.between(addDays(localDate(), -30), localDate(), branchId),
        attendance$.between(addDays(localDate(), -60), addDays(localDate(), -31), branchId),
        admissions$.pending()
    ]);

    const joinedThisMonth = roll.filter((s) => (s.joinedOn || '') >= monthStart).length;
    const rate = AttendanceMath.rateOf(attendance);
    const priorRate = AttendanceMath.rateOf(priorAttendance);

    return [
        {
            key: 'students',
            label: 'Active students',
            value: roll.length,
            unit: null,
            delta: joinedThisMonth ? { value: `+${joinedThisMonth}`, tone: 'positive', note: 'joined this month' } : null,
            tone: 'neutral',
            link: '#/students'
        },
        {
            key: 'collections',
            label: 'Collected this month',
            value: collections.collected,
            money: true,
            delta: deltaOf(collections.collected, priorCollections.collected, 'vs last month'),
            tone: collections.collected >= priorCollections.collected ? 'positive' : 'caution',
            link: '#/fees'
        },
        {
            key: 'outstanding',
            label: 'Outstanding',
            value: collections.outstanding,
            money: true,
            delta: collections.overdueCount
                ? { value: `${collections.overdueCount} overdue`, tone: 'negative', note: null }
                : { value: 'nothing overdue', tone: 'positive', note: null },
            tone: collections.overdueCount ? 'negative' : 'positive',
            link: '#/fees?filter=outstanding'
        },
        {
            key: 'attendance',
            label: 'Attendance, 30 days',
            value: rate ?? '—',
            unit: rate === null ? null : '%',
            delta: deltaOf(rate, priorRate, 'vs previous 30 days', true),
            tone: rate === null ? 'neutral' : rate >= 80 ? 'positive' : rate >= 65 ? 'caution' : 'negative',
            link: '#/attendance'
        },
        {
            key: 'applications',
            label: 'Applications waiting',
            value: applications.length,
            delta: null,
            tone: applications.length > 5 ? 'caution' : 'neutral',
            link: '#/admissions'
        }
    ];
}

/**
 * Today: which classes run, which registers are done, who is teaching. The
 * panel that answers "what is happening in the building right now".
 */
export async function today(branchId = null) {
    const date = localDate();
    const board = await dayBoard(date, branchId);

    const done = board.batches.filter((b) => b.done).length;
    const nowTime = new Date().toTimeString().slice(0, 5);

    return {
        date,
        holiday: board.holiday,
        classes: board.batches.map((b) => ({
            id: b.id,
            name: b.name,
            level: b.level,
            room: b.room,
            teacher: b.teacherName,
            startTime: b.startTime,
            endTime: b.endTime,
            expected: b.expected,
            marked: b.marked,
            done: b.done,
            rate: b.rate,
            state: b.done ? 'marked' : (b.endTime < nowTime ? 'missed' : b.startTime <= nowTime ? 'running' : 'upcoming')
        })),
        total: board.batches.length,
        registersDone: done,
        registersPending: board.batches.length - done,
        studentsExpected: board.batches.reduce((sum, b) => sum + b.expected, 0)
    };
}

/** Money: collection, position, and the six-month revenue shape. */
export async function money(branchId = null) {
    const monthStart = startOfMonth();

    const [collections, position, series] = await Promise.all([
        collectionSummary({ from: monthStart, to: localDate(), branchId }),
        currentMonthPosition(branchId),
        monthlySeries(6, branchId)
    ]);

    return {
        collectedThisMonth: collections.collected,
        outstanding: collections.outstanding,
        overdue: collections.overdue,
        overdueCount: collections.overdueCount,
        byMode: collections.byMode,
        ageing: collections.ageing,
        position,
        series: series.map((row) => ({
            period: row.period,
            label: formatMonth(row.period),
            income: row.income,
            expense: row.expense,
            net: row.net
        })),
        sparkline: series.map((row) => row.income)
    };
}

/** Admissions funnel plus the applications actually waiting on someone. */
export async function admissionsPanel(branchId = null) {
    const [stats, recent] = await Promise.all([
        pipeline(branchId),
        admissions$.recent(6)
    ]);

    return {
        ...stats,
        recent: recent.map((a) => ({
            id: a.id,
            name: a.name,
            level: a.level,
            status: a.status,
            appliedOn: a.appliedOn,
            waitingDays: a.appliedOn ? daysBetween(a.appliedOn, localDate()) : null
        }))
    };
}

/** Attendance trend and the batches that are struggling. */
export async function attendancePanel(branchId = null) {
    const [trend, recent, batches] = await Promise.all([
        attendanceTrend(6, branchId),
        attendance$.between(addDays(localDate(), -30), localDate(), branchId),
        batches$.active(branchId)
    ]);

    const byBatch = new Map();
    for (const row of recent) {
        if (!byBatch.has(row.batchId)) byBatch.set(row.batchId, []);
        byBatch.get(row.batchId).push(row);
    }

    const perBatch = batches
        .map((batch) => ({
            id: batch.id,
            name: batch.name,
            level: batch.level,
            rate: AttendanceMath.rateOf(byBatch.get(batch.id) || []),
            marks: (byBatch.get(batch.id) || []).length
        }))
        .filter((b) => b.marks > 0)
        .sort((a, b) => a.rate - b.rate);

    return {
        trend: trend.map((t) => ({ ...t, label: formatMonth(t.period) })),
        overall: AttendanceMath.rateOf(recent),
        breakdown: AttendanceMath.breakdownOf(recent),
        weakest: perBatch.slice(0, 4),
        strongest: perBatch.slice(-3).reverse()
    };
}

/** Roll composition — the level pyramid and where students are missing. */
export async function rollPanel(branchId = null) {
    const [all, batches] = await Promise.all([
        students$.all(),
        batches$.withOccupancy(branchId)
    ]);

    const scoped = branchId ? all.filter((s) => s.branchId === branchId) : all;
    const active = scoped.filter((s) => s.status === STUDENT_STATUS.ACTIVE);

    return {
        total: active.length,
        unplaced: active.filter((s) => !s.batchId).length,
        onLeave: scoped.filter((s) => s.status === STUDENT_STATUS.ON_LEAVE).length,
        capacity: {
            seats: batches.reduce((sum, b) => sum + (b.capacity || 0), 0),
            filled: batches.reduce((sum, b) => sum + b.enrolled, 0),
            occupancy: batches.length
                ? Math.round((batches.reduce((s, b) => s + b.enrolled, 0) /
                    Math.max(1, batches.reduce((s, b) => s + (b.capacity || 0), 0))) * 100)
                : null
        },
        byLevel: groupCount(active, (s) => s.level),
        full: batches.filter((b) => b.capacity && b.enrolled >= b.capacity).map((b) => ({ id: b.id, name: b.name })),
        empty: batches.filter((b) => b.enrolled === 0).map((b) => ({ id: b.id, name: b.name }))
    };
}

/** What is coming up. */
export async function programsPanel(branchId = null) {
    const upcoming = await programs$.upcoming(5, branchId);

    return {
        upcoming: upcoming.map((p) => ({
            id: p.id,
            name: p.name,
            type: p.type,
            date: p.date,
            venue: p.venue,
            daysAway: daysBetween(localDate(), p.date),
            participants: p.participants?.length || 0
        })),
        next: upcoming[0] || null
    };
}

/**
 * The action list — the panel that earns the dashboard its place.
 *
 * Everything here is something a person should do today, phrased as the thing
 * to do rather than the statistic behind it, and each carries the route that
 * lets them do it in one click.
 */
export async function needsAttention(branchId = null) {
    const items = [];

    const [overdue, unplaced, pending, missing, stalledApps] = await Promise.all([
        invoices$.overdue(branchId),
        students$.unassigned(),
        admissions$.byStatus('approved'),
        missingRegisters({ days: 7, branchId }),
        admissions$.pending()
    ]);

    const unplacedScoped = branchId ? unplaced.filter((s) => s.branchId === branchId) : unplaced;

    if (overdue.length) {
        items.push({
            severity: 'high',
            icon: 'receipt',
            title: `${overdue.length} overdue invoice${overdue.length === 1 ? '' : 's'}`,
            detail: `${InvoiceMath.totals(overdue).balance / 100 >= 100000 ? 'Over a lakh' : 'Money'} outstanding past the due date.`,
            action: 'Chase payments',
            link: '#/fees?filter=overdue'
        });
    }
    if (unplacedScoped.length) {
        items.push({
            severity: 'high',
            icon: 'users',
            title: `${unplacedScoped.length} student${unplacedScoped.length === 1 ? ' is' : 's are'} not in a batch`,
            detail: 'They appear on no roll call until they are placed.',
            action: 'Place students',
            link: '#/students?filter=unplaced'
        });
    }
    if (pending.length) {
        items.push({
            severity: 'medium',
            icon: 'inbox',
            title: `${pending.length} approved applicant${pending.length === 1 ? '' : 's'} not yet enrolled`,
            detail: 'The family has been told they have a place.',
            action: 'Enrol them',
            link: '#/admissions?filter=approved'
        });
    }
    if (missing.length) {
        items.push({
            severity: missing.some((m) => m.age > 3) ? 'medium' : 'low',
            icon: 'check-square',
            title: `${missing.length} register${missing.length === 1 ? '' : 's'} not marked this week`,
            detail: missing.slice(0, 2).map((m) => `${m.batch.name} on ${m.date}`).join(', '),
            action: 'Mark attendance',
            link: '#/attendance'
        });
    }
    if (stalledApps.filter((a) => daysBetween(a.appliedOn, localDate()) > 7).length) {
        const count = stalledApps.filter((a) => daysBetween(a.appliedOn, localDate()) > 7).length;
        items.push({
            severity: 'medium',
            icon: 'clock',
            title: `${count} application${count === 1 ? ' has' : 's have'} waited over a week`,
            detail: 'Families are waiting to hear back.',
            action: 'Review applications',
            link: '#/admissions'
        });
    }

    const order = { high: 0, medium: 1, low: 2 };
    return items.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Recent activity, from the audit log. */
export async function activityPanel() {
    try {
        return await recentActivity(10);
    } catch {
        return [];   // an accountant without audit rights still gets a dashboard
    }
}

/** Branch comparison — only shown when viewing the school as a whole. */
export async function branchPanel() {
    const [all, students, staffRows] = await Promise.all([
        branches$.active(), students$.active(), staff$.activeStaff()
    ]);

    const monthStart = startOfMonth();
    const collections = await Promise.all(
        all.map((b) => collectionSummary({ from: monthStart, to: localDate(), branchId: b.id }))
    );

    return all.map((branch, index) => ({
        id: branch.id,
        name: branch.name,
        code: branch.code,
        students: students.filter((s) => s.branchId === branch.id).length,
        staff: staffRows.filter((s) => s.branchId === branch.id).length,
        collected: collections[index].collected,
        outstanding: collections[index].outstanding
    })).sort((a, b) => b.students - a.students);
}

/* ==========================================================================
   TEACHER'S DASHBOARD
   ========================================================================== */

/**
 * The same idea, scoped to one teacher: their classes today, their registers,
 * their students who are slipping. A teacher opening the app should not have
 * to read the school's collection figures to find out which register they have
 * not marked.
 */
export async function forTeacher(staffId) {
    const [board, batches] = await Promise.all([
        dayBoard(localDate()),
        batches$.byTeacher(staffId)
    ]);

    const mine = new Set(batches.map((b) => b.id));
    const todaysClasses = board.batches.filter((b) => mine.has(b.id));

    const recent = await attendance$.between(addDays(localDate(), -30), localDate());
    const myMarks = recent.filter((r) => mine.has(r.batchId));

    return {
        date: localDate(),
        classesToday: todaysClasses,
        registersPending: todaysClasses.filter((b) => !b.done).length,
        batches: batches.length,
        studentsTaught: (await Promise.all(batches.map((b) => students$.byBatch(b.id)))).flat().length,
        attendanceRate: AttendanceMath.rateOf(myMarks),
        missing: (await missingRegisters({ days: 14 })).filter((m) => mine.has(m.batch.id))
    };
}

/* ------------------------------------------------------------------ HELPERS */

function deltaOf(current, previous, note, isPercentagePoint = false) {
    if (current === null || previous === null || previous === 0) return null;

    const change = isPercentagePoint
        ? Math.round(current - previous)
        : Math.round(((current - previous) / Math.abs(previous)) * 100);

    if (change === 0) return { value: 'no change', tone: 'neutral', note };

    return {
        value: `${change > 0 ? '+' : ''}${change}${isPercentagePoint ? ' pts' : '%'}`,
        tone: change > 0 ? 'positive' : 'negative',
        note
    };
}

function groupCount(rows, keyOf) {
    const counts = new Map();
    for (const row of rows) {
        const key = keyOf(row);
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()].map(([key, count]) => ({ key, count }));
}
