const safeAll = (name) => { try { return $(name).all().map(i => i.json); } catch (e) { return []; } };
const cfg = $('Load Config').first().json.config || {};
const C = cfg.clay || {};
// Enrich Companies first: its rows are fresher than the sheet read, and the stats item rides along
const items = [...safeAll('Fetch Accounts For Clay'), ...safeAll('Add Enrich Stats')];
const statsItem = items.find(r => r && r.__row_type === 'stats');
const accountRows = items.filter(r => r && r.account_id && r.domain);

const base = statsItem ? JSON.parse(JSON.stringify(statsItem)) : { __row_type: 'stats', stats: {} };
base.stats = base.stats || {};

if (C.enabled === false) {
  base.stats.clay = { queued: 0, merged: 0, skipped: 'clay disabled by config' };
  return [{ json: base }];
}

const minScore = Number(C.min_score_for_clay || 65);
const cap = Math.max(1, Number(C.max_rows_per_run || 10));

// Only website-verified, never-queued, score-qualified accounts burn Clay credits
const seenIds = new Set();
const uniqueAccounts = accountRows.filter(r => {
  if (seenIds.has(r.account_id)) return false;
  seenIds.add(r.account_id);
  return true;
});
const eligible = uniqueAccounts.filter(r =>
  String(r.status || '') !== 'rejected' &&
  String(r.clay_status || '').trim() === '' &&
  String(r.enrichment_status || '') === 'enriched' &&
  Number(r.final_score || 0) >= minScore &&
  // S15 (ADR-118): the directory profile already gives services, tier and languages
  !(String(r.lead_track || '') === 'agency_partner' && ((cfg.lead_tracks || {}).agency_partner || {}).clay_research === false)
);

const queued = eligible.slice(0, cap).map(r => ({
  json: {
    queued_at: new Date().toISOString(),
    account_id: r.account_id,
    domain: r.domain,
    company_name: r.company_name,
    website: r.website,
    linkedin_url: r.linkedin_url || '',
    final_score: r.final_score,
    tech_stack_n8n: r.tech_stack || '',
    clay_status: 'queued'
  }
}));

base.stats.all_accounts = uniqueAccounts;

base.stats.clay = {
  queued: queued.length,
  merged: 0,
  eligible: eligible.length,
  skipped_over_cap: Math.max(0, eligible.length - cap)
};
return queued.concat([{ json: base }]);