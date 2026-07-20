/**
 * Detects import cycles. Circular ES modules do not throw — they resolve to
 * `undefined` bindings at the moment of use, which surfaces as "x is not a
 * function" from a file that plainly exports x. Worth catching statically.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const graph = new Map();

(function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) {
            const source = fs.readFileSync(full, 'utf8');
            const deps = [];
            // Static imports only. A dynamic import inside a function body is
            // a legitimate way to break a cycle and must not be counted.
            const pattern = /^\s*import\s+[^;]*?from\s+['"](\.[^'"]+)['"]/gm;
            let match;
            while ((match = pattern.exec(source))) {
                deps.push(path.relative(ROOT, path.resolve(path.dirname(full), match[1])));
            }
            graph.set(path.relative(ROOT, full), deps);
        }
    }
})(path.join(ROOT, 'js'));

const cycles = [];
const state = new Map();

function visit(node, stack) {
    if (state.get(node) === 'done') return;
    if (state.get(node) === 'open') {
        cycles.push([...stack.slice(stack.indexOf(node)), node].join(' -> '));
        return;
    }
    state.set(node, 'open');
    for (const dep of graph.get(node) || []) visit(dep, [...stack, node]);
    state.set(node, 'done');
}

for (const node of graph.keys()) visit(node, []);

if (cycles.length) {
    console.log(`${cycles.length} import cycles:\n`);
    for (const cycle of [...new Set(cycles)]) console.log('  ' + cycle);
    process.exitCode = 1;
} else {
    console.log(`No import cycles across ${graph.size} modules.`);
}
