const safeAll = (name) => { try { return $(name).all().map(i => i.json); } catch (e) { return []; } };
const cfg = $('Load Config').first().json.config || {};
const K = cfg.contact || {};
const CC = cfg.clay_contacts || {};
// Sprint 14: EU and UK accounts get contacts first. Same list and config as Select Outreach Pairs.
const P = cfg.priority || {};
// Fix 10: region is a sort preference, not part of final_score (ADR-109).
const EU_UK = ['austria','belgium','bulgaria','croatia','cyprus','czechia','czech republic','denmark','estonia','finland','france','germany','greece','hungary','ireland','italy','latvia','lithuania','luxembourg','malta','netherlands','poland','portugal','romania','slovakia','slovenia','spain','sweden','united kingdom','norway','iceland','liechtenstein','switzerland'];
const regionBonusPts = Number(P.region_bonus ?? 5);
const regions = (Array.isArray(P.regions) ? P.regions : EU_UK).map(s => String(s).toLowerCase());
const regionBonus = (a) => regions.includes(String((a || {}).country || '').trim().toLowerCase()) ? regionBonusPts : 0;
const statsRows = safeAll('Merge Clay Into Accounts').filter(r => r && r.__row_type === 'stats');
const items = [...statsRows, ...safeAll('Fetch Qualified Accounts'), ...safeAll('Fetch Seen Contacts')];
const resultDomains = new Set(
  safeAll('Fetch Contact Results')
    .map(r => String(r.domain || '').toLowerCase())
    .filter(d => d && d !== '__placeholder__')
);
const statsItem = items.find(r => r && r.__row_type === 'stats');
const accountRows = items.filter(r => r && r.account_id && r.domain && r.enrichment_status !== undefined);
const seenRows = items.filter(r => r && r.contact_key !== undefined && r.account_domain !== undefined);

const base = statsItem ? JSON.parse(JSON.stringify(statsItem)) : { __row_type: 'stats', stats: {} };
base.stats = base.stats || {};

if (CC.enabled === false) {
  base.stats.contacts = { queued: 0, discovered: 0, written: 0, skipped: 'clay_contacts disabled by config' };
  return [{ json: base }];
}

const minScore = Number((cfg.contact || {}).min_account_score || 65);
const capAccounts = Math.max(1, Number(K.max_accounts_per_run || 3));
const seenAccountDomains = new Set(seenRows.map(r => String(r.account_domain || '').toLowerCase()).filter(d => d && d !== 'placeholder'));

const eligible = accountRows.filter(r =>
  String(r.status || '') !== 'rejected' &&
  String(r.enrichment_status || '') === 'enriched' &&
  Number(r.final_score || 0) >= minScore &&
  String(r.contact_status || '').trim() === '' &&
  !seenAccountDomains.has(String(r.domain || '').toLowerCase())
);

// Do not queue accounts whose results are already pasted. Queue and rescore must never touch the same account in one run.
// S14 patch: top the queue up to the cap instead of adding the cap every pass. Contact Finder takes
// contact.max_accounts_per_run per run, and two engine passes per GTM Run used to add twice that.
const alreadyQueued = accountRows.filter(r => String(r.contact_status || '').trim() === 'queued' && String(r.status || '') !== 'rejected').length;
const slots = Math.max(0, capAccounts - alreadyQueued);
const queued = eligible.filter(r => !resultDomains.has(String(r.domain || '').toLowerCase()))
  .sort((a, b) => (Number(b.final_score || 0) + regionBonus(b)) - (Number(a.final_score || 0) + regionBonus(a)))
  .slice(0, slots).map(r => ({
  json: {
    queued_at: new Date().toISOString(),
    account_id: r.account_id,
    domain: r.domain,
    company_name: r.company_name,
    website: r.website || '',
    linkedin_url: r.linkedin_url || '',
    employee_count: r.employee_count || '',
    contact_status: 'queued',
    target_roles: 'founder, co-founder, ceo, cto, head of revops, head of sales, head of growth'
  }
}));

const inFlight = accountRows.filter(r =>
  String(r.enrichment_status || '') === 'enriched' &&
  Number(r.final_score || 0) >= minScore &&
  ['', 'queued'].includes(String(r.contact_status || '').trim()) &&
  !seenAccountDomains.has(String(r.domain || '').toLowerCase())
);
base.stats.all_qualified = inFlight;
base.stats.contacts = { queued: queued.length, discovered: 0, written: 0, eligible: eligible.length, already_queued: alreadyQueued, rejected: {} };
return queued.concat([{ json: base }]);