#!/usr/bin/env python3
"""Sanitize n8n workflow exports before committing them to a public repo.

Usage:
    python3 scripts/sanitize_workflows.py exports/*.json --out workflows/

What it does (deterministic, no network):
  - Replaces every Google Sheet ID with YOUR_SPREADSHEET_ID
  - Replaces e-mail addresses with you@example.com
  - Removes credential IDs (keeps the credential name so n8n can remap it on import)
  - Replaces n8n Data Table IDs with YOUR_<TABLE>_TABLE_ID and blanks their URLs
  - Removes instance, workflow, version and error-workflow IDs, clears pinned data,
    and sets the workflow to inactive
  - FAILS (exit 1, nothing written) if it finds anything that looks like a secret:
    Groq, Google, Tavily, OpenAI-style keys, Discord webhook URLs, bearer tokens, private keys
"""
import argparse, json, pathlib, re, sys

SECRET_PATTERNS = {
    'groq_key': r'gsk_[A-Za-z0-9]{20,}',
    'google_api_key': r'AIza[0-9A-Za-z_\-]{30,}',
    'tavily_key': r'tvly-[A-Za-z0-9\-]{16,}',
    'openai_style_key': r'\bsk-[A-Za-z0-9_\-]{20,}',
    'discord_webhook': r'discord(?:app)?\.com/api/webhooks/\d+/[A-Za-z0-9_\-]+',
    'bearer_literal': r'Bearer\s+[A-Za-z0-9_\-\.=]{24,}',
    'private_key': r'-----BEGIN [A-Z ]*PRIVATE KEY-----',
}
SHEET_URL_ID = re.compile(r'/spreadsheets/d/([A-Za-z0-9_\-]{25,})')
EMAIL = re.compile(r'\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b')
EMAIL_KEEP = {'you@example.com', 'noreply@example.com'}


def collect_sheet_ids(node_list):
    ids = set()
    for n in node_list:
        doc = (n.get('parameters') or {}).get('documentId')
        if isinstance(doc, dict) and doc.get('mode') in ('list', 'id') and isinstance(doc.get('value'), str):
            ids.add(doc['value'])
    return ids


def walk(o, fn):
    if isinstance(o, dict):
        return {k: walk(fn(k, v), fn) for k, v in o.items()}
    if isinstance(o, list):
        return [walk(v, fn) for v in o]
    return o


def sanitize(wf):
    report = []
    nodes = wf.get('nodes', [])
    raw = json.dumps(wf)
    sheet_ids = collect_sheet_ids(nodes) | set(SHEET_URL_ID.findall(raw))

    for n in nodes:
        for cred in (n.get('credentials') or {}).values():
            if 'id' in cred:
                cred.pop('id'); report.append('credential id removed: ' + str(cred.get('name')))
        p = n.get('parameters') or {}
        dt = p.get('dataTableId')
        if isinstance(dt, dict):
            name = re.sub(r'[^A-Za-z0-9]+', '_', str(dt.get('cachedResultName') or 'DATA')).upper().strip('_')
            dt['value'] = 'YOUR_' + name + '_TABLE_ID'
            dt['cachedResultUrl'] = ''
            report.append('data table id replaced: ' + name)

    for k in ('id', 'versionId'):
        wf.pop(k, None)
    (wf.get('meta') or {}).pop('instanceId', None)
    (wf.get('settings') or {}).pop('errorWorkflow', None)
    wf['pinData'] = {}
    wf['active'] = False

    def fix(_k, v):
        if isinstance(v, str):
            for sid in sheet_ids:
                v = v.replace(sid, 'YOUR_SPREADSHEET_ID')
            v = EMAIL.sub(lambda m: m.group(0) if m.group(0) in EMAIL_KEEP else 'you@example.com', v)
        return v
    wf = walk(wf, fix)
    if sheet_ids:
        report.append('sheet ids replaced: %d' % len(sheet_ids))

    text = json.dumps(wf)
    leaks = [name for name, pat in SECRET_PATTERNS.items() if re.search(pat, text)]
    return wf, report, leaks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+')
    ap.add_argument('--out', default='workflows')
    a = ap.parse_args()
    out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)
    results, failed = [], False
    for f in a.files:
        wf = json.loads(pathlib.Path(f).read_text(encoding='utf-8'))
        clean, report, leaks = sanitize(wf)
        if leaks:
            failed = True
            print('BLOCKED %s: possible secrets: %s' % (f, ', '.join(leaks)))
            continue
        name = re.sub(r'[^a-z0-9]+', '_', clean.get('name', pathlib.Path(f).stem).lower()).strip('_') + '.json'
        results.append((out / name, clean, report))
    if failed:
        print('Nothing written. Remove the secrets from n8n (use $env or credentials), export again, re-run.')
        sys.exit(1)
    for path, clean, report in results:
        path.write_text(json.dumps(clean, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        print('OK  %s  (%d nodes)' % (path, len(clean.get('nodes', []))))
        for line in sorted(set(report)):
            print('    - ' + line)


if __name__ == '__main__':
    main()
