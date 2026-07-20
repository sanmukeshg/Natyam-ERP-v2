/**
 * NATYAM ERP 2.0 — Notifications
 *
 * Two things in one place: alerts the system derives, and announcements people
 * write.
 *
 * The alerts are all *derived* — recomputed from the current data rather than
 * fired once when something happened. That is the important design choice.
 * An event-fired alert saying "7 invoices overdue" is a lie the moment someone
 * pays; a derived one is either true or gone. It also means the notification
 * list survives a restore from backup, which an event log would not.
 *
 * Announcements are the opposite: written by a person, true because someone
 * said so, and they stay until removed.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { confirm } from '../../ui/overlay.js';
import { formOverlay } from '../../ui/form.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { router } from '../../core/router.js';
import { formatNumber } from '../../utils/money.js';
import { relativeTime, formatDateTime } from '../../utils/date.js';

import {
    centre, refreshAlerts, markRead, markAllRead, dismiss,
    announce, removeAnnouncement, kindMeta
} from '../../services/notifications.service.js';

const SEVERITY = {
    error: { label: 'Needs action', badge: 'badge-danger', tone: 'negative' },
    warning: { label: 'Worth a look', badge: 'badge-warning', tone: 'caution' },
    success: { label: 'Good news', badge: 'badge-success', tone: 'positive' },
    info: { label: 'For information', badge: 'badge-info', tone: 'neutral' }
};

const FILTERS = [
    { key: '', label: 'Everything' },
    { key: 'unread', label: 'Unread' },
    { key: 'error', label: 'Needs action' },
    { key: 'warning', label: 'Worth a look' },
    { key: 'fee', label: 'Fees' },
    { key: 'attendance', label: 'Attendance' },
    { key: 'birthday', label: 'Birthdays' },
    { key: 'program', label: 'Events' }
];

export default class NotificationsPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Notifications';
        this.filter = this.query.filter || '';
    }

    async render(container) {
        this.container = container;
        render(container, this.shell());
        this.bind();
        await this.load();
    }

    shell() {
        return html`
            <header class="page-header">
                <div class="page-header-text">
                    <h1 class="page-title">Notifications</h1>
                    <p class="page-subtitle" data-role="subtitle">Alerts and announcements.</p>
                </div>
                <div class="page-actions">
                    <button class="btn btn-secondary btn-sm" data-action="refresh">
                        ${raw(icon('rotate-ccw', { size: 15 }))} Recheck
                    </button>
                    <button class="btn btn-secondary btn-sm" data-action="read-all">Mark all read</button>
                    ${session.can('settings.edit') ? html`
                        <button class="btn btn-primary btn-sm" data-action="announce">
                            ${raw(icon('plus', { size: 15 }))} Announcement
                        </button>
                    ` : ''}
                </div>
            </header>
            <div class="page-body">
                <div data-role="summary"></div>
                <div class="filter-bar">
                    <div class="row row-wrap">
                        ${FILTERS.map((chip) => html`
                            <button class="btn btn-sm ${this.filter === chip.key ? 'btn-primary' : 'btn-secondary'}"
                                    data-quick="${chip.key}" aria-pressed="${this.filter === chip.key}">
                                ${chip.label}
                            </button>
                        `)}
                    </div>
                </div>
                <div class="grid grid-2-1">
                    <div data-role="feed"></div>
                    <div data-role="announcements"></div>
                </div>
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
            this.paint();
        }));

        this.onDispose(on(this.container, 'click', '[data-action="refresh"]', () => this.recheck()));
        this.onDispose(on(this.container, 'click', '[data-action="read-all"]', () => this.readAll()));
        this.onDispose(on(this.container, 'click', '[data-action="announce"]', () => this.postAnnouncement()));

        this.onDispose(on(this.container, 'click', '[data-open]', async (_e, target) => {
            const row = this.data.rows.find((r) => r.id === target.dataset.open);
            if (!row) return;
            if (!row.read) await markRead(row.id);
            if (row.link) router.go(row.link.replace(/^#/, ''));
            else await this.load();
        }));

        this.onDispose(on(this.container, 'click', '[data-dismiss]', async (event, target) => {
            event.stopPropagation();
            await dismiss(target.dataset.dismiss);
            await this.load();
        }));

        this.onDispose(on(this.container, 'click', '[data-remove-announcement]', async (_e, target) => {
            const ok = await confirm({
                title: 'Remove this announcement?',
                message: 'It disappears for everyone.',
                confirmLabel: 'Remove',
                danger: true
            });
            if (!ok) return;
            await removeAnnouncement(target.dataset.removeAnnouncement);
            toast.success('Announcement removed.');
            await this.load();
        }));

        [EVENTS.NOTIFICATION_ADDED, EVENTS.PAYMENT_RECORDED, EVENTS.ATTENDANCE_SAVED]
            .filter(Boolean)
            .forEach((event) => this.events.on(event, () => this.load()));
    }

    async load() {
        try {
            this.data = await centre({ limit: 120 });
            this.paint();
        } catch (err) {
            console.error(err);
            toast.error(err.message);
        }
    }

    paint() {
        const data = this.data;

        render(this.container.querySelector('[data-role="subtitle"]'), html`
            ${formatNumber(data.unread)} unread of ${formatNumber(data.rows.length)}
        `);

        render(this.container.querySelector('[data-role="summary"]'), html`
            <div class="grid grid-4">
                ${Object.entries(SEVERITY).map(([key, meta]) => html`
                    <button class="kpi kpi-quiet ${this.filter === key ? 'is-active' : ''}"
                            data-quick="${key}" data-tone="${meta.tone}"
                            aria-pressed="${this.filter === key}">
                        <div class="kpi-head"><span class="kpi-label">${meta.label}</span></div>
                        <div class="kpi-value">${formatNumber(data.counts[key])}</div>
                    </button>
                `)}
            </div>
        `);

        render(this.container.querySelector('[data-role="feed"]'), this.feedView(this.visibleRows()));
        render(this.container.querySelector('[data-role="announcements"]'), this.announcementView(data.announcements));
    }

    visibleRows() {
        const rows = this.data.rows;
        if (!this.filter) return rows;
        if (this.filter === 'unread') return rows.filter((row) => !row.read);
        if (SEVERITY[this.filter]) return rows.filter((row) => row.severity === this.filter);
        return rows.filter((row) => row.kind === this.filter);
    }

    feedView(rows) {
        return html`
            <section class="card">
                <div class="card-header">
                    <h2 class="card-title">Alerts</h2>
                    <p class="card-subtitle">
                        Recalculated from live data, so they clear themselves once dealt with.
                    </p>
                </div>
                <div class="card-body card-body-tight">
                    ${rows.length ? html`
                        <ul class="notice-list">
                            ${rows.map((row) => {
                                const meta = kindMeta(row.kind);
                                const severity = SEVERITY[row.severity] || SEVERITY.info;
                                return html`
                                    <li class="notice ${row.read ? '' : 'is-unread'}" data-tone="${severity.tone}">
                                        <span class="notice-icon" aria-hidden="true">
                                            ${raw(icon(meta.icon, { size: 16 }))}
                                        </span>
                                        <button class="notice-body" data-open="${row.id}">
                                            <span class="notice-title">
                                                ${row.title}
                                                ${row.read ? '' : html`<span class="dot" aria-label="unread"></span>`}
                                            </span>
                                            ${row.body ? html`<span class="notice-text">${row.body}</span>` : ''}
                                            <span class="notice-meta">
                                                <span class="badge ${severity.badge} badge-sm">${severity.label}</span>
                                                <span class="type-caption type-muted">${relativeTime(row.at)}</span>
                                            </span>
                                        </button>
                                        <button class="btn btn-icon btn-ghost btn-sm" data-dismiss="${row.id}"
                                                aria-label="Dismiss">
                                            ${raw(icon('x', { size: 14 }))}
                                        </button>
                                    </li>
                                `;
                            })}
                        </ul>
                    ` : html`
                        <div class="empty empty-compact">
                            <div class="empty-glyph">${raw(icon('check-circle'))}</div>
                            <p class="empty-title">Nothing needs you</p>
                            <p class="empty-text">
                                ${this.filter ? 'Nothing matches this filter.' : 'Every alert has been dealt with.'}
                            </p>
                        </div>
                    `}
                </div>
            </section>
        `;
    }

    announcementView(announcements) {
        return html`
            <section class="card">
                <div class="card-header">
                    <h2 class="card-title">Announcements</h2>
                    <p class="card-subtitle">Notices the school writes.</p>
                </div>
                <div class="card-body card-body-tight">
                    ${announcements.length ? html`
                        <ul class="stack stack-sm">
                            ${announcements.map((row) => html`
                                <li class="announcement ${row.pinned ? 'is-pinned' : ''}">
                                    <div class="spread">
                                        <span class="type-strong">
                                            ${row.pinned ? raw(icon('star', { size: 13 })) : ''}
                                            ${row.title}
                                        </span>
                                        ${session.can('settings.edit') ? html`
                                            <button class="btn btn-icon btn-ghost btn-sm"
                                                    data-remove-announcement="${row.id}"
                                                    aria-label="Remove announcement">
                                                ${raw(icon('trash', { size: 13 }))}
                                            </button>
                                        ` : ''}
                                    </div>
                                    ${row.body ? html`<p class="type-body">${row.body}</p>` : ''}
                                    <p class="type-caption type-muted">
                                        ${row.author || 'The school'} · ${formatDateTime(row.at)}
                                    </p>
                                </li>
                            `)}
                        </ul>
                    ` : html`
                        <div class="empty empty-compact">
                            <p class="empty-text">No announcements.</p>
                        </div>
                    `}
                </div>
            </section>
        `;
    }

    /* --------------------------------------------------------------- ACTIONS */

    async recheck() {
        try {
            const count = await refreshAlerts({ branchId: session.branch() });
            toast.success(count
                ? `${count} alert${count === 1 ? '' : 's'} current.`
                : 'Nothing needs attention.');
            await this.load();
        } catch (err) {
            toast.error(err.message);
        }
    }

    async readAll() {
        await markAllRead();
        toast.success('All marked as read.');
        await this.load();
    }

    async postAnnouncement() {
        const done = await formOverlay({
            title: 'Post an announcement',
            description: 'Shown to everyone who uses this system.',
            submitLabel: 'Post',
            fields: [
                { name: 'title', label: 'Title', required: true, placeholder: 'Hall closed on Friday' },
                { name: 'body', label: 'Detail', type: 'textarea', rows: 3,
                  hint: 'Enough that nobody has to ask a follow-up question.' },
                { name: 'link', label: 'Link', placeholder: '#/programs',
                  hint: 'Optional — where someone should go about this.' },
                { name: 'pinned', label: 'Keep at the top', type: 'switch' }
            ],
            onSubmit: async (values) => announce(values)
        });

        if (done) {
            toast.success('Announcement posted.');
            await this.load();
        }
    }
}
