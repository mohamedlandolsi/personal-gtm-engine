// Parse Forum Mail (Code node, Run Once for All Items). Sprint 15, Phase 0 outcome.
// The n8n and Make community terms forbid automated access to the forums, so new Jobs topics reach the
// engine as the forum's own notification emails: you set the Jobs category to "Watching First Post", a Gmail
// filter labels those emails, and the Read Forum Mail node reads them. This node turns each email into a post.
// While Read Forum Mail is disabled (no Gmail credential yet), n8n passes the Load Config item through: it is ignored.
const cfg = $('Load Config').first().json.config || {};
const G = cfg.gig || {};
const S = (G.sources || {}).forum_mail || {};
if (G.enabled === false || S.enabled === false) return [{ json: { __skipped: 'forum_mail: disabled by config' } }];

const HOSTS = (Array.isArray(S.hosts) && S.hosts.length ? S.hosts : ['community.n8n.io']).map(h => String(h).toLowerCase());
const PREFIX = { 'community.n8n.io': 'n8n', 'community.make.com': 'make' };
const PLATFORM = { 'community.n8n.io': 'n8n_forum', 'community.make.com': 'make_forum' };
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LINK = new RegExp('https?://(' + HOSTS.map(esc).join('|') + ')/t/([a-z0-9%_-]+)/(\\d+)(?:/(\\d+))?', 'i');

const htmlText = h => String(h || '')
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|tr|blockquote)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const FOOTER = /\n\s*(visit topic|reply to this email|to unsubscribe|you are receiving this|unsubscribe|view in browser|in reply to)\b/i;

const mails = $input.all().map(i => i.json).filter(m => m && (m.id || m.messageId) && (m.subject || m.Subject || m.text || m.html || m.snippet));
if (!mails.length) return [{ json: { __skipped: 'forum_mail: no mail read (Read Forum Mail disabled, no credential, or no new mail)' } }];

const C = { mails: mails.length, posts: 0, no_link: 0, replies_skipped: 0 };
const byKey = new Map();
for (const m of mails) {
  const subject = String(m.subject || m.Subject || '').trim();
  const text = m.text ? String(m.text).replace(/\r/g, '') : htmlText(m.html || m.textAsHtml || m.snippet || '');
  const hay = text + '\n' + String(m.html || '');
  const lm = hay.match(LINK);
  if (!lm) { C.no_link++; continue; }
  const host = lm[1].toLowerCase(), slug = lm[2], topicId = lm[3], postNo = Number(lm[4] || 1);
  if (postNo > 1) { C.replies_skipped++; continue; }                     // a reply in the thread, not a new post

  const fromName = (m.from && m.from.value && m.from.value[0] && m.from.value[0].name) || String(m.From || '').replace(/<[^>]*>/, '').trim();
  const poster = String(fromName || '').replace(/^"|"$/g, '').replace(/\s+via\s+.+$/i, '').trim();
  let title = subject.replace(/^\s*((re|fwd?):\s*)*/i, '').replace(/^(\s*\[[^\]]*\])+\s*/, '').trim();
  if (!title) title = decodeURIComponent(slug).replace(/-/g, ' ');
  let body = text;
  const f = body.search(FOOTER);
  if (f > 40) body = body.slice(0, f);
  body = body.split('\n').filter(l => !LINK.test(l) || l.replace(LINK, '').trim().length > 10).join('\n').trim().slice(0, 4000);

  const date = m.date ? new Date(m.date) : (m.internalDate ? new Date(Number(m.internalDate)) : new Date());
  const post = {
    post_key: (PREFIX[host] || host.split('.')[1] || 'forum') + ':' + topicId,
    platform: PLATFORM[host] || 'n8n_forum',
    url: 'https://' + host + '/t/' + slug + '/' + topicId,
    title: title.slice(0, 300), body_text: body, poster: poster.slice(0, 120), poster_company: '',
    posted_at: isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
    reply_count: null, __source: 'forum_mail'
  };
  const prev = byKey.get(post.post_key);
  if (!prev || post.body_text.length > prev.body_text.length) byKey.set(post.post_key, post);
}
C.posts = byKey.size;
return [...byKey.values()].map(p => ({ json: p })).concat([{ json: { __stats: 'forum_mail: ' + Object.entries(C).map(([k, v]) => k + '=' + v).join(' ') } }]);
