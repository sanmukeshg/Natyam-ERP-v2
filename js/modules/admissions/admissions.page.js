/**
 * NATYAM ERP 2.0 — Admissions
 *
 * The application pipeline, and the one operation this whole rebuild was
 * shaped around: turning an approved applicant into a student.
 *
 * In 1.0 that conversion wrote a student record but never set `batchId`. The
 * child existed, appeared in the roll count, had fees raised against them —
 * and appeared on no register anywhere, so nobody marked them present and
 * nobody noticed they had stopped coming. The fix is not in this file. It is
 * in admissions.service.enrolApplicant, which refuses to run without a batch
 * and writes the student and the application status in one transaction. All
 * this page does is collect the batch and show whatever the service says.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { drawer, confirm } from '../../ui/overlay.js';
import { DataTable } from '../../ui/table.js';
import { formOverlay, optionsFrom, summaryList, fields as renderFields } from '../../ui/form.js';
import { wizard } from '../../ui/wizard.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { router } from '../../core/router.js';
import { formatMoney, formatNumber } from '../../utils/money.js';
import { formatDate, formatDateLong, localDate } from '../../utils/date.js';
import { ADMISSION_STATUS, LEVELS } from '../../config/app.config.js';

import {
    ADMISSION_STEPS, validateStep, listApplications, applicationDetail,
    saveDraft, listDrafts, loadDraft, discardDraft, submit,
    beginReview, approve, reject, reopen, enrolApplicant, eligibleBatches, pipeline
} from '../../services/admissions.service.js';
import { listBranches, listFeePlans } from '../../services/settings.service.js';

const STATUS_BADGE = {
    draft: 'badge-neutral',
    submitted: 'badge-info',
    reviewing: 'badge-accent',
    approved: 'badge-warning',
    enrolled: 'badge-success',
    rejected: 'badge-danger'
};

export default class AdmissionsPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Admissions';
        this.filters = { status: this.query.filter || 'all' };
        this.reference = null;
    }

    async render(container) {
        this.container = container;
        render(container, this.shell());
        this.bind();

        const [branches, plans] = await Promise.all([listBranches(), listFeePlans()]);
        this.reference = { branches, plans };

        this.buildTable();
        await this.load();

        if (this.query.new) this.startApplication();
    }

    shell() {
        return html`
            <header class="page-header">
                <div class="page-header-text">
                    <h1 class="page-title">Admissions</h1>
                    <p class="page-subtitle">Applications from first enquiry to a place on the roll.</p>
                </div>
                <div class="page-actions">
                    <button class="btn btn-secondary btn-sm" data-action="drafts">
                        ${raw(icon('file-text', { size: 15 }))} Drafts
                    </button>
                    ${session.can('admission.edit') ? html`
                        <button class="btn btn-primary btn-sm" data-action="new">
                            ${raw(icon('plus', { size: 15 }))} New application
                        </button>
                    ` : ''}
                </div>
            </header>
            <div class="page-body">
                <div data-role="pipeline"></div>
                <div class="filter-bar" data-role="filters"></div>
                <div data-role="table"></div>
            </div>
        `;
    }

    bind() {
        this.onDispose(on(this.container, 'click', '[data-action="new"]', () => this.startApplication()));
        this.onDispose(on(this.container, 'click', '[data-action="drafts"]', () => this.openDrafts()));
        this.onDispose(on(this.container, 'click', '[data-stage]', (_e, target) => {
            this.filters.status = target.dataset.stage;
            this.load();
        }));

        [EVENTS.ADMISSION_SUBMITTED, EVENTS.ADMISSION_APPROVED, EVENTS.ADMISSION_ENROLLED, EVENTS.BRANCH_CHANGED]
            .forEach((event) => this.events.on(event, () => this.load()));
    }

    /* -------------------------------------------------------------- PIPELINE */

    pipelineBar(stats) {
        const stages = [
            { key: 'all', label: 'All', value: stats.total },
            { key: ADMISSION_STATUS.SUBMITTED, label: 'Awaiting review', value: stats.submitted },
            { key: ADMISSION_STATUS.REVIEWING, label: 'Under review', value: stats.reviewing },
            { key: ADMISSION_STATUS.APPROVED, label: 'Approved, not enrolled', value: stats.approved },
            { key: ADMISSION_STATUS.ENROLLED, label: 'Enrolled', value: stats.enrolled },
            { key: ADMISSION_STATUS.REJECTED, label: 'Rejected', value: stats.rejected }
        ];

        return html`
            <div class="grid grid-6">
                ${stages.map((stage) => html`
                    <button class="kpi kpi-quiet ${this.filters.status === stage.key ? 'is-active' : ''}"
                            data-stage="${stage.key}"
                            data-tone="${stage.key === ADMISSION_STATUS.APPROVED && stage.value ? 'caution' : 'neutral'}"
                            aria-pressed="${this.filters.status === stage.key}">
                        <div class="kpi-head"><span class="kpi-label">${stage.label}</span></div>
                        <div class="kpi-value">${formatNumber(stage.value)}</div>
                    </button>
                `)}
            </div>
            ${stats.approved ? html`
                <div class="alert alert-warning">
                    <p class="alert-body">
                        ${formatNumber(stats.approved)} applicant${stats.approved === 1 ? ' has' : 's have'}
                        been told they have a place but ${stats.approved === 1 ? 'is' : 'are'} not on the roll yet.
                        Until they are enrolled into a batch they appear on no register.
                    </p>
                </div>
            ` : ''}
            ${stats.conversionRate !== null ? html`
                <p class="type-caption type-muted">
                    ${stats.conversionRate}% of decided applications end in an enrolment
                    · ${formatNumber(stats.thisMonth)} applied this month
                </p>
            ` : ''}
        `;
    }

    /* ----------------------------------------------------------------- TABLE */

    buildTable() {
        this.table = new DataTable({
            rows: [],
            searchPlaceholder: 'Search applicant or guardian…',
            defaultSort: 'appliedOn',
            defaultSortDir: 'desc',
            emptyTitle: 'No applications in this view',
            emptyMessage: 'Applications appear here as families apply.',
            emptyIcon: 'inbox',
            emptyAction: session.can('admission.edit')
                ? { label: 'New application', onClick: () => this.startApplication() }
                : null,
            onRowClick: (row) => this.openApplication(row.id),
            columns: [
                {
                    key: 'name', label: 'Applicant', sortable: true,
                    searchValue: (row) => `${row.name} ${row.guardianName || ''} ${row.guardianPhone || ''}`,
                    render: (row) => html`
                        <div>
                            <span class="type-strong">${row.name}</span>
                            <div class="type-caption type-muted">
                                ${row.applicationNo || ''} ${row.guardianName ? `· ${row.guardianName}` : ''}
                            </div>
                        </div>
                    `
                },
                { key: 'levelLabel', label: 'Level', sortable: true },
                {
                    key: 'appliedOn', label: 'Applied', sortable: true,
                    render: (row) => html`
                        <div>
                            <span>${row.appliedOn ? formatDate(row.appliedOn) : '—'}</span>
                            ${row.stalled ? html`
                                <div class="type-caption" data-tone="negative">waiting ${row.waitingDays} days</div>
                            ` : ''}
                        </div>
                    `
                },
                {
                    key: 'status', label: 'Stage', sortable: true,
                    render: (row) => html`<span class="badge ${STATUS_BADGE[row.status] || 'badge-neutral'}">
                        ${row.statusLabel}</span>`
                },
                {
                    key: 'action', label: '', sortable: false,
                    render: (row) => row.nextAction && session.can('admission.edit')
                        ? html`<button class="btn btn-sm btn-secondary" data-next="${row.id}">
                                   ${row.nextAction.label}</button>`
                        : ''
                }
            ]
        });

        this.table.mount(this.container.querySelector('[data-role="table"]'));
        this.onDispose(() => this.table.destroy());
        this.onDispose(on(this.container, 'click', '[data-next]', async (event, target) => {
            event.stopPropagation();
            const row = this.rows.find((r) => r.id === target.dataset.next);
            await this.advance(row);
        }));
    }

    async load() {
        try {
            const [rows, stats] = await Promise.all([
                listApplications(session.branch(), { status: this.filters.status }),
                pipeline(session.branch())
            ]);

            this.rows = rows;
            this.table.setRows(rows);
            render(this.container.querySelector('[data-role="pipeline"]'), this.pipelineBar(stats));
        } catch (err) {
            console.error(err);
            toast.error(`Applications could not be loaded — ${err.message}`);
        }
    }

    /* ------------------------------------------------------------- THE WIZARD */

    async startApplication(draft = null) {
        session.require('admission.edit', 'take an application');

        let draftId = draft?.id || null;
        const state = draft?.data ? { ...draft.data } : { branchId: session.branch() || null };

        const result = await wizard({
            title: draft ? 'Continue application' : 'New application',
            description: 'Saved as you go — you can close this and come back to it.',
            steps: this.wizardSteps(),
            state,
            finishLabel: 'Submit application',
            onStep: async (data, index) => {
                try {
                    const saved = await saveDraft(draftId, data, { step: index });
                    draftId = saved.id || draftId;
                } catch (err) {
                    console.warn('Draft not saved', err);
                }
            },
            onFinish: async (data) => submit(data, { draftId })
        });

        if (!result) return;

        toast.success(`${result.name || 'The application'} submitted.`);
        await this.load();
        this.openApplication(result.id);
    }

    /**
     * Steps mirror ADMISSION_STEPS from the service, and validation for each is
     * the service's own validateStep. The page cannot invent a rule about what
     * an application needs, and cannot fall out of step with the service when
     * that changes.
     */
    wizardSteps() {
        const branchOptions = optionsFrom(this.reference.branches, { label: (b) => b.name });
        const planOptions = optionsFrom(this.reference.plans, {
            label: (p) => p.name,
            note: (p) => `${formatMoney(p.amount)}/month`
        });

        const step = (key, config) => ({
            key,
            label: ADMISSION_STEPS.find((s) => s.key === key).label,
            validate: (data) => validateStep(key, data),
            ...config
        });

        return [
            step('applicant', {
                description: 'Who is applying.',
                fields: () => [
                    { name: 'name', label: 'Full name', required: true, width: 'half', autofocus: true },
                    { name: 'dateOfBirth', label: 'Date of birth', type: 'date', required: true, width: 'half' },
                    {
                        name: 'gender', label: 'Gender', type: 'select', required: true, width: 'half',
                        options: [
                            { value: 'female', label: 'Female' },
                            { value: 'male', label: 'Male' },
                            { value: 'other', label: 'Other' }
                        ]
                    },
                    { name: 'school', label: 'School or college', width: 'half' },
                    { name: 'address', label: 'Address', type: 'textarea', rows: 2 }
                ]
            }),
            step('guardian', {
                description: 'The parent or guardian we contact.',
                fields: () => [
                    { name: 'guardianName', label: 'Name', required: true, width: 'half' },
                    {
                        name: 'guardianRelation', label: 'Relationship', type: 'select', required: true,
                        width: 'half', placeholder: false,
                        options: ['Mother', 'Father', 'Grandparent', 'Guardian'].map((r) => ({ value: r, label: r }))
                    },
                    { name: 'guardianPhone', label: 'Phone', type: 'tel', required: true, width: 'half' },
                    { name: 'guardianEmail', label: 'Email', type: 'email', width: 'half' },
                    { name: 'alternatePhone', label: 'Emergency contact', type: 'tel', width: 'half',
                      hint: 'Used when the first number cannot be reached.' },
                    { name: 'occupation', label: 'Occupation', width: 'half' }
                ]
            }),
            step('placement', {
                description: 'Where they will study, and at what level.',
                fields: () => [
                    { name: 'branchId', label: 'Branch', type: 'select', required: true, width: 'half',
                      options: branchOptions },
                    {
                        name: 'level', label: 'Starting level', type: 'select', required: true, width: 'half',
                        options: LEVELS.map((l) => ({ value: l.value, label: l.label, note: l.description })),
                        hint: 'A beginner starts at Prarambhika. A transfer may be placed higher after an assessment.'
                    }
                ]
            }),
            step('batch', {
                description: 'Optional now — a batch is required before enrolment, not before applying.',
                fields: () => [],
                render: (data) => html`
                    <div data-role="batch-slot">
                        <p class="type-muted">Checking which batches have room…</p>
                    </div>
                `,
                onMount: async (bodyEl, { data, refresh }) => {
                    void refresh;
                    const slot = bodyEl.querySelector('[data-role="batch-slot"]');
                    if (!slot) return;

                    if (!data.level) {
                        render(slot, html`<p class="type-muted">Choose a level first.</p>`);
                        return;
                    }

                    const batches = await eligibleBatches(data.level, data.branchId || null);
                    render(slot, batches.length ? renderFields([{
                        name: 'preferredBatchId',
                        label: 'Preferred batch',
                        type: 'select',
                        value: data.preferredBatchId,
                        placeholder: 'Decide at enrolment',
                        options: batches.map((batch) => ({
                            value: batch.id,
                            label: `${batch.name} — ${batch.schedule || ''}`,
                            note: batch.reason,
                            disabled: !batch.selectable
                        })),
                        hint: 'A preference only. The batch is confirmed when the applicant is enrolled.'
                    }]) : html`
                        <div class="alert alert-warning">
                            <p class="alert-body">No batch currently teaches this level with room to spare.
                            The application can still proceed — a batch must be created or freed before enrolment.</p>
                        </div>
                    `);
                }
            }),
            step('experience', {
                description: 'Any dance the applicant has already done.',
                fields: () => [
                    {
                        name: 'priorExperience', label: 'Previous training', type: 'select',
                        options: [
                            { value: 'none', label: 'None — complete beginner' },
                            { value: 'kuchipudi', label: 'Kuchipudi elsewhere' },
                            { value: 'bharatanatyam', label: 'Bharatanatyam' },
                            { value: 'other-classical', label: 'Another classical form' },
                            { value: 'other', label: 'Other dance' }
                        ]
                    },
                    { name: 'yearsOfPractice', label: 'Years of practice', type: 'number', min: 0, max: 40, width: 'half' },
                    { name: 'previousGuru', label: 'Previous teacher', width: 'half' },
                    { name: 'experienceNotes', label: 'Notes', type: 'textarea', rows: 2 }
                ]
            }),
            step('medical', {
                description: 'Anything a teacher must know before the applicant dances.',
                fields: () => [
                    { name: 'medicalNotes', label: 'Medical notes', type: 'textarea', rows: 3,
                      hint: 'Asthma, past injuries, allergies. Shown to teachers on the register.' },
                    { name: 'consentPhotography', label: 'Consents to photography at performances',
                      type: 'switch', value: true }
                ]
            }),
            step('fees', {
                description: 'The plan this applicant will be billed on.',
                fields: () => [
                    { name: 'feePlanId', label: 'Fee plan', type: 'select', required: true, options: planOptions },
                    { name: 'feeNotes', label: 'Concession or note', type: 'textarea', rows: 2,
                      hint: 'Any agreed discount is applied when the invoice is raised, not here.' }
                ]
            }),
            step('documents', {
                description: 'What the family has provided.',
                fields: () => [
                    { name: 'docIdProof', label: 'Identity proof seen', type: 'switch' },
                    { name: 'docBirthCertificate', label: 'Birth certificate seen', type: 'switch' },
                    { name: 'docPhotograph', label: 'Photograph provided', type: 'switch' },
                    { name: 'documentNotes', label: 'Notes', type: 'textarea', rows: 2 }
                ]
            }),
            step('review', {
                description: 'Check this over before it goes into the pipeline.',
                fields: () => [],
                render: (data) => {
                    const plan = this.reference.plans.find((p) => p.id === data.feePlanId);
                    const branch = this.reference.branches.find((b) => b.id === data.branchId);

                    return html`
                        ${summaryList([
                            ['Applicant', data.name],
                            ['Date of birth', data.dateOfBirth ? formatDateLong(data.dateOfBirth) : null],
                            ['Guardian', data.guardianName ? `${data.guardianName} (${data.guardianRelation})` : null],
                            ['Phone', data.guardianPhone],
                            ['Branch', branch?.name],
                            ['Level', LEVELS.find((l) => l.value === data.level)?.label],
                            ['Fee plan', plan ? `${plan.name} — ${formatMoney(plan.amount)}/month` : null],
                            ['Previous training', data.priorExperience],
                            ['Medical', data.medicalNotes]
                        ])}
                        <div class="alert alert-info mt-4">
                            <p class="alert-body">Submitting puts this application in the review queue.
                            Nobody is enrolled and no fee is raised until an approved applicant is
                            placed in a batch.</p>
                        </div>
                    `;
                }
            })
        ];
    }

    /* ---------------------------------------------------------------- DRAFTS */

    async openDrafts() {
        const drafts = await listDrafts();

        await drawer({
            title: 'Unfinished applications',
            description: 'Saved automatically. They are yours until you submit or discard them.',
            size: 'sm',
            content: drafts.length ? html`
                <ul class="stack stack-sm">
                    ${drafts.map((draft) => html`
                        <li class="spread">
                            <div>
                                <span class="type-strong">${draft.data?.name || 'Unnamed applicant'}</span>
                                <div class="type-caption type-muted">
                                    step ${(draft.step || 0) + 1} of ${ADMISSION_STEPS.length}
                                    · saved ${formatDate(draft.updatedAt)}
                                </div>
                            </div>
                            <div class="row row-tight">
                                <button class="btn btn-sm btn-primary" data-resume="${draft.id}">Continue</button>
                                <button class="btn btn-sm btn-ghost btn-icon" data-discard="${draft.id}"
                                        aria-label="Discard draft">${raw(icon('trash', { size: 14 }))}</button>
                            </div>
                        </li>
                    `)}
                </ul>
            ` : html`
                <div class="empty empty-compact">
                    <p class="empty-text">No unfinished applications.</p>
                </div>
            `,
            actions: [{ label: 'Close', variant: 'secondary', value: null }],
            onMount: (body, api) => {
                on(body, 'click', '[data-resume]', async (_e, target) => {
                    const draft = await loadDraft(target.dataset.resume);
                    api.close(null);
                    await this.startApplication(draft);
                });
                on(body, 'click', '[data-discard]', async (_e, target) => {
                    await discardDraft(target.dataset.discard);
                    target.closest('li')?.remove();
                    toast.success('Draft discarded.');
                });
            }
        });
    }

    /* ----------------------------------------------------------- APPLICATION */

    async openApplication(id) {
        let detail;
        try {
            detail = await applicationDetail(id);
        } catch (err) {
            toast.error(err.message);
            return;
        }

        const a = detail.application;

        await drawer({
            title: a.name,
            description: `${detail.levelLabel} · ${detail.statusLabel}${a.applicationNo ? ` · ${a.applicationNo}` : ''}`,
            size: 'wide',
            content: html`
                ${detail.possibleDuplicates.length ? html`
                    <div class="alert alert-warning">
                        <div class="alert-title">This may be a duplicate</div>
                        <p class="alert-body">
                            ${detail.possibleDuplicates.map((d) => `${d.name} (${d.status})`).join(', ')}
                        </p>
                    </div>
                ` : ''}

                <div class="card"><div class="card-body">
                    ${summaryList([
                        ['Applied', a.appliedOn ? formatDateLong(a.appliedOn) : null],
                        ['Date of birth', a.dateOfBirth ? formatDate(a.dateOfBirth) : null],
                        ['Guardian', a.guardianName ? `${a.guardianName} (${a.guardianRelation || 'guardian'})` : null],
                        ['Phone', a.guardianPhone],
                        ['Email', a.guardianEmail],
                        ['Emergency contact', a.alternatePhone],
                        ['Address', a.address],
                        ['Previous training', a.priorExperience],
                        ['Years of practice', a.yearsOfPractice],
                        ['Medical', a.medicalNotes],
                        ['Fee plan', this.reference.plans.find((p) => p.id === a.feePlanId)?.name],
                        ['Decision note', a.decisionNote || a.rejectionReason]
                    ])}
                </div></div>

                <div class="card">
                    <div class="card-header"><h3 class="card-title">Batches teaching ${detail.levelLabel}</h3></div>
                    <div class="card-body card-body-tight">
                        ${detail.eligibleBatches.length ? html`
                            <ul class="stack stack-sm">
                                ${detail.eligibleBatches.map((batch) => html`
                                    <li class="spread">
                                        <div>
                                            <span class="type-strong">${batch.name}</span>
                                            <div class="type-caption type-muted">${batch.schedule || ''}</div>
                                        </div>
                                        <span class="badge ${batch.selectable ? 'badge-success' : 'badge-neutral'}">
                                            ${batch.reason}
                                        </span>
                                    </li>
                                `)}
                            </ul>
                        ` : html`
                            <p class="type-muted">No batch teaches this level yet. One must exist before
                            this applicant can be enrolled.</p>
                        `}
                    </div>
                </div>
            `,
            actions: this.applicationActions(detail)
        });
    }

    applicationActions(detail) {
        const actions = [{ label: 'Close', variant: 'secondary', value: null }];
        if (!session.can('admission.edit')) return actions;

        const a = detail.application;

        if (a.status === ADMISSION_STATUS.REVIEWING || a.status === ADMISSION_STATUS.SUBMITTED) {
            actions.push({
                label: 'Reject',
                variant: 'danger-quiet',
                onClick: async () => { await this.rejectApplication(a); return null; }
            });
        }

        if (detail.nextAction) {
            actions.push({
                label: detail.nextAction.label,
                variant: 'primary',
                primary: true,
                onClick: async () => { await this.advance({ ...a, nextAction: detail.nextAction }); return null; }
            });
        }

        return actions;
    }

    /** Moves an application one stage forward, whichever stage it is at. */
    async advance(row) {
        if (!row?.nextAction) return;

        try {
            switch (row.nextAction.key) {
                case 'review':
                    await beginReview(row.id);
                    toast.success('Marked as under review.');
                    break;
                case 'approve':
                    await this.approveApplication(row);
                    break;
                case 'enrol':
                    await this.enrol(row);
                    break;
                case 'reopen':
                    await reopen(row.id);
                    toast.success('Application reopened.');
                    break;
                default:
                    break;
            }
            await this.load();
        } catch (err) {
            toast.error(err.message);
        }
    }

    async approveApplication(row) {
        const done = await formOverlay({
            title: `Approve ${row.name}?`,
            variant: 'modal',
            size: 'sm',
            submitLabel: 'Approve',
            intro: 'Approving tells the family they have a place. They are not on the roll until they are enrolled into a batch.',
            fields: [{ name: 'note', label: 'Note', type: 'textarea', rows: 2 }],
            onSubmit: async (values) => approve(row.id, { note: values.note })
        });
        if (done) toast.success(`${row.name} approved. Enrol them into a batch next.`);
    }

    async rejectApplication(row) {
        const done = await formOverlay({
            title: `Reject ${row.name}?`,
            variant: 'modal',
            size: 'sm',
            submitLabel: 'Reject application',
            danger: true,
            fields: [{
                name: 'reason', label: 'Reason', type: 'textarea', rows: 3, required: true,
                hint: 'Kept on the record. A rejected application can be reopened later.'
            }],
            onSubmit: async (values) => reject(row.id, { reason: values.reason })
        });

        if (done) {
            toast.success('Application rejected.');
            await this.load();
        }
    }

    /**
     * Enrolment. The batch field is required here because the service requires
     * it — a student without a batch is the bug this rebuild exists to remove.
     */
    async enrol(row) {
        const batches = await eligibleBatches(row.level, row.branchId || session.branch());
        const selectable = batches.filter((b) => b.selectable);

        if (!selectable.length) {
            await confirm({
                title: 'No batch has room',
                message: `${row.name} is placed at ${row.level}, and no open batch at that level has a free seat. `
                    + 'Create a batch or free a seat first — enrolling without a batch would put this student on no register.',
                confirmLabel: 'Go to batches',
                cancelLabel: 'Not now'
            }).then((ok) => { if (ok) router.go('/batches'); });
            return;
        }

        const result = await formOverlay({
            title: `Enrol ${row.name}`,
            variant: 'modal',
            submitLabel: 'Enrol student',
            intro: 'This creates the student record, places them in the batch and raises their fees — all together, or not at all.',
            fields: [
                {
                    name: 'batchId', label: 'Batch', type: 'select', required: true,
                    value: row.preferredBatchId && selectable.some((b) => b.id === row.preferredBatchId)
                        ? row.preferredBatchId : '',
                    options: batches.map((batch) => ({
                        value: batch.id,
                        label: `${batch.name} — ${batch.schedule || ''}`,
                        note: batch.reason,
                        disabled: !batch.selectable
                    })),
                    hint: 'Required. A student with no batch appears on no roll call.'
                },
                {
                    name: 'feePlanId', label: 'Fee plan', type: 'select', value: row.feePlanId,
                    options: optionsFrom(this.reference.plans, {
                        label: (p) => p.name, note: (p) => `${formatMoney(p.amount)}/month`
                    })
                },
                { name: 'joinedOn', label: 'Joining date', type: 'date', value: localDate(), width: 'half' },
                { name: 'raiseFees', label: 'Raise the fee schedule now', type: 'switch', value: true, width: 'half' }
            ],
            onSubmit: async (values) => enrolApplicant(row.id, values)
        });

        if (!result) return;

        toast.success(`${result.student.name} is enrolled and on the register.`);
        if (result.billingError) {
            toast.warning(`The student is enrolled, but fees were not raised: ${result.billingError}. `
                + 'Raise them from the fee screen.');
        } else if (result.billing?.invoices?.length) {
            toast.info(`${result.billing.invoices.length} monthly fees raised.`);
        }

        await this.load();
    }
}
