import Link from "next/link";
import { cn } from "@/lib/utils";

// URL-driven segmented filter (server-rendered links). On phones a 3-column grid, so five items wrap
// onto two rows instead of squeezing or scrolling.
export function SegmentedLinks({
  label,
  items,
}: {
  label: string;
  items: { href: string; label: string; count?: number; active: boolean }[];
}) {
  return (
    <nav aria-label={label} className="grid grid-cols-3 gap-1 rounded-md bg-secondary p-1 sm:flex sm:w-fit">
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          aria-current={it.active ? "page" : undefined}
          className={cn(
            "flex h-11 min-w-0 items-center justify-center gap-1.5 rounded border border-transparent px-2.5 text-[0.8125rem] font-medium whitespace-nowrap text-muted-foreground sm:h-8",
            it.active && "border-border bg-card text-foreground",
          )}
        >
          {it.label}
          {it.count !== undefined ? <span className="tabular text-ink-3">{it.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
