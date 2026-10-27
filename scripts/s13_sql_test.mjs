// Sprint 13: offline test of db/s13_hubspot.sql against db/schema.sql in an in-memory Postgres (PGlite).
// Nothing touches Neon. Exit code 0 = all checks passed.
// Run from the repo root:
//   1. once, in any scratch folder outside the repo:  npm init -y  &&  npm i @electric-sql/pglite@0.3
//   2. PGLITE_DIR=<that scratch folder> node scripts/s13_sql_test.mjs
//      (PowerShell: $env:PGLITE_DIR="C:\temp\pgl"; node scripts/s13_sql_test.mjs)
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
const record = (r, run, action, id) => q(`select gtm_hubspot_record($1::jsonb)`, [JSON.stringify({
  run_id: run, link_type: r.link_type, local_id: r.local_id, ok: true, action, hubspot_id: id, properties_hash: r.properties_hash })]);

await db.exec(fs.readFileSync('db/schema.sql', 'utf8'));
await db.exec(fs.readFileSync('db/s13_hubspot.sql', 'utf8'));
await db.exec(fs.readFileSync('db/s13_hubspot.sql', 'utf8'));            // re-run must be safe
check('re-run of s13_hubspot.sql is safe', true);

await q(`select gtm_save_config($1, 'test', 'test')`, [JSON.stringify({ rev: 'r1', enabled: true,
  outreach: {}, digest: { enabled: false },
  hubspot: { enabled: true, max_per_run: 5, pipeline_id: 'default', follow_up_days: 3,
    stages: { approved: 'appointmentscheduled', contacted: 'qualifiedtobuy', replied: 'presentationscheduled' },
    reply_stage_ids: ['presentationscheduled', 'decisionmakerboughtin', 'closedwon'] } })]);

await db.exec(`
insert into accounts (account_id, company_name, domain, website, employee_count, country, linkedin_url, clay_summary, final_score, clay_trigger, status) values
 ('acc1', 'Throxy', 'throxy.com', 'https://throxy.com', 25, 'United Kingdom', 'https://linkedin.com/company/throxy', 'AI SDR <agency> & co', 82, 'Hiring 2 SDRs', 'qualified'),
 ('acc2', 'Vetoed Co', 'vetoed.io', null, 10, 'Germany', null, null, 70, null, 'rejected'),
 ('acc3', 'NoEmail Ltd', 'noemail.dev', null, null, null, null, null, 75, null, 'qualified');
insert into contacts (contact_id, account_id, company_name, full_name, title, email, email_status, linkedin_url) values
 ('c1', 'acc1', 'Throxy', 'Bergen Merey', 'CEO', 'Bergen@Throxy.com', 'verified', 'https://linkedin.com/in/bergen'),
 ('c2', 'acc2', 'Vetoed Co', 'X Y', 'CTO', 'x@vetoed.io', 'verified', null),
 ('c3', 'acc3', 'NoEmail Ltd', 'Joseph L.', 'Founder', null, 'not_found', 'https://linkedin.com/in/joe');
insert into outreach_queue (outreach_id, account_id, contact_id, company_name, channel, angle, value_proposition, message_draft, linkedin_note, follow_up_1, approval_status) values
 ('o1', 'acc1', 'c1', 'Throxy', 'linkedin_manual', 'angle A', 'value V', E'Hi Bergen,\\nline 2', 'note', 'fu1 text', 'approved'),
 ('o2', 'acc2', 'c2', 'Vetoed Co', 'email', 'a', 'v', 'msg', 'n', 'f', 'approved'),
 ('o3', 'acc3', 'c3', 'NoEmail Ltd', 'linkedin_manual', 'a3', 'v3', 'msg3', 'n3', '', 'approved'),
 ('o4', 'acc1', 'c1', 'Throxy', 'linkedin_manual', 'a', 'v', 'old', 'n', 'f', 'pending');`);

let rows = await q(`select * from v_hubspot_outbox order by step, local_id`);
check('first read: only companies are ready (children wait for parents)', rows.every(r => r.step === 1), rows.map(r => r.step));
check('vetoed account and pending-only drafts are out of scope', rows.map(r => r.local_id).join() === 'acc1,acc3', rows.map(r => r.local_id));
check('no NULL text columns (typed sub-workflow inputs)', rows.every(r => r.hubspot_id === '' && r.key_value !== null), rows[0]);
check('custom properties present', rows[0].properties.gtm_account_key === 'acc1' && rows[0].properties.gtm_score === '82', rows[0].properties);

for (const r of rows) await record(r, 'run1', 'created', 'co_' + r.local_id);
rows = await q(`select * from v_hubspot_outbox where step = 2 order by local_id`);
check('contacts appear once their company is linked', rows.length === 2, rows.length);
check('LinkedIn goes to the built-in hs_linkedin_url by default', rows[0].properties.hs_linkedin_url === 'https://linkedin.com/in/bergen', rows[0].properties);
check('verified email is the search key, lower-cased', rows[0].key_value === 'bergen@throxy.com', rows[0].key_value);
check('no email: empty key, so the sub-workflow creates without searching', rows[1].key_value === '' && !('email' in rows[1].properties), rows[1]);
check('GDPR: contacts carry the HubSpot legal basis (exact option value)', rows.every(r => r.properties.hs_legal_basis === 'Legitimate interest \u2013 prospect/lead'), rows[0].properties.hs_legal_basis);
check('contact -> company association type 1 (primary)', rows[0].associations[0].types[0].associationTypeId === 1, rows[0].associations);

for (const r of rows) await record(r, 'run1', 'created', 'ct_' + r.local_id);
rows = await q(`select * from v_hubspot_outbox where step = 3 order by local_id`);
check('one deal per account, at the approved stage', rows.length === 2 && rows[0].properties.dealstage === 'appointmentscheduled', rows);
for (const r of rows) await record(r, 'run1', 'created', 'dl_' + r.local_id);

rows = await q(`select * from v_hubspot_outbox`);
check('second read after a full run: outbox empty (idempotent)', rows.length === 0, rows);

await q(`update accounts set final_score = 85 where account_id = 'acc1'`);
rows = await q(`select * from v_hubspot_outbox`);
check('a changed company field queues exactly one update by id', rows.length === 1 && rows[0].hubspot_id === 'co_acc1', rows);
await q(`update accounts set final_score = 82 where account_id = 'acc1'`);
check('reverting the field empties the outbox again', (await q(`select * from v_hubspot_outbox`)).length === 0);

await q(`select gtm_review('o1', 'mark_sent')`);
rows = await q(`select * from v_hubspot_outbox order by step`);
check('mark sent queues note, task and stage move', rows.map(r => r.step).join() === '4,5,6', rows.map(r => r.step));
check('note body is escaped HTML', rows[0].properties.hs_note_body.includes('Hi Bergen,<br>line 2'), rows[0].properties.hs_note_body);
check('stage move updates the existing deal by id', rows[2].hubspot_id === 'dl_acc1' && rows[2].properties.dealstage === 'qualifiedtobuy', rows[2]);
for (const r of rows) await record(r, 'run2', r.hubspot_id ? 'updated' : 'created', r.hubspot_id || ('x_' + r.link_type));
check('after activities: outbox empty', (await q(`select * from v_hubspot_outbox`)).length === 0);
check('deal link now remembers contacted', (await q(`select deal_stage from hubspot_links where link_type = 'deals' and local_id = 'acc1'`))[0].deal_stage === 'qualifiedtobuy');

await q(`update accounts set final_score = 90 where account_id = 'acc3'`);
for (let i = 0; i < 3; i++) await q(`select gtm_hubspot_record($1::jsonb)`, [JSON.stringify({ run_id: 'run3', link_type: 'companies', local_id: 'acc3', ok: false, error: '400 PROPERTY_DOESNT_EXIST' })]);
check('3 failures since last success: row quarantined, not retried', (await q(`select * from v_hubspot_outbox`)).length === 0);
check('quarantine view lists it', (await q(`select * from v_hubspot_quarantine`)).length === 1);

let pull = (await q(`select gtm_hubspot_pull_stages($1::jsonb) r`, [JSON.stringify({ run_id: 'run4',
  results: [{ id: 'dl_acc1', properties: { dealstage: 'presentationscheduled' } }, { id: 'not_ours', properties: { dealstage: 'x' } }] })]))[0].r;
check('stage pull: 1 changed, 1 reply flagged, foreign deals ignored', pull.changed === 1 && pull.replied === 1, pull);
check('reply copied to outreach_queue', (await q(`select reply_received from outreach_queue where outreach_id = 'o1'`))[0].reply_received === 'yes');
check('reply audited in console_events', (await q(`select count(*)::int n from console_events where actor = 'hubspot' and action = 'crm_reply'`))[0].n === 1);
pull = (await q(`select gtm_hubspot_pull_stages($1::jsonb) r`, [JSON.stringify({ run_id: 'run5', results: [{ id: 'dl_acc1', properties: { dealstage: 'presentationscheduled' } }] })]))[0].r;
check('same stage pulled again: 0 changes', pull.changed === 0, pull);

const runs = await q(`select * from v_hubspot_runs order by started_at`);
check('v_hubspot_runs counts per run', runs[0].created === 6 && runs[2].failed === 3, runs);
check('v_crm_status shows ids per draft', (await q(`select deal_hs_id from v_crm_status where outreach_id = 'o1'`))[0].deal_hs_id === 'dl_acc1');
check('existing console view still works', (await q(`select count(*)::int n from v_review_queue`))[0].n === 4);

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
