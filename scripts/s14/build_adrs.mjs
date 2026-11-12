// Sprint 14 close-out: ADR-103 to ADR-111 copied from the guide's ADR table (never retyped) into docs/ADR.md.
// Usage: node scripts/s14/build_adrs.mjs "<path to the Sprint 14 guide>"
import fs from 'node:fs';
const md = fs.readFileSync(process.argv[2], 'utf8').replace(/\r\n/g, '\n');
const h = md.indexOf('## ADRs and trade-offs');
const t0 = md.indexOf('\n| ADR |', h) + 1;
const t1 = md.indexOf('\n\n', t0);
const BS = String.fromCharCode(92);
const rows = md.slice(t0, t1).split('\n').slice(2).map(l => l.trim().slice(1, -1).split(' | ').map(c => c.trim().split(BS + '_').join('_')));
if (rows.length !== 9 || rows.some(r => r.length !== 4)) throw new Error('unexpected ADR table shape');
const title = {
  103: 'A rejected draft blocks its whole account by default',
  104: 'Derive new facts at draft time and store them on outreach_queue',
  105: 'GTM Run chains the sync, engine and Contact Finder',
  106: 'Product overlap is a fixed-rule gate with a visible row',
  107: 'Code picks the angle, the LLM only writes',
  108: 'Template and invalid drafts go to needs_redraft',
  109: 'Region is a sort preference, not part of final_score',
  110: 'Defer employee_count_date, country source and LinkedIn verification',
  111: 'Small teams without a valid trigger get no draft'
};
const out = rows.map(([n, decision, rejected, tradeoff]) => [
  `## ADR-${n}: ${title[n]}`,
  '**Status:** Accepted',
  `**Context:** Draft Review of 2026-11-03 (Sprint 14). Alternative considered: ${rejected.replace(/^./, c => c.toLowerCase())}.`,
  `**Decision:** ${decision}.`,
  `**Trade-offs / consequences:** ${tradeoff}.`,
  '**Source:** Sprints/Sprint 14 - Engine Fixes Guide.md (ADR table)'
].join('\n')).join('\n\n') + '\n';
if (/[\u2014\u2013]/.test(out)) throw new Error('dash in ADR text');
let adr = fs.readFileSync('docs/ADR.md', 'utf8').replace(/\r\n/g, '\n');
if (adr.includes('## ADR-103')) throw new Error('ADR-103 already present');
const anchor = '\n---\n\n## Notes';
const i = adr.indexOf(anchor);
if (i < 0 || adr.indexOf(anchor, i + 1) >= 0) throw new Error('Notes anchor not unique');
adr = adr.slice(0, i) + '\n' + out + adr.slice(i);
fs.writeFileSync('docs/ADR.md', adr);
console.log('inserted ' + rows.length + ' ADRs');
