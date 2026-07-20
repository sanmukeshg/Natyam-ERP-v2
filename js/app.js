/**
 * NATYAM ERP 2.0 — Bootstrap
 *
 * Start-up in a fixed order, because each step depends on the last:
 *
 *   1. Paint the theme before anything else. Reading the preference from
 *      localStorage is synchronous, so the first frame is already correct;
 *      waiting for IndexedDB here produces a white flash then a dark app.
 *   2. Open the database and run migrations.
 *   3. Seed if empty, so a fresh install is a working school rather than a
 *      set of empty tables with no way in.
 *   4. Hydrate the session — who is using this, which branches exist.
 *   5. Mount the shell and router, and show the first screen.
 *   6. *Then* run maintenance: sweeping overdue invoices and recomputing
 *      alerts. These are deliberately last and deliberately not awaited by
 *      the render path; the school should see its dashboard immediately, not
 *      wait on a sweep of last term's invoices.
 *
 * Anything that fails during 2–4 is fatal and gets an honest screen with the
 * actual error, because "something went wrong" in an offline app with no
 * telemetry leaves the user with nothing to tell anyone.
 */

import { db } from './core/db.js';
import { session } from './core/session.js';
import { router } from './core/router.js';
import { bus, EVENTS } from './core/bus.js';
import { ROUTES } from './config/app.config.js';
import { Shell, applyTheme, applyDensity } from './ui/shell.js';
import { commandPalette } from './ui/palette.js';
import { toast } from './ui/toast.js';
import { seedIfEmpty } from './data/seed.js';
import { branches$, drafts$, notifications$ } from './data/repositories.js';
import { sweepOverdue } from './services/fees.service.js';
import { refreshAlerts } from './services/notifications.service.js';

async function boot() {
    const prefs = session.prefs();
    applyTheme(prefs.theme);
    applyDensity(prefs.density);

    try {
        await db.open();
        await seedIfEmpty();
        await hydrateSession();
    } catch (err) {
        console.error('Start-up failed', err);
        showFatal(err);
        return;
    }

    const root = document.querySelector('#app');
    const shell = new Shell(root);
    const viewport = shell.mount();

    commandPalette();               // registers Ctrl-K for the life of the app
    registerRoutes();
    router.mount(viewport).start();

    document.querySelector('#boot')?.remove();
    bus.emit(EVENTS.APP_READY);

    // Preferences can change on any screen; the shell is the only thing that
    // needs to react, so it is handled once here rather than in every page.
    bus.on(EVENTS.PREFS_CHANGED, ({ key, value }) => {
        if (key === 'theme') applyTheme(value);
        if (key === 'density') applyDensity(value);
    });

    maintenance();
}

function registerRoutes() {
    for (const route of ROUTES) {
        router.register(route.path, {
            load: route.load,
            cap: route.cap,
            title: route.label
        });

        // Detail routes are registered alongside their list route so a page can
        // own both /students and /students/:id without a second config entry.
        if (route.detail !== false) {
            router.register(`${route.path === '/' ? '' : route.path}/:id`, {
                load: route.load,
                cap: route.cap,
                title: route.label
            });
        }
    }
}

async function hydrateSession() {
    const branches = await branches$.active();

    // There is no login. This is a single-tenant app running on the school's
    // own machine, and inventing a password screen with no server to verify it
    // would be security theatre. The "user" is the operating convention that
    // decides which screens are shown; the device login is the real boundary.
    // session.hydrate remembers the previously selected branch itself, so no
    // branch id is passed here — passing one would override the user's choice
    // on every reload.
    session.hydrate({
        user: { id: 'owner', name: 'Principal', role: 'owner' },
        branches,
        activeBranchId: null
    });
}

/**
 * Housekeeping that must happen but must not delay the first paint. Each step
 * is isolated: a failure to prune drafts should not stop overdue invoices from
 * being marked.
 */
async function maintenance() {
    const tasks = [
        ['sweeping overdue invoices', () => sweepOverdue()],
        ['recomputing alerts', () => refreshAlerts({ branchId: session.branch() })],
        ['pruning old drafts', () => drafts$.prune?.(30)],
        ['pruning notifications', () => notifications$.prune?.(200)]
    ];

    for (const [what, run] of tasks) {
        try {
            await run();
        } catch (err) {
            console.warn(`Maintenance step failed while ${what}`, err);
        }
    }
}

function showFatal(err) {
    const root = document.querySelector('#app') || document.body;
    root.innerHTML = `
        <div class="fatal">
            <h1>NATYAM could not start</h1>
            <p>The school's database could not be opened in this browser.</p>
            <pre>${String(err?.message || err)}</pre>
            <p class="type-caption">
                This usually means the browser is in private mode, storage is
                full, or the site is open in another tab performing an upgrade.
                Close other tabs and reload. If you have a backup file, a fresh
                browser profile can be restored from it.
            </p>
            <button onclick="location.reload()">Reload</button>
        </div>
    `;
}

/* Unhandled failures anywhere in the app surface as a toast rather than a
   silent console entry nobody in a dance school will ever open. */
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection', event.reason);
    toast?.error?.(event.reason?.message || 'Something failed unexpectedly.');
});

boot();
