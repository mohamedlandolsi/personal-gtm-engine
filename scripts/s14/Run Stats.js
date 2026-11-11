const pkg = $input.first().json;
const stats = pkg.stats || {};
const enr = stats.enrichment || {};
const clay = stats.clay || {};

let rev = 'unknown';
try { rev = ($('Load Config').first().json.config || {}).rev || 'unknown'; } catch (e) { /* keep unknown */ }
let minScore = 0;
try { minScore = Number(($('Load Config').first().json.config || {}).min_account_score || 0); } catch (e) { minScore = 0; }

const rejections = Object.entries(stats.rejected || {})
  .filter(([k, v]) => v > 0)
  .map(([k, v]) => `${k}:${v}`)
  .join(' | ');

// Sprint 14: outreach skip counters and needs_redraft go into rejection_summary as outreach_<key>:<n>.
const outreachCounters = Object.entries(stats.outreach || {})
  .filter(([k, v]) => (k.startsWith('skipped_') || k === 'needs_redraft') && typeof v === 'number' && v > 0)
  .map(([k, v]) => `outreach_${k}:${v}`)
  .join(' | ');

return [{
  json: {
    run_at: stats.run_at || new Date().toISOString(),
    config_rev: stats.config_rev || rev,
    source: Object.keys(stats.sources || {}).join('+') || 'seed_accounts',
    seed_rows: stats.seed_rows || 0,
    seen_rows_pre: stats.seen_rows_pre || 0,
    after_filters: stats.after_filters || 0,
    accounts_written: stats.accounts_written || 0,
    min_account_score: minScore,
    warnings: stats.warnings || '',
    errors_sample: stats.errors_sample || '',
    apollo_companies: stats.apollo_companies || 0,
    source_errors: (stats.source_errors || []).join(' | '),
    rejection_summary: [rejections, stats.below_min_score ? 'below_min_score:' + stats.below_min_score : '', outreachCounters].filter(Boolean).join(' | ') || 'none',
    enriched_rows: enr.rows || 0,
    enrich_errors: (enr.errors || []).join(' | '),
    clay_queued: clay.queued || 0,
    clay_merged: clay.merged || 0,
    contacts_discovered: (stats.contacts || {}).discovered || 0,
    contacts_written: (stats.contacts || {}).written || 0,
    outreach_drafts_written: (stats.outreach || {}).drafted || 0,
    llm_calls: (stats.outreach || {}).llm_calls || 0,
    llm_failures: (stats.outreach || {}).llm_failures || 0
    
  }
}];