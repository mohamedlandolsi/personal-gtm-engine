// Sprint 15 Phase 2: add the lead-track config keys (plan section 7, D1 to D7 at their defaults,
// gig sources changed by the Phase 0 spike). Adds keys only: an existing key is never overwritten.
//   example: node scripts/s15/phase2_config.mjs example        (updates config/config.example.json)
//   neon:    node scripts/s15/phase2_config.mjs neon           (reads the active config, saves a new version
//            through gtm_save_config() with note "S15 lead tracks"; needs PROD_URL, production endpoint only)
//   dry run: node scripts/s15/phase2_config.mjs neon --dry     (prints the keys it would add)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const PROD_ENDPOINT = 'ep-little-hall-b93smd6i';

export const S15 = {
  offers: [
    { id: 'n8n_fix_build', label: 'Fix or build one n8n workflow, fixed scope', match: ['n8n', 'workflow', 'webhook', 'automation', 'api'] },
    { id: 'clay_table_build', label: 'One Clay enrichment table wired to your CRM', match: ['clay', 'enrichment', 'waterfall', 'lead list'] },
    { id: 'hubspot_cleanup', label: 'HubSpot cleanup: dedupe, properties, pipeline', match: ['hubspot', 'crm', 'dedupe', 'pipeline', 'import'] },
    { id: 'white_label_overflow', label: 'Scoped build tasks from your client work, under your brand', match: ['agency', 'white label', 'overflow', 'subcontract'] }
  ],
  lead_tracks: {
    smb_direct: { enabled: true },
    agency_partner: {
      enabled: true,
      allowed_utc_offsets: [-5, -4, 0, 1, 2, 3, 4],                       // D1
      employee_max: 25,
      allow_unknown_size: true,
      exclude_tiers: ['clay:elite studio', 'n8n:enterprise', 'make:platinum'],
      exclude_pricing: ['10k-a-month'],                                    // Phase 0: "$10k+ a month" partners are not boutiques
      required_languages: ['english'],
      stack_keywords: ['n8n', 'clay', 'hubspot', 'apollo', 'revops', 'crm', 'enrichment', 'outbound', 'workflow automation'],
      min_account_score: 60,
      skip_small_team_gate: true,
      skip_product_overlap_gate: true,
      clay_research: false,                                                // ADR-118
      cta: 'Open to sending one small scoped task so you can judge the work?',
      proof_points: [
        'Built an n8n and Clay outbound engine with deterministic gates, an LLM fallback chain, a review console and HubSpot sync',
        'Six months building GTM workflows at a Berlin B2B SaaS startup (FastAPI, Supabase, LLM routing, Apify, Tavily)'
      ]
    },
    gig_post: {
      enabled: true,
      proof_points: [
        'Public repo: Personal GTM Engine (n8n, Clay, Neon, HubSpot)',
        'Public repo: Job Radar (n8n job intelligence workflow)'
      ]
    }
  },
  outreach: { signature_link: 'https://mohamedlandolsi.tech' },          // D3
  sources: {
    partner_directories: {
      enabled: true,
      max_profiles_per_run: 10,                                            // pilot value; raise to 40 after the first run
      politeness_ms: 1500,
      clay: { enabled: true, max_pages: 7, base: 'https://www.clay.com', list_path: '/en/experts', profile_path: '/en/experts/partner/' },
      n8n: { enabled: true, max_pages: 2, base: 'https://experts.n8n.io', list_path: '/', profile_path: '/partner/' },
      make: { enabled: false, max_pages: 5 }                               // D2; no-go for automation (Phase 0)
    }
  },
  gig: {
    enabled: true,
    sources: {
      // Phase 0: the forums forbid automated access, so posts arrive as the forum's own notification
      // emails (Jobs category set to "Watching First Post"), labelled by a Gmail filter.
      forum_mail: { enabled: true, gmail_query: 'label:gtm-gigs newer_than:4d', max_messages: 30, hosts: ['community.n8n.io'] },
      manual: { enabled: true },                                           // posts added on the console Gigs page
      hn_freelancer: { enabled: false, title_match: 'Freelancer? Seeking freelancer?' }   // 0 hiring posts in 4 months
    },
    politeness_ms: 1500,
    max_age_hours: 72,
    max_replies: 25,
    min_score: 60,
    max_drafts_per_run: 2,                                                 // pilot value; plan target 6
    discord_ping_min_score: 75,                                            // D4
    min_hourly_usd: null,                                                  // D5
    reply_words: { min: 60, max: 130 },
    stack_keywords: ['n8n', 'clay', 'hubspot', 'apollo', 'crm', 'webhook', 'api', 'enrichment', 'lead generation', 'outbound', 'supabase', 'postgres', 'google sheets', 'automation'],
    my_stack: ['n8n', 'Clay', 'HubSpot', 'Apollo', 'Apify', 'Tavily', 'Supabase', 'Postgres', 'Neon', 'FastAPI', 'Python', 'JavaScript', 'Next.js', 'Google Sheets', 'webhooks', 'REST APIs', 'LLM APIs'],   // D6
    portfolio_links: ['https://mohamedlandolsi.tech', 'https://github.com/mohamedlandolsi/personal-gtm-engine', 'https://github.com/mohamedlandolsi/job-radar'],
    veto_keywords: ['unpaid', 'equity only', 'rev share only', 'german-speaking', 'german speaking', 'spanish-speaking', 'native french', 'us only', 'usa only', 'us-based only', 'india only', 'crypto', 'casino', 'adult'],
    console_url: 'https://personal-gtm-engine.vercel.app'
  }
};

// Adds missing keys from src into dst, recursing into plain objects. Arrays and existing values are kept.
export function addMissing(dst, src, at = '', added = []) {
  for (const [k, v] of Object.entries(src)) {
    const p = at ? at + '.' + k : k;
    if (!(k in dst)) { dst[k] = v; added.push(p); }
    else if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) addMissing(dst[k], v, p, added);
  }
  return added;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
const [mode, flag] = isMain ? process.argv.slice(2) : ['__import__'];
if (mode === '__import__') { /* imported by a test: export only */ }
else if (mode === 'example') {
  const p = 'config/config.example.json';
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const added = addMissing(j, S15);
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  console.log('example: added ' + added.join(', '));
} else if (mode === 'neon') {
  const url = process.env.PROD_URL || '';
  if (!url || !new URL(url).hostname.startsWith(PROD_ENDPOINT)) { console.error('Refusing: PROD_URL is not the production endpoint'); process.exit(2); }
  const req = createRequire(path.resolve('gtm-console', 'package.json'));
  const mod = await import(pathToFileURL(req.resolve('@neondatabase/serverless')).href);
  const { Client, neonConfig } = mod.Client ? mod : mod.default;
  if (typeof WebSocket !== 'undefined') neonConfig.webSocketConstructor = WebSocket;
  const c = new Client({ connectionString: url }); await c.connect();
  try {
    const cur = (await c.query('select id, rev, payload_text from config_versions order by id desc limit 1')).rows[0];
    const j = JSON.parse(cur.payload_text);
    const added = addMissing(j, S15);
    if (!added.length) { console.log('nothing to add; active rev ' + cur.rev); }
    else {
      const d = new Date(); const pad = (n) => String(n).padStart(2, '0');
      j.rev = `console-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
      const text = JSON.stringify(j, null, 4);
      console.log('from rev ' + cur.rev + ' to ' + j.rev + '; adds ' + added.join(', '));
      if (flag !== '--dry') {
        const id = (await c.query(`select gtm_save_config($1, $2, 'claude_code') as id`, [text, 'S15 lead tracks'])).rows[0].id;
        console.log('saved config_versions.id ' + id);
      }
    }
  } finally { await c.end(); }
} else { console.error('usage: example | neon [--dry]'); process.exit(2); }
