/**
 * NATYAM ERP 2.0 — Settings
 *
 * Everything that configures the system rather than records what it did:
 * the institute, its branches and academic years, fee plans, who may sign in
 * and what each role can do, this browser's preferences, the audit log, and
 * the data itself.
 *
 * These are separate tabs rather than separate routes because they are all
 * rare, administrative, and mostly performed in one sitting when the school is
 * set up. Nine sidebar entries for tasks done twice a year would crowd out the
 * ones done twice an hour.
 *
 * Two tabs deserve a note. **Roles** is read-only: capabilities are declared in
 * app.config and a role editor would let an owner lock themselves out of their
 * own database with no server to appeal to. **Data** is where the honest
 * warning lives — this app's records exist in one browser on one machine, and
 * a user who does not understand that will not take backups until the day they
 * need one.
 */

import { Page } from '../../core/router.js';
import { kpiCard } from '../../ui/chart.js';
import { html, render, raw, on } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { drawer, confirm, confirmTyped } from '../../ui/overlay.js';
import { formOverlay, optionsFrom, summaryList, filterSelect, filterDate } from '../../ui/form.js';
import { downloadCSV } from '../../utils/csv.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { formatMoney, formatNumber } from '../../utils/money.js';
import { formatDate, formatDateTime, relativeTime, localDate } from '../../utils/date.js';
import { PROGRAM_TYPES, EXPENSE_CATEGORIES, STORE_NAMES, curriculum, levelLabel, roleTable, roleLabel, exposedFeeFrequencies, DEFAULT_FEE_FREQUENCY } from '../../config/app.config.js';

import {
    institute, updateInstitute, listBranches, createBranch, updateBranch, closeBranch,
    listAcademicYears, createAcademicYear, setCurrentYear,
    listFeePlans, createFeePlan, updateFeePlan, deleteFeePlan,
    listUsers, createUser, updateUser, deactivateUser,
    roleMatrix, preferences, setPreference, storageStatus, requestPersistence
} from '../../services/settings.service.js';
import { search as searchAudit, describe as describeAudit, filterOptions, activitySummary } from '../../services/audit.service.js';
import { backupStatus, downloadBackup, inspectBackup, restore, exportStore, resetEverything } from '../../services/backup.service.js';
import { IMPORTERS, readFile, dryRun, commit } from '../../services/import.service.js';

const TABS = [
    { key: 'institute', label: 'Institute' },
    { key: 'branches', label: 'Branches' },
    { key: 'fees', label: 'Fee plans' },
    { key: 'curriculum', label: 'Curriculum' },
    { key: 'users', label: 'Users' },
    { key: 'roles', label: 'Roles' },
    { key: 'preferences', label: 'Preferences' },
    { key: 'audit', label: 'Audit log' },
    { key: 'data', label: 'Data' }
];

export default class SettingsPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Settings';
        this.tab = this.query.tab || 'institute';
        this.auditFilters = { entity: '', action: '', from: '', to: '' };
    }

    async render(container) {
        this.container = container;
        session.require('settings.view', 'open settings');

        render(container, this.shell());
        this.bind();
        await this.paint();
    }

    shell() {
        return html`
            <header class="page-header">
                <div class="page-header-text">
                    <h1 class="page-title">Settings</h1>
                    <p class="page-subtitle">How this school and this copy of the system are configured.</p>
                </div>
            </header>
            <div class="page-body">
                <div class="tabs tabs-scroll" role="tablist">
                    ${TABS.map((tab) => html`
                        <button class="tab ${tab.key === this.tab ? 'is-active' : ''}" role="tab"
                                aria-selected="${tab.key === this.tab}" data-tab="${tab.key}">${tab.label}</button>
                    `)}
                </div>
                <div data-role="panel"></div>
            </div>
        `;
    }

    bind() {
        this.onDispose(on(this.container, 'click', '[data-tab]', (_e, target) => {
            this.tab = target.dataset.tab;
            this.container.querySelectorAll('[data-tab]').forEach((node) => {
                const active = node.dataset.tab === this.tab;
                node.classList.toggle('is-active', active);
                node.setAttribute('aria-selected', String(active));
            });
            this.paint();
        }));

        this.onDispose(on(this.container, 'click', '[data-do]', (event, target) => {
            event.preventDefault();
            this.dispatch(target.dataset.do, target.dataset);
        }));

        this.events.on(EVENTS.BRANCH_CHANGED, () => this.paint());
    }

    async paint() {
        const panel = this.container.querySelector('[data-role="panel"]');
        render(panel, html`<div class="skeleton skeleton-row"></div>`);

        const builders = {
            institute: () => this.institutePanel(),
            branches: () => this.branchesPanel(),
            fees: () => this.feesPanel(),
            curriculum: () => this.curriculumPanel(),
            users: () => this.usersPanel(),
            roles: () => this.rolesPanel(),
            preferences: () => this.preferencesPanel(),
            audit: () => this.auditPanel(),
            data: () => this.dataPanel()
        };

        try {
            render(panel, await (builders[this.tab] || builders.institute)());
        } catch (err) {
            console.error(err);
            render(panel, html`
                <div class="alert alert-danger">
                    <div class="alert-title">This section could not be loaded</div>
                    <p class="alert-body">${err.message}</p>
                </div>
            `);
        }
    }

    /** One dispatcher rather than a listener per button — the tabs re-render constantly. */
    async dispatch(action, dataset) {
        const handlers = {
            'edit-institute': () => this.editInstitute(),
            'new-branch': () => this.editBranch(null),
            'edit-branch': () => this.editBranch(dataset.id),
            'close-branch': () => this.closeBranchFlow(dataset.id),
            'new-year': () => this.newYear(),
            'set-year': () => this.setYear(dataset.id),
            'new-plan': () => this.editPlan(null),
            'edit-plan': () => this.editPlan(dataset.id),
            'delete-plan': () => this.deletePlan(dataset.id),
            'new-user': () => this.editUser(null),
            'edit-user': () => this.editUser(dataset.id),
            'deactivate-user': () => this.deactivateUserFlow(dataset.id),
            'run-audit': () => this.paint(),
            'export-audit': () => this.exportAudit(),
            backup: () => this.takeBackup(),
            restore: () => this.restoreFlow(),
            'export-store': () => this.exportStoreFlow(),
            import: () => this.importFlow(),
            persist: () => this.persist(),
            reset: () => this.resetFlow()
        };

        try {
            await handlers[action]?.();
        } catch (err) {
            toast.error(err.message);
        }
    }

    /* ------------------------------------------------------------- INSTITUTE */

    async institutePanel() {
        const [org, years] = await Promise.all([institute(), listAcademicYears()]);
        const current = years.find((y) => y.isCurrent) || years[0] || null;

        return html`
            <div class="card">
                <div class="card-header">
                    <h2 class="card-title">${org.name || 'NATYAM — School of Kuchipudi'}</h2>
                    <p class="card-subtitle">Printed on every receipt, certificate and report.</p>
                    ${session.can('settings.edit') ? html`
                        <div class="card-actions">
                            <button class="btn btn-sm btn-primary" data-do="edit-institute">Edit</button>
                        </div>
                    ` : ''}
                </div>
                <div class="card-body">
                    ${summaryList([
                        ['Name', org.name],
                        ['Registered name', org.legalName],
                        ['Address', org.address],
                        ['Phone', org.phone],
                        ['Email', org.email],
                        ['Website', org.website],
                        ['Principal', org.principal],
                        ['Founded', org.foundedOn ? formatDate(org.foundedOn) : null],
                        ['Registration', org.registrationNo],
                        ['Tax number', org.taxNo]
                    ])}
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h2 class="card-title">Current academic year</h2>
                    <p class="card-subtitle">
                        The dance year runs June to May. Past years are kept for reporting.
                    </p>
                    ${session.can('settings.edit') ? html`
                        <div class="card-actions">
                            <button class="btn btn-sm" data-do="new-year">Add a year</button>
                        </div>
                    ` : ''}
                </div>
                <div class="card-body">
                    ${current ? html`
                        <p class="type-lg type-strong">${current.label}</p>
                        <p class="type-caption type-muted">
                            ${formatDate(current.startsOn)} — ${formatDate(current.endsOn)}
                        </p>
                        ${years.length > 1 && session.can('settings.edit') ? html`
                            <div class="row row-wrap" style="margin-top: var(--space-3); gap: var(--space-2);">
                                ${years.filter((y) => !y.isCurrent).map((year) => html`
                                    <button class="btn btn-sm btn-ghost" data-do="set-year" data-id="${year.id}">
                                        Switch to ${year.label}
                                    </button>
                                `)}
                            </div>
                        ` : ''}
                    ` : html`<p class="type-caption type-muted">No academic year set.</p>`}
                </div>
            </div>
        `;
    }

    async editInstitute() {
        const org = await institute();

        const saved = await formOverlay({
            title: 'Institute details',
            size: 'wide',
            fields: [
                { name: 'name', label: 'Name', required: true, width: 'half', value: org.name },
                { name: 'legalName', label: 'Registered name', width: 'half', value: org.legalName },
                { name: 'address', label: 'Address', type: 'textarea', rows: 2, value: org.address },
                { name: 'phone', label: 'Phone', type: 'tel', width: 'half', value: org.phone },
                { name: 'email', label: 'Email', type: 'email', width: 'half', value: org.email },
                { name: 'website', label: 'Website', width: 'half', value: org.website },
                { name: 'principal', label: 'Principal', width: 'half', value: org.principal,
                  hint: 'Signs certificates unless another signatory is chosen.' },
                { name: 'foundedOn', label: 'Founded', type: 'date', width: 'half', value: org.foundedOn },
                { name: 'registrationNo', label: 'Registration number', width: 'half', value: org.registrationNo },
                { name: 'taxNo', label: 'Tax number', width: 'half', value: org.taxNo }
            ],
            onSubmit: async (values) => updateInstitute(values)
        });

        if (saved) {
            toast.success('Institute details updated.');
            await this.paint();
        }
    }

    /* -------------------------------------------------------------- BRANCHES */

    async branchesPanel() {
        const branches = await listBranches({ includeInactive: true });

        return html`
            <div class="card">
                <div class="card-header">
                    <h2 class="card-title">Branches</h2>
                    <p class="card-subtitle">
                        ${formatNumber(branches.filter((b) => b.status === 'active').length)} open
                        of ${formatNumber(branches.length)}.
                    </p>
                    ${session.can('settings.edit') ? html`
                        <div class="card-actions">
                            <button class="btn btn-sm btn-primary" data-do="new-branch">New branch</button>
                        </div>
                    ` : ''}
                </div>
                <div class="card-body card-body-flush">
                    <div class="table-wrap"><table class="table">
                        <thead><tr>
                            <th scope="col">Branch</th><th scope="col">Code</th>
                            <th scope="col">Address</th><th scope="col">Phone</th>
                            <th scope="col">Status</th><th scope="col"></th>
                        </tr></thead>
                        <tbody>
                            ${branches.map((branch) => html`
                                <tr>
                                    <th scope="row">${branch.name}</th>
                                    <td>${branch.code || '—'}</td>
                                    <td class="type-caption">${branch.address || '—'}</td>
                                    <td>${branch.phone || '—'}</td>
                                    <td><span class="badge ${branch.status === 'active' ? 'badge-success' : 'badge-neutral'}">
                                        ${branch.status}</span></td>
                                    <td class="text-right">
                                        ${session.can('settings.edit') ? html`
                                            <div class="row row-tight">
                                                <button class="btn btn-sm btn-ghost"
                                                        data-do="edit-branch" data-id="${branch.id}">Edit</button>
                                                ${branch.status === 'active' ? html`
                                                    <button class="btn btn-sm btn-danger-quiet"
                                                            data-do="close-branch" data-id="${branch.id}">Close</button>
                                                ` : ''}
                                            </div>
                                        ` : ''}
                                    </td>
                                </tr>
                            `)}
                        </tbody>
                    </table></div>
                </div>
            </div>
        `;
    }

    async editBranch(id) {
        const branches = await listBranches({ includeInactive: true });
        const branch = id ? branches.find((b) => b.id === id) : null;

        const saved = await formOverlay({
            title: branch ? `Edit ${branch.name}` : 'New branch',
            fields: [
                { name: 'name', label: 'Name', required: true, width: 'half', value: branch?.name },
                { name: 'code', label: 'Code', width: 'half', value: branch?.code, placeholder: 'HYD-C',
                  hint: 'Used as a prefix on admission numbers.' },
                { name: 'address', label: 'Address', type: 'textarea', rows: 2, value: branch?.address },
                { name: 'phone', label: 'Phone', type: 'tel', width: 'half', value: branch?.phone },
                { name: 'email', label: 'Email', type: 'email', width: 'half', value: branch?.email },
                { name: 'openedOn', label: 'Opened', type: 'date', width: 'half',
                  value: branch?.openedOn || localDate() }
            ],
            onSubmit: async (values) => (branch ? updateBranch(branch.id, values) : createBranch(values))
        });

        if (saved) {
            toast.success(branch ? 'Branch updated.' : 'Branch created.');
            await this.paint();
        }
    }

    async closeBranchFlow(id) {
        const done = await formOverlay({
            title: 'Close this branch?',
            variant: 'modal',
            size: 'sm',
            submitLabel: 'Close branch',
            danger: true,
            intro: 'Its students, batches and history are kept. It stops appearing as a choice for new records.',
            fields: [{ name: 'reason', label: 'Reason', type: 'textarea', rows: 2, required: true }],
            onSubmit: async (values) => closeBranch(id, { reason: values.reason })
        });

        if (done) {
            toast.success('Branch closed.');
            await this.paint();
        }
    }

    /* ----------------------------------------------------------------- YEARS */

    async newYear() {
        const saved = await formOverlay({
            title: 'Add an academic year',
            variant: 'modal',
            size: 'sm',
            fields: [
                { name: 'label', label: 'Name', required: true, placeholder: '2026–27' },
                { name: 'startsOn', label: 'Starts', type: 'date', required: true, width: 'half' },
                { name: 'endsOn', label: 'Ends', type: 'date', required: true, width: 'half' },
                { name: 'makeCurrent', label: 'Make this the current year', type: 'switch' }
            ],
            onSubmit: async (values) => createAcademicYear(values)
        });

        if (saved) {
            toast.success('Academic year added.');
            await this.paint();
        }
    }

    async setYear(id) {
        await setCurrentYear(id);
        toast.success('Current academic year changed.');
        await this.paint();
    }

    /* ------------------------------------------------------------- FEE PLANS */

    async feesPanel() {
        const plans = await listFeePlans({ includeInactive: true });

        return html`
            <div class="card">
                <div class="card-header">
                    <h2 class="card-title">Fee plans</h2>
                    <p class="card-subtitle">
                        What each student pays a month. Changing a plan
                        does not alter invoices already raised — a bill the family has already been
                        given does not change because the price list did.
                    </p>
                    ${session.can('settings.edit') ? html`
                        <div class="card-actions">
                            <button class="btn btn-sm btn-primary" data-do="new-plan">New plan</button>
                        </div>
                    ` : ''}
                </div>
                <div class="card-body card-body-flush">
                    <div class="table-wrap"><table class="table">
                        <thead><tr>
                            <th scope="col">Plan</th>
                            <th scope="col" class="text-right">Monthly fee</th>
                            <th scope="col" class="text-right">Year total</th>
                            <th scope="col">Status</th><th scope="col"></th>
                        </tr></thead>
                        <tbody>
                            ${plans.map((plan) => html`
                                <tr>
                                    <th scope="row">${plan.name}</th>
                                    <td class="text-right type-strong">${formatMoney(plan.amount)}</td>
                                    <td class="text-right type-muted">${formatMoney(plan.yearlyTotal)}</td>
                                    <td><span class="badge ${plan.status === 'active' ? 'badge-success' : 'badge-neutral'}">
                                        ${plan.status || 'active'}</span></td>
                                    <td class="text-right">
                                        ${session.can('settings.edit') ? html`
                                            <div class="row row-tight">
                                                <button class="btn btn-sm btn-ghost"
                                                        data-do="edit-plan" data-id="${plan.id}">Edit</button>
                                                <button class="btn btn-sm btn-danger-quiet"
                                                        data-do="delete-plan" data-id="${plan.id}">Delete</button>
                                            </div>
                                        ` : ''}
                                    </td>
                                </tr>
                            `)}
                        </tbody>
                    </table></div>
                </div>
            </div>
        `;
    }

    async editPlan(id) {
        const plans = await listFeePlans({ includeInactive: true });
        const plan = id ? plans.find((p) => p.id === id) : null;

        const saved = await formOverlay({
            title: plan ? `Edit ${plan.name}` : 'New fee plan',
            fields: [
                { name: 'name', label: 'Name', required: true, value: plan?.name,
                  placeholder: 'Foundation — monthly' },
                { name: 'amount', label: 'Monthly fee', type: 'money', required: true,
                  width: 'half', value: plan?.amount,
                  hint: 'Collected every month of the academic year.' },
                // NATYAM collects monthly, so with a single exposed frequency
                // there is nothing to choose and no field is shown. Marking
                // another frequency `exposed` in the config surfaces this
                // automatically — no change needed here.
                ...(exposedFeeFrequencies().length > 1 ? [{
                    name: 'frequency', label: 'Billing frequency', type: 'select', required: true,
                    width: 'half', value: plan?.frequency || DEFAULT_FEE_FREQUENCY,
                    options: exposedFeeFrequencies().map((f) => ({ value: f.value, label: f.label }))
                }] : []),
                { name: 'description', label: 'Notes', type: 'textarea', rows: 2,
                  value: plan?.description }
            ],
            onSubmit: async (values) => (plan ? updateFeePlan(plan.id, values) : createFeePlan(values))
        });

        if (saved) {
            toast.success(plan ? 'Fee plan updated.' : 'Fee plan created.');
            await this.paint();
        }
    }

    async deletePlan(id) {
        const ok = await confirm({
            title: 'Delete this fee plan?',
            message: 'The plan is removed for good. Students already billed keep their existing '
                + 'invoices, but the plan can no longer be assigned to anyone.',
            confirmLabel: 'Delete plan',
            danger: true
        });
        if (!ok) return;

        await deleteFeePlan(id);
        toast.success('Fee plan deleted.');
        await this.paint();
    }

    /* ------------------------------------------------------------ CURRICULUM */

    /**
     * Levels, programme types and expense categories are declared in
     * app.config rather than stored as records. They are shown here because
     * people reasonably look for them, and shown read-only because they are
     * referenced by value throughout the data: renaming "prarambhika" at
     * runtime would orphan every student, batch and certificate holding it.
     */
    curriculumPanel() {
        return html`
            <div class="alert alert-info">
                <div class="alert-title">These are fixed by the system</div>
                <p class="alert-body">
                    Levels and categories are referenced by every student, batch and certificate.
                    Changing one at runtime would orphan those records, so they are set in the
                    application rather than edited here. Ask for a new release if the curriculum changes.
                </p>
            </div>

            <div class="card">
                <div class="card-header">
                    <h2 class="card-title">Dance levels</h2>
                    <p class="card-subtitle">The Kuchipudi progression, in order.</p>
                </div>
                <div class="card-body card-body-flush">
                    <div class="table-wrap"><table class="table">
                        <thead><tr>
                            <th scope="col">#</th><th scope="col">Level</th>
                            <th scope="col">Typical duration</th><th scope="col">Description</th>
                        </tr></thead>
                        <tbody>
                            ${curriculum().map((level, index) => html`
                                <tr>
                                    <td>${index + 1}</td>
                                    <th scope="row">${level.label}</th>
                                    <td>${level.years} year${level.years === 1 ? '' : 's'}</td>
                                    <td class="type-caption">${level.description || '—'}</td>
                                </tr>
                            `)}
                        </tbody>
                    </table></div>
                </div>
            </div>

            <div class="grid grid-2">
                <div class="card">
                    <div class="card-header"><h2 class="card-title">Programme types</h2></div>
                    <div class="card-body">
                        <ul class="stack stack-xs">
                            ${PROGRAM_TYPES.map((type) => html`
                                <li class="row row-tight">
                                    <span class="badge badge-neutral">${type.value}</span>
                                    <span>${type.label}</span>
                                </li>
                            `)}
                        </ul>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header"><h2 class="card-title">Expense categories</h2></div>
                    <div class="card-body">
                        <ul class="stack stack-xs">
                            ${EXPENSE_CATEGORIES.map((category) => html`<li>${category}</li>`)}
                        </ul>
                    </div>
                </div>
            </div>
        `;
    }

    /* ----------------------------------------------------------------- USERS */

    async usersPanel() {
        const users = await listUsers();

        return html`
            <div class="alert alert-info">
                <div class="alert-title">Roles are an operating convention, not a security boundary</div>
                <p class="alert-body">
                    This system has no server. Anyone with access to this computer and this browser can
                    reach the underlying database regardless of the role set here. Roles keep people out
                    of screens that are not their job — they do not protect data from a determined person
                    at the keyboard. Device login is what protects the records.
                </p>
            </div>

            <div class="card">
                <div class="card-header">
                    <h2 class="card-title">Users</h2>
                    <p class="card-subtitle">${formatNumber(users.length)} people can use this system.</p>
                    ${session.can('settings.edit') ? html`
                        <div class="card-actions">
                            <button class="btn btn-sm btn-primary" data-do="new-user">Add user</button>
                        </div>
                    ` : ''}
                </div>
                <div class="card-body card-body-flush">
                    <div class="table-wrap"><table class="table">
                        <thead><tr>
                            <th scope="col">Name</th><th scope="col">Role</th>
                            <th scope="col">Branch</th><th scope="col">Last seen</th>
                            <th scope="col">Status</th><th scope="col"></th>
                        </tr></thead>
                        <tbody>
                            ${users.map((user) => html`
                                <tr>
                                    <th scope="row">
                                        ${user.name}
                                        ${user.id === session.actorId()
                                            ? html`<span class="badge badge-accent badge-sm">you</span>` : ''}
                                        <div class="type-caption type-muted">${user.email || ''}</div>
                                    </th>
                                    <td>${roleLabel(user.role) || user.role}</td>
                                    <td>${user.branchName || 'All branches'}</td>
                                    <td class="type-caption">
                                        ${user.lastSeenAt ? relativeTime(user.lastSeenAt) : 'never'}
                                    </td>
                                    <td><span class="badge ${user.status === 'active' ? 'badge-success' : 'badge-neutral'}">
                                        ${user.status || 'active'}</span></td>
                                    <td class="text-right">
                                        ${session.can('settings.edit') ? html`
                                            <div class="row row-tight">
                                                <button class="btn btn-sm btn-ghost"
                                                        data-do="edit-user" data-id="${user.id}">Edit</button>
                                                ${user.status === 'active' && user.id !== session.actorId() ? html`
                                                    <button class="btn btn-sm btn-danger-quiet"
                                                            data-do="deactivate-user" data-id="${user.id}">Remove</button>
                                                ` : ''}
                                            </div>
                                        ` : ''}
                                    </td>
                                </tr>
                            `)}
                        </tbody>
                    </table></div>
                </div>
            </div>
        `;
    }

    async editUser(id) {
        const [users, branches] = await Promise.all([listUsers(), listBranches()]);
        const user = id ? users.find((u) => u.id === id) : null;

        const saved = await formOverlay({
            title: user ? `Edit ${user.name}` : 'Add a user',
            fields: [
                { name: 'name', label: 'Name', required: true, width: 'half', value: user?.name },
                { name: 'email', label: 'Email', type: 'email', width: 'half', value: user?.email },
                {
                    name: 'role', label: 'Role', type: 'select', required: true, width: 'half',
                    value: user?.role || 'registrar',
                    options: Object.entries(roleTable()).map(([value, role]) => ({
                        value, label: role.label, note: role.description
                    }))
                },
                {
                    name: 'branchId', label: 'Branch', type: 'select', width: 'half', value: user?.branchId,
                    placeholder: 'All branches',
                    options: optionsFrom(branches, { label: (b) => b.name }),
                    hint: 'Restricts what this person sees by default. They can still switch.'
                },
                { name: 'staffId', label: 'Linked staff record', width: 'half', value: user?.staffId,
                  hint: 'Optional. Links a login to a teacher so their dashboard shows their own batches.' }
            ],
            onSubmit: async (values) => (user ? updateUser(user.id, values) : createUser(values))
        });

        if (saved) {
            toast.success(user ? 'User updated.' : 'User added.');
            await this.paint();
        }
    }

    async deactivateUserFlow(id) {
        const ok = await confirm({
            title: 'Remove this user?',
            message: 'They can no longer be selected. Everything they did stays in the audit log under their name.',
            confirmLabel: 'Remove user',
            danger: true
        });
        if (!ok) return;

        await deactivateUser(id);
        toast.success('User removed.');
        await this.paint();
    }

    /* ----------------------------------------------------------------- ROLES */

    rolesPanel() {
        const matrix = roleMatrix();

        return html`
            <div class="card">
                <div class="card-header">
                    <h2 class="card-title">What each role can do</h2>
                    <p class="card-subtitle">
                        Capabilities are declared in the application. They are shown here so it is clear
                        what a role means before someone is given it.
                    </p>
                </div>
                <div class="card-body card-body-flush">
                    <div class="table-wrap">
                        <table class="table table-compact table-pin-first">
                            <thead>
                                <tr>
                                    <th scope="col">Capability</th>
                                    ${matrix.roles.map((role) => html`
                                        <th scope="col" class="text-center" title="${role.description}">
                                            ${role.label}
                                        </th>
                                    `)}
                                </tr>
                            </thead>
                            <tbody>
                                ${matrix.capabilities.map((capability) => html`
                                    <tr>
                                        <th scope="row">
                                            <span class="type-caption">${capability.label}</span>
                                        </th>
                                        ${matrix.roles.map((role) => html`
                                            <td class="text-center">
                                                ${role.grants[capability.key]
                                                    ? html`<span class="tick" data-tone="positive"
                                                                 aria-label="Allowed">✓</span>`
                                                    : html`<span class="type-muted" aria-label="Not allowed">—</span>`}
                                            </td>
                                        `)}
                                    </tr>
                                `)}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div class="grid grid-3">
                ${matrix.roles.map((role) => html`
                    <div class="card"><div class="card-body">
                        <h3 class="card-title">${role.label}</h3>
                        <p class="type-caption type-muted">${role.description}</p>
                    </div></div>
                `)}
            </div>
        `;
    }

    /* ----------------------------------------------------------- PREFERENCES */

    preferencesPanel() {
        const prefs = preferences();

        return html`
            <div class="card">
                <div class="card-header">
                    <h2 class="card-title">Preferences</h2>
                    <p class="card-subtitle">
                        These apply to this browser only, not to the school. Another machine has its own.
                    </p>
                </div>
                <div class="card-body">
                    <div class="form-grid">
                        <label class="field" data-width="half">
                            <span class="field-label">Appearance</span>
                            <select class="select" data-pref="theme">
                                <option value="light" ${prefs.theme === 'light' ? 'selected' : ''}>Light</option>
                                <option value="dark" ${prefs.theme === 'dark' ? 'selected' : ''}>Dark</option>
                                <option value="system" ${prefs.theme === 'system' ? 'selected' : ''}>Match the device</option>
                            </select>
                            <span class="field-hint">Dark is easier in a hall with the lights down.</span>
                        </label>

                        <label class="field" data-width="half">
                            <span class="field-label">Density</span>
                            <select class="select" data-pref="density">
                                <option value="comfortable" ${prefs.density === 'comfortable' ? 'selected' : ''}>Comfortable</option>
                                <option value="compact" ${prefs.density === 'compact' ? 'selected' : ''}>Compact</option>
                            </select>
                            <span class="field-hint">Compact fits more rows on a laptop screen.</span>
                        </label>

                        <label class="field" data-width="half">
                            <span class="field-label">Rows per page</span>
                            <select class="select" data-pref="pageSize">
                                ${[10, 25, 50, 100].map((size) => html`
                                    <option value="${size}" ${Number(prefs.pageSize) === size ? 'selected' : ''}>
                                        ${size}
                                    </option>
                                `)}
                            </select>
                        </label>

                        <label class="field" data-width="half">
                            <span class="field-label">Landing screen</span>
                            <select class="select" data-pref="landingRoute">
                                ${[
                                    { value: '/', label: 'Dashboard' },
                                    { value: '/attendance', label: 'Attendance' },
                                    { value: '/students', label: 'Students' },
                                    { value: '/fees', label: 'Fees' }
                                ].map((option) => html`
                                    <option value="${option.value}"
                                            ${prefs.landingRoute === option.value ? 'selected' : ''}>
                                        ${option.label}
                                    </option>
                                `)}
                            </select>
                            <span class="field-hint">Where this browser opens. A teacher may prefer the register.</span>
                        </label>

                        <label class="check check-block">
                            <input type="checkbox" data-pref="confirmDestructive"
                                   ${prefs.confirmDestructive ? 'checked' : ''}>
                            <span class="check-box" aria-hidden="true"></span>
                            <span>
                                <span class="type-strong">Confirm before anything destructive</span>
                                <span class="type-caption type-muted">
                                    Keep this on unless you have a very good reason.
                                </span>
                            </span>
                        </label>
                    </div>
                </div>
            </div>
            ${this.wirePreferences()}
        `;
    }

    wirePreferences() {
        queueMicrotask(() => {
            const panel = this.container?.querySelector('[data-role="panel"]');
            if (!panel) return;

            const apply = (key, value) => {
                try {
                    setPreference(key, value);
                    toast.success('Preference saved.');
                } catch (err) {
                    toast.error(err.message);
                }
            };

            on(panel, 'change', 'select[data-pref]', (_e, target) => {
                const value = target.dataset.pref === 'pageSize' ? Number(target.value) : target.value;
                apply(target.dataset.pref, value);
            });
            on(panel, 'change', 'input[data-pref]', (_e, target) =>
                apply(target.dataset.pref, target.checked));
        });
        return '';
    }

    /* ------------------------------------------------------------- AUDIT LOG */

    async auditPanel() {
        session.require('audit.view', 'read the audit log');

        const [options, summary, entries] = await Promise.all([
            filterOptions(),
            activitySummary({ days: 30 }),
            searchAudit({ ...this.cleanAuditFilters(), limit: 300 })
        ]);

        return html`
            <div class="grid grid-4">
                ${kpiCard('Entries, 30 days', formatNumber(summary.total))}
                ${kpiCard('People active', formatNumber(summary.actors?.length ?? 0))}
                ${kpiCard('Busiest day', summary.busiestDay ? formatDate(summary.busiestDay.date) : '—',
                    summary.busiestDay ? `${summary.busiestDay.count} actions` : null)}
                ${kpiCard('Deletions', formatNumber(summary.deletions ?? 0), null, { tone: summary.deletions ? 'caution' : 'positive' })}
            </div>

            <div class="card">
                <div class="card-header">
                    <h2 class="card-title">Audit log</h2>
                    <p class="card-subtitle">
                        Every write, with who did it. Append-only — nothing in this list can be edited.
                    </p>
                    <div class="card-actions">
                        <button class="btn btn-sm btn-secondary" data-do="export-audit">Export</button>
                    </div>
                </div>

                <div class="card-body card-body-tight">
                    <div class="filter-bar">
                        <div class="row row-wrap">
                            ${filterSelect({
                                name: 'entity', label: 'Entity', value: this.auditFilters.entity,
                                options: [
                                    { value: '', label: 'Everything' },
                                    ...(options.entities || []).map((e) => ({ value: e, label: e }))
                                ]
                            })}
                            ${filterSelect({
                                name: 'action', label: 'Action', value: this.auditFilters.action,
                                options: [
                                    { value: '', label: 'Any action' },
                                    ...(options.actions || []).map((a) => ({ value: a, label: a }))
                                ]
                            })}
                            ${filterDate({ name: 'from', label: 'From', value: this.auditFilters.from })}
                            ${filterDate({ name: 'to', label: 'To', value: this.auditFilters.to })}
                        </div>
                    </div>

                    ${entries.length ? html`
                        <ul class="timeline">
                            ${entries.map((entry) => html`
                                <li class="timeline-item">
                                    <span class="timeline-dot"
                                          data-tone="${entry.action?.includes('delete') ? 'negative' : 'neutral'}"></span>
                                    <div class="timeline-content">
                                        <div class="timeline-title">${describeAudit(entry)}</div>
                                        <div class="timeline-meta">
                                            ${entry.actorName || 'System'}
                                            · ${formatDateTime(entry.at)}
                                            · <span class="type-muted">${entry.entity}</span>
                                        </div>
                                    </div>
                                </li>
                            `)}
                        </ul>
                    ` : html`
                        <div class="empty empty-compact">
                            <p class="empty-text">Nothing matches these filters.</p>
                        </div>
                    `}
                </div>
            </div>
            ${this.wireAudit()}
        `;
    }

    cleanAuditFilters() {
        const filters = {};
        for (const [key, value] of Object.entries(this.auditFilters)) {
            if (value) filters[key] = value;
        }
        return filters;
    }

    wireAudit() {
        queueMicrotask(() => {
            const panel = this.container?.querySelector('[data-role="panel"]');
            if (!panel) return;
            on(panel, 'change', '[data-filter]', (_e, target) => {
                this.auditFilters[target.dataset.filter] = target.value;
                this.paint();
            });
        });
        return '';
    }

    async exportAudit() {
        const entries = await searchAudit({ ...this.cleanAuditFilters(), limit: 5000 });
        downloadCSV(`natyam-audit-${localDate()}`, entries.map((entry) => ({
            When: formatDateTime(entry.at),
            Who: entry.actorName || 'System',
            Entity: entry.entity,
            Action: entry.action,
            Detail: describeAudit(entry),
            Reference: entry.entityId || ''
        })));
        toast.success(`${entries.length} entries exported.`);
    }

    /* ------------------------------------------------------------------ DATA */

    async dataPanel() {
        const [status, storage] = await Promise.all([backupStatus(), storageStatus()]);

        return html`
            <div class="alert ${status.stale ? 'alert-warning' : 'alert-info'}">
                <div class="alert-title">
                    ${status.stale ? 'Take a backup' : 'Backups are current'}
                </div>
                <p class="alert-body">
                    ${status.message} This school's records live in this browser, on this computer.
                    There is no server holding a copy. A backup file is the only thing standing between
                    a cleared browser and losing everything.
                </p>
                <button class="btn btn-sm btn-primary" data-do="backup">Download a backup now</button>
            </div>

            <div class="grid grid-2">
                <div class="card">
                    <div class="card-header">
                        <h2 class="card-title">Storage</h2>
                        <p class="card-subtitle">${storage.advice}</p>
                    </div>
                    <div class="card-body">
                        ${summaryList([
                            ['Used', storage.usageLabel || `${formatNumber(Math.round((storage.usage || 0) / 1024))} KB`],
                            ['Available', storage.quotaLabel || '—'],
                            ['Protected from clearing', storage.persisted ? 'Yes' : 'No']
                        ])}
                        ${!storage.persisted ? html`
                            <button class="btn btn-sm btn-secondary mt-2" data-do="persist">
                                Ask the browser to keep this data
                            </button>
                        ` : ''}
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h2 class="card-title">Move data in and out</h2>
                        <p class="card-subtitle">CSV for spreadsheets, JSON for whole sections.</p>
                    </div>
                    <div class="card-body">
                        <div class="stack stack-sm">
                            <button class="btn btn-secondary" data-do="import">
                                ${raw(icon('upload', { size: 15 }))} Import from a spreadsheet
                            </button>
                            <button class="btn btn-secondary" data-do="export-store">
                                ${raw(icon('download', { size: 15 }))} Export one section as JSON
                            </button>
                            <p class="type-caption type-muted">
                                Per-report CSV exports live on the reports screen, where the columns
                                and filters are already chosen.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            ${session.can('backup.manage') ? html`
                <div class="card">
                    <div class="card-header">
                        <h2 class="card-title">Restore</h2>
                        <p class="card-subtitle">
                            Replaces everything currently held with the contents of a backup file.
                        </p>
                    </div>
                    <div class="card-body">
                        <p class="type-body">
                            A restore is not a merge. Merging sounds safer and is not — it quietly
                            produces two copies of every record whose identifier changed, and the school
                            finds out months later. Before anything is overwritten, a safety copy of the
                            current data is offered for download.
                        </p>
                        <button class="btn btn-secondary mt-2" data-do="restore">
                            ${raw(icon('upload', { size: 15 }))} Restore from a backup file
                        </button>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h2 class="card-title">Start again</h2>
                    </div>
                    <div class="card-body">
                        <p class="type-body">
                            Erases every student, payment, register and certificate held in this browser.
                            Intended for clearing demonstration data before the school begins real use.
                        </p>
                        <button class="btn btn-danger mt-2" data-do="reset">Erase everything</button>
                    </div>
                </div>
            ` : ''}
        `;
    }

    async takeBackup() {
        await downloadBackup({ note: 'Manual backup from settings' });
        toast.success('Backup downloaded. Keep it somewhere that is not this computer.');
        await this.paint();
    }

    async persist() {
        const granted = await requestPersistence();
        toast[granted ? 'success' : 'warning'](granted
            ? 'The browser has agreed to keep this data.'
            : 'The browser declined. Keep taking backups.');
        await this.paint();
    }

    async exportStoreFlow() {
        const chosen = await formOverlay({
            title: 'Export a section',
            variant: 'modal',
            size: 'sm',
            submitLabel: 'Export',
            fields: [{
                name: 'store', label: 'Section', type: 'select', required: true,
                options: STORE_NAMES.map((store) => ({ value: store, label: store }))
            }],
            onSubmit: async (values) => values
        });

        if (!chosen) return;
        await exportStore(chosen.store);
        toast.success(`${chosen.store} exported as JSON.`);
    }

    /**
     * Restore is gated behind an inspection: the file is read and summarised
     * before the user is asked to confirm, so the dialog can say what is
     * actually in it rather than asking for faith.
     */
    async restoreFlow() {
        const file = await pickFile('.json');
        if (!file) return;

        let inspection;
        try {
            inspection = await inspectBackup(file);
        } catch (err) {
            toast.error(err.message);
            return;
        }

        const confirmed = await confirmTyped({
            title: 'Replace everything with this backup?',
            message: [
                `This file was taken on ${formatDateTime(inspection.backup.takenAt)}`,
                `and holds ${formatNumber(inspection.recordCount)} records`,
                inspection.summary?.students ? `including ${inspection.summary.students} students.` : '.',
                '',
                'Everything currently in this browser will be replaced.',
                'A safety copy of the current data will download first.',
                ...inspection.warnings
            ].join(' '),
            phrase: 'REPLACE',
            confirmLabel: 'Restore this backup'
        });

        if (!confirmed) return;

        try {
            const result = await restore(inspection.backup, { safetyCopy: true });
            toast.success(`Restored ${formatNumber(result.restored ?? inspection.recordCount)} records.`);
            setTimeout(() => window.location.reload(), 1200);
        } catch (err) {
            toast.error(err.message);
        }
    }

    async resetFlow() {
        const confirmed = await confirmTyped({
            title: 'Erase every record?',
            message: 'Every student, payment, register, certificate and ledger entry in this browser will '
                + 'be deleted. A safety copy downloads first, and it will be the only copy left.',
            phrase: 'ERASE',
            confirmLabel: 'Erase everything'
        });
        if (!confirmed) return;

        await resetEverything({ safetyCopy: true });
        toast.success('Everything erased. Reloading.');
        setTimeout(() => window.location.reload(), 1200);
    }

    /* ---------------------------------------------------------------- IMPORT */

    async importFlow() {
        const file = await pickFile('.csv,.json');
        if (!file) return;

        let parsed;
        try {
            parsed = await readFile(file);
        } catch (err) {
            toast.error(err.message);
            return;
        }

        if (!parsed.rows.length) {
            toast.error('That file has no rows in it.');
            return;
        }

        const choice = await formOverlay({
            title: 'Import records',
            description: `${file.name} — ${formatNumber(parsed.rows.length)} rows, `
                + `columns: ${parsed.headers.slice(0, 6).join(', ')}${parsed.headers.length > 6 ? '…' : ''}`,
            submitLabel: 'Check the file',
            fields: [
                {
                    name: 'importerId', label: 'What is in this file', type: 'select', required: true,
                    options: IMPORTERS.map((importer) => ({
                        value: importer.id, label: importer.label, note: importer.description
                    }))
                },
                { name: 'raiseFees', label: 'Raise fee schedules for imported students',
                  type: 'switch', value: false,
                  hint: 'Leave off if these students have already paid elsewhere.' }
            ],
            onSubmit: async (values) => values
        });

        if (!choice) return;

        let check;
        try {
            check = await dryRun(choice.importerId, parsed.rows, { branchId: session.branch() });
        } catch (err) {
            toast.error(err.message);
            return;
        }

        await this.showImportPreview(check, choice);
    }

    async showImportPreview(check, choice) {
        const bad = check.rows.filter((row) => !row.ok);

        await drawer({
            title: `Import ${check.importer.label.toLowerCase()}`,
            description: `${formatNumber(check.valid)} of ${formatNumber(check.total)} rows can be imported.`,
            size: 'wide',
            content: html`
                <div class="grid grid-3">
                    ${kpiCard('Rows in file', formatNumber(check.total))}
                    ${kpiCard('Will import', formatNumber(check.valid), null, { tone: check.valid ? 'positive' : 'negative' })}
                    ${kpiCard('Have problems', formatNumber(check.invalid), null, { tone: check.invalid ? 'caution' : 'positive' })}
                </div>

                ${check.warnings.map((warning) => html`
                    <div class="alert alert-warning"><p class="alert-body">${warning}</p></div>
                `)}

                ${bad.length ? html`
                    <div class="card">
                        <div class="card-header">
                            <h3 class="card-title">Rows that will be skipped</h3>
                            <p class="card-subtitle">
                                Fix these in the spreadsheet and import again — nothing is silently dropped.
                            </p>
                        </div>
                        <div class="card-body card-body-flush">
                            <div class="table-wrap"><table class="table table-compact">
                                <thead><tr>
                                    <th scope="col">Line</th><th scope="col">Name</th><th scope="col">Problem</th>
                                </tr></thead>
                                <tbody>
                                    ${bad.slice(0, 50).map((row) => html`
                                        <tr>
                                            <td>${row.line}</td>
                                            <th scope="row">${row.values.name || '—'}</th>
                                            <td class="type-caption" data-tone="negative">
                                                ${row.problems.join('; ')}
                                            </td>
                                        </tr>
                                    `)}
                                </tbody>
                            </table></div>
                        </div>
                    </div>
                ` : ''}

                ${check.valid ? html`
                    <div class="card">
                        <div class="card-header">
                            <h3 class="card-title">First few that will be imported</h3>
                        </div>
                        <div class="card-body card-body-flush">
                            <div class="table-wrap"><table class="table table-compact">
                                <thead><tr>
                                    <th scope="col">Line</th><th scope="col">Name</th>
                                    <th scope="col">Detail</th>
                                </tr></thead>
                                <tbody>
                                    ${check.rows.filter((row) => row.ok).slice(0, 10).map((row) => html`
                                        <tr>
                                            <td>${row.line}</td>
                                            <th scope="row">${row.values.name}</th>
                                            <td class="type-caption">
                                                ${[row.values.level, row.values.role,
                                                   row.values.guardianName, row.values.phone]
                                                    .filter(Boolean).join(' · ')}
                                            </td>
                                        </tr>
                                    `)}
                                </tbody>
                            </table></div>
                        </div>
                    </div>
                ` : ''}
            `,
            actions: [
                { label: 'Cancel', variant: 'secondary', value: null },
                ...(check.valid ? [{
                    label: `Import ${check.valid} record${check.valid === 1 ? '' : 's'}`,
                    variant: 'primary',
                    primary: true,
                    onClick: async () => {
                        try {
                            const result = await commit(choice.importerId, check.rows, {
                                branchId: session.branch(),
                                raiseFees: choice.raiseFees
                            });

                            toast.success(`${result.created} record${result.created === 1 ? '' : 's'} imported.`);
                            if (result.failed.length) {
                                toast.warning(`${result.failed.length} failed while writing: `
                                    + result.failed.slice(0, 2).map((f) => f.reason).join('; '));
                            }
                            return result;
                        } catch (err) {
                            toast.error(err.message);
                            return false;
                        }
                    }
                }] : [])
            ]
        });
    }
}

/* ------------------------------------------------------------------ HELPERS */


/**
 * A file picker as a promise. Built here rather than imported because a hidden
 * input element is the only way to open a file dialog from script, and wrapping
 * that once is cheaper than a component nobody else needs.
 */
function pickFile(accept) {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.style.display = 'none';
        input.addEventListener('change', () => {
            resolve(input.files?.[0] || null);
            input.remove();
        });
        // A cancelled dialog fires no event in some browsers; the focus return
        // is the only reliable signal, and a late resolve is harmless.
        window.addEventListener('focus', () => {
            setTimeout(() => { if (document.body.contains(input)) { resolve(null); input.remove(); } }, 400);
        }, { once: true });

        document.body.append(input);
        input.click();
    });
}
