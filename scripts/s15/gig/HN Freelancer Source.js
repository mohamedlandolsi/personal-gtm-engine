// HN Freelancer Source (Code node, Run Once for All Items). Sprint 15.
// Latest "Ask HN: Freelancer? Seeking freelancer?" thread via the public Algolia API; keeps top-level
// comments that start with SEEKING FREELANCER (people hiring). Off by default: the Phase 0 spike found
// 0 hiring posts in the August to November 2026 threads. Turn on with gig.sources.hn_freelancer.enabled.
const cfg = $('Load Config').first().json.config || {};
const G = cfg.gig || {};
const S = (G.sources || {}).hn_freelancer || {};
if (G.enabled === false || S.enabled !== true) return [{ json: { __skipped: 'hn_freelancer: disabled by config' } }];

const TITLE = String(S.title_match || 'Freelancer? Seeking freelancer?');
const http = async (url) => this.helpers.httpRequest({ method: 'GET', url, json: true, timeout: 20000 });
const text = h => String(h || '').replace(/<p>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#x2F;/g, '/').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

let story;
try {
  const s = await http('https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=10&query=' + encodeURIComponent('"' + TITLE + '"'));
  const hits = (s.hits || []).filter(h => String(h.title || '').toLowerCase().includes(TITLE.toLowerCase()));
  if (!hits.length) return [{ json: { __error: 'hn_freelancer: no thread found for "' + TITLE + '"' } }];
  // Two people sometimes post the same month: take the latest month, then the busiest thread in it.
  const month = String(hits[0].created_at || '').slice(0, 7);
  story = hits.filter(h => String(h.created_at || '').slice(0, 7) === month).sort((a, b) => (b.num_comments || 0) - (a.num_comments || 0))[0];
} catch (e) { return [{ json: { __error: 'hn_freelancer: search failed: ' + String(e.message || e).slice(0, 80) } }]; }

let item;
try { item = await http('https://hn.algolia.com/api/v1/items/' + story.objectID); }
catch (e) { return [{ json: { __error: 'hn_freelancer: thread fetch failed: ' + String(e.message || e).slice(0, 80) } }]; }

const kids = Array.isArray(item.children) ? item.children : [];
const out = [];
for (const k of kids) {
  const t = text(k.text);
  if (!/^seeking freelancer/i.test(t)) continue;
  const firstLine = t.split('\n')[0].replace(/^seeking freelancer\s*[:|-]?\s*/i, '').trim();
  out.push({ json: {
    post_key: 'hn:' + k.id, platform: 'hn_freelancer', url: 'https://news.ycombinator.com/item?id=' + k.id,
    title: (firstLine || 'SEEKING FREELANCER').slice(0, 300), body_text: t.slice(0, 4000),
    poster: String(k.author || ''), poster_company: '', posted_at: k.created_at || null,
    reply_count: Array.isArray(k.children) ? k.children.length : null, __source: 'hn_freelancer'
  } });
}
return out.concat([{ json: { __stats: 'hn_freelancer: thread=' + story.objectID + ' top_level=' + kids.length + ' hiring=' + out.length } }]);
