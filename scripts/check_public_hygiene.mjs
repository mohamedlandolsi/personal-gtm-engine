// Public repo hygiene: fails if a tracked text file contains an API key, a database URL with a password,
// or an email address outside the placeholder domains. Screenshots and lockfiles are skipped.
// Run from the repo root: node scripts/check_public_hygiene.mjs
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const SKIP = [/^screenshots\//, /package-lock\.json$/, /\.(png|jpe?g|gif|ico|svg|webp|pdf)$/i];
const SECRETS = [
  ['OpenAI-style key', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['Groq key', /\bgsk_[A-Za-z0-9]{20,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}/],
  ['HubSpot private app token', /\bpat-(?:na|eu)\d-[0-9a-f-]{30,}/],
  ['Tavily key', /\btvly-[A-Za-z0-9-]{20,}/],
  ['Discord webhook', /discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{20,}/],
  // a real password, not a placeholder such as PASSWORD, <password> or ****
  ['Postgres URL with password', /postgres(?:ql)?:\/\/[^\s'"`:/@]+:(?!PASSWORD@|password@|<[^>]*>@|\*+@|x+@)[^\s'"`@]{6,}@/],
];
// Emails are allowed only on reserved or placeholder domains (RFC 2606 / 6761).
// The top-level domain must be letters, so package@1.2 versions do not count. A match right after ':' is URL credentials.
const EMAIL = /(?<![:A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b/g;
const OK_DOMAIN = /(^|\.)(example\.(com|org|net)|example|test|invalid|localhost)$|^(vetoed\.io)$/i;

const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(f => f && !SKIP.some(r => r.test(f)));
const hits = [];
for (const f of files) {
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
  if (text.includes('\u0000')) continue;   // binary
  text.split('\n').forEach((line, i) => {
    for (const [name, re] of SECRETS) if (re.test(line)) hits.push(`${f}:${i + 1}  ${name}`);
    for (const m of line.matchAll(EMAIL)) if (!OK_DOMAIN.test(m[1])) hits.push(`${f}:${i + 1}  email ${m[0]}`);
  });
}
for (const h of hits) console.log('FAIL  ' + h);
console.log(hits.length ? `${hits.length} finding(s) in ${files.length} files` : `Clean: ${files.length} files checked`);
process.exit(hits.length ? 1 : 0);
