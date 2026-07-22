/**
 * NATYAM ERP 2.0 — Timetable
 *
 * The week, laid out so a double-booking is visible without anyone running a
 * check. The service already refuses to create clashing batches; this exists
 * because the batches created *before* that rule, or deliberately overridden
 * past it, still need to be seen by a human.
 *
 * Two layouts, same data: a day-column grid on a wide screen, and a stacked
 * day-by-day list on a narrow one. The stacked version is not a degraded
 * fallback — on a phone in a corridor it is the better of the two.
 */

import { Page } from '../../core/router.js';
import { html, render, raw, on } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { router } from '../../core/router.js';
import { formatNumber } from '../../utils/money.js';
import { timetable } from '../../services/batches.service.js';
import { listStaff } from '../../services/staff.service.js';

export default class TimetablePage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Timetable';
        this.teacherId = this.query.teacher || '';
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
                    <h1 class="page-title">Timetable</h1>
                    <p class="page-subtitle" data-role="subtitle">The teaching week.</p>
                </div>
                <div class="page-actions">
                    <label class="filter-control">
                        <span class="sr-only">Teacher</span>
                        <select class="select select-sm" data-role="teacher">
                            <option value="">All teachers</option>
                        </select>
                    </label>
                    <button class="btn btn-secondary btn-sm" data-action="print">
                        ${raw(icon('printer', { size: 15 }))} Print
                    </button>
                </div>
            </header>
            <div class="page-body" data-role="body"></div>
        `;
    }

    bind() {
        this.onDispose(on(this.container, 'change', '[data-role="teacher"]', (_e, target) => {
            this.teacherId = target.value;
            this.paint();
        }));
        this.onDispose(on(this.container, 'click', '[data-action="print"]', () => window.print()));
        this.onDispose(on(this.container, 'click', '[data-batch]', (_e, target) =>
            router.go(`/batches?batch=${target.dataset.batch}`)));

        this.events.on(EVENTS.BRANCH_CHANGED, () => this.load());
    }

    async load() {
        const body = this.container.querySelector('[data-role="body"]');
        render(body, html`<div class="skeleton skeleton-row"></div>`);

        try {
            const [week, staff] = await Promise.all([
                timetable(session.branch()),
                listStaff(session.branch())
            ]);

            this.week = week;

            const select = this.container.querySelector('[data-role="teacher"]');
            render(select, html`
                <option value="">All teachers</option>
                ${staff.filter((person) => person.role === 'teacher').map((person) => html`
                    <option value="${person.id}" ${person.id === this.teacherId ? 'selected' : ''}>
                        ${person.name}
                    </option>
                `)}
            `);

            this.paint();
        } catch (err) {
            console.error(err);
            toast.error(err.message);
        }
    }

    paint() {
        const week = this.teacherId
            ? this.week.map((day) => ({
                ...day,
                sessions: day.sessions.filter((s) => s.teacherId === this.teacherId)
            }))
            : this.week;

        const total = week.reduce((sum, day) => sum + day.sessions.length, 0);
        const clashes = findClashes(week);

        render(this.container.querySelector('[data-role="subtitle"]'), html`
            ${formatNumber(total)} class${total === 1 ? '' : 'es'} a week
            ${clashes.length ? `· ${clashes.length} clash${clashes.length === 1 ? '' : 'es'}` : '· no clashes'}
        `);

        render(this.container.querySelector('[data-role="body"]'), html`
            ${clashes.length ? html`
                <div class="alert alert-warning">
                    <div class="alert-title">Two classes share a teacher or a room</div>
                    <ul class="stack stack-xs">
                        ${clashes.map((clash) => html`<li>${clash}</li>`)}
                    </ul>
                </div>
            ` : ''}

            ${total ? html`
                <div class="timetable">
                    ${week.map((day) => html`
                        <section class="timetable-day">
                            <h2 class="timetable-day-label">${day.label}</h2>
                            ${day.sessions.length ? html`
                                <ul class="stack stack-sm">
                                    ${day.sessions.map((entry) => html`
                                        <li>
                                            <button class="timetable-slot" data-batch="${entry.id}">
                                                <span class="timetable-time">
                                                    ${entry.startTime}–${entry.endTime}
                                                </span>
                                                <span class="type-strong">${entry.name}</span>
                                                <span class="type-caption type-muted">
                                                    ${entry.levelLabel} · ${entry.teacherName}
                                                    ${entry.room ? `· ${entry.room}` : ''}
                                                </span>
                                            </button>
                                        </li>
                                    `)}
                                </ul>
                            ` : html`<p class="type-caption type-muted">No classes.</p>`}
                        </section>
                    `)}
                </div>
            ` : html`
                <div class="card"><div class="card-body">
                    <div class="empty">
                        <div class="empty-glyph">${raw(icon('calendar'))}</div>
                        <h2 class="empty-title">Nothing scheduled</h2>
                        <p class="empty-text">
                            ${this.teacherId ? 'This teacher has no batches.' : 'Create a batch to fill the week.'}
                        </p>
                        <div class="empty-actions">
                            <a class="btn btn-primary" href="#/batches?new=1">New batch</a>
                        </div>
                    </div>
                </div></div>
            `}
        `);
    }
}

/**
 * Overlap detection for display only. The authoritative check is
 * batches.service.findConflicts, which runs before a batch is written; this
 * catches what is already in the database.
 */
function findClashes(week) {
    const messages = [];

    for (const day of week) {
        for (let i = 0; i < day.sessions.length; i += 1) {
            for (let j = i + 1; j < day.sessions.length; j += 1) {
                const a = day.sessions[i];
                const b = day.sessions[j];
                if (!overlaps(a, b)) continue;

                if (a.teacherId && a.teacherId === b.teacherId) {
                    messages.push(`${a.teacherName} teaches ${a.name} and ${b.name} at the same time on ${day.label}.`);
                } else if (a.room && a.room === b.room) {
                    messages.push(`${a.room} holds ${a.name} and ${b.name} at the same time on ${day.label}.`);
                }
            }
        }
    }

    return messages;
}

function overlaps(a, b) {
    return (a.startTime || '') < (b.endTime || '') && (b.startTime || '') < (a.endTime || '');
}
