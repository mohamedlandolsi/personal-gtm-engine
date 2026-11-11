// Sprint 14: print every line of a file that holds a non-ASCII character, with those characters as \uXXXX escapes.
// Usage: node scripts/s14/show_non_ascii.mjs <file>
import fs from 'node:fs';
const s = fs.readFileSync(process.argv[2], 'utf8');
const lines = s.split('\n');
lines.forEach((l, i) => {
  if (/[^\x00-\x7f]/.test(l)) console.log((i + 1) + ': ' + l.replace(/[^\x00-\x7f]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')));
});
console.log(`lines ${lines.length}, chars ${s.length}, CR ${(s.match(/\r/g) || []).length}, tabs ${(s.match(/\t/g) || []).length}`);
