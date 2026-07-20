/**
 * NATYAM ERP 2.0 — Fee collection
 *
 * Collection only. This module raises invoices and takes money; it does not do
 * accounting. That separation is deliberate and is the reason 1.0's "finance"
 * tab could never answer a simple question about profit: it conflated a fee
 * receipt with a ledger entry, so an expense had nowhere to live and income
 * could only ever mean fees.
 *
 * Here, taking a payment posts an income entry into the ledger inside the same
 * transaction — one atomic write, done by fees.service.recordPayment. The
 * finance module reads that ledger and never recomputes income from invoices.
 * This page's only job is to make the taking of money quick and hard to get
 * wrong.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { drawer, confirm } from '../../ui/overlay.js';
import { DataTable } from '../../ui/table.js';
import { formOverlay, summaryList } from '../../ui/form.js';
import { downloadCSV } from '../../utils/csv.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { formatMoney, formatMoneyShort, formatNumber, amountInWords } from '../../utils/money.js';
import { formatDate, formatDateLong, localDate, startOfMonth } from '../../utils/date.js';
import { donutChart, legend, chartPalette, kpiCard } from '../../ui/chart.js';
import { PAYMENT_MODES } from '../../config/app.config.js';

import {
    studentFeeSummary, recordPayment, refundPayment, waiveInvoice,
    raiseSchedule, collectionSummary, sweepOverdue, receiptData, createInvoice
} from '../../services/fees.service.js';
import { listStudents } from '../../services/students.service.js';
import { institute } from '../../services/settings.service.js';

export default class FeesPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Fees';
        this.filter = this.query.filter || 'owing';
        this.range = {
            from: this.query.from || startOfMonth(localDate()),
            to: this.query.to || localDate()
        };
    }

    async render(container) {
        this.container = container;
        render(container, this.shell());
        this.bind();
        this.buildTable();
        await this.load();

        // Deep link from the student profile: "collect a fee for this person".
        if (this.query.student && this.query.collect) {
            await this.openStudent(this.query.student);
        }
    }

    shell() {
        return html`
            <header class="page-header">
                <div class="page-header-text">
                    <h1 class="page-title">Fees</h1>
                    <p class="page-subtitle" data-role="subtitle">Collections and outstanding balances.</p>
                </div>
                <div class="page-actions">
                    <button class="btn btn-secondary btn-sm" data-action="export">
                        ${raw(icon('download', { size: 15 }))} Export
                    </button>
                    ${session.can('fee.collect') ? html`
                        <button class="btn btn-secondary btn-sm" data-action="sweep">Refresh overdue</button>
                    ` : ''}
                </div>
            </header>
            <div class="page-body">
                <div data-role="summary"></div>
                <div class="filter-bar">
                    <div class="row row-wrap">
                        ${[
                            { key: 'owing', label: 'Owing' },
                            { key: 'overdue', label: 'Overdue' },
                            { key: 'clear', label: 'Settled' },
                            { key: 'all', label: 'Everyone' }
                        ].map((chip) => html`
                            <button class="btn btn-sm ${this.filter === chip.key ? 'btn-primary' : 'btn-secondary'}"
                                    data-quick="${chip.key}" aria-pressed="${this.filter === chip.key}">
                                ${chip.label}
                            </button>
                        `)}
                    </div>
                    <div class="row row-wrap">
                        <label class="filter-control">
                            <span class="type-caption type-muted">Collections from</span>
                            <input class="input input-sm" type="date" value="${this.range.from}" data-range="from">
                        </label>
                        <label class="filter-control">
                            <span class="type-caption type-muted">to</span>
                            <input class="input input-sm" type="date" value="${this.range.to}" data-range="to">
                        </label>
                    </div>
                </div>
                <div data-role="table"></div>
            </div>
        `;
    }

    bind() {
        this.onDispose(on(this.container, 'click', '[data-quick]', (_e, target) => {
            this.filter = target.dataset.quick;
            this.container.querySelectorAll('[data-quick]').forEach((node) => {
                const active = node.dataset.quick === this.filter;
                node.classList.toggle('btn-primary', active);
                node.classList.toggle('btn-secondary', !active);
                node.setAttribute('aria-pressed', String(active));
            });
            this.applyFilter();
        }));
        this.onDispose(on(this.container, 'change', '[data-range]', (_e, target) => {
            this.range[target.dataset.range] = target.value;
            this.loadSummary();
        }));
        this.onDispose(on(this.container, 'click', '[data-action="export"]', () => this.exportDues()));
        this.onDispose(on(this.container, 'click', '[data-action="sweep"]', () => this.sweep()));

        [EVENTS.PAYMENT_RECORDED, EVENTS.INVOICE_CREATED, EVENTS.BRANCH_CHANGED]
            .forEach((event) => this.events.on(event, () => this.load()));
    }

    buildTable() {
        const canCollect = session.can('fee.collect');

        this.table = new DataTable({
            rows: [],
            searchPlaceholder: 'Search student, admission number or guardian…',
            defaultSort: 'outstanding',
            defaultSortDir: 'desc',
            emptyTitle: 'Nothing outstanding',
            emptyMessage: 'Every student in this view has settled their fees.',
            emptyIcon: 'check-circle',
            onRowClick: (row) => this.openStudent(row.id),
            columns: [
                {
                    key: 'name', label: 'Student', sortable: true,
                    searchValue: (row) => `${row.name} ${row.admissionNo || ''} ${row.guardianName || ''}`,
                    render: (row) => html`
                        <div>
                            <span class="type-strong">${row.name}</span>
                            <div class="type-caption type-muted">
                                ${row.admissionNo || ''} ${row.batchName ? `· ${row.batchName}` : '· not placed'}
                            </div>
                        </div>
                    `
                },
                { key: 'levelLabel', label: 'Level', sortable: true },
                {
                    key: 'guardianName', label: 'Guardian', sortable: true,
                    render: (row) => row.guardianPhone
                        ? html`<div>
                                   <span>${row.guardianName || '—'}</span>
                                   <div class="type-caption type-muted">${row.guardianPhone}</div>
                               </div>`
                        : html`<span class="type-muted">${row.guardianName || '—'}</span>`
                },
                {
                    key: 'overdue', label: 'Overdue', align: 'right', sortable: true,
                    exportValue: (row) => row.overdue / 100,
                    render: (row) => row.overdue > 0
                        ? html`<span class="badge badge-danger">${formatMoney(row.overdue)}</span>`
                        : html`<span class="type-muted">—</span>`
                },
                {
                    key: 'outstanding', label: 'Outstanding', align: 'right', sortable: true,
                    exportValue: (row) => row.outstanding / 100,
                    render: (row) => html`<span class="type-strong">${formatMoney(row.outstanding)}</span>`
                },
                {
                    key: 'collect', label: '', sortable: false,
                    render: (row) => canCollect && row.outstanding > 0
                        ? html`<button class="btn btn-sm btn-primary" data-collect="${row.id}">Collect</button>`
                        : ''
                }
            ]
        });

        this.table.mount(this.container.querySelector('[data-role="table"]'));
        this.onDispose(() => this.table.destroy());
        this.onDispose(on(this.container, 'click', '[data-collect]', async (event, target) => {
            event.stopPropagation();
            await this.openStudent(target.dataset.collect, { straightToPayment: true });
        }));
    }

    async load() {
        try {
            this.rows = await listStudents(session.branch(), { status: 'all' });
            this.applyFilter();
            await this.loadSummary();
        } catch (err) {
            console.error(err);
            toast.error(err.message);
        }
    }

    applyFilter() {
        const rows = this.rows.filter((row) => {
            switch (this.filter) {
                case 'owing': return row.outstanding > 0;
                case 'overdue': return row.overdue > 0;
                case 'clear': return row.outstanding === 0;
                default: return true;
            }
        });
        this.table.setRows(rows);
    }

    async loadSummary() {
        try {
            const stats = await collectionSummary({
                from: this.range.from,
                to: this.range.to,
                branchId: session.branch()
            });

            render(this.container.querySelector('[data-role="subtitle"]'), html`
                ${formatMoney(stats.collected)} collected in this period
                · ${formatMoney(stats.outstanding)} still owed across ${formatNumber(stats.outstandingCount)} invoices
            `);

            render(this.container.querySelector('[data-role="summary"]'), html`
                <div class="grid grid-4">
                    ${kpiCard('Collected', formatMoney(stats.collected),
                        `${formatNumber(stats.receiptCount)} receipts`)}
                    ${kpiCard('Refunded', formatMoney(stats.refunded), stats.refunded ? 'in this period' : 'none')}
                    ${kpiCard('Outstanding', formatMoney(stats.outstanding),
                        `${formatNumber(stats.outstandingCount)} open invoices`, { tone: stats.outstanding ? 'caution' : 'positive' })}
                    ${kpiCard('Oldest debt', stats.ageing[3]?.amount
                        ? formatMoneyShort(stats.ageing[3].amount) : '—',
                        'over 60 days', { tone: stats.ageing[3]?.amount ? 'negative' : 'positive' })}
                </div>

                <div class="grid grid-2-1">
                    <div class="card">
                        <div class="card-header"><h2 class="card-title">Ageing</h2>
                            <p class="card-subtitle">How long the money has been owed.</p></div>
                        <div class="card-body card-body-flush">
                            <div class="table-wrap"><table class="table table-compact">
                                <thead><tr>
                                    <th scope="col">Age</th>
                                    <th scope="col" class="text-right">Invoices</th>
                                    <th scope="col" class="text-right">Amount</th>
                                </tr></thead>
                                <tbody>
                                    ${stats.ageing.map((bucket) => html`
                                        <tr>
                                            <th scope="row">${bucket.label}</th>
                                            <td class="text-right">${formatNumber(bucket.count)}</td>
                                            <td class="text-right">${formatMoney(bucket.amount)}</td>
                                        </tr>
                                    `)}
                                </tbody>
                            </table></div>
                        </div>
                    </div>

                    <div class="card">
                        <div class="card-header"><h2 class="card-title">How they paid</h2></div>
                        <div class="card-body">
                            ${stats.byMode.length ? html`
                                ${raw(donutChart(stats.byMode.map((m) => ({ label: m.label, value: m.amount })), {
                                    size: 150,
                                    centreValue: formatMoneyShort(stats.collected),
                                    centreLabel: 'collected'
                                }))}
                                ${raw(legend(stats.byMode.map((mode, index) => ({
                                    label: `${mode.label} — ${formatMoney(mode.amount)}`,
                                    color: chartPalette[index % chartPalette.length]
                                }))))}
                            ` : html`<p class="type-muted">No payments in this period.</p>`}
                        </div>
                    </div>
                </div>
            `);
        } catch (err) {
            console.error(err);
        }
    }

    /**
     * A one-off invoice outside the fee schedule: costumes, an examination
     * entry, a competition fee. Without this the only billable thing is the
     * monthly tuition, and every school charges for more than tuition — the
     * rest would be collected off the books entirely.
     */
    async billExtra(student) {
        const done = await formOverlay({
            title: `Bill ${student.name}`,
            description: 'A one-off invoice, separate from the monthly fee schedule.',
            submitLabel: 'Raise invoice',
            fields: [
                { name: 'description', label: 'What is being billed', required: true,
                  placeholder: 'Annual day costume' },
                { name: 'amount', label: 'Amount', type: 'money', required: true, width: 'half' },
                { name: 'dueDate', label: 'Due by', type: 'date', required: true, width: 'half',
                  value: localDate() },
                { name: 'discount', label: 'Concession', type: 'money', width: 'half',
                  hint: 'Leave empty unless the family is being charged less.' },
                { name: 'discountReason', label: 'Reason for the concession', width: 'half' }
            ],
            onSubmit: async (values) => createInvoice({
                ...values,
                studentId: student.id,
                branchId: student.branchId
            })
        });

        if (done) {
            toast.success('Invoice raised.');
            await this.openStudent(student.id);
        }
    }

    async sweep() {
        try {
            const count = await sweepOverdue();
            toast.success(count
                ? `${count} invoice${count === 1 ? '' : 's'} moved to overdue.`
                : 'Nothing new is overdue.');
            await this.load();
        } catch (err) {
            toast.error(err.message);
        }
    }

    /* --------------------------------------------------------- STUDENT LEDGER */

    async openStudent(studentId, { straightToPayment = false } = {}) {
        const student = this.rows?.find((row) => row.id === studentId);
        let fees;

        try {
            fees = await studentFeeSummary(studentId);
        } catch (err) {
            toast.error(err.message);
            return;
        }

        if (straightToPayment) {
            const open = fees.invoices.filter((invoice) => invoice.balance > 0);
            if (open.length) {
                await this.collect(open[0], student, fees);
                return;
            }
        }

        await drawer({
            title: student?.name || 'Fee record',
            description: fees.outstanding
                ? `${formatMoney(fees.outstanding)} outstanding`
                : 'All settled',
            size: 'wide',
            content: html`
                <div class="grid grid-3">
                    ${kpiCard('Billed', formatMoney(fees.billed))}
                    ${kpiCard('Collected', formatMoney(fees.collected))}
                    ${kpiCard('Outstanding', formatMoney(fees.outstanding),
                        fees.overdue ? `${formatMoney(fees.overdue)} overdue` : null, { tone: fees.overdue ? 'negative' : fees.outstanding ? 'caution' : 'positive' })}
                </div>

                ${!fees.invoices.length ? html`
                    <div class="alert alert-warning">
                        <div class="alert-title">Nothing has been billed</div>
                        <p class="alert-body">This student has no fee schedule. They will never appear on a
                        dues list until one is raised.</p>
                        ${session.can('fee.collect') ? html`
                            <button class="btn btn-sm btn-primary" data-action="raise">Raise fee schedule</button>
                        ` : ''}
                    </div>
                ` : ''}

                <div class="card">
                    <div class="card-header">
                        <h3 class="card-title">Invoices</h3>
                        ${session.can('fee.collect') ? html`
                            <div class="card-actions">
                                <button class="btn btn-sm btn-secondary" data-action="bill">
                                    Bill something else
                                </button>
                            </div>
                        ` : ''}
                    </div>
                    <div class="card-body card-body-flush">
                        <div class="table-wrap"><table class="table table-compact">
                            <thead><tr>
                                <th scope="col">Invoice</th>
                                <th scope="col">Due</th>
                                <th scope="col" class="text-right">Amount</th>
                                <th scope="col" class="text-right">Balance</th>
                                <th scope="col">Status</th>
                                <th scope="col"></th>
                            </tr></thead>
                            <tbody>
                                ${fees.invoices.map((invoice) => html`
                                    <tr>
                                        <th scope="row">
                                            ${invoice.number}
                                            <div class="type-caption type-muted">${invoice.description || ''}</div>
                                        </th>
                                        <td>${formatDate(invoice.dueDate)}</td>
                                        <td class="text-right">${formatMoney(invoice.amount)}</td>
                                        <td class="text-right">${formatMoney(invoice.balance)}</td>
                                        <td><span class="badge ${statusBadge(invoice.status)}">${invoice.status}</span></td>
                                        <td class="text-right">
                                            ${invoice.balance > 0 && session.can('fee.collect') ? html`
                                                <div class="row row-tight">
                                                    <button class="btn btn-sm btn-primary"
                                                            data-pay="${invoice.id}">Collect</button>
                                                    <button class="btn btn-sm btn-ghost"
                                                            data-waive="${invoice.id}">Waive</button>
                                                </div>
                                            ` : ''}
                                        </td>
                                    </tr>
                                `)}
                            </tbody>
                        </table></div>
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
                                                ${receipt.reference ? `· ${receipt.reference}` : ''}
                                                ${receipt.status === 'refunded' ? ' · refunded' : ''}
                                            </div>
                                        </div>
                                        <div class="row row-tight">
                                            <span class="type-strong">${formatMoney(receipt.amount)}</span>
                                            <button class="btn btn-sm btn-ghost"
                                                    data-receipt="${receipt.id}">Receipt</button>
                                            ${receipt.status !== 'refunded' && session.can('fee.refund') ? html`
                                                <button class="btn btn-sm btn-ghost"
                                                        data-refund="${receipt.id}">Refund</button>
                                            ` : ''}
                                        </div>
                                    </li>
                                `)}
                            </ul>
                        ` : html`<p class="type-muted">No payments received yet.</p>`}
                    </div>
                </div>
            `,
            actions: [{ label: 'Close', variant: 'secondary', value: null }],
            onMount: (body, api) => {
                on(body, 'click', '[data-pay]', async (_e, target) => {
                    const invoice = fees.invoices.find((i) => i.id === target.dataset.pay);
                    api.close(null);
                    await this.collect(invoice, student, fees);
                });
                on(body, 'click', '[data-waive]', async (_e, target) => {
                    const invoice = fees.invoices.find((i) => i.id === target.dataset.waive);
                    api.close(null);
                    await this.waive(invoice);
                });
                on(body, 'click', '[data-refund]', async (_e, target) => {
                    const receipt = fees.receipts.find((r) => r.id === target.dataset.refund);
                    api.close(null);
                    await this.refund(receipt);
                });
                on(body, 'click', '[data-receipt]', async (_e, target) => {
                    await this.printReceipt(target.dataset.receipt);
                });
                on(body, 'click', '[data-action="bill"]', async () => {
                    api.close(null);
                    await this.billExtra(student);
                });
                on(body, 'click', '[data-action="raise"]', async () => {
                    api.close(null);
                    await this.raise(studentId);
                });
            }
        });
    }

    /* -------------------------------------------------------------- COLLECT */

    async collect(invoice, student, fees) {
        if (!invoice) return;

        const result = await formOverlay({
            title: `Collect — ${student?.name || 'student'}`,
            description: `${invoice.number} · ${formatMoney(invoice.balance)} outstanding`,
            variant: 'modal',
            submitLabel: 'Record payment',
            intro: fees?.overdue
                ? `This family owes ${formatMoney(fees.outstanding)} in total.`
                : null,
            fields: [
                {
                    name: 'amount', label: 'Amount received', type: 'money', required: true,
                    value: invoice.balance, width: 'half',
                    hint: `Up to ${formatMoney(invoice.balance)}. Part payments are fine.`
                },
                { name: 'paidOn', label: 'Received on', type: 'date', required: true,
                  value: localDate(), width: 'half' },
                {
                    name: 'mode', label: 'How', type: 'select', required: true, width: 'half',
                    options: PAYMENT_MODES.map((mode) => ({ value: mode.value, label: mode.label }))
                },
                {
                    name: 'reference', label: 'Reference', width: 'half',
                    hint: 'UPI transaction ID, cheque number or bank reference.'
                },
                { name: 'note', label: 'Note', type: 'textarea', rows: 2 }
            ],
            onSubmit: async (values) => recordPayment({ invoiceId: invoice.id, ...values })
        });

        if (!result) return;

        toast.success(`${formatMoney(result.payment.amount)} received — receipt ${result.payment.receiptNo}.`);
        await this.load();

        const print = await confirm({
            title: 'Print the receipt?',
            message: `Receipt ${result.payment.receiptNo} for ${formatMoney(result.payment.amount)}.`,
            confirmLabel: 'Print receipt',
            cancelLabel: 'Not now'
        });
        if (print) await this.printReceipt(result.payment.id);
    }

    async waive(invoice) {
        const done = await formOverlay({
            title: `Waive ${invoice.number}?`,
            variant: 'modal',
            size: 'sm',
            submitLabel: 'Waive invoice',
            danger: true,
            intro: 'Waiving writes the balance off. It stays on the record with the reason attached.',
            fields: [{
                name: 'reason', label: 'Reason', type: 'textarea', rows: 3, required: true,
                hint: 'Scholarship, hardship, goodwill — whatever it is, someone will ask later.'
            }],
            onSubmit: async (values) => waiveInvoice(invoice.id, { reason: values.reason })
        });

        if (done) {
            toast.success('Invoice waived.');
            await this.load();
        }
    }

    async refund(receipt) {
        const done = await formOverlay({
            title: `Refund receipt ${receipt.receiptNo}?`,
            variant: 'modal',
            size: 'sm',
            submitLabel: 'Refund',
            danger: true,
            intro: `${formatMoney(receipt.amount)} goes back to the family, and the invoice balance is restored.`,
            fields: [{ name: 'reason', label: 'Reason', type: 'textarea', rows: 3, required: true }],
            onSubmit: async (values) => refundPayment(receipt.id, { reason: values.reason })
        });

        if (done) {
            toast.success('Refund recorded.');
            await this.load();
        }
    }

    async raise(studentId) {
        const done = await confirm({
            title: 'Raise the fee schedule?',
            message: 'Invoices are created for the rest of the academic year, using this student\u2019s fee plan.',
            confirmLabel: 'Raise invoices'
        });
        if (!done) return;

        try {
            const result = await raiseSchedule(studentId);
            toast.success(`${result.invoices.length} invoices raised.`);
            await this.load();
        } catch (err) {
            toast.error(err.message);
        }
    }

    /* --------------------------------------------------------------- RECEIPT */

    async printReceipt(paymentId) {
        try {
            const [data, school] = await Promise.all([receiptData(paymentId), institute()]);
            const win = window.open('', '_blank', 'width=720,height=900');
            if (!win) {
                toast.error('Allow pop-ups to print the receipt.');
                return;
            }

            win.document.write(receiptHTML(data, school));
            win.document.close();
            win.focus();
            win.print();
        } catch (err) {
            toast.error(err.message);
        }
    }

    exportDues() {
        const rows = this.table.processed.map((row) => ({
            'Admission no': row.admissionNo || '',
            Student: row.name,
            Level: row.levelLabel,
            Batch: row.batchName || '',
            Guardian: row.guardianName || '',
            Phone: row.guardianPhone || '',
            Overdue: row.overdue / 100,
            Outstanding: row.outstanding / 100
        }));

        downloadCSV(`natyam-fees-${localDate()}`, rows);
        toast.success(`${rows.length} rows exported.`);
    }
}

/* ------------------------------------------------------------------ HELPERS */

function statusBadge(status) {
    return {
        paid: 'badge-success',
        overdue: 'badge-danger',
        partial: 'badge-warning',
        open: 'badge-info',
        waived: 'badge-neutral',
        cancelled: 'badge-neutral'
    }[status] || 'badge-neutral';
}


/**
 * Receipts print from a self-contained document rather than the app's
 * stylesheet: a print window that depends on the running app's CSS breaks the
 * day someone opens it from a stale tab, and a receipt is the one artefact a
 * family keeps.
 */
function receiptHTML(data, school) {
    const { payment, invoice, student } = data;
    const name = school?.name || 'NATYAM — School of Kuchipudi';

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Receipt ${payment.receiptNo}</title>
<style>
  body { font: 13px/1.55 "Segoe UI", system-ui, sans-serif; color: #1a1a1a; margin: 32px; }
  h1 { font-size: 18px; margin: 0; letter-spacing: .02em; }
  .head { border-bottom: 2px solid #b8562f; padding-bottom: 12px; margin-bottom: 20px; }
  .muted { color: #6b6b6b; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; margin: 18px 0; }
  th, td { text-align: left; padding: 7px 0; border-bottom: 1px solid #e6e2dc; }
  td.amt, th.amt { text-align: right; }
  .total { font-weight: 600; font-size: 15px; }
  .words { font-style: italic; color: #4a4a4a; margin-top: 4px; }
  .foot { margin-top: 40px; display: flex; justify-content: space-between; font-size: 12px; }
  @media print { body { margin: 12mm; } }
</style></head><body>
  <div class="head">
    <h1>${escape(name)}</h1>
    <div class="muted">${escape(school?.address || '')}${school?.phone ? ` · ${escape(school.phone)}` : ''}</div>
  </div>

  <table>
    <tr><th>Receipt number</th><td class="amt">${escape(payment.receiptNo)}</td></tr>
    <tr><th>Date</th><td class="amt">${escape(formatDateLong(payment.paidOn))}</td></tr>
    <tr><th>Received from</th><td class="amt">${escape(student?.name || '')}</td></tr>
    <tr><th>Admission number</th><td class="amt">${escape(student?.admissionNo || '')}</td></tr>
    <tr><th>Towards</th><td class="amt">${escape(invoice?.description || invoice?.number || 'Fees')}</td></tr>
    <tr><th>Paid by</th><td class="amt">${escape(payment.mode)}${payment.reference ? ` · ${escape(payment.reference)}` : ''}</td></tr>
    <tr class="total"><th>Amount</th><td class="amt">${escape(formatMoney(payment.amount))}</td></tr>
  </table>

  <div class="words">${escape(amountInWords(payment.amount))}</div>

  <div class="foot">
    <span>Computer-generated receipt. No signature required.</span>
    <span>${escape(formatDateLong(localDate()))}</span>
  </div>
</body></html>`;
}

function escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}
