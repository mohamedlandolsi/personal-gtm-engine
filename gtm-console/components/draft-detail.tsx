import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, ExternalLink, TriangleAlert } from "lucide-react";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { displayState, httpUrl, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChannelIcon, channelLabel } from "@/components/channel-icon";
import { ClayTriggerFact } from "@/components/clay-trigger";
import { FadeStatusChip } from "@/components/fade-status-chip";
import { ReviewActions } from "@/components/review-actions";
import { ScoreLedger } from "@/components/score-ledger";
import { ScoreMeter } from "@/components/score-meter";

// One draft's review surface: header, decision bar, message sheet and evidence panels.
// Rendered full width on /queue/[id] ("page") and as the right pane of the desktop queue ("pane").

type Draft = {
  outreach_id: string;
  account_id: string | null;
  company_name: string | null;
  final_score: number | null;
  channel: string | null;
  approval_status: string;
  send_status: string;
  email_subject: string | null;
  message_draft: string | null;
  follow_up_1: string | null;
  follow_up_2: string | null;
  follow_up_3: string | null;
  linkedin_note: string | null;
  notes: string | null;
  angle: string | null;
  trigger: string | null;
  pain_point: string | null;
  value_proposition: string | null;
  proof_point: string | null;
  why_match: string | null;
  red_flags: string | null;
  clay_summary: string | null;
  tech_stack: string | null;
  score_breakdown: string | null;
  contact_name: string | null;
  contact_title: string | null;
  contact_email: string | null;
  email_status: string | null;
  contact_linkedin: string | null;
  llm_provider: string | null;
  risk_notes: string | null;
  run_date: Date | null;
  clay_trigger: string | null;
  clay_trigger_source: string | null;
  clay_trigger_date: string | null;
};

type Event = {
  id: number;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: Date;
};

type Neighbours = { prev_id: string | null; next_id: string | null };

const STATE_KEYS = ["approval_status", "send_status"];

function Fact({ term, value, warn = false }: { term: string; value: string | null; warn?: boolean }) {
  if (!value) return null;
  return (
    <div className="space-y-0.5">
      <dt className="text-[0.8125rem] font-medium text-muted-foreground">{term}</dt>
      <dd className={warn ? "flex gap-1.5" : undefined}>
        {warn ? <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-label="Warning" role="img" /> : null}
        {/* Risk notes and tech stacks contain long machine tokens: let them wrap anywhere. */}
        <span className="min-w-0 whitespace-pre-wrap wrap-anywhere">{value}</span>
      </dd>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <h2 className="text-[1.0625rem] leading-snug font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function describeEvent(e: Event): string {
  const parts: string[] = [];
  for (const k of STATE_KEYS) {
    const b = e.before?.[k];
    const a = e.after?.[k];
    if (b !== a) parts.push(`${String(b ?? "none")} to ${String(a ?? "none")}`);
  }
  const edited = Object.keys(e.after ?? {}).filter((k) => !STATE_KEYS.includes(k));
  if (edited.length) parts.push(`changed ${edited.join(", ")}`);
  return parts.join("; ");
}

export async function DraftDetail({ id, mode }: { id: string; mode: "page" | "pane" }) {
  await requireSession();

  const [drafts, events] = (await Promise.all([
    sql`select * from v_review_queue where outreach_id = ${id}`,
    sql`
      select id::int as id, action, before, after, created_at
      from console_events
      where entity = 'outreach' and entity_id = ${id}
      order by created_at desc, id desc
      limit 50`,
  ])) as [Draft[], Event[]];
  const d = drafts[0];
  if (!d) {
    if (mode === "page") notFound();
    return (
      <div className="rounded-lg border bg-card px-4 py-8 text-center">
        <p>This draft is no longer in the queue.</p>
      </div>
    );
  }

  // J/K neighbours inside the review tab's order (none when this draft is not awaiting review).
  // The desktop pane moves through its own list instead, so it skips this query.
  let nb: Neighbours | undefined;
  if (mode === "page") {
    [nb] = (await sql`
      with r as (
        select outreach_id,
               lag(outreach_id)  over w as prev_id,
               lead(outreach_id) over w as next_id
        from v_review_queue
        where approval_status in ('pending','edited') and send_status = 'not_sent'
        window w as (order by final_score desc nulls last, run_date desc nulls last)
      )
      select prev_id, next_id from r where outreach_id = ${id}`) as Neighbours[];
  }

  const linkedin = httpUrl(d.contact_linkedin);
  const template = d.llm_provider === "template";
  const Title = mode === "page" ? "h1" : "h2";

  return (
    <div className={cn("space-y-4", mode === "page" && "pb-20 sm:pb-0")}>
      <div className="space-y-2">
        {mode === "page" ? (
          <Link href="/queue" className="text-[0.9375rem] text-muted-foreground hover:text-foreground">
            Back to queue
          </Link>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Title className="text-2xl leading-tight font-semibold">{d.company_name ?? "Unknown company"}</Title>
          <ScoreMeter score={d.final_score} />
          <FadeStatusChip state={displayState(d.approval_status, d.send_status)} />
        </div>
        <p className="flex flex-wrap items-center gap-x-2 text-[0.9375rem] text-muted-foreground">
          <ChannelIcon channel={d.channel} className="size-4" />
          <span>
            {channelLabel(d.channel)} to {[d.contact_name, d.contact_title].filter(Boolean).join(", ") || "no contact"}
          </span>
          {d.run_date ? <span className="tabular text-ink-3">drafted {timeAgo(d.run_date.toISOString())}</span> : null}
        </p>
      </div>

      <ReviewActions
        id={d.outreach_id}
        approvalStatus={d.approval_status}
        sendStatus={d.send_status}
        channel={d.channel}
        companyName={d.company_name ?? "this company"}
        contactName={d.contact_name ?? "this contact"}
        contactEmail={d.contact_email}
        prevId={nb?.prev_id ?? null}
        nextId={nb?.next_id ?? null}
        draft={{
          email_subject: d.email_subject,
          message_draft: d.message_draft,
          follow_up_1: d.follow_up_1,
          follow_up_2: d.follow_up_2,
          follow_up_3: d.follow_up_3,
          linkedin_note: d.linkedin_note,
          notes: d.notes,
        }}
      />

      {/* The pane is narrower than the page, so its side column only appears from xl. */}
      <div
        className={cn(
          "grid gap-4",
          mode === "page" ? "lg:grid-cols-[minmax(0,1fr)_22rem]" : "xl:grid-cols-[minmax(0,1fr)_18rem]",
        )}
      >
        <Panel title="Why this person, why now">
          <dl className="space-y-3">
            <Fact term="Angle" value={d.angle} />
            <Fact term="Trigger" value={d.trigger} />
            <ClayTriggerFact trigger={d.clay_trigger} source={d.clay_trigger_source} date={d.clay_trigger_date} />
            <Fact term="Pain point" value={d.pain_point} />
            <Fact term="Value proposition" value={d.value_proposition} />
            <Fact term="Proof point" value={d.proof_point} />
            <Fact term="Why it matches" value={d.why_match} />
            <Fact term="Red flags" value={d.red_flags} warn />
            <Fact term="Clay summary" value={d.clay_summary} />
            <Fact term="Tech stack" value={d.tech_stack} />
          </dl>
        </Panel>

        <div className="space-y-4">
          <Panel title="Score">
            <ScoreLedger breakdown={d.score_breakdown} />
          </Panel>

          <Panel title="Contact">
            <div className="space-y-1">
              <p className="font-semibold">{d.contact_name ?? "No contact"}</p>
              {d.contact_title ? <p className="text-muted-foreground">{d.contact_title}</p> : null}
              {d.contact_email ? <p className="break-all">{d.contact_email}</p> : null}
              {d.email_status ? (
                <p className="flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                  {d.email_status === "verified" ? <CircleCheck className="size-3.5" aria-hidden /> : null}
                  {d.email_status === "verified" ? "Email verified" : `Email ${d.email_status.replace(/_/g, " ")}`}
                </p>
              ) : null}
              {linkedin ? (
                <a
                  href={linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-11 items-center gap-1.5 font-medium underline underline-offset-4 sm:h-auto"
                >
                  LinkedIn profile
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              ) : null}
              {d.account_id ? (
                <Link
                  href={`/accounts/${encodeURIComponent(d.account_id)}`}
                  className="block text-[0.9375rem] text-muted-foreground underline underline-offset-4"
                >
                  Open account
                </Link>
              ) : null}
            </div>
          </Panel>

          <Panel title="Quality">
            <p className={template ? "flex items-center gap-1.5 font-medium text-danger" : ""}>
              {template ? <TriangleAlert className="size-4" aria-hidden /> : null}
              {template ? "Drafted by the template fallback, not an LLM" : `Drafted by ${d.llm_provider ?? "unknown"}`}
            </p>
            <dl>
              <Fact term="Risk notes" value={d.risk_notes} />
            </dl>
          </Panel>
        </div>
      </div>

      <Panel title="History">
        {events.length === 0 ? (
          <p className="text-muted-foreground">No console actions yet.</p>
        ) : (
          <ol className="divide-y divide-border">
            {events.map((e) => (
              <li key={e.id} className="flex items-baseline gap-3 py-2">
                <span className="font-medium">{e.action.replace(/_/g, " ")}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{describeEvent(e)}</span>
                <span className="tabular shrink-0 text-[0.8125rem] text-ink-3" title={e.created_at.toISOString()}>
                  {timeAgo(e.created_at.toISOString())}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}
