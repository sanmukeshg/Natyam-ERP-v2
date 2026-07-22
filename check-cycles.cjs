/**
 * Integration checker.
 *
 * Parses every module's import statements, resolves the target file, and
 * confirms each named import is actually exported there. This is the class of
 * bug that unit tests miss and that only shows up as a blank screen at
 * runtime, because ES module resolution failures happen at load time in the
 * browser and there is no build step here to catch them.
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

/** Collects every exported binding name from a module's source. */
function exportsOf(source) {
    const names = new Set();

    const patterns = [
        /export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g,
        /export\s+class\s+([A-Za-z0-9_$]+)/g,
        /export\s+const\s+([A-Za-z0-9_$]+)/g,
        /export\s+let\s+([A-Za-z0-9_$]+)/g,
        /export\s+var\s+([A-Za-z0-9_$]+)/g
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(source))) names.add(match[1]);
    }

    // export { a, b as c }
    const braces = /export\s*\{([^}]*)\}/g;
    let match;
    while ((match = braces.exec(source))) {
        for (const part of match[1].split(',')) {
            const piece = part.trim();
            if (!piece) continue;
            const asMatch = piece.match(/\bas\s+([A-Za-z0-9_$]+)/);
            names.add(asMatch ? asMatch[1] : piece);
        }
    }

    if (/export\s+default/.test(source)) names.add('default');
    return names;
}

const problems = [];
const exportCache = new Map();

function exportsFor(file) {
    if (!exportCache.has(file)) {
        exportCache.set(file, exportsOf(fs.readFileSync(file, 'utf8')));
    }
    return exportCache.get(file);
}

for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const importPattern = /import\s+([^;]*?)\s+from\s+['"]([^'"]+)['"]/g;
    let match;

    while ((match = importPattern.exec(source))) {
        const [, clause, specifier] = match;
        if (!specifier.startsWith('.')) continue;

        const target = path.resolve(path.dirname(file), specifier);
        const rel = path.relative(ROOT, file);

        if (!fs.existsSync(target)) {
            problems.push(`${rel}: imports missing file ${specifier}`);
            continue;
        }

        const available = exportsFor(target);
        const braced = clause.match(/\{([^}]*)\}/);
        if (!braced) continue;

        for (const part of braced[1].split(',')) {
            const piece = part.trim();
            if (!piece) continue;
            const name = piece.split(/\s+as\s+/)[0].trim();
            if (name && !available.has(name)) {
                problems.push(`${rel}: "${name}" is not exported by ${specifier}`);
            }
        }
    }

    // Dynamic imports too — these fail at the moment a route is opened.
    const dynamicPattern = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = dynamicPattern.exec(source))) {
        const specifier = match[1];
        if (!specifier.startsWith('.')) continue;
        const target = path.resolve(path.dirname(file), specifier);
        if (!fs.existsSync(target)) {
            problems.push(`${path.relative(ROOT, file)}: dynamic import of missing ${specifier}`);
        }
    }
}

if (problems.length) {
    console.log(`${problems.length} import problems:\n`);
    for (const problem of problems) console.log('  ' + problem);
    process.exitCode = 1;
} else {
    console.log(`All imports resolve across ${files.length} files.`);
}
