#!/usr/bin/env node
// Sprint 10 helper: writes the hand-written console files (guide sections 6.2 to 6.4)
// byte-for-byte from the guide, so nobody retypes security code.
//
// Usage (from the repo root):
//   node scripts/s10_extract_console_files.mjs            write files into gtm-console/
//   node scripts/s10_extract_console_files.mjs --check    exit 1 if a guarded file differs or a reworked file lost a safety line
//   node scripts/s10_extract_console_files.mjs --force    also overwrite files that P1 to P5 reworked
// Options: --guide <path to the Sprint 10 guide .md>  (default: ../../Sprint 10 - Ops Console  Neon Guide.md)
//          --app <app folder>                         (default: gtm-console)
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const CHECK = args.includes("--check");
const FORCE = args.includes("--force");
// Files create-next-app generates and the guide replaces on the first write. Written once, then kept.
const FIRST_RUN = !existsSync(resolve(opt("--app", "gtm-console"), "lib", "auth-token.ts"));
const REPLACE_TEMPLATE = new Set(FIRST_RUN ? ["app/layout.tsx", "app/page.tsx", "CLAUDE.md"] : []);
const guidePath = resolve(opt("--guide", "../../Sprint 10 - Ops Console  Neon Guide.md"));
const appDir = resolve(opt("--app", "gtm-console"));

const md = readFileSync(guidePath, "utf8").replace(/\r\n/g, "\n");
const start = md.indexOf("\n### 6.2 ");
const end = md.indexOf("\n### 6.5 ");
if (start < 0 || end < 0) { console.error("Could not find sections 6.2 to 6.5 in " + guidePath); process.exit(2); }
const lines = md.slice(start, end).split("\n");

// A file is announced by **`path`** (6.3) or by "Create `gtm-console/path`" (6.2, 6.4); its content is the next fenced block.
const files = [];
let pending = null;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const a = line.match(/^\*\*`([^`]+)`\*\*/);
  const b = line.match(/^Create `gtm-console\/([^`]+)`/);
  if (a || b) { pending = (a || b)[1]; continue; }
  if (pending && /^```[a-z]*\s*$/.test(line)) {
    const body = [];
    let j = i + 1;
    for (; j < lines.length && lines[j] !== "```"; j++) body.push(lines[j]);
    if (j >= lines.length) { console.error("Unclosed code block for " + pending); process.exit(2); }
    files.push({ path: pending, content: body.join("\n") + "\n" });
    pending = null;
    i = j;
  }
}

const EXPECTED = 16;
if (files.length !== EXPECTED) {
  console.error(`Expected ${EXPECTED} files in the guide, found ${files.length}: ${files.map(f => f.path).join(", ")}`);
  process.exit(2);
}
if (!existsSync(join(appDir, "package.json"))) {
  console.error(`${appDir} has no package.json. Run create-next-app first (guide 6.1).`);
  process.exit(2);
}

// --check: the security and data boundary must stay byte-identical. The prompts P1 to P5 are allowed
// to rework the layouts, the landing redirect, the placeholder queue page and CLAUDE.md, so those
// are only checked for the lines that keep them safe.
const REWORKED = {
  "app/layout.tsx": ["robots: { index: false, follow: false }"],
  "app/(console)/layout.tsx": ["export const instant = false", "await requireSession()"],
  "app/page.tsx": [],
  "app/(console)/queue/page.tsx": ["await requireSession()"],
  "CLAUDE.md": [],
};

let diffs = 0;
for (const f of files) {
  const target = join(appDir, f.path);
  const sha = createHash("sha256").update(f.content).digest("hex").slice(0, 12);
  if (CHECK) {
    const now = existsSync(target) ? readFileSync(target, "utf8").replace(/\r\n/g, "\n") : null;
    if (f.path in REWORKED) {
      const missing = now === null ? ["file missing"] : REWORKED[f.path].filter(s => !now.includes(s));
      if (missing.length) diffs++;
      console.log(`${missing.length ? "MISSING" : "OK     "} ${f.path}  (may change; must keep: ${REWORKED[f.path].join(" | ") || "nothing"})${missing.length ? "  -> " + missing.join(", ") : ""}`);
      continue;
    }
    const same = now === f.content;
    if (!same) diffs++;
    console.log(`${same ? "OK     " : "DIFFERS"} ${f.path}  ${sha}`);
  } else {
    // Never clobber a reworked file (P1 to P5 changed it) unless --force; guarded files are always restored.
    if (f.path in REWORKED && !FORCE && existsSync(target) && !REPLACE_TEMPLATE.has(f.path)
        && readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== f.content) {
      console.log(`kept    ${f.path}  (already changed by a later prompt; use --force to overwrite)`);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.content);
    console.log(`wrote   ${f.path}  ${sha}`);
  }
}

// 6.1: the template ignores .env*, which would also hide .env.example
const gi = join(appDir, ".gitignore");
if (!CHECK && existsSync(gi) && !readFileSync(gi, "utf8").includes("!.env.example")) {
  appendFileSync(gi, "\n!.env.example\n");
  console.log("added   !.env.example to .gitignore");
}

if (CHECK) {
  console.log(diffs ? `\n${diffs} file(s) broke the guide contract. Restore them with the write mode or fix the missing lines.` : "\nAll hand-written files match the guide.");
  process.exit(diffs ? 1 : 0);
}
console.log(`\n${files.length} files written. Next: copy .env.example to .env.local and fill it (guide 6.2), then npm run build.`);
