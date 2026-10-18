#!/usr/bin/env node
// Sprint 10 helper: splits db/schema.sql into single statements for the Neon connector's
// run_sql_transaction (which takes one statement per array item). Keeps $$ bodies, quotes
// and comments intact; never rewrites a statement.
//
// Usage: node scripts/s10_split_schema.mjs [db/schema.sql] > schema.statements.json
// Prints a JSON array of statements to stdout and a count plus sha256 to stderr.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const path = process.argv[2] || "db/schema.sql";
const sql = readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const out = [];
let buf = "", i = 0, dollar = null, quote = false, lineComment = false, blockComment = 0;
while (i < sql.length) {
  const c = sql[i], n = sql[i + 1];
  if (lineComment) { buf += c; if (c === "\n") lineComment = false; i++; continue; }
  if (blockComment) { buf += c; if (c === "*" && n === "/") { buf += n; i += 2; blockComment--; continue; } i++; continue; }
  if (dollar) {
    if (sql.startsWith(dollar, i)) { buf += dollar; i += dollar.length; dollar = null; continue; }
    buf += c; i++; continue;
  }
  if (quote) { buf += c; if (c === "'") { if (n === "'") { buf += n; i += 2; continue; } quote = false; } i++; continue; }
  if (c === "-" && n === "-") { lineComment = true; buf += c; i++; continue; }
  if (c === "/" && n === "*") { blockComment++; buf += c + n; i += 2; continue; }
  if (c === "'") { quote = true; buf += c; i++; continue; }
  if (c === "$") {
    const m = sql.slice(i).match(/^\$[A-Za-z_]*\$/);
    if (m) { dollar = m[0]; buf += dollar; i += dollar.length; continue; }
  }
  if (c === ";") {
    const stmt = (buf + ";").trim();
    // drop chunks that are only comments
    if (stmt.replace(/--[^\n]*\n?/g, "").replace(/\/\*[\s\S]*?\*\//g, "").trim() !== ";") out.push(stmt);
    buf = ""; i++; continue;
  }
  buf += c; i++;
}
if (buf.replace(/--[^\n]*\n?/g, "").trim()) { console.error("Trailing text without a semicolon:\n" + buf.slice(0, 200)); process.exit(2); }
if (dollar || quote || blockComment) { console.error("Unterminated quote or $$ body"); process.exit(2); }

process.stdout.write(JSON.stringify(out, null, 1) + "\n");
console.error(`${out.length} statements, sha256(schema)=${createHash("sha256").update(sql).digest("hex").slice(0, 12)}`);
