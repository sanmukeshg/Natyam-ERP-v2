/**
 * Curriculum & academic structure (Phase 2).
 *
 * A curriculum is a named, coded course of study with a configurable
 * Level → Stage → Lesson tree. It is deliberately independent of batches: a
 * student's curriculum (what they are learning) and their batch (which class
 * they attend) are separate assignments, and neither references the other.
 *
 * The level vocabulary (Beginner / Intermediate / Advanced, extensible) lives
 * in its own store so a school can rename, reorder, retire or add levels
 * without a code change. Each curriculum's structure references those levels
 * and caches the name it was added under, so a later rename never orphans a
 * tree and a retired level still reads correctly on an existing curriculum.
 *
 * The whole structure tree is saved as one document on the curriculum record —
 * editing it is therefore atomic, which suits an offline-first store.
 */

import { session } from '../core/session.js';
import { uid } from '../utils/id.js';
import { CURRICULUM_STATUS, CAPABILITIES } from '../config/app.config.js';
import { curricula$, curriculumLevels$, students$ } from '../data/repositories.js';

const MANAGE = CAPABILITIES.SETTINGS_EDIT; // curriculum structure is academic configuration

/* ==========================================================================
   LEVELS — the reusable, editable vocabulary
   ========================================================================== */

export async function listCurriculumLevels({ includeInactive = true } = {}) {
    const rows = includeInactive ? await curriculumLevels$.ordered() : await curriculumLevels$.active();
    return rows;
}

export async function createCurriculumLevel(data) {
    session.require(MANAGE, 'add a curriculum level');
    const nextOrder = data.sortOrder ?? (await nextLevelOrder());
    return curriculumLevels$.create({
        name: data.name,
        code: data.code || slug(data.name),
        sortOrder: nextOrder,
        status: data.status || CURRICULUM_STATUS.ACTIVE
    });
}

export async function updateCurriculumLevel(id, changes) {
    session.require(MANAGE, 'edit a curriculum level');
    return curriculumLevels$.update(id, changes);
}

export async function setCurriculumLevelStatus(id, status) {
    session.require(MANAGE, 'change a curriculum level');
    return curriculumLevels$.update(id, { status });
}

async function nextLevelOrder() {
    const rows = await curriculumLevels$.all();
    return rows.reduce((max, r) => Math.max(max, Number(r.sortOrder) || 0), 0) + 1;
}

/* ==========================================================================
   CURRICULA
   ========================================================================== */

export async function listCurricula({ includeInactive = true } = {}) {
    const rows = includeInactive ? await curricula$.ordered() : await curricula$.active();
    return rows.map((c) => ({ ...c, counts: structureCounts(c.structure) }));
}

/**
 * A curriculum with its structure resolved for display: every level node
 * carries the level's current name, and the tree is returned in sort order.
 */
export async function curriculumDetail(id) {
    const curriculum = await curricula$.findOrFail(id);
    const levels = await curriculumLevels$.all();
    const byId = new Map(levels.map((l) => [l.id, l]));

    const structure = normaliseStructure(curriculum.structure);
    const resolvedLevels = [...structure.levels]
        .sort(bySortOrder)
        .map((node) => {
            const level = byId.get(node.levelId);
            return {
                ...node,
                levelName: level?.name || node.levelName || 'Removed level',
                levelRetired: level ? level.status !== CURRICULUM_STATUS.ACTIVE : true,
                stages: [...(node.stages || [])]
                    .sort(bySortOrder)
                    .map((stage) => ({
                        ...stage,
                        lessons: [...(stage.lessons || [])].sort(bySortOrder)
                    }))
            };
        });

    const assignedStudents = await curriculumUsage(id);
    return { ...curriculum, structure: { levels: resolvedLevels }, counts: structureCounts(curriculum.structure), assignedStudents };
}

export async function createCurriculum(data) {
    session.require(MANAGE, 'create a curriculum');
    const nextOrder = data.sortOrder ?? (await nextCurriculumOrder());
    return curricula$.create({
        code: data.code,
        name: data.name,
        description: data.description || null,
        durationValue: data.durationValue != null ? Number(data.durationValue) : null,
        durationUnit: data.durationUnit || 'months',
        sortOrder: nextOrder,
        status: data.status || CURRICULUM_STATUS.ACTIVE,
        structure: { levels: [] }
    });
}

export async function updateCurriculum(id, changes) {
    session.require(MANAGE, 'edit a curriculum');
    // Metadata only — the structure has its own dedicated operations so a
    // metadata edit can never accidentally clear the tree.
    const { structure, ...metadata } = changes;
    if (metadata.durationValue != null) metadata.durationValue = Number(metadata.durationValue) || null;
    return curricula$.update(id, metadata);
}

export async function setCurriculumStatus(id, status) {
    session.require(MANAGE, 'change a curriculum');
    return curricula$.update(id, { status });
}

/** How many students are assigned to this curriculum (assignment is on the student). */
async function curriculumUsage(id) {
    return (await students$.where('curriculumId', id)).length;
}

async function nextCurriculumOrder() {
    const rows = await curricula$.all();
    return rows.reduce((max, r) => Math.max(max, Number(r.sortOrder) || 0), 0) + 1;
}

/* ==========================================================================
   STRUCTURE — Level → Stage → Lesson, saved atomically on the curriculum
   ========================================================================== */

export async function addLevelToCurriculum(curriculumId, levelId) {
    session.require(MANAGE, 'add a level to a curriculum');
    const level = await curriculumLevels$.findOrFail(levelId);
    return mutateStructure(curriculumId, (structure) => {
        if (structure.levels.some((l) => l.levelId === levelId)) {
            throw new Error(`${level.name} is already in this curriculum.`);
        }
        structure.levels.push({
            id: uid('CLN'),
            levelId,
            levelName: level.name,
            sortOrder: nextOrder(structure.levels),
            stages: []
        });
    });
}

export async function removeLevelFromCurriculum(curriculumId, levelNodeId) {
    session.require(MANAGE, 'remove a level from a curriculum');
    return mutateStructure(curriculumId, (structure) => {
        structure.levels = structure.levels.filter((l) => l.id !== levelNodeId);
    });
}

export async function addStage(curriculumId, levelNodeId, { name }) {
    session.require(MANAGE, 'add a stage');
    return mutateStructure(curriculumId, (structure) => {
        const level = findNode(structure.levels, levelNodeId);
        if (!level) throw new Error('That level is no longer in this curriculum.');
        level.stages = level.stages || [];
        level.stages.push({ id: uid('STG'), name: cleanName(name, 'stage'), sortOrder: nextOrder(level.stages), lessons: [] });
    });
}

export async function updateStage(curriculumId, stageId, { name }) {
    session.require(MANAGE, 'rename a stage');
    return mutateStructure(curriculumId, (structure) => {
        const stage = findStage(structure, stageId);
        if (!stage) throw new Error('That stage no longer exists.');
        stage.name = cleanName(name, 'stage');
    });
}

export async function removeStage(curriculumId, stageId) {
    session.require(MANAGE, 'remove a stage');
    return mutateStructure(curriculumId, (structure) => {
        for (const level of structure.levels) {
            level.stages = (level.stages || []).filter((s) => s.id !== stageId);
        }
    });
}

export async function addLesson(curriculumId, stageId, { name }) {
    session.require(MANAGE, 'add a lesson');
    return mutateStructure(curriculumId, (structure) => {
        const stage = findStage(structure, stageId);
        if (!stage) throw new Error('That stage no longer exists.');
        stage.lessons = stage.lessons || [];
        stage.lessons.push({ id: uid('LSN'), name: cleanName(name, 'lesson'), sortOrder: nextOrder(stage.lessons) });
    });
}

export async function updateLesson(curriculumId, lessonId, { name }) {
    session.require(MANAGE, 'rename a lesson');
    return mutateStructure(curriculumId, (structure) => {
        const lesson = findLesson(structure, lessonId);
        if (!lesson) throw new Error('That lesson no longer exists.');
        lesson.name = cleanName(name, 'lesson');
    });
}

export async function removeLesson(curriculumId, lessonId) {
    session.require(MANAGE, 'remove a lesson');
    return mutateStructure(curriculumId, (structure) => {
        for (const level of structure.levels) {
            for (const stage of (level.stages || [])) {
                stage.lessons = (stage.lessons || []).filter((l) => l.id !== lessonId);
            }
        }
    });
}

/**
 * Reorders a node among its siblings. `kind` is 'level' | 'stage' | 'lesson';
 * `direction` is -1 (up) or +1 (down). Swaps sortOrder with the neighbour.
 */
export async function moveNode(curriculumId, kind, nodeId, direction) {
    session.require(MANAGE, 'reorder the curriculum');
    return mutateStructure(curriculumId, (structure) => {
        const siblings = siblingsOf(structure, kind, nodeId);
        if (!siblings) return;
        const sorted = [...siblings].sort(bySortOrder);
        const index = sorted.findIndex((n) => n.id === nodeId);
        const swapWith = index + direction;
        if (index < 0 || swapWith < 0 || swapWith >= sorted.length) return;
        const a = sorted[index];
        const b = sorted[swapWith];
        const tmp = a.sortOrder;
        a.sortOrder = b.sortOrder;
        b.sortOrder = tmp;
    });
}

/* ------------------------------------------------------------------ INTERNAL */

async function mutateStructure(curriculumId, mutator) {
    const curriculum = await curricula$.findOrFail(curriculumId);
    const structure = normaliseStructure(curriculum.structure);
    mutator(structure);
    return curricula$.update(curriculumId, { structure });
}

function normaliseStructure(structure) {
    const levels = Array.isArray(structure?.levels) ? structure.levels : [];
    return {
        levels: levels.map((l) => ({
            ...l,
            stages: Array.isArray(l.stages) ? l.stages.map((s) => ({
                ...s,
                lessons: Array.isArray(s.lessons) ? s.lessons : []
            })) : []
        }))
    };
}

function structureCounts(structure) {
    const s = normaliseStructure(structure);
    let stages = 0, lessons = 0;
    for (const level of s.levels) {
        stages += (level.stages || []).length;
        for (const stage of (level.stages || [])) lessons += (stage.lessons || []).length;
    }
    return { levels: s.levels.length, stages, lessons };
}

function findNode(list, id) { return list.find((n) => n.id === id) || null; }

function findStage(structure, stageId) {
    for (const level of structure.levels) {
        const stage = (level.stages || []).find((s) => s.id === stageId);
        if (stage) return stage;
    }
    return null;
}

function findLesson(structure, lessonId) {
    for (const level of structure.levels) {
        for (const stage of (level.stages || [])) {
            const lesson = (stage.lessons || []).find((l) => l.id === lessonId);
            if (lesson) return lesson;
        }
    }
    return null;
}

function siblingsOf(structure, kind, nodeId) {
    if (kind === 'level') return structure.levels;
    if (kind === 'stage') {
        const level = structure.levels.find((l) => (l.stages || []).some((s) => s.id === nodeId));
        return level ? level.stages : null;
    }
    if (kind === 'lesson') {
        for (const level of structure.levels) {
            const stage = (level.stages || []).find((s) => (s.lessons || []).some((l) => l.id === nodeId));
            if (stage) return stage.lessons;
        }
    }
    return null;
}

function nextOrder(list) {
    return (list || []).reduce((max, n) => Math.max(max, Number(n.sortOrder) || 0), 0) + 1;
}

function bySortOrder(a, b) { return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0); }

function cleanName(name, what) {
    const clean = String(name || '').trim();
    if (!clean) throw new Error(`A ${what} needs a name.`);
    return clean;
}

function slug(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'LEVEL';
}
