/**
 * NATYAM ERP 2.0 — Attendance
 *
 * Two screens in one route: the day board (which registers are done, which are
 * not) and the register itself.
 *
 * The register is the most-used screen in the whole ERP — a teacher opens it
 * on a phone, at the edge of a hall, with thirty children waiting. So it is
 * built for one-handed speed: everybody starts present, marking is one tap per
 * exception, and the save is a single atomic post rather than a write per
 * child. Nothing here decides what a valid mark is; postRegister does, and it
 * refuses backdating beyond thirty days whatever this page sends it.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { drawer, confirm } from '../../ui/overlay.js';
import { formOverlay } from '../../ui/form.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { formatNumber } from '../../utils/money.js';
import { formatDate, formatDateLong, localDate, addDays, monthKey, formatMonth } from '../../utils/date.js';
import { ATTENDANCE_STATUS } from '../../config/app.config.js';

import {
    openRegister, dayBoard, postRegister, declareHoliday,
    monthlyGrid, decideLeave, requestLeave, missingRegisters
} from '../../services/attendance.service.js';
import { listBatches } from '../../services/batches.service.js';

const MARKS = [
    { value: ATTENDANCE_STATUS.PRESENT, label: 'Present', short: 'P', tone: 'positive' },
    { value: ATTENDANCE_STATUS.ABSENT, label: 'Absent', short: 'A', tone: 'negative' },
    { value: ATTENDANCE_STATUS.LATE, label: 'Late', short: 'L', tone: 'caution' },
    { value: ATTENDANCE_STATUS.EXCUSED, label: 'Excused', short: 'E', tone: 'neutral' }
];

export default class AttendancePage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Attendance';
        this.date = this.query.date || localDate();
        this.batchId = this.query.batch || null;
        this.register = null;
    }

    async render(container) {
        this.container = container;
        render(container, this.shell());
        this.bind();

        if (this.batchId) await this.openBatchRegister(this.batchId);
        else await this.loadBoard();
    }

    shell() {
        return html`
            <header class="page-header">
                <div class="page-header-text">
                    <h1 class="page-title" data-role="title">Attendance</h1>
                    <p class="page-subtitle" data-role="subtitle">${formatDateLong(this.date)}</p>
                </div>
                <div class="page-actions">
                    <div class="row row-tight">
                        <button class="btn btn-secondary btn-icon btn-sm" data-shift="-1"
                                aria-label="Previous day">${raw(icon('chevron-left', { size: 15 }))}</button>
                        <input class="input input-sm" type="date" value="${this.date}" data-role="date"
                               aria-label="Date">
                        <button class="btn btn-secondary btn-icon btn-sm" data-shift="1"
                                aria-label="Next day">${raw(icon('chevron-right', { size: 15 }))}</button>
                    </div>
                    <button class="btn btn-secondary btn-sm" data-action="month">
                        ${raw(icon('calendar', { size: 15 }))} Month view
                    </button>
                    ${session.can('attendance.mark') ? html`
                        <button class="btn btn-secondary btn-sm" data-action="holiday">Declare holiday</button>
                    ` : ''}
                </div>
            </header>
            <div class="page-body" data-role="body"></div>
        `;
    }

    bind() {
        this.onDispose(on(this.container, 'change', '[data-role="date"]', (_e, target) => {
            this.date = target.value;
            this.batchId ? this.openBatchRegister(this.batchId) : this.loadBoard();
        }));
        this.onDispose(on(this.container, 'click', '[data-shift]', (_e, target) => {
            this.date = addDays(this.date, Number(target.dataset.shift));
            const input = this.container.querySelector('[data-role="date"]');
            if (input) input.value = this.date;
            this.batchId ? this.openBatchRegister(this.batchId) : this.loadBoard();
        }));
        this.onDispose(on(this.container, 'click', '[data-action="holiday"]', () => this.declareHoliday()));
        this.onDispose(on(this.container, 'click', '[data-action="month"]', () => this.monthView()));
        this.onDispose(on(this.container, 'click', '[data-open-batch]', (_e, target) =>
            this.openBatchRegister(target.dataset.openBatch)));
        this.onDispose(on(this.container, 'click', '[data-action="back"]', () => {
            this.batchId = null;
            this.loadBoard();
        }));

        this.events.on(EVENTS.BRANCH_CHANGED, () => { this.batchId = null; this.loadBoard(); });
    }

    /* ------------------------------------------------------------- DAY BOARD */

    async loadBoard() {
        const body = this.container.querySelector('[data-role="body"]');
        render(body, html`<div class="skeleton skeleton-row"></div>`);

        try {
            const [board, missing] = await Promise.all([
                dayBoard(this.date, session.branch()),
                missingRegisters({ days: 7, branchId: session.branch() })
            ]);

            render(this.container.querySelector('[data-role="title"]'), 'Attendance');
            render(this.container.querySelector('[data-role="subtitle"]'),
                `${formatDateLong(this.date)} · ${board.batches.filter((b) => b.done).length} of ${board.batches.length} registers marked`);

            render(body, this.boardView(board, missing));
        } catch (err) {
            console.error(err);
            toast.error(err.message);
        }
    }

    boardView(board, missing) {
        if (board.holiday) {
            return html`
                <div class="card"><div class="card-body">
                    <div class="empty">
                        <div class="empty-glyph">${raw(icon('sun'))}</div>
                        <h2 class="empty-title">${board.holiday.name}</h2>
                        <p class="empty-text">No classes run on ${formatDateLong(this.date)}.</p>
                    </div>
                </div></div>
            `;
        }

        return html`
            ${missing.length ? html`
                <div class="alert alert-warning">
                    <div class="alert-title">${missing.length} register${missing.length === 1 ? '' : 's'} unmarked this week</div>
                    <ul class="stack stack-xs mt-2">
                        ${missing.slice(0, 5).map((entry) => html`
                            <li class="spread">
                                <span>${entry.batch.name} · ${formatDate(entry.date)}</span>
                                <button class="btn btn-sm btn-secondary"
                                        data-open-batch="${entry.batch.id}">Mark</button>
                            </li>
                        `)}
                    </ul>
                </div>
            ` : ''}

            ${board.batches.length ? html`
                <div class="grid grid-3">
                    ${board.batches.map((batch) => html`
                        <button class="card card-interactive" data-open-batch="${batch.id}">
                            <div class="card-body">
                                <div class="spread">
                                    <h3 class="card-title">${batch.name}</h3>
                                    <span class="badge ${batch.done ? 'badge-success' : 'badge-warning'}">
                                        ${batch.done ? 'Marked' : 'Pending'}
                                    </span>
                                </div>
                                <p class="card-subtitle">
                                    ${batch.startTime}–${batch.endTime} · ${batch.teacherName}
                                    ${batch.room ? `· ${batch.room}` : ''}
                                </p>
                                <div class="divider"></div>
                                <div class="spread">
                                    <span class="type-caption type-muted">
                                        ${formatNumber(batch.expected)} on the roll
                                    </span>
                                    <span class="type-strong">
                                        ${batch.done ? `${batch.rate}% present` : 'Not marked'}
                                    </span>
                                </div>
                            </div>
                        </button>
                    `)}
                </div>
            ` : html`
                <div class="card"><div class="card-body">
                    <div class="empty">
                        <div class="empty-glyph">${raw(icon('calendar'))}</div>
                        <h2 class="empty-title">No batches meet on ${formatDate(this.date)}</h2>
                        <p class="empty-text">Pick another date, or check the timetable.</p>
                        <div class="empty-actions">
                            <a class="btn btn-secondary" href="#/timetable">Open timetable</a>
                        </div>
                    </div>
                </div></div>
            `}
        `;
    }

    /* -------------------------------------------------------------- REGISTER */

    async openBatchRegister(batchId) {
        this.batchId = batchId;
        const body = this.container.querySelector('[data-role="body"]');
        render(body, html`<div class="skeleton skeleton-row"></div>`);

        try {
            this.register = await openRegister(batchId, this.date);
        } catch (err) {
            toast.error(err.message);
            this.batchId = null;
            return this.loadBoard();
        }

        render(this.container.querySelector('[data-role="title"]'), this.register.batch.name);
        render(this.container.querySelector('[data-role="subtitle"]'),
            `${this.register.dayName}, ${formatDateLong(this.date)} · ${this.register.entries.length} students`);

        this.paintRegister();
        return undefined;
    }

    paintRegister() {
        const body = this.container.querySelector('[data-role="body"]');
        const reg = this.register;
        const canEdit = session.can('attendance.mark');

        render(body, html`
            <div class="row row-wrap">
                <button class="btn btn-sm btn-ghost" data-action="back">
                    ${raw(icon('arrow-left', { size: 15 }))} All registers
                </button>
            </div>

            ${reg.holiday ? html`
                <div class="alert alert-info">
                    <p class="alert-body">${formatDate(this.date)} is a holiday — ${reg.holiday.name}.
                    Marking is still possible if the class went ahead.</p>
                </div>
            ` : ''}

            ${!reg.meetsToday ? html`
                <div class="alert alert-warning">
                    <p class="alert-body">${reg.batch.name} does not normally meet on a ${reg.dayName}.
                    You can still mark a make-up class.</p>
                </div>
            ` : ''}

            ${reg.alreadyMarked ? html`
                <div class="alert alert-info">
                    <p class="alert-body">This register was already marked. Saving again records a correction.</p>
                </div>
            ` : ''}

            ${reg.empty ? html`
                <div class="card"><div class="card-body">
                    <div class="empty">
                        <div class="empty-glyph">${raw(icon('users'))}</div>
                        <h2 class="empty-title">Nobody is in this batch</h2>
                        <p class="empty-text">Students must be placed in the batch before a register exists.</p>
                        <div class="empty-actions">
                            <a class="btn btn-primary" href="#/students?filter=unplaced">Place students</a>
                        </div>
                    </div>
                </div></div>
            ` : html`
                <section class="card">
                    <div class="card-header">
                        <div>
                            <h2 class="card-title">Roll call</h2>
                            <p class="card-subtitle" data-role="tally"></p>
                        </div>
                        ${canEdit ? html`
                            <div class="card-actions">
                                <button class="btn btn-sm btn-secondary" data-all="present">All present</button>
                                <button class="btn btn-sm btn-secondary" data-all="absent">All absent</button>
                            </div>
                        ` : ''}
                    </div>
                    <div class="card-body card-body-flush">
                        <ul class="register">
                            ${reg.entries.map((entry, index) => html`
                                <li class="register-row" data-student="${entry.studentId}">
                                    <div class="register-who">
                                        <span class="type-caption type-muted">${index + 1}</span>
                                        <div>
                                            <span class="type-strong">${entry.name}</span>
                                            <div class="type-caption type-muted">
                                                ${entry.admissionNo || ''}
                                                ${entry.onLeave ? '· approved leave' : ''}
                                                ${entry.medicalNotes ? '· medical note' : ''}
                                            </div>
                                        </div>
                                    </div>
                                    <div class="register-marks" role="group" aria-label="Mark ${entry.name}">
                                        ${MARKS.map((mark) => html`
                                            <button type="button"
                                                    class="mark-btn ${entry.status === mark.value ? 'is-active' : ''}"
                                                    data-tone="${mark.tone}"
                                                    data-mark="${mark.value}"
                                                    ${canEdit ? '' : 'disabled'}
                                                    aria-pressed="${entry.status === mark.value}"
                                                    title="${mark.label}">
                                                <span aria-hidden="true">${mark.short}</span>
                                                <span class="sr-only">${mark.label}</span>
                                            </button>
                                        `)}
                                    </div>
                                </li>
                            `)}
                        </ul>
                    </div>
                    ${canEdit ? html`
                        <div class="card-footer spread">
                            <span class="type-caption type-muted">
                                Saved in one go — a half-written register is never left behind.
                            </span>
                            <button class="btn btn-primary" data-action="save">
                                ${reg.alreadyMarked ? 'Save correction' : 'Save register'}
                            </button>
                        </div>
                    ` : ''}
                </section>
            `}
        `);

        this.updateTally();
        this.bindRegister();
    }

    bindRegister() {
        const body = this.container.querySelector('[data-role="body"]');

        this.registerDisposers?.forEach((fn) => fn());
        this.registerDisposers = [
            on(body, 'click', '[data-mark]', (_e, target) => {
                const row = target.closest('[data-student]');
                const entry = this.register.entries.find((e) => e.studentId === row.dataset.student);
                entry.status = target.dataset.mark;

                row.querySelectorAll('[data-mark]').forEach((button) => {
                    const active = button.dataset.mark === entry.status;
                    button.classList.toggle('is-active', active);
                    button.setAttribute('aria-pressed', String(active));
                });
                this.updateTally();
            }),
            on(body, 'click', '[data-all]', (_e, target) => {
                const status = target.dataset.all === 'present'
                    ? ATTENDANCE_STATUS.PRESENT : ATTENDANCE_STATUS.ABSENT;
                this.register.entries.forEach((entry) => { entry.status = status; });
                this.paintRegister();
            }),
            on(body, 'click', '[data-action="save"]', () => this.save())
        ];

        this.onDispose(() => this.registerDisposers.forEach((fn) => fn()));
    }

    updateTally() {
        const slot = this.container.querySelector('[data-role="tally"]');
        if (!slot || !this.register) return;

        const counts = MARKS.map((mark) => ({
            ...mark,
            count: this.register.entries.filter((entry) => entry.status === mark.value).length
        }));

        render(slot, html`${counts.filter((c) => c.count).map((c) => `${c.count} ${c.label.toLowerCase()}`).join(' · ')}`);
    }

    async save() {
        try {
            const result = await postRegister({
                batchId: this.register.batch.id,
                date: this.date,
                entries: this.register.entries.map((entry) => ({
                    studentId: entry.studentId,
                    status: entry.status,
                    note: entry.note || null
                }))
            });

            toast.success(result?.corrections
                ? `Register corrected — ${result.corrections} mark${result.corrections === 1 ? '' : 's'} changed.`
                : 'Register saved.');

            await this.openBatchRegister(this.register.batch.id);
        } catch (err) {
            toast.error(err.message);
        }
    }

    /* ------------------------------------------------------------- MONTH VIEW */

    async monthView() {
        const batches = await listBatches(session.branch());
        if (!batches.length) {
            toast.info('There are no batches to show.');
            return;
        }

        let batchId = this.batchId || batches[0].id;
        let month = monthKey(this.date);

        await drawer({
            title: 'Month view',
            description: 'Every meeting day in the month, per student.',
            size: 'wide',
            content: html`
                <div class="filter-bar">
                    <div class="row row-wrap">
                        <label class="filter-control">
                            <span class="sr-only">Batch</span>
                            <select class="select select-sm" data-role="batch">
                                ${batches.map((batch) => html`
                                    <option value="${batch.id}" ${batch.id === batchId ? 'selected' : ''}>
                                        ${batch.name}
                                    </option>
                                `)}
                            </select>
                        </label>
                        <label class="filter-control">
                            <span class="sr-only">Month</span>
                            <input class="input input-sm" type="month" value="${month}" data-role="month">
                        </label>
                    </div>
                </div>
                <div data-role="grid"><p class="type-muted">Loading…</p></div>
            `,
            actions: [{ label: 'Close', variant: 'secondary', value: null }],
            onMount: (body) => {
                const paint = async () => {
                    const slot = body.querySelector('[data-role="grid"]');
                    render(slot, html`<div class="skeleton skeleton-row"></div>`);
                    try {
                        const grid = await monthlyGrid({ batchId, month });
                        render(slot, this.gridView(grid));
                    } catch (err) {
                        render(slot, html`<div class="alert alert-danger"><p class="alert-body">${err.message}</p></div>`);
                    }
                };

                on(body, 'change', '[data-role="batch"]', (_e, target) => { batchId = target.value; paint(); });
                on(body, 'change', '[data-role="month"]', (_e, target) => { month = target.value; paint(); });
                paint();
            }
        });
    }

    gridView(grid) {
        if (!grid.days.length) {
            return html`<div class="empty empty-compact">
                <p class="empty-text">${grid.batch.name} has no meeting days yet in ${formatMonth(grid.month)}.</p>
            </div>`;
        }

        return html`
            <div class="table-wrap">
                <table class="table table-pin-first table-compact">
                    <caption class="sr-only">
                        Attendance for ${grid.batch.name}, ${formatMonth(grid.month)}
                    </caption>
                    <thead>
                        <tr>
                            <th scope="col">Student</th>
                            ${grid.days.map((day) => html`
                                <th scope="col" class="text-center" ${day.holiday ? 'data-tone="muted"' : ''}
                                    title="${formatDate(day.date)}">${day.day}</th>
                            `)}
                            <th scope="col" class="text-right">Rate</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${grid.rows.map((row) => html`
                            <tr>
                                <th scope="row">${row.student.name}</th>
                                ${row.cells.map((cell) => {
                                    const meta = MARKS.find((m) => m.value === cell);
                                    return html`<td class="text-center">
                                        ${meta
                                            ? html`<span class="mark-dot" data-tone="${meta.tone}"
                                                         title="${meta.label}">${meta.short}</span>`
                                            : html`<span class="type-muted" aria-label="not marked">\u00b7</span>`}
                                    </td>`;
                                })}
                                <td class="text-right">
                                    ${row.rate === null
                                        ? html`<span class="type-muted">—</span>`
                                        : html`<span class="badge ${row.rate >= 80 ? 'badge-success'
                                            : row.rate >= 65 ? 'badge-warning' : 'badge-danger'}">${row.rate}%</span>`}
                                </td>
                            </tr>
                        `)}
                    </tbody>
                </table>
            </div>
            <p class="type-caption type-muted mt-2">
                Only days this batch meets appear as columns.
            </p>
        `;
    }

    /* --------------------------------------------------------------- HOLIDAY */

    async declareHoliday() {
        const done = await formOverlay({
            title: 'Declare a holiday',
            variant: 'modal',
            size: 'sm',
            submitLabel: 'Declare holiday',
            intro: 'Every batch meeting that day is marked as a holiday, so the registers do not sit unmarked forever.',
            fields: [
                { name: 'date', label: 'Date', type: 'date', required: true, value: this.date, width: 'half' },
                { name: 'name', label: 'Occasion', required: true, width: 'half', placeholder: 'Dasara' },
                { name: 'mark', label: 'Mark the registers as holiday', type: 'switch', value: true }
            ],
            onSubmit: async (values) => declareHoliday({ ...values, branchId: session.branch() })
        });

        if (done) {
            toast.success('Holiday declared.');
            await this.loadBoard();
        }
    }
}

/* The leave workflow is exposed here for the batch and student screens to
   reuse rather than re-implementing the same two service calls. */
export async function requestLeaveFor(student) {
    const done = await formOverlay({
        title: `Leave for ${student.name}`,
        variant: 'modal',
        size: 'sm',
        submitLabel: 'Request leave',
        fields: [
            { name: 'fromDate', label: 'From', type: 'date', required: true, width: 'half', value: localDate() },
            { name: 'toDate', label: 'To', type: 'date', required: true, width: 'half', value: localDate() },
            { name: 'reason', label: 'Reason', type: 'textarea', rows: 2, required: true }
        ],
        onSubmit: async (values) => requestLeave({ studentId: student.id, ...values })
    });
    if (done) toast.success('Leave recorded.');
    return done;
}

export async function decideLeaveRequest(leave, approved) {
    const ok = await confirm({
        title: approved ? 'Approve this leave?' : 'Decline this leave?',
        message: approved
            ? 'Absences already marked in the covered dates are rewritten as excused.'
            : 'The dates stay as they were marked.',
        confirmLabel: approved ? 'Approve leave' : 'Decline leave',
        danger: !approved
    });
    if (!ok) return false;

    await decideLeave(leave.id, approved, {});
    toast.success(approved ? 'Leave approved.' : 'Leave declined.');
    return true;
}
