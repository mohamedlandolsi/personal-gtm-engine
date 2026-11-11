// Sprint 14: compare live n8n node bodies with files, byte for byte (script, never by eye).
// Usage: node scripts/s14/live_verify.mjs <dir with saved get_workflow_details payloads> <workflowId> <fileDir> "<Node Name>" ...
// Picks the NEWEST saved payload for that workflow. Prints versionId, node count, and MATCH or DIFF per node.
// With --save <dir> it also writes the live bodies of the named nodes to that dir (rollback copies).
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
let saveDir = '';
const si = args.indexOf('--save');
if (si >= 0) { saveDir = args[si + 1]; args.splice(si, 2); }
const [resultsDir, workflowId, fileDir, ...names] = args;

const files = fs.readdirSync(resultsDir)
  .filter(f => /get_workflow_details/.test(f))
  .map(f => ({ f, t: fs.statSync(path.join(resultsDir, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t);
let wf = null, used = '';
for (const { f } of files) {
  try {
    let raw = JSON.parse(fs.readFileSync(path.join(resultsDir, f), 'utf8'));
    if (Array.isArray(raw) && raw[0] && raw[0].text) raw = JSON.parse(raw[0].text);
    const w = raw.workflow || raw;
    if (w && w.id === workflowId) { wf = w; used = f; break; }
  } catch (e) { /* not a payload */ }
}
if (!wf) { console.error('no saved payload for workflow ' + workflowId); process.exit(2); }
console.log(`payload ${used}`);
console.log(`workflow "${wf.name}" versionId=${wf.versionId} active=${wf.active} activeVersionId=${wf.activeVersionId} nodes=${wf.nodes.length} updatedAt=${wf.updatedAt}`);

let bad = 0;
for (const name of names) {
  const n = wf.nodes.find(x => x.name === name);
  if (!n) { console.log(`MISSING  ${name} (not in the live workflow)`); bad++; continue; }
  const liveCode = String((n.parameters || {}).jsCode ?? '');
  if (saveDir) { fs.mkdirSync(saveDir, { recursive: true }); fs.writeFileSync(path.join(saveDir, name + '.js'), liveCode); }
  const p = path.join(fileDir, name + '.js');
  if (!fs.existsSync(p)) { console.log(`NOFILE   ${name} (live ${liveCode.length} chars)`); bad++; continue; }
  const want = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  if (liveCode === want) { console.log(`MATCH    ${name} (${liveCode.length} chars)`); continue; }
  bad++;
  let i = 0; while (i < liveCode.length && i < want.length && liveCode[i] === want[i]) i++;
  const line = want.slice(0, i).split('\n').length;
  console.log(`DIFF     ${name}: live ${liveCode.length} chars, file ${want.length} chars, first difference at char ${i} (file line ${line})`);
  console.log('  file: ' + JSON.stringify(want.slice(Math.max(0, i - 40), i + 80)));
  console.log('  live: ' + JSON.stringify(liveCode.slice(Math.max(0, i - 40), i + 80)));
}
process.exit(bad ? 1 : 0);
