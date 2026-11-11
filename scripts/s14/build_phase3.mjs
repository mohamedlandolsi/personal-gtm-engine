// Sprint 14 Phase 3 (enrichment data): build Score Enriched and YC Directory Source from the LIVE bodies plus the guide.
// Usage: node scripts/s14/build_phase3.mjs <dir with the live node bodies> "<path to the Sprint 14 guide>"
import path from 'node:path';
import { read, once, between, save } from './lib_patch.mjs';

const [live, guidePath] = process.argv.slice(2);
const out = path.resolve('scripts/s14');
const tech = read(path.join(out, 'guide', 'tech_3_1.js')).replace(/\n$/, '');   // guide 3.1, verbatim (comments + const TECH)
const guide = read(guidePath);

// ---------------------------------------------------------------- Score Enriched: only the TECH array changes
let s = read(path.join(live, 'Score Enriched.js'));
s = between(s, `const TECH = [\n`, `\nconst CRM = new Set(`, tech, 'score: TECH');
save(out, 'Score Enriched', s);

// ---------------------------------------------------------------- YC Directory Source: stage mapping, both lines copied from the guide (prompt C14-3)
const lineAfter = (marker) => {
  const i = guide.indexOf(marker);
  if (i < 0) throw new Error('guide marker not found: ' + marker);
  return guide.slice(i + marker.length).split('\n')[0].trim();
};
const newMapping = (() => {
  const i = guide.indexOf('2. YC Directory Source: replace');
  const j = guide.indexOf('   with\n', i);
  if (i < 0 || j < 0) throw new Error('C14-3 step 2 not found in the guide');
  return guide.slice(j + '   with\n'.length).split('\n')[0].trim();
})();
const newComment = lineAfter('and update the comment above it to: ');
if (!newMapping.startsWith('funding_stage: ({') || !newComment.startsWith('// YC stage:')) throw new Error('unexpected guide text: ' + newMapping + ' / ' + newComment);

let y = read(path.join(live, 'YC Directory Source.js'));
y = once(y,
`        // YC-backed means at least seed money. "Growth" gets no early-stage bonus.
        funding_stage: String(c.stage || '') === 'Early' ? 'seed' : 'series_b',`,
`        ${newComment}
        ${newMapping}`, 'yc: stage mapping');
save(out, 'YC Directory Source', y);
