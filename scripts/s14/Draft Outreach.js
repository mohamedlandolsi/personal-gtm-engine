const cfg = $('Load Config').first().json.config || {};
const O = cfg.outreach || {};
const L = O.llm || {};
const pairs = $input.all().map(i => i.json).filter(r => r && r.outreach_pair === true);
if (!pairs.length) return [];

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

// ---------- facts ----------
const displayName = p => {
  const raw = String(p.company_name || p.domain || '').trim();
  if (!/\./.test(raw)) return raw;
  const stem = String(p.domain || raw).split('.')[0];
  const m = String(p.clay_summary || '').match(new RegExp('\\b' + stem.replace(/[^a-z0-9]/gi, '') + '\\b', 'i'));
  return m ? m[0] : stem.charAt(0).toUpperCase() + stem.slice(1);
};
const firstName = p => String(p.full_name || '').trim().split(/\s+/)[0] || 'there';
// Sprint 14 (Fix 4): only tools the homepage really loads (script, embed or form host). Nothing from clay_summary or tech_stack.
// Analytics is left out: it is not a source of lead data.
const companyTools = p => (p.__tools || []).filter(t => t !== 'google_analytics').map(t => t.replace(/_/g, ' '));
const pickProof = p => {
  const r = String(p.role_category || '').toLowerCase() + ' ' + String(p.title || '').toLowerCase();
  if (/rev ?ops|operations|ops|growth|marketing|sales/.test(r)) return PROOFS[2] || PROOFS[0];
  if (/ceo|founder|cto/.test(r)) return PROOFS[1] || PROOFS[0];
  return PROOFS[0];
};

// ---------- what the company SELLS (so a draft never pitches a company its own product) ----------
// Fixed rules, no LLM: words that the company repeats when it describes itself are its product words
// ("commission" for a commission tool, "crm" for a CRM maker). My own vocabulary and filler words are ignored.
const TERM_STOP = new Set(('the and for with that this your our you their its from into are was has have can will all any more most one two new now get got use used using make made help helps build built team teams company companies business businesses customer customers client clients user users people ' +
  'software platform platforms tool tools solution solutions product products service services app apps suite system systems feature features ' +
  'sales marketing revenue growth b2b saas startup startups small modern best leading first open source free easy simple fast faster powerful smart full time save saves reduce reduces error errors work works way need needs every across within such including also than then them they about over ' +
  'data lead leads pipeline pipelines workflow workflows process processes manual manually target stated concrete detail observation relevant related site says').split(' '));
const TERM_STOP_PREFIX = ['automat', 'integrat', 'enrich', 'scor', 'rout', 'engineer', 'manag', 'sell', 'offer', 'provid', 'includ', 'describ'];
const stemWord = w => (w.length > 4 && /ies$/.test(w)) ? w.slice(0, -3) + 'y' : ((w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) ? w.slice(0, -1) : w);
const productTerms = (p) => {
  if (O.product_guard === false) return [];
  const text = (String(p.clay_summary || '').slice(0, 450) + ' ' + String(p.__site || '').slice(0, 420)).toLowerCase();
  const own = new Set((String(p.company_name || '') + ' ' + displayName(p) + ' ' + String(p.domain || '').split('.')[0]).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stemWord));
  const count = {};
  for (const raw of text.split(/[^a-z0-9]+/)) {
    const w = stemWord(raw);
    if (w.length < 3 || /^\d+$/.test(w) || TERM_STOP.has(w) || TERM_STOP.has(raw) || own.has(w) || WATCH.includes(w)) continue;
    if (w.length >= 4 && [...own].some(n => n.startsWith(w) || w.startsWith(n) && n.length >= 4)) continue;   // "palette" for PaletteHQ
    if (TERM_STOP_PREFIX.some(x => w.startsWith(x))) continue;
    count[w] = (count[w] || 0) + 1;
  }
  return Object.keys(count).filter(w => count[w] >= 2).sort((a, b) => count[b] - count[a] || a.localeCompare(b)).slice(0, 3);
};
const termRe = t => new RegExp('(^|[^a-z0-9])' + t.replace(/y$/, '(?:y|ie)') + "(?:s|es|'s)?([^a-z0-9]|$)", 'i');   // terms are a-z0-9 only
const smallTeam = p => { const n = Number(p.employee_count); return Number.isFinite(n) && n > 0 && n <= 20; };

// ---------- Sprint 14: tool signatures (guide 3.1) and the classify / angle rules (guide 4.1), copied from the guide ----------
// Fix 4: a tool counts only when its script, embed or form endpoint is on the page (real usage).
// Words such as "HubSpot" in text, logos or integration lists do not count.
// Keep this list identical in Score Enriched and Draft Outreach.
const TECH = [
  ['hubspot',          /js\.hs-scripts\.com|js\.hsforms\.net|js\.hs-analytics\.net|js\.hs-banner\.com|js\.usemessages\.com/i],
  ['salesforce',       /pi\.pardot\.com|go\.pardot\.com|webto(?:lead|case)\.salesforce\.com/i],
  ['pipedrive',        /leadbooster-chat\.pipedrive\.com|webforms\.pipedrive\.com/i],
  ['intercom',         /widget\.intercom\.io|js\.intercomcdn\.com/i],
  ['segment',          /cdn\.segment\.com\/analytics/i],
  ['stripe',           /js\.stripe\.com/i],
  ['zapier',           /hooks\.zapier\.com/i],
  ['make',             /hook\.(?:eu|us)\d\.make\.com/i],
  ['apollo',           /assets\.apollo\.io\/micro\/website-tracker/i],
  ['mailchimp',        /chimpstatic\.com|list-manage\.com\/subscribe/i],
  ['brevo',            /sibforms\.com/i],
  ['calendly',         /assets\.calendly\.com|calendly\.com\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)?["'?]/i],
  ['clearbit',         /tag\.clearbitscripts\.com/i],
  ['mixpanel',         /cdn\.mxpnl\.com/i],
  ['amplitude',        /cdn\.amplitude\.com/i],
  ['hotjar',           /static\.hotjar\.com/i],
  ['google_analytics', /googletagmanager\.com|gtag\(/i],
  ['linkedin_insight', /snap\.licdn\.com/i],
  ['webflow',          /website-files\.com|webflow\.js/i],
  ['framer',           /framerusercontent\.com/i],
  ['wordpress',        /\/wp-content\//i],
  ['shopify',          /cdn\.shopify\.com/i]
];

// Fix 5 and 8: what the company sells, how it sells, which angle fits. Fixed rules, no LLM.
const CATS = [
  ['crm',            /\bcrm\b|customer relationship management/],
  ['outbound',       /outbound (?:sales )?(?:platform|software|tool|engine|outreach|service)|cold email|\bai sdr|sales sequences?|multichannel sequences?|prospecting (?:tool|platform|software)/],
  ['enrichment',     /enrichment|contact data|b2b data|data provider|intent (?:data|signals?)|verified data/],
  ['deliverability', /deliverability|email warm-?up|inbox placement/],
  ['sales_tech',     /sales engagement|sales enablement|revenue intelligence|conversation intelligence|sales coach|sales copilot|ai sales (?:agent|assistant)|coaches reps|demo automation/],
  ['automation',     /workflow automation|no-code automation|document (?:automation|processing)|\brpa\b|integration platform|ai agents? for (?:sales|gtm|revenue)/]
];
const OVERLAP = ['crm', 'outbound', 'enrichment', 'deliverability', 'sales_tech', 'automation'];
const SERVICE = /\bagency\b|consultan|done-for-you|fully managed|we help|marketing services|lead generation services/;
const LEAD_SELLER = /pay[- ]per[- ]lead|pay-per-sale|lead generation|\bleads? (?:delivered|per month|a month)|valid leads|qualified leads|appointment setting/;
const HARDWARE = /\brobot|hardware|manufactur|semiconductor|\bsensors?\b|\bdrones?\b|biotech|medical device|lab equipment|satellite/;
const HIRE_MATCH = /revops|revenue operations|\bgtm\b|go-to-market|sales ops|sales operations|marketing ops|marketing operations|\bops\b|operations|\bcrm\b|automation/i;

const classify = (p, site) => {
  const text = [p.company_name, p.industry, p.company_type, p.clay_summary, site.desc, site.title].map(s => String(s || '')).join(' ').toLowerCase();
  let category = (CATS.find(([, re]) => re.test(text)) || ['other'])[0];
  if (category === 'other' && /->\s*sales\b/.test(String(p.industry || '').toLowerCase())) category = 'sales_tech';   // YC tag "B2B -> Sales"
  const service = String(p.company_type || '') === 'agency' || SERVICE.test(text);
  let type = 'other';
  if (HARDWARE.test(text) && !service) type = 'hardware';
  else if (service && LEAD_SELLER.test(text)) type = 'lead_seller';
  else if (service) type = 'agency';
  else if (site.demo) type = 'demo_saas';
  else if (site.selfserve || site.booking) type = 'self_serve_saas';
  return { category, type, overlap: OVERLAP.includes(category) && type !== 'lead_seller' };
};

const ANGLES = {
  hire_bridge:       'Offer to take part of the new role setup work (CRM, enrichment, reporting) as a contractor while they hire, or next to the new person.',
  delivery_ops:      'Offer a lead delivery layer: validate and dedupe each lead before it is billed or sent, route it to the right client, log every decision for disputes.',
  client_reporting:  'Offer one automated report per client: pull pipeline and campaign data from each client CRM, clean it, send the same report every week.',
  demo_brief:        'Offer a demo request flow: look up the company behind each request, flag best-fit accounts, send a short brief before the call, follow up no-shows.',
  booking_followup:  'Offer a booking flow: pick up each booking, add it to the CRM with a short brief before the call, follow up people who do not convert.',
  signup_activation: 'Offer a new-signup flow: enrich each signup, flag accounts worth a personal reply, send a weekly list of high-fit signups.'
};
const firstSentence = (s, re) => (String(s || '').split(/(?<=[.!?])\s+/).find(x => re.test(x.toLowerCase())) || '').slice(0, 220);
const pickAngle = (p, c, site) => {
  const trig = String(p.clay_trigger || '');
  if (p.trigger_ok && String(p.clay_trigger_source) === 'hiring' && HIRE_MATCH.test(trig)) return { id: 'hire_bridge', basis: trig };
  if (c.type === 'hardware') return null;
  if (c.type === 'lead_seller') return { id: 'delivery_ops', basis: firstSentence(p.clay_summary || site.desc, LEAD_SELLER) || 'sells leads to clients' };
  if (c.type === 'agency') return { id: 'client_reporting', basis: firstSentence(p.clay_summary || site.desc, SERVICE) || 'B2B agency serving several clients' };
  if (site.demo) return { id: 'demo_brief', basis: 'demo call to action on the homepage: ' + site.demo };
  if (site.booking) return { id: 'booking_followup', basis: 'booking link on the homepage' };
  if (site.selfserve && Number(p.employee_count) >= 10) return { id: 'signup_activation', basis: 'self-serve signup on the homepage: ' + site.selfserve };
  return null;
};

// Homepage signals, from the HTML the node already fetches.
const motionOf = (html) => {
  const low = String(html || '').toLowerCase();
  const m = (re) => { const x = low.match(re); return x ? x[0] : ''; };
  return {
    demo: m(/(?:book|request|get|schedule|see) (?:a |your )?(?:free )?demo/),
    selfserve: m(/start (?:for )?free|free trial|try (?:it )?(?:for )?free|sign up (?:for )?free|get started (?:for )?free/),
    booking: /assets\.calendly\.com|calendly\.com\/[a-z0-9_-]+|cal\.com\/[a-z0-9_-]+/.test(low)
  };
};
// ---------- end of the Sprint 14 rules ----------

// Sprint 14 (Fix 4, 8): the homepage is always read, once per company and run. One free GET, fixed rules, no LLM.
// It gives the description, the tools the page really loads (TECH) and how the company sells (motionOf).
const siteCache = {};
const decode = s => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#\d+;|&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const SITE_FAIL = { ok: false, desc: '', title: '', tools: [], mentions: [], demo: '', selfserve: '', booking: false };
const siteFetch = async (p) => {
  const d = String(p.domain || '').toLowerCase().trim();
  if (!d) return SITE_FAIL;
  if (siteCache[d] !== undefined) return siteCache[d];
  let out = SITE_FAIL;
  try {
    const r = await http({ method: 'GET', url: 'https://' + d + '/', json: false, timeout: Math.max(3000, Number(SITE.timeout_ms || 8000)),
      headers: { 'User-Agent': 'personal-gtm-engine/3.0 (n8n outreach research)', 'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' } });
    const html = (r.status >= 200 && r.status < 300 && typeof r.body === 'string') ? r.body.slice(0, 300000) : '';
    if (html) {
      const meta = (re) => { const m = html.match(re); return m ? decode(m[1] || m[2]) : ''; };
      const desc = meta(/<meta[^>]+(?:name|property)=["'](?:description|og:description|twitter:description)["'][^>]*content=["']([^"']{20,600})["']/i)
                || meta(/<meta[^>]+content=["']([^"']{20,600})["'][^>]*(?:name|property)=["'](?:description|og:description|twitter:description)["']/i);
      const title = meta(/<title[^>]*>([^<]{3,200})<\/title>/i);
      // A bot wall or an error page is not the homepage: treat it as unreachable.
      if (!/access denied|just a moment|attention required|captcha|403 forbidden|page not found|website expired/i.test([title, desc].filter(Boolean).join(' | '))) {
        const tools = TECH.filter(([, re]) => re.test(html)).map(([name]) => name);
        const seen = tools.map(t => t.replace(/_/g, ' '));
        const low = html.toLowerCase();
        const mentions = WATCH.filter(t => has(low, t) && !seen.includes(t));   // named on the page, but no script evidence
        out = Object.assign({ ok: true, desc, title, tools, mentions }, motionOf(html));
      }
    }
  } catch (e) { out = SITE_FAIL; }
  siteCache[d] = out;
  return out;
};

const SYSTEM = [
  'You write cold outreach drafts for a GTM automation and integration engineer. A human reviews everything; nothing is sent automatically.',
  'Use ONLY the facts in the USER message. Never invent metrics, clients, results, hiring events, products, documents, data sources or tools.',
  'GROUNDING: CLAY_SUMMARY and SITE_DESCRIPTION are the only things you know about what the company does. If both are "none", do not describe their product, customers, data or internal processes at all: build first_line from INDUSTRY and ALLOWED_COMPANY_TOOLS only.',
  'ALLOWED_COMPANY_TOOLS were detected on the company public website. You may say you noticed a tool on their site. You do not know how they use it. A product that integrates with a tool is not the same as the company using that tool internally.',
  'You may name a tool of the COMPANY only if it appears in ALLOWED_COMPANY_TOOLS. Otherwise do not name any company tool.',
  'THEIR PRODUCT IS NOT THEIR PROBLEM: CLAY_SUMMARY and SITE_DESCRIPTION describe what the company SELLS to its own customers. Never offer to build, automate, extend, feed or integrate with that product, and never describe the problem their product solves as a problem they have. The words in PRODUCT_TERMS name their product: they may appear in first_line and trigger only, and in no other field.',
  'WHAT YOU OFFER: exactly the ANGLE in the USER message, written for this company. Do not switch to another idea and do not add a second one. You may use what they sell only to infer who their buyers are.',
  'Follow TEAM_NOTE.',
  'HEDGING: you have never seen inside this company. Any statement about their team, workload or problems must be a question or a hedged guess (use "likely", "often", "if", "curious whether"). Never write that their team "must", "has to", "spends", "struggles" or "is forced" as a fact, and never write "forces your", "which means", "considerable time" or "significant time".',
  'Never invent an example that names specific documents, tickets, contracts or systems of theirs. Workflow ideas must use only ALLOWED_COMPANY_TOOLS and generic nouns (leads, contacts, CRM, pipeline), minus anything in PRODUCT_TERMS.',
  'Do not propose a partnership or a "joint" anything. The sender is offering a small freelance automation build.',
  'PROOF_POINT is the SENDER own work: write it in first person (I/we), never as the recipient own ("your n8n engine"). If PROOF_POINT starts with "Can build", say "I can build", never "I built". Do not quantify results (no "in half", "2x", percentages).',
  'Do NOT write a greeting, a sign-off, a call to action, a placeholder like [Name], links, or em dashes. Code adds those.',
  'If TRIGGER_FACT is not none, use it as the trigger and build first_line on it. Copy any date, amount or job title from it exactly. Never add details it does not contain.',
  'If TRIGGER_FACT is none, set trigger to "none".',
  'first_line: 15-35 words and it MUST contain COMPANY_NAME_TO_USE exactly. ONE specific observation taken from TRIGGER_FACT if it is not none, else from ANGLE_BASIS, + ONE hedged guess or question that leads to the ANGLE. No flattery.',
  'body_rest: 45-65 words. One capability proof (paraphrase PROOF_POINT) + the ANGLE as one concrete workflow for them.',
  'follow_up_1 and follow_up_2: 12-30 words each; follow_up_2 adds one concrete workflow idea. follow_up_3: under 12 words, the shortest of the three, a polite breakup. Each follow-up starts with the first name. first_line must NOT start with the first name.',
  'linkedin_note: between 20 and 40 words (count them), ends with a short question.',
  'Return ONLY a JSON object with exactly these string keys: angle, trigger, pain_point, value_proposition, email_subject, first_line, body_rest, follow_up_1, follow_up_2, follow_up_3, linkedin_note.'
].join(' ');

const userPrompt = p => [
  'COMPANY: ' + p.company_name + ' (' + p.domain + ')',
  'COMPANY_NAME_TO_USE: ' + displayName(p),
  'INDUSTRY: ' + p.industry + ' | EMPLOYEES: ' + p.employee_count + ' | FUNDING: ' + p.funding_stage,
  'CLAY_SUMMARY: ' + String(p.clay_summary || 'none').slice(0, 450),
  'TRIGGER_FACT: ' + (p.trigger_ok ? String(p.clay_trigger).slice(0, 200) : 'none'),
  'ANGLE: ' + ANGLES[p.__angle.id],
  'ANGLE_BASIS: ' + p.__angle.basis,
  'SITE_DESCRIPTION: ' + String(p.__site || 'none').slice(0, 420),
  'ALLOWED_COMPANY_TOOLS: ' + (companyTools(p).join(', ') || 'none'),
  'PRODUCT_TERMS: ' + ((p.__terms || []).join(', ') || 'none'),
  'TEAM_NOTE: ' + (smallTeam(p) ? 'small company of about ' + p.employee_count + ' people. There is no separate ops team. Say "you" or "your team", never "ops team" or "operations team".' : 'none'),
  'CONTACT: ' + p.full_name + ', ' + p.title,
  'FIRST_NAME: ' + firstName(p),
  'PROOF_POINT: ' + pickProof(p),
  'TONE: ' + (O.tone || 'direct, concise, evidence-first')
].join('\n');

// ---------- assemble + validate (deterministic, no LLM) ----------
const KEYS_REQ = ['angle','trigger','pain_point','value_proposition','email_subject','first_line','body_rest','follow_up_1','follow_up_2','follow_up_3','linkedin_note'];
const assemble = (p, d) => {
  const o = {};
  for (const k of KEYS_REQ) o[k] = norm(d[k]);
  o.first_line = o.first_line.replace(new RegExp('^' + firstName(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[,:-]\\s*', 'i'), '').replace(/^./, c => c.toUpperCase());
  o.proof_point = pickProof(p);
  o.cta = CTA;
  o.message_draft = 'Hi ' + firstName(p) + ',\n\n' + o.first_line + ' ' + o.body_rest + '\n\n' + CTA + '\n\n' + SENDER;
  return o;
};
const HEDGE = /\b(likely|may|might|could|can|if|perhaps|probably|often|curious|wonder|guess|assume|typically|usually|tends?|sometimes|whether)\b|\?/i;
const ASSERT = /\b(?:your|the|their)\s+(?:[a-z-]+\s+){0,2}(?:team|group|crew|engineers|reps|staff)\s+(?:must|has to|have to|is forced|are forced|spends?|wastes?|struggles?|juggles?|is juggling|are juggling)\b|\bforc(?:es|ing) (?:your|the|their)\b/i;
const validate = (p, o) => {
  const bad = [];
  for (const k of KEYS_REQ) if (!o[k]) bad.push('missing:' + k);
  if (bad.length) return bad;
  const all = KEYS_REQ.map(k => o[k]).join(' \n ');
  const lower0 = all.toLowerCase();
  if (/[\[\]{}]|https?:\/\/|www\./i.test(all)) bad.push('placeholder_or_link');
  if (/[$%€]/.test(all)) bad.push('money_or_percent');
  if (/\bi hope\b|\bbest,|\bregards\b/i.test(all)) bad.push('boilerplate');
  const total = wc(o.message_draft);
  if (total < W.total[0] || total > W.total[1]) bad.push('words:' + total);
  const nw = wc(o.linkedin_note);
  if (nw < W.note[0] || nw > W.note[1] || o.linkedin_note.length > 300) bad.push('li_words:' + nw);
  const f1 = wc(o.follow_up_1), f2 = wc(o.follow_up_2), f3 = wc(o.follow_up_3);
  if (f1 > 40 || f2 > 40 || f3 > f1 || f3 > f2) bad.push('followups_length:' + f1 + '/' + f2 + '/' + f3);
  const stem = String(p.domain || '').split('.')[0].toLowerCase();
  const fl = o.first_line.toLowerCase();
  if (!(fl.includes(String(p.company_name || '').toLowerCase()) || fl.includes(displayName(p).toLowerCase()) || (stem && fl.includes(stem)))) bad.push('first_line_no_company');
  if (wc(o.email_subject) < 3 || o.email_subject.length > 80) bad.push('subject');
  if (/\b(your|their) (n8n|engine)\b/i.test(all)) bad.push('wrong_perspective');
  if (/\b(i|we)('ve| have)? built\b/i.test(all) && !PROOFS.filter(x => /^built /i.test(x)).map(x => x.toLowerCase().split(/\s+/).slice(1, 4).join(' ')).some(k => lower0.includes(k))) bad.push('overclaims_built');
  if (/\b(in half|twice|double|doubling|triple|halve|halving|\dx)\b/i.test(all)) bad.push('quantified_claim');
  if (/\bjoint (workflow|project|solution|venture|effort)\b|\bpartner(ship)? with (you|your)\b/i.test(all)) bad.push('partnership_pitch');
  // an unhedged statement about their team's problems is a guess presented as a fact
  // "so your team spends less time on X" describes the benefit, not their problem, so it is not counted
  const asserted = all.split(/(?<=[.!?])\s+|\n/).map(s => s.replace(/\bso (?:that )?(?:your|the|their)\b/gi, 'so')).filter(s => ASSERT.test(s) && !HEDGE.test(s));
  if (asserted.length) bad.push('asserted_pain');
  // a guess dressed up as a conclusion ("which likely means you spend considerable time ...")
  if (/\b(?:considerable|significant|substantial|countless|a lot of|too much|hours of)\s+(?:time|effort|hours|manual)\b|\b(?:which|that|this)\s+(?:(?:likely|probably|surely|clearly)\s+)?means\b|\bno doubt\b|\bi know (?:you|your)\b/i.test(all)) bad.push('presumptuous');
  if (smallTeam(p) && /\b(?:ops|operations|revops|rev ops|sales ops|marketing ops)\s+(?:team|department|staff)(?:'s)?\b/i.test(all)) bad.push('ops_team_at_small_company');
  // their product is not their problem: product words are allowed in first_line and trigger only
  const offer = ['angle','pain_point','value_proposition','email_subject','body_rest','follow_up_1','follow_up_2','follow_up_3','linkedin_note'].map(k => o[k]).join(' \n ');
  const own = (p.__terms || []).filter(t => termRe(t).test(offer));
  if (own.length) bad.push('own_product:' + own.join('+'));
  // tool whitelist: a watched tool may appear only if the company uses it or my chosen proof mentions it
  const okTools = new Set(companyTools(p).concat(WATCH.filter(t => has(o.proof_point.toLowerCase(), t))));
  const lower = all.toLowerCase();
  const rogue = WATCH.filter(t => has(lower, t) && !okTools.has(t));
  if (rogue.length) bad.push('rogue_tools:' + rogue.join('+'));
  // numbers must come from the facts. Words like n8n, b2b, web3 are names, not numbers.
  const facts = (String(p.clay_summary || '') + ' ' + String(p.__site || '') + ' ' + p.employee_count + ' ' + o.proof_point + ' ' + CTA + ' ' + p.tech_stack + ' ' + String(p.clay_trigger || '')).toLowerCase();
  const nums = (lower.replace(/\b[a-z]+\d[a-z0-9]*\b/g, ' ').match(/\d+/g) || []).filter(n => !facts.includes(n));
  if (nums.length) bad.push('invented_numbers:' + nums.join(','));
  // Fix 7: validator v2 (Sprint 14, guide 4.1). A paragraph must end with punctuation; no 12 words in a row copied from the summary or the site.
  const paras = o.message_draft.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean).slice(1, -1);   // skip "Hi X," and the sender
  if (paras.some(s => !/[.!?]["')]?$/.test(s))) bad.push('unpunctuated_end');
  const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const src = ' ' + words(String(p.clay_summary || '') + ' ' + String(p.__site || '')).join(' ') + ' ';
  const mw = words(o.message_draft);
  for (let i = 0; i + 12 <= mw.length; i++) if (src.includes(' ' + mw.slice(i, i + 12).join(' ') + ' ')) { bad.push('copied_source'); break; }
  return bad;
};

const proofSentence = t => (/^can /i.test(t) ? 'I ' + t.replace(/^./, c => c.toLowerCase()) : /^built /i.test(t) ? 'I ' + t.replace(/^./, c => c.toLowerCase()) : t) + '.';
const templateDraft = p => {
  const cap = t => t.replace(/\b\w/g, c => c.toUpperCase());
  const tools = companyTools(p).slice(0, 2).map(cap).join(' and ');
  const nm = displayName(p);
  const fn = firstName(p);
  // Sprint 14 (Fix 7): the template never uses summary text. It says only what was actually seen (a tool the site loads), or a neutral sentence.
  const obs = tools ? 'I noticed ' + tools + ' on the ' + nm + ' site' : nm + ' came up while I was looking at B2B teams that run their own lead operations';
  return {
    angle: 'automation-audit', trigger: String(p.clay_trigger || '').slice(0, 200) || obs,
    pain_point: 'Manual handoffs between lead data, CRM and reporting often grow with volume.',
    value_proposition: 'Deterministic n8n and Clay pipelines that enrich, score and route leads without extra headcount.',
    email_subject: nm + ': one lead-ops workflow idea',
    first_line: obs + '. For a team like ' + nm + ', lead enrichment and routing often stay manual.',
    body_rest: 'I build deterministic automation layers that enrich, score and route leads without adding headcount, so your team can spend time on conversations instead of data entry. Relevant proof: ' + proofSentence(pickProof(p)),
    follow_up_1: fn + ', adding one concrete idea: a scheduled n8n job that enriches new leads and writes scored rows to your CRM. Worth a short example?',
    follow_up_2: fn + ', I can send a one-page diagram of the lead routing flow. No call needed.',
    follow_up_3: fn + ', closing the loop. My door stays open if automation capacity comes up later.',
    linkedin_note: 'Hi ' + fn + ', I build n8n and Clay pipelines that enrich and route leads for B2B teams like ' + nm + '. Open to a short workflow example?'
  };
};
// The fallback text says "CRM". For a company that sells a CRM, that word is their product, so it is swapped out.
const templateFor = p => {
  const t = templateDraft(p);
  if (!(p.__terms || []).includes('crm')) return t;
  for (const k of Object.keys(t)) t[k] = t[k].replace(/lead data, CRM and reporting/g, 'lead data and reporting').replace(/\byour CRM\b/g, 'your pipeline').replace(/\bCRM\b/g, 'pipeline');
  return t;
};

// Plain-language repair hints for the rules a model most often misreads.
const hints = (bad) => {
  const h = [];
  const own = bad.find(b => b.startsWith('own_product:'));
  if (own) h.push(' The words "' + own.slice(12).split('+').join('", "') + '" name what this company SELLS. Remove them from every field except first_line and trigger, and keep to the ANGLE.');
  if (bad.includes('presumptuous')) h.push(' Do not conclude anything about their workload. Ask a short question instead.');
  if (bad.includes('ops_team_at_small_company')) h.push(' This is a small company: write "you" or "your team", never "ops team".');
  return h.join('');
};

// ---------- Sprint 14 gate rows ----------
// A gated pair still gets a visible row (rejected, 0 LLM calls), so the same contact is not fetched again every run.
const GATE_OVERRIDES = (Array.isArray(O.gate_overrides) ? O.gate_overrides : []).map(String);
const gateRow = (p, gate, scope, c) => {
  const what = gate === 'product_overlap' ? c.category : c.type;
  const how = gate === 'no_angle'
    ? 'No angle in the library fits this business model. Re-draft after a new dated trigger.'
    : 'Add the account_id to outreach.gate_overrides and Re-draft to override.';
  return { json: {
    run_date: new Date().toISOString(),
    outreach_id: 'or_' + String(p.contact_id || '').replace(/\s+/g, '_') + '_' + Date.now().toString(36),
    account_id: p.account_id, contact_id: p.contact_id, company_name: p.company_name, contact_name: p.full_name,
    channel: p.channel,
    angle: '', trigger: '', pain_point: '', value_proposition: '', proof_point: '', cta: '', email_subject: '', first_line: '',
    message_draft: '', follow_up_1: '', follow_up_2: '', follow_up_3: '', linkedin_note: '',
    risk_notes: ['gate=' + gate, 'account_type=' + c.type, 'product_category=' + c.category,
      'tools=' + ((p.__tools || []).join('+') || 'none'), 'mentions=' + ((p.__mentions || []).join('+') || 'none'),
      'trigger=' + (p.trigger_ok ? (p.clay_trigger_source || 'clay') : 'none')].join('; ').slice(0, NOTES_MAX),
    approval_status: 'rejected', reject_scope: scope, send_status: 'not_sent', sent_at: '', reply_received: '',
    notes: 'Auto-skipped by the Sprint 14 gate (' + gate + '): ' + what + '. ' + how,
    llm_provider: 'gate:' + gate, llm_calls: 0, llm_failures: 0,
    angle_basis: '', account_type: c.type, product_category: c.category } };
};

// ---------- run ----------
const cooldown = {};   // step id -> timestamp until which the step is skipped
const hardFails = {};  // step id -> consecutive hard failures
const out = [];
let first = true;
let leftForNextRun = 0;
const dstats = { skipped_site_unreachable: 0 };   // read by Add Outreach Stats

for (let pi = 0; pi < pairs.length; pi++) {
  const p = pairs[pi];
  // Stop early rather than hit the Code node time limit. Undrafted contacts stay "new" and are picked up next run.
  if (Date.now() - T0 > RUN_BUDGET_MS) { leftForNextRun = pairs.length - pi; break; }

  // ---- Sprint 14 gates: fixed rules, in this order, all before any LLM call ----
  // a. The homepage must be readable: it carries the tools and the selling motion. No row is written, so the pair is re-checked next run.
  const site = await siteFetch(p);
  if (!site.ok) { dstats.skipped_site_unreachable++; continue; }
  p.__tools = site.tools;
  p.__mentions = site.mentions;
  // p.__site keeps its meaning: the homepage text is used as company facts only when there is no Clay summary.
  p.__site = (String(p.clay_summary || '').trim() || SITE.enabled === false) ? '' : [site.title, site.desc].filter(Boolean).join(' | ').slice(0, 420);
  // b. Sells GTM tooling, or is hardware: a visible rejected row with scope account, no LLM call (ADR-106).
  const c = classify(p, site);
  if (!GATE_OVERRIDES.includes(String(p.account_id)) && (c.overlap || c.type === 'hardware')) {
    out.push(gateRow(p, c.overlap ? 'product_overlap' : 'hardware', 'account', c));
    continue;
  }
  // c. Code picks the angle (ADR-107). No angle fits: a rejected row with scope pitch.
  p.__angle = pickAngle(p, c, site);
  if (!p.__angle) { out.push(gateRow(p, 'no_angle', 'pitch', c)); continue; }

  // Pause between LLM drafts only: gate rows make no LLM call.
  if (!first) await sleep(PACE_MS);
  first = false;

  const factsLevel = String(p.clay_summary || '').trim() ? 'clay' : (p.__site ? 'site' : 'none');
  p.__terms = productTerms(p);

  let row = null, provider = 'template', calls = 0, fails = 0;
  const errs = [];

  for (const step of CHAIN) {
    if (step.error) { errs.push(step.id + ':' + step.error); continue; }
    if (!$env[step.key]) { errs.push(step.id + ':key_missing'); fails++; continue; }
    if (cooldown[step.id] && Date.now() < cooldown[step.id]) { errs.push(step.id + ':cooling_down'); continue; }

    let repair = '', waits = 0, transient = 0;
    for (let attempt = 0; attempt < 4 && !row; attempt++) {
      calls++;
      const r = await callStep(step, SYSTEM, userPrompt(p) + repair);
      if (r.retried_plain) errs.push(step.id + ':extras_rejected_retried_plain');

      if (r.status === 200) {
        hardFails[step.id] = 0;
        const d = parseJSON(r.text);
        const bad = d ? validate(p, assemble(p, d)) : ['unparseable_json'];
        if (!bad.length) { row = assemble(p, d); provider = step.id; break; }
        fails++; errs.push(step.id + ':invalid:' + bad.join('|').slice(0, 80));
        if (repair) break;                       // one repair attempt per provider
        repair = '\n\nYOUR PREVIOUS ANSWER WAS REJECTED FOR: ' + bad.join('|') + '.' + hints(bad) + ' Return the full JSON again with these problems fixed.';
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
        // Too long to wait here. Rest this model and let the next provider take over; it comes back after the cooldown.
        cooldown[step.id] = Date.now() + Math.min(wait, 300) * 1000;
        errs.push(step.id + ':429_cooldown_' + Math.ceil(Math.min(wait, 300)) + 's');
        break;
      }
      if ([400, 401, 403, 404].includes(r.status)) {
        // Wrong key, wrong model name or blocked account: no point retrying in this run.
        cooldown[step.id] = Date.now() + 3600000;
        errs.push(step.id + ':http_' + r.status + ':' + (errText(r.body) || r.err).slice(0, 70));
        break;
      }
      // 5xx, timeout or network error
      errs.push(step.id + ':' + (r.status ? 'http_' + r.status : 'network') + ':' + (errText(r.body) || r.err).slice(0, 50));
      if (r.status >= 500 && transient < 1) { transient++; await sleep(3000); continue; }
      hardFails[step.id] = (hardFails[step.id] || 0) + 1;
      if (hardFails[step.id] >= 2) cooldown[step.id] = Date.now() + 120000;
      break;
    }
    if (row) break;
  }

  // Sprint 14 (Fix 7): a template draft, or a draft that still fails the validator, is parked in needs_redraft, outside Review.
  let status = 'pending';
  if (!row) { row = assemble(p, templateFor(p)); status = 'needs_redraft'; }
  const finalBad = validate(p, row);
  if (finalBad.length) { status = 'needs_redraft'; errs.push('final_invalid:' + finalBad.join('|')); }
  // Only now: the stored angle and trigger are set by code, never by the LLM (Fix 6, Fix 8).
  row.angle = p.__angle.id;
  row.trigger = p.trigger_ok ? String(p.clay_trigger).slice(0, 200) : '';

  const flags = [];
  if (p.flags) flags.push(p.flags);
  flags.push('provider=' + provider);
  if (provider === 'template') flags.push('template_review_hard');
  flags.push('facts=' + factsLevel);
  flags.push('trigger=' + (p.trigger_ok ? (p.clay_trigger_source || 'clay') : 'none'));
  if (factsLevel === 'none') flags.push('no_company_facts');
  if (p.__terms.length) flags.push('their_product=' + p.__terms.join('+'));
  // Sprint 14: what the code decided, plus the evidence: tools = scripts the page loads, mentions = names on the page only.
  flags.push('angle=' + p.__angle.id);
  flags.push('account_type=' + c.type);
  flags.push('product_category=' + c.category);
  flags.push('tools=' + (p.__tools.join('+') || 'none'));
  flags.push('mentions=' + (p.__mentions.join('+') || 'none'));

  out.push({ json: Object.assign({
    run_date: new Date().toISOString(),
    outreach_id: 'or_' + String(p.contact_id || '').replace(/\s+/g, '_') + '_' + Date.now().toString(36),
    account_id: p.account_id, contact_id: p.contact_id, company_name: p.company_name, contact_name: p.full_name,
    channel: p.channel }, (() => { const r = Object.assign({}, row); delete r.body_rest; return r; })(), {
    risk_notes: (flags.join('; ') + (errs.length ? ' | llm_errors: ' + errs.join(' ; ') : '')).slice(0, NOTES_MAX),
    approval_status: status, reject_scope: '', send_status: 'not_sent', sent_at: '', reply_received: '',
    notes: p.__site ? ('Site says: ' + p.__site).slice(0, 450) : '',
    llm_provider: provider, llm_calls: calls, llm_failures: fails,
    angle_basis: p.__angle.basis, account_type: c.type, product_category: c.category }) });
}

if (leftForNextRun && out.length) {
  const last = out[out.length - 1].json;
  last.risk_notes = ('run_budget_hit: ' + leftForNextRun + ' contact(s) left for the next run; ' + last.risk_notes).slice(0, NOTES_MAX);
}
// The counter rides on the first row as a key that is not a column (gtm_insert_draft ignores it). Add Outreach Stats reads it.
if (out.length) out[0].json.__draft_stats = dstats;
return out;