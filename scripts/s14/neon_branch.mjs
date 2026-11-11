// Sprint 14: tiny helper to talk to the Neon TEST branch s14-test only (never production).
// The connection string is never stored in the repo: pass it in S14_TEST_DATABASE_URL.
// Guard: the host must be the s14-test endpoint, otherwise the script refuses to connect.
//   apply a file : node scripts/s14/neon_branch.mjs apply db/s14_engine_fixes.sql
//   run a query  : node scripts/s14/neon_branch.mjs query "select 1"
//   save fixture : node scripts/s14/neon_branch.mjs save scripts/s14/fixtures/x.json "select ..."
//   try and undo  : node scripts/s14/neon_branch.mjs rollback file.sql   (begin, run, print, ROLLBACK: nothing is kept)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const S14_TEST_ENDPOINT = 'ep-solitary-block-b9qmlyvy';   // branch s14-test (br-still-snow-b98xnsnb)
const url = process.env.S14_TEST_DATABASE_URL || '';
if (!url) { console.error('S14_TEST_DATABASE_URL is not set'); process.exit(2); }
const host = new URL(url).hostname;
if (!host.startsWith(S14_TEST_ENDPOINT)) { console.error('Refusing: host is not the s14-test endpoint: ' + host); process.exit(2); }

const req = createRequire(path.resolve('gtm-console', 'package.json'));
const mod = await import(pathToFileURL(req.resolve('@neondatabase/serverless')).href);
const { Client, neonConfig } = mod.Client ? mod : mod.default;
if (typeof WebSocket !== 'undefined') neonConfig.webSocketConstructor = WebSocket;

const [mode, a, b] = process.argv.slice(2);
const client = new Client({ connectionString: url });
await client.connect();
try {
  if (mode === 'apply') {
    const sql = fs.readFileSync(a, 'utf8');
    await client.query(sql);
    console.log('applied ' + a + ' (' + sql.length + ' chars) on ' + host);
  } else if (mode === 'query') {
    const r = await client.query(a);
    console.log(JSON.stringify(r.rows, null, 1));
  } else if (mode === 'save') {
    const r = await client.query(b);
    fs.writeFileSync(a, JSON.stringify(r.rows, null, 1));
    console.log('saved ' + r.rows.length + ' rows to ' + a);
  } else if (mode === 'rollback') {
    await client.query('begin');
    try {
      const res = await client.query(fs.readFileSync(a, 'utf8'));
      for (const r of (Array.isArray(res) ? res : [res])) console.log(JSON.stringify(r.rows, null, 1));
    } finally { await client.query('rollback'); console.log('rolled back'); }
  } else { console.error('unknown mode'); process.exitCode = 2; }
} catch (e) {
  console.error('ERROR: ' + (e.message || e)); process.exitCode = 1;
} finally { await client.end(); }
