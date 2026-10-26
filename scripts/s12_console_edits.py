#!/usr/bin/env python3
"""Sprint 12: retire the Digest from the GTM console (Runs > Digest tab, 'New digests' column, Digest switch).
Run from gtm-console/:  python3 ../scripts/s12_console_edits.py           (dry run: checks every anchor, writes nothing)
                        python3 ../scripts/s12_console_edits.py --write
Stops without writing if any anchor is not found exactly once. Guarded files (s10 --check) are not touched."""
import re, sys
from pathlib import Path

WRITE = "--write" in sys.argv
RUNS = Path("app/(console)/runs/page.tsx")
SW = Path("components/config-switches.tsx")

def cut_between(src, start, end, label):
    i = src.find(start)
    j = src.find(end, i + 1) if i >= 0 else -1
    if i < 0 or j < 0 or src.count(start) != 1:
        sys.exit(f"[{label}] anchor not found exactly once")
    return src[:i] + src[j:]

def rep(src, old, new, label):
    n = src.count(old)
    if n != 1:
        sys.exit(f"[{label}] found {n} times, expected 1")
    return src.replace(old, new)

runs = RUNS.read_text(encoding="utf8").replace("\r\n", "\n")
runs = rep(runs, '  { key: "digest", label: "Digest" },\n', "", "TABS entry")
runs = cut_between(runs, "type DigestRun = {", "type SyncRun = {", "DigestRun type")
runs = rep(runs, "  new_digest_ops: number | null;\n", "", "SyncRun field")
runs = cut_between(runs, "function digestFlag(r: DigestRun) {", "function syncFlag(r: SyncRun) {", "DigestTab")
runs = rep(runs, "<Th right>New digests</Th>", "", "sync header")
runs = rep(runs, "                <Num>{n(r.new_digest_ops)}</Num>\n", "", "sync cell")
runs = rep(runs, "new_outreach, new_ops, new_digest_ops,", "new_outreach, new_ops,", "sync query")
runs = cut_between(runs, '  } else if (tab === "digest") {', '  } else if (tab === "sync") {', "digest branch")
left = re.findall(r"[Dd]igest", runs)
if left:
    sys.exit(f"runs/page.tsx still mentions digest {len(left)} times")

sw = SW.read_text(encoding="utf8").replace("\r\n", "\n")
sw = rep(sw, '  { path: "digest.enabled", label: "Digest", hint: "Posts the Discord digest" },\n', "", "Digest switch")

if WRITE:
    RUNS.write_text(runs, encoding="utf8", newline="\n")
    SW.write_text(sw, encoding="utf8", newline="\n")
    print("written: runs/page.tsx, config-switches.tsx")
else:
    print("dry run ok: all 9 anchors found once. Re-run with --write.")
