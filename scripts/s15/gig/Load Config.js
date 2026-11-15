const DEFAULTS = {
  rev: 'personal-gtm-sprint1-unified',
  enabled: true,
  max_companies_per_run: 25,
  min_account_score: 65,
  priority_score: 80,
  allow_agencies: true,
  allow_startups: true,
  allow_smb: true,
  allow_enterprise: false,
  timezone: {
    allowed_utc_offsets: [0, 1, 2, 3, 4],
    allow_unknown_timezone: false
  },
  company: {
    employee_min: 2,
    employee_max: 150,
    must_have_domain: true,
    industries_include: [],
    industries_exclude: [],
    keywords_include: [],
    keywords_exclude: []
  },
  scoring: {
    weights: {
      icp_fit: 0.35,
      budget_proxy: 0.25,
      automation_need: 0.25,
      timezone_fit: 0.15
    },
    vertical_boost: {
      enabled: true,
      bonus: 5,
      keywords: []
    }
  }
};

const rows = $('Fetch Config').all().map(i => i.json);
const row = rows.find(r => String(r.key || '').trim().toLowerCase() === 'config_json');

let warnings = [];
let config = JSON.parse(JSON.stringify(DEFAULTS));

if (row && row.value) {
  try {
    const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;

    config = {
      ...config,
      ...parsed,
      timezone: {
        ...config.timezone,
        ...(parsed.timezone || {})
      },
      company: {
        ...config.company,
        ...(parsed.company || {})
      },
      scoring: {
        ...config.scoring,
        ...(parsed.scoring || {}),
        weights: {
          ...config.scoring.weights,
          ...((parsed.scoring || {}).weights || {})
        },
        vertical_boost: {
          ...config.scoring.vertical_boost,
          ...((parsed.scoring || {}).vertical_boost || {})
        }
      }
    };
  } catch (e) {
    warnings.push('config_json invalid: ' + String(e.message || e));
  }
} else {
  warnings.push('config_json missing; using defaults');
}

return [{ json: { config, warnings } }];