import { diffLines } from "diff";
import { cn } from "@/lib/utils";

const CONTEXT = 2;

type Line = { kind: "add" | "del" | "same"; text: string };
type Row = Line | { kind: "gap"; count: number };

// Line diff with unchanged runs folded to CONTEXT lines around each change.
// Added lines use the approved tint, removed lines the danger tint: here color does mean state.
export function ConfigDiff({ before, after }: { before: string; after: string }) {
  const lines: Line[] = diffLines(before, after).flatMap((part) => {
    const kind = part.added ? "add" : part.removed ? "del" : "same";
    const text = part.value.endsWith("\n") ? part.value.slice(0, -1) : part.value;
    return text.split("\n").map((t) => ({ kind, text: t }) as Line);
  });

  const changed = lines.map((l) => l.kind !== "same");
  if (!changed.some(Boolean)) return <p className="text-muted-foreground">No differences.</p>;

  const keep = lines.map((_, i) =>
    changed.slice(Math.max(0, i - CONTEXT), i + CONTEXT + 1).some(Boolean),
  );
  const rows: Row[] = [];
  lines.forEach((l, i) => {
    if (keep[i]) rows.push(l);
    else {
      const last = rows[rows.length - 1];
      if (last?.kind === "gap") last.count++;
      else rows.push({ kind: "gap", count: 1 });
    }
  });

  const added = lines.filter((l) => l.kind === "add").length;
  const removed = lines.filter((l) => l.kind === "del").length;

  return (
    <div className="space-y-2">
      <p className="tabular text-[0.8125rem] text-muted-foreground">
        {added} {added === 1 ? "line" : "lines"} added, {removed} removed
      </p>
      <div className="overflow-hidden rounded-md border font-mono text-[0.8125rem] leading-5">
        {rows.map((r, i) =>
          r.kind === "gap" ? (
            <div key={i} className="bg-secondary px-3 py-1 font-sans text-ink-3">
              {r.count} unchanged {r.count === 1 ? "line" : "lines"}
            </div>
          ) : (
            <div
              key={i}
              className={cn(
                "grid grid-cols-[1.25rem_1fr] px-2 whitespace-pre-wrap wrap-anywhere",
                r.kind === "add" && "bg-state-approved-tint text-state-approved",
                r.kind === "del" && "bg-danger-tint text-danger",
              )}
            >
              <span aria-hidden className="select-none">{r.kind === "add" ? "+" : r.kind === "del" ? "−" : " "}</span>
              <span>
                <span className="sr-only">{r.kind === "add" ? "Added: " : r.kind === "del" ? "Removed: " : ""}</span>
                {r.text || " "}
              </span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
