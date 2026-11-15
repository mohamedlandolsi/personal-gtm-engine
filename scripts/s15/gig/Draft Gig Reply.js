// Draft Gig Reply (Code node, Run Once for All Items). Sprint 15.
// Drafts a short reply for each post from Select Gigs to Draft, validated by fixed rules (gig validator), one repair
// retry per provider, then needs_redraft. The LLM router section is copied verbatim from Draft Outreach (ADR-115):
// keep both in sync until an LLM Router sub-workflow exists. Nothing is sent: drafts go to the review console.
const cfg = $('Load Config').first().json.config || {};
const O = cfg.outreach || {};
const L = O.llm || {};

// ---------- settings (all overridable from config.outreach.llm) ----------
const T0 = Date.now();
const TIMEOUT = Math.max(5000, Number(L.timeout_ms || 40000));
const TEMP = Number(L.temperature ?? 0.3);
const PACE_MS = Math.max(0, Number(L.politeness_ms ?? 6000));          // pause between drafts
const MAX_OUT = Math.max(600, Number(L.max_output_tokens || 1500));    // includes reasoning tokens
const MAX_WAIT_S = Math.max(0, Number(L.max_wait_s ?? 20));            // longest single wait on a 429
let WAIT_BUDGET_MS = Math.max(0, Number(L.wait_budget_ms ?? 90000));   // total 429 waiting per run
const RUN_BUDGET_MS = Math.max(60000, Number(L.run_budget_ms || 240000)); // stay under the Code node time limit
const SITE = Object.assign({ enabled: true, timeout_ms: 8000 }, O.site_facts || {});

const SENDER = String(O.sender_name || 'Mohamed');
const CTA = String(O.cta || 'Open to a 2-minute workflow example relevant to your stack?');
const PROOFS = (O.proof_points && O.proof_points.length) ? O.proof_points : ['Built a federated B2B GTM SaaS platform with FastAPI, Supabase and LLM routing'];
const WATCH = (O.tool_watchlist || ['hubspot','salesforce','pipedrive','shopify','stripe','intercom','calendly','google analytics','zapier','slack','mixpanel','snowflake','zendesk','marketo','salesloft','airtable']).map(s => String(s).toLowerCase());
const W = { total: [Number((O.words || {}).min || 70), Number((O.words || {}).max || 120)], note: [20, 40] };
const NOTES_MAX = 600;   // risk_notes length. Sprint 14 adds 5 flags, so the cap went from 450 to 600 to keep the llm_errors readable.

const sleep = ms => new Promise(r => setTimeout(r, ms));
const wc = s => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const norm = s => String(s == null ? '' : s).replace(/[‐‑‒–]/g, '-').replace(/\s*—\s*/g, ' - ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+\n/g, '\n').replace(/[ ]{2,}/g, ' ').trim();
const has = (hay, needle) => new RegExp('(^|[^a-z0-9])' + needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)', 'i').test(hay);

// ---------- provider registry ----------
// Every provider except Gemini speaks the OpenAI chat format, so adding one is a line of config, not new code.
const PRESETS = {
  groq:       { kind: 'openai', url: 'https://api.groq.com/openai/v1/chat/completions', key: 'GROQ_API_KEY',       model: L.groq_model || 'openai/gpt-oss-120b' },
  mistral:    { kind: 'openai', url: 'https://api.mistral.ai/v1/chat/completions',      key: 'MISTRAL_API_KEY',    model: L.mistral_model || 'mistral-small-latest' },
  cerebras:   { kind: 'openai', url: 'https://api.cerebras.ai/v1/chat/completions',     key: 'CEREBRAS_API_KEY',   model: L.cerebras_model || 'gpt-oss-120b' },
  openrouter: { kind: 'openai', url: 'https://openrouter.ai/api/v1/chat/completions',   key: 'OPENROUTER_API_KEY', model: L.openrouter_model || '' },
  gemini:     { kind: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta/models/', key: 'GEMINI_API_KEY', model: L.gemini_model || 'gemini-3.8-flash' }
};
// Optional extra providers from config: outreach.llm.providers = { "name": { "url": "...", "key_env": "NAME_API_KEY", "model": "..." } }
for (const [name, p] of Object.entries(L.providers || {})) {
  if (p && p.url && p.key_env) PRESETS[String(name).toLowerCase()] = { kind: p.kind === 'gemini' ? 'gemini' : 'openai', url: String(p.url), key: String(p.key_env), model: String(p.model || '') };
}

// A chain entry is "provider" or "provider:model". The second form lets one key use two models,
// and each model has its own rate limit bucket.
const parseStep = (entry) => {
  const s = String(entry || '').trim();
  const i = s.indexOf(':');
  const name = (i === -1 ? s : s.slice(0, i)).toLowerCase();
  const preset = PRESETS[name];
  if (!preset) return { id: s, error: 'unknown' };
  const model = i === -1 ? preset.model : s.slice(i + 1).trim();
  if (!model) return { id: s, error: 'no_model' };
  return { id: i === -1 ? name : name + ':' + model, name, model, kind: preset.kind, url: preset.url, key: preset.key };
};
const CHAIN = (Array.isArray(L.chain) && L.chain.length ? L.chain : ['groq', 'gemini', 'template'])
  .filter(s => String(s).toLowerCase() !== 'template').map(parseStep);

// Per-model extras that cut token use. If a provider rejects them (HTTP 400), the call is retried once without them.
const extrasFor = (step) => {
  const m = step.model.toLowerCase();
  const x = {};
  if (step.name === 'mistral') x.max_tokens = MAX_OUT; else x.max_completion_tokens = MAX_OUT;
  if (m.includes('gpt-oss')) { x.reasoning_effort = 'low'; if (step.name === 'groq') x.include_reasoning = false; }
  else if (m.includes('qwen')) { x.reasoning_effort = 'low'; if (step.name === 'groq') x.reasoning_format = 'hidden'; }
  return x;
};

// One HTTP call that never throws. Returns { status, headers, body, err }.
const http = async (opts) => {
  try {
    const res = await this.helpers.httpRequest(Object.assign({ json: true, timeout: TIMEOUT, returnFullResponse: true, ignoreHttpStatusErrors: true }, opts));
    if (res && typeof res === 'object' && ('statusCode' in res || 'status' in res) && 'body' in res) {
      let body = res.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { /* keep text */ } }
      return { status: Number(res.statusCode || res.status || 0), headers: res.headers || {}, body, err: '' };
    }
    return { status: 200, headers: {}, body: res, err: '' };   // helper returned the body directly
  } catch (e) {
    const msg = String((e && e.message) || e);
    const m = msg.match(/status code (\d{3})/i);
    const r = (e && e.response) || {};
    return { status: m ? Number(m[1]) : Number(r.status || e.httpCode || 0), headers: r.headers || {}, body: r.data || r.body || null, err: msg };
  }
};
const header = (h, name) => { const k = Object.keys(h || {}).find(x => x.toLowerCase() === name); return k ? h[k] : undefined; };
const errText = (body) => {
  if (!body) return '';
  if (typeof body === 'string') return body.slice(0, 120);
  const e = body.error || body;
  return String((e && (e.message || e.code || e.status)) || '').slice(0, 120);
};
// Seconds to wait after a 429: the retry-after header, else "try again in 7.6s" from the message, else 30.
const retryAfter = (r) => {
  const h = Number(header(r.headers, 'retry-after'));
  if (Number.isFinite(h) && h > 0) return h;
  const m = (errText(r.body) + ' ' + r.err).match(/(?:try again|retry) in\s+(?:(\d+)m)?\s*([\d.]+)\s*s/i);
  if (m) return Number(m[1] || 0) * 60 + Number(m[2]);
  return 30;
};

const parseJSON = text => {
  const t = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s === -1 || e <= s) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch (err) { return null; }
};

const noExtras = {};   // step id -> true once a provider has rejected the extras
const callStep = async (step, system, user) => {
  const KEY = $env[step.key];
  if (step.kind === 'gemini') {
    const r = await http({ method: 'POST', url: step.url + step.model + ':generateContent',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
      body: { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }],
              generationConfig: { temperature: TEMP, responseMimeType: 'application/json' } } });
    if (r.status === 200) r.text = (((r.body || {}).candidates || [])[0]?.content?.parts || []).map(x => x.text || '').join('');
    return r;
  }
  const base = { model: step.model, temperature: TEMP, response_format: { type: 'json_object' },
                 messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
  const send = (body) => http({ method: 'POST', url: step.url, headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body });
  let r = await send(noExtras[step.id] ? base : Object.assign({}, base, extrasFor(step)));
  if (r.status === 400 && !noExtras[step.id]) { noExtras[step.id] = true; r = await send(base); r.retried_plain = true; }
  if (r.status === 200) r.text = ((r.body || {}).choices || [])[0]?.message?.content;
  return r;
};

// ================= gig drafting (Sprint 15) =================
// Everything above this line is the Draft Outreach router, copied by scripts/s15/gig/build.mjs (ADR-115).
const G = cfg.gig || {};
const GT = (cfg.lead_tracks || {}).gig_post || {};
const GW = [Number((G.reply_words || {}).min || 60), Number((G.reply_words || {}).max || 130)];
const MY_STACK = (G.my_stack || []).map(String).filter(Boolean);
const LINKS = (G.portfolio_links || []).map(String).filter(u => /^https?:\/\//.test(u));
const GPROOFS = (GT.proof_points && GT.proof_points.length ? GT.proof_points : PROOFS).map(String);
const OFFERS = (Array.isArray(cfg.offers) ? cfg.offers : []).filter(o => o && o.id && o.label);
const PING_MIN = Number(G.discord_ping_min_score ?? 75);
const CONSOLE = String(G.console_url || (cfg.digest || {}).console_url || '').replace(/\/+$/, '');
const PLATFORM_LABEL = { n8n_forum: 'n8n community forum', make_forum: 'Make community forum', hn_freelancer: 'Hacker News', manual: 'job post' };

const posts = $input.all().map(i => i.json).filter(r => r && r.post_key);
const gstats = { candidates: posts.length, drafted: 0, pending: 0, needs_redraft: 0, llm_calls: 0, llm_failures: 0, ping_eligible: 0 };
if (!posts.length) return [{ json: { __row_type: 'stats', __stats: gstats } }];

// Tools a reply might name. A tool is allowed when it is in gig.my_stack or the post itself names it.
const TOOLS = ['n8n', 'zapier', 'make.com', 'integromat', 'clay', 'hubspot', 'salesforce', 'pipedrive', 'apollo', 'airtable',
  'notion', 'google sheets', 'supabase', 'postgres', 'neon', 'python', 'javascript', 'typescript', 'node.js', 'next.js', 'fastapi',
  'openai', 'chatgpt', 'claude', 'gemini', 'langchain', 'retool', 'bubble', 'webflow', 'shopify', 'stripe', 'slack', 'twilio',
  'instantly', 'lemlist', 'smartlead', 'phantombuster', 'apify', 'tavily', 'zoho', 'monday.com', 'clickup', 'asana', 'jira',
  'mailchimp', 'activecampaign', 'klaviyo', 'gohighlevel', 'power automate', 'pabbly', 'firebase', 'mongodb', 'mysql', 'aws',
  'docker', 'vapi', 'retell', 'elevenlabs', 'whatsapp', 'telegram', 'outreach.io', 'salesloft', 'close.com', 'attio', 'brevo'];
const toolsIn = (s) => TOOLS.filter(t => has(s, t));
const STOP = new Set(('about after again also because before being below build built could doing every first from going having ' +
  'hello here help looking might more most need needed needs other ours please project projects should simple someone something ' +
  'their there these thing things those thanks through today using want wanted where which while would yours anyone experience ' +
  'freelancer developer expert hiring paid budget')
  .split(' '));
const postTerms = (p) => {
  const text = p.title + ' ' + p.body_text;
  const tools = new Set(toolsIn(text).concat(MY_STACK.filter(t => has(text, t)).map(t => t.toLowerCase())));
  const words = (String(p.title).toLowerCase().match(/[a-z][a-z0-9-]{4,}/g) || []).filter(w => !STOP.has(w));
  return [...new Set([...tools, ...words])].slice(0, 12);
};
const pickOffer = (p) => {
  const text = (p.title + ' ' + p.body_text).toLowerCase();
  let best = null, bestN = 0;
  for (const o of OFFERS) {
    if (o.id === 'white_label_overflow' && !/agency|white[- ]label|our clients|subcontract/.test(text)) continue;
    const kws = Array.isArray(o.match) && o.match.length ? o.match : String(o.id).split('_');
    const n = kws.filter(k => has(text, String(k))).length;
    if (n > bestN) { best = o; bestN = n; }
  }
  return best || OFFERS.find(o => o.id === 'n8n_fix_build') || OFFERS[0] || { id: 'n8n_fix_build', label: 'Fix or build one n8n workflow, fixed scope' };
};
const channelFor = (p) => p.contact_email ? 'email' : (p.contact_hint === 'dm_invited' ? 'forum_dm' : 'forum_reply');

const SYSTEM_G = [
  'You write a short first reply to a public job post, or a short email to the person who posted it.',
  'You write as ' + SENDER + ', an entry-level GTM and automation builder with real projects but no long track record. Be honest about that.',
  'Return ONLY a JSON object: {"reply": "...", "email_subject": "..."}.',
  'Rules for "reply":',
  '- ' + GW[0] + ' to ' + GW[1] + ' words. Plain text, short paragraphs, no markdown, no bullet lists, no links, no sign-off (code adds the name and links).',
  '- Greet the poster by first name if POSTER gives one, else "Hi". The first sentence restates their concrete problem in their own words.',
  '- Name at least two specific things from the post: their tools, data, systems or steps (see POST_TERMS).',
  '- Name only tools that are in ALLOWED_TOOLS.',
  '- Use one proof point from PROOF_POINTS, said plainly. Never claim years of experience, seniority, "expert in", client counts or results that are not in PROOF_POINTS.',
  '- Only use numbers that appear in the post or in PROOF_POINTS (you may say "15-minute call" or "2-minute Loom").',
  '- Offer OFFER as a small, fixed-scope first step.',
  '- Never mention prices, rates, fees, hourly amounts or money.',
  '- End with exactly one concrete next step: a small paid trial task, a short Loom of how you would approach it, or a 15-minute call.',
  '- No em dashes, no exclamation marks, no flattery, no "I hope this finds you well".',
  'Rules for "email_subject": 3 to 8 words, specific to the post, no clickbait, no money.'
].join('\n');

const userGig = (p, offer) => {
  const allowed = [...new Set(MY_STACK.concat(toolsIn(p.title + ' ' + p.body_text)))];
  const rules = p.platform === 'n8n_forum' || p.platform === 'make_forum'
    ? 'This answer goes to a community forum: a public reply in the thread, or a direct message only because the post invites one. Keep it useful to the poster, not an advert.'
    : 'This answer goes to the poster directly.';
  return [
    'PLATFORM: ' + (PLATFORM_LABEL[p.platform] || p.platform) + '. ' + rules,
    'CHANNEL: ' + p.__channel,
    'POSTER: ' + (p.poster || 'unknown') + (p.poster_company ? ' at ' + p.poster_company : ''),
    'POST_TITLE: ' + p.title,
    'POST_TEXT: ' + String(p.body_text || '').slice(0, 1800),
    'POST_TERMS: ' + postTerms(p).join(', '),
    'MATCHED_STACK: ' + (p.matched_stack || 'none'),
    'ALLOWED_TOOLS: ' + allowed.join(', '),
    'PROOF_POINTS: ' + GPROOFS.slice(0, 3).join(' | '),
    'OFFER: ' + offer.label
  ].join('\n');
};

const SENIOR = /\b\d+\+?\s*(years?|yrs)\b|\bsenior\b|\bexpert in\b|\bmany clients\b|\bdozens of\b|\bhundreds of\b|\bseasoned\b|\bveteran\b|\bworld[- ]class\b/i;
const MONEY = /[$€£]\s?\d|\b\d[\d,.]*\s?(usd|eur|gbp|dollars?|euros?)\b|\b\d[\d,.]*\s?(\/|per)\s?(hour|hr|h)\b|\bhourly (rate|fee|pay)\b|\bpric(e|es|ing)\b|\bfees?\b|\binvoice\b|\bdiscount\b/i;   // 'hourly sync' is not money
const NEXT = /paid trial|trial task|small paid|\bloom\b|15[- ]minute call|quick call|short call/i;
const LINKISH = /https?:\/\/|www\./i;
const nums = s => (String(s).match(/\d+(?:[.,]\d+)?/g) || []);
const validateGig = (p, d) => {
  const bad = [];
  const r = norm((d && d.reply) || '');
  const n = wc(r);
  if (n < GW[0] || n > GW[1]) bad.push('words_' + n);
  const terms = postTerms(p);
  const hit = terms.filter(t => has(r, t));
  if (hit.length < Math.min(2, terms.length)) bad.push('specific_' + hit.length);
  const allowed = new Set(MY_STACK.map(s => s.toLowerCase()).concat(toolsIn(p.title + ' ' + p.body_text)));
  const foreign = toolsIn(r).filter(t => !allowed.has(t));
  if (foreign.length) bad.push('tool_not_in_stack:' + foreign.slice(0, 3).join('+'));
  if (SENIOR.test(r)) bad.push('seniority_claim');
  const okNums = new Set(nums(p.title + ' ' + p.body_text + ' ' + GPROOFS.join(' ')).concat(['15', '2', '1']));
  const invented = nums(r).filter(x => !okNums.has(x));
  if (invented.length) bad.push('invented_number:' + invented.slice(0, 3).join('+'));
  if (LINKISH.test(r)) bad.push('llm_link');
  if (!NEXT.test(r.slice(-220))) bad.push('no_next_step');
  if (MONEY.test(r) || MONEY.test((d && d.email_subject) || '')) bad.push('money');
  if (/!/.test(r)) bad.push('exclamation');
  if (p.__channel === 'email') { const s = wc(norm((d && d.email_subject) || '')); if (s < 2 || s > 10) bad.push('subject_words'); }
  return bad;
};
const hintsGig = (p, bad) => bad.map(b =>
  b.startsWith('words_') ? ' Write ' + GW[0] + ' to ' + GW[1] + ' words in "reply".' :
  b.startsWith('specific_') ? ' Name at least two of: ' + postTerms(p).slice(0, 6).join(', ') + '.' :
  b.startsWith('tool_not_in_stack') ? ' Remove tools that are not in ALLOWED_TOOLS.' :
  b === 'seniority_claim' ? ' Remove any claim of years, seniority, expertise or client counts.' :
  b.startsWith('invented_number') ? ' Remove numbers that are not in the post or the proof points.' :
  b === 'llm_link' ? ' Remove all links.' :
  b === 'no_next_step' ? ' End with one next step: a small paid trial task, a short Loom of the approach, or a 15-minute call.' :
  b === 'money' ? ' Remove every price, rate or fee.' :
  b === 'exclamation' ? ' No exclamation marks.' :
  b === 'subject_words' ? ' "email_subject" must be 3 to 8 words.' : '').join('');

const templateGig = (p, offer) => {
  const first = (String(p.poster || '').split(/[\s._-]+/)[0] || '').replace(/[^A-Za-z]/g, '');
  const tools = String(p.matched_stack || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 2);
  const reply = [
    (first ? 'Hi ' + first + ',' : 'Hi,') + ' I read your post about ' + String(p.title).replace(/[.?!]+$/, '') + '.',
    'I build ' + (tools.length ? tools.join(' and ') : 'automation') + ' workflows. One example: ' + GPROOFS[0].replace(/\.$/, '') + '.',
    'A good first step could be this: ' + offer.label.charAt(0).toLowerCase() + offer.label.slice(1) + ', limited to the part you described.',
    'I can start with a small paid trial task, or send a short Loom of how I would approach it.'
  ].join(' ');
  return { reply, email_subject: String(p.title).slice(0, 60) };
};

// ---------- run ----------
const cooldown = {};
const hardFails = {};
const out = [];
let firstCall = true;

for (let pi = 0; pi < posts.length; pi++) {
  const p = posts[pi];
  if (Date.now() - T0 > RUN_BUDGET_MS) { gstats.left_for_next_run = posts.length - pi; break; }
  p.title = String(p.title || ''); p.body_text = String(p.body_text || '');
  p.__channel = channelFor(p);
  const offer = pickOffer(p);
  if (!firstCall) await sleep(PACE_MS);
  firstCall = false;

  let d = null, provider = 'template', calls = 0, fails = 0;
  const errs = [];
  for (const step of CHAIN) {
    if (step.error) { errs.push(step.id + ':' + step.error); continue; }
    if (!$env[step.key]) { errs.push(step.id + ':key_missing'); fails++; continue; }
    if (cooldown[step.id] && Date.now() < cooldown[step.id]) { errs.push(step.id + ':cooling_down'); continue; }
    let repair = '', waits = 0, transient = 0;
    for (let attempt = 0; attempt < 4 && !d; attempt++) {
      calls++;
      const r = await callStep(step, SYSTEM_G, userGig(p, offer) + repair);
      if (r.retried_plain) errs.push(step.id + ':extras_rejected_retried_plain');
      if (r.status === 200) {
        hardFails[step.id] = 0;
        const j = parseJSON(r.text);
        const bad = j ? validateGig(p, j) : ['unparseable_json'];
        if (!bad.length) { d = j; provider = step.id; break; }
        fails++; errs.push(step.id + ':invalid:' + bad.join('|').slice(0, 80));
        if (repair) break;                                   // one repair attempt per provider
        repair = '\n\nYOUR PREVIOUS ANSWER WAS REJECTED FOR: ' + bad.join('|') + '.' + hintsGig(p, bad) + ' Return the full JSON again with these problems fixed.';
        continue;
      }
      fails++;
      if (r.status === 429) {
        const wait = retryAfter(r);
        const waitMs = Math.ceil(wait * 1000) + 500;
        if (wait <= MAX_WAIT_S && waits < 2 && waitMs <= WAIT_BUDGET_MS) {
          errs.push(step.id + ':429_waited_' + Math.ceil(wait) + 's');
          WAIT_BUDGET_MS -= waitMs; waits++;
          await sleep(waitMs);
          continue;
        }
        cooldown[step.id] = Date.now() + Math.min(wait, 300) * 1000;
        errs.push(step.id + ':429_cooldown_' + Math.ceil(Math.min(wait, 300)) + 's');
        break;
      }
      if ([400, 401, 403, 404].includes(r.status)) {
        cooldown[step.id] = Date.now() + 3600000;
        errs.push(step.id + ':http_' + r.status + ':' + (errText(r.body) || r.err).slice(0, 70));
        break;
      }
      errs.push(step.id + ':' + (r.status ? 'http_' + r.status : 'network') + ':' + (errText(r.body) || r.err).slice(0, 50));
      if (r.status >= 500 && transient < 1) { transient++; await sleep(3000); continue; }
      hardFails[step.id] = (hardFails[step.id] || 0) + 1;
      if (hardFails[step.id] >= 2) cooldown[step.id] = Date.now() + 120000;
      break;
    }
    if (d) break;
  }

  let status = 'pending';
  if (!d) { d = templateGig(p, offer); status = 'needs_redraft'; }
  const finalBad = validateGig(p, d);
  if (finalBad.length) { status = 'needs_redraft'; errs.push('final_invalid:' + finalBad.join('|')); }

  const reply = norm(d.reply);
  const sentences = reply.split(/(?<=[.?!])\s+/).filter(Boolean);
  // Links are added by code after validation, never by the LLM (plan: gig validator, links rule).
  const signature = '\n\n' + SENDER + (LINKS.length ? '\n' + LINKS.slice(0, 2).join('\n') : '');
  const posted = p.posted_at ? new Date(p.posted_at) : null;
  const ageH = posted && !isNaN(posted.getTime()) ? Math.max(0, Math.round((Date.now() - posted.getTime()) / 3600000)) : null;
  const outreachId = 'gig_' + String(p.post_key).replace(/[^a-z0-9]+/gi, '_') + '_' + Date.now().toString(36);
  const score = Number(p.gig_score || 0);
  const flags = ['track=gig_post', 'provider=' + provider, 'gig_score=' + score, 'channel=' + p.__channel, 'offer=' + offer.id,
    'matched=' + (String(p.matched_stack || '').replace(/,\s*/g, '+') || 'none'), 'intent=' + (p.intent || 'unclear')];
  if (provider === 'template') flags.push('template_review_hard');

  out.push({ json: {
    run_date: new Date().toISOString(),
    outreach_id: outreachId,
    account_id: 'gig:' + p.post_key, contact_id: 'gig:' + p.post_key,
    company_name: (p.poster_company || p.poster || PLATFORM_LABEL[p.platform] || 'gig post').slice(0, 120),
    contact_name: String(p.poster || '').slice(0, 120),
    channel: p.__channel, angle: 'gig_reply',
    trigger: (p.title + (posted && !isNaN(posted.getTime()) ? ' (posted ' + posted.toISOString().slice(0, 10) + ')' : '')).slice(0, 200),
    pain_point: p.title.slice(0, 200), value_proposition: offer.label, proof_point: GPROOFS[0] || '',
    cta: (sentences[sentences.length - 1] || '').slice(0, 200),
    email_subject: norm(d.email_subject || p.title).slice(0, 120), first_line: (sentences[0] || '').slice(0, 300),
    message_draft: reply + signature,
    follow_up_1: '', follow_up_2: '', follow_up_3: '', linkedin_note: '',
    risk_notes: (flags.join('; ') + (errs.length ? ' | llm_errors: ' + errs.join(' ; ') : '')).slice(0, NOTES_MAX),
    approval_status: status, reject_scope: '', send_status: 'not_sent', sent_at: '', reply_received: '',
    notes: ('Post: ' + p.url + (p.score_breakdown ? ' | ' + p.score_breakdown : '')).slice(0, 450),
    llm_provider: provider, llm_calls: calls, llm_failures: fails,
    angle_basis: ('gig post: ' + p.title).slice(0, 200), account_type: 'gig', product_category: '',
    lead_track: 'gig_post',
    // Not columns: gtm_insert_draft ignores them. Hot Gig Ping reads them (title, platform, age, score, link; no email, no body).
    __gig_score: score, __title: p.title.slice(0, 150), __platform: PLATFORM_LABEL[p.platform] || p.platform,
    __post_url: p.url, __age_h: ageH, __ping: score >= PING_MIN, __console_link: CONSOLE ? CONSOLE + '/gigs' : ''
  } });
  gstats.drafted++; gstats[status === 'pending' ? 'pending' : 'needs_redraft']++;
  gstats.llm_calls += calls; gstats.llm_failures += fails;
  if (score >= PING_MIN) gstats.ping_eligible++;
}

out.push({ json: { __row_type: 'stats', __stats: gstats } });
return out;
