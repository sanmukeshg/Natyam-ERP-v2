/* ============================================================================
   NATYAM ERP 2.0 — COMPONENT LIBRARY
   Every visual pattern in the product lives here exactly once.
   Rules: no raw hex, no raw px spacing, no !important outside utilities.
   ============================================================================ */

/* ==========================================================================
   BUTTON
   ========================================================================== */

.btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    height: var(--control-height);
    padding: 0 var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    line-height: 1;
    white-space: nowrap;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    cursor: pointer;
    user-select: none;
    transition: background-color var(--duration-fast) var(--ease-standard),
                border-color var(--duration-fast) var(--ease-standard),
                color var(--duration-fast) var(--ease-standard),
                box-shadow var(--duration-fast) var(--ease-standard),
                transform var(--duration-instant) var(--ease-standard);
}

.btn:active:not(:disabled) { transform: translateY(0.5px); }

.btn:disabled,
.btn[aria-disabled="true"] {
    opacity: 0.5;
    pointer-events: none;
}

.btn:focus-visible { outline: none; box-shadow: var(--shadow-focus); }

/* Primary — the one committing action on a screen. Never two at once. */
.btn-primary {
    background: var(--accent);
    color: var(--neutral-0);
    box-shadow: var(--shadow-xs);
}
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
.btn-primary:active:not(:disabled) { background: var(--accent-active); }

/* Secondary — the default for everything else. */
.btn-secondary {
    background: var(--surface-raised);
    color: var(--text-primary);
    border-color: var(--border-default);
    box-shadow: var(--shadow-xs);
}
.btn-secondary:hover:not(:disabled) { background: var(--surface-hover); border-color: var(--border-strong); }
.btn-secondary:active:not(:disabled) { background: var(--surface-active); }

/* Ghost — toolbars and table row actions, where borders would create noise. */
.btn-ghost { background: transparent; color: var(--text-secondary); }
.btn-ghost:hover:not(:disabled) { background: var(--surface-hover); color: var(--text-primary); }
.btn-ghost:active:not(:disabled) { background: var(--surface-active); }

/* Danger — destructive, and only after a confirmation step. */
.btn-danger {
    background: var(--danger-500);
    color: var(--neutral-0);
    box-shadow: var(--shadow-xs);
}
.btn-danger:hover:not(:disabled) { background: var(--danger-600); }
.btn-danger:focus-visible { box-shadow: var(--shadow-focus-danger); }

.btn-danger-quiet {
    background: transparent;
    color: var(--danger-500);
    border-color: transparent;
}
.btn-danger-quiet:hover:not(:disabled) { background: var(--danger-50); }

.btn-link {
    height: auto;
    padding: 0;
    background: none;
    color: var(--text-link);
    font-weight: var(--weight-medium);
}
.btn-link:hover:not(:disabled) { text-decoration: underline; }

/* Sizes */
.btn-sm { height: calc(var(--control-height) - 6px); padding: 0 var(--space-3); font-size: var(--text-xs); }
.btn-lg { height: calc(var(--control-height) + 8px); padding: 0 var(--space-6); font-size: var(--text-base); }
.btn-block { width: 100%; }

/* Icon-only. Square, and always carries an aria-label. */
.btn-icon {
    width: var(--control-height);
    padding: 0;
    flex-shrink: 0;
}
.btn-icon.btn-sm { width: calc(var(--control-height) - 6px); }
.btn-icon.btn-lg { width: calc(var(--control-height) + 8px); }

.btn .icon { width: 16px; height: 16px; flex-shrink: 0; }
.btn-lg .icon { width: 18px; height: 18px; }

/* Loading state. Label stays in the DOM for screen readers but is hidden so
   the button does not change width mid-action. */
.btn[data-loading="true"] { position: relative; color: transparent; pointer-events: none; }
.btn[data-loading="true"] > * { visibility: hidden; }
.btn[data-loading="true"]::after {
    content: "";
    position: absolute;
    inset: 50% auto auto 50%;
    width: 14px; height: 14px;
    margin: -7px 0 0 -7px;
    border: 2px solid currentColor;
    border-top-color: transparent;
    border-radius: var(--radius-full);
    color: var(--neutral-0);
    visibility: visible;
    animation: spin var(--duration-slow) linear infinite;
}
.btn-secondary[data-loading="true"]::after,
.btn-ghost[data-loading="true"]::after { color: var(--text-secondary); }

@keyframes spin { to { transform: rotate(360deg); } }

/* Segmented control — mutually exclusive views (Day / Week / Month). */
.btn-group {
    display: inline-flex;
    padding: 2px;
    background: var(--surface-sunken);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
}
.btn-group > .btn {
    height: calc(var(--control-height) - 6px);
    border: none;
    background: transparent;
    box-shadow: none;
    color: var(--text-secondary);
    border-radius: var(--radius-sm);
}
.btn-group > .btn:hover { background: var(--surface-hover); color: var(--text-primary); }
.btn-group > .btn[aria-pressed="true"] {
    background: var(--surface-raised);
    color: var(--text-primary);
    font-weight: var(--weight-semibold);
    box-shadow: var(--shadow-xs);
}

/* ==========================================================================
   CARD / PANEL
   ========================================================================== */

.card {
    display: flex;
    flex-direction: column;
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-xs);
    overflow: hidden;
}

.card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
    min-height: 52px;
}

.card-header-text { min-width: 0; }
.card-title { font-size: var(--text-md); font-weight: var(--weight-semibold); letter-spacing: var(--tracking-tight); }
.card-subtitle { font-size: var(--text-xs); color: var(--text-secondary); margin-top: 2px; }
.card-actions { display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0; }

.card-body { padding: var(--space-5); flex: 1; min-width: 0; }
.card-body-flush { padding: 0; }
.card-body-tight { padding: var(--space-3); }

.card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-5);
    background: var(--surface-sunken);
    border-top: 1px solid var(--border-subtle);
    font-size: var(--text-xs);
    color: var(--text-secondary);
}

.card-interactive { cursor: pointer; transition: box-shadow var(--duration-fast) var(--ease-standard),
                                                 border-color var(--duration-fast) var(--ease-standard),
                                                 transform var(--duration-fast) var(--ease-standard); }
.card-interactive:hover { box-shadow: var(--shadow-md); border-color: var(--border-default); transform: translateY(-1px); }
.card-interactive:focus-visible { box-shadow: var(--shadow-focus); }

/* ==========================================================================
   KPI CARD
   The figure is the content. Everything else is scaffolding around it, so
   nothing else in the card competes at that weight.
   ========================================================================== */

.kpi {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-5);
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-xs);
    overflow: hidden;
}

/* The signature: a 3px thread on the leading edge, echoing the gold border of
   a Kuchipudi costume. It is the only decorative element in the system, and it
   carries meaning — its colour is the metric's health. */
.kpi::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    background: var(--brand-gold-500);
}
.kpi[data-tone="positive"]::before { background: var(--success-500); }
.kpi[data-tone="negative"]::before { background: var(--danger-500); }
.kpi[data-tone="caution"]::before  { background: var(--warning-500); }
.kpi[data-tone="neutral"]::before  { background: var(--border-default); }

.kpi-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); }
.kpi-label { font-size: var(--text-2xs); font-weight: var(--weight-semibold); letter-spacing: var(--tracking-caps); text-transform: uppercase; color: var(--text-tertiary); }

.kpi-icon {
    display: grid;
    place-items: center;
    width: 30px; height: 30px;
    border-radius: var(--radius-md);
    background: var(--surface-sunken);
    color: var(--text-secondary);
    flex-shrink: 0;
}
.kpi-icon .icon { width: 16px; height: 16px; }

.kpi-value {
    font-size: var(--text-2xl);
    font-weight: var(--weight-semibold);
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-tight);
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
}
.kpi-unit { font-size: var(--text-md); font-weight: var(--weight-medium); color: var(--text-secondary); margin-left: 2px; }

.kpi-foot { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-xs); color: var(--text-secondary); flex-wrap: wrap; }

.kpi-delta { display: inline-flex; align-items: center; gap: 3px; font-weight: var(--weight-semibold); font-variant-numeric: tabular-nums; }
.kpi-delta[data-dir="up"]   { color: var(--success-500); }
.kpi-delta[data-dir="down"] { color: var(--danger-500); }
.kpi-delta[data-dir="flat"] { color: var(--text-tertiary); }
.kpi-delta .icon { width: 12px; height: 12px; }

.kpi-spark { margin-top: var(--space-1); height: 34px; }

/* ==========================================================================
   FORM CONTROLS
   ========================================================================== */

.field { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }

.field-label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    color: var(--text-secondary);
}
.field-required { color: var(--danger-500); font-weight: var(--weight-bold); }

/* Optional is marked, not required — most fields in an ERP form are mandatory,
   so marking the exception is less visual noise than marking the rule. */
.field-optional { font-weight: var(--weight-regular); color: var(--text-tertiary); }

.input,
.select,
.textarea {
    width: 100%;
    min-height: var(--control-height);
    padding: 0 var(--space-3);
    font-size: var(--text-sm);
    color: var(--text-primary);
    background: var(--surface-raised);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    transition: border-color var(--duration-fast) var(--ease-standard),
                box-shadow var(--duration-fast) var(--ease-standard),
                background-color var(--duration-fast) var(--ease-standard);
}

.textarea { padding: var(--space-2) var(--space-3); min-height: 84px; resize: vertical; line-height: var(--leading-normal); }

.input::placeholder, .textarea::placeholder { color: var(--text-disabled); }

.input:hover:not(:disabled), .select:hover:not(:disabled), .textarea:hover:not(:disabled) { border-color: var(--border-strong); }

.input:focus, .select:focus, .textarea:focus {
    outline: none;
    border-color: var(--focus-ring);
    box-shadow: var(--shadow-focus);
}

.input:disabled, .select:disabled, .textarea:disabled {
    background: var(--surface-sunken);
    color: var(--text-disabled);
    cursor: not-allowed;
}

.input[readonly] { background: var(--surface-sunken); }

.input[aria-invalid="true"], .select[aria-invalid="true"], .textarea[aria-invalid="true"] {
    border-color: var(--danger-500);
}
.input[aria-invalid="true"]:focus { box-shadow: var(--shadow-focus-danger); }

/* Native select needs its own chevron; the OS one is inconsistent across
   platforms and ignores the token palette. */
.select {
    appearance: none;
    padding-right: var(--space-8);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%236F7C8E' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right var(--space-3) center;
    background-size: 16px;
    cursor: pointer;
}
[data-theme="dark"] .select {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23A3AEBE' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E");
}

/* Currency, dates and quantities read as data, not prose. */
.input-numeric { font-family: var(--font-mono); font-variant-numeric: tabular-nums; text-align: right; }

.input-group { display: flex; align-items: stretch; }
.input-group .input { border-radius: 0; }
.input-group > :first-child { border-top-left-radius: var(--radius-md); border-bottom-left-radius: var(--radius-md); }
.input-group > :last-child { border-top-right-radius: var(--radius-md); border-bottom-right-radius: var(--radius-md); }
.input-group > * + * { margin-left: -1px; }
.input-group .input:focus { z-index: 1; }

.input-affix {
    display: grid;
    place-items: center;
    min-width: var(--control-height);
    padding: 0 var(--space-3);
    font-size: var(--text-sm);
    color: var(--text-secondary);
    background: var(--surface-sunken);
    border: 1px solid var(--border-default);
}

/* Search input with a leading glyph. */
.input-search { padding-left: var(--space-8); }
.search-wrap { position: relative; display: flex; align-items: center; }
.search-wrap .icon-search {
    position: absolute;
    left: var(--space-3);
    width: 15px; height: 15px;
    color: var(--text-tertiary);
    pointer-events: none;
}
.search-wrap .btn-clear { position: absolute; right: var(--space-1); }

.field-hint { font-size: var(--text-xs); color: var(--text-tertiary); line-height: var(--leading-snug); }

.field-error {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--danger-500);
    line-height: var(--leading-snug);
}
.field-error .icon { width: 13px; height: 13px; flex-shrink: 0; margin-top: 1px; }

/* Checkbox and radio. Custom-drawn so the tick uses the accent token and the
   hit area meets the 44px touch minimum on coarse pointers. */
.check {
    position: relative;
    display: inline-flex;
    align-items: flex-start;
    gap: var(--space-3);
    cursor: pointer;
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
    min-height: 22px;
}
.check input { position: absolute; opacity: 0; width: 0; height: 0; }

.check-box {
    display: grid;
    place-items: center;
    width: 18px; height: 18px;
    flex-shrink: 0;
    margin-top: 1px;
    background: var(--surface-raised);
    border: 1.5px solid var(--border-strong);
    border-radius: var(--radius-xs);
    transition: background-color var(--duration-fast) var(--ease-standard),
                border-color var(--duration-fast) var(--ease-standard);
}
.check-radio { border-radius: var(--radius-full); }

.check-box::after {
    content: "";
    width: 10px; height: 10px;
    transform: scale(0);
    transition: transform var(--duration-fast) var(--ease-spring);
    background: var(--neutral-0);
    clip-path: polygon(14% 47%, 0 61%, 39% 100%, 100% 22%, 85% 8%, 38% 71%);
}
.check-radio::after { clip-path: none; border-radius: var(--radius-full); width: 7px; height: 7px; }

.check input:checked + .check-box { background: var(--accent); border-color: var(--accent); }
.check input:checked + .check-box::after { transform: scale(1); }
.check input:indeterminate + .check-box { background: var(--accent); border-color: var(--accent); }
.check input:indeterminate + .check-box::after { transform: scale(1); clip-path: polygon(10% 42%, 10% 58%, 90% 58%, 90% 42%); }
.check input:focus-visible + .check-box { box-shadow: var(--shadow-focus); }
.check input:disabled + .check-box { background: var(--surface-sunken); border-color: var(--border-default); }
.check:hover input:not(:disabled) + .check-box { border-color: var(--accent); }

/* Switch — for settings that take effect immediately, not for form fields. */
.switch { position: relative; display: inline-flex; align-items: center; gap: var(--space-3); cursor: pointer; }
.switch input { position: absolute; opacity: 0; width: 0; height: 0; }
.switch-track {
    position: relative;
    width: 38px; height: 22px;
    flex-shrink: 0;
    background: var(--border-strong);
    border-radius: var(--radius-full);
    transition: background-color var(--duration-normal) var(--ease-standard);
}
.switch-track::after {
    content: "";
    position: absolute;
    top: 3px; left: 3px;
    width: 16px; height: 16px;
    background: var(--neutral-0);
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-sm);
    transition: transform var(--duration-normal) var(--ease-spring);
}
.switch input:checked + .switch-track { background: var(--success-500); }
.switch input:checked + .switch-track::after { transform: translateX(16px); }
.switch input:focus-visible + .switch-track { box-shadow: var(--shadow-focus); }

/* Form layout */
.form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--space-4) var(--space-5); }
.form-grid .field-full { grid-column: 1 / -1; }

.fieldset { display: flex; flex-direction: column; gap: var(--space-4); }
.fieldset-legend {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-tertiary);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--border-subtle);
}

/* ==========================================================================
   BADGE
   ========================================================================== */

.badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 2px var(--space-2);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-wide);
    line-height: 1.6;
    white-space: nowrap;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
}

.badge-neutral { background: var(--surface-sunken); color: var(--text-secondary); border-color: var(--border-subtle); }
.badge-success { background: var(--success-50); color: var(--success-600); border-color: var(--success-100); }
.badge-warning { background: var(--warning-50); color: var(--warning-600); border-color: var(--warning-100); }
.badge-danger  { background: var(--danger-50);  color: var(--danger-600);  border-color: var(--danger-100); }
.badge-info    { background: var(--info-50);    color: var(--info-600);    border-color: var(--info-100); }
.badge-accent  { background: var(--accent-subtle); color: var(--accent-text); border-color: var(--accent-border); }

/* A dot carries status faster than a word at table density. */
.badge-dot::before {
    content: "";
    width: 6px; height: 6px;
    border-radius: var(--radius-full);
    background: currentColor;
    flex-shrink: 0;
}

.badge-count {
    display: inline-grid;
    place-items: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    font-size: var(--text-2xs);
    font-weight: var(--weight-bold);
    font-variant-numeric: tabular-nums;
    color: var(--neutral-0);
    background: var(--danger-500);
    border-radius: var(--radius-full);
}

/* ==========================================================================
   TABLE
   ========================================================================== */

.table-wrap {
    width: 100%;
    overflow: auto;
    border-radius: var(--radius-lg);
    -webkit-overflow-scrolling: touch;
}

.table { width: 100%; font-size: var(--text-sm); }

.table thead th {
    position: sticky;
    top: 0;
    z-index: 2;
    padding: var(--space-3) var(--cell-pad-x);
    text-align: left;
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-tertiary);
    background: var(--surface-sunken);
    border-bottom: 1px solid var(--border-default);
    white-space: nowrap;
}

.table tbody td {
    height: var(--row-height);
    padding: var(--cell-pad-y) var(--cell-pad-x);
    border-bottom: 1px solid var(--border-subtle);
    color: var(--text-primary);
    vertical-align: middle;
}

.table tbody tr { transition: background-color var(--duration-instant) var(--ease-standard); }
.table tbody tr:hover { background: var(--surface-hover); }
.table tbody tr[aria-selected="true"] { background: var(--surface-selected); }
.table tbody tr:last-child td { border-bottom: none; }

.table-clickable tbody tr { cursor: pointer; }
.table-clickable tbody tr:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }

/* Numeric columns right-align so magnitudes compare down the column. */
.table .col-num { text-align: right; font-variant-numeric: tabular-nums; font-family: var(--font-mono); font-size: var(--text-xs); }
.table .col-actions { text-align: right; width: 1%; white-space: nowrap; }
.table .col-check { width: 1%; padding-right: 0; }

/* Row actions stay hidden until the row is engaged — 80 rows × 3 buttons is
   240 competing affordances otherwise. */
.row-actions { display: flex; gap: var(--space-1); justify-content: flex-end; opacity: 0; transition: opacity var(--duration-fast) var(--ease-standard); }
tr:hover .row-actions,
tr:focus-within .row-actions { opacity: 1; }
@media (pointer: coarse) { .row-actions { opacity: 1; } }

/* Sortable headers */
.th-sort { cursor: pointer; user-select: none; }
.th-sort:hover { color: var(--text-secondary); background: var(--surface-active); }
.th-sort-inner { display: inline-flex; align-items: center; gap: var(--space-1); }
.th-sort .icon { width: 12px; height: 12px; opacity: 0; transition: opacity var(--duration-fast) var(--ease-standard); }
.th-sort:hover .icon { opacity: 0.4; }
.th-sort[aria-sort="ascending"] .icon,
.th-sort[aria-sort="descending"] .icon { opacity: 1; color: var(--accent); }
.th-sort[aria-sort="descending"] .icon { transform: rotate(180deg); }

/* First column pins on horizontal scroll so the row stays identifiable. */
.table-pin-first thead th:first-child,
.table-pin-first tbody td:first-child {
    position: sticky;
    left: 0;
    z-index: 1;
    background: var(--surface-raised);
}
.table-pin-first thead th:first-child { z-index: 3; background: var(--surface-sunken); }
.table-pin-first tbody tr:hover td:first-child { background: var(--surface-hover); }

.table-toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
    flex-wrap: wrap;
}
.table-toolbar .search-wrap { flex: 1 1 220px; max-width: 340px; }

/* Bulk-action bar replaces the toolbar when rows are selected. */
.table-selection-bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-selected);
    border-bottom: 1px solid var(--border-default);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
}

/* ==========================================================================
   PAGINATION
   ========================================================================== */

.pagination {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--border-subtle);
    font-size: var(--text-xs);
    color: var(--text-secondary);
    flex-wrap: wrap;
}
.pagination-pages { display: flex; align-items: center; gap: var(--space-1); }
.page-btn {
    min-width: 28px; height: 28px;
    padding: 0 var(--space-2);
    display: grid; place-items: center;
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    font-variant-numeric: tabular-nums;
    color: var(--text-secondary);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
}
.page-btn:hover:not(:disabled) { background: var(--surface-hover); color: var(--text-primary); }
.page-btn[aria-current="page"] { background: var(--surface-raised); border-color: var(--border-default); color: var(--text-primary); font-weight: var(--weight-semibold); box-shadow: var(--shadow-xs); }
.page-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.page-ellipsis { padding: 0 var(--space-1); color: var(--text-disabled); }

/* ==========================================================================
   TABS
   ========================================================================== */

.tabs { display: flex; gap: var(--space-1); border-bottom: 1px solid var(--border-subtle); overflow-x: auto; scrollbar-width: none; }
.tabs::-webkit-scrollbar { display: none; }

.tab {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--text-secondary);
    white-space: nowrap;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    transition: color var(--duration-fast) var(--ease-standard),
                border-color var(--duration-fast) var(--ease-standard);
}
.tab:hover { color: var(--text-primary); }
.tab[aria-selected="true"] { color: var(--accent-text); border-bottom-color: var(--accent); font-weight: var(--weight-semibold); }
.tab .badge { margin-left: var(--space-1); }
.tab .icon { width: 15px; height: 15px; }

.tab-panel { padding-top: var(--space-5); }
.tab-panel[hidden] { display: none; }

/* ==========================================================================
   MODAL
   ========================================================================== */

.modal-region {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: grid;
    place-items: center;
    padding: var(--space-4);
    background: var(--surface-scrim);
    backdrop-filter: blur(2px);
    animation: fade-in var(--duration-fast) var(--ease-entrance);
}

.modal {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 520px;
    max-height: min(88vh, 780px);
    background: var(--surface-overlay);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-xl);
    animation: modal-in var(--duration-normal) var(--ease-entrance);
    overflow: hidden;
}

.modal-sm { max-width: 400px; }
.modal-lg { max-width: 760px; }
.modal-xl { max-width: 1040px; }

.modal-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-5) var(--space-5) var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
}
.modal-title { font-size: var(--text-md); font-weight: var(--weight-semibold); }
.modal-description { font-size: var(--text-xs); color: var(--text-secondary); margin-top: var(--space-1); line-height: var(--leading-normal); }

.modal-body { padding: var(--space-5); overflow-y: auto; flex: 1; }

.modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5);
    background: var(--surface-sunken);
    border-top: 1px solid var(--border-subtle);
    flex-shrink: 0;
}
.modal-footer-split { justify-content: space-between; }

@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes modal-in {
    from { opacity: 0; transform: translateY(12px) scale(0.985); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
}

@media (max-width: 640px) {
    /* On a phone a centred dialog wastes the safest area of the screen. Dock
       it to the bottom, where the thumb already is. */
    .modal-region { place-items: end center; padding: 0; }
    .modal {
        max-width: 100%;
        max-height: 92vh;
        border-radius: var(--radius-xl) var(--radius-xl) 0 0;
        animation: sheet-in var(--duration-normal) var(--ease-entrance);
    }
    .modal-footer { flex-direction: column-reverse; padding-bottom: max(var(--space-4), env(safe-area-inset-bottom)); }
    .modal-footer .btn { width: 100%; }
}
@keyframes sheet-in { from { transform: translateY(100%); } to { transform: translateY(0); } }

/* ==========================================================================
   DRAWER
   Detail views that must not lose the list behind them.
   ========================================================================== */

.drawer-region {
    position: fixed;
    inset: 0;
    z-index: var(--z-drawer);
    background: var(--surface-scrim);
    animation: fade-in var(--duration-fast) var(--ease-entrance);
}

.drawer {
    position: absolute;
    inset: 0 0 0 auto;
    display: flex;
    flex-direction: column;
    width: min(560px, 100%);
    background: var(--surface-overlay);
    border-left: 1px solid var(--border-subtle);
    box-shadow: var(--shadow-xl);
    animation: drawer-in var(--duration-normal) var(--ease-entrance);
}
.drawer-wide { width: min(880px, 100%); }

.drawer-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
}
.drawer-body { padding: var(--space-5); overflow-y: auto; flex: 1; }
.drawer-footer {
    display: flex; align-items: center; justify-content: flex-end; gap: var(--space-3);
    padding: var(--space-4) var(--space-5);
    background: var(--surface-sunken);
    border-top: 1px solid var(--border-subtle);
    flex-shrink: 0;
}

@keyframes drawer-in { from { transform: translateX(100%); } to { transform: translateX(0); } }

@media (max-width: 640px) {
    .drawer { inset: auto 0 0 0; width: 100%; height: 92vh; border-left: none; border-top: 1px solid var(--border-subtle); border-radius: var(--radius-xl) var(--radius-xl) 0 0; animation: sheet-in var(--duration-normal) var(--ease-entrance); }
}

/* ==========================================================================
   TOAST
   ========================================================================== */

.toast-region {
    position: fixed;
    bottom: var(--space-5);
    right: var(--space-5);
    z-index: var(--z-toast);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: min(380px, calc(100vw - var(--space-8)));
    pointer-events: none;
}

.toast {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-overlay);
    border: 1px solid var(--border-subtle);
    border-left: 3px solid var(--border-default);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    pointer-events: auto;
    animation: toast-in var(--duration-normal) var(--ease-entrance);
}
.toast[data-leaving="true"] { animation: toast-out var(--duration-fast) var(--ease-exit) forwards; }

.toast-success { border-left-color: var(--success-500); }
.toast-error   { border-left-color: var(--danger-500); }
.toast-warning { border-left-color: var(--warning-500); }
.toast-info    { border-left-color: var(--info-500); }

.toast-icon { width: 17px; height: 17px; flex-shrink: 0; margin-top: 1px; }
.toast-success .toast-icon { color: var(--success-500); }
.toast-error   .toast-icon { color: var(--danger-500); }
.toast-warning .toast-icon { color: var(--warning-500); }
.toast-info    .toast-icon { color: var(--info-500); }

.toast-content { flex: 1; min-width: 0; }
.toast-title { font-size: var(--text-sm); font-weight: var(--weight-semibold); }
.toast-message { font-size: var(--text-xs); color: var(--text-secondary); margin-top: 2px; line-height: var(--leading-snug); }
.toast-action { margin-top: var(--space-2); }

@keyframes toast-in  { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
@keyframes toast-out { to { opacity: 0; transform: translateX(20px); height: 0; margin: 0; padding-block: 0; } }

@media (max-width: 640px) {
    /* Full-width under the sticky header rather than over it: top-anchored at
       var(--space-3) sat on top of the 56px header and covered the search bar
       and menu button. Clearing the header height keeps toasts stacked below
       it, still full-width, still animating in from the top. */
    .toast-region {
        bottom: auto;
        top: calc(var(--header-height) + var(--space-3));
        left: var(--space-3);
        right: var(--space-3);
        width: auto;
        max-height: calc(100vh - var(--header-height) - var(--space-5));
        overflow: hidden;
    }
    @keyframes toast-in { from { opacity: 0; transform: translateY(-16px); } to { opacity: 1; transform: translateY(0); } }
}

/* ==========================================================================
   ALERT — inline, persistent, tied to a region of the page
   ========================================================================== */

.alert {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid;
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
}
.alert .icon { width: 17px; height: 17px; flex-shrink: 0; margin-top: 1px; }
.alert-title { font-weight: var(--weight-semibold); }
.alert-body { flex: 1; min-width: 0; }

.alert-info    { background: var(--info-50);    border-color: var(--info-100);    color: var(--info-700); }
.alert-success { background: var(--success-50); border-color: var(--success-100); color: var(--success-700); }
.alert-warning { background: var(--warning-50); border-color: var(--warning-100); color: var(--warning-700); }
.alert-danger  { background: var(--danger-50);  border-color: var(--danger-100);  color: var(--danger-700); }

/* ==========================================================================
   EMPTY & ERROR STATES
   An empty screen is an instruction, not an apology.
   ========================================================================== */

.empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--space-3);
    padding: var(--space-12) var(--space-6);
    max-width: 420px;
    margin: 0 auto;
}
.empty-compact { padding: var(--space-8) var(--space-4); }

.empty-glyph {
    display: grid;
    place-items: center;
    width: 44px; height: 44px;
    color: var(--text-tertiary);
    background: var(--surface-sunken);
    border-radius: var(--radius-lg);
    margin-bottom: var(--space-1);
}
.empty-glyph .icon { width: 22px; height: 22px; }

.empty-title { font-size: var(--text-md); font-weight: var(--weight-semibold); }
.empty-text { font-size: var(--text-sm); color: var(--text-secondary); line-height: var(--leading-normal); }
.empty-actions { display: flex; gap: var(--space-2); margin-top: var(--space-2); flex-wrap: wrap; justify-content: center; }

.empty-cell { text-align: center; color: var(--text-tertiary); padding: var(--space-8) var(--space-4) !important; font-size: var(--text-sm); }

/* ==========================================================================
   SKELETON — shows the shape of what is loading, not a spinner
   ========================================================================== */

.skeleton {
    background: linear-gradient(90deg,
        var(--surface-sunken) 25%,
        var(--surface-hover) 37%,
        var(--surface-sunken) 63%);
    background-size: 400% 100%;
    border-radius: var(--radius-sm);
    animation: shimmer 1.4s ease-in-out infinite;
}
@keyframes shimmer { from { background-position: 100% 50%; } to { background-position: 0 50%; } }

.skeleton-text  { height: 11px; margin: 5px 0; }
.skeleton-title { height: 17px; width: 45%; margin-bottom: var(--space-3); }
.skeleton-row   { height: var(--row-height); margin-bottom: 1px; border-radius: 0; }
.skeleton-kpi   { height: 118px; border-radius: var(--radius-lg); }
.skeleton-chart { height: 220px; border-radius: var(--radius-md); }
.skeleton-avatar { width: 36px; height: 36px; border-radius: var(--radius-full); flex-shrink: 0; }

@media (prefers-reduced-motion: reduce) {
    .skeleton { animation: none; background: var(--surface-sunken); }
}

/* ==========================================================================
   PROGRESS
   ========================================================================== */

.progress {
    width: 100%;
    height: 6px;
    background: var(--surface-sunken);
    border-radius: var(--radius-full);
    overflow: hidden;
}
.progress-bar {
    height: 100%;
    background: var(--accent);
    border-radius: var(--radius-full);
    transition: width var(--duration-slow) var(--ease-standard);
}
.progress-bar[data-tone="success"] { background: var(--success-500); }
.progress-bar[data-tone="warning"] { background: var(--warning-500); }
.progress-bar[data-tone="danger"]  { background: var(--danger-500); }

.progress-meta { display: flex; justify-content: space-between; font-size: var(--text-2xs); color: var(--text-secondary); margin-top: var(--space-1); font-variant-numeric: tabular-nums; }

/* Wizard step indicator */
.steps { display: flex; align-items: center; gap: var(--space-2); overflow-x: auto; padding-bottom: var(--space-1); scrollbar-width: none; }
.steps::-webkit-scrollbar { display: none; }

.step { display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0; }
.step-marker {
    display: grid; place-items: center;
    width: 24px; height: 24px;
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    font-variant-numeric: tabular-nums;
    color: var(--text-tertiary);
    background: var(--surface-sunken);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-full);
    transition: all var(--duration-fast) var(--ease-standard);
}
.step-label { font-size: var(--text-xs); font-weight: var(--weight-medium); color: var(--text-tertiary); white-space: nowrap; }
.step-line { width: 24px; height: 1px; background: var(--border-default); flex-shrink: 0; }

.step[data-state="current"] .step-marker { background: var(--accent); border-color: var(--accent); color: var(--neutral-0); }
.step[data-state="current"] .step-label { color: var(--text-primary); font-weight: var(--weight-semibold); }
.step[data-state="done"] .step-marker { background: var(--success-500); border-color: var(--success-500); color: var(--neutral-0); }
.step[data-state="done"] .step-label { color: var(--text-secondary); }

/* ==========================================================================
   DROPDOWN / MENU
   ========================================================================== */

.menu {
    position: absolute;
    z-index: var(--z-dropdown);
    min-width: 200px;
    max-height: 380px;
    overflow-y: auto;
    padding: var(--space-1);
    background: var(--surface-overlay);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    animation: menu-in var(--duration-fast) var(--ease-entrance);
}
@keyframes menu-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }

.menu-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    color: var(--text-primary);
    text-align: left;
    border-radius: var(--radius-sm);
    transition: background-color var(--duration-instant) var(--ease-standard);
}
.menu-item:hover:not(:disabled),
.menu-item[data-active="true"] { background: var(--surface-hover); text-decoration: none; }
.menu-item:disabled { color: var(--text-disabled); cursor: not-allowed; }
.menu-item .icon { width: 15px; height: 15px; flex-shrink: 0; color: var(--text-tertiary); }
.menu-item-danger { color: var(--danger-500); }
.menu-item-danger:hover:not(:disabled) { background: var(--danger-50); }
.menu-item-danger .icon { color: var(--danger-500); }
.menu-shortcut { margin-left: auto; font-size: var(--text-2xs); color: var(--text-tertiary); font-family: var(--font-mono); }

.menu-separator { height: 1px; background: var(--border-subtle); margin: var(--space-1) 0; }
.menu-label { padding: var(--space-2) var(--space-3) var(--space-1); font-size: var(--text-2xs); font-weight: var(--weight-semibold); letter-spacing: var(--tracking-caps); text-transform: uppercase; color: var(--text-tertiary); }

/* ==========================================================================
   AVATAR
   ========================================================================== */

.avatar {
    display: grid;
    place-items: center;
    width: 34px; height: 34px;
    flex-shrink: 0;
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-wide);
    color: var(--neutral-0);
    background: var(--brand-indigo-500);
    border-radius: var(--radius-full);
    overflow: hidden;
    text-transform: uppercase;
}
.avatar img { width: 100%; height: 100%; object-fit: cover; }
.avatar-sm { width: 26px; height: 26px; font-size: var(--text-2xs); }
.avatar-lg { width: 52px; height: 52px; font-size: var(--text-md); }
.avatar-xl { width: 76px; height: 76px; font-size: var(--text-lg); }

/* Deterministic tints so a given person is always the same colour. */
.avatar[data-tint="1"] { background: var(--brand-indigo-500); }
.avatar[data-tint="2"] { background: var(--brand-terracotta-500); }
.avatar[data-tint="3"] { background: var(--success-500); }
.avatar[data-tint="4"] { background: var(--warning-600); }
.avatar[data-tint="5"] { background: var(--info-500); }
.avatar[data-tint="6"] { background: var(--brand-gold-700); }

.avatar-stack { display: flex; }
.avatar-stack .avatar { margin-left: -8px; border: 2px solid var(--surface-raised); }
.avatar-stack .avatar:first-child { margin-left: 0; }

/* ==========================================================================
   TIMELINE
   ========================================================================== */

.timeline { display: flex; flex-direction: column; }

.timeline-item { position: relative; display: flex; gap: var(--space-4); padding-bottom: var(--space-5); }
.timeline-item:last-child { padding-bottom: 0; }

.timeline-rail { position: relative; display: flex; flex-direction: column; align-items: center; flex-shrink: 0; }
.timeline-dot {
    width: 9px; height: 9px;
    margin-top: 5px;
    background: var(--surface-raised);
    border: 2px solid var(--border-strong);
    border-radius: var(--radius-full);
    z-index: 1;
}
.timeline-dot[data-tone="success"] { border-color: var(--success-500); background: var(--success-500); }
.timeline-dot[data-tone="danger"]  { border-color: var(--danger-500);  background: var(--danger-500); }
.timeline-dot[data-tone="warning"] { border-color: var(--warning-500); background: var(--warning-500); }
.timeline-dot[data-tone="accent"]  { border-color: var(--accent);      background: var(--accent); }

.timeline-item:not(:last-child) .timeline-rail::after {
    content: "";
    position: absolute;
    top: 16px; bottom: -8px;
    width: 1px;
    background: var(--border-subtle);
}

.timeline-content { flex: 1; min-width: 0; padding-top: 1px; }
.timeline-title { font-size: var(--text-sm); font-weight: var(--weight-medium); }
.timeline-meta { font-size: var(--text-xs); color: var(--text-tertiary); margin-top: 2px; }

/* ==========================================================================
   DESCRIPTION LIST — the read view of any record
   ========================================================================== */

.dl { display: grid; grid-template-columns: minmax(120px, 34%) 1fr; gap: var(--space-3) var(--space-4); font-size: var(--text-sm); }
.dl dt { color: var(--text-tertiary); font-size: var(--text-xs); font-weight: var(--weight-medium); }
.dl dd { color: var(--text-primary); min-width: 0; word-break: break-word; }
.dl dd:empty::after { content: "Not recorded"; color: var(--text-disabled); font-style: italic; }

@media (max-width: 560px) {
    .dl { grid-template-columns: 1fr; gap: var(--space-1) 0; }
    .dl dd { margin-bottom: var(--space-3); }
}

/* ==========================================================================
   BREADCRUMB
   ========================================================================== */

.breadcrumb { display: flex; align-items: center; gap: var(--space-1); font-size: var(--text-xs); color: var(--text-tertiary); flex-wrap: wrap; }
.breadcrumb a { color: var(--text-tertiary); }
.breadcrumb a:hover { color: var(--text-primary); text-decoration: none; }
.breadcrumb-sep { color: var(--text-disabled); user-select: none; }
.breadcrumb [aria-current="page"] { color: var(--text-secondary); font-weight: var(--weight-medium); }

/* ==========================================================================
   TOOLTIP — CSS-only, so no JS positioning cost on hover-heavy tables
   ========================================================================== */

[data-tooltip] { position: relative; }
[data-tooltip]::after {
    content: attr(data-tooltip);
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%) translateY(3px);
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-2xs);
    font-weight: var(--weight-medium);
    white-space: nowrap;
    color: var(--text-inverse);
    background: var(--surface-inverse);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-md);
    opacity: 0;
    pointer-events: none;
    z-index: var(--z-dropdown);
    transition: opacity var(--duration-fast) var(--ease-standard),
                transform var(--duration-fast) var(--ease-standard);
}
[data-theme="dark"] [data-tooltip]::after { color: var(--neutral-900); background: var(--neutral-300); }
[data-tooltip]:hover::after,
[data-tooltip]:focus-visible::after { opacity: 1; transform: translateX(-50%) translateY(0); }

/* ==========================================================================
   KEYBOARD KEY
   ========================================================================== */

kbd, .kbd {
    display: inline-grid;
    place-items: center;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    font-family: var(--font-ui);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    color: var(--text-secondary);
    background: var(--surface-sunken);
    border: 1px solid var(--border-default);
    border-bottom-width: 2px;
    border-radius: var(--radius-xs);
}

/* ==========================================================================
   FILTER CHIP
   ========================================================================== */

.chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 26px;
    padding: 0 var(--space-1) 0 var(--space-3);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--text-primary);
    background: var(--surface-selected);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
}
.chip-key { color: var(--text-tertiary); }
.chip-remove {
    display: grid; place-items: center;
    width: 18px; height: 18px;
    color: var(--text-tertiary);
    border-radius: var(--radius-full);
}
.chip-remove:hover { background: var(--surface-active); color: var(--text-primary); }
.chip-remove .icon { width: 11px; height: 11px; }

/* ==========================================================================
   CHART SHELL — SVG charts are drawn in JS; this styles their container
   ========================================================================== */

.chart { width: 100%; overflow: visible; }
.chart-grid-line { stroke: var(--chart-grid); stroke-width: 1; }
.chart-axis-label { font-size: 10px; fill: var(--chart-axis); font-family: var(--font-ui); }
.chart-series-1 { fill: var(--chart-1); stroke: var(--chart-1); }
.chart-series-2 { fill: var(--chart-2); stroke: var(--chart-2); }
.chart-series-3 { fill: var(--chart-3); stroke: var(--chart-3); }
.chart-series-4 { fill: var(--chart-4); stroke: var(--chart-4); }

.chart-legend { display: flex; flex-wrap: wrap; gap: var(--space-4); font-size: var(--text-xs); color: var(--text-secondary); }
.chart-legend-item { display: inline-flex; align-items: center; gap: var(--space-2); }
.chart-legend-swatch { width: 9px; height: 9px; border-radius: 2px; flex-shrink: 0; }

.chart-bar { transition: opacity var(--duration-fast) var(--ease-standard); }
.chart-bar:hover { opacity: 0.78; }

/* ==========================================================================
   DIVIDER
   ========================================================================== */

.divider { height: 1px; background: var(--border-subtle); border: 0; }
.divider-v { width: 1px; align-self: stretch; background: var(--border-subtle); }
.divider-labelled { display: flex; align-items: center; gap: var(--space-3); color: var(--text-tertiary); font-size: var(--text-2xs); text-transform: uppercase; letter-spacing: var(--tracking-caps); }
.divider-labelled::before, .divider-labelled::after { content: ""; flex: 1; height: 1px; background: var(--border-subtle); }

/* ============================================================================
   TYPOGRAPHY UTILITIES
   ----------------------------------------------------------------------------
   A deliberately small set. Every page reached for `type-muted` and
   `type-strong` to mean "secondary text" and "the important word in this row",
   so they are defined once here rather than as ad-hoc inline styles.
   ============================================================================ */

.type-muted     { color: var(--text-tertiary); }
.type-secondary { color: var(--text-secondary); }
.type-strong    { font-weight: var(--weight-semibold); color: var(--text-primary); }
.type-caption   { font-size: var(--text-xs); line-height: var(--leading-snug); }
.type-body      { font-size: var(--text-sm); color: var(--text-secondary); line-height: var(--leading-normal); }
.type-body-sm   { font-size: var(--text-xs); color: var(--text-secondary); }
.type-lg        { font-size: var(--text-lg); }
.type-mono      { font-family: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, monospace;
                  font-size: 0.95em; font-variant-numeric: tabular-nums; }

.page-subtitle  { font-size: var(--text-sm); color: var(--text-secondary); margin-top: var(--space-1); }

/* ============================================================================
   LAYOUT UTILITIES
   ============================================================================ */

.stack     { display: flex; flex-direction: column; gap: var(--space-4); }
.stack-sm  { gap: var(--space-3); }
.stack-xs  { gap: var(--space-2); }

.row       { display: flex; align-items: center; gap: var(--space-3); }
.row-tight { gap: var(--space-2); }
.row-wrap  { flex-wrap: wrap; }

.spread    { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.flex-1    { flex: 1; min-width: 0; }

.grid      { display: grid; gap: var(--space-4); }
.grid-2    { display: grid; gap: var(--space-4); grid-template-columns: repeat(2, minmax(0, 1fr)); }
.grid-3    { display: grid; gap: var(--space-4); grid-template-columns: repeat(3, minmax(0, 1fr)); }
.grid-4    { display: grid; gap: var(--space-4); grid-template-columns: repeat(4, minmax(0, 1fr)); }
.grid-6    { display: grid; gap: var(--space-3); grid-template-columns: repeat(6, minmax(0, 1fr)); }

/* Two thirds / one third — a table beside its summary panel. */
.grid-2-1  { display: grid; gap: var(--space-4); grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }

.mt-2 { margin-top: var(--space-2); }
.mt-4 { margin-top: var(--space-4); }
.mb-4 { margin-bottom: var(--space-4); }

.text-right  { text-align: right; }
.text-center { text-align: center; }

/* ============================================================================
   FILTER BAR
   ----------------------------------------------------------------------------
   Filters are not form fields: no validation, no submit, applied on change.
   They get their own quiet treatment so a screen full of them does not compete
   with the data underneath.
   ============================================================================ */

.filter-bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
    padding: var(--space-3) 0;
}

.filter-control {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
}

.filter-control > .type-caption { white-space: nowrap; }

/* ============================================================================
   SMALL CONTROL VARIANTS
   ============================================================================ */

.select-sm,
.input-sm {
    height: 32px;
    padding-top: 0;
    padding-bottom: 0;
    font-size: var(--text-xs);
}

.input-prefix {
    display: inline-flex;
    align-items: center;
    padding: 0 var(--space-2);
    color: var(--text-tertiary);
    font-size: var(--text-sm);
    background: var(--surface-sunken);
    border-right: 1px solid var(--border-subtle);
}

.badge-sm { padding: 0 var(--space-1); font-size: var(--text-2xs); height: 16px; }

/* ============================================================================
   CHECK VARIANTS
   ============================================================================ */

.checkbox,
.check-block {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: border-color var(--duration-fast) var(--ease-standard),
                background-color var(--duration-fast) var(--ease-standard);
}
.checkbox:hover,
.check-block:hover { border-color: var(--border-default); background: var(--surface-hover); }
.check-block > span { display: flex; flex-direction: column; gap: 2px; }

.checkbox-group { display: grid; gap: var(--space-2); grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }

/* ============================================================================
   METER
   ----------------------------------------------------------------------------
   A capacity or progress bar used wherever "how full is this" is the question:
   batch occupancy, admission funnel stages.
   ============================================================================ */

.meter {
    position: relative;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--surface-sunken);
    overflow: hidden;
}
.meter-sm { height: 4px; }

.meter-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent-border);
    transition: width var(--duration-normal) var(--ease-standard);
}
.meter[data-tone="positive"] .meter-fill { background: var(--success-500); }
.meter[data-tone="caution"]  .meter-fill { background: var(--warning-500); }
.meter[data-tone="negative"] .meter-fill { background: var(--danger-500); }

/* ============================================================================
   TABLE VARIANTS
   ============================================================================ */

.table-compact th,
.table-compact td { padding-top: var(--space-2); padding-bottom: var(--space-2); font-size: var(--text-xs); }

/* Section and total rows in a financial statement. */
.table-section td,
.table-section th {
    background: var(--surface-sunken);
    font-weight: var(--weight-semibold);
    text-transform: uppercase;
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-caps);
    color: var(--text-secondary);
}
.table-total td,
.table-total th {
    border-top: 2px solid var(--border-strong);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
}

/* ============================================================================
   KPI VARIANTS
   ============================================================================ */

/*
 * The costume border: a three-pixel gold edge, taken from the gold trim on a
 * Kuchipudi costume. Reserved for the headline figures so the identity colour
 * means something rather than decorating everything.
 */
.kpi-costume {
    border-left: 3px solid var(--brand-gold-500);
}

/* The quiet variant, for supporting figures that should not shout. */
.kpi-quiet {
    background: var(--surface-sunken);
    border: 1px solid var(--border-subtle);
    box-shadow: none;
}
.kpi-quiet .kpi-value { font-size: var(--text-lg); }

.kpi[data-tone="positive"] .kpi-value { color: var(--success-700); }
.kpi[data-tone="negative"] .kpi-value { color: var(--danger-700); }
.kpi[data-tone="caution"]  .kpi-value { color: var(--warning-700); }

/* Movement against the previous period. */
.delta { font-weight: var(--weight-medium); font-variant-numeric: tabular-nums; }
.delta[data-direction="up"]   { color: var(--success-700); }
.delta[data-direction="down"] { color: var(--danger-700); }
.delta[data-direction="flat"] { color: var(--text-tertiary); }

/* Tone applied to any cell or inline value. */
[data-tone="positive"] { color: var(--success-700); }
[data-tone="negative"] { color: var(--danger-700); }
[data-tone="caution"]  { color: var(--warning-700); }

.tick { color: var(--success-600); font-weight: var(--weight-semibold); }

.dot {
    display: inline-block;
    width: 6px; height: 6px;
    border-radius: var(--radius-full);
    background: var(--accent-border);
    vertical-align: middle;
    margin-left: var(--space-2);
}

/* ============================================================================
   TABS AND FORM SECTIONS
   ============================================================================ */

/* Ten settings tabs do not fit a phone; they scroll rather than wrap. */
.tabs-scroll {
    overflow-x: auto;
    flex-wrap: nowrap;
    scrollbar-width: none;
}
.tabs-scroll::-webkit-scrollbar { display: none; }
.tabs-scroll .tab { white-space: nowrap; flex-shrink: 0; }

.drawer-tabs { padding: 0 var(--space-5); border-bottom: 1px solid var(--border-subtle); }

.form-section { margin-bottom: var(--space-5); }
.form-section-title {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
    color: var(--text-secondary);
    margin-bottom: var(--space-1);
}
.form-section-description { font-size: var(--text-xs); color: var(--text-tertiary); margin-bottom: var(--space-3); }

/* ============================================================================
   WIZARD
   ============================================================================ */

.wizard { display: flex; flex-direction: column; gap: var(--space-5); }
.wizard-header { padding-bottom: var(--space-4); border-bottom: 1px solid var(--border-subtle); }
.wizard-panel { min-height: 240px; }

.step.is-current .step-marker {
    background: var(--accent-border);
    color: var(--text-inverse);
    border-color: var(--accent-border);
}
.step.is-done .step-marker {
    background: var(--success-500);
    color: var(--text-inverse);
    border-color: var(--success-500);
}

/* ============================================================================
   GENERIC ACTIVE STATE
   ============================================================================ */

.is-active { background: var(--surface-selected); }
