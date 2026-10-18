import { FACTOR_LABELS, parseBreakdown } from "@/lib/format";

// Score breakdown as a ledger: one row per factor, thin neutral bar, value right-aligned. No colors.
export function ScoreLedger({ breakdown }: { breakdown: string | null }) {
  const rows = parseBreakdown(breakdown);
  if (rows.length === 0) return <p className="text-ink-3">No breakdown recorded.</p>;
  return (
    <dl className="space-y-2">
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[8.5rem_1fr_2.5rem] items-center gap-3">
          <dt className="truncate text-[0.8125rem] font-medium text-muted-foreground">{FACTOR_LABELS[r.key] ?? r.key}</dt>
          <span className="h-1.5 rounded-sm bg-meter-track" aria-hidden>
            <span
              className="block h-full rounded-sm bg-meter-fill"
              style={{ width: `${Math.max(0, Math.min(100, r.value))}%` }}
            />
          </span>
          <dd className="tabular text-right font-semibold">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
