/**
 * DataTable.
 *
 * Every list in the ERP is this component with a different column definition.
 * In 1.0, each module hand-wrote its own <table> markup; that produced six
 * subtly different empty states, no sorting anywhere, and no pagination, so
 * the students page rendered all 80 rows and would have rendered all 8,000.
 *
 * Design decisions worth stating:
 *   - Rendering is a full innerHTML replacement of the <tbody> only. For page
 *     sizes of 25–100 rows this measures faster than diffing and is far less
 *     code to be wrong.
 *   - Row actions use a single delegated listener on the table, so re-rendering
 *     does not churn listeners.
 *   - Sorting and filtering happen over the supplied row array. Where a store
 *     is large, the caller passes an already-paginated slice and sets
 *     `serverSide: true`.
 */

import { html, render, raw, escapeHtml, el, on, debounce, announce } from '../utils/dom.js';
import { icon } from './icons.js';

let instanceCount = 0;

export class DataTable {
    /**
     * @param {object} config
     * @param {Array}  config.columns  [{ key, label, align, sortable, width, render(row), exportValue(row) }]
     * @param {Array}  [config.rows]
     * @param {string} [config.rowId='id']
     * @param {string} [config.emptyTitle]
     * @param {string} [config.emptyMessage]
     * @param {object} [config.emptyAction]  { label, onClick }
     * @param {boolean}[config.selectable=false]
     * @param {boolean}[config.searchable=true]
     * @param {string} [config.searchPlaceholder]
     * @param {number} [config.pageSize=25]
     * @param {Function}[config.onRowClick]
     * @param {Array}  [config.bulkActions]  [{ label, variant, onClick(ids) }]
     * @param {Array}  [config.toolbar]      Raw html`` fragments placed in the toolbar.
     */
    constructor(config) {
        this.id = `dt-${++instanceCount}`;
        this.columns = config.columns;
        this.rows = config.rows || [];
        this.rowId = config.rowId || 'id';
        this.emptyTitle = config.emptyTitle || 'Nothing here yet';
        this.emptyMessage = config.emptyMessage || '';
        this.emptyAction = config.emptyAction || null;
        this.emptyIcon = config.emptyIcon || 'inbox';
        this.selectable = config.selectable || false;
        this.searchable = config.searchable !== false;
        this.searchPlaceholder = config.searchPlaceholder || 'Search…';
        this.pageSize = config.pageSize || 25;
        this.onRowClick = config.onRowClick || null;
        this.bulkActions = config.bulkActions || [];
        this.toolbar = config.toolbar || [];
        this.pinFirst = config.pinFirst !== false;
        this.caption = config.caption || null;

        this.state = {
            search: '',
            sortKey: config.defaultSort || null,
            sortDir: config.defaultSortDir || 'asc',
            page: 1,
            selected: new Set()
        };

        this.container = null;
        this.disposers = [];
    }

    /* ------------------------------------------------------------------ DATA */

    setRows(rows) {
        this.rows = rows;
        this.state.page = 1;
        // Drop selections for rows that no longer exist.
        this.state.selected = new Set([...this.state.selected].filter((id) => rows.some((r) => r[this.rowId] === id)));
        this.refresh();
    }

    /**
     * Swap the column set. The reports module drives this: one table instance
     * renders thirteen different reports, so the columns are data too. Sort and
     * page state reset because a sort key from the previous report is
     * meaningless against the new one.
     */
    setColumns(columns) {
        this.columns = columns;
        this.state.sortKey = null;
        this.state.page = 1;
        this.state.selected = new Set();
        this.refresh();
    }

    /** Rows after search and sort, before pagination. */
    get processed() {
        let rows = this.rows;

        const term = this.state.search.trim().toLowerCase();
        if (term) {
            rows = rows.filter((row) => this.columns.some((col) => {
                const value = col.searchValue ? col.searchValue(row) : row[col.key];
                return String(value ?? '').toLowerCase().includes(term);
            }));
        }

        if (this.state.sortKey) {
            const column = this.columns.find((c) => c.key === this.state.sortKey);
            const direction = this.state.sortDir === 'asc' ? 1 : -1;
            const accessor = column?.sortValue || ((row) => row[this.state.sortKey]);

            rows = [...rows].sort((a, b) => {
                const av = accessor(a);
                const bv = accessor(b);
                if (av === bv) return 0;
                if (av === null || av === undefined) return 1;   // blanks always last,
                if (bv === null || bv === undefined) return -1;  // in both directions
                if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * direction;
                return String(av).localeCompare(String(bv), 'en-IN', { numeric: true, sensitivity: 'base' }) * direction;
            });
        }

        return rows;
    }

    get pageRows() {
        const rows = this.processed;
        const start = (this.state.page - 1) * this.pageSize;
        return rows.slice(start, start + this.pageSize);
    }

    get pageCount() {
        return Math.max(1, Math.ceil(this.processed.length / this.pageSize));
    }

    /* ---------------------------------------------------------------- RENDER */

    mount(container) {
        this.container = container;
        render(container, this.markup());
        this.bind();
        return this;
    }

    /** Re-renders body, toolbar counts and pagination without rebuilding the head. */
    refresh() {
        if (!this.container) return;
        // Clamp the page after a filter shrinks the result set.
        if (this.state.page > this.pageCount) this.state.page = this.pageCount;

        const body = this.container.querySelector('tbody');
        if (body) body.innerHTML = String(this.bodyMarkup());

        const pagination = this.container.querySelector('[data-dt-pagination]');
        if (pagination) pagination.outerHTML = String(this.paginationMarkup());

        const selectionBar = this.container.querySelector('[data-dt-selection]');
        if (selectionBar) selectionBar.outerHTML = String(this.selectionMarkup());

        this.syncSortIndicators();
        this.syncSelectAll();
    }

    markup() {
        return html`
            <div class="card" data-dt="${this.id}">
                ${(this.searchable || this.toolbar.length) && html`
                    <div class="table-toolbar">
                        ${this.searchable && html`
                            <div class="search-wrap">
                                ${raw(icon('search', { size: 15, className: 'icon icon-search' }))}
                                <input type="search" class="input input-search" data-dt-search
                                       placeholder="${this.searchPlaceholder}"
                                       aria-label="${this.searchPlaceholder}"
                                       aria-controls="${this.id}-body">
                            </div>`}
                        ${this.toolbar}
                    </div>`}

                ${this.selectionMarkup()}

                <div class="table-wrap">
                    <table class="table ${this.pinFirst ? 'table-pin-first' : ''} ${this.onRowClick ? 'table-clickable' : ''}"
                           id="${this.id}">
                        ${this.caption && html`<caption class="sr-only">${this.caption}</caption>`}
                        <thead>${this.headMarkup()}</thead>
                        <tbody id="${this.id}-body">${this.bodyMarkup()}</tbody>
                    </table>
                </div>

                ${this.paginationMarkup()}
            </div>
        `;
    }

    headMarkup() {
        return html`<tr>
            ${this.selectable && html`
                <th class="col-check" scope="col">
                    <label class="check">
                        <input type="checkbox" data-dt-select-all aria-label="Select all rows on this page">
                        <span class="check-box"></span>
                    </label>
                </th>`}
            ${this.columns.map((col) => html`
                <th scope="col"
                    class="${col.align === 'right' ? 'col-num' : ''} ${col.align === 'actions' ? 'col-actions' : ''} ${col.sortable ? 'th-sort' : ''}"
                    ${col.width ? raw(`style="width:${escapeHtml(col.width)}"`) : ''}
                    ${col.sortable ? raw(`data-dt-sort="${escapeHtml(col.key)}" aria-sort="none" tabindex="0" role="columnheader"`) : ''}>
                    <span class="th-sort-inner">
                        ${col.label}
                        ${col.sortable && raw(icon('arrow-up', { size: 12 }))}
                    </span>
                </th>`)}
        </tr>`;
    }

    bodyMarkup() {
        const rows = this.pageRows;
        const span = this.columns.length + (this.selectable ? 1 : 0);

        if (!rows.length) {
            const filtered = this.state.search.trim().length > 0;
            return html`<tr><td colspan="${span}" class="empty-cell">
                <div class="empty empty-compact">
                    <div class="empty-glyph">${raw(icon(filtered ? 'search' : this.emptyIcon, { size: 22 }))}</div>
                    <p class="empty-title">${filtered ? `Nothing matches “${this.state.search}”` : this.emptyTitle}</p>
                    <p class="empty-text">${filtered ? 'Try a shorter search, or clear it to see everything.' : this.emptyMessage}</p>
                    ${filtered
                        ? html`<div class="empty-actions"><button type="button" class="btn btn-sm btn-secondary" data-dt-clear-search>Clear search</button></div>`
                        : this.emptyAction && html`<div class="empty-actions"><button type="button" class="btn btn-sm btn-primary" data-dt-empty-action>${this.emptyAction.label}</button></div>`}
                </div>
            </td></tr>`;
        }

        return rows.map((row) => {
            const id = row[this.rowId];
            const selected = this.state.selected.has(id);
            return html`<tr data-dt-row="${id}" ${selected ? raw('aria-selected="true"') : ''}
                            ${this.onRowClick ? raw('tabindex="0"') : ''}>
                ${this.selectable && html`
                    <td class="col-check">
                        <label class="check">
                            <input type="checkbox" data-dt-select="${id}" ${selected ? raw('checked') : ''}
                                   aria-label="Select this row">
                            <span class="check-box"></span>
                        </label>
                    </td>`}
                ${this.columns.map((col) => html`
                    <td class="${col.align === 'right' ? 'col-num' : ''} ${col.align === 'actions' ? 'col-actions' : ''}">
                        ${col.render ? col.render(row) : row[col.key] ?? html`<span class="text-subtle">—</span>`}
                    </td>`)}
            </tr>`;
        });
    }

    selectionMarkup() {
        const count = this.state.selected.size;
        if (!this.selectable || !count) return html`<div data-dt-selection hidden></div>`;

        return html`<div class="table-selection-bar" data-dt-selection>
            <span>${count} selected</span>
            <button type="button" class="btn btn-sm btn-ghost" data-dt-clear-selection>Clear</button>
            <div class="push-right row row-2">
                ${this.bulkActions.map((action, index) => html`
                    <button type="button" class="btn btn-sm btn-${action.variant || 'secondary'}" data-dt-bulk="${index}">
                        ${action.label}
                    </button>`)}
            </div>
        </div>`;
    }

    paginationMarkup() {
        const total = this.processed.length;
        const pageCount = this.pageCount;

        if (total <= this.pageSize) {
            return html`<div class="pagination" data-dt-pagination>
                <span>${total} ${total === 1 ? 'record' : 'records'}</span>
            </div>`;
        }

        const from = (this.state.page - 1) * this.pageSize + 1;
        const to = Math.min(this.state.page * this.pageSize, total);

        return html`<div class="pagination" data-dt-pagination>
            <span>Showing ${from}–${to} of ${total}</span>
            <div class="pagination-pages" role="navigation" aria-label="Pagination">
                <button type="button" class="page-btn" data-dt-page="prev"
                        ${this.state.page === 1 ? raw('disabled') : ''} aria-label="Previous page">
                    ${raw(icon('chevron-left', { size: 14 }))}
                </button>
                ${pageNumbers(this.state.page, pageCount).map((entry) => entry === '…'
                    ? html`<span class="page-ellipsis">…</span>`
                    : html`<button type="button" class="page-btn" data-dt-page="${entry}"
                                   ${entry === this.state.page ? raw('aria-current="page"') : ''}
                                   aria-label="Page ${entry}">${entry}</button>`)}
                <button type="button" class="page-btn" data-dt-page="next"
                        ${this.state.page === pageCount ? raw('disabled') : ''} aria-label="Next page">
                    ${raw(icon('chevron-right', { size: 14 }))}
                </button>
            </div>
        </div>`;
    }

    /* ---------------------------------------------------------------- EVENTS */

    bind() {
        const root = this.container;

        const search = root.querySelector('[data-dt-search]');
        if (search) {
            const run = debounce((value) => {
                this.state.search = value;
                this.state.page = 1;
                this.refresh();
                announce(`${this.processed.length} results`);
            }, 200);
            search.addEventListener('input', (event) => run(event.target.value));
            this.disposers.push(() => run.cancel());
        }

        this.disposers.push(
            on(root, 'click', '[data-dt-sort]', (_e, target) => this.sortBy(target.dataset.dtSort)),
            on(root, 'keydown', '[data-dt-sort]', (event, target) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    this.sortBy(target.dataset.dtSort);
                }
            }),
            on(root, 'click', '[data-dt-page]', (_e, target) => {
                const value = target.dataset.dtPage;
                if (value === 'prev') this.state.page = Math.max(1, this.state.page - 1);
                else if (value === 'next') this.state.page = Math.min(this.pageCount, this.state.page + 1);
                else this.state.page = Number(value);
                this.refresh();
                // `?.scrollTo?.()` rather than `?.scrollTo()`: Element.scrollTo is absent
                // in older Safari, and paging a table should not throw there.
                root.querySelector('.table-wrap')?.scrollTo?.({ top: 0 });
            }),
            on(root, 'change', '[data-dt-select]', (_e, target) => {
                const id = target.dataset.dtSelect;
                if (target.checked) this.state.selected.add(id);
                else this.state.selected.delete(id);
                target.closest('tr')?.setAttribute('aria-selected', String(target.checked));
                this.refreshSelectionBar();
            }),
            on(root, 'change', '[data-dt-select-all]', (_e, target) => {
                for (const row of this.pageRows) {
                    if (target.checked) this.state.selected.add(row[this.rowId]);
                    else this.state.selected.delete(row[this.rowId]);
                }
                this.refresh();
            }),
            on(root, 'click', '[data-dt-clear-selection]', () => {
                this.state.selected.clear();
                this.refresh();
            }),
            on(root, 'click', '[data-dt-bulk]', async (_e, target) => {
                const action = this.bulkActions[Number(target.dataset.dtBulk)];
                if (!action) return;
                target.dataset.loading = 'true';
                try {
                    await action.onClick([...this.state.selected]);
                } finally {
                    delete target.dataset.loading;
                }
            }),
            on(root, 'click', '[data-dt-clear-search]', () => {
                this.state.search = '';
                const input = root.querySelector('[data-dt-search]');
                if (input) input.value = '';
                this.refresh();
            }),
            on(root, 'click', '[data-dt-empty-action]', () => this.emptyAction?.onClick())
        );

        if (this.onRowClick) {
            this.disposers.push(
                on(root, 'click', '[data-dt-row]', (event, target) => {
                    // A click on a control inside the row belongs to that
                    // control, not to the row.
                    if (event.target.closest('button, a, input, label, select')) return;
                    const row = this.rows.find((r) => String(r[this.rowId]) === target.dataset.dtRow);
                    if (row) this.onRowClick(row, event);
                }),
                on(root, 'keydown', '[data-dt-row]', (event, target) => {
                    if (event.key !== 'Enter') return;
                    const row = this.rows.find((r) => String(r[this.rowId]) === target.dataset.dtRow);
                    if (row) this.onRowClick(row, event);
                })
            );
        }
    }

    refreshSelectionBar() {
        const existing = this.container.querySelector('[data-dt-selection]');
        if (existing) existing.outerHTML = String(this.selectionMarkup());
    }

    sortBy(key) {
        if (this.state.sortKey === key) {
            this.state.sortDir = this.state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            this.state.sortKey = key;
            this.state.sortDir = 'asc';
        }
        this.state.page = 1;
        this.refresh();

        const column = this.columns.find((c) => c.key === key);
        announce(`Sorted by ${column?.label || key}, ${this.state.sortDir === 'asc' ? 'ascending' : 'descending'}`);
    }

    syncSortIndicators() {
        for (const th of this.container.querySelectorAll('[data-dt-sort]')) {
            const active = th.dataset.dtSort === this.state.sortKey;
            th.setAttribute('aria-sort', active ? (this.state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
        }
    }

    syncSelectAll() {
        const box = this.container.querySelector('[data-dt-select-all]');
        if (!box) return;
        const ids = this.pageRows.map((r) => r[this.rowId]);
        const chosen = ids.filter((id) => this.state.selected.has(id)).length;
        box.checked = chosen > 0 && chosen === ids.length;
        box.indeterminate = chosen > 0 && chosen < ids.length;
    }

    /* ---------------------------------------------------------------- EXPORT */

    /** Rows currently visible after search and sort — what the user sees. */
    toCSV() {
        const header = this.columns
            .filter((c) => c.align !== 'actions')
            .map((c) => csvCell(c.label));

        const lines = this.processed.map((row) => this.columns
            .filter((c) => c.align !== 'actions')
            .map((c) => csvCell(c.exportValue ? c.exportValue(row) : row[c.key]))
            .join(','));

        return [header.join(','), ...lines].join('\r\n');
    }

    destroy() {
        this.disposers.forEach((d) => d());
        this.disposers = [];
        this.container = null;
    }
}

/** Excel interprets a leading =, +, - or @ as a formula. Prefix breaks that. */
function csvCell(value) {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

/** 1 … 4 5 [6] 7 8 … 20 */
function pageNumbers(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

    const pages = new Set([1, total, current, current - 1, current + 1]);
    if (current <= 3) [2, 3, 4].forEach((p) => pages.add(p));
    if (current >= total - 2) [total - 1, total - 2, total - 3].forEach((p) => pages.add(p));

    const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);

    const out = [];
    let previous = 0;
    for (const page of sorted) {
        if (page - previous > 1) out.push('…');
        out.push(page);
        previous = page;
    }
    return out;
}
