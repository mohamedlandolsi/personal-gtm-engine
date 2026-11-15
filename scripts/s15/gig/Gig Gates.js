// Gig Gates (Code node, Run Once for All Items). Sprint 15, ADR-116.
// Normalizes every post from Merge Posts, then runs the fixed gates in plan order, before any LLM call:
// seen, intent, freshness, crowding, veto, stack, budget. Every drop is counted.
// Gated posts keep status gated_out plus gate_reason (they are still upserted, for telemetry and dedupe).
// Seen posts (already drafted, sent, answered or expired) are counted and dropped here.
const cfg = $('Load Config').first().json.config || {};
const G = cfg.gig || {};
const MAX_AGE_H = Number(G.max_age_hours ?? 72);
const MAX_REPLIES = Number(G.max_replies ?? 25);
const MIN_RATE = G.min_hourly_usd === null || G.min_hourly_usd === undefined || G.min_hourly_usd === '' ? null : Number(G.min_hourly_usd);
const VETO = (G.veto_keywords || []).map(s => String(s).toLowerCase()).filter(Boolean);
const STACK_KW = (G.stack_keywords || []).map(s => String(s).toLowerCase()).filter(Boolean);
const MY_STACK = (G.my_stack || []).map(String).filter(Boolean);

const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (kw) => new RegExp('(^|[^a-z0-9])' + esc(kw.toLowerCase()) + '([^a-z0-9]|$)', 'i');
const clean = s => String(s == null ? '' : s).replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

// ---------- inputs ----------
const sourceNotes = [];
const raw = [];
for (const it of $('Merge Posts').all()) {
  const j = it.json || {};
  if (j.__skipped) { sourceNotes.push(String(j.__skipped)); continue; }
  if (j.__error) { sourceNotes.push('ERROR ' + String(j.__error)); continue; }
  if (j.__stats) { sourceNotes.push(typeof j.__stats === 'string' ? j.__stats : JSON.stringify(j.__stats)); continue; }
  if (j.post_key) raw.push(j);
}
const seen = new Map();
for (const it of $('Fetch Seen Gigs').all()) { const j = it.json || {}; if (j.post_key) seen.set(String(j.post_key), String(j.status || '')); }

// One row per post_key; the longest body wins (a post can arrive by mail and by a manual add).
const byKey = new Map();
for (const r of raw) {
  const k = String(r.post_key).trim();
  const prev = byKey.get(k);
  if (!prev || String(r.body_text || '').length > String(prev.body_text || '').length) byKey.set(k, r);
}

const C = { fetched: byKey.size, already_seen: 0, intent_for_hire: 0, intent_unclear: 0, stale: 0, crowded: 0,
            vetoed: 0, stack_miss: 0, budget_low: 0, passed: 0 };

// ---------- intent (ADR-116) ----------
const TAG_HIRING = /\[(hiring|paid|job|task|gig|hire)\]/i;
const TAG_FOR_HIRE = /\[(for hire|available|offering|seeking work)\]/i;
const FOR_HIRE = /\bfor hire\b|available for (hire|work)|seeking work|open to work|\bi'?m available\b|\bhire me\b|offering my services|my services/i;
const HIRING = /\bhiring\b|looking for|seeking (a |an )?(freelancer|developer|builder|expert|consultant|engineer)|\bneed (an? |help|someone)|\bwanted\b|paid (job|task|trial|project)|\bcontract\b|\bbudget\b|\bwho can\b/i;

// ---------- extractors ----------
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const DM = /\b(dm|pm) me\b|send me a (dm|pm|message)|direct message|message me|reach out (to me )?(privately|directly)|via dm/i;
const RATE = /(?:\$|usd\s?|us\$)\s?(\d{1,4}(?:\.\d+)?)\s*(?:\/\s?h(?:ou)?r?\b|per hour|an hour|hourly|\/h\b)|(\d{1,4}(?:\.\d+)?)\s?(?:usd|\$)\s*(?:\/\s?h(?:ou)?r?\b|per hour|an hour|hourly)/i;
const BUDGET = /(?:budget|pay|paying|rate|fixed price|price)[^.\n]{0,40}?(?:[$€£]\s?\d[\d,.]*k?|\d[\d,.]*\s?(?:usd|eur|gbp|dollars|euros))|[$€£]\s?\d[\d,.]*k?(?:\s?(?:\/\s?h(?:ou)?r?|per hour|hourly|fixed))?/i;
const REMOTE = /\bremote\b|\basync\b|anywhere|\b(eu|uk|cet|gmt|bst|emea)\b|europe|time ?zone/i;

const out = [];
const nowMs = Date.now();
for (const [k, r] of byKey) {
  const title = clean(r.title).slice(0, 300);
  const body = clean(r.body_text).slice(0, 4000);
  const head = (title + '\n' + body.slice(0, 300));
  const all = (title + '\n' + body).toLowerCase();
  const posted = r.posted_at ? new Date(r.posted_at) : null;
  const ageH = posted && !isNaN(posted.getTime()) ? (nowMs - posted.getTime()) / 3600000 : null;
  const replies = r.reply_count === null || r.reply_count === undefined || r.reply_count === '' ? null : Number(r.reply_count);
  const email = (body.match(EMAIL) || [''])[0];
  const rate = body.match(RATE) || title.match(RATE);
  const rateUsd = rate ? Number(rate[1] || rate[2]) : null;
  const matched = MY_STACK.filter(t => word(t).test(all));
  const stackHits = STACK_KW.filter(t => word(t).test(all));

  const post = {
    post_key: k, platform: r.platform, url: r.url, title, body_text: body,
    poster: clean(r.poster).slice(0, 120), poster_company: clean(r.poster_company).slice(0, 120),
    posted_at: posted && !isNaN(posted.getTime()) ? posted.toISOString() : null,
    reply_count: Number.isFinite(replies) ? replies : null,
    contact_email: email, contact_hint: email ? 'email' : (DM.test(body) ? 'dm_invited' : 'reply'),
    stated_budget: ((body.match(BUDGET) || title.match(BUDGET) || [''])[0]).slice(0, 80),
    remote_hint: ((all.match(REMOTE) || [''])[0]).slice(0, 40),
    matched_stack: matched.join(', '),
    intent: 'unclear', status: 'new', gate_reason: '',
    __age_h: ageH === null ? null : Math.round(ageH * 10) / 10,
    __stack_hits: stackHits.length, __rate_usd: rateUsd, __source: r.__source || r.platform
  };

  // 1. seen: already drafted, sent, answered or expired. Not upserted again.
  const st = seen.get(k);
  if (st) { C.already_seen++; continue; }

  // 2. intent
  if (TAG_HIRING.test(title)) post.intent = 'hiring';
  else if (TAG_FOR_HIRE.test(title) || FOR_HIRE.test(head)) post.intent = 'for_hire';
  else if (HIRING.test(head)) post.intent = 'hiring';
  const gate = (reason, counter) => { post.status = 'gated_out'; post.gate_reason = reason; C[counter]++; };
  if (post.intent === 'for_hire') gate('intent_for_hire', 'intent_for_hire');
  else {
    if (post.intent === 'unclear') C.intent_unclear++;
    // 3. freshness, 4. crowding, 5. veto, 6. stack, 7. budget
    if (ageH !== null && ageH > MAX_AGE_H) gate('stale', 'stale');
    else if (post.reply_count !== null && post.reply_count > MAX_REPLIES) gate('crowded', 'crowded');
    else {
      const v = VETO.find(kw => word(kw).test(all));
      if (v) gate('veto:' + v, 'vetoed');
      else if (!stackHits.length && !matched.length) gate('stack_miss', 'stack_miss');
      else if (MIN_RATE !== null && Number.isFinite(MIN_RATE) && rateUsd !== null && rateUsd < MIN_RATE) gate('budget_low:' + rateUsd, 'budget_low');
    }
  }
  if (post.status === 'new') C.passed++;
  out.push({ json: post });
}

out.push({ json: { __gate_stats: C, __source_notes: sourceNotes.slice(0, 10) } });
return out;
