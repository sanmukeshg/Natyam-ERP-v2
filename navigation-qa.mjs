/**
 * Finds exports nobody imports (dead code) and identically-named local helper
 * functions defined in more than one file (candidates for extraction).
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

const sources = new Map(files.map((f) => [f, fs.readFileSync(f, 'utf8')]));
const allSource = [...sources.values()].join('\n');

/* ---------------------------------------------------------- DEAD EXPORTS */

const dead = [];

for (const [file, source] of sources) {
    const rel = path.relative(ROOT, file);
    // Entry point and page modules are loaded dynamically by the router; their
    // default export is used by name nowhere.
    if (rel.endsWith('app.js')) continue;

    const names = new Set();
    const patterns = [
        /export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g,
        /export\s+class\s+([A-Za-z0-9_$]+)/g,
        /export\s+const\s+([A-Za-z0-9_$]+)/g
    ];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(source))) names.add(match[1]);
    }

    for (const name of names) {
        // Count references outside the defining file.
        let used = false;
        for (const [other, otherSource] of sources) {
            if (other === file) continue;
            // `$`-suffixed repository singletons need a trailing boundary that
            // isn't \b, since `$` is not a word character.
            const escaped = name.replace(/\$/g, '\\$');
            const referenced = name.endsWith('$')
                ? new RegExp(`\\b${escaped}`).test(otherSource)
                : new RegExp(`\\b${escaped}\\b`).test(otherSource);
            if (referenced) { used = true; break; }
        }
        if (!used) dead.push(`${rel}: ${name}`);
    }
}

/* ------------------------------------------------------ DUPLICATE HELPERS */

const localFunctions = new Map();

for (const [file, source] of sources) {
    const pattern = /^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm;
    let match;
    while ((match = pattern.exec(source))) {
        const name = match[1];
        if (!localFunctions.has(name)) localFunctions.set(name, []);
        localFunctions.get(name).push(path.relative(ROOT, file));
    }
}

const duplicates = [...localFunctions.entries()]
    .filter(([, where]) => where.length > 1)
    .map(([name, where]) => `${name}  (${where.length}x): ${where.join(', ')}`);

console.log(`— Unreferenced exports (${dead.length}) —`);
for (const entry of dead) console.log('  ' + entry);
console.log(`\n— Duplicate local helper names (${duplicates.length}) —`);
for (const entry of duplicates) console.log('  ' + entry);

void allSource;
