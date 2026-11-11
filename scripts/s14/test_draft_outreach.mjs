// Sprint 14: offline test of the new Draft Outreach and Add Outreach Stats bodies. No network, no n8n, no Neon, no LLM.
// HTTP is mocked: homepages come from the SITES table below, LLM answers from a fake provider.
// Usage: node scripts/s14/test_draft_outreach.mjs      (exit code 0 = all checks passed)
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('scripts/s14');
const code = fs.readFileSync(path.join(dir, 'Draft Outreach.js'), 'utf8');
const statsCode = fs.readFileSync(path.join(dir, 'Add Outreach Stats.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const config = {
  outreach: {
    sender_name: 'Mohamed', gate_overrides: ['acc_override'],
    proof_points: ['Built a federated B2B GTM SaaS platform with FastAPI, Supabase and LLM routing',
      'Built my own outbound engine in n8n, Postgres and HubSpot, with a person approving every message',
      'Can build Clay/n8n/Apollo/HubSpot workflows for enrichment, scoring and outreach ops'],
    llm: { chain: ['groq', 'template'], politeness_ms: 0, max_wait_s: 0 }
  }
};

const page = (title, desc, body) => `<html><head><title>${title}</title><meta name="description" content="${desc}"></head><body>${body}</body></html>`;
const SITES = {
  'acme-analytics.com': page('Acme Analytics', 'Acme Analytics shows product usage for software companies in one place.',
    '<a href="/demo">Book a demo</a><script src="https://js.hs-scripts.com/123.js"></script><p>Works with Salesforce and Slack.</p>'),
  'crmco.io': page('CRMco', 'The CRM for small startups that hate data entry.', '<a>Start for free</a>'),
  'robots.dev': page('Robots', 'Warehouse robots and hardware for retail stores.', '<a>Request a demo</a>'),
  'plain.io': page('Plain', 'Internal knowledge base for engineering groups.', '<a>Contact us</a>'),
  'agency.co': page('Agency Co', 'A B2B marketing agency for software firms.', '<a>Contact</a>'),
  'override.io': page('Override', 'A CRM for dentists and clinics.', '<a>Request a demo</a>'),
  'wall.io': page('Just a moment...', '', '<p>checking your browser</p>')
};

const pair = (o) => Object.assign({
  outreach_pair: true, channel: 'email', flags: '', industry: 'software', employee_count: 30, funding_stage: 'seed',
  tech_stack: 'hubspot, zapier', clay_summary: '', why_match: '', account_score: 80, clay_trigger: '', clay_trigger_source: '',
  buyer_score: 100, region_bonus: 5, account_run_date: '2026-11-03', company_type: 'startup', website: '',
  trigger_ok: false, trigger_type: '', trigger_date: '', title: 'CEO', role_category: 'ceo', email: 'x@example.com',
  linkedin_url: '', contact_score: 90
}, o);
const pairs = [
  pair({ contact_id: 'ct_overlap', account_id: 'acc_overlap', company_name: 'CRMco', domain: 'crmco.io', full_name: 'Ana Ruiz', clay_summary: 'CRMco sells a CRM to small startups.' }),
  pair({ contact_id: 'ct_hw', account_id: 'acc_hw', company_name: 'Robots', domain: 'robots.dev', full_name: 'Ben Ode' }),
  pair({ contact_id: 'ct_plain', account_id: 'acc_plain', company_name: 'Plain', domain: 'plain.io', full_name: 'Cy Dunn' }),
  pair({ contact_id: 'ct_demo', account_id: 'acc_demo', company_name: 'Acme Analytics', domain: 'acme-analytics.com', full_name: 'Dee Park' }),
  pair({ contact_id: 'ct_hire', account_id: 'acc_hire', company_name: 'Agency Co', domain: 'agency.co', full_name: 'Eli Voss', company_type: 'agency',
    clay_trigger: 'Hiring a RevOps Manager', clay_trigger_source: 'hiring', trigger_ok: true }),
  pair({ contact_id: 'ct_down', account_id: 'acc_down', company_name: 'Down', domain: 'down.io', full_name: 'Flo Marsh' }),
  pair({ contact_id: 'ct_wall', account_id: 'acc_wall', company_name: 'Wall', domain: 'wall.io', full_name: 'Gus Hale' }),
  pair({ contact_id: 'ct_over', account_id: 'acc_override', company_name: 'Override', domain: 'override.io', full_name: 'Hal Imre' }),
  pair({ contact_id: 'ct_stale_trigger', account_id: 'acc_st', company_name: 'Acme Analytics', domain: 'acme-analytics.com', full_name: 'Ivy Lund',
    clay_trigger: 'Mentions an old blog post', clay_trigger_source: 'news', trigger_ok: false })
];

const draft = (name, first, { noPeriod } = {}) => ({
  angle: 'whatever the model says', trigger: 'none',
  pain_point: 'Demo requests may reach the call without any research.', value_proposition: 'A short brief before each call.',
  email_subject: 'Demo requests at ' + name,
  first_line: name + ' shows a demo button on its homepage, so I am curious whether each request gets researched before the call or only after it.',
  body_rest: 'I built a federated B2B GTM SaaS platform, and I can set up a demo request flow for you: look up the company behind each request, flag the best-fit accounts, send a short brief before the call, and follow up people who did not show. Curious whether that would be useful' + (noPeriod ? '' : '.'),
  follow_up_1: first + ', one concrete version: every demo request gets a short company brief before the call. Worth a look?',
  follow_up_2: first + ', I can also flag best-fit accounts and follow up no-shows, with a log of each step.',
  follow_up_3: first + ', I will leave it here.',
  linkedin_note: 'Hi ' + first + ', I build small automation flows for demo requests: a company lookup, a best-fit flag and a short brief before each call. Would a quick example be useful?'
});

const llmCalls = [];
const seenFirst = new Set();
const httpRequest = async (opts) => {
  if (opts.method === 'GET') {
    const host = new URL(opts.url).hostname;
    if (!SITES[host]) throw new Error('getaddrinfo ENOTFOUND ' + host);
    return { statusCode: 200, headers: {}, body: SITES[host] };
  }
  const user = opts.body.messages[1].content;
  const get = (k) => (user.match(new RegExp('^' + k + ': (.*)$', 'm')) || [])[1] || '';
  const name = get('COMPANY_NAME_TO_USE'), first = get('FIRST_NAME');
  llmCalls.push({ name, first, user, system: opts.body.messages[0].content });
  let content;
  if (name === 'Agency Co') content = 'sorry, no json today';                       // forces the template
  else if (first === 'Dee' && !seenFirst.has('Dee')) { seenFirst.add('Dee'); content = JSON.stringify(draft(name, first, { noPeriod: true })); }   // repaired on attempt 2
  else content = JSON.stringify(draft(name, first));
  return { statusCode: 200, headers: {}, body: { choices: [{ message: { content } }] } };
};

const $ = (name) => {
  if (name === 'Load Config') return { first: () => ({ json: { config } }), all: () => [{ json: { config } }] };
  throw new Error('node not executed: ' + name);
};
const $input = { all: () => pairs.map(json => ({ json })) };
const out = await new AsyncFunction('$', '$input', '$env', code).call({ helpers: { httpRequest } }, $, $input, { GROQ_API_KEY: 'test-key' });
const rows = out.map(i => i.json);
const by = Object.fromEntries(rows.map(r => [r.contact_id, r]));

let failed = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  got: ' + JSON.stringify(got)}`); if (!ok) failed++; };

console.log('contact | status | scope | provider | angle | account_type | product_category | llm_calls');
for (const r of rows) console.log([r.contact_id, r.approval_status, r.reject_scope || '-', r.llm_provider, r.angle || '-', r.account_type, r.product_category, r.llm_calls].join(' | '));
console.log('');

check('7 rows for 9 pairs (2 unreachable sites write no row)', rows.length === 7, rows.length);
check('unreachable counter = 2 (DNS error and bot wall), on the first row', rows[0].__draft_stats && rows[0].__draft_stats.skipped_site_unreachable === 2, rows[0].__draft_stats);
let r = by.ct_overlap;
check('product overlap: rejected, scope account, gate:product_overlap, 0 LLM calls', r.approval_status === 'rejected' && r.reject_scope === 'account' && r.llm_provider === 'gate:product_overlap' && r.llm_calls === 0 && r.message_draft === '' && r.product_category === 'crm', r);
check('gate note names the gate and the override', /^Auto-skipped by the Sprint 14 gate \(product_overlap\): crm\. Add the account_id to outreach\.gate_overrides and Re-draft to override\.$/.test(r.notes), r.notes);
r = by.ct_hw;
check('hardware: rejected, scope account, gate:hardware', r.approval_status === 'rejected' && r.reject_scope === 'account' && r.llm_provider === 'gate:hardware' && r.account_type === 'hardware', r);
r = by.ct_plain;
check('no angle: rejected, scope pitch, gate:no_angle', r.approval_status === 'rejected' && r.reject_scope === 'pitch' && r.llm_provider === 'gate:no_angle' && r.angle_basis === '', r);
r = by.ct_demo;
check('demo SaaS: pending, angle demo_brief set by code, basis from the homepage', r.approval_status === 'pending' && r.angle === 'demo_brief' && r.angle_basis === 'demo call to action on the homepage: book a demo' && r.account_type === 'demo_saas', r);
check('demo SaaS: repaired after unpunctuated_end (2 calls, 1 failure)', r.llm_calls === 2 && r.llm_failures === 1 && /groq:invalid:unpunctuated_end/.test(r.risk_notes), r.risk_notes);
check('tools come from scripts only; a named tool is a mention', /tools=hubspot;/.test(r.risk_notes) && /mentions=salesforce\+slack/.test(r.risk_notes) && !/facts_tools/.test(r.risk_notes), r.risk_notes);
check('trigger stored empty when there is no valid trigger', r.trigger === '' && /trigger=none/.test(r.risk_notes), [r.trigger, r.risk_notes]);
check('message ends each paragraph with punctuation', !r.message_draft.split(/\n\s*\n/).slice(1, -1).some(s => !/[.!?]["')]?$/.test(s.trim())), r.message_draft);
r = by.ct_hire;
check('hiring trigger: angle hire_bridge, trigger copied by code', r.angle === 'hire_bridge' && r.trigger === 'Hiring a RevOps Manager' && r.angle_basis === 'Hiring a RevOps Manager', r);
check('LLM failed twice: template, parked in needs_redraft', r.approval_status === 'needs_redraft' && r.llm_provider === 'template' && /template_review_hard/.test(r.risk_notes), r);
check('template text has no summary sentence and ends with punctuation', /came up while I was looking at B2B teams/.test(r.first_line) && /\.$/.test(r.first_line), r.first_line);
r = by.ct_over;
check('gate override: an overlap account in outreach.gate_overrides is drafted', r.approval_status === 'pending' && r.product_category === 'crm' && r.angle === 'demo_brief', r);
r = by.ct_stale_trigger;
check('invalid trigger is not shown to the LLM', llmCalls.filter(c => c.first === 'Ivy').every(c => /^TRIGGER_FACT: none$/m.test(c.user)) && r.trigger === '', r.trigger);
const u = llmCalls.find(c => c.first === 'Dee').user;
check('prompt carries ANGLE and ANGLE_BASIS', /^ANGLE: Offer a demo request flow:/m.test(u) && /^ANGLE_BASIS: demo call to action on the homepage: book a demo$/m.test(u), u);
check('prompt lists only script-detected tools', /^ALLOWED_COMPANY_TOOLS: hubspot$/m.test(u), u.match(/^ALLOWED_COMPANY_TOOLS.*$/m));
const sys = llmCalls[0].system;
check('SYSTEM has the 4 new lines and none of the old ones', /WHAT YOU OFFER: exactly the ANGLE/.test(sys) && /set trigger to "none"\./.test(sys) && /else from ANGLE_BASIS/.test(sys) && /the ANGLE as one concrete workflow for them\./.test(sys) && !/OWN go-to-market operations|THEIR OWN incoming leads/.test(sys), '');
check('no em dash in any output text', !rows.some(x => /—/.test(JSON.stringify(x))), '');
check('no LLM call for gate rows (calls only for Dee, Eli, Hal, Ivy)', [...new Set(llmCalls.map(c => c.first))].sort().join(',') === 'Dee,Eli,Hal,Ivy', [...new Set(llmCalls.map(c => c.first))]);

// ---- Add Outreach Stats on the same rows ----
const statsIn = { __row_type: 'stats', stats: { outreach: { pairs: pairs.length, drafted: 0, llm_calls: 0, llm_failures: 0, skipped_blocked: 3 } } };
const $s = (name) => { if (name === 'Draft Outreach') return { all: () => out }; throw new Error('node not executed: ' + name); };
const sOut = await new AsyncFunction('$', '$input', statsCode)($s, { first: () => ({ json: statsIn }) });
const o = sOut[0].json.stats.outreach;
console.log('\nstats.outreach = ' + JSON.stringify(o));
check('stats: drafted = pending only (3), needs_redraft 1', o.drafted === 3 && o.needs_redraft === 1, o);
check('stats: gate rows by kind (1 / 1 / 1) and 2 unreachable', o.skipped_gate_overlap === 1 && o.skipped_gate_hardware === 1 && o.skipped_gate_no_angle === 1 && o.skipped_site_unreachable === 2, o);
check('stats: earlier counters are kept', o.skipped_blocked === 3 && o.pairs === pairs.length, o);
const sOut2 = await new AsyncFunction('$', '$input', statsCode)((n) => ({ all: () => [] }), { first: () => ({ json: statsIn }) });
check('stats: no rows at all means every pair was unreachable', sOut2[0].json.stats.outreach.skipped_site_unreachable === pairs.length, sOut2[0].json.stats.outreach);

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
