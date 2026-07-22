/**
 * NATYAM ERP 2.0 — Staff
 *
 * The people who teach and run the school. A staff record is not a login: this
 * is an offline app with no server, so a "user" (who can sign in and act) and a
 * "staff member" (who teaches batches and is paid) are separate things, joined
 * only when someone deliberately links them in settings.
 *
 * The teacher drawer is the interesting part. A teacher's real question is not
 * "what are my details" — they know those — but "which of my batches is
 * slipping". So the drawer leads with attendance per batch, worst first.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { kpiCard } from '../../ui/chart.js';
import { toast } from '../../ui/toast.js';
import { drawer } from '../../ui/overlay.js';
import { DataTable } from '../../ui/table.js';
import { formOverlay, optionsFrom, summaryList } from '../../ui/form.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { router } from '../../core/router.js';
import { formatMoney, formatNumber } from '../../utils/money.js';
import { formatDate, formatMonth, localDate } from '../../utils/date.js';

import {
    STAFF_ROLES, hire, updateStaff, deactivate, reactivate,
    listStaff, teacherDashboard, staffSummary
} from '../../services/staff.service.js';
import { listBranches } from '../../services/settings.service.js';

export default class StaffPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Staff';
        this.includeInactive = false;
    }

    async render(container) {
        this.container = container;
        session.require('staff.view', 'open the staff directory');

        render(container, this.shell());
        this.bind();
        this.buildTable();
        await this.load();

        if (this.query.staff) this.openStaff(this.query.staff);
    }

    shell() {
        return html`
            <header class="page-header">
                <div class="page-header-text">
                    <h1 class="page-title">Staff</h1>
                    <p class="page-subtitle" data-role="subtitle">Teachers, musicians and the office.</p>
                </div>
                <div class="page-actions">
                    ${session.can('staff.edit') ? html`
                        <button class="btn btn-primary btn-sm" data-action="hire">
                            ${raw(icon('user-plus', { size: 15 }))} Add staff
                        </button>
                    ` : ''}
                </div>
            </header>
            <div class="page-body">
                <div data-role="summary"></div>
                <div class="filter-bar">
                    <label class="row row-tight">
                        <input type="checkbox" class="checkbox" data-role="inactive">
                        <span class="type-caption">Include past staff</span>
                    </label>
                </div>
                <div data-role="table"></div>
            </div>
        `;
    }

    bind() {
        this.onDispose(on(this.container, 'click', '[data-action="hire"]', () => this.hireStaff()));
        this.onDispose(on(this.container, 'change', '[data-role="inactive"]', (_e, target) => {
            this.includeInactive = target.checked;
            this.load();
        }));

        [EVENTS.STAFF_CREATED, EVENTS.STAFF_UPDATED, EVENTS.SALARY_PROCESSED, EVENTS.BRANCH_CHANGED]
            .filter(Boolean)
            .forEach((event) => this.events.on(event, () => this.load()));
    }

    buildTable() {
        this.table = new DataTable({
            rows: [],
            searchPlaceholder: 'Search name, role or specialisation…',
            defaultSort: 'name',
            emptyTitle: 'Nobody on the staff list',
            emptyMessage: 'Add the teachers first — a batch cannot be assigned without one.',
            emptyIcon: 'briefcase',
            emptyAction: session.can('staff.edit')
                ? { label: 'Add staff', onClick: () => this.hireStaff() }
                : null,
            onRowClick: (row) => this.openStaff(row.id),
            columns: [
                {
                    key: 'name', label: 'Name', sortable: true,
                    searchValue: (row) => `${row.name} ${row.roleLabel} ${row.specialisation || ''} ${row.phone || ''}`,
                    render: (row) => html`
                        <div>
                            <span class="type-strong">${row.name}</span>
                            <div class="type-caption type-muted">
                                ${row.employeeNo || ''} ${row.specialisation ? `· ${row.specialisation}` : ''}
                            </div>
                        </div>
                    `
                },
                { key: 'roleLabel', label: 'Role', sortable: true },
                {
                    key: 'batchCount', label: 'Teaching', align: 'right', sortable: true,
                    render: (row) => row.batchCount
                        ? html`<div>
                                   <span class="type-strong">${row.batchCount} batch${row.batchCount === 1 ? '' : 'es'}</span>
                                   <div class="type-caption type-muted">
                                       ${formatNumber(row.studentCount)} students · ${row.weeklySessions}/week
                                   </div>
                               </div>`
                        : html`<span class="type-muted">—</span>`
                },
                {
                    key: 'monthlySalary', label: 'Salary', align: 'right', sortable: true,
                    exportValue: (row) => (row.monthlySalary || 0) / 100,
                    render: (row) => session.can('finance.view')
                        ? html`<span>${row.monthlySalary ? formatMoney(row.monthlySalary) : '—'}</span>`
                        : html`<span class="type-muted">hidden</span>`
                },
                {
                    key: 'status', label: 'Status', sortable: true,
                    render: (row) => html`<span class="badge ${row.status === 'active' ? 'badge-success' : 'badge-neutral'}">
                        ${row.status || 'active'}</span>`
                }
            ]
        });

        this.table.mount(this.container.querySelector('[data-role="table"]'));
        this.onDispose(() => this.table.destroy());
    }

    async load() {
        try {
            const [rows, stats] = await Promise.all([
                listStaff(session.branch(), { includeInactive: this.includeInactive }),
                staffSummary(session.branch())
            ]);

            this.rows = rows;
            this.table.setRows(rows);

            render(this.container.querySelector('[data-role="subtitle"]'), html`
                ${formatNumber(stats.total)} on the staff · ${formatNumber(stats.teachers)} teaching
            `);

            render(this.container.querySelector('[data-role="summary"]'), html`
                <div class="grid grid-4">
                    ${kpiCard('On staff', formatNumber(stats.total))}
                    ${kpiCard('Teachers', formatNumber(stats.teachers), `${formatNumber(stats.others)} other roles`)}
                    ${session.can('finance.view')
                        ? kpiCard('Monthly wage bill', formatMoney(stats.monthlyWageBill))
                        : kpiCard('Monthly wage bill', 'Hidden', 'needs finance access')}
                    ${kpiCard('This month\u2019s payroll',
                        stats.payrollRun ? `${stats.payrollPaid} paid` : 'Not run',
                        stats.payrollPending ? `${stats.payrollPending} pending` : null, { tone: stats.payrollPending ? 'caution' : 'positive' })}
                </div>
            `);
        } catch (err) {
            console.error(err);
            toast.error(err.message);
        }
    }

    /* ---------------------------------------------------------------- HIRING */

    async staffFields(existing = null) {
        const branches = await listBranches();

        return [
            { name: 'name', label: 'Full name', required: true, width: 'half', value: existing?.name },
            { name: 'employeeNo', label: 'Employee number', width: 'half', value: existing?.employeeNo,
              hint: 'Must be unique. Leave blank to skip.' },
            {
                name: 'role', label: 'Role', type: 'select', required: true, width: 'half',
                value: existing?.role || 'teacher',
                options: STAFF_ROLES.map((role) => ({ value: role.value, label: role.label }))
            },
            {
                name: 'branchId', label: 'Branch', type: 'select', required: true, width: 'half',
                value: existing?.branchId || session.branch(),
                options: optionsFrom(branches, { label: (b) => b.name })
            },
            { name: 'specialisation', label: 'Specialisation', width: 'half', value: existing?.specialisation,
              placeholder: 'Nattuvangam, abhinaya' },
            { name: 'joinedOn', label: 'Joined on', type: 'date', width: 'half',
              value: existing?.joinedOn || localDate() },

            { type: 'divider', label: 'Contact' },
            { name: 'phone', label: 'Phone', type: 'tel', required: true, width: 'half', value: existing?.phone },
            { name: 'email', label: 'Email', type: 'email', width: 'half', value: existing?.email },
            { name: 'address', label: 'Address', type: 'textarea', rows: 2, value: existing?.address },

            ...(session.can('finance.view') ? [
                { type: 'divider', label: 'Pay' },
                { name: 'monthlySalary', label: 'Monthly salary', type: 'money', width: 'half',
                  value: existing?.monthlySalary,
                  hint: 'Used to prepare payroll. Leave blank for staff paid another way.' },
                { name: 'bankAccount', label: 'Bank account', width: 'half', value: existing?.bankAccount }
            ] : []),

            { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, value: existing?.notes }
        ];
    }

    async hireStaff() {
        session.require('staff.edit', 'add a staff member');
        const fields = await this.staffFields();

        const created = await formOverlay({
            title: 'Add a staff member',
            fields,
            size: 'wide',
            submitLabel: 'Add to staff',
            onSubmit: async (values) => hire(values)
        });

        if (created) {
            toast.success(`${created.name} added.`);
            await this.load();
        }
    }

    async editStaff(member) {
        const fields = await this.staffFields(member);

        const saved = await formOverlay({
            title: `Edit ${member.name}`,
            fields,
            size: 'wide',
            onSubmit: async (values) => updateStaff(member.id, values)
        });

        if (saved) {
            toast.success('Staff record updated.');
            await this.load();
        }
    }

    /* ---------------------------------------------------------------- DRAWER */

    async openStaff(id) {
        let data;
        try {
            data = await teacherDashboard(id);
        } catch (err) {
            toast.error(err.message);
            return;
        }

        const member = data.staff;

        await drawer({
            title: member.name,
            description: `${STAFF_ROLES.find((r) => r.value === member.role)?.label || member.role}`
                + `${member.specialisation ? ` · ${member.specialisation}` : ''}`,
            size: 'wide',
            content: html`
                ${data.atRisk.length ? html`
                    <div class="alert alert-warning">
                        <div class="alert-title">
                            ${data.atRisk.length} batch${data.atRisk.length === 1 ? '' : 'es'} below 75% attendance
                        </div>
                        <p class="alert-body">
                            ${data.atRisk.map((row) => `${row.batch.name} (${row.attendanceRate}%)`).join(', ')}
                        </p>
                    </div>
                ` : ''}

                <div class="grid grid-3">
                    ${kpiCard('Batches', formatNumber(data.batches.length))}
                    ${kpiCard('Students taught', formatNumber(data.studentCount))}
                    ${kpiCard('Attendance, 60 days',
                        data.attendanceRate === null ? '—' : `${data.attendanceRate}%`, null,
                        { tone: data.attendanceRate === null ? 'neutral'
                            : data.attendanceRate >= 80 ? 'positive' : 'caution' })}
                </div>

                <div class="card">
                    <div class="card-header">
                        <h3 class="card-title">Batches</h3>
                        <p class="card-subtitle">Weakest attendance first.</p>
                    </div>
                    <div class="card-body card-body-tight">
                        ${data.batches.length ? html`
                            <ul class="stack stack-sm">
                                ${[...data.batches]
                                    .sort((a, b) => (a.attendanceRate ?? 101) - (b.attendanceRate ?? 101))
                                    .map((row) => html`
                                    <li class="spread">
                                        <div>
                                            <span class="type-strong">${row.batch.name}</span>
                                            <div class="type-caption type-muted">
                                                ${formatNumber(row.enrolled)} students
                                                · ${formatNumber(row.sessionsMarked)} sessions marked
                                            </div>
                                        </div>
                                        <div class="row row-tight">
                                            ${row.attendanceRate === null
                                                ? html`<span class="type-caption type-muted">no marks</span>`
                                                : html`<span class="badge ${row.attendanceRate >= 80 ? 'badge-success'
                                                    : row.attendanceRate >= 65 ? 'badge-warning' : 'badge-danger'}">
                                                    ${row.attendanceRate}%</span>`}
                                            <button class="btn btn-sm btn-ghost"
                                                    data-batch="${row.batch.id}">Open</button>
                                        </div>
                                    </li>
                                `)}
                            </ul>
                        ` : html`<p class="type-muted">Not teaching any batch at the moment.</p>`}
                    </div>
                </div>

                <div class="card">
                    <div class="card-header"><h3 class="card-title">Week</h3></div>
                    <div class="card-body card-body-tight">
                        ${data.schedule.length ? html`
                            <ul class="stack stack-sm">
                                ${data.schedule.map((day) => html`
                                    <li>
                                        <span class="type-strong">${day.day}</span>
                                        <div class="type-caption type-muted">
                                            ${day.sessions.map((s) => `${s.startTime}–${s.endTime} ${s.name}`).join(' · ')}
                                        </div>
                                    </li>
                                `)}
                            </ul>
                        ` : html`<p class="type-muted">Nothing scheduled.</p>`}
                    </div>
                </div>

                <div class="card"><div class="card-body">
                    ${summaryList([
                        ['Employee number', member.employeeNo],
                        ['Phone', member.phone],
                        ['Email', member.email],
                        ['Joined', member.joinedOn ? formatDate(member.joinedOn) : null],
                        ['Address', member.address],
                        ['Notes', member.notes]
                    ])}
                </div></div>

                ${session.can('finance.view') && data.salaries.length ? html`
                    <div class="card">
                        <div class="card-header"><h3 class="card-title">Pay history</h3></div>
                        <div class="card-body card-body-tight">
                            <ul class="stack stack-sm">
                                ${data.salaries.map((salary) => html`
                                    <li class="spread">
                                        <span>${formatMonth(salary.period)}</span>
                                        <div class="row row-tight">
                                            <span class="type-strong">${formatMoney(salary.net)}</span>
                                            <span class="badge ${salary.status === 'paid' ? 'badge-success' : 'badge-warning'}">
                                                ${salary.status}</span>
                                        </div>
                                    </li>
                                `)}
                            </ul>
                        </div>
                    </div>
                ` : ''}
            `,
            actions: this.staffActions(member),
            onMount: (body, api) => {
                on(body, 'click', '[data-batch]', (_e, target) => {
                    api.close(null);
                    router.go(`/batches?batch=${target.dataset.batch}`);
                });
            }
        });
    }

    staffActions(member) {
        const actions = [{ label: 'Close', variant: 'secondary', value: null }];
        if (!session.can('staff.edit')) return actions;

        actions.push({
            label: member.status === 'active' ? 'Mark as left' : 'Reinstate',
            variant: member.status === 'active' ? 'danger-quiet' : 'secondary',
            onClick: async () => { await this.toggleStatus(member); return null; }
        });

        actions.push({
            label: 'Edit',
            variant: 'primary',
            primary: true,
            onClick: async () => { await this.editStaff(member); return null; }
        });

        return actions;
    }

    async toggleStatus(member) {
        try {
            if (member.status !== 'active') {
                await reactivate(member.id);
                toast.success(`${member.name} reinstated.`);
                await this.load();
                return;
            }

            const teaching = this.rows.find((row) => row.id === member.id)?.batchCount || 0;

            const done = await formOverlay({
                title: `${member.name} is leaving?`,
                variant: 'modal',
                size: 'sm',
                submitLabel: 'Mark as left',
                danger: true,
                intro: teaching
                    ? `They currently teach ${teaching} batch${teaching === 1 ? '' : 'es'}. `
                      + 'Those batches will have no teacher until someone else is assigned.'
                    : 'Their record and pay history are kept.',
                fields: [
                    { name: 'lastDay', label: 'Last working day', type: 'date', value: localDate(), width: 'half' },
                    { name: 'reason', label: 'Reason', type: 'textarea', rows: 2 }
                ],
                onSubmit: async (values) => deactivate(member.id, values)
            });

            if (done) {
                toast.success(`${member.name} marked as left.`);
                await this.load();
            }
        } catch (err) {
            toast.error(err.message);
        }
    }
}

