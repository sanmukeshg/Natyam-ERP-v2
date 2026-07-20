/**
 * NATYAM ERP 2.0 — Reports
 *
 * One screen for every report, because the reports themselves are data. The
 * service holds a catalogue — name, group, the filters each accepts, its
 * columns and a builder — and this page renders whatever it is handed. Adding
 * a report to the school's repertoire is adding an entry to REPORTS; no new
 * screen, no new route, no new export code.
 *
 * That inversion is the whole design. In 1.0 each report was a bespoke page
 * with its own filter bar and its own half-working CSV writer, which is why
 * three of them exported dates in three different formats.
 *
 * Export honesty: CSV and SpreadsheetML come from the service, and "PDF" is
 * the browser's own print pipeline against a proper print stylesheet. That is
 * a real PDF on every platform, without vendoring a PDF library into an
 * offline app nobody can update.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { DataTable } from '../../ui/table.js';
import { filterSelect, filterDate } from '../../ui/form.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { formatNumber } from '../../utils/money.js';
import { formatDate, formatDateTime, localDate, startOfMonth } from '../../utils/date.js';
import { LEVELS, STUDENT_STATUS } from '../../config/app.config.js';

import {
    reportCatalogue, reportById, run,
    downloadCSV, downloadSpreadsheet, printReport
} from '../../services/reports.service.js';
import { listBatches } from '../../services/batches.service.js';
import { listBranches } from '../../services/settings.service.js';

export default class ReportsPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Reports';
        this.reportId = this.query.report || 'student-roll';
        this.filters = {
            from: this.query.from || startOfMonth(localDate()),
            to: this.query.to || localDate(),
            branchId: session.branch(),
            batchId: '',
            level: '',
            status: ''
        };
        this.result = null;
    }

    async render(container) {
        this.container = container;
        session.require('report.view', 'open reports');

        render(container, this.shell());
        this.bind();

        const [batches, branches] = await Promise.all([
            listBatches(session.branch(), { includeClosed: true }),
            listBranches()
        ]);
        this.reference = { batches, branches };

        this.buildTable();
        this.paintCatalogue();
        await this.execute();
    }

    shell() {
        return html`
            <header class="page-header">
                <div class="page-header-text">
                    <h1 class="page-title" data-role="title">Reports</h1>
                    <p class="page-subtitle" data-role="subtitle">Choose a report on the left.</p>
                </div>
                <div class="page-actions" data-role="actions"></div>
            </header>
            <div class="page-body report-layout">
                <aside class="report-nav" data-role="catalogue" aria-label="Report catalogue"></aside>
                <div class="report-main">
                    <div class="filter-bar" data-role="filters"></div>
                    <div data-role="meta"></div>
                    <div data-role="table"></div>
                </div>
            </div>
        `;
    }

    bind() {
        this.onDispose(on(this.container, 'click', '[data-report]', (_e, target) => {
            this.reportId = target.dataset.report;
            this.paintCatalogue();
            this.execute();
        }));
        this.onDispose(on(this.container, 'change', '[data-filter]', (_e, target) => {
            this.filters[target.dataset.filter] = target.value;
            this.execute();
        }));
        this.onDispose(on(this.container, 'click', '[data-export]', (_e, target) => {
            this.exportAs(target.dataset.export);
        }));

        // A report is a snapshot of live data; if the data moves underneath it,
        // silently showing yesterday's numbers is worse than a re-run.
        [EVENTS.PAYMENT_RECORDED, EVENTS.ATTENDANCE_SAVED, EVENTS.BRANCH_CHANGED]
            .forEach((event) => this.events.on(event, () => this.execute()));
    }

    /* -------------------------------------------------------------- CATALOGUE */

    paintCatalogue() {
        render(this.container.querySelector('[data-role="catalogue"]'), html`
            ${reportCatalogue().map((group) => html`
                <section class="report-group">
                    <h2 class="report-group-title">${group.group}</h2>
                    <ul class="report-list">
                        ${group.reports.map((report) => html`
                            <li>
                                <button class="report-item ${report.id === this.reportId ? 'is-active' : ''}"
                                        data-report="${report.id}"
                                        aria-current="${report.id === this.reportId ? 'true' : 'false'}">
                                    <span class="type-strong">${report.name}</span>
                                    <span class="type-caption type-muted">${report.description}</span>
                                </button>
                            </li>
                        `)}
                    </ul>
                </section>
            `)}
        `);
    }

    /* ---------------------------------------------------------------- FILTERS */

    /**
     * Only the filters this report declares are drawn. A branch report showing
     * a batch picker that does nothing is how people stop trusting filters.
     */
    paintFilters(report) {
        const accepts = new Set(report.filters || []);

        render(this.container.querySelector('[data-role="filters"]'), html`
            <div class="row row-wrap">
                ${accepts.has('dateRange') ? html`
                    ${filterDate({ name: 'from', label: 'From', value: this.filters.from })}
                    ${filterDate({ name: 'to', label: 'To', value: this.filters.to })}
                ` : ''}

                ${accepts.has('branch') ? filterSelect({
                    name: 'branchId', label: 'Branch', value: this.filters.branchId || '',
                    options: [
                        { value: '', label: 'All branches' },
                        ...this.reference.branches.map((b) => ({ value: b.id, label: b.name }))
                    ]
                }) : ''}

                ${accepts.has('batch') ? filterSelect({
                    name: 'batchId', label: 'Batch', value: this.filters.batchId,
                    options: [
                        { value: '', label: 'All batches' },
                        ...this.reference.batches.map((b) => ({ value: b.id, label: b.name }))
                    ]
                }) : ''}

                ${accepts.has('level') ? filterSelect({
                    name: 'level', label: 'Level', value: this.filters.level,
                    options: [
                        { value: '', label: 'All levels' },
                        ...LEVELS.map((l) => ({ value: l.value, label: l.label }))
                    ]
                }) : ''}

                ${accepts.has('status') ? filterSelect({
                    name: 'status', label: 'Status', value: this.filters.status,
                    options: [
                        { value: '', label: 'Default' },
                        ...Object.values(STUDENT_STATUS).map((v) => ({
                            value: v, label: v.replace(/_/g, ' ')
                        }))
                    ]
                }) : ''}
            </div>
        `);
    }

    /* ----------------------------------------------------------------- RUN */

    async execute() {
        const report = reportById(this.reportId);
        this.paintFilters(report);

        render(this.container.querySelector('[data-role="title"]'), report.name);
        render(this.container.querySelector('[data-role="subtitle"]'), report.description);
        render(this.container.querySelector('[data-role="meta"]'), html`<div class="skeleton skeleton-row"></div>`);

        try {
            this.result = await run(this.reportId, this.filters);
            this.rebuildColumns(this.result.report.columns);
            this.table.setRows(this.result.rows);
            this.paintMeta();
            this.paintActions();
        } catch (err) {
            console.error(err);
            this.result = null;
            this.table.setRows([]);
            render(this.container.querySelector('[data-role="meta"]'), html`
                <div class="alert alert-danger">
                    <div class="alert-title">This report could not be built</div>
                    <p class="alert-body">${err.message}</p>
                </div>
            `);
            this.paintActions();
        }
    }

    paintMeta() {
        const result = this.result;

        render(this.container.querySelector('[data-role="meta"]'), html`
            <div class="report-meta spread">
                <div>
                    <span class="type-strong">${formatNumber(result.count)} row${result.count === 1 ? '' : 's'}</span>
                    <span class="type-caption type-muted">
                        · ${formatDate(result.filters.from)} to ${formatDate(result.filters.to)}
                        · run by ${result.generatedBy} at ${formatDateTime(result.generatedAt)}
                    </span>
                </div>
                ${result.totals ? html`
                    <div class="report-total">
                        <span class="type-caption type-muted">${result.totals.label}</span>
                        <span class="type-strong">${result.totals.value}</span>
                    </div>
                ` : ''}
            </div>
            ${result.note ? html`
                <div class="alert alert-info"><p class="alert-body">${result.note}</p></div>
            ` : ''}
        `);
    }

    paintActions() {
        const disabled = !this.result?.count ? 'disabled' : '';

        render(this.container.querySelector('[data-role="actions"]'), html`
            <button class="btn btn-secondary btn-sm" data-export="csv" ${disabled}>
                ${raw(icon('download', { size: 15 }))} CSV
            </button>
            <button class="btn btn-secondary btn-sm" data-export="xls" ${disabled}>
                ${raw(icon('file-text', { size: 15 }))} Spreadsheet
            </button>
            <button class="btn btn-primary btn-sm" data-export="print" ${disabled}>
                ${raw(icon('printer', { size: 15 }))} Print / PDF
            </button>
        `);
    }

    /* ---------------------------------------------------------------- TABLE */

    buildTable() {
        this.table = new DataTable({
            rows: [],
            columns: [],
            searchable: true,
            searchPlaceholder: 'Search within this report…',
            pageSize: 50,
            emptyTitle: 'Nothing to report',
            emptyMessage: 'No rows match these filters. Widen the date range or clear a filter.',
            emptyIcon: 'file-text'
        });

        this.table.mount(this.container.querySelector('[data-role="table"]'));
        this.onDispose(() => this.table.destroy());
    }

    /**
     * Report columns are declared by the service, so they are translated into
     * DataTable columns rather than duplicated. `format` is display only; the
     * exports use the service's own formatter so a printed figure and an
     * exported one can never disagree.
     */
    rebuildColumns(columns) {
        this.table.setColumns(columns.map((column) => ({
            key: column.key,
            label: column.label,
            align: column.align || 'left',
            sortable: true,
            sortValue: column.numeric ? (row) => Number(row[column.key] || 0) : undefined,
            render: (row) => {
                const value = row[column.key];
                const text = column.format ? column.format(value) : (value ?? '—');
                return row.emphasis
                    ? html`<span class="type-strong">${text}</span>`
                    : html`<span>${text}</span>`;
            }
        })));
    }

    /* --------------------------------------------------------------- EXPORT */

    async exportAs(kind) {
        if (!this.result?.count) return;

        try {
            switch (kind) {
                case 'csv':
                    downloadCSV(this.result);
                    toast.success(`${this.result.count} rows exported as CSV.`);
                    break;
                case 'xls':
                    downloadSpreadsheet(this.result);
                    toast.success('Spreadsheet downloaded. Excel opens it directly.');
                    break;
                case 'print':
                    await printReport(this.result);
                    break;
                default:
                    break;
            }
        } catch (err) {
            toast.error(err.message);
        }
    }
}
