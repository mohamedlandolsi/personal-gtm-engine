// Partner Directories Source (Code node, Run Once for All Items). Sprint 15, agency lane (ADR-117, ADR-119).
// Reads the Clay experts and n8n experts directories (Phase 0: both go; robots.txt allows the listing and profile
// pages, ?page=N pagination). Both run on the same directory platform: the data sits in the page's __NUXT_DATA__
// JSON. Profiles already in the seen_directory_profiles Data Table are skipped; at most
// sources.partner_directories.max_profiles_per_run profiles are fetched, 1.5 s apart. Emits the normalized company
// schema (same shape as YC Directory Source) plus lead_track = agency_partner and source_meta. Public business data only.
const cfg = $('Load Config').first().json.config || {};
const PD = (cfg.sources || {}).partner_directories || {};
const AT = (cfg.lead_tracks || {}).agency_partner || {};
if (PD.enabled !== true || AT.enabled === false) return [{ json: { __skipped: 'partner_directories disabled by config' } }];

const T0 = Date.now();
const BUDGET_MS = 150000;
const PACE = Math.max(1000, Number(PD.politeness_ms || 1500));
const MAX_PROFILES = Math.max(0, Number(PD.max_profiles_per_run ?? 10));
const EXCLUDE_TIERS = (AT.exclude_tiers || []).map(s => String(s).toLowerCase());
const DIRS = [
  { id: 'clay', label: 'Clay experts directory', source: 'clay_experts', base: 'https://www.clay.com', list: '/en/experts', profile: '/en/experts/partner/', services: 'Expertise', pricing: 'Pricing' },
  { id: 'n8n', label: 'n8n experts directory', source: 'n8n_experts', base: 'https://experts.n8n.io', list: '/', profile: '/partner/', services: 'Services', pricing: 'Project Budget' }
].map(d => Object.assign(d, PD[d.id] || {}, { base: (PD[d.id] || {}).base || d.base, list: (PD[d.id] || {}).list_path || d.list, profile: (PD[d.id] || {}).profile_path || d.profile }))
 .filter(d => d.enabled === true);
if (!DIRS.length) return [{ json: { __skipped: 'partner_directories: no directory enabled' } }];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const seen = new Set($('Fetch Seen Profiles').all().map(i => String((i.json || {}).profile_key || '')).filter(Boolean));
const C = { pages: 0, listed: 0, seen: 0, tier_out: 0, fetched: 0, no_site: 0, errors: 0, returned: 0 };
const errors = [];

// ---------- Nuxt payload (devalue): one flat array, objects hold indexes into it ----------
const WRAP = ['ShallowReactive', 'Reactive', 'Ref', 'ShallowRef', 'EmptyRef', 'EmptyShallowRef'];
const nuxtData = (html) => {
  const m = String(html || '').match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  const arr = JSON.parse(m[1]);
  const memo = new Map();
  const r = (i) => {
    if (typeof i !== 'number' || i < 0) return null;
    if (memo.has(i)) return memo.get(i);
    const v = arr[i];
    let out;
    if (Array.isArray(v)) {
      if (v.length && typeof v[0] === 'string' && WRAP.includes(v[0])) out = v.length > 1 ? r(v[1]) : null;
      else if (v.length && v[0] === 'Set') out = v.slice(1).map(r);
      else if (v.length && v[0] === 'Date') out = v[1];
      else { out = []; memo.set(i, out); for (const x of v) out.push(r(x)); }
    } else if (v && typeof v === 'object') {
      out = {}; memo.set(i, out);
      for (const k of Object.keys(v)) out[k] = r(v[k]);
    } else out = v;
    memo.set(i, out);
    return out;
  };
  const root = r(0) || {};
  return root.data || {};
};
const get = async (url) => this.helpers.httpRequest({ method: 'GET', url, json: false, timeout: 20000,
  // experts.n8n.io answers 406 to a bare "Accept: text/html" (test run 804), so send the browser-style list Draft Outreach uses.
  headers: { 'User-Agent': 'personal-gtm-engine/3.0 (n8n, partner directory research)', 'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' } });

// ---------- places (copied from YC Directory Source, plus the Americas for the agency window D1) ----------
const PLACES = [
  [0, ['united kingdom', 'england', 'scotland', 'wales', 'ireland', 'portugal', 'iceland', 'london', 'dublin', 'lisbon', 'ghana', 'senegal']],
  [1, ['germany', 'france', 'spain', 'italy', 'netherlands', 'belgium', 'austria', 'switzerland', 'czech', 'poland',
       'hungary', 'slovakia', 'slovenia', 'croatia', 'serbia', 'malta', 'tunisia', 'morocco', 'algeria', 'denmark',
       'norway', 'sweden', 'luxembourg', 'nigeria', 'berlin', 'paris', 'madrid', 'amsterdam', 'stockholm', 'copenhagen', 'zurich', 'europe']],
  [2, ['greece', 'romania', 'bulgaria', 'finland', 'estonia', 'latvia', 'lithuania', 'ukraine', 'cyprus', 'israel',
       'lebanon', 'egypt', 'south africa', 'tel aviv', 'helsinki', 'tallinn']],
  [3, ['turkey', 'saudi arabia', 'qatar', 'kuwait', 'bahrain', 'iraq', 'jordan', 'kenya', 'istanbul', 'nairobi']],
  [4, ['united arab emirates', 'dubai', 'abu dhabi', 'armenia', 'azerbaijan']],
  [-5, ['new york', 'boston', 'massachusetts', 'toronto', 'ontario', 'montreal', 'miami', 'florida', 'atlanta', 'georgia, united states',
        'washington, d', 'philadelphia', 'pennsylvania', 'new jersey', 'north carolina', 'virginia', 'ohio', 'michigan', 'detroit', 'colombia', 'peru']],
  [-6, ['chicago', 'illinois', 'texas', 'austin', 'dallas', 'houston', 'minnesota', 'mexico']],
  [-7, ['colorado', 'denver', 'arizona', 'utah']],
  [-8, ['california', 'san francisco', 'los angeles', 'san jose', 'san diego', 'seattle', 'washington state', 'oregon', 'portland', 'vancouver']],
  [-3, ['brazil', 'argentina', 'sao paulo', 'buenos aires', 'chile', 'uruguay']],
  [5.5, ['india', 'bangalore', 'bengaluru', 'mumbai', 'delhi', 'pune', 'hyderabad', 'chennai']],
  [8, ['singapore', 'philippines', 'malaysia', 'china', 'hong kong', 'taiwan']],
  [10, ['australia', 'sydney', 'melbourne']]
];
const US_STATE = { ca: -8, wa: -8, or: -8, nv: -8, co: -7, az: -7, ut: -7, tx: -6, il: -6, mn: -6, mo: -6, wi: -6,
  ny: -5, ma: -5, fl: -5, ga: -5, nc: -5, nj: -5, pa: -5, va: -5, oh: -5, mi: -5, md: -5, dc: -5, ct: -5 };
const tzOf = (text) => {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return null;
  for (const [offset, names] of PLACES) if (names.some(n => t.includes(n))) return offset;
  const st = t.match(/,\s*([a-z]{2})\s*$/);
  if (st && US_STATE[st[1]] !== undefined) return US_STATE[st[1]];
  return null;
};
const US_NAMES = /\b(united states|usa|massachusetts|new york|california|texas|florida|georgia|illinois|washington|colorado|arizona|utah|oregon|pennsylvania|new jersey|north carolina|virginia|ohio|michigan|minnesota|nevada|maryland|connecticut)\b/i;
const CA_NAMES = /\b(canada|ontario|quebec|british columbia|toronto|montreal|vancouver)\b/i;
const countryOf = (text) => {
  const t = String(text || '').trim();
  const st = t.toLowerCase().match(/,\s*([a-z]{2})\s*$/);
  if (st && US_STATE[st[1]] !== undefined) return 'United States';
  if (CA_NAMES.test(t)) return 'Canada';
  if (US_NAMES.test(t)) return 'United States';
  return t.split(',').pop().trim();
};
const normalizeDomain = (raw) => {
  const v = String(raw || '').trim().toLowerCase();
  const host = v.replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#:]/)[0].trim();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : '';
};
const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

// ---------- 1. listings ----------
const share = Math.ceil(MAX_PROFILES / DIRS.length);
const todo = [];
for (const d of DIRS) {
  const maxPages = Math.max(1, Math.min(10, Number(d.max_pages || 1)));
  let picked = 0;
  for (let page = 1; page <= maxPages && picked < share; page++) {
    if (Date.now() - T0 > BUDGET_MS) break;
    if (C.pages) await sleep(PACE);
    let data;
    try {
      data = nuxtData(await get(d.base + d.list + (d.list.includes('?') ? '&' : '?') + 'page=' + page));
      C.pages++;
    } catch (e) { C.errors++; errors.push(d.id + ' list p' + page + ': ' + String(e.message || e).slice(0, 60)); break; }
    const res = Object.values(data || {}).filter(v => v && typeof v === 'object' && Array.isArray(v.results))
      .sort((a, b) => b.results.length - a.results.length)[0];
    if (!res || !res.results.length) break;
    for (const e of res.results) {
      if (!e || !e.slug) continue;
      C.listed++;
      const key = d.id + ':' + e.slug;
      if (seen.has(key) || todo.some(t => t.key === key)) { C.seen++; continue; }
      const tier = String((e.tier || {}).title || '').trim();
      if (EXCLUDE_TIERS.includes((d.id + ':' + tier).toLowerCase())) { C.tier_out++; continue; }
      if (picked >= share) continue;
      todo.push({ key, dir: d, entry: e, tier });
      picked++;
    }
    if (!res.next) break;
  }
}

// ---------- 2. profiles ----------
const out = [];
const today = new Date().toISOString().slice(0, 10);
for (const t of todo.slice(0, MAX_PROFILES)) {
  if (Date.now() - T0 > BUDGET_MS) { errors.push('run budget hit, ' + (todo.length - C.fetched) + ' left'); break; }
  await sleep(PACE);
  const d = t.dir, e = t.entry;
  const profileUrl = d.base + d.profile + e.slug;
  let p = null;
  try {
    const data = nuxtData(await get(profileUrl));
    p = Object.values(data || {}).find(v => v && typeof v === 'object' && v.slug === e.slug && Array.isArray(v.assignedFilterOptions)) || null;
    C.fetched++;
  } catch (err) { C.errors++; errors.push(t.key + ': ' + String(err.message || err).slice(0, 60)); continue; }
  const src = Object.assign({}, e, p || {});
  const names = {};
  for (const f of (src.filters || [])) if (f && f.id) names[f.id] = f.name;
  const grp = {};
  for (const o of (src.assignedFilterOptions || [])) {
    if (!o) continue;
    const n = names[o.filter] || 'Other';
    (grp[n] = grp[n] || []).push({ name: String(o.name || ''), slug: String(o.slug || '') });
  }
  const labels = (n) => (grp[n] || []).map(x => x.name).filter(Boolean);
  const slugs = (n) => (grp[n] || []).map(x => x.slug).filter(Boolean);
  const services = labels(d.services);
  const languages = labels('Language').map(s => s.toLowerCase());
  const locs = Array.isArray(src.locations) ? src.locations.filter(Boolean) : [];
  const locationRaw = locs.length ? locs.map(l => l.title).filter(Boolean).join('; ') : String(src.location || '').trim();
  // Several offices: prefer one inside the agency time window.
  const allowed = (AT.allowed_utc_offsets || []).map(Number);
  const offsets = (locs.length ? locs.map(l => tzOf(l.title || l.countryName)) : [tzOf(locationRaw)]).filter(x => x !== null);
  let tz = offsets.find(o => allowed.includes(o));
  if (tz === undefined) tz = offsets.length ? offsets[0] : null;
  if (tz === null) {
    const regions = labels('Region').map(s => s.toLowerCase());
    if (regions.includes('europe')) tz = 1; else if (regions.includes('north america')) tz = -5;
  }
  const country = locs.length ? String(locs[0].countryName || '').trim() : countryOf(locationRaw);
  const domain = normalizeDomain(src.website);
  if (!domain) { C.no_site++; continue; }
  const meta = {
    directory: d.id, slug: e.slug, profile_url: profileUrl, tier: t.tier, services, languages,
    pricing: slugs(d.pricing), min_engagement: labels('Minimum Engagement'), icps: labels('ICPs'),
    regions: labels('Region'), company_focus: labels('Company Type Focus'),
    rating: src.rating ?? null, reviews: Number(src.numberOfReviews || 0), availability: src.availability ?? null,
    contact_form: src.contactRequestsEnabled === true
  };
  const description = [
    String(src.headline || '').trim(), strip(src.description).slice(0, 1400),
    services.length ? 'Services: ' + services.join(', ') + '.' : '',
    t.tier ? 'Tier: ' + t.tier + '.' : '',
    languages.length ? 'Languages: ' + languages.join(', ') + '.' : '',
    labels(d.pricing).length ? (d.id === 'clay' ? 'Pricing: ' : 'Project budget: ') + labels(d.pricing).join(', ') + '.' : '',
    meta.min_engagement.length ? 'Minimum engagement: ' + meta.min_engagement.join(', ') + '.' : '',
    meta.company_focus.length ? 'Focus: ' + meta.company_focus.join(', ') + '.' : ''
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 2500);
  out.push({ json: {
    source: d.source,
    company_name: String(src.title || e.slug).trim(),
    domain,
    website: String(src.website || '').trim(),
    industry: ('gtm agency | ' + services.slice(0, 6).join(', ')).toLowerCase(),
    company_type: 'agency',
    employee_count: null,
    location_raw: locationRaw,
    country,
    timezone_utc_offset: tz,
    funding_stage: 'unknown',
    description_text: description,
    status: 'new',
    linkedin_url: '',
    lead_track: 'agency_partner',
    source_meta: JSON.stringify(meta),
    directory_trigger: ('Listed in the ' + d.label + (t.tier ? ' (' + t.tier + ')' : '') + (services.length ? ': ' + services.slice(0, 3).join(', ') : '')).slice(0, 200),
    directory_trigger_date: today,
    __profile_key: t.key, __profile_directory: d.id, __profile_slug: e.slug
  } });
}
C.returned = out.length;

const note = 'partner_directories stats: ' + Object.entries(C).map(([k, v]) => k + '=' + v).join(' ') + (errors.length ? ' | ' + errors.slice(0, 3).join(' ; ') : '');
if (!out.length && C.errors && !C.pages) return [{ json: { __error: 'partner_directories: all listing requests failed | ' + errors.slice(0, 2).join(' ; ') } }];
return out.concat([{ json: { __skipped: note } }]);
