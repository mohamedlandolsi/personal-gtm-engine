// Sprint 15 Phase 4: builds the new engine Code node bodies from the live copies (never retyped).
// Every edit is an anchored replacement that must match exactly once, so a changed live body stops the build.
// Usage: node scripts/s15/engine/patch_engine.mjs <dir with live .js copies>
// Output: scripts/s15/engine/<node>.js  (Partner Directories Source.js is written by hand, not patched)
import fs from 'node:fs';
import path from 'node:path';

const live = process.argv[2];
if (!live) { console.error('usage: patch_engine.mjs <live dir>'); process.exit(2); }
const outDir = path.resolve('scripts/s15/engine');
const read = (n) => fs.readFileSync(path.join(live, n + '.js'), 'utf8').replace(/\r\n/g, '\n');
const rep = (src, a, b, node) => {
  const n = src.split(a).length - 1;
  if (n !== 1) { console.error(`${node}: anchor found ${n} times:\n${a.slice(0, 160)}`); process.exit(1); }
  return src.replace(a, () => b);
};
const build = (node, edits) => {
  let s = read(node);
  for (const [a, b] of edits) s = rep(s, a, b, node);
  if (/[—]/.test(s.replace(/\\s\*—\\s\*/g, ''))) { console.error(node + ': em dash in output'); process.exit(1); }
  fs.writeFileSync(path.join(outDir, node + '.js'), s);
  console.log(node + ': ' + edits.length + ' edits, ' + s.length + ' chars');
};

// ---------- Normalize Seeds: lead_track and source from the seed row ----------
build('Normalize Seeds', [
  ["      source: 'seed_accounts',\n", "      source: String(r.source || '').trim() || 'seed_accounts',   // S15: e.g. hubspot_directory\n"],
  ["      status: String(r.status || 'new').toLowerCase().trim()\n    }",
   "      status: String(r.status || 'new').toLowerCase().trim(),\n      // S15 (ADR-113): blank or unknown means smb_direct\n      lead_track: String(r.lead_track || '').trim().toLowerCase() === 'agency_partner' ? 'agency_partner' : 'smb_direct'\n    }"]
]);

// ---------- Process Accounts: track filters and the agency score ----------
const PA_HELPERS = `

// ---- Sprint 15: lead tracks (ADR-113). agency_partner rows get their own filters and score; smb_direct is unchanged. ----
const AT = (config.lead_tracks || {}).agency_partner || {};
const trackOf = (a) => String(a.lead_track || '').trim().toLowerCase() === 'agency_partner' && AT.enabled !== false ? 'agency_partner' : 'smb_direct';
const metaOf = (a) => { try { const m = JSON.parse(a.source_meta || '{}'); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; } };
const lc = (arr) => (Array.isArray(arr) ? arr : []).map(x => String(x).toLowerCase());
const blankTz = (v) => v === null || v === undefined || v === '';
const agencyFilter = (a) => {
  const m = metaOf(a);
  const emp = a.employee_count;
  if (emp === null || emp === undefined || emp === '') { if (AT.allow_unknown_size === false) return 'agency_size'; }
  else if (Number(emp) > Number(AT.employee_max ?? 25)) return 'agency_size';
  if (lc(AT.exclude_tiers).includes((String(m.directory || '') + ':' + String(m.tier || '')).toLowerCase())) return 'agency_tier';
  if (lc(m.pricing).some(p => lc(AT.exclude_pricing).includes(p))) return 'agency_pricing';
  const langs = lc(m.languages);
  if (langs.length && lc(AT.required_languages).some(l => !langs.includes(l))) return 'agency_language';
  if (includesAny(a.industry, config.company.industries_exclude)) return 'industry_exclude';
  const text = [a.company_name, a.industry, a.description_text, a.location_raw].join(' ').toLowerCase();
  if (includesAny(text, config.company.keywords_exclude)) return 'keyword_exclude';
  if (!lc(AT.stack_keywords).some(k => text.includes(k))) return 'agency_stack_miss';
  const offsets = (AT.allowed_utc_offsets || (config.timezone || {}).allowed_utc_offsets || []).map(Number);
  if (blankTz(a.timezone_utc_offset)) { if (!(config.timezone || {}).allow_unknown_timezone) return 'timezone'; }
  else if (!offsets.includes(Number(a.timezone_utc_offset))) return 'timezone';
  return '';
};
// score = 0.35*stack_fit + 0.25*capacity_need + 0.20*size_fit + 0.20*tz_language_fit (plan 4.4)
const agencyScore = (a) => {
  const m = metaOf(a);
  const text = [a.company_name, a.industry, a.description_text].join(' ').toLowerCase();
  const kws = lc(AT.stack_keywords).filter(k => text.includes(k));
  const stack = kws.length >= 3 ? 100 : kws.length === 2 ? 75 : kws.length === 1 ? 50 : 0;
  let capacity = 40;
  if (Number(m.reviews || 0) >= 3) capacity += 20;
  if (/we'?re hiring|\\bhiring\\b|join our team|growing team|overflow|white[- ]label|subcontract|capacity/.test(text)) capacity += 20;
  if (m.availability === true) capacity += 20;
  capacity = Math.min(100, capacity);
  const tier = String(m.tier || '').toLowerCase();
  let size = ({ 'advanced artisan': 100, 'artisan': 100, 'select': 100, 'studio': 70, 'premium': 70 })[tier] ?? 60;
  if (lc(m.pricing).some(p => ['any-budget', '250-1000', '1000-5000'].includes(p))) size = Math.max(size, 90);
  const emp = Number(a.employee_count);
  if (a.employee_count !== null && a.employee_count !== '' && Number.isFinite(emp) && emp > 0) size = emp <= 10 ? 100 : (emp <= 25 ? Math.max(size, 80) : size);
  const off = blankTz(a.timezone_utc_offset) ? null : Number(a.timezone_utc_offset);
  let tzl = off === null ? 50 : [0, 1, 2].includes(off) ? 100 : [3, 4].includes(off) ? 80 : [-5, -4].includes(off) ? 60 : 30;
  if (lc(m.languages).length && !lc(m.languages).includes('english')) tzl = Math.min(tzl, 30);
  const final_score = Math.round(0.35 * stack + 0.25 * capacity + 0.20 * size + 0.20 * tzl);
  if (final_score < Number(AT.min_account_score ?? config.min_account_score ?? 60)) { stats.below_min_score++; return null; }
  return {
    run_date: new Date().toISOString(),
    source: a.source || 'partner_directory',
    account_id: 'acc_' + a.domain.replace(/[^a-z0-9]/gi, '_'),
    company_name: a.company_name,
    domain: a.domain,
    website: a.website || '',
    industry: a.industry || '',
    company_type: a.company_type || 'agency',
    employee_count: a.employee_count ?? '',
    location_raw: a.location_raw || '',
    country: a.country || '',
    timezone_utc_offset: a.timezone_utc_offset ?? '',
    funding_stage: a.funding_stage || '',
    final_score,
    priority: final_score >= Number(config.priority_score || 80),
    why_match: ['agency track', kws.length ? 'services: ' + kws.slice(0, 5).join(', ') : '', m.tier ? 'tier: ' + m.tier : '', m.directory ? 'directory: ' + m.directory : ''].filter(Boolean).join('; '),
    red_flags: [a.employee_count === null || a.employee_count === '' ? 'employee_count unknown' : '', off === null ? 'timezone unknown' : ''].filter(Boolean).join('; '),
    score_breakdown: \`track=agency_partner; stack=\${stack}; capacity=\${capacity}; size=\${size}; tz_lang=\${tzl}\`,
    confidence: 60,
    status: 'new',
    linkedin_url: a.linkedin_url || '',
    tech_stack: '',
    funding_proxy_score: size,
    automation_need_score: stack,
    enrichment_status: 'pending',
    lead_track: 'agency_partner',
    source_meta: a.source_meta || '',
    // ADR-117: the directory listing is the dated trigger for this track
    clay_trigger: a.directory_trigger || '',
    clay_trigger_source: a.directory_trigger ? 'directory' : '',
    clay_trigger_date: a.directory_trigger ? String(a.directory_trigger_date || new Date().toISOString().slice(0, 10)) : ''
  };
};
`;
build('Process Accounts', [
  ["  return (arr || []).some(x => t.includes(String(x).toLowerCase()));\n};\n",
   "  return (arr || []).some(x => t.includes(String(x).toLowerCase()));\n};\n" + PA_HELPERS],
  ["  if (currentRunDomains.has(a.domain)) { stats.rejected.duplicate_run++; continue; }\n",
   "  if (currentRunDomains.has(a.domain)) { stats.rejected.duplicate_run++; continue; }\n\n" +
   "  // S15: agency_partner rows take the track filters (size, tier, pricing, language, stack, time window)\n" +
   "  if (trackOf(a) === 'agency_partner') {\n" +
   "    const why = agencyFilter(a);\n" +
   "    if (why) { stats.rejected[why] = (stats.rejected[why] || 0) + 1; continue; }\n" +
   "    currentRunDomains.add(a.domain);\n" +
   "    filtered.push(a);\n" +
   "    continue;\n" +
   "  }\n"],
  ["for (const a of filtered) {\n  const search_text = [",
   "for (const a of filtered) {\n  if (trackOf(a) === 'agency_partner') { const row = agencyScore(a); if (row) scored.push({ json: row }); continue; }   // S15\n\n  const search_text = ["],
  ["      enrichment_status: 'pending'\n    }\n  });",
   "      enrichment_status: 'pending',\n      lead_track: 'smb_direct'   // S15 (ADR-113)\n    }\n  });"]
]);

// ---------- Score Enriched: agency rows keep their score; a careers page raises capacity_need ----------
build('Score Enriched', [
  ["  // Explainable re-score: parse stored components, add ONLY new evidence\n",
   "  // Sprint 15: agency_partner rows keep their own score components (ADR-113). A careers page raises capacity_need.\n" +
   "  const ag = String(r.score_breakdown || '').match(/track=agency_partner;\\s*stack=(\\d+);\\s*capacity=(\\d+);\\s*size=(\\d+);\\s*tz_lang=(\\d+)/i);\n" +
   "  if (String(r.lead_track || '') === 'agency_partner' && ag) {\n" +
   "    const st = Number(ag[1]), sz = Number(ag[3]), tzl = Number(ag[4]);\n" +
   "    const capN = Math.min(100, Number(ag[2]) + (hiring ? 20 : 0));\n" +
   "    const fin = Math.round(0.35 * st + 0.25 * capN + 0.20 * sz + 0.20 * tzl);\n" +
   "    row.tech_stack = detected.join(', ');\n" +
   "    row.final_score = fin;\n" +
   "    row.priority = fin >= Number(cfg.priority_score || 80);\n" +
   "    row.score_breakdown = 'track=agency_partner; stack=' + st + '; capacity=' + capN + '; size=' + sz + '; tz_lang=' + tzl +\n" +
   "      '; enrich=website:ok,stack:' + detected.length + (hiring ? ',hiring:1' : '') + (contact ? ',contact:1' : '');\n" +
   "    row.why_match = [r.why_match, 'enrichment: website live' + (crm.length ? '; crm: ' + crm.join('/') : '') + (auto.length ? '; tools: ' + auto.join('/') : '') + (hiring ? '; hiring page' : '')].filter(Boolean).join('; ');\n" +
   "    row.confidence = detected.length ? 75 : 70;\n" +
   "    row.linkedin_url = linkedin;\n" +
   "    row.enrichment_status = 'enriched';\n" +
   "    out.push({ json: row });\n" +
   "    return;\n" +
   "  }\n\n" +
   "  // Explainable re-score: parse stored components, add ONLY new evidence\n"]
]);

// ---------- Rescore Accounts: agency score plus contact feasibility ----------
build('Rescore Accounts', [
  ["  const feas = Math.max(...scores);\n",
   "  const feas = Math.max(...scores);\n" +
   "  // Sprint 15: agency_partner rows keep their components; contact feasibility weighs 15%, as in the SMB formula.\n" +
   "  const ag = String(a.score_breakdown || '').match(/track=agency_partner;\\s*stack=(\\d+);\\s*capacity=(\\d+);\\s*size=(\\d+);\\s*tz_lang=(\\d+)/i);\n" +
   "  if (String(a.lead_track || '') === 'agency_partner' && ag) {\n" +
   "    const st = Number(ag[1]), cp = Number(ag[2]), sz = Number(ag[3]), tzl = Number(ag[4]);\n" +
   "    const fin = Math.round(0.30 * st + 0.20 * cp + 0.20 * sz + 0.15 * tzl + 0.15 * feas);\n" +
   "    const rowA = Object.assign({}, a);\n" +
   "    rowA.contact_feasibility_score = feas;\n" +
   "    rowA.final_score = fin;\n" +
   "    rowA.priority = fin >= Number(cfg.priority_score || 80);\n" +
   "    rowA.score_breakdown = 'track=agency_partner; stack=' + st + '; capacity=' + cp + '; size=' + sz + '; tz_lang=' + tzl + '; feasibility=' + feas;\n" +
   "    rowA.status = 'contact_found';\n" +
   "    rowA.contact_status = 'contacts_done';\n" +
   "    out.push({ json: rowA });\n" +
   "    continue;\n" +
   "  }\n"]
]);

// ---------- Select Clay Batch: no Clay research credits on the agency track (ADR-118) ----------
build('Select Clay Batch', [
  ["  Number(r.final_score || 0) >= minScore\n);",
   "  Number(r.final_score || 0) >= minScore &&\n" +
   "  // S15 (ADR-118): the directory profile already gives services, tier and languages\n" +
   "  !(String(r.lead_track || '') === 'agency_partner' && ((cfg.lead_tracks || {}).agency_partner || {}).clay_research === false)\n);"]
]);

// ---------- Select Contact Batch: agency rows use the track's minimum score ----------
build('Select Contact Batch', [
  ["const minScore = Number((cfg.contact || {}).min_account_score || 65);\n",
   "const minScore = Number((cfg.contact || {}).min_account_score || 65);\n" +
   "// S15: agency_partner rows use lead_tracks.agency_partner.min_account_score\n" +
   "const AT = (cfg.lead_tracks || {}).agency_partner || {};\n" +
   "const minFor = (r) => String(r.lead_track || '') === 'agency_partner' ? Number(AT.min_account_score ?? minScore) : minScore;\n"],
  ["  String(r.enrichment_status || '') === 'enriched' &&\n  Number(r.final_score || 0) >= minScore &&\n  String(r.contact_status || '').trim() === '' &&",
   "  String(r.enrichment_status || '') === 'enriched' &&\n  Number(r.final_score || 0) >= minFor(r) &&\n  String(r.contact_status || '').trim() === '' &&"],
  ["  String(r.enrichment_status || '') === 'enriched' &&\n  Number(r.final_score || 0) >= minScore &&\n  ['', 'queued']",
   "  String(r.enrichment_status || '') === 'enriched' &&\n  Number(r.final_score || 0) >= minFor(r) &&\n  ['', 'queued']"]
]);

// ---------- Select Outreach Pairs: directory trigger, small-team gate, contact_form channel ----------
build('Select Outreach Pairs', [
  ["  return !!text && TRIGGER_TYPES.includes(type) && (dated || (type === 'hiring' && role));\n",
   "  // S15 (ADR-117): for agency_partner rows a dated directory listing is a valid trigger.\n" +
   "  if (type === 'directory') return !!text && dated && String(a.lead_track || '') === 'agency_partner';\n" +
   "  return !!text && TRIGGER_TYPES.includes(type) && (dated || (type === 'hiring' && role));\n"],
  ["const blocked = new Map(",
   "// Sprint 15: agency_partner rows (ADR-113, ADR-117)\n" +
   "const AT = (cfg.lead_tracks || {}).agency_partner || {};\n" +
   "const isAgency = (a) => String((a || {}).lead_track || '') === 'agency_partner' && AT.enabled !== false;\n" +
   "const metaOf = (a) => { try { const m = JSON.parse((a || {}).source_meta || '{}'); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; } };\n" +
   "const blocked = new Map("],
  ["String(a.contact_status || '') !== 'contacts_done' || Number(a.final_score || 0) < minAcct) { sk.account++; continue; }",
   "String(a.contact_status || '') !== 'contacts_done' || Number(a.final_score || 0) < (isAgency(a) ? Number(AT.min_account_score ?? minAcct) : minAcct)) { sk.account++; continue; }"],
  ["  if (emp > 0 && emp < smallTeam && !triggerOk) { sk.small_no_trigger++; continue; }",
   "  if (emp > 0 && emp < smallTeam && !triggerOk && !(isAgency(a) && AT.skip_small_team_gate !== false)) { sk.small_no_trigger++; continue; }"],
  ["  else if (emailOk && allowGuessed) { channel = 'email'; flags.push('email_unverified'); }\n",
   "  else if (emailOk && allowGuessed) { channel = 'email'; flags.push('email_unverified'); }\n" +
   "  // S15: an agency without a usable email or LinkedIn can still be reached through its directory contact form\n" +
   "  if (!channel && isAgency(a) && metaOf(a).contact_form && metaOf(a).profile_url) { channel = 'contact_form'; flags.push('contact_form'); }\n"],
  ["    email: c.email, linkedin_url: c.linkedin_url, contact_score: c.contact_score\n  } });",
   "    email: c.email, linkedin_url: c.linkedin_url, contact_score: c.contact_score,\n" +
   "    // Sprint 15: track facts for Draft Outreach\n" +
   "    lead_track: isAgency(a) ? 'agency_partner' : 'smb_direct', source_meta: isAgency(a) ? String(a.source_meta || '') : '',\n" +
   "    hiring_signal: /hiring page|hiring:1/i.test(String(a.why_match || '') + ' ' + String(a.score_breakdown || ''))\n  } });"]
]);

// ---------- Draft Outreach: agency track switch, angles, validator v3, signature link, lead_track ----------
const DO_AGENCY = `
// ---------- Sprint 15: agency_partner track (ADR-113, ADR-117). SMB drafts do not change. ----------
const AT = (cfg.lead_tracks || {}).agency_partner || {};
const isAgency = p => String(p.lead_track || '') === 'agency_partner' && AT.enabled !== false;
const metaOf = p => { try { const m = JSON.parse(p.source_meta || '{}'); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; } };
const AGENCY_PROOFS = (AT.proof_points && AT.proof_points.length) ? AT.proof_points.map(String) : PROOFS;
const ctaFor = p => (isAgency(p) && AT.cta) ? String(AT.cta) : CTA;
const SENIOR = /\\b\\d+\\+?\\s*(years?|yrs)\\b|\\bsenior\\b|\\bexpert in\\b|\\bmany clients\\b|\\bdozens of\\b|\\bhundreds of\\b|\\bseasoned\\b|\\bveteran\\b|\\bworld[- ]class\\b/i;   // same as the gig validator
// Tools from the directory profile count as their tools (plan 4.7: site tools plus directory services).
const AGENCY_TOOLS = WATCH.concat(['n8n', 'clay', 'make', 'apollo']);
const svcText = p => ((metaOf(p).services || []).join(' ') + ' ' + String(p.industry || '')).toLowerCase();
const serviceTools = p => isAgency(p) ? AGENCY_TOOLS.filter(t => has(svcText(p), t)) : [];
const SVC_STOP = new Set('building design solutions solution services service other based custom management installation server focused process list'.split(' '));
const agencyServiceWords = p => [...new Set(((metaOf(p).services || []).join(' ').toLowerCase().match(/[a-z0-9]+/g) || [])
  .filter(w => (w.length >= 4 || w === 'n8n' || w === 'crm') && !SVC_STOP.has(w)))];
const agencyAngle = (p) => {
  const m = metaOf(p);
  const svc = (m.services || []).map(String);
  const mine = ['n8n', 'clay', 'hubspot', 'apollo', 'make'].filter(t => has(svcText(p), t));
  if (p.hiring_signal) return { id: 'hire_bridge', basis: 'careers page on their site' };
  if (mine.length) return { id: 'stack_specific_help', basis: ('listed services: ' + (svc.slice(0, 3).join(', ') || mine.join(', '))).slice(0, 200) };
  return { id: 'white_label_overflow', basis: m.directory ? 'listed in the ' + (m.directory === 'n8n' ? 'n8n' : 'Clay') + ' experts directory' + (m.tier ? ' as a ' + m.tier + ' partner' : '') : 'GTM or automation agency' };
};
const agencyLines = (p) => [
  'TRACK: agency_partner. ' + displayName(p) + ' is a small GTM or automation agency that delivers this kind of work for its own clients. Offer to take scoped tasks under their brand (white label), as extra capacity. Never pitch them as a buyer of automation for their own sales, never position yourself as a competitor, never propose a partnership.',
  'THEIR_SERVICES: ' + (((metaOf(p).services || []).join(', ')) || String(p.industry || 'none')),
  'AGENCY_RULES: name one of THEIR_SERVICES in first_line or body_rest. In body_rest offer exactly one small first task. ALLOWED_COMPANY_TOOLS also lists tools from their directory profile (services they deliver). Never claim years of experience, seniority, "expert in" or client counts.'
];
`;
build('Draft Outreach', [
  ["const companyTools = p => (p.__tools || []).filter(t => t !== 'google_analytics').map(t => t.replace(/_/g, ' '));\n",
   "const companyTools = p => [...new Set((p.__tools || []).filter(t => t !== 'google_analytics').map(t => t.replace(/_/g, ' ')).concat(serviceTools(p)))];   // S15: plus directory services\n" + DO_AGENCY],
  ["const pickProof = p => {\n",
   "const pickProof = p => {\n  if (isAgency(p)) return AGENCY_PROOFS[0];   // S15: proof points from the track config\n"],
  ["  signup_activation: 'Offer a new-signup flow: enrich each signup, flag accounts worth a personal reply, send a weekly list of high-fit signups.'\n};",
   "  signup_activation: 'Offer a new-signup flow: enrich each signup, flag accounts worth a personal reply, send a weekly list of high-fit signups.',\n" +
   "  // Sprint 15: agency_partner angles. The angle text says \"under your brand\"; the no-partnership rule still holds.\n" +
   "  white_label_overflow: 'Offer to take scoped build tasks from their client work (n8n, Clay or HubSpot builds) and deliver them under their brand, starting with one small first task.',\n" +
   "  stack_specific_help: 'Offer hands-on help with the stack they sell (their listed services): one small, fixed-scope build or fix on a client project, delivered under their brand.'\n};"],
  ["const pickAngle = (p, c, site) => {\n",
   "const pickAngle = (p, c, site) => {\n  if (isAgency(p)) return agencyAngle(p);   // S15\n"],
  ["  'TONE: ' + (O.tone || 'direct, concise, evidence-first')\n].join('\\n');",
   "  'TONE: ' + (O.tone || 'direct, concise, evidence-first')\n].concat(isAgency(p) ? agencyLines(p) : []).join('\\n');"],
  ["  o.cta = CTA;\n  o.message_draft = 'Hi ' + firstName(p) + ',\\n\\n' + o.first_line + ' ' + o.body_rest + '\\n\\n' + CTA + '\\n\\n' + SENDER;",
   "  o.cta = ctaFor(p);\n  o.message_draft = 'Hi ' + firstName(p) + ',\\n\\n' + o.first_line + ' ' + o.body_rest + '\\n\\n' + ctaFor(p) + '\\n\\n' + SENDER;"],
  ["const builtMatchesProof = (txt) => txt.split(",
   "const AGENCY_PROOF_KEYS = PROOFS.concat(AGENCY_PROOFS).filter(x => /^built /i.test(x)).map(x => new Set((x.toLowerCase().match(/[a-z0-9]+/g) || []).filter(w => w.length >= 3 && !PROOF_STOP.has(w))));   // S15\n" +
   "const builtMatchesProof = (txt, keys = PROOF_KEYS) => txt.split("],
  ["  return PROOF_KEYS.some(k => [...k].filter(w => ws.has(w)).length >= 2);",
   "  return keys.some(k => [...k].filter(w => ws.has(w)).length >= 2);"],
  ["  if (/\\b(i|we)('ve| have)? built\\b/i.test(all) && !builtMatchesProof(all)) bad.push('overclaims_built');",
   "  if (/\\b(i|we)('ve| have)? built\\b/i.test(all) && !builtMatchesProof(all, isAgency(p) ? AGENCY_PROOF_KEYS : PROOF_KEYS)) bad.push('overclaims_built');"],
  ["' ' + o.proof_point + ' ' + CTA + ' ' + p.tech_stack + ' ' + String(p.clay_trigger || '')).toLowerCase();",
   "' ' + o.proof_point + ' ' + ctaFor(p) + ' ' + p.tech_stack + ' ' + String(p.clay_trigger || '') + (isAgency(p) ? ' ' + String(p.source_meta || '') : '')).toLowerCase();"],
  ["  for (let i = 0; i + 12 <= mw.length; i++) if (src.includes(' ' + mw.slice(i, i + 12).join(' ') + ' ')) { bad.push('copied_source'); break; }\n  return bad;\n};",
   "  for (let i = 0; i + 12 <= mw.length; i++) if (src.includes(' ' + mw.slice(i, i + 12).join(' ') + ' ')) { bad.push('copied_source'); break; }\n" +
   "  // Sprint 15: validator v3, agency rules (plan 4.8): one of their services, one small first task, no seniority claims.\n" +
   "  if (isAgency(p)) {\n" +
   "    const svc = agencyServiceWords(p);\n" +
   "    // their service must be named outside my own proof sentence (\"I built ... HubSpot sync\" does not count)\n" +
   "    const core = (o.first_line + ' ' + o.body_rest.split(/(?<=[.!?])\\s+/).filter(x => !/\\b(i|we)('ve| have)? built\\b|relevant proof/i.test(x)).join(' ')).toLowerCase();\n" +
   "    if (svc.length && !svc.some(w => has(core, w))) bad.push('agency_no_service');\n" +
   "    if (!/\\b(one|a|single)\\s+(?:[a-z-]+\\s+){0,2}(task|build|piece|project|job)\\b/i.test(o.body_rest + ' ' + o.value_proposition) ||\n" +
   "        !/\\b(small|scoped|fixed[- ]scope|first|trial|single)\\b/i.test(o.body_rest + ' ' + o.value_proposition)) bad.push('agency_no_small_task');\n" +
   "    if (SENIOR.test(all)) bad.push('seniority_claim');\n" +
   "  }\n" +
   "  return bad;\n};"],
  ["const templateFor = p => {\n  const t = templateDraft(p);",
   "// Sprint 15: agency fallback text (parked in needs_redraft like every template draft).\n" +
   "const agencyTemplate = (p) => {\n" +
   "  const nm = displayName(p), fn = firstName(p);\n" +
   "  const svc = (metaOf(p).services || []).slice(0, 2).join(' and ') || 'automation builds';\n" +
   "  return {\n" +
   "    angle: 'white_label_overflow', trigger: String(p.clay_trigger || '').slice(0, 200) || nm + ' agency listing',\n" +
   "    pain_point: 'Client build work at agencies often comes in waves that are hard to staff.',\n" +
   "    value_proposition: 'One small scoped task from client work, delivered under the agency brand.',\n" +
   "    email_subject: nm + ': extra build capacity',\n" +
   "    first_line: nm + ' lists ' + svc + ' among its services, so client build work likely comes in waves.',\n" +
   "    body_rest: 'I build n8n, Clay and HubSpot workflows and could take one small scoped task from a client project, delivered under your brand, so you can judge the work first. Relevant proof: ' + proofSentence(AGENCY_PROOFS[0]),\n" +
   "    follow_up_1: fn + ', one concrete option: a single enrichment or CRM sync task from a current client, fixed scope, under your brand. Worth a look?',\n" +
   "    follow_up_2: fn + ', I can send a short Loom of a recent build so you can judge the quality first.',\n" +
   "    follow_up_3: fn + ', closing the loop. Happy to help when capacity gets tight.',\n" +
   "    linkedin_note: 'Hi ' + fn + ', I build n8n, Clay and HubSpot workflows and take scoped tasks from agency client work under your brand. Open to one small first task?'\n" +
   "  };\n" +
   "};\n" +
   "const templateFor = p => {\n  if (isAgency(p)) return agencyTemplate(p);   // S15\n  const t = templateDraft(p);"],
  ["  if (bad.includes('ops_team_at_small_company')) h.push(' This is a small company: write \"you\" or \"your team\", never \"ops team\".');\n",
   "  if (bad.includes('ops_team_at_small_company')) h.push(' This is a small company: write \"you\" or \"your team\", never \"ops team\".');\n" +
   "  // Sprint 15: agency rules\n" +
   "  if (bad.includes('agency_no_service')) h.push(' Name one of THEIR_SERVICES in first_line or body_rest.');\n" +
   "  if (bad.includes('agency_no_small_task')) h.push(' In body_rest, offer exactly one small first task, for example \"one small scoped task from a client project\".');\n" +
   "  if (bad.includes('seniority_claim')) h.push(' Remove any claim of years, seniority, expertise or client counts.');\n"],
  ["    angle_basis: '', account_type: c.type, product_category: c.category } };",
   "    angle_basis: '', account_type: c.type, product_category: c.category,\n    lead_track: isAgency(p) ? 'agency_partner' : 'smb_direct' } };   // S15 (plan 4.9)"],
  ["  if (!GATE_OVERRIDES.includes(String(p.account_id)) && (c.overlap || c.type === 'hardware')) {",
   "  // S15 (ADR-117): the product-overlap gate is skipped for agency_partner: agencies selling GTM services are the target.\n" +
   "  if (!GATE_OVERRIDES.includes(String(p.account_id)) && ((c.overlap && !(isAgency(p) && AT.skip_product_overlap_gate !== false)) || c.type === 'hardware')) {"],
  ["  p.__terms = productTerms(p).filter(t => !termRe(t).test(String(ANGLES[p.__angle.id] || '')));",
   "  p.__terms = isAgency(p) ? [] : productTerms(p).filter(t => !termRe(t).test(String(ANGLES[p.__angle.id] || '')));   // S15: their services are the work I offer"],
  ["  row.trigger = p.trigger_ok ? String(p.clay_trigger).slice(0, 200) : '';\n",
   "  row.trigger = p.trigger_ok ? String(p.clay_trigger).slice(0, 200) : '';\n" +
   "  // S15 (D3): agency emails and contact forms carry the portfolio link, added by code after validation (the LLM writes no links).\n" +
   "  if (isAgency(p) && O.signature_link && ['email', 'contact_form'].includes(p.channel)) row.message_draft = row.message_draft + '\\n' + String(O.signature_link);\n"],
  ["  flags.push('mentions=' + (p.__mentions.join('+') || 'none'));\n",
   "  flags.push('mentions=' + (p.__mentions.join('+') || 'none'));\n  if (isAgency(p)) flags.push('track=agency_partner');   // S15\n"],
  ["    notes: p.__site ? ('Site says: ' + p.__site).slice(0, 450) : '',\n",
   "    notes: ((p.channel === 'contact_form' && metaOf(p).profile_url ? 'Contact form: ' + metaOf(p).profile_url + (p.__site ? ' | ' : '') : '') + (p.__site ? 'Site says: ' + p.__site : '')).slice(0, 450),\n"],
  ["    angle_basis: p.__angle.basis, account_type: c.type, product_category: c.category }) });",
   "    angle_basis: p.__angle.basis, account_type: c.type, product_category: c.category,\n    lead_track: isAgency(p) ? 'agency_partner' : 'smb_direct' }) });   // S15 (plan 4.9)"]
]);
console.log('done');
