const cfg = $('Load Config').first().json.config || {};
const A = (cfg.sources || {}).yc_directory || {};

if (A.enabled !== true) {
  return [{ json: { __skipped: 'yc_directory disabled by config' } }];
}

const tags = (Array.isArray(A.tags) && A.tags.length ? A.tags : ['sales', 'marketing', 'crm'])
  .map(t => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 12);
const cap = Math.max(1, Number(A.max_companies_per_run || 300));
const allowed = ((cfg.timezone || {}).allowed_utc_offsets || [0, 1, 2, 3, 4]).map(Number);
const empMin = Number((cfg.company || {}).employee_min || 2);
const empMax = Number((cfg.company || {}).employee_max || 150);

// Per-gate counters, written to ops.source_errors
const C = { tags_ok: 0, tags_fail: 0, rows: 0, inactive: 0, no_site: 0, size: 0, tz_out: 0, dup: 0, tz_null: 0 };

// Deterministic place -> UTC offset. No LLM, no geo API.
const PLACES = [
  [0, ['united kingdom', 'england', 'scotland', 'wales', 'ireland', 'portugal', 'iceland', 'london', 'dublin', 'lisbon', 'ghana', 'senegal']],
  [1, ['germany', 'france', 'spain', 'italy', 'netherlands', 'belgium', 'austria', 'switzerland', 'czech', 'poland',
       'hungary', 'slovakia', 'slovenia', 'croatia', 'serbia', 'malta', 'tunisia', 'morocco', 'algeria', 'denmark',
       'norway', 'sweden', 'luxembourg', 'nigeria', 'berlin', 'paris', 'madrid', 'amsterdam', 'stockholm', 'copenhagen', 'zurich', 'europe']],
  [2, ['greece', 'romania', 'bulgaria', 'finland', 'estonia', 'latvia', 'lithuania', 'ukraine', 'cyprus', 'israel',
       'lebanon', 'egypt', 'south africa', 'tel aviv', 'helsinki', 'tallinn']],
  [3, ['turkey', 'saudi arabia', 'qatar', 'kuwait', 'bahrain', 'iraq', 'jordan', 'kenya', 'istanbul', 'nairobi']],
  [4, ['united arab emirates', 'dubai', 'abu dhabi', 'armenia', 'azerbaijan']]
];
const FAR = ['usa', 'united states', 'canada', 'mexico', 'brazil', 'argentina', 'colombia', 'chile', 'peru', 'india',
  'singapore', 'indonesia', 'china', 'japan', 'south korea', 'australia', 'new zealand', 'pakistan', 'bangladesh',
  'vietnam', 'philippines', 'thailand', 'malaysia', 'taiwan', 'hong kong'];

// Returns an offset, 'far' (known but outside your window), or null (unknown / remote only)
function tzOf(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return null;
  for (const [offset, names] of PLACES) if (names.some(n => t.includes(n))) return offset;
  if (FAR.some(n => t.includes(n))) return 'far';
  return null;
}

function normalizeDomain(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return '';
  const host = v.replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#:]/)[0].trim();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : '';
}

const GENERIC_TAGS = ['saas', 'b2b', 'ai', 'artificial intelligence', 'generative ai', 'startup', 'software'];

const out = [];
const seenDomains = new Set();
const errors = [];

for (const tag of tags) {
  if (out.length >= cap) break;
  let list = [];
  try {
    list = await this.helpers.httpRequest({
      method: 'GET', json: true, timeout: 20000,
      url: 'https://yc-oss.github.io/api/tags/' + encodeURIComponent(tag) + '.json'
    });
    if (typeof list === 'string') list = JSON.parse(list);
    if (!Array.isArray(list)) throw new Error('not a list');
    C.tags_ok++;
  } catch (e) {
    C.tags_fail++;
    errors.push(tag + ': ' + String(e.message || e).slice(0, 60));
    continue;
  }

  for (const c of list) {
    if (out.length >= cap) break;
    if (!c || !c.name) continue;
    C.rows++;

    if (String(c.status || '') !== 'Active') { C.inactive++; continue; }

    const domain = normalizeDomain(c.website);
    if (!domain) { C.no_site++; continue; }
    if (seenDomains.has(domain)) { C.dup++; continue; }

    const size = Number(c.team_size);
    if (!Number.isFinite(size) || size < empMin || size > empMax) { C.size++; continue; }

    // Headquarters first (first location), then the regions list
    const hq = String(c.all_locations || '').split(';')[0];
    let tz = tzOf(hq);
    if (tz === null) tz = tzOf((Array.isArray(c.regions) ? c.regions : []).join(' | '));
    if (tz === 'far' || (tz !== null && !allowed.includes(tz))) { C.tz_out++; continue; }
    if (tz === null) C.tz_null++;

    seenDomains.add(domain);
    // Generic tags would give every YC company the same keyword points, so they are left out of the text
    const tagList = (Array.isArray(c.tags) ? c.tags : []).filter(t => !GENERIC_TAGS.includes(String(t).toLowerCase()));

    out.push({
      json: {
        source: 'yc_directory',
        company_name: String(c.name).trim(),
        domain,
        website: String(c.website || '').trim(),
        industry: ('software | ' + String(c.subindustry || c.industry || '')).toLowerCase(),
        company_type: 'startup',
        employee_count: size,
        location_raw: String(c.all_locations || 'Remote').trim(),
        country: hq.split(',').pop().trim(),
        timezone_utc_offset: tz,
        // YC stage: Early = seed money; Growth = later round, size unknown.
        funding_stage: ({ Early: 'seed', Growth: 'growth' })[String(c.stage || '')] || 'unknown',
        description_text: [c.one_liner, c.long_description, tagList.length ? 'Tags: ' + tagList.join(', ') : '',
          c.isHiring ? 'Currently hiring.' : '', c.batch ? 'YC ' + c.batch + '.' : '']
          .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 2500),
        status: 'new',
        linkedin_url: ''
      }
    });
  }
}

const note = 'yc stats: tags_ok=' + C.tags_ok + ' tags_fail=' + C.tags_fail + ' rows=' + C.rows + ' inactive=' + C.inactive +
  ' no_site=' + C.no_site + ' size=' + C.size + ' tz_out=' + C.tz_out + ' dup=' + C.dup + ' tz_null=' + C.tz_null +
  ' returned=' + out.length;

if (!C.tags_ok) return [{ json: { __error: 'yc_directory: all tag requests failed | ' + errors.slice(0, 2).join(' ; ') } }];
if (!out.length) return [{ json: { __error: 'yc_directory: 0 companies after gates | ' + note } }];
return out.concat([{ json: { __skipped: note + (errors.length ? ' | failed: ' + errors.slice(0, 2).join(' ; ') : '') } }]);