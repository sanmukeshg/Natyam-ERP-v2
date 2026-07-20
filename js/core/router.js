/**
 * NATYAM ERP 2.0 — Router
 *
 * Hash-based, because the deployment target is GitHub Pages: there is no server
 * to rewrite deep links, so `/students/STU-123` would 404 on refresh while
 * `#/students/STU-123` will not.
 *
 * Over 1.0 this adds:
 *   - Lazy module loading. A page is downloaded and parsed the first time it is
 *     opened, not on boot. Boot goes from "parse every module" to "parse the
 *     shell and the dashboard".
 *   - Path parameters and query strings, so a student detail view is a real
 *     URL that can be bookmarked and shared between tabs.
 *   - Guards, so an unauthorised route redirects rather than rendering and then
 *     erroring.
 *   - Deterministic teardown, and cancellation of a navigation the user has
 *     already moved on from.
 */

import { bus, EVENTS } from './bus.js';
import { session } from './session.js';
import { html, render } from '../utils/dom.js';
import { icon } from '../ui/icons.js';

class Router {
    constructor() {
        this.routes = [];
        this.viewport = null;
        this.current = null;
        this.currentPage = null;
        this.navigationId = 0;
        this.scrollPositions = new Map();
        this.notFound = null;
    }

    /**
     * @param {string} pattern  e.g. '/students' or '/students/:id'
     * @param {object} options
     * @param {Function} options.load       Dynamic import returning { default } or a page factory.
     * @param {string}  [options.cap]       Capability required to enter.
     * @param {string}  [options.title]
     */
    register(pattern, options) {
        this.routes.push({ pattern, ...options, matcher: compile(pattern) });
        return this;
    }

    mount(viewport) {
        this.viewport = viewport;
        window.addEventListener('hashchange', () => this.resolve());
        return this;
    }

    /** Programmatic navigation. `replace` avoids polluting history on redirect. */
    go(path, { replace = false } = {}) {
        const target = `#${path.startsWith('/') ? path : `/${path}`}`;
        if (window.location.hash === target) return this.resolve();
        if (replace) window.location.replace(target);
        else window.location.hash = target;
        return undefined;
    }

    start() {
        if (!window.location.hash) window.location.replace('#/');
        return this.resolve();
    }

    /** Current path without the query string. */
    path() {
        return (window.location.hash.slice(1) || '/').split('?')[0];
    }

    async resolve() {
        const raw = window.location.hash.slice(1) || '/';
        const [path, queryString = ''] = raw.split('?');
        const query = Object.fromEntries(new URLSearchParams(queryString));

        // A second navigation while the first is still awaiting its import must
        // win. Without this, a fast double-click renders the older page last.
        this.navigationId += 1;
        const navigation = this.navigationId;

        if (this.current) this.scrollPositions.set(this.current, window.scrollY);

        bus.emit(EVENTS.ROUTE_START, { path, query });

        const match = this.match(path);

        if (!match) {
            this.teardown();
            this.current = path;
            this.renderNotFound(path);
            bus.emit(EVENTS.ROUTE_DONE, { path, query, found: false });
            return;
        }

        if (match.route.cap && !session.can(match.route.cap)) {
            this.teardown();
            this.current = path;
            this.renderDenied(match.route);
            bus.emit(EVENTS.ROUTE_DONE, { path, query, denied: true });
            return;
        }

        this.renderLoading();

        let PageClass;
        try {
            const loaded = await match.route.load();
            if (navigation !== this.navigationId) return; // superseded
            PageClass = loaded.default || loaded.Page || loaded;
        } catch (err) {
            console.error('Failed to load module for', path, err);
            if (navigation !== this.navigationId) return;
            this.renderLoadFailure(path, err);
            bus.emit(EVENTS.ROUTE_FAILED, { path, error: err });
            return;
        }

        this.teardown();

        const context = { path, params: match.params, query, router: this };

        try {
            const page = typeof PageClass === 'function' && PageClass.prototype?.render
                ? new PageClass(context)
                : PageClass(context);

            this.currentPage = page;
            this.current = path;

            await page.render(this.viewport, context);
            if (navigation !== this.navigationId) return;

            document.title = `${match.route.title || page.title || 'Natyam'} — Natyam ERP`;

            // Restore the list position when coming back from a detail view;
            // otherwise start at the top.
            const remembered = this.scrollPositions.get(path);
            window.scrollTo?.({ top: remembered ?? 0, behavior: 'instant' });

            // Move focus to the new page region so a keyboard or screen-reader
            // user is not left at the bottom of the previous page's DOM.
            this.viewport.focus?.();

            bus.emit(EVENTS.ROUTE_DONE, { path, query, params: match.params });
        } catch (err) {
            console.error('Route render failed:', path, err);
            if (navigation !== this.navigationId) return;
            this.renderError(err);
            bus.emit(EVENTS.ROUTE_FAILED, { path, error: err });
        }
    }

    match(path) {
        for (const route of this.routes) {
            const params = route.matcher(path);
            if (params) return { route, params };
        }
        return null;
    }

    teardown() {
        if (this.currentPage?.destroy) {
            try { this.currentPage.destroy(); } catch (err) { console.error('destroy failed', err); }
        }
        this.currentPage = null;
    }

    /* -------------------------------------------------------- FALLBACK VIEWS */

    renderLoading() {
        render(this.viewport, html`
            <div class="page-header">
                <div class="page-header-text">
                    <div class="skeleton skeleton-title" style="width:200px;height:22px"></div>
                </div>
            </div>
            <div class="page-body">
                <div class="grid grid-4">
                    ${[1, 2, 3, 4].map(() => html`<div class="skeleton skeleton-kpi"></div>`)}
                </div>
                <div class="skeleton skeleton-chart"></div>
            </div>
        `);
    }

    renderNotFound(path) {
        render(this.viewport, html`
            <div class="page-body">
                <div class="card"><div class="card-body">
                    <div class="empty">
                        <div class="empty-glyph">${icon('compass')}</div>
                        <h2 class="empty-title">There is no page at ${path}</h2>
                        <p class="empty-text">The link may be from an older version of Natyam ERP,
                        or the record it pointed to has been removed.</p>
                        <div class="empty-actions">
                            <a class="btn btn-primary" href="#/">Go to dashboard</a>
                        </div>
                    </div>
                </div></div>
            </div>
        `);
    }

    renderDenied(route) {
        render(this.viewport, html`
            <div class="page-body">
                <div class="card"><div class="card-body">
                    <div class="empty">
                        <div class="empty-glyph">${icon('lock')}</div>
                        <h2 class="empty-title">${route.title || 'This module'} is not available to your role</h2>
                        <p class="empty-text">You are signed in as ${session.roleLabel()}.
                        An owner or administrator can grant access in Settings → Roles.</p>
                        <div class="empty-actions">
                            <a class="btn btn-secondary" href="#/">Back to dashboard</a>
                        </div>
                    </div>
                </div></div>
            </div>
        `);
    }

    renderLoadFailure(path, err) {
        render(this.viewport, html`
            <div class="page-body">
                <div class="card"><div class="card-body">
                    <div class="empty">
                        <div class="empty-glyph">${icon('cloud-off')}</div>
                        <h2 class="empty-title">This module could not be loaded</h2>
                        <p class="empty-text">Natyam ERP loads each module the first time you open it.
                        This one did not arrive — usually because the app files are still downloading,
                        or the browser cache holds a partial copy.</p>
                        <p class="type-mono type-caption">${err.message}</p>
                        <div class="empty-actions">
                            <button class="btn btn-primary" onclick="location.reload()">Reload the app</button>
                            <a class="btn btn-secondary" href="#/">Back to dashboard</a>
                        </div>
                    </div>
                </div></div>
            </div>
        `);
    }

    renderError(err) {
        render(this.viewport, html`
            <div class="page-body">
                <div class="card"><div class="card-body">
                    <div class="empty">
                        <div class="empty-glyph">${icon('alert-triangle')}</div>
                        <h2 class="empty-title">This page hit an error</h2>
                        <p class="empty-text">Your data is unaffected — nothing was written.</p>
                        <p class="type-mono type-caption">${err.message}</p>
                        <div class="empty-actions">
                            <button class="btn btn-primary" onclick="location.reload()">Reload</button>
                        </div>
                    </div>
                </div></div>
            </div>
        `);
    }
}

/**
 * Compiles '/students/:id' into a matcher returning { id } or null.
 * Deliberately tiny: this app has fewer than thirty routes and none of them
 * need optional segments or wildcards.
 */
function compile(pattern) {
    const segments = pattern.split('/').filter(Boolean);

    return (path) => {
        const parts = path.split('/').filter(Boolean);
        if (parts.length !== segments.length) return null;

        const params = {};
        for (let i = 0; i < segments.length; i += 1) {
            const segment = segments[i];
            if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(parts[i]);
            else if (segment !== parts[i]) return null;
        }
        return params;
    };
}

export const router = new Router();

/**
 * Base class for pages. Provides a disposal scope so a page can subscribe to
 * events and attach delegated listeners without having to remember to remove
 * each one — `destroy()` handles all of them.
 */
export class Page {
    constructor(context = {}) {
        this.context = context;
        this.params = context.params || {};
        this.query = context.query || {};
        this.events = bus.scope();
        this.disposers = [];
        this.container = null;
    }

    /** Registers a teardown function. */
    onDispose(fn) { this.disposers.push(fn); }

    async render(_container) {
        throw new Error('Page subclasses must implement render()');
    }

    destroy() {
        this.events.dispose();
        this.disposers.forEach((fn) => {
            try { fn(); } catch (err) { console.error('disposer failed', err); }
        });
        this.disposers.length = 0;
    }
}
