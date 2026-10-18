import Link from "next/link";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ConfigDiff } from "@/components/config-diff";
import { ConfigWorkspace } from "@/components/config-workspace";

// Per-request private data: the layout's `instant = false` does not cover pages below it.
export const instant = false;

type Latest = {
  id: number;
  rev: string;
  payload_text: string;
  note: string | null;
  created_by: string;
  created_at: Date;
  pushed_to_sheet_at: Date | null;
};

type Version = Omit<Latest, "payload_text"> & { prev_id: number | null };
type Pair = { id: number; rev: string; payload_text: string };

export default async function ConfigPage({ searchParams }: PageProps<"/config">) {
  await requireSession();
  const rawCompare = (await searchParams).compare;
  const compareId = Number(Array.isArray(rawCompare) ? rawCompare[0] : rawCompare);

  const [latest] = (await sql`
    select id::int as id, rev, payload_text, note, created_by, created_at, pushed_to_sheet_at
    from config_versions
    order by id desc
    limit 1`) as Latest[];

  // No payloads here: the list only needs metadata (each payload is about 10 KB).
  const versions = (await sql`
    select id::int as id, rev, note, created_by, created_at, pushed_to_sheet_at,
           (lag(id) over (order by id))::int as prev_id
    from config_versions
    order by id desc
    limit 20`) as Version[];

  // The selected version and the one saved before it, for the diff.
  const pair =
    Number.isInteger(compareId) && compareId > 0
      ? ((await sql`
          (select id::int as id, rev, payload_text from config_versions where id = ${compareId})
          union all
          (select id::int as id, rev, payload_text from config_versions where id < ${compareId} order by id desc limit 1)
        `) as Pair[])
      : [];
  const [after, before] = [pair.find((p) => p.id === compareId), pair.find((p) => p.id !== compareId)];

  if (!latest) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl leading-tight font-semibold">Config</h1>
        <div className="rounded-lg border bg-card px-4 py-8 text-center">
          <p>No config saved yet. The first sync imports it from the Sheet.</p>
          <Link href="/runs" className="mt-2 inline-block font-medium underline underline-offset-4">Check sync runs</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl leading-tight font-semibold">Config</h1>
        <p className="text-[0.9375rem] text-muted-foreground">
          Saved {timeAgo(latest.created_at.toISOString())} by {latest.created_by}.{" "}
          {latest.pushed_to_sheet_at ? "In the Sheet." : "Waiting to sync to the Sheet."}
        </p>
      </div>

      <ConfigWorkspace key={latest.id} savedText={latest.payload_text} savedRev={latest.rev} />

      <section id="versions" className="space-y-3 rounded-lg border bg-card p-4">
        <h2 className="text-[1.0625rem] font-semibold">Versions</h2>
        <ol className="divide-y divide-border">
          {versions.map((v) => {
            const open = v.id === compareId;
            return (
              <li key={v.id} id={`v${v.id}`} className="space-y-2 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-[0.8125rem] font-semibold break-all">{v.rev}</span>
                  {v.pushed_to_sheet_at ? (
                    <span className="inline-flex h-6 items-center rounded bg-secondary px-2 text-[0.8125rem] font-medium">
                      In Sheet
                    </span>
                  ) : null}
                  {v.id === latest.id ? <span className="text-[0.8125rem] font-semibold">Current</span> : null}
                  <span
                    className="tabular ml-auto text-[0.8125rem] text-ink-3"
                    title={v.created_at.toISOString()}
                  >
                    {timeAgo(v.created_at.toISOString())}
                  </span>
                </div>
                <p className="text-[0.8125rem] text-muted-foreground">
                  By {v.created_by}
                  {v.note ? `: ${v.note}` : ""}
                </p>
                {v.prev_id !== null ? (
                  <Link
                    href={open ? "/config#versions" : `/config?compare=${v.id}#v${v.id}`}
                    scroll={false}
                    aria-expanded={open}
                    className={cn(
                      "inline-flex min-h-11 items-center text-[0.9375rem] font-medium underline underline-offset-4 sm:min-h-0",
                    )}
                  >
                    {open ? "Hide comparison" : "Compare with previous"}
                  </Link>
                ) : (
                  <p className="text-[0.8125rem] text-ink-3">First version, nothing to compare.</p>
                )}
                {open && after && before ? <ConfigDiff before={before.payload_text} after={after.payload_text} /> : null}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
