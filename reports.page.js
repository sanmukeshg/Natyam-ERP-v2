/**
 * NATYAM ERP 2.0 — Programmes and events
 *
 * Performances, workshops, competitions, examinations and rehearsals are one
 * entity distinguished by a `type` field, not five near-identical stores. In
 * 1.0 "events" and "programmes" were drifting apart into two half-built things
 * that shared 90% of their fields; the school never made the distinction the
 * software insisted on.
 *
 * Completing a programme posts its income and expenditure to the ledger, which
 * is why a ticketed performance shows up in the finance module without anyone
 * re-keying it.
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
import { formatDate, formatDateLong, localDate } from '../../utils/date.js';
import { PROGRAM_TYPES, LEVELS } from '../../config/app.config.js';

import {
    PROGRAM_STATUS, schedule, updateProgram, complete, cancel,
    setParticipants, eligibleStudents, listPrograms, programDetail, programSummary
} from '../../services/programs.service.js';
import { listBranches } from '../../services/settings.service.js';
import { listStaff } from '../../services/staff.service.js';

const STATUS_BADGE = {
    scheduled: 'badge-info',
    running: 'badge-warning',
    completed: 'badge-success',
    cancelled: 'badge-neutral'
};

export default class ProgramsPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Programmes';
        this.filters = { type: this.query.type || '', status: this.query.status || '' };
    }

    async render(container) {
        this.container = container;
        render(container, this.shell());
        this.bind();

        const [branches, staff] = await Promise.all([listBranches(), listStaff(session.branch())]);
        this.reference = { branches, staff };

        this.buildTable();
        await this.load();

        if (this.query.new) this.scheduleProgram();
    }

    shell() {
        return html`
            <header class="page-header">
                <div class="page-header-text">
                    <h1 class="page-title">Programmes</h1>
                    <p class="page-subtitle" data-role="subtitle">
                        Performances, workshops, competitions and examinations.
                    </p>
                </div>
                <div class="page-actions">
                    ${session.can('program.edit') ? html`
                        <button class="btn btn-primary btn-sm" data-action="new">
                            ${raw(icon('plus', { size: 15 }))} Schedule
                        </button>
                    ` : ''}
                </div>
            </header>
            <div class="page-body">
                <div data-role="summary"></div>
                <div class="filter-bar">
                    <div class="row row-wrap">
                        <label class="filter-control">
                            <span class="sr-only">Type</span>
                            <select class="select select-sm" data-filter="type">
                                <option value="">All types</option>
                                ${PROGRAM_TYPES.map((type) => html`
                                    <option value="${type.value}" ${this.filters.type === type.value ? 'selected' : ''}>
                                        ${type.label}
                                    </option>
                                `)}
                            </select>
                        </label>
                        <label class="filter-control">
                            <span class="sr-only">Status</span>
                            <select class="select select-sm" data-filter="status">
                                <option value="">All statuses</option>
                                ${Object.values(PROGRAM_STATUS).map((status) => html`
                                    <option value="${status}" ${this.filters.status === status ? 'selected' : ''}>
                                        ${status}
                                    </option>
                                `)}
                            </select>
                        </label>
                    </div>
                </div>
                <div data-role="table"></div>
            </div>
        `;
    }

    bind() {
        this.onDispose(on(this.container, 'click', '[data-action="new"]', () => this.scheduleProgram()));
        this.onDispose(on(this.container, 'change', '[data-filter]', (_e, target) => {
            this.filters[target.dataset.filter] = target.value;
            this.load();
        }));

        // PROGRAM_SCHEDULED, not PROGRAM_CREATED — the latter does not exist, so
        // this list previously registered a listener on `undefined` and the
        // screen never refreshed after a programme was scheduled.
        [EVENTS.PROGRAM_SCHEDULED, EVENTS.PROGRAM_UPDATED, EVENTS.PROGRAM_COMPLETED,
         EVENTS.BRANCH_CHANGED]
            .forEach((event) => this.events.on(event, () => this.load()));
    }

    buildTable() {
        this.table = new DataTable({
            rows: [],
            searchPlaceholder: 'Search programme, venue or lead…',
            defaultSort: 'date',
            defaultSortDir: 'desc',
            emptyTitle: 'Nothing scheduled',
            emptyMessage: 'Performances, workshops and examinations appear here once scheduled.',
            emptyIcon: 'star',
            emptyAction: session.can('program.edit')
                ? { label: 'Schedule one', onClick: () => this.scheduleProgram() }
                : null,
            onRowClick: (row) => this.openProgram(row.id),
            columns: [
                {
                    key: 'name', label: 'Programme', sortable: true,
                    searchValue: (row) => `${row.name} ${row.venue || ''} ${row.leadName || ''}`,
                    render: (row) => html`
                        <div>
                            <span class="type-strong">${row.name}</span>
                            <div class="type-caption type-muted">
                                ${row.typeLabel}${row.venue ? ` · ${row.venue}` : ''}
                            </div>
                        </div>
                    `
                },
                {
                    key: 'date', label: 'When', sortable: true,
                    render: (row) => html`
                        <div>
                            <span>${formatDate(row.date)}</span>
                            ${row.daysAway !== null ? html`
                                <div class="type-caption ${row.daysAway <= 14 ? '' : 'type-muted'}"
                                     ${row.daysAway <= 14 ? 'data-tone="caution"' : ''}>
                                    in ${row.daysAway} day${row.daysAway === 1 ? '' : 's'}
                                </div>
                            ` : ''}
                        </div>
                    `
                },
                { key: 'branchName', label: 'Branch', sortable: true },
                {
                    key: 'leadName', label: 'Lead', sortable: true,
                    render: (row) => row.leadName || html`<span class="type-muted">Unassigned</span>`
                },
                {
                    key: 'participantCount', label: 'Cast', align: 'right', sortable: true,
                    render: (row) => row.participantCount
                        ? html`<span>${formatNumber(row.participantCount)}</span>`
                        : html`<span class="type-muted">—</span>`
                },
                {
                    key: 'status', label: 'Status', sortable: true,
                    render: (row) => html`<span class="badge ${STATUS_BADGE[row.status] || 'badge-neutral'}">
                        ${row.status}</span>`
                }
            ]
        });

        this.table.mount(this.container.querySelector('[data-role="table"]'));
        this.onDispose(() => this.table.destroy());
    }

    async load() {
        try {
            const [rows, stats] = await Promise.all([
                listPrograms(session.branch(), {
                    type: this.filters.type || null,
                    status: this.filters.status || null
                }),
                programSummary(session.branch())
            ]);

            this.rows = rows;
            this.table.setRows(rows);

            render(this.container.querySelector('[data-role="subtitle"]'), html`
                ${formatNumber(stats.upcoming)} coming up
                ${stats.nextUp ? `· next is ${stats.nextUp.name} on ${formatDate(stats.nextUp.date)}` : ''}
            `);

            render(this.container.querySelector('[data-role="summary"]'), html`
                <div class="grid grid-4">
                    ${kpiCard('Upcoming', formatNumber(stats.upcoming))}
                    ${kpiCard('This year', formatNumber(stats.thisYear), `${formatNumber(stats.completed)} completed`)}
                    ${kpiCard('Students involved', formatNumber(stats.participantsEngaged), 'this year')}
                    ${kpiCard('Cancelled', formatNumber(stats.cancelled), null, { tone: stats.cancelled ? 'caution' : 'positive' })}
                </div>
            `);
        } catch (err) {
            console.error(err);
            toast.error(err.message);
        }
    }

    /* -------------------------------------------------------------- SCHEDULE */

    programFields(existing = null) {
        return [
            { name: 'name', label: 'Name', required: true, value: existing?.name,
              placeholder: 'Annual Day Performance' },
            {
                name: 'type', label: 'Type', type: 'select', required: true, width: 'half',
                value: existing?.type || 'performance',
                options: PROGRAM_TYPES.map((type) => ({ value: type.value, label: type.label })),
                hint: 'An examination is held for one level and needs that level set.'
            },
            { name: 'date', label: 'Date', type: 'date', required: true, width: 'half',
              value: existing?.date || localDate() },
            { name: 'startTime', label: 'Starts', type: 'time', width: 'half', value: existing?.startTime },
            { name: 'endTime', label: 'Ends', type: 'time', width: 'half', value: existing?.endTime },
            { name: 'venue', label: 'Venue', width: 'half', value: existing?.venue },
            {
                name: 'branchId', label: 'Branch', type: 'select', required: true, width: 'half',
                value: existing?.branchId || session.branch(),
                options: optionsFrom(this.reference.branches, { label: (b) => b.name })
            },
            {
                name: 'level', label: 'Level', type: 'select', width: 'half', value: existing?.level,
                placeholder: 'All levels',
                options: LEVELS.map((l) => ({ value: l.value, label: l.label })),
                hint: 'Required for an examination.'
            },
            {
                name: 'leadStaffId', label: 'Lead', type: 'select', width: 'half', value: existing?.leadStaffId,
                options: optionsFrom(this.reference.staff, {
                    label: (s) => s.name, note: (s) => s.roleLabel || s.role
                })
            },
            { name: 'description', label: 'Description', type: 'textarea', rows: 3, value: existing?.description }
        ];
    }

    async scheduleProgram() {
        session.require('program.edit', 'schedule a programme');

        const created = await formOverlay({
            title: 'Schedule a programme',
            fields: this.programFields(),
            size: 'wide',
            submitLabel: 'Schedule',
            onSubmit: async (values) => schedule(values)
        });

        if (created) {
            toast.success(`${created.name} scheduled.`);
            await this.load();
            this.openProgram(created.id);
        }
    }

    async editProgram(program) {
        const saved = await formOverlay({
            title: `Edit ${program.name}`,
            fields: this.programFields(program),
            size: 'wide',
            onSubmit: async (values) => updateProgram(program.id, values)
        });

        if (saved) {
            toast.success('Programme updated.');
            await this.load();
        }
    }

    /* ---------------------------------------------------------------- DETAIL */

    async openProgram(id) {
        let detail;
        try {
            detail = await programDetail(id);
        } catch (err) {
            toast.error(err.message);
            return;
        }

        const program = detail.program;

        await drawer({
            title: program.name,
            description: `${program.typeLabel} · ${formatDateLong(program.date)}`
                + `${program.venue ? ` · ${program.venue}` : ''}`,
            size: 'wide',
            content: html`
                ${program.status === PROGRAM_STATUS.CANCELLED ? html`
                    <div class="alert alert-warning">
                        <div class="alert-title">Cancelled</div>
                        <p class="alert-body">${program.cancellationReason || 'No reason recorded.'}</p>
                    </div>
                ` : ''}

                <div class="grid grid-3">
                    ${kpiCard('Cast', formatNumber(detail.participants.length))}
                    ${kpiCard('Status', program.status)}
                    ${kpiCard(program.daysAway === null ? 'Held' : 'Days away',
                        program.daysAway === null ? formatDate(program.date) : formatNumber(program.daysAway))}
                </div>

                <div class="card"><div class="card-body">
                    ${summaryList([
                        ['Type', program.typeLabel],
                        ['Date', formatDateLong(program.date)],
                        ['Time', program.startTime ? `${program.startTime}–${program.endTime || ''}` : null],
                        ['Venue', program.venue],
                        ['Branch', detail.branch?.name],
                        ['Lead', detail.lead?.name],
                        ['Level', LEVELS.find((l) => l.value === program.level)?.label],
                        ['Description', program.description],
                        ...(program.status === PROGRAM_STATUS.COMPLETED ? [
                            ['Attendees', program.attendees],
                            ['Income', program.income ? formatMoney(program.income) : null],
                            ['Expenditure', program.expenditure ? formatMoney(program.expenditure) : null],
                            ['Notes', program.completionNotes]
                        ] : [])
                    ])}
                </div></div>

                <div class="card">
                    <div class="card-header">
                        <h3 class="card-title">Cast</h3>
                        ${detail.byLevel.length ? html`
                            <p class="card-subtitle">
                                ${detail.byLevel.map((row) => `${row.count} ${row.label}`).join(' · ')}
                            </p>
                        ` : ''}
                        ${session.can('program.edit') && program.status === PROGRAM_STATUS.SCHEDULED ? html`
                            <div class="card-actions">
                                <button class="btn btn-sm btn-secondary" data-action="cast">Choose cast</button>
                            </div>
                        ` : ''}
                    </div>
                    <div class="card-body card-body-tight">
                        ${detail.participants.length ? html`
                            <ul class="stack stack-sm">
                                ${detail.participants.map((student) => html`
                                    <li class="spread">
                                        <div>
                                            <span class="type-strong">${student.name}</span>
                                            <div class="type-caption type-muted">${student.level}</div>
                                        </div>
                                        <button class="btn btn-sm btn-ghost"
                                                data-student="${student.id}">Open</button>
                                    </li>
                                `)}
                            </ul>
                        ` : html`<p class="type-muted">Nobody has been cast yet.</p>`}
                    </div>
                </div>
            `,
            actions: this.programActions(detail),
            onMount: (body, api) => {
                on(body, 'click', '[data-student]', (_e, target) => {
                    api.close(null);
                    router.go(`/students?student=${target.dataset.student}`);
                });
                on(body, 'click', '[data-action="cast"]', async () => {
                    api.close(null);
                    await this.chooseCast(detail);
                });
            }
        });
    }

    programActions(detail) {
        const program = detail.program;
        const actions = [{ label: 'Close', variant: 'secondary', value: null }];
        if (!session.can('program.edit')) return actions;

        if (program.status === PROGRAM_STATUS.SCHEDULED) {
            actions.push({
                label: 'Cancel',
                variant: 'danger-quiet',
                onClick: async () => { await this.cancelProgram(program); return null; }
            });
            actions.push({
                label: 'Mark complete',
                variant: 'primary',
                primary: true,
                onClick: async () => { await this.completeProgram(program); return null; }
            });
        } else {
            actions.push({
                label: 'Edit',
                variant: 'primary',
                primary: true,
                onClick: async () => { await this.editProgram(program); return null; }
            });
        }

        return actions;
    }

    /**
     * Casting is a multi-select over the students the service says are
     * eligible — the page never decides who may take part, it only draws the
     * list it is given.
     */
    async chooseCast(detail) {
        const program = detail.program;
        const students = await eligibleStudents(program.id);
        const chosen = new Set((program.participants || []));

        await drawer({
            title: `Cast for ${program.name}`,
            description: `${students.length} eligible students`,
            size: 'md',
            content: html`
                <div class="filter-bar">
                    <input class="input input-sm" type="search" data-role="search"
                           placeholder="Search students…" aria-label="Search students">
                    <div class="row row-tight">
                        <button class="btn btn-sm btn-secondary" data-bulk="all">Select all</button>
                        <button class="btn btn-sm btn-secondary" data-bulk="none">Clear</button>
                    </div>
                </div>
                <ul class="stack stack-xs" data-role="list">
                    ${students.map((student) => html`
                        <li>
                            <label class="check check-block" data-name="${student.name.toLowerCase()}">
                                <input type="checkbox" value="${student.id}"
                                       ${chosen.has(student.id) ? 'checked' : ''}>
                                <span>
                                    <span class="type-strong">${student.name}</span>
                                    <span class="type-caption type-muted">
                                        ${student.level}${student.batchName ? ` · ${student.batchName}` : ''}
                                    </span>
                                </span>
                            </label>
                        </li>
                    `)}
                </ul>
            `,
            actions: [
                { label: 'Cancel', variant: 'secondary', value: null },
                {
                    label: 'Save cast',
                    variant: 'primary',
                    primary: true,
                    onClick: async ({ body }) => {
                        const ids = [...body.querySelectorAll('input[type="checkbox"]:checked')]
                            .map((input) => input.value);
                        try {
                            await setParticipants(program.id, ids);
                            toast.success(`${ids.length} students cast.`);
                            await this.load();
                            return ids;
                        } catch (err) {
                            toast.error(err.message);
                            return false;
                        }
                    }
                }
            ],
            onMount: (body) => {
                on(body, 'input', '[data-role="search"]', (_e, target) => {
                    const term = target.value.trim().toLowerCase();
                    body.querySelectorAll('[data-name]').forEach((label) => {
                        label.closest('li').hidden = term && !label.dataset.name.includes(term);
                    });
                });
                on(body, 'click', '[data-bulk]', (_e, target) => {
                    const check = target.dataset.bulk === 'all';
                    body.querySelectorAll('li:not([hidden]) input[type="checkbox"]')
                        .forEach((input) => { input.checked = check; });
                });
            }
        });
    }

    async completeProgram(program) {
        const done = await formOverlay({
            title: `Complete ${program.name}`,
            submitLabel: 'Mark complete',
            intro: 'Income and expenditure recorded here post straight to the finance ledger.',
            fields: [
                { name: 'attendees', label: 'People who came', type: 'number', min: 0, width: 'half' },
                { name: 'income', label: 'Income taken', type: 'money', width: 'half',
                  hint: 'Ticket sales, entry fees.' },
                { name: 'expenditure', label: 'Money spent', type: 'money', width: 'half',
                  hint: 'Hall hire, costumes, musicians.' },
                { name: 'notes', label: 'Notes', type: 'textarea', rows: 3,
                  hint: 'What went well, what to do differently. Read before the next one.' }
            ],
            onSubmit: async (values) => complete(program.id, values)
        });

        if (done) {
            toast.success(`${program.name} marked complete.`);
            await this.load();
        }
    }

    async cancelProgram(program) {
        const done = await formOverlay({
            title: `Cancel ${program.name}?`,
            variant: 'modal',
            size: 'sm',
            submitLabel: 'Cancel programme',
            danger: true,
            intro: 'The record stays, with the reason attached. Families already told will need to hear from you.',
            fields: [{ name: 'reason', label: 'Reason', type: 'textarea', rows: 3, required: true }],
            onSubmit: async (values) => cancel(program.id, { reason: values.reason })
        });

        if (done) {
            toast.success('Programme cancelled.');
            await this.load();
        }
    }
}

