/**
 * NATYAM ERP 2.0 — Batches
 *
 * A batch is where a level, a teacher, a room and a slot in the week meet. It
 * is also the thing that makes a student real: without one they are on no
 * register, which is why capacity and clashes are checked before anything is
 * written rather than discovered later by a teacher standing in a full hall.
 *
 * Conflict handling is worth noting. createBatch throws with a `conflicts`
 * array attached when a new batch would double-book a teacher or a room. This
 * page catches that, shows what it clashes with, and offers to save anyway —
 * because a school sometimes genuinely does run two things in one hall, and a
 * system that simply says "no" gets worked around outside the system.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { kpiCard } from '../../ui/chart.js';
import { toast } from '../../ui/toast.js';
import { drawer, confirm } from '../../ui/overlay.js';
import { DataTable } from '../../ui/table.js';
import { formOverlay, optionsFrom, summaryList } from '../../ui/form.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { router } from '../../core/router.js';
import { formatNumber } from '../../utils/money.js';
import { localDate } from '../../utils/date.js';
import { LEVELS } from '../../config/app.config.js';

import {
    WEEK, listBatches, batchDetail, createBatch, updateBatch, closeBatch, reopenBatch
} from '../../services/batches.service.js';
import { availableTeachers } from '../../services/staff.service.js';

const DAY_LABELS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

export default class BatchesPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Batches';
        this.includeClosed = false;
    }

    async render(container) {
        this.container = container;
        render(container, this.shell());
        this.bind();
        this.buildTable();
        await this.load();

        if (this.query.new) this.createBatch();
        if (this.query.batch) this.openBatch(this.query.batch);
    }

    shell() {
        return html`
            <header class="page-header">
                <div class="page-header-text">
                    <h1 class="page-title">Batches</h1>
                    <p class="page-subtitle" data-role="count">Loading…</p>
                </div>
                <div class="page-actions">
                    <a class="btn btn-secondary btn-sm" href="#/timetable">
                        ${raw(icon('calendar', { size: 15 }))} Timetable
                    </a>
                    ${session.can('student.edit') ? html`
                        <button class="btn btn-primary btn-sm" data-action="new">
                            ${raw(icon('plus', { size: 15 }))} New batch
                        </button>
                    ` : ''}
                </div>
            </header>
            <div class="page-body">
                <div class="filter-bar">
                    <label class="row row-tight">
                        <input type="checkbox" class="checkbox" data-role="closed">
                        <span class="type-caption">Include closed batches</span>
                    </label>
                </div>
                <div data-role="table"></div>
            </div>
        `;
    }

    bind() {
        this.onDispose(on(this.container, 'click', '[data-action="new"]', () => this.createBatch()));
        this.onDispose(on(this.container, 'change', '[data-role="closed"]', (_e, target) => {
            this.includeClosed = target.checked;
            this.load();
        }));

        [EVENTS.BATCH_CREATED, EVENTS.BATCH_UPDATED, EVENTS.STUDENT_CREATED, EVENTS.BRANCH_CHANGED]
            .filter(Boolean)
            .forEach((event) => this.events.on(event, () => this.load()));
    }

    buildTable() {
        this.table = new DataTable({
            rows: [],
            searchPlaceholder: 'Search batch, teacher or room…',
            defaultSort: 'name',
            emptyTitle: 'No batches yet',
            emptyMessage: 'A batch is what puts a student on a register. Create the first one.',
            emptyIcon: 'grid',
            emptyAction: session.can('student.edit')
                ? { label: 'New batch', onClick: () => this.createBatch() }
                : null,
            onRowClick: (row) => this.openBatch(row.id),
            columns: [
                {
                    key: 'name', label: 'Batch', sortable: true,
                    searchValue: (row) => `${row.name} ${row.code || ''} ${row.teacherName} ${row.room || ''}`,
                    render: (row) => html`
                        <div>
                            <span class="type-strong">${row.name}</span>
                            <div class="type-caption type-muted">${row.code || ''} · ${row.levelLabel}</div>
                        </div>
                    `
                },
                {
                    key: 'schedule', label: 'When', sortable: true,
                    render: (row) => html`
                        <div>
                            <span>${row.schedule}</span>
                            ${row.room ? html`<div class="type-caption type-muted">${row.room}</div>` : ''}
                        </div>
                    `
                },
                { key: 'teacherName', label: 'Teacher', sortable: true },
                {
                    key: 'enrolled', label: 'Seats', align: 'right', sortable: true,
                    render: (row) => html`
                        <div>
                            <span class="type-strong">${row.enrolled}${row.capacity ? ` / ${row.capacity}` : ''}</span>
                            ${row.capacity ? html`
                                <div class="meter meter-sm" role="img"
                                     aria-label="${row.occupancy}% full">
                                    <span class="meter-fill" style="width:${Math.min(100, row.occupancy)}%"
                                          data-tone="${row.occupancy >= 100 ? 'negative' : row.occupancy >= 80 ? 'caution' : 'positive'}"></span>
                                </div>
                            ` : ''}
                        </div>
                    `
                },
                {
                    key: 'attendanceRate', label: 'Attendance', align: 'right', sortable: true,
                    render: (row) => row.attendanceRate === null
                        ? html`<span class="type-muted">—</span>`
                        : html`<span class="badge ${row.attendanceRate >= 80 ? 'badge-success'
                            : row.attendanceRate >= 65 ? 'badge-warning' : 'badge-danger'}">${row.attendanceRate}%</span>`
                },
                {
                    key: 'status', label: 'Status', sortable: true,
                    render: (row) => html`<span class="badge ${row.status === 'active' ? 'badge-success' : 'badge-neutral'}">
                        ${row.status}</span>`
                }
            ]
        });

        this.table.mount(this.container.querySelector('[data-role="table"]'));
        this.onDispose(() => this.table.destroy());
    }

    async load() {
        try {
            const rows = await listBatches(session.branch(), { includeClosed: this.includeClosed });
            this.rows = rows;
            this.table.setRows(rows);

            const full = rows.filter((r) => r.capacity && r.enrolled >= r.capacity).length;
            const empty = rows.filter((r) => !r.enrolled).length;

            render(this.container.querySelector('[data-role="count"]'), html`
                ${formatNumber(rows.length)} batch${rows.length === 1 ? '' : 'es'}
                ${full ? `· ${full} full` : ''}
                ${empty ? `· ${empty} with nobody in them` : ''}
            `);
        } catch (err) {
            console.error(err);
            toast.error(err.message);
        }
    }

    /* ------------------------------------------------------------ CREATE/EDIT */

    async batchFields(existing = null) {
        const teachers = await availableTeachers({
            branchId: session.branch(),
            excludeBatchId: existing?.id || null
        });

        return [
            { name: 'name', label: 'Batch name', required: true, width: 'half', value: existing?.name,
              placeholder: 'Prarambhika Morning' },
            { name: 'code', label: 'Code', width: 'half', value: existing?.code, placeholder: 'PRA-M1',
              hint: 'Short label used on registers and reports.' },
            {
                name: 'level', label: 'Level', type: 'select', required: true, width: 'half', value: existing?.level,
                options: LEVELS.map((l) => ({ value: l.value, label: l.label })),
                hint: 'Only students at this level can be placed here.'
            },
            {
                name: 'teacherId', label: 'Teacher', type: 'select', width: 'half', value: existing?.teacherId,
                options: optionsFrom(teachers, {
                    label: (t) => t.name,
                    note: (t) => `${t.load} batch${t.load === 1 ? '' : 'es'} · ${t.weeklySessions} sessions a week`
                })
            },
            {
                name: 'days', label: 'Days', type: 'checkbox-group', required: true, value: existing?.days || [],
                options: WEEK.map((day) => ({ value: day, label: DAY_LABELS[day] || day })),
                hint: 'The register only exists on these days.'
            },
            { name: 'startTime', label: 'Starts', type: 'time', required: true, width: 'half', value: existing?.startTime },
            { name: 'endTime', label: 'Ends', type: 'time', required: true, width: 'half', value: existing?.endTime },
            { name: 'room', label: 'Room or hall', width: 'half', value: existing?.room },
            { name: 'capacity', label: 'Capacity', type: 'number', min: 1, max: 200, width: 'half',
              value: existing?.capacity, hint: 'Leave blank for no limit.' },
            { name: 'startsOn', label: 'Running since', type: 'date', width: 'half',
              value: existing?.startsOn || localDate() },
            { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, value: existing?.notes }
        ];
    }

    async createBatch() {
        session.require('student.edit', 'create a batch');
        const fields = await this.batchFields();

        const created = await formOverlay({
            title: 'New batch',
            description: 'A batch fixes a level, a teacher and a slot in the week.',
            fields,
            size: 'wide',
            submitLabel: 'Create batch',
            onSubmit: async (values, helpers) => this.saveWithConflictCheck(
                (allowConflicts) => createBatch(values, { allowConflicts }),
                helpers
            )
        });

        if (created) {
            toast.success(`${created.name} created.`);
            await this.load();
            this.openBatch(created.id);
        }
    }

    async editBatch(batch) {
        const fields = await this.batchFields(batch);

        const saved = await formOverlay({
            title: `Edit ${batch.name}`,
            fields,
            size: 'wide',
            onSubmit: async (values, helpers) => this.saveWithConflictCheck(
                (allowConflicts) => updateBatch(batch.id, values, { allowConflicts }),
                helpers
            )
        });

        if (saved) {
            toast.success('Batch updated.');
            await this.load();
        }
    }

    /**
     * The service refuses a clashing batch by throwing with the clashes
     * attached. Rather than swallowing that or forcing the user to guess, we
     * show what it collides with and let them decide — a school does sometimes
     * mean it.
     */
    async saveWithConflictCheck(attempt, helpers) {
        try {
            return await attempt(false);
        } catch (err) {
            if (!err.conflicts?.length) throw err;

            const proceed = await confirm({
                title: 'This clashes with another batch',
                message: err.conflicts.map((conflict) => conflict.message).join('\n'),
                confirmLabel: 'Save anyway',
                cancelLabel: 'Change the timing',
                danger: true
            });

            if (!proceed) {
                helpers.banner('Adjust the day, time, teacher or room and try again.');
                return { errors: {} };
            }
            return attempt(true);
        }
    }

    /* ---------------------------------------------------------------- DETAIL */

    async openBatch(id) {
        let detail;
        try {
            detail = await batchDetail(id);
        } catch (err) {
            toast.error(err.message);
            return;
        }

        const batch = detail.batch;

        await drawer({
            title: batch.name,
            description: `${batch.levelLabel} · ${batch.schedule} · ${detail.teacher?.name || 'no teacher assigned'}`,
            size: 'wide',
            content: html`
                ${detail.conflicts.length ? html`
                    <div class="alert alert-warning">
                        <div class="alert-title">Timetable clash</div>
                        <ul class="stack stack-xs">
                            ${detail.conflicts.map((conflict) => html`<li>${conflict.message}</li>`)}
                        </ul>
                    </div>
                ` : ''}

                ${!detail.teacher ? html`
                    <div class="alert alert-warning">
                        <p class="alert-body">No teacher is assigned. Nobody is responsible for marking this register.</p>
                    </div>
                ` : ''}

                <div class="grid grid-3">
                    ${kpiCard('On the roll', `${batch.enrolled}${batch.capacity ? ` / ${batch.capacity}` : ''}`,
                        batch.seatsLeft === null ? 'no limit set' : `${batch.seatsLeft} seats free`)}
                    ${kpiCard('Attendance, 60 days', detail.attendanceRate === null ? '—' : `${detail.attendanceRate}%`)}
                    ${kpiCard('Room', batch.room || 'Not set')}
                </div>

                <div class="card"><div class="card-body">
                    ${summaryList([
                        ['Code', batch.code],
                        ['Level', batch.levelLabel],
                        ['Schedule', batch.schedule],
                        ['Teacher', detail.teacher?.name],
                        ['Running since', batch.startsOn],
                        ['Status', batch.status],
                        ['Notes', batch.notes]
                    ])}
                </div></div>

                <div class="card">
                    <div class="card-header">
                        <h3 class="card-title">Roll</h3>
                        <p class="card-subtitle">Lowest attendance first — the ones worth a phone call.</p>
                    </div>
                    <div class="card-body card-body-tight">
                        ${detail.roster.length ? html`
                            <ul class="stack stack-sm">
                                ${detail.roster.map((student) => html`
                                    <li class="spread">
                                        <div>
                                            <span class="type-strong">${student.name}</span>
                                            <div class="type-caption type-muted">${student.admissionNo || ''}</div>
                                        </div>
                                        <div class="row row-tight">
                                            ${student.attendanceRate === null
                                                ? html`<span class="type-muted type-caption">not marked yet</span>`
                                                : html`<span class="badge ${student.attendanceRate >= 80 ? 'badge-success'
                                                    : student.attendanceRate >= 65 ? 'badge-warning' : 'badge-danger'}">
                                                    ${student.attendanceRate}%</span>`}
                                            <button class="btn btn-sm btn-ghost" data-student="${student.id}">Open</button>
                                        </div>
                                    </li>
                                `)}
                            </ul>
                        ` : html`
                            <div class="empty empty-compact">
                                <p class="empty-text">Nobody is in this batch yet.</p>
                                <a class="btn btn-sm btn-primary" href="#/students?filter=unplaced">Place students</a>
                            </div>
                        `}
                    </div>
                </div>
            `,
            actions: this.detailActions(batch),
            onMount: (body, api) => {
                on(body, 'click', '[data-student]', (_e, target) => {
                    api.close(null);
                    router.go(`/students?student=${target.dataset.student}`);
                });
            }
        });
    }

    detailActions(batch) {
        const actions = [
            { label: 'Close', variant: 'secondary', value: null },
            {
                label: 'Take register',
                variant: 'secondary',
                onClick: () => { router.go(`/attendance?batch=${batch.id}`); return null; }
            }
        ];

        if (!session.can('student.edit')) return actions;

        actions.push({
            label: batch.status === 'active' ? 'Close batch' : 'Reopen batch',
            variant: batch.status === 'active' ? 'danger-quiet' : 'secondary',
            onClick: async () => {
                await this.toggleStatus(batch);
                return null;
            }
        });

        actions.push({
            label: 'Edit',
            variant: 'primary',
            primary: true,
            onClick: async () => { await this.editBatch(batch); return null; }
        });

        return actions;
    }

    async toggleStatus(batch) {
        try {
            if (batch.status === 'active') {
                const ok = await confirm({
                    title: `Close ${batch.name}?`,
                    message: batch.enrolled
                        ? `${batch.enrolled} students are still in this batch. They must be moved elsewhere first, `
                          + 'or they will be left on no register.'
                        : 'The batch stops appearing on the timetable. Its attendance history is kept.',
                    confirmLabel: 'Close batch',
                    danger: true
                });
                if (!ok) return;
                await closeBatch(batch.id);
                toast.success(`${batch.name} closed.`);
            } else {
                await reopenBatch(batch.id);
                toast.success(`${batch.name} reopened.`);
            }
            await this.load();
        } catch (err) {
            toast.error(err.message);
        }
    }
}

