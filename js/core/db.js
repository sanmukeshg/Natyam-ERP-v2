/**
 * NATYAM ERP 2.0 — Database engine
 *
 * A thin, honest wrapper over IndexedDB. Its job is to make the rest of the
 * application never touch a raw IDBRequest.
 *
 * What 2.0 adds over 1.0's service:
 *   - Declarative, ordered migrations instead of one version number.
 *   - Real index usage. 1.0 called getAll() then filtered in memory, which is
 *     fine at 80 students and quadratic at 8,000.
 *   - Cursor pagination, so a table renders 25 rows without deserialising the
 *     whole store.
 *   - Atomic work units spanning several stores, with rollback.
 *   - Whole-database export and import for backup and for moving a device.
 */

import { SCHEMA } from '../config/app.config.js';

/**
 * Promisify a single IDBRequest.
 *
 * Exported because `db.unit()` hands the caller raw IDBObjectStore handles —
 * services composing a multi-store unit of work need the same promisifier
 * rather than each inventing its own callback dance.
 */
export function request(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export class Database {
    constructor(schema = SCHEMA) {
        this.schema = schema;
        this.db = null;
        this._opening = null;
        this._listeners = new Set();
    }

    /* ------------------------------------------------------------- LIFECYCLE */

    /**
     * Opens the database, running any pending migrations. Concurrent callers
     * share one open request rather than racing to create three connections.
     */
    open() {
        if (this.db) return Promise.resolve(this.db);
        if (this._opening) return this._opening;

        this._opening = new Promise((resolve, reject) => {
            let req;
            try {
                req = indexedDB.open(this.schema.name, this.schema.version);
            } catch (err) {
                return reject(new Error(
                    'This browser blocked local storage. Natyam ERP stores everything on ' +
                    'this device, so it cannot run in private browsing on some browsers.'
                ));
            }

            req.onupgradeneeded = (event) => {
                const db = req.result;
                const tx = req.transaction;
                const from = event.oldVersion;

                // Create or reconcile every declared store and index. Running
                // this on every upgrade means an install that missed a release
                // still ends up with the correct shape.
                for (const [name, def] of Object.entries(this.schema.stores)) {
                    const store = db.objectStoreNames.contains(name)
                        ? tx.objectStore(name)
                        : db.createObjectStore(name, { keyPath: def.keyPath, autoIncrement: !!def.autoIncrement });

                    for (const [indexName, keyPath, options] of def.indexes || []) {
                        if (!store.indexNames.contains(indexName)) {
                            store.createIndex(indexName, keyPath, options || {});
                        }
                    }
                }

                // Then run data-shaping migrations in order.
                for (const migration of this.schema.migrations) {
                    if (migration.to > from && typeof migration.upgrade === 'function') {
                        migration.upgrade(db, tx, from);
                    }
                }
            };

            req.onsuccess = () => {
                this.db = req.result;

                // Another tab upgrading the schema must not leave this tab
                // holding a stale connection that blocks it forever.
                this.db.onversionchange = () => {
                    this.close();
                    this._emit({ type: 'versionchange' });
                };

                resolve(this.db);
            };

            req.onerror = () => reject(req.error || new Error('The local database could not be opened.'));

            req.onblocked = () => reject(new Error(
                'Another tab is running an older version of Natyam ERP. Close it, then reload this page.'
            ));
        });

        this._opening.catch(() => { this._opening = null; });
        return this._opening;
    }

    close() {
        if (this.db) this.db.close();
        this.db = null;
        this._opening = null;
    }

    /** Subscribe to write events. Returns an unsubscribe function. */
    onChange(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    _emit(event) {
        for (const fn of this._listeners) {
            try { fn(event); } catch (err) { console.error('db listener failed', err); }
        }
    }

    /* ---------------------------------------------------------- TRANSACTIONS */

    /**
     * Runs `work` inside one transaction across `stores`.
     *
     * `work` receives a map of store name to IDBObjectStore and may be async
     * only in the sense of awaiting requests created inside the same tick —
     * IndexedDB auto-commits a transaction once its request queue drains, so
     * never await anything external in here.
     *
     * Resolves when the transaction commits, rejects if it aborts. That
     * distinction matters: 1.0 resolved on the last request's success, so a
     * later abort produced a "saved" toast over rolled-back data.
     */
    async tx(stores, mode, work) {
        const db = await this.open();
        const names = Array.isArray(stores) ? stores : [stores];

        const missing = names.filter((n) => !db.objectStoreNames.contains(n));
        if (missing.length) {
            throw new Error(`Database is missing store(s): ${missing.join(', ')}. Increase SCHEMA.version.`);
        }

        return new Promise((resolve, reject) => {
            let transaction;
            try {
                transaction = db.transaction(names, mode);
            } catch (err) {
                return reject(err);
            }

            const handles = {};
            for (const n of names) handles[n] = transaction.objectStore(n);

            let outcome;
            let failed = null;

            Promise.resolve()
                .then(() => work(handles, transaction))
                .then((value) => { outcome = value; })
                .catch((err) => {
                    failed = err;
                    try { transaction.abort(); } catch { /* already gone */ }
                });

            transaction.oncomplete = () => resolve(outcome);
            transaction.onabort = () => reject(failed || transaction.error || new Error('The write was rolled back.'));
            transaction.onerror = (e) => { e.preventDefault(); };
        });
    }

    /* ----------------------------------------------------------------- READS */

    async get(store, key) {
        return this.tx(store, 'readonly', (s) => request(s[store].get(key)));
    }

    async getMany(store, keys) {
        return this.tx(store, 'readonly', async (s) => {
            const out = [];
            for (const key of keys) out.push(await request(s[store].get(key)));
            return out.filter(Boolean);
        });
    }

    async all(store) {
        return (await this.tx(store, 'readonly', (s) => request(s[store].getAll()))) || [];
    }

    async count(store, { index, value } = {}) {
        return this.tx(store, 'readonly', (s) => {
            const target = index ? s[store].index(index) : s[store];
            return request(value === undefined ? target.count() : target.count(IDBKeyRange.only(value)));
        });
    }

    /**
     * Index-backed lookup. Prefer this over all() + filter anywhere the field
     * is indexed — it is the difference between reading five records and
     * deserialising the entire store.
     */
    async byIndex(store, index, value, { limit } = {}) {
        return this.tx(store, 'readonly', (s) => {
            const idx = s[store].index(index);
            const range = value instanceof IDBKeyRange ? value : IDBKeyRange.only(value);
            return request(limit ? idx.getAll(range, limit) : idx.getAll(range));
        });
    }

    /** Inclusive range query against an index, e.g. attendance between dates. */
    async between(store, index, lower, upper, { limit, direction = 'next' } = {}) {
        const range = IDBKeyRange.bound(lower, upper);
        return this.tx(store, 'readonly', async (s) => {
            const idx = s[store].index(index);
            if (direction === 'next' && !limit) return request(idx.getAll(range));

            const out = [];
            await new Promise((resolve, reject) => {
                const cursorReq = idx.openCursor(range, direction);
                cursorReq.onsuccess = () => {
                    const cursor = cursorReq.result;
                    if (!cursor || (limit && out.length >= limit)) return resolve();
                    out.push(cursor.value);
                    cursor.continue();
                };
                cursorReq.onerror = () => reject(cursorReq.error);
            });
            return out;
        });
    }

    /**
     * Cursor-based page. Walks the index rather than materialising the store,
     * and applies an optional in-cursor predicate so filtering does not force
     * a full read either.
     */
    async page(store, { index, range = null, direction = 'next', offset = 0, limit = 25, where = null } = {}) {
        return this.tx(store, 'readonly', async (s) => {
            const target = index ? s[store].index(index) : s[store];
            const rows = [];
            let skipped = 0;
            let total = 0;

            await new Promise((resolve, reject) => {
                const cursorReq = target.openCursor(range, direction);
                cursorReq.onsuccess = () => {
                    const cursor = cursorReq.result;
                    if (!cursor) return resolve();

                    const record = cursor.value;
                    if (!where || where(record)) {
                        total += 1;
                        if (skipped < offset) skipped += 1;
                        else if (rows.length < limit) rows.push(record);
                    }
                    cursor.continue();
                };
                cursorReq.onerror = () => reject(cursorReq.error);
            });

            return { rows, total, offset, limit, hasMore: offset + rows.length < total };
        });
    }

    /* ---------------------------------------------------------------- WRITES */

    async put(store, record) {
        await this.tx(store, 'readwrite', (s) => request(s[store].put(record)));
        this._emit({ type: 'put', store, id: record[this.schema.stores[store].keyPath] });
        return record;
    }

    /** All-or-nothing bulk write. */
    async putMany(store, records) {
        if (!records.length) return 0;
        await this.tx(store, 'readwrite', async (s) => {
            for (const record of records) await request(s[store].put(record));
        });
        this._emit({ type: 'putMany', store, count: records.length });
        return records.length;
    }

    async remove(store, key) {
        await this.tx(store, 'readwrite', (s) => request(s[store].delete(key)));
        this._emit({ type: 'remove', store, id: key });
        return true;
    }

    async removeMany(store, keys) {
        await this.tx(store, 'readwrite', async (s) => {
            for (const key of keys) await request(s[store].delete(key));
        });
        this._emit({ type: 'removeMany', store, count: keys.length });
        return keys.length;
    }

    async clear(store) {
        await this.tx(store, 'readwrite', (s) => request(s[store].clear()));
        this._emit({ type: 'clear', store });
    }

    /**
     * Runs a multi-store unit of work atomically and emits one change event.
     *
     * This is the mechanism behind "record a payment": the invoice update, the
     * payment row and the two ledger entries either all land or none do. 1.0
     * wrote them with three separate put() calls, so a failure between the
     * second and third left the books unbalanced with no way to detect it.
     */
    async unit(stores, work, eventName = 'unit') {
        const result = await this.tx(stores, 'readwrite', work);
        this._emit({ type: eventName, stores });
        return result;
    }

    /* -------------------------------------------------------- BACKUP / MOVE */

    /** Serialises every store to a plain object suitable for JSON. */
    async exportAll() {
        const names = Object.keys(this.schema.stores);
        const data = {};
        for (const name of names) data[name] = await this.all(name);
        return {
            format: 'natyam-erp-backup',
            schemaVersion: this.schema.version,
            exportedAt: new Date().toISOString(),
            counts: Object.fromEntries(names.map((n) => [n, data[n].length])),
            data
        };
    }

    /**
     * Writes a map of `{ storeName: records[] }` into the database.
     * `mode: 'replace'` wipes each named store first; `'merge'` upserts by key,
     * which is what you want when combining two devices.
     *
     * This takes a bare store map, not a backup file. File-level concerns —
     * what a valid backup looks like, which version wrote it, what to do about
     * unrecognised sections — belong to the backup service, which is where the
     * user-facing messages live. Validating a file format here as well meant
     * two envelope shapes to keep in step, and they had already drifted: this
     * layer checked for `format`, while the service was writing `kind`.
     */
    async importAll(storeMap, { mode = 'replace' } = {}) {
        if (!storeMap || typeof storeMap !== 'object') {
            throw new Error('There is no data to import.');
        }

        const names = Object.keys(storeMap).filter((n) => this.schema.stores[n]);
        if (!names.length) throw new Error('None of that data belongs to this database.');
        const summary = {};

        await this.tx(names, 'readwrite', async (s) => {
            for (const name of names) {
                if (mode === 'replace') await request(s[name].clear());
                const records = storeMap[name] || [];
                for (const record of records) await request(s[name].put(record));
                summary[name] = records.length;
            }
        });

        this._emit({ type: 'import', summary });
        return summary;
    }

    /** Best-effort storage usage, for the footer indicator. */
    async usage() {
        if (!navigator.storage?.estimate) return null;
        const { usage = 0, quota = 0 } = await navigator.storage.estimate();
        return { usage, quota, percent: quota ? (usage / quota) * 100 : 0 };
    }

    /**
     * Asks the browser to exempt this origin from eviction under storage
     * pressure. Offline-first data that the browser may silently delete is not
     * actually offline-first.
     */
    async requestPersistence() {
        if (!navigator.storage?.persist) return false;
        if (await navigator.storage.persisted()) return true;
        return navigator.storage.persist();
    }
}

export const db = new Database();
