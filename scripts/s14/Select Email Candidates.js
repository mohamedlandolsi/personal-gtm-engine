// Picks contacts for the Clay table "Contacts Email".
//   find   = no email yet, account final_score >= MIN_ACCOUNT_SCORE, one contact per account
//   verify = email_status 'guessed' (any score): a validator checks the address we already have
// Sprint 14 patch: find rows now pass the same free gates as the drafter, so Clay credits are never spent
// on a person the engine will not write to (blocked or vetoed account, small team without trigger, weak buying role).
const MIN_ACCOUNT_SCORE = 72;   // normal gate on the Clay Free plan (was 65 on the trial's last day)
const MAX_ROWS = 25;            // kill switch: set to 0 and nothing is queued
const SMALL_TEAM = 10;          // keep equal to config outreach.small_team_no_trigger
const MIN_BUYER = 60;           // keep equal to config outreach.min_buyer_score

const safeAll = (n) => { try { return $(n).all().map(i => i.json); } catch (e) { return []; } };
const norm = (d) => String(d || '').toLowerCase().trim()
  .replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
// Removes accents so email patterns work: "Léonard" -> "Leonard"
const ascii = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const STATUS_RANK = { used_in_outreach: 0, new: 1 };

// Same rules as Select Outreach Pairs (Sprint 14, guide Phase 2). Keep them identical.
const buyerScore = (title) => {
  const t = String(title || '').toLowerCase();
  if (/\bceo\b|chief executive|managing director|general manager|gerente|directeur g.n.ral|gesch.ftsf.hrer/.test(t)) return 100;
  if (/\bcto\b|chief technology|engineer|engineering|head of product|chief product|\bcpo\b|developer|technical|scientist/.test(t)) return 30;
  if (/\bcoo\b|chief operating|\bcro\b|chief revenue|head of (?:growth|revops|revenue operations|operations|sales|marketing)|vp,? (?:sales|marketing|growth)|revops|sales ops|marketing ops/.test(t)) return 90;
  if (/\b(?:co-?)?founder\b|fundador|fondat|gr.nder/.test(t)) return 70;
  return 40;
};
const TRIGGER_TYPES = ['hiring', 'funding', 'news', 'launch'];
const validTrigger = (a) => {
  const type = String(a.clay_trigger_source || '').toLowerCase();
  const text = String(a.clay_trigger || '').trim();
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(String(a.clay_trigger_date || ''));
  const role = /hiring|account executive|\bsdr\b|\bbdr\b|revops|operations|\bops\b|sales|marketing|growth|\bgtm\b|manager|head of|lead/i.test(text);
  return !!text && TRIGGER_TYPES.includes(type) && (dated || (type === 'hiring' && role));
};

const acct = {};
for (const a of safeAll('Read Accounts')) {
  const d = norm(a.domain);
  if (d) acct[d] = a;
}
const scoreOf = (d) => Number((acct[d] || {}).final_score) || 0;
// Neon v_outreach_blocks: vetoed accounts and accounts with a rejected draft (scope account, or pitch with no newer trigger)
const blocked = new Set(safeAll('Fetch Outreach Blocks').map(r => String(r.account_id || '')).filter(Boolean));
const queueRows = safeAll('Read Email Queue').filter(r => r && r.contact_id);
const queuedIds = new Set(queueRows.map(r => String(r.contact_id).trim()));
const queuedFindDomains = new Set(queueRows.filter(r => r.mode === 'find').map(r => norm(r.domain)));

const stats = { contacts: 0, queued_find: 0, queued_verify: 0, skipped_rejected: 0, skipped_low_score: 0,
  skipped_already_queued: 0, skipped_extra_per_account: 0, skipped_cap: 0,
  skipped_blocked: 0, skipped_small_no_trigger: 0, skipped_low_buyer_role: 0 };
const verify = [];
const byAccount = {};

for (const c of safeAll('Read Contacts')) {
  if (!c || !c.contact_id) continue;
  stats.contacts++;
  const status = String(c.status || '').toLowerCase();
  const email = String(c.email || '').trim();
  const es = String(c.email_status || '').toLowerCase();
  if (status === 'rejected') { stats.skipped_rejected++; continue; }
  if (queuedIds.has(String(c.contact_id).trim())) { stats.skipped_already_queued++; continue; }
  const d = norm(c.domain || c.account_domain);
  const a = acct[d] || {};
  if (blocked.has(String(c.account_id || a.account_id || '')) || String(a.status || '').toLowerCase() === 'rejected') { stats.skipped_blocked++; continue; }
  if (email && es === 'guessed') { verify.push(c); continue; }
  if (email) continue;                                   // verified emails are never touched
  if (scoreOf(d) < MIN_ACCOUNT_SCORE) { stats.skipped_low_score++; continue; }
  const emp = Number(a.employee_count || 0);
  if (emp > 0 && emp < SMALL_TEAM && !validTrigger(a)) { stats.skipped_small_no_trigger++; continue; }
  if (buyerScore(c.title) < MIN_BUYER) { stats.skipped_low_buyer_role++; continue; }
  (byAccount[d] = byAccount[d] || []).push(c);
}

const find = [];
for (const [d, list] of Object.entries(byAccount)) {
  if (queuedFindDomains.has(d)) { stats.skipped_extra_per_account += list.length; continue; }
  // Same person the drafter would pick: strongest buying role first, then status, then contact score
  list.sort((a, b) =>
    buyerScore(b.title) - buyerScore(a.title) ||
    (STATUS_RANK[String(a.status).toLowerCase()] ?? 9) - (STATUS_RANK[String(b.status).toLowerCase()] ?? 9) ||
    (Number(b.contact_score) || 0) - (Number(a.contact_score) || 0) ||
    String(a.contact_id).localeCompare(String(b.contact_id)));
  find.push(list[0]);
  stats.skipped_extra_per_account += list.length - 1;
}
// When the cap bites, keep the highest-scoring accounts; the rest are queued on the next run
find.sort((a, b) => scoreOf(norm(b.domain || b.account_domain)) - scoreOf(norm(a.domain || a.account_domain)));

const now = new Date().toISOString();
const toRow = (c, mode) => {
  const parts = ascii(c.full_name).replace(/[^A-Za-z\s'-]/g, ' ').split(/\s+/).filter(Boolean);
  return { json: {
    queued_at: now,
    contact_id: c.contact_id,
    account_id: c.account_id || '',
    domain: norm(c.domain || c.account_domain),
    company_name: c.company_name || '',
    full_name: c.full_name || '',
    first_name: (parts[0] || '').toLowerCase(),
    last_name: parts.slice(1).join('').toLowerCase(),   // "van den Ingh" -> "vandeningh"
    title: c.title || '',
    linkedin_url: c.linkedin_url || '',
    current_email: c.email || '',
    current_email_status: c.email_status || '',
    contact_score: Number(c.contact_score) || 0,
    mode,
    clay_status: 'queued'
  } };
};

const all = verify.map(c => toRow(c, 'verify')).concat(find.map(c => toRow(c, 'find')));
const out = all.slice(0, Math.max(0, MAX_ROWS));
stats.skipped_cap = all.length - out.length;
stats.queued_verify = out.filter(r => r.json.mode === 'verify').length;
stats.queued_find = out.length - stats.queued_verify;

// The stats item has no contact_id, so the Filter drops it. Read it in this node's output.
return out.concat([{ json: { __stats: JSON.stringify(stats) } }]);
