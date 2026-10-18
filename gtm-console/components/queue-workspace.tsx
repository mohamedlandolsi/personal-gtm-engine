"use client";

import { createContext, useContext, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { STATE_RULE, type DisplayState } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChannelIcon } from "@/components/channel-icon";
import { FadeStatusChip } from "@/components/fade-status-chip";
import { ROW_COLLAPSE_MS, motionMs } from "@/components/motion";
import { ScoreMeter } from "@/components/score-meter";

// The review queue list. Phones: list only, a row opens /queue/[id]. From lg: two panes like an
// inbox, the selected draft (?id=) on the right, J/K moving the selection. When a decision lands
// and a row leaves the current tab, it collapses out and the selection moves to the next row.

export type QueueRow = {
  outreach_id: string;
  company_name: string | null;
  final_score: number | null;
  contact_name: string | null;
  contact_title: string | null;
  channel: string | null;
  first_line: string | null;
  age: string;
  state: DisplayState;
};
type Item = QueueRow & { leaving?: boolean };

const TWO_PANE = "(min-width: 64rem)"; // Tailwind lg

const QueueSelection = createContext<{ move: (delta: 1 | -1) => void } | null>(null);

// For ReviewActions: inside the desktop pane, J/K move through this list instead of the review order.
export function useQueueSelection() {
  return useContext(QueueSelection);
}

// Keep rows that just left the tab in place, marked leaving, so they can collapse out.
function withLeaving(prev: Item[], next: QueueRow[]): Item[] {
  const ids = new Set(next.map((r) => r.outreach_id));
  const out: Item[] = [...next];
  let pos = 0;
  for (const p of prev) {
    if (ids.has(p.outreach_id)) pos = out.findIndex((r) => r.outreach_id === p.outreach_id) + 1;
    else out.splice(pos++, 0, { ...p, leaving: true });
  }
  return out;
}

function Row({
  row,
  selected,
  showChip,
  linkRef,
  onSelect,
  onLeave,
  onGone,
}: {
  row: Item;
  selected: boolean;
  showChip: boolean;
  linkRef: (el: HTMLAnchorElement | null) => void;
  onSelect: (id: string) => void;
  onLeave: (id: string) => void;
  onGone: (id: string) => void;
}) {
  const liRef = useRef<HTMLLIElement>(null);
  const leave = useEffectEvent(() => onLeave(row.outreach_id));
  const gone = useEffectEvent(() => onGone(row.outreach_id));

  useLayoutEffect(() => {
    const el = liRef.current;
    if (!row.leaving || !el) return;
    leave();
    const collapse = el.animate([{ height: `${el.offsetHeight}px`, opacity: 1 }, { height: "0px", opacity: 0 }], {
      duration: motionMs(ROW_COLLAPSE_MS),
      easing: "ease-out",
      fill: "forwards",
    });
    collapse.onfinish = () => gone();
    return () => collapse.cancel();
  }, [row.leaving]);

  return (
    <li ref={liRef} inert={row.leaving} className={row.leaving ? "overflow-hidden" : undefined}>
      <Link
        ref={linkRef}
        href={`/queue/${encodeURIComponent(row.outreach_id)}`}
        aria-current={selected ? "true" : undefined}
        onClick={(e) => {
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          if (!window.matchMedia(TWO_PANE).matches) return;
          e.preventDefault();
          onSelect(row.outreach_id);
        }}
        className={cn(
          "block scroll-mt-20 space-y-1 border-l-[3px] px-4 py-3 hover:bg-secondary",
          selected && "bg-secondary",
          STATE_RULE[row.state],
        )}
      >
        <div className="flex items-center gap-3">
          <span className="min-w-0 truncate font-semibold">{row.company_name ?? "Unknown company"}</span>
          <ScoreMeter score={row.final_score} />
          {showChip ? <FadeStatusChip state={row.state} /> : null}
          <span className="tabular ml-auto shrink-0 text-[0.8125rem] text-ink-3">{row.age}</span>
        </div>
        <div className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
          <ChannelIcon channel={row.channel} className="size-3.5 shrink-0" />
          <span className="truncate">
            {[row.contact_name, row.contact_title].filter(Boolean).join(", ") || "No contact"}
          </span>
        </div>
        {row.first_line ? (
          <p className="line-clamp-2 font-serif text-[1.0625rem] leading-relaxed">{row.first_line}</p>
        ) : null}
      </Link>
    </li>
  );
}

export function QueueWorkspace({
  tab,
  rows,
  selectedId,
  showChips,
  children,
}: {
  tab: string;
  rows: QueueRow[];
  selectedId: string | null;
  showChips: boolean;
  /** The detail pane for selectedId, rendered on the server. */
  children: React.ReactNode;
}) {
  const router = useRouter();

  const [items, setItems] = useState<Item[]>(rows);
  const [lastRows, setLastRows] = useState(rows);
  if (rows !== lastRows) {
    setLastRows(rows);
    setItems(withLeaving(items, rows));
  }

  // The highlighted row follows a click at once; the pane follows when the server answers.
  const [picked, setPicked] = useState(selectedId);
  const [lastSelected, setLastSelected] = useState(selectedId);
  if (selectedId !== lastSelected) {
    setLastSelected(selectedId);
    setPicked(selectedId);
  }

  const links = useRef(new Map<string, HTMLAnchorElement>());

  function focusRow(id: string) {
    const el = links.current.get(id);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest" });
  }

  function select(id: string | null, focus = false) {
    setPicked(id);
    const q = `/queue?tab=${encodeURIComponent(tab)}`;
    router.replace(id ? `${q}&id=${encodeURIComponent(id)}` : q, { scroll: false });
    if (focus && id) focusRow(id);
  }

  function move(delta: 1 | -1) {
    const live = items.filter((i) => !i.leaving);
    const at = live.findIndex((i) => i.outreach_id === picked);
    const target = at < 0 ? live[0] : live[at + delta];
    if (target) select(target.outreach_id, true);
  }

  // A row left the tab: if it was selected or focused, the next row takes over.
  const refocusOnSwap = useRef(false);
  function onLeave(id: string) {
    const wasFocused = links.current.get(id) === document.activeElement;
    if (id !== picked && !wasFocused) return;
    const at = items.findIndex((i) => i.outreach_id === id);
    const next =
      items.slice(at + 1).find((i) => !i.leaving) ?? items.slice(0, Math.max(at, 0)).findLast((i) => !i.leaving);
    if (id === picked) {
      refocusOnSwap.current = true;
      select(next?.outreach_id ?? null, true);
    } else if (next) focusRow(next.outreach_id);
  }

  // A confirm dialog hands focus back to its trigger in the old pane, which the swap then unmounts.
  // If focus fell to the body that way, put it back on the selected row.
  useEffect(() => {
    if (!refocusOnSwap.current) return;
    refocusOnSwap.current = false;
    if (selectedId && document.activeElement === document.body) {
      links.current.get(selectedId)?.focus({ preventScroll: true });
    }
  }, [selectedId]);

  function onGone(id: string) {
    setItems((prev) => prev.filter((i) => !(i.leaving && i.outreach_id === id)));
  }

  // Desktop opens on the first draft, like an inbox. Phones never select (they open /queue/[id]).
  const first = rows[0]?.outreach_id;
  useEffect(() => {
    if (selectedId || !first || !window.matchMedia(TWO_PANE).matches) return;
    router.replace(`/queue?tab=${encodeURIComponent(tab)}&id=${encodeURIComponent(first)}`, { scroll: false });
  }, [selectedId, first, tab, router]);

  return (
    <QueueSelection value={{ move }}>
      <div className="lg:grid lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start lg:gap-4">
        <ul className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
          {items.length === 0 ? <li className="px-4 py-8 text-center">No drafts in this view.</li> : null}
          {items.map((r) => (
            <Row
              key={r.outreach_id}
              row={r}
              selected={r.outreach_id === picked}
              showChip={showChips}
              linkRef={(el) => {
                if (el) links.current.set(r.outreach_id, el);
                else links.current.delete(r.outreach_id);
              }}
              onSelect={select}
              onLeave={onLeave}
              onGone={onGone}
            />
          ))}
        </ul>

        {/* Keyed by the confirmed selection: switching drafts remounts the pane (fresh edit state, scroll
            at the top, no chip fade), while a decision on the same draft updates it in place. */}
        <div
          key={selectedId ?? ""}
          className="hidden lg:sticky lg:top-18 lg:-m-1 lg:block lg:max-h-[calc(100dvh-5.5rem)] lg:overflow-y-auto lg:p-1"
        >
          {children}
        </div>
      </div>
    </QueueSelection>
  );
}
