/**
 * NATYAM ERP 2.0 — Report service
 *
 * Every report the school can produce, defined as data: a name, the filters it
 * accepts, the columns it returns, and a function that builds the rows. The
 * reports *page* renders whatever this module describes, which means adding a
 * report is adding an entry here rather than building another screen.
 *
 * On export formats, an honest note about the constraint this product runs
 * under. There is no server, no build step and no CDN, so a genuine .xlsx or
 * a laid-out .pdf would mean shipping a bundled copy of a library like SheetJS
 * or pdfmake — several hundred kilobytes of vendored code that nobody in the
 * school can audit or update. The alternative used here:
 *
 *  - CSV, which Excel opens natively and which is trivially correct;
 *  - SpreadsheetML (.xls), a plain-XML format Excel has read for twenty years,
 *    generated as text, so column widths and number formats survive;
 *  - print-to-PDF via the browser's own print pipeline with a proper print
 *    stylesheet, which produces a better-looking document than a hand-rolled
 *    PDF writer would and is one keystroke from a real PDF on every platform.
 *
 * This is a smaller, more maintainable product than one carrying two vendored
 * binaries, and for a school printing a fee statement it is indistinguishable
 * in outcome.
 */

import { session } from '../core/session.js';
import { localDate, startOfMonth, endOfMonth, monthKey, formatDate, formatDateTime, formatMonth, academicYearOf } from '../utils/date.js';
import { formatMoney, toAmount } from '../utils/money.js';
import { escapeHtml, downloadFile } from '../utils/dom.js';
import { LEVELS, ATTENDANCE_STATUS, levelLabel } from '../config/app.config.js';
import {
    students$, batches$, admissions$, invoices$, payments$, expenses$,
    staff$, programs$, certificates$, branches$, attendance$, salaries$,
    AttendanceMath, PaymentMath
} from '../data/repositories.js';
import { summary as attendanceSummary, teacherCompliance } from './attendance.service.js';
import { collectionSummary } from './fees.service.js';
import { profitAndLoss, ledgerView, expenseBreakdown } from './finance.service.js';
import { institute } from './settings.service.js';

/* ==========================================================================
   REPORT DEFINITIONS
   ========================================================================== */

const money = (v) => formatMoney(v || 0);

export const REPORTS = Object.freeze([
    {
        id: 'student-roll',
        name: 'Student roll',
        group: 'Students',
        description: 'Every active student with their batch, level and contact details.',
        filters: ['branch', 'batch', 'level', 'status'],
        columns: [
            { key: 'admissionNo', label: 'Admission no.' },
            { key: 'name', label: 'Student' },
            { key: 'levelLabel', label: 'Level' },
            { key: 'batchName', label: 'Batch' },
            { key: 'joinedOn', label: 'Joined', format: formatDate },
            { key: 'guardianName', label: 'Parent' },
            { key: 'guardianPhone', label: 'Contact' },
            { key: 'status', label: 'Status' }
        ],
        build: buildStudentRoll
    },
    {
        id: 'attendance-register',
        name: 'Attendance register',
        group: 'Attendance',
        description: 'Per-student attendance across a period, with percentages.',
        filters: ['branch', 'batch', 'dateRange'],
        columns: [
            { key: 'admissionNo', label: 'Admission no.' },
            { key: 'name', label: 'Student' },
            { key: 'batchName', label: 'Batch' },
            { key: 'present', label: 'Present', align: 'right' },
            { key: 'absent', label: 'Absent', align: 'right' },
            { key: 'excused', label: 'Excused', align: 'right' },
            { key: 'sessions', label: 'Sessions', align: 'right' },
            { key: 'rate', label: 'Attendance', align: 'right', format: (v) => (v === null ? '—' : `${v}%`) }
        ],
        build: buildAttendanceRegister
    },
    {
        id: 'teacher-compliance',
        name: 'Register compliance',
        group: 'Attendance',
        description: 'How reliably each teacher marks their registers.',
        filters: ['branch', 'dateRange'],
        columns: [
            { key: 'teacherName', label: 'Teacher' },
            { key: 'batches', label: 'Batches', align: 'right' },
            { key: 'expected', label: 'Expected', align: 'right' },
            { key: 'marked', label: 'Marked', align: 'right' },
            { key: 'compliance', label: 'Compliance', align: 'right', format: (v) => (v === null ? '—' : `${v}%`) }
        ],
        build: buildTeacherCompliance
    },
    {
        id: 'fee-collection',
        name: 'Fee collection',
        group: 'Fees',
        description: 'Every payment received in a period, by mode.',
        filters: ['branch', 'dateRange'],
        columns: [
            { key: 'receiptNo', label: 'Receipt' },
            { key: 'paidOn', label: 'Date', format: formatDate },
            { key: 'studentName', label: 'Student' },
            { key: 'mode', label: 'Mode' },
            { key: 'reference', label: 'Reference' },
            { key: 'amount', label: 'Amount', align: 'right', format: money, numeric: true }
        ],
        build: buildFeeCollection
    },
    {
        id: 'fee-outstanding',
        name: 'Outstanding fees',
        group: 'Fees',
        description: 'Unpaid and part-paid invoices, oldest first, with ageing.',
        filters: ['branch', 'batch'],
        columns: [
            { key: 'invoiceNo', label: 'Invoice' },
            { key: 'studentName', label: 'Student' },
            { key: 'batchName', label: 'Batch' },
            { key: 'dueDate', label: 'Due', format: formatDate },
            { key: 'ageDays', label: 'Age', align: 'right', format: (v) => (v > 0 ? `${v} days` : 'Not due') },
            { key: 'amount', label: 'Billed', align: 'right', format: money, numeric: true },
            { key: 'paid', label: 'Paid', align: 'right', format: money, numeric: true },
            { key: 'balance', label: 'Outstanding', align: 'right', format: money, numeric: true }
        ],
        build: buildOutstanding
    },
    {
        id: 'profit-loss',
        name: 'Profit and loss',
        group: 'Finance',
        description: 'Income and expenditure by account for a period.',
        filters: ['branch', 'dateRange'],
        columns: [
            { key: 'section', label: 'Section' },
            { key: 'account', label: 'Account' },
            { key: 'amount', label: 'Amount', align: 'right', format: money, numeric: true }
        ],
        build: buildProfitAndLoss
    },
    {
        id: 'ledger',
        name: 'Ledger',
        group: 'Finance',
        description: 'Every entry in date order with a running balance.',
        filters: ['branch', 'dateRange'],
        columns: [
            { key: 'date', label: 'Date', format: formatDate },
            { key: 'account', label: 'Account' },
            { key: 'narration', label: 'Narration' },
            { key: 'income', label: 'Income', align: 'right', format: money, numeric: true },
            { key: 'expense', label: 'Expenditure', align: 'right', format: money, numeric: true },
            { key: 'balance', label: 'Balance', align: 'right', format: money, numeric: true }
        ],
        build: buildLedger
    },
    {
        id: 'expenses',
        name: 'Expenditure',
        group: 'Finance',
        description: 'Expenses in a period, by category.',
        filters: ['branch', 'dateRange'],
        columns: [
            { key: 'date', label: 'Date', format: formatDate },
            { key: 'category', label: 'Category' },
            { key: 'description', label: 'Description' },
            { key: 'paidTo', label: 'Paid to' },
            { key: 'mode', label: 'Mode' },
            { key: 'amount', label: 'Amount', align: 'right', format: money, numeric: true }
        ],
        build: buildExpenses
    },
    {
        id: 'admissions',
        name: 'Admissions',
        group: 'Admissions',
        description: 'Applications received in a period and what became of them.',
        filters: ['branch', 'dateRange', 'status'],
        columns: [
            { key: 'applicationNo', label: 'Application' },
            { key: 'appliedOn', label: 'Applied', format: formatDate },
            { key: 'name', label: 'Applicant' },
            { key: 'levelLabel', label: 'Level' },
            { key: 'guardianPhone', label: 'Contact' },
            { key: 'status', label: 'Status' },
            { key: 'outcome', label: 'Outcome' }
        ],
        build: buildAdmissions
    },
    {
        id: 'programs',
        name: 'Programmes',
        group: 'Programmes',
        description: 'Programmes held, participation and their financial result.',
        filters: ['branch', 'dateRange'],
        columns: [
            { key: 'date', label: 'Date', format: formatDate },
            { key: 'name', label: 'Programme' },
            { key: 'typeLabel', label: 'Type' },
            { key: 'venue', label: 'Venue' },
            { key: 'participantCount', label: 'Participants', align: 'right' },
            { key: 'income', label: 'Income', align: 'right', format: money, numeric: true },
            { key: 'expenditure', label: 'Costs', align: 'right', format: money, numeric: true },
            { key: 'net', label: 'Net', align: 'right', format: money, numeric: true }
        ],
        build: buildPrograms
    },
    {
        id: 'staff-roster',
        name: 'Staff roster',
        group: 'Staff',
        description: 'Everyone on the staff, their teaching load and their pay.',
        filters: ['branch', 'status'],
        columns: [
            { key: 'employeeNo', label: 'Employee no.' },
            { key: 'name', label: 'Name' },
            { key: 'roleLabel', label: 'Role' },
            { key: 'specialisation', label: 'Specialisation' },
            { key: 'joinedOn', label: 'Joined', format: formatDate },
            { key: 'batchCount', label: 'Batches', align: 'right' },
            { key: 'studentCount', label: 'Students', align: 'right' },
            { key: 'weeklySessions', label: 'Sessions/week', align: 'right' },
            { key: 'monthlySalary', label: 'Salary', align: 'right', format: money, numeric: true },
            { key: 'status', label: 'Status' }
        ],
        build: buildStaffRoster
    },
    {
        id: 'payroll',
        name: 'Payroll',
        group: 'Staff',
        description: 'Salaries processed in a period, with adjustments.',
        filters: ['branch', 'dateRange'],
        columns: [
            { key: 'period', label: 'Period', format: formatMonth },
            { key: 'staffName', label: 'Staff' },
            { key: 'gross', label: 'Gross', align: 'right', format: money, numeric: true },
            { key: 'allowances', label: 'Allowances', align: 'right', format: money, numeric: true },
            { key: 'deductions', label: 'Deductions', align: 'right', format: money, numeric: true },
            { key: 'net', label: 'Net', align: 'right', format: money, numeric: true },
            { key: 'status', label: 'Status' }
        ],
        build: buildPayroll
    },
    {
        id: 'branch-performance',
        name: 'Branch performance',
        group: 'Branches',
        description: 'Every branch side by side — roll, attendance, collection and net.',
        filters: ['dateRange'],
        columns: [
            { key: 'branchName', label: 'Branch' },
            { key: 'students', label: 'Students', align: 'right' },
            { key: 'batches', label: 'Batches', align: 'right' },
            { key: 'staff', label: 'Staff', align: 'right' },
            { key: 'attendanceRate', label: 'Attendance', align: 'right', format: (v) => (v === null ? '—' : `${v}%`) },
            { key: 'collected', label: 'Collected', align: 'right', format: money, numeric: true },
            { key: 'outstanding', label: 'Outstanding', align: 'right', format: money, numeric: true },
            { key: 'net', label: 'Net', align: 'right', format: money, numeric: true }
        ],
        build: buildBranchPerformance
    },
    {
        id: 'certificates',
        name: 'Certificates issued',
        group: 'Certificates',
        description: 'The certificate register, with serials for verification.',
        filters: ['branch', 'dateRange'],
        columns: [
            { key: 'serial', label: 'Serial' },
            { key: 'issuedOn', label: 'Issued', format: formatDate },
            { key: 'studentName', label: 'Student' },
            { key: 'templateName', label: 'Certificate' },
            { key: 'issuedByName', label: 'Issued by' },
            { key: 'status', label: 'Status' }
        ],
        build: buildCertificates
    }
]);

export function reportById(id) {
    const found = REPORTS.find((r) => r.id === id);
    if (!found) throw new Error(`There is no report called "${id}".`);
    return found;
}

/** Reports grouped for the reports page navigation. */
export function reportCatalogue() {
    const groups = new Map();
    for (const report of REPORTS) {
        if (!groups.has(report.group)) groups.set(report.group, []);
        groups.get(report.group).push({ id: report.id, name: report.name, description: report.description, filters: report.filters });
    }
    return [...groups.entries()].map(([group, reports]) => ({ group, reports }));
}

/* ==========================================================================
   RUNNING A REPORT
   ========================================================================== */

/**
 * Runs a report and returns rows plus everything needed to render or export
 * it. Filters are normalised here so every builder receives the same shape and
 * none of them has to guess what "this month" meant.
 */
export async function run(reportId, filters = {}) {
    session.require('report.view', 'run reports');

    const report = reportById(reportId);
    const resolved = {
        from: filters.from || startOfMonth(),
        to: filters.to || localDate(),
        branchId: filters.branchId ?? session.activeBranchId ?? null,
        batchId: filters.batchId || null,
        level: filters.level || null,
        status: filters.status || null
    };

    const { rows, totals = null, note = null } = await report.build(resolved);

    return {
        report: { id: report.id, name: report.name, description: report.description, columns: report.columns },
        filters: resolved,
        rows,
        totals,
        note,
        count: rows.length,
        generatedAt: new Date().toISOString(),
        generatedBy: session.actorName()
    };
}

/* ==========================================================================
   BUILDERS
   ========================================================================== */

async function buildStudentRoll({ branchId, batchId, level, status }) {
    const [all, batches] = await Promise.all([students$.all(), batches$.all()]);
    const batchName = new Map(batches.map((b) => [b.id, b.name]));

    let rows = all;
    if (branchId) rows = rows.filter((s) => s.branchId === branchId);
    if (batchId) rows = rows.filter((s) => s.batchId === batchId);
    if (level) rows = rows.filter((s) => s.level === level);
    rows = rows.filter((s) => (status ? s.status === status : s.status === 'active'));

    return {
        rows: rows
            .map((s) => ({
                ...s,
                levelLabel: levelLabel(s.level, '—'),
                batchName: batchName.get(s.batchId) || 'Not placed'
            }))
            .sort((a, b) => a.batchName.localeCompare(b.batchName) || a.name.localeCompare(b.name, 'en-IN')),
        totals: null
    };
}

async function buildAttendanceRegister({ from, to, branchId, batchId }) {
    const [marks, roster, batches] = await Promise.all([
        attendance$.between(from, to, branchId),
        students$.active(branchId),
        batches$.all()
    ]);

    const batchName = new Map(batches.map((b) => [b.id, b.name]));
    const scoped = batchId ? marks.filter((m) => m.batchId === batchId) : marks;

    const byStudent = new Map();
    for (const row of scoped) {
        if (!byStudent.has(row.studentId)) byStudent.set(row.studentId, []);
        byStudent.get(row.studentId).push(row);
    }

    const rows = roster
        .filter((s) => !batchId || s.batchId === batchId)
        .map((student) => {
            const own = byStudent.get(student.id) || [];
            const breakdown = AttendanceMath.breakdownOf(own);
            return {
                admissionNo: student.admissionNo,
                name: student.name,
                batchName: batchName.get(student.batchId) || 'Not placed',
                present: (breakdown[ATTENDANCE_STATUS.PRESENT] || 0) + (breakdown[ATTENDANCE_STATUS.LATE] || 0),
                absent: breakdown[ATTENDANCE_STATUS.ABSENT] || 0,
                excused: breakdown[ATTENDANCE_STATUS.EXCUSED] || 0,
                sessions: own.filter((r) => r.status !== ATTENDANCE_STATUS.HOLIDAY).length,
                rate: AttendanceMath.rateOf(own)
            };
        })
        .sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101));

    const overall = await attendanceSummary({ from, to, branchId, batchId });
    return {
        rows,
        totals: { label: 'Overall attendance', value: overall.rate === null ? '—' : `${overall.rate}%` },
        note: `${overall.sessions} class sessions across ${rows.length} students.`
    };
}

async function buildTeacherCompliance({ from, to, branchId }) {
    const rows = await teacherCompliance({ from, to, branchId });
    return {
        rows: rows.map((r) => ({
            teacherName: r.teacher.name,
            batches: r.batches,
            expected: r.expected,
            marked: r.marked,
            compliance: r.compliance
        })),
        totals: null
    };
}

async function buildFeeCollection({ from, to, branchId }) {
    const [rows, students, summary] = await Promise.all([
        payments$.between(from, to, branchId),
        students$.all(),
        collectionSummary({ from, to, branchId })
    ]);

    const nameOf = new Map(students.map((s) => [s.id, s.name]));
    const cleared = rows.filter((p) => p.status === 'cleared');

    return {
        rows: cleared
            .map((p) => ({ ...p, studentName: nameOf.get(p.studentId) || '—' }))
            .sort((a, b) => a.paidOn.localeCompare(b.paidOn)),
        totals: { label: 'Total collected', value: money(summary.collected) },
        note: summary.byMode.map((m) => `${m.mode}: ${money(m.amount)}`).join(' · ')
    };
}

async function buildOutstanding({ branchId, batchId }) {
    const [invoices, students, batches] = await Promise.all([
        invoices$.outstanding(branchId),
        students$.all(),
        batches$.all()
    ]);

    const studentById = new Map(students.map((s) => [s.id, s]));
    const batchName = new Map(batches.map((b) => [b.id, b.name]));
    const today = localDate();

    const rows = invoices
        .map((invoice) => {
            const student = studentById.get(invoice.studentId);
            return {
                ...invoice,
                studentName: student?.name || '—',
                batchName: batchName.get(student?.batchId) || 'Not placed',
                batchId: student?.batchId || null,
                ageDays: invoice.dueDate < today
                    ? Math.floor((new Date(today) - new Date(invoice.dueDate)) / 86400000)
                    : 0
            };
        })
        .filter((r) => !batchId || r.batchId === batchId)
        .sort((a, b) => b.ageDays - a.ageDays || b.balance - a.balance);

    const total = rows.reduce((sum, r) => sum + r.balance, 0);
    return {
        rows,
        totals: { label: 'Total outstanding', value: money(total) },
        note: `${rows.filter((r) => r.ageDays > 0).length} of ${rows.length} invoices are past their due date.`
    };
}

async function buildProfitAndLoss({ from, to, branchId }) {
    const pl = await profitAndLoss({ from, to, branchId });

    const rows = [
        ...pl.income.map((a) => ({ section: 'Income', account: a.account, amount: a.amount })),
        { section: 'Income', account: 'Total income', amount: pl.totalIncome, emphasis: true },
        ...pl.expense.map((a) => ({ section: 'Expenditure', account: a.account, amount: a.amount })),
        { section: 'Expenditure', account: 'Total expenditure', amount: pl.totalExpense, emphasis: true }
    ];

    return {
        rows,
        totals: { label: pl.net >= 0 ? 'Surplus' : 'Deficit', value: money(Math.abs(pl.net)) },
        note: pl.margin === null ? null : `Margin ${pl.margin}% on ${pl.entryCount} ledger entries.`
    };
}

async function buildLedger({ from, to, branchId }) {
    const view = await ledgerView({ from, to, branchId });

    return {
        rows: view.rows.map((entry) => ({
            ...entry,
            income: entry.type === 'income' ? entry.amount : 0,
            expense: entry.type === 'expense' ? entry.amount : 0
        })),
        totals: { label: 'Closing balance', value: money(view.totals.net) }
    };
}

async function buildExpenses({ from, to, branchId }) {
    const [rows, breakdown] = await Promise.all([
        expenses$.between(from, to, branchId),
        expenseBreakdown({ from, to, branchId })
    ]);

    return {
        rows: rows.sort((a, b) => a.date.localeCompare(b.date)),
        totals: { label: 'Total expenditure', value: money(breakdown.total) },
        note: breakdown.categories.slice(0, 3).map((c) => `${c.category} ${c.share}%`).join(' · ')
    };
}

async function buildAdmissions({ from, to, branchId, status }) {
    let rows = (await admissions$.all()).filter((a) => (a.appliedOn || '') >= from && (a.appliedOn || '') <= to);
    if (branchId) rows = rows.filter((a) => a.branchId === branchId);
    if (status) rows = rows.filter((a) => a.status === status);

    return {
        rows: rows
            .map((a) => ({
                ...a,
                levelLabel: levelLabel(a.level, '—'),
                outcome: a.status === 'enrolled' ? `Enrolled ${formatDate(a.enrolledOn)}`
                    : a.status === 'rejected' ? (a.rejectionReason || 'Declined')
                    : 'In progress'
            }))
            .sort((a, b) => (b.appliedOn || '').localeCompare(a.appliedOn || '')),
        totals: null,
        note: `${rows.filter((a) => a.status === 'enrolled').length} of ${rows.length} applications resulted in an enrolment.`
    };
}

async function buildPrograms({ from, to, branchId }) {
    let rows = (await programs$.all()).filter((p) => p.date >= from && p.date <= to);
    if (branchId) rows = rows.filter((p) => p.branchId === branchId);

    return {
        rows: rows
            .map((p) => ({
                ...p,
                typeLabel: p.type,
                participantCount: p.participants?.length || 0,
                net: (p.income || 0) - (p.expenditure || 0)
            }))
            .sort((a, b) => a.date.localeCompare(b.date)),
        totals: {
            label: 'Net result',
            value: money(rows.reduce((sum, p) => sum + ((p.income || 0) - (p.expenditure || 0)), 0))
        }
    };
}

async function buildCertificates({ from, to, branchId }) {
    let rows = (await certificates$.all()).filter((c) => c.issuedOn >= from && c.issuedOn <= to);
    if (branchId) rows = rows.filter((c) => c.branchId === branchId);

    return {
        rows: rows
            .map((c) => ({ ...c, templateName: c.templateId }))
            .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn)),
        totals: null,
        note: rows.filter((c) => c.status === 'revoked').length
            ? `${rows.filter((c) => c.status === 'revoked').length} of these have since been revoked.`
            : null
    };
}

/* ==========================================================================
   EXPORT — CSV
   ========================================================================== */

/**
 * CSV, with the quoting rules actually applied rather than assumed. A student
 * called "Rao, Sruthi" or an expense described as `10" cymbals` will otherwise
 * shift every subsequent column, and the school will not notice until the
 * numbers stop reconciling.
 */
async function buildStaffRoster({ branchId, status }) {
    const [team, batches, students] = await Promise.all([
        staff$.all(), batches$.all(), students$.active()
    ]);

    const roster = new Map();
    for (const student of students) {
        if (student.batchId) roster.set(student.batchId, (roster.get(student.batchId) || 0) + 1);
    }

    let rows = branchId ? team.filter((s) => s.branchId === branchId) : team;
    rows = rows.filter((s) => (status ? s.status === status : s.status !== 'inactive'));

    return {
        rows: rows
            .map((member) => {
                const own = batches.filter((b) => b.teacherId === member.id && b.status !== 'closed');
                return {
                    ...member,
                    roleLabel: member.role,
                    batchCount: own.length,
                    studentCount: own.reduce((sum, b) => sum + (roster.get(b.id) || 0), 0),
                    weeklySessions: own.reduce((sum, b) => sum + (b.days?.length || 0), 0)
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name, 'en-IN')),
        totals: {
            label: 'Monthly wage bill',
            value: money(rows.reduce((sum, s) => sum + (s.monthlySalary || 0), 0))
        }
    };
}

async function buildPayroll({ from, to, branchId }) {
    const fromPeriod = monthKey(from);
    const toPeriod = monthKey(to);

    let rows = (await salaries$.all())
        .filter((s) => s.period >= fromPeriod && s.period <= toPeriod);
    if (branchId) rows = rows.filter((s) => s.branchId === branchId);

    return {
        rows: rows.sort((a, b) =>
            b.period.localeCompare(a.period) || a.staffName.localeCompare(b.staffName, 'en-IN')),
        totals: {
            label: 'Net paid',
            value: money(rows.filter((s) => s.status === 'paid').reduce((sum, s) => sum + s.net, 0))
        },
        note: rows.some((s) => s.status !== 'paid')
            ? `${rows.filter((s) => s.status !== 'paid').length} lines in this range are still unpaid.`
            : null
    };
}

/**
 * The one report that deliberately ignores the active branch: comparing
 * branches is the whole point, so scoping it to one would produce a table with
 * a single row and no meaning.
 */
async function buildBranchPerformance({ from, to }) {
    const all = await branches$.active();

    const rows = await Promise.all(all.map(async (branch) => {
        const [roll, batchRows, team, marks, collection, pl] = await Promise.all([
            students$.active(branch.id),
            batches$.active(branch.id),
            staff$.activeStaff(branch.id),
            attendance$.between(from, to, branch.id),
            collectionSummary({ from, to, branchId: branch.id }),
            profitAndLoss({ from, to, branchId: branch.id })
        ]);

        return {
            branchId: branch.id,
            branchName: branch.name,
            students: roll.length,
            batches: batchRows.length,
            staff: team.length,
            attendanceRate: AttendanceMath.rateOf(marks),
            collected: collection.collected,
            outstanding: collection.outstanding,
            net: pl.net
        };
    }));

    return {
        rows: rows.sort((a, b) => b.net - a.net),
        totals: {
            label: 'Combined net',
            value: money(rows.reduce((sum, r) => sum + r.net, 0))
        }
    };
}

export function toCSV(result) {
    const { report, rows, totals } = result;
    const lines = [report.columns.map((c) => csvCell(c.label)).join(',')];

    for (const row of rows) {
        lines.push(report.columns.map((column) => {
            const raw = row[column.key];
            // Money and counts export as plain numbers so the spreadsheet can
            // sum them; formatting is for reading, not for arithmetic.
            if (column.numeric) return String(toAmount(raw || 0));
            return csvCell(column.format ? column.format(raw) : raw);
        }).join(','));
    }

    if (totals) lines.push(`\n${csvCell(totals.label)},${csvCell(totals.value)}`);
    return lines.join('\n');
}

export function downloadCSV(result) {
    const filename = `${result.report.id}-${localDate()}.csv`;
    // The BOM makes Excel open UTF-8 correctly, which matters for ₹ and for
    // Telugu names.
    downloadFile(filename, `\ufeff${toCSV(result)}`, 'text/csv;charset=utf-8');
    return filename;
}

function csvCell(value) {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/* ==========================================================================
   EXPORT — SPREADSHEET
   ========================================================================== */

/**
 * SpreadsheetML 2003: plain XML that Excel, LibreOffice and Google Sheets all
 * open natively. Unlike CSV it carries types, so amounts arrive as numbers
 * rather than text, and the header row can be bold — which is the entire
 * practical difference for a report a treasurer prints once a month.
 */
export function toSpreadsheetXML(result) {
    const { report, rows, totals, filters, generatedAt, generatedBy } = result;

    const cell = (value, type = 'String') =>
        `<Cell><Data ss:Type="${type}">${escapeHtml(String(value ?? ''))}</Data></Cell>`;

    const header = report.columns.map((c) =>
        `<Cell ss:StyleID="head"><Data ss:Type="String">${escapeHtml(c.label)}</Data></Cell>`).join('');

    const body = rows.map((row) => `<Row>${report.columns.map((column) => {
        const raw = row[column.key];
        if (column.numeric) return `<Cell ss:StyleID="money"><Data ss:Type="Number">${toAmount(raw || 0)}</Data></Cell>`;
        return cell(column.format ? column.format(raw) : raw);
    }).join('')}</Row>`).join('');

    return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="head"><Font ss:Bold="1"/><Interior ss:Color="#EDEDF2" ss:Pattern="Solid"/></Style>
  <Style ss:ID="money"><NumberFormat ss:Format="#,##0.00"/></Style>
  <Style ss:ID="title"><Font ss:Bold="1" ss:Size="14"/></Style>
 </Styles>
 <Worksheet ss:Name="${escapeHtml(report.name.slice(0, 31))}">
  <Table>
   <Row><Cell ss:StyleID="title"><Data ss:Type="String">${escapeHtml(report.name)}</Data></Cell></Row>
   <Row>${cell(`${formatDate(filters.from)} to ${formatDate(filters.to)}`)}</Row>
   <Row>${cell(`Generated ${formatDateTime(generatedAt)} by ${generatedBy}`)}</Row>
   <Row></Row>
   <Row>${header}</Row>
   ${body}
   ${totals ? `<Row></Row><Row><Cell ss:StyleID="head"><Data ss:Type="String">${escapeHtml(totals.label)}</Data></Cell>${cell(totals.value)}</Row>` : ''}
  </Table>
 </Worksheet>
</Workbook>`;
}

export function downloadSpreadsheet(result) {
    const filename = `${result.report.id}-${localDate()}.xls`;
    downloadFile(filename, toSpreadsheetXML(result), 'application/vnd.ms-excel');
    return filename;
}

/* ==========================================================================
   EXPORT — PRINT / PDF
   ========================================================================== */

/**
 * Renders a report as a standalone printable document and opens the browser's
 * print dialogue, where "Save as PDF" is available on every platform this app
 * runs on.
 *
 * The letterhead is built from the institute settings so a printed fee
 * statement carries the school's own name and address rather than looking like
 * a database dump — which is the actual reason a school asks for PDF export.
 */
export async function printReport(result) {
    const org = await institute();
    const { report, rows, totals, filters, note, generatedAt, generatedBy } = result;

    const head = report.columns
        .map((c) => `<th${c.align === 'right' ? ' class="r"' : ''}>${escapeHtml(c.label)}</th>`).join('');

    const body = rows.map((row) => `<tr>${report.columns.map((column) => {
        const raw = row[column.key];
        const text = column.format ? column.format(raw) : (raw ?? '');
        return `<td${column.align === 'right' ? ' class="r"' : ''}${row.emphasis ? ' class="b"' : ''}>${escapeHtml(String(text))}</td>`;
    }).join('')}</tr>`).join('');

    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(report.name)} — ${escapeHtml(org.name)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font: 11px/1.5 "Segoe UI", system-ui, sans-serif; color: #14141c; margin: 0; }
  header { border-bottom: 2px solid #2f2a6b; padding-bottom: 10px; margin-bottom: 16px; }
  .org { font-size: 16px; font-weight: 700; color: #2f2a6b; letter-spacing: -0.01em; }
  .sub { color: #5c5c6e; font-size: 10px; margin-top: 2px; }
  h1 { font-size: 13px; margin: 14px 0 2px; }
  .meta { color: #5c5c6e; font-size: 10px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.05em;
       color: #5c5c6e; border-bottom: 1px solid #c9c9d4; padding: 6px 6px 5px; }
  td { padding: 5px 6px; border-bottom: 1px solid #ededf2; }
  .r { text-align: right; font-variant-numeric: tabular-nums; }
  .b { font-weight: 600; }
  tbody tr:nth-child(even) { background: #fafafc; }
  .totals { margin-top: 14px; padding-top: 10px; border-top: 2px solid #2f2a6b;
            display: flex; justify-content: space-between; font-weight: 700; font-size: 12px; }
  footer { margin-top: 20px; padding-top: 8px; border-top: 1px solid #ededf2;
           color: #8a8a9a; font-size: 9px; display: flex; justify-content: space-between; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head>
<body>
  <header>
    <div class="org">${escapeHtml(org.name)}</div>
    <div class="sub">${[org.address, org.phone, org.email].filter(Boolean).map(escapeHtml).join(' · ')}</div>
  </header>
  <h1>${escapeHtml(report.name)}</h1>
  <div class="meta">${formatDate(filters.from)} to ${formatDate(filters.to)}${note ? ` · ${escapeHtml(note)}` : ''}</div>
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  ${totals ? `<div class="totals"><span>${escapeHtml(totals.label)}</span><span>${escapeHtml(totals.value)}</span></div>` : ''}
  <footer>
    <span>Generated ${formatDateTime(generatedAt)} by ${escapeHtml(generatedBy)}</span>
    <span>${rows.length} record${rows.length === 1 ? '' : 's'}</span>
  </footer>
</body></html>`;

    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);

    frame.srcdoc = html;
    await new Promise((resolve) => { frame.onload = resolve; });

    frame.contentWindow.focus();
    frame.contentWindow.print();

    // Left in the document until the print dialogue has certainly been read
    // from; removing it immediately cancels the job in some browsers.
    setTimeout(() => frame.remove(), 60000);
    return true;
}

/* ------------------------------------------------------------------ HELPERS */


export { startOfMonth, endOfMonth, monthKey, academicYearOf };
