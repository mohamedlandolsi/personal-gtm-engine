const { config, warnings } = $('Load Config').first().json;

const safeAll = (name) => {
  try { return $(name).all().map(i => i.json); } catch (e) { return []; }
};

const seenRows = $input.all()
  .map(i => i.json)
  .filter(r => r && r.domain && String(r.domain).toLowerCase().trim() !== '__placeholder__');

const seenDomains = new Set(
  seenRows.map(r => String(r.domain).toLowerCase().trim())
);

// ---- Sprint 2: multi-source read ----
const mergedItems = safeAll('Merge Sources');
const markers = mergedItems.filter(a => a && (a.__error || a.__skipped));
const rawAccounts = mergedItems.filter(a => a && !a.__error && !a.__skipped && a.company_name);

const sourceCounts = {};
for (const a of rawAccounts) {
  const s = String(a.source || 'unknown');
  sourceCounts[s] = (sourceCounts[s] || 0) + 1;
}

const stats = {
  seed_rows: rawAccounts.length,
  seen_rows_pre: seenDomains.size,
  after_filters: 0,
  accounts_written: 0,
  below_min_score: 0,
  sources: sourceCounts,
  apollo_companies: sourceCounts.apollo || 0,
  source_errors: markers.map(m => m.__error || m.__skipped).slice(0, 8),
  rejected: {
    not_new: 0,
    no_domain: 0,
    seen: 0,
    duplicate_run: 0,
    employee_range: 0,
    company_type: 0,
    industry_include: 0,
    industry_exclude: 0,
    keyword_include: 0,
    keyword_exclude: 0,
    timezone: 0
  },
  errors: []
};

for (const m of markers) {
  if (m.__error) stats.errors.push(m.__error);
}

if (!config.enabled) {
  stats.errors.push('Workflow disabled by config.enabled=false');
  return [{
    json: {
      accounts: [],
      seen_rows: [],
      stats: {
        ...stats,
        warnings: (warnings || []).join(' | '),
        errors_sample: stats.errors.slice(0, 3).join(' | ')
      }
    }
  }];
}

const includesAny = (text, arr) => {
  const t = String(text || '').toLowerCase();
  return (arr || []).some(x => t.includes(String(x).toLowerCase()));
};

const currentRunDomains = new Set();
const filtered = [];

for (const a of rawAccounts) {
  if (a.status !== 'new') { stats.rejected.not_new++; continue; }

  if (config.company.must_have_domain && !a.domain) {
    stats.rejected.no_domain++;
    stats.errors.push(`Missing domain for ${a.company_name}`);
    continue;
  }

  if (seenDomains.has(a.domain)) { stats.rejected.seen++; continue; }
  if (currentRunDomains.has(a.domain)) { stats.rejected.duplicate_run++; continue; }

  if (
    a.employee_count === null ||
    a.employee_count < Number(config.company.employee_min) ||
    a.employee_count > Number(config.company.employee_max)
  ) { stats.rejected.employee_range++; continue; }

  const type = String(a.company_type || '').toLowerCase();

  const typeAllowed =
    (type.includes('agency') && config.allow_agencies) ||
    (type.includes('startup') && config.allow_startups) ||
    (type.includes('smb') && config.allow_smb) ||
    (type.includes('enterprise') && config.allow_enterprise);

  if (!typeAllowed) { stats.rejected.company_type++; continue; }

  if (
    config.company.industries_include.length &&
    !includesAny(a.industry, config.company.industries_include)
  ) { stats.rejected.industry_include++; continue; }

  if (includesAny(a.industry, config.company.industries_exclude)) { stats.rejected.industry_exclude++; continue; }

  const search_text = [
    a.company_name,
    a.industry,
    a.description_text,
    a.funding_stage,
    a.location_raw
  ].join(' ').toLowerCase();

  if (
    config.company.keywords_include.length &&
    !includesAny(search_text, config.company.keywords_include)
  ) { stats.rejected.keyword_include++; continue; }

  if (includesAny(search_text, config.company.keywords_exclude)) { stats.rejected.keyword_exclude++; continue; }

  const tzConfig = config.timezone || {};
  const allowedOffsets = tzConfig.allowed_utc_offsets || [];

  if (a.timezone_utc_offset === null) {
    if (!tzConfig.allow_unknown_timezone) { stats.rejected.timezone++; continue; }
  } else if (!allowedOffsets.includes(a.timezone_utc_offset)) {
    stats.rejected.timezone++;
    continue;
  }

  currentRunDomains.add(a.domain);
  filtered.push(a);
}

stats.after_filters = filtered.length;

const weights = {
  icp_fit: 0.35,
  budget_proxy: 0.25,
  automation_need: 0.25,
  timezone_fit: 0.15,
  ...(config.scoring?.weights || {})
};

const vertical_boost = {
  enabled: false,
  bonus: 0,
  keywords: [],
  ...(config.scoring?.vertical_boost || {})
};

const scored = [];

for (const a of filtered) {
  const search_text = [
    a.company_name,
    a.industry,
    a.description_text,
    a.funding_stage,
    a.location_raw
  ].join(' ').toLowerCase();

  const industryMatch = includesAny(a.industry, config.company.industries_include || []);

  const keywordMatches = (config.company.keywords_include || []).filter(k =>
    search_text.includes(String(k).toLowerCase())
  );

  const icp_fit = Math.min(
    100,
    (industryMatch ? 50 : 20) +
    Math.min(30, keywordMatches.length * 10) +
    (['startup', 'agency', 'smb'].includes(a.company_type) ? 20 : 0)
  );

  let budget_proxy = 0;

  if (['seed', 'pre_seed', 'series_a'].includes(a.funding_stage)) {
    budget_proxy += 30;
  } else if (a.funding_stage === 'bootstrapped') {
    budget_proxy += 15;
  }

  const emp = Number(a.employee_count) || 0;

  if (emp >= 5 && emp <= 100) budget_proxy += 30;
  else if (emp >= 2 && emp <= 4) budget_proxy += 15;
  else if (emp > 100 && emp <= 150) budget_proxy += 10;

  if (['startup', 'agency'].includes(a.company_type)) budget_proxy += 20;

  budget_proxy = Math.min(100, budget_proxy);

  const automationToolsMatch = includesAny(search_text, [
    'crm', 'hubspot', 'salesforce', 'clay', 'n8n', 'make.com', 'zapier'
  ]);

  const automation_need = Math.min(
    100,
    keywordMatches.length * 20 +
    (automationToolsMatch ? 25 : 0)
  );

  let timezone_fit = 0;

  if (a.timezone_utc_offset === null) {
    timezone_fit = config.timezone?.allow_unknown_timezone ? 30 : 0;
  } else if (a.timezone_utc_offset === 1) {
    timezone_fit = 100;
  } else if ([0, 2, 3].includes(a.timezone_utc_offset)) {
    timezone_fit = 90;
  } else if (a.timezone_utc_offset === 4) {
    timezone_fit = 75;
  } else {
    timezone_fit = 0;
  }

  let final_score = Math.round(
    weights.icp_fit * icp_fit +
    weights.budget_proxy * budget_proxy +
    weights.automation_need * automation_need +
    weights.timezone_fit * timezone_fit
  );

  if (vertical_boost.enabled && includesAny(search_text, vertical_boost.keywords || [])) {
    final_score = Math.min(100, final_score + Number(vertical_boost.bonus || 0));
  }

  if (final_score < Number(config.min_account_score || 0)) {
    stats.below_min_score++;
    continue;
  }

  const red_flags = [];
  if (a.employee_count === null) red_flags.push('employee_count unknown');
  if (a.timezone_utc_offset === null) red_flags.push('timezone unknown');
  if (a.funding_stage === 'unknown') red_flags.push('funding unknown');

  const why_match = [];
  if (industryMatch) why_match.push('industry fit');
  if (keywordMatches.length) why_match.push('keywords: ' + keywordMatches.slice(0, 5).join(', '));
  if (a.company_type) why_match.push('company type: ' + a.company_type);

  scored.push({
    json: {
      run_date: new Date().toISOString(),
      source: a.source || 'seed_accounts',
      account_id: 'acc_' + a.domain.replace(/[^a-z0-9]/gi, '_'),
      company_name: a.company_name,
      domain: a.domain,
      website: a.website || '',
      industry: a.industry || '',
      company_type: a.company_type || '',
      employee_count: a.employee_count ?? '',
      location_raw: a.location_raw || '',
      country: a.country || '',
      timezone_utc_offset: a.timezone_utc_offset ?? '',
      funding_stage: a.funding_stage || '',
      final_score,
      priority: final_score >= Number(config.priority_score || 80),
      why_match: why_match.join('; ') || 'seed match',
      red_flags: red_flags.join('; '),
      score_breakdown: `icp=${icp_fit}; budget=${budget_proxy}; automation=${automation_need}; timezone=${timezone_fit}`,
      confidence: a.source === 'apollo' ? 65 : 60,
      status: 'new',
      linkedin_url: a.linkedin_url || '',
      tech_stack: '',
      funding_proxy_score: budget_proxy, // Map existing proxy to new field
      automation_need_score: automation_need, // Map existing need to new field
      enrichment_status: 'pending'
    }
  });
}

scored.sort((a, b) => b.json.final_score - a.json.final_score);

const capped = scored
  .slice(0, Number(config.max_companies_per_run || 25))
  .map(i => i.json);

stats.accounts_written = capped.length;

const seen_rows = capped.map(a => ({
  domain: a.domain,
  company_name: a.company_name,
  first_seen_at: new Date().toISOString(),
  last_seen_at: new Date().toISOString(),
  source: a.source || 'seed_accounts'
}));

stats.warnings = (warnings || []).join(' | ');
stats.errors_sample = stats.errors.slice(0, 3).join(' | ');

return [{
  json: {
    accounts: capped,
    seen_rows,
    stats
  }
}];