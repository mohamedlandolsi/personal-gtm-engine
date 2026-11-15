// Sprint 15: test of db/s15_lead_tracks.sql. Exit code 0 = all checks passed.
// Two targets, same checks:
//   offline (default): schema.sql + the migration in an in-memory Postgres (PGlite). Nothing touches Neon.
//     PowerShell: $env:PGLITE_DIR="C:\temp\pgl"; node scripts/s15_sql_test.mjs
//   neon branch s15-test only: applies the migration twice, then runs every check inside one
//   transaction that is ROLLED BACK, so the branch keeps the migration but none of the test rows.
//     PowerShell: $env:S15_TEST_DATABASE_URL="<s15-test URL>"; node scripts/s15_sql_test.mjs --neon
//   The URL is never stored in the repo. The script refuses any host other than the s15-test endpoint.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const S15_TEST_ENDPOINT = 'ep-bitter-sound-b9saaxyd';   // branch s15-test (br-wispy-glitter-b9trkhwp)
const neon = process.argv.includes('--neon');
const migration = fs.readFileSync('db/s15_lead_tracks.sql', 'utf8');
const hubspot = fs.readFileSync('db/s15_hubspot.sql', 'utf8');   // Phase 6

let run, close;
if (neon) {
  const url = process.env.S15_TEST_DATABASE_URL || '';
  if (!url) { console.error('S15_TEST_DATABASE_URL is not set'); process.exit(2); }
  const host = new URL(url).hostname;
  if (!host.startsWith(S15_TEST_ENDPOINT)) { console.error('Refusing: host is not the s15-test endpoint: ' + host); process.exit(2); }
  const req = createRequire(path.resolve('gtm-console', 'package.json'));
  const mod = await import(pathToFileURL(req.resolve('@neondatabase/serverless')).href);
  const { Client, neonConfig } = mod.Client ? mod : mod.default;
  if (typeof WebSocket !== 'undefined') neonConfig.webSocketConstructor = WebSocket;
  const client = new Client({ connectionString: url });
  await client.connect();
  run = async (s, p) => (await client.query(s, p)).rows;
  close = () => client.end();
  console.log('target: neon ' + host);
} else {
  const dir = path.resolve(process.env.PGLITE_DIR || process.cwd());
  const entry = createRequire(path.join(dir, 'package.json')).resolve('@electric-sql/pglite');
  const { PGlite } = await import(pathToFileURL(entry).href);
  const db = new PGlite();
  await db.exec(fs.readFileSync('db/schema.sql', 'utf8'));
  run = async (s, p) => (p ? (await db.query(s, p)).rows : ((await db.exec(s)).at(-1)?.rows ?? []));
  close = () => db.close();
  console.log('target: pglite (schema.sql)');
}

const q = (s, p) => run(s, p);
let failed = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  got: ' + JSON.stringify(got)}`); if (!ok) failed++; };
// An expected error must not abort the test transaction: wrap it in a savepoint.
const err = async (sql, p) => {
  await q('savepoint t');
  try { await q(sql, p); await q('release savepoint t'); return ''; }
  catch (e) { await q('rollback to savepoint t'); return String(e.message || e); }
};
const one = async (s, p) => (await q(s, p))[0];
const draft = (o) => q(`select * from gtm_insert_draft($1::jsonb)`, [JSON.stringify(o)]);
const upsert = async (posts) => (await one(`select gtm_gig_upsert($1::jsonb) as r`, [JSON.stringify(posts)])).r;
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();

// ---------- migration ---------------------------------------------------------------
await q(migration);
await q(migration);
await q(hubspot);
await q(hubspot);
check('migrations (lead tracks, hubspot) run twice without error', true);
const cols = await q(`select table_name, column_name, is_nullable, column_default from information_schema.columns
  where table_schema = 'public' and column_name in ('lead_track','source_meta') and table_name in ('accounts','outreach_queue') order by 1, 2`);
check('lead_track and source_meta exist with smb_direct default',
  cols.length === 3 && cols.filter(c => c.column_name === 'lead_track').every(c => c.is_nullable === 'NO' && /smb_direct/.test(c.column_default)), cols);

await q('begin');
try {
  // ---------- existing rows and fixtures ------------------------------------------------
  const nulls = await one(`select (select count(*) from accounts where lead_track is null)::int as a,
                                  (select count(*) from outreach_queue where lead_track is null)::int as o`);
  check('no existing row has a NULL lead_track', nulls.a === 0 && nulls.o === 0, nulls);

  await q(`insert into accounts (account_id, company_name, domain, status) values
    ('t15_smb', 'T15 Smb', 't15s.io', 'contact_found'),
    ('t15_agy', 'T15 Agency', 't15a.io', 'contact_found')`);
  const a0 = await one(`select lead_track from accounts where account_id = 't15_smb'`);
  check('new account without lead_track gets smb_direct', a0.lead_track === 'smb_direct', a0);

  // ---------- gtm_insert_draft ---------------------------------------------------------
  await draft({ outreach_id: 't15_o1', account_id: 't15_smb', contact_id: 't15_c1', message_draft: 'smb draft body text' });
  await draft({ outreach_id: 't15_o2', account_id: 't15_smb', contact_id: 't15_c1', message_draft: 'smb draft body text', lead_track: '' });
  await draft({ outreach_id: 't15_o3', account_id: 't15_agy', contact_id: 't15_c2', message_draft: 'agency draft body', lead_track: 'agency_partner', approval_status: 'approved' });
  const tr = Object.fromEntries((await q(`select outreach_id, lead_track from outreach_queue where outreach_id like 't15_o%' order by 1`)).map(r => [r.outreach_id, r.lead_track]));
  check('insert_draft: missing key and "" become smb_direct, agency_partner kept',
    tr.t15_o1 === 'smb_direct' && tr.t15_o2 === 'smb_direct' && tr.t15_o3 === 'agency_partner', tr);
  check('insert_draft: unknown track is refused by the check',
    /outreach_track_chk/.test(await err(`select * from gtm_insert_draft($1::jsonb)`, [JSON.stringify({ outreach_id: 't15_bad', lead_track: 'freelance' })])));

  // ---------- gtm_sync_pull ------------------------------------------------------------
  const acc = (id, extra) => ({ account_id: id, company_name: id, domain: id + '.io', status: 'new', ...extra });
  await one(`select gtm_sync_pull($1::jsonb) as r`, [JSON.stringify({ accounts: [
    acc('t15_s1'),                                                   // old Sheet: no lead_track column
    acc('t15_s2', { lead_track: '', source_meta: '' }),              // new column, blank cell
    acc('t15_s3', { lead_track: ' Agency_Partner ', source_meta: '{"directory":"clay","tier":"partner"}' }),
    acc('t15_s4', { lead_track: 'junk' })] })]);
  let sp = Object.fromEntries((await q(`select account_id, lead_track, source_meta from accounts where account_id like 't15_s%'`)).map(r => [r.account_id, r]));
  check('sync_pull: missing, blank and unknown track become smb_direct',
    sp.t15_s1.lead_track === 'smb_direct' && sp.t15_s2.lead_track === 'smb_direct' && sp.t15_s4.lead_track === 'smb_direct', sp);
  check('sync_pull: track is trimmed and lower-cased, source_meta kept, "" source_meta is NULL',
    sp.t15_s3.lead_track === 'agency_partner' && sp.t15_s3.source_meta.includes('clay') && sp.t15_s2.source_meta === null, sp);
  await one(`select gtm_sync_pull($1::jsonb) as r`, [JSON.stringify({ accounts: [acc('t15_s1', { lead_track: 'agency_partner' })] })]);
  sp = await one(`select lead_track from accounts where account_id = 't15_s1'`);
  check('sync_pull: a later sync updates the track', sp.lead_track === 'agency_partner', sp);

  // ---------- gtm_gig_upsert -----------------------------------------------------------
  const post = (k, extra) => ({ post_key: k, platform: 'n8n_forum', url: 'https://community.n8n.io/t/' + k, title: 'Need n8n help ' + k,
    body_text: 'Looking for an n8n freelancer', posted_at: hoursAgo(5), reply_count: 2, intent: 'hiring', gig_score: 70, status: 'new', ...extra });
  let r = await upsert([
    post('n8n:t15a'),
    post('n8n:t15b', { body_text: 'x'.repeat(5000), reply_count: '' }),
    post('n8n:t15c', { title: '[FOR HIRE] n8n expert available', intent: 'for_hire', status: 'gated_out', gate_reason: 'intent', gig_score: '' }),
    post('n8n:t15a', { reply_count: 3 })]);                         // same key twice in one batch
  check('gig_upsert: 3 new posts, duplicate key in one batch is collapsed', r.inserted === 3 && r.updated === 0, r);
  const b = await one(`select length(body_text) as n, reply_count from gig_posts where post_key = 'n8n:t15b'`);
  check('gig_upsert: body_text cut to 4000 chars, "" number becomes NULL', b.n === 4000 && b.reply_count === null, b);
  check('gig_upsert: unknown platform is refused', /gig_platform_chk/.test(await err(`select gtm_gig_upsert($1::jsonb)`, [JSON.stringify(post('x:t15z', { platform: 'reddit' }))])));
  check('gig_upsert: a single object (not an array) works', (await upsert(post('n8n:t15d'))).inserted === 1);

  // ---------- gig draft, re-upsert, review ---------------------------------------------
  const gigDraft = (k, extra) => draft({ outreach_id: 't15_g_' + k, account_id: 'gig:n8n:' + k, contact_id: 'gig:n8n:' + k,
    company_name: 'Gig ' + k, channel: 'forum_reply', angle: 'gig_reply', message_draft: 'gig reply draft body text', lead_track: 'gig_post', ...extra });
  await gigDraft('t15a');
  await gigDraft('t15a');                                            // re-insert: no duplicate, no change
  let g = await one(`select status from gig_posts where post_key = 'n8n:t15a'`);
  check('insert_draft: gig draft moves its post from new to drafted', g.status === 'drafted', g);

  r = await upsert([post('n8n:t15a', { reply_count: 9, gig_score: 10 }), post('n8n:t15b'), post('n8n:t15c', { status: 'new', gig_score: 65, gate_reason: '' })]);
  check('gig_upsert: re-run inserts 0 and updates 3', r.inserted === 0 && r.updated === 3, r);
  g = await one(`select status, reply_count, gig_score from gig_posts where post_key = 'n8n:t15a'`);
  check('gig_upsert: drafted post keeps status and score, reply_count refreshes', g.status === 'drafted' && g.gig_score === 70 && g.reply_count === 9, g);
  g = await one(`select status, gig_score, gate_reason from gig_posts where post_key = 'n8n:t15c'`);
  check('gig_upsert: gated_out post is re-gated (config change can reopen it)', g.status === 'new' && g.gig_score === 65 && g.gate_reason === null, g);

  const rv = await one(`select lead_track, gig_platform, gig_url, gig_reply_count, gig_status, final_score from v_review_queue where outreach_id = 't15_g_t15a'`);
  check('v_review_queue: gig draft shows with post url, platform, replies, status',
    rv && rv.lead_track === 'gig_post' && rv.gig_platform === 'n8n_forum' && rv.gig_url.endsWith('n8n:t15a') && rv.gig_reply_count === 9 && rv.gig_status === 'drafted' && rv.final_score === null, rv);

  await q(`select gtm_review('t15_g_t15a', 'approve')`);
  await q(`select gtm_review('t15_g_t15a', 'mark_sent')`);
  g = await one(`select status from gig_posts where post_key = 'n8n:t15a'`);
  check('gtm_review: Mark sent on a gig draft sets the post to sent', g.status === 'sent', g);
  await upsert(post('n8n:t15a', { status: 'new' }));
  g = await one(`select status from gig_posts where post_key = 'n8n:t15a'`);
  check('gig_upsert: never downgrades sent', g.status === 'sent', g);

  await gigDraft('t15d');
  await q(`select gtm_review('t15_g_t15d', 'redraft')`);
  g = await one(`select status from gig_posts where post_key = 'n8n:t15d'`);
  check('gtm_review: redraft on a gig draft sets the post back to new', g.status === 'new', g);

  // ---------- gtm_gig_expire -----------------------------------------------------------
  await upsert([post('n8n:t15old', { posted_at: hoursAgo(200) }), post('n8n:t15old2', { posted_at: hoursAgo(200) }),
                post('n8n:t15sent', { posted_at: hoursAgo(200) })]);
  await gigDraft('t15old');                                          // pending draft -> superseded
  await gigDraft('t15old2', { approval_status: 'approved' });        // approved draft -> kept
  await gigDraft('t15sent', { approval_status: 'approved' });
  await q(`select gtm_review('t15_g_t15sent', 'mark_sent')`);
  r = (await one(`select gtm_gig_expire(144) as r`)).r;
  const ex = Object.fromEntries((await q(`select post_key, status from gig_posts where post_key like 'n8n:t15%'`)).map(x => [x.post_key, x.status]));
  check('gig_expire: old new/drafted posts expire, sent and fresh posts do not',
    ex['n8n:t15old'] === 'expired' && ex['n8n:t15old2'] === 'expired' && ex['n8n:t15sent'] === 'sent' && ex['n8n:t15b'] === 'new', ex);
  const ds = Object.fromEntries((await q(`select outreach_id, approval_status from outreach_queue where outreach_id in ('t15_g_t15old','t15_g_t15old2')`)).map(x => [x.outreach_id, x.approval_status]));
  check('gig_expire: pending draft superseded, approved draft kept', ds.t15_g_t15old === 'superseded' && ds.t15_g_t15old2 === 'approved', ds);
  const ev = await q(`select action, actor from console_events where entity_id = 't15_g_t15old' and action = 'gig_expire'`);
  check('gig_expire: one console_events row per superseded draft', ev.length === 1 && ev[0].actor === 'gig_expire', ev);
  check('gig_expire: counts returned', r.expired >= 2 && r.superseded >= 1, r);
  check('gig_expire: second run changes nothing', (await one(`select gtm_gig_expire(144) as r`)).r.expired === 0);

  // ---------- console gig functions -----------------------------------------------------
  const added = (await one(`select gtm_gig_add($1, $2, $3) as r`,
    ['https://community.n8n.io/t/need-help-with-hubspot-sync/987654', 'Need help with a HubSpot sync', 'Looking for someone to fix our n8n HubSpot workflow, paid task.'])).r;
  check('gig_add: n8n forum link gives n8n:<topic id>, new, unscored', added.post_key === 'n8n:987654' && added.platform === 'n8n_forum' && added.status === 'new' && added.gig_score === null, added);
  const man = (await one(`select gtm_gig_add($1, $2, $3) as r`, ['https://www.reddit.com/r/n8n/comments/abc/hiring_n8n_dev/', 'Hiring an n8n dev', 'We need an n8n developer for a webhook to CRM flow.'])).r;
  check('gig_add: other links get manual:<hash> and platform manual', /^manual:[0-9a-f]{12}$/.test(man.post_key) && man.platform === 'manual', man);
  await one(`select gtm_gig_add($1, $2, $3) as r`, ['https://www.reddit.com/r/n8n/comments/abc/hiring_n8n_dev/', 'Hiring an n8n dev', 'We need an n8n developer for a webhook to CRM flow.']);
  check('gig_add: adding the same link twice keeps one row', (await one(`select count(*)::int as n from gig_posts where post_key = $1`, [man.post_key])).n === 1);
  check('gig_add: bad link is refused', (await err(`select gtm_gig_add('not a link', 'Some title', 'Some body text that is long enough')`)).startsWith('invalid_url'));
  check('gig_status: unknown status is refused', (await err(`select gtm_gig_status('n8n:987654', 'archived')`)).startsWith('invalid_status'));
  let gs = (await one(`select gtm_gig_status('n8n:987654', 'dismiss') as r`)).r;
  check('gig_status: dismiss sets gated_out with reason dismissed', gs.status === 'gated_out' && gs.gate_reason === 'dismissed', gs);
  check('gig_status: dismiss after a reply was sent is refused', (await err(`select gtm_gig_status('n8n:t15a', 'dismiss')`)).startsWith('invalid_transition'));
  gs = (await one(`select gtm_gig_status('n8n:t15a', 'replied') as r`)).r;
  check('gig_status: sent -> replied', gs.status === 'replied', gs);
  await q(`select gtm_gig_status('n8n:t15a', 'won')`);
  check('gig_status: won is final (no back to replied)', (await err(`select gtm_gig_status('n8n:t15a', 'replied')`)).startsWith('invalid_transition'));
  const gev = (await q(`select action from console_events where entity = 'gig' and entity_id = 'n8n:t15a' order by id`)).map(x => x.action);
  check('gig_status: every change logged in console_events', gev.join() === 'replied,won', gev);
  const vg = await one(`select age_hours, outreach_id, draft_status from v_gig_posts where post_key = 'n8n:t15a'`);
  check('v_gig_posts: age and live draft shown', vg && vg.age_hours >= 4 && vg.outreach_id === 't15_g_t15a' && vg.draft_status === 'approved', vg);

  // ---------- Phase 6: HubSpot outbox ----------------------------------------------------
  await q(`update accounts set lead_track = 'agency_partner' where account_id = 't15_agy'`);
  let ob = await one(`select properties from v_hubspot_outbox where step = 1 and local_id = 't15_agy'`);
  check('hubspot outbox: company payload carries gtm_lead_track', ob && ob.properties.gtm_lead_track === 'agency_partner', ob);
  await q(`insert into hubspot_links (link_type, local_id, hubspot_id, pushed_hash)
           select 'companies', 't15_agy', 'hs_t15', md5(properties::text) from v_hubspot_outbox where step = 1 and local_id = 't15_agy'`);
  ob = await one(`select count(*)::int as n from v_hubspot_outbox where step = 1 and local_id = 't15_agy'`);
  check('hubspot outbox: a second sync writes nothing for the same company', ob.n === 0, ob);
  check('hubspot outbox: no gig draft in scope', (await one(`select count(*)::int as n from v_hubspot_scope where account_id like 'gig:%'`)).n === 0);

  // ---------- views --------------------------------------------------------------------
  const hs = (await q(`select outreach_id from v_hubspot_scope where outreach_id like 't15_%'`)).map(x => x.outreach_id).sort();
  check('v_hubspot_scope: approved agency draft in scope, gig drafts never', hs.join() === 't15_o3', hs);
  const va = await one(`select lead_track, source_meta, block_reason, drafts_count from v_accounts where account_id = 't15_s3'`);
  check('v_accounts: shows lead_track and source_meta', va && va.lead_track === 'agency_partner' && va.source_meta.includes('clay'), va);
  const sh = await one(`select lead_track, reviewed_at from n8n_outreach_queue_sheet where outreach_id = 't15_o3'`);
  check('n8n_outreach_queue_sheet: lead_track appended', sh && sh.lead_track === 'agency_partner', sh);
  const smoke = await one(`select (select count(*) from v_review_queue)::int as rq, (select count(*) from v_accounts)::int as va,
    (select count(*) from v_hubspot_outbox)::int as ob, (select count(*) from gtm_sync_push_rows())::int as pr,
    (select count(*) from v_outreach_blocks)::int as bl`);
  check('console and sync views still answer', Object.values(smoke).every(n => Number.isInteger(n)), smoke);
} finally {
  await q('rollback');
  console.log('test rows rolled back');
}

console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
await close();
process.exit(failed ? 1 : 0);
