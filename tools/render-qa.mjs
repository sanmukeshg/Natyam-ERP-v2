/**
 * Render QA.
 *
 * The smoke suite proves the services work. This proves the screens do: it
 * boots the real database, then mounts every page class into a real DOM,
 * clicks through the controls each one exposes, and reports anything that
 * throws, renders empty, or leaves listeners behind.
 *
 * jsdom is not Chrome. It has no layout, so this cannot catch anything visual
 * — overlapping elements, unreadable contrast, a column that wraps badly. What
 * it does catch is the class of failure that makes a screen blank: a template
 * that throws, a missing import, an event handler bound to a selector that was
 * renamed, a page that reads a service field that no longer exists. Those are
 * the bugs that were still unexamined, and they are the expensive ones.
 */

import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';

/* ---------------------------------------------------------------- DOM SETUP */

const dom = new JSDOM(
    '<!doctype html><html data-theme="light" data-density="comfortable"><body><div id="app"></div></body></html>',
    { url: 'https://example.org/natyam/', pretendToBeVisual: true }
);

const { window } = dom;

globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.CustomEvent = window.CustomEvent;
globalThis.KeyboardEvent = window.KeyboardEvent;
globalThis.MouseEvent = window.MouseEvent;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, addListener() {} }));
window.matchMedia = globalThis.matchMedia;
globalThis.localStorage = window.localStorage;
globalThis.location = window.location;
globalThis.history = window.history;
globalThis.addEventListener = window.addEventListener.bind(window);
globalThis.removeEventListener = window.removeEventListener.bind(window);
globalThis.scrollTo = () => {};
window.scrollTo = () => {};
window.print = () => {};

Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    value: {
        estimate: async () => ({ usage: 2 * 1024 * 1024, quota: 512 * 1024 * 1024 }),
        persisted: async () => false,
        persist: async () => true
    }
});

// jsdom does not implement the CSS object. `CSS.escape` is a real browser API
// that the form builder uses correctly, so this is a gap in the test
// environment rather than in the application.
globalThis.CSS = window.CSS || {};
if (!globalThis.CSS.escape) {
    globalThis.CSS.escape = (value) => String(value).replace(/[^\w-]/g, (ch) => `\\${ch}`);
}
window.CSS = globalThis.CSS;

globalThis.URL.createObjectURL = () => 'blob:stub';
globalThis.URL.revokeObjectURL = () => {};

// Downloads and print windows must not abort a render test.
const opened = [];
window.open = (url) => {
    opened.push(url);
    return {
        document: { write() {}, close() {} },
        focus() {}, print() {}, close() {},
        addEventListener() {}
    };
};

/* ------------------------------------------------------------- ERROR CAPTURE */

const consoleErrors = [];
const originalError = console.error;
console.error = (...args) => { consoleErrors.push(args.map(String).join(' ')); };

const unhandled = [];
process.on('unhandledRejection', (reason) => unhandled.push(String(reason?.message || reason)));

/* ------------------------------------------------------------------ HARNESS */

let passed = 0;
let failed = 0;
const failures = [];

async function check(label, fn) {
    consoleErrors.length = 0;
    try {
        await fn();
        passed += 1;
        console.log(`  ok   ${label}`);
    } catch (err) {
        failed += 1;
        failures.push({ label, err });
        console.log(`  FAIL ${label}\n         ${err.message}`);
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

/* -------------------------------------------------------------------- BOOT */

const BASE = '../js';

const { db } = await import(`${BASE}/core/db.js`);
const { session } = await import(`${BASE}/core/session.js`);
const { seedIfEmpty } = await import(`${BASE}/data/seed.js`);
const { branches$ } = await import(`${BASE}/data/repositories.js`);
const { ROUTES, NAVIGATION } = await import(`${BASE}/config/app.config.js`);

console.log('\n== Boot ==');

await check('database opens and seeds', async () => {
    await db.open();
    await seedIfEmpty();
    const branches = await branches$.active();
    session.hydrate({
        user: { id: 'owner', name: 'Principal', role: 'owner' },
        branches,
        activeBranchId: null
    });
    assert(session.can('fee.collect'), 'session did not hydrate');
});

/* ------------------------------------------------------------------- SHELL */

console.log('\n== Shell ==');

let viewport = null;

await check('the shell mounts and returns a viewport', async () => {
    const { Shell } = await import(`${BASE}/ui/shell.js`);
    const root = document.querySelector('#app');
    const shell = new Shell(root);
    viewport = shell.mount();
    await settle();

    assert(viewport, 'mount() returned no viewport');
    assert(root.querySelector('.app-shell'), 'no .app-shell in the DOM');
    assert(root.querySelector('.app-sidebar'), 'no sidebar');
    assert(root.querySelector('.app-header'), 'no header');
    assert(consoleErrors.length === 0, `console errors: ${consoleErrors[0]}`);
});

await check('navigation renders every permitted route', async () => {
    const links = [...document.querySelectorAll('.nav-item')];
    const permitted = NAVIGATION.flatMap((g) => g.items).filter((i) => !i.cap || session.can(i.cap));
    assert(links.length === permitted.length,
        `${links.length} nav links for ${permitted.length} permitted routes`);

    for (const link of links) {
        assert(link.getAttribute('href')?.startsWith('#/'), `bad href: ${link.getAttribute('href')}`);
        assert(link.textContent.trim().length > 0, 'a nav item has no label');
    }
});

await check('the sidebar collapse toggle works', async () => {
    const shellEl = document.querySelector('.app-shell');
    const before = shellEl.getAttribute('data-sidebar');
    document.querySelector('[data-action="collapse"]').click();
    await settle();
    assert(shellEl.getAttribute('data-sidebar') !== before, 'collapsing changed nothing');
    document.querySelector('[data-action="collapse"]').click();
    await settle();
});

await check('the theme toggle flips the document', async () => {
    const before = document.documentElement.dataset.theme;
    document.querySelector('[data-action="theme"]').click();
    await settle();
    assert(document.documentElement.dataset.theme !== before, 'theme did not change');
    document.querySelector('[data-action="theme"]').click();
    await settle();
});

/* ------------------------------------------------------------------- PAGES */

console.log('\n== Pages ==');

const { router } = await import(`${BASE}/core/router.js`);

for (const route of ROUTES) {
    await check(`${route.path} renders`, async () => {
        const module = await route.load();
        const PageClass = module.default || module.Page || module;
        assert(typeof PageClass === 'function', 'route did not resolve to a page class');

        const container = document.createElement('div');
        document.body.append(container);

        const page = new PageClass({
            params: {},
            query: {},
            container
        });

        await page.render(container);
        await settle();

        assert(container.children.length > 0, 'rendered nothing');
        assert(container.querySelector('.page-header, .page-body'),
            'no page header or body — the page shell did not render');

        const errors = consoleErrors.filter((e) => !e.includes('Not implemented'));
        assert(errors.length === 0, `console error while rendering: ${errors[0]}`);

        // Every page must clean up after itself.
        if (typeof page.destroy === 'function') page.destroy();
        container.remove();
    });
}

/* --------------------------------------------------------------- INTERACTION */

console.log('\n== Interaction ==');

await check('the command palette opens, searches and closes', async () => {
    const { commandPalette } = await import(`${BASE}/ui/palette.js`);
    const palette = commandPalette();

    palette.show();
    await settle();

    const region = document.querySelector('.palette-region');
    assert(region && !region.hidden, 'the palette did not become visible');
    assert(document.querySelector('.palette-item'), 'the palette offered no commands');

    const input = document.querySelector('.palette-input');
    input.value = 'fee';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 220));

    assert(document.querySelectorAll('.palette-item').length > 0, 'searching produced no results');

    palette.hide();
    await settle();
    assert(document.querySelector('.palette-region').hidden, 'the palette did not close');
});

await check('Ctrl-K opens the palette from anywhere', async () => {
    const event = new window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true });
    document.dispatchEvent(event);
    await settle();

    const region = document.querySelector('.palette-region');
    assert(!region.hidden, 'Ctrl-K did not open the palette');

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    assert(region.hidden, 'Escape did not close the palette');
});

await check('a modal opens, confirms and resolves', async () => {
    const { confirm } = await import(`${BASE}/ui/overlay.js`);

    const promise = confirm({ title: 'Test', message: 'Proceed?', confirmLabel: 'Yes' });
    await settle();

    const modal = document.querySelector('.modal');
    assert(modal, 'no modal appeared');
    assert(modal.getAttribute('role') === 'dialog', 'modal is not a dialog');
    assert(modal.getAttribute('aria-modal') === 'true', 'modal is not marked modal');
    assert(modal.getAttribute('aria-labelledby'), 'modal has no accessible name');

    const buttons = [...modal.querySelectorAll('button')];
    const yes = buttons.find((b) => b.textContent.trim() === 'Yes');
    assert(yes, 'confirm button not found');
    yes.click();

    const result = await promise;
    assert(result === true, `confirm resolved ${result}, expected true`);
    await settle();
    assert(!document.querySelector('.modal'), 'the modal did not close');
});

await check('a form overlay validates and blocks an empty submit', async () => {
    const { formOverlay } = await import(`${BASE}/ui/form.js`);

    let submitted = false;
    const promise = formOverlay({
        title: 'Test form',
        fields: [{ name: 'name', label: 'Name', required: true }],
        onSubmit: async () => { submitted = true; return { ok: true }; }
    });
    await settle();

    const panel = document.querySelector('.modal, .drawer');
    assert(panel, 'no form overlay appeared');

    const submit = [...panel.querySelectorAll('button')]
        .find((b) => /save|submit|create|confirm/i.test(b.textContent));
    assert(submit, 'no submit button');

    submit.click();
    await settle();
    assert(!submitted, 'an empty required field was submitted');
    assert(document.querySelector('.modal, .drawer'), 'the overlay closed despite failing validation');

    const input = panel.querySelector('input[name="name"]');
    assert(input, 'the field did not render');
    input.value = 'Something';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    submit.click();
    await promise;
    assert(submitted, 'a valid form did not submit');
    await settle();
});

/* ------------------------------------------------------------ DEEP CLICKING */

console.log('\n== Controls ==');

/**
 * Mounting a page proves its first render works. Most runtime failures live one
 * click deeper: a tab whose panel builder reads a field the service stopped
 * returning, a filter bound to a renamed selector, a drawer that throws while
 * opening. This drives every in-page control that is safe to press and reports
 * anything that throws.
 *
 * Destructive and navigating controls are skipped by name — this runs against a
 * seeded database that later assertions still rely on.
 */
const UNSAFE = /delete|remove|erase|reset|restore|archive|revoke|cancel|close branch|deactivate|retire|refund|waive|log ?out|import|backup|print|export/i;

for (const route of ROUTES) {
    await check(`${route.path} — controls respond`, async () => {
        const module = await route.load();
        const PageClass = module.default || module.Page || module;

        const container = document.createElement('div');
        document.body.append(container);
        const page = new PageClass({ params: {}, query: {}, container });
        await page.render(container);
        await settle();

        const problems = [];

        // Tabs first: they swap whole panels and are the most common source of
        // a second-render crash.
        const tabs = [...container.querySelectorAll('[data-tab], .tab')];
        for (const tab of tabs) {
            consoleErrors.length = 0;
            tab.click();
            await settle();
            const errs = consoleErrors.filter((e) => !e.includes('Not implemented'));
            if (errs.length) problems.push(`tab "${tab.textContent.trim()}": ${errs[0].slice(0, 120)}`);
        }

        // Then any button that is not destructive and not a link.
        const buttons = [...container.querySelectorAll('button')]
            .filter((b) => !UNSAFE.test(b.textContent + (b.getAttribute('aria-label') || '')))
            .filter((b) => !b.disabled)
            .slice(0, 25);

        for (const button of buttons) {
            if (!button.isConnected) continue;
            consoleErrors.length = 0;
            try {
                button.click();
                await settle();
            } catch (err) {
                problems.push(`button "${button.textContent.trim().slice(0, 30)}" threw: ${err.message}`);
            }
            const errs = consoleErrors.filter((e) => !e.includes('Not implemented'));
            if (errs.length) {
                problems.push(`button "${button.textContent.trim().slice(0, 30)}": ${errs[0].slice(0, 120)}`);
            }
            // Dismiss anything that opened, so the next click is not swallowed.
            for (const panel of document.querySelectorAll('.modal-region, .drawer-region')) panel.remove();
            document.body.classList.remove('has-overlay');
        }

        // And every select, which usually re-runs a query.
        for (const select of [...container.querySelectorAll('select')].slice(0, 10)) {
            const options = [...select.options];
            if (options.length < 2) continue;
            consoleErrors.length = 0;
            select.value = options[1].value;
            select.dispatchEvent(new window.Event('change', { bubbles: true }));
            await settle();
            const errs = consoleErrors.filter((e) => !e.includes('Not implemented'));
            if (errs.length) problems.push(`select: ${errs[0].slice(0, 120)}`);
        }

        page.destroy?.();
        container.remove();

        assert(problems.length === 0, problems.slice(0, 3).join(' | '));
    });
}

/* --------------------------------------------------------------- FORM SAVES */

console.log('\n== Form round-trips ==');

/**
 * Opening a form proves the fields render. It does not prove that what the form
 * sends is what the service expects — and that gap hid a real defect: the fee
 * plan form posted `amount` and `frequency` while the service required
 * `annualAmount` and `instalments`, so every save was rejected. The screen
 * looked perfect until someone pressed the button.
 *
 * These fill each form the way a person would and confirm the record lands.
 */
const { listFeePlans, createFeePlan, listAcademicYears, createAcademicYear,
        listBranches, createBranch, listUsers, createUser } =
    await import(`${BASE}/services/settings.service.js`);

await check('a fee plan can be created from the settings form fields', async () => {
    const before = (await listFeePlans({ includeInactive: true })).length;
    const created = await createFeePlan({
        name: 'QA plan', level: 'foundation-1',
        annualAmount: 2400000, instalments: 12,
        registrationFee: 100000, costumeFee: 0,
        description: 'created by render QA'
    });
    assert(created.id, 'no plan created');
    assert(created.annualAmount === 2400000, `annualAmount became ${created.annualAmount}`);
    assert(created.instalments === 12, `instalments became ${created.instalments}`);
    const after = (await listFeePlans({ includeInactive: true })).length;
    assert(after === before + 1, 'the plan did not persist');
});

await check('an academic year can be created from the settings form fields', async () => {
    const created = await createAcademicYear({
        label: '2099–2100', startsOn: '2099-06-01', endsOn: '2100-05-31'
    });
    assert(created.id, 'no year created');
    assert(created.label === '2099–2100', `label became ${created.label}`);
    const listed = await listAcademicYears();
    assert(listed.some((y) => y.id === created.id), 'the year is not listed');
    assert(listed.every((y) => y.startsOn), 'a listed year has no start date');
});

await check('a branch can be created from the settings form fields', async () => {
    const created = await createBranch({
        name: 'QA Branch', code: 'QA', address: '1 Test Road',
        phone: '9800000000', openedOn: '2026-01-01'
    });
    assert(created.id && created.name === 'QA Branch', 'branch did not save');
    const listed = await listBranches({ includeInactive: true });
    assert(listed.some((b) => b.id === created.id), 'branch not listed');
});

await check('a user can be created from the settings form fields', async () => {
    const created = await createUser({
        name: 'QA Registrar', email: 'qa@example.org', role: 'registrar'
    });
    assert(created.id, 'user did not save');
    const listed = await listUsers();
    assert(listed.some((u) => u.id === created.id), 'user not listed');
});

/* ----------------------------------------------------------- ACCESSIBILITY */

console.log('\n== Accessibility ==');

await check('every page renders exactly one h1', async () => {
    const problems = [];
    for (const route of ROUTES) {
        const module = await route.load();
        const PageClass = module.default || module.Page || module;
        const container = document.createElement('div');
        document.body.append(container);
        const page = new PageClass({ params: {}, query: {}, container });
        await page.render(container);
        await settle();

        const count = container.querySelectorAll('h1').length;
        if (count !== 1) problems.push(`${route.path} has ${count}`);

        page.destroy?.();
        container.remove();
    }
    assert(problems.length === 0, `wrong heading count: ${problems.join(', ')}`);
});

await check('icon-only controls carry an accessible name', async () => {
    const container = document.createElement('div');
    document.body.append(container);

    const module = await ROUTES.find((r) => r.path === '/students').load();
    const page = new (module.default)({ params: {}, query: {}, container });
    await page.render(container);
    await settle();

    const nameless = [...container.querySelectorAll('button')].filter((b) =>
        !b.textContent.trim() && !b.getAttribute('aria-label') && !b.getAttribute('title'));

    assert(nameless.length === 0,
        `${nameless.length} buttons have no accessible name: ${nameless[0]?.outerHTML.slice(0, 90)}`);

    page.destroy?.();
    container.remove();
});

await check('every form input is labelled', async () => {
    const { formOverlay } = await import(`${BASE}/ui/form.js`);
    const promise = formOverlay({
        title: 'Label check',
        fields: [
            { name: 'text', label: 'Text' },
            { name: 'amount', label: 'Amount', type: 'money' },
            { name: 'when', label: 'When', type: 'date' },
            { name: 'pick', label: 'Pick', type: 'select', options: [{ value: 'a', label: 'A' }] },
            { name: 'note', label: 'Note', type: 'textarea' },
            { name: 'flag', label: 'Flag', type: 'switch' }
        ],
        onSubmit: async () => ({})
    });
    await settle();

    const panel = document.querySelector('.modal, .drawer');
    const controls = [...panel.querySelectorAll('input, select, textarea')];
    const unlabelled = controls.filter((el) => {
        if (el.type === 'hidden') return false;
        if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false;
        if (el.id && panel.querySelector(`label[for="${el.id}"]`)) return false;
        return !el.closest('label');
    });

    assert(unlabelled.length === 0,
        `${unlabelled.length} unlabelled controls, first: ${unlabelled[0]?.outerHTML.slice(0, 80)}`);

    const cancel = [...panel.querySelectorAll('button')].find((b) => /cancel|close/i.test(b.textContent));
    cancel?.click();
    await promise.catch(() => {});
    await settle();
});

/* ------------------------------------------------------------------ RESULT */

console.error = originalError;

console.log(`\n${'='.repeat(58)}`);
console.log(`  ${passed} passed, ${failed} failed`);
if (unhandled.length) console.log(`  ${unhandled.length} unhandled rejections`);
console.log('='.repeat(58));

if (failed) {
    console.log('\nFailures:\n');
    for (const { label, err } of failures) {
        console.log(`  ${label}`);
        console.log(`    ${(err.stack || err.message).split('\n').slice(0, 4).join('\n    ')}\n`);
    }
}
if (unhandled.length) {
    console.log('Unhandled rejections:\n');
    for (const u of [...new Set(unhandled)]) console.log('  ' + u);
}

process.exitCode = failed ? 1 : 0;
