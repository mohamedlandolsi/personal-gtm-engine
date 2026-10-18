import Link from "next/link";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { STATE_RULE, displayState, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChannelIcon } from "@/components/channel-icon";
import { ScoreMeter } from "@/components/score-meter";
import { SegmentedLinks } from "@/components/segmented-links";
import { StatusChip } from "@/components/status-chip";

// Per-request private data: the layout's `instant = false` does not cover pages below it.
export const instant = false;

const TABS = [
  { key: "review", label: "Review" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "sent", label: "Sent" },
  { key: "all", label: "All" },
] as const;
type Tab = (typeof TABS)[number]["key"];

type Counts = Record<Tab, number>;
type Row = {
  outreach_id: string;
  company_name: string | null;
  final_score: number | null;
  contact_name: string | null;
  contact_title: string | null;
  channel: string | null;
  first_line: string | null;
  run_date: Date | null;
  approval_status: string;
  send_status: string;
};

export default async function QueuePage({ searchParams }: PageProps<"/queue">) {
  await requireSession();
  const raw = (await searchParams).tab;
  const tab: Tab = TABS.some((t) => t.key === raw) ? (raw as Tab) : "review";

  const [counts] = (await sql`
    select
      count(*) filter (where approval_status in ('pending','edited') and send_status = 'not_sent')::int as review,
      count(*) filter (where approval_status = 'approved' and send_status = 'not_sent')::int as approved,
      count(*) filter (where approval_status = 'rejected')::int as rejected,
      count(*) filter (where send_status = 'sent')::int as sent,
      count(*) filter (where approval_status <> 'superseded')::int as "all"
    from v_review_queue`) as Counts[];

  const rows = (await sql`
    select outreach_id, company_name, final_score, contact_name, contact_title, channel,
           first_line, run_date, approval_status, send_status
    from v_review_queue
    where (${tab} = 'review'   and approval_status in ('pending','edited') and send_status = 'not_sent')
       or (${tab} = 'approved' and approval_status = 'approved' and send_status = 'not_sent')
       or (${tab} = 'rejected' and approval_status = 'rejected')
       or (${tab} = 'sent'     and send_status = 'sent')
       or (${tab} = 'all'      and approval_status <> 'superseded')
    order by final_score desc nulls last, run_date desc nulls last
    limit 100`) as Row[];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl leading-tight font-semibold">Review queue</h1>
      <SegmentedLinks
        label="Draft filter"
        items={TABS.map((t) => ({
          href: `/queue?tab=${t.key}`,
          label: t.label,
          count: counts?.[t.key] ?? 0,
          active: t.key === tab,
        }))}
      />

      {rows.length === 0 ? (
        <div className="rounded-lg border bg-card px-4 py-8 text-center">
          {tab === "review" ? (
            <p>Nothing to review. New drafts arrive after the next engine run.</p>
          ) : (
            <p>No drafts in this view.</p>
          )}
          <Link
            href={tab === "review" ? "/queue?tab=all" : "/queue"}
            className="mt-2 inline-block text-[0.9375rem] font-medium underline underline-offset-4"
          >
            {tab === "review" ? "See all drafts" : "Back to review"}
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
          {rows.map((r) => {
            const state = displayState(r.approval_status, r.send_status);
            return (
              <li key={r.outreach_id}>
                <Link
                  href={`/queue/${encodeURIComponent(r.outreach_id)}`}
                  className={cn("block space-y-1 border-l-[3px] px-4 py-3 hover:bg-secondary", STATE_RULE[state])}
                >
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 truncate font-semibold">{r.company_name ?? "Unknown company"}</span>
                    <ScoreMeter score={r.final_score} />
                    {tab !== "review" ? <StatusChip state={state} /> : null}
                    <span className="tabular ml-auto shrink-0 text-[0.8125rem] text-ink-3">
                      {r.run_date ? timeAgo(r.run_date.toISOString()) : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
                    <ChannelIcon channel={r.channel} className="size-3.5 shrink-0" />
                    <span className="truncate">
                      {[r.contact_name, r.contact_title].filter(Boolean).join(", ") || "No contact"}
                    </span>
                  </div>
                  {r.first_line ? (
                    <p className="line-clamp-2 font-serif text-[1.0625rem] leading-relaxed">{r.first_line}</p>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
