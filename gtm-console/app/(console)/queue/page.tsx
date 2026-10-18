import Link from "next/link";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { displayState, timeAgo } from "@/lib/format";
import { DraftDetail } from "@/components/draft-detail";
import { QueueWorkspace, type QueueRow } from "@/components/queue-workspace";
import { SegmentedLinks } from "@/components/segmented-links";

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
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "review";
  // The desktop pane's draft. Phones never set it; the list picks the first row on desktop.
  const selectedId = typeof sp.id === "string" && sp.id.length > 0 && sp.id.length <= 200 ? sp.id : null;

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

  const list: QueueRow[] = rows.map((r) => ({
    outreach_id: r.outreach_id,
    company_name: r.company_name,
    final_score: r.final_score,
    contact_name: r.contact_name,
    contact_title: r.contact_title,
    channel: r.channel,
    first_line: r.first_line,
    age: r.run_date ? timeAgo(r.run_date.toISOString()) : "",
    state: displayState(r.approval_status, r.send_status),
  }));

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

      {/* With a selection, keep the workspace even when the list just emptied, so the last row can collapse out. */}
      {list.length === 0 && !selectedId ? (
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
        <QueueWorkspace key={tab} tab={tab} rows={list} selectedId={selectedId} showChips={tab !== "review"}>
          {selectedId ? (
            <DraftDetail id={selectedId} mode="pane" />
          ) : (
            <div className="rounded-lg border bg-card px-4 py-8 text-center text-muted-foreground">
              <p>Pick a draft to review it here.</p>
            </div>
          )}
        </QueueWorkspace>
      )}
    </div>
  );
}
