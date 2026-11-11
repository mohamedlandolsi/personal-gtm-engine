const safeAll = (name) => { try { return $(name).all().map(i => i.json); } catch (e) { return []; } };
const cfg = $('Load Config').first().json.config || {};
const K = cfg.contact || {};
// Input is Select Contact Batch (carries the stats item). Person rows and seen keys are read by name,
// so the seen-guard sees them on every run.
const items = [...$input.all().map(i => i.json), ...safeAll('Fetch Contact Results'), ...safeAll('Fetch Seen Contacts')];
const statsItem = items.find(r => r && r.__row_type === 'stats');
const personRows = items.filter(r => r && !r.__row_type && String(r.full_name || '').trim() && r.domain);
const seenRows = items.filter(r => r && r.contact_key !== undefined && r.account_domain !== undefined);

const base = statsItem ? JSON.parse(JSON.stringify(statsItem)) : { __row_type: 'stats', stats: {} };
base.stats = base.stats || {};
base.stats.contacts = base.stats.contacts || { queued: 0, discovered: 0, written: 0, rejected: {} };
const stats = base.stats.contacts;
stats.discovered = personRows.length;
const rej = (k) => { stats.rejected[k] = (stats.rejected[k] || 0) + 1; };

const EXCLUDE = (K.roles_exclude || []).map(s => String(s).toLowerCase());
const GENERIC = (K.generic_email_prefixes || []);
const minContact = Number(K.min_contact_score || 60);
const maxPerCompany = Math.max(1, Number(K.max_contacts_per_company || 3));
const smallThreshold = Number(K.small_team_threshold || 50);
const preferFounder = K.prefer_founder_for_small_teams !== false;
const requireContact = K.require_email_or_linkedin !== false;
const allowedTz = (cfg.timezone || {}).allowed_utc_offsets || [0, 1, 2, 3, 4];
const acctByDomain = {};
for (const a of (base.stats.all_qualified || [])) acctByDomain[String(a.domain || '').toLowerCase()] = a;
// Accounts that already left the in-flight list still need their facts here,
// otherwise a contact added later loses its timezone points and scores too low to be drafted.
for (const a of safeAll('Fetch Qualified Accounts')) {
  const d = String((a && a.domain) || '').toLowerCase();
  if (d && a.account_id && !acctByDomain[d]) acctByDomain[d] = a;
}

function roleCategory(title) {
  const t = String(title || '').toLowerCase();
  // Sprint 14 (Fix 3): CEO first, so "Founder/CEO" is the buyer. A founder who is the technical lead ("Founder/CTO") ranks as cto.
  if (/\bceo\b|chief executive/.test(t)) return 'ceo';
  if (/\b(?:co-?)?founder\b|founding partner/.test(t)) return /\bcto\b|chief technology|technical|engineer|product/.test(t) ? 'cto' : 'founder';
  // Non-English and general-manager titles at small companies are the top decision maker (Sprint 11, 11.3: IDL Consulting)
  if (/\b(?:co-?)?fundador(?:a)?\b|\b(?:co-?)?fondat(?:eur|rice)\b|\b(?:co-?)?gr.nder(?:in)?\b/.test(t)) return 'founder';
  if (/general manager|managing director|director(?:a)? general|\bgerente\b|gesch.ftsf.hrer(?:in)?|directeur g.n.ral/.test(t)) return 'ceo';
  if (/\bcto\b|chief technology/.test(t)) return 'cto';
  if (/revops|revenue operations/.test(t)) return 'revops';
  if (/sales ops|sales operations/.test(t)) return 'salesops';
  if (/marketing ops|marketing operations|marops/.test(t)) return 'mktops';
  if (/head of sales|vp sales|vice president of sales|sales director|director of sales|chief revenue officer|\bcro\b/.test(t)) return 'sales';
  if (/head of growth|growth lead/.test(t)) return 'growth';
  if (/head of operations|operations lead|ops lead|chief operating officer|\bcoo\b|operations director|director of operations|director(?:a)? de operaciones/.test(t)) return 'ops';
  if (/client delivery/.test(t)) return 'delivery';
  if (/head of marketing|marketing lead|\bcmo\b/.test(t)) return 'mkt';
  if (/\bgtm\b|go-to-market/.test(t)) return 'gtm';
  if (/automation/.test(t)) return 'automation';
  return 'other';
}
const RA = { founder: 100, ceo: 100, cto: 60, revops: 90, salesops: 85, sales: 85, ops: 85, automation: 85, gtm: 80, growth: 80, delivery: 80, mktops: 75, mkt: 75, other: 40, generic: 0 };
const REL = { founder: 85, ceo: 85, cto: 50, revops: 100, salesops: 100, mktops: 100, automation: 100, gtm: 90, sales: 75, growth: 75, ops: 80, delivery: 70, mkt: 75, other: 40, generic: 10 };

const seenKeys = new Set(seenRows.map(r => String(r.contact_key || '').toLowerCase()).filter(k => k && k !== '__placeholder__'));
const runKeys = new Set();
const built = [];

for (const p of personRows) {
  const domain = String(p.domain || '').toLowerCase().trim();
const rawEmail = String(p.email || '').trim().toLowerCase();
const email = (/not_unlocked|@domain\.com$/.test(rawEmail)) ? '' : rawEmail;
  const linkedin = String(p.person_linkedin || p.linkedin_url || '').trim();
  const name = String(p.full_name || '').trim();
  const title = String(p.title || '').trim();
  let role = roleCategory(title);

  if (EXCLUDE.some(x => title.toLowerCase().includes(x))) { rej('excluded_role'); continue; }
  if (email && GENERIC.some(g => email.startsWith(g))) role = 'generic';
  if (role === 'generic') { rej('generic_email'); continue; }
  if (requireContact && !email && !linkedin) { rej('no_contact_point'); continue; }

  const key = email ? 'em:' + email : (linkedin ? 'li:' + linkedin.toLowerCase() : 'nm:' + name.toLowerCase() + '@' + domain);
  if (seenKeys.has(key) || runKeys.has(key)) { rej('seen'); continue; }
  runKeys.add(key);

  const est = String(p.email_status || '').toLowerCase();
  const emailStatus = email ? ((est === 'verified' || est === 'valid') ? 'verified' : 'guessed') : 'not_found';
  const ec = emailStatus === 'verified' ? 100 : (emailStatus === 'guessed' ? 30 : 0);
  const li = linkedin ? 100 : 0;
  const acct = acctByDomain[domain] || {};
  const tzOff = acct.timezone_utc_offset;
  const tzFit = (tzOff === null || tzOff === undefined || tzOff === '') ? 0 : (allowedTz.includes(Number(tzOff)) ? 100 : 0);

  const score = Math.round(0.35 * (RA[role] || 40) + 0.25 * (REL[role] || 40) + 0.20 * ec + 0.10 * li + 0.10 * tzFit);
  if (score < minContact) { rej('below_min'); continue; }

  const confidence = Math.min(90, (emailStatus === 'verified' ? 70 : emailStatus === 'guessed' ? 50 : 40) + (linkedin ? 10 : 0) + (['founder', 'ceo', 'revops'].includes(role) ? 10 : 0));

  built.push({
    account_id: p.account_id || acct.account_id || '',
    domain, name, title, role, email, emailStatus, linkedin, score, confidence,
    provider: String(p.provider || 'clay_waterfall').toLowerCase(),
    emp: Number(acct.employee_count || 0)
  });
}

// Per-account cap with founder preference for small teams
const byAcct = {};
for (const c of built) (byAcct[c.account_id] = byAcct[c.account_id] || []).push(c);
const out = [];
for (const aid of Object.keys(byAcct)) {
  let list = byAcct[aid].sort((a, b) => b.score - a.score);
  const small = list.length && list[0].emp > 0 && list[0].emp <= smallThreshold;
  if (small && preferFounder) {
    list = list.sort((a, b) => {
      const fa = ['founder', 'ceo'].includes(a.role) ? 1 : 0;
      const fb = ['founder', 'ceo'].includes(b.role) ? 1 : 0;
      return fb - fa || b.score - a.score;
    });
  }
  list.slice(0, maxPerCompany).forEach(c => out.push(c));
  Math.max(0, list.length - maxPerCompany) && (stats.rejected.over_cap = (stats.rejected.over_cap || 0) + (list.length - maxPerCompany));
}

const contactRows = out.map(c => ({
  json: {
    run_date: new Date().toISOString(),
    contact_id: 'ct_' + (c.domain + '_' + (c.email || c.name)).toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    account_id: c.account_id,
    company_name: (acctByDomain[c.domain] || {}).company_name || c.domain,
    domain: c.domain,
    full_name: c.name,
    title: c.title,
    role_category: c.role,
    email: c.email,
    email_status: c.emailStatus,
    linkedin_url: c.linkedin,
    phone: '',
    source: c.provider,
    confidence: c.confidence,
    contact_score: c.score,
    preferred_channel: c.email ? 'email' : 'linkedin_manual',
    status: 'new',
    contact_key: c.email ? 'em:' + c.email : (c.linkedin ? 'li:' + c.linkedin.toLowerCase() : 'nm:' + c.name.toLowerCase() + '@' + c.domain),
    account_domain: c.domain
  }
}));
stats.written = contactRows.length;
return contactRows.concat([{ json: base }]);