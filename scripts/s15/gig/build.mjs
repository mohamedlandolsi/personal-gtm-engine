// Sprint 15: assembles the GTM Gig Finder Code node bodies from files (never retyped).
//   Draft Gig Reply.js = header + the Draft Outreach router (settings .. callStep, verbatim, ADR-115) + Draft Gig Reply.tail.js
//   Load Config.js     = the engine's Load Config, verbatim
// Usage: node scripts/s15/gig/build.mjs <draft outreach source .js> <engine load config .js>
// Output: scripts/s15/gig/Draft Gig Reply.js and scripts/s15/gig/Load Config.js
import fs from 'node:fs';
import path from 'node:path';

const [draftSrc, loadSrc] = process.argv.slice(2);
if (!draftSrc || !loadSrc) { console.error('usage: build.mjs <Draft Outreach.js> <Load Config.js>'); process.exit(2); }
const dir = path.resolve('scripts/s15/gig');
const src = fs.readFileSync(draftSrc, 'utf8').replace(/\r\n/g, '\n');
const START = '// ---------- settings (all overridable from config.outreach.llm) ----------';
const END = '// ---------- facts ----------';
const a = src.indexOf(START), b = src.indexOf(END);
if (a < 0 || b < 0 || b <= a) { console.error('router markers not found in ' + draftSrc); process.exit(1); }
const router = src.slice(a, b).trimEnd();

const header = [
  '// Draft Gig Reply (Code node, Run Once for All Items). Sprint 15.',
  '// Drafts a short reply for each post from Select Gigs to Draft, validated by fixed rules (gig validator), one repair',
  '// retry per provider, then needs_redraft. The LLM router section is copied verbatim from Draft Outreach (ADR-115):',
  '// keep both in sync until an LLM Router sub-workflow exists. Nothing is sent: drafts go to the review console.',
  "const cfg = $('Load Config').first().json.config || {};",
  'const O = cfg.outreach || {};',
  'const L = O.llm || {};',
  ''
].join('\n');
const tail = fs.readFileSync(path.join(dir, 'Draft Gig Reply.tail.js'), 'utf8').replace(/\r\n/g, '\n');
const body = header + '\n' + router + '\n\n' + tail;
if (/[—–]/.test(body.replace(/\[‐‑‒–\]/g, '').replace(/\\s\*—\\s\*/g, ''))) {
  // The router's norm() mentions the dash characters inside regexes on purpose; anything else is a mistake.
  const bad = body.split('\n').filter(l => /[—–]/.test(l) && !/norm = s =>/.test(l));
  if (bad.length) { console.error('em or en dash outside norm():\n' + bad.join('\n')); process.exit(1); }
}
fs.writeFileSync(path.join(dir, 'Draft Gig Reply.js'), body);
fs.writeFileSync(path.join(dir, 'Load Config.js'), fs.readFileSync(loadSrc, 'utf8').replace(/\r\n/g, '\n'));
console.log('Draft Gig Reply.js ' + body.length + ' chars (router ' + router.length + '), Load Config.js copied');
