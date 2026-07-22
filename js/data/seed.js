/**
 * Seed data.
 *
 * Runs once, on an empty database. Produces a school that looks like the real
 * one — two branches, ~85 students spread unevenly across five levels, six
 * months of attendance with plausible absence patterns, and a fee book that is
 * mostly collected but not entirely.
 *
 * Why generate this rather than ship three demo rows: every layout decision in
 * the product is a bet about volume and shape. A dashboard tested against four
 * students tells you nothing about whether the collection chart is legible or
 * the student table paginates sensibly.
 */

import { db } from '../core/db.js';
import { uid, sequenceNumber } from '../utils/id.js';
import { localDate, addDays, monthKey, academicYearOf, nowISO } from '../utils/date.js';
import { toPaise } from '../utils/money.js';
import {
    STUDENT_STATUS, ADMISSION_STATUS, ATTENDANCE_STATUS,
    INVOICE_STATUS, PAYMENT_STATUS, LEVELS, EXPENSE_CATEGORIES
} from '../config/app.config.js';

/* Deterministic PRNG so the demo data is identical on every device — a bug
   reproduced on one machine must reproduce on another. */
let seedState = 20260718;
function random() {
    seedState = (seedState * 1103515245 + 12345) & 0x7fffffff;
    return seedState / 0x7fffffff;
}
const pick = (list) => list[Math.floor(random() * list.length)];
const between = (min, max) => min + Math.floor(random() * (max - min + 1));
const chance = (probability) => random() < probability;

const GIVEN_NAMES = [
    'Srilekha', 'Aditya', 'Meghana', 'Rohit', 'Kavya', 'Anirudh', 'Sahasra', 'Pranav',
    'Nithya', 'Varun', 'Bhavana', 'Karthik', 'Ishita', 'Sourav', 'Deepika', 'Vivek',
    'Aparna', 'Manoj', 'Harini', 'Siddharth', 'Lasya', 'Tejas', 'Ananya', 'Rahul',
    'Divya', 'Naveen', 'Swathi', 'Arjun', 'Keerthi', 'Sanjay', 'Vaishnavi', 'Pavan',
    'Sneha', 'Ravi', 'Madhuri', 'Kiran', 'Padmaja', 'Suresh', 'Ramya', 'Ashok',
    'Chandana', 'Girish', 'Jhansi', 'Mahesh', 'Nikhita', 'Prashant', 'Rukmini', 'Satish'
];

const SURNAMES = [
    'Ramachandran', 'Iyer', 'Rao', 'Reddy', 'Sharma', 'Nair', 'Chowdary', 'Varma',
    'Menon', 'Prasad', 'Krishnan', 'Bhat', 'Naidu', 'Gupta', 'Shastri', 'Murthy',
    'Pillai', 'Deshpande', 'Kulkarni', 'Sundaram'
];

const STREETS = [
    'Road No. 12, Banjara Hills', 'Sarojini Devi Road, Secunderabad', 'Vittal Rao Nagar, Madhapur',
    'Kavuri Hills, Jubilee Hills', 'West Marredpally', 'Ameerpet Main Road',
    'Nallakunta', 'Habsiguda', 'Kondapur', 'Manikonda'
];

function personName() { return `${pick(GIVEN_NAMES)} ${pick(SURNAMES)}`; }
function phone() { return `+91 9${between(1, 8)}${String(between(0, 99999999)).padStart(8, '0')}`; }
function emailFor(name) {
    return `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`;
}

/* ==========================================================================
   MAIN ENTRY
   ========================================================================== */

export async function seedIfEmpty() {
    const existing = await db.count('branches');
    if (existing > 0) return { seeded: false };

    const migrated = await migrateFromV1();

    const branches = await seedBranches();
    const users = await seedUsers(branches);
    const years = await seedAcademicYears();
    const staff = await seedStaff(branches);
    const plans = await seedFeePlans(years[0]);
    const batches = await seedBatches(branches, staff);

    if (migrated.students > 0) {
        // A 1.0 database was found and imported. Do not fabricate students on
        // top of the school's real records — only fill in the scaffolding they
        // never had (branches, plans, batches).
        await seedSettings(years[0]);
        return { seeded: true, migratedFrom: '1.0', ...migrated };
    }

    const students = await seedStudents(branches, batches, plans);
    await seedCurriculum(students);
    await seedAdmissions(branches, plans);
    await seedAttendance(students, batches);
    const invoices = await seedFeeBook(students, plans, branches);
    await seedFinance(branches, staff, invoices);
    await seedPrograms(branches);
    await seedNotifications(students);
    await seedSettings(years[0], invoices.sequences);

    return {
        seeded: true,
        counts: {
            branches: branches.length,
            students: students.length,
            batches: batches.length,
            staff: staff.length,
            users: users.length
        }
    };
}

/* ==========================================================================
   MIGRATION FROM 1.0
   ========================================================================== */

/**
 * 1.0 stored everything in `NatyamErpUnifiedDB`. If that database exists on
 * this device, its records are the school's real data and must be carried
 * forward, not discarded because the schema changed.
 *
 * This is deliberately forgiving: 1.0's records were inconsistent (two spellings
 * of the same status, missing batchId, a hard-coded fee amount), so anything
 * that cannot be mapped confidently is imported with a flag rather than dropped.
 */
async function migrateFromV1() {
    const result = { students: 0, admissions: 0, payments: 0 };

    const legacy = await openLegacy('NatyamErpUnifiedDB');
    if (!legacy) return result;

    try {
        const read = (store) => new Promise((resolve) => {
            if (!legacy.objectStoreNames.contains(store)) return resolve([]);
            const request = legacy.transaction(store, 'readonly').objectStore(store).getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => resolve([]);
        });

        const [oldStudents, oldAdmissions, oldFinance] = await Promise.all([
            read('students'), read('admissions'), read('finance')
        ]);

        if (oldStudents.length) {
            const students = oldStudents.map((s, index) => ({
                id: uid('STU'),
                legacyId: s.id,
                admissionNo: s.admissionNumber || sequenceNumber('NAT/ADM', 2025, index + 1),
                name: s.name || 'Unnamed student',
                level: normaliseLevel(s.course),
                branchId: null,          // reassigned to the default branch below
                batchId: null,           // 1.0 frequently left this empty
                status: s.status === 'Active' ? STUDENT_STATUS.ACTIVE : STUDENT_STATUS.INACTIVE,
                joinedOn: s.joiningDate || localDate(),
                searchKey: String(s.name || '').toLowerCase(),
                importedFrom: '1.0',
                needsReview: !s.batchId,
                createdAt: nowISO(),
                updatedAt: nowISO(),
                deletedAt: null
            }));
            await db.putMany('students', students);
            result.students = students.length;
        }

        if (oldAdmissions.length) {
            const admissions = oldAdmissions.map((a) => ({
                id: uid('ADM'),
                legacyId: a.id,
                name: a.name || 'Unnamed applicant',
                level: normaliseLevel(a.courseLevel),
                branchId: null,
                appliedOn: a.appliedOn || localDate(),
                // 1.0 compared 'Pending Approval' and 'Pending approval' in
                // different files. Fold every casing to one value.
                status: /pending|submitted/i.test(a.status || '')
                    ? ADMISSION_STATUS.SUBMITTED
                    : /verified|approved/i.test(a.status || '')
                        ? ADMISSION_STATUS.APPROVED
                        : ADMISSION_STATUS.SUBMITTED,
                searchKey: String(a.name || '').toLowerCase(),
                importedFrom: '1.0',
                createdAt: nowISO(),
                updatedAt: nowISO(),
                deletedAt: null
            }));
            await db.putMany('admissions', admissions);
            result.admissions = admissions.length;
        }

        const receipts = oldFinance.filter((f) => f.recordType === 'RECEIPT' || f.receiptNumber);
        if (receipts.length) {
            const payments = receipts.map((r, index) => ({
                id: uid('PAY'),
                legacyId: r.id,
                receiptNo: r.receiptNumber || sequenceNumber('NAT/RCP', 2025, index + 1),
                studentId: null,
                invoiceId: null,
                branchId: null,
                amount: toPaise(r.amount || 0),
                mode: String(r.paymentMode || 'cash').toLowerCase(),
                paidOn: r.date || localDate(),
                status: PAYMENT_STATUS.CLEARED,
                note: 'Imported from Natyam ERP 1.0 — not linked to an invoice.',
                importedFrom: '1.0',
                needsReview: true,
                createdAt: nowISO(),
                updatedAt: nowISO(),
                deletedAt: null
            }));
            await db.putMany('payments', payments);
            result.payments = payments.length;
        }
    } catch (err) {
        console.warn('1.0 migration could not complete; continuing with a fresh database.', err);
    } finally {
        legacy.close();
    }

    return result;
}

function openLegacy(name) {
    return new Promise((resolve) => {
        let settled = false;
        const done = (value) => { if (!settled) { settled = true; resolve(value); } };

        try {
            // Opening without a version avoids triggering an upgrade on the old
            // database, which would destroy it if this code is wrong.
            const request = indexedDB.open(name);
            request.onsuccess = () => {
                const database = request.result;
                if (!database.objectStoreNames.length) { database.close(); return done(null); }
                done(database);
            };
            request.onerror = () => done(null);
            request.onupgradeneeded = () => {
                // The database did not exist. Abort so an empty one is not left behind.
                request.transaction?.abort();
                done(null);
            };
            setTimeout(() => done(null), 2500);
        } catch {
            done(null);
        }
    });
}

function normaliseLevel(value) {
    const text = String(value || '').toLowerCase();
    return LEVELS.find((l) => text.includes(l.value))?.value || LEVELS[0].value;
}

/* ==========================================================================
   GENERATORS
   ========================================================================== */

async function seedBranches() {
    const branches = [
        {
            id: uid('BRN'), code: 'HYD-C', name: 'Hyderabad — Central Campus',
            address: 'Road No. 12, Banjara Hills, Hyderabad 500034',
            phone: phone(), email: 'central@natyam.example', status: 'active',
            openedOn: '2016-06-15', capacity: 120
        },
        {
            id: uid('BRN'), code: 'SEC-N', name: 'Secunderabad — Nrityalaya',
            address: 'Sarojini Devi Road, Secunderabad 500003',
            phone: phone(), email: 'secunderabad@natyam.example', status: 'active',
            openedOn: '2021-08-01', capacity: 60
        }
    ].map(stamp);

    await db.putMany('branches', branches);
    return branches;
}

async function seedUsers(branches) {
    const users = [
        { id: uid('USR'), name: 'Acharya Mohan Krishna', role: 'owner', email: 'mohan@natyam.example', branchId: null, status: 'active' },
        { id: uid('USR'), name: 'Lalitha Prasad', role: 'registrar', email: 'lalitha@natyam.example', branchId: branches[0].id, status: 'active' },
        { id: uid('USR'), name: 'Venkat Rao', role: 'accountant', email: 'venkat@natyam.example', branchId: null, status: 'active' }
    ].map(stamp);

    await db.putMany('users', users);
    return users;
}

async function seedAcademicYears() {
    const current = academicYearOf();
    const years = [
        { id: uid('AY'), label: `${current.start}–${current.end}`, startsOn: `${current.start}-06-01`, endsOn: `${current.end}-05-31`, isCurrent: 1 },
        { id: uid('AY'), label: `${current.start - 1}–${current.start}`, startsOn: `${current.start - 1}-06-01`, endsOn: `${current.start}-05-31`, isCurrent: 0 }
    ].map(stamp);

    await db.putMany('academicYears', years);
    return years;
}

async function seedStaff(branches) {
    const teachers = [
        { name: 'Guru Radha Krishna Sarma', role: 'teacher', specialisation: 'Nritta, Bhama Kalapam', since: '2016-06-15' },
        { name: 'Smt. Padmavathi Devi', role: 'teacher', specialisation: 'Abhinaya, Ashtapadi', since: '2017-09-01' },
        { name: 'Sri Chandrasekhar Reddy', role: 'teacher', specialisation: 'Nattuvangam, Jathi', since: '2019-01-20' },
        { name: 'Kumari Sailaja Rao', role: 'teacher', specialisation: 'Foundation adavus', since: '2022-06-10' },
        { name: 'Sri Murali Mohan', role: 'musician', specialisation: 'Mridangam', since: '2018-03-05' },
        { name: 'Smt. Jayalakshmi', role: 'admin', specialisation: 'Front desk, admissions', since: '2020-07-01' }
    ];

    const staff = teachers.map((t, index) => stamp({
        id: uid('STF'),
        employeeNo: `NAT/EMP/${String(index + 1).padStart(3, '0')}`,
        name: t.name,
        role: t.role,
        specialisation: t.specialisation,
        branchId: index % 3 === 2 ? branches[1].id : branches[0].id,
        phone: phone(),
        email: emailFor(t.name),
        joinedOn: t.since,
        monthlySalary: toPaise(t.role === 'teacher' ? between(28000, 46000) : between(18000, 30000)),
        status: 'active',
        searchKey: `${t.name} ${t.specialisation}`.toLowerCase()
    }));

    await db.putMany('staff', staff);
    return staff;
}

async function seedFeePlans(year) {
    const plans = LEVELS.map((level, index) => stamp({
        id: uid('FPL'),
        name: `${level.label} — annual tuition`,
        level: level.value,
        academicYearId: year.id,
        amount: toPaise(1000 + index * 375),
        frequency: 'monthly',
        registrationFee: toPaise(index === 0 ? 2500 : 0),
        costumeFee: toPaise(index >= 2 ? 3500 : 0),
        status: 'active',
        description: level.description
    }));

    await db.putMany('feePlans', plans);
    return plans;
}

async function seedBatches(branches, staff) {
    const teachers = staff.filter((s) => s.role === 'teacher');

    const definitions = [
        { code: 'HYD-PRA-A', name: 'Prarambhika — weekday morning', level: 'prarambhika', branch: 0, days: ['Mon', 'Wed', 'Fri'], start: '06:30', end: '08:00' },
        { code: 'HYD-PRA-B', name: 'Prarambhika — weekend', level: 'prarambhika', branch: 0, days: ['Sat', 'Sun'], start: '08:00', end: '10:00' },
        { code: 'HYD-PRV-A', name: 'Praveshika — evening', level: 'praveshika', branch: 0, days: ['Tue', 'Thu'], start: '17:30', end: '19:30' },
        { code: 'HYD-MAD-A', name: 'Madhyama — advanced evening', level: 'madhyama', branch: 0, days: ['Mon', 'Wed', 'Fri'], start: '18:00', end: '20:00' },
        { code: 'HYD-VIS-A', name: 'Visharada — margam intensive', level: 'visharada', branch: 0, days: ['Sat'], start: '15:00', end: '18:00' },
        { code: 'SEC-PRA-A', name: 'Prarambhika — Secunderabad morning', level: 'prarambhika', branch: 1, days: ['Tue', 'Thu', 'Sat'], start: '07:00', end: '08:30' },
        { code: 'SEC-PRV-A', name: 'Praveshika — Secunderabad', level: 'praveshika', branch: 1, days: ['Mon', 'Fri'], start: '17:00', end: '19:00' },
        { code: 'HYD-ALK-A', name: 'Alankara — performance diploma', level: 'alankara', branch: 0, days: ['Sun'], start: '10:00', end: '13:00' }
    ];

    const batches = definitions.map((definition, index) => stamp({
        id: uid('BCH'),
        code: definition.code,
        name: definition.name,
        level: definition.level,
        branchId: branches[definition.branch].id,
        teacherId: teachers[index % teachers.length].id,
        days: definition.days,
        startTime: definition.start,
        endTime: definition.end,
        capacity: between(12, 22),
        room: `Hall ${String.fromCharCode(65 + (index % 3))}`,
        status: 'active'
    }));

    await db.putMany('batches', batches);
    return batches;
}

async function seedStudents(branches, batches, plans) {
    const total = 87;
    const students = [];
    const year = academicYearOf().start;

    for (let i = 0; i < total; i += 1) {
        const name = personName();
        // Weighted toward the lower levels, which is how a real school's
        // pyramid looks — most beginners, few at diploma.
        const roll = random();
        const level = roll < 0.4 ? 'prarambhika'
            : roll < 0.68 ? 'praveshika'
            : roll < 0.86 ? 'madhyama'
            : roll < 0.96 ? 'visharada' : 'alankara';

        const candidates = batches.filter((b) => b.level === level);
        const batch = candidates.length ? pick(candidates) : null;
        const branchId = batch ? batch.branchId : branches[0].id;
        const guardian = `${pick(GIVEN_NAMES)} ${name.split(' ')[1]}`;

        const status = chance(0.94) ? STUDENT_STATUS.ACTIVE
            : chance(0.6) ? STUDENT_STATUS.ON_LEAVE : STUDENT_STATUS.INACTIVE;

        students.push(stamp({
            id: uid('STU'),
            admissionNo: sequenceNumber('NAT/ADM', year, i + 1),
            name,
            level,
            branchId,
            batchId: batch?.id || null,
            feePlanId: plans.find((p) => p.level === level)?.id || null,
            status,
            gender: chance(0.72) ? 'female' : 'male',
            dateOfBirth: localDate(new Date(year - between(6, 22), between(0, 11), between(1, 28))),
            joinedOn: addDays(localDate(), -between(30, 1400)),
            guardianName: guardian,
            guardianRelation: chance(0.6) ? 'Mother' : 'Father',
            guardianPhone: phone(),
            guardianEmail: emailFor(guardian),
            alternatePhone: chance(0.4) ? phone() : null,
            address: `${between(1, 200)}, ${pick(STREETS)}, Hyderabad`,
            bloodGroup: pick(['A+', 'B+', 'O+', 'AB+', 'A-', 'O-']),
            medicalNotes: chance(0.12) ? pick(['Mild asthma — inhaler in bag', 'Dust allergy', 'Recovering ankle sprain, no jumps']) : null,
            emergencyContact: phone(),
            previousExperience: chance(0.3) ? pick(['2 years Bharatanatyam', 'School-level folk dance', 'Kuchipudi at another school, 1 year']) : null,
            searchKey: `${name} ${sequenceNumber('NAT/ADM', year, i + 1)} ${guardian} ${level}`.toLowerCase()
        }));
    }

    await db.putMany('students', students);
    return students;
}

/**
 * One worked example curriculum so a fresh install shows the module in use
 * rather than an empty screen. The default level vocabulary (Beginner /
 * Intermediate / Advanced) is created by the schema migration, so this only
 * builds a curriculum on top of it and assigns it to a slice of students —
 * independently of their batch, which is the whole point of the separation.
 */
async function seedCurriculum(students) {
    const curriculum = stamp({
        id: uid('CUR'),
        code: 'KUCHI-FND',
        name: 'Kuchipudi Foundation',
        description: 'The foundational course of study — posture, adavus and the first pure-dance items.',
        durationValue: 24,
        durationUnit: 'months',
        sortOrder: 1,
        status: 'active',
        searchKey: 'kuchipudi foundation kuchi-fnd',
        structure: {
            levels: [
                {
                    id: uid('CLN'), levelId: 'CLV-FND-1', levelName: 'Foundation - Level 1', sortOrder: 1,
                    stages: [
                        {
                            id: uid('STG'), name: 'Foundations', sortOrder: 1,
                            lessons: [
                                { id: uid('LSN'), name: 'Namaskaram', sortOrder: 1 },
                                { id: uid('LSN'), name: 'Araimandi (half-sitting posture)', sortOrder: 2 }
                            ]
                        },
                        {
                            id: uid('STG'), name: 'Adavus', sortOrder: 2,
                            lessons: [
                                { id: uid('LSN'), name: 'Tatta Adavu', sortOrder: 1 },
                                { id: uid('LSN'), name: 'Natta Adavu', sortOrder: 2 }
                            ]
                        }
                    ]
                },
                {
                    id: uid('CLN'), levelId: 'CLV-INT-CERT', levelName: 'Intermediate - Certificate', sortOrder: 2,
                    stages: [
                        {
                            id: uid('STG'), name: 'Nritta items', sortOrder: 1,
                            lessons: [
                                { id: uid('LSN'), name: 'Jatiswaram', sortOrder: 1 },
                                { id: uid('LSN'), name: 'Sabdam', sortOrder: 2 }
                            ]
                        }
                    ]
                }
            ]
        }
    });

    await db.putMany('curricula', [curriculum]);

    // Assign to roughly a third of active students, re-writing only those rows.
    const assigned = students
        .filter((s) => s.status === STUDENT_STATUS.ACTIVE && chance(0.34))
        .map((s) => ({ ...s, curriculumId: curriculum.id, updatedAt: nowISO() }));
    if (assigned.length) await db.putMany('students', assigned);

    return curriculum;
}

async function seedAdmissions(branches, plans) {
    const admissions = [];
    const statuses = [
        ADMISSION_STATUS.SUBMITTED, ADMISSION_STATUS.SUBMITTED, ADMISSION_STATUS.SUBMITTED,
        ADMISSION_STATUS.REVIEWING, ADMISSION_STATUS.REVIEWING,
        ADMISSION_STATUS.APPROVED, ADMISSION_STATUS.REJECTED
    ];

    for (let i = 0; i < 11; i += 1) {
        const name = personName();
        const level = pick(LEVELS.slice(0, 3)).value;
        const guardian = `${pick(GIVEN_NAMES)} ${name.split(' ')[1]}`;

        admissions.push(stamp({
            id: uid('ADM'),
            applicationNo: sequenceNumber('NAT/APP', academicYearOf().start, i + 1),
            name,
            level,
            branchId: pick(branches).id,
            feePlanId: plans.find((p) => p.level === level)?.id || null,
            status: statuses[i % statuses.length],
            appliedOn: addDays(localDate(), -between(1, 45)),
            dateOfBirth: localDate(new Date(2026 - between(6, 20), between(0, 11), between(1, 28))),
            guardianName: guardian,
            guardianPhone: phone(),
            guardianEmail: emailFor(guardian),
            address: `${between(1, 200)}, ${pick(STREETS)}, Hyderabad`,
            previousExperience: chance(0.4) ? '1 year Bharatanatyam' : null,
            searchKey: `${name} ${guardian} ${level}`.toLowerCase()
        }));
    }

    await db.putMany('admissions', admissions);
    return admissions;
}

async function seedAttendance(students, batches) {
    const records = [];
    const active = students.filter((s) => s.status === STUDENT_STATUS.ACTIVE && s.batchId);
    const dayCodes = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // 90 days of history. Enough for a six-month trend chart without producing
    // a database the demo takes ten seconds to seed.
    for (let back = 90; back >= 0; back -= 1) {
        const date = addDays(localDate(), -back);
        const dayCode = dayCodes[new Date(date).getDay()];

        for (const batch of batches) {
            if (!batch.days.includes(dayCode)) continue;

            const roster = active.filter((s) => s.batchId === batch.id);
            if (!roster.length) continue;

            for (const student of roster) {
                // Attendance is not uniform: most students are reliable, a few
                // are not, and everyone is worse during exam season.
                const reliability = 0.78 + (hashFraction(student.id) * 0.2);
                const roll = random();

                let status;
                if (roll < reliability) status = ATTENDANCE_STATUS.PRESENT;
                else if (roll < reliability + 0.06) status = ATTENDANCE_STATUS.LATE;
                else if (roll < reliability + 0.10) status = ATTENDANCE_STATUS.EXCUSED;
                else status = ATTENDANCE_STATUS.ABSENT;

                records.push(stamp({
                    id: uid('ATT'),
                    // Composite unique index. This is what makes saving a roll
                    // call twice an update rather than a duplicate — the exact
                    // bug that produced double rows in 1.0.
                    batchDate: `${batch.id}|${date}|${student.id}`,
                    studentId: student.id,
                    batchId: batch.id,
                    branchId: batch.branchId,
                    date,
                    status,
                    markedBy: batch.teacherId,
                    note: status === ATTENDANCE_STATUS.EXCUSED ? pick(['Unwell', 'Family function', 'School exam']) : null
                }));
            }
        }
    }

    // Written in chunks: a single transaction with ~15,000 puts is slow to
    // commit and blocks the boot screen.
    for (let i = 0; i < records.length; i += 2000) {
        await db.putMany('attendance', records.slice(i, i + 2000));
    }
    return records.length;
}

async function seedFeeBook(students, plans, branches) {
    const invoices = [];
    const payments = [];
    const year = academicYearOf().start;
    let invoiceSeq = 0;
    let receiptSeq = 0;

    for (const student of students) {
        if (student.status === STUDENT_STATUS.INACTIVE) continue;

        const plan = plans.find((p) => p.id === student.feePlanId) || plans[0];
        const count = 12;
        const each = Number(plan.amount) || 0;

        for (let i = 0; i < count; i += 1) {
            const dueDate = addDays(student.joinedOn, i * Math.round(365 / count));
            // Only bill months whose due date has arrived or is near.
            if (dueDate > addDays(localDate(), 45)) continue;

            invoiceSeq += 1;
            const invoiceId = uid('INV');
            const overdue = dueDate < localDate();

            // Most families pay. Some pay part. A few are late.
            const outcome = random();
            const paidAmount = outcome < 0.72 ? each
                : outcome < 0.88 ? Math.round(each * (0.3 + random() * 0.4))
                : 0;

            const status = paidAmount >= each ? INVOICE_STATUS.PAID
                : paidAmount > 0 ? INVOICE_STATUS.PARTIAL
                : overdue ? INVOICE_STATUS.OVERDUE : INVOICE_STATUS.OPEN;

            invoices.push(stamp({
                id: invoiceId,
                number: sequenceNumber('NAT/INV', year, invoiceSeq),
                studentId: student.id,
                studentName: student.name,
                branchId: student.branchId,
                feePlanId: plan.id,
                description: `${plan.name} — monthly fee ${i + 1} of ${count}`,
                amount: each,
                paidAmount,
                balance: each - paidAmount,
                dueDate,
                issuedOn: addDays(dueDate, -14),
                status
            }));

            if (paidAmount > 0) {
                receiptSeq += 1;
                payments.push(stamp({
                    id: uid('PAY'),
                    receiptNo: sequenceNumber('NAT/RCP', year, receiptSeq),
                    invoiceId,
                    studentId: student.id,
                    studentName: student.name,
                    branchId: student.branchId,
                    amount: paidAmount,
                    mode: pick(['upi', 'upi', 'upi', 'cash', 'bank', 'card']),
                    reference: chance(0.7) ? `UTR${between(100000000, 999999999)}` : null,
                    paidOn: addDays(dueDate, between(-5, 12)),
                    status: PAYMENT_STATUS.CLEARED,
                    collectedBy: 'seed'
                }));
            }
        }
    }

    await db.putMany('invoices', invoices);
    await db.putMany('payments', payments);
    // The next real invoice must not reuse a seeded number. Returning the
    // counters actually reached keeps the sequences correct no matter how many
    // rows the fixture happens to produce.
    invoices.sequences = { invoice: invoiceSeq, receipt: receiptSeq };
    return invoices;
}

async function seedFinance(branches, staff, invoices) {
    const entries = [];
    const expenses = [];

    // Six months of operating expenses, at plausible ratios for a dance school:
    // rent and salaries dominate, everything else is noise around them.
    for (let back = 5; back >= 0; back -= 1) {
        const month = addDays(localDate(), -back * 30);
        const key = monthKey(month);

        expenses.push(stamp({
            id: uid('EXP'), branchId: branches[0].id, date: `${key}-05`,
            category: 'Rent', amount: toPaise(45000),
            description: 'Central campus — monthly rent', paidTo: 'Sri Venkateswara Properties',
            mode: 'bank', status: 'paid', period: key
        }));
        expenses.push(stamp({
            id: uid('EXP'), branchId: branches[1].id, date: `${key}-05`,
            category: 'Rent', amount: toPaise(22000),
            description: 'Secunderabad — monthly rent', paidTo: 'Nrityalaya Trust',
            mode: 'bank', status: 'paid', period: key
        }));

        for (let i = 0; i < between(4, 8); i += 1) {
            const category = pick(EXPENSE_CATEGORIES.filter((c) => c !== 'Rent' && c !== 'Salaries'));
            expenses.push(stamp({
                id: uid('EXP'),
                branchId: pick(branches).id,
                date: `${key}-${String(between(2, 27)).padStart(2, '0')}`,
                category,
                amount: toPaise(between(800, 18000)),
                description: `${category} — ${pick(['monthly', 'annual programme', 'replacement', 'routine'])}`,
                paidTo: pick(['Local vendor', 'Sangeet Stores', 'Kalanjali', 'Online purchase']),
                mode: pick(['upi', 'cash', 'bank']),
                status: 'paid',
                period: key
            }));
        }

        for (const member of staff) {
            entries.push(stamp({
                id: uid('LDG'), branchId: member.branchId, date: `${key}-01`,
                account: 'Salaries', type: 'expense', amount: member.monthlySalary,
                narration: `Salary — ${member.name}`, sourceId: member.id, period: key
            }));
        }
    }

    await db.putMany('expenses', expenses);
    await db.putMany('ledgerEntries', entries);
}

async function seedPrograms(branches) {
    const programs = [
        { name: 'Annual Day — Rangapravesham', type: 'performance', offset: 34, venue: 'Ravindra Bharathi' },
        { name: 'Bhama Kalapam intensive workshop', type: 'workshop', offset: 12, venue: 'Central Campus, Hall A' },
        { name: 'Level examinations — Praveshika', type: 'examination', offset: 21, venue: 'Central Campus' },
        { name: 'Inter-school Kuchipudi competition', type: 'competition', offset: 58, venue: 'Shilpakala Vedika' },
        { name: 'Dasara Utsav performance', type: 'performance', offset: -26, venue: 'Chilkur Temple' },
        { name: 'Guru Purnima recital', type: 'performance', offset: -62, venue: 'Central Campus' }
    ].map((p) => stamp({
        id: uid('PRG'),
        name: p.name,
        type: p.type,
        branchId: branches[0].id,
        date: addDays(localDate(), p.offset),
        venue: p.venue,
        status: p.offset < 0 ? 'completed' : 'scheduled',
        participantCount: between(8, 40),
        description: null
    }));

    await db.putMany('programs', programs);
}

async function seedNotifications(students) {
    const upcoming = students.filter((s) => s.status === STUDENT_STATUS.ACTIVE).slice(0, 3);

    const items = [
        { kind: 'fee', title: '7 invoices are now overdue', body: 'Oldest is 34 days past due.', read: 0 },
        { kind: 'admission', title: '3 applications awaiting review', body: 'Submitted in the last week.', read: 0 },
        { kind: 'program', title: 'Annual Day is in 34 days', body: 'Participant list is not yet finalised.', read: 0 },
        ...upcoming.map((s) => ({ kind: 'birthday', title: `${s.name} has a birthday this month`, body: null, read: 1 }))
    ].map((n) => stamp({
        id: uid('NTF'),
        kind: n.kind,
        title: n.title,
        body: n.body,
        read: n.read,
        link: null
    }));

    await db.putMany('notifications', items);
}

async function seedSettings(year, sequences = {}) {
    await db.putMany('settings', [
        { key: 'institute', value: { name: 'NATYAM — School of Kuchipudi', founded: 2016, principal: 'Acharya Mohan Krishna', gstin: null } },
        { key: 'currentAcademicYearId', value: year.id },
        { key: 'sequences', value: {
            admission: 88, application: 12, certificate: 24,
            invoice: sequences.invoice ?? 400,
            receipt: sequences.receipt ?? 340
        } },
        { key: 'seededAt', value: nowISO() }
    ]);
}

/* ------------------------------------------------------------------ HELPERS */

function stamp(record) {
    return {
        createdAt: nowISO(),
        createdBy: 'seed',
        updatedAt: nowISO(),
        updatedBy: 'seed',
        deletedAt: null,
        ...record
    };
}

/** Stable 0–1 value from an id, for per-student traits that must not vary. */
function hashFraction(value) {
    let hash = 0;
    const text = String(value);
    for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
    return Math.abs(hash % 1000) / 1000;
}
