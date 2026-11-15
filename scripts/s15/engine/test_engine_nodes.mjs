// Sprint 15 Phase 4: offline tests of the agency lane bodies. No network, no n8n, no Neon, no LLM.
//  1. SMB regression: every patched node gives the same SMB output as the S14 body (new track keys aside),
//     on the S14 Draft Outreach pairs and on the scripts/s14/fixtures Select Outreach Pairs data (local, not committed).
//  2. Agency behaviour of each node, including Partner Directories Source on the Phase 0 fixtures.
// Usage: node scripts/s15/engine/test_engine_nodes.mjs <dir with the S14 live .js copies>   (exit 0 = all passed)
import fs from 'node:fs';
import path from 'node:path';
import { S15 } from '../phase2_config.mjs';

const OLD = path.resolve(process.argv[2] || 'scripts/s14');
const NEW = path.resolve('scripts/s15/engine');
const src = (dir, n) => fs.readFileSync(path.join(dir, n + '.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let failed = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  got: ' + JSON.stringify(got).slice(0, 700)}`); if (!ok) failed++; };
const run = async (code, nodes, input, http, env = {}) => {
  const $ = (n) => { if (!(n in nodes)) throw new Error('node not executed: ' + n); const it = nodes[n].map(json => ({ json })); return { all: () => it, first: () => it[0] }; };
  const $input = { all: () => input.map(json => ({ json })), first: () => ({ json: input[0] }) };
  return (await new AsyncFunction('$', '$input', '$env', code).call({ helpers: { httpRequest: http || (async () => { throw new Error('no network'); }) } }, $, $input, env)).map(i => i.json);
};
const strip = (rows, keys) => rows.map(r => { const o = Object.assign({}, r); for (const k of keys) delete o[k]; return o; });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const TRACK_KEYS = ['lead_track', 'source_meta', 'hiring_signal', 'run_date', 'outreach_id', 'queued_at', 'first_seen_at', 'last_seen_at'];

const baseCfg = JSON.parse(fs.readFileSync('config/config.example.json', 'utf8'));
const config = JSON.parse(JSON.stringify(Object.assign({}, baseCfg, S15, { outreach: Object.assign({}, baseCfg.outreach, S15.outreach) })));
config.timezone = Object.assign({ allowed_utc_offsets: [0, 1, 2, 3, 4], allow_unknown_timezone: true }, config.timezone);
const LC = [{ config, warnings: [] }];

// ============ 1. SMB regression ============
// --- Draft Outreach on the S14 test pairs (fixture block taken from the S14 test file, not retyped) ---
const s14 = fs.readFileSync('scripts/s14/test_draft_outreach.mjs', 'utf8');
const block = s14.slice(s14.indexOf('const config = {'), s14.indexOf('const $ = (name) => {'));
const fixtureFactory = new Function('URL', 'return (async () => {' + block + '; return { config, pairs, httpRequest }; })();');
const draftRun = async (dir) => {
  const fx = await fixtureFactory(URL);
  const $ = (name) => { if (name === 'Load Config') return { first: () => ({ json: { config: fx.config } }), all: () => [{ json: { config: fx.config } }] }; throw new Error('node not executed: ' + name); };
  return (await new AsyncFunction('$', '$input', '$env', src(dir, 'Draft Outreach')).call({ helpers: { httpRequest: fx.httpRequest } }, $, { all: () => fx.pairs.map(json => ({ json })) }, { GROQ_API_KEY: 'k' })).map(i => i.json);
};
const dOld = await draftRun(OLD), dNew = await draftRun(NEW);
check('Draft Outreach: SMB rows identical to S14 (lead_track aside)', same(strip(dOld, TRACK_KEYS), strip(dNew, TRACK_KEYS)), { old: dOld.length, new: dNew.length });
check('Draft Outreach: SMB rows carry lead_track smb_direct (gate rows too)', dNew.length === 7 && dNew.every(r => r.lead_track === 'smb_direct'), dNew.map(r => r.lead_track));

// --- Select Outreach Pairs on the S14 fixtures ---
const fxDir = 'scripts/s14/fixtures';
if (fs.existsSync(path.join(fxDir, 'accounts.json'))) {
  const fx = (n) => JSON.parse(fs.readFileSync(path.join(fxDir, n), 'utf8'));
  const cfgRow = fx('config.json')[0];
  const nodes = { 'Fetch Accounts For Outreach': fx('accounts.json'), 'Fetch Contacts For Outreach': fx('contacts.json'), 'Fetch Outreach Queue': fx('queue.json'),
    'Fetch Outreach Blocks': fx('blocks.json'), 'Load Config': [{ config: cfgRow.payload || cfgRow, warnings: [] }], 'Rescore Accounts': [] };
  const pOld = await run(src(OLD, 'Select Outreach Pairs'), nodes, []), pNew = await run(src(NEW, 'Select Outreach Pairs'), nodes, []);
  check('Select Outreach Pairs: S14 fixture pairs and stats identical (track keys aside)', same(strip(pOld, TRACK_KEYS), strip(pNew, TRACK_KEYS)) && pOld.length === pNew.length, [pOld.length, pNew.length]);
} else console.log('SKIP  Select Outreach Pairs fixture diff (scripts/s14/fixtures not present)');

// --- Process Accounts, Score Enriched, Rescore, Clay, Contact batch on synthetic SMB rows ---
const smb = (d, o) => Object.assign({ source: 'yc_directory', company_name: d, domain: d + '.io', website: 'https://' + d + '.io', industry: 'b2b saas',
  company_type: 'startup', employee_count: 30, location_raw: 'Berlin, Germany', country: 'Germany', timezone_utc_offset: 1, funding_stage: 'seed',
  description_text: 'CRM automation and hubspot workflows for revops teams', status: 'new' }, o);
const smbIn = [smb('alpha'), smb('beta', { employee_count: 400 }), smb('gamma', { timezone_utc_offset: -8 }), smb('delta', { company_type: 'agency', industry: 'marketing agency' })];
const paNodes = (rows) => ({ 'Load Config': LC, 'Merge Sources': rows });
const paOld = await run(src(OLD, 'Process Accounts'), paNodes(smbIn), []), paNew = await run(src(NEW, 'Process Accounts'), paNodes(smbIn), []);
check('Process Accounts: SMB accounts and stats identical (lead_track aside)',
  same(strip(paOld[0].accounts, TRACK_KEYS), strip(paNew[0].accounts, TRACK_KEYS)) && same(paOld[0].stats, paNew[0].stats) && paNew[0].accounts.every(a => a.lead_track === 'smb_direct'), [paOld[0].stats, paNew[0].stats]);

const page = (o) => ({ data: '<html><script src="https://js.hs-scripts.com/1.js"></script><a href="/careers">Careers</a><meta name="description" content="CRM ops for B2B teams in Europe"></html>', ...o });
const accs = paOld[0].accounts.map(a => Object.assign({ account_id: a.account_id }, a));
const seOld = await run(src(OLD, 'Score Enriched'), { 'Load Config': LC, 'Select Pending Accounts': accs }, accs.map(() => page()));
const seNew = await run(src(NEW, 'Score Enriched'), { 'Load Config': LC, 'Select Pending Accounts': accs }, accs.map(() => page()));
check('Score Enriched: SMB rows identical', same(strip(seOld, TRACK_KEYS), strip(seNew, TRACK_KEYS)), seNew.map(r => r.score_breakdown));

const qual = seOld.map(r => Object.assign({}, r, { contact_status: 'queued' }));
const reIn = qual.map(r => ({ contact_id: 'c_' + r.account_id, account_id: r.account_id, contact_score: 80 })).concat([{ __row_type: 'stats', stats: { all_qualified: qual } }]);
const reNodes = { 'Load Config': LC, 'Fetch Contact Results': [], 'Fetch Seen Contacts': [] };
const rOld = await run(src(OLD, 'Rescore Accounts'), reNodes, reIn), rNew = await run(src(NEW, 'Rescore Accounts'), reNodes, reIn);
check('Rescore Accounts: SMB rows identical', same(rOld, rNew), rNew.slice(0, 2));

const clayIn = seOld.map(r => Object.assign({}, r, { clay_status: '' }));
const cOld = await run(src(OLD, 'Select Clay Batch'), { 'Load Config': LC, 'Fetch Accounts For Clay': clayIn, 'Add Enrich Stats': [] }, []);
const cNew = await run(src(NEW, 'Select Clay Batch'), { 'Load Config': LC, 'Fetch Accounts For Clay': clayIn, 'Add Enrich Stats': [] }, []);
check('Select Clay Batch: SMB queue identical', same(strip(cOld, TRACK_KEYS), strip(cNew, TRACK_KEYS)), [cOld.length, cNew.length]);

const cbNodes = (rows) => ({ 'Load Config': LC, 'Merge Clay Into Accounts': [], 'Fetch Qualified Accounts': rows, 'Fetch Seen Contacts': [], 'Fetch Contact Results': [] });
const cbIn = seOld.map(r => Object.assign({}, r, { contact_status: '' }));
const bOld = await run(src(OLD, 'Select Contact Batch'), cbNodes(cbIn), []), bNew = await run(src(NEW, 'Select Contact Batch'), cbNodes(cbIn), []);
check('Select Contact Batch: SMB queue identical', same(strip(bOld, TRACK_KEYS), strip(bNew, TRACK_KEYS)), [bOld.length, bNew.length]);

const seeds = [{ company_name: 'Seedco', domain: 'seed.co', status: 'new', employee_count: '12', timezone_utc_offset: '1' }];
const nsOld = await run(src(OLD, 'Normalize Seeds'), {}, seeds), nsNew = await run(src(NEW, 'Normalize Seeds'), {}, seeds);
check('Normalize Seeds: old seed rows unchanged, lead_track smb_direct', same(strip(nsOld, TRACK_KEYS), strip(nsNew, TRACK_KEYS)) && nsNew[0].lead_track === 'smb_direct' && nsNew[0].source === 'seed_accounts', nsNew[0]);

// ============ 2. Agency behaviour ============
// --- Partner Directories Source on the Phase 0 fixtures ---
const F = 'scripts/s15/fixtures/';
const read = (n) => fs.readFileSync(F + n, 'utf8');
const clayList = read('clay_list.html'), clayProfile = read('clay_profile.html'), n8nList = read('n8n_experts_list.html'), n8nProfile = read('n8n_experts_profile.html');
const slugsOf = (html) => [...html.matchAll(/"slug":(\d+)/g)].length;   // not used for logic; fixture sanity only
const urls = [];
const pdHttp = async ({ url }) => {
  urls.push(url);
  if (url === 'https://www.clay.com/en/experts?page=1') return clayList;
  if (url === 'https://experts.n8n.io/?page=1') return n8nList;
  if (url.endsWith('/en/experts/partner/cs2')) return clayProfile;
  if (url.endsWith('/partner/2v-automation')) return n8nProfile;
  if (/page=2/.test(url)) return '<html><script id="__NUXT_DATA__" type="application/json">[{"data":1},{}]</script></html>';
  throw new Error('404 ' + url);
};
// Every listed slug except the two fixture profiles is already "seen", so the run fetches exactly those two.
const nuxtSlugs = (html) => { const arr = JSON.parse(html.match(/id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)[1]); return arr.filter(v => typeof v === 'string' && /^[a-z0-9-]+$/.test(v)); };
const seenRows = [...new Set(nuxtSlugs(clayList).map(s => 'clay:' + s).concat(nuxtSlugs(n8nList).map(s => 'n8n:' + s)))]
  .filter(k => k !== 'clay:cs2' && k !== 'n8n:2v-automation').map(k => ({ profile_key: k }));
const pdCfg = JSON.parse(JSON.stringify(config)); pdCfg.sources.partner_directories.politeness_ms = 1000; pdCfg.sources.partner_directories.max_pages = 1;
pdCfg.sources.partner_directories.clay.max_pages = 1; pdCfg.sources.partner_directories.n8n.max_pages = 1;
const T = Date.now();
const pd = await run(src(NEW, 'Partner Directories Source'), { 'Load Config': [{ config: pdCfg }], 'Fetch Seen Profiles': seenRows }, [], pdHttp);
const pdRows = pd.filter(j => j.company_name);
const cs2 = pdRows.find(r => r.__profile_key === 'clay:cs2'), v2 = pdRows.find(r => r.__profile_key === 'n8n:2v-automation');
check('directories: listing and profile parsed from __NUXT_DATA__, seen slugs skipped', pdRows.length === 2 && cs2 && v2 && urls.filter(u => /partner/.test(u)).length === 2, { rows: pdRows.length, urls });
check('directories: normalized schema like YC (agency, gtm agency industry, unknown size)', cs2.company_type === 'agency' && /^gtm agency \| /.test(cs2.industry) && cs2.employee_count === null &&
  cs2.domain === 'cs2marketing.com' && cs2.lead_track === 'agency_partner' && cs2.source === 'clay_experts', cs2);
const m1 = JSON.parse(cs2.source_meta), m2 = JSON.parse(v2.source_meta);
check('directories: source_meta has tier, services, languages, pricing slugs, contact form', m1.tier === 'Studio' && m1.services.includes('AI Outbound') && m1.languages.includes('english') &&
  m1.pricing.includes('10k-a-month') && m1.contact_form === true && m1.profile_url === 'https://www.clay.com/en/experts/partner/cs2', m1);
check('directories: location to time zone (San Jose, CA = -8; n8n office list picks one inside the window)', cs2.timezone_utc_offset === -8 && cs2.country === 'United States' && v2.timezone_utc_offset === -5, [cs2.timezone_utc_offset, v2.timezone_utc_offset, v2.location_raw]);
check('directories: dated directory trigger (ADR-117)', /^Listed in the Clay experts directory \(Studio\): /.test(cs2.directory_trigger) && /^\d{4}-\d{2}-\d{2}$/.test(cs2.directory_trigger_date), cs2.directory_trigger);
check('directories: stats line in the YC format, politeness respected', /partner_directories stats: pages=2 listed=\d+ seen=\d+ tier_out=\d+ fetched=2/.test(pd.at(-1).__skipped) && Date.now() - T >= 3000, pd.at(-1));
const off = JSON.parse(JSON.stringify(config)); off.sources.partner_directories.enabled = false;
check('directories: off by config is a skip marker', (await run(src(NEW, 'Partner Directories Source'), { 'Load Config': [{ config: off }], 'Fetch Seen Profiles': [] }, []))[0].__skipped === 'partner_directories disabled by config');

// --- Process Accounts: agency filters and score ---
const ag = (name, metaO, o) => Object.assign({ source: 'clay_experts', company_name: name, domain: name + '.agency', website: 'https://' + name + '.agency',
  industry: 'gtm agency | crm enrichment - hubspot, ai outbound', company_type: 'agency', employee_count: null, location_raw: 'London, UK', country: 'United Kingdom',
  timezone_utc_offset: 0, funding_stage: 'unknown', description_text: 'We build Clay and HubSpot workflows for B2B teams. Ongoing client work. Services: CRM Enrichment - Hubspot, AI Outbound.',
  status: 'new', lead_track: 'agency_partner', directory_trigger: 'Listed in the Clay experts directory (Studio): CRM Enrichment - Hubspot', directory_trigger_date: '2026-11-15',
  source_meta: JSON.stringify(Object.assign({ directory: 'clay', slug: name, tier: 'Studio', services: ['CRM Enrichment - Hubspot', 'AI Outbound'], languages: ['english'],
    pricing: ['5k-a-month'], reviews: 4, availability: true, contact_form: true, profile_url: 'https://www.clay.com/en/experts/partner/' + name }, metaO)) }, o);
const agIn = [ag('good'), ag('elite', { tier: 'Elite Studio' }), ag('pricey', { pricing: ['10k-a-month'] }), ag('french', { languages: ['french'] }),
  ag('big', {}, { employee_count: 80 }), ag('far', {}, { timezone_utc_offset: -8 }), ag('east', {}, { timezone_utc_offset: -5 }),
  ag('nostack', {}, { industry: 'gtm agency | branding', description_text: 'We design logos and brand books.' })];
const paA = (await run(src(NEW, 'Process Accounts'), paNodes(agIn.concat(smbIn)), []))[0];
const byName = Object.fromEntries(paA.accounts.map(a => [a.company_name, a]));
const R = paA.stats.rejected;
check('agency filters: tier, pricing, language, size, time window, stack each rejected and counted',
  R.agency_tier === 1 && R.agency_pricing === 1 && R.agency_language === 1 && R.agency_size === 1 && R.agency_stack_miss === 1 && R.timezone >= 1 && !byName.far, R);
check('agency filters: D1 window lets US East (-5) in, smb rows keep the SMB window', !!byName.east && !paA.accounts.find(a => a.company_name === 'gamma'), Object.keys(byName));
const g = byName.good;
check('agency score: breakdown and formula, lead_track, source_meta, directory trigger', g && /^track=agency_partner; stack=\d+; capacity=\d+; size=\d+; tz_lang=\d+$/.test(g.score_breakdown) &&
  g.lead_track === 'agency_partner' && g.source_meta.includes('"tier":"Studio"') && g.clay_trigger_source === 'directory' && g.clay_trigger_date === '2026-11-15' && g.final_score >= 60, g);
check('agency score: unknown size allowed, below-min agencies counted', g.employee_count === '' && typeof paA.stats.below_min_score === 'number', g.employee_count);

// --- Score Enriched + Rescore on an agency row ---
const gRow = Object.assign({}, g);
const seA = (await run(src(NEW, 'Score Enriched'), { 'Load Config': LC, 'Select Pending Accounts': [gRow] }, [page()]))[0];
const cap0 = Number(g.score_breakdown.match(/capacity=(\d+)/)[1]);
check('Score Enriched: agency keeps its components, careers page adds 20 to capacity', /^track=agency_partner; stack=\d+; capacity=\d+; size=\d+; tz_lang=\d+; enrich=website:ok,stack:\d,hiring:1/.test(seA.score_breakdown) &&
  Number(seA.score_breakdown.match(/capacity=(\d+)/)[1]) === Math.min(100, cap0 + 20) && seA.enrichment_status === 'enriched' && /hiring page/.test(seA.why_match), seA.score_breakdown);
const rqA = Object.assign({}, seA, { contact_status: 'queued' });
const reA = (await run(src(NEW, 'Rescore Accounts'), reNodes, [{ contact_id: 'c1', account_id: rqA.account_id, contact_score: 90 }, { __row_type: 'stats', stats: { all_qualified: [rqA] } }]))[0];
check('Rescore Accounts: agency formula with feasibility', /; feasibility=90$/.test(reA.score_breakdown) && reA.status === 'contact_found' && reA.score_breakdown.startsWith('track=agency_partner'), reA.score_breakdown);

// --- Clay and contact batches ---
const clayA = await run(src(NEW, 'Select Clay Batch'), { 'Load Config': LC, 'Fetch Accounts For Clay': [Object.assign({}, seA, { clay_status: '', final_score: 90 })], 'Add Enrich Stats': [] }, []);
check('Select Clay Batch: agency rows never queued for Clay research (ADR-118)', clayA.filter(j => j.account_id).length === 0, clayA);
const cbA = await run(src(NEW, 'Select Contact Batch'), cbNodes([Object.assign({}, seA, { contact_status: '', final_score: 62 })]), []);
check('Select Contact Batch: agency uses its own minimum (60, not 65)', cbA.filter(j => j.account_id).length === 1, cbA.map(j => j.account_id));

// --- Select Outreach Pairs: directory trigger, small team, contact_form ---
const acctA = Object.assign({}, reA, { contact_status: 'contacts_done', final_score: 62, employee_count: 4, run_date: new Date().toISOString() });
const contact = (o) => Object.assign({ contact_id: 'ct_a', account_id: acctA.account_id, status: 'new', contact_score: 85, title: 'Founder', full_name: 'Ada Lane',
  email: '', email_status: '', linkedin_url: '', run_date: new Date(Date.now() - 5 * 86400e3).toISOString(), source: 'tavily' }, o);
const spNodes = (accts, cts) => ({ 'Load Config': LC, 'Rescore Accounts': [], 'Fetch Outreach Blocks': [], 'Fetch Outreach Queue': [], 'Fetch Accounts For Outreach': accts, 'Fetch Contacts For Outreach': cts });
let sp = (await run(src(NEW, 'Select Outreach Pairs'), spNodes([acctA], [contact()]), [])).filter(j => j.outreach_pair);
check('pairs: directory listing is a valid trigger, small-team gate skipped, contact_form channel', sp.length === 1 && sp[0].trigger_ok === true && sp[0].channel === 'contact_form' &&
  sp[0].lead_track === 'agency_partner' && sp[0].hiring_signal === true && JSON.parse(sp[0].source_meta).profile_url, sp[0]);
const smbSmall = Object.assign({}, acctA, { lead_track: 'smb_direct', source_meta: '', account_id: 'acc_smb_small', clay_trigger_source: 'directory', final_score: 70 });
sp = (await run(src(NEW, 'Select Outreach Pairs'), spNodes([smbSmall], [contact({ account_id: 'acc_smb_small', linkedin_url: 'https://linkedin.com/in/x' })]), []));
check('pairs: an SMB row cannot use a directory trigger (small team still gated)', sp.filter(j => j.outreach_pair).length === 0 && sp.at(-1).stats.outreach.skipped_small_no_trigger === 1, sp.at(-1).stats.outreach);

// --- Draft Outreach: agency drafting ---
const pairA = (await run(src(NEW, 'Select Outreach Pairs'), spNodes([acctA], [contact({ email: 'ada@good-agency.example.com', email_status: 'verified' })]), [])).find(j => j.outreach_pair);
const SITE = '<html><head><title>Good Agency</title><meta name="description" content="Good Agency builds Clay enrichment and HubSpot CRM workflows for B2B clients across Europe."></head>' +
  '<body><a>Contact</a><script src="https://js.hs-scripts.com/1.js"></script></body></html>';
const prompts = [];
const agDraft = (o) => Object.assign({ angle: 'x', trigger: 'none', pain_point: 'Client build work may come in waves.', value_proposition: 'One small scoped task from a client project.',
  email_subject: 'Extra capacity for Good client builds',
  first_line: 'Good Agency is listed in the Clay experts directory for CRM Enrichment with HubSpot, so I am curious whether client builds ever pile up at once.',
  body_rest: 'I built an n8n and Clay outbound engine with deterministic gates and HubSpot sync. I could take one small scoped task from a client project, such as a HubSpot enrichment build, delivered under your brand so you can judge the work.',
  follow_up_1: 'Ada, one concrete option: a single HubSpot enrichment task from a current client, under your brand. Worth a look?',
  follow_up_2: 'Ada, I can send a short Loom of a recent build so you can judge the quality.',
  follow_up_3: 'Ada, closing the loop here.',
  linkedin_note: 'Hi Ada, I build Clay and HubSpot workflows and take scoped tasks from agency client work under your brand. Open to one small first task?' }, o);
let callsA = 0;
const agHttp = async (opts) => {
  if (opts.method === 'GET') return { statusCode: 200, headers: {}, body: SITE };
  callsA++;
  prompts.push(opts.body.messages[1].content);
  const repaired = /REJECTED FOR/.test(opts.body.messages[1].content);
  const d = repaired ? agDraft() : agDraft({ body_rest: 'I have 5 years of experience as a senior expert in automation and can help your team move faster with better systems overall, at any scale you need for client projects.' });
  return { statusCode: 200, headers: {}, body: { choices: [{ message: { content: JSON.stringify(d) } }] } };
};
const cfgD = JSON.parse(JSON.stringify(config)); cfgD.outreach.llm = { chain: ['groq', 'template'], politeness_ms: 0, max_wait_s: 0 };
const dA = (await run(src(NEW, 'Draft Outreach'), { 'Load Config': [{ config: cfgD }] }, [pairA], agHttp, { GROQ_API_KEY: 'k' }))[0];
check('agency draft: no product-overlap gate, drafted pending after one repair', dA.approval_status === 'pending' && callsA === 2 && /seniority_claim/.test(dA.risk_notes) && dA.lead_track === 'agency_partner', [dA.approval_status, dA.llm_provider, dA.risk_notes]);
check('agency draft: careers page means angle hire_bridge; directory trigger stored', dA.angle === 'hire_bridge' && /^Listed in the Clay experts directory/.test(dA.trigger) && /track=agency_partner/.test(dA.risk_notes), [dA.angle, dA.trigger]);
check('agency draft: prompt carries TRACK, THEIR_SERVICES, AGENCY_RULES and service tools', /^TRACK: agency_partner\./m.test(prompts[0]) && /^THEIR_SERVICES: CRM Enrichment - Hubspot, AI Outbound$/m.test(prompts[0]) && /^ALLOWED_COMPANY_TOOLS: hubspot$/m.test(prompts[0]), prompts[0].split('\n').filter(l => /TRACK|SERVICES|ALLOWED/.test(l)));
check('agency draft: track CTA and proof point, signature link added after validation', dA.cta === config.lead_tracks.agency_partner.cta && dA.proof_point === config.lead_tracks.agency_partner.proof_points[0] &&
  dA.message_draft.endsWith('\n' + config.outreach.signature_link), dA.message_draft.slice(-160));
const noSvc = async (opts) => {
  if (opts.method === 'GET') return { statusCode: 200, headers: {}, body: SITE };
  return { statusCode: 200, headers: {}, body: { choices: [{ message: { content: JSON.stringify(agDraft({ first_line: 'Good Agency came up while I was looking at agencies, so I am curious whether client builds ever pile up at once.', body_rest: 'I built an n8n and Clay outbound engine with deterministic gates and HubSpot sync. I can help your team with automation work whenever you need more hands for client delivery.', value_proposition: 'More hands for delivery.' })) } }] } };
};
const dB = (await run(src(NEW, 'Draft Outreach'), { 'Load Config': [{ config: cfgD }] }, [pairA], noSvc, { GROQ_API_KEY: 'k' }))[0];
check('agency validator v3: no service named and no small first task means needs_redraft', dB.approval_status === 'needs_redraft' && /agency_no_service/.test(dB.risk_notes) && /agency_no_small_task/.test(dB.risk_notes), dB.risk_notes);
const pairCF = (await run(src(NEW, 'Select Outreach Pairs'), spNodes([acctA], [contact()]), [])).find(j => j.outreach_pair);
const dC = (await run(src(NEW, 'Draft Outreach'), { 'Load Config': [{ config: cfgD }] }, [pairCF], agHttp, { GROQ_API_KEY: 'k' }))[0];
check('agency draft: contact_form channel puts the profile link in notes', dC.channel === 'contact_form' && dC.notes.startsWith('Contact form: https://www.clay.com/en/experts/partner/good'), dC.notes);
const pairS = Object.assign({}, pairA, { hiring_signal: false });
const dS = (await run(src(NEW, 'Draft Outreach'), { 'Load Config': [{ config: cfgD }] }, [pairS], agHttp, { GROQ_API_KEY: 'k' }))[0];
check('agency draft: no hiring signal and a HubSpot service means angle stack_specific_help', dS.angle === 'stack_specific_help' && /^listed services: CRM Enrichment - Hubspot/.test(dS.angle_basis), [dS.angle, dS.angle_basis]);
const pairW = Object.assign({}, pairA, { hiring_signal: false, industry: 'gtm agency | ai outbound', source_meta: JSON.stringify(Object.assign(JSON.parse(pairA.source_meta), { services: ['AI Outbound'] })) });
const dW = (await run(src(NEW, 'Draft Outreach'), { 'Load Config': [{ config: cfgD }] }, [pairW], agHttp, { GROQ_API_KEY: 'k' }))[0];
check('agency draft: services outside my stack means angle white_label_overflow', dW.angle === 'white_label_overflow' && /Clay experts directory as a Studio partner/.test(dW.angle_basis), [dW.angle, dW.angle_basis]);
check('no em dash in agency drafts', ![dA, dB, dC].some(r => /—/.test(r.message_draft)));

console.log(failed ? `${failed} check(s) failed` : 'All checks passed');
process.exit(failed ? 1 : 0);
