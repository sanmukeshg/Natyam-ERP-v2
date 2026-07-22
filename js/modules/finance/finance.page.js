/**
 * NATYAM ERP 2.0 — Finance
 *
 * Separate from fees, and that separation is the point. In 1.0 "finance" meant
 * a list of fee receipts, so the school could see what came in and had no way
 * to record what went out; the answer to "did we make money last month" was a
 * spreadsheet somebody kept privately.
 *
 * Here the ledger is the source of truth. Fee payments post into it
 * automatically, expenses and salaries post into it explicitly, and the P&L
 * reads it and nothing else. No screen in this module recomputes income from
 * invoices — if it did, the two numbers would drift and both would be quoted.
 *
 * Four views, one route: position, ledger, expenses, payroll.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { confirm } from '../../ui/overlay.js';
import { formOverlay, optionsFrom } from '../../ui/form.js';
import { downloadCSV } from '../../utils/csv.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { formatMoney, formatMoneyShort, formatNumber } from '../../utils/money.js';
import { formatDate, formatMonth, localDate, monthKey, startOfMonth } from '../../utils/date.js';
import { barChart, donutChart, legend, chartPalette, kpiCard } from '../../ui/chart.js';
import { EXPENSE_CATEGORIES, PAYMENT_MODES } from '../../config/app.config.js';

import {
    ACCOUNTS, postEntry, reverseEntry, recordExpense, updateExpense, removeExpense, listExpenses,
    preparePayroll, adjustSalary, paySalaries, profitAndLoss, monthlySeries,
    ledgerView, expenseBreakdown, branchPerformance
} from '../../services/finance.service.js';

import { listBranches } from '../../services/settings.service.js';

const TABS = [
    { key: 'position', label: 'Position' },
    { key: 'ledger', label: 'Ledger' },
    { key: 'expenses', label: 'Expenses' },
    { key: 'payroll', label: 'Payroll' }
];

export default class FinancePage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Finance';
        this.tab = this.query.tab || 'position';
        this.range = {
            from: this.query.from || startOfMonth(localDate()),
            to: this.query.to || localDate()
        };
        this.period = this.query.period || monthKey();
    }

    async render(container) {
        this.container = container;
        session.require('finance.view', 'open the finance module');

        render(container, this.shell());
        this.bind();
        await this.paint();
    }

    shell() {
        return html`
            <header class="page-header">
                <div class="page-header-text">
                    <h1 class="page-title">Finance</h1>
                    <p class="page-subtitle">Income, expenditure and payroll, read from the ledger.</p>
                </div>
                <div class="page-actions">
                    <label class="filter-control">
                        <span class="type-caption type-muted">From</span>
                        <input class="input input-sm" type="date" value="${this.range.from}" data-range="from">
                    </label>
                    <label class="filter-control">
                        <span class="type-caption type-muted">To</span>
                        <input class="input input-sm" type="date" value="${this.range.to}" data-range="to">
                    </label>
                    ${session.can('finance.edit') ? html`
                        <button class="btn btn-primary btn-sm" data-action="expense">
                            ${raw(icon('plus', { size: 15 }))} Record expense
                        </button>
                    ` : ''}
                </div>
            </header>
            <div class="page-body">
                <div class="tabs" role="tablist">
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
        this.onDispose(on(this.container, 'change', '[data-range]', (_e, target) => {
            this.range[target.dataset.range] = target.value;
            this.paint();
        }));
        this.onDispose(on(this.container, 'click', '[data-action="expense"]', () => this.recordExpense()));
        this.onDispose(on(this.container, 'click', '[data-expense-edit]', (_e, target) =>
            this.correctExpense(target.dataset.expenseEdit)));
        this.onDispose(on(this.container, 'click', '[data-expense-remove]', (_e, target) =>
            this.removeExpenseFlow(target.dataset.expenseRemove)));

        [EVENTS.EXPENSE_RECORDED, EVENTS.LEDGER_POSTED, EVENTS.SALARY_PROCESSED,
         EVENTS.PAYMENT_RECORDED, EVENTS.BRANCH_CHANGED]
            .forEach((event) => this.events.on(event, () => this.paint()));
    }

    async paint() {
        const panel = this.container.querySelector('[data-role="panel"]');
        render(panel, html`<div class="skeleton skeleton-row"></div>`);

        try {
            switch (this.tab) {
                case 'ledger': return render(panel, await this.ledgerPanel());
                case 'expenses': return render(panel, await this.expensesPanel());
                case 'payroll': return render(panel, await this.payrollPanel());
                default: return render(panel, await this.positionPanel());
            }
        } catch (err) {
            console.error(err);
            render(panel, html`
                <div class="alert alert-danger">
                    <div class="alert-title">This view could not be built</div>
                    <p class="alert-body">${err.message}</p>
                </div>
            `);
            return undefined;
        }
    }

    /* -------------------------------------------------------------- POSITION */

    async positionPanel() {
        const [pl, series, expenses, branches] = await Promise.all([
            profitAndLoss({ ...this.range, branchId: session.branch() }),
            monthlySeries(6, session.branch()),
            expenseBreakdown({ ...this.range, branchId: session.branch() }),
            branchPerformance(this.range).catch(() => [])
        ]);

        return html`
            <section class="finance-summary">
                <div class="finance-summary-head">
                    <div>
                        <p class="finance-summary-label">Net position</p>
                        <p class="finance-summary-value" data-tone="${pl.net >= 0 ? 'positive' : 'negative'}">
                            ${formatMoney(pl.net)}
                        </p>
                        <p class="finance-summary-meta">
                            ${formatDate(pl.from)} — ${formatDate(pl.to)}
                            · ${formatNumber(pl.entryCount)} ledger entries
                        </p>
                    </div>
                    <div class="finance-summary-split">
                        <div class="finance-stat">
                            <span class="finance-stat-label">Income</span>
                            <span class="finance-stat-value" data-tone="positive">${formatMoney(pl.totalIncome)}</span>
                        </div>
                        <div class="finance-stat">
                            <span class="finance-stat-label">Expenditure</span>
                            <span class="finance-stat-value" data-tone="negative">${formatMoney(pl.totalExpense)}</span>
                        </div>
                        <div class="finance-stat">
                            <span class="finance-stat-label">Margin</span>
                            <span class="finance-stat-value">${pl.margin === null ? '—' : `${pl.margin}%`}</span>
                        </div>
                    </div>
                </div>
            </section>

            <div class="card">
                <div class="card-header">
                    <h2 class="card-title">Six months</h2>
                    <p class="card-subtitle">Net position per month, from the ledger.</p>
                </div>
                <div class="card-body">
                    ${raw(barChart(series.map((row) => ({ label: row.label, value: row.net })), {
                        height: 180,
                        formatValue: (value) => formatMoneyShort(value),
                        highlightLast: true,
                        title: 'Net position by month'
                    }))}
                </div>
            </div>

            <div class="grid grid-2-1">
                <div class="card">
                    <div class="card-header"><h2 class="card-title">Profit and loss</h2>
                        <p class="card-subtitle">${formatDate(pl.from)} to ${formatDate(pl.to)}</p></div>
                    <div class="card-body card-body-flush">
                        <div class="table-wrap"><table class="table table-compact">
                            <tbody>
                                <tr><th scope="row" colspan="2" class="table-section">Income</th></tr>
                                ${pl.income.length ? pl.income.map((row) => html`
                                    <tr><th scope="row">${row.account}</th>
                                        <td class="text-right">${formatMoney(row.amount)}</td></tr>
                                `) : html`<tr><td colspan="2" class="type-muted">No income recorded.</td></tr>`}
                                <tr class="table-total"><th scope="row">Total income</th>
                                    <td class="text-right">${formatMoney(pl.totalIncome)}</td></tr>

                                <tr><th scope="row" colspan="2" class="table-section">Expenditure</th></tr>
                                ${pl.expense.length ? pl.expense.map((row) => html`
                                    <tr><th scope="row">${row.account}</th>
                                        <td class="text-right">${formatMoney(row.amount)}</td></tr>
                                `) : html`<tr><td colspan="2" class="type-muted">No expenditure recorded.</td></tr>`}
                                <tr class="table-total"><th scope="row">Total expenditure</th>
                                    <td class="text-right">${formatMoney(pl.totalExpense)}</td></tr>

                                <tr class="table-total"><th scope="row">Net</th>
                                    <td class="text-right" data-tone="${pl.net >= 0 ? 'positive' : 'negative'}">
                                        ${formatMoney(pl.net)}</td></tr>
                            </tbody>
                        </table></div>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header"><h2 class="card-title">Where it went</h2></div>
                    <div class="card-body">
                        ${expenses.categories.length ? html`
                            ${raw(donutChart(expenses.categories.map((c) => ({ label: c.category, value: c.amount })), {
                                size: 150,
                                centreValue: formatMoneyShort(expenses.total),
                                centreLabel: 'spent'
                            }))}
                            ${raw(legend(expenses.categories.map((category, index) => ({
                                label: `${category.category} — ${category.share}%`,
                                color: chartPalette[index % chartPalette.length]
                            }))))}
                        ` : html`<p class="type-muted">No expenditure in this period.</p>`}
                    </div>
                </div>
            </div>

            ${branches.length > 1 ? html`
                <div class="card">
                    <div class="card-header"><h2 class="card-title">By branch</h2></div>
                    <div class="card-body card-body-flush">
                        <div class="table-wrap"><table class="table table-compact">
                            <thead><tr>
                                <th scope="col">Branch</th>
                                <th scope="col" class="text-right">Income</th>
                                <th scope="col" class="text-right">Expenditure</th>
                                <th scope="col" class="text-right">Net</th>
                                <th scope="col" class="text-right">Margin</th>
                            </tr></thead>
                            <tbody>
                                ${branches.map((row) => html`
                                    <tr>
                                        <th scope="row">${row.branch.name}</th>
                                        <td class="text-right">${formatMoney(row.income)}</td>
                                        <td class="text-right">${formatMoney(row.expense)}</td>
                                        <td class="text-right" data-tone="${row.net >= 0 ? 'positive' : 'negative'}">
                                            ${formatMoney(row.net)}</td>
                                        <td class="text-right">${row.margin === null ? '—' : `${row.margin}%`}</td>
                                    </tr>
                                `)}
                            </tbody>
                        </table></div>
                    </div>
                </div>
            ` : ''}
        `;
    }

    /* ---------------------------------------------------------------- LEDGER */

    async ledgerPanel() {
        const view = await ledgerView({ ...this.range, branchId: session.branch() });

        return html`
            <div class="grid grid-3">
                ${kpiCard('Income', formatMoney(view.totals.income))}
                ${kpiCard('Expenditure', formatMoney(view.totals.expense))}
                ${kpiCard('Net', formatMoney(view.totals.net), null, { tone: view.totals.net >= 0 ? 'positive' : 'negative' })}
            </div>

            <div class="card">
                <div class="card-header">
                    <h2 class="card-title">Ledger</h2>
                    <p class="card-subtitle">Every entry, in date order, with a running balance.</p>
                    <div class="card-actions">
                        ${session.can('finance.edit') ? html`
                            <button class="btn btn-sm btn-secondary" data-action="entry">Manual entry</button>
                        ` : ''}
                        <button class="btn btn-sm btn-secondary" data-action="export-ledger">Export</button>
                    </div>
                </div>
                <div class="card-body card-body-flush">
                    ${view.rows.length ? html`
                        <div class="table-wrap"><table class="table table-compact">
                            <thead><tr>
                                <th scope="col">Date</th>
                                <th scope="col">Account</th>
                                <th scope="col">Narration</th>
                                <th scope="col" class="text-right">Income</th>
                                <th scope="col" class="text-right">Expenditure</th>
                                <th scope="col" class="text-right">Balance</th>
                                <th scope="col"></th>
                            </tr></thead>
                            <tbody>
                                ${view.rows.map((entry) => html`
                                    <tr ${entry.reversedBy ? 'data-tone="muted"' : ''}>
                                        <td>${formatDate(entry.date)}</td>
                                        <th scope="row">${entry.account}</th>
                                        <td>
                                            ${entry.narration || ''}
                                            ${entry.sourceType ? html`
                                                <span class="badge badge-neutral badge-sm">${entry.sourceType}</span>
                                            ` : ''}
                                        </td>
                                        <td class="text-right">${entry.type === 'income' ? formatMoney(entry.amount) : ''}</td>
                                        <td class="text-right">${entry.type === 'expense' ? formatMoney(entry.amount) : ''}</td>
                                        <td class="text-right">${formatMoney(entry.balance)}</td>
                                        <td class="text-right">
                                            ${!entry.reversedBy && !entry.sourceType && session.can('finance.edit') ? html`
                                                <button class="btn btn-sm btn-ghost" data-reverse="${entry.id}">Reverse</button>
                                            ` : ''}
                                        </td>
                                    </tr>
                                `)}
                            </tbody>
                        </table></div>
                    ` : html`
                        <div class="empty empty-compact">
                            <p class="empty-text">No ledger entries in this period.</p>
                        </div>
                    `}
                </div>
            </div>
            ${this.wireLedger(view)}
        `;
    }

    wireLedger(view) {
        queueMicrotask(() => {
            const panel = this.container?.querySelector('[data-role="panel"]');
            if (!panel) return;

            on(panel, 'click', '[data-action="entry"]', () => this.manualEntry());
            on(panel, 'click', '[data-action="export-ledger"]', () => {
                downloadCSV(`natyam-ledger-${this.range.from}-to-${this.range.to}`, view.rows.map((entry) => ({
                    Date: entry.date,
                    Account: entry.account,
                    Type: entry.type,
                    Narration: entry.narration || '',
                    Source: entry.sourceType || 'manual',
                    Amount: entry.amount / 100,
                    Balance: entry.balance / 100
                })));
                toast.success('Ledger exported.');
            });
            on(panel, 'click', '[data-reverse]', async (_e, target) => {
                const ok = await confirm({
                    title: 'Reverse this entry?',
                    message: 'A reversing entry is posted against it. Nothing is deleted — the ledger keeps both, '
                        + 'which is what makes it auditable.',
                    confirmLabel: 'Post reversal',
                    danger: true
                });
                if (!ok) return;
                try {
                    await reverseEntry(target.dataset.reverse, { reason: 'Reversed from the ledger view' });
                    toast.success('Reversal posted.');
                    await this.paint();
                } catch (err) {
                    toast.error(err.message);
                }
            });
        });
        return '';
    }

    async manualEntry() {
        const branches = await listBranches();

        const done = await formOverlay({
            title: 'Manual ledger entry',
            description: 'For donations, ticket sales and corrections — anything no other module posts.',
            submitLabel: 'Post entry',
            fields: [
                {
                    name: 'type', label: 'Kind', type: 'radio', required: true, value: 'income',
                    options: [
                        { value: 'income', label: 'Income' },
                        { value: 'expense', label: 'Expenditure' }
                    ]
                },
                {
                    name: 'account', label: 'Account', type: 'select', required: true,
                    options: [...ACCOUNTS.income, ...ACCOUNTS.expense]
                        .map((account) => ({ value: account, label: account })),
                    hint: 'The account must match the kind above — income accounts for income.'
                },
                { name: 'amount', label: 'Amount', type: 'money', required: true, width: 'half' },
                { name: 'date', label: 'Date', type: 'date', required: true, value: localDate(), width: 'half' },
                {
                    name: 'branchId', label: 'Branch', type: 'select', width: 'half',
                    value: session.branch(), options: optionsFrom(branches, { label: (b) => b.name })
                },
                { name: 'narration', label: 'Narration', type: 'textarea', rows: 2, required: true,
                  hint: 'What this was. Someone will read it a year from now with no other context.' }
            ],
            onSubmit: async (values) => postEntry(values)
        });

        if (done) {
            toast.success('Entry posted.');
            await this.paint();
        }
    }

    /* -------------------------------------------------------------- EXPENSES */

    async expensesPanel() {
        const breakdown = await expenseBreakdown({ ...this.range, branchId: session.branch() });
        const view = await ledgerView({ ...this.range, branchId: session.branch(), type: 'expense' });
        const rows = await listExpenses({ ...this.range, branchId: session.branch() });
        this.expenses = rows;

        return html`
            <div class="grid grid-3">
                ${kpiCard('Spent', formatMoney(breakdown.total), `${formatNumber(breakdown.count)} expenses`)}
                ${kpiCard('Largest category', breakdown.categories[0]?.category || '—',
                    breakdown.categories[0] ? formatMoney(breakdown.categories[0].amount) : null)}
                ${kpiCard('Entries in ledger', formatNumber(view.rows.length))}
            </div>

            <div class="card">
                <div class="card-header">
                    <h2 class="card-title">By category</h2>
                    ${session.can('finance.edit') ? html`
                        <div class="card-actions">
                            <button class="btn btn-sm btn-primary" data-action="expense">Record expense</button>
                        </div>
                    ` : ''}
                </div>
                <div class="card-body card-body-flush">
                    ${breakdown.categories.length ? html`
                        <div class="table-wrap"><table class="table table-compact">
                            <thead><tr>
                                <th scope="col">Category</th>
                                <th scope="col" class="text-right">Count</th>
                                <th scope="col" class="text-right">Amount</th>
                                <th scope="col" class="text-right">Share</th>
                            </tr></thead>
                            <tbody>
                                ${breakdown.categories.map((category) => html`
                                    <tr>
                                        <th scope="row">${category.category}</th>
                                        <td class="text-right">${formatNumber(category.count ?? 0)}</td>
                                        <td class="text-right">${formatMoney(category.amount)}</td>
                                        <td class="text-right">${category.share}%</td>
                                    </tr>
                                `)}
                            </tbody>
                        </table></div>
                    ` : html`
                        <div class="empty empty-compact">
                            <p class="empty-text">No expenses recorded in this period.</p>
                        </div>
                    `}
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h2 class="card-title">Every expense</h2>
                    <p class="card-subtitle">
                        Corrections rewrite the ledger entry alongside the expense, so the two can
                        never disagree. Removals are archived with a reason rather than erased.
                    </p>
                </div>
                <div class="card-body card-body-flush">
                    ${rows.length ? html`
                        <div class="table-wrap"><table class="table table-compact">
                            <thead><tr>
                                <th scope="col">Date</th>
                                <th scope="col">Category</th>
                                <th scope="col">Description</th>
                                <th scope="col">Paid to</th>
                                <th scope="col" class="text-right">Amount</th>
                                <th scope="col"></th>
                            </tr></thead>
                            <tbody>
                                ${rows.map((expense) => html`
                                    <tr>
                                        <td>${formatDate(expense.date)}</td>
                                        <td><span class="badge badge-neutral">${expense.category}</span></td>
                                        <th scope="row">${expense.description || '—'}</th>
                                        <td>${expense.paidTo || '—'}</td>
                                        <td class="text-right">${formatMoney(expense.amount)}</td>
                                        <td class="text-right">
                                            ${session.can('finance.edit') ? html`
                                                <div class="row row-tight">
                                                    <button class="btn btn-sm btn-ghost"
                                                            data-expense-edit="${expense.id}">Correct</button>
                                                    <button class="btn btn-sm btn-danger-quiet"
                                                            data-expense-remove="${expense.id}">Remove</button>
                                                </div>
                                            ` : ''}
                                        </td>
                                    </tr>
                                `)}
                            </tbody>
                        </table></div>
                    ` : html`
                        <div class="empty empty-compact">
                            <p class="empty-text">Nothing spent in this period.</p>
                        </div>
                    `}
                </div>
            </div>
        `;
    }

    /**
     * Correcting an expense rather than deleting and re-entering it: the
     * service rewrites the expense and its ledger entry in one transaction, so
     * the books cannot be left holding the old figure.
     */
    async correctExpense(id) {
        const expense = this.expenses?.find((row) => row.id === id);
        if (!expense) return;

        const done = await formOverlay({
            title: 'Correct this expense',
            description: 'The matching ledger entry is rewritten at the same time.',
            submitLabel: 'Save correction',
            fields: [
                {
                    name: 'category', label: 'Category', type: 'select', required: true,
                    width: 'half', value: expense.category,
                    options: EXPENSE_CATEGORIES.map((category) => ({ value: category, label: category }))
                },
                { name: 'date', label: 'Date', type: 'date', required: true,
                  width: 'half', value: expense.date },
                { name: 'amount', label: 'Amount', type: 'money', required: true,
                  width: 'half', value: expense.amount },
                { name: 'paidTo', label: 'Paid to', width: 'half', value: expense.paidTo },
                { name: 'description', label: 'Description', required: true, value: expense.description },
                { name: 'reference', label: 'Reference', value: expense.reference,
                  hint: 'Bill or voucher number, if there is one.' }
            ],
            onSubmit: async (values) => updateExpense(id, values)
        });

        if (done) {
            toast.success('Expense corrected and the ledger updated.');
            await this.paint();
        }
    }

    async removeExpenseFlow(id) {
        const expense = this.expenses?.find((row) => row.id === id);
        if (!expense) return;

        const done = await formOverlay({
            title: 'Remove this expense?',
            variant: 'modal',
            size: 'sm',
            submitLabel: 'Remove expense',
            danger: true,
            intro: `${formatMoney(expense.amount)} — ${expense.description || expense.category}. `
                + 'The ledger entry goes with it. The expense is archived, not erased, so the '
                + 'audit trail still shows it existed and why it went.',
            fields: [{ name: 'reason', label: 'Why is this being removed?',
                      type: 'textarea', rows: 2, required: true }],
            onSubmit: async (values) => removeExpense(id, { reason: values.reason })
        });

        if (done) {
            toast.success('Expense removed and the ledger corrected.');
            await this.paint();
        }
    }

    async recordExpense() {
        session.require('finance.edit', 'record an expense');
        const branches = await listBranches();

        const done = await formOverlay({
            title: 'Record an expense',
            description: 'Posts to the ledger immediately — expenses and their ledger entry are written together.',
            submitLabel: 'Record expense',
            fields: [
                {
                    name: 'category', label: 'Category', type: 'select', required: true,
                    options: EXPENSE_CATEGORIES.map((category) => ({ value: category, label: category }))
                },
                { name: 'description', label: 'What was it for', required: true,
                  hint: 'Specific enough to recognise on a bank statement.' },
                { name: 'amount', label: 'Amount', type: 'money', required: true, width: 'half' },
                { name: 'date', label: 'Date', type: 'date', required: true, value: localDate(), width: 'half' },
                { name: 'paidTo', label: 'Paid to', width: 'half' },
                {
                    name: 'mode', label: 'How', type: 'select', width: 'half', value: 'cash',
                    options: PAYMENT_MODES.map((mode) => ({ value: mode.value, label: mode.label }))
                },
                { name: 'reference', label: 'Reference', width: 'half' },
                {
                    name: 'branchId', label: 'Branch', type: 'select', required: true, width: 'half',
                    value: session.branch(), options: optionsFrom(branches, { label: (b) => b.name })
                }
            ],
            onSubmit: async (values) => recordExpense(values)
        });

        if (done) {
            toast.success('Expense recorded and posted to the ledger.');
            await this.paint();
        }
    }

    /* --------------------------------------------------------------- PAYROLL */

    async payrollPanel() {
        let payroll;
        try {
            payroll = await preparePayroll(this.period, { branchId: session.branch() });
        } catch (err) {
            return html`
                <div class="alert alert-warning">
                    <div class="alert-title">Payroll unavailable</div>
                    <p class="alert-body">${err.message}</p>
                </div>
            `;
        }

        const pending = payroll.lines.filter((line) => line.status === 'pending');

        return html`
            <div class="filter-bar">
                <label class="filter-control">
                    <span class="type-caption type-muted">Pay period</span>
                    <input class="input input-sm" type="month" value="${this.period}" data-role="period">
                </label>
            </div>

            <div class="grid grid-3">
                ${kpiCard('Gross', formatMoney(payroll.gross), `${formatNumber(payroll.lines.length)} staff`)}
                ${kpiCard('Net payable', formatMoney(payroll.net))}
                ${kpiCard('Awaiting payment', formatNumber(pending.length),
                    pending.length ? formatMoney(pending.reduce((s, l) => s + l.net, 0)) : 'all paid', { tone: pending.length ? 'caution' : 'positive' })}
            </div>

            <div class="card">
                <div class="card-header">
                    <h2 class="card-title">${formatMonth(this.period)}</h2>
                    <p class="card-subtitle">Salaries post to the ledger as one atomic run.</p>
                    ${pending.length && session.can('finance.edit') ? html`
                        <div class="card-actions">
                            <button class="btn btn-sm btn-primary" data-action="pay">
                                Pay ${pending.length} staff
                            </button>
                        </div>
                    ` : ''}
                </div>
                <div class="card-body card-body-flush">
                    ${payroll.lines.length ? html`
                        <div class="table-wrap"><table class="table table-compact">
                            <thead><tr>
                                <th scope="col">Staff</th>
                                <th scope="col" class="text-right">Gross</th>
                                <th scope="col" class="text-right">Allowances</th>
                                <th scope="col" class="text-right">Deductions</th>
                                <th scope="col" class="text-right">Net</th>
                                <th scope="col">Status</th>
                                <th scope="col"></th>
                            </tr></thead>
                            <tbody>
                                ${payroll.lines.map((line) => html`
                                    <tr>
                                        <th scope="row">${line.staffName}</th>
                                        <td class="text-right">${formatMoney(line.gross)}</td>
                                        <td class="text-right">${formatMoney(line.allowances || 0)}</td>
                                        <td class="text-right">${formatMoney(line.deductions || 0)}</td>
                                        <td class="text-right type-strong">${formatMoney(line.net)}</td>
                                        <td><span class="badge ${line.status === 'paid' ? 'badge-success' : 'badge-warning'}">
                                            ${line.status}</span></td>
                                        <td class="text-right">
                                            ${line.status === 'pending' && session.can('finance.edit') ? html`
                                                <button class="btn btn-sm btn-ghost" data-adjust="${line.id}">Adjust</button>
                                            ` : ''}
                                        </td>
                                    </tr>
                                `)}
                            </tbody>
                        </table></div>
                    ` : html`
                        <div class="empty empty-compact">
                            <p class="empty-text">No staff have a monthly salary set for this period.</p>
                            <a class="btn btn-sm btn-secondary" href="#/staff">Open staff</a>
                        </div>
                    `}
                </div>
            </div>
            ${this.wirePayroll(payroll, pending)}
        `;
    }

    wirePayroll(payroll, pending) {
        queueMicrotask(() => {
            const panel = this.container?.querySelector('[data-role="panel"]');
            if (!panel) return;

            on(panel, 'change', '[data-role="period"]', (_e, target) => {
                this.period = target.value;
                this.paint();
            });

            on(panel, 'click', '[data-adjust]', async (_e, target) => {
                const line = payroll.lines.find((l) => l.id === target.dataset.adjust);
                await this.adjust(line);
            });

            on(panel, 'click', '[data-action="pay"]', async () => {
                const ok = await confirm({
                    title: `Pay ${pending.length} staff?`,
                    message: `${formatMoney(pending.reduce((s, l) => s + l.net, 0))} in total. `
                        + 'The salary records and their ledger entries are written together — all of it, or none.',
                    confirmLabel: 'Run payroll'
                });
                if (!ok) return;

                try {
                    const result = await paySalaries(pending.map((line) => line.id), { paidOn: localDate() });
                    toast.success(`Payroll run — ${formatMoney(result.total ?? 0)} paid.`);
                    await this.paint();
                } catch (err) {
                    toast.error(err.message);
                }
            });
        });
        return '';
    }

    async adjust(line) {
        if (!line) return;

        const done = await formOverlay({
            title: `Adjust ${line.staffName}`,
            variant: 'modal',
            size: 'sm',
            submitLabel: 'Save adjustment',
            fields: [
                { name: 'allowances', label: 'Allowances', type: 'money', value: line.allowances || 0, width: 'half' },
                { name: 'deductions', label: 'Deductions', type: 'money', value: line.deductions || 0, width: 'half' },
                { name: 'note', label: 'Reason', type: 'textarea', rows: 2, value: line.note }
            ],
            onSubmit: async (values) => adjustSalary(line.id, values)
        });

        if (done) {
            toast.success('Adjustment saved.');
            await this.paint();
        }
    }
}

