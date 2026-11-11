// Sprint 14: helpers shared by the build scripts. Every edit is an exact, single-occurrence replacement
// on the live node body, so a changed live node makes the build fail instead of producing a wrong node.
import fs from 'node:fs';
import path from 'node:path';

export const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

export const once = (src, oldText, newText, label) => {
  const n = src.split(oldText).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 occurrence, found ${n}: ${oldText.slice(0, 90)}`);
  return src.replace(oldText, () => newText);
};

// Replace the text between two anchors (both kept unless includeEnd is false).
export const between = (src, startText, endText, newText, label) => {
  const s = src.indexOf(startText);
  if (s < 0 || src.indexOf(startText, s + 1) >= 0) throw new Error(`[${label}] start anchor not unique: ${startText.slice(0, 80)}`);
  const e = src.indexOf(endText, s + startText.length);
  if (e < 0) throw new Error(`[${label}] end anchor not found: ${endText.slice(0, 80)}`);
  return src.slice(0, s) + newText + src.slice(e);
};

// n8n Code nodes run as the body of an async function: compile the same way to catch syntax errors.
export const compileCheck = (code, label) => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  try { new AsyncFunction('$', '$input', '$json', '$node', '$env', 'helpers', code); }
  catch (e) { throw new Error(`[${label}] does not compile: ${e.message}`); }
};

export const noEmDash = (text, label) => {
  if (/[—–]/.test(text)) throw new Error(`[${label}] contains an em or en dash`);
};

export const save = (dir, name, code) => {
  compileCheck(code, name);
  noEmDash(code, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name + '.js'), code);
  console.log(`built ${name}.js (${code.length} chars)`);
};
