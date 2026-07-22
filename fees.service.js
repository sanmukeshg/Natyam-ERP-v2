/**
 * NATYAM ERP 2.0 — Analytics
 *
 * The owner's view: where the school is going, rather than what it is doing
 * today. The daily dashboard answers "what needs me now"; this answers "is
 * this working".
 *
 * Every number comes from analytics.service, which itself composes the finance,
 * attendance and fee services rather than recomputing anything. That matters
 * more here than anywhere else in the app: an analytics screen that derives
 * revenue its own way will eventually disagree with the finance screen, and
 * the school will believe neither.
 *
 * Panels are failure-isolated by the service. If the ledger is unreadable, the
 * revenue chart says so and the attendance chart still draws.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { router } from '../../core/router.js';
import { formatMoney, formatMoneyShort, formatNumber } from '../../utils/money.js';
import { formatDate } from '../../utils/date.js';
import { barChart, lineChart, donutChart, legend, progressRing, chartPalette, kpiCard } from '../../ui/chart.js';
import { analyticsOverview } from '../../services/analytics.service.js';

const RANGES = [
    { months: 6, label: '6 months' },
    { months: 12, label: '12 months' },
    { months: 24, label: '2 years' }
];

export default class AnalyticsPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Analytics';
        this.months = Number(this.query.months) || 12;
    }

    async render(container) {
        this.container = container;
        session.require('report.view', 'view analytics');

        render(container, this.shell());
        this.bind();
        await this.load();
    }

    shell() {
        return html`
            <header class="page-header">
                <div class="page-header-text">
                    <h1 class="page-title">Analytics</h1>
                    <p class="page-subtitle" data-role="subtitle">How the school is trending.</p>
                </div>
                <div class="page-actions">
                    <div class="row row-tight" role="group" aria-label="Period">
                        ${RANGES.map((range) => html`
                            <button class="btn btn-sm ${range.months === this.months ? 'btn-primary' : 'btn-secondary'}"
                                    data-months="${range.months}"
                                    aria-pressed="${range.months === this.months}">${range.label}</button>
                        `)}
                    </div>
                    <a class="btn btn-secondary btn-sm" href="#/reports">
                        ${raw(icon('file-text', { size: 15 }))} Reports
                    </a>
                </div>
            </header>
            <div class="page-body" data-role="body"></div>
        `;
    }

    bind() {
        this.onDispose(on(this.container, 'click', '[data-months]', (_e, target) => {
            this.months = Number(target.dataset.months);
            this.container.querySelectorAll('[data-months]').forEach((node) => {
                const active = Number(node.dataset.months) === this.months;
                node.classList.toggle('btn-primary', active);
                node.classList.toggle('btn-secondary', !active);
                node.setAttribute('aria-pressed', String(active));
            });
            this.load();
        }));

        this.onDispose(on(this.container, 'click', '[data-goto]', (_e, target) =>
            router.go(target.dataset.goto)));

        [EVENTS.PAYMENT_RECORDED, EVENTS.LEDGER_POSTED, EVENTS.STUDENT_CREATED, EVENTS.BRANCH_CHANGED]
            .forEach((event) => this.events.on(event, () => this.load()));
    }

    async load() {
        const body = this.container.querySelector('[data-role="body"]');
        render(body, html`<div class="skeleton skeleton-row"></div>`);

        try {
            const data = await analyticsOverview({ branchId: session.branch(), months: this.months });
            this.data = data;

            render(this.container.querySelector('[data-role="subtitle"]'), html`
                ${formatDate(data.range.from)} to ${formatDate(data.range.to)}
                ${data.failed.length ? `· ${data.failed.length} panel${data.failed.length === 1 ? '' : 's'} unavailable` : ''}
            `);

            render(body, this.view(data));
        } catch (err) {
            console.error(err);
            render(body, html`
                <div class="alert alert-danger">
                    <div class="alert-title">Analytics could not be assembled</div>
                    <p class="alert-body">${err.message}</p>
                </div>
            `);
        }
    }

    view(data) {
        return html`
            ${data.failed.length ? html`
                <div class="alert alert-warning">
                    <p class="alert-body">
                        These panels could not be built: ${data.failed.join(', ')}. The rest is current.
                    </p>
                </div>
            ` : ''}

            ${this.kpiRow(data.kpis)}

            <div class="grid grid-2">
                ${this.growthPanel(data.growth)}
                ${this.revenuePanel(data.revenue)}
            </div>

            <div class="grid grid-2">
                ${this.attendancePanel(data.attendance)}
                ${this.collectionPanel(data.collection)}
            </div>

            <div class="grid grid-2-1">
                ${this.branchPanel(data.branches)}
                ${this.funnelPanel(data.funnel)}
            </div>

            <div class="grid grid-2">
                ${this.teacherPanel(data.teachers)}
                ${this.programPanel(data.programs)}
            </div>
        `;
    }

    /* ------------------------------------------------------------- KPI CARDS */

    kpiRow(kpis) {
        if (!kpis) return panelError('Headline figures are unavailable.');

        const cards = [
            kpis.students, kpis.joined, kpis.revenue, kpis.net,
            kpis.collected, kpis.outstanding, kpis.attendance
        ];

        return html`
            <div class="grid grid-4">
                ${cards.map((card) => html`
                    <div class="kpi kpi-costume" data-tone="${toneOf(card)}">
                        <div class="kpi-head"><span class="kpi-label">${card.label}</span></div>
                        <div class="kpi-value">${formatKpi(card.value, card.format)}</div>
                        <div class="kpi-foot">
                            ${card.delta === null || card.delta === 0
                                ? html`<span class="type-muted">no change on last month</span>`
                                : html`
                                    <span class="delta" data-direction="${card.direction}">
                                        ${card.direction === 'up' ? '▲' : '▼'}
                                        ${formatKpi(Math.abs(card.delta), card.format)}
                                    </span>
                                    <span class="type-muted">on last month</span>
                                `}
                        </div>
                    </div>
                `)}
            </div>
        `;
    }

    /* ---------------------------------------------------------------- GROWTH */

    growthPanel(growth) {
        if (!growth?.length) return panelError('Student growth is unavailable.');

        const latest = growth.at(-1);
        const first = growth[0];
        const change = latest.total - first.opening;

        return html`
            <section class="card">
                <div class="card-header">
                    <h2 class="card-title">Student growth</h2>
                    <p class="card-subtitle">
                        ${change >= 0 ? 'Up' : 'Down'} ${formatNumber(Math.abs(change))}
                        since ${first.label} · ${formatNumber(latest.total)} on the roll now
                    </p>
                </div>
                <div class="card-body">
                    ${raw(lineChart(
                        [{ label: 'On the roll', values: growth.map((row) => row.total) }],
                        growth.map((row) => row.label),
                        {
                            height: 180,
                            formatValue: (value) => formatNumber(value),
                            title: 'Students on the roll by month'
                        }
                    ))}
                </div>
                <div class="card-body card-body-flush">
                    <div class="table-wrap"><table class="table table-compact">
                        <thead><tr>
                            <th scope="col">Month</th>
                            <th scope="col" class="text-right">Joined</th>
                            <th scope="col" class="text-right">Left</th>
                            <th scope="col" class="text-right">Net</th>
                            <th scope="col" class="text-right">Roll</th>
                        </tr></thead>
                        <tbody>
                            ${growth.slice(-6).reverse().map((row) => html`
                                <tr>
                                    <th scope="row">${row.label}</th>
                                    <td class="text-right">${formatNumber(row.joined)}</td>
                                    <td class="text-right">${formatNumber(row.left)}</td>
                                    <td class="text-right" data-tone="${row.netChange >= 0 ? 'positive' : 'negative'}">
                                        ${row.netChange >= 0 ? '+' : ''}${formatNumber(row.netChange)}
                                    </td>
                                    <td class="text-right type-strong">${formatNumber(row.total)}</td>
                                </tr>
                            `)}
                        </tbody>
                    </table></div>
                </div>
            </section>
        `;
    }

    /* --------------------------------------------------------------- REVENUE */

    revenuePanel(revenue) {
        if (!revenue?.length) return panelError('Revenue is unavailable.');

        const totalIncome = revenue.reduce((sum, row) => sum + row.income, 0);
        const totalNet = revenue.reduce((sum, row) => sum + row.net, 0);
        const best = [...revenue].sort((a, b) => b.net - a.net)[0];

        return html`
            <section class="card">
                <div class="card-header">
                    <h2 class="card-title">Revenue</h2>
                    <p class="card-subtitle">
                        ${formatMoney(totalIncome)} income · ${formatMoney(totalNet)} net over the period
                    </p>
                </div>
                <div class="card-body">
                    ${raw(barChart(revenue.map((row) => ({ label: row.label, value: row.net })), {
                        height: 180,
                        formatValue: (value) => formatMoneyShort(value),
                        highlightLast: true,
                        title: 'Net position by month'
                    }))}
                    <p class="type-caption type-muted mt-2">
                        Best month was ${best.label} at ${formatMoney(best.net)} net.
                    </p>
                </div>
            </section>
        `;
    }

    /* ------------------------------------------------------------ ATTENDANCE */

    attendancePanel(attendance) {
        if (!attendance?.length) return panelError('Attendance trend is unavailable.');

        const marked = attendance.filter((row) => row.rate !== null);
        const average = marked.length
            ? Math.round(marked.reduce((sum, row) => sum + row.rate, 0) / marked.length)
            : null;
        const latest = marked.at(-1)?.rate ?? null;

        return html`
            <section class="card">
                <div class="card-header">
                    <h2 class="card-title">Attendance</h2>
                    <p class="card-subtitle">
                        ${average === null ? 'Nothing marked yet' : `Averaging ${average}% over the period`}
                    </p>
                </div>
                <div class="card-body">
                    <div class="row row-wrap">
                        ${latest === null ? '' : raw(progressRing(latest, {
                            size: 96,
                            label: 'this month'
                        }))}
                        <div class="flex-1">
                            ${raw(lineChart(
                                [{ label: 'Attendance', values: attendance.map((row) => row.rate ?? 0) }],
                                attendance.map((row) => row.label),
                                {
                                    height: 150,
                                    formatValue: (value) => `${value}%`,
                                    title: 'Attendance rate by month',
                                    yMax: 100
                                }
                            ))}
                        </div>
                    </div>
                    ${latest !== null && latest < 75 ? html`
                        <div class="alert alert-warning mt-2">
                            <p class="alert-body">
                                Attendance is below 75%. The register compliance figures below usually
                                explain some of this — an unmarked register is not an absent child.
                            </p>
                        </div>
                    ` : ''}
                </div>
            </section>
        `;
    }

    /* ------------------------------------------------------------ COLLECTION */

    collectionPanel(collection) {
        if (!collection?.length) return panelError('Collection trend is unavailable.');

        const billed = collection.reduce((sum, row) => sum + row.billed, 0);
        const collected = collection.reduce((sum, row) => sum + row.collected, 0);
        const rate = billed ? Math.round((collected / billed) * 100) : null;

        return html`
            <section class="card">
                <div class="card-header">
                    <h2 class="card-title">Collection</h2>
                    <p class="card-subtitle">
                        ${formatMoney(collected)} collected against ${formatMoney(billed)} billed
                        ${rate === null ? '' : `· ${rate}%`}
                    </p>
                </div>
                <div class="card-body card-body-flush">
                    <div class="table-wrap"><table class="table table-compact">
                        <thead><tr>
                            <th scope="col">Month</th>
                            <th scope="col" class="text-right">Billed</th>
                            <th scope="col" class="text-right">Collected</th>
                            <th scope="col" class="text-right">Gap</th>
                            <th scope="col" class="text-right">Rate</th>
                        </tr></thead>
                        <tbody>
                            ${collection.slice(-8).reverse().map((row) => html`
                                <tr>
                                    <th scope="row">${row.label}</th>
                                    <td class="text-right">${formatMoney(row.billed)}</td>
                                    <td class="text-right">${formatMoney(row.collected)}</td>
                                    <td class="text-right" data-tone="${row.gap > 0 ? 'caution' : 'positive'}">
                                        ${formatMoney(row.gap)}
                                    </td>
                                    <td class="text-right">
                                        ${row.rate === null
                                            ? html`<span class="type-muted">—</span>`
                                            : html`<span class="badge ${row.rate >= 90 ? 'badge-success'
                                                : row.rate >= 70 ? 'badge-warning' : 'badge-danger'}">${row.rate}%</span>`}
                                    </td>
                                </tr>
                            `)}
                        </tbody>
                    </table></div>
                </div>
                <div class="card-footer">
                    <button class="btn btn-sm btn-secondary" data-goto="/fees?filter=overdue">
                        Chase what is outstanding
                    </button>
                </div>
            </section>
        `;
    }

    /* --------------------------------------------------------------- BRANCH */

    branchPanel(branches) {
        if (!branches?.length) return panelError('Branch comparison is unavailable.');

        return html`
            <section class="card">
                <div class="card-header">
                    <h2 class="card-title">Branches</h2>
                    <p class="card-subtitle">Side by side over the period.</p>
                </div>
                <div class="card-body card-body-flush">
                    <div class="table-wrap"><table class="table table-compact">
                        <thead><tr>
                            <th scope="col">Branch</th>
                            <th scope="col" class="text-right">Students</th>
                            <th scope="col" class="text-right">Occupancy</th>
                            <th scope="col" class="text-right">Collected</th>
                            <th scope="col" class="text-right">Outstanding</th>
                            <th scope="col" class="text-right">Net</th>
                        </tr></thead>
                        <tbody>
                            ${branches.map((row) => html`
                                <tr>
                                    <th scope="row">${row.branch.name}</th>
                                    <td class="text-right">${formatNumber(row.students)}</td>
                                    <td class="text-right">
                                        ${row.occupancy === null
                                            ? html`<span class="type-muted">—</span>`
                                            : html`<span class="badge ${row.occupancy >= 85 ? 'badge-warning'
                                                : 'badge-neutral'}">${row.occupancy}%</span>`}
                                    </td>
                                    <td class="text-right">${formatMoney(row.collected)}</td>
                                    <td class="text-right">${formatMoney(row.outstanding)}</td>
                                    <td class="text-right type-strong"
                                        data-tone="${row.net >= 0 ? 'positive' : 'negative'}">
                                        ${formatMoney(row.net)}
                                    </td>
                                </tr>
                            `)}
                        </tbody>
                    </table></div>
                </div>
            </section>
        `;
    }

    /* --------------------------------------------------------------- FUNNEL */

    funnelPanel(funnel) {
        if (!funnel) return panelError('Admission funnel is unavailable.');

        const widest = Math.max(...funnel.stages.map((stage) => stage.value), 1);

        return html`
            <section class="card">
                <div class="card-header">
                    <h2 class="card-title">Admissions</h2>
                    <p class="card-subtitle">
                        ${funnel.conversionRate === null
                            ? 'No decided applications yet'
                            : `${funnel.conversionRate}% of decided applications enrol`}
                    </p>
                </div>
                <div class="card-body">
                    <ul class="stack stack-sm">
                        ${funnel.stages.map((stage) => html`
                            <li>
                                <div class="spread">
                                    <span class="type-caption">${stage.label}</span>
                                    <span class="type-strong">${formatNumber(stage.value)}</span>
                                </div>
                                <div class="meter">
                                    <span class="meter-fill"
                                          style="width:${Math.round((stage.value / widest) * 100)}%"></span>
                                </div>
                            </li>
                        `)}
                    </ul>

                    ${funnel.awaitingEnrolment ? html`
                        <div class="alert alert-warning mt-4">
                            <p class="alert-body">
                                ${formatNumber(funnel.awaitingEnrolment)} approved applicant${funnel.awaitingEnrolment === 1 ? '' : 's'}
                                ${funnel.awaitingEnrolment === 1 ? 'is' : 'are'} not yet on a register.
                            </p>
                            <button class="btn btn-sm btn-primary" data-goto="/admissions?filter=approved">
                                Enrol them
                            </button>
                        </div>
                    ` : ''}
                </div>
            </section>
        `;
    }

    /* -------------------------------------------------------------- TEACHERS */

    teacherPanel(teachers) {
        if (!teachers?.length) return panelError('Teacher figures are unavailable.');

        return html`
            <section class="card">
                <div class="card-header">
                    <h2 class="card-title">Register compliance</h2>
                    <p class="card-subtitle">
                        How reliably registers get marked. This measures paperwork, not teaching.
                    </p>
                </div>
                <div class="card-body card-body-flush">
                    <div class="table-wrap"><table class="table table-compact">
                        <thead><tr>
                            <th scope="col">Teacher</th>
                            <th scope="col" class="text-right">Batches</th>
                            <th scope="col" class="text-right">Students</th>
                            <th scope="col" class="text-right">Marked</th>
                            <th scope="col" class="text-right">Compliance</th>
                        </tr></thead>
                        <tbody>
                            ${teachers.map((row) => html`
                                <tr>
                                    <th scope="row">${row.name}</th>
                                    <td class="text-right">${formatNumber(row.batches)}</td>
                                    <td class="text-right">${formatNumber(row.students)}</td>
                                    <td class="text-right">
                                        ${formatNumber(row.marked)} / ${formatNumber(row.expected)}
                                    </td>
                                    <td class="text-right">
                                        ${row.compliance === null
                                            ? html`<span class="type-muted">—</span>`
                                            : html`<span class="badge ${row.compliance >= 90 ? 'badge-success'
                                                : row.compliance >= 70 ? 'badge-warning' : 'badge-danger'}">
                                                ${row.compliance}%</span>`}
                                    </td>
                                </tr>
                            `)}
                        </tbody>
                    </table></div>
                </div>
            </section>
        `;
    }

    /* ------------------------------------------------------------- PROGRAMMES */

    programPanel(programs) {
        if (!programs) return panelError('Programme analytics are unavailable.');

        const slices = programs.byType.filter((entry) => entry.count > 0);

        return html`
            <section class="card">
                <div class="card-header">
                    <h2 class="card-title">Programmes</h2>
                    <p class="card-subtitle">
                        ${formatNumber(programs.held)} held · ${formatNumber(programs.participantsEngaged)} students involved
                    </p>
                </div>
                <div class="card-body">
                    <div class="grid grid-3">
                        ${kpiCard('Income', formatMoney(programs.totalIncome))}
                        ${kpiCard('Costs', formatMoney(programs.totalCost))}
                        ${kpiCard('Net', formatMoney(programs.net), null,
                            { tone: programs.net >= 0 ? 'positive' : 'negative' })}
                    </div>

                    ${slices.length ? html`
                        <div class="row row-wrap mt-4">
                            ${raw(donutChart(slices.map((entry) => ({ label: entry.label, value: entry.count })), {
                                size: 140,
                                centreValue: formatNumber(programs.held),
                                centreLabel: 'held'
                            }))}
                            ${raw(legend(slices.map((entry, index) => ({
                                label: `${entry.label} — ${entry.count}`,
                                color: chartPalette[index % chartPalette.length]
                            }))))}
                        </div>
                    ` : html`<p class="type-muted mt-2">No programmes completed in this period.</p>`}

                    ${programs.mostAttended.length ? html`
                        <ul class="stack stack-sm mt-4">
                            ${programs.mostAttended.map((program) => html`
                                <li class="spread">
                                    <div>
                                        <span class="type-strong">${program.name}</span>
                                        <div class="type-caption type-muted">${formatDate(program.date)}</div>
                                    </div>
                                    <span>${formatNumber(program.participantCount)} in the cast</span>
                                </li>
                            `)}
                        </ul>
                    ` : ''}
                </div>
            </section>
        `;
    }
}

/* ------------------------------------------------------------------ HELPERS */

function panelError(message) {
    return html`
        <section class="card"><div class="card-body">
            <div class="empty empty-compact">
                <p class="empty-text">${message}</p>
            </div>
        </div></section>
    `;
}


function formatKpi(value, format) {
    if (value === null || value === undefined) return '—';
    if (format === 'money') return formatMoneyShort(value);
    if (format === 'percent') return `${value}%`;
    return formatNumber(value);
}

function toneOf(card) {
    if (card.good === null) return 'neutral';
    return card.good ? 'positive' : 'negative';
}
