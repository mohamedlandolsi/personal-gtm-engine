const safeAll = (name) => { try { return $(name).all().map(i => i.json); } catch (e) { return []; } };
const cfg = $('Load Config').first().json.config || {};
const O = cfg.outreach || {};
const C = cfg.contact || {};
const P = cfg.priority || {};

// ---- Sprint 14 rules (copied from the guide, Phase 2) ----
// Fix 3: buying-role score from the title. CEO first, then technical words win over "founder".
const buyerScore = (title) => {
  const t = String(title || '').toLowerCase();
  if (/\bceo\b|chief executive|managing director|general manager|gerente|directeur g.n.ral|gesch.ftsf.hrer/.test(t)) return 100;
  if (/\bcto\b|chief technology|engineer|engineering|head of product|chief product|\bcpo\b|developer|technical|scientist/.test(t)) return 30;
  if (/\bcoo\b|chief operating|\bcro\b|chief revenue|head of (?:growth|revops|revenue operations|operations|sales|marketing)|vp,? (?:sales|marketing|growth)|revops|sales ops|marketing ops/.test(t)) return 90;
  if (/\b(?:co-?)?founder\b|fundador|fondat|gr.nder/.test(t)) return 70;
  return 40;
};

// Fix 6: a trigger counts only if it is an event of a known type, dated, or a named hiring role.
const TRIGGER_TYPES = ['hiring', 'funding', 'news', 'launch'];
const validTrigger = (a) => {
  const type = String(a.clay_trigger_source || '').toLowerCase();
  const text = String(a.clay_trigger || '').trim();
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(String(a.clay_trigger_date || ''));
  const role = /hiring|account executive|\bsdr\b|\bbdr\b|revops|operations|\bops\b|sales|marketing|growth|\bgtm\b|manager|head of|lead/i.test(text);
  return !!text && TRIGGER_TYPES.includes(type) && (dated || (type === 'hiring' && role));
};

// Fix 10: region is a sort preference, not part of final_score (ADR-109).
const EU_UK = ['austria','belgium','bulgaria','croatia','cyprus','czechia','czech republic','denmark','estonia','finland','france','germany','greece','hungary','ireland','italy','latvia','lithuania','luxembourg','malta','netherlands','poland','portugal','romania','slovakia','slovenia','spain','sweden','united kingdom','norway','iceland','liechtenstein','switzerland'];
// ---- end of Sprint 14 rules ----

const statsRows = safeAll('Rescore Accounts').filter(r => r && r.__row_type === 'stats');
const base = statsRows.length ? JSON.parse(JSON.stringify(statsRows[0])) : { __row_type: 'stats', stats: {} };
base.stats = base.stats || {};
const finish = (pairs, o) => {
  base.stats.outreach = Object.assign({ pairs: pairs.length, drafted: 0, llm_calls: 0, llm_failures: 0 }, o || {});
  return pairs.concat([{ json: base }]);
};

// Gate 0: kill switch (stats item still travels so Run Stats never dies)
if (O.enabled === false || (O.llm && O.llm.enabled === false)) return finish([], { skipped: 'outreach disabled by config' });

const minAcct = Number(O.min_account_score || cfg.min_account_score || 65);
const minContact = Number(O.min_contact_score || C.min_contact_score || 60);
const perRun = Math.max(1, Number(O.max_pairs_per_run || 4));
const perDay = Math.max(1, Number(O.max_per_day || 10));
// How many people at one company may have a live draft at the same time. 1 = never message two founders at once.
const perAccount = Math.max(1, Number(O.max_contacts_per_account || 1));
const verified = (O.email_verified_statuses || ['verified', 'valid']).map(s => String(s).toLowerCase());
const allowGuessed = O.allow_guessed_email_channel === true;
const genericPrefixes = (C.generic_email_prefixes || []).map(s => String(s).toLowerCase());
const rolesExclude = (C.roles_exclude || []).map(s => String(s).toLowerCase());

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

// Queue = the ledger. 'superseded' rows no longer block a re-draft.
const queue = safeAll('Fetch Outreach Queue').filter(r => r && r.contact_id);
const statusOf = r => String(r.approval_status || '').toLowerCase();
const doneSet = new Set(queue.filter(r => statusOf(r) !== 'superseded').map(r => String(r.contact_id)));
const today = new Date().toISOString().slice(0, 10);
const draftedToday = queue.filter(r => String(r.run_date || '').slice(0, 10) === today && statusOf(r) !== 'superseded').length;
const room = perDay - draftedToday;
if (room <= 0) return finish([], { skipped: 'daily cap reached (' + draftedToday + '/' + perDay + ')' });
const cap = Math.min(perRun, room);

// Live drafts per company: anything not superseded and not rejected (pending, edited, approved, sent).
const liveByAccount = {};
for (const r of queue) {
  const st = statusOf(r);
  if (st === 'superseded' || st === 'rejected') continue;
  const k = String(r.account_id || '');
  if (k) liveByAccount[k] = (liveByAccount[k] || 0) + 1;
}

const accounts = {};
for (const a of safeAll('Fetch Accounts For Outreach')) if (a && a.account_id) accounts[String(a.account_id)] = a;

const sk = { account: 0, rejected: 0, role: 0, channel: 0, per_account: 0, blocked: 0, blocked_by_reason: {}, stale: 0, low_buyer_role: 0, small_no_trigger: 0 };
const pairs = [];
// Sprint 14 order: newest accounts first (Fix 2), then account score plus region bonus (Fix 10, ADR-109),
// then buying role (Fix 3), then contact score. The per-company cap keeps the strongest buyer.
const acctOf = (c) => accounts[String(c.account_id)] || {};
const contacts = safeAll('Fetch Contacts For Outreach')
  .filter(c => c && c.contact_id && String(c.status || 'new') === 'new' && Number(c.contact_score || 0) >= minContact && !doneSet.has(String(c.contact_id)))
  .sort((x, y) =>
    dayOf(acctOf(y).run_date).localeCompare(dayOf(acctOf(x).run_date)) ||
    (Number(acctOf(y).final_score || 0) + regionBonus(acctOf(y))) - (Number(acctOf(x).final_score || 0) + regionBonus(acctOf(x))) ||
    buyerScore(y.title) - buyerScore(x.title) ||
    Number(y.contact_score || 0) - Number(x.contact_score || 0));

for (const c of contacts) {
  // Fix 1: a blocked account gets no new draft, whoever the contact is.
  const blockReason = blocked.get(String(c.account_id || ''));
  if (blockReason) { sk.blocked++; sk.blocked_by_reason[blockReason] = (sk.blocked_by_reason[blockReason] || 0) + 1; continue; }
  const a = accounts[String(c.account_id || '')];
  if (!a || String(a.contact_status || '') !== 'contacts_done' || Number(a.final_score || 0) < minAcct) { sk.account++; continue; }
  if (String(a.status || '').toLowerCase() === 'rejected') { sk.rejected++; continue; }
  if ((liveByAccount[String(a.account_id)] || 0) >= perAccount) { sk.per_account++; continue; }
  const title = String(c.title || '').toLowerCase();
  if (rolesExclude.some(r => title.includes(r))) { sk.role++; continue; }
  // Sprint 14: contact found too long ago, weak buying role, or a small team with no valid trigger. No row is written,
  // so the pair is re-checked next run at no cost.
  const foundAt = Date.parse(String(c.run_date || ''));
  if (maxAgeDays > 0 && !isNaN(foundAt) && (Date.now() - foundAt) > maxAgeDays * 86400000) { sk.stale++; continue; }
  const buyer = buyerScore(c.title);
  if (buyer < minBuyer) { sk.low_buyer_role++; continue; }
  const emp = Number(a.employee_count || 0);
  const triggerOk = validTrigger(a);
  if (emp > 0 && emp < smallTeam && !triggerOk) { sk.small_no_trigger++; continue; }

  const email = String(c.email || '').trim().toLowerCase();
  const isGeneric = genericPrefixes.some(p => email.startsWith(p));
  const emailStatus = String(c.email_status || '').toLowerCase();
  const emailOk = !!email && !isGeneric;
  const flags = [];
    // The finder could not confirm this person works at this company (name match only)
  if (/unverified/i.test(String(c.source || ''))) flags.push('contact_unverified');
  let channel = '';
  if (emailOk && verified.includes(emailStatus)) channel = 'email';
  else if (String(c.linkedin_url || '').trim()) { channel = 'linkedin_manual'; if (emailOk) flags.push('email_' + (emailStatus || 'unknown') + '_not_used'); }
  else if (emailOk && allowGuessed) { channel = 'email'; flags.push('email_unverified'); }
  if (!channel) { sk.channel++; continue; }

  liveByAccount[String(a.account_id)] = (liveByAccount[String(a.account_id)] || 0) + 1;
  pairs.push({ json: {
    outreach_pair: true, channel, flags: flags.join(','),
    contact_id: c.contact_id, account_id: a.account_id,
    company_name: a.company_name || c.company_name, domain: c.domain || a.domain,
    industry: a.industry, employee_count: a.employee_count, funding_stage: a.funding_stage,
    tech_stack: a.tech_stack, clay_summary: a.clay_summary, why_match: a.why_match, account_score: a.final_score,
    clay_trigger: a.clay_trigger || '', clay_trigger_source: a.clay_trigger_source || '',
    // Sprint 14: facts for the Draft Outreach gates and the angle
    buyer_score: buyer, region_bonus: regionBonus(a), account_run_date: dayOf(a.run_date),
    company_type: a.company_type || '', website: a.website || '',
    trigger_ok: triggerOk, trigger_type: String(a.clay_trigger_source || '').toLowerCase(), trigger_date: String(a.clay_trigger_date || ''),
    full_name: c.full_name, title: c.title, role_category: c.role_category,
    email: c.email, linkedin_url: c.linkedin_url, contact_score: c.contact_score
  } });
  if (pairs.length >= cap) break;
}
return finish(pairs, { skipped_account_not_done: sk.account, skipped_account_rejected: sk.rejected, skipped_per_account_cap: sk.per_account, skipped_role: sk.role, skipped_no_safe_channel: sk.channel, skipped_blocked: sk.blocked, blocked_by_reason: sk.blocked_by_reason, skipped_stale: sk.stale, skipped_low_buyer_role: sk.low_buyer_role, skipped_small_no_trigger: sk.small_no_trigger, drafted_today_before: draftedToday });