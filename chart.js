/**
 * NATYAM ERP 2.0 — Student management
 *
 * The roll, and everything you can do to it. This file is deliberately thin:
 * it decides what a student looks like on screen and which service call a
 * click maps to. It contains no rule about capacity, level progression, fee
 * balances or archiving — every one of those lives in students.service, and
 * the page finds out about them only by being told "no" with a sentence it can
 * show the user.
 *
 * The profile drawer is the centre of gravity. In 1.0 a student's information
 * was spread across four screens and nothing joined them, so answering "has
 * this child paid, and are they turning up?" meant three navigations and a
 * mental join. Here it is one panel with tabs, assembled by one service call.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on, initials } from '../../utils/dom.js';
import { downloadCSV } from '../../utils/csv.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { drawer, confirm } from '../../ui/overlay.js';
import { DataTable } from '../../ui/table.js';
import { formOverlay, optionsFrom, summaryList } from '../../ui/form.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { router } from '../../core/router.js';
import { formatMoney, formatNumber } from '../../utils/money.js';
import { formatDate, formatDateLong, relativeTime, localDate } from '../../utils/date.js';
import { donutChart, legend, chartPalette, kpiCard } from '../../ui/chart.js';
import { STUDENT_STATUS } from '../../config/app.config.js';

import {
    listStudents, listFilters, profile, enrol, updateStudent, assignToBatch,
    bulkAssign, promote, setStatus, archive, restore, household, contactSheet,
    levels as LEVELS
} from '../../services/students.service.js';
import { listBatches } from '../../services/batches.service.js';
import { listFeePlans, listBranches } from '../../services/settings.service.js';
import { listCurricula } from '../../services/curriculum.service.js';
import { historyOf, describe as describeAudit } from '../../services/audit.service.js';
import { requestLeave } from '../../services/attendance.service.js';

const FEE_BADGE = { clear: 'badge-success', due: 'badge-warning', overdue: 'badge-danger' };
const STATUS_BADGE = {
    active: 'badge-success',
    on_leave: 'badge-warning',
    graduated: 'badge-info',
    inactive: 'badge-neutral'
};

export default class StudentsPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Students';
        this.filters = {
            status: this.query.status || STUDENT_STATUS.ACTIVE,
            level: this.query.level || '',
            batchId: this.query.batch || '',
            filter: this.query.filter || ''
        };
        this.table = null;
        this.options = null;
    }

    async render(container) {
        this.container = container;
        render(container, this.shell());
        this.bind();

        this.options = await listFilters(session.branch());
        render(this.container.querySelector('[data-role="filters"]'), this.filterBar());

        this.buildTable();
        await this.load();

        if (this.query.new) this.newStudent();
        if (this.params.id) this.openProfile(this.params.id);
    }

    /* ------------------------------------------------------------- STRUCTURE */

    shell() {
        return html`
            <header class="page-header">
                <div class="page-header-text">
                    <h1 class="page-title">Students</h1>
                    <p class="page-subtitle" data-role="count">Loading the roll…</p>
                </div>
                <div class="page-actions">
                    <button class="btn btn-secondary btn-sm" data-action="contact-sheet">
                        ${raw(icon('download', { size: 15 }))} Contact sheet
                    </button>
                    ${session.can('student.edit') ? html`
                        <button class="btn btn-primary btn-sm" data-action="new">
                            ${raw(icon('user-plus', { size: 15 }))} Add student
                        </button>
                    ` : ''}
                </div>
            </header>
            <div class="page-body">
                <div class="filter-bar" data-role="filters"></div>
                <div data-role="table"></div>
            </div>
        `;
    }

    filterBar() {
        const chips = [
            { key: '', label: 'Everyone' },
            { key: 'unplaced', label: 'Not in a batch' },
            { key: 'overdue', label: 'Fees overdue' },
            { key: 'at-risk', label: 'At risk' }
        ];

        return html`
            <div class="row row-wrap">
                ${chips.map((chip) => html`
                    <button class="btn btn-sm ${this.filters.filter === chip.key ? 'btn-primary' : 'btn-secondary'}"
                            data-quick="${chip.key}" aria-pressed="${this.filters.filter === chip.key}">
                        ${chip.label}
                    </button>
                `)}
            </div>
            <div class="row row-wrap">
                <label class="filter-control">
                    <span class="sr-only">Status</span>
                    <select class="select select-sm" data-filter="status">
                        <option value="all" ${this.filters.status === 'all' ? 'selected' : ''}>All statuses</option>
                        ${this.options.statuses.map((option) => html`
                            <option value="${option.value}" ${this.filters.status === option.value ? 'selected' : ''}>
                                ${option.label}
                            </option>
                        `)}
                    </select>
                </label>
                <label class="filter-control">
                    <span class="sr-only">Level</span>
                    <select class="select select-sm" data-filter="level">
                        <option value="">All levels</option>
                        ${this.options.levels.map((option) => html`
                            <option value="${option.value}" ${this.filters.level === option.value ? 'selected' : ''}>
                                ${option.label}
                            </option>
                        `)}
                    </select>
                </label>
                <label class="filter-control">
                    <span class="sr-only">Batch</span>
                    <select class="select select-sm" data-filter="batchId">
                        <option value="">All batches</option>
                        ${this.options.batches.map((option) => html`
                            <option value="${option.value}" ${this.filters.batchId === option.value ? 'selected' : ''}>
                                ${option.label}
                            </option>
                        `)}
                    </select>
                </label>
                ${this.isFiltered() ? html`
                    <button class="btn btn-sm btn-link" data-action="clear-filters">Clear filters</button>
                ` : ''}
            </div>
        `;
    }

    isFiltered() {
        return Boolean(this.filters.level || this.filters.batchId || this.filters.filter
            || this.filters.status !== STUDENT_STATUS.ACTIVE);
    }

    bind() {
        this.onDispose(on(this.container, 'click', '[data-action="new"]', () => this.newStudent()));
        this.onDispose(on(this.container, 'click', '[data-action="contact-sheet"]', () => this.exportContacts()));
        // Row actions. The table suppresses row-click for anything inside a
        // button, so these never open the profile by accident.
        this.onDispose(on(this.container, 'click', '[data-student-act]', async (event, target) => {
            event.stopPropagation();
            const id = target.dataset.id;
            const act = target.dataset.studentAct;
            try {
                if (act === 'view') return await this.openProfile(id);
                const { student } = await profile(id);
                if (act === 'edit') return await this.editStudent(student);
                if (act === 'archive') return await this.archiveStudent(student);
                if (act === 'restore') return await this.profileAction('restore', student);
            } catch (err) {
                toast.error(err.message);
            }
        }));
        this.onDispose(on(this.container, 'change', '[data-filter]', (_e, target) => {
            this.filters[target.dataset.filter] = target.value;
            this.load();
        }));
        this.onDispose(on(this.container, 'click', '[data-quick]', (_e, target) => {
            this.filters.filter = target.dataset.quick;
            render(this.container.querySelector('[data-role="filters"]'), this.filterBar());
            this.load();
        }));
        this.onDispose(on(this.container, 'click', '[data-action="clear-filters"]', () => {
            this.filters = { status: STUDENT_STATUS.ACTIVE, level: '', batchId: '', filter: '' };
            render(this.container.querySelector('[data-role="filters"]'), this.filterBar());
            this.load();
        }));

        [EVENTS.STUDENT_CREATED, EVENTS.STUDENT_UPDATED, EVENTS.PAYMENT_RECORDED, EVENTS.BRANCH_CHANGED]
            .forEach((event) => this.events.on(event, () => this.load()));
    }

    /* ----------------------------------------------------------------- TABLE */

    buildTable() {
        const canEdit = session.can('student.edit');

        this.table = new DataTable({
            rows: [],
            rowId: 'id',
            searchPlaceholder: 'Search name, admission number, guardian or phone…',
            pageSize: session.prefs?.().pageSize || 25,
            selectable: canEdit,
            defaultSort: 'name',
            emptyTitle: 'No students match this view',
            emptyMessage: 'Change the filters above, or add the first student.',
            emptyIcon: 'users',
            emptyAction: canEdit ? { label: 'Add student', onClick: () => this.newStudent() } : null,
            onRowClick: (row) => this.openProfile(row.id),
            columns: [
                {
                    key: 'name',
                    label: 'Student',
                    sortable: true,
                    searchValue: (row) => `${row.name} ${row.admissionNo || ''} ${row.guardianName || ''} ${row.guardianPhone || ''}`,
                    render: (row) => html`
                        <div class="row row-tight">
                            <span class="avatar avatar-sm" data-tint="${row.tint || ''}">${initials(row.name)}</span>
                            <div>
                                <span class="type-strong">${row.name}</span>
                                <div class="type-caption type-muted">${row.admissionNo || 'no admission number'}</div>
                            </div>
                        </div>
                    `
                },
                {
                    key: 'levelLabel', label: 'Level', sortable: true,
                    sortValue: (row) => LEVELS.findIndex((l) => l.value === row.level)
                },
                {
                    key: 'batchName', label: 'Batch', sortable: true,
                    render: (row) => row.batchName
                        ? html`<span>${row.batchName}</span>`
                        : html`<span class="badge badge-warning">Not placed</span>`
                },
                {
                    key: 'guardianName', label: 'Guardian', sortable: true,
                    render: (row) => row.guardianName
                        ? html`<div>
                                   <span>${row.guardianName}</span>
                                   <div class="type-caption type-muted">${row.guardianPhone || ''}</div>
                               </div>`
                        : html`<span class="type-muted">—</span>`
                },
                {
                    key: 'outstanding', label: 'Fees', align: 'right', sortable: true,
                    exportValue: (row) => row.outstanding / 100,
                    render: (row) => html`
                        <span class="badge ${FEE_BADGE[row.feeState]}">
                            ${row.feeState === 'clear' ? 'Clear' : formatMoney(row.outstanding)}
                        </span>
                    `
                },
                {
                    key: 'status', label: 'Status', sortable: true,
                    render: (row) => html`<span class="badge ${STATUS_BADGE[row.status] || 'badge-neutral'}">
                        ${String(row.status).replace(/_/g, ' ')}</span>`
                },
                {
                    // The profile drawer still holds the full set of operations,
                    // but View / Edit / Archive were reachable only by knowing
                    // to click the row and then a second "Actions" button. The
                    // three everyday actions now sit on the row itself.
                    key: 'rowActions', label: '', align: 'right', sortable: false,
                    render: (row) => html`
                        <span class="row-actions">
                            <button class="btn btn-sm btn-ghost" data-student-act="view" data-id="${row.id}"
                                    title="View profile" aria-label="View ${row.name}">View</button>
                            ${canEdit ? html`
                                <button class="btn btn-sm btn-ghost" data-student-act="edit" data-id="${row.id}"
                                        title="Edit details" aria-label="Edit ${row.name}">Edit</button>
                                ${row.deletedAt
                                    ? html`<button class="btn btn-sm btn-ghost" data-student-act="restore" data-id="${row.id}"
                                                   title="Restore student" aria-label="Restore ${row.name}">Restore</button>`
                                    : html`<button class="btn btn-sm btn-danger-quiet" data-student-act="archive" data-id="${row.id}"
                                                   title="Archive student" aria-label="Archive ${row.name}">Archive</button>`}
                            ` : ''}
                        </span>
                    `
                }
            ],
            bulkActions: canEdit ? [
                { label: 'Assign to batch', variant: 'primary', onClick: (ids) => this.bulkAssign(ids) },
                { label: 'Export selection', variant: 'secondary', onClick: (ids) => this.exportSelection(ids) }
            ] : []
        });

        this.table.mount(this.container.querySelector('[data-role="table"]'));
        this.onDispose(() => this.table.destroy());
    }

    async load() {
        try {
            const rows = await listStudents(session.branch(), {
                status: this.filters.status,
                level: this.filters.level || null,
                batchId: this.filters.batchId || null,
                filter: this.filters.filter || null
            });

            this.rows = rows;
            this.table.setRows(rows);

            const owing = rows.filter((r) => r.outstanding > 0).length;
            render(this.container.querySelector('[data-role="count"]'), html`
                ${formatNumber(rows.length)} student${rows.length === 1 ? '' : 's'}
                ${owing ? `· ${formatNumber(owing)} with fees outstanding` : '· fees all clear'}
            `);
        } catch (err) {
            console.error(err);
            toast.error(`The roll could not be loaded — ${err.message}`);
        }
    }

    /* ------------------------------------------------------------ ADD / EDIT */

    async studentFields(existing = null) {
        const [batches, plans, curricula, branches] = await Promise.all([
            listBatches(session.branch()),
            listFeePlans(),
            listCurricula({ includeInactive: false }),
            listBranches()
        ]);

        const open = batches.filter((b) => b.status !== 'closed');

        // Every student must belong to a branch — the repository enforces it.
        // A student created against a batch inherits that batch's branch, but a
        // student without a batch had no way to supply one, so the save was
        // rejected with no field to correct. Default to the branch in view, or
        // the only branch when the school has one.
        const defaultBranchId = existing?.branchId
            || session.branch()
            || (branches.length === 1 ? branches[0].id : '');

        return [
            { name: 'name', label: 'Full name', required: true, width: 'half', value: existing?.name, autofocus: true },
            { name: 'dateOfBirth', label: 'Date of birth', type: 'date', width: 'half', value: existing?.dateOfBirth },
            {
                name: 'gender', label: 'Gender', type: 'select', width: 'half', value: existing?.gender,
                options: [
                    { value: 'female', label: 'Female' },
                    { value: 'male', label: 'Male' },
                    { value: 'other', label: 'Other' }
                ]
            },
            {
                name: 'branchId', label: 'Branch', type: 'select', required: true, width: 'half',
                value: defaultBranchId,
                options: optionsFrom(branches, { label: (b) => b.name }),
                hint: branches.length > 1 ? 'Which branch this student attends.' : null
            },
            {
                name: 'level', label: 'Level', type: 'select', required: true, width: 'half',
                value: existing?.level,
                options: LEVELS.map((l) => ({ value: l.value, label: l.label, note: `${l.years} yr` })),
                hint: 'A batch overrides this — a student always sits at their batch\u2019s level.'
            },
            {
                name: 'batchId', label: 'Batch', type: 'select', width: 'half', value: existing?.batchId,
                placeholder: 'Place later',
                options: optionsFrom(open, {
                    label: (b) => b.name,
                    note: (b) => `${b.enrolled}/${b.capacity || '∞'} · ${b.levelLabel}`,
                    disabled: (b) => Boolean(b.capacity && b.enrolled >= b.capacity)
                }),
                hint: 'A student with no batch appears on no register.'
            },
            {
                name: 'feePlanId', label: 'Fee plan', type: 'select', width: 'half', value: existing?.feePlanId,
                options: optionsFrom(plans, { label: (p) => p.name, note: (p) => `${formatMoney(p.amount)}/month` })
            },
            {
                name: 'curriculumId', label: 'Curriculum', type: 'select', width: 'half', value: existing?.curriculumId,
                placeholder: 'Assign later',
                options: optionsFrom(curricula, { label: (c) => c.name, note: (c) => c.code }),
                hint: 'The course of study. Independent of the batch — a student can follow any curriculum.'
            },
            { name: 'joinedOn', label: 'Joined on', type: 'date', width: 'half', value: existing?.joinedOn || localDate() },

            { type: 'divider', label: 'Guardian' },
            { name: 'guardianName', label: 'Guardian name', required: true, width: 'half', value: existing?.guardianName },
            {
                name: 'guardianRelation', label: 'Relationship', type: 'select', width: 'half',
                value: existing?.guardianRelation || 'Mother',
                placeholder: false,
                options: ['Mother', 'Father', 'Grandparent', 'Guardian', 'Sibling'].map((r) => ({ value: r, label: r }))
            },
            { name: 'guardianPhone', label: 'Phone', type: 'tel', required: true, width: 'half', value: existing?.guardianPhone },
            { name: 'guardianEmail', label: 'Email', type: 'email', width: 'half', value: existing?.guardianEmail },
            { name: 'alternatePhone', label: 'Emergency contact', type: 'tel', width: 'half', value: existing?.alternatePhone,
              hint: 'Called when the guardian cannot be reached.' },
            { name: 'address', label: 'Address', type: 'textarea', rows: 2, value: existing?.address },

            { type: 'divider', label: 'Health and notes' },
            { name: 'medicalNotes', label: 'Medical notes', type: 'textarea', rows: 2, value: existing?.medicalNotes,
              hint: 'Injuries, allergies, anything a teacher must know before class.' },
            { name: 'notes', label: 'Other notes', type: 'textarea', rows: 2, value: existing?.notes }
        ];
    }

    async newStudent() {
        session.require('student.edit', 'add a student');
        const list = await this.studentFields();

        const result = await formOverlay({
            title: 'Add a student',
            description: 'Enrols directly, without an application.',
            fields: list,
            size: 'wide',
            submitLabel: 'Enrol student',
            onSubmit: async (values) => enrol(values)
        });

        if (!result) return;

        toast.success(`${result.student.name} is on the roll.`);
        if (result.billing?.invoices?.length) {
            toast.info(`${result.billing.invoices.length} monthly fees raised.`);
        }
        await this.load();
        this.openProfile(result.student.id);
    }

    async editStudent(student) {
        session.require('student.edit', 'edit a student');
        const list = await this.studentFields(student);

        const saved = await formOverlay({
            title: `Edit ${student.name}`,
            fields: list,
            size: 'wide',
            onSubmit: async (values) => updateStudent(student.id, values)
        });

        if (saved) {
            toast.success('Student updated.');
            await this.load();
            this.openProfile(student.id);
        }
    }

    /* --------------------------------------------------------- BATCH MOVEMENT */

    async assign(student) {
        const batches = (await listBatches(session.branch())).filter((b) => b.status !== 'closed');

        const done = await formOverlay({
            title: `Place ${student.name}`,
            variant: 'modal',
            size: 'sm',
            submitLabel: 'Assign',
            fields: [{
                name: 'batchId', label: 'Batch', type: 'select', required: true, value: student.batchId,
                options: optionsFrom(batches, {
                    label: (b) => b.name,
                    note: (b) => `${b.levelLabel} · ${b.enrolled}/${b.capacity || '∞'} · ${b.schedule}`,
                    disabled: (b) => Boolean(b.capacity && b.enrolled >= b.capacity && b.id !== student.batchId)
                })
            }],
            onSubmit: async (values) => assignToBatch(student.id, values.batchId)
        });

        if (done) {
            toast.success('Student placed.');
            await this.load();
            this.openProfile(student.id);
        }
    }

    async bulkAssign(ids) {
        const batches = (await listBatches(session.branch())).filter((b) => b.status !== 'closed');

        const done = await formOverlay({
            title: `Place ${ids.length} students`,
            variant: 'modal',
            size: 'sm',
            submitLabel: `Assign ${ids.length}`,
            intro: 'All of them move together, or none do — a half-applied assignment is worse than none.',
            fields: [{
                name: 'batchId', label: 'Batch', type: 'select', required: true,
                options: optionsFrom(batches, {
                    label: (b) => b.name,
                    note: (b) => `${b.levelLabel} · ${b.seatsLeft ?? '∞'} seats free`
                })
            }],
            onSubmit: async (values) => bulkAssign(ids, values.batchId)
        });

        if (done) {
            toast.success(`${ids.length} students placed.`);
            await this.load();
        }
    }

    /* ------------------------------------------------------------- PROFILE */

    async openProfile(studentId) {
        let data;
        try {
            data = await profile(studentId);
        } catch (err) {
            toast.error(err.message);
            return;
        }

        const tabs = ['Overview', 'Fees', 'Attendance', 'People', 'Records', 'History'];
        let active = 'Overview';

        await drawer({
            title: data.student.name,
            description: `${data.level?.label || ''} · ${data.batch?.name || 'not placed'} · ${data.student.admissionNo || ''}`,
            size: 'wide',
            content: html`
                <div class="drawer-tabs">
                    <div class="tabs" role="tablist">
                        ${tabs.map((tab) => html`
                            <button class="tab ${tab === active ? 'is-active' : ''}" role="tab"
                                    aria-selected="${tab === active}" data-tab="${tab}">${tab}</button>
                        `)}
                    </div>
                    <div class="tab-panel" data-role="panel"></div>
                </div>
            `,
            actions: this.profileActions(data),
            onMount: (body, api) => {
                const panel = body.querySelector('[data-role="panel"]');
                const paint = () => render(panel, this.profilePanel(active, data));
                paint();

                on(body, 'click', '[data-tab]', (_e, target) => {
                    active = target.dataset.tab;
                    body.querySelectorAll('[data-tab]').forEach((node) => {
                        const on_ = node.dataset.tab === active;
                        node.classList.toggle('is-active', on_);
                        node.setAttribute('aria-selected', String(on_));
                    });
                    paint();
                });

                on(body, 'click', '[data-profile-action]', async (_e, target) => {
                    const action = target.dataset.profileAction;
                    api.close(null);
                    await this.profileAction(action, data.student);
                });
            }
        });
    }

    profileActions(data) {
        const student = data.student;
        const actions = [{ label: 'Close', variant: 'secondary', value: null }];
        if (!session.can('student.edit')) return actions;

        return [
            ...actions,
            {
                label: 'Actions',
                variant: 'primary',
                primary: true,
                onClick: async (close) => {
                    close(null);
                    await this.quickActions(student, data);
                }
            }
        ];
    }

    /** The quick-action sheet — every operation a service exposes for a student. */
    async quickActions(student, data) {
        const items = [
            { key: 'edit', label: 'Edit details', icon: 'edit' },
            { key: 'assign', label: student.batchId ? 'Move to another batch' : 'Place in a batch', icon: 'grid' },
            { key: 'collect', label: 'Collect a fee', icon: 'receipt', hide: !session.can('fee.collect') },
            { key: 'leave', label: 'Record leave', icon: 'calendar' },
            { key: 'promote', label: 'Promote a level', icon: 'trending-up' },
            { key: 'status', label: 'Change status', icon: 'toggle-left' },
            { key: 'certificate', label: 'Issue a certificate', icon: 'award' },
            student.deletedAt
                ? { key: 'restore', label: 'Restore student', icon: 'rotate-ccw' }
                : { key: 'archive', label: 'Archive student', icon: 'archive', danger: true }
        ].filter((item) => !item.hide);

        await drawer({
            title: `${student.name} — actions`,
            size: 'sm',
            content: html`
                <div class="menu">
                    ${items.map((item) => html`
                        <button class="menu-item ${item.danger ? 'menu-item-danger' : ''}"
                                data-profile-action="${item.key}">
                            ${raw(icon(item.icon, { size: 15 }))} ${item.label}
                        </button>
                    `)}
                </div>
                ${data.fees.outstanding > 0 ? html`
                    <div class="alert alert-warning mt-4">
                        <p class="alert-body">${formatMoney(data.fees.outstanding)} outstanding.
                        A student cannot be archived while they owe money.</p>
                    </div>
                ` : ''}
            `,
            actions: [{ label: 'Close', variant: 'secondary', value: null }],
            onMount: (body, api) => {
                on(body, 'click', '[data-profile-action]', async (_e, target) => {
                    api.close(null);
                    await this.profileAction(target.dataset.profileAction, student);
                });
            }
        });
    }

    async profileAction(action, student) {
        try {
            switch (action) {
                case 'edit':
                    return await this.editStudent(student);
                case 'assign':
                    return await this.assign(student);
                case 'collect':
                    return router.go(`/fees?student=${student.id}&collect=1`);
                case 'certificate':
                    return router.go(`/certificates?student=${student.id}&issue=1`);
                case 'leave':
                    return await this.recordLeave(student);
                case 'promote':
                    return await this.promoteStudent(student);
                case 'status':
                    return await this.changeStatus(student);
                case 'archive':
                    return await this.archiveStudent(student);
                case 'restore':
                    await restore(student.id);
                    toast.success(`${student.name} restored.`);
                    return await this.load();
                default:
                    return undefined;
            }
        } catch (err) {
            toast.error(err.message);
            return undefined;
        }
    }

    async recordLeave(student) {
        const done = await formOverlay({
            title: `Leave for ${student.name}`,
            variant: 'modal',
            size: 'sm',
            submitLabel: 'Request leave',
            fields: [
                { name: 'fromDate', label: 'From', type: 'date', required: true, width: 'half', value: localDate() },
                { name: 'toDate', label: 'To', type: 'date', required: true, width: 'half', value: localDate() },
                { name: 'reason', label: 'Reason', type: 'textarea', required: true, rows: 2 }
            ],
            onSubmit: async (values) => requestLeave({ studentId: student.id, ...values })
        });
        if (done) toast.success('Leave recorded. Approve it from the attendance screen.');
    }

    async promoteStudent(student) {
        const next = LEVELS[LEVELS.findIndex((l) => l.value === student.level) + 1];
        if (!next) {
            toast.info(`${student.name} is already at the highest level.`);
            return;
        }

        const ok = await confirm({
            title: `Promote to ${next.label}?`,
            message: `${student.name} moves from ${student.level} to ${next.label}. `
                + 'They will be removed from their current batch and must be placed again.',
            confirmLabel: `Promote to ${next.label}`
        });
        if (!ok) return;

        await promote(student.id, {});
        toast.success(`${student.name} promoted to ${next.label}. Place them in a batch next.`);
        await this.load();
    }

    async changeStatus(student) {
        const done = await formOverlay({
            title: `Status of ${student.name}`,
            variant: 'modal',
            size: 'sm',
            submitLabel: 'Update status',
            fields: [
                {
                    name: 'status', label: 'Status', type: 'radio', required: true, value: student.status,
                    options: Object.values(STUDENT_STATUS).map((value) => ({
                        value, label: value.replace(/_/g, ' ')
                    }))
                },
                { name: 'reason', label: 'Reason', type: 'textarea', rows: 2,
                  hint: 'Stored against the record so the change can be explained later.' }
            ],
            onSubmit: async (values) => setStatus(student.id, values.status, { reason: values.reason })
        });

        if (done) {
            toast.success('Status updated.');
            await this.load();
        }
    }

    async archiveStudent(student) {
        const ok = await confirm({
            title: `Archive ${student.name}?`,
            message: 'They leave the roll and every register, but the record, fee history and '
                + 'certificates are kept. This can be undone.',
            confirmLabel: 'Archive student',
            danger: true
        });
        if (!ok) return;

        await archive(student.id);
        toast.success(`${student.name} archived.`);
        await this.load();
    }

    /* ------------------------------------------------------- PROFILE PANELS */

    profilePanel(tab, data) {
        switch (tab) {
            case 'Fees': return this.feesPanel(data);
            case 'Attendance': return this.attendancePanel(data);
            case 'People': return this.peoplePanel(data);
            case 'Records': return this.recordsPanel(data);
            case 'History': return this.historyPanel(data);
            default: return this.overviewPanel(data);
        }
    }

    overviewPanel(data) {
        const s = data.student;

        return html`
            <div class="grid grid-3">
                ${kpiCard('Attendance, 90 days', data.attendance.recentRate === null ? '—' : `${data.attendance.recentRate}%`)}
                ${kpiCard('Fees outstanding', formatMoney(data.fees.outstanding))}
                ${kpiCard('With the school', `${Math.floor(data.tenureDays / 30)} months`)}
            </div>

            ${!s.batchId ? html`
                <div class="alert alert-warning">
                    <div class="alert-title">Not in a batch</div>
                    <p class="alert-body">${s.name} appears on no register and will be marked absent nowhere.</p>
                    <button class="btn btn-sm btn-primary" data-profile-action="assign">Place in a batch</button>
                </div>
            ` : ''}

            ${s.medicalNotes ? html`
                <div class="alert alert-info">
                    <div class="alert-title">Medical note</div>
                    <p class="alert-body">${s.medicalNotes}</p>
                </div>
            ` : ''}

            <div class="card"><div class="card-body">
                ${summaryList([
                    ['Admission number', s.admissionNo],
                    ['Level', data.level?.label],
                    ['Batch', data.batch ? `${data.batch.name}` : 'Not placed'],
                    ['Curriculum', data.curriculum ? data.curriculum.name : 'Not assigned'],
                    ['Status', String(s.status).replace(/_/g, ' ')],
                    ['Joined', s.joinedOn ? formatDateLong(s.joinedOn) : null],
                    ['Date of birth', s.dateOfBirth ? `${formatDate(s.dateOfBirth)} (${data.age})` : null],
                    ['Gender', s.gender],
                    ['Address', s.address]
                ])}
            </div></div>

            ${data.timeline.length ? html`
                <div class="card">
                    <div class="card-header"><h3 class="card-title">Timeline</h3></div>
                    <div class="card-body card-body-tight">
                        <ul class="timeline">
                            ${data.timeline.slice(0, 15).map((event) => html`
                                <li class="timeline-item">
                                    <span class="timeline-dot"></span>
                                    <div class="timeline-content">
                                        <div class="timeline-title">${event.title}</div>
                                        <div class="timeline-meta">
                                            ${formatDate(event.at)}
                                            ${event.detail ? `· ${event.detail}` : ''}
                                            ${event.amount ? `· ${formatMoney(event.amount)}` : ''}
                                        </div>
                                    </div>
                                </li>
                            `)}
                        </ul>
                    </div>
                </div>
            ` : ''}
        `;
    }

    feesPanel(data) {
        const fees = data.fees;

        return html`
            <div class="grid grid-3">
                ${kpiCard('Billed', formatMoney(fees.billed))}
                ${kpiCard('Collected', formatMoney(fees.collected))}
                ${kpiCard('Outstanding', formatMoney(fees.outstanding), fees.overdue ? 'includes overdue' : null)}
            </div>

            ${fees.overdue > 0 ? html`
                <div class="alert alert-danger">
                    <p class="alert-body">${formatMoney(fees.overdue)} is past its due date${
                        fees.oldestDue ? `, the oldest since ${formatDate(fees.oldestDue)}` : ''}.</p>
                    ${session.can('fee.collect') ? html`
                        <button class="btn btn-sm btn-primary" data-profile-action="collect">Collect now</button>
                    ` : ''}
                </div>
            ` : ''}

            <div class="card">
                <div class="card-header"><h3 class="card-title">Invoices</h3></div>
                <div class="card-body card-body-flush">
                    ${fees.invoices.length ? html`
                        <div class="table-wrap"><table class="table">
                            <thead><tr>
                                <th scope="col">Invoice</th><th scope="col">Due</th>
                                <th scope="col" class="text-right">Amount</th>
                                <th scope="col" class="text-right">Balance</th>
                                <th scope="col">Status</th>
                            </tr></thead>
                            <tbody>
                                ${fees.invoices.map((invoice) => html`
                                    <tr>
                                        <th scope="row">${invoice.number}
                                            <div class="type-caption type-muted">${invoice.description || ''}</div></th>
                                        <td>${formatDate(invoice.dueDate)}</td>
                                        <td class="text-right">${formatMoney(invoice.amount)}</td>
                                        <td class="text-right">${formatMoney(invoice.balance)}</td>
                                        <td><span class="badge badge-${invoice.status === 'paid' ? 'success'
                                            : invoice.status === 'overdue' ? 'danger'
                                            : invoice.status === 'partial' ? 'warning' : 'neutral'}">${invoice.status}</span></td>
                                    </tr>
                                `)}
                            </tbody>
                        </table></div>
                    ` : html`<div class="empty empty-compact"><p class="empty-text">Nothing billed yet.</p></div>`}
                </div>
            </div>

            <div class="card">
                <div class="card-header"><h3 class="card-title">Receipts</h3></div>
                <div class="card-body card-body-tight">
                    ${fees.receipts.length ? html`
                        <ul class="stack stack-sm">
                            ${fees.receipts.map((receipt) => html`
                                <li class="spread">
                                    <div>
                                        <span class="type-strong">${receipt.receiptNo}</span>
                                        <div class="type-caption type-muted">
                                            ${formatDate(receipt.paidOn)} · ${receipt.mode}
                                            ${receipt.status === 'refunded' ? '· refunded' : ''}
                                        </div>
                                    </div>
                                    <span class="type-strong">${formatMoney(receipt.amount)}</span>
                                </li>
                            `)}
                        </ul>
                    ` : html`<p class="empty-text">No payments received yet.</p>`}
                </div>
            </div>
        `;
    }

    attendancePanel(data) {
        const attendance = data.attendance;
        const slices = Object.entries(attendance.breakdown || {})
            .filter(([, count]) => count > 0)
            .map(([label, value]) => ({ label, value }));

        return html`
            <div class="grid grid-3">
                ${kpiCard('All time', attendance.rate === null ? '—' : `${attendance.rate}%`)}
                ${kpiCard('Last 90 days', attendance.recentRate === null ? '—' : `${attendance.recentRate}%`)}
                ${kpiCard('Last seen', attendance.lastSeen ? formatDate(attendance.lastSeen) : '—')}
            </div>

            ${slices.length ? html`
                <div class="card"><div class="card-body">
                    <div class="row row-wrap">
                        ${raw(donutChart(slices, {
                            size: 150,
                            centreValue: `${attendance.rate ?? 0}%`,
                            centreLabel: 'present',
                            title: 'Attendance breakdown'
                        }))}
                        ${raw(legend(slices.map((slice, index) => ({
                            label: `${slice.label} — ${formatNumber(slice.value)}`,
                            color: chartPalette[index % chartPalette.length]
                        }))))}
                    </div>
                </div></div>
            ` : html`<div class="empty empty-compact"><p class="empty-text">No attendance marked yet.</p></div>`}

            ${attendance.rows.length ? html`
                <div class="card">
                    <div class="card-header"><h3 class="card-title">Recent marks</h3></div>
                    <div class="card-body card-body-tight">
                        <ul class="stack stack-sm">
                            ${attendance.rows.slice(0, 20).map((row) => html`
                                <li class="spread">
                                    <span>${formatDate(row.date)}</span>
                                    <span class="badge badge-${row.status === 'present' ? 'success'
                                        : row.status === 'absent' ? 'danger'
                                        : row.status === 'late' ? 'warning' : 'neutral'}">${row.status}</span>
                                </li>
                            `)}
                        </ul>
                    </div>
                </div>
            ` : ''}
        `;
    }

    peoplePanel(data) {
        const guardian = data.guardian;
        const s = data.student;

        return html`
            <div class="card">
                <div class="card-header"><h3 class="card-title">Guardian</h3></div>
                <div class="card-body">
                    ${summaryList([
                        ['Name', guardian.name],
                        ['Relationship', guardian.relation],
                        ['Phone', guardian.phone],
                        ['Email', guardian.email],
                        ['Emergency contact', s.alternatePhone],
                        ['Address', s.address]
                    ])}
                    ${guardian.phone ? html`
                        <div class="row row-wrap mt-4">
                            <a class="btn btn-sm btn-secondary" href="tel:${guardian.phone}">
                                ${raw(icon('phone', { size: 14 }))} Call
                            </a>
                            ${guardian.email ? html`
                                <a class="btn btn-sm btn-secondary" href="mailto:${guardian.email}">
                                    ${raw(icon('mail', { size: 14 }))} Email
                                </a>
                            ` : ''}
                        </div>
                    ` : ''}
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Medical and emergency</h3>
                </div>
                <div class="card-body">
                    ${s.medicalNotes
                        ? html`<p class="type-body">${s.medicalNotes}</p>`
                        : html`<p class="type-muted">Nothing recorded. A teacher would see no warning before class.</p>`}
                </div>
            </div>

            <div class="card" data-role="household">
                <div class="card-header"><h3 class="card-title">Household</h3></div>
                <div class="card-body card-body-tight" data-role="household-body">
                    <p class="type-muted">Looking for siblings…</p>
                </div>
            </div>
            ${raw(this.loadHousehold(s.id))}
        `;
    }

    /**
     * Siblings are found by the service, not here — matching guardians is a
     * rule about what a household *is*, and two pages guessing at it would
     * eventually disagree.
     */
    loadHousehold(studentId) {
        queueMicrotask(async () => {
            const slot = document.querySelector('[data-role="household-body"]');
            if (!slot) return;
            try {
                const home = await household(studentId);
                const siblings = home.members.filter((member) => member.id !== studentId);
                render(slot, siblings.length ? html`
                    <ul class="stack stack-sm">
                        ${siblings.map((sibling) => html`
                            <li class="spread">
                                <div>
                                    <span class="type-strong">${sibling.name}</span>
                                    <div class="type-caption type-muted">${sibling.level} · ${sibling.status}</div>
                                </div>
                                <button class="btn btn-sm btn-ghost" data-sibling="${sibling.id}">Open</button>
                            </li>
                        `)}
                    </ul>
                ` : html`<p class="type-muted">No siblings on the roll.</p>`);

                on(slot, 'click', '[data-sibling]', (_e, target) => this.openProfile(target.dataset.sibling));
            } catch {
                render(slot, html`<p class="type-muted">Household could not be checked.</p>`);
            }
        });
        return '';
    }

    recordsPanel(data) {
        return html`
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Certificates</h3>
                    ${session.can('certificate.issue') ? html`
                        <div class="card-actions">
                            <button class="btn btn-sm btn-secondary" data-profile-action="certificate">Issue</button>
                        </div>
                    ` : ''}
                </div>
                <div class="card-body card-body-tight">
                    ${data.certificates.length ? html`
                        <ul class="stack stack-sm">
                            ${data.certificates.map((certificate) => html`
                                <li class="spread">
                                    <div>
                                        <span class="type-strong">${certificate.title}</span>
                                        <div class="type-caption type-muted">
                                            ${certificate.serial} · ${formatDate(certificate.issuedOn)}
                                        </div>
                                    </div>
                                    <span class="badge ${certificate.status === 'revoked' ? 'badge-danger' : 'badge-success'}">
                                        ${certificate.status || 'issued'}
                                    </span>
                                </li>
                            `)}
                        </ul>
                    ` : html`<p class="type-muted">None issued.</p>`}
                </div>
            </div>

            <div class="card">
                <div class="card-header"><h3 class="card-title">Programmes</h3></div>
                <div class="card-body card-body-tight">
                    ${data.programs.length ? html`
                        <ul class="stack stack-sm">
                            ${data.programs.map((program) => html`
                                <li class="spread">
                                    <div>
                                        <span class="type-strong">${program.name}</span>
                                        <div class="type-caption type-muted">
                                            ${formatDate(program.date)} · ${program.type}
                                        </div>
                                    </div>
                                    <span class="badge badge-neutral">${program.status}</span>
                                </li>
                            `)}
                        </ul>
                    ` : html`<p class="type-muted">Has not taken part in a programme yet.</p>`}
                </div>
            </div>

            <div class="card">
                <div class="card-header"><h3 class="card-title">Documents</h3></div>
                <div class="card-body card-body-tight">
                    ${data.documents.length ? html`
                        <ul class="stack stack-sm">
                            ${data.documents.map((document_) => html`
                                <li class="spread">
                                    <span>${document_.name}</span>
                                    <span class="type-caption type-muted">${formatDate(document_.createdAt)}</span>
                                </li>
                            `)}
                        </ul>
                    ` : html`<p class="type-muted">No documents attached.</p>`}
                </div>
            </div>
        `;
    }

    historyPanel(data) {
        return html`
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Change history</h3>
                    <p class="card-subtitle">Who changed this record, and when.</p>
                </div>
                <div class="card-body card-body-tight" data-role="audit-body">
                    <p class="type-muted">Reading the audit log…</p>
                </div>
            </div>
            ${raw(this.loadHistory(data.student.id))}
        `;
    }

    loadHistory(studentId) {
        queueMicrotask(async () => {
            const slot = document.querySelector('[data-role="audit-body"]');
            if (!slot) return;
            try {
                const entries = await historyOf('students', studentId);
                render(slot, entries.length ? html`
                    <ul class="timeline">
                        ${entries.map((entry) => html`
                            <li class="timeline-item">
                                <span class="timeline-dot"></span>
                                <div class="timeline-content">
                                    <div class="timeline-title">${entry.summary || describeAudit(entry)}</div>
                                    <div class="timeline-meta">
                                        ${entry.actorName || 'System'} · ${relativeTime(entry.at || entry.createdAt)}
                                    </div>
                                </div>
                            </li>
                        `)}
                    </ul>
                ` : html`<p class="type-muted">Nothing recorded against this student yet.</p>`);
            } catch {
                render(slot, html`<p class="type-muted">You do not have access to the audit log.</p>`);
            }
        });
        return '';
    }

    /* ---------------------------------------------------------------- EXPORT */

    async exportContacts() {
        try {
            const rows = await contactSheet({
                batchId: this.filters.batchId || null,
                branchId: session.branch()
            });
            downloadCSV(`natyam-contacts-${localDate()}`, rows);
            toast.success(`${rows.length} contacts exported.`);
        } catch (err) {
            toast.error(err.message);
        }
    }

    exportSelection(ids) {
        const chosen = this.rows.filter((row) => ids.includes(row.id));
        downloadCSV(`natyam-students-${localDate()}`, chosen.map((row) => ({
            'Admission no': row.admissionNo,
            Name: row.name,
            Level: row.levelLabel,
            Batch: row.batchName || '',
            Guardian: row.guardianName || '',
            Phone: row.guardianPhone || '',
            Outstanding: row.outstanding / 100,
            Status: row.status
        })));
        toast.success(`${chosen.length} students exported.`);
    }
}

/* ------------------------------------------------------------------ HELPERS */




