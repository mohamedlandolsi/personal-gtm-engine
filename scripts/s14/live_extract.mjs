// Sprint 14: extract live node bodies from a saved get_workflow_details payload (script, never retyped).
// Usage: node scripts/s14/live_extract.mjs <payload.json|txt> <outDir> [node name ...]
// With no node names it prints the node list (name | type | version | code size) and the connections.
import fs from 'node:fs';
import path from 'node:path';
const [file, outDir, ...names] = process.argv.slice(2);
let raw = JSON.parse(fs.readFileSync(file, 'utf8'));
if (Array.isArray(raw) && raw[0] && raw[0].text) raw = JSON.parse(raw[0].text);
const wf = raw.workflow || raw;
const nodes = wf.nodes || [];
if (!names.length) {
  console.log(`workflow ${wf.id} "${wf.name}" active=${wf.active} versionId=${wf.versionId} nodes=${nodes.length}`);
  for (const n of nodes) {
    const code = n.parameters && (n.parameters.jsCode || n.parameters.query || '');
    console.log([n.name, n.type, n.typeVersion, code ? String(code).length : '', n.disabled ? 'DISABLED' : ''].join(' | '));
  }
  console.log('--- connections');
  for (const [src, c] of Object.entries(wf.connections || {}))
    for (const [kind, outs] of Object.entries(c))
      outs.forEach((arr, i) => (arr || []).forEach(t => console.log(`${src} [${kind}:${i}] -> ${t.node} [${t.index}]`)));
  console.log('--- settings', JSON.stringify(wf.settings || {}));
} else {
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of names) {
    const n = nodes.find(x => x.name === name);
    if (!n) { console.error('NOT FOUND: ' + name); process.exitCode = 1; continue; }
    const p = n.parameters || {};
    const body = p.jsCode !== undefined ? p.jsCode : JSON.stringify(n, null, 2);
    const ext = p.jsCode !== undefined ? '.js' : '.json';
    fs.writeFileSync(path.join(outDir, name + ext), body);
    fs.writeFileSync(path.join(outDir, name + '.node.json'), JSON.stringify({ ...n, parameters: { ...p, jsCode: p.jsCode !== undefined ? '<see .js>' : undefined } }, null, 2));
    console.log(`saved ${name}${ext} (${String(body).length} chars)`);
  }
}
