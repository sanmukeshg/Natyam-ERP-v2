/**
 * Toasts.
 *
 * Rules this implementation enforces, because 1.0's did not:
 *   - Errors do not auto-dismiss. If a payment failed, the message must still
 *     be there when the user looks back at the screen.
 *   - Identical messages coalesce with a count instead of stacking eight deep.
 *   - Hovering pauses the timer. Reading a message should not make it vanish.
 *   - Everything is announced to assistive technology.
 *   - Content is set as text, never as markup.
 */

import { el, announce } from '../utils/dom.js';
import { icon } from './icons.js';

const ICONS = {
    success: 'check-circle',
    error:   'x-circle',
    warning: 'alert-triangle',
    info:    'info'
};

const DEFAULT_DURATION = { success: 4000, info: 5000, warning: 7000, error: 0 };

class ToastManager {
    constructor() {
        this.region = null;
        this.active = new Map(); // dedupe key -> { node, count, timer }
        this.max = 4;
    }

    _ensureRegion() {
        if (this.region?.isConnected) return this.region;
        this.region = el('div', {
            class: 'toast-region',
            role: 'region',
            'aria-label': 'Notifications'
        });
        document.body.append(this.region);
        return this.region;
    }

    /**
     * @param {object} options
     * @param {'success'|'error'|'warning'|'info'} options.type
     * @param {string} options.title     Short, in the interface's voice.
     * @param {string} [options.message] One sentence of detail, optional.
     * @param {number} [options.duration] ms; 0 keeps it until dismissed.
     * @param {{label:string, onClick:Function}} [options.action]
     */
    show({ type = 'info', title, message = '', duration, action = null }) {
        const region = this._ensureRegion();
        const key = `${type}|${title}|${message}`;

        // Same message again: bump a counter rather than adding another card.
        const existing = this.active.get(key);
        if (existing) {
            existing.count += 1;
            const counter = existing.node.querySelector('.toast-repeat');
            if (counter) counter.textContent = `×${existing.count}`;
            else existing.node.querySelector('.toast-title')
                ?.append(el('span', { class: 'toast-repeat text-subtle' }, ` ×${existing.count}`));
            this._resetTimer(key, duration ?? DEFAULT_DURATION[type]);
            return () => this.dismiss(key);
        }

        // Cap the stack. The oldest non-error goes first; errors are sticky by
        // intent and should not be evicted by a run of routine successes.
        if (this.active.size >= this.max) {
            const evictable = [...this.active.entries()].find(([, v]) => v.type !== 'error');
            if (evictable) this.dismiss(evictable[0]);
        }

        const node = el('div', {
            class: `toast toast-${type}`,
            role: type === 'error' ? 'alert' : 'status',
            'aria-live': type === 'error' ? 'assertive' : 'polite'
        });

        const glyph = el('span', { class: 'toast-icon' });
        glyph.innerHTML = icon(ICONS[type] || 'info', { size: 17, className: '' });

        const content = el('div', { class: 'toast-content' },
            el('div', { class: 'toast-title' }, title)
        );
        if (message) content.append(el('div', { class: 'toast-message' }, message));

        if (action) {
            const button = el('button', {
                type: 'button',
                class: 'btn btn-sm btn-secondary toast-action',
                onClick: () => { action.onClick(); this.dismiss(key); }
            }, action.label);
            content.append(button);
        }

        const close = el('button', {
            type: 'button',
            class: 'btn btn-ghost btn-icon btn-sm',
            'aria-label': 'Dismiss notification',
            onClick: () => this.dismiss(key)
        });
        close.innerHTML = icon('x', { size: 14 });

        node.append(glyph, content, close);

        // Pausing on hover or focus means a long message can actually be read.
        node.addEventListener('mouseenter', () => this._pause(key));
        node.addEventListener('mouseleave', () => this._resume(key, duration ?? DEFAULT_DURATION[type]));
        node.addEventListener('focusin', () => this._pause(key));

        region.append(node);
        this.active.set(key, { node, type, count: 1, timer: null });
        this._resetTimer(key, duration ?? DEFAULT_DURATION[type]);

        announce(message ? `${title}. ${message}` : title, type === 'error');
        return () => this.dismiss(key);
    }

    _resetTimer(key, duration) {
        const entry = this.active.get(key);
        if (!entry) return;
        clearTimeout(entry.timer);
        if (duration > 0) entry.timer = setTimeout(() => this.dismiss(key), duration);
    }

    _pause(key) {
        const entry = this.active.get(key);
        if (entry) clearTimeout(entry.timer);
    }

    _resume(key, duration) {
        this._resetTimer(key, duration);
    }

    dismiss(key) {
        const entry = this.active.get(key);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.active.delete(key);

        entry.node.dataset.leaving = 'true';
        entry.node.addEventListener('animationend', () => entry.node.remove(), { once: true });
        // Belt and braces: if the animation is suppressed by reduced-motion,
        // animationend may not fire.
        setTimeout(() => entry.node.remove(), 400);
    }

    clear() {
        for (const key of [...this.active.keys()]) this.dismiss(key);
    }
}

const manager = new ToastManager();

export const toast = {
    success: (title, message, options = {}) => manager.show({ type: 'success', title, message, ...options }),
    error:   (title, message, options = {}) => manager.show({ type: 'error', title, message, ...options }),
    warning: (title, message, options = {}) => manager.show({ type: 'warning', title, message, ...options }),
    info:    (title, message, options = {}) => manager.show({ type: 'info', title, message, ...options }),

    /**
     * Wraps an async action with pending/success/error toasts. Keeps the
     * three-branch pattern out of every call site.
     */
    async promise(work, { pending = 'Working…', success = 'Done', error = 'That did not work' }) {
        const dismiss = manager.show({ type: 'info', title: pending, duration: 0 });
        try {
            const result = await work;
            dismiss();
            manager.show({ type: 'success', title: typeof success === 'function' ? success(result) : success });
            return result;
        } catch (err) {
            dismiss();
            manager.show({
                type: 'error',
                title: typeof error === 'function' ? error(err) : error,
                message: err.message
            });
            throw err;
        }
    },

    clear: () => manager.clear()
};
