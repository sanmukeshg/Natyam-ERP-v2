/**
 * NATYAM ERP 2.0 — Form builder
 *
 * Thirteen module pages need forms. Without this file each of them writes its
 * own `<div class="field"><label…` by hand, and within a month the label sits
 * above the input on nine screens and beside it on four, half of them forget
 * `aria-describedby` on the error text, and the required marker is a red
 * asterisk in some places and the word "required" in others.
 *
 * So forms are declared as data here and rendered once. A page says what it
 * wants collected; this module decides what that looks like and how it behaves
 * when it is wrong.
 *
 * What this deliberately does NOT do is validate business rules. It checks
 * that a required box has something in it and that a number is a number —
 * shape, not meaning. Whether a fee may be waived, or a student may join a
 * full batch, is the service layer's answer and this file must never guess it.
 */

import { html, render, el, escapeHtml } from '../utils/dom.js';
import { overlay } from './overlay.js';
import { toPaise, toRupees } from '../utils/money.js';

/* ==========================================================================
   FIELD MARKUP
   ========================================================================== */

/**
 * @typedef {object} Field
 * @property {string} name
 * @property {string} label
 * @property {'text'|'textarea'|'select'|'number'|'money'|'date'|'time'|'tel'|'email'|'checkbox'|'switch'|'radio'|'hidden'|'static'|'divider'} [type='text']
 * @property {*} [value]
 * @property {boolean} [required]
 * @property {string} [hint]
 * @property {string} [placeholder]
 * @property {Array}  [options]   For select/radio: [{ value, label, disabled, note }]
 * @property {number} [min] @property {number} [max] @property {number} [step]
 * @property {number} [rows]      For textarea.
 * @property {string} [width]     Grid span hint: 'full' | 'half' | 'third'.
 * @property {boolean}[autofocus]
 * @property {boolean}[disabled]
 */

/** Renders one field. */
export function field(config) {
    const {
        name, label, type = 'text', value = '', required = false, hint = '',
        placeholder = '', options = [], rows = 3, min, max, step,
        disabled = false, autofocus = false, autocomplete
    } = config;

    const id = `f-${name}`;
    const describedBy = hint ? `${id}-hint` : '';

    if (type === 'hidden') {
        return html`<input type="hidden" name="${name}" value="${value ?? ''}">`;
    }

    if (type === 'divider') {
        return html`<div class="divider divider-labelled" data-label="${label || ''}"></div>`;
    }

    if (type === 'static') {
        return html`
            <div class="field" data-width="${config.width || 'full'}">
                <span class="field-label">${label}</span>
                <p class="type-body">${value || '—'}</p>
                ${hint ? html`<p class="field-hint">${hint}</p>` : ''}
            </div>
        `;
    }

    if (type === 'checkbox' || type === 'switch') {
        const controlBox = type === 'switch'
            ? html`<span class="switch-track" aria-hidden="true"></span>`
            : html`<span class="check-box" aria-hidden="true"></span>`;
        return html`
            <div class="field" data-width="${config.width || 'full'}">
                <label class="${type === 'switch' ? 'switch' : 'check'}">
                    <input type="checkbox" name="${name}" id="${id}"
                           ${value ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
                    ${controlBox}
                    <span>${label}</span>
                </label>
                ${hint ? html`<p class="field-hint" id="${id}-hint">${hint}</p>` : ''}
                <p class="field-error" data-error-for="${name}" hidden></p>
            </div>
        `;
    }

    // A set of independent checkboxes returning an array — the "which days
    // does this batch meet" shape. Added here rather than hand-rolled in the
    // batch form because programmes and reports need exactly the same control.
    if (type === 'checkbox-group') {
        const selected = new Set((Array.isArray(value) ? value : []).map(String));
        return html`
            <fieldset class="field" data-width="${config.width || 'full'}">
                <legend class="field-label">${label}${required ? requiredMark() : ''}</legend>
                <div class="row row-wrap">
                    ${options.map((option, index) => html`
                        <label class="check">
                            <input type="checkbox" name="${name}" value="${option.value}"
                                   ${selected.has(String(option.value)) ? 'checked' : ''}
                                   ${option.disabled ? 'disabled' : ''}
                                   ${autofocus && index === 0 ? 'autofocus' : ''}>
                            <span class="check-box" aria-hidden="true"></span>
                            <span>${option.label}</span>
                        </label>
                    `)}
                </div>
                ${hint ? html`<p class="field-hint" id="${id}-hint">${hint}</p>` : ''}
                <p class="field-error" data-error-for="${name}" hidden></p>
            </fieldset>
        `;
    }

    if (type === 'radio') {
        return html`
            <fieldset class="field" data-width="${config.width || 'full'}">
                <legend class="field-label">${label}${required ? requiredMark() : ''}</legend>
                <div class="row row-wrap">
                    ${options.map((option, index) => html`
                        <label class="check">
                            <input type="radio" name="${name}" value="${option.value}"
                                   ${String(value) === String(option.value) ? 'checked' : ''}
                                   ${option.disabled ? 'disabled' : ''}
                                   ${autofocus && index === 0 ? 'autofocus' : ''}>
                            <span class="check-box check-radio" aria-hidden="true"></span>
                            <span>${option.label}</span>
                        </label>
                    `)}
                </div>
                ${hint ? html`<p class="field-hint" id="${id}-hint">${hint}</p>` : ''}
                <p class="field-error" data-error-for="${name}" hidden></p>
            </fieldset>
        `;
    }

    let control;

    if (type === 'textarea') {
        control = html`<textarea class="textarea" name="${name}" id="${id}" rows="${rows}"
                                 placeholder="${placeholder}"
                                 ${required ? 'required' : ''} ${disabled ? 'disabled' : ''}
                                 ${autofocus ? 'autofocus' : ''}
                                 ${describedBy ? `aria-describedby="${describedBy}"` : ''}
                       >${value ?? ''}</textarea>`;
    } else if (type === 'select') {
        control = html`
            <select class="select" name="${name}" id="${id}"
                    ${required ? 'required' : ''} ${disabled ? 'disabled' : ''}
                    ${autofocus ? 'autofocus' : ''}
                    ${describedBy ? `aria-describedby="${describedBy}"` : ''}>
                ${config.placeholder !== false
                    ? html`<option value="">${placeholder || 'Choose…'}</option>`
                    : ''}
                ${options.map((option) => html`
                    <option value="${option.value}"
                            ${String(value) === String(option.value) ? 'selected' : ''}
                            ${option.disabled ? 'disabled' : ''}>
                        ${option.label}${option.note ? ` — ${option.note}` : ''}
                    </option>
                `)}
            </select>
        `;
    } else {
        // `money` is a decimal rupee input; the caller receives paise.
        const inputType = type === 'money' ? 'number' : type;
        const inputStep = type === 'money' ? '0.01' : step;

        control = html`
            <input class="input" type="${inputType}" name="${name}" id="${id}"
                   value="${value ?? ''}" placeholder="${placeholder}"
                   ${min !== undefined ? `min="${min}"` : ''}
                   ${max !== undefined ? `max="${max}"` : ''}
                   ${inputStep !== undefined ? `step="${inputStep}"` : ''}
                   ${autocomplete ? `autocomplete="${autocomplete}"` : ''}
                   ${required ? 'required' : ''} ${disabled ? 'disabled' : ''}
                   ${autofocus ? 'autofocus' : ''}
                   ${type === 'money' ? 'data-money="1" inputmode="decimal"' : ''}
                   ${describedBy ? `aria-describedby="${describedBy}"` : ''}>
        `;
    }

    return html`
        <div class="field" data-width="${config.width || 'full'}">
            <label class="field-label" for="${id}">${label}${required ? requiredMark() : ''}</label>
            ${type === 'money'
                ? html`<div class="input-group"><span class="input-prefix">₹</span>${control}</div>`
                : control}
            ${hint ? html`<p class="field-hint" id="${id}-hint">${hint}</p>` : ''}
            <p class="field-error" data-error-for="${name}" hidden></p>
        </div>
    `;
}

function requiredMark() {
    return html`<span class="field-required" aria-hidden="true">*</span><span class="sr-only"> (required)</span>`;
}

/** Renders a list of fields into a responsive grid. */
export function fields(list) {
    return html`<div class="form-grid">${list.filter(Boolean).map((f) => field(f))}</div>`;
}

/** A titled group of fields. */
export function section(title, list, description = '') {
    return html`
        <section class="form-section">
            <h3 class="form-section-title">${title}</h3>
            ${description ? html`<p class="form-section-description">${description}</p>` : ''}
            ${fields(list)}
        </section>
    `;
}

/* ==========================================================================
   READING VALUES BACK
   ========================================================================== */

/**
 * Reads a form's values, typed according to the field list that produced it.
 *
 * Typing here rather than at the call site is what stops a rupee amount
 * reaching a service as the string "1200.50". Money always leaves this
 * function as integer paise, numbers as numbers, empty text as null.
 */
export function readForm(root, list) {
    const values = {};

    for (const config of list.filter(Boolean)) {
        if (!config.name || config.type === 'divider' || config.type === 'static') continue;

        const control = root.querySelector(`[name="${CSS.escape(config.name)}"]`);
        if (!control && config.type !== 'radio' && config.type !== 'checkbox-group') continue;

        switch (config.type) {
            case 'checkbox-group': {
                const boxes = root.querySelectorAll(`[name="${CSS.escape(config.name)}"]:checked`);
                values[config.name] = [...boxes].map((box) => box.value);
                break;
            }
            case 'checkbox':
            case 'switch':
                values[config.name] = Boolean(control.checked);
                break;
            case 'radio': {
                const checked = root.querySelector(`[name="${CSS.escape(config.name)}"]:checked`);
                values[config.name] = checked ? checked.value : null;
                break;
            }
            case 'money': {
                const raw = control.value.trim();
                values[config.name] = raw === '' ? null : toPaise(Number(raw));
                break;
            }
            case 'number': {
                const raw = control.value.trim();
                values[config.name] = raw === '' ? null : Number(raw);
                break;
            }
            default: {
                const raw = String(control.value ?? '').trim();
                values[config.name] = raw === '' ? null : raw;
            }
        }
    }

    return values;
}

/** Shape-level validation only. Returns { ok, errors: { field: message } }. */
export function validateShape(values, list) {
    const errors = {};

    for (const config of list.filter(Boolean)) {
        if (!config.name) continue;
        const value = values[config.name];

        // An empty array is empty even though it is truthy.
        if (config.required && Array.isArray(value) && value.length === 0) {
            errors[config.name] = `${config.label} is needed.`;
            continue;
        }
        if (config.required && (value === null || value === undefined || value === '' || value === false)) {
            errors[config.name] = `${config.label} is needed.`;
            continue;
        }
        if (value === null || value === undefined) continue;

        if ((config.type === 'number' || config.type === 'money') && Number.isNaN(value)) {
            errors[config.name] = 'This must be a number.';
        }
        if (config.type === 'money' && value !== null && value < 0) {
            errors[config.name] = 'This cannot be negative.';
        }
        if (config.type === 'number' && config.min !== undefined && value < config.min) {
            errors[config.name] = `This cannot be below ${config.min}.`;
        }
        if (config.type === 'number' && config.max !== undefined && value > config.max) {
            errors[config.name] = `This cannot be above ${config.max}.`;
        }
        if (config.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            errors[config.name] = 'This does not look like an email address.';
        }
        if (config.type === 'tel' && String(value).replace(/\D/g, '').length < 10) {
            errors[config.name] = 'A phone number needs at least ten digits.';
        }
    }

    return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * Paints errors onto a rendered form and moves focus to the first one, so a
 * failure on a long form does not leave the user hunting for the red text.
 */
export function showErrors(root, errors) {
    root.querySelectorAll('[data-error-for]').forEach((node) => {
        node.hidden = true;
        node.textContent = '';
    });
    root.querySelectorAll('[aria-invalid]').forEach((node) => node.removeAttribute('aria-invalid'));

    let first = null;

    for (const [name, message] of Object.entries(errors || {})) {
        const slot = root.querySelector(`[data-error-for="${CSS.escape(name)}"]`);
        const control = root.querySelector(`[name="${CSS.escape(name)}"]`);

        if (slot) {
            slot.textContent = message;
            slot.hidden = false;
        }
        if (control) {
            control.setAttribute('aria-invalid', 'true');
            control.setAttribute('aria-errormessage', `err-${name}`);
            if (slot) slot.id = `err-${name}`;
            if (!first) first = control;
        }
    }

    first?.focus();
    return first !== null;
}

/** Clears every error slot. */
export function clearErrors(root) {
    showErrors(root, {});
}

/* ==========================================================================
   FORM OVERLAYS
   ========================================================================== */

/**
 * A drawer or modal containing a form. Resolves with the submitted values, or
 * null if the user backed out.
 *
 * The submit handler is given the typed values and may throw: a thrown error
 * is shown inside the form rather than as a toast, because the user is looking
 * at the form and an error about the form belongs there. If the handler
 * returns a `{ errors }` object, those are painted onto the fields.
 *
 * @param {object} options
 * @param {string} options.title
 * @param {Field[]} options.fields
 * @param {Function} options.onSubmit  async (values, helpers) => result
 * @param {'modal'|'drawer'} [options.variant='drawer']
 * @param {string} [options.submitLabel='Save']
 * @param {Function} [options.onMount]  (body, helpers) => void — for live wiring.
 */
export function formOverlay({
    title,
    description = '',
    fields: list,
    onSubmit,
    variant = 'drawer',
    size = 'md',
    submitLabel = 'Save',
    cancelLabel = 'Cancel',
    intro = '',
    danger = false,
    onMount = null
}) {
    let body = null;
    let currentFields = list;

    const helpers = {
        /** Swaps the field list — for forms whose shape depends on a choice. */
        setFields(next) {
            currentFields = next;
            const values = readForm(body, currentFields);
            render(body.querySelector('[data-role="fields"]'), fields(next));
            // Restore what the user had already typed into surviving fields.
            for (const [name, value] of Object.entries(values)) {
                const control = body.querySelector(`[name="${CSS.escape(name)}"]`);
                if (control && value !== null && control.type !== 'checkbox') control.value = value;
            }
        },
        values: () => readForm(body, currentFields),
        setError(name, message) { showErrors(body, { [name]: message }); },
        banner(message, tone = 'danger') {
            const slot = body.querySelector('[data-role="form-banner"]');
            if (!slot) return;
            render(slot, message
                ? html`<div class="alert alert-${tone}"><p class="alert-body">${message}</p></div>`
                : '');
        }
    };

    return overlay({
        variant,
        size,
        title,
        description,
        content: html`
            <form data-role="form" novalidate>
                <div data-role="form-banner"></div>
                ${intro ? html`<p class="type-body mb-4">${intro}</p>` : ''}
                <div data-role="fields">${fields(list)}</div>
            </form>
        `,
        actions: [
            { label: cancelLabel, variant: 'secondary', value: null },
            {
                label: submitLabel,
                variant: danger ? 'danger' : 'primary',
                primary: true,
                onClick: async ({ body: mounted, close, button }) => {
                    void mounted; void close;
                    const values = readForm(body, currentFields);
                    const shape = validateShape(values, currentFields);

                    // `false` is the overlay's "stay open" signal; every
                    // validation failure below uses it.
                    if (!shape.ok) {
                        showErrors(body, shape.errors);
                        return false;
                    }
                    clearErrors(body);

                    const original = button.innerHTML;
                    button.innerHTML = 'Working…';

                    try {
                        const result = await onSubmit(values, helpers);
                        if (result && result.errors) {
                            showErrors(body, result.errors);
                            return false;
                        }
                        return result === undefined ? values : result;
                    } catch (err) {
                        console.error('Form submission failed', err);
                        helpers.banner(err.message);
                        body.scrollTo?.({ top: 0, behavior: 'smooth' });
                        return false;
                    } finally {
                        button.innerHTML = original;
                    }
                }
            }
        ],
        onMount: (mounted, api) => {
            body = mounted;
            // Enter submits, as it does in every other form the user has used.
            mounted.querySelector('[data-role="form"]')?.addEventListener('submit', (event) => {
                event.preventDefault();
                mounted.closest('.modal, .drawer')?.querySelector('.btn-primary, .btn-danger')?.click();
            });
            onMount?.(mounted, { ...helpers, close: api.close });
            mounted.querySelector('input, select, textarea')?.focus();
        }
    });
}

/* ==========================================================================
   SMALL HELPERS PAGES REACH FOR
   ========================================================================== */

/** Turns a record list into select options. */
export function optionsFrom(rows, { value = 'id', label = 'name', note = null, disabled = null } = {}) {
    return rows.map((row) => ({
        value: typeof value === 'function' ? value(row) : row[value],
        label: typeof label === 'function' ? label(row) : row[label],
        note: note ? (typeof note === 'function' ? note(row) : row[note]) : null,
        disabled: disabled ? disabled(row) : false
    }));
}

/** Rupee value for pre-filling a money field from stored paise. */
export function moneyValue(paise) {
    return paise === null || paise === undefined ? '' : String(toRupees(paise));
}

/** A read-only summary block, used in confirmation steps. */
export function summaryList(pairs) {
    return html`
        <dl class="dl">
            ${pairs.filter(([, value]) => value !== null && value !== undefined && value !== '')
                .map(([term, value]) => html`<dt>${term}</dt><dd>${value}</dd>`)}
        </dl>
    `;
}

/** Escapes a value for use inside an attribute built by hand. */
export const attr = escapeHtml;

/**
 * Filter-bar controls.
 *
 * These are deliberately separate from the form builder: a filter is not a
 * form field. It has no validation, no submit, no dirty state, and it applies
 * the instant it changes. Nine pages had hand-rolled the same label/select
 * pairing with slightly different aria wiring — three of them had no
 * accessible name at all — so it lives here now.
 *
 * Both emit `data-filter="<name>"`, which is the delegation hook every page
 * listens on.
 */
export function filterSelect({ name, label, options, value = '', width = null }) {
    return html`
        <label class="filter-control" ${width ? `style="width:${width}"` : ''}>
            <span class="sr-only">${label}</span>
            <select class="select select-sm" data-filter="${name}" aria-label="${label}">
                ${options.map((option) => html`
                    <option value="${option.value}" ${String(value) === String(option.value) ? 'selected' : ''}>
                        ${option.label}
                    </option>
                `)}
            </select>
        </label>
    `;
}

/** The date half of the same pattern — used by every date-range filter bar. */
export function filterDate({ name, label, value = '', min = null, max = null }) {
    return html`
        <label class="filter-control">
            <span class="type-caption type-muted">${label}</span>
            <input class="input input-sm" type="date" data-filter="${name}"
                   value="${value || ''}" aria-label="${label}"
                   ${min ? `min="${min}"` : ''} ${max ? `max="${max}"` : ''}>
        </label>
    `;
}
