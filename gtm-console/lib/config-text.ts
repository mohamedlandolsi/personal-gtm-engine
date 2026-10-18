// Client-safe helpers for the config editor. The server action and gtm_save_config() still validate everything.

export type ConfigObject = Record<string, unknown>;

export type ParseResult =
  | { ok: true; obj: ConfigObject; rev: string | null }
  | { ok: false; error: string };

export function parseConfig(text: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Not valid JSON" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "The config must be a JSON object" };
  }
  const obj = value as ConfigObject;
  return { ok: true, obj, rev: typeof obj.rev === "string" ? obj.rev : null };
}

// console-YYYYMMDD-HHmm in Africa/Tunis time.
export function tunisRev(now: Date = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Tunis",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return `console-${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}`;
}

// Replace only the top-level "rev" string value, keeping every other byte of the text.
// Returns null when the text has no "rev" string or the replacement did not land on the top-level key.
export function replaceRev(text: string, rev: string): string | null {
  const re = /("rev"\s*:\s*)"(?:[^"\\]|\\.)*"/;
  if (!re.test(text)) return null;
  const next = text.replace(re, (_m, prefix: string) => `${prefix}${JSON.stringify(rev)}`);
  const check = parseConfig(next);
  return check.ok && check.rev === rev ? next : null;
}

// Dotted-path access for the quick switches ("outreach.max_per_day").
export function getPath(obj: ConfigObject, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (cur, key) => (cur && typeof cur === "object" ? (cur as ConfigObject)[key] : undefined),
    obj,
  );
}

export function setPath(obj: ConfigObject, path: string, value: unknown): ConfigObject {
  const copy: ConfigObject = structuredClone(obj);
  const keys = path.split(".");
  let cur = copy;
  for (const key of keys.slice(0, -1)) {
    if (typeof cur[key] !== "object" || cur[key] === null) cur[key] = {};
    cur = cur[key] as ConfigObject;
  }
  cur[keys[keys.length - 1]] = value;
  return copy;
}
