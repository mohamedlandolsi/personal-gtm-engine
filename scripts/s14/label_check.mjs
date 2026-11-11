// Sprint 14 step 4.4: label check without LLM calls. Read only: no network, no n8n, no Neon writes.
// The rules block is copied by script out of scripts/s14/Draft Outreach.js (the body applied to n8n),
// then classify() runs on every account in scripts/s14/fixtures/accounts.json with an EMPTY site object.
// Usage: node scripts/s14/label_check.mjs [--all]
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('scripts/s14');
const node = fs.readFileSync(path.join(dir, 'Draft Outreach.js'), 'utf8').replace(/\r\n/g, '\n');
const guide = fs.readFileSync(path.join(dir, 'guide', 'rules_4_1.js'), 'utf8').replace(/\r\n/g, '\n');
const phase2 = fs.readFileSync(path.join(dir, 'guide', 'phase2_rules.js'), 'utf8').replace(/\r\n/g, '\n');

const START = '// Fix 5 and 8:';
const END = '// ---------- end of the Sprint 14 rules ----------';
const a = node.indexOf(START), b = node.indexOf(END);
if (a < 0 || b < 0) throw new Error('rules block not found in Draft Outreach.js');
const block = node.slice(a, b);

// Paste check: the block in the node must equal the guide text up to the validator v2 marker.
const guideA = guide.slice(0, guide.indexOf('// Fix 7: validator v2.')).replace(/\n+$/, '\n');
console.log('rules block in the node equals the guide (4.1, CATS to motionOf): ' + (block === guideA));

const { classify, pickAngle, validTrigger } = new Function(phase2 + '\n' + block + '\nreturn { classify, pickAngle, validTrigger };')();
const accounts = JSON.parse(fs.readFileSync(path.join(dir, 'fixtures', 'accounts.json'), 'utf8'));
const SITE = { desc: '', title: '', demo: '', selfserve: '', booking: false };

// The companies of the guide's 4.1 result table, with the expected labels for an empty site.
const EXPECT = [
  ['adstrategy', 'other', ['lead_seller'], 'delivery_ops'],
  ['idl consulting', 'other', ['lead_seller'], 'delivery_ops'],
  ['lead pronto', 'other', ['agency'], 'client_reporting (delivery_ops once the homepage says pay per lead)'],
  ['parallel', 'other', ['other', 'agency'], 'hire_bridge'],
  ['telli', 'other', ['other', 'agency'], 'hire_bridge'],
  ['unmuted', 'other', ['other', 'agency'], 'hire_bridge'],
  ['demodesk', 'crm', ['other'], 'gate account'],
  ['close', 'crm', ['other'], 'gate account'],
  ['topo', 'outbound', ['other', 'agency'], 'gate account'],
  ['throxy', 'outbound', ['other', 'agency'], 'gate account'],
  ['mailwarm', 'deliverability', ['other'], 'gate account'],
  ['nomi', 'sales_tech', ['other'], 'gate account'],
  ['kenobi', 'sales_tech', ['other'], 'gate account'],
  ['goareo', 'other', ['hardware'], 'gate account'],
  ['moby', 'other', ['other'], 'from the homepage'],
  ['trackingplan', 'other', ['other'], 'from the homepage'],
  ['alguna', 'other', ['other'], 'from the homepage'],
  ['newton', 'other', ['other'], 'from the homepage']
];
const norm = s => String(s || '').toLowerCase();
const label = (acc) => {
  const p = Object.assign({}, acc, { trigger_ok: validTrigger(acc) });
  const c = classify(p, SITE);
  const angle = pickAngle(p, c, SITE);
  const outcome = c.overlap ? 'gate account (product_overlap)' : c.type === 'hardware' && !(angle && angle.id === 'hire_bridge') ? 'gate account (hardware)'
    : angle ? angle.id : 'no angle without the homepage';
  return { c, outcome };
};

console.log('\ncompany | category | type | overlap | outcome with an empty site | expected (guide 4.1) | match');
let bad = 0;
for (const [key, cat, types, exp] of EXPECT) {
  const acc = accounts.find(x => norm(x.company_name).startsWith(key) || norm(x.domain).startsWith(key));
  if (!acc) { console.log(`${key} | NOT IN FIXTURES | | | | ${cat} / ${types.join(' or ')} | n/a`); continue; }
  const { c, outcome } = label(acc);
  const ok = c.category === cat && types.includes(c.type);
  if (!ok) bad++;
  console.log([acc.company_name, c.category, c.type, c.overlap, outcome, `${cat} | ${types.join(' or ')} | ${exp}`, ok ? 'yes' : 'NO'].join(' | '));
}
console.log(`\nmismatches against the guide table: ${bad}`);

if (process.argv.includes('--all')) {
  console.log('\nALL ACCOUNTS (' + accounts.length + ')\ncompany | category | type | overlap | outcome with an empty site');
  for (const acc of accounts.slice().sort((x, y) => norm(x.company_name).localeCompare(norm(y.company_name)))) {
    const { c, outcome } = label(acc);
    console.log([acc.company_name, c.category, c.type, c.overlap, outcome].join(' | '));
  }
}
process.exit(bad ? 1 : 0);
