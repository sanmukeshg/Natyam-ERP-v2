/**
 * NATYAM ERP 2.0 — Import service
 *
 * Bringing records in from a spreadsheet, which is how every one of these
 * schools starts: eighty students in a shared Excel file that someone has
 * maintained for six years.
 *
 * The single most important behaviour here is the dry run. An import that
 * writes as it goes and fails halfway leaves a database nobody can reason
 * about — some students in, some not, and no way to tell which without reading
 * all of them. So this validates every row first, reports what it found, and
 * only writes when the caller confirms. Rows that fail validation are never
 * silently skipped; they come back with a reason attached.
 *
 * Imports go through the normal services, not the repositories. A student
 * created by import gets the same admission number, the same audit entry and
 * the same fee schedule as one typed in by hand — otherwise imported records
 * become second-class citizens with missing fields nobody notices for a year.
 */

import { session } from '../core/session.js';
import { localDate } from '../utils/date.js';
import { toAmount } from '../utils/money.js';
import { LEVELS, STUDENT_STATUS } from '../config/app.config.js';
import { enrol } from './students.service.js';
import { hire, STAFF_ROLES } from './staff.service.js';
import { listBatches } from './batches.service.js';
import { listBranches } from './settings.service.js';

/* ==========================================================================
   PARSING
   ========================================================================== */

/**
 * A small, correct CSV reader. Correct matters more than fast here: real
 * exports contain quoted fields with commas in addresses and newlines inside
 * notes, and a split(',') parser mangles exactly the rows a human would never
 * think to check.
 */
export function parseCSV(text) {
    const clean = String(text).replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let value = '';
    let quoted = false;

    for (let i = 0; i < clean.length; i += 1) {
        const char = clean[i];

        if (quoted) {
            if (char === '"') {
                if (clean[i + 1] === '"') { value += '"'; i += 1; } else { quoted = false; }
            } else {
                value += char;
            }
            continue;
        }

        if (char === '"') { quoted = true; continue; }
        if (char === ',') { row.push(value); value = ''; continue; }
        if (char === '\r') continue;
        if (char === '\n') { row.push(value); rows.push(row); row = []; value = ''; continue; }
        value += char;
    }

    if (value !== '' || row.length) { row.push(value); rows.push(row); }

    const nonEmpty = rows.filter((r) => r.some((cell) => cell.trim() !== ''));
    if (!nonEmpty.length) return { headers: [], rows: [] };

    const headers = nonEmpty[0].map((h) => h.trim());
    return {
        headers,
        rows: nonEmpty.slice(1).map((cells) =>
            Object.fromEntries(headers.map((header, index) => [header, (cells[index] ?? '').trim()])))
    };
}

/** JSON array or an object wrapping one — both shapes turn up in the wild. */
export function parseJSON(text) {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return { headers: Object.keys(parsed[0] || {}), rows: parsed };
    if (Array.isArray(parsed.rows)) return { headers: Object.keys(parsed.rows[0] || {}), rows: parsed.rows };
    if (Array.isArray(parsed.data)) return { headers: Object.keys(parsed.data[0] || {}), rows: parsed.data };
    throw new Error('That JSON file does not contain a list of records.');
}

export async function readFile(file) {
    const text = await file.text();
    return file.name.toLowerCase().endsWith('.json') ? parseJSON(text) : parseCSV(text);
}

/* ==========================================================================
   IMPORTERS
   ========================================================================== */

export const IMPORTERS = Object.freeze([
    {
        id: 'students',
        label: 'Students',
        description: 'Adds students to the roll. Each needs a name, a level and a guardian phone number.',
        required: ['name', 'level', 'guardianName', 'guardianPhone'],
        optional: ['admissionNo', 'dateOfBirth', 'gender', 'batch', 'joinedOn', 'guardianEmail',
            'guardianRelation', 'alternatePhone', 'address', 'medicalNotes', 'notes'],
        sample: {
            name: 'Ananya Rao', level: 'foundation-1', guardianName: 'Lakshmi Rao',
            guardianPhone: '9876543210', batch: 'Foundation Level 1 Morning', joinedOn: '2026-06-01'
        }
    },
    {
        id: 'staff',
        label: 'Staff',
        description: 'Adds teachers and other staff. Each needs a name, a role and a phone number.',
        required: ['name', 'role', 'phone'],
        optional: ['employeeNo', 'specialisation', 'email', 'address', 'joinedOn', 'monthlySalary'],
        sample: {
            name: 'Sridevi Kumar', role: 'teacher', phone: '9876500011',
            specialisation: 'Nattuvangam', monthlySalary: '32000'
        }
    }
]);

export function importerById(id) {
    const found = IMPORTERS.find((i) => i.id === id);
    if (!found) throw new Error(`There is no importer called "${id}".`);
    return found;
}

/* ==========================================================================
   VALIDATION
   ========================================================================== */

/**
 * Checks every row without writing anything, and returns exactly what would
 * happen. The caller shows this and asks for confirmation.
 */
export async function dryRun(importerId, rows, { branchId = null } = {}) {
    session.require('student.edit', 'import records');

    const importer = importerById(importerId);

    // The branch has to be settled here, not at commit time. Every record needs
    // one, and if it cannot be resolved the write fails for all of them — after
    // the preview has already told the user the rows were fine. A dry run that
    // does not check the thing that will actually stop the write is worse than
    // no dry run, because it is trusted.
    const target = branchId || session.activeBranchId || await soleBranch();
    const context = await buildContext(importerId, target);

    const checked = rows.map((row, index) => {
        const problems = [];
        const mapped = MAPPERS[importerId](row, context, problems);

        mapped.branchId = mapped.branchId || target;
        if (!mapped.branchId) {
            problems.push('no branch could be determined — choose one branch before importing');
        }

        for (const field of importer.required) {
            if (mapped[field] === null || mapped[field] === undefined || mapped[field] === '') {
                problems.push(`${field} is missing`);
            }
        }

        return { line: index + 2, raw: row, values: mapped, problems, ok: problems.length === 0 };
    });

    const ok = checked.filter((row) => row.ok);

    return {
        importer,
        total: checked.length,
        valid: ok.length,
        invalid: checked.length - ok.length,
        rows: checked,
        branchId: target,
        warnings: warningsFor(importerId, ok, context)
    };
}

/**
 * When the user is viewing "all branches" there is no active branch to inherit,
 * but a school with exactly one branch has no ambiguity to resolve — so resolve
 * it rather than making them go and switch context first.
 */
async function soleBranch() {
    const branches = await listBranches();
    return branches.length === 1 ? branches[0].id : null;
}

/**
 * Writes the valid rows. Deliberately sequential rather than parallel: each
 * write allocates a human sequence number from an atomic counter, and eighty
 * concurrent allocations would serialise on that counter anyway while making
 * a partial failure far harder to describe.
 */
export async function commit(importerId, checkedRows, { branchId = null, raiseFees = false } = {}) {
    session.require('student.edit', 'import records');

    const valid = checkedRows.filter((row) => row.ok);
    const created = [];
    const failed = [];

    for (const row of valid) {
        try {
            const record = importerId === 'students'
                ? (await enrol({ ...row.values, branchId: row.values.branchId || branchId }, { raiseFees })).student
                : await hire({ ...row.values, branchId: row.values.branchId || branchId });
            created.push(record);
        } catch (err) {
            failed.push({ line: row.line, name: row.values.name, reason: err.message });
        }
    }

    return {
        created: created.length,
        failed,
        skipped: checkedRows.length - valid.length,
        records: created
    };
}

/* ==========================================================================
   MAPPING
   ========================================================================== */

async function buildContext(importerId, branchId) {
    if (importerId !== 'students') return {};
    const batches = await listBatches(branchId, { includeClosed: false });
    return {
        batches,
        byName: new Map(batches.map((b) => [b.name.toLowerCase(), b])),
        byCode: new Map(batches.filter((b) => b.code).map((b) => [b.code.toLowerCase(), b]))
    };
}

const MAPPERS = {
    students(row, context, problems) {
        const level = matchLevel(row.level || row.Level);
        if ((row.level || row.Level) && !level) problems.push(`"${row.level || row.Level}" is not a known level`);

        const batchText = pick(row, 'batch', 'Batch', 'batchName');
        let batch = null;
        if (batchText) {
            batch = context.byName?.get(batchText.toLowerCase())
                || context.byCode?.get(batchText.toLowerCase())
                || null;
            if (!batch) problems.push(`no open batch called "${batchText}"`);
            else if (batch.capacity && batch.enrolled >= batch.capacity) {
                problems.push(`${batch.name} is full`);
            }
        }

        const phone = digits(pick(row, 'guardianPhone', 'Phone', 'phone', 'Contact'));
        if (phone && phone.length < 10) problems.push('the guardian phone number looks too short');

        return {
            name: clean(pick(row, 'name', 'Name', 'Student')),
            admissionNo: clean(pick(row, 'admissionNo', 'Admission no.', 'Admission no')) || null,
            level,
            dateOfBirth: normaliseDate(pick(row, 'dateOfBirth', 'Date of birth', 'DOB')),
            gender: (pick(row, 'gender', 'Gender') || '').toLowerCase() || null,
            joinedOn: normaliseDate(pick(row, 'joinedOn', 'Joined', 'Joined on')) || localDate(),
            batchId: batch?.id || null,
            guardianName: clean(pick(row, 'guardianName', 'Parent', 'Guardian')),
            guardianRelation: clean(pick(row, 'guardianRelation', 'Relationship')) || 'Guardian',
            guardianPhone: phone || null,
            guardianEmail: (pick(row, 'guardianEmail', 'Email') || '').toLowerCase() || null,
            alternatePhone: digits(pick(row, 'alternatePhone', 'Emergency contact')) || null,
            address: clean(pick(row, 'address', 'Address')) || null,
            medicalNotes: clean(pick(row, 'medicalNotes', 'Medical notes')) || null,
            notes: clean(pick(row, 'notes', 'Notes')) || null,
            status: STUDENT_STATUS.ACTIVE
        };
    },

    staff(row, _context, problems) {
        const roleText = (pick(row, 'role', 'Role') || '').toLowerCase();
        const role = STAFF_ROLES.find((r) => r.value === roleText || r.label.toLowerCase() === roleText);
        if (roleText && !role) problems.push(`"${roleText}" is not a known role`);

        const salary = pick(row, 'monthlySalary', 'Salary');

        return {
            name: clean(pick(row, 'name', 'Name')),
            employeeNo: clean(pick(row, 'employeeNo', 'Employee no.', 'Employee no')) || null,
            role: role?.value || null,
            specialisation: clean(pick(row, 'specialisation', 'Specialisation')) || null,
            phone: digits(pick(row, 'phone', 'Phone', 'Contact')) || null,
            email: (pick(row, 'email', 'Email') || '').toLowerCase() || null,
            address: clean(pick(row, 'address', 'Address')) || null,
            joinedOn: normaliseDate(pick(row, 'joinedOn', 'Joined')) || localDate(),
            monthlySalary: salary ? toAmount(salary) : null
        };
    }
};

function warningsFor(importerId, rows, context) {
    const warnings = [];

    if (importerId === 'students') {
        const unplaced = rows.filter((row) => !row.values.batchId).length;
        if (unplaced) {
            warnings.push(`${unplaced} student${unplaced === 1 ? '' : 's'} will have no batch. `
                + 'They appear on no register until placed.');
        }
        if (!context.batches?.length) {
            warnings.push('There are no open batches, so nobody can be placed during this import.');
        }

        const seen = new Set();
        const duplicates = rows.filter((row) => {
            const key = `${row.values.name}|${row.values.guardianPhone}`;
            if (seen.has(key)) return true;
            seen.add(key);
            return false;
        }).length;
        if (duplicates) warnings.push(`${duplicates} row${duplicates === 1 ? ' looks like a duplicate' : 's look like duplicates'} within this file.`);
    }

    return warnings;
}

/* ------------------------------------------------------------------ HELPERS */

function pick(row, ...keys) {
    for (const key of keys) {
        if (row[key] !== undefined && String(row[key]).trim() !== '') return String(row[key]).trim();
    }
    return '';
}

function clean(value) {
    return String(value || '').trim().replace(/\s+/g, ' ') || null;
}

function digits(value) {
    return String(value || '').replace(/\D/g, '') || null;
}

function matchLevel(value) {
    if (!value) return null;
    const text = String(value).trim().toLowerCase();
    return LEVELS.find((level) =>
        level.value === text || level.label.toLowerCase() === text)?.value || null;
}

/** Accepts ISO, dd/mm/yyyy and dd-mm-yyyy — what Indian spreadsheets contain. */
function normaliseDate(value) {
    if (!value) return null;
    const text = String(value).trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

    const parts = text.split(/[/\-.]/);
    if (parts.length === 3 && parts[0].length <= 2) {
        const [day, month, year] = parts;
        const full = year.length === 2 ? `20${year}` : year;
        return `${full}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    return null;
}
