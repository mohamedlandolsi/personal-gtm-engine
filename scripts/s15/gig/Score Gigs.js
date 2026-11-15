// Score Gigs (Code node, Run Once for All Items). Sprint 15.
// Scores every post that passed Gig Gates (0 to 100, written to score_breakdown) and packs all posts,
// gated ones included, into one item for Upsert Gig Posts. Also hands the draft and expiry parameters on.
//   gig_score = 0.35*stack_fit + 0.20*intent + 0.15*freshness + 0.15*competition + 0.10*budget_signal + 0.05*remote_fit (+10 bonus)
const cfg = $('Load Config').first().json.config || {};
const G = cfg.gig || {};
const T = (cfg.lead_tracks || {}).gig_post || {};
const MIN_RATE = G.min_hourly_usd === null || G.min_hourly_usd === undefined || G.min_hourly_usd === '' ? null : Number(G.min_hourly_usd);

const items = $input.all().map(i => i.json);
const stats = Object.assign({}, (items.find(j => j.__gate_stats) || {}).__gate_stats || {});
const notes = (items.find(j => j.__source_notes) || {}).__source_notes || [];
const posts = items.filter(j => j && j.post_key);

const BONUS = /\bagency\b|our clients|white[- ]label|\bongoing\b|long[- ]term|retainer|more work|future projects/i;
const PAID_TRIAL = /paid (trial|test|task)|trial task/i;

let scored = 0;
const packed = posts.map(p => {
  const row = Object.assign({}, p);
  if (row.status === 'new') {
    const n = String(row.matched_stack || '').split(',').map(s => s.trim()).filter(Boolean).length;
    const stack = n >= 3 ? 100 : n === 2 ? 75 : n === 1 ? 50 : 25;           // 25: passed on a stack keyword only
    const intent = row.intent === 'hiring' ? 100 : 40;
    const age = row.__age_h;
    const fresh = age === null ? 50 : age < 12 ? 100 : age < 24 ? 80 : age < 48 ? 50 : 20;
    const r = row.reply_count;
    const comp = r === null ? 70 : r <= 3 ? 100 : r <= 10 ? 70 : 40;          // unknown replies (mail source) = 70
    const text = row.title + '\n' + row.body_text;
    const budget = PAID_TRIAL.test(text) || (row.__rate_usd !== null && (MIN_RATE === null || row.__rate_usd >= MIN_RATE)) ? 100 : 50;
    const remote = row.remote_hint ? 100 : 60;
    const bonus = BONUS.test(text) ? 10 : 0;
    const total = Math.max(0, Math.min(100, Math.round(0.35 * stack + 0.20 * intent + 0.15 * fresh + 0.15 * comp + 0.10 * budget + 0.05 * remote + bonus)));
    row.gig_score = total;
    row.score_breakdown = `stack=${stack} intent=${intent} fresh=${fresh} comp=${comp} budget=${budget} remote=${remote} bonus=${bonus} -> ${total}`;
    scored++;
  } else {
    row.gig_score = null;
    row.score_breakdown = '';
  }
  for (const k of Object.keys(row)) if (k.startsWith('__')) delete row[k];
  return row;
});
stats.scored = scored;

const on = G.enabled !== false && T.enabled !== false;
const minScore = Number(G.min_score ?? 60);
const maxAge = Number(G.max_age_hours ?? 72);
const maxDrafts = on ? Math.max(0, Math.min(20, Number(G.max_drafts_per_run ?? 2))) : 0;

return [{ json: {
  posts: packed,
  stats,
  source_notes: notes,
  draft_params: [minScore, maxAge, maxDrafts],
  expire_hours: Math.max(1, maxAge * 2),
  enabled: on
} }];
