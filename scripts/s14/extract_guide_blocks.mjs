// Sprint 14: copy the code blocks out of the guide FILE (never retyped).
// Usage: node scripts/s14/extract_guide_blocks.mjs "<path to Sprint 14 - Engine Fixes Guide.md>"
// Writes scripts/s14/guide/: phase2_rules.js, tech_3_1.js, rules_4_1.js, prompt_4_2.json
import fs from 'node:fs';
import path from 'node:path';
const guidePath = process.argv[2];
const md = fs.readFileSync(guidePath, 'utf8').replace(/\r\n/g, '\n');
const out = path.resolve('scripts/s14/guide');
fs.mkdirSync(out, { recursive: true });

const FENCE = '`'.repeat(3);
const blockAfter = (heading, lang) => {
  const h = md.indexOf(heading);
  if (h < 0) throw new Error('heading not found: ' + heading);
  const open = md.indexOf(FENCE + lang + '\n', h);
  if (open < 0) throw new Error('no ' + lang + ' block after: ' + heading);
  const start = open + FENCE.length + lang.length + 1;
  const end = md.indexOf('\n' + FENCE, start);
  return md.slice(start, end) + '\n';
};
const save = (name, text) => {
  fs.writeFileSync(path.join(out, name), text);
  console.log('saved guide/' + name + ' (' + text.length + ' chars, ' + (text.split('\n').length - 1) + ' lines)');
};

save('phase2_rules.js', blockAfter('### The rules, as code the nodes will share', 'javascript'));
save('tech_3_1.js', blockAfter('### 3.1 The signature list', 'javascript'));
save('rules_4_1.js', blockAfter('### 4.1 The rules', 'javascript'));

// 4.2 prompt table: | Where | Old text starts with | New text |
// Cells are split on " | " (the table has no pipe inside a cell); markdown escapes for underscore are removed.
const h = md.indexOf('### 4.2 Prompt changes');
const tableStart = md.indexOf('\n| Where |', h) + 1;
const tableEnd = md.indexOf('\n\n', tableStart);
const BS = String.fromCharCode(92);
const rows = md.slice(tableStart, tableEnd).split('\n').slice(2).map(line => {
  const inner = line.trim().slice(1, -1);
  const cells = inner.split(' | ').map(c => c.trim().split(BS + '_').join('_'));
  if (cells.length !== 3) throw new Error('unexpected cell count ' + cells.length + ' in: ' + line);
  return { where: cells[0], old_starts_with: cells[1], new_text: cells[2] };
});
save('prompt_4_2.json', JSON.stringify(rows, null, 1) + '\n');
