// "Clay trigger" fact (Sprint 11): the dated, sourced "why now" line from accounts.clay_trigger.
// Renders a dt/dd pair, so it sits inside the same <dl> as the other facts and wraps like them.
// Source and date are a neutral chip: they are provenance, not a draft state.

export function ClayTriggerFact({
  trigger,
  source,
  date,
}: {
  trigger: string | null;
  source: string | null;
  date: string | null;
}) {
  const text = trigger?.trim();
  if (!text) return null;
  const meta = [source?.trim(), date?.trim()].filter(Boolean).join(", ");
  return (
    <div className="space-y-0.5">
      <dt className="text-[0.8125rem] font-medium text-muted-foreground">Clay trigger</dt>
      <dd className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="min-w-0 whitespace-pre-wrap wrap-anywhere">{text}</span>
        {meta ? (
          <span className="inline-flex h-6 shrink-0 items-center rounded bg-secondary px-2 text-[0.8125rem] font-medium">
            {meta.charAt(0).toUpperCase() + meta.slice(1)}
          </span>
        ) : null}
      </dd>
    </div>
  );
}
