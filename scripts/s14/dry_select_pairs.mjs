// Sprint 14 step 2.3: dry run of the new Select Outreach Pairs code on fixtures. Read only.
// No n8n, no Sheets, no LLM, no network. Fixtures come from Neon (scripts/s14/fixtures/, not committed).
// Usage: node scripts/s14/dry_select_pairs.mjs
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('scripts/s14');
const fx = (name) => JSON.parse(fs.readFileSync(path.join(dir, 'fixtures', name), 'utf8'));
const accounts = fx('accounts.json');
const contacts = fx('contacts.json');
const queue = fx('queue.json');
const blocks = fx('blocks.json');
const cfgRow = fx('config.json')[0];
const config = cfgRow.payload || cfgRow;

const data = {
  'Fetch Accounts For Outreach': accounts,
  'Fetch Contacts For Outreach': contacts,
  'Fetch Outreach Queue': queue,
  'Fetch Outreach Blocks': blocks,
  'Load Config': [{ config, warnings: [] }],
  'Rescore Accounts': []
};
const $ = (name) => {
  if (!(name in data)) throw new Error('node not executed: ' + name);
  const items = data[name].map(json => ({ json }));
  return { all: () => items, first: () => items[0] };
};

const code = fs.readFileSync(path.join(dir, 'Select Outreach Pairs.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const out = await new AsyncFunction('$', code)($);

const pairs = out.map(i => i.json).filter(j => j.outreach_pair);
const statsItem = out.map(i => i.json).find(j => j.__row_type === 'stats');

console.log(`config rev: ${config.rev}   fixtures: ${accounts.length} accounts, ${contacts.length} contacts, ${queue.length} queue rows, ${blocks.length} blocks`);
console.log('\nPAIRS (' + pairs.length + ')');
console.log('company | contact | title | buyer_score | trigger_ok | employees | account_run_date | region_bonus');
for (const p of pairs) console.log([p.company_name, p.full_name, p.title, p.buyer_score, p.trigger_ok, p.employee_count, p.account_run_date, p.region_bonus].join(' | '));
console.log('\nSTATS ITEM (stats.outreach)');
console.log(JSON.stringify(statsItem.stats.outreach, null, 1));

// ---- Checks from the guide table (2.3) ----
const blockedIds = new Set(blocks.map(b => String(b.account_id)));
const acct = Object.fromEntries(accounts.map(a => [String(a.account_id), a]));
console.log('\nCHECKS');
console.log('pairs at blocked accounts: ' + pairs.filter(p => blockedIds.has(String(p.account_id))).length);
console.log('pairs with buyer_score < 60: ' + pairs.filter(p => Number(p.buyer_score) < 60).length);
console.log('pairs at accounts under 10 people without trigger_ok: ' + pairs.filter(p => Number(p.employee_count) > 0 && Number(p.employee_count) < 10 && !p.trigger_ok).length);

// ---- Explanation: every unused contact and the first rule that stops it (independent of the node code) ----
const O = config.outreach || {}, C = config.contact || {};
const minContact = Number(O.min_contact_score || C.min_contact_score || 60);
const minAcct = Number(O.min_account_score || config.min_account_score || 65);
const st = r => String(r.approval_status || '').toLowerCase();
const done = new Set(queue.filter(r => r.contact_id && st(r) !== 'superseded').map(r => String(r.contact_id)));
const live = {};
for (const r of queue) if (r.contact_id && !['superseded', 'rejected'].includes(st(r))) live[r.account_id] = (live[r.account_id] || 0) + 1;
const blockOf = Object.fromEntries(blocks.map(b => [String(b.account_id), b.reason]));
const unused = contacts.filter(c => c.contact_id && String(c.status || 'new') === 'new' && Number(c.contact_score || 0) >= minContact && !done.has(String(c.contact_id)));
console.log('\nUNUSED CONTACTS (' + unused.length + '): status new, contact_score >= ' + minContact + ', no live or rejected draft of their own');
console.log('company | contact | title | account_score | contact_status | live drafts at account | block reason | account status');
for (const c of unused.sort((a, b) => String(a.company_name).localeCompare(String(b.company_name)))) {
  const a = acct[String(c.account_id)] || {};
  console.log([c.company_name, c.full_name, c.title, a.final_score, a.contact_status, live[c.account_id] || 0, blockOf[String(c.account_id)] || '-', a.status].join(' | '));
}
console.log('\nblocked accounts with an unused contact: ' + new Set(unused.filter(c => blockOf[String(c.account_id)]).map(c => c.account_id)).size);
console.log('thresholds: min account score ' + minAcct + ', min contact score ' + minContact);
