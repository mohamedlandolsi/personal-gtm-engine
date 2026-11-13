// Sprint 14: offline test of db/s14_engine_fixes.sql against db/schema.sql in an in-memory Postgres (PGlite).
// Nothing touches Neon. Exit code 0 = all checks passed.
// Run from the repo root (same scratch folder as Sprint 13):
//   PowerShell: $env:PGLITE_DIR="C:\temp\pgl"; node scripts/s14_sql_test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.PGLITE_DIR || process.cwd());
const entry = createRequire(path.join(dir, 'package.json')).resolve('@electric-sql/pglite');
const { PGlite } = await import(pathToFileURL(entry).href);

const db = new PGlite();
const q = async (s, p) => (await db.query(s, p)).rows;
let failed = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  got: ' + JSON.stringify(got)}`); if (!ok) failed++; };
const err = async (sql, p) => { try { await q(sql, p); return ''; } catch (e) { return String(e.message || e); } };

await db.exec(fs.readFileSync('db/schema.sql', 'utf8'));
await db.exec(`
insert into accounts (account_id, company_name, domain, status, clay_trigger_date) values
 ('a_veto', 'Vetoed', 'v.io', 'rejected', null),
 ('a_old',  'OldReject', 'o.io', 'contact_found', null),
 ('a_ctc',  'ContactScope', 'c.io', 'contact_found', null),
 ('a_pitch','PitchScope', 'p.io', 'contact_found', null),
 ('a_pnew', 'PitchNewTrigger', 'pn.io', 'contact_found', '2099-01-01'),
 ('a_ok',   'Clean', 'k.io', 'contact_found', null);
insert into outreach_queue (outreach_id, account_id, contact_id, company_name, message_draft, approval_status, reviewed_at) values
 ('o_old',  'a_old',  'c1', 'OldReject', 'old draft text here', 'rejected', now()),
 ('o_ctc',  'a_ctc',  'c2', 'ContactScope', 'draft to reject as contact', 'pending', null),
 ('o_pit',  'a_pitch','c3', 'PitchScope', 'draft to reject as pitch', 'pending', null),
 ('o_pnew', 'a_pnew', 'c4', 'PitchNewTrigger', 'draft to reject as pitch', 'pending', null),
 ('o_acc',  'a_ok',   'c5', 'Clean', 'draft to reject as account later', 'pending', null);`);

const sql14 = fs.readFileSync('db/s14_engine_fixes.sql', 'utf8');
await db.exec(sql14);
await db.exec(sql14);
check('migration runs twice without error', true);
const sqlPatch = fs.readFileSync('db/s14_patch_blocks.sql', 'utf8');
await db.exec(sqlPatch);
await db.exec(sqlPatch);
check('patch migration (s14_patch_blocks.sql) runs twice without error', true);

check('needs_redraft is a valid status', (await err(`update outreach_queue set approval_status='needs_redraft' where outreach_id='o_acc'`)) === '');
check('approve from needs_redraft is refused with a clear message',
  (await err(`select gtm_review('o_acc','approve')`)).startsWith('needs_redraft'));
check('reject from needs_redraft works', (await err(`select gtm_reject('o_acc','account','sells sales tooling','test')`)) === '');
let a = (await q(`select status from accounts where account_id='a_ok'`))[0];
check('scope account also vetoes the account', a.status === 'rejected', a);

check('invalid scope is refused', (await err(`select gtm_reject('o_ctc','company')`)).startsWith('invalid_scope'));
await q(`select gtm_reject('o_ctc','contact','wrong person, try the CEO','test')`);
await q(`select gtm_reject('o_pit','pitch','generic angle','test')`);
await q(`select gtm_reject('o_pnew','pitch','generic angle','test')`);
let r = (await q(`select reject_scope, notes from outreach_queue where outreach_id='o_ctc'`))[0];
check('scope and reason are stored', r.reject_scope === 'contact' && /Rejected \(contact, \d{4}-\d{2}-\d{2}\): wrong person/.test(r.notes), r);

const blocks = Object.fromEntries((await q(`select account_id, reason from v_outreach_blocks`)).map(x => [x.account_id, x.reason]));
check('vetoed account is blocked', blocks.a_veto === 'account_vetoed', blocks);
check('old rejection without scope blocks the account (ADR-103)', blocks.a_old === 'draft_rejected_account', blocks);
check('contact scope does not block the account', !('a_ctc' in blocks), blocks);
check('pitch scope blocks while no newer dated trigger', blocks.a_pitch === 'draft_rejected_pitch', blocks);
check('pitch scope unblocks after a newer dated trigger', !('a_pnew' in blocks), blocks);
check('account scope reports the veto', blocks.a_ok === 'account_vetoed', blocks);

await q(`select gtm_review('o_ctc','reopen')`);
r = (await q(`select approval_status, reject_scope from outreach_queue where outreach_id='o_ctc'`))[0];
check('reopen clears the scope', r.approval_status === 'pending' && r.reject_scope === null, r);

const ev = (await q(`select action from console_events where entity_id='o_pit' order by id`)).map(x => x.action);
check('audit log has reject then reject_scope', ev.join() === 'reject,reject_scope', ev);

await q(`select * from gtm_insert_draft($1::jsonb)`, [JSON.stringify({ outreach_id: 'o_new', account_id: 'a_ctc', contact_id: 'c9',
  approval_status: 'needs_redraft', angle_basis: 'demo CTA on homepage', account_type: 'demo_saas', product_category: 'other', reject_scope: '' })]);
r = (await q(`select approval_status, angle_basis, account_type, product_category, reject_scope from outreach_queue where outreach_id='o_new'`))[0];
check('gtm_insert_draft writes the new columns ("" becomes NULL)', r.approval_status === 'needs_redraft' && r.angle_basis === 'demo CTA on homepage' && r.account_type === 'demo_saas' && r.reject_scope === null, r);

const cols = (await q(`select * from n8n_outreach_queue_sheet limit 1`))[0];
check('n8n view exposes reject_scope and reviewed_at', 'reject_scope' in cols && 'reviewed_at' in cols, Object.keys(cols));
const rv = (await q(`select * from v_review_queue where outreach_id='o_new'`))[0];
check('v_review_queue exposes the new columns', rv.angle_basis === 'demo CTA on homepage', Object.keys(rv).slice(-4));
const va = (await q(`select account_id, block_reason from v_accounts where account_id in ('a_old','a_ctc') order by 1`));
check('v_accounts shows block_reason', va[1].block_reason === 'draft_rejected_account' && va[0].block_reason === null, va);

// Sprint 14 patch (db/s14_patch_blocks.sql): an engine gate row has scope 'pitch' but no reviewed_at.
// It must still block its account, with pitch_at taken from run_date.
await db.exec(`
insert into accounts (account_id, company_name, domain, status, clay_trigger_date) values ('a_gate', 'GateNoAngle', 'g.io', 'contact_found', null);
insert into outreach_queue (outreach_id, account_id, contact_id, company_name, approval_status, reject_scope, reviewed_at, run_date, llm_provider)
values ('o_gate', 'a_gate', 'c10', 'GateNoAngle', 'rejected', 'pitch', null, now(), 'gate:no_angle');`);
const gate = (await q(`select reason, pitch_at from v_outreach_blocks where account_id = 'a_gate'`))[0];
check('patch: a gate row (scope pitch, no reviewed_at) blocks its account', gate && gate.reason === 'draft_rejected_pitch' && gate.pitch_at !== null, gate);

console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
process.exit(failed ? 1 : 0);
