/**
 * Field consistency check.
 *
 * The academic-year screen was dead because three files disagreed about what a
 * year record is called: the seed wrote `startsOn`, the service sorted on
 * `startDate`, and the page displayed `name`. Nothing failed at import time and
 * nothing failed at parse time — it only threw when a person opened the tab.
 *
 * This looks for more of the same. For each store it collects the field names
 * that are *written* (in seed data and in repository create calls) and the
 * field names that are *read* off records of that type, then reports reads with
 * no corresponding write.
 *
 * It is a heuristic and will produce false positives — computed fields, fields
 * added by services after load, fields from joined records. It is meant to give
 * a short list worth eyeballing, not a verdict.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const files = [];

(function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) files.push(full);
    }
})(path.join(ROOT, 'js'));

const sources = new Map(files.map((f) => [path.relative(ROOT, f), fs.readFileSync(f, 'utf8')]));

/* Singular accessor names that indicate "this variable holds a record of type X". */
const ENTITIES = {
    student: 'students', batch: 'batches', invoice: 'invoices', payment: 'payments',
    expense: 'expenses', program: 'programs', certificate: 'certificates',
    branch: 'branches', year: 'academicYears', plan: 'feePlans', member: 'staff',
    application: 'admissions', admission: 'admissions', entry: 'ledgerEntries',
    salary: 'salaries', row: null, record: null
};

/* Fields written anywhere, per store, gathered from object literals near a
   store name and from the seed file. */
const written = new Map();

function addWritten(store, field) {
    if (!store) return;
    if (!written.has(store)) written.set(store, new Set());
    written.get(store).add(field);
}

// Seed file: `await db.putMany('storeName', rows)` preceded by object literals.
const seed = sources.get('js/data/seed.js') || '';
for (const match of seed.matchAll(/putMany\('([a-zA-Z]+)'/g)) {
    const store = match[1];
    // Take the 4000 characters before the call — the literals that built it.
    const chunk = seed.slice(Math.max(0, match.index - 4000), match.index);
    for (const field of chunk.matchAll(/\b([a-zA-Z][a-zA-Z0-9]*)\s*:/g)) {
        addWritten(store, field[1]);
    }
}

// Service creates: `xxx$.create({ ... })` — attribute the literal to that repo.
for (const [, source] of sources) {
    for (const match of source.matchAll(/([a-zA-Z]+)\$\.(?:create|update|put)\(/g)) {
        const repo = match[1];
        const store = repo === 'staff' ? 'staff' : repo;
        const chunk = source.slice(match.index, match.index + 1200);
        for (const field of chunk.matchAll(/\b([a-zA-Z][a-zA-Z0-9]*)\s*:/g)) addWritten(store, field[1]);
    }
    // Object literals assigned to a variable then written.
    for (const match of source.matchAll(/s\.([a-zA-Z]+)\.put\(/g)) {
        const store = match[1];
        const chunk = source.slice(Math.max(0, match.index - 2500), match.index);
        for (const field of chunk.matchAll(/\b([a-zA-Z][a-zA-Z0-9]*)\s*:/g)) addWritten(store, field[1]);
    }
}

/* Fields read, per entity variable name. */
const suspicious = [];

for (const [file, source] of sources) {
    if (file === 'js/data/seed.js') continue;

    for (const [variable, store] of Object.entries(ENTITIES)) {
        if (!store) continue;
        const pattern = new RegExp(`\\b${variable}\\.([a-zA-Z][a-zA-Z0-9]*)\\b`, 'g');
        for (const match of source.matchAll(pattern)) {
            const field = match[1];
            if (['id', 'map', 'filter', 'find', 'length', 'sort', 'reduce', 'some', 'every',
                 'slice', 'push', 'includes', 'forEach', 'join', 'toFixed', 'toString',
                 'flatMap', 'indexOf', 'concat', 'at', 'keys', 'values', 'entries'].includes(field)) continue;

            const known = written.get(store);
            if (known && known.size > 4 && !known.has(field)) {
                suspicious.push({ file, store, expression: `${variable}.${field}` });
            }
        }
    }
}

const grouped = new Map();
for (const item of suspicious) {
    const key = `${item.store}.${item.expression}`;
    if (!grouped.has(key)) grouped.set(key, new Set());
    grouped.get(key).add(item.file);
}

console.log(`— Reads with no matching write (${grouped.size}) —`);
console.log('  Heuristic: computed and joined fields will appear here legitimately.\n');
for (const [key, where] of [...grouped.entries()].sort()) {
    console.log(`  ${key.padEnd(38)} ${[...where].join(', ')}`);
}
