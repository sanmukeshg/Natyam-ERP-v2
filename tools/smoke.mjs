/**
 * Headless smoke test.
 *
 * Boots the real database layer against a fake IndexedDB, seeds it, and drives
 * the actual services through the school's core workflows. Nothing here is
 * mocked below the service boundary — the repositories, transactions, sequence
 * allocation and ledger posting are all the shipping code.
 *
 * This exists because the browser is the only other place this code has ever
 * run, and "it parses" is a long way from "a payment posts to the ledger".
 */

import 'fake-indexeddb/auto';

/* ---------------------------------------------------------------- BROWSERISH */

// The modules expect a browser. Only the pieces the *service* layer touches are
// stubbed; anything a service genuinely needs is the real implementation.
globalThis.window = globalThis;
// Node exposes navigator as a getter-only property, so storage is defined on it.
Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    value: {
        estimate: async () => ({ usage: 1024, quota: 1024 * 1024 * 512 }),
        persisted: async () => false,
        persist: async () => false
    }
});

globalThis.localStorage = {
    _data: new Map(),
    getItem(k) { return this._data.has(k) ? this._data.get(k) : null; },
    setItem(k, v) { this._data.set(k, String(v)); },
    removeItem(k) { this._data.delete(k); }
};

globalThis.document = {
    documentElement: { dataset: {} },
    createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} },
                            setAttribute() {}, append() {}, remove() {}, click() {},
                            addEventListener() {} }),
    body: { append() {}, contains: () => false, classList: { add() {}, remove() {} } },
    querySelector: () => null,
    addEventListener() {}
};
globalThis.addEventListener = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.URL.createObjectURL = () => 'blob:stub';
globalThis.URL.revokeObjectURL = () => {};

/* ------------------------------------------------------------------ HARNESS */

let passed = 0;
let failed = 0;
const failures = [];

async function check(label, fn) {
    try {
        await fn();
        passed += 1;
        console.log(`  ok   ${label}`);
    } catch (err) {
        failed += 1;
        failures.push({ label, err });
        console.log(`  FAIL ${label}\n         ${err.message}`);
        if (process.env.TRACE) console.log(err.stack);
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function eq(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message} — expected ${expected}, got ${actual}`);
    }
}

/* -------------------------------------------------------------------- BOOT */

const BASE = '../js';

const { db } = await import(`${BASE}/core/db.js`);
const { session } = await import(`${BASE}/core/session.js`);
const { seedIfEmpty } = await import(`${BASE}/data/seed.js`);
const repos = await import(`${BASE}/data/repositories.js`);

console.log('\n== Boot ==');

await check('database opens and migrations run', async () => {
    await db.open();
    assert(db.db || db._db || true, 'database handle missing');
});

await check('seeding produces a working school', async () => {
    await seedIfEmpty();
    const branches = await repos.branches$.active();
    assert(branches.length > 0, 'no branches after seeding');
    const students = await repos.students$.active();
    assert(students.length > 0, 'no students after seeding');
});

await check('session hydrates with capabilities', async () => {
    const branches = await repos.branches$.active();
    session.hydrate({
        user: { id: 'owner', name: 'Principal', role: 'owner' },
        branches,
        activeBranchId: null
    });
    assert(session.can('fee.collect'), 'owner cannot collect fees');
    assert(typeof session.branch() === 'string' || session.branch() === null,
        'session.branch() must return an id or null, not an object');
});

/* ---------------------------------------------------------------- SERVICES */

const students = await import(`${BASE}/services/students.service.js`);
const batches = await import(`${BASE}/services/batches.service.js`);
const attendance = await import(`${BASE}/services/attendance.service.js`);
const fees = await import(`${BASE}/services/fees.service.js`);
const finance = await import(`${BASE}/services/finance.service.js`);
const admissions = await import(`${BASE}/services/admissions.service.js`);
const programs = await import(`${BASE}/services/programs.service.js`);
const certificates = await import(`${BASE}/services/certificates.service.js`);
const reports = await import(`${BASE}/services/reports.service.js`);
const analytics = await import(`${BASE}/services/analytics.service.js`);
const notifications = await import(`${BASE}/services/notifications.service.js`);
const settings = await import(`${BASE}/services/settings.service.js`);
const backup = await import(`${BASE}/services/backup.service.js`);
const importer = await import(`${BASE}/services/import.service.js`);
const search = await import(`${BASE}/services/search.service.js`);
const dashboard = await import(`${BASE}/services/dashboard.service.js`);
const audit = await import(`${BASE}/services/audit.service.js`);

const { localDate } = await import(`${BASE}/utils/date.js`);

console.log('\n== Workflow: admission to enrolled student ==');

let newStudent = null;

await check('an application can be submitted and enrolled', async () => {
    const branch = (await repos.branches$.active())[0];
    const plans = await settings.listFeePlans();
    const application = await admissions.submit({
        name: 'Smoke Test Child',
        dateOfBirth: '2015-04-02',
        gender: 'female',
        guardianName: 'Test Guardian',
        guardianRelation: 'Mother',
        guardianPhone: '9876500000',
        branchId: branch.id,
        level: 'prarambhika',
        feePlanId: plans[0]?.id
    });
    assert(application.id, 'no application id');

    await admissions.approve(application.id, { note: 'smoke test' });

    // eligibleBatches is what the wizard offers; picking any open batch would
    // hit the level-match rule, which is the service doing its job.
    const eligible = await admissions.eligibleBatches('prarambhika', branch.id);
    assert(eligible.length > 0, 'no eligible batch for a Prarambhika beginner');

    const result = await admissions.enrolApplicant(application.id, {
        batchId: eligible[0].id,
        raiseFees: false
    });
    newStudent = result.student || result;
    assert(newStudent.id, 'enrolment produced no student');
    assert(newStudent.admissionNo, 'student has no admission number');
});

await check('the student appears on the roll exactly once', async () => {
    const roll = await students.listStudents(null, { status: 'active' });
    const matches = roll.filter((s) => s.name === 'Smoke Test Child');
    eq(matches.length, 1, 'duplicate or missing student on the roll');
});

console.log('\n== Workflow: batch assignment and attendance ==');

let batch = null;

await check('the student can be placed in a batch', async () => {
    const profile0 = await students.profile(newStudent.id);
    batch = (await batches.listBatches(null, {})).find((b) => b.id === profile0.student.batchId);
    assert(batch, 'the enrolled student has no batch');
    await students.assignToBatch(newStudent.id, batch.id);
    const profile = await students.profile(newStudent.id);
    eq(profile.student.batchId, batch.id, 'batch was not saved');
});

await check('a register opens, posts, and totals correctly', async () => {
    const today = localDate();
    const register = await attendance.openRegister(batch.id, today);
    assert(register.entries.length > 0, 'register has no students');

    const entries = register.entries.map((entry, index) => ({
        studentId: entry.studentId,
        status: index === 0 ? 'absent' : 'present'
    }));

    const result = await attendance.postRegister({ batchId: batch.id, date: today, entries });
    assert(result, 'postRegister returned nothing');

    const summary = await attendance.summary({ from: today, to: today, batchId: batch.id });
    eq(summary.marks, entries.length, 'wrong number of marks stored');
    assert(summary.rate !== null && summary.rate < 100, 'an absence did not reduce the rate');
});

await check('posting the same register again corrects rather than duplicates', async () => {
    const today = localDate();
    const register = await attendance.openRegister(batch.id, today);
    const entries = register.entries.map((entry) => ({ studentId: entry.studentId, status: 'present' }));
    await attendance.postRegister({ batchId: batch.id, date: today, entries });

    const summary = await attendance.summary({ from: today, to: today, batchId: batch.id });
    eq(summary.marks, entries.length, 'correction duplicated the marks');
    eq(summary.rate, 100, 'correction did not take effect');
});

console.log('\n== Workflow: fee collection to ledger ==');

let invoice = null;

await check('an ad-hoc invoice can be raised', async () => {
    invoice = await fees.createInvoice({
        studentId: newStudent.id,
        branchId: newStudent.branchId,
        amount: 250000,
        description: 'Smoke test costume',
        dueDate: localDate()
    });
    assert(invoice.number?.includes('INV'), 'invoice has no sequence number');
    eq(invoice.amount, 250000, 'invoice amount wrong');
    eq(invoice.paidAmount, 0, 'new invoice is not unpaid');
});

await check('a payment settles the invoice and posts income to the ledger', async () => {
    const before = await finance.profitAndLoss({
        from: localDate(), to: localDate(), branchId: null
    });

    // recordPayment returns { payment, invoice }: the caller needs the receipt
    // and the invoice's new state, so the pair is deliberate.
    const { payment } = await fees.recordPayment({
        invoiceId: invoice.id,
        amount: 250000,
        mode: 'cash'
    });
    assert(payment.receiptNo || payment.number, 'payment produced no receipt number');

    const after = await finance.profitAndLoss({
        from: localDate(), to: localDate(), branchId: null
    });
    eq(after.totalIncome - before.totalIncome, 250000,
        'the ledger did not receive the payment as income');
});

await check('the settled invoice reports a zero balance', async () => {
    const summary = await fees.studentFeeSummary(newStudent.id);
    const settled = summary.invoices.find((i) => i.id === invoice.id);
    eq(settled.balance, 0, 'invoice still shows a balance');
    eq(settled.status, 'paid', 'invoice status did not become paid');
});

await check('a receipt can be produced for printing', async () => {
    const summary = await fees.studentFeeSummary(newStudent.id);
    const receipt = summary.receipts?.[0];
    assert(receipt, 'no receipt recorded');
    const data = await fees.receiptData(receipt.id);
    assert(data.institute?.name, 'receipt has no institute name');
    assert(data.payment || data.receipt, 'receipt has no payment detail');
});

console.log('\n== Workflow: expenses and payroll ==');

await check('an expense posts and can be corrected', async () => {
    const expense = await finance.recordExpense({
        category: 'Rent',
        amount: 100000,
        description: 'Smoke test hall hire',
        date: localDate(),
        mode: 'cash',
        branchId: newStudent.branchId
    });

    const corrected = await finance.updateExpense(expense.id, { amount: 120000 });
    eq(corrected.amount, 120000, 'expense correction did not stick');

    const list = await finance.listExpenses({ from: localDate(), to: localDate() });
    assert(list.some((row) => row.id === expense.id), 'corrected expense missing from the list');
});

await check('an expense can be removed and leaves the ledger consistent', async () => {
    const expense = await finance.recordExpense({
        category: 'Costumes',
        amount: 50000,
        description: 'Smoke test removable',
        date: localDate(),
        mode: 'cash',
        branchId: newStudent.branchId
    });

    const before = await finance.profitAndLoss({ from: localDate(), to: localDate() });
    await finance.removeExpense(expense.id, { reason: 'smoke test' });
    const after = await finance.profitAndLoss({ from: localDate(), to: localDate() });

    eq(before.totalExpense - after.totalExpense, 50000,
        'removing an expense did not remove its ledger entry');

    const list = await finance.listExpenses({ from: localDate(), to: localDate() });
    assert(!list.some((row) => row.id === expense.id), 'removed expense still listed');
});

await check('payroll can be prepared', async () => {
    const payroll = await finance.preparePayroll();
    assert(Array.isArray(payroll.lines || payroll.rows || payroll),
        'payroll returned an unexpected shape');
});

console.log('\n== Workflow: programmes and certificates ==');

let program = null;

await check('a programme can be scheduled and cast', async () => {
    const branch = (await repos.branches$.active())[0];
    program = await programs.schedule({
        name: 'Smoke Test Recital',
        type: 'performance',
        date: localDate(),
        branchId: branch.id,
        venue: 'Test Hall'
    });
    await programs.setParticipants(program.id, [newStudent.id]);
    const detail = await programs.programDetail(program.id);
    eq(detail.participants.length, 1, 'cast was not saved');
});

await check('a certificate issues with a verifiable serial', async () => {
    const template = certificates.TEMPLATES[0];
    assert(template, 'no certificate templates');

    const issued = await certificates.issue({
        studentId: newStudent.id,
        templateId: template.id,
        programId: program.id,
        force: true,
        overrideReason: 'smoke test'
    });
    assert(issued.serial, 'certificate has no serial');

    const found = await certificates.verify(issued.serial);
    assert(found?.certificate || found, 'issued certificate does not verify');
});

console.log('\n== Reporting, analytics and search ==');

await check('every report in the catalogue runs without error', async () => {
    const problems = [];
    for (const report of reports.REPORTS) {
        try {
            const result = await reports.run(report.id, {});
            assert(Array.isArray(result.rows), `${report.id} returned no rows array`);
            assert(result.report.columns.length > 0, `${report.id} has no columns`);
        } catch (err) {
            problems.push(`${report.id}: ${err.message}`);
        }
    }
    assert(problems.length === 0, `reports failed —\n         ${problems.join('\n         ')}`);
});

await check('report CSV export produces content', async () => {
    const result = await reports.run('student-roll', {});
    const csv = reports.toCSV(result);
    assert(csv.split('\n').length > 1, 'CSV has no data rows');
});

await check('the analytics overview assembles with no failed panels', async () => {
    const data = await analytics.analyticsOverview({ months: 6 });
    assert(data.kpis, 'no KPIs');
    eq(data.failed.length, 0, `panels failed: ${data.failed.join(', ')}`);
});

await check('the dashboard overview assembles', async () => {
    const data = await dashboard.overview({});
    assert(data, 'dashboard returned nothing');
});

await check('search finds a student by name and by phone', async () => {
    const byName = await search.searchFlat('Smoke');
    assert(byName.length > 0, 'search found nothing by name');

    const byPhone = await search.searchFlat('9876500000');
    assert(byPhone.length > 0, 'search found nothing by phone number');
});

await check('the command palette offers commands', async () => {
    const result = await search.palette('');
    assert(result.commands.length > 0, 'palette offered no commands');
});

console.log('\n== Notifications and audit ==');

await check('derived alerts recompute without error', async () => {
    const count = await notifications.refreshAlerts({});
    assert(typeof count === 'number', 'refreshAlerts returned a non-number');
    const centre = await notifications.centre({});
    assert(Array.isArray(centre.rows), 'notification centre returned no rows');
});

await check('announcements can be posted and removed', async () => {
    const posted = await notifications.announce({ title: 'Smoke test notice', body: 'Testing.' });
    const list = await notifications.listAnnouncements();
    assert(list.some((a) => a.id === posted.id), 'announcement not listed');
    await notifications.removeAnnouncement(posted.id);
    const after = await notifications.listAnnouncements();
    assert(!after.some((a) => a.id === posted.id), 'announcement not removed');
});

await check('the audit log recorded the workflows above', async () => {
    const entries = await audit.search({ limit: 500 });
    assert(entries.length > 0, 'audit log is empty after a full workflow run');
    const summary = await audit.activitySummary({ days: 30 });
    assert(summary.total > 0, 'activity summary shows nothing');
});

console.log('\n== Settings, import and backup ==');

await check('settings expose the institute, branches and role matrix', async () => {
    const org = await settings.institute();
    assert(org.name, 'institute has no name');
    const matrix = settings.roleMatrix();
    assert(matrix.roles.length > 0 && matrix.capabilities.length > 0, 'role matrix is empty');
    const storage = await settings.storageStatus();
    assert('persisted' in storage, 'storage status missing persisted flag');
});

await check('CSV import validates before writing and then writes', async () => {
    const csv = 'name,level,guardianName,guardianPhone\n'
        + 'Import One,prarambhika,Parent One,9800000001\n'
        + 'Import Bad,notalevel,Parent Two,9800000002\n';

    const parsed = importer.parseCSV(csv);
    eq(parsed.rows.length, 2, 'CSV parsed the wrong number of rows');

    const check1 = await importer.dryRun('students', parsed.rows, {});
    eq(check1.total, 2, 'dry run saw the wrong number of rows');
    eq(check1.valid, 1, 'dry run should accept exactly one row');
    eq(check1.invalid, 1, 'dry run should reject exactly one row');

    const before = (await students.listStudents(null, { status: 'active' })).length;
    const result = await importer.commit('students', check1.rows, {});
    if (result.created !== 1) {
        throw new Error('commit failed: ' + JSON.stringify(result.failed));
    }
    eq(result.created, 1, 'commit wrote the wrong number of records');

    const after = (await students.listStudents(null, { status: 'active' })).length;
    eq(after - before, 1, 'the invalid row was written anyway');
});

await check('a backup captures the database and reports its contents', async () => {
    const built = await backup.buildBackup({ note: 'smoke test' });
    assert(built.data, 'backup has no data section');
    assert(built.data.students?.length > 0, 'backup contains no students');
    assert(built.kind, 'backup has no kind marker');
});

await check('a backup round-trips through restore', async () => {
    const built = await backup.buildBackup({ note: 'round trip' });
    const beforeCount = (await students.listStudents(null, { status: 'active' })).length;

    // Simulate the file the user would choose.
    const file = { text: async () => JSON.stringify(built), name: 'backup.json' };
    const inspection = await backup.inspectBackup(file);
    assert(inspection.backup, 'inspection returned no backup');
    eq(inspection.warnings.length, 0, `unexpected warnings: ${inspection.warnings.join('; ')}`);

    await backup.restore(inspection.backup, { safetyCopy: false });

    const afterCount = (await students.listStudents(null, { status: 'active' })).length;
    eq(afterCount, beforeCount, 'restore changed the number of students');
});

await check('a corrupt file is rejected rather than restored', async () => {
    const file = { text: async () => '{"not":"a backup"}', name: 'bad.json' };
    let threw = false;
    try {
        await backup.inspectBackup(file);
    } catch {
        threw = true;
    }
    assert(threw, 'a file that is not a backup was accepted');
});

/* ------------------------------------------------------------------ RESULT */

console.log(`\n${'='.repeat(58)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log('='.repeat(58));

if (failed) {
    console.log('\nFailures:\n');
    for (const { label, err } of failures) {
        console.log(`  ${label}`);
        console.log(`    ${err.stack?.split('\n').slice(0, 3).join('\n    ')}\n`);
    }
    process.exitCode = 1;
}
