// Sprint 15: offline test of the GTM Gig Finder Code node bodies. No network, no n8n, no Neon, no LLM.
// The forum notification emails below are SYNTHETIC (no real one exists until the Jobs category is watched);
// replace them with a saved real email after the first live run (see SPIKE.md section 4).
// Usage: node scripts/s15/gig/test_gig_nodes.mjs     (exit code 0 = all checks passed)
import fs from 'node:fs';
import path from 'node:path';
import { S15 } from '../phase2_config.mjs';

const dir = path.resolve('scripts/s15/gig');
const load = (n) => fs.readFileSync(path.join(dir, n + '.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let failed = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  got: ' + JSON.stringify(got).slice(0, 600)}`); if (!ok) failed++; };
const items = (arr) => arr.map(json => ({ json }));
const node = (data) => ({ all: () => items(data), first: () => ({ json: data[0] }) });
const run = async (name, nodes, input, opts = {}) => {
  const $ = (n) => { if (!(n in nodes)) throw new Error('node not mocked: ' + n); return node(nodes[n]); };
  const $input = { all: () => items(input), first: () => ({ json: input[0] }) };
  return (await new AsyncFunction('$', '$input', '$env', load(name)).call({ helpers: { httpRequest: opts.http || (async () => { throw new Error('no network in tests'); }) } },
    $, $input, opts.env || {})).map(i => i.json);
};

const config = JSON.parse(JSON.stringify(Object.assign({ rev: 'test-rev', outreach: { sender_name: 'Mohamed', llm: { chain: ['groq', 'template'], politeness_ms: 0, max_wait_s: 0 } } }, S15)));
const LC = [{ config }];
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();

// ---------- Parse Forum Mail ----------
const mail = (id, subject, link, body, fromName = 'jane_doe via n8n Community', h = 3) => ({
  id, threadId: id, subject, date: hoursAgo(h),
  from: { value: [{ name: fromName, address: 'noreply@forum.example.com' }], text: fromName },
  text: body + '\n\nVisit Topic or reply to this email to respond.\n' + link + '\n\nTo unsubscribe from these emails, click here.'
});
const mails = [
  mail('m1', '[n8n Community] [Jobs] Looking for n8n developer to sync HubSpot deals into Google Sheets',
    'https://community.n8n.io/t/looking-for-n8n-developer-to-sync-hubspot-deals/123456/1',
    'Hi all, we need someone to build an n8n workflow that pulls HubSpot deals every hour and writes them to Google Sheets, with a webhook for new deals. Paid task, remote is fine, EU hours preferred. DM me if interested.'),
  mail('m2', '[n8n Community] [Jobs] [FOR HIRE] n8n expert available for your projects',
    'https://community.n8n.io/t/for-hire-n8n-expert-available/123457/1',
    'I am an n8n expert with 6 years of experience, available for hire. Contact me.'),
  mail('m3', '[n8n Community] [Jobs] Looking for n8n developer to sync HubSpot deals into Google Sheets',
    'https://community.n8n.io/t/looking-for-n8n-developer-to-sync-hubspot-deals/123456/3', 'I can help with this!'),
  mail('m4', '[n8n Community] Summary', 'https://example.com/nothing', 'Weekly summary without topic links.')
];
let pm = await run('Parse Forum Mail', { 'Load Config': LC }, mails);
const pmPosts = pm.filter(j => j.post_key);
check('forum mail: 2 posts (new topics only), reply and summary skipped', pmPosts.length === 2 && /replies_skipped=1/.test(pm.at(-1).__stats) && /no_link=1/.test(pm.at(-1).__stats), pm.at(-1));
const p1 = pmPosts.find(p => p.post_key === 'n8n:123456');
check('forum mail: key, url, title without [..] prefixes, poster without "via"', p1 && p1.url === 'https://community.n8n.io/t/looking-for-n8n-developer-to-sync-hubspot-deals/123456' &&
  p1.title.startsWith('Looking for n8n developer') && p1.poster === 'jane_doe' && p1.platform === 'n8n_forum', p1);
check('forum mail: footer cut from the body', p1 && !/unsubscribe/i.test(p1.body_text) && /Google Sheets/.test(p1.body_text), p1 && p1.body_text);
pm = await run('Parse Forum Mail', { 'Load Config': LC }, LC);
check('forum mail: Gmail node disabled (config item passed through) is a skip, not an error', pm.length === 1 && /no mail read/.test(pm[0].__skipped), pm);

// ---------- HN Freelancer Source ----------
let hn = await run('HN Freelancer Source', { 'Load Config': LC }, LC);
check('hn: off by default (Phase 0)', hn.length === 1 && /disabled/.test(hn[0].__skipped), hn);
const cfgHn = JSON.parse(JSON.stringify(config)); cfgHn.gig.sources.hn_freelancer.enabled = true;
hn = await run('HN Freelancer Source', { 'Load Config': [{ config: cfgHn }] }, LC, { http: async ({ url }) => url.includes('search_by_date')
  ? { hits: [{ objectID: '1', title: 'Ask HN: Freelancer? Seeking freelancer? (November 2026)', created_at: '2026-11-02T16:02:19Z', num_comments: 3 }] }
  : { children: [{ id: 11, author: 'acme', created_at: '2026-11-03T10:00:00Z', text: 'SEEKING FREELANCER | n8n and HubSpot<p>Need a HubSpot sync built in n8n.', children: [] },
                 { id: 12, author: 'dev', created_at: '2026-11-03T11:00:00Z', text: 'SEEKING WORK | Remote', children: [] }] } });
check('hn: keeps SEEKING FREELANCER only', hn.filter(j => j.post_key).length === 1 && hn[0].post_key === 'hn:11', hn);

// ---------- Gig Gates ----------
const manual = { post_key: 'manual:abc123def456', platform: 'manual', url: 'https://example.org/job/1', title: 'Need help with a Clay table and HubSpot import',
  body_text: 'We are looking for someone to build a Clay enrichment table and import the results into HubSpot. Ongoing work possible.', poster: 'Sam', poster_company: 'Acme Agency',
  posted_at: hoursAgo(10), reply_count: null, __source: 'manual' };
const base = (k, o) => Object.assign({ post_key: k, platform: 'n8n_forum', url: 'https://community.n8n.io/t/x/' + k.split(':')[1], poster: 'p', posted_at: hoursAgo(5), reply_count: 2 }, o);
const merged = pmPosts.concat([manual,
  base('n8n:2001', { title: 'Looking for n8n help with a webhook', body_text: 'Need an n8n webhook to post into Slack. Paid.', posted_at: hoursAgo(100) }),
  base('n8n:2002', { title: 'Need n8n developer for CRM sync', body_text: 'Looking for help with n8n and HubSpot.', reply_count: 40 }),
  base('n8n:2003', { title: 'Looking for n8n developer', body_text: 'Need a crypto trading bot built with n8n.' }),
  base('n8n:2004', { title: 'Looking for a logo designer', body_text: 'Need a logo for our bakery.' }),
  base('n8n:2005', { title: 'Need n8n workflow', body_text: 'Looking for an n8n automation. Budget $15/hour.' }),
  base('n8n:999', { title: 'Need help with n8n', body_text: 'Already drafted earlier.' }),
  { __skipped: 'hn_freelancer: disabled by config' }, {}]);
const cfgFloor = JSON.parse(JSON.stringify(config)); cfgFloor.gig.min_hourly_usd = 25;
const gates = await run('Gig Gates', { 'Load Config': [{ config: cfgFloor }], 'Merge Posts': merged, 'Fetch Seen Gigs': [{ post_key: 'n8n:999', status: 'drafted' }] }, []);
const g = Object.fromEntries(gates.filter(j => j.post_key).map(j => [j.post_key, j]));
const C = gates.at(-1).__gate_stats;
check('gates: [FOR HIRE] post is gated as intent_for_hire, never new', g['n8n:123457'] && g['n8n:123457'].status === 'gated_out' && g['n8n:123457'].gate_reason === 'intent_for_hire', g['n8n:123457']);
check('gates: stale, crowded, veto, stack, budget in that order', g['n8n:2001'].gate_reason === 'stale' && g['n8n:2002'].gate_reason === 'crowded' &&
  g['n8n:2003'].gate_reason === 'veto:crypto' && g['n8n:2004'].gate_reason === 'stack_miss' && /^budget_low:15/.test(g['n8n:2005'].gate_reason), Object.values(g).map(x => x.post_key + '=' + x.gate_reason));
check('gates: seen post (drafted) is counted and dropped', !g['n8n:999'] && C.already_seen === 1, C);
check('gates: every counter is set', C.fetched === 9 && C.intent_for_hire === 1 && C.stale === 1 && C.crowded === 1 && C.vetoed === 1 && C.stack_miss === 1 && C.budget_low === 1 && C.passed === 2, C);
check('gates: DM invite and stack matches extracted', g['n8n:123456'].contact_hint === 'dm_invited' && /n8n/.test(g['n8n:123456'].matched_stack) && /HubSpot/.test(g['n8n:123456'].matched_stack) && g['n8n:123456'].intent === 'hiring', g['n8n:123456']);
check('gates: source notes kept for stats', gates.at(-1).__source_notes.some(s => /hn_freelancer/.test(s)), gates.at(-1));

// ---------- Score Gigs ----------
const sc = (await run('Score Gigs', { 'Load Config': LC }, gates))[0];
const sp = Object.fromEntries(sc.posts.map(p => [p.post_key, p]));
check('score: passing posts scored 0..100 with a breakdown, gated ones unscored', sp['n8n:123456'].gig_score >= 60 && sp['n8n:123456'].gig_score <= 100 &&
  /-> \d+$/.test(sp['n8n:123456'].score_breakdown) && sp['n8n:123457'].gig_score === null, sp['n8n:123456']);
check('score: agency / ongoing bonus applied', /bonus=10/.test(sp['manual:abc123def456'].score_breakdown), sp['manual:abc123def456']);
check('score: helper fields stripped before the upsert', !Object.keys(sp['n8n:123456']).some(k => k.startsWith('__')), Object.keys(sp['n8n:123456']));
check('score: draft params from config (min 60, age 72, pilot cap 2), expiry 144 h', JSON.stringify(sc.draft_params) === '[60,72,2]' && sc.expire_hours === 144, sc.draft_params);
const off = JSON.parse(JSON.stringify(config)); off.lead_tracks.gig_post.enabled = false;
check('score: track switched off means 0 drafts', (await run('Score Gigs', { 'Load Config': [{ config: off }] }, gates))[0].draft_params[2] === 0);

// ---------- Draft Gig Reply ----------
const toDraft = [Object.assign({}, sp['n8n:123456']), Object.assign({}, sp['manual:abc123def456'])];
const good1 = { reply: 'Hi Jane, you need an n8n workflow that pulls HubSpot deals every hour into Google Sheets, plus a webhook for new deals. ' +
  'I built an n8n and HubSpot sync for my own outbound engine, which is a public repo: Personal GTM Engine. ' +
  'A good first step would be one fixed-scope build: the hourly deals sync with the webhook, tested on a copy of your sheet. ' +
  'If that sounds useful, I can start with a small paid trial task.', email_subject: 'HubSpot deals to Google Sheets' };
const bad2 = { reply: 'Hi Sam, I am a senior expert in Clay with 5 years of experience. See https://example.com. I can build your Clay table.', email_subject: 'Clay' };
const good2 = { reply: 'Hi Sam, you want a Clay enrichment table whose results get imported into HubSpot, with more work possible later. ' +
  'I built the Clay layer of my own outbound engine, a public repo called Personal GTM Engine, so this is the kind of table I set up. ' +
  'A good first step: one Clay table with your enrichment columns and a clean HubSpot import, scoped to a sample of your list. ' +
  'Happy to send a short Loom of how I would approach it.', email_subject: 'Clay table into HubSpot' };
let n = 0;
const llm = async ({ body }) => {
  n++;
  const u = body.messages[1].content;
  const ans = u.includes('Jane') || u.includes('jane_doe') ? good1 : (u.includes('REJECTED') ? good2 : bad2);
  return { statusCode: 200, headers: {}, body: { choices: [{ message: { content: JSON.stringify(ans) } }] } };
};
const drafts = await run('Draft Gig Reply', { 'Load Config': LC }, toDraft, { http: llm, env: { GROQ_API_KEY: 'k' } });
const d1 = drafts.find(j => j.account_id === 'gig:n8n:123456'), d2 = drafts.find(j => j.account_id === 'gig:manual:abc123def456');
check('draft: valid reply is pending, lead_track gig_post, angle gig_reply', d1 && d1.approval_status === 'pending' && d1.lead_track === 'gig_post' && d1.angle === 'gig_reply', d1 && d1.risk_notes);
check('draft: channel forum_dm when the post invites a DM', d1 && d1.channel === 'forum_dm', d1 && d1.channel);
check('draft: links added by code after validation, not by the LLM', d1 && d1.message_draft.includes('\n\nMohamed\nhttps://mohamedlandolsi.tech'), d1 && d1.message_draft);
check('draft: seniority claim, invented number and link rejected, repaired once, then pending', d2 && d2.approval_status === 'pending' && /seniority_claim/.test(d2.risk_notes) && /invented_number/.test(d2.risk_notes) && /llm_link/.test(d2.risk_notes), d2 && d2.risk_notes);
check('draft: trigger is title + posted date, notes carry the post link', d1 && /\(posted \d{4}-\d{2}-\d{2}\)$/.test(d1.trigger) && d1.notes.startsWith('Post: https://community.n8n.io/'), d1 && d1.trigger);
check('draft: ping fields carry no email and no body', d1 && Object.keys(d1).filter(k => k.startsWith('__')).sort().join() === '__age_h,__console_link,__gig_score,__ping,__platform,__post_url,__title', d1 && Object.keys(d1));
const st = drafts.at(-1);
check('draft: stats row last', st.__row_type === 'stats' && st.__stats.drafted === 2 && st.__stats.pending === 2, st);
const tpl = await run('Draft Gig Reply', { 'Load Config': LC }, [toDraft[0]], { env: {} });
check('draft: no LLM key means a template draft parked in needs_redraft', tpl[0].approval_status === 'needs_redraft' && /key_missing/.test(tpl[0].risk_notes) && tpl[0].llm_provider === 'template', tpl[0]);
const none = await run('Draft Gig Reply', { 'Load Config': LC }, [{}]);
check('draft: empty select (alwaysOutputData item) gives the stats row only', none.length === 1 && none[0].__stats.candidates === 0, none);
check('draft: no em dash in any draft', !drafts.some(j => /[—–]/.test(String(j.message_draft || ''))));

// ---------- Gig Run Stats ----------
const rs = await run('Gig Run Stats', { 'Load Config': LC, 'Score Gigs': [sc], 'Upsert Gig Posts': [{ result: { inserted: 8, updated: 0 } }],
  'Expire Old Gigs': [{ result: { expired: 1, superseded: 1 } }], 'Hot Gig Ping': [{}] }, [st]);
const row = rs[0];
check('stats: gig_ops row carries every gate counter and config_rev', row.config_rev === 'test-rev' && row.fetched === 9 && row.intent_for_hire === 1 && row.stale === 1 &&
  row.crowded === 1 && row.vetoed === 1 && row.stack_miss === 1 && row.budget_low === 1 && row.already_seen === 1 && row.drafted === 2 && row.pinged === 1 && row.expired === 1, row);
check('stats: source_stats is JSON with upsert and drafts', JSON.parse(row.source_stats).upsert.inserted === 8 && JSON.parse(row.source_stats).drafts.pending === 2, row.source_stats);

console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
process.exit(failed ? 1 : 0);
