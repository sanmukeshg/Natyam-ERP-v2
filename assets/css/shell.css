/* ============================================================================
   NATYAM ERP 2.0 — APPLICATION SHELL
   Sidebar, header, page chrome, command palette, boot screen.
   ============================================================================ */

.app-shell {
    display: grid;
    grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
    min-height: 100vh;
    min-height: 100dvh;
    transition: grid-template-columns var(--duration-normal) var(--ease-standard);
}

.app-shell[data-sidebar="collapsed"] { grid-template-columns: var(--sidebar-width-collapsed) minmax(0, 1fr); }

/* ==========================================================================
   SIDEBAR
   ========================================================================== */

.app-sidebar {
    position: sticky;
    top: 0;
    height: 100vh;
    height: 100dvh;
    display: flex;
    flex-direction: column;
    background: var(--brand-indigo-800);
    border-right: 1px solid var(--brand-indigo-900);
    z-index: var(--z-sidebar);
    overflow: hidden;
}

.sidebar-brand {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    height: var(--header-height);
    padding: 0 var(--space-4);
    flex-shrink: 0;
    border-bottom: 1px solid var(--border-inverse);
}

.brand-mark {
    display: grid;
    place-items: center;
    width: 30px; height: 30px;
    flex-shrink: 0;
    font-family: var(--font-display);
    font-size: var(--text-md);
    font-weight: var(--weight-bold);
    color: var(--brand-indigo-900);
    background: var(--brand-gold-500);
    border-radius: var(--radius-md);
}

.brand-text { min-width: 0; overflow: hidden; }
.brand-name {
    font-family: var(--font-display);
    font-size: var(--text-base);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-wide);
    color: var(--text-inverse);
    line-height: 1.15;
    white-space: nowrap;
}
.brand-sub { font-size: var(--text-2xs); color: var(--text-inverse-muted); white-space: nowrap; letter-spacing: var(--tracking-wide); }

.sidebar-search { padding: var(--space-3) var(--space-3) var(--space-2); flex-shrink: 0; }

.sidebar-search-btn {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    height: 32px;
    padding: 0 var(--space-2) 0 var(--space-3);
    font-size: var(--text-xs);
    color: var(--text-inverse-muted);
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--border-inverse);
    border-radius: var(--radius-md);
    transition: background-color var(--duration-fast) var(--ease-standard);
}
.sidebar-search-btn:hover { background: rgba(255, 255, 255, 0.11); color: var(--text-inverse); }
.sidebar-search-btn .icon { width: 14px; height: 14px; flex-shrink: 0; }
.sidebar-search-btn .kbd {
    margin-left: auto;
    background: rgba(255, 255, 255, 0.08);
    border-color: var(--border-inverse);
    color: var(--text-inverse-muted);
}

.sidebar-nav {
    flex: 1;
    padding: var(--space-2) var(--space-3) var(--space-4);
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-color: rgba(255,255,255,0.16) transparent;
}
.sidebar-nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.16); }

.nav-group + .nav-group { margin-top: var(--space-4); }

.nav-group-label {
    padding: 0 var(--space-3) var(--space-2);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.38);
    white-space: nowrap;
}

.nav-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    height: 34px;
    padding: 0 var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: rgba(255, 255, 255, 0.68);
    border-radius: var(--radius-md);
    transition: background-color var(--duration-fast) var(--ease-standard),
                color var(--duration-fast) var(--ease-standard);
}
.nav-item + .nav-item { margin-top: 1px; }
.nav-item:hover { background: rgba(255, 255, 255, 0.07); color: var(--text-inverse); text-decoration: none; }
.nav-item .icon { width: 17px; height: 17px; flex-shrink: 0; }
.nav-item-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }

.nav-item[aria-current="page"] {
    background: rgba(255, 255, 255, 0.11);
    color: var(--text-inverse);
    font-weight: var(--weight-semibold);
}

/* The gold thread. Same device as the KPI card edge — one signature, used
   consistently, marks "you are here" across the whole product. */
.nav-item[aria-current="page"]::before {
    content: "";
    position: absolute;
    left: calc(var(--space-3) * -1 + 2px);
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 18px;
    background: var(--brand-gold-500);
    border-radius: var(--radius-full);
}

.nav-item .badge-count { margin-left: auto; }

/* Nested items */
.nav-sublist { padding-left: var(--space-6); margin-top: 1px; }
.nav-sublist .nav-item { height: 30px; font-size: var(--text-xs); }
.nav-sublist .nav-item[aria-current="page"]::before { left: calc(var(--space-6) * -1 + var(--space-1)); height: 14px; }

.nav-toggle-chevron { width: 13px; height: 13px; margin-left: auto; transition: transform var(--duration-fast) var(--ease-standard); opacity: 0.6; }
.nav-item[aria-expanded="true"] .nav-toggle-chevron { transform: rotate(90deg); }

.sidebar-footer {
    padding: var(--space-3);
    border-top: 1px solid var(--border-inverse);
    flex-shrink: 0;
}

.sidebar-collapse {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    height: 32px;
    padding: 0 var(--space-3);
    font-size: var(--text-xs);
    color: var(--text-inverse-muted);
    border-radius: var(--radius-md);
}
.sidebar-collapse:hover { background: rgba(255, 255, 255, 0.07); color: var(--text-inverse); }
.sidebar-collapse .icon { width: 15px; height: 15px; flex-shrink: 0; transition: transform var(--duration-normal) var(--ease-standard); }

/* Collapsed state: labels and group headings disappear, icons centre. */
.app-shell[data-sidebar="collapsed"] .brand-text,
.app-shell[data-sidebar="collapsed"] .nav-item-label,
.app-shell[data-sidebar="collapsed"] .nav-group-label,
.app-shell[data-sidebar="collapsed"] .sidebar-search-btn span,
.app-shell[data-sidebar="collapsed"] .sidebar-search-btn .kbd,
.app-shell[data-sidebar="collapsed"] .nav-toggle-chevron,
.app-shell[data-sidebar="collapsed"] .sidebar-collapse span,
.app-shell[data-sidebar="collapsed"] .nav-sublist { display: none; }

.app-shell[data-sidebar="collapsed"] .nav-item,
.app-shell[data-sidebar="collapsed"] .sidebar-search-btn,
.app-shell[data-sidebar="collapsed"] .sidebar-collapse { justify-content: center; padding: 0; }
.app-shell[data-sidebar="collapsed"] .sidebar-brand { justify-content: center; padding: 0; }
.app-shell[data-sidebar="collapsed"] .nav-group + .nav-group { margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--border-inverse); }
.app-shell[data-sidebar="collapsed"] .sidebar-collapse .icon { transform: rotate(180deg); }
.app-shell[data-sidebar="collapsed"] .nav-item .badge-count {
    position: absolute; top: 2px; right: 4px; margin: 0;
    min-width: 15px; height: 15px; font-size: 9px;
}

/* ==========================================================================
   MAIN COLUMN
   ========================================================================== */

.app-main { display: flex; flex-direction: column; min-width: 0; min-height: 100vh; min-height: 100dvh; }

.app-header {
    position: sticky;
    top: 0;
    z-index: var(--z-header);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    height: var(--header-height);
    padding: 0 var(--content-pad);
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
}

.header-nav-toggle { display: none; }

.header-search { flex: 1 1 auto; max-width: 460px; }

.header-search-btn {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    height: 34px;
    padding: 0 var(--space-2) 0 var(--space-3);
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    background: var(--surface-sunken);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    transition: border-color var(--duration-fast) var(--ease-standard),
                background-color var(--duration-fast) var(--ease-standard);
}
.header-search-btn:hover { border-color: var(--border-default); background: var(--surface-raised); }
.header-search-btn .icon { width: 15px; height: 15px; flex-shrink: 0; }
.header-search-btn .kbd { margin-left: auto; }

.header-actions { display: flex; align-items: center; gap: var(--space-1); margin-left: auto; }

.header-btn {
    position: relative;
    display: grid;
    place-items: center;
    width: 34px; height: 34px;
    color: var(--text-secondary);
    border-radius: var(--radius-md);
    transition: background-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
}
.header-btn:hover { background: var(--surface-hover); color: var(--text-primary); }
.header-btn .icon { width: 17px; height: 17px; }
.header-btn .badge-count { position: absolute; top: 0; right: 0; transform: translate(25%, -25%); }

/* Branch selector — the single most consequential control in the header, so it
   gets a label rather than an icon. Which campus you are looking at is never
   something the user should have to infer. */
.branch-select {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 34px;
    padding: 0 var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--text-primary);
    background: var(--surface-raised);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    max-width: 220px;
}
.branch-select:hover { background: var(--surface-hover); }
.branch-select .icon { width: 15px; height: 15px; color: var(--text-tertiary); flex-shrink: 0; }
.branch-select-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.profile-btn { display: flex; align-items: center; gap: var(--space-2); padding: 0 var(--space-1); border-radius: var(--radius-md); height: 34px; }
.profile-btn:hover { background: var(--surface-hover); }

/* Page header sits inside the scroll area, under the sticky app header. */
.page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-5) var(--content-pad) var(--space-4);
    flex-wrap: wrap;
}
.page-header-text { min-width: 0; }
.page-title { font-size: var(--text-xl); font-weight: var(--weight-semibold); letter-spacing: var(--tracking-tight); }
.page-description { font-size: var(--text-sm); color: var(--text-secondary); margin-top: var(--space-1); }
.page-actions { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }

.page-body {
    flex: 1;
    padding: 0 var(--content-pad) var(--space-10);
    max-width: var(--content-max);
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
}

.app-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4) var(--content-pad);
    border-top: 1px solid var(--border-subtle);
    background: var(--surface-raised);
    font-size: var(--text-2xs);
    color: var(--text-tertiary);
    flex-wrap: wrap;
}

.storage-pill { display: inline-flex; align-items: center; gap: var(--space-2); }
.storage-dot { width: 6px; height: 6px; border-radius: var(--radius-full); background: var(--success-500); }
.storage-dot[data-state="warn"] { background: var(--warning-500); }
.storage-dot[data-state="error"] { background: var(--danger-500); }

/* ==========================================================================
   COMMAND PALETTE
   ========================================================================== */

.cmd-region {
    position: fixed;
    inset: 0;
    z-index: var(--z-palette);
    display: flex;
    justify-content: center;
    padding: max(10vh, var(--space-8)) var(--space-4) var(--space-4);
    background: var(--surface-scrim);
    backdrop-filter: blur(3px);
    animation: fade-in var(--duration-fast) var(--ease-entrance);
}

.cmd-palette {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 620px;
    max-height: 62vh;
    background: var(--surface-overlay);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-xl);
    overflow: hidden;
    animation: modal-in var(--duration-normal) var(--ease-entrance);
}

.cmd-input-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
}
.cmd-input-row .icon { width: 17px; height: 17px; color: var(--text-tertiary); flex-shrink: 0; }
.cmd-input {
    flex: 1;
    min-width: 0;
    font-size: var(--text-md);
    background: none;
    border: none;
    outline: none;
    color: var(--text-primary);
}
.cmd-input::placeholder { color: var(--text-disabled); }

.cmd-results { overflow-y: auto; padding: var(--space-2); flex: 1; }

.cmd-group-label {
    padding: var(--space-2) var(--space-3) var(--space-1);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--text-tertiary);
}

.cmd-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    text-align: left;
    border-radius: var(--radius-md);
    color: var(--text-primary);
}
.cmd-item[data-active="true"] { background: var(--surface-selected); }
.cmd-item .icon { width: 16px; height: 16px; color: var(--text-tertiary); flex-shrink: 0; }
.cmd-item-text { flex: 1; min-width: 0; }
.cmd-item-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cmd-item-sub { font-size: var(--text-2xs); color: var(--text-tertiary); }
.cmd-item mark { background: var(--accent-subtle); color: var(--accent-text); font-weight: var(--weight-semibold); border-radius: 2px; padding: 0 1px; }

.cmd-footer {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-4);
    background: var(--surface-sunken);
    border-top: 1px solid var(--border-subtle);
    font-size: var(--text-2xs);
    color: var(--text-tertiary);
    flex-shrink: 0;
}
.cmd-hint { display: inline-flex; align-items: center; gap: var(--space-1); }

/* ==========================================================================
   BOOT SCREEN
   ========================================================================== */

.boot {
    position: fixed;
    inset: 0;
    z-index: var(--z-boot);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    background: var(--surface-canvas);
}

.boot-mark {
    display: grid;
    place-items: center;
    width: 46px; height: 46px;
    font-family: var(--font-display);
    font-size: var(--text-xl);
    font-weight: var(--weight-bold);
    color: var(--brand-indigo-900);
    background: var(--brand-gold-500);
    border-radius: var(--radius-lg);
    animation: boot-pulse 1.6s var(--ease-standard) infinite;
}
@keyframes boot-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }

.boot-text { font-size: var(--text-sm); color: var(--text-secondary); }

.boot-error { max-width: 480px; padding: var(--space-6); text-align: center; }
.boot-error h1 { font-size: var(--text-lg); color: var(--danger-500); margin-bottom: var(--space-3); }
.boot-error p { font-size: var(--text-sm); color: var(--text-secondary); margin-bottom: var(--space-3); line-height: var(--leading-normal); }
.boot-error .type-mono { display: block; padding: var(--space-3); background: var(--surface-sunken); border-radius: var(--radius-md); text-align: left; word-break: break-word; margin-bottom: var(--space-4); }

/* ==========================================================================
   RESPONSIVE
   ========================================================================== */

@media (max-width: 1024px) {
    /* Below a laptop, the sidebar becomes an overlay drawer. Grid collapses to
       a single column so content gets the full width. */
    .app-shell { grid-template-columns: minmax(0, 1fr); }

    .app-sidebar {
        position: fixed;
        inset: 0 auto 0 0;
        width: var(--sidebar-width);
        transform: translateX(-100%);
        transition: transform var(--duration-normal) var(--ease-standard);
        box-shadow: var(--shadow-xl);
    }
    .app-shell[data-sidebar="open"] .app-sidebar { transform: translateX(0); }
    .app-shell[data-sidebar="collapsed"] { grid-template-columns: minmax(0, 1fr); }
    .app-shell[data-sidebar="collapsed"] .app-sidebar { width: var(--sidebar-width); }
    .app-shell[data-sidebar="collapsed"] .brand-text,
    .app-shell[data-sidebar="collapsed"] .nav-item-label,
    .app-shell[data-sidebar="collapsed"] .nav-group-label,
    .app-shell[data-sidebar="collapsed"] .nav-sublist { display: revert; }

    .sidebar-scrim {
        position: fixed;
        inset: 0;
        z-index: calc(var(--z-sidebar) - 1);
        background: var(--surface-scrim);
        animation: fade-in var(--duration-fast) var(--ease-entrance);
    }

    .header-nav-toggle { display: grid; }
    .sidebar-footer { display: none; }
}

@media (max-width: 720px) {
    :root { --content-pad: var(--space-4); }

    .header-search { display: none; }
    .branch-select-name { display: none; }
    .branch-select { padding: 0 var(--space-2); }

    .page-header { padding: var(--space-4) var(--content-pad) var(--space-3); }
    .page-actions { width: 100%; }
    .page-actions .btn { flex: 1; }

    .app-footer { flex-direction: column; align-items: flex-start; gap: var(--space-2); }

    .cmd-region { padding: var(--space-3); align-items: flex-start; }
    .cmd-palette { max-height: 80vh; }
}
