/**
 * NATYAM ERP 2.0 — Parents and households
 *
 * There is no parent record in this system, and that is a decision rather than
 * an omission. A guardian here has no login, no portal and no existence that
 * outlives their child's enrolment; giving them their own store would create a
 * second place for a phone number to be wrong and a reconciliation job nobody
 * would ever run.
 *
 * So a household is derived from the students who share a contact number, by
 * students.service.households(). This page is a view over that derivation: a
 * directory for the office to ring families, spot siblings, and find the
 * records where the school has no way to reach anyone at all.
 */

import { Page } from '../../core/router.js';
import { kpiCard } from '../../ui/chart.js';
import { html, render, raw, on } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { drawer } from '../../ui/overlay.js';
import { DataTable } from '../../ui/table.js';
import { formOverlay, summaryList } from '../../ui/form.js';
import { downloadCSV } from '../../utils/csv.js';
import { session } from '../../core/session.js';
import { EVENTS } from '../../core/bus.js';
import { router } from '../../core/router.js';
import { formatMoney, formatNumber } from '../../utils/money.js';
import { localDate } from '../../utils/date.js';
import { households, householdSummary, updateStudent } from '../../services/students.service.js';

export default class ParentsPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Parents';
        this.filter = this.query.filter || '';
        this.groups = [];
    }

    async render(container) {
        this.container = container;
        render(container, this.shell());
        this.bind();
        this.buildTable();
        await this.load();
    }

    shell() {
        return html`
            <header class="page-header">
                <div class="page-header-text">
                    <h1 class="page-title">Parents</h1>
                    <p class="page-subtitle">Households, derived from the contact number on each student record.</p>
                </div>
                <div class="page-actions">
                    <button class="btn btn-secondary btn-sm" data-action="export">
                        ${raw(icon('download', { size: 15 }))} Export directory
                    </button>
                </div>
            </header>
            <div class="page-body">
                <div data-role="summary"></div>
                <div class="filter-bar">
                    <div class="row row-wrap">
                        ${[
                            { key: '', label: 'All households' },
                            { key: 'siblings', label: 'More than one child' },
                            { key: 'owing', label: 'Owing fees' },
                            { key: 'uncontactable', label: 'No phone number' },
                            { key: 'no-email', label: 'No email' }
                        ].map((chip) => html`
                            <button class="btn btn-sm ${this.filter === chip.key ? 'btn-primary' : 'btn-secondary'}"
                                    data-quick="${chip.key}" aria-pressed="${this.filter === chip.key}">
                                ${chip.label}
                            </button>
                        `)}
                    </div>
                </div>
                <div data-role="table"></div>
            </div>
        `;
    }

    bind() {
        this.onDispose(on(this.container, 'click', '[data-quick]', (_e, target) => {
            this.filter = target.dataset.quick;
            this.container.querySelectorAll('[data-quick]').forEach((node) => {
                const active = node.dataset.quick === this.filter;
                node.classList.toggle('btn-primary', active);
                node.classList.toggle('btn-secondary', !active);
                node.setAttribute('aria-pressed', String(active));
            });
            this.apply();
        }));
        this.onDispose(on(this.container, 'click', '[data-action="export"]', () => this.exportDirectory()));

        [EVENTS.STUDENT_CREATED, EVENTS.STUDENT_UPDATED, EVENTS.BRANCH_CHANGED]
            .forEach((event) => this.events.on(event, () => this.load()));
    }

    buildTable() {
        this.table = new DataTable({
            rows: [],
            rowId: 'key',
            searchPlaceholder: 'Search guardian, phone or child…',
            defaultSort: 'guardianName',
            emptyTitle: 'No households match',
            emptyMessage: 'Households appear as soon as students have a guardian phone number.',
            emptyIcon: 'phone',
            onRowClick: (row) => this.openHousehold(row),
            columns: [
                {
                    key: 'guardianName', label: 'Guardian', sortable: true,
                    searchValue: (row) => `${row.guardianName} ${row.phone || ''} ${row.children.map((c) => c.name).join(' ')}`,
                    render: (row) => html`
                        <div>
                            <span class="type-strong">${row.guardianName}</span>
                            <div class="type-caption type-muted">${row.guardianRelation}</div>
                        </div>
                    `
                },
                {
                    key: 'phone', label: 'Contact', sortable: true,
                    render: (row) => row.phone
                        ? html`<div>
                                   <a href="tel:${row.phone}">${row.phone}</a>
                                   ${row.email ? html`<div class="type-caption type-muted">${row.email}</div>` : ''}
                               </div>`
                        : html`<span class="badge badge-danger">No number</span>`
                },
                {
                    key: 'size', label: 'Children', align: 'right', sortable: true,
                    render: (row) => html`
                        <div>
                            <span class="type-strong">${formatNumber(row.size)}</span>
                            <div class="type-caption type-muted">${row.children.map((c) => c.name).join(', ')}</div>
                        </div>
                    `
                },
                {
                    key: 'outstanding', label: 'Owed', align: 'right', sortable: true,
                    exportValue: (row) => row.outstanding / 100,
                    render: (row) => row.outstanding > 0
                        ? html`<span class="badge badge-warning">${formatMoney(row.outstanding)}</span>`
                        : html`<span class="badge badge-success">Clear</span>`
                }
            ]
        });

        this.table.mount(this.container.querySelector('[data-role="table"]'));
        this.onDispose(() => this.table.destroy());
    }

    async load() {
        try {
            const [groups, stats] = await Promise.all([
                households(session.branch()),
                householdSummary(session.branch())
            ]);

            this.groups = groups;
            this.apply();
            render(this.container.querySelector('[data-role="summary"]'), this.summaryRow(stats));
        } catch (err) {
            console.error(err);
            toast.error(`Households could not be assembled — ${err.message}`);
        }
    }

    summaryRow(stats) {
        return html`
            <div class="grid grid-4">
                ${kpiCard('Households', formatNumber(stats.households))}
                ${kpiCard('With siblings', formatNumber(stats.multiChild), 'a discount conversation waiting to happen')}
                ${kpiCard('Unreachable', formatNumber(stats.missingPhone),
                    stats.missingPhone ? 'no phone number on file' : 'everyone can be reached', { tone: stats.missingPhone ? 'negative' : 'positive' })}
                ${kpiCard('Owing', formatMoney(stats.totalOutstanding), `${stats.owing} households`, { tone: stats.totalOutstanding ? 'caution' : 'positive' })}
            </div>
        `;
    }

    apply() {
        const rows = this.groups.filter((group) => {
            switch (this.filter) {
                case 'siblings': return group.size > 1;
                case 'owing': return group.outstanding > 0;
                case 'uncontactable': return !group.contactable;
                case 'no-email': return !group.email;
                default: return true;
            }
        });
        this.table.setRows(rows);
    }

    /* ------------------------------------------------------------- HOUSEHOLD */

    async openHousehold(group) {
        await drawer({
            title: group.guardianName,
            description: `${group.guardianRelation} · ${group.size} child${group.size === 1 ? '' : 'ren'} on the roll`,
            size: 'md',
            content: html`
                ${!group.contactable ? html`
                    <div class="alert alert-danger">
                        <div class="alert-title">No way to reach this family</div>
                        <p class="alert-body">There is no phone number on any of these records. In an
                        emergency at class there would be nobody to call.</p>
                    </div>
                ` : ''}

                <div class="card"><div class="card-body">
                    ${summaryList([
                        ['Phone', group.phone],
                        ['Email', group.email],
                        ['Emergency contact', group.alternatePhone],
                        ['Address', group.address],
                        ['Combined balance', formatMoney(group.outstanding)]
                    ])}
                    ${group.phone ? html`
                        <div class="row row-wrap mt-4">
                            <a class="btn btn-sm btn-secondary" href="tel:${group.phone}">
                                ${raw(icon('phone', { size: 14 }))} Call
                            </a>
                            ${group.email ? html`
                                <a class="btn btn-sm btn-secondary" href="mailto:${group.email}">
                                    ${raw(icon('mail', { size: 14 }))} Email
                                </a>
                            ` : ''}
                        </div>
                    ` : ''}
                </div></div>

                <div class="card">
                    <div class="card-header"><h3 class="card-title">Children</h3></div>
                    <div class="card-body card-body-tight">
                        <ul class="stack stack-sm">
                            ${group.children.map((child) => html`
                                <li class="spread">
                                    <div>
                                        <span class="type-strong">${child.name}</span>
                                        <div class="type-caption type-muted">
                                            ${child.levelLabel} · ${child.batchName || 'not placed'}
                                        </div>
                                    </div>
                                    <div class="row row-tight">
                                        ${child.outstanding > 0
                                            ? html`<span class="badge badge-warning">${formatMoney(child.outstanding)}</span>`
                                            : ''}
                                        <button class="btn btn-sm btn-ghost" data-open-student="${child.id}">Open</button>
                                    </div>
                                </li>
                            `)}
                        </ul>
                    </div>
                </div>
            `,
            actions: [
                { label: 'Close', variant: 'secondary', value: null },
                ...(session.can('student.edit') ? [{
                    label: 'Update contact details',
                    variant: 'primary',
                    primary: true,
                    onClick: async () => { await this.editContacts(group); return null; }
                }] : [])
            ],
            onMount: (body, api) => {
                on(body, 'click', '[data-open-student]', (_e, target) => {
                    api.close(null);
                    router.go(`/students?student=${target.dataset.openStudent}`);
                });
            }
        });
    }

    /**
     * Editing a household edits every child's record, because the contact
     * details live on the students. One save, applied consistently — which is
     * precisely the duplication risk a separate parent entity would create,
     * handled in one place instead.
     */
    async editContacts(group) {
        const done = await formOverlay({
            title: `Contact details — ${group.guardianName}`,
            variant: 'modal',
            submitLabel: `Update ${group.size} record${group.size === 1 ? '' : 's'}`,
            intro: 'These details are stored on each child\u2019s record and will be updated on all of them.',
            fields: [
                { name: 'guardianName', label: 'Guardian name', required: true, width: 'half', value: group.guardianName },
                {
                    name: 'guardianRelation', label: 'Relationship', type: 'select', width: 'half',
                    value: group.guardianRelation, placeholder: false,
                    options: ['Mother', 'Father', 'Grandparent', 'Guardian'].map((r) => ({ value: r, label: r }))
                },
                { name: 'guardianPhone', label: 'Phone', type: 'tel', required: true, width: 'half', value: group.phone },
                { name: 'guardianEmail', label: 'Email', type: 'email', width: 'half', value: group.email },
                { name: 'alternatePhone', label: 'Emergency contact', type: 'tel', width: 'half', value: group.alternatePhone },
                { name: 'address', label: 'Address', type: 'textarea', rows: 2, value: group.address }
            ],
            onSubmit: async (values) => {
                for (const child of group.children) {
                    await updateStudent(child.id, values);
                }
                return values;
            }
        });

        if (done) {
            toast.success(`Contact details updated on ${group.size} record${group.size === 1 ? '' : 's'}.`);
            await this.load();
        }
    }

    exportDirectory() {
        const rows = this.table.processed.map((group) => ({
            Guardian: group.guardianName,
            Relationship: group.guardianRelation,
            Phone: group.phone || '',
            Email: group.email || '',
            'Emergency contact': group.alternatePhone || '',
            Children: group.children.map((c) => c.name).join('; '),
            'Children count': group.size,
            Outstanding: group.outstanding / 100,
            Address: group.address || ''
        }));

        downloadCSV(`natyam-parents-${localDate()}`, rows);
        toast.success(`${rows.length} households exported.`);
    }
}

