/**
 * NATYAM ERP 2.0 — Application configuration
 *
 * Everything environment-shaped or business-shaped that other modules need to
 * agree on lives here. Modules import from this file; they never hard-code a
 * store name, a status string, a route or a role.
 */

export const APP = Object.freeze({
    name: 'Natyam ERP',
    version: '2.2.0',
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
    version: 2,

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
export const LEVELS = Object.freeze([
    { value: 'prarambhika', label: 'Prarambhika', order: 1, years: 2, description: 'Foundation — adavus and basic nritta' },
    { value: 'praveshika',  label: 'Praveshika',  order: 2, years: 2, description: 'Entry — jatiswaram, shabdam' },
    { value: 'madhyama',    label: 'Madhyama',    order: 3, years: 2, description: 'Intermediate — varnam, abhinaya' },
    { value: 'visharada',   label: 'Visharada',   order: 4, years: 2, description: 'Advanced — full margam, Bhama Kalapam' },
    { value: 'alankara',    label: 'Alankara',    order: 5, years: 1, description: 'Performance diploma' }
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
