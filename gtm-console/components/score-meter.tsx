// Number first, then a 48 px meter with ticks at the qualification thresholds (65 warm, 80 hot).
export function ScoreMeter({ score }: { score: number | null }) {
  const v = Math.max(0, Math.min(100, score ?? 0));
  return (
    <span className="inline-flex shrink-0 items-center gap-2" aria-label={score == null ? "No score" : `Score ${score} of 100`}>
      <span className="tabular w-7 text-right font-semibold">{score ?? "-"}</span>
      <span className="relative h-1.5 w-12 rounded-sm bg-meter-track" aria-hidden>
        <span className="absolute inset-y-0 left-0 rounded-sm bg-meter-fill" style={{ width: `${v}%` }} />
        <span className="absolute -top-0.5 h-2.5 w-px bg-meter-tick" style={{ left: "65%" }} />
        <span className="absolute -top-0.5 h-2.5 w-px bg-meter-tick" style={{ left: "80%" }} />
      </span>
    </span>
  );
}
