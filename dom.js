/**
 * NATYAM ERP 2.0 — Notification service
 *
 * Two distinct things share the word "notification" in most products, and
 * conflating them makes both worse:
 *
 *  - a *toast* is feedback about something the user just did. It is transient,
 *    it is never stored, and it belongs to ui/toast.js.
 *  - a *notification* is something the school needs to know that nobody asked
 *    about — seven invoices went overdue overnight, three applications have
 *    been waiting a week, the Annual Day is in a fortnight. It outlives the
 *    session and is stored.
 *
 * This module owns the second kind. It also generates them: derived alerts are
 * computed at boot from the data itself rather than written at the moment
 * something happens, because an app that was closed when an invoice fell due
 * would otherwise never mention it.
 */

import { bus, EVENTS } from '../core/bus.js';
import { session } from '../core/session.js';
import { uid } from '../utils/id.js';
import { nowISO } from '../utils/date.js';
import { localDate, addDays, daysBetween, formatDate } from '../utils/date.js';
import { formatMoneyShort } from '../utils/money.js';
import { notifications$, invoices$, admissions$, programs$, students$, certificates$ } from '../data/repositories.js';

const KINDS = Object.freeze({
    fee: { icon: 'receipt', tone: 'warning' },
    admission: { icon: 'inbox', tone: 'info' },
    program: { icon: 'star', tone: 'info' },
    birthday: { icon: 'award', tone: 'neutral' },
    attendance: { icon: 'check-square', tone: 'warning' },
    system: { icon: 'info', tone: 'neutral' },
    certificate: { icon: 'award', tone: 'success' }
});

export function kindMeta(kind) {
    return KINDS[kind] || KINDS.system;
}

/* ==========================================================================
   WRITING
   ========================================================================== */

/**
 * Records a notification.
 *
 * De-duplicated on `key`: derived alerts are regenerated on every boot, and
 * without this the notification centre would accumulate one identical "7
 * invoices overdue" row per launch. A repeat updates the existing row in place
 * and, if its text changed, marks it unread again.
 */
export async function notify({ kind = 'system', title, body = null, link = null, key = null }) {
    if (!title?.trim()) throw new Error('A notification needs a title.');

    const dedupeKey = key || `${kind}:${title}`;
    const existing = (await notifications$.all()).find((n) => n.key === dedupeKey);

    if (existing) {
        const changed = existing.title !== title || existing.body !== body;
        const updated = await notifications$.update(existing.id, {
            title, body, link,
            read: changed ? 0 : existing.read,
            repeatedAt: new Date().toISOString()
        });
        return updated;
    }

    const record = await notifications$.create({ kind, title: title.trim(), body, link, key: dedupeKey, read: 0 });
    bus.emit(EVENTS.NOTIFICATION_ADDED, { notification: record });
    return record;
}

export async function markRead(id) {
    const row = await notifications$.markRead(id);
    bus.emit(EVENTS.NOTIFICATION_ADDED, { notification: row });
    bus.emit(EVENTS.NOTIFICATION_READ);
    return row;
}

export async function markAllRead() {
    const count = await notifications$.markAllRead();
    bus.emit(EVENTS.NOTIFICATION_ADDED, { notification: null });
    bus.emit(EVENTS.NOTIFICATION_READ);
    return count;
}

export async function dismiss(id) {
    await notifications$.remove(id, { hard: true });
    bus.emit(EVENTS.NOTIFICATION_ADDED, { notification: null });
    bus.emit(EVENTS.NOTIFICATION_READ);
    return true;
}

export async function list(limit = 30) {
    const rows = await notifications$.recent(limit);
    return rows.map((row) => ({ ...row, meta: kindMeta(row.kind) }));
}

export async function unreadCount() {
    return notifications$.unreadCount();
}

/* ==========================================================================
   DERIVED ALERTS
   ========================================================================== */

/**
 * Recomputes every alert the school should see. Called once at boot, after the
 * overdue sweep, and again when the user asks for a refresh.
 *
 * Each generator is independent and failure-isolated: a malformed programme
 * date must not stop the overdue-fee alert from being written.
 */
export async function refreshAlerts({ branchId = null } = {}) {
    const generators = [
        overdueFees, waitingApplications, upcomingPrograms, monthBirthdays,
        unplacedStudents, expiringCertificates, unmarkedRegisters
    ];
    const written = [];

    for (const generate of generators) {
        try {
            const produced = await generate(branchId);
            written.push(...produced.filter(Boolean));
        } catch (err) {
            console.error(`Alert generator ${generate.name} failed`, err);
        }
    }

    await notifications$.prune(200);
    return written.length;
}

async function overdueFees(branchId) {
    const overdue = await invoices$.overdue(branchId);
    if (!overdue.length) return [];

    const amount = overdue.reduce((sum, i) => sum + i.balance, 0);
    const oldest = overdue.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    const age = daysBetween(oldest.dueDate, localDate());

    return [await notify({
        key: 'derived:fees-overdue',
        kind: 'fee',
        title: `${overdue.length} invoice${overdue.length === 1 ? ' is' : 's are'} overdue`,
        body: `${formatMoneyShort(amount)} outstanding. The oldest is ${age} day${age === 1 ? '' : 's'} past due.`,
        link: '#/fees?filter=overdue'
    })];
}

async function waitingApplications(branchId) {
    const pending = (await admissions$.pending()).filter((a) => !branchId || a.branchId === branchId);
    if (!pending.length) return [];

    const week = addDays(localDate(), -7);
    const stale = pending.filter((a) => (a.appliedOn || '') < week);

    return [await notify({
        key: 'derived:admissions-pending',
        kind: 'admission',
        title: `${pending.length} application${pending.length === 1 ? '' : 's'} awaiting review`,
        body: stale.length
            ? `${stale.length} ${stale.length === 1 ? 'has' : 'have'} been waiting more than a week.`
            : 'All submitted within the last week.',
        link: '#/admissions'
    })];
}

async function upcomingPrograms(branchId) {
    const soon = (await programs$.upcoming(3, branchId))
        .filter((p) => daysBetween(localDate(), p.date) <= 45);

    return Promise.all(soon.map((program) => {
        const days = daysBetween(localDate(), program.date);
        return notify({
            key: `derived:program:${program.id}`,
            kind: 'program',
            title: days === 0 ? `${program.name} is today` : `${program.name} is in ${days} day${days === 1 ? '' : 's'}`,
            body: [program.venue, formatDate(program.date)].filter(Boolean).join(' · '),
            link: `#/programs/${program.id}`
        });
    }));
}

async function monthBirthdays(branchId) {
    const month = Number(localDate().slice(5, 7));
    const all = await students$.birthdaysIn(month);
    const list = branchId ? all.filter((s) => s.branchId === branchId) : all;
    if (!list.length) return [];

    const today = localDate().slice(5);
    const todays = list.filter((s) => (s.dateOfBirth || '').slice(5) === today);

    return [await notify({
        key: 'derived:birthdays',
        kind: 'birthday',
        title: todays.length
            ? `${todays.map((s) => s.name).join(', ')} ${todays.length === 1 ? 'has a birthday' : 'have birthdays'} today`
            : `${list.length} student birthday${list.length === 1 ? '' : 's'} this month`,
        body: todays.length ? null : list.slice(0, 4).map((s) => s.name).join(', ') + (list.length > 4 ? '…' : ''),
        link: '#/students'
    })];
}

async function unplacedStudents(branchId) {
    const all = await students$.unassigned();
    const list = branchId ? all.filter((s) => s.branchId === branchId) : all;
    if (!list.length) return [];

    return [await notify({
        key: 'derived:unplaced',
        kind: 'attendance',
        title: `${list.length} student${list.length === 1 ? ' is' : 's are'} not in a batch`,
        body: 'They will not appear on any roll call until placed.',
        link: '#/students?filter=unplaced'
    })];
}

async function expiringCertificates() {
    // Certificates do not expire, but drafts awaiting issue do go stale.
    const pending = (await certificates$.all()).filter((c) => c.status === 'draft');
    if (!pending.length) return [];

    return [await notify({
        key: 'derived:certificates-draft',
        kind: 'certificate',
        title: `${pending.length} certificate${pending.length === 1 ? '' : 's'} prepared but not issued`,
        body: 'Issue them so students can verify their serials.',
        link: '#/certificates'
    })];
}


/**
 * Registers nobody filled in. This is the alert teachers resent most in 1.0
 * because it fired per register; here it is one row summarising the week, with
 * the oldest named, because a list of forty is not actionable and gets muted.
 */
async function unmarkedRegisters(branchId) {
    const { missingRegisters } = await import('./attendance.service.js');
    const missing = await missingRegisters({ days: 7, branchId });
    if (!missing.length) return [];

    const oldest = missing[missing.length - 1];

    return [await notify({
        key: 'derived:registers-unmarked',
        kind: 'attendance',
        title: `${missing.length} register${missing.length === 1 ? '' : 's'} not marked this week`,
        body: `The oldest is ${oldest.batch.name} on ${formatDate(oldest.date)}.`,
        link: '#/attendance'
    })];
}

/* ==========================================================================
   ANNOUNCEMENTS
   --------------------------------------------------------------------------
   A notice the school writes for itself — a closure, a change of hall, a
   reminder before a performance. Stored as a notification with an explicit
   `announcement` flag rather than in a store of its own: it needs exactly the
   same read state, pruning and feed as everything else, and a second store
   would have duplicated all of it.
   ========================================================================== */

export async function announce({ title, body = null, link = null, pinned = false }) {
    session.require('settings.edit', 'post an announcement');

    if (!title?.trim()) throw new Error('An announcement needs a title.');

    const row = await notifications$.create({
        kind: 'system',
        key: `announcement:${uid('ANN')}`,
        title: title.trim(),
        body: body?.trim() || null,
        link,
        announcement: true,
        pinned,
        author: session.actorName(),
        read: false,
        at: nowISO()
    });

    bus.emit(EVENTS.NOTIFICATION_ADDED, row);
    return row;
}

export async function removeAnnouncement(id) {
    session.require('settings.edit', 'remove an announcement');
    const row = await notifications$.find(id);
    if (!row?.announcement) throw new Error('That is not an announcement.');
    await notifications$.remove(id);
    return true;
}

/** The announcement feed, pinned notices first. */
export async function listAnnouncements() {
    const rows = (await notifications$.all()).filter((row) => row.announcement);
    return rows.sort((a, b) =>
        Number(b.pinned) - Number(a.pinned) || (b.at || '').localeCompare(a.at || ''));
}

/**
 * The notification centre's own view: everything, grouped by how urgent it is
 * rather than by kind, because "what must I deal with" is the question being
 * asked and the kind is only a hint towards the answer.
 */
export async function centre({ limit = 100 } = {}) {
    const [rows, announcements] = await Promise.all([list(limit), listAnnouncements()]);
    const feed = rows.filter((row) => !row.announcement);

    const severityOf = (row) => {
        if (row.kind === 'fee') return 'error';
        if (row.kind === 'attendance' || row.kind === 'admission') return 'warning';
        if (row.kind === 'certificate') return 'success';
        return 'info';
    };

    const withSeverity = feed.map((row) => ({ ...row, severity: severityOf(row) }));

    return {
        rows: withSeverity,
        announcements,
        unread: withSeverity.filter((row) => !row.read).length,
        counts: {
            error: withSeverity.filter((r) => r.severity === 'error').length,
            warning: withSeverity.filter((r) => r.severity === 'warning').length,
            success: withSeverity.filter((r) => r.severity === 'success').length,
            info: withSeverity.filter((r) => r.severity === 'info').length
        }
    };
}
