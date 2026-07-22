/**
 * Session.
 *
 * Holds who is using the app and which branch they are looking at. Both are
 * needed synchronously in a great many places — every repository write stamps
 * an actor, every query scopes to a branch — so this is a plain synchronous
 * object hydrated once at boot.
 *
 * A note on what this is not: with no server, this is an *operational* role
 * system, not a security boundary. Anyone with the device can open devtools
 * and change it. It exists so a teacher's screen is not cluttered with the
 * accountant's tools and so a mis-click cannot delete a fee record. Genuine
 * access control needs the backend the architecture is being kept ready for,
 * and that should be said plainly rather than implied by a lock icon.
 */

import { roleCapabilities, roleLabel as resolveRoleLabel, PREFERENCE_DEFAULTS } from '../config/app.config.js';
import { bus, EVENTS } from './bus.js';

const STORAGE_KEY = 'natyam.session';

class Session {
    constructor() {
        this.user = null;
        this.branches = [];
        this.activeBranchId = null;
        this._capabilities = new Set();
    }

    /** Called once during boot, after branches and users are loaded. */
    hydrate({ user, branches, activeBranchId }) {
        this.user = user;
        this.branches = branches || [];

        const remembered = this._readStored().activeBranchId;
        const candidate = activeBranchId || remembered || this.branches[0]?.id || null;
        this.activeBranchId = this.branches.some((b) => b.id === candidate) ? candidate : (this.branches[0]?.id || null);

        this._capabilities = new Set(roleCapabilities(user?.role));
        this._persist();
    }

    /* ------------------------------------------------------------- IDENTITY */

    actorId()   { return this.user?.id || 'system'; }
    actorName() { return this.user?.name || 'System'; }
    role()      { return this.user?.role || 'owner'; }
    roleLabel() { return resolveRoleLabel(this.role()) || 'User'; }

    /* ----------------------------------------------------------- CAPABILITY */

    /** `can('fee.collect')`. A null or undefined capability is always allowed. */
    can(capability) {
        if (!capability) return true;
        return this._capabilities.has(capability);
    }

    canAny(...capabilities) { return capabilities.some((c) => this.can(c)); }
    canAll(...capabilities) { return capabilities.every((c) => this.can(c)); }

    /** Throws with a message meant for a person, not a log. */
    require(capability, action = 'do that') {
        if (this.can(capability)) return;
        throw new Error(`Your role (${this.roleLabel()}) cannot ${action}. Ask an administrator for access.`);
    }

    /* --------------------------------------------------------------- BRANCH */

    /**
     * The active branch **id**, or null for "all branches".
     *
     * This returns the id rather than the record because that is what every
     * caller needs: services take a branchId, and the whole application passes
     * this straight through as a scope argument. An earlier version returned
     * the record, which meant every call site wrote `session.branch().id` and
     * crashed the moment "all branches" was selected and the record was null.
     */
    branch() {
        return this.activeBranchId;
    }

    /** The active branch record, when the name or address is actually needed. */
    branchRecord() {
        return this.branches.find((b) => b.id === this.activeBranchId) || null;
    }

    branchName() { return this.branchRecord()?.name || 'All branches'; }

    setBranch(branchId) {
        if (branchId === this.activeBranchId) return;
        if (branchId !== null && !this.branches.some((b) => b.id === branchId)) return;
        this.activeBranchId = branchId;
        this._persist();
        bus.emit(EVENTS.BRANCH_CHANGED, { branchId, branch: this.branchRecord() });
    }

    /**
     * Standard scope predicate. A branch of null means "all branches", which
     * owners and administrators may select and other roles may not.
     */
    scopeFilter() {
        const id = this.activeBranchId;
        return (record) => id === null || record.branchId === id;
    }

    /* ---------------------------------------------------------- PERSISTENCE */

    /**
     * Preferences live in localStorage rather than IndexedDB deliberately:
     * they are needed to paint the first frame (theme, density, sidebar), and
     * waiting on an async database open there causes a visible flash of the
     * wrong theme.
     */
    prefs() {
        return { ...PREFERENCE_DEFAULTS, ...this._readStored().prefs };
    }

    setPref(key, value) {
        const stored = this._readStored();
        stored.prefs = { ...stored.prefs, [key]: value };
        this._write(stored);
        bus.emit(EVENTS.PREFS_CHANGED, { key, value });
    }

    _readStored() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        } catch {
            return {};
        }
    }

    _write(value) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
        } catch {
            // Private mode or a full quota. Preferences are a convenience;
            // losing them must never stop the app.
        }
    }

    _persist() {
        const stored = this._readStored();
        stored.activeBranchId = this.activeBranchId;
        stored.userId = this.user?.id || null;
        this._write(stored);
    }
}

export const session = new Session();
