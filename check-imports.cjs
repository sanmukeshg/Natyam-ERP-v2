/**
 * Phase 1 verification — the six approved UI/functional fixes.
 *
 * Reuses the render-QA jsdom + fake-indexeddb harness. jsdom has no layout, so
 * this asserts structure and wiring, not pixels; the report notes the manual
 * visual pass that complements it.
 */
import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';

const dom = new JSDOM(
    '<!doctype html><html data-theme="light"><body><div id="app"></div></body></html>',
    { url: 'https://example.org/natyam/', pretendToBeVisual: true }
);
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.Element = window.Element;
globalThis.Event = window.Event;
globalThis.CustomEvent = window.CustomEvent;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
window.matchMedia = globalThis.matchMedia;
globalThis.localStorage = window.localStorage;
globalThis.location = window.location;
Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    value: { estimate: async () => ({ usage: 0, quota: 1 }), persisted: async () => false, persist: async () => true }
});
globalThis.CSS = window.CSS || {};
if (!globalThis.CSS.escape) globalThis.CSS.escape = (v) => String(v).replace(/[^\w-]/g, (c) => `\\${c}`);
window.CSS = globalThis.CSS;

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? (pass++, console.log('  ok  ', name)) : (fail++, console.log('  FAIL', name, extra)); };

const { field, render: _r } = await import('../js/ui/form.js');
const { render } = await import('../js/utils/dom.js');

function renderField(config) {
    const host = document.createElement('div');
    render(host, field(config));
    return host;
}

/* ---- Items 2 & 3 (display): control elements + accessibility ------------- */
{
    const cb = renderField({ name: 'agree', label: 'Agree', type: 'checkbox', value: true });
    ok('checkbox renders styled .check-box', !!cb.querySelector('.check-box'));
    ok('checkbox keeps a real input (a11y)', cb.querySelector('input[type="checkbox"][name="agree"]')?.checked === true);
    ok('.check-box is decorative (aria-hidden)', cb.querySelector('.check-box')?.getAttribute('aria-hidden') === 'true');

    const sw = renderField({ name: 'active', label: 'Active', type: 'switch', value: false });
    ok('switch renders .switch-track', !!sw.querySelector('.switch-track'));
    ok('switch keeps a real input', !!sw.querySelector('input[type="checkbox"][name="active"]'));

    const grp = renderField({
        name: 'days', label: 'Days', type: 'checkbox-group', value: ['Mon', 'Wed'],
        options: ['Mon', 'Tue', 'Wed'].map((d) => ({ value: d, label: d }))
    });
    ok('checkbox-group renders a .check-box per option', grp.querySelectorAll('.check-box').length === 3);
    ok('checkbox-group reflects the selected values', grp.querySelector('input[value="Mon"]').checked && grp.querySelector('input[value="Wed"]').checked && !grp.querySelector('input[value="Tue"]').checked);

    const radio = renderField({
        name: 'gender', label: 'Gender', type: 'radio', value: 'f',
        options: [{ value: 'm', label: 'Male' }, { value: 'f', label: 'Female' }]
    });
    ok('radio renders a .check-radio per option', radio.querySelectorAll('.check-radio').length === 2);
    ok('radio reflects the selected value', radio.querySelector('input[value="f"]').checked && !radio.querySelector('input[value="m"]').checked);
}

/* ---- Item 1: attendance tones must match the CSS vocabulary -------------- */
{
    const pageSrc = readFileSync(new URL('../js/modules/attendance/attendance.page.js', import.meta.url), 'utf8');
    const cssSrc = readFileSync(new URL('../assets/css/modules.css', import.meta.url), 'utf8');
    const marksBlock = pageSrc.slice(pageSrc.indexOf('const MARKS'), pageSrc.indexOf('const MARKS') + 400);
    const usedTones = [...marksBlock.matchAll(/tone:\s*'([a-z]+)'/g)].map((m) => m[1]);
    const btnTones = [...cssSrc.matchAll(/\.mark-btn\.is-active\[data-tone="([a-z]+)"\]/g)].map((m) => m[1]);
    const dotTones = [...cssSrc.matchAll(/\.mark-dot\[data-tone="([a-z]+)"\]/g)].map((m) => m[1]);
    ok('every attendance tone has a mark-btn colour rule', usedTones.every((t) => btnTones.includes(t)), `tones=${usedTones} css=${btnTones}`);
    ok('every attendance tone has a mark-dot colour rule', usedTones.every((t) => dotTones.includes(t)));
    ok('Present=positive, Absent=negative, Late=caution present', usedTones.includes('positive') && usedTones.includes('negative') && usedTones.includes('caution'));
}

/* ---- Item 4 & 3 (service): branch required, days conflict guard ---------- */
{
    const { db } = await import('../js/core/db.js');
    const { session } = await import('../js/core/session.js');
    const { seedIfEmpty } = await import('../js/data/seed.js');
    const bs = await import('../js/services/batches.service.js');
    await db.open(); await seedIfEmpty();
    const branches = await db.all('branches');
    session.hydrate({ user: { id: 'owner', name: 'P', role: 'owner' }, branches, activeBranchId: null });

    // Item 4: the batch page form now includes a defaulted, required branch select.
    const { default: BatchesPage } = await import('../js/modules/batches/batches.page.js');
    const fieldsList = await new BatchesPage().batchFields();
    const branchField = fieldsList.find((f) => f.name === 'branchId');
    ok('batch form has a branchId field', !!branchField);
    ok('branch field is a required select', branchField?.type === 'select' && branchField?.required === true);
    ok('branch field defaults to a real branch', !!branchField?.value && branches.some((b) => b.id === branchField.value));
    ok('branch field lists the branches', Array.isArray(branchField?.options) && branchField.options.length === branches.length);

    // Item 4: a create with a branch succeeds; without one, the clear message.
    let created = false, msgWithoutBranch = '';
    try { const r = await bs.createBatch({ name: 'P1 Test', code: 'P1-' + Math.random().toString(36).slice(2, 5).toUpperCase(), level: 'prarambhika', branchId: branches[0].id, days: ['Mon'], startTime: '07:00', endTime: '08:00', capacity: 5, teacherId: null }); created = !!r.batch; } catch (e) { msgWithoutBranch = e.message; }
    ok('batch creates when a branch is supplied', created);
    try { await bs.createBatch({ name: 'No Branch', code: 'NB-' + Math.random().toString(36).slice(2, 5).toUpperCase(), level: 'prarambhika', branchId: undefined, days: ['Mon'], startTime: '07:00', endTime: '08:00', capacity: 5 }); } catch (e) { msgWithoutBranch = e.message; }
    ok('missing branch still gives the clear message', /branch/i.test(msgWithoutBranch));

    // Item 3: a stored batch with a malformed (non-array) days must not throw a TypeError during conflict search.
    await db.put('batches', { id: 'BCH-BAD', name: 'Legacy', code: 'LGC', branchId: branches[0].id, level: 'prarambhika', days: null, startTime: '07:00', endTime: '08:00', status: 'active', teacherId: null, createdAt: new Date().toISOString() });
    let typeError = false;
    try {
        await bs.createBatch({ name: 'Overlap', code: 'OV-' + Math.random().toString(36).slice(2, 5).toUpperCase(), level: 'prarambhika', branchId: branches[0].id, days: ['Mon'], startTime: '07:00', endTime: '08:00', capacity: 5, teacherId: null }, { allowConflicts: true });
    } catch (e) { if (/is not a function|Cannot read/i.test(e.message)) typeError = true; }
    ok('legacy non-array days never throws a TypeError in conflict search', !typeError);
}

/* ---- Items 5 & 6: static-asset assertions ------------------------------- */
{
    const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    ok('boot text is the school name', indexHtml.includes('NATYAM – School of Kuchipudi') && !indexHtml.includes('Opening the school'));
    const css = readFileSync(new URL('../assets/css/components.css', import.meta.url), 'utf8');
    ok('mobile toast region clears the header', css.includes('top: calc(var(--header-height) + var(--space-3))'));
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
