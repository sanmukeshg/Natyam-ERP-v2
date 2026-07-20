/**
 * NATYAM ERP 2.0 — Search service
 *
 * Backs the header search box and the command palette. One module, because
 * they are the same question asked two ways: "take me to the thing I am
 * thinking of". Splitting entity search from command search would mean typing
 * "sruthi" in one place and "mark attendance" in another, which is exactly the
 * friction a palette exists to remove.
 *
 * Ranking matters more than matching here. A registrar typing "sru" wants
 * Sruthi Reddy, not the seventeen expense narrations containing those letters,
 * so exact prefix matches on names and identifiers outrank substring hits
 * anywhere else, and each result carries the route that opens it.
 */

import { session } from '../core/session.js';
import { NAVIGATION } from '../config/app.config.js';
import { formatMoney } from '../utils/money.js';
import { formatDate } from '../utils/date.js';
import {
    students$, admissions$, batches$, staff$, invoices$,
    programs$, certificates$, expenses$
} from '../data/repositories.js';

/* ==========================================================================
   ENTITY SEARCH
   ========================================================================== */

const SOURCES = [
    {
        key: 'students', label: 'Students', icon: 'users', capability: 'student.view',
        load: (branchId) => students$.all(),
        scope: (row, branchId) => !branchId || row.branchId === branchId,
        fields: (s) => [s.name, s.admissionNo, s.guardianName, s.guardianPhone],
        map: (s) => ({
            id: s.id,
            title: s.name,
            subtitle: [s.admissionNo, s.level].filter(Boolean).join(' · '),
            meta: s.status === 'active' ? null : s.status,
            route: `#/students/${s.id}`
        })
    },
    {
        key: 'admissions', label: 'Applications', icon: 'inbox', capability: 'admission.view',
        load: () => admissions$.all(),
        scope: (row, branchId) => !branchId || row.branchId === branchId,
        fields: (a) => [a.name, a.applicationNo, a.guardianName, a.guardianPhone],
        map: (a) => ({
            id: a.id,
            title: a.name,
            subtitle: [a.applicationNo, a.status].filter(Boolean).join(' · '),
            route: `#/admissions/${a.id}`
        })
    },
    {
        key: 'batches', label: 'Batches', icon: 'layers', capability: 'student.view',
        load: () => batches$.all(),
        scope: (row, branchId) => !branchId || row.branchId === branchId,
        fields: (b) => [b.name, b.code, b.room],
        map: (b) => ({
            id: b.id,
            title: b.name,
            subtitle: [b.code, b.level].filter(Boolean).join(' · '),
            meta: b.status === 'active' ? null : 'Closed',
            route: `#/batches/${b.id}`
        })
    },
    {
        key: 'staff', label: 'Staff', icon: 'user-check', capability: 'staff.view',
        load: () => staff$.all(),
        scope: (row, branchId) => !branchId || row.branchId === branchId,
        fields: (s) => [s.name, s.employeeNo, s.phone, s.specialisation],
        map: (s) => ({
            id: s.id,
            title: s.name,
            subtitle: [s.employeeNo, s.role].filter(Boolean).join(' · '),
            route: `#/staff/${s.id}`
        })
    },
    {
        key: 'invoices', label: 'Invoices', icon: 'receipt', capability: 'fee.view',
        load: () => invoices$.all(),
        scope: (row, branchId) => !branchId || row.branchId === branchId,
        fields: (i) => [i.invoiceNo, i.studentName, i.description],
        map: (i) => ({
            id: i.id,
            title: i.invoiceNo,
            subtitle: [i.studentName, formatMoney(i.amount)].filter(Boolean).join(' · '),
            meta: i.status,
            route: `#/fees/${i.id}`
        })
    },
    {
        key: 'programs', label: 'Programmes', icon: 'star', capability: 'program.view',
        load: () => programs$.all(),
        scope: (row, branchId) => !branchId || row.branchId === branchId,
        fields: (p) => [p.name, p.venue, p.description],
        map: (p) => ({
            id: p.id,
            title: p.name,
            subtitle: [formatDate(p.date), p.venue].filter(Boolean).join(' · '),
            route: `#/programs/${p.id}`
        })
    },
    {
        key: 'certificates', label: 'Certificates', icon: 'award', capability: 'program.view',
        load: () => certificates$.all(),
        scope: (row, branchId) => !branchId || row.branchId === branchId,
        fields: (c) => [c.serial, c.studentName, c.title],
        map: (c) => ({
            id: c.id,
            title: c.serial,
            subtitle: c.studentName,
            meta: c.status === 'revoked' ? 'Revoked' : null,
            route: `#/certificates/${c.id}`
        })
    },
    {
        key: 'expenses', label: 'Expenses', icon: 'trending-down', capability: 'finance.view',
        load: () => expenses$.all(),
        scope: (row, branchId) => !branchId || row.branchId === branchId,
        fields: (e) => [e.description, e.category, e.paidTo, e.reference],
        map: (e) => ({
            id: e.id,
            title: e.description,
            subtitle: [e.category, formatMoney(e.amount)].join(' · '),
            meta: formatDate(e.date),
            route: `#/finance?expense=${e.id}`
        })
    }
];

/**
 * Scores one record against a query.
 *
 * The scale is deliberately coarse — exact, prefix, word-start, substring —
 * because fine-grained relevance scoring on eighty students is false
 * precision. What people actually notice is whether the thing they typed the
 * start of is first.
 */
function score(fields, query) {
    let best = 0;

    for (const field of fields) {
        if (!field) continue;
        const value = String(field).toLowerCase();

        if (value === query) return 100;
        if (value.startsWith(query)) { best = Math.max(best, 80); continue; }

        // A word beginning with the query: "reddy" matching "Sruthi Reddy".
        if (value.split(/[\s/\-]+/).some((word) => word.startsWith(query))) { best = Math.max(best, 60); continue; }
        if (value.includes(query)) best = Math.max(best, 30);
    }

    return best;
}

/**
 * Searches across every entity the current user is allowed to see.
 *
 * @param {string} query
 * @param {object} [options]
 * @param {string[]} [options.only]   Restrict to certain source keys.
 * @param {number} [options.limit=8]  Results per source.
 */
export async function search(query, { only = null, limit = 8, branchId = undefined } = {}) {
    const q = String(query || '').trim().toLowerCase();
    if (q.length < 2) return [];

    const scope = branchId === undefined ? session.activeBranchId : branchId;

    const sources = SOURCES
        .filter((source) => !only || only.includes(source.key))
        .filter((source) => session.can(source.capability));

    const groups = await Promise.all(sources.map(async (source) => {
        let rows;
        try {
            rows = await source.load(scope);
        } catch {
            return null;   // one unavailable store must not blank the palette
        }

        const hits = rows
            .filter((row) => source.scope(row, scope))
            .map((row) => ({ row, weight: score(source.fields(row), q) }))
            .filter((hit) => hit.weight > 0)
            .sort((a, b) => b.weight - a.weight)
            .slice(0, limit)
            .map((hit) => ({ ...source.map(hit.row), weight: hit.weight, source: source.key, icon: source.icon }));

        return hits.length ? { key: source.key, label: source.label, icon: source.icon, results: hits } : null;
    }));

    return groups
        .filter(Boolean)
        .sort((a, b) => b.results[0].weight - a.results[0].weight);
}

/** A single flat, ranked list — what the command palette renders. */
export async function searchFlat(query, { limit = 12 } = {}) {
    const groups = await search(query, { limit: 5 });
    return groups
        .flatMap((group) => group.results.map((r) => ({ ...r, group: group.label })))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, limit);
}

/* ==========================================================================
   COMMANDS
   ========================================================================== */

/**
 * Actions the palette can run, as opposed to records it can open.
 *
 * Each is gated by capability, so an accountant's palette does not offer to
 * mark attendance — a menu that lists things you are not allowed to do is
 * worse than one that does not.
 */
const COMMANDS = [
    { id: 'new-admission',  label: 'New application',        hint: 'Start the admissions wizard', icon: 'plus',        capability: 'admission.edit',   route: '#/admissions/new' },
    { id: 'new-student',    label: 'Add student directly',   hint: 'Skip the application',        icon: 'user-plus',   capability: 'student.edit',     route: '#/students/new' },
    { id: 'mark-attendance',label: 'Mark attendance',        hint: 'Today’s registers',           icon: 'check-square',capability: 'attendance.mark',  route: '#/attendance' },
    { id: 'collect-fee',    label: 'Record a payment',       hint: 'Issue a receipt',             icon: 'receipt',     capability: 'fee.collect',      route: '#/fees?action=collect' },
    { id: 'add-expense',    label: 'Record an expense',      hint: 'Post to the ledger',          icon: 'trending-down',capability: 'finance.edit',    route: '#/finance?action=expense' },
    { id: 'run-payroll',    label: 'Prepare payroll',        hint: 'This month’s salaries',       icon: 'briefcase',   capability: 'finance.edit',     route: '#/finance?tab=payroll' },
    { id: 'new-batch',      label: 'Create a batch',         hint: 'Timetable a new class',       icon: 'layers',      capability: 'student.edit',     route: '#/batches/new' },
    { id: 'schedule-program',label: 'Schedule a programme',  hint: 'Performance or workshop',     icon: 'star',        capability: 'program.edit',     route: '#/programs/new' },
    { id: 'issue-certificate',label: 'Issue a certificate',  hint: 'For a student or programme',  icon: 'award',       capability: 'certificate.issue',route: '#/certificates?action=issue' },
    { id: 'verify-certificate',label: 'Verify a certificate',hint: 'Look up a serial',            icon: 'search',      capability: 'program.view', route: '#/certificates?action=verify' },
    { id: 'run-report',     label: 'Run a report',           hint: 'Export or print',             icon: 'file-text',   capability: 'report.view',      route: '#/reports' },
    { id: 'take-backup',    label: 'Take a backup',          hint: 'Download all data',           icon: 'download',    capability: 'backup.manage',  route: '#/settings?tab=backup' },
    { id: 'audit-log',      label: 'Open the audit log',     hint: 'Who changed what',            icon: 'shield',      capability: 'audit.view',       route: '#/settings?tab=audit' }
];

/** Commands and navigation destinations the current user can reach. */
export function commands(query = '') {
    const q = String(query || '').trim().toLowerCase();

    const actions = COMMANDS
        .filter((command) => session.can(command.capability))
        .map((command) => ({ ...command, kind: 'action', weight: q ? score([command.label, command.hint], q) : 50 }));

    // NAVIGATION groups carry `group` and their items carry `cap` and `path`.
    // An earlier version read `group.label`, `item.capability` and `item.id`,
    // none of which exist: the palette threw on every open, and the capability
    // filter silently passed everything because `undefined` is falsy.
    const destinations = NAVIGATION
        .flatMap((group) => group.items.map((item) => ({ ...item, groupName: group.group })))
        .filter((item) => !item.cap || session.can(item.cap))
        .map((item) => ({
            id: `go-${item.path}`,
            label: item.label,
            hint: `Go to ${item.groupName.toLowerCase()}`,
            icon: item.icon,
            route: item.path,
            kind: 'navigate',
            weight: q ? score([item.label, item.groupName], q) : 40
        }));

    return [...actions, ...destinations]
        .filter((entry) => !q || entry.weight > 0)
        .sort((a, b) => b.weight - a.weight);
}

/**
 * What the palette shows for a given input: commands when the box is empty or
 * the query looks like an instruction, records once it looks like a name.
 * Both are always offered — the ordering is what changes.
 */
export async function palette(query = '') {
    const q = String(query || '').trim();

    if (q.length < 2) {
        return { commands: commands().slice(0, 8), records: [], empty: true };
    }

    const [records, matched] = await Promise.all([searchFlat(q, { limit: 10 }), Promise.resolve(commands(q))]);
    return { commands: matched.slice(0, 5), records, empty: !records.length && !matched.length };
}

/** Suggestions for an empty search box — the recently touched records. */
export async function recentSuggestions(limit = 5) {
    if (!session.can('student.view')) return [];

    const rows = (await students$.all())
        .filter((s) => s.status === 'active')
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
        .slice(0, limit);

    return rows.map((s) => ({
        id: s.id,
        title: s.name,
        subtitle: s.admissionNo,
        route: `#/students/${s.id}`,
        icon: 'users',
        group: 'Recent'
    }));
}
