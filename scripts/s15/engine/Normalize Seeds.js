function normalizeDomain(raw) {
  if (!raw) return '';

  let value = String(raw).trim();

  try {
    if (!/^https?:\/\//i.test(value)) {
      value = 'https://' + value;
    }

    const u = new URL(value);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch (e) {
    return String(raw)
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .trim();
  }
}

const out = [];

for (const item of $input.all()) {
  const r = item.json;

  if (!r || r.__empty) continue;

  const company_name = String(r.company_name || '').trim();
  if (!company_name) continue;

  const domain = normalizeDomain(r.domain || r.website || '');
  const website = String(r.website || '').trim();

  const employeeRaw = String(r.employee_count || '').replace(/[^0-9]/g, '');
  const employeeNumber = Number(employeeRaw);
  const employee_count = Number.isFinite(employeeNumber) && employeeNumber > 0
    ? employeeNumber
    : null;

  const tzRaw = r.timezone_utc_offset;
  const tzNumber = Number(tzRaw);
  const timezone_utc_offset = tzRaw === undefined || tzRaw === null || String(tzRaw).trim() === ''
    ? null
    : (Number.isFinite(tzNumber) ? tzNumber : null);

  const description_text = [
    r.description,
    r.notes
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  out.push({
    json: {
      source: String(r.source || '').trim() || 'seed_accounts',   // S15: e.g. hubspot_directory
      company_name,
      domain,
      website,
      industry: String(r.industry || '').trim(),
      company_type: String(r.company_type || '').toLowerCase().trim(),
      employee_count,
      location_raw: String(r.location_raw || '').trim(),
      country: String(r.country || '').trim(),
      timezone_utc_offset,
      funding_stage: String(r.funding_stage || '').toLowerCase().trim(),
      description_text,
      status: String(r.status || 'new').toLowerCase().trim(),
      // S15 (ADR-113): blank or unknown means smb_direct
      lead_track: String(r.lead_track || '').trim().toLowerCase() === 'agency_partner' ? 'agency_partner' : 'smb_direct'
    }
  });
}

if (!out.length) {
  return [{ json: { __empty: true } }];
}

return out;