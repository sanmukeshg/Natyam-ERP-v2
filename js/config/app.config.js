/**
 * NATYAM ERP 2.0 — Application configuration
 *
 * Everything environment-shaped or business-shaped that other modules need to
 * agree on lives here. Modules import from this file; they never hard-code a
 * store name, a status string, a route or a role.
 */

export const APP = Object.freeze({
    name: 'Natyam ERP',
    version: '2.2.2',
    organisation: 'NATYAM — School of Kuchipudi',
    locale: 'en-IN',
    currency: 'INR',
    timezone: 'Asia/Kolkata'
});

/* ==========================================================================
   DATABASE SCHEMA
   --------------------------------------------------------------------------
   Declarative, versioned migrations. Each entry runs once, in order, for any
   install below that version. 1.0 bumped a single version number and hoped
   onupgradeneeded would sort it out; that works for adding stores and breaks
   the moment data has to be reshaped.
   ========================================================================== */

export const SCHEMA = Object.freeze({
    name: 'natyam_erp',
    version: 6,

    stores: {
        branches:       { keyPath: 'id', indexes: [['code', 'code', { unique: true }], ['status', 'status']] },
        academicYears:  { keyPath: 'id', indexes: [['isCurrent', 'isCurrent']] },

        students:       { keyPath: 'id', indexes: [
            ['branchId', 'branchId'], ['status', 'status'], ['batchId', 'batchId'],
            ['admissionNo', 'admissionNo', { unique: true }], ['level', 'level'],
            ['curriculumId', 'curriculumId'],
            ['searchKey', 'searchKey'], ['createdAt', 'createdAt']
        ]},

        admissions:     { keyPath: 'id', indexes: [
            ['branchId', 'branchId'], ['status', 'status'], ['appliedOn', 'appliedOn'], ['searchKey', 'searchKey']
        ]},

        admissionDrafts:{ keyPath: 'id', indexes: [['updatedAt', 'updatedAt']] },

        batches:        { keyPath: 'id', indexes: [
            ['branchId', 'branchId'], ['status', 'status'], ['teacherId', 'teacherId'],
            ['level', 'level'], ['code', 'code', { unique: true }]
        ]},

        staff:          { keyPath: 'id', indexes: [
            ['branchId', 'branchId'], ['status', 'status'], ['role', 'role'], ['searchKey', 'searchKey']
        ]},

        attendance:     { keyPath: 'id', indexes: [
            ['branchId', 'branchId'], ['batchId', 'batchId'], ['date', 'date'],
            ['studentId', 'studentId'], ['batchDate', 'batchDate', { unique: true }], ['status', 'status']
        ]},

        holidays:       { keyPath: 'id', indexes: [['date', 'date'], ['branchId', 'branchId']] },
        leaveRequests:  { keyPath: 'id', indexes: [['studentId', 'studentId'], ['status', 'status'], ['fromDate', 'fromDate']] },

        feePlans:       { keyPath: 'id', indexes: [['level', 'level'], ['status', 'status'], ['academicYearId', 'academicYearId']] },

        invoices:       { keyPath: 'id', indexes: [
            ['studentId', 'studentId'], ['branchId', 'branchId'], ['status', 'status'],
            ['dueDate', 'dueDate'], ['number', 'number', { unique: true }]
        ]},

        payments:       { keyPath: 'id', indexes: [
            ['studentId', 'studentId'], ['invoiceId', 'invoiceId'], ['branchId', 'branchId'],
            ['paidOn', 'paidOn'], ['mode', 'mode'], ['receiptNo', 'receiptNo', { unique: true }],
            ['status', 'status']
        ]},

        /* Finance is double-entry-shaped and deliberately separate from fee
           collection. Collections record what a family owes and has paid;
           finance records what the school earned and spent. Conflating them
           was the largest structural flaw in 1.0. */
        ledgerEntries:  { keyPath: 'id', indexes: [
            ['branchId', 'branchId'], ['date', 'date'], ['account', 'account'],
            ['type', 'type'], ['sourceId', 'sourceId'], ['period', 'period']
        ]},
        expenses:       { keyPath: 'id', indexes: [['branchId', 'branchId'], ['date', 'date'], ['category', 'category'], ['status', 'status']] },
        salaries:       { keyPath: 'id', indexes: [['staffId', 'staffId'], ['period', 'period'], ['status', 'status']] },

        programs:       { keyPath: 'id', indexes: [['branchId', 'branchId'], ['type', 'type'], ['date', 'date'], ['status', 'status']] },
        certificates:   { keyPath: 'id', indexes: [['studentId', 'studentId'], ['programId', 'programId'], ['serial', 'serial', { unique: true }], ['issuedOn', 'issuedOn']] },
        documents:      { keyPath: 'id', indexes: [['ownerId', 'ownerId'], ['ownerType', 'ownerType'], ['kind', 'kind']] },

        notifications:  { keyPath: 'id', indexes: [['read', 'read'], ['createdAt', 'createdAt'], ['kind', 'kind']] },
        auditLog:       { keyPath: 'id', indexes: [['entity', 'entity'], ['action', 'action'], ['at', 'at'], ['actorId', 'actorId']] },
        settings:       { keyPath: 'key' },
        users:          { keyPath: 'id', indexes: [['role', 'role'], ['status', 'status']] },

        /* Curriculum & academic structure (Phase 2). Independent of batches —
           a student's curriculum and their batch are separate assignments.
           `curricula` carries its Level → Stage → Lesson tree in `structure`,
           edited as one document; `curriculumLevels` is the reusable, editable
           level vocabulary (Beginner / Intermediate / Advanced, extensible). */
        curricula:       { keyPath: 'id', indexes: [
            ['code', 'code', { unique: true }], ['status', 'status'],
            ['sortOrder', 'sortOrder'], ['searchKey', 'searchKey']
        ]},
        curriculumLevels:{ keyPath: 'id', indexes: [['status', 'status'], ['sortOrder', 'sortOrder']] }
    },

    /**
     * Ordered migrations. `to` is the schema version each one produces.
     * `upgrade(db, tx)` runs inside the versionchange transaction; `seed(api)`
     * runs afterwards, once, with normal read/write access.
     */
    migrations: [
        {
            to: 1,
            note: 'Initial 2.0 schema. Imports any 1.0 data found on the device.'
        },
        {
            to: 2,
            note: 'Curriculum & academic structure. Seeds the default, editable level vocabulary.',
            /* Runs inside the version-change transaction, after the store
               reconciliation loop has created curriculumLevels. Deterministic
               ids make this idempotent: a device that somehow re-runs it simply
               overwrites the same three rows rather than duplicating them. The
               school is free to rename, reorder, retire or add to these. */
            upgrade(db, tx) {
                const at = new Date().toISOString();
                const store = tx.objectStore('curriculumLevels');
                [
                    { code: 'BEGINNER', name: 'Beginner', sortOrder: 1 },
                    { code: 'INTERMEDIATE', name: 'Intermediate', sortOrder: 2 },
                    { code: 'ADVANCED', name: 'Advanced', sortOrder: 3 }
                ].forEach((level) => {
                    store.put({
                        id: `CLV-${level.code}`,
                        code: level.code,
                        name: level.name,
                        sortOrder: level.sortOrder,
                        status: 'active',
                        createdAt: at,
                        updatedAt: at,
                        deletedAt: null
                    });
                });
            }
        },
        {
            to: 3,
            note: 'Replaces the placeholder level vocabulary with the approved Level / Qualification list.',
            /* v2.2.0 seeded three placeholder levels (Beginner / Intermediate /
               Advanced) that were never the approved list. This installs the
               approved defaults on every device — new and existing — and
               removes the placeholders so they do not linger in the picker.
               Deterministic ids keep it idempotent. A level the school has
               already renamed is left alone: only the untouched placeholders
               are removed, and a curriculum that referenced one keeps working
               because the structure caches the level name it was added under. */
            upgrade(db, tx) {
                const at = new Date().toISOString();
                const store = tx.objectStore('curriculumLevels');

                DEFAULT_CURRICULUM_LEVELS.forEach((level, index) => {
                    store.put({
                        id: `CLV-${level.code}`,
                        code: level.code,
                        name: level.name,
                        sortOrder: index + 1,
                        status: 'active',
                        createdAt: at,
                        updatedAt: at,
                        deletedAt: null
                    });
                });

                // Drop the placeholders only where they are still exactly as
                // seeded — anything the school edited is their data, not ours.
                [
                    { id: 'CLV-BEGINNER', name: 'Beginner' },
                    { id: 'CLV-INTERMEDIATE', name: 'Intermediate' },
                    { id: 'CLV-ADVANCED', name: 'Advanced' }
                ].forEach((placeholder) => {
                    const request = store.get(placeholder.id);
                    request.onsuccess = () => {
                        const existing = request.result;
                        if (existing && existing.name === placeholder.name) store.delete(placeholder.id);
                    };
                });
            }
        },
        {
            to: 4,
            note: 'Fee plans move from a yearly amount split into instalments to a monthly amount.',
            /* NATYAM collects monthly. A plan previously stored the whole year
               and how many instalments to split it into; it now stores what is
               due each period plus the period itself. Existing plans convert by
               dividing the year by twelve, so a school upgrading keeps working
               fee plans without re-entering them. The original annual figure is
               retained on the record for reference and reporting history. */
            upgrade(db, tx) {
                const store = tx.objectStore('feePlans');
                const request = store.openCursor();
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (!cursor) return;
                    const plan = cursor.value;
                    if (plan && plan.amount == null) {
                        const annual = Number(plan.annualAmount) || 0;
                        cursor.update({
                            ...plan,
                            amount: Math.round(annual / 12),
                            frequency: 'monthly',
                            legacyAnnualAmount: annual,
                            updatedAt: new Date().toISOString()
                        });
                    }
                    cursor.continue();
                };
            }
        },
        {
            to: 5,
            note: 'Monetary amounts move from scaled paise to whole rupees.',
            /* Amounts were stored as paise but entered and shown as rupees, and
               a saved form re-scaled its own value — ₹1,500 became ₹150,000 and
               then ₹15,00,000. Storage is now the same whole number the user
               types, which removes the factor entirely. Existing rows are
               divided by a hundred once. `moneyMigratedAt` marks a record so a
               re-run can never divide it twice. */
            upgrade(db, tx) {
                const MONEY_FIELDS = {
                    feePlans:     ['amount', 'registrationFee', 'costumeFee', 'legacyAnnualAmount'],
                    invoices:     ['amount', 'paidAmount', 'balance', 'discount'],
                    payments:     ['amount'],
                    ledgerEntries:['amount', 'debit', 'credit'],
                    expenses:     ['amount'],
                    salaries:     ['amount', 'gross', 'net', 'allowances', 'deductions', 'monthlySalary'],
                    staff:        ['monthlySalary', 'allowances', 'deductions'],
                    admissions:   ['registrationFee', 'amount'],
                    programs:     ['totalCost', 'budget', 'fee']
                };
                const at = new Date().toISOString();

                Object.entries(MONEY_FIELDS).forEach(([storeName, fields]) => {
                    if (!db.objectStoreNames.contains(storeName)) return;
                    const store = tx.objectStore(storeName);
                    const request = store.openCursor();
                    request.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (!cursor) return;
                        const row = cursor.value;
                        if (row && !row.moneyMigratedAt) {
                            const next = { ...row, moneyMigratedAt: at };
                            let touched = false;
                            fields.forEach((f) => {
                                if (typeof next[f] === 'number' && Number.isFinite(next[f])) {
                                    next[f] = Math.round(next[f] / 100);
                                    touched = true;
                                }
                            });
                            if (touched) cursor.update(next);
                        }
                        cursor.continue();
                    };
                });
            }
        },
        {
            to: 6,
            note: 'Dance levels move to the approved Foundation / Intermediate / Advanced ladder.',
            /* The five Sanskrit grades are replaced by the school's actual
               qualification ladder. Existing students, batches, admissions and
               plans are mapped onto the equivalent rung so nobody loses their
               placement; anything unrecognised is left untouched rather than
               guessed at, and shows as-is until someone corrects it. */
            upgrade(db, tx) {
                const MAP = {
                    prarambhika: 'foundation-1',
                    praveshika:  'foundation-5',
                    madhyama:    'intermediate-certificate',
                    visharada:   'intermediate-diploma',
                    alankara:    'advanced-masters'
                };
                ['students', 'batches', 'admissions', 'feePlans', 'certificates'].forEach((storeName) => {
                    if (!db.objectStoreNames.contains(storeName)) return;
                    const store = tx.objectStore(storeName);
                    const request = store.openCursor();
                    request.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (!cursor) return;
                        const row = cursor.value;
                        if (row && MAP[row.level]) {
                            cursor.update({ ...row, level: MAP[row.level], updatedAt: new Date().toISOString() });
                        }
                        cursor.continue();
                    };
                });
            }
        }
    ]
});

/* ==========================================================================
   DOMAIN CONSTANTS
   Status values are frozen objects, not loose strings. 1.0 compared
   'Pending Approval' against 'Pending approval' in two files and silently
   returned zero.
   ========================================================================== */

export const STUDENT_STATUS = Object.freeze({
    ACTIVE:    'active',
    ON_LEAVE:  'on_leave',
    GRADUATED: 'graduated',
    INACTIVE:  'inactive'
});

export const ADMISSION_STATUS = Object.freeze({
    DRAFT:     'draft',
    SUBMITTED: 'submitted',
    REVIEWING: 'reviewing',
    APPROVED:  'approved',
    ENROLLED:  'enrolled',
    REJECTED:  'rejected'
});

export const ATTENDANCE_STATUS = Object.freeze({
    PRESENT: 'present',
    ABSENT:  'absent',
    LATE:    'late',
    EXCUSED: 'excused',
    HOLIDAY: 'holiday'
});

/* Curriculum & academic structure (Phase 2). Curricula and curriculum levels
   share the same simple active/inactive lifecycle; retiring one keeps its
   history and any student assignments intact while hiding it from new use. */
export const CURRICULUM_STATUS = Object.freeze({
    ACTIVE:   'active',
    INACTIVE: 'inactive'
});

export const DURATION_UNITS = Object.freeze([
    { value: 'months', label: 'Months' },
    { value: 'years',  label: 'Years' }
]);

/* Fee collection frequency. NATYAM collects monthly, which is the only option
   offered in the UI. The others are declared so a future release can expose one
   without reshaping fee plans, invoices or the schedule generator: everything
   downstream reads periodsPerYear and dayGap from this table rather than
   assuming a cadence. Set `exposed: true` to surface one in the form. */
const FEE_FREQUENCIES = Object.freeze([
    { value: 'monthly',     label: 'Monthly',     periodsPerYear: 12, dayGap: 30,  exposed: true },
    { value: 'quarterly',   label: 'Quarterly',   periodsPerYear: 4,  dayGap: 91,  exposed: false },
    { value: 'half_yearly', label: 'Half-yearly', periodsPerYear: 2,  dayGap: 182, exposed: false },
    { value: 'annual',      label: 'Annual',      periodsPerYear: 1,  dayGap: 365, exposed: false },
    { value: 'workshop',    label: 'Workshop',    periodsPerYear: 1,  dayGap: 0,   exposed: false },
    { value: 'one_time',    label: 'One-time',    periodsPerYear: 1,  dayGap: 0,   exposed: false }
]);

export const DEFAULT_FEE_FREQUENCY = 'monthly';

/** Resolves a frequency, falling back to monthly for unknown or legacy values. */
export function feeFrequency(value) {
    return FEE_FREQUENCIES.find((f) => f.value === value)
        || FEE_FREQUENCIES.find((f) => f.value === DEFAULT_FEE_FREQUENCY);
}

/** Only the frequencies a user may currently choose. */
export function exposedFeeFrequencies() {
    return FEE_FREQUENCIES.filter((f) => f.exposed);
}

/* The default Level / Qualification vocabulary. "Foundation", "Intermediate"
   and "Advanced" are display prefixes inside a single flat list — not separate
   fields, groups or selectors. These are seed values only: the school edits,
   reorders, retires and extends the list from the Curriculum module, and
   nothing in the application branches on these names or codes. */
const DEFAULT_CURRICULUM_LEVELS = Object.freeze([
    { code: 'FND-1',    name: 'Foundation - Level 1' },
    { code: 'FND-2',    name: 'Foundation - Level 2' },
    { code: 'FND-3',    name: 'Foundation - Level 3' },
    { code: 'FND-4',    name: 'Foundation - Level 4' },
    { code: 'FND-5',    name: 'Foundation - Level 5' },
    { code: 'FND-6',    name: 'Foundation - Level 6' },
    { code: 'FND-7',    name: 'Foundation - Level 7' },
    { code: 'FND-8',    name: 'Foundation - Level 8' },
    { code: 'INT-CERT', name: 'Intermediate - Certificate' },
    { code: 'INT-DIP',  name: 'Intermediate - Diploma' },
    { code: 'ADV-MAS',  name: 'Advanced - Masters' },
    { code: 'ADV-THY',  name: 'Advanced - Theory' },
    { code: 'ADV-PRC',  name: 'Advanced - Practical' }
]);

export const INVOICE_STATUS = Object.freeze({
    DRAFT:    'draft',
    OPEN:     'open',
    PARTIAL:  'partial',
    PAID:     'paid',
    OVERDUE:  'overdue',
    WAIVED:   'waived',
    CANCELLED:'cancelled'
});

export const PAYMENT_STATUS = Object.freeze({
    CLEARED:  'cleared',
    PENDING:  'pending',
    BOUNCED:  'bounced',
    REFUNDED: 'refunded'
});

export const PAYMENT_MODES = Object.freeze([
    { value: 'upi',      label: 'UPI',           needsReference: true },
    { value: 'cash',     label: 'Cash',          needsReference: false },
    { value: 'bank',     label: 'Bank transfer', needsReference: true },
    { value: 'cheque',   label: 'Cheque',        needsReference: true },
    { value: 'card',     label: 'Card',          needsReference: true }
]);

/**
 * The Kuchipudi curriculum ladder. Order matters — promotion, certificate
 * eligibility and fee banding all read this sequence.
 */
/* The school's Level / Qualification ladder.
   "Foundation", "Intermediate" and "Advanced" are part of each name, not
   separate fields or a second selector — a student holds exactly one of these
   values. The list is the default; a school can override it (see
   configureCurriculum) without any code change. */
export const LEVELS = Object.freeze([
    { value: 'foundation-1', label: 'Foundation Level 1', order: 1,  years: 1, description: 'Foundation — first year exam' },
    { value: 'foundation-2', label: 'Foundation Level 2', order: 2,  years: 1, description: 'Foundation — second year exam' },
    { value: 'foundation-3', label: 'Foundation Level 3', order: 3,  years: 1, description: 'Foundation — third year exam' },
    { value: 'foundation-4', label: 'Foundation Level 4', order: 4,  years: 1, description: 'Foundation — fourth year exam' },
    { value: 'foundation-5', label: 'Foundation Level 5', order: 5,  years: 1, description: 'Foundation — fifth year exam' },
    { value: 'foundation-6', label: 'Foundation Level 6', order: 6,  years: 1, description: 'Foundation — sixth year exam' },
    { value: 'foundation-7', label: 'Foundation Level 7', order: 7,  years: 1, description: 'Foundation — seventh year exam' },
    { value: 'foundation-8', label: 'Foundation Level 8', order: 8,  years: 1, description: 'Foundation — eighth year exam' },
    { value: 'intermediate-certificate', label: 'Intermediate Certificate', order: 9,  years: 1, description: 'Intermediate — certificate' },
    { value: 'intermediate-diploma',     label: 'Intermediate Diploma',     order: 10, years: 1, description: 'Intermediate — diploma' },
    { value: 'advanced-masters',   label: 'Advanced Masters',   order: 11, years: 1, description: 'Advanced — masters' },
    { value: 'advanced-theory',    label: 'Advanced Theory',    order: 12, years: 1, description: 'Advanced — theory course' },
    { value: 'advanced-practical', label: 'Advanced Practical', order: 13, years: 1, description: 'Advanced — practical course' }
]);

export const EXPENSE_CATEGORIES = Object.freeze([
    'Rent', 'Salaries', 'Utilities', 'Costumes', 'Instruments', 'Musicians',
    'Travel', 'Venue hire', 'Marketing', 'Maintenance', 'Stationery', 'Other'
]);

export const PROGRAM_TYPES = Object.freeze([
    { value: 'performance', label: 'Performance' },
    { value: 'workshop',    label: 'Workshop' },
    { value: 'competition', label: 'Competition' },
    { value: 'examination', label: 'Examination' },
    { value: 'rehearsal',   label: 'Rehearsal' }
]);

/* ==========================================================================
   ROLES & PERMISSIONS
   Capability strings, not role checks scattered through the UI. A view asks
   "can I do X", never "am I an admin".
   ========================================================================== */

export const CAPABILITIES = Object.freeze({
    STUDENT_VIEW: 'student.view',   STUDENT_EDIT: 'student.edit',   STUDENT_DELETE: 'student.delete',
    ADMISSION_VIEW: 'admission.view', ADMISSION_EDIT: 'admission.edit', ADMISSION_APPROVE: 'admission.approve',
    ATTENDANCE_VIEW: 'attendance.view', ATTENDANCE_MARK: 'attendance.mark',
    FEE_VIEW: 'fee.view', FEE_COLLECT: 'fee.collect', FEE_REFUND: 'fee.refund', FEE_WAIVE: 'fee.waive',
    FINANCE_VIEW: 'finance.view', FINANCE_EDIT: 'finance.edit',
    STAFF_VIEW: 'staff.view', STAFF_EDIT: 'staff.edit',
    PROGRAM_VIEW: 'program.view', PROGRAM_EDIT: 'program.edit',
    CERTIFICATE_ISSUE: 'certificate.issue',
    REPORT_VIEW: 'report.view', REPORT_EXPORT: 'report.export',
    SETTINGS_VIEW: 'settings.view', SETTINGS_EDIT: 'settings.edit',
    AUDIT_VIEW: 'audit.view',
    BACKUP_MANAGE: 'backup.manage'
});

const ALL_CAPS = Object.values(CAPABILITIES);

export const ROLES = Object.freeze({
    owner: {
        label: 'Owner',
        description: 'Full access, including settings, finance and backups.',
        capabilities: ALL_CAPS
    },
    administrator: {
        label: 'Administrator',
        description: 'Runs day-to-day operations across every branch.',
        capabilities: ALL_CAPS.filter((c) => c !== CAPABILITIES.BACKUP_MANAGE)
    },
    registrar: {
        label: 'Registrar',
        description: 'Admissions, students, attendance and fee collection.',
        capabilities: [
            CAPABILITIES.STUDENT_VIEW, CAPABILITIES.STUDENT_EDIT,
            CAPABILITIES.ADMISSION_VIEW, CAPABILITIES.ADMISSION_EDIT, CAPABILITIES.ADMISSION_APPROVE,
            CAPABILITIES.ATTENDANCE_VIEW, CAPABILITIES.ATTENDANCE_MARK,
            CAPABILITIES.FEE_VIEW, CAPABILITIES.FEE_COLLECT,
            CAPABILITIES.PROGRAM_VIEW, CAPABILITIES.REPORT_VIEW, CAPABILITIES.REPORT_EXPORT,
            CAPABILITIES.STAFF_VIEW
        ]
    },
    teacher: {
        label: 'Teacher',
        description: 'Own batches: roll call, student progress, programmes.',
        capabilities: [
            CAPABILITIES.STUDENT_VIEW,
            CAPABILITIES.ATTENDANCE_VIEW, CAPABILITIES.ATTENDANCE_MARK,
            CAPABILITIES.PROGRAM_VIEW, CAPABILITIES.PROGRAM_EDIT,
            CAPABILITIES.REPORT_VIEW
        ]
    },
    accountant: {
        label: 'Accountant',
        description: 'Collections, expenses, salaries and financial reports.',
        capabilities: [
            CAPABILITIES.STUDENT_VIEW,
            CAPABILITIES.FEE_VIEW, CAPABILITIES.FEE_COLLECT, CAPABILITIES.FEE_REFUND, CAPABILITIES.FEE_WAIVE,
            CAPABILITIES.FINANCE_VIEW, CAPABILITIES.FINANCE_EDIT,
            CAPABILITIES.REPORT_VIEW, CAPABILITIES.REPORT_EXPORT
        ]
    }
});

/* ==========================================================================
   NAVIGATION
   Grouped, capability-gated, lazily loaded. `load` is a dynamic import, so a
   registrar who never opens Finance never downloads or parses it.
   ========================================================================== */

export const NAVIGATION = Object.freeze([
    {
        group: 'Overview',
        items: [
            { path: '/', label: 'Dashboard', icon: 'home', cap: null,
              load: () => import('../modules/dashboard/dashboard.page.js') }
        ]
    },
    {
        group: 'People',
        items: [
            { path: '/admissions', label: 'Admissions', icon: 'inbox', cap: CAPABILITIES.ADMISSION_VIEW,
              load: () => import('../modules/admissions/admissions.page.js'), badge: 'admissions.pending' },
            { path: '/students', label: 'Students', icon: 'users', cap: CAPABILITIES.STUDENT_VIEW,
              load: () => import('../modules/students/students.page.js') },
            { path: '/parents', label: 'Parents', icon: 'phone', cap: CAPABILITIES.STUDENT_VIEW,
              load: () => import('../modules/students/parents.page.js') },
            { path: '/staff', label: 'Staff', icon: 'briefcase', cap: CAPABILITIES.STAFF_VIEW,
              load: () => import('../modules/staff/staff.page.js') }
        ]
    },
    {
        group: 'Teaching',
        items: [
            { path: '/batches', label: 'Batches', icon: 'grid', cap: CAPABILITIES.STUDENT_VIEW,
              load: () => import('../modules/batches/batches.page.js') },
            { path: '/timetable', label: 'Timetable', icon: 'calendar', cap: CAPABILITIES.STUDENT_VIEW,
              load: () => import('../modules/batches/timetable.page.js') },
            { path: '/attendance', label: 'Attendance', icon: 'check-square', cap: CAPABILITIES.ATTENDANCE_VIEW,
              load: () => import('../modules/attendance/attendance.page.js') },
            { path: '/programs', label: 'Programmes', icon: 'star', cap: CAPABILITIES.PROGRAM_VIEW,
              load: () => import('../modules/programs/programs.page.js') },
            { path: '/certificates', label: 'Certificates', icon: 'award', cap: CAPABILITIES.PROGRAM_VIEW,
              load: () => import('../modules/certificates/certificates.page.js') },
            { path: '/curriculum', label: 'Curriculum', icon: 'file-text', cap: CAPABILITIES.SETTINGS_VIEW,
              load: () => import('../modules/curriculum/curriculum.page.js') }
        ]
    },
    {
        group: 'Money',
        items: [
            { path: '/fees', label: 'Fee collection', icon: 'receipt', cap: CAPABILITIES.FEE_VIEW,
              load: () => import('../modules/fees/fees.page.js'), badge: 'fees.overdue' },
            { path: '/finance', label: 'Finance', icon: 'trending-up', cap: CAPABILITIES.FINANCE_VIEW,
              load: () => import('../modules/finance/finance.page.js') }
        ]
    },
    {
        group: 'Insight',
        items: [
            { path: '/analytics', label: 'Analytics', icon: 'trending-up', cap: CAPABILITIES.REPORT_VIEW,
              load: () => import('../modules/reports/analytics.page.js') },
            { path: '/reports', label: 'Reports', icon: 'bar-chart', cap: CAPABILITIES.REPORT_VIEW,
              load: () => import('../modules/reports/reports.page.js') },
            { path: '/notifications', label: 'Notifications', icon: 'bell', cap: CAPABILITIES.STUDENT_VIEW,
              load: () => import('../modules/notifications/notifications.page.js') },
            { path: '/settings', label: 'Settings', icon: 'settings', cap: CAPABILITIES.SETTINGS_VIEW,
              load: () => import('../modules/settings/settings.page.js') }
        ]
    }
]);

/* ==========================================================================
   REFERENCE-DATA RESOLUTION SEAM
   --------------------------------------------------------------------------
   Two pieces of structural reference data — the curriculum ladder (LEVELS) and
   the role → capability matrix (ROLES) — are defined above as frozen defaults.
   A confirmed business decision makes both of these editable by the school in a
   later phase, with the edits persisted to the database.

   Rather than have that later change hunt down every reader of LEVELS and ROLES,
   all resolution now flows through the accessors below. Today they return the
   frozen defaults unchanged, so behaviour is identical; when a later phase loads
   overrides from the database it calls configureCurriculum()/configureRoles()
   once at boot and every consumer follows without further edits.

   The frozen tables remain the source of truth until an override is installed,
   and remain the fallback if one is ever cleared. Nothing mutates the frozen
   objects themselves — the overrides are held in these private slots.
   ========================================================================== */

let _curriculumOverride = null;
let _rolesOverride = null;

/** Install a database-sourced curriculum. Pass null/empty to fall back to LEVELS. */
export function configureCurriculum(levels) {
    _curriculumOverride = Array.isArray(levels) && levels.length ? levels : null;
}

/** Install a database-sourced role matrix. Pass null/empty to fall back to ROLES. */
export function configureRoles(roles) {
    _rolesOverride = roles && typeof roles === 'object' && Object.keys(roles).length ? roles : null;
}

/** The active curriculum ladder — the override when present, otherwise the frozen default. */
export function curriculum() {
    return _curriculumOverride || LEVELS;
}

/** The active role matrix — the override when present, otherwise the frozen default. */
export function roleTable() {
    return _rolesOverride || ROLES;
}

/** Capabilities granted to a role, resolved through the active matrix. */
export function roleCapabilities(roleKey) {
    return roleTable()[roleKey]?.capabilities || [];
}

/** Display label for a role, resolved through the active matrix. */
export function roleLabel(roleKey) {
    return roleTable()[roleKey]?.label || null;
}

/**
 * The display name for a level value.
 *
 * Six services had defined this privately against the same LEVELS table two
 * imports away, and they had already drifted: three different fallbacks for an
 * unrecognised value ('—', the raw value, and 'an unknown level'), so the same
 * missing level read differently depending on which screen showed it. The
 * fallback is now an argument, because a table cell and a sentence genuinely
 * want different things.
 *
 * Resolves through curriculum() rather than the frozen LEVELS directly, so a
 * later editable-curriculum phase relabels every screen through this one point.
 */
export function levelLabel(value, fallback = null) {
    return curriculum().find((l) => l.value === value)?.label || value || fallback;
}

/**
 * Every store name, derived from SCHEMA rather than written out again.
 *
 * SCHEMA.stores is keyed by name so the database layer can look a store up
 * directly; code that needs to *iterate* stores — backup, restore, reset,
 * per-store export — wants a list. Three call sites had assumed it was already
 * an array and called `.some()` and `.map()` on an object, which broke restore
 * validation and the export picker.
 */
export const STORE_NAMES = Object.freeze(Object.keys(SCHEMA.stores));

/** Flat route table, derived so the two can never drift apart. */
export const ROUTES = NAVIGATION.flatMap((g) => g.items);

export const PREFERENCE_DEFAULTS = Object.freeze({
    theme: 'system',          // system | light | dark
    density: 'comfortable',   // compact | comfortable | spacious
    sidebar: 'expanded',      // expanded | collapsed
    pageSize: 25,
    activeBranchId: null
});
