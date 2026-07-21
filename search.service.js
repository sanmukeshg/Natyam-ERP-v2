/**
 * NATYAM ERP 2.0 — Wizard
 *
 * A multi-step form in an overlay, with a step rail, per-step validation and
 * autosave. Built as a general component rather than inside the admissions
 * module because payroll runs and year-end promotion are the same shape, and
 * the second copy of a wizard is always the one that drifts.
 *
 * Two decisions worth stating:
 *
 * 1. Validation is delegated. The wizard asks its caller "is this step ok?"
 *    and paints whatever errors come back. It knows nothing about admissions
 *    rules — those belong to the service, which is exactly where the caller
 *    forwards the question.
 *
 * 2. State is one flat object shared by every step. Steps read and write the
 *    same bag, so a later step can show what an earlier one collected without
 *    the caller threading values through by hand.
 */

import { html, render, on, el } from '../utils/dom.js';
import { overlay } from './overlay.js';
import { fields as renderFields, readForm, showErrors, clearErrors } from './form.js';
import { debounce } from '../utils/dom.js';

/**
 * @param {object} config
 * @param {string} config.title
 * @param {Array}  config.steps    [{ key, label, description, fields(state) => Field[]|html, validate(state) => {ok,errors}, render(state) }]
 * @param {object} [config.state]  Initial values.
 * @param {Function} config.onFinish   async (state) => result
 * @param {Function} [config.onStep]   async (state, stepIndex) => void — autosave hook.
 * @param {string} [config.finishLabel='Finish']
 * @returns {Promise<*>} Whatever onFinish returned, or null if abandoned.
 */
export function wizard({
    title,
    description = '',
    steps,
    state = {},
    onFinish,
    onStep = null,
    finishLabel = 'Finish',
    size = 'wide'
}) {
    let index = 0;
    let body = null;
    const data = { ...state };

    const autosave = debounce(() => { onStep?.(data, index); }, 900);

    const current = () => steps[index];

    /** Pulls the visible step's inputs into the shared state bag. */
    function absorb() {
        const step = current();
        if (typeof step.fields !== 'function') return;
        const list = step.fields(data);
        if (!Array.isArray(list)) return;
        Object.assign(data, readForm(body.querySelector('[data-role="step-body"]'), list));
    }

    function paint() {
        render(body, markup());
        // The first control of a step gets focus, so a keyboard user is not
        // dropped at the top of the dialog on every "Next".
        body.querySelector('[data-role="step-body"] input, [data-role="step-body"] select, [data-role="step-body"] textarea')?.focus();
        current().onMount?.(body.querySelector('[data-role="step-body"]'), { data, refresh: paint, go });
    }

    function markup() {
        const step = current();
        const list = typeof step.fields === 'function' ? step.fields(data) : null;

        return html`
            <div class="wizard">
                <ol class="steps" aria-label="Application steps">
                    ${steps.map((s, i) => html`
                        <li class="step ${i === index ? 'is-current' : i < index ? 'is-done' : ''}">
                            <button type="button" class="step-marker" data-goto="${i}"
                                    ${i > index ? 'disabled' : ''}
                                    aria-current="${i === index ? 'step' : 'false'}">
                                ${i < index ? '✓' : i + 1}
                            </button>
                            <span class="step-label">${s.label}</span>
                            ${i < steps.length - 1 ? html`<span class="step-line"></span>` : ''}
                        </li>
                    `)}
                </ol>

                <div class="wizard-panel">
                    <header class="wizard-header">
                        <h3 class="form-section-title">${step.label}</h3>
                        ${step.description ? html`<p class="form-section-description">${step.description}</p>` : ''}
                    </header>
                    <div data-role="step-banner"></div>
                    <form data-role="step-body" novalidate>
                        ${Array.isArray(list) ? renderFields(list) : (step.render ? step.render(data) : '')}
                    </form>
                </div>
            </div>
        `;
    }

    async function go(target) {
        if (target === index) return;

        // Moving forward validates; moving back never does, because forcing a
        // user to fix step 3 before they can look at step 2 is how forms get
        // abandoned.
        if (target > index) {
            absorb();
            const step = current();
            const result = step.validate ? await step.validate(data) : { ok: true, errors: {} };
            if (!result.ok) {
                showErrors(body.querySelector('[data-role="step-body"]'), result.errors);
                return;
            }
            clearErrors(body.querySelector('[data-role="step-body"]'));
            await onStep?.(data, target);
        } else {
            absorb();
        }

        index = Math.max(0, Math.min(steps.length - 1, target));
        paint();
        syncFooter();
    }

    /* The footer buttons live in the overlay chrome, so they are re-labelled
       rather than re-rendered as the step changes. */
    function syncFooter() {
        const root = body.closest('.modal, .drawer');
        if (!root) return;
        const back = root.querySelector('[data-wizard="back"]');
        const next = root.querySelector('[data-wizard="next"]');
        if (back) back.disabled = index === 0;
        if (next) next.textContent = index === steps.length - 1 ? finishLabel : 'Continue';
    }

    return overlay({
        variant: 'drawer',
        size,
        title,
        description,
        content: el('div', { class: 'wizard-host' }),
        actions: [
            {
                label: 'Back',
                variant: 'secondary',
                attrs: { 'data-wizard': 'back' },
                onClick: async () => { await go(index - 1); return false; }
            },
            {
                label: 'Continue',
                variant: 'primary',
                primary: true,
                attrs: { 'data-wizard': 'next' },
                onClick: async ({ close, button }) => {
                    if (index < steps.length - 1) {
                        await go(index + 1);
                        return false;
                    }

                    absorb();
                    const step = current();
                    const result = step.validate ? await step.validate(data) : { ok: true, errors: {} };
                    if (!result.ok) {
                        showErrors(body.querySelector('[data-role="step-body"]'), result.errors);
                        return false;
                    }

                    void close;
                    const original = button.textContent;
                    button.textContent = 'Working…';
                    try {
                        const finished = await onFinish(data);
                        return finished === undefined ? data : finished;
                    } catch (err) {
                        console.error('Wizard finish failed', err);
                        render(body.querySelector('[data-role="step-banner"]'), html`
                            <div class="alert alert-danger"><p class="alert-body">${err.message}</p></div>
                        `);
                        return false;
                    } finally {
                        button.textContent = original;
                    }
                }
            }
        ],
        onMount: (mounted, api) => {
            body = mounted;
            void api;
            paint();
            syncFooter();

            on(mounted, 'click', '[data-goto]', (_e, target) => go(Number(target.dataset.goto)));
            on(mounted, 'input', 'input, select, textarea', () => { absorb(); autosave(); });
            mounted.addEventListener('submit', (event) => {
                event.preventDefault();
                mounted.closest('.modal, .drawer')?.querySelector('[data-wizard="next"]')?.click();
            });
        }
    });
}
