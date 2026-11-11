const safeAll = (name) => { try { return $(name).all().map(i => i.json); } catch (e) { return []; } };
const cfg = $('Load Config').first().json.config || {};

// Deterministic tech-stack signatures (GTM-relevant only)
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
const CRM = new Set(['hubspot', 'salesforce', 'pipedrive', 'close', 'attio', 'zoho']);
const AUTO = new Set(['zapier', 'make', 'n8n', 'clay', 'apollo', 'workato']);

const weights = { icp_fit: 0.35, budget_proxy: 0.25, automation_need: 0.25, timezone_fit: 0.15, ...((cfg.scoring || {}).weights || {}) };
const boost = { enabled: false, bonus: 0, keywords: [], ...((cfg.scoring || {}).vertical_boost || {}) };
const includesAny = (t, arr) => { const s = String(t || '').toLowerCase(); return (arr || []).some(x => s.includes(String(x).toLowerCase())); };

// The HTTP node returns exactly one item per account, in the same order (failed fetches included).
const accounts = safeAll('Select Pending Accounts').filter(r => r && r.account_id);
const pages = $input.all().map(i => i.json);
if (accounts.length !== pages.length) {
  throw new Error('Enrich alignment mismatch: ' + accounts.length + ' accounts vs ' + pages.length + ' pages');
}

const out = [];

accounts.forEach((r, idx) => {
  const page = pages[idx] || {};
  const row = Object.assign({}, r);

  // Failure path: the HTTP node was set to "Continue", so errors arrive as an `error` field
  if (page.error) {
    const msg = typeof page.error === 'string' ? page.error : ((page.error && page.error.message) || 'unreachable');
    row.enrichment_status = 'enrich_failed';
    row.confidence = 55;
    row.red_flags = [r.red_flags, 'website unreachable'].filter(s => String(s || '').trim()).join('; ');
    row.enrich_error = r.domain + ': ' + String(msg).slice(0, 120);
    out.push({ json: row });
    return;
  }

  const html = String(page.html !== undefined ? page.html : (page.data !== undefined ? page.data : '')).slice(0, 200000);
  const low = html.toLowerCase();
  const detected = [];
  for (const [name, re] of TECH) { if (re.test(low)) detected.push(name); }
  const crm = detected.filter(n => CRM.has(n));
  const auto = detected.filter(n => AUTO.has(n));
  const hiring = /\/careers|\/jobs|\/join-?us|we'?re hiring|hiring now|open roles/.test(low);
  const contact = /\/contact|\/contact-us|mailto:/.test(low);

  let metaDesc = '';
  const mD = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{10,400})["']/i)
          || html.match(/<meta[^>]+content=["']([^"']{10,400})["'][^>]+name=["']description["']/i);
  if (mD) metaDesc = mD[1].replace(/\s+/g, ' ').trim();

  let linkedin = String(r.linkedin_url || '').trim();
  if (!linkedin) {
    const mLi = html.match(/linkedin\.com\/company\/[a-z0-9-]+/i);
    if (mLi) linkedin = 'https://www.' + mLi[0];
  }

  // Explainable re-score: parse stored components, add ONLY new evidence
  const bm = String(r.score_breakdown || '').match(/icp=(\d+);\s*budget=(\d+);\s*automation=(\d+);\s*timezone=(\d+)/i);
  const icp = bm ? Number(bm[1]) : 50;
  const tz = bm ? Number(bm[4]) : 0;
  let budget = (bm ? Number(bm[2]) : 50) + 10 + ((crm.length || auto.length) ? 10 : 0) + (hiring ? 5 : 0);
  budget = Math.min(100, budget);
  let automation = (bm ? Number(bm[3]) : 0) + (crm.length ? 20 : 0) + (auto.length ? 20 : 0);
  automation = Math.min(100, automation);

  const searchText = [r.company_name, r.industry, r.funding_stage, r.location_raw, metaDesc, detected.join(' ')].join(' ').toLowerCase();
  let final = Math.round(weights.icp_fit * icp + weights.budget_proxy * budget + weights.automation_need * automation + weights.timezone_fit * tz);
  if (boost.enabled && includesAny(searchText, boost.keywords)) final = Math.min(100, final + Number(boost.bonus || 0));

  row.tech_stack = detected.join(', ');
  row.funding_proxy_score = budget;
  row.automation_need_score = automation;
  row.final_score = final;
  row.priority = final >= Number(cfg.priority_score || 80);
  row.score_breakdown = 'icp=' + icp + '; budget=' + budget + '; automation=' + automation + '; timezone=' + tz +
    '; enrich=website:ok,stack:' + detected.length + (hiring ? ',hiring:1' : '') + (contact ? ',contact:1' : '');
  row.why_match = [r.why_match, 'enrichment: website live' + (crm.length ? '; crm: ' + crm.join('/') : '') + (auto.length ? '; tools: ' + auto.join('/') : '') + (hiring ? '; hiring page' : '')].filter(Boolean).join('; ');
  row.confidence = detected.length ? 75 : 70;
  row.linkedin_url = linkedin;
  row.enrichment_status = 'enriched';
  out.push({ json: row });
});

return out;