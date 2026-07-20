/**
 * NATYAM ERP 2.0 — Settings service
 *
 * Institute details, branches, academic years, fee plans, users and roles.
 * These are the records everything else points at, which makes them the ones
 * where a careless delete does the most damage — so almost every operation
 * here is a check that something is not still in use before allowing it to
 * change.
 *
 * Branch administration lives in this module rather than in a service of its
 * own. A branch has three operations — create, rename, deactivate — and one
 * interesting rule (you cannot close a branch with active students). A
 * separate file for that would be an empty ceremony; what matters is that the
 * rule exists and lives in the service layer.
 */

import { bus, EVENTS } from '../core/bus.js';
import { session } from '../core/session.js';
import { db } from '../core/db.js';
import { localDate } from '../utils/date.js';
import { toPaise, splitInstalments } from '../utils/money.js';
import { LEVELS, ROLES, CAPABILITIES, PREFERENCE_DEFAULTS } from '../config/app.config.js';
import {
    settings$, branches$, academicYears$, feePlans$, users$, students$, staff$, batches$, invoices$
} from '../data/repositories.js';

/* ==========================================================================
   INSTITUTE
   ========================================================================== */

const INSTITUTE_DEFAULTS = {
    name: 'NATYAM — School of Kuchipudi',
    tagline: 'Classical Kuchipudi, taught in the traditional guru-shishya parampara',
    principal: '',
    email: '',
    phone: '',
    address: '',
    website: '',
    gstin: '',
    logo: null
};

export async function institute() {
    const stored = await settings$.get('institute', {});
    return { ...INSTITUTE_DEFAULTS, ...stored };
}

export async function updateInstitute(changes) {
    session.require('settings.edit', 'change the institute details');

    const current = await institute();
    const next = { ...current, ...changes };

    if (!next.name?.trim()) throw new Error('The school needs a name — it appears on every receipt and certificate.');
    if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(next.email)) throw new Error('That email address does not look right.');

    await settings$.set('institute', next);
    bus.emit(EVENTS.SETTINGS_CHANGED, { key: 'institute', value: next });
    return next;
}

/** Arbitrary key/value settings — opening balance, fee reminders, and so on. */
export async function getSetting(key, fallback = null) {
    return settings$.get(key, fallback);
}

export async function setSetting(key, value) {
    session.require('settings.edit', 'change a setting');
    await settings$.set(key, value);
    bus.emit(EVENTS.SETTINGS_CHANGED, { key, value });
    return value;
}

/* ==========================================================================
   BRANCHES
   ========================================================================== */

export async function listBranches({ includeInactive = false } = {}) {
    const rows = includeInactive ? await branches$.all() : await branches$.active();
    const [students, staffRows, batchRows] = await Promise.all([
        students$.active(), staff$.activeStaff(), batches$.active()
    ]);

    return rows.map((branch) => ({
        ...branch,
        studentCount: students.filter((s) => s.branchId === branch.id).length,
        staffCount: staffRows.filter((s) => s.branchId === branch.id).length,
        batchCount: batchRows.filter((b) => b.branchId === branch.id).length
    }));
}

export async function createBranch(data) {
    session.require('settings.edit', 'add a branch');

    const record = {
        ...data,
        name: String(data.name || '').trim(),
        code: String(data.code || '').trim().toUpperCase(),
        status: 'active'
    };

    if (!record.name) throw new Error('A branch needs a name.');
    if (!record.code) throw new Error('A branch needs a short code, e.g. HYD-C.');

    const clash = (await branches$.all()).find((b) => b.code === record.code);
    if (clash) throw new Error(`The code ${record.code} is already used by ${clash.name}.`);

    const branch = await branches$.create(record);
    bus.emit(EVENTS.SETTINGS_CHANGED, { key: 'branches', value: branch });
    return branch;
}

export async function updateBranch(id, changes) {
    session.require('settings.edit', 'edit a branch');
    const branch = await branches$.update(id, changes);
    bus.emit(EVENTS.SETTINGS_CHANGED, { key: 'branches', value: branch });
    return branch;
}

/**
 * Closes a branch. Refuses while anything still points at it — a branch with
 * active students is a branch that is still open, whatever the record says.
 */
export async function closeBranch(id, { reason }) {
    session.require('settings.edit', 'close a branch');

    if (!reason?.trim()) throw new Error('Record why the branch is closing.');
    const branch = await branches$.findOrFail(id);

    const [students, staffRows, batchRows] = await Promise.all([
        students$.active(id), staff$.activeStaff(id), batches$.active(id)
    ]);

    const blockers = [];
    if (students.length) blockers.push(`${students.length} active student${students.length === 1 ? '' : 's'}`);
    if (staffRows.length) blockers.push(`${staffRows.length} staff member${staffRows.length === 1 ? '' : 's'}`);
    if (batchRows.length) blockers.push(`${batchRows.length} active batch${batchRows.length === 1 ? '' : 'es'}`);

    if (blockers.length) {
        throw new Error(`${branch.name} still has ${blockers.join(', ')}. Move or close them before closing the branch.`);
    }

    const closed = await branches$.update(id, { status: 'inactive', closedOn: localDate(), closeReason: reason.trim() });
    bus.emit(EVENTS.SETTINGS_CHANGED, { key: 'branches', value: closed });
    return closed;
}

/* ==========================================================================
   ACADEMIC YEARS
   ========================================================================== */

/**
 * Academic years, newest first.
 *
 * The field names here are `label`, `startsOn`, `endsOn` and `isCurrent`,
 * which is what the schema indexes, the repository queries and the seed writes.
 * This service had been reading `startDate`/`endDate` and writing `name`/
 * `current` — three different vocabularies for one record — so listing the
 * years threw on a field that never existed and the whole screen was dead.
 */
export async function listAcademicYears() {
    return (await academicYears$.all())
        .sort((a, b) => (b.startsOn || '').localeCompare(a.startsOn || ''));
}

export async function createAcademicYear(data) {
    session.require('settings.edit', 'add an academic year');

    if (!data.label?.trim()) throw new Error('Name the academic year, e.g. 2026–27.');
    if (!data.startsOn || !data.endsOn) throw new Error('Give the start and end dates.');
    if (data.endsOn <= data.startsOn) throw new Error('The year cannot end before it starts.');

    const overlapping = (await academicYears$.all()).find((y) =>
        data.startsOn <= y.endsOn && y.startsOn <= data.endsOn);
    if (overlapping) throw new Error(`That overlaps with ${overlapping.label}.`);

    const created = await academicYears$.create({
        ...data,
        label: data.label.trim(),
        isCurrent: 0
    });

    // The switch on the form is a request to make it current, and that has to
    // go through makeCurrent so exactly one year holds the flag.
    if (data.makeCurrent) return academicYears$.makeCurrent(created.id);
    return created;
}

/** Makes a year current. The repository does the swap atomically. */
export async function setCurrentYear(id) {
    session.require('settings.edit', 'change the current academic year');
    const year = await academicYears$.makeCurrent(id);
    bus.emit(EVENTS.SETTINGS_CHANGED, { key: 'academicYear', value: year });
    return year;
}

/* ==========================================================================
   FEE PLANS
   --------------------------------------------------------------------------
   1.0 could create fee structures but never edit them, so a price rise meant
   creating a parallel plan and hoping the right one got picked. Editing is
   allowed here, with the one guard that matters: changing a plan does not
   touch invoices already raised from it.
   ========================================================================== */

export async function listFeePlans({ includeInactive = false } = {}) {
    const rows = includeInactive ? await feePlans$.all() : await feePlans$.active();
    const counts = await Promise.all(rows.map((plan) => feePlans$.usageCount(plan.id)));

    return rows.map((plan, i) => ({
        ...plan,
        levelLabel: LEVELS.find((l) => l.value === plan.level)?.label || plan.level || 'Any level',
        inUse: counts[i],
        instalmentAmounts: splitInstalments(plan.annualAmount, plan.instalments || 1)
    })).sort((a, b) => (a.levelOrder || 0) - (b.levelOrder || 0) || a.name.localeCompare(b.name));
}

export async function createFeePlan(data) {
    session.require('settings.edit', 'create a fee plan');
    return feePlans$.create(normalisePlan(data));
}

/**
 * Edits a fee plan. Invoices already raised keep the amounts they were raised
 * with — a bill the family has already been given does not change because the
 * price list did. The caller is told how many students are affected going
 * forward.
 */
export async function updateFeePlan(id, changes) {
    session.require('settings.edit', 'edit a fee plan');

    const existing = await feePlans$.findOrFail(id);
    const plan = await feePlans$.update(id, normalisePlan({ ...existing, ...changes }));
    const affected = await feePlans$.usageCount(id);

    bus.emit(EVENTS.SETTINGS_CHANGED, { key: 'feePlans', value: plan });
    return { plan, affected };
}

/** Retires a plan. Students already on it keep their existing invoices. */
export async function retireFeePlan(id) {
    session.require('settings.edit', 'retire a fee plan');

    const inUse = await feePlans$.usageCount(id);
    const plan = await feePlans$.update(id, { status: 'inactive', retiredOn: localDate() });

    return { plan, inUse };
}

function normalisePlan(data) {
    const annual = typeof data.annualAmount === 'number' ? data.annualAmount : toPaise(data.annualAmount || 0);
    const record = {
        ...data,
        name: String(data.name || '').trim(),
        annualAmount: Math.round(annual),
        instalments: Math.max(1, Number(data.instalments) || 1),
        registrationFee: Math.round(Number(data.registrationFee) || 0),
        costumeFee: Math.round(Number(data.costumeFee) || 0),
        levelOrder: LEVELS.find((l) => l.value === data.level)?.order || 0,
        status: data.status || 'active'
    };

    if (!record.name) throw new Error('A fee plan needs a name.');
    if (record.annualAmount <= 0) throw new Error('The annual amount must be more than zero.');
    if (record.instalments > 12) throw new Error('A plan can have at most twelve instalments.');
    return record;
}

/* ==========================================================================
   USERS AND ROLES
   --------------------------------------------------------------------------
   Worth being honest about what this is. There is no server, so these roles
   are an *operational* boundary, not a security one: they decide which
   buttons a receptionist sees, and they stop an accountant from accidentally
   deleting a student. Anyone with the browser's developer tools can bypass
   them entirely. Presenting them as security would be a lie that leads a
   school to store things here it should not.
   ========================================================================== */

export async function listUsers() {
    const rows = await users$.all();
    return rows.map((user) => ({
        ...user,
        roleLabel: ROLES[user.role]?.label || user.role,
        capabilities: ROLES[user.role]?.capabilities || []
    }));
}

export async function createUser(data) {
    session.require('settings.edit', 'add a user');

    const record = {
        ...data,
        name: String(data.name || '').trim(),
        email: data.email?.trim().toLowerCase() || null,
        role: data.role,
        status: 'active'
    };

    if (!record.name) throw new Error('A user needs a name.');
    if (!record.role || !ROLES[record.role]) throw new Error('Choose a valid role.');

    const clash = record.email && (await users$.all()).find((u) => u.email === record.email);
    if (clash) throw new Error(`${clash.name} already uses that email address.`);

    return users$.create(record);
}

export async function updateUser(id, changes) {
    session.require('settings.edit', 'edit a user');

    const existing = await users$.findOrFail(id);
    if (changes.role && !ROLES[changes.role]) throw new Error('Choose a valid role.');

    // The school must not be able to lock itself out of its own owner account.
    if (existing.role === 'owner' && changes.role && changes.role !== 'owner') {
        const owners = (await users$.activeUsers()).filter((u) => u.role === 'owner');
        if (owners.length <= 1) throw new Error('There must always be at least one owner.');
    }

    return users$.update(id, changes);
}

export async function deactivateUser(id) {
    session.require('settings.edit', 'deactivate a user');

    const user = await users$.findOrFail(id);
    if (user.role === 'owner') {
        const owners = (await users$.activeUsers()).filter((u) => u.role === 'owner');
        if (owners.length <= 1) throw new Error('The last owner account cannot be deactivated.');
    }
    if (user.id === session.actorId()) throw new Error('You cannot deactivate the account you are signed in with.');

    return users$.update(id, { status: 'inactive', deactivatedOn: localDate() });
}

/** The role matrix, for the permissions screen. */
export function roleMatrix() {
    const capabilities = Object.entries(CAPABILITIES).map(([key, label]) => ({ key, label }));
    return {
        capabilities,
        roles: Object.entries(ROLES).map(([value, role]) => ({
            value,
            label: role.label,
            description: role.description,
            grants: Object.fromEntries(capabilities.map((c) => [
                c.key,
                role.capabilities.includes('*') || role.capabilities.includes(c.key)
            ]))
        }))
    };
}

/* ==========================================================================
   PREFERENCES
   ========================================================================== */

export function preferences() {
    return { ...PREFERENCE_DEFAULTS, ...session.prefs() };
}

export function setPreference(key, value) {
    if (!(key in PREFERENCE_DEFAULTS)) throw new Error(`"${key}" is not a known preference.`);
    session.setPref(key, value);
    return preferences();
}

/* ==========================================================================
   STORAGE
   ========================================================================== */

/**
 * How much room the school's data is taking and whether the browser has
 * promised to keep it. Worth surfacing plainly: this application's data lives
 * in one browser on one machine, and a user who does not understand that will
 * not take backups.
 */
export async function storageStatus() {
    const [usage, persisted] = await Promise.all([db.usage(), navigator.storage?.persisted?.() ?? false]);
    return {
        ...usage,
        persisted,
        advice: persisted
            ? 'This browser has been asked not to clear the school’s data automatically.'
            : 'The browser may clear this data if the device runs low on space. Take regular backups.'
    };
}

export async function requestPersistence() {
    return db.requestPersistence();
}
