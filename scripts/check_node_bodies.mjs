// Syntax check for the n8n Code node bodies kept in scripts/s14/ (one file per node, named after the node).
// n8n wraps a Code node body in an async function, so top-level await and return are legal there.
// This compiles each body the same way, without running it. Exit code 0 = every body compiles.
// Run from the repo root: node scripts/check_node_bodies.mjs
import fs from 'node:fs';
import path from 'node:path';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const dir = 'scripts/s14';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && !f.endsWith('.sdk.js')).sort();
let failed = 0;
for (const f of files) {
  const code = fs.readFileSync(path.join(dir, f), 'utf8');
  try {
    new AsyncFunction('$', '$input', '$env', code);
    console.log(`PASS  ${f}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${f}  ${e.message}`);
  }
}
console.log(failed ? `${failed} of ${files.length} node bodies failed` : `All ${files.length} node bodies compile`);
process.exit(failed ? 1 : 0);
