import { TriangleAlert } from "lucide-react";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { formatAge } from "@/lib/format";
import { cn } from "@/lib/utils";

type Health = { run_at: Date; age_seconds: number; pending_push: number };

// Freshness is not a draft state: ink-3 when fresh, weight 600 after 30 min, danger with an icon after 24 h.
export async function SyncHealth() {
  await requireSession();
  const rows = (await sql`select run_at, age_seconds, pending_push from v_sync_health`) as Health[];
  const h = rows[0];

  if (!h) {
    return (
      <span className="flex items-center gap-1 text-[0.8125rem] font-medium text-danger">
        <TriangleAlert className="size-3.5" aria-hidden />
        No sync yet
      </span>
    );
  }

  // Age comes from the database clock, so it matches the sync's own timestamps.
  const stale = h.age_seconds > 86400;
  const late = h.age_seconds > 1800;
  return (
    <span
      className="flex min-w-0 items-center gap-2 text-[0.8125rem] whitespace-nowrap"
      title={`Last sync ${h.run_at.toISOString()}`}
    >
      <span
        className={cn(
          "tabular flex items-center gap-1",
          stale ? "font-medium text-danger" : late ? "font-semibold text-foreground" : "text-ink-3",
        )}
      >
        {stale ? <TriangleAlert className="size-3.5" aria-hidden /> : null}
        Synced {formatAge(h.age_seconds)}
      </span>
      {h.pending_push > 0 ? (
        <span className="tabular hidden text-ink-3 sm:inline">{h.pending_push} waiting to sync</span>
      ) : null}
    </span>
  );
}
