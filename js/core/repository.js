/**
 * NATYAM ERP 2.0 — Repository base class
 *
 * One place for the mechanics every entity shares: id minting, timestamps,
 * actor stamping, soft delete, search-key maintenance and audit trail. A
 * concrete repository declares its store and its searchable fields, then only
 * writes the queries that are genuinely specific to it.
 *
 * In 1.0 each of the eight repositories re-implemented getAll/save/delete
 * slightly differently; three of them forgot to write an audit entry and two
 * minted ids with a pattern that could collide inside a loop.
 */

import { db } from './db.js';
import { uid } from '../utils/id.js';
import { nowISO } from '../utils/date.js';
import { session } from './session.js';

export class Repository {
    /**
     * @param {object} config
     * @param {string} config.store       IndexedDB store name.
     * @param {string} config.prefix      Id prefix, e.g. 'STU'.
     * @param {string} config.entity      Human name used in audit entries.
     * @param {string[]} [config.searchFields]  Fields folded into `searchKey`.
     * @param {boolean} [config.softDelete=true]
     * @param {boolean} [config.audit=true]
     */
    constructor({ store, prefix, entity, searchFields = [], softDelete = true, audit = true }) {
        this.store = store;
        this.prefix = prefix;
        this.entity = entity;
        this.searchFields = searchFields;
        this.softDelete = softDelete;
        this.audit = audit;
    }

    /* ---------------------------------------------------------------- HOOKS */

    /** Override to normalise or derive fields before every write. */
    beforeSave(record) { return record; }

    /** Override to throw on invalid state. Runs after beforeSave. */
    validate(_record) { /* no-op by default */ }

    /* ------------------------------------------------------------- INTERNAL */

    /**
     * A single lowercase string containing every searchable field, stored on
     * the record and indexed. Global search then scans one short field per
     * record instead of six, and never has to case-fold at query time.
     */
    _searchKey(record) {
        return this.searchFields
            .map((f) => record[f])
            .filter((v) => v !== null && v !== undefined && v !== '')
            .join(' ')
            .toLowerCase();
    }

    _stamp(record, isNew) {
        const at = nowISO();
        const actor = session.actorId();
        const next = { ...record };

        if (isNew) {
            next.id = next.id || uid(this.prefix);
            next.createdAt = next.createdAt || at;
            next.createdBy = next.createdBy || actor;
            if (this.softDelete) next.deletedAt = null;
        }
        next.updatedAt = at;
        next.updatedBy = actor;

        if (this.searchFields.length) next.searchKey = this._searchKey(next);
        return next;
    }

    async _audit(action, id, detail) {
        if (!this.audit) return;
        await db.put('auditLog', {
            id: uid('AUD'),
            entity: this.entity,
            entityId: id,
            action,
            detail: detail || null,
            actorId: session.actorId(),
            actorName: session.actorName(),
            at: nowISO()
        });
    }

    _visible(record) {
        return record && (!this.softDelete || !record.deletedAt);
    }

    /* ---------------------------------------------------------------- READS */

    /**
     * A missing id is guarded here rather than left to IndexedDB. Passing
     * `undefined` as a key raises `DataError: Data provided to an operation
     * does not meet requirements`, which tells the user nothing and the
     * developer almost nothing — the stack points at the database layer rather
     * than the caller that lost the id. This turns it into a real message.
     */
    async find(id) {
        if (id === undefined || id === null || id === '') return null;
        const record = await db.get(this.store, id);
        return this._visible(record) ? record : null;
    }

    /** Throws rather than returning null. Use where absence is a bug. */
    async findOrFail(id) {
        if (id === undefined || id === null || id === '') {
            throw new Error(`No ${this.entity.toLowerCase()} was specified.`);
        }
        const record = await this.find(id);
        if (!record) throw new Error(`${this.entity} ${id} no longer exists.`);
        return record;
    }

    async all({ includeDeleted = false } = {}) {
        const rows = await db.all(this.store);
        return includeDeleted ? rows : rows.filter((r) => this._visible(r));
    }

    async where(index, value) {
        const rows = await db.byIndex(this.store, index, value);
        return rows.filter((r) => this._visible(r));
    }

    async count(index, value) {
        if (!index) return (await this.all()).length;
        return (await this.where(index, value)).length;
    }

    /**
     * Paginated, sorted, filtered list — the query behind every table in the
     * product. Sorting happens on the index when possible; only the requested
     * page is returned to the view.
     */
    async paginate({ index = null, value = null, direction = 'next', page = 1, pageSize = 25, filter = null } = {}) {
        const range = value === null || value === undefined
            ? null
            : (value instanceof IDBKeyRange ? value : IDBKeyRange.only(value));

        const predicate = (record) => {
            if (!this._visible(record)) return false;
            return filter ? filter(record) : true;
        };

        const result = await db.page(this.store, {
            index,
            range,
            direction,
            offset: (page - 1) * pageSize,
            limit: pageSize,
            where: predicate
        });

        return {
            rows: result.rows,
            total: result.total,
            page,
            pageSize,
            pageCount: Math.max(1, Math.ceil(result.total / pageSize))
        };
    }

    /**
     * Prefix search over the indexed searchKey. Falls back to a substring scan
     * only when the prefix range returns nothing, because a registrar looking
     * for "Ramachandran" should still find "Srilekha Ramachandran".
     */
    async search(term, { limit = 20 } = {}) {
        const q = String(term || '').trim().toLowerCase();
        if (!q) return [];

        if (!this.searchFields.length) {
            return (await this.all())
                .filter((r) => JSON.stringify(r).toLowerCase().includes(q))
                .slice(0, limit);
        }

        const prefixRange = IDBKeyRange.bound(q, `${q}\uffff`);
        const prefixHits = (await db.byIndex(this.store, 'searchKey', prefixRange, { limit }))
            .filter((r) => this._visible(r));
        if (prefixHits.length >= limit) return prefixHits;

        const seen = new Set(prefixHits.map((r) => r.id));
        const rest = (await this.all())
            .filter((r) => !seen.has(r.id) && (r.searchKey || '').includes(q))
            .slice(0, limit - prefixHits.length);

        return [...prefixHits, ...rest];
    }

    /* --------------------------------------------------------------- WRITES */

    async create(data) {
        const record = this._stamp(this.beforeSave({ ...data }), true);
        this.validate(record);
        await db.put(this.store, record);
        await this._audit('create', record.id);
        return record;
    }

    async update(id, changes) {
        const existing = await this.findOrFail(id);
        const record = this._stamp(this.beforeSave({ ...existing, ...changes, id }), false);
        this.validate(record);
        await db.put(this.store, record);

        // Record what actually changed, not the whole object — an audit log
        // full of full-record snapshots is unreadable and grows without bound.
        const changed = Object.keys(changes).filter((k) => existing[k] !== record[k]);
        await this._audit('update', id, { fields: changed });
        return record;
    }

    /** Insert or update depending on whether the id already exists. */
    async save(data) {
        if (data.id && await db.get(this.store, data.id)) return this.update(data.id, data);
        return this.create(data);
    }

    /**
     * Soft delete by default. A school's records are legal documents; a
     * mis-click should not vaporise a student's fee history.
     */
    async remove(id, { hard = false } = {}) {
        if (!this.softDelete || hard) {
            await db.remove(this.store, id);
            await this._audit('delete', id, { hard: true });
            return true;
        }
        const existing = await this.findOrFail(id);
        await db.put(this.store, { ...existing, deletedAt: nowISO(), deletedBy: session.actorId() });
        await this._audit('archive', id);
        return true;
    }

    async restore(id) {
        const existing = await db.get(this.store, id);
        if (!existing) throw new Error(`${this.entity} ${id} no longer exists.`);
        await db.put(this.store, { ...existing, deletedAt: null, deletedBy: null, updatedAt: nowISO() });
        await this._audit('restore', id);
        return true;
    }

    async createMany(items) {
        const records = items.map((item) => {
            const record = this._stamp(this.beforeSave({ ...item }), true);
            this.validate(record);
            return record;
        });
        await db.putMany(this.store, records);
        await this._audit('createMany', null, { count: records.length });
        return records;
    }
}
