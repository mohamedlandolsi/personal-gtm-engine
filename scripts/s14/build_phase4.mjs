// Sprint 14 Phase 4 (draft quality): build Draft Outreach and Add Outreach Stats from the LIVE bodies plus the guide.
// Usage: node scripts/s14/build_phase4.mjs <dir with the live node bodies>
// Guide text used verbatim: TECH (3.1), rules block (4.1), prompt edits (4.2). Nothing from the guide is retyped here.
import fs from 'node:fs';
import path from 'node:path';
import { read, once, compileCheck } from './lib_patch.mjs';

const live = process.argv[2];
const out = path.resolve('scripts/s14');
const R = String.raw;

const tech = read(path.join(out, 'guide', 'tech_3_1.js'));
const rules = read(path.join(out, 'guide', 'rules_4_1.js'));
const prompt = JSON.parse(read(path.join(out, 'guide', 'prompt_4_2.json')));

// 4.1 splits in two: the rules (CATS ... motionOf) and the validator v2 lines that go inside validate().
const V2_MARK = '// Fix 7: validator v2.';
const vi = rules.indexOf(V2_MARK);
if (vi < 0) throw new Error('validator v2 marker not found in the guide rules');
const rulesA = rules.slice(0, vi).replace(/\n+$/, '\n');
const v2Lines = rules.slice(vi).split('\n').slice(1).filter(l => l.trim());      // drop the instruction comment line
if (v2Lines.length !== 6) throw new Error('expected 6 validator v2 lines, got ' + v2Lines.length);

const spans = (s) => (s.match(/`([^`]+)`/g) || []).map(x => x.slice(1, -1));

let s = read(path.join(live, 'Draft Outreach.js'));
const liveDashes = (s.match(/[‐-―]/g) || []).length;

// ---------------------------------------------------------------- settings
s = once(s, R`const W = { total: [Number((O.words || {}).min || 70), Number((O.words || {}).max || 120)], note: [20, 40] };
`, R`const W = { total: [Number((O.words || {}).min || 70), Number((O.words || {}).max || 120)], note: [20, 40] };
const NOTES_MAX = 600;   // risk_notes length. Sprint 14 adds 5 flags, so the cap went from 450 to 600 to keep the llm_errors readable.
`, 'settings: NOTES_MAX');

// ---------------------------------------------------------------- 3. companyTools: script-detected tools only
s = once(s, R`const companyTools = p => {
  const blob = (String(p.tech_stack || '') + ' ' + String(p.clay_summary || '')).toLowerCase().replace(/_/g, ' ');
  return WATCH.filter(t => has(blob, t) && t !== 'google analytics');   // analytics is not a source of lead data
};`, R`// Sprint 14 (Fix 4): only tools the homepage really loads (script, embed or form host). Nothing from clay_summary or tech_stack.
// Analytics is left out: it is not a source of lead data.
const companyTools = p => (p.__tools || []).filter(t => t !== 'google_analytics').map(t => t.replace(/_/g, ' '));`, 'companyTools');

// ---------------------------------------------------------------- 1 + 2. TECH, rules block, siteFetch
s = once(s, R`// When there is no Clay summary, read what the company says about itself on its own homepage (title + meta description).
// One free GET per company, fixed rules, no LLM. Cached per domain for the run.
const siteCache = {};
`, `// ---------- Sprint 14: tool signatures (guide 3.1) and the classify / angle rules (guide 4.1), copied from the guide ----------
${tech}
${rulesA}// ---------- end of the Sprint 14 rules ----------

// Sprint 14 (Fix 4, 8): the homepage is always read, once per company and run. One free GET, fixed rules, no LLM.
// It gives the description, the tools the page really loads (TECH) and how the company sells (motionOf).
const siteCache = {};
`, 'site: header + rules');

s = once(s, R`const siteFacts = async (p) => {
  const d = String(p.domain || '').toLowerCase().trim();
  if (!d || SITE.enabled === false) return '';
  if (siteCache[d] !== undefined) return siteCache[d];
  let out = '';
`, R`const SITE_FAIL = { ok: false, desc: '', title: '', tools: [], mentions: [], demo: '', selfserve: '', booking: false };
const siteFetch = async (p) => {
  const d = String(p.domain || '').toLowerCase().trim();
  if (!d) return SITE_FAIL;
  if (siteCache[d] !== undefined) return siteCache[d];
  let out = SITE_FAIL;
`, 'site: function head');

// The bot-wall test keeps the live regex; it is lifted from the live code, not retyped.
const wall = s.match(/if \((\/access denied[^\n]*?\/i)\.test\(out\)\) out = '';/);
if (!wall) throw new Error('bot-wall regex not found in the live code');
s = once(s, `      out = [title, desc].filter(Boolean).join(' | ').slice(0, 420);
      if (${wall[1]}.test(out)) out = '';
    }
  } catch (e) { out = ''; }
`, `      // A bot wall or an error page is not the homepage: treat it as unreachable.
      if (!${wall[1]}.test([title, desc].filter(Boolean).join(' | '))) {
        const tools = TECH.filter(([, re]) => re.test(html)).map(([name]) => name);
        const seen = tools.map(t => t.replace(/_/g, ' '));
        const low = html.toLowerCase();
        const mentions = WATCH.filter(t => has(low, t) && !seen.includes(t));   // named on the page, but no script evidence
        out = Object.assign({ ok: true, desc, title, tools, mentions }, motionOf(html));
      }
    }
  } catch (e) { out = SITE_FAIL; }
`, 'site: result');

// ---------------------------------------------------------------- 5. prompt edits, guide 4.2 (SYSTEM rows)
for (const row of prompt.filter(r => r.where === 'SYSTEM')) {
  const oldStart = spans(row.old_starts_with)[0];
  const newText = spans(row.new_text)[0];
  if (!oldStart || !newText || newText.includes("'")) throw new Error('unexpected 4.2 row: ' + JSON.stringify(row));
  const lines = s.split('\n');
  const hits = lines.map((l, i) => (l.startsWith("  '" + oldStart) ? i : -1)).filter(i => i >= 0);
  if (hits.length !== 1) throw new Error('SYSTEM line not unique (' + hits.length + '): ' + oldStart);
  if (!lines[hits[0]].endsWith("',")) throw new Error('SYSTEM line has an unexpected ending: ' + lines[hits[0]].slice(-20));
  lines[hits[0]] = "  '" + newText + "',";
  s = lines.join('\n');
}

// hints(), own_product
{
  const row = prompt.find(r => /hints\(\)/.test(r.where));
  const oldSpan = spans(row.old_starts_with)[0];      // ...and offer help ... instead (...)
  const newSpan = spans(row.new_text)[0];             // ...and keep to the ANGLE.
  const startText = oldSpan.replace(/^\.\.\./, '').replace(/\(\.\.\.\)$/, '(');
  const a = s.indexOf(startText);
  if (a < 0 || s.indexOf(startText, a + 1) >= 0) throw new Error('hints anchor not unique: ' + startText);
  const b = s.indexOf(").'", a);
  if (b < 0) throw new Error('hints end not found');
  s = s.slice(0, a) + newSpan.replace(/^\.\.\./, '') + s.slice(b + 2);
}

// userPrompt(): TRIGGER_FACT line, then ANGLE and ANGLE_BASIS
{
  const row = prompt.find(r => /userPrompt\(\)/.test(r.where));
  const [trig, angle, basis] = spans(row.new_text);
  if (!trig.startsWith("'TRIGGER_FACT: '") || !angle.startsWith("'ANGLE: '") || !basis.startsWith("'ANGLE_BASIS: '")) throw new Error('unexpected userPrompt row');
  s = once(s, R`  'TRIGGER_FACT: ' + (String(p.clay_trigger || '').slice(0, 200) || 'none'),
`, `  ${trig},
  ${angle},
  ${basis},
`, 'userPrompt: trigger + angle');
}

// ---------------------------------------------------------------- 1. validator v2, at the end of validate()
s = once(s, R`  if (nums.length) bad.push('invented_numbers:' + nums.join(','));
  return bad;
};`, `  if (nums.length) bad.push('invented_numbers:' + nums.join(','));
  // Fix 7: validator v2 (Sprint 14, guide 4.1). A paragraph must end with punctuation; no 12 words in a row copied from the summary or the site.
${v2Lines.map(l => '  ' + l).join('\n')}
  return bad;
};`, 'validate: v2');

// ---------------------------------------------------------------- 7. templateDraft: no summary text
s = once(s, R`  const clayObs = (String(p.clay_summary || '').split(/\.\s/)[0] || '').replace(/\.$/, '').slice(0, 150);
  // No Clay summary: say only what was actually seen (a tool on their site), never a generic claim about the company.
  const obs = clayObs || (tools ? 'I noticed ' + tools + ' on the ' + nm + ' site' : nm + ' came up while I was looking at B2B teams that run their own lead operations');
`, R`  // Sprint 14 (Fix 7): the template never uses summary text. It says only what was actually seen (a tool the site loads), or a neutral sentence.
  const obs = tools ? 'I noticed ' + tools + ' on the ' + nm + ' site' : nm + ' came up while I was looking at B2B teams that run their own lead operations';
`, 'template: obs');
s = once(s, R`', lead enrichment and routing often stay manual' + (tools && clayObs ? ' between tools such as ' + tools : '') + '.',`,
  R`', lead enrichment and routing often stay manual.',`, 'template: first_line');

// ---------------------------------------------------------------- 4. gate rows
s = once(s, R`// ---------- run ----------
`, R`// ---------- Sprint 14 gate rows ----------
// A gated pair still gets a visible row (rejected, 0 LLM calls), so the same contact is not fetched again every run.
const GATE_OVERRIDES = (Array.isArray(O.gate_overrides) ? O.gate_overrides : []).map(String);
const gateRow = (p, gate, scope, c) => {
  const what = gate === 'product_overlap' ? c.category : c.type;
  const how = gate === 'no_angle'
    ? 'No angle in the library fits this business model. Re-draft after a new dated trigger.'
    : 'Add the account_id to outreach.gate_overrides and Re-draft to override.';
  return { json: {
    run_date: new Date().toISOString(),
    outreach_id: 'or_' + String(p.contact_id || '').replace(/\s+/g, '_') + '_' + Date.now().toString(36),
    account_id: p.account_id, contact_id: p.contact_id, company_name: p.company_name, contact_name: p.full_name,
    channel: p.channel,
    angle: '', trigger: '', pain_point: '', value_proposition: '', proof_point: '', cta: '', email_subject: '', first_line: '',
    message_draft: '', follow_up_1: '', follow_up_2: '', follow_up_3: '', linkedin_note: '',
    risk_notes: ['gate=' + gate, 'account_type=' + c.type, 'product_category=' + c.category,
      'tools=' + ((p.__tools || []).join('+') || 'none'), 'mentions=' + ((p.__mentions || []).join('+') || 'none'),
      'trigger=' + (p.trigger_ok ? (p.clay_trigger_source || 'clay') : 'none')].join('; ').slice(0, NOTES_MAX),
    approval_status: 'rejected', reject_scope: scope, send_status: 'not_sent', sent_at: '', reply_received: '',
    notes: 'Auto-skipped by the Sprint 14 gate (' + gate + '): ' + what + '. ' + how,
    llm_provider: 'gate:' + gate, llm_calls: 0, llm_failures: 0,
    angle_basis: '', account_type: c.type, product_category: c.category } };
};

// ---------- run ----------
`, 'gate rows');

s = once(s, R`let leftForNextRun = 0;
`, R`let leftForNextRun = 0;
const dstats = { skipped_site_unreachable: 0 };   // read by Add Outreach Stats
`, 'run: dstats');

s = once(s, R`  if (Date.now() - T0 > RUN_BUDGET_MS) { leftForNextRun = pairs.length - pi; break; }
  if (!first) await sleep(PACE_MS);
  first = false;

  p.__site = String(p.clay_summary || '').trim() ? '' : await siteFacts(p);
  const factsLevel`, R`  if (Date.now() - T0 > RUN_BUDGET_MS) { leftForNextRun = pairs.length - pi; break; }

  // ---- Sprint 14 gates: fixed rules, in this order, all before any LLM call ----
  // a. The homepage must be readable: it carries the tools and the selling motion. No row is written, so the pair is re-checked next run.
  const site = await siteFetch(p);
  if (!site.ok) { dstats.skipped_site_unreachable++; continue; }
  p.__tools = site.tools;
  p.__mentions = site.mentions;
  // p.__site keeps its meaning: the homepage text is used as company facts only when there is no Clay summary.
  p.__site = (String(p.clay_summary || '').trim() || SITE.enabled === false) ? '' : [site.title, site.desc].filter(Boolean).join(' | ').slice(0, 420);
  // b. Sells GTM tooling, or is hardware: a visible rejected row with scope account, no LLM call (ADR-106).
  const c = classify(p, site);
  if (!GATE_OVERRIDES.includes(String(p.account_id)) && (c.overlap || c.type === 'hardware')) {
    out.push(gateRow(p, c.overlap ? 'product_overlap' : 'hardware', 'account', c));
    continue;
  }
  // c. Code picks the angle (ADR-107). No angle fits: a rejected row with scope pitch.
  p.__angle = pickAngle(p, c, site);
  if (!p.__angle) { out.push(gateRow(p, 'no_angle', 'pitch', c)); continue; }

  // Pause between LLM drafts only: gate rows make no LLM call.
  if (!first) await sleep(PACE_MS);
  first = false;

  const factsLevel`, 'run: gates');

// ---------------------------------------------------------------- 6. after the provider loop
s = once(s, R`  if (!row) {
    row = assemble(p, templateFor(p));
    const bad = validate(p, row);
    if (bad.length) errs.push('template_warn:' + bad.join('|'));
  }
`, R`  // Sprint 14 (Fix 7): a template draft, or a draft that still fails the validator, is parked in needs_redraft, outside Review.
  let status = 'pending';
  if (!row) { row = assemble(p, templateFor(p)); status = 'needs_redraft'; }
  const finalBad = validate(p, row);
  if (finalBad.length) { status = 'needs_redraft'; errs.push('final_invalid:' + finalBad.join('|')); }
  // Only now: the stored angle and trigger are set by code, never by the LLM (Fix 6, Fix 8).
  row.angle = p.__angle.id;
  row.trigger = p.trigger_ok ? String(p.clay_trigger).slice(0, 200) : '';
`, 'run: final status');

// ---------------------------------------------------------------- 8. flags and output row
s = once(s, R`  flags.push('trigger=' + (String(p.clay_trigger || '').trim() ? (p.clay_trigger_source || 'clay') : 'none'));
  if (factsLevel === 'none') flags.push('no_company_facts');
  flags.push('facts_tools=' + (companyTools(p).join('+') || 'none'));
  if (p.__terms.length) flags.push('their_product=' + p.__terms.join('+'));
`, R`  flags.push('trigger=' + (p.trigger_ok ? (p.clay_trigger_source || 'clay') : 'none'));
  if (factsLevel === 'none') flags.push('no_company_facts');
  if (p.__terms.length) flags.push('their_product=' + p.__terms.join('+'));
  // Sprint 14: what the code decided, plus the evidence: tools = scripts the page loads, mentions = names on the page only.
  flags.push('angle=' + p.__angle.id);
  flags.push('account_type=' + c.type);
  flags.push('product_category=' + c.category);
  flags.push('tools=' + (p.__tools.join('+') || 'none'));
  flags.push('mentions=' + (p.__mentions.join('+') || 'none'));
`, 'run: flags');

s = once(s, R`    risk_notes: (flags.join('; ') + (errs.length ? ' | llm_errors: ' + errs.join(' ; ') : '')).slice(0, 450),
    approval_status: 'pending', send_status: 'not_sent', sent_at: '', reply_received: '',
    notes: p.__site ? ('Site says: ' + p.__site).slice(0, 450) : '',
    llm_provider: provider, llm_calls: calls, llm_failures: fails }) });`, R`    risk_notes: (flags.join('; ') + (errs.length ? ' | llm_errors: ' + errs.join(' ; ') : '')).slice(0, NOTES_MAX),
    approval_status: status, reject_scope: '', send_status: 'not_sent', sent_at: '', reply_received: '',
    notes: p.__site ? ('Site says: ' + p.__site).slice(0, 450) : '',
    llm_provider: provider, llm_calls: calls, llm_failures: fails,
    angle_basis: p.__angle.basis, account_type: c.type, product_category: c.category }) });`, 'run: output row');

s = once(s, R`  last.risk_notes = ('run_budget_hit: ' + leftForNextRun + ' contact(s) left for the next run; ' + last.risk_notes).slice(0, 450);
}
return out;`, R`  last.risk_notes = ('run_budget_hit: ' + leftForNextRun + ' contact(s) left for the next run; ' + last.risk_notes).slice(0, NOTES_MAX);
}
// The counter rides on the first row as a key that is not a column (gtm_insert_draft ignores it). Add Outreach Stats reads it.
if (out.length) out[0].json.__draft_stats = dstats;
return out;`, 'run: end');

// ---------------------------------------------------------------- checks and save
if (s.includes('siteFacts(')) throw new Error('siteFacts is still referenced');
if (s.includes('clayObs')) throw new Error('clayObs is still referenced');
if (!s.includes(tech) || !s.includes(rulesA)) throw new Error('guide blocks are not verbatim in the node');
for (const l of v2Lines) if (!s.includes('  ' + l)) throw new Error('validator v2 line missing: ' + l.slice(0, 60));
const dashes = (s.match(/[‐-―]/g) || []).length;
if (dashes !== liveDashes) throw new Error('dash count changed: live ' + liveDashes + ', new ' + dashes);
compileCheck(s, 'Draft Outreach');
fs.writeFileSync(path.join(out, 'Draft Outreach.js'), s);
console.log(`built Draft Outreach.js (${s.length} chars; dash characters unchanged at ${dashes}, all inside the live norm() helper)`);

// ---------------------------------------------------------------- Add Outreach Stats
let a = read(path.join(live, 'Add Outreach Stats.js'));
a = once(a, R`const rows = safeAll('Draft Outreach').filter(r => r && r.contact_id);
base.stats.outreach = Object.assign({}, prev, {
  drafted: rows.length,
`, R`const all = safeAll('Draft Outreach');
const rows = all.filter(r => r && r.contact_id);
// Sprint 14: drafted = pending rows only. Failed drafts, gate rows and unreachable sites are counted on their own.
const by = (status) => rows.filter(r => String(r.approval_status || '') === status).length;
const gate = (name) => rows.filter(r => String(r.llm_provider || '') === 'gate:' + name).length;
const ds = (all.find(r => r && r.__draft_stats) || {}).__draft_stats;
base.stats.outreach = Object.assign({}, prev, {
  drafted: by('pending'),
  needs_redraft: by('needs_redraft'),
  skipped_gate_overlap: gate('product_overlap'),
  skipped_gate_hardware: gate('hardware'),
  skipped_gate_no_angle: gate('no_angle'),
  // From the Draft Outreach stats. With no row at all, every selected pair was unreachable.
  skipped_site_unreachable: ds ? (Number(ds.skipped_site_unreachable) || 0) : Math.max(0, (Number(prev.pairs) || 0) - rows.length),
`, 'stats: counters');
if (/[‐-―]/.test(a)) throw new Error('dash in Add Outreach Stats');
compileCheck(a, 'Add Outreach Stats');
fs.writeFileSync(path.join(out, 'Add Outreach Stats.js'), a);
console.log(`built Add Outreach Stats.js (${a.length} chars)`);
