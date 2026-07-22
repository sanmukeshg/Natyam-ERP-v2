/**
 * NATYAM ERP 2.0 — Analytics service
 *
 * Trends and comparisons, for the analytics dashboard.
 *
 * This service is almost entirely composition: it asks finance for its monthly
 * series, attendance for its trend, fees for its collection summary, and joins
 * the answers. It deliberately does not recompute any of those from the raw
 * stores. If analytics derived revenue its own way, the school would have two
 * revenue numbers that differed by rounding and a fortnight of arguments about
 * which screen was lying.
 *
 * The one thing genuinely computed here is student growth, because no other
 * module needs "how did the roll move month by month" and there was nowhere
 * honest to put it.
 */

import { session } from '../core/session.js';
import { localDate, lastMonths, monthKey, formatMonth, addMonths, startOfMonth, endOfMonth } from '../utils/date.js';
import { students$, admissions$, batches$, invoices$ } from '../data/repositories.js';
import { STUDENT_STATUS, ADMISSION_STATUS } from '../config/app.config.js';

import { monthlySeries, profitAndLoss, branchPerformance as financeByBranch } from './finance.service.js';
import { trend as attendanceTrend, teacherCompliance } from './attendance.service.js';
import { collectionSummary } from './fees.service.js';
import { programSummary, listPrograms } from './programs.service.js';
import { listStaff } from './staff.service.js';
import { listBranches } from './settings.service.js';

/* ==========================================================================
   EXECUTIVE SUMMARY
   ========================================================================== */

/**
 * The half-dozen numbers an owner actually wants, each with the direction of
 * travel. A KPI without a comparison is a number without meaning — "82%
 * attendance" only matters next to last month's 76%.
 */
export async function executiveKPIs(branchId = null) {
    session.require('report.view', 'view analytics');

    const thisMonth = monthKey();
    const lastMonth = monthKey(addMonths(localDate(), -1));

    const [roll, growth, revenue, attendance, collection, previousCollection] = await Promise.all([
        students$.active(branchId),
        studentGrowth(2, branchId),
        monthlySeries(2, branchId),
        attendanceTrend(2, branchId),
        collectionSummary({
            from: startOfMonth(localDate()), to: localDate(), branchId
        }),
        collectionSummary({
            from: startOfMonth(addMonths(localDate(), -1)),
            to: endOfMonth(addMonths(localDate(), -1)),
            branchId
        })
    ]);

    const current = revenue.find((r) => r.period === thisMonth) || { income: 0, net: 0 };
    const previous = revenue.find((r) => r.period === lastMonth) || { income: 0, net: 0 };
    const attendanceNow = attendance.find((a) => a.period === thisMonth)?.rate ?? null;
    const attendanceThen = attendance.find((a) => a.period === lastMonth)?.rate ?? null;
    const joinedNow = growth.at(-1)?.joined ?? 0;
    const joinedThen = growth.at(-2)?.joined ?? 0;

    return {
        students: kpi('Students on the roll', roll.length, roll.length - (growth.at(-1)?.opening ?? roll.length)),
        joined: kpi('Joined this month', joinedNow, joinedNow - joinedThen),
        revenue: kpi('Income this month', current.income, current.income - previous.income, 'money'),
        net: kpi('Net this month', current.net, current.net - previous.net, 'money'),
        collected: kpi('Collected this month', collection.collected,
            collection.collected - previousCollection.collected, 'money'),
        outstanding: kpi('Outstanding', collection.outstanding,
            collection.outstanding - previousCollection.outstanding, 'money', true),
        attendance: kpi('Attendance this month', attendanceNow,
            attendanceNow === null || attendanceThen === null ? null : attendanceNow - attendanceThen, 'percent')
    };
}

function kpi(label, value, delta, format = 'number', lowerIsBetter = false) {
    const direction = delta === null || delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down';
    const good = direction === 'flat'
        ? null
        : lowerIsBetter ? direction === 'down' : direction === 'up';

    return { label, value, delta, direction, good, format };
}

/* ==========================================================================
   TRENDS
   ========================================================================== */

/**
 * The roll month by month: who joined, who left, and where the total stood at
 * the end. Leavers are inferred from a status that is no longer active rather
 * than from a deletion, because archiving is a soft delete and a hard-deleted
 * student would silently vanish from history.
 */
export async function studentGrowth(months = 12, branchId = null) {
    const keys = lastMonths(months);
    const all = (await students$.all()).filter((s) => !branchId || s.branchId === branchId);

    let running = all.filter((student) => {
        const joined = student.joinedOn || student.createdAt?.slice(0, 10);
        return joined && joined < `${keys[0]}-01`
            && !(student.leftOn && student.leftOn < `${keys[0]}-01`);
    }).length;

    return keys.map((period) => {
        const opening = running;

        const joined = all.filter((s) => (s.joinedOn || s.createdAt?.slice(0, 10) || '').startsWith(period)).length;
        const left = all.filter((s) => (s.leftOn || '').startsWith(period)).length;

        running = opening + joined - left;

        return {
            period,
            label: formatMonth(period),
            opening,
            joined,
            left,
            total: running,
            netChange: joined - left
        };
    });
}

/** Income, expenditure and net by month — read straight from the ledger. */
export async function revenueTrend(months = 12, branchId = null) {
    return monthlySeries(months, branchId);
}

/** Attendance rate by month. */
export async function attendanceTrendSeries(months = 12, branchId = null) {
    const rows = await attendanceTrend(months, branchId);
    return rows.map((row) => ({ ...row, label: formatMonth(row.period) }));
}

/**
 * Billed against collected, month by month. The gap between the two lines is
 * the arrears the school is carrying, which is a more useful thing to look at
 * than either line alone.
 */
export async function collectionTrend(months = 12, branchId = null) {
    const keys = lastMonths(months);
    const invoices = (await invoices$.all()).filter((i) => !branchId || i.branchId === branchId);

    return Promise.all(keys.map(async (period) => {
        const billed = invoices
            .filter((invoice) => (invoice.issuedOn || invoice.dueDate || '').startsWith(period))
            .filter((invoice) => invoice.status !== 'cancelled')
            .reduce((sum, invoice) => sum + (invoice.amount || 0), 0);

        const summary = await collectionSummary({
            from: `${period}-01`,
            to: endOfMonth(`${period}-01`),
            branchId
        });

        return {
            period,
            label: formatMonth(period),
            billed,
            collected: summary.collected,
            gap: billed - summary.collected,
            rate: billed ? Math.round((summary.collected / billed) * 100) : null
        };
    }));
}

/* ==========================================================================
   COMPARISONS
   ========================================================================== */

/** Every branch side by side. */
export async function branchComparison({ from, to }) {
    const [branches, financials] = await Promise.all([
        listBranches(),
        financeByBranch({ from, to })
    ]);

    const byId = new Map(financials.map((row) => [row.branch.id, row]));

    return Promise.all(branches.map(async (branch) => {
        const [roll, batchRows, collection] = await Promise.all([
            students$.active(branch.id),
            batches$.active(branch.id),
            collectionSummary({ from, to, branchId: branch.id })
        ]);

        const financial = byId.get(branch.id) || { income: 0, expense: 0, net: 0, margin: null };

        return {
            branch,
            students: roll.length,
            batches: batchRows.length,
            capacity: batchRows.reduce((sum, b) => sum + (b.capacity || 0), 0),
            occupancy: batchRows.reduce((sum, b) => sum + (b.capacity || 0), 0)
                ? Math.round((roll.length / batchRows.reduce((sum, b) => sum + (b.capacity || 0), 0)) * 100)
                : null,
            collected: collection.collected,
            outstanding: collection.outstanding,
            income: financial.income,
            expense: financial.expense,
            net: financial.net,
            margin: financial.margin
        };
    }));
}

/**
 * Teacher performance, which needs stating carefully: this measures register
 * compliance and the attendance of the classes they teach. It does not measure
 * teaching. A guru with the school's hardest batch will look worse than one
 * with the keenest, and the numbers are presented as prompts for a
 * conversation rather than a ranking.
 */
export async function teacherPerformance({ from, to, branchId = null }) {
    const [staff, compliance] = await Promise.all([
        listStaff(branchId),
        teacherCompliance({ from, to, branchId })
    ]);

    const byTeacher = new Map(compliance.map((row) => [row.teacher.id, row]));

    return staff
        .filter((member) => member.role === 'teacher')
        .map((member) => {
            const record = byTeacher.get(member.id) || {};
            return {
                staff: member,
                name: member.name,
                batches: member.batchCount,
                students: member.studentCount,
                weeklySessions: member.weeklySessions,
                expected: record.expected ?? 0,
                marked: record.marked ?? 0,
                compliance: record.compliance ?? null
            };
        })
        .sort((a, b) => (b.compliance ?? -1) - (a.compliance ?? -1));
}

/** Programmes by type, participation and financial result. */
export async function programAnalytics(branchId = null, { from = null, to = null } = {}) {
    const [summary, rows] = await Promise.all([
        programSummary(branchId),
        listPrograms(branchId, { from, to })
    ]);

    const completed = rows.filter((program) => program.status === 'completed');

    return {
        ...summary,
        held: completed.length,
        totalIncome: completed.reduce((sum, p) => sum + (p.income || 0), 0),
        totalCost: completed.reduce((sum, p) => sum + (p.expenditure || 0), 0),
        net: completed.reduce((sum, p) => sum + ((p.income || 0) - (p.expenditure || 0)), 0),
        averageCast: completed.length
            ? Math.round(completed.reduce((sum, p) => sum + (p.participantCount || 0), 0) / completed.length)
            : 0,
        byType: summary.byType.map((entry) => {
            const ofType = completed.filter((p) => p.type === entry.type);
            return {
                ...entry,
                net: ofType.reduce((sum, p) => sum + ((p.income || 0) - (p.expenditure || 0)), 0),
                participants: ofType.reduce((sum, p) => sum + (p.participantCount || 0), 0)
            };
        }),
        mostAttended: [...completed]
            .sort((a, b) => (b.participantCount || 0) - (a.participantCount || 0))
            .slice(0, 5)
    };
}

/* ==========================================================================
   FUNNEL
   ========================================================================== */

/**
 * Application to enrolment, as a funnel. The number worth watching is not the
 * conversion rate but the count sitting at "approved" — those are families who
 * have been told yes and are not yet on any register.
 */
export async function admissionFunnel(branchId = null, { months = 6 } = {}) {
    const since = `${lastMonths(months)[0]}-01`;
    const all = (await admissions$.all())
        .filter((a) => !branchId || a.branchId === branchId)
        .filter((a) => (a.appliedOn || '') >= since);

    const count = (status) => all.filter((a) => a.status === status).length;

    const applied = all.length;
    const enrolled = count(ADMISSION_STATUS.ENROLLED);
    const decided = enrolled + count(ADMISSION_STATUS.REJECTED);

    return {
        stages: [
            { key: 'applied', label: 'Applied', value: applied },
            { key: 'reviewing', label: 'In review', value: count(ADMISSION_STATUS.SUBMITTED) + count(ADMISSION_STATUS.REVIEWING) },
            { key: 'approved', label: 'Approved', value: count(ADMISSION_STATUS.APPROVED) },
            { key: 'enrolled', label: 'Enrolled', value: enrolled }
        ],
        conversionRate: decided ? Math.round((enrolled / decided) * 100) : null,
        awaitingEnrolment: count(ADMISSION_STATUS.APPROVED)
    };
}

/* ==========================================================================
   COMPOSITE
   ========================================================================== */

/**
 * Everything the analytics page needs, resolved in parallel with each panel
 * isolated: one slow or broken panel must not blank the whole dashboard.
 */
export async function analyticsOverview({ branchId = null, months = 12, from = null, to = null } = {}) {
    session.require('report.view', 'view analytics');

    const range = {
        from: from || `${lastMonths(months)[0]}-01`,
        to: to || localDate()
    };

    const panels = await Promise.allSettled([
        executiveKPIs(branchId),
        studentGrowth(months, branchId),
        revenueTrend(months, branchId),
        attendanceTrendSeries(months, branchId),
        collectionTrend(months, branchId),
        branchComparison(range),
        teacherPerformance({ ...range, branchId }),
        programAnalytics(branchId, range),
        admissionFunnel(branchId, { months: 6 }),
        profitAndLoss({ ...range, branchId })
    ]);

    const [kpis, growth, revenue, attendance, collection, branches, teachers, programs, funnel, pl] =
        panels.map((panel) => (panel.status === 'fulfilled' ? panel.value : null));

    const failed = panels
        .map((panel, index) => (panel.status === 'rejected' ? PANEL_NAMES[index] : null))
        .filter(Boolean);

    return {
        range, months,
        kpis, growth, revenue, attendance, collection,
        branches, teachers, programs, funnel, profitAndLoss: pl,
        failed
    };
}

const PANEL_NAMES = [
    'headline figures', 'student growth', 'revenue', 'attendance', 'collection',
    'branches', 'teachers', 'programmes', 'admissions', 'profit and loss'
];

export { STUDENT_STATUS };
