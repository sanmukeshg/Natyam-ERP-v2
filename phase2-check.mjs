/**
 * CSS coverage check.
 *
 * Extracts every class name referenced from JS template markup and compares it
 * against the classes the stylesheets actually define. In an app with no build
 * step and no CSS-in-JS, a class that exists only in a template is invisible
 * until someone opens that screen and finds it unstyled.
 *
 * Reports both directions: classes used but never defined (broken screens) and
 * classes defined but never used (dead CSS).
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

/* ------------------------------------------------------------ CLASSES USED */

const used = new Map();   // class -> Set(files)
const jsFiles = [];

(function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) jsFiles.push(full);
    }
})(path.join(ROOT, 'js'));

function record(name, file) {
    if (!name) return;
    if (!used.has(name)) used.set(name, new Set());
    used.get(name).add(path.relative(ROOT, file));
}

for (const file of jsFiles) {
    const source = fs.readFileSync(file, 'utf8');

    // Only look inside class attributes. An earlier version scanned every
    // quoted string that "looked like a class", which happily reported icon
    // names and aria attribute values as missing CSS.
    const attrPattern = /class="((?:[^"]|\$\{[^}]*\})*)"/g;
    let match;
    while ((match = attrPattern.exec(source))) {
        const value = match[1];

        // Literal tokens, once interpolations are stripped out.
        for (const token of value.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
            record(token.trim(), file);
        }

        // Tokens inside the interpolations themselves, which is where
        // conditional classes live: ${x ? 'badge-success' : 'badge-danger'}
        const inner = value.match(/\$\{[^}]*\}/g) || [];
        for (const expression of inner) {
            const strings = expression.match(/'[^']*'|"[^"]*"/g) || [];
            for (const literal of strings) {
                for (const token of literal.slice(1, -1).split(/\s+/)) {
                    record(token.trim(), file);
                }
            }
        }
    }

    // classList.toggle('x') / add / remove
    const listPattern = /classList\.(?:toggle|add|remove)\(\s*['"]([a-z0-9-]+)['"]/g;
    while ((match = listPattern.exec(source))) record(match[1], file);
}

/* --------------------------------------------------------- CLASSES DEFINED */

const defined = new Set();
const cssDir = path.join(ROOT, 'assets', 'css');

for (const name of fs.readdirSync(cssDir)) {
    if (!name.endsWith('.css')) continue;
    const source = fs.readFileSync(path.join(cssDir, name), 'utf8');
    const pattern = /\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g;
    let match;
    while ((match = pattern.exec(source))) defined.add(match[1]);
}

/* ------------------------------------------------------------------ REPORT */

// Tokens that are not classes but slip through the heuristics.
const IGNORE = new Set([
    'text-align', 'font-size', 'e-g', 'i-e', 'dd-mm-yyyy', 'yyyy-mm-dd',
    'utf-8', 'image-svg', 'application-json', 'text-csv', 'prefers-color-scheme'
]);

const missing = [...used.entries()]
    .filter(([name]) => !defined.has(name) && !IGNORE.has(name))
    .filter(([name]) => /^[a-z]/.test(name))
    .sort((a, b) => b[1].size - a[1].size);

console.log(`— Classes used in JS but not defined in CSS (${missing.length}) —\n`);
for (const [name, files] of missing) {
    console.log(`  .${name}`.padEnd(34) + `${[...files].join(', ')}`);
}
