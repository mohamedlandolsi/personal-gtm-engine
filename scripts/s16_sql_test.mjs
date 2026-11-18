// Sprint 16: offline test of db/s16_trigger_checks.sql. Exit code 0 = all checks passed.
// schema.sql + the migration (run twice) in an in-memory Postgres (PGlite). Nothing touches Neon.
//   PowerShell: $env:PGLITE_DIR="C:\temp\pgl"; node scripts/s16_sql_test.mjs
//   Git Bash:   PGLITE_DIR=C:/temp/pgl node scripts/s16_sql_test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const migration = fs.readFileSync('db/s16_trigger_checks.sql', 'utf8');
const dir = path.resolve(process.env.PGLITE_DIR || process.cwd());
const entry = createRequire(path.join(dir, 'package.json')).resolve('@electric-sql/pglite');
const { PGlite } = await import(pathToFileURL(entry).href);
const db = new PGlite();
await db.exec(fs.readFileSync('db/schema.sql', 'utf8'));
const q = async (s, p) => (p ? (await db.query(s, p)).rows : ((await db.exec(s)).at(-1)?.rows ?? []));
console.log('target: pglite (schema.sql)');

let failed = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  got: ' + JSON.stringify(got)}`); if (!ok) failed++; };
const one = async (s, p) => (await q(s, p))[0];
const trig = async (x) => (await one(`select gtm_trigger_upsert($1::jsonb) as n`, [JSON.stringify(x)])).n;
const acc = async (x) => (await one(`select gtm_account_check_upsert($1::jsonb) as n`, [JSON.stringify(x)])).n;
const draft = (o) => q(`select * from gtm_insert_draft($1::jsonb)`, [JSON.stringify(o)]);

// ---------- migration, twice ----------------------------------------------------------
await q(migration);
// A row written between the two runs must survive the second run (tables are not re-created).
await q(`insert into trigger_checks (account_id, checked_at, trigger_type) values ('t16_keep', '2026-01-01T00:00:00Z', 'none')`);
await q(`insert into account_checks (account_id, checked_at, status) values ('t16_keep', '2026-01-01T00:00:00Z', 'ok')`);
const objs = async () => one(`select
    (select count(*) from pg_indexes where tablename in ('trigger_checks','account_checks'))::int as idx,
    (select count(*) from information_schema.columns where table_name = 'outreach_queue'
       and column_name in ('contact_verified_at','contact_verified_title','gtm_people'))::int as cols,
    (select count(*) from pg_proc where proname in ('gtm_trigger_upsert','gtm_account_check_upsert','gtm_insert_draft'))::int as fns`);
const before = await objs();
await q(migration);
const after = await objs();
const kept = await one(`select (select count(*) from trigger_checks where account_id = 't16_keep')::int as t,
                               (select count(*) from account_checks where account_id = 't16_keep')::int as a`);
check('second run is a no-op (same indexes, columns, functions; earlier rows kept)',
  JSON.stringify(before) === JSON.stringify(after) && after.cols === 3 && after.fns === 3 && kept.t === 1 && kept.a === 1, { before, after, kept });
const types = await q(`select column_name, data_type from information_schema.columns where table_name = 'outreach_queue'
  and column_name in ('contact_verified_at','contact_verified_title','gtm_people') order by column_name`);
check('outreach_queue: contact_verified_at timestamptz, contact_verified_title text, gtm_people integer',
  types.map(c => c.column_name + ':' + c.data_type).join() === 'contact_verified_at:timestamp with time zone,contact_verified_title:text,gtm_people:integer', types);
await q(`delete from trigger_checks where account_id = 't16_keep'; delete from account_checks where account_id = 't16_keep'`);

await q('begin');
try {
  // ---------- gtm_trigger_upsert / v_trigger_latest ----------------------------------------
  check('gtm_trigger_upsert([]) = 0', (await trig([])) === 0);
  const n2 = await trig([
    { account_id: 't16_a', trigger_type: 'funding', trigger_text: 'T16 A raises EUR 5 million', trigger_date: '2026-09-03',
      trigger_url: 'https://example.com/a', stage_signal: 'early', amount_musd: '5', query: 'q a' },
    { account_id: 't16_b', trigger_type: 'none', trigger_text: '', trigger_date: '', trigger_url: '', amount_musd: '' }
  ]);
  check('upsert of an array of 2 returns 2', n2 === 2, n2);
  let r = await one(`select * from trigger_checks where account_id = 't16_a'`);
  check('valid row stored: date, amount, type, stage, source tavily',
    r && String(r.trigger_date instanceof Date ? r.trigger_date.toISOString() : r.trigger_date).startsWith('2026-09-03') &&
    Number(r.amount_musd) === 5 && r.trigger_type === 'funding' && r.stage_signal === 'early' && r.source === 'tavily', r);
  r = await one(`select * from trigger_checks where account_id = 't16_b'`);
  check('defaults: empty date and amount become null, stage unknown', r && r.trigger_date === null && r.amount_musd === null && r.stage_signal === 'unknown', r);
  const nBad = await trig({ account_id: 't16_c', trigger_type: 'launch', trigger_date: '03/09/2026', amount_musd: 'EUR 5M' });
  r = await one(`select * from trigger_checks where account_id = 't16_c'`);
  check('single object accepted; bad date and bad amount become null', nBad === 1 && r.trigger_date === null && r.amount_musd === null, { nBad, r });
  const nSkip = await trig([{ account_id: '', trigger_type: 'funding' }, { trigger_type: 'funding' }, { account_id: 't16_d', trigger_type: 'hiring' }]);
  const blank = await one(`select count(*)::int as n from trigger_checks where account_id = '' or account_id is null`);
  check("account_id '' (and missing) is skipped", nSkip === 1 && blank.n === 0, { nSkip, blank });
  r = await one(`select trigger_text from trigger_checks where account_id = 't16_a'`);
  const long = await trig({ account_id: 't16_e', trigger_text: 'x'.repeat(400), query: 'y'.repeat(400) });
  r = await one(`select length(trigger_text) as t, length(query) as q from trigger_checks where account_id = 't16_e'`);
  check('trigger_text and query cut to 300 chars', long === 1 && r.t === 300 && r.q === 300, r);
  await q(`insert into trigger_checks (account_id, checked_at, trigger_type, trigger_text) values
    ('t16_l', now() - interval '40 days', 'funding', 'old'),
    ('t16_l', now() - interval '2 days',  'launch',  'new'),
    ('t16_l', now() - interval '10 days', 'hiring',  'mid')`);
  const lat = await q(`select account_id, trigger_text from v_trigger_latest where account_id = 't16_l'`);
  check('v_trigger_latest returns the newest row per account (one row)', lat.length === 1 && lat[0].trigger_text === 'new', lat);
  const per = await one(`select count(*)::int as n, count(distinct account_id)::int as d from v_trigger_latest where account_id like 't16_%'`);
  check('v_trigger_latest: one row per account', per.n === per.d && per.d === 6, per);

  // ---------- gtm_account_check_upsert / v_account_check_latest / v_clay_usage ---------------
  check('gtm_account_check_upsert([]) = 0', (await acc([])) === 0);
  const leaders = [{ name: 'L One', title: 'CEO & Co-Founder', linkedin_url: 'https://www.linkedin.com/in/l-one', started: '2019-01' }];
  const m2 = await acc([
    { account_id: 't16_k1', status: 'ok', gtm_people: '2', gtm_titles: 'Head of Sales, Sales Development Representative', leaders, results_used: '5', note: '' },
    { account_id: 't16_k2', status: 'ok', gtm_people: 1, gtm_titles: 'Growth Lead', leaders: 'not an array', results_used: 3 }
  ]);
  check('account check upsert of an array of 2 returns 2', m2 === 2, m2);
  let k = await one(`select * from account_checks where account_id = 't16_k1'`);
  check('k1 stored: gtm_people 2, leaders jsonb array, results 5, source clay_api, employee_count null',
    k && k.gtm_people === 2 && Array.isArray(k.leaders) && k.leaders[0].title === 'CEO & Co-Founder' && k.results_used === 5 &&
    k.source === 'clay_api' && k.employee_count === null, k);
  k = await one(`select * from account_checks where account_id = 't16_k2'`);
  check('numbers given as JSON numbers are kept; a non-array leaders becomes []',
    k && k.gtm_people === 1 && k.results_used === 3 && Array.isArray(k.leaders) && k.leaders.length === 0, k);
  const kBad = await acc({ account_id: 't16_k3', gtm_people: 'two', employee_count: '83 people', results_used: '-1' });
  k = await one(`select * from account_checks where account_id = 't16_k3'`);
  check('bad numbers become null (results_used becomes 0); status defaults to ok',
    kBad === 1 && k.gtm_people === null && k.employee_count === null && k.results_used === 0 && k.status === 'ok', k);
  const kSkip = await acc([{ account_id: '', results_used: 5 }, { results_used: 5 }]);
  check("account check: account_id '' (and missing) is skipped", kSkip === 0, kSkip);
  await q(`insert into account_checks (account_id, checked_at, status, gtm_people, results_used, source) values
    ('t16_k4', now() - interval '5 days', 'ok',     0, 5, 'clay_api'),
    ('t16_k4', now() - interval '1 day',  'budget', null, 0, 'clay_api'),
    ('t16_k5', now() - interval '1 day',  'error',  null, 0, 'clay_api')`);
  const kl = await q(`select account_id, status, gtm_people from v_account_check_latest where account_id in ('t16_k4','t16_k5')`);
  check("v_account_check_latest: a newer 'budget' row is not latest, an 'error'-only account has no row",
    kl.length === 1 && kl[0].account_id === 't16_k4' && kl[0].status === 'ok' && kl[0].gtm_people === 0, kl);
  const one4 = await one(`select count(*)::int as n from v_account_check_latest where account_id like 't16_k%'`);
  check('v_account_check_latest: one row per account', one4.n === 4, one4);

  const u0 = (await one(`select results_30d from v_clay_usage`)).results_30d;
  await q(`insert into account_checks (account_id, checked_at, results_used, source) values
    ('t16_u1', now() - interval '29 days', 7,  'clay_api'),
    ('t16_u2', now() - interval '31 days', 50, 'clay_api'),
    ('t16_u3', now() - interval '1 day',   9,  'manual'),
    ('t16_u4', now() - interval '3 days',  4,  'clay_mcp')`);
  const u1 = (await one(`select results_30d from v_clay_usage`)).results_30d;
  check('v_clay_usage sums only the last 30 days and only clay_api / clay_mcp rows', u0 === 5 + 3 + 0 + 5 && u1 === u0 + 7 + 4, { u0, u1 });

  // ---------- gtm_insert_draft and the views --------------------------------------------
  await q(`insert into accounts (account_id, company_name, domain, status) values ('t16_acc', 'T16 Co', 't16.io', 'contact_found')`);
  await q(`insert into contacts (contact_id, account_id, full_name, title, status) values ('t16_ct', 't16_acc', 'Ann Test', 'CEO', 'new')`);
  const d1 = await draft({ outreach_id: 't16_o1', account_id: 't16_acc', contact_id: 't16_ct', company_name: 'T16 Co',
    contact_name: 'Ann Test', channel: 'email', message_draft: 'Hi', llm_calls: 1, llm_failures: 0,
    contact_verified_at: '2026-11-17T09:23:45.000Z', contact_verified_title: 'CEO & Co-Founder', gtm_people: 1 });
  check('gtm_insert_draft stores the 3 new columns', d1.length === 1 && d1[0].contact_verified_title === 'CEO & Co-Founder' &&
    d1[0].gtm_people === 1 && new Date(d1[0].contact_verified_at).toISOString() === '2026-11-17T09:23:45.000Z' &&
    d1[0].lead_track === 'smb_direct' && d1[0].approval_status === 'pending', d1[0]);
  const d2 = await draft({ outreach_id: 't16_o2', account_id: 't16_acc', contact_id: 't16_ct', company_name: 'T16 Co',
    contact_verified_at: '', contact_verified_title: '', gtm_people: '' });
  check('gtm_insert_draft: "" for the 3 columns becomes null', d2.length === 1 && d2[0].contact_verified_at === null &&
    d2[0].contact_verified_title === null && d2[0].gtm_people === null, d2[0]);
  const d3 = await draft({ outreach_id: 't16_o3', account_id: 't16_acc', company_name: 'T16 Co' });
  check('gtm_insert_draft: rows without the new keys still insert (S15 shape)', d3.length === 1 && d3[0].gtm_people === null, d3[0]);
  const d1b = await draft({ outreach_id: 't16_o1', account_id: 't16_acc', gtm_people: 5 });
  check('gtm_insert_draft: an existing outreach_id is returned unchanged', d1b.length === 1 && d1b[0].gtm_people === 1, d1b[0]);
  const rv = await one(`select contact_verified_at, contact_verified_title, gtm_people, contact_title, lead_track from v_review_queue where outreach_id = 't16_o1'`);
  check('v_review_queue shows the 3 columns', rv && rv.contact_verified_title === 'CEO & Co-Founder' && rv.gtm_people === 1 &&
    rv.contact_verified_at !== null && rv.contact_title === 'CEO', rv);
  const last3 = async (v) => (await q(`select column_name from information_schema.columns where table_name = $1 order by ordinal_position`, [v])).map(c => c.column_name).slice(-3).join();
  const rqLast = await last3('v_review_queue'), shLast = await last3('n8n_outreach_queue_sheet');
  check('v_review_queue ends with contact_verified_at, contact_verified_title, gtm_people', rqLast === 'contact_verified_at,contact_verified_title,gtm_people', rqLast);
  check('n8n_outreach_queue_sheet ends with the same 3 columns', shLast === 'contact_verified_at,contact_verified_title,gtm_people', shLast);
  const sh1 = await one(`select contact_verified_at, contact_verified_title, gtm_people, lead_track from n8n_outreach_queue_sheet where outreach_id = 't16_o1'`);
  const sh2 = await one(`select contact_verified_at, contact_verified_title, gtm_people from n8n_outreach_queue_sheet where outreach_id = 't16_o2'`);
  check('n8n_outreach_queue_sheet: ISO text and title; empty values are "" and gtm_people stays null',
    sh1 && /^2026-11-17T09:23:45/.test(sh1.contact_verified_at) && sh1.contact_verified_title === 'CEO & Co-Founder' && sh1.gtm_people === 1 &&
    sh1.lead_track === 'smb_direct' && sh2.contact_verified_at === '' && sh2.contact_verified_title === '' && sh2.gtm_people === null, { sh1, sh2 });
  const smoke = await one(`select (select count(*) from v_review_queue)::int as rq, (select count(*) from n8n_outreach_queue_sheet)::int as sh,
    (select count(*) from v_outreach_blocks)::int as bl, (select count(*) from v_trigger_latest)::int as tl,
    (select count(*) from v_account_check_latest)::int as al, (select results_30d from v_clay_usage) as cu`);
  check('console, engine and new views all answer', Object.values(smoke).every(n => Number.isInteger(n)), smoke);
} finally {
  await q('rollback');
  console.log('test rows rolled back');
}

console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
await db.close();
process.exit(failed ? 1 : 0);
