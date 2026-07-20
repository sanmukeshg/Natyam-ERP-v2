/**
 * NATYAM ERP 2.0 — Command palette
 *
 * Ctrl-K opens one box that searches every record and runs every action the
 * user is allowed to perform. It exists because the alternative — remembering
 * which of fourteen screens holds the thing you want — is the tax that makes
 * admin software feel slow even when it is fast.
 *
 * The palette is a UI shell only. Every result and every command comes from
 * search.service, which enforces capabilities: what the palette can offer is
 * decided by the service, never assembled here.
 *
 * Design notes worth keeping:
 *
 *  - Queries are debounced but *stale results are discarded by sequence
 *    number*, not by timer alone. Typing "sri" then "srid" can otherwise
 *    render the slower "sri" answer last, and the list flickers back to the
 *    wrong thing under exactly the fast typing this is meant to reward.
 *  - Arrow keys move a single highlighted index across the merged list of
 *    commands and records, because to the person using it there is one list.
 *  - Opening restores focus to whatever was focused before. A palette that
 *    dumps focus on <body> when dismissed makes the keyboard user start again.
 */

import { html, render, raw, el } from '../utils/dom.js';
import { icon } from './icons.js';
import { debounce } from '../utils/dom.js';
import { palette as loadPalette, recentSuggestions } from '../services/search.service.js';

let instance = null;

class CommandPalette {
    constructor() {
        this.open = false;
        this.query = '';
        this.items = [];
        this.index = 0;
        this.sequence = 0;
        this.previouslyFocused = null;

        this.region = el('div', { class: 'palette-region', hidden: true });
        this.panel = el('div', {
            class: 'palette',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': 'Search and commands'
        });

        this.region.append(this.panel);
        document.body.append(this.region);

        this.paintShell();
        this.bind();
    }

    paintShell() {
        render(this.panel, html`
            <div class="palette-input-row">
                <span class="palette-input-icon" aria-hidden="true">${raw(icon('search', { size: 17 }))}</span>
                <input class="palette-input" type="text" role="combobox"
                       aria-expanded="true" aria-controls="palette-results" aria-autocomplete="list"
                       placeholder="Search students, batches, receipts — or type a command"
                       autocomplete="off" spellcheck="false">
                <kbd class="palette-hint">esc</kbd>
            </div>
            <div class="palette-results" id="palette-results" role="listbox"></div>
            <div class="palette-footer">
                <span><kbd>↑</kbd><kbd>↓</kbd> to move</span>
                <span><kbd>enter</kbd> to open</span>
                <span><kbd>ctrl</kbd><kbd>k</kbd> to reopen</span>
            </div>
        `);

        this.input = this.panel.querySelector('.palette-input');
        this.results = this.panel.querySelector('.palette-results');
    }

    bind() {
        // Global shortcut. Registered once for the life of the app.
        document.addEventListener('keydown', (event) => {
            const combo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
            if (combo) {
                event.preventDefault();
                this.toggle();
                return;
            }

            // "/" opens search the way it does in most tools, but only when the
            // user is not already typing into something.
            if (event.key === '/' && !this.open && !isTyping(event.target)) {
                event.preventDefault();
                this.show();
            }

            if (event.key === 'Escape' && this.open) this.hide();
        });

        this.region.addEventListener('mousedown', (event) => {
            if (event.target === this.region) this.hide();
        });

        this.input.addEventListener('input', debounce(() => {
            this.query = this.input.value;
            this.load();
        }, 110));

        this.input.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); this.move(1); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); this.move(-1); }
            else if (event.key === 'Enter') { event.preventDefault(); this.choose(this.items[this.index]); }
        });

        this.results.addEventListener('click', (event) => {
            const row = event.target.closest('[data-index]');
            if (row) this.choose(this.items[Number(row.dataset.index)]);
        });
    }

    /* ------------------------------------------------------------ VISIBILITY */

    toggle() { this.open ? this.hide() : this.show(); }

    show() {
        if (this.open) return;
        this.previouslyFocused = document.activeElement;
        this.open = true;
        this.region.hidden = false;
        document.body.classList.add('has-overlay');
        this.input.value = '';
        this.query = '';
        this.input.focus();
        this.load();
    }

    hide() {
        if (!this.open) return;
        this.open = false;
        this.region.hidden = true;
        document.body.classList.remove('has-overlay');
        this.previouslyFocused?.focus?.();
    }

    /* ----------------------------------------------------------------- DATA */

    async load() {
        const ticket = ++this.sequence;

        try {
            const data = this.query.trim().length < 2
                ? { commands: (await loadPalette('')).commands, records: await recentSuggestions(5), empty: false }
                : await loadPalette(this.query);

            // A slower earlier query must never overwrite a newer answer.
            if (ticket !== this.sequence) return;

            this.items = [
                ...data.commands.map((command) => ({ ...command, type: 'command' })),
                ...data.records.map((record) => ({ ...record, type: 'record' }))
            ];
            this.index = 0;
            this.paintResults();
        } catch (err) {
            if (ticket !== this.sequence) return;
            console.error(err);
            render(this.results, html`
                <div class="palette-empty">
                    <p class="type-body">Search is unavailable right now.</p>
                    <p class="type-caption type-muted">${err.message}</p>
                </div>
            `);
        }
    }

    paintResults() {
        if (!this.items.length) {
            render(this.results, html`
                <div class="palette-empty">
                    <p class="type-body">Nothing found for “${this.query}”.</p>
                    <p class="type-caption type-muted">
                        Try an admission number, a phone number, a receipt number or part of a name.
                    </p>
                </div>
            `);
            return;
        }

        let lastGroup = null;

        render(this.results, html`
            ${this.items.map((item, index) => {
                const group = item.type === 'command'
                    ? (item.kind === 'navigate' ? 'Go to' : 'Actions')
                    : (item.group || 'Records');
                const heading = group !== lastGroup ? group : null;
                lastGroup = group;

                return html`
                    ${heading ? html`<div class="palette-group">${heading}</div>` : ''}
                    <button class="palette-item ${index === this.index ? 'is-active' : ''}"
                            data-index="${index}" role="option"
                            aria-selected="${index === this.index}">
                        <span class="palette-item-icon" aria-hidden="true">
                            ${raw(icon(item.icon || 'chevron-right', { size: 16 }))}
                        </span>
                        <span class="palette-item-text">
                            <span class="palette-item-title">${item.label || item.title}</span>
                            ${item.hint || item.subtitle
                                ? html`<span class="palette-item-hint">${item.hint || item.subtitle}</span>`
                                : ''}
                        </span>
                        ${index === this.index ? html`<kbd class="palette-enter">↵</kbd>` : ''}
                    </button>
                `;
            })}
        `);
    }

    move(step) {
        if (!this.items.length) return;
        this.index = (this.index + step + this.items.length) % this.items.length;
        this.paintResults();
        this.results.querySelector('.palette-item.is-active')
            ?.scrollIntoView({ block: 'nearest' });
    }

    choose(item) {
        if (!item) return;
        this.hide();

        const route = item.route;
        if (route) window.location.hash = route.startsWith('#') ? route : `#${route}`;
    }
}

function isTyping(node) {
    if (!node) return false;
    const tag = node.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
}

/** Creates the palette once and returns it. */
export function commandPalette() {
    if (!instance) instance = new CommandPalette();
    return instance;
}

export function openPalette() {
    commandPalette().show();
}
