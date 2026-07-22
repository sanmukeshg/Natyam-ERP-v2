/**
 * Phase 2 verification — Curriculum & academic structure.
 *
 * Reuses the render-QA jsdom + fake-indexeddb harness. Exercises the services
 * and repositories against a real (in-memory) database, and renders the
 * curriculum and settings pages to confirm wiring. jsdom has no layout, so this
 * asserts structure and behaviour, not pixels.
 *
 * Covers: the migration's default level vocabulary; the seeded example
 * curriculum; level and curriculum CRUD; the Level → Stage → Lesson structure
 * operations (add / rename / reorder / remove) and the duplicate-level guard;
 * student ↔ curriculum assignment persisting and staying independent of the
 * batch; and the Academic-Year change in Settings (no standalone tab, a current
 * -year control instead, with history preserved).
 */
import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';

const dom = new JSDOM(
    '<!doctype html><html data-theme="light"><body><div id="app"></div></body></html>',
    { url: 'https://example.org/natyam/', pretendToBeVisual: true }
);
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.Element = window.Element;
globalThis.Event = window.Event;
globalThis.CustomEvent = window.CustomEvent;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
window.matchMedia = globalThis.matchMedia;
globalThis.localStorage = window.localStorage;
globalThis.location = window.location;
Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    value: { estimate: async () => ({ usage: 0, quota: 1 }), persisted: async () => false, persist: async () => true }
});
globalThis.CSS = window.CSS || {};
if (!globalThis.CSS.escape) globalThis.CSS.escape = (v) => String(v).replace(/[^\w-]/g, (c) => `\\${c}`);
window.CSS = globalThis.CSS;

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? (pass++, console.log('  ok  ', name)) : (fail++, console.log('  FAIL', name, extra)); };
const settle = () => new Promise((r) => setTimeout(r, 0));

const BASE = '../js';
const { db } = await import(`${BASE}/core/db.js`);
const { session } = await import(`${BASE}/core/session.js`);
const { seedIfEmpty } = await import(`${BASE}/data/seed.js`);
const { branches$, curricula$, curriculumLevels$, students$ } = await import(`${BASE}/data/repositories.js`);
const { academicYearOf } = await import(`${BASE}/utils/date.js`);
const curriculumSvc = await import(`${BASE}/services/curriculum.service.js`);
const { updateStudent, profile, enrol } = await import(`${BASE}/services/students.service.js`);
const { listAcademicYears } = await import(`${BASE}/services/settings.service.js`);

/* -------------------------------------------------------------------- BOOT */

await db.open();
await seedIfEmpty();
const branches = await branches$.active();
session.hydrate({ user: { id: 'owner', name: 'Principal', role: 'owner' }, branches, activeBranchId: null });
ok('session hydrated as owner', session.can('settings.edit'));

/* ------------------------------------------- migration: default level vocab */
{
    const levels = await curriculumLevels$.ordered();
    const names = levels.map((l) => l.name);
    ok('migration seeded the 13 approved levels', levels.length >= 13, `got ${levels.length}`);
    ok('approved level names are present',
        ['Foundation - Level 1', 'Foundation - Level 8', 'Intermediate - Certificate',
         'Intermediate - Diploma', 'Advanced - Masters', 'Advanced - Theory', 'Advanced - Practical']
            .every((n) => names.includes(n)), names.join(','));
    ok('placeholder levels were removed',
        !names.includes('Beginner') && !names.includes('Advanced'), names.join(','));
    ok('default levels have deterministic ids',
        !!(await curriculumLevels$.find('CLV-FND-1')) && !!(await curriculumLevels$.find('CLV-ADV-MAS')));
}

/* --------------------------------------------------- seed: example curriculum */
{
    const all = await curriculumSvc.listCurricula();
    const example = all.find((c) => c.code === 'KUCHI-FND');
    ok('seed created the example curriculum', !!example);
    ok('example curriculum has a non-trivial structure',
        !!example && example.counts.levels >= 2 && example.counts.stages >= 1 && example.counts.lessons >= 1,
        example && JSON.stringify(example.counts));
}

/* ------------------------------------------------------------- level CRUD */
{
    const created = await curriculumSvc.createCurriculumLevel({ name: 'Diploma' });
    ok('createCurriculumLevel adds a level', !!created?.id);
    ok('new level code is generated and uppercased', created.code === 'DIPLOMA', created.code);

    const updated = await curriculumSvc.updateCurriculumLevel(created.id, { name: 'Diploma (Senior)' });
    ok('updateCurriculumLevel renames', updated.name === 'Diploma (Senior)');

    await curriculumSvc.setCurriculumLevelStatus(created.id, 'inactive');
    const active = await curriculumSvc.listCurriculumLevels({ includeInactive: false });
    ok('retired level is excluded from active list', !active.some((l) => l.id === created.id));
}

/* -------------------------------------------------------- curriculum CRUD */
let curriculumId = null;
{
    const created = await curriculumSvc.createCurriculum({
        name: 'Test Curriculum', code: 'test-crm', description: 'A test.', durationValue: 12, durationUnit: 'months'
    });
    curriculumId = created.id;
    ok('createCurriculum creates a record', !!created?.id);
    ok('curriculum code is uppercased', created.code === 'TEST-CRM', created.code);
    ok('new curriculum starts with an empty structure', (created.structure?.levels || []).length === 0);

    const updated = await curriculumSvc.updateCurriculum(created.id, { name: 'Test Curriculum (v2)', durationValue: 18 });
    ok('updateCurriculum edits metadata', updated.name === 'Test Curriculum (v2)' && updated.durationValue === 18);

    // Metadata update must not disturb an existing structure.
    await curriculumSvc.addLevelToCurriculum(created.id, 'CLV-FND-1');
    await curriculumSvc.updateCurriculum(created.id, { description: 'changed' });
    const afterMeta = await curricula$.find(created.id);
    ok('metadata update leaves the structure intact', (afterMeta.structure.levels || []).length === 1);

    await curriculumSvc.setCurriculumStatus(created.id, 'inactive');
    const active = await curriculumSvc.listCurricula({ includeInactive: false });
    ok('retired curriculum excluded from active list', !active.some((c) => c.id === created.id));
    await curriculumSvc.setCurriculumStatus(created.id, 'active');
}

/* -------------------------------------------- structure: Level→Stage→Lesson */
{
    // Duplicate-level guard.
    let threw = false;
    try { await curriculumSvc.addLevelToCurriculum(curriculumId, 'CLV-FND-1'); }
    catch { threw = true; }
    ok('adding a duplicate level is rejected', threw);

    await curriculumSvc.addLevelToCurriculum(curriculumId, 'CLV-INT-CERT');
    let detail = await curriculumSvc.curriculumDetail(curriculumId);
    ok('two levels present after add', detail.structure.levels.length === 2);
    const firstNode = detail.structure.levels.find((l) => l.levelId === 'CLV-FND-1');

    await curriculumSvc.addStage(curriculumId, firstNode.id, { name: 'Stage A' });
    await curriculumSvc.addStage(curriculumId, firstNode.id, { name: 'Stage B' });
    detail = await curriculumSvc.curriculumDetail(curriculumId);
    let level = detail.structure.levels.find((l) => l.id === firstNode.id);
    ok('stages added under a level', level.stages.length === 2);

    const stageA = level.stages.find((s) => s.name === 'Stage A');
    const stageB = level.stages.find((s) => s.name === 'Stage B');
    ok('stages sort in insertion order', level.stages[0].name === 'Stage A' && level.stages[1].name === 'Stage B');

    // Reorder: move Stage B up; it should now precede Stage A.
    await curriculumSvc.moveNode(curriculumId, 'stage', stageB.id, -1);
    detail = await curriculumSvc.curriculumDetail(curriculumId);
    level = detail.structure.levels.find((l) => l.id === firstNode.id);
    ok('moveNode reorders stages', level.stages[0].name === 'Stage B' && level.stages[1].name === 'Stage A');

    // Lessons.
    await curriculumSvc.addLesson(curriculumId, stageA.id, { name: 'Lesson 1' });
    await curriculumSvc.addLesson(curriculumId, stageA.id, { name: 'Lesson 2' });
    detail = await curriculumSvc.curriculumDetail(curriculumId);
    level = detail.structure.levels.find((l) => l.id === firstNode.id);
    let stage = level.stages.find((s) => s.id === stageA.id);
    ok('lessons added under a stage', stage.lessons.length === 2);

    const lesson1 = stage.lessons.find((l) => l.name === 'Lesson 1');
    await curriculumSvc.updateLesson(curriculumId, lesson1.id, { name: 'Lesson 1 (renamed)' });
    detail = await curriculumSvc.curriculumDetail(curriculumId);
    stage = detail.structure.levels.find((l) => l.id === firstNode.id).stages.find((s) => s.id === stageA.id);
    ok('updateLesson renames a lesson', stage.lessons.some((l) => l.name === 'Lesson 1 (renamed)'));

    await curriculumSvc.removeLesson(curriculumId, lesson1.id);
    detail = await curriculumSvc.curriculumDetail(curriculumId);
    stage = detail.structure.levels.find((l) => l.id === firstNode.id).stages.find((s) => s.id === stageA.id);
    ok('removeLesson removes a lesson', stage.lessons.length === 1);

    await curriculumSvc.removeStage(curriculumId, stageA.id);
    detail = await curriculumSvc.curriculumDetail(curriculumId);
    level = detail.structure.levels.find((l) => l.id === firstNode.id);
    ok('removeStage removes a stage', level.stages.length === 1 && level.stages[0].name === 'Stage B');

    await curriculumSvc.removeLevelFromCurriculum(curriculumId, firstNode.id);
    detail = await curriculumSvc.curriculumDetail(curriculumId);
    ok('removeLevelFromCurriculum removes a level', detail.structure.levels.length === 1);
}

/* ------------------------------------- student assignment, batch-independent */
{
    const all = await students$.all();
    const withBatch = all.find((s) => s.batchId);
    ok('fixture has a student with a batch', !!withBatch);

    // Assign a curriculum to a student that has a batch — batch must be untouched.
    const beforeBatch = withBatch.batchId;
    await updateStudent(withBatch.id, { curriculumId });
    let reloaded = await students$.find(withBatch.id);
    ok('curriculum assignment persists', reloaded.curriculumId === curriculumId);
    ok('assigning a curriculum leaves the batch untouched', reloaded.batchId === beforeBatch);

    // Independence: a student can be enrolled with a curriculum and no batch.
    const { student: fresh } = await enrol({
        name: 'Curriculum Only Student', level: 'foundation-1',
        guardianName: 'Guardian', guardianPhone: '9000000000',
        branchId: branches[0].id, curriculumId
    }, { raiseFees: false });
    ok('a student can hold a curriculum with no batch', fresh.curriculumId === curriculumId && !fresh.batchId);

    // profile() resolves the assigned curriculum.
    const prof = await profile(withBatch.id);
    ok('profile() surfaces the assigned curriculum', prof.curriculum?.id === curriculumId);

    // Clearing the assignment stores null, not a blank string.
    await updateStudent(withBatch.id, { curriculumId: '' });
    reloaded = await students$.find(withBatch.id);
    ok('clearing curriculum stores null', reloaded.curriculumId === null);

    // The by-index lookup used for usage counts works.
    const usersOfCurriculum = await students$.where('curriculumId', curriculumId);
    ok('students are queryable by curriculumId index', usersOfCurriculum.length >= 1);
}

/* --------------------------------------- academic year: settings integration */
{
    const years = await listAcademicYears();
    ok('academic-year history is preserved', years.length >= 1, `${years.length} years`);
    ok('date-derived academic year still resolves', typeof academicYearOf().start === 'number');

    // Render the settings page and inspect its tabs + institute panel.
    const settingsMod = await import(`${BASE}/modules/settings/settings.page.js`);
    const SettingsPage = settingsMod.default;
    const container = document.createElement('div');
    const page = new SettingsPage({ params: {}, query: {}, container });
    await page.render(container);
    await settle();

    const tabLabels = [...container.querySelectorAll('[data-tab]')].map((b) => b.textContent.trim());
    ok('Settings has no standalone "Academic years" tab', !tabLabels.includes('Academic years'), tabLabels.join(','));
    ok('Settings shows a "Current academic year" control',
        container.textContent.includes('Current academic year'));
}

/* ------------------------------------------------- curriculum page renders */
{
    const mod = await import(`${BASE}/modules/curriculum/curriculum.page.js`);
    const CurriculumPage = mod.default;

    const listContainer = document.createElement('div');
    const listPage = new CurriculumPage({ params: {}, query: {}, container: listContainer });
    await listPage.render(listContainer);
    await settle();
    const tabs = [...listContainer.querySelectorAll('[data-tab]')].map((b) => b.dataset.tab);
    ok('curriculum list renders Curricula and Levels tabs',
        tabs.includes('curricula') && tabs.includes('levels'), tabs.join(','));

    const detailContainer = document.createElement('div');
    const detailPage = new CurriculumPage({ params: { id: curriculumId }, query: {}, container: detailContainer });
    await detailPage.render(detailContainer);
    await settle();
    ok('curriculum detail renders the Structure section', detailContainer.textContent.includes('Structure'));
}

/* -------------------------------------------------------------------- DONE */
console.log(`\nPhase 2: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
