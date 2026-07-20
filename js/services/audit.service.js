/**
 * NATYAM ERP 2.0 — Audit service
 *
 * 1.0 wrote audit rows diligently and provided no way whatsoever to read them.
 * Four years of "who changed this student's fee plan" sat in an object store
 * that no screen ever queried. This module is the missing half.
 *
 * The design principle: an audit entry is only useful if a person can read it.
 * A row saying `{entity: "Student", action: "update", detail: {...}}` is a
 * database record, not an answer. Everything here turns those into sentences —
 * "Lalitha Prasad moved Sruthi Reddy to Praveshika B, 4 days ago" — because
 * the question being asked is never "what rows exist" but "what happened, and
 * who did it".
 */

import { session } from '../core/session.js';
import { uid } from '../utils/id.js';
import { localDate, addDays, formatDateTime, relativeTime, nowISO } from '../utils/date.js';
import { formatMoney } from '../utils/money.js';
import { audit$, users$ } from '../data/repositories.js';

/* ==========================================================================
   PHRASING
   ========================================================================== */

const ENTITY_LABELS = {
    Student: 'student', Admission: 'application', Attendance: 'attendance',
    Invoice: 'invoice', Payment: 'payment', Expense: 'expense', Salary: 'salary',
    Certificate: 'certificate', Batch: 'batch', Staff: 'staff member',
    Program: 'programme', Branch: 'branch', Settings: 'settings', FeePlan: 'fee plan'
};

const ACTION_VERBS = {
    create: 'created', update: 'edited', archive: 'archived', restore: 'restored',
    enrol: 'enrolled', approve: 'approved', reject: 'rejected', mark: 'marked',
    correct: 'corrected', pay: 'paid', issue: 'issued', revoke: 'revoked',
    waive: 'waived', cancel: 'cancelled', refund: 'refunded', bulkAssign: 'reassigned',
    close: 'closed', reopen: 'reopened'
};

/**
 * Turns one audit row into a readable sentence.
 *
 * Kept as a pure function so it can be used by the audit page, the student
 * timeline and the CSV export without three slightly different phrasings
 * drifting apart.
 */
/**
 * Builds an audit row for writing inside a caller's transaction.
 *
 * The fees and finance services each had a private copy. Both wrote the log's
 * shape by hand, which meant the format of the audit trail was defined in three
 * places and could drift silently — the one record where drift is least
 * acceptable, since it exists to be trusted after the fact.
 *
 * Returned rather than written, because the caller must put it inside the same
 * transaction as the change it describes. An audit entry committed separately
 * can survive a rolled-back write and describe something that never happened.
 */
export function auditRow(entity, entityId, action, detail = null) {
    return {
        id: uid('AUD'),
        entity, entityId, action, detail,
        actorId: session.actorId(),
        actorName: session.actorName(),
        at: nowISO()
    };
}

export function describe(entry) {
    const actor = entry.actorName || 'Someone';
    const verb = ACTION_VERBS[entry.action] || entry.action;
    const noun = ENTITY_LABELS[entry.entity] || (entry.entity || 'record').toLowerCase();
    const detail = entry.detail || {};

    switch (`${entry.entity}:${entry.action}`) {
        case 'Admission:enrol':
            return `${actor} enrolled an applicant as ${detail.admissionNo || 'a new student'}.`;
        case 'Attendance:mark':
            return `${actor} marked attendance for ${detail.count} student${detail.count === 1 ? '' : 's'} on ${detail.date}.`;
        case 'Attendance:correct':
            return `${actor} corrected ${detail.corrections || 0} attendance mark${detail.corrections === 1 ? '' : 's'} for ${detail.date}.`;
        case 'Payment:create':
            return `${actor} recorded a payment of ${formatMoney(detail.amount || 0)}${detail.receiptNo ? ` — receipt ${detail.receiptNo}` : ''}.`;
        case 'Expense:create':
            return `${actor} recorded a ${detail.category || ''} expense of ${formatMoney(detail.amount || 0)}.`;
        case 'Salary:pay':
            return `${actor} paid ${detail.count} salar${detail.count === 1 ? 'y' : 'ies'} totalling ${formatMoney(detail.total || 0)} for ${detail.period}.`;
        case 'Certificate:issue':
            return `${actor} issued certificate ${detail.serial}${detail.overridden ? ' (eligibility overridden)' : ''}.`;
        case 'Student:bulkAssign':
            return `${actor} moved ${detail.count} students to another batch.`;
        default: {
            const fields = detail.fields || detail.changed;
            if (entry.action === 'update' && Array.isArray(fields) && fields.length) {
                return `${actor} edited ${fields.slice(0, 3).join(', ')}${fields.length > 3 ? ` and ${fields.length - 3} more` : ''} on a ${noun}.`;
            }
            return `${actor} ${verb} a ${noun}.`;
        }
    }
}

/** Decorates a raw row with everything a table needs to render it. */
function decorate(entry) {
    return {
        ...entry,
        summary: describe(entry),
        when: formatDateTime(entry.at),
        ago: relativeTime(entry.at),
        entityLabel: ENTITY_LABELS[entry.entity] || entry.entity,
        actionLabel: ACTION_VERBS[entry.action] || entry.action
    };
}

/* ==========================================================================
   READING
   ========================================================================== */

/**
 * The audit log, filtered. Everything a compliance question needs: what
 * happened, in what window, by whom, to what.
 */
export async function search({ from = null, to = null, entity = null, action = null, actorId = null, entityId = null, limit = 200 } = {}) {
    session.require('audit.view', 'view the audit log');

    let rows = (from || to)
        ? await audit$.between(from || '1970-01-01', to || localDate())
        : await audit$.recent(limit * 3);

    if (entity) rows = rows.filter((r) => r.entity === entity);
    if (action) rows = rows.filter((r) => r.action === action);
    if (actorId) rows = rows.filter((r) => r.actorId === actorId);
    if (entityId) rows = rows.filter((r) => r.entityId === entityId);

    return rows
        .sort((a, b) => (b.at || '').localeCompare(a.at || ''))
        .slice(0, limit)
        .map(decorate);
}

/** The history of one record — shown on a student or invoice detail page. */
export async function historyOf(entity, entityId) {
    const rows = await audit$.forEntity(entity, entityId);
    return rows
        .sort((a, b) => (b.at || '').localeCompare(a.at || ''))
        .map(decorate);
}

/** The most recent activity, for the dashboard's activity feed. */
export async function recentActivity(limit = 12) {
    const rows = await audit$.recent(limit);
    return rows.map(decorate);
}

/* ==========================================================================
   ANALYSIS
   ========================================================================== */

/**
 * Who has been doing what, over a window. Answers the practical management
 * question — is the registrar keeping up, did anyone touch the books last
 * month — rather than producing a compliance artefact nobody reads.
 */
export async function activitySummary({ days = 30 } = {}) {
    session.require('audit.view', 'view the audit log');

    const from = addDays(localDate(), -days);
    const [rows, people] = await Promise.all([
        audit$.between(from, localDate()),
        users$.all()
    ]);

    const byActor = new Map();
    const byEntity = new Map();
    const byDay = new Map();

    for (const row of rows) {
        const day = (row.at || '').slice(0, 10);
        byActor.set(row.actorId, (byActor.get(row.actorId) || 0) + 1);
        byEntity.set(row.entity, (byEntity.get(row.entity) || 0) + 1);
        byDay.set(day, (byDay.get(day) || 0) + 1);
    }

    const nameOf = new Map(people.map((u) => [u.id, u.name]));

    return {
        from,
        to: localDate(),
        total: rows.length,
        actors: [...byActor.entries()]
            .map(([id, count]) => ({ id, name: nameOf.get(id) || 'Unknown', count }))
            .sort((a, b) => b.count - a.count),
        entities: [...byEntity.entries()]
            .map(([entity, count]) => ({ entity, label: ENTITY_LABELS[entity] || entity, count }))
            .sort((a, b) => b.count - a.count),
        daily: [...byDay.entries()]
            .map(([date, count]) => ({ date, count }))
            .sort((a, b) => a.date.localeCompare(b.date))
    };
}

/**
 * Entries worth a second look: eligibility overrides, waivers, refunds,
 * backdated corrections and deletions. Not an accusation — these are all
 * legitimate operations — but they are the ones an owner would want to see a
 * list of once a month.
 */
export async function exceptions({ days = 90 } = {}) {
    session.require('audit.view', 'view the audit log');

    const from = addDays(localDate(), -days);
    const rows = await audit$.between(from, localDate());

    const flagged = rows.filter((row) => {
        const detail = row.detail || {};
        if (['waive', 'refund', 'revoke', 'archive', 'reverse'].includes(row.action)) return true;
        if (detail.overridden) return true;
        if (row.action === 'correct' && (detail.corrections || 0) > 0) return true;
        return false;
    });

    return flagged
        .sort((a, b) => (b.at || '').localeCompare(a.at || ''))
        .map((row) => ({
            ...decorate(row),
            why: row.detail?.overridden ? 'Eligibility rules overridden'
                : row.action === 'waive' ? 'Fee waived'
                : row.action === 'refund' ? 'Payment refunded'
                : row.action === 'revoke' ? 'Certificate revoked'
                : row.action === 'archive' ? 'Record archived'
                : 'Existing records corrected'
        }));
}

/** The filter options the audit page offers, derived from what exists. */
export async function filterOptions() {
    const rows = await audit$.recent(1000);
    return {
        entities: [...new Set(rows.map((r) => r.entity))].filter(Boolean).sort()
            .map((entity) => ({ value: entity, label: ENTITY_LABELS[entity] || entity })),
        actions: [...new Set(rows.map((r) => r.action))].filter(Boolean).sort()
            .map((action) => ({ value: action, label: ACTION_VERBS[action] || action })),
        actors: [...new Map(rows.filter((r) => r.actorId).map((r) => [r.actorId, r.actorName])).entries()]
            .map(([value, label]) => ({ value, label: label || 'Unknown' }))
            .sort((a, b) => a.label.localeCompare(b.label))
    };
}
