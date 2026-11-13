const cfg = $('Load Config').first().json.config || {};
const items = $input.all().map(i => i.json);
const safeAll = (name) => { try { return $(name).all().map(i => i.json); } catch (e) { return []; } };
const norm = (d) => String(d || '').toLowerCase().trim();
// S14 patch: domains the finder already answered (a person or NO_RESULT), and domains with contacts on file.
const answered = new Set(safeAll('Fetch Contact Results').map(r => norm(r.domain)).filter(d => d && d !== '__placeholder__'));
const onFile = new Set(safeAll('Fetch Seen Contacts').map(r => norm(r.account_domain)).filter(d => d && d !== 'placeholder'));
let closedNone = 0, closedFound = 0;
const statsItem = items.find(r => r && r.__row_type === 'stats');
const contactRows = items.filter(r => r && r.contact_id);
const byAcct = {};
for (const c of contactRows) (byAcct[c.account_id] = byAcct[c.account_id] || []).push(Number(c.contact_score || 0));

const boost = ((cfg.scoring || {}).vertical_boost) || { enabled: false, bonus: 0, keywords: [] };
const quals = (statsItem && statsItem.stats && statsItem.stats.all_qualified) || [];
const out = [];
for (const a of quals) {
  const scores = byAcct[a.account_id];
  if (!scores || !scores.length) {
    // S14 patch: the finder answered but no usable contact came out of it (NO_RESULT, or every person rejected).
    // Close the account so it leaves the contact queue instead of being searched again every run.
    const d = norm(a.domain);
    if (String(a.contact_status || '').trim() === 'queued' && answered.has(d)) {
      const row = Object.assign({}, a);
      if (onFile.has(d)) { row.status = 'contact_found'; closedFound++; } else { row.status = 'contacts_none'; closedNone++; }
      row.contact_status = 'contacts_done';
      out.push({ json: row });
    }
    continue;
  }
  const feas = Math.max(...scores);
  const bm = String(a.score_breakdown || '').match(/icp=(\d+);\s*budget=(\d+);\s*automation=(\d+);\s*timezone=(\d+)/i);
  const icp = bm ? Number(bm[1]) : 50, budget = bm ? Number(bm[2]) : 50, auto = bm ? Number(bm[3]) : 0, tz = bm ? Number(bm[4]) : 0;
  const text = [a.company_name, a.industry, a.clay_summary].join(' ').toLowerCase();
  let final = Math.round(0.30 * icp + 0.20 * budget + 0.20 * auto + 0.15 * tz + 0.15 * feas);
  if (boost.enabled && (boost.keywords || []).some(k => text.includes(String(k).toLowerCase()))) final = Math.min(100, final + Number(boost.bonus || 0));
  const row = Object.assign({}, a);
  row.contact_feasibility_score = feas;
  row.final_score = final;
  row.priority = final >= Number(cfg.priority_score || 80);
  row.score_breakdown = 'icp=' + icp + '; budget=' + budget + '; automation=' + auto + '; timezone=' + tz + '; feasibility=' + feas;
  row.status = 'contact_found';
  row.contact_status = 'contacts_done';
  out.push({ json: row });
}
const base = statsItem ? JSON.parse(JSON.stringify(statsItem)) : { __row_type: 'stats', stats: {} };
base.stats = base.stats || {};
base.stats.contacts = Object.assign(base.stats.contacts || {}, { closed_none: closedNone, closed_found: closedFound });
return out.concat([{ json: base }]);