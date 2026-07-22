/**
 * Phase 0.5 verification — the structural-override boot loader.
 *
 * Proves that applyStructuralOverrides():
 *   1. runs as a clean no-op when no override is stored (frozen defaults hold),
 *   2. installs a stored curriculum/role override when one is present,
 *   3. never throws in either case.
 *
 * Reuses the same browser shim the smoke suite uses.
 */
import 'fake-indexeddb/auto';

globalThis.window = globalThis;
Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    value: { estimate: async () => ({ usage: 0, quota: 1 }), persisted: async () => false, persist: async () => false }
});
globalThis.localStorage = {
    _d: new Map(),
    getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
    setItem(k, v) { this._d.set(k, String(v)); },
    removeItem(k) { this._d.delete(k); }
};

const { db } = await import('../js/core/db.js');
const { session } = await import('../js/core/session.js');
const cfg = await import('../js/config/app.config.js');
const settings = await import('../js/services/settings.service.js');

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('  ok  ', name)) : (fail++, console.log('  FAIL', name)); };

await db.open();
// Give the session an owner so setSetting's capability check passes.
session.hydrate({ user: { id: 'owner', name: 'Principal', role: 'owner' }, branches: [], activeBranchId: null });

// 1) No override stored → no-op, defaults hold.
await settings.applyStructuralOverrides();
ok('no-op when nothing stored: curriculum() === LEVELS', JSON.stringify(cfg.curriculum()) === JSON.stringify(cfg.LEVELS));
ok('no-op when nothing stored: roleTable() === ROLES', JSON.stringify(cfg.roleTable()) === JSON.stringify(cfg.ROLES));

// 2) Store overrides, reload them, confirm they install.
await settings.setSetting('curriculum.override', [{ value: 'foundation', label: 'Foundation', order: 1 }]);
await settings.setSetting('roles.override', { owner: { label: 'Principal', capabilities: ['student.view'] } });
await settings.applyStructuralOverrides();
ok('stored curriculum override installs', cfg.levelLabel('foundation') === 'Foundation' && cfg.curriculum().length === 1);
ok('stored role override installs', cfg.roleLabel('owner') === 'Principal');

// 3) Clearing the keys falls back to defaults.
await settings.setSetting('curriculum.override', null);
await settings.setSetting('roles.override', null);
await settings.applyStructuralOverrides();
ok('cleared → curriculum falls back to LEVELS', cfg.curriculum().length === cfg.LEVELS.length);
ok('cleared → roleLabel(owner) back to "Owner"', cfg.roleLabel('owner') === 'Owner');

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
