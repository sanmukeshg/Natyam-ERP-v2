/**
 * NATYAM ERP — Curriculum & academic structure (Phase 2)
 *
 * A curriculum is a named, coded course of study with a configurable
 * Level → Stage → Lesson tree. It is independent of batches: assigning a
 * student to a curriculum (done from the student profile) says nothing about
 * which class they attend, and vice versa.
 *
 * The list view carries two tabs — the curricula themselves, and the reusable
 * level vocabulary. Opening a curriculum shows its detail with the structure
 * editor, where levels are drawn from that vocabulary and stages and lessons
 * are added, renamed, reordered and removed in place.
 */

import { Page, router } from '../../core/router.js';
import { html, render, raw, on } from '../../utils/dom.js';
import { icon } from '../../ui/icons.js';
import { toast } from '../../ui/toast.js';
import { DataTable } from '../../ui/table.js';
import { formOverlay, optionsFrom, summaryList } from '../../ui/form.js';
import { confirm } from '../../ui/overlay.js';
import { session } from '../../core/session.js';
import { CURRICULUM_STATUS, DURATION_UNITS } from '../../config/app.config.js';
import {
    listCurricula, curriculumDetail, createCurriculum, updateCurriculum, setCurriculumStatus,
    listCurriculumLevels, createCurriculumLevel, updateCurriculumLevel, setCurriculumLevelStatus,
    addLevelToCurriculum, removeLevelFromCurriculum,
    addStage, updateStage, removeStage, addLesson, updateLesson, removeLesson, moveNode
} from '../../services/curriculum.service.js';

const STATUS_BADGE = {
    [CURRICULUM_STATUS.ACTIVE]: 'badge-success',
    [CURRICULUM_STATUS.INACTIVE]: 'badge-neutral'
};

/** "12 months" / "2 years" / "—" for a curriculum's duration. */
function durationText(c) {
    if (c.durationValue == null || c.durationValue === '') return '—';
    const unit = c.durationUnit || 'months';
    const value = Number(c.durationValue);
    const label = value === 1 ? unit.replace(/s$/, '') : unit;
    return `${value} ${label}`;
}

export default class CurriculumPage extends Page {
    constructor(context) {
        super(context);
        this.title = 'Curriculum';
        this.tab = this.query.tab === 'levels' ? 'levels' : 'curricula';
        this.canManage = session.can('settings.edit');
    }

    async render(container) {
        this.container = container;
        if (this.params.id) {
            await this.renderDetail(this.params.id);
        } else {
            await this.renderList();
        }
    }

    /* ==================================================================== LIST */

    async renderList() {
        render(this.container, this.listShell());
        this.bindList();
        this.buildTable();
        await this.loadTab();
    }

    listShell() {
        const onCurricula = this.tab === 'curricula';
        const onLevels = this.tab === 'levels';
        return html`
            <header class="page-header">
                <div class="page-header-text">
                    <h1 class="page-title">Curriculum</h1>
                    <p class="page-subtitle">
                        Courses of study and their Level → Stage → Lesson structure. Independent of batches.
                    </p>
                </div>
                <div class="page-actions" data-role="actions"></div>
            </header>
            <div class="page-body">
                <div class="tabs" role="tablist">
                    <button class="tab ${onCurricula ? 'is-active' : ''}" role="tab"
                            aria-selected="${onCurricula}" data-tab="curricula">Curricula</button>
                    <button class="tab ${onLevels ? 'is-active' : ''}" role="tab"
                            aria-selected="${onLevels}" data-tab="levels">Levels</button>
                </div>
                <div data-role="panel"></div>
            </div>
        `;
    }

    bindList() {
        this.onDispose(on(this.container, 'click', '[data-tab]', (_e, target) => {
            this.tab = target.dataset.tab;
            this.container.querySelectorAll('[data-tab]').forEach((node) => {
                const active = node.dataset.tab === this.tab;
                node.classList.toggle('is-active', active);
                node.setAttribute('aria-selected', String(active));
            });
            this.loadTab();
        }));
        this.onDispose(on(this.container, 'click', '[data-action]', (event, target) => {
            this.dispatch(target.dataset.action, target.dataset, event);
        }));
    }

    renderActions() {
        const slot = this.container.querySelector('[data-role="actions"]');
        if (!slot) return;
        if (!this.canManage) { render(slot, html``); return; }
        render(slot, this.tab === 'curricula'
            ? html`<button class="btn btn-primary btn-sm" data-action="new-curriculum">
                       ${raw(icon('plus', { size: 15 }))} New curriculum
                   </button>`
            : html`<button class="btn btn-primary btn-sm" data-action="new-level">
                       ${raw(icon('plus', { size: 15 }))} New level
                   </button>`);
    }

    async loadTab() {
        this.renderActions();
        const panel = this.container.querySelector('[data-role="panel"]');
        if (this.tab === 'levels') {
            render(panel, await this.levelsPanel());
        } else {
            render(panel, html`<div data-role="table"></div>`);
            this.table.mount(panel.querySelector('[data-role="table"]'));
            await this.loadCurricula();
        }
    }

    buildTable() {
        this.table = new DataTable({
            rows: [],
            searchPlaceholder: 'Search curriculum or code…',
            defaultSort: 'sortOrder',
            defaultSortDir: 'asc',
            emptyTitle: 'No curricula yet',
            emptyMessage: 'A curriculum defines a course of study and its Level → Stage → Lesson structure.',
            emptyIcon: 'file-text',
            emptyAction: this.canManage ? { label: 'Create one', onClick: () => this.newCurriculum() } : null,
            onRowClick: (row) => router.go(`/curriculum/${row.id}`),
            columns: [
                {
                    key: 'name', label: 'Curriculum', sortable: true,
                    searchValue: (row) => `${row.name} ${row.code}`,
                    render: (row) => html`
                        <div>
                            <span class="type-strong">${row.name}</span>
                            <div class="type-caption type-muted">${row.code}</div>
                        </div>
                    `
                },
                {
                    key: 'duration', label: 'Duration', sortable: false,
                    render: (row) => html`<span>${durationText(row)}</span>`
                },
                {
                    key: 'structure', label: 'Structure', sortable: false,
                    render: (row) => html`
                        <span class="type-caption type-muted">
                            ${row.counts.levels} level${row.counts.levels === 1 ? '' : 's'} ·
                            ${row.counts.stages} stage${row.counts.stages === 1 ? '' : 's'} ·
                            ${row.counts.lessons} lesson${row.counts.lessons === 1 ? '' : 's'}
                        </span>
                    `
                },
                {
                    key: 'sortOrder', label: 'Order', align: 'right', sortable: true,
                    render: (row) => html`<span class="text-subtle">${row.sortOrder}</span>`
                },
                {
                    key: 'status', label: 'Status', sortable: true,
                    render: (row) => html`<span class="badge ${STATUS_BADGE[row.status] || 'badge-neutral'}">
                        ${row.status === CURRICULUM_STATUS.ACTIVE ? 'Active' : 'Inactive'}</span>`
                }
            ]
        });
    }

    async loadCurricula() {
        const rows = await listCurricula();
        this.table.setRows(rows);
    }

    async levelsPanel() {
        const levels = await listCurriculumLevels();
        return html`
            <div class="card">
                <div class="card-header">
                    <h2 class="card-title">Levels</h2>
                    <p class="card-subtitle">
                        The shared vocabulary every curriculum draws on. Rename, reorder, retire or add —
                        no code change needed.
                    </p>
                </div>
                <div class="card-body card-body-flush">
                    ${levels.length ? html`
                        <div class="table-wrap"><table class="table">
                            <thead><tr>
                                <th scope="col">Order</th><th scope="col">Level</th>
                                <th scope="col">Code</th><th scope="col">Status</th><th scope="col"></th>
                            </tr></thead>
                            <tbody>
                                ${levels.map((level, index) => html`
                                    <tr>
                                        <td class="text-subtle">${level.sortOrder}</td>
                                        <th scope="row">${level.name}</th>
                                        <td class="type-caption type-muted">${level.code}</td>
                                        <td>${level.status === CURRICULUM_STATUS.ACTIVE
                                            ? html`<span class="badge badge-success">Active</span>`
                                            : html`<span class="badge badge-neutral">Retired</span>`}</td>
                                        <td class="text-right">
                                            ${this.canManage ? html`
                                                <button class="btn btn-sm btn-ghost" data-action="move-level"
                                                        data-id="${level.id}" data-dir="-1" ${index === 0 ? 'disabled' : ''}
                                                        aria-label="Move up">${raw(icon('chevron-up', { size: 15 }))}</button>
                                                <button class="btn btn-sm btn-ghost" data-action="move-level"
                                                        data-id="${level.id}" data-dir="1" ${index === levels.length - 1 ? 'disabled' : ''}
                                                        aria-label="Move down">${raw(icon('chevron-down', { size: 15 }))}</button>
                                                <button class="btn btn-sm btn-ghost" data-action="edit-level"
                                                        data-id="${level.id}">Edit</button>
                                                <button class="btn btn-sm btn-ghost" data-action="toggle-level"
                                                        data-id="${level.id}" data-status="${level.status}">
                                                    ${level.status === CURRICULUM_STATUS.ACTIVE ? 'Retire' : 'Restore'}</button>
                                            ` : ''}
                                        </td>
                                    </tr>
                                `)}
                            </tbody>
                        </table></div>
                    ` : html`<div class="empty empty-compact"><p class="empty-text">No levels defined.</p></div>`}
                </div>
            </div>
        `;
    }

    /* ================================================================== DETAIL */

    async renderDetail(id) {
        let data;
        try {
            data = await curriculumDetail(id);
        } catch (err) {
            render(this.container, this.notFound(err));
            this.onDispose(on(this.container, 'click', '[data-action="back"]', () => router.go('/curriculum')));
            return;
        }
        this.detail = data;
        render(this.container, this.detailShell(data));
        this.onDispose(on(this.container, 'click', '[data-action]', (event, target) => {
            this.dispatch(target.dataset.action, target.dataset, event);
        }));
    }

    detailShell(c) {
        const levelOptions = c.structure.levels;
        return html`
            <header class="page-header">
                <div class="page-header-text">
                    <button class="btn btn-ghost btn-sm" data-action="back">
                        ${raw(icon('arrow-left', { size: 15 }))} Curriculum
                    </button>
                    <h1 class="page-title">${c.name}</h1>
                    <p class="page-subtitle">
                        <span class="badge ${STATUS_BADGE[c.status] || 'badge-neutral'}">
                            ${c.status === CURRICULUM_STATUS.ACTIVE ? 'Active' : 'Inactive'}</span>
                        · ${c.code} · ${durationText(c)}
                        · ${c.assignedStudents} student${c.assignedStudents === 1 ? '' : 's'} assigned
                    </p>
                </div>
                ${this.canManage ? html`
                    <div class="page-actions">
                        <button class="btn btn-sm" data-action="edit-curriculum">Edit details</button>
                        <button class="btn btn-sm btn-ghost" data-action="toggle-curriculum" data-status="${c.status}">
                            ${c.status === CURRICULUM_STATUS.ACTIVE ? 'Retire' : 'Restore'}
                        </button>
                    </div>
                ` : ''}
            </header>
            <div class="page-body">
                <div class="card">
                    <div class="card-body">
                        ${summaryList([
                            ['Code', c.code],
                            ['Name', c.name],
                            ['Description', c.description],
                            ['Duration', durationText(c)],
                            ['Sort order', String(c.sortOrder)],
                            ['Students assigned', String(c.assignedStudents)]
                        ])}
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <h2 class="card-title">Structure</h2>
                        <p class="card-subtitle">Levels drawn from the shared vocabulary; stages and lessons defined here.</p>
                        ${this.canManage ? html`
                            <div class="card-actions">
                                <button class="btn btn-sm btn-primary" data-action="add-level">
                                    ${raw(icon('plus', { size: 15 }))} Add level
                                </button>
                            </div>
                        ` : ''}
                    </div>
                    <div class="card-body">
                        ${levelOptions.length ? this.tree(levelOptions) : html`
                            <div class="empty empty-compact">
                                <p class="empty-text">No structure yet. Add a level to begin.</p>
                            </div>
                        `}
                    </div>
                </div>
            </div>
        `;
    }

    tree(levels) {
        return html`
            <div class="tree">
                ${levels.map((level, li) => html`
                    <div class="tree-level">
                        <div class="tree-row tree-row-level">
                            <span class="type-strong">${level.levelName}</span>
                            ${level.levelRetired ? html`<span class="badge badge-neutral">retired level</span>` : ''}
                            ${this.canManage ? html`
                                <span class="tree-actions">
                                    ${this.moveButtons('level', level.id, li === 0, li === levels.length - 1)}
                                    <button class="btn btn-sm btn-ghost" data-action="add-stage" data-id="${level.id}">Add stage</button>
                                    <button class="btn btn-sm btn-ghost" data-action="remove-level" data-id="${level.id}"
                                            aria-label="Remove level">${raw(icon('x-circle', { size: 15 }))}</button>
                                </span>
                            ` : ''}
                        </div>
                        <div class="tree-children">
                            ${(level.stages || []).length ? (level.stages || []).map((stage, si) => html`
                                <div class="tree-stage">
                                    <div class="tree-row tree-row-stage">
                                        <span>${stage.name}</span>
                                        ${this.canManage ? html`
                                            <span class="tree-actions">
                                                ${this.moveButtons('stage', stage.id, si === 0, si === level.stages.length - 1)}
                                                <button class="btn btn-sm btn-ghost" data-action="add-lesson" data-id="${stage.id}">Add lesson</button>
                                                <button class="btn btn-sm btn-ghost" data-action="edit-stage" data-id="${stage.id}"
                                                        data-name="${stage.name}">Rename</button>
                                                <button class="btn btn-sm btn-ghost" data-action="remove-stage" data-id="${stage.id}"
                                                        aria-label="Remove stage">${raw(icon('x-circle', { size: 15 }))}</button>
                                            </span>
                                        ` : ''}
                                    </div>
                                    <div class="tree-children">
                                        ${(stage.lessons || []).length ? (stage.lessons || []).map((lesson, lsi) => html`
                                            <div class="tree-row tree-row-lesson">
                                                <span>${lesson.name}</span>
                                                ${this.canManage ? html`
                                                    <span class="tree-actions">
                                                        ${this.moveButtons('lesson', lesson.id, lsi === 0, lsi === stage.lessons.length - 1)}
                                                        <button class="btn btn-sm btn-ghost" data-action="edit-lesson" data-id="${lesson.id}"
                                                                data-name="${lesson.name}">Rename</button>
                                                        <button class="btn btn-sm btn-ghost" data-action="remove-lesson" data-id="${lesson.id}"
                                                                aria-label="Remove lesson">${raw(icon('x-circle', { size: 15 }))}</button>
                                                    </span>
                                                ` : ''}
                                            </div>
                                        `) : html`<p class="type-caption type-muted tree-empty">No lessons yet.</p>`}
                                    </div>
                                </div>
                            `) : html`<p class="type-caption type-muted tree-empty">No stages yet.</p>`}
                        </div>
                    </div>
                `)}
            </div>
        `;
    }

    moveButtons(kind, id, isFirst, isLast) {
        return html`
            <button class="btn btn-sm btn-ghost" data-action="move" data-kind="${kind}" data-id="${id}" data-dir="-1"
                    ${isFirst ? 'disabled' : ''} aria-label="Move up">${raw(icon('chevron-up', { size: 14 }))}</button>
            <button class="btn btn-sm btn-ghost" data-action="move" data-kind="${kind}" data-id="${id}" data-dir="1"
                    ${isLast ? 'disabled' : ''} aria-label="Move down">${raw(icon('chevron-down', { size: 14 }))}</button>
        `;
    }

    notFound(err) {
        return html`
            <header class="page-header">
                <div class="page-header-text">
                    <button class="btn btn-ghost btn-sm" data-action="back">
                        ${raw(icon('arrow-left', { size: 15 }))} Curriculum
                    </button>
                    <h1 class="page-title">Curriculum not found</h1>
                </div>
            </header>
            <div class="page-body">
                <div class="alert alert-danger">
                    <div class="alert-title">This curriculum could not be opened</div>
                    <p class="alert-body">${err.message}</p>
                </div>
            </div>
        `;
    }

    /* ================================================================ ACTIONS */

    async dispatch(action, dataset, event) {
        if (event) event.stopPropagation();
        const id = this.params.id;
        const handlers = {
            'new-curriculum': () => this.newCurriculum(),
            'edit-curriculum': () => this.editCurriculum(this.detail),
            'toggle-curriculum': () => this.toggleCurriculum(id, dataset.status),
            'new-level': () => this.editLevel(null),
            'edit-level': () => this.editLevelById(dataset.id),
            'toggle-level': () => this.toggleLevel(dataset.id, dataset.status),
            'move-level': () => this.moveLevelVocab(dataset.id, Number(dataset.dir)),
            'add-level': () => this.addLevel(id),
            'remove-level': () => this.removeLevel(id, dataset.id),
            'add-stage': () => this.addStage(id, dataset.id),
            'edit-stage': () => this.renameNode('stage', id, dataset.id, dataset.name),
            'remove-stage': () => this.removeNode('stage', id, dataset.id),
            'add-lesson': () => this.addLesson(id, dataset.id),
            'edit-lesson': () => this.renameNode('lesson', id, dataset.id, dataset.name),
            'remove-lesson': () => this.removeNode('lesson', id, dataset.id),
            'move': () => this.move(id, dataset.kind, dataset.id, Number(dataset.dir)),
            back: () => router.go('/curriculum')
        };
        try {
            await handlers[action]?.();
        } catch (err) {
            toast.error(err.message);
        }
    }

    /* ---- curricula ---- */

    async newCurriculum() {
        const saved = await formOverlay({
            title: 'New curriculum',
            fields: this.curriculumFields(),
            onSubmit: (values) => createCurriculum(values)
        });
        if (saved) {
            toast.success('Curriculum created.');
            router.go(`/curriculum/${saved.id}`);
        }
    }

    async editCurriculum(existing) {
        const saved = await formOverlay({
            title: 'Edit curriculum',
            fields: this.curriculumFields(existing),
            onSubmit: (values) => updateCurriculum(existing.id, values)
        });
        if (saved) {
            toast.success('Curriculum updated.');
            await this.renderDetail(existing.id);
        }
    }

    curriculumFields(existing = null) {
        return [
            { name: 'name', label: 'Name', required: true, value: existing?.name, placeholder: 'Kuchipudi Foundation' },
            { name: 'code', label: 'Code', required: true, width: 'half', value: existing?.code, placeholder: 'KUCHI-FND',
              hint: 'A short unique code.' },
            { name: 'sortOrder', label: 'Sort order', type: 'number', width: 'half', value: existing?.sortOrder },
            { name: 'description', label: 'Description', type: 'textarea', value: existing?.description,
              placeholder: 'What this course of study covers.' },
            { name: 'durationValue', label: 'Duration', type: 'number', width: 'half', value: existing?.durationValue,
              placeholder: '12' },
            { name: 'durationUnit', label: 'Unit', type: 'select', width: 'half',
              value: existing?.durationUnit || 'months', options: DURATION_UNITS },
            ...(existing ? [{
                name: 'status', label: 'Status', type: 'select', value: existing.status,
                options: [
                    { value: CURRICULUM_STATUS.ACTIVE, label: 'Active' },
                    { value: CURRICULUM_STATUS.INACTIVE, label: 'Inactive' }
                ]
            }] : [])
        ];
    }

    async toggleCurriculum(id, status) {
        const next = status === CURRICULUM_STATUS.ACTIVE ? CURRICULUM_STATUS.INACTIVE : CURRICULUM_STATUS.ACTIVE;
        await setCurriculumStatus(id, next);
        toast.success(next === CURRICULUM_STATUS.ACTIVE ? 'Curriculum restored.' : 'Curriculum retired.');
        await this.renderDetail(id);
    }

    /* ---- levels (vocabulary) ---- */

    async editLevel(existing) {
        const saved = await formOverlay({
            title: existing ? 'Edit level' : 'New level',
            variant: 'modal',
            size: 'sm',
            fields: [
                { name: 'name', label: 'Name', required: true, value: existing?.name, placeholder: 'Beginner' },
                { name: 'code', label: 'Code', width: 'half', value: existing?.code, placeholder: 'BEGINNER',
                  hint: 'Optional — generated from the name if left blank.' },
                { name: 'sortOrder', label: 'Sort order', type: 'number', width: 'half', value: existing?.sortOrder }
            ],
            onSubmit: (values) => existing ? updateCurriculumLevel(existing.id, values) : createCurriculumLevel(values)
        });
        if (saved) {
            toast.success(existing ? 'Level updated.' : 'Level added.');
            await this.loadTab();
        }
    }

    async editLevelById(id) {
        const levels = await listCurriculumLevels();
        const level = levels.find((l) => l.id === id);
        if (level) await this.editLevel(level);
    }

    async toggleLevel(id, status) {
        const next = status === CURRICULUM_STATUS.ACTIVE ? CURRICULUM_STATUS.INACTIVE : CURRICULUM_STATUS.ACTIVE;
        await setCurriculumLevelStatus(id, next);
        toast.success(next === CURRICULUM_STATUS.ACTIVE ? 'Level restored.' : 'Level retired.');
        await this.loadTab();
    }

    async moveLevelVocab(id, dir) {
        // Reorder the shared vocabulary by swapping sort order with the neighbour.
        const levels = await listCurriculumLevels();
        const index = levels.findIndex((l) => l.id === id);
        const swap = index + dir;
        if (index < 0 || swap < 0 || swap >= levels.length) return;
        const a = levels[index], b = levels[swap];
        await updateCurriculumLevel(a.id, { sortOrder: b.sortOrder });
        await updateCurriculumLevel(b.id, { sortOrder: a.sortOrder });
        await this.loadTab();
    }

    /* ---- structure ---- */

    async addLevel(curriculumId) {
        const all = await listCurriculumLevels({ includeInactive: false });
        const used = new Set(this.detail.structure.levels.map((l) => l.levelId));
        const available = all.filter((l) => !used.has(l.id));
        if (!available.length) {
            toast.info('Every active level is already in this curriculum. Add a new level under the Levels tab.');
            return;
        }
        const saved = await formOverlay({
            title: 'Add a level',
            variant: 'modal',
            size: 'sm',
            fields: [{
                name: 'levelId', label: 'Level', type: 'select', required: true,
                options: optionsFrom(available, { label: (l) => l.name })
            }],
            onSubmit: (values) => addLevelToCurriculum(curriculumId, values.levelId)
        });
        if (saved) {
            toast.success('Level added.');
            await this.renderDetail(curriculumId);
        }
    }

    async removeLevel(curriculumId, levelNodeId) {
        const ok = await confirm({
            title: 'Remove this level?',
            message: 'Its stages and lessons will be removed from this curriculum. The level itself stays in the vocabulary.',
            confirmLabel: 'Remove',
            danger: true
        });
        if (!ok) return;
        await removeLevelFromCurriculum(curriculumId, levelNodeId);
        toast.success('Level removed.');
        await this.renderDetail(curriculumId);
    }

    async addStage(curriculumId, levelNodeId) {
        const saved = await this.namePrompt('Add a stage', 'Stage name', 'e.g. Adavus');
        if (saved == null) return;
        await addStage(curriculumId, levelNodeId, { name: saved });
        toast.success('Stage added.');
        await this.renderDetail(curriculumId);
    }

    async addLesson(curriculumId, stageId) {
        const saved = await this.namePrompt('Add a lesson', 'Lesson name', 'e.g. Tatta Adavu');
        if (saved == null) return;
        await addLesson(curriculumId, stageId, { name: saved });
        toast.success('Lesson added.');
        await this.renderDetail(curriculumId);
    }

    async renameNode(kind, curriculumId, nodeId, current) {
        const saved = await this.namePrompt(`Rename ${kind}`, `${kind[0].toUpperCase()}${kind.slice(1)} name`, '', current);
        if (saved == null) return;
        if (kind === 'stage') await updateStage(curriculumId, nodeId, { name: saved });
        else await updateLesson(curriculumId, nodeId, { name: saved });
        toast.success('Renamed.');
        await this.renderDetail(curriculumId);
    }

    async removeNode(kind, curriculumId, nodeId) {
        const ok = await confirm({
            title: `Remove this ${kind}?`,
            message: kind === 'stage' ? 'Its lessons will be removed too.' : 'This lesson will be removed.',
            confirmLabel: 'Remove',
            danger: true
        });
        if (!ok) return;
        if (kind === 'stage') await removeStage(curriculumId, nodeId);
        else await removeLesson(curriculumId, nodeId);
        toast.success('Removed.');
        await this.renderDetail(curriculumId);
    }

    async move(curriculumId, kind, nodeId, dir) {
        await moveNode(curriculumId, kind, nodeId, dir);
        await this.renderDetail(curriculumId);
    }

    async namePrompt(title, label, placeholder = '', value = '') {
        let result = null;
        await formOverlay({
            title,
            variant: 'modal',
            size: 'sm',
            fields: [{ name: 'name', label, required: true, value, placeholder }],
            onSubmit: (values) => { result = String(values.name || '').trim(); return true; }
        });
        return result;
    }
}
