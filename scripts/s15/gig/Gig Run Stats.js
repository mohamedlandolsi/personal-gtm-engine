// Gig Run Stats (Code node, Run Once for All Items). Sprint 15.
// Builds the one gig_ops row for this run from the gate counters, the upsert and expiry results and the
// drafting stats. Write Gig Ops inserts it. Read it on the console Runs page (gig_ops tab).
const safeFirst = (name) => { try { return $(name).first().json || {}; } catch (e) { return {}; } };
const safeAll = (name) => { try { return $(name).all().map(i => i.json); } catch (e) { return []; } };
const cfg = safeFirst('Load Config').config || {};
const score = safeFirst('Score Gigs');
const gates = score.stats || {};
const upsert = (safeFirst('Upsert Gig Posts').result) || {};
const expire = (safeFirst('Expire Old Gigs').result) || {};
const dstats = ($input.first().json || {}).__stats || {};
const pinged = safeAll('Hot Gig Ping').length;

const errors = (score.source_notes || []).filter(s => /^ERROR /.test(String(s)));
if (dstats.llm_failures) errors.push('llm_failures=' + dstats.llm_failures);
if (dstats.left_for_next_run) errors.push('run_budget_hit: ' + dstats.left_for_next_run + ' left');

const now = new Date();
const row = {
  run_id: 'gig_' + now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '_' + Math.random().toString(36).slice(2, 6),
  run_at: now.toISOString(),
  config_rev: String(cfg.rev || ''),
  fetched: Number(gates.fetched || 0),
  intent_for_hire: Number(gates.intent_for_hire || 0),
  intent_unclear: Number(gates.intent_unclear || 0),
  stale: Number(gates.stale || 0),
  crowded: Number(gates.crowded || 0),
  vetoed: Number(gates.vetoed || 0),
  stack_miss: Number(gates.stack_miss || 0),
  budget_low: Number(gates.budget_low || 0),
  already_seen: Number(gates.already_seen || 0),
  scored: Number(gates.scored || 0),
  drafted: Number(dstats.drafted || 0),
  pinged,
  expired: Number(expire.expired || 0),
  errors: errors.join(' | ').slice(0, 1000),
  source_stats: JSON.stringify({
    sources: score.source_notes || [],
    upsert: { inserted: Number(upsert.inserted || 0), updated: Number(upsert.updated || 0) },
    superseded: Number(expire.superseded || 0),
    drafts: { pending: Number(dstats.pending || 0), needs_redraft: Number(dstats.needs_redraft || 0), candidates: Number(dstats.candidates || 0) },
    llm: { calls: Number(dstats.llm_calls || 0), failures: Number(dstats.llm_failures || 0) }
  }).slice(0, 4000)
};
return [{ json: row }];
