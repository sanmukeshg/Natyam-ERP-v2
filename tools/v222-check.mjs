/**
 * v2.2.2 verification — final stabilization.
 *
 * Covers every issue raised in the manual UAT report. Two habits from the
 * previous release are kept because they caught real defects: control styling
 * is checked by reading the stylesheet and asserting a rule exists for the
 * class each control actually emits (jsdom applies no CSS cascade, so a
 * rendered element tells you nothing about whether it is visible), and money is
 * checked by round-tripping a value through save twice rather than once, since
 * a scaling bug only shows on the second pass.
 */
import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const app = (rel) => path.join(HERE, '..', rel);

const dom = new JSDOM('<!doctype html><html data-theme="light"><body><div id="app"></div></body></html>',
    { url: 'https://example.org/natyam/', pretendToBeVisual: true });
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
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; console.log('  ok  ', name); }
    else { fail++; console.log('  FAIL', name, extra ? `\n         ${extra}` : ''); }
};
const settle = () => new Promise((r) => setTimeout(r, 20));

const CSS_DIR = app('assets/css');
const styles = fs.readdirSync(CSS_DIR).filter((f) => f.endsWith('.css'))
    .map((f) => fs.readFileSync(path.join(CSS_DIR, f), 'utf8')).join('\n');
const hasRule = (...fragments) => styles.split('}')
    .some((block) => { const sel = block.split('{')[0]; return fragments.every((f) => sel.includes(f)); });

const BASE = '../js';
const { db } = await import(`${BASE}/core/db.js`);
const { session } = await import(`${BASE}/core/session.js`);
const { seedIfEmpty } = await import(`${BASE}/data/seed.js`);
const { branches$, students$, feePlans$, invoices$, attendance$, curriculumLevels$, programs$ } =
    await import(`${BASE}/data/repositories.js`);
const { LEVELS, STORE_NAMES } = await import(`${BASE}/config/app.config.js`);
const { toAmount, formatMoney } = await import(`${BASE}/utils/money.js`);
const { field } = await import(`${BASE}/ui/form.js`);
const { render } = await import(`${BASE}/utils/dom.js`);
const { enrol, deleteStudent, deletionImpact } = await import(`${BASE}/services/students.service.js`);
const { createFeePlan, updateFeePlan, deleteFeePlan, listFeePlans } = await import(`${BASE}/services/settings.service.js`);
const { eligibleStudents } = await import(`${BASE}/services/programs.service.js`);

await db.open();
await seedIfEmpty();
const branches = await branches$.active();
session.hydrate({ user: { id: 'owner', name: 'Principal', role: 'owner' }, branches, activeBranchId: null });

/* ============================================================ ISSUE 2 — MONEY */
console.log('\n== Issue 2: whole-rupee money, no scaling ==');
{
    ok('toAmount keeps a plain number', toAmount(1500) === 1500);
    ok('toAmount strips separators from imports', toAmount('1,500') === 1500, String(toAmount('1,500')));
    ok('toAmount rounds rather than scaling', toAmount('1500.4') === 1500);
    ok('formatMoney shows no decimals', /^₹\s?1,500$/.test(formatMoney(1500)), formatMoney(1500));
    ok('formatMoney of 6375 is ₹6,375', formatMoney(6375).replace(/\s/g, '') === '₹6,375', formatMoney(6375));

    // The bug only appeared on re-save, so save twice.
    const plan = await createFeePlan({ name: 'Money Round Trip', amount: 1500 });
    ok('a new plan stores exactly what was entered', plan.amount === 1500, String(plan.amount));
    const once = (await updateFeePlan(plan.id, { amount: plan.amount })).plan;
    ok('re-saving does not multiply the amount', once.amount === 1500, String(once.amount));
    const twice = (await updateFeePlan(plan.id, { amount: once.amount })).plan;
    ok('a second re-save is still stable', twice.amount === 1500, String(twice.amount));

    // A money field must round-trip through the form without scaling.
    const holder = window.document.createElement('div');
    render(holder, field({ name: 'amount', label: 'Monthly fee', type: 'money', value: 1500 }));
    const input = holder.querySelector('input[data-money]');
    ok('a money field shows the stored figure unchanged', input?.getAttribute('value') === '1500', input?.getAttribute('value'));
    ok('a money field steps in whole rupees', input?.getAttribute('step') === '1', input?.getAttribute('step'));
    ok('a money field asks for a numeric keypad, not decimal',
        input?.getAttribute('inputmode') === 'numeric', input?.getAttribute('inputmode'));

    // Behavioural rather than textual: percentage helpers legitimately use 100.
    ok('the money module never scales an amount by a hundred',
        toAmount(1500) === 1500 && toAmount('1500') === 1500 && toAmount(1500) * 100 !== toAmount(1500));
    const jsFiles = [];
    (function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full); else if (entry.name.endsWith('.js')) jsFiles.push(full);
        }
    })(app('js'));
    const offenders = jsFiles.filter((f) => /toPaise|toRupees|addPaise|subPaise/.test(fs.readFileSync(f, 'utf8')));
    ok('no module still converts to or from paise', offenders.length === 0, offenders.join(', '));
}

/* ====================================================== ISSUE 1 — STUDENT CRUD */
console.log('\n== Issue 1: student row actions ==');
{
    const StudentsPage = (await import(`${BASE}/modules/students/students.page.js`)).default;
    const container = window.document.createElement('div');
    const page = new StudentsPage({ params: {}, query: {}, container });
    await page.render(container);
    await settle();
    const acts = [...container.querySelectorAll('[data-student-act]')].map((b) => b.dataset.studentAct);
    ok('rows expose View', acts.includes('view'), acts.join(','));
    ok('rows expose Edit', acts.includes('edit'), acts.join(','));
    ok('rows expose Delete', acts.includes('delete'), acts.join(','));

    const created = await enrol({
        name: 'Delete Me', level: 'foundation-1', branchId: branches[0].id,
        guardianName: 'G', guardianPhone: '9700000001'
    }, { raiseFees: true });
    const id = created.student.id;
    const impact = await deletionImpact(id);
    ok('deletion impact is reported before deleting', typeof impact.invoices === 'number');
    await deleteStudent(id);
    ok('the student is gone', (await students$.find(id)) === null);
    ok('no invoices are orphaned', (await invoices$.forStudent(id)).length === 0);
    ok('no attendance is orphaned', (await attendance$.forStudent(id)).length === 0);
}

/* ============================================================== ISSUE 5 — LEVELS */
console.log('\n== Issue 5: Level / Qualification ladder ==');
{
    const labels = LEVELS.map((l) => l.label);
    const expected = [
        'Foundation Level 1', 'Foundation Level 2', 'Foundation Level 3', 'Foundation Level 4',
        'Foundation Level 5', 'Foundation Level 6', 'Foundation Level 7', 'Foundation Level 8',
        'Intermediate Certificate', 'Intermediate Diploma',
        'Advanced Masters', 'Advanced Theory', 'Advanced Practical'
    ];
    ok('all thirteen levels are present', expected.every((l) => labels.includes(l)),
        expected.filter((l) => !labels.includes(l)).join(', '));
    ok('there are exactly thirteen', LEVELS.length === 13, String(LEVELS.length));
    ok('the old Sanskrit grades are gone', !labels.some((l) => /Prarambhika|Praveshika|Madhyama|Visharada|Alankara/.test(l)));
    ok('each level is one flat value, not a group plus a sub-field',
        LEVELS.every((l) => !('group' in l) && !('parent' in l) && typeof l.value === 'string'));
    ok('the ladder is ordered Foundation → Intermediate → Advanced',
        LEVELS.findIndex((l) => l.value === 'foundation-8') <
        LEVELS.findIndex((l) => l.value === 'intermediate-certificate') &&
        LEVELS.findIndex((l) => l.value === 'intermediate-diploma') <
        LEVELS.findIndex((l) => l.value === 'advanced-masters'));
    ok('the curriculum vocabulary carries the same thirteen',
        (await curriculumLevels$.ordered()).length >= 13);
}

/* =========================================================== ISSUE 6 — FEE PLANS */
console.log('\n== Issue 6: fee plan fields and delete ==');
{
    const src = fs.readFileSync(app('js/modules/settings/settings.page.js'), 'utf8');
    // The plan form is declared inline in editPlan; read that block.
    const planForm = src.slice(src.indexOf('async editPlan('), src.indexOf('async editPlan(') + 2500);
    ok('the fee plan form has no Level field', !/name: 'level'/.test(planForm));
    ok('the fee plan form has no registration fee', !/registrationFee/.test(planForm));
    ok('the fee plan form has no costume fee', !/costumeFee/.test(planForm));
    ok('the fee plan form still asks for a monthly amount', /name: 'amount'/.test(planForm));

    ok('the Retire button is gone', !/>Retire</.test(src));
    ok('a Delete button is offered instead', /data-do="delete-plan"/.test(src));

    const plan = await createFeePlan({ name: 'Deletable', amount: 900 });
    const student = await enrol({
        name: 'Plan Holder', level: 'foundation-1', branchId: branches[0].id,
        guardianName: 'G', guardianPhone: '9700000002', feePlanId: plan.id
    }, { raiseFees: false });
    await deleteFeePlan(plan.id);
    ok('a deleted plan is really gone', (await feePlans$.find(plan.id)) === null);
    ok('students on it are unlinked, not left dangling',
        (await students$.find(student.student.id))?.feePlanId === null);
}

/* =========================================================== ISSUE 7 — PROGRAMMES */
console.log('\n== Issue 7: every student can be cast ==');
{
    const all = await students$.active(branches[0].id);
    const program = (await programs$.all())[0];
    if (program) {
        const eligible = await eligibleStudents(program.id);
        ok('the picker offers the whole roll', eligible.length === all.length,
            `${eligible.length} offered of ${all.length}`);
        ok('no student is marked ineligible', eligible.every((s) => s.eligible === true));
        ok('no student carries an exclusion reason', eligible.every((s) => !s.reason));
    } else {
        ok('a programme exists to cast', false, 'no programme in fixture');
    }

    // The picker's checkbox must be styled, or it looks unselectable.
    const src = fs.readFileSync(app('js/modules/programs/programs.page.js'), 'utf8');
    ok('the cast picker emits a styled control', /check-box/.test(src));
    ok('a checked rule exists for that control', hasRule(':checked', '.check-box'));
}

/* ============================================== hand-rolled controls, everywhere */
console.log('\n== Selection controls are styled wherever they are written by hand ==');
{
    const files = [];
    (function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full); else if (entry.name.endsWith('.js')) files.push(full);
        }
    })(app('js'));

    const broken = files.filter((f) => {
        const src = fs.readFileSync(f, 'utf8');
        const labels = (src.match(/class="check(?:\s[^"]*)?"/g) || []).length;
        const boxes = (src.match(/check-box|check-radio|switch-track/g) || []).length;
        return labels > 0 && boxes === 0;
    });
    ok('every hand-rolled .check label emits its styled box', broken.length === 0,
        broken.map((f) => path.relative(app('.'), f)).join(', '));
}

/* ================================================================ ISSUE 3 — ERASE */
console.log('\n== Issue 3: erase leaves a genuinely empty installation ==');
{
    const { resetEverything } = await import(`${BASE}/services/backup.service.js`);
    const before = await students$.all();
    ok('there is data to erase', before.length > 0);

    await resetEverything({ safetyCopy: false });

    const counts = {};
    for (const store of STORE_NAMES) counts[store] = await db.count(store);
    const business = Object.entries(counts).filter(([store, n]) => store !== 'settings' && n > 0);
    ok('every business store is empty', business.length === 0, JSON.stringify(Object.fromEntries(business)));

    // The real failure was on the next load, when the seeder rebuilt everything.
    const result = await seedIfEmpty();
    ok('the seeder honours a deliberate erase', result.seeded === false && result.erased === true,
        JSON.stringify(result));
    ok('students are still absent after a reload', (await db.count('students')) === 0);
    ok('batches are still absent after a reload', (await db.count('batches')) === 0);
    ok('staff are still absent after a reload', (await db.count('staff')) === 0);
    ok('attendance is still absent after a reload', (await db.count('attendance')) === 0);
    ok('sequence counters are reset', (await db.get('settings', 'sequences'))?.value?.invoice === 0);
}

/* ------------------------------------------------------------------- DONE */
console.log(`\nv2.2.2: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
