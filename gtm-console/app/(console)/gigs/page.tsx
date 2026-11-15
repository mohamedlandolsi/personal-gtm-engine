import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { PLATFORM_LABELS, httpUrl, timeAgo } from "@/lib/format";
import { AddGigForm } from "@/components/add-gig-form";
import { GigActions } from "@/components/gig-actions";
import { ScoreMeter } from "@/components/score-meter";
import { SegmentedLinks } from "@/components/segmented-links";
import { StatusChip } from "@/components/status-chip";

// Per-request private data: the layout's `instant = false` does not cover pages below it.
export const instant = false;

// Sprint 15 (ADR-114): gig posts live in Neon (gig_posts, read through v_gig_posts). Open this page first each day:
// posts go stale within days, so freshness matters more than order.
const TABS = [
  { key: "new", label: "New" },
  { key: "drafted", label: "Drafted" },
  { key: "sent", label: "Sent" },
  { key: "replied", label: "Replied" },
  { key: "closed", label: "Won or lost" },
  { key: "gated", label: "Set aside" },
  { key: "all", label: "All" },
] as const;
type Tab = (typeof TABS)[number]["key"];
type Counts = Record<Tab, number>;

type Gig = {
  post_key: string;
  platform: string;
  url: string;
  title: string | null;
  poster: string | null;
  poster_company: string | null;
  posted_at: Date | null;
  reply_count: number | null;
  stated_budget: string | null;
  matched_stack: string | null;
  intent: string | null;
  gig_score: number | null;
  status: string;
  gate_reason: string | null;
  age_hours: number | null;
  outreach_id: string | null;
  draft_status: string | null;
  draft_send_status: string | null;
};

const STATUS_WORDS: Record<string, string> = {
  new: "New",
  gated_out: "Set aside",
  drafted: "Drafted",
  sent: "Sent",
  replied: "Replied",
  won: "Won",
  lost: "Lost",
  expired: "Expired",
};

const GATE_WORDS: Record<string, string> = {
  intent_for_hire: "someone offering services",
  stale: "too old",
  crowded: "too many replies",
  stack_miss: "no stack match",
  dismissed: "dismissed by you",
};

function gateWords(reason: string | null): string | null {
  if (!reason) return null;
  if (reason.startsWith("veto:")) return `vetoed word "${reason.slice(5)}"`;
  if (reason.startsWith("budget_low:")) return `rate below your floor (${reason.slice(11)} USD)`;
  return GATE_WORDS[reason] ?? reason.replace(/_/g, " ");
}

function ageWords(h: number | null): string {
  if (h === null) return "";
  if (h < 1) return "under 1 h old";
  if (h < 48) return `${h} h old`;
  return `${Math.round(h / 24)} d old`;
}

export default async function GigsPage({ searchParams }: PageProps<"/gigs">) {
  await requireSession();
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "new";

  const [counts] = (await sql`
    select
      count(*) filter (where status = 'new')::int as new,
      count(*) filter (where status = 'drafted')::int as drafted,
      count(*) filter (where status = 'sent')::int as sent,
      count(*) filter (where status = 'replied')::int as replied,
      count(*) filter (where status in ('won','lost'))::int as closed,
      count(*) filter (where status in ('gated_out','expired'))::int as gated,
      count(*)::int as "all"
    from v_gig_posts`) as Counts[];

  const rows = (await sql`
    select post_key, platform, url, title, poster, poster_company, posted_at, reply_count, stated_budget,
           matched_stack, intent, gig_score, status, gate_reason, age_hours, outreach_id, draft_status, draft_send_status
    from v_gig_posts
    where (${tab} = 'new'     and status = 'new')
       or (${tab} = 'drafted' and status = 'drafted')
       or (${tab} = 'sent'    and status = 'sent')
       or (${tab} = 'replied' and status = 'replied')
       or (${tab} = 'closed'  and status in ('won','lost'))
       or (${tab} = 'gated'   and status in ('gated_out','expired'))
       or (${tab} = 'all')
    order by case when ${tab} in ('new','drafted') then coalesce(gig_score, 0) end desc nulls last,
             coalesce(posted_at, first_seen_at) desc
    limit 100`) as Gig[];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl leading-tight font-semibold">Gigs</h1>
      <p className="max-w-[70ch] text-[0.9375rem] text-muted-foreground">
        Public posts where someone hires for n8n, Clay, HubSpot or automation work. Reply drafts go to the review queue
        under the Gig track. Nothing is sent from here.
      </p>
      <SegmentedLinks
        label="Gig filter"
        items={TABS.map((t) => ({ href: `/gigs?tab=${t.key}`, label: t.label, count: counts?.[t.key] ?? 0, active: t.key === tab }))}
      />

      {rows.length === 0 ? (
        <div className="rounded-lg border bg-card px-4 py-8 text-center">
          <p>
            {tab === "new"
              ? "No new gig posts. The Gig Finder adds them from forum emails and from posts you add below."
              : "No gig posts in this view."}
          </p>
          <Link href="/gigs?tab=all" className="mt-2 inline-block font-medium underline underline-offset-4">
            See all gig posts
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
          {rows.map((g) => {
            const link = httpUrl(g.url);
            const title = g.title ?? g.post_key;
            const gate = g.status === "gated_out" ? gateWords(g.gate_reason) : null;
            return (
              <li key={g.post_key} className="space-y-2 px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    {link ? (
                      <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1.5 font-semibold hover:underline">
                        <span className="min-w-0 wrap-anywhere">{title}</span>
                        <ExternalLink className="mt-1 size-3.5 shrink-0" aria-label="Opens the post" role="img" />
                      </a>
                    ) : (
                      <span className="font-semibold wrap-anywhere">{title}</span>
                    )}
                    <p className="text-[0.8125rem] text-muted-foreground">
                      {[PLATFORM_LABELS[g.platform] ?? g.platform, [g.poster, g.poster_company].filter(Boolean).join(" at ") || null]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  </div>
                  <ScoreMeter score={g.gig_score} />
                </div>

                <p className="tabular flex flex-wrap gap-x-3 gap-y-0.5 text-[0.8125rem] text-ink-3">
                  <span>{ageWords(g.age_hours) || (g.posted_at ? timeAgo(g.posted_at.toISOString()) : "")}</span>
                  <span>{g.reply_count == null ? "replies unknown" : `${g.reply_count} ${g.reply_count === 1 ? "reply" : "replies"}`}</span>
                  {g.matched_stack ? <span>{g.matched_stack}</span> : null}
                  {g.stated_budget ? <span>budget {g.stated_budget}</span> : null}
                  {g.intent === "unclear" ? <span>intent unclear</span> : null}
                </p>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.9375rem]">
                  <span className="font-medium">{STATUS_WORDS[g.status] ?? g.status}</span>
                  {gate ? <span className="text-muted-foreground">{gate}</span> : null}
                  {g.outreach_id && g.draft_status ? (
                    <Link href={`/queue/${encodeURIComponent(g.outreach_id)}`} className="inline-flex items-center gap-2 underline underline-offset-4">
                      <StatusChip approval={g.draft_status} send={g.draft_send_status ?? "not_sent"} />
                      Open the draft
                    </Link>
                  ) : null}
                  <span className="ml-auto">
                    <GigActions postKey={g.post_key} status={g.status} title={title} />
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <section className="space-y-3 rounded-lg border bg-card p-4">
        <h2 className="text-[1.0625rem] leading-snug font-semibold">Add a post by hand</h2>
        <p className="text-[0.9375rem] text-muted-foreground">
          Found a post yourself? Paste it here. Forum links keep their topic number, so the same post is never added twice.
        </p>
        <AddGigForm />
      </section>
    </div>
  );
}
