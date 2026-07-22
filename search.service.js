/**
 * NATYAM ERP 2.0 — Application shell
 *
 * The chrome around every page: sidebar navigation, the header with its branch
 * switcher, search, notification bell and profile, and the footer that tells
 * the school how its data is doing.
 *
 * The markup here is written against the class contract already defined in
 * shell.css (.app-shell / .app-sidebar / .app-header / .nav-item …) rather
 * than inventing a parallel set of names. Two naming schemes for one piece of
 * furniture is how stylesheets rot.
 *
 * Navigation is filtered by capability, so a teacher's sidebar has no Finance
 * entry — absent, not disabled. A menu full of things you cannot do teaches
 * people to stop reading the menu.
 *
 * The shell listens on the bus rather than being poked by pages. When a payment
 * is recorded the bell updates because notifications changed, not because the
 * fees page remembered to tell the shell. A shell that pages must notify is a
 * shell that breaks each time a page is added.
 */

import { html, render, raw, on, el, initials } from '../utils/dom.js';
import { icon } from './icons.js';
import { session } from '../core/session.js';
import { bus, EVENTS } from '../core/bus.js';
import { router } from '../core/router.js';
import { NAVIGATION } from '../config/app.config.js';
import { openPalette } from './palette.js';
import { unreadCount } from '../services/notifications.service.js';
import { storageStatus } from '../services/settings.service.js';
import { backupStatus } from '../services/backup.service.js';

export class Shell {
    constructor(root) {
        this.root = root;
        this.collapsed = session.prefs().sidebarCollapsed === true;
    }

    mount() {
        render(this.root, html`
            <a class="skip-link" href="#main">Skip to content</a>

            <div class="app-shell" data-role="shell"
                 data-sidebar="${this.collapsed ? 'collapsed' : 'expanded'}">

                <aside class="app-sidebar" data-role="sidebar">
                    <div class="sidebar-brand">
                        <span class="brand-mark" aria-hidden="true">${raw(icon('feather', { size: 20 }))}</span>
                        <span class="brand-text">
                            <span class="brand-name">NATYAM</span>
                            <span class="brand-sub">School of Kuchipudi</span>
                        </span>
                    </div>

                    <div class="sidebar-search">
                        <button class="sidebar-search-btn" data-action="search">
                            ${raw(icon('search', { size: 15 }))}
                            <span>Search</span>
                            <kbd class="kbd">Ctrl K</kbd>
                        </button>
                    </div>

                    <nav class="sidebar-nav" aria-label="Main">
                        <div data-role="nav"></div>
                    </nav>

                    <div class="sidebar-footer">
                        <button class="sidebar-collapse" data-action="collapse"
                                aria-label="Collapse navigation">
                            ${raw(icon('chevrons-left', { size: 16 }))}
                            <span>Collapse</span>
                        </button>
                    </div>
                </aside>

                <div class="app-main">
                    <header class="app-header">
                        <button class="header-btn header-nav-toggle" data-action="menu"
                                aria-label="Open navigation">
                            ${raw(icon('menu', { size: 18 }))}
                        </button>

                        <div class="header-search">
                            <button class="header-search-btn" data-action="search">
                                ${raw(icon('search', { size: 15 }))}
                                <span>Search students, receipts, batches…</span>
                                <kbd class="kbd">Ctrl K</kbd>
                            </button>
                        </div>

                        <div class="header-actions">
                            <div data-role="branch"></div>

                            <a class="header-btn" href="#/notifications"
                               data-role="bell" aria-label="Notifications">
                                ${raw(icon('bell', { size: 18 }))}
                            </a>

                            <button class="header-btn" data-action="theme"
                                    aria-label="Switch between light and dark">
                                ${raw(icon('moon', { size: 18 }))}
                            </button>

                            <button class="profile-btn" data-action="profile">
                                <span class="avatar avatar-sm" aria-hidden="true" data-role="avatar"></span>
                                <span class="brand-text">
                                    <span class="type-strong" data-role="user-name"></span>
                                    <span class="type-caption type-muted" data-role="user-role"></span>
                                </span>
                            </button>
                        </div>
                    </header>

                    <main class="viewport" id="main" data-role="viewport" tabindex="-1"></main>

                    <footer class="app-footer">
                        <span class="storage-pill" data-role="storage"></span>
                        <span data-role="backup"></span>
                    </footer>
                </div>

                <div class="scrim" data-action="close-menu" hidden></div>
            </div>
        `);

        this.paintNav();
        this.paintBranch();
        this.paintUser();
        this.bind();
        this.refreshBell();
        this.refreshFooter();

        return this.root.querySelector('[data-role="viewport"]');
    }

    /* ------------------------------------------------------------------ NAV */

    paintNav() {
        const groups = NAVIGATION
            .map((group) => ({
                ...group,
                items: group.items.filter((item) => !item.cap || session.can(item.cap))
            }))
            .filter((group) => group.items.length);

        render(this.root.querySelector('[data-role="nav"]'), html`
            ${groups.map((group) => html`
                <div class="nav-group">
                    <div class="nav-group-label">${group.group}</div>
                    <ul class="nav-list">
                        ${group.items.map((item) => html`
                            <li>
                                <a class="nav-item" href="#${item.path}" data-path="${item.path}">
                                    ${raw(icon(item.icon, { size: 17 }))}
                                    <span class="nav-item-label">${item.label}</span>
                                </a>
                            </li>
                        `)}
                    </ul>
                </div>
            `)}
        `);

        this.markActive();
    }

    /**
     * Highlights the current route, matching on prefix so /students/:id still
     * lights up Students. `aria-current` is what the stylesheet keys on, which
     * makes the visual state and the accessible state impossible to separate.
     */
    markActive() {
        const current = router.path();

        this.root.querySelectorAll('[data-path]').forEach((node) => {
            const path = node.dataset.path;
            const active = path === '/'
                ? current === '/'
                : current === path || current.startsWith(`${path}/`);

            if (active) node.setAttribute('aria-current', 'page');
            else node.removeAttribute('aria-current');
        });
    }

    /* --------------------------------------------------------------- BRANCH */

    paintBranch() {
        const branches = session.branches || [];
        const target = this.root.querySelector('[data-role="branch"]');

        // A single-branch school is not shown a branch switcher: one more
        // control that can never do anything is worse than no control.
        if (branches.length < 2) {
            render(target, '');
            return;
        }

        render(target, html`
            <label class="branch-select">
                ${raw(icon('map-pin', { size: 15 }))}
                <span class="sr-only">Active branch</span>
                <select class="select select-sm" data-role="branch-select">
                    ${session.canAny('settings.view', 'report.view') ? html`
                        <option value="" ${session.branch() === null ? 'selected' : ''}>All branches</option>
                    ` : ''}
                    ${branches.map((branch) => html`
                        <option value="${branch.id}" ${session.branch() === branch.id ? 'selected' : ''}>
                            ${branch.name}
                        </option>
                    `)}
                </select>
            </label>
        `);
    }

    paintUser() {
        const name = session.actorName();
        render(this.root.querySelector('[data-role="user-name"]'), name);
        render(this.root.querySelector('[data-role="user-role"]'), session.roleLabel());
        render(this.root.querySelector('[data-role="avatar"]'), initials(name));
    }

    /* ----------------------------------------------------------------- BELL */

    async refreshBell() {
        try {
            const count = await unreadCount();
            const bell = this.root.querySelector('[data-role="bell"]');
            if (!bell) return;

            bell.setAttribute('aria-label',
                count ? `Notifications, ${count} unread` : 'Notifications');

            const existing = bell.querySelector('.badge-count');
            if (count) {
                const text = count > 9 ? '9+' : String(count);
                if (existing) existing.textContent = text;
                else bell.append(el('span', { class: 'badge-count' }, text));
            } else {
                existing?.remove();
            }
        } catch {
            /* The bell is decoration. A failure here must not break the shell. */
        }
    }

    /**
     * The footer states plainly where the data lives and when it was last
     * backed up. This app holds a school's entire record set in one browser
     * profile; a person who never sees that fact will not take a backup until
     * the morning it matters.
     */
    async refreshFooter() {
        try {
            const [storage, backup] = await Promise.all([storageStatus(), backupStatus()]);

            render(this.root.querySelector('[data-role="storage"]'), html`
                <span class="storage-dot" data-state="${storage.persisted ? 'ok' : 'warn'}"></span>
                <span>${storage.persisted
                    ? 'Stored in this browser, protected'
                    : 'Stored in this browser, unprotected'}</span>
            `);

            render(this.root.querySelector('[data-role="backup"]'), html`
                <a href="#/settings?tab=data">${backup.message}</a>
            `);
        } catch {
            /* Footer detail is optional; silence beats a broken shell. */
        }
    }

    /* ---------------------------------------------------------------- EVENTS */

    bind() {
        on(this.root, 'click', '[data-action="search"]', () => openPalette());
        on(this.root, 'click', '[data-action="profile"]', () => router.go('/settings?tab=users'));

        on(this.root, 'click', '[data-action="collapse"]', () => {
            this.collapsed = !this.collapsed;
            this.root.querySelector('[data-role="shell"]')
                .setAttribute('data-sidebar', this.collapsed ? 'collapsed' : 'expanded');
            session.setPref('sidebarCollapsed', this.collapsed);
        });

        on(this.root, 'click', '[data-action="menu"]', () => this.toggleMobileNav(true));
        on(this.root, 'click', '[data-action="close-menu"]', () => this.toggleMobileNav(false));
        on(this.root, 'click', '.nav-item', () => this.toggleMobileNav(false));

        on(this.root, 'click', '[data-action="theme"]', () => {
            const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
            applyTheme(next);
            session.setPref('theme', next);
        });

        on(this.root, 'change', '[data-role="branch-select"]', (_e, target) => {
            session.setBranch(target.value || null);
        });

        bus.on(EVENTS.ROUTE_DONE, () => {
            this.markActive();
            this.root.querySelector('[data-role="viewport"]')?.focus?.();
        });

        bus.on(EVENTS.BRANCH_CHANGED, () => this.paintBranch());
        bus.on(EVENTS.BACKUP_RESTORED, () => this.refreshFooter());

        [EVENTS.NOTIFICATION_ADDED, EVENTS.NOTIFICATION_READ, EVENTS.PAYMENT_RECORDED]
            .forEach((event) => bus.on(event, () => this.refreshBell()));
    }

    toggleMobileNav(open) {
        const shell = this.root.querySelector('[data-role="shell"]');
        const scrim = this.root.querySelector('.scrim');
        shell.setAttribute('data-nav', open ? 'open' : 'closed');
        scrim.hidden = !open;
    }
}

/* ------------------------------------------------------------------ THEME */

/**
 * Applied to <html> so the first paint is already correct. "system" follows
 * the device and keeps following it, which matters for a school that starts
 * before dawn and finishes after dark.
 */
export function applyTheme(preference) {
    const resolved = preference === 'system'
        ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : preference;

    document.documentElement.dataset.theme = resolved || 'light';
    bus.emit(EVENTS.THEME_CHANGED, { theme: resolved });
}

export function applyDensity(density) {
    document.documentElement.dataset.density = density || 'comfortable';
}

