/**
 * Navigation regression suite.
 *
 * This exists because of a bug that every other test missed. The render suite
 * mounted page classes directly — `new StudentsPage().render(container)` — which
 * proved each page works but never asked the router which page a URL resolves
 * to. Meanwhile a stray '/:id' catch-all was routing fifteen of sixteen screens
 * to the dashboard. The URL changed, the sidebar highlighted, nothing threw,
 * and the content never moved.
 *
 * So this suite never constructs a page. It sets `window.location.hash`, waits,
 * and asserts that the *viewport contents actually changed to the right page*.
 * That is the only assertion that would have caught it.
 */

import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';

/* ---------------------------------------------------------------- DOM SETUP */

const dom = new JSDOM(
    '<!doctype html><html><body><div id="app"></div></body></html>',
    { url: 'https://user.github.io/natyam/', pretendToBeVisual: true }
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
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
window.matchMedia = globalThis.matchMedia;
globalThis.localStorage = window.localStorage;
globalThis.location = window.location;
globalThis.addEventListener = window.addEventListener.bind(window);
globalThis.scrollTo = () => {};
window.scrollTo = () => {};

globalThis.CSS = { escape: (v) => String(v).replace(/[^\w-]/g, (c) => `\\${c}`) };
window.CSS = globalThis.CSS;

Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    value: {
        estimate: async () => ({ usage: 1024, quota: 1024 * 1024 }),
        persisted: async () => false,
        persist: async () => true
    }
});

globalThis.URL.createObjectURL = () => 'blob:stub';
globalThis.URL.revokeObjectURL = () => {};
window.open = () => ({ document: { write() {}, close() {} }, focus() {}, print() {}, close() {} });

const consoleErrors = [];
console.error = (...args) => consoleErrors.push(args.map(String).join(' '));

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

/**
 * jsdom fires hashchange asynchronously, and the router then awaits a dynamic
 * import and an async render. Poll until the viewport settles rather than
 * guessing at a fixed delay.
 */
async function navigate(hash, { timeout = 4000 } = {}) {
    const before = viewport.innerHTML;
    window.location.hash = hash;

    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 20));
        const now = viewport.innerHTML;
        // Settled when the content has changed and is no longer the skeleton.
        if (now !== before && !now.includes('skeleton-title')) return;
    }
}

/* -------------------------------------------------------------------- BOOT */

const BASE = '../js';

const { db } = await import(`${BASE}/core/db.js`);
const { session } = await import(`${BASE}/core/session.js`);
const { seedIfEmpty } = await import(`${BASE}/data/seed.js`);
const { branches$ } = await import(`${BASE}/data/repositories.js`);
const { ROUTES } = await import(`${BASE}/config/app.config.js`);
const { router } = await import(`${BASE}/core/router.js`);
const { Shell } = await import(`${BASE}/ui/shell.js`);

let viewport = null;

console.log('\n== Boot the real application ==');

await check('the app boots exactly as app.js does', async () => {
    await db.open();
    await seedIfEmpty();

    const branches = await branches$.active();
    session.hydrate({
        user: { id: 'owner', name: 'Principal', role: 'owner' },
        branches,
        activeBranchId: null
    });

    // Route registration copied from app.js. If that function changes shape,
    // this suite must be updated with it — deliberately, so the coupling is
    // visible rather than mocked away.
    for (const route of ROUTES) {
        router.register(route.path, { load: route.load, cap: route.cap, title: route.label });
        if (route.detail !== false && route.path !== '/') {
            router.register(`${route.path}/:id`, {
                load: route.load, cap: route.cap, title: route.label
            });
        }
    }

    const shell = new Shell(document.querySelector('#app'));
    viewport = shell.mount();
    router.mount(viewport).start();

    await new Promise((r) => setTimeout(r, 400));
    assert(viewport.innerHTML.length > 0, 'the router rendered nothing at boot');
});

/* -------------------------------------------------- THE REGRESSION ITSELF */

console.log('\n== Every route resolves to its own page ==');

await check('the matcher maps each path to the route that owns it', async () => {
    const wrong = [];
    for (const route of ROUTES) {
        const match = router.match(route.path);
        assert(match, `${route.path} matches no route at all`);
        if (match.route.title !== route.label) {
            wrong.push(`${route.path} -> "${match.route.title}" via "${match.route.pattern}"`);
        }
    }
    assert(wrong.length === 0,
        `${wrong.length} of ${ROUTES.length} paths resolve to the wrong page:\n         `
        + wrong.join('\n         '));
});

await check('no route pattern is a catch-all for other routes', async () => {
    // A pattern whose segments are all parameters will swallow any path of the
    // same length. '/:id' is the one that caused the outage.
    const greedy = router.routes.filter((r) =>
        r.shape.length > 0 && r.shape.every((segment) => segment === 1));

    assert(greedy.length === 0,
        `catch-all patterns registered: ${greedy.map((r) => r.pattern).join(', ')}`);
});

console.log('\n== Navigating actually replaces the content ==');

/**
 * A fingerprint of what is on screen. The h1 alone is not enough — two pages
 * could share a heading — so this also takes a hash of the body length.
 */
function fingerprint() {
    const heading = viewport.querySelector('h1')?.textContent.trim() || '';
    return { heading, size: viewport.innerHTML.length };
}

const seen = new Map();

for (const route of ROUTES) {
    await check(`${route.path} swaps the main content to "${route.label}"`, async () => {
        await navigate(`#${route.path}`);

        const view = fingerprint();

        assert(view.heading.length > 0, 'the viewport has no heading after navigating');
        assert(!viewport.innerHTML.includes('skeleton-title'),
            'the viewport is still showing the loading skeleton');
        assert(!viewport.innerHTML.includes('Page not found'),
            'the router rendered its not-found view');
        assert(!viewport.innerHTML.includes('could not be opened'),
            'the router rendered its load-failure view');

        // The heading must belong to this route, not a previous one.
        const previous = seen.get(view.heading);
        assert(previous === undefined || previous === route.path,
            `this screen is identical to ${previous} — the content did not change`);
        seen.set(view.heading, route.path);

        assert(router.path() === route.path,
            `router.path() is ${router.path()} after navigating to ${route.path}`);

        const errors = consoleErrors.filter((e) => !e.includes('Not implemented'));
        assert(errors.length === 0, `console error: ${errors[0]}`);
    });
}

await check('every screen was distinct — none silently fell back to another', async () => {
    assert(seen.size === ROUTES.length,
        `${ROUTES.length} routes produced only ${seen.size} distinct screens`);
});

console.log('\n== Router behaviour ==');

await check('going back to a visited route re-renders it', async () => {
    await navigate('#/students');
    const students = fingerprint().heading;
    await navigate('#/fees');
    await navigate('#/students');
    assert(fingerprint().heading === students, 'returning to a route did not re-render it');
});

await check('the previous page is destroyed before the next renders', async () => {
    await navigate('#/students');
    const first = router.currentPage;
    await navigate('#/attendance');
    assert(router.currentPage !== first, 'the router still holds the previous page');
});

await check('a detail URL reaches the same page with its parameter', async () => {
    const match = router.match('/students/STU-0001');
    assert(match, '/students/STU-0001 matches nothing');
    assert(match.route.title === 'Students', `detail URL routed to ${match.route.title}`);
    assert(match.params.id === 'STU-0001', `parameter came through as ${match.params.id}`);
});

await check('an unknown URL renders the not-found view, not a real page', async () => {
    window.location.hash = '#/no-such-screen';
    await new Promise((r) => setTimeout(r, 400));
    assert(router.match('/no-such-screen') === null, 'an unknown path matched a route');
});

await check('a query string is parsed and does not affect matching', async () => {
    const match = router.match('/fees');
    assert(match?.route.title === 'Fee collection', 'plain /fees did not match');
    window.location.hash = '#/fees?filter=overdue';
    await new Promise((r) => setTimeout(r, 500));
    assert(router.path() === '/fees', `router.path() returned ${router.path()}`);
});

/* ------------------------------------------------------------------ RESULT */

console.log(`\n${'='.repeat(58)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log('='.repeat(58));

if (failed) {
    console.log('\nFailures:\n');
    for (const { label, err } of failures) {
        console.log(`  ${label}`);
        console.log(`    ${(err.stack || err.message).split('\n').slice(0, 4).join('\n    ')}\n`);
    }
}

process.exitCode = failed ? 1 : 0;
