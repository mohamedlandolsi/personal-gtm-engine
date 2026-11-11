// Fix 5 and 8: what the company sells, how it sells, which angle fits. Fixed rules, no LLM.
const CATS = [
  ['crm',            /\bcrm\b|customer relationship management/],
  ['outbound',       /outbound (?:sales )?(?:platform|software|tool|engine|outreach|service)|cold email|\bai sdr|sales sequences?|multichannel sequences?|prospecting (?:tool|platform|software)/],
  ['enrichment',     /enrichment|contact data|b2b data|data provider|intent (?:data|signals?)|verified data/],
  ['deliverability', /deliverability|email warm-?up|inbox placement/],
  ['sales_tech',     /sales engagement|sales enablement|revenue intelligence|conversation intelligence|sales coach|sales copilot|ai sales (?:agent|assistant)|coaches reps|demo automation/],
  ['automation',     /workflow automation|no-code automation|document (?:automation|processing)|\brpa\b|integration platform|ai agents? for (?:sales|gtm|revenue)/]
];
const OVERLAP = ['crm', 'outbound', 'enrichment', 'deliverability', 'sales_tech', 'automation'];
const SERVICE = /\bagency\b|consultan|done-for-you|fully managed|we help|marketing services|lead generation services/;
const LEAD_SELLER = /pay[- ]per[- ]lead|pay-per-sale|lead generation|\bleads? (?:delivered|per month|a month)|valid leads|qualified leads|appointment setting/;
const HARDWARE = /\brobot|hardware|manufactur|semiconductor|\bsensors?\b|\bdrones?\b|biotech|medical device|lab equipment|satellite/;
const HIRE_MATCH = /revops|revenue operations|\bgtm\b|go-to-market|sales ops|sales operations|marketing ops|marketing operations|\bops\b|operations|\bcrm\b|automation/i;

const classify = (p, site) => {
  const text = [p.company_name, p.industry, p.company_type, p.clay_summary, site.desc, site.title].map(s => String(s || '')).join(' ').toLowerCase();
  let category = (CATS.find(([, re]) => re.test(text)) || ['other'])[0];
  if (category === 'other' && /->\s*sales\b/.test(String(p.industry || '').toLowerCase())) category = 'sales_tech';   // YC tag "B2B -> Sales"
  const service = String(p.company_type || '') === 'agency' || SERVICE.test(text);
  let type = 'other';
  if (HARDWARE.test(text) && !service) type = 'hardware';
  else if (service && LEAD_SELLER.test(text)) type = 'lead_seller';
  else if (service) type = 'agency';
  else if (site.demo) type = 'demo_saas';
  else if (site.selfserve || site.booking) type = 'self_serve_saas';
  return { category, type, overlap: OVERLAP.includes(category) && type !== 'lead_seller' };
};

const ANGLES = {
  hire_bridge:       'Offer to take part of the new role setup work (CRM, enrichment, reporting) as a contractor while they hire, or next to the new person.',
  delivery_ops:      'Offer a lead delivery layer: validate and dedupe each lead before it is billed or sent, route it to the right client, log every decision for disputes.',
  client_reporting:  'Offer one automated report per client: pull pipeline and campaign data from each client CRM, clean it, send the same report every week.',
  demo_brief:        'Offer a demo request flow: look up the company behind each request, flag best-fit accounts, send a short brief before the call, follow up no-shows.',
  booking_followup:  'Offer a booking flow: pick up each booking, add it to the CRM with a short brief before the call, follow up people who do not convert.',
  signup_activation: 'Offer a new-signup flow: enrich each signup, flag accounts worth a personal reply, send a weekly list of high-fit signups.'
};
const firstSentence = (s, re) => (String(s || '').split(/(?<=[.!?])\s+/).find(x => re.test(x.toLowerCase())) || '').slice(0, 220);
const pickAngle = (p, c, site) => {
  const trig = String(p.clay_trigger || '');
  if (p.trigger_ok && String(p.clay_trigger_source) === 'hiring' && HIRE_MATCH.test(trig)) return { id: 'hire_bridge', basis: trig };
  if (c.type === 'hardware') return null;
  if (c.type === 'lead_seller') return { id: 'delivery_ops', basis: firstSentence(p.clay_summary || site.desc, LEAD_SELLER) || 'sells leads to clients' };
  if (c.type === 'agency') return { id: 'client_reporting', basis: firstSentence(p.clay_summary || site.desc, SERVICE) || 'B2B agency serving several clients' };
  if (site.demo) return { id: 'demo_brief', basis: 'demo call to action on the homepage: ' + site.demo };
  if (site.booking) return { id: 'booking_followup', basis: 'booking link on the homepage' };
  if (site.selfserve && Number(p.employee_count) >= 10) return { id: 'signup_activation', basis: 'self-serve signup on the homepage: ' + site.selfserve };
  return null;
};

// Homepage signals, from the HTML the node already fetches.
const motionOf = (html) => {
  const low = String(html || '').toLowerCase();
  const m = (re) => { const x = low.match(re); return x ? x[0] : ''; };
  return {
    demo: m(/(?:book|request|get|schedule|see) (?:a |your )?(?:free )?demo/),
    selfserve: m(/start (?:for )?free|free trial|try (?:it )?(?:for )?free|sign up (?:for )?free|get started (?:for )?free/),
    booking: /assets\.calendly\.com|calendly\.com\/[a-z0-9_-]+|cal\.com\/[a-z0-9_-]+/.test(low)
  };
};

// Fix 7: validator v2. Add at the end of validate(), before "return bad;".
const paras = o.message_draft.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean).slice(1, -1);   // skip "Hi X," and the sender
if (paras.some(s => !/[.!?]["')]?$/.test(s))) bad.push('unpunctuated_end');
const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
const src = ' ' + words(String(p.clay_summary || '') + ' ' + String(p.__site || '')).join(' ') + ' ';
const mw = words(o.message_draft);
for (let i = 0; i + 12 <= mw.length; i++) if (src.includes(' ' + mw.slice(i, i + 12).join(' ') + ' ')) { bad.push('copied_source'); break; }
