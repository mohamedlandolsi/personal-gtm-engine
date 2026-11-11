// Sprint 14 Phase 2 (draft selection): build the 4 new Code node bodies from the LIVE bodies plus the guide blocks.
// Usage: node scripts/s14/build_phase2.mjs <dir with the live node bodies>
// Output: scripts/s14/Select Outreach Pairs.js, Merge Contact Results.js, Select Contact Batch.js, Run Stats.js
import path from 'node:path';
import { read, once, save } from './lib_patch.mjs';

const live = process.argv[2];
const out = path.resolve('scripts/s14');
const rules = read(path.join(out, 'guide', 'phase2_rules.js'));          // buyerScore, validTrigger, EU_UK (guide, verbatim)
const euIdx = rules.indexOf('// Fix 10:');
if (euIdx < 0) throw new Error('EU_UK block not found in the guide rules');
const euBlock = rules.slice(euIdx);                                       // comment + EU_UK line (guide, verbatim)

// ---------------------------------------------------------------- Select Outreach Pairs
let s = read(path.join(live, 'Select Outreach Pairs.js'));

s = once(s, `const C = cfg.contact || {};\n`,
`const C = cfg.contact || {};
const P = cfg.priority || {};

// ---- Sprint 14 rules (copied from the guide, Phase 2) ----
${rules}// ---- end of Sprint 14 rules ----
`, 'pairs: rules');

s = once(s, `const rolesExclude = (C.roles_exclude || []).map(s => String(s).toLowerCase());\n`,
`const rolesExclude = (C.roles_exclude || []).map(s => String(s).toLowerCase());

// Sprint 14 gates: all deterministic, all before any LLM call. Defaults live here, so a missing config key never breaks a run.
const minBuyer = Number(O.min_buyer_score ?? 60);
const maxAgeDays = Number(O.max_contact_age_days ?? 30);
const smallTeam = Number(O.small_team_no_trigger ?? 10);
const regionBonusPts = Number(P.region_bonus ?? 5);
const regions = (Array.isArray(P.regions) ? P.regions : EU_UK).map(s => String(s).toLowerCase());
const regionBonus = (a) => regions.includes(String((a || {}).country || '').trim().toLowerCase()) ? regionBonusPts : 0;
const dayOf = (v) => String(v || '').slice(0, 10);
// Fix 1: accounts the drafter must skip (Neon view v_outreach_blocks): vetoed, or a rejected draft with scope account or pitch.
const blocked = new Map(safeAll('Fetch Outreach Blocks').filter(r => r && r.account_id).map(r => [String(r.account_id), String(r.reason || 'blocked')]));
`, 'pairs: config');

s = once(s, `const sk = { account: 0, rejected: 0, role: 0, channel: 0, per_account: 0 };`,
`const sk = { account: 0, rejected: 0, role: 0, channel: 0, per_account: 0, blocked: 0, blocked_by_reason: {}, stale: 0, low_buyer_role: 0, small_no_trigger: 0 };`, 'pairs: counters');

s = once(s,
`// Best account first, then best contact inside it, so the per-company cap keeps the strongest person.
const contacts = safeAll('Fetch Contacts For Outreach')`,
`// Sprint 14 order: newest accounts first (Fix 2), then account score plus region bonus (Fix 10, ADR-109),
// then buying role (Fix 3), then contact score. The per-company cap keeps the strongest buyer.
const acctOf = (c) => accounts[String(c.account_id)] || {};
const contacts = safeAll('Fetch Contacts For Outreach')`, 'pairs: sort comment');

s = once(s,
`  .sort((a, b) =>
    Number((accounts[String(b.account_id)] || {}).final_score || 0) - Number((accounts[String(a.account_id)] || {}).final_score || 0) ||
    Number(b.contact_score || 0) - Number(a.contact_score || 0));`,
`  .sort((x, y) =>
    dayOf(acctOf(y).run_date).localeCompare(dayOf(acctOf(x).run_date)) ||
    (Number(acctOf(y).final_score || 0) + regionBonus(acctOf(y))) - (Number(acctOf(x).final_score || 0) + regionBonus(acctOf(x))) ||
    buyerScore(y.title) - buyerScore(x.title) ||
    Number(y.contact_score || 0) - Number(x.contact_score || 0));`, 'pairs: sort');

s = once(s,
`for (const c of contacts) {
  const a = accounts[String(c.account_id || '')];`,
`for (const c of contacts) {
  // Fix 1: a blocked account gets no new draft, whoever the contact is.
  const blockReason = blocked.get(String(c.account_id || ''));
  if (blockReason) { sk.blocked++; sk.blocked_by_reason[blockReason] = (sk.blocked_by_reason[blockReason] || 0) + 1; continue; }
  const a = accounts[String(c.account_id || '')];`, 'pairs: blocked');

s = once(s,
`  if (rolesExclude.some(r => title.includes(r))) { sk.role++; continue; }
`,
`  if (rolesExclude.some(r => title.includes(r))) { sk.role++; continue; }
  // Sprint 14: contact found too long ago, weak buying role, or a small team with no valid trigger. No row is written,
  // so the pair is re-checked next run at no cost.
  const foundAt = Date.parse(String(c.run_date || ''));
  if (maxAgeDays > 0 && !isNaN(foundAt) && (Date.now() - foundAt) > maxAgeDays * 86400000) { sk.stale++; continue; }
  const buyer = buyerScore(c.title);
  if (buyer < minBuyer) { sk.low_buyer_role++; continue; }
  const emp = Number(a.employee_count || 0);
  const triggerOk = validTrigger(a);
  if (emp > 0 && emp < smallTeam && !triggerOk) { sk.small_no_trigger++; continue; }
`, 'pairs: gates');

s = once(s,
`    clay_trigger: a.clay_trigger || '', clay_trigger_source: a.clay_trigger_source || '',
`,
`    clay_trigger: a.clay_trigger || '', clay_trigger_source: a.clay_trigger_source || '',
    // Sprint 14: facts for the Draft Outreach gates and the angle
    buyer_score: buyer, region_bonus: regionBonus(a), account_run_date: dayOf(a.run_date),
    company_type: a.company_type || '', website: a.website || '',
    trigger_ok: triggerOk, trigger_type: String(a.clay_trigger_source || '').toLowerCase(), trigger_date: String(a.clay_trigger_date || ''),
`, 'pairs: pair fields');

s = once(s,
`skipped_no_safe_channel: sk.channel, drafted_today_before: draftedToday });`,
`skipped_no_safe_channel: sk.channel, skipped_blocked: sk.blocked, blocked_by_reason: sk.blocked_by_reason, skipped_stale: sk.stale, skipped_low_buyer_role: sk.low_buyer_role, skipped_small_no_trigger: sk.small_no_trigger, drafted_today_before: draftedToday });`, 'pairs: stats');

save(out, 'Select Outreach Pairs', s);

// ---------------------------------------------------------------- Merge Contact Results
let m = read(path.join(live, 'Merge Contact Results.js'));
m = once(m,
`  if (/\\b(?:co-?)?founder\\b|founding partner/.test(t)) return 'founder';
  if (/\\bceo\\b|chief executive/.test(t)) return 'ceo';
`,
`  // Sprint 14 (Fix 3): CEO first, so "Founder/CEO" is the buyer. A founder who is the technical lead ("Founder/CTO") ranks as cto.
  if (/\\bceo\\b|chief executive/.test(t)) return 'ceo';
  if (/\\b(?:co-?)?founder\\b|founding partner/.test(t)) return /\\bcto\\b|chief technology|technical|engineer|product/.test(t) ? 'cto' : 'founder';
`, 'merge: roleCategory');
m = once(m, `const RA = { founder: 100, ceo: 100, cto: 95,`, `const RA = { founder: 100, ceo: 100, cto: 60,`, 'merge: RA');
m = once(m, `const REL = { founder: 85, ceo: 85, cto: 80,`, `const REL = { founder: 85, ceo: 85, cto: 50,`, 'merge: REL');
save(out, 'Merge Contact Results', m);

// ---------------------------------------------------------------- Select Contact Batch
let b = read(path.join(live, 'Select Contact Batch.js'));
b = once(b, `const CC = cfg.clay_contacts || {};\n`,
`const CC = cfg.clay_contacts || {};
// Sprint 14: EU and UK accounts get contacts first. Same list and config as Select Outreach Pairs.
const P = cfg.priority || {};
${euBlock}const regionBonusPts = Number(P.region_bonus ?? 5);
const regions = (Array.isArray(P.regions) ? P.regions : EU_UK).map(s => String(s).toLowerCase());
const regionBonus = (a) => regions.includes(String((a || {}).country || '').trim().toLowerCase()) ? regionBonusPts : 0;
`, 'batch: config');
b = once(b,
`  .sort((a, b) => Number(b.final_score || 0) - Number(a.final_score || 0))`,
`  .sort((a, b) => (Number(b.final_score || 0) + regionBonus(b)) - (Number(a.final_score || 0) + regionBonus(a)))`, 'batch: sort');
save(out, 'Select Contact Batch', b);

// ---------------------------------------------------------------- Run Stats
let r = read(path.join(live, 'Run Stats.js'));
r = once(r,
`return [{
  json: {
    run_at:`,
`// Sprint 14: outreach skip counters and needs_redraft go into rejection_summary as outreach_<key>:<n>.
const outreachCounters = Object.entries(stats.outreach || {})
  .filter(([k, v]) => (k.startsWith('skipped_') || k === 'needs_redraft') && typeof v === 'number' && v > 0)
  .map(([k, v]) => \`outreach_\${k}:\${v}\`)
  .join(' | ');

return [{
  json: {
    run_at:`, 'stats: counters');
r = once(r,
`rejection_summary: [rejections, stats.below_min_score ? 'below_min_score:' + stats.below_min_score : ''].filter(Boolean).join(' | ') || 'none',`,
`rejection_summary: [rejections, stats.below_min_score ? 'below_min_score:' + stats.below_min_score : '', outreachCounters].filter(Boolean).join(' | ') || 'none',`, 'stats: summary');
save(out, 'Run Stats', r);
