/**
 * NATYAM ERP 2.0 — Dashboard
 *
 * This page computes nothing. Every figure below arrives from
 * dashboard.service; the page's only job is to decide what a number should
 * look like. That separation is the whole reason 1.0's "zero pending
 * admissions" bug cannot recur here — there is exactly one place a count can
 * come from, and it is not this file.
 *
 * Layout intent: the top row answers "how is the school doing", the second row
 * answers "what must I do today", and everything below is context you scroll to
 * only when the first two rows raise a question.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { formatMoney, formatMoneyShort, formatNumber } from '../../utils/money.js';
import { formatDateLong, formatDate, relativeTime } from '../../utils/date.js';
import { barChart, sparkline, donutChart, legend, chartPalette } from '../../ui/chart.js';
import { overview, forTeacher } from '../../services/dashboard.service.js';
import { describe as describeAudit } from '../../services/audit.service.js';

const SEVERITY_TONE = { high: 'danger', medium: 'warning', low: 'info' };

const STATE_LABEL = {
    marked: 'Register marked',
    running: 'In progress',
    missed: 'Register not marked',
    upcoming: 'Later today'
};

const STATE_BADGE = {
    marked: 'badge-success',
    running: 'badge-accent',
    missed: 'badge-danger',
    upcoming: 'badge-neutral'
};

export default class DashboardPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Dashboard';
        this.data = null;
    }

    async render(container) {
        this.container = container;

        // A teacher's dashboard is a different question, not a subset of this
        // one — they need their registers, not the school's cash position.
        this.teacherMode = session.role() === 'teacher' && !session.can('finance.view');

        render(container, this.shell());
        this.bindEvents();
        await this.load();
    }

    /* ------------------------------------------------------------- STRUCTURE */

    shell() {
        return html`
            <header class="page-header">
                <div class="page-header-text">
                    <h1 class="page-title">${this.greeting()}</h1>
                    <p class="page-subtitle" data-role="subtitle">${formatDateLong(new Date())}</p>
                </div>
                <div class="page-actions">
                    <button class="btn btn-secondary btn-sm" data-action="refresh">
                        ${raw(icon('refresh-cw', { size: 15 }))} Refresh
                    </button>
                    ${session.can('student.edit')
                        ? html`<a class="btn btn-secondary btn-sm" href="#/students?new=1">
                                   ${raw(icon('user-plus', { size: 15 }))} Add student
                               </a>`
                        : ''}
                    ${session.can('fee.collect')
                        ? html`<a class="btn btn-primary btn-sm" href="#/fees?collect=1">
                                   ${raw(icon('receipt', { size: 15 }))} Collect fee
                               </a>`
                        : ''}
                </div>
            </header>
            <div class="page-body" data-role="body">
                ${this.skeleton()}
            </div>
        `;
    }

    skeleton() {
        return html`
            <div class="grid grid-4">
                ${[1, 2, 3, 4].map(() => html`<div class="skeleton skeleton-kpi"></div>`)}
            </div>
            <div class="skeleton skeleton-chart"></div>
        `;
    }

    greeting() {
        const hour = new Date().getHours();
        const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
        const name = (session.actorName() || '').split(' ').slice(-1)[0] || '';
        return name ? `${part}, ${name}` : part;
    }

    bindEvents() {
        this.onDispose(on(this.container, 'click', '[data-action="refresh"]', () => this.load(true)));

        // Anything that changes a number on this screen refreshes it. Cheap,
        // because the whole dashboard is one parallelised service call.
        const refresh = () => { if (document.visibilityState === 'visible') this.load(); };
        [
            EVENTS.PAYMENT_RECORDED, EVENTS.ATTENDANCE_SAVED, EVENTS.ADMISSION_ENROLLED,
            EVENTS.STUDENT_CREATED, EVENTS.EXPENSE_RECORDED, EVENTS.BRANCH_CHANGED
        ].forEach((event) => this.events.on(event, refresh));
    }

    /* ------------------------------------------------------------------ LOAD */

    async load(announce = false) {
        const body = this.container.querySelector('[data-role="body"]');
        if (!body) return;

        try {
            this.data = this.teacherMode
                ? { teacher: await forTeacher(session.actorId()) }
                : await overview({ branchId: session.branch() });

            render(body, this.teacherMode ? this.teacherView(this.data.teacher) : this.view(this.data));
            if (announce) toast.success('Dashboard updated');
        } catch (err) {
            console.error('Dashboard failed', err);
            render(body, html`
                <div class="alert alert-danger">
                    <div class="alert-title">The dashboard could not be assembled</div>
                    <p class="alert-body">${err.message}</p>
                    <button class="btn btn-sm btn-secondary" data-action="refresh">Try again</button>
                </div>
            `);
        }
    }

    /* ------------------------------------------------------------------ VIEW */

    view(data) {
        return html`
            ${this.kpiRow(data.headline)}
            <div class="grid grid-2-1">
                ${this.attentionCard(data.attention)}
                ${this.todayCard(data.today)}
            </div>
            <div class="grid grid-2-1">
                ${this.moneyCard(data.money)}
                ${this.admissionsCard(data.admissions)}
            </div>
            <div class="grid grid-3">
                ${this.attendanceCard(data.attendance)}
                ${this.rollCard(data.roll)}
                ${this.programsCard(data.programs)}
            </div>
            <div class="grid grid-2-1">
                ${data.branches ? this.branchCard(data.branches) : ''}
                ${this.activityCard(data.activity)}
            </div>
        `;
    }

    /* -------------------------------------------------------------- KPI CARDS */

    kpiRow(headline) {
        if (panelFailed(headline)) return this.panelError('Key figures', headline);

        return html`
            <div class="grid grid-4">
                ${headline.map((kpi) => html`
                    <a class="kpi" href="${kpi.link || '#/'}" data-tone="${kpi.tone || 'neutral'}">
                        <div class="kpi-head">
                            <span class="kpi-label">${kpi.label}</span>
                        </div>
                        <div class="kpi-value">
                            ${kpi.money ? formatMoneyShort(kpi.value) : formatNumber(kpi.value)}
                            ${kpi.unit ? html`<span class="kpi-unit">${kpi.unit}</span>` : ''}
                        </div>
                        ${kpi.delta
                            ? html`<div class="kpi-delta" data-tone="${kpi.delta.tone}">
                                       ${kpi.delta.value}
                                       ${kpi.delta.note ? html`<span class="kpi-foot">${kpi.delta.note}</span>` : ''}
                                   </div>`
                            : html`<div class="kpi-foot">&nbsp;</div>`}
                    </a>
                `)}
            </div>
        `;
    }

    /* --------------------------------------------------------- NEEDS ATTENTION */

    attentionCard(items) {
        if (panelFailed(items)) return this.panelError('Needs attention', items);

        return html`
            <section class="card">
                <div class="card-header">
                    <div>
                        <h2 class="card-title">Needs attention</h2>
                        <p class="card-subtitle">${items.length
                            ? 'Things waiting on a person, most urgent first.'
                            : 'Nothing is waiting on anyone.'}</p>
                    </div>
                </div>
                <div class="card-body${items.length ? ' card-body-flush' : ''}">
                    ${items.length ? html`
                        <ul class="timeline">
                            ${items.map((item) => html`
                                <li class="timeline-item" data-tone="${SEVERITY_TONE[item.severity]}">
                                    <span class="timeline-dot">${raw(icon(item.icon, { size: 14 }))}</span>
                                    <div class="timeline-content">
                                        <div class="timeline-title">${item.title}</div>
                                        <div class="timeline-meta">${item.detail}</div>
                                    </div>
                                    <a class="btn btn-sm btn-secondary" href="${item.link}">${item.action}</a>
                                </li>
                            `)}
                        </ul>
                    ` : html`
                        <div class="empty empty-compact">
                            <div class="empty-glyph">${raw(icon('check-circle'))}</div>
                            <p class="empty-title">All clear</p>
                            <p class="empty-text">Registers are marked, applications are answered
                            and no invoice is past its due date.</p>
                        </div>
                    `}
                </div>
            </section>
        `;
    }

    /* ------------------------------------------------------------------ TODAY */

    todayCard(today) {
        if (panelFailed(today)) return this.panelError("Today's classes", today);

        return html`
            <section class="card">
                <div class="card-header">
                    <div>
                        <h2 class="card-title">Today</h2>
                        <p class="card-subtitle">
                            ${today.holiday
                                ? `Holiday — ${today.holiday.name}`
                                : `${today.registersDone} of ${today.total} registers marked`}
                        </p>
                    </div>
                    <div class="card-actions">
                        <a class="btn btn-sm btn-ghost" href="#/attendance">Open</a>
                    </div>
                </div>
                <div class="card-body card-body-tight">
                    ${today.holiday ? html`
                        <div class="alert alert-info">
                            <p class="alert-body">No classes run today. ${today.holiday.name}.</p>
                        </div>
                    ` : today.classes.length ? html`
                        <ul class="stack stack-sm">
                            ${today.classes.map((cls) => html`
                                <li class="spread">
                                    <div>
                                        <a class="type-strong" href="#/attendance?batch=${cls.id}">${cls.name}</a>
                                        <div class="type-caption type-muted">
                                            ${cls.startTime}–${cls.endTime}
                                            ${cls.teacher ? `· ${cls.teacher}` : ''}
                                            ${cls.room ? `· ${cls.room}` : ''}
                                        </div>
                                    </div>
                                    <span class="badge ${STATE_BADGE[cls.state]}">
                                        ${cls.done && cls.rate !== null
                                            ? `${cls.rate}% present`
                                            : STATE_LABEL[cls.state]}
                                    </span>
                                </li>
                            `)}
                        </ul>
                    ` : html`
                        <div class="empty empty-compact">
                            <p class="empty-text">No batches meet today.</p>
                        </div>
                    `}
                </div>
                ${today.classes.length ? html`
                    <div class="card-footer">
                        <span class="type-caption type-muted">
                            ${formatNumber(today.studentsExpected)} students expected today
                        </span>
                    </div>
                ` : ''}
            </section>
        `;
    }

    /* ------------------------------------------------------------------ MONEY */

    moneyCard(money) {
        if (panelFailed(money)) return this.panelError('Money', money);
        if (!session.can('finance.view') && !session.can('fee.view')) return '';

        const bars = money.series.map((row) => ({ label: row.label, value: row.income }));
        const ageing = [
            { label: 'Not yet due', value: money.ageing?.current || 0 },
            { label: '1–30 days', value: money.ageing?.d30 || 0 },
            { label: '31–60 days', value: money.ageing?.d60 || 0 },
            { label: '60+ days', value: money.ageing?.d90 || 0 }
        ].filter((slice) => slice.value > 0);

        return html`
            <section class="card">
                <div class="card-header">
                    <div>
                        <h2 class="card-title">Money</h2>
                        <p class="card-subtitle">Collection against the last six months of income.</p>
                    </div>
                    <div class="card-actions">
                        <a class="btn btn-sm btn-ghost" href="#/finance">Finance</a>
                        <a class="btn btn-sm btn-ghost" href="#/fees">Fees</a>
                    </div>
                </div>
                <div class="card-body">
                    <div class="grid grid-3">
                        ${this.stat('Collected this month', formatMoney(money.collectedThisMonth))}
                        ${this.stat('Outstanding', formatMoney(money.outstanding),
                            money.overdueCount ? `${money.overdueCount} overdue` : 'nothing overdue')}
                        ${this.stat('Net position', formatMoney(money.position?.net ?? 0),
                            money.position?.net >= 0 ? 'in surplus this month' : 'in deficit this month')}
                    </div>
                    <div class="divider"></div>
                    ${raw(barChart(bars, {
                        height: 210,
                        title: 'Monthly income',
                        formatValue: (value) => formatMoneyShort(value)
                    }))}
                    ${ageing.length ? html`
                        <div class="divider divider-labelled" data-label="Outstanding by age"></div>
                        <div class="row row-wrap">
                            ${raw(donutChart(ageing, {
                                size: 150,
                                centreValue: formatMoneyShort(money.outstanding),
                                centreLabel: 'outstanding',
                                title: 'Outstanding by age'
                            }))}
                            ${raw(legend(ageing.map((slice, index) => ({
                                label: `${slice.label} — ${formatMoneyShort(slice.value)}`,
                                color: chartPalette[index % chartPalette.length]
                            }))))}
                        </div>
                    ` : ''}
                </div>
            </section>
        `;
    }

    /* ------------------------------------------------------------- ADMISSIONS */

    admissionsCard(panel) {
        if (panelFailed(panel)) return this.panelError('Admissions', panel);

        return html`
            <section class="card">
                <div class="card-header">
                    <div>
                        <h2 class="card-title">Admissions</h2>
                        <p class="card-subtitle">Applications moving through the pipeline.</p>
                    </div>
                    <div class="card-actions">
                        <a class="btn btn-sm btn-ghost" href="#/admissions">Open</a>
                    </div>
                </div>
                <div class="card-body card-body-tight">
                    <div class="row row-wrap">
                        ${['submitted', 'reviewing', 'approved'].map((key) => html`
                            <span class="chip">
                                <span class="chip-key">${key}</span>
                                ${formatNumber(panel[key] ?? panel.counts?.[key] ?? 0)}
                            </span>
                        `)}
                    </div>
                    ${panel.recent?.length ? html`
                        <div class="divider"></div>
                        <ul class="stack stack-sm">
                            ${panel.recent.map((app) => html`
                                <li class="spread">
                                    <div>
                                        <a class="type-strong" href="#/admissions/${app.id}">${app.name}</a>
                                        <div class="type-caption type-muted">
                                            ${app.level || 'level not set'}
                                            ${app.waitingDays !== null ? `· waiting ${app.waitingDays}d` : ''}
                                        </div>
                                    </div>
                                    <span class="badge badge-neutral">${app.status}</span>
                                </li>
                            `)}
                        </ul>
                    ` : html`<p class="empty-text">No applications yet this season.</p>`}
                </div>
            </section>
        `;
    }

    /* ------------------------------------------------------------- ATTENDANCE */

    attendanceCard(panel) {
        if (panelFailed(panel)) return this.panelError('Attendance', panel);

        const breakdown = Object.entries(panel.breakdown || {})
            .filter(([, count]) => count > 0)
            .map(([status, count]) => ({ label: status, value: count }));

        return html`
            <section class="card">
                <div class="card-header">
                    <div>
                        <h2 class="card-title">Attendance</h2>
                        <p class="card-subtitle">Last 30 days across the school.</p>
                    </div>
                </div>
                <div class="card-body">
                    <div class="kpi-value">${panel.overall === null ? '—' : `${panel.overall}%`}</div>
                    ${panel.trend?.length
                        ? raw(sparkline(panel.trend.map((t) => t.rate), { tone: 'accent', width: 260 }))
                        : ''}
                    ${breakdown.length ? html`
                        <div class="divider"></div>
                        ${raw(legend(breakdown.map((slice, index) => ({
                            label: `${slice.label} ${formatNumber(slice.value)}`,
                            color: chartPalette[index % chartPalette.length]
                        }))))}
                    ` : ''}
                    ${panel.weakest?.length ? html`
                        <div class="divider divider-labelled" data-label="Lowest batches"></div>
                        <ul class="stack stack-sm">
                            ${panel.weakest.map((batch) => html`
                                <li class="spread">
                                    <a href="#/batches/${batch.id}">${batch.name}</a>
                                    <span class="badge ${batch.rate < 65 ? 'badge-danger' : 'badge-warning'}">
                                        ${batch.rate}%
                                    </span>
                                </li>
                            `)}
                        </ul>
                    ` : ''}
                </div>
            </section>
        `;
    }

    /* -------------------------------------------------------------- ROLL PANEL */

    rollCard(panel) {
        if (panelFailed(panel)) return this.panelError('Roll', panel);

        const levels = Object.entries(panel.byLevel || {}).map(([label, value]) => ({ label, value }));

        return html`
            <section class="card">
                <div class="card-header">
                    <div>
                        <h2 class="card-title">The roll</h2>
                        <p class="card-subtitle">${formatNumber(panel.total)} active students.</p>
                    </div>
                </div>
                <div class="card-body">
                    ${panel.unplaced ? html`
                        <div class="alert alert-warning">
                            <p class="alert-body">
                                ${formatNumber(panel.unplaced)} student${panel.unplaced === 1 ? '' : 's'}
                                ${panel.unplaced === 1 ? 'is' : 'are'} in no batch and appear on no register.
                            </p>
                            <a class="btn btn-sm btn-secondary" href="#/students?filter=unplaced">Place them</a>
                        </div>
                    ` : ''}
                    ${levels.length ? raw(barChart(levels, {
                        height: 180,
                        title: 'Students by level',
                        formatValue: (value) => formatNumber(value)
                    })) : ''}
                    <div class="divider"></div>
                    <dl class="dl">
                        <dt>Seats filled</dt>
                        <dd>${formatNumber(panel.capacity.filled)} of ${formatNumber(panel.capacity.seats)}
                            ${panel.capacity.occupancy !== null ? `(${panel.capacity.occupancy}%)` : ''}</dd>
                        <dt>On leave</dt>
                        <dd>${formatNumber(panel.onLeave)}</dd>
                        ${panel.full.length ? html`
                            <dt>Full batches</dt>
                            <dd>${panel.full.map((b) => b.name).join(', ')}</dd>
                        ` : ''}
                        ${panel.empty.length ? html`
                            <dt>Empty batches</dt>
                            <dd>${panel.empty.map((b) => b.name).join(', ')}</dd>
                        ` : ''}
                    </dl>
                </div>
            </section>
        `;
    }

    /* ---------------------------------------------------------------- PROGRAMS */

    programsCard(panel) {
        if (panelFailed(panel)) return this.panelError('Programmes', panel);

        return html`
            <section class="card">
                <div class="card-header">
                    <div>
                        <h2 class="card-title">Coming up</h2>
                        <p class="card-subtitle">Performances, workshops and examinations.</p>
                    </div>
                    <div class="card-actions">
                        <a class="btn btn-sm btn-ghost" href="#/programs">Open</a>
                    </div>
                </div>
                <div class="card-body card-body-tight">
                    ${panel.upcoming.length ? html`
                        <ul class="timeline">
                            ${panel.upcoming.map((program) => html`
                                <li class="timeline-item">
                                    <span class="timeline-dot">${raw(icon('star', { size: 13 }))}</span>
                                    <div class="timeline-content">
                                        <div class="timeline-title">
                                            <a href="#/programs/${program.id}">${program.name}</a>
                                        </div>
                                        <div class="timeline-meta">
                                            ${formatDate(program.date)}
                                            ${program.daysAway === 0 ? '· today'
                                                : program.daysAway === 1 ? '· tomorrow'
                                                : `· in ${program.daysAway} days`}
                                            ${program.venue ? `· ${program.venue}` : ''}
                                            · ${formatNumber(program.participants)} participating
                                        </div>
                                    </div>
                                </li>
                            `)}
                        </ul>
                    ` : html`
                        <div class="empty empty-compact">
                            <p class="empty-text">Nothing scheduled.</p>
                        </div>
                    `}
                </div>
            </section>
        `;
    }

    /* ---------------------------------------------------------------- BRANCHES */

    branchCard(branches) {
        if (panelFailed(branches) || !branches?.length) return '';

        return html`
            <section class="card">
                <div class="card-header">
                    <div>
                        <h2 class="card-title">Branches</h2>
                        <p class="card-subtitle">This month, side by side.</p>
                    </div>
                </div>
                <div class="card-body card-body-flush">
                    <div class="table-wrap">
                        <table class="table table-pin-first">
                            <thead>
                                <tr>
                                    <th scope="col">Branch</th>
                                    <th scope="col" class="text-right">Students</th>
                                    <th scope="col" class="text-right">Staff</th>
                                    <th scope="col" class="text-right">Collected</th>
                                    <th scope="col" class="text-right">Outstanding</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${branches.map((branch) => html`
                                    <tr>
                                        <th scope="row">${branch.name}
                                            <span class="type-caption type-muted">${branch.code}</span></th>
                                        <td class="text-right">${formatNumber(branch.students)}</td>
                                        <td class="text-right">${formatNumber(branch.staff)}</td>
                                        <td class="text-right">${formatMoney(branch.collected)}</td>
                                        <td class="text-right">${formatMoney(branch.outstanding)}</td>
                                    </tr>
                                `)}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>
        `;
    }

    /* ---------------------------------------------------------------- ACTIVITY */

    activityCard(entries) {
        if (panelFailed(entries) || !entries?.length) return '';

        return html`
            <section class="card">
                <div class="card-header">
                    <div>
                        <h2 class="card-title">Recent activity</h2>
                        <p class="card-subtitle">Who changed what.</p>
                    </div>
                    ${session.can('audit.view') ? html`
                        <div class="card-actions">
                            <a class="btn btn-sm btn-ghost" href="#/settings?tab=audit">Audit log</a>
                        </div>
                    ` : ''}
                </div>
                <div class="card-body card-body-tight">
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
                </div>
            </section>
        `;
    }

    /* ------------------------------------------------------- TEACHER DASHBOARD */

    teacherView(data) {
        return html`
            <div class="grid grid-4">
                ${this.kpi('Classes today', formatNumber(data.classesToday.length),
                    data.registersPending ? `${data.registersPending} register pending` : 'all marked',
                    data.registersPending ? 'caution' : 'positive')}
                ${this.kpi('My batches', formatNumber(data.batches))}
                ${this.kpi('Students taught', formatNumber(data.studentsTaught))}
                ${this.kpi('Attendance, 30 days',
                    data.attendanceRate === null ? '—' : `${data.attendanceRate}%`, null,
                    data.attendanceRate >= 80 ? 'positive' : 'caution')}
            </div>

            <section class="card">
                <div class="card-header">
                    <div>
                        <h2 class="card-title">Your classes today</h2>
                        <p class="card-subtitle">${formatDateLong(data.date)}</p>
                    </div>
                </div>
                <div class="card-body card-body-tight">
                    ${data.classesToday.length ? html`
                        <ul class="stack stack-sm">
                            ${data.classesToday.map((cls) => html`
                                <li class="spread">
                                    <div>
                                        <span class="type-strong">${cls.name}</span>
                                        <div class="type-caption type-muted">${cls.startTime}–${cls.endTime}</div>
                                    </div>
                                    <a class="btn btn-sm ${cls.done ? 'btn-secondary' : 'btn-primary'}"
                                       href="#/attendance?batch=${cls.id}">
                                        ${cls.done ? 'View register' : 'Mark register'}
                                    </a>
                                </li>
                            `)}
                        </ul>
                    ` : html`<p class="empty-text">No classes scheduled for you today.</p>`}
                </div>
            </section>

            ${data.missing?.length ? html`
                <section class="card">
                    <div class="card-header">
                        <h2 class="card-title">Registers you have not marked</h2>
                    </div>
                    <div class="card-body card-body-tight">
                        <ul class="stack stack-sm">
                            ${data.missing.map((entry) => html`
                                <li class="spread">
                                    <span>${entry.batch.name} · ${formatDate(entry.date)}</span>
                                    <a class="btn btn-sm btn-secondary"
                                       href="#/attendance?batch=${entry.batch.id}&date=${entry.date}">Mark</a>
                                </li>
                            `)}
                        </ul>
                    </div>
                </section>
            ` : ''}
        `;
    }

    /* ----------------------------------------------------------------- PIECES */

    kpi(label, value, foot = null, tone = 'neutral') {
        return html`
            <div class="kpi" data-tone="${tone}">
                <div class="kpi-head"><span class="kpi-label">${label}</span></div>
                <div class="kpi-value">${value}</div>
                <div class="kpi-foot">${foot || '\u00a0'}</div>
            </div>
        `;
    }

    stat(label, value, foot = null) {
        return html`
            <div class="stack stack-xs">
                <span class="type-caption type-muted">${label}</span>
                <span class="type-strong type-lg">${value}</span>
                ${foot ? html`<span class="type-caption type-muted">${foot}</span>` : ''}
            </div>
        `;
    }

    panelError(name, panel) {
        return html`
            <section class="card">
                <div class="card-body">
                    <div class="empty empty-compact">
                        <div class="empty-glyph">${raw(icon('alert-triangle'))}</div>
                        <p class="empty-title">${name} could not be calculated</p>
                        <p class="empty-text type-mono type-caption">${panel?.error || 'Unknown error'}</p>
                        <div class="empty-actions">
                            <button class="btn btn-sm btn-secondary" data-action="refresh">Retry</button>
                        </div>
                    </div>
                </div>
            </section>
        `;
    }
}

/** A panel that failed is an object carrying only `error`. */
function panelFailed(panel) {
    return !panel || (!Array.isArray(panel) && typeof panel === 'object' && 'error' in panel);
}
