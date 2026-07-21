/**
 * NATYAM ERP 2.0 — Backup and restore service
 *
 * This application stores everything in one browser on one machine. There is
 * no server holding a copy. If the laptop is stolen, the profile is reset or
 * the browser decides to reclaim space, the school's entire record goes with
 * it — eighty-seven students, four years of attendance, every receipt.
 *
 * So backup is not a nice-to-have feature tucked in settings; it is the only
 * thing standing between the school and total loss, and it is written
 * accordingly: a backup file is self-describing, a restore states plainly what
 * it is about to destroy, and a partial restore is impossible.
 */

import { bus, EVENTS } from '../core/bus.js';
import { session } from '../core/session.js';
import { db } from '../core/db.js';
import { APP, SCHEMA, STORE_NAMES, CAPABILITIES } from '../config/app.config.js';
import { nowISO, localDate, formatDateTime } from '../utils/date.js';
import { downloadFile } from '../utils/dom.js';
import { settings$ } from '../data/repositories.js';

const FILE_KIND = 'natyam-erp-backup';

/* ==========================================================================
   EXPORT
   ========================================================================== */

/**
 * Builds a complete backup object.
 *
 * The envelope matters as much as the data. A bare dump of object stores is
 * unreadable in two years' time; this records the app version, the schema
 * version, when it was taken and by whom, so a future restore can tell whether
 * it understands the file before it starts overwriting anything.
 */
export async function buildBackup({ note = null } = {}) {
    // db.exportAll() returns an envelope — { format, schemaVersion, exportedAt,
    // counts, data } — and the store map is the `data` property inside it.
    // Taking the envelope whole put the records one level too deep, so every
    // backup file carried five sections named after envelope fields and no
    // store data that restore could recognise. Restore then filtered all five
    // out, cleared the database and wrote nothing back.
    const exported = await db.exportAll();
    const data = exported.data;
    const counts = Object.fromEntries(Object.entries(data).map(([store, rows]) => [store, rows.length]));

    return {
        kind: FILE_KIND,
        app: APP.name,
        appVersion: APP.version,
        schemaVersion: SCHEMA.version,
        takenAt: nowISO(),
        takenBy: session.actorName(),
        note: note?.trim() || null,
        counts,
        totalRecords: Object.values(counts).reduce((a, b) => a + b, 0),
        data
    };
}

/** Builds a backup and hands it to the browser as a download. */
export async function downloadBackup({ note = null } = {}) {
    session.require(CAPABILITIES.BACKUP_MANAGE, 'take a backup');

    const backup = await buildBackup({ note });
    const filename = `natyam-backup-${localDate()}.json`;

    downloadFile(filename, JSON.stringify(backup, null, 2), 'application/json');
    await settings$.set('lastBackupAt', backup.takenAt);

    return { filename, ...summarise(backup) };
}

/** When the school last took a backup, and whether that is long enough ago to worry. */
export async function backupStatus() {
    const last = await settings$.get('lastBackupAt', null);
    if (!last) {
        return { everBackedUp: false, lastAt: null, ageDays: null, stale: true, message: 'No backup has ever been taken from this browser.' };
    }

    const ageDays = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
    return {
        everBackedUp: true,
        lastAt: last,
        ageDays,
        stale: ageDays > 7,
        message: ageDays === 0
            ? `Last backup taken today at ${formatDateTime(last).split(', ').pop()}.`
            : `Last backup was ${ageDays} day${ageDays === 1 ? '' : 's'} ago.`
    };
}

/* ==========================================================================
   INSPECTION
   ========================================================================== */

/**
 * Reads and validates a backup file without writing anything.
 *
 * Always called before a restore so the confirmation dialog can say "this file
 * holds 87 students from 3 July" rather than asking the user to accept an
 * irreversible action on faith.
 */
export async function inspectBackup(file) {
    let parsed;
    try {
        parsed = JSON.parse(await file.text());
    } catch {
        throw new Error('That file is not readable as a backup. It should be the .json file this app produced.');
    }

    if (parsed.kind !== FILE_KIND) {
        throw new Error('That file was not produced by NATYAM ERP. Restoring it could corrupt the school’s records.');
    }
    if (!parsed.data || typeof parsed.data !== 'object') {
        throw new Error('That backup file is missing its data section and cannot be restored.');
    }

    const unknownStores = Object.keys(parsed.data).filter((store) => !STORE_NAMES.includes(store));
    const newerSchema = (parsed.schemaVersion || 0) > SCHEMA.version;

    return {
        backup: parsed,
        ...summarise(parsed),
        unknownStores,
        newerSchema,
        warnings: [
            newerSchema && 'This backup came from a newer version of the app. Some data may not be understood.',
            unknownStores.length && `${unknownStores.length} unrecognised section${unknownStores.length === 1 ? '' : 's'} will be ignored.`
        ].filter(Boolean)
    };
}

/* ==========================================================================
   RESTORE
   ========================================================================== */

/**
 * Replaces the entire database with the contents of a backup.
 *
 * Destructive and deliberately so — a "merge" restore sounds safer and is not:
 * it silently produces two copies of every student whose id changed, and the
 * school discovers this months later. What actually protects the user is a
 * safety copy of the current state, taken and offered for download before
 * anything is overwritten.
 *
 * @param {object} backup            A backup object from inspectBackup.
 * @param {boolean} [options.safetyCopy=true]  Download current data first.
 */
export async function restore(backup, { safetyCopy = true } = {}) {
    session.require(CAPABILITIES.BACKUP_MANAGE, 'restore from a backup');

    if (backup.kind !== FILE_KIND) throw new Error('That is not a NATYAM ERP backup file.');

    let safety = null;
    if (safetyCopy) {
        const current = await buildBackup({ note: 'Automatic safety copy taken before a restore' });
        if (current.totalRecords > 0) {
            downloadFile(`natyam-before-restore-${localDate()}.json`, JSON.stringify(current), 'application/json');
            safety = summarise(current);
        }
    }

    const known = Object.fromEntries(
        Object.entries(backup.data).filter(([store]) => STORE_NAMES.includes(store))
    );

    // A restore that recognises nothing must not proceed. `importAll` with
    // `clear` would empty every store and write nothing back, which is the
    // worst possible outcome of an operation the user reached for precisely
    // because they wanted their data returned to them.
    if (!Object.keys(known).length) {
        throw new Error(
            'This backup contains no recognisable data, so nothing was changed. '
            + 'The file may be from a different application or an incompatible version.'
        );
    }

    await db.importAll(known, { mode: 'replace' });
    await settings$.set('lastRestoreAt', nowISO());

    const result = { ...summarise(backup), safety };
    bus.emit(EVENTS.BACKUP_RESTORED, result);
    bus.emit(EVENTS.DATA_IMPORTED, result);

    return result;
}

/* ==========================================================================
   PARTIAL EXPORT
   ========================================================================== */

/**
 * Exports one store as JSON — the answer to "send me the student list" that
 * does not involve handing over the whole ledger. Not a backup, and labelled
 * so nobody mistakes it for one.
 */
export async function exportStore(storeName, { pretty = true } = {}) {
    session.require(CAPABILITIES.BACKUP_MANAGE, 'export data');

    if (!STORE_NAMES.includes(storeName)) throw new Error(`There is no "${storeName}" data to export.`);

    const rows = await db.all(storeName);
    const payload = {
        kind: 'natyam-erp-extract',
        store: storeName,
        app: APP.name,
        takenAt: nowISO(),
        count: rows.length,
        rows
    };

    downloadFile(`natyam-${storeName}-${localDate()}.json`, JSON.stringify(payload, null, pretty ? 2 : 0), 'application/json');
    return { store: storeName, count: rows.length };
}

/**
 * Wipes everything and starts again with fresh seed data. Genuinely useful
 * when a school has been trialling the app and wants to begin for real, and
 * genuinely dangerous, so it demands a safety copy first like a restore does.
 */
export async function resetEverything({ safetyCopy = true } = {}) {
    session.require(CAPABILITIES.BACKUP_MANAGE, 'erase all data');

    if (safetyCopy) {
        const current = await buildBackup({ note: 'Automatic safety copy taken before a full reset' });
        if (current.totalRecords > 0) {
            downloadFile(`natyam-before-reset-${localDate()}.json`, JSON.stringify(current), 'application/json');
        }
    }

    for (const store of STORE_NAMES) {
        await db.clear(store);
    }

    bus.emit(EVENTS.DATA_IMPORTED, { reset: true });
    return true;
}

/* ------------------------------------------------------------------ HELPERS */

/** The human summary of a backup: what a person needs to decide about it. */
function summarise(backup) {
    const counts = backup.counts || Object.fromEntries(
        Object.entries(backup.data || {}).map(([store, rows]) => [store, rows.length])
    );

    return {
        takenAt: backup.takenAt,
        takenBy: backup.takenBy,
        note: backup.note,
        appVersion: backup.appVersion,
        schemaVersion: backup.schemaVersion,
        totalRecords: backup.totalRecords ?? Object.values(counts).reduce((a, b) => a + b, 0),
        highlights: [
            { label: 'Students', count: counts.students || 0 },
            { label: 'Attendance records', count: counts.attendance || 0 },
            { label: 'Invoices', count: counts.invoices || 0 },
            { label: 'Payments', count: counts.payments || 0 },
            { label: 'Ledger entries', count: counts.ledgerEntries || 0 },
            { label: 'Certificates', count: counts.certificates || 0 }
        ],
        counts
    };
}
