/**
 * DOM utilities.
 *
 * The central idea here is the `html` tagged template. In 1.0, templates built
 * strings with plain interpolation and it was left to each author to remember
 * `escapeHtml()` on every value. They did not, consistently. With `html`,
 * escaping is the default and passing raw markup requires the explicit `raw()`
 * marker — the safe path is the shortest one.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Wrapper marking a string as already-safe markup. */
class RawHtml {
    constructor(value) { this.value = value; }
    toString() { return this.value; }
}

export function raw(value) { return new RawHtml(value); }

/**
 * Tagged template that escapes every interpolated value unless it is marked
 * raw(). Arrays are joined, so `${items.map(row)}` works without `.join('')`.
 * null, undefined and false render as nothing, so `${cond && html`…`}` works.
 */
export function html(strings, ...values) {
    let out = strings[0];
    for (let i = 0; i < values.length; i += 1) {
        out += serialise(values[i]) + strings[i + 1];
    }
    return raw(out);
}

function serialise(value) {
    if (value === null || value === undefined || value === false || value === true) return '';
    if (value instanceof RawHtml) return value.value;
    if (Array.isArray(value)) return value.map(serialise).join('');
    return escapeHtml(value);
}

/** Renders an html`` result into a container. */
export function render(container, content) {
    container.innerHTML = content instanceof RawHtml ? content.value : escapeHtml(content);
    return container;
}

/* ------------------------------------------------------------- SELECTION */

export const $  = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

/** Creates an element with attributes and children in one call. */
export function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
        else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
        if (child === null || child === undefined || child === false) continue;
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
}

/* ------------------------------------------------------------------ EVENTS */

/**
 * Delegated listener. One listener on a container handles every current and
 * future match, so re-rendering a table of 80 rows does not mean attaching and
 * detaching 240 listeners.
 *
 * Returns a disposer.
 */
export function on(container, eventName, selector, handler, options) {
    const listener = (event) => {
        const target = event.target.closest(selector);
        if (target && container.contains(target)) handler(event, target);
    };
    container.addEventListener(eventName, listener, options);
    return () => container.removeEventListener(eventName, listener, options);
}

/** Collects a form into a plain object, trimming strings. */
export function formData(form) {
    const out = {};
    for (const [key, value] of new FormData(form).entries()) {
        const trimmed = typeof value === 'string' ? value.trim() : value;
        if (key in out) {
            out[key] = Array.isArray(out[key]) ? [...out[key], trimmed] : [out[key], trimmed];
        } else {
            out[key] = trimmed;
        }
    }
    // FormData omits unchecked boxes entirely; represent them explicitly so a
    // "false" is a value rather than an absence.
    for (const box of form.querySelectorAll('input[type="checkbox"][name]')) {
        if (!(box.name in out)) out[box.name] = false;
        else if (out[box.name] === 'on') out[box.name] = true;
    }
    return out;
}

/* ------------------------------------------------------------- ACCESSIBILITY */

const FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])'
].join(',');

/**
 * Confines Tab within a container and restores focus on release. Required for
 * any modal or drawer; 1.0's modal had no trap, so tabbing out of a dialog
 * landed the user on the page behind it with no visible cue.
 */
export function trapFocus(container) {
    const previous = document.activeElement;

    const onKeydown = (event) => {
        if (event.key !== 'Tab') return;
        const items = $$(FOCUSABLE, container).filter((n) => n.offsetParent !== null);
        if (!items.length) return;

        const first = items[0];
        const last = items[items.length - 1];

        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };

    container.addEventListener('keydown', onKeydown);

    // Prefer the first real control; fall back to the container so the screen
    // reader announces the dialog rather than staying on the trigger.
    const target = $$(FOCUSABLE, container).find((n) => !n.hasAttribute('data-autofocus-skip'));
    (target || container).focus?.();

    return () => {
        container.removeEventListener('keydown', onKeydown);
        if (previous?.isConnected) previous.focus();
    };
}

/** Announces a message to screen readers without moving focus. */
let liveRegion = null;
export function announce(message, assertive = false) {
    if (!liveRegion) {
        liveRegion = el('div', { class: 'sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' });
        document.body.append(liveRegion);
    }
    liveRegion.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
    liveRegion.textContent = '';
    // A same-value reassignment is ignored by assistive tech; the tick forces it.
    requestAnimationFrame(() => { liveRegion.textContent = message; });
}

/** Prevents background scroll while an overlay is open, without layout shift. */
let scrollLocks = 0;
export function lockScroll() {
    scrollLocks += 1;
    if (scrollLocks > 1) return () => releaseScroll();
    const gap = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;
    return () => releaseScroll();
}

function releaseScroll() {
    scrollLocks = Math.max(0, scrollLocks - 1);
    if (scrollLocks === 0) {
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
    }
}

/* -------------------------------------------------------------- SCHEDULING */

export function debounce(fn, wait = 220) {
    let timer;
    const wrapped = (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
    wrapped.cancel = () => clearTimeout(timer);
    return wrapped;
}

export function throttle(fn, interval = 120) {
    let last = 0;
    let pending = null;
    return (...args) => {
        const now = Date.now();
        if (now - last >= interval) {
            last = now;
            fn(...args);
        } else {
            clearTimeout(pending);
            pending = setTimeout(() => { last = Date.now(); fn(...args); }, interval - (now - last));
        }
    };
}

/** Highlights a matched substring for search results. Escapes around the mark. */
export function highlight(text, term) {
    const source = String(text || '');
    const needle = String(term || '').trim();
    if (!needle) return raw(escapeHtml(source));

    const index = source.toLowerCase().indexOf(needle.toLowerCase());
    if (index < 0) return raw(escapeHtml(source));

    return raw(
        escapeHtml(source.slice(0, index)) +
        `<mark>${escapeHtml(source.slice(index, index + needle.length))}</mark>` +
        escapeHtml(source.slice(index + needle.length))
    );
}

/** Triggers a client-side file download. Used by every export. */
export function downloadFile(filename, content, mime = 'text/plain') {
    const blob = content instanceof Blob ? content : new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Initials for an avatar. Two copies of this existed — one in the shell, one in
 * the students page — and they disagreed on capitalisation for single-word
 * names, so the same person's avatar differed between the sidebar and the roll.
 */
export function initials(name) {
    return String(name || '?')
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() || '')
        .join('');
}
