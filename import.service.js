/**
 * Overlays: modals, drawers, confirmation dialogs.
 *
 * One implementation serving both, because the behaviour is identical and only
 * the presentation differs — a modal is centred, a drawer is edged.
 *
 * Behaviour 1.0 lacked:
 *   - Focus is trapped and restored to the trigger on close.
 *   - Background scroll is locked without the layout shifting.
 *   - Overlays stack; Escape closes only the topmost.
 *   - A submitting action disables the footer so a double-click cannot record
 *     a payment twice. That specific bug is the reason this is not optional.
 *   - The dialog is properly labelled for assistive technology.
 */

import { el, trapFocus, lockScroll, html, render } from '../utils/dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';

const stack = [];

function closeTop() {
    const top = stack[stack.length - 1];
    if (top?.dismissible) top.close(null);
}

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && stack.length) {
        event.stopPropagation();
        closeTop();
    }
});

/**
 * Core overlay. Returns a promise that resolves with whatever the closing
 * action passed — so `const saved = await modal({...})` reads naturally.
 *
 * @param {object} options
 * @param {'modal'|'drawer'} [options.variant='modal']
 * @param {string} options.title
 * @param {string} [options.description]
 * @param {string|object} options.content   html`` result or an HTMLElement.
 * @param {'sm'|'md'|'lg'|'xl'|'wide'} [options.size='md']
 * @param {Array} [options.actions]  [{ label, variant, value, onClick, primary }]
 * @param {boolean} [options.dismissible=true]
 * @param {Function} [options.onMount]  Receives the body element.
 */
export function overlay({
    variant = 'modal',
    title,
    description = '',
    content = '',
    size = 'md',
    actions = [],
    dismissible = true,
    onMount = null
} = {}) {
    return new Promise((resolve) => {
        const titleId = `ov-title-${Math.random().toString(36).slice(2, 8)}`;
        const descId = `${titleId}-desc`;

        const region = el('div', {
            class: variant === 'drawer' ? 'drawer-region' : 'modal-region'
        });

        const panel = el('div', {
            class: variant === 'drawer'
                ? `drawer ${size === 'wide' ? 'drawer-wide' : ''}`
                : `modal ${size !== 'md' ? `modal-${size}` : ''}`,
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': titleId,
            ...(description ? { 'aria-describedby': descId } : {})
        });

        /* Header */
        const heading = el('div', { class: variant === 'drawer' ? 'drawer-header' : 'modal-header' });
        const headingText = el('div', {},
            el('h2', { class: 'modal-title', id: titleId }, title)
        );
        if (description) {
            headingText.append(el('p', { class: 'modal-description', id: descId }, description));
        }
        heading.append(headingText);

        if (dismissible) {
            const closeBtn = el('button', {
                type: 'button',
                class: 'btn btn-ghost btn-icon btn-sm',
                'aria-label': 'Close'
            });
            closeBtn.innerHTML = icon('x', { size: 16 });
            closeBtn.addEventListener('click', () => close(null));
            heading.append(closeBtn);
        }

        /* Body */
        const body = el('div', { class: variant === 'drawer' ? 'drawer-body' : 'modal-body' });
        if (content instanceof HTMLElement) body.append(content);
        else render(body, content);

        panel.append(heading, body);

        /* Footer */
        let footer = null;
        if (actions.length) {
            footer = el('div', { class: variant === 'drawer' ? 'drawer-footer' : 'modal-footer' });
            for (const action of actions) {
                const button = el('button', {
                    type: 'button',
                    class: `btn btn-${action.variant || 'secondary'}`,
                    ...(action.attrs || {})
                }, action.label);

                button.addEventListener('click', async () => {
                    if (!action.onClick) return close(action.value);

                    // Lock the whole footer, not just this button: "Cancel"
                    // during an in-flight save is its own class of bug.
                    setFooterBusy(true, button);
                    try {
                        const result = await action.onClick({ body, panel, close, button });
                        // Returning false is the explicit "keep me open" signal
                        // used by validation failures.
                        if (result !== false) close(result === undefined ? action.value : result);
                    } catch (err) {
                        // Rethrowing here achieved nothing: this is an async
                        // event listener, so there is no caller to catch it and
                        // the failure surfaced only as an unhandled rejection
                        // in a console nobody at a dance school will open. The
                        // overlay stays open with the user's input intact and
                        // the reason is shown to them instead.
                        console.error('Overlay action failed', err);
                        setFooterBusy(false);
                        toast.error(err?.message || 'That action could not be completed.');
                    } finally {
                        if (button.isConnected) setFooterBusy(false);
                    }
                });

                footer.append(button);
            }
            panel.append(footer);
        }

        function setFooterBusy(busy, activeButton = null) {
            if (!footer) return;
            for (const button of footer.querySelectorAll('button')) {
                button.disabled = busy;
                if (busy && button === activeButton) button.dataset.loading = 'true';
                else delete button.dataset.loading;
            }
        }

        /* Dismissal by backdrop. mousedown, not click, so a drag that starts
           inside the panel and ends on the backdrop does not close it. */
        if (dismissible) {
            region.addEventListener('mousedown', (event) => {
                if (event.target === region) close(null);
            });
        }

        region.append(panel);
        document.body.append(region);

        const releaseScroll = lockScroll();
        const releaseFocus = trapFocus(panel);

        const entry = { close, dismissible };
        stack.push(entry);

        let settled = false;
        function close(value) {
            if (settled) return;
            settled = true;

            const index = stack.indexOf(entry);
            if (index >= 0) stack.splice(index, 1);

            releaseFocus();
            releaseScroll();
            region.remove();
            resolve(value);
        }

        onMount?.(body, { close, panel });
    });
}

/** Centred dialog. */
export const modal = (options) => overlay({ ...options, variant: 'modal' });

/** Edge panel that keeps the list behind it visible. */
export const drawer = (options) => overlay({ ...options, variant: 'drawer' });

/**
 * Confirmation. Resolves true or false.
 *
 * The confirm button is labelled with the verb of the action ("Archive
 * student"), never "OK" — a dialog whose buttons are "OK" and "Cancel" makes
 * the user re-read the sentence to work out which one does the thing.
 */
export function confirm({
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false,
    detail = null
} = {}) {
    return overlay({
        variant: 'modal',
        size: 'sm',
        title,
        content: html`
            <p class="type-body">${message}</p>
            ${detail && html`
                <div class="alert ${danger ? 'alert-danger' : 'alert-info'} mt-4">
                    <div class="alert-body type-body-sm">${detail}</div>
                </div>`}
        `,
        actions: [
            { label: cancelLabel, variant: 'secondary', value: false },
            { label: confirmLabel, variant: danger ? 'danger' : 'primary', value: true }
        ]
    }).then((value) => value === true);
}

/**
 * Confirmation for genuinely irreversible actions: the user must type the
 * record's name. Reserved for hard deletes and restoring a backup over live
 * data — using it for routine deletion trains people to type without reading.
 */
export function confirmTyped({ title, message, phrase, confirmLabel = 'Delete permanently' }) {
    return overlay({
        variant: 'modal',
        size: 'sm',
        title,
        content: html`
            <p class="type-body mb-4">${message}</p>
            <div class="field">
                <label class="field-label" for="confirm-phrase">
                    Type <strong>${phrase}</strong> to continue
                </label>
                <input class="input" id="confirm-phrase" name="phrase" autocomplete="off" spellcheck="false">
            </div>
        `,
        onMount: (body, { close }) => {
            const input = body.querySelector('#confirm-phrase');
            const confirmButton = body.closest('.modal')?.querySelector('.btn-danger');
            if (confirmButton) confirmButton.disabled = true;

            input.addEventListener('input', () => {
                if (confirmButton) confirmButton.disabled = input.value.trim() !== phrase;
            });
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && input.value.trim() === phrase) close(true);
            });
        },
        actions: [
            { label: 'Cancel', variant: 'secondary', value: false },
            { label: confirmLabel, variant: 'danger', value: true }
        ]
    }).then((value) => value === true);
}
