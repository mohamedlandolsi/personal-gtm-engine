import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, ExternalLink, TriangleAlert } from "lucide-react";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/session";
import {
  ANGLE_LABELS,
  type AgentMeta,
  LANE_LABELS,
  PLATFORM_LABELS,
  REJECT_SCOPE_LABELS,
  type SampleRow,
  TRACK_LABELS,
  displayState,
  formatMusd,
  gateName,
  httpUrl,
  idWords,
  isAgent,
  timeAgo,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChannelIcon, channelLabel } from "@/components/channel-icon";
import { readHubspotCfg } from "@/lib/hubspot";
import { ClayTriggerFact } from "@/components/clay-trigger";
import { type CrmRow, CrmStatus } from "@/components/crm-status";
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
  account_status: string | null;
  // Sprint 14: what the drafter decided, and the scope of a rejection.
  reject_scope: string | null;
  angle_basis: string | null;
  account_type: string | null;
  product_category: string | null;
  // Sprint 15: lead track, the agency directory profile, and the gig post behind a gig draft.
  lead_track: string | null;
  source_meta: string | null;
  gig_platform: string | null;
  gig_url: string | null;
  gig_posted_at: Date | null;
  gig_reply_count: number | null;
  gig_matched_stack: string | null;
  gig_stated_budget: string | null;
  gig_status: string | null;
  gig_score: number | null;
};

type DirectoryMeta = {
  directory?: string;
  tier?: string;
  services?: string[];
  languages?: string[];
  pricing?: string[];
  profile_url?: string;
};

// source_meta is a short JSON string written by the engine or the agent; anything unreadable is ignored.
function readMeta<T extends object>(text: string | null): T | null {
  if (!text) return null;
  try {
    const m = JSON.parse(text);
    return m && typeof m === "object" ? (m as T) : null;
  } catch {
    return null;
  }
}

const list = (v: string[] | undefined) => (Array.isArray(v) && v.length ? v.join(", ") : null);

// A source link as readable text: no scheme, no trailing slash.
const linkText = (url: string) => url.replace(/^https?:\/\//i, "").replace(/\/$/, "");

function SourceLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 max-w-full items-center gap-1.5 font-medium underline underline-offset-4 sm:min-h-0"
    >
      <span className="min-w-0 wrap-anywhere">{linkText(url)}</span>
      <ExternalLink className="size-3.5 shrink-0" aria-hidden />
    </a>
  );
}

const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Sprint 18 (ADR-140): the sample accounts behind a lane A pitch, so each trigger can be checked
// at its source before approving. Stacked cards on phones, a table from lg (xl in the narrower pane).
function SampleList({ rows, dropped, mode }: { rows: SampleRow[]; dropped: number; mode: "page" | "pane" }) {
  const items = rows.map((r, i) => {
    const domain = str(r.domain);
    return {
      key: `${domain ?? "row"}-${i}`,
      company: str(r.company) ?? domain ?? "Unknown company",
      domain,
      domainUrl: domain && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) ? `https://${domain}` : null,
      trigger: str(r.trigger),
      date: str(r.trigger_date),
      buyer: str(r.buyer_title),
      source: httpUrl(str(r.trigger_url)),
    };
  });
  const wide = mode === "page" ? "lg" : "xl";
  const link = "font-medium underline underline-offset-4";
  const domainLink = (it: (typeof items)[number]) =>
    it.domainUrl ? (
      <a href={it.domainUrl} target="_blank" rel="noopener noreferrer" className={cn(link, "wrap-anywhere")}>
        {it.domain}
      </a>
    ) : (
      <span className="wrap-anywhere">{it.domain}</span>
    );
  const sourceLink = (it: (typeof items)[number], cls?: string) =>
    it.source ? (
      <a href={it.source} target="_blank" rel="noopener noreferrer" className={cn(link, "inline-flex items-center gap-1.5", cls)}>
        Source
        <ExternalLink className="size-3.5 shrink-0" aria-hidden />
      </a>
    ) : null;

  return (
    <Panel title="Sample list">
      <ul className={cn("divide-y divide-border", wide === "lg" ? "lg:hidden" : "xl:hidden")}>
        {items.map((it) => (
          <li key={it.key} className="space-y-1 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold">{it.company}</span>
              {it.domain ? <span className="text-[0.8125rem]">{domainLink(it)}</span> : null}
            </div>
            {it.trigger ? <p className="wrap-anywhere">{it.trigger}</p> : null}
            <p className="flex flex-wrap items-center gap-x-3 text-[0.8125rem] text-muted-foreground">
              {it.date ? <span className="tabular">{it.date}</span> : null}
              {it.buyer ? <span>Buyer: {it.buyer}</span> : null}
            </p>
            {sourceLink(it, "min-h-11 sm:min-h-0")}
          </li>
        ))}
      </ul>
      <table className={cn("hidden w-full text-[0.9375rem]", wide === "lg" ? "lg:table" : "xl:table")}>
        <thead>
          <tr className="border-b text-left text-[0.8125rem] text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Company</th>
            <th className="py-2 pr-3 font-medium">Trigger</th>
            <th className="py-2 pr-3 font-medium whitespace-nowrap">Date</th>
            <th className="py-2 pr-3 font-medium">Buyer</th>
            <th className="py-2 font-medium">
              <span className="sr-only">Source</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((it) => (
            <tr key={it.key} className="align-top">
              <td className="min-w-36 py-2.5 pr-3">
                <span className="block font-semibold">{it.company}</span>
                {it.domain ? <span className="text-[0.8125rem]">{domainLink(it)}</span> : null}
              </td>
              <td className="py-2.5 pr-3 wrap-anywhere">{it.trigger}</td>
              <td className="tabular py-2.5 pr-3 whitespace-nowrap">{it.date}</td>
              <td className="py-2.5 pr-3">{it.buyer}</td>
              <td className="py-2.5 whitespace-nowrap">{sourceLink(it)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {dropped > 0 ? (
        <p className="tabular text-[0.8125rem] text-ink-3">
          {dropped} {dropped === 1 ? "row" : "rows"} dropped by the database
        </p>
      ) : null}
    </Panel>
  );
}

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

  const [drafts, events, crm, cfgRows] = (await Promise.all([
    sql`select * from v_review_queue where outreach_id = ${id}`,
    sql`
      select id::int as id, action, before, after, created_at
      from console_events
      where entity = 'outreach' and entity_id = ${id}
      order by created_at desc, id desc
      limit 50`,
    sql`
      select company_hs_id, contact_hs_id, deal_hs_id, deal_stage, last_error
      from v_crm_status
      where outreach_id = ${id}`,
    sql`select payload->'hubspot' as hubspot from config_versions order by id desc limit 1`,
  ])) as [Draft[], Event[], CrmRow[], { hubspot: unknown }[]];
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
  // Sprint 14: gate rows, rejections with a scope, and drafts parked for a re-draft.
  const gate = gateName(d.llm_provider);
  const rejected = d.approval_status === "rejected";
  const needsRedraft = d.approval_status === "needs_redraft" && d.send_status === "not_sent";
  const failure = d.risk_notes?.includes("llm_errors:") ? d.risk_notes.split("llm_errors:").slice(1).join("llm_errors:").trim() : "";
  const hubspot = readHubspotCfg(cfgRows[0]?.hubspot);
  // Same rule as v_hubspot_scope: approved or sent, account not vetoed.
  const inCrmScope =
    (d.approval_status === "approved" || d.send_status === "sent") && d.account_status !== "rejected";
  const Title = mode === "page" ? "h1" : "h2";
  const gig = d.lead_track === "gig_post";
  // Sprint 17 (ADR-133): Claude lead digest drafts. Their source_meta holds the agent's evidence,
  // not a directory profile, even on the agency track.
  const agent = isAgent(d.llm_provider);
  const meta = d.lead_track === "agency_partner" && !agent ? readMeta<DirectoryMeta>(d.source_meta) : null;
  const agentMeta = agent ? readMeta<AgentMeta>(d.source_meta) : null;
  const signalUrl = httpUrl(typeof agentMeta?.signal_url === "string" ? agentMeta.signal_url : null);
  const sourceUrls = [
    ...new Set(
      (Array.isArray(agentMeta?.source_urls) ? agentMeta.source_urls : [])
        .map((u) => (typeof u === "string" ? httpUrl(u.trim()) : null))
        .filter((u): u is string => u !== null && u !== signalUrl),
    ),
  ];
  const whatTheySell = typeof agentMeta?.what_they_sell === "string" ? agentMeta.what_they_sell : null;
  const scoreIn =
    typeof agentMeta?.score_in === "number" && agentMeta.score_in !== d.final_score ? agentMeta.score_in : null;
  // Sprint 18: lane, buyer and budget facts, and the sample accounts (lane A).
  const lane = str(agentMeta?.lane);
  const sellsTo = str(agentMeta?.sells_to);
  const buyerPool = num(agentMeta?.buyer_pool);
  const gtmPeople = num(agentMeta?.gtm_people);
  const revenueSignal = str(agentMeta?.revenue_signal);
  const author = agentMeta?.signal_author && typeof agentMeta.signal_author === "object" ? agentMeta.signal_author : null;
  const authorText = [str(author?.name), str(author?.role)].filter(Boolean).join(", ") || null;
  const fnd = agentMeta?.funding && typeof agentMeta.funding === "object" ? agentMeta.funding : null;
  const fundingText =
    [str(fnd?.stage), formatMusd(fnd?.amount_musd), str(fnd?.date), str(fnd?.lead_investor) ? `led by ${str(fnd?.lead_investor)}` : null]
      .filter(Boolean)
      .join(", ") || null;
  const fundingUrl = httpUrl(str(fnd?.url));
  const sample = Array.isArray(agentMeta?.sample)
    ? agentMeta.sample.filter((r): r is SampleRow => r !== null && typeof r === "object")
    : [];
  const sampleDropped = num(agentMeta?.sample_dropped) ?? 0;
  const agentSources = Boolean(
    signalUrl ||
      sourceUrls.length ||
      whatTheySell ||
      scoreIn !== null ||
      lane ||
      sellsTo ||
      buyerPool !== null ||
      gtmPeople !== null ||
      authorText ||
      fundingText ||
      revenueSignal,
  );
  // The agent writes its signal to both trigger and clay_trigger, and the signal URL to angle_basis:
  // show each once (the dated Trigger fact and the Agent sources links).
  const sameTrigger = agent && (d.trigger ?? "").trim() === (d.clay_trigger ?? "").trim();
  const sameBasis = agent && (d.angle_basis ?? "").trim() === (agentMeta?.signal_url ?? "").trim();
  const postUrl = httpUrl(d.gig_url);
  const profileUrl = httpUrl(meta?.profile_url ?? null);

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
          {/* Provenance, not a draft state: a neutral chip. */}
          {gate ? (
            <span className="inline-flex h-6 shrink-0 items-center rounded bg-secondary px-2 text-[0.8125rem] font-medium">
              Auto
            </span>
          ) : null}
          {agent ? (
            <span className="inline-flex h-6 shrink-0 items-center rounded bg-secondary px-2 text-[0.8125rem] font-medium">
              Claude
            </span>
          ) : null}
          {/* Sprint 15: the lead track is a fact, not a state, so the chip stays neutral. */}
          {d.lead_track && d.lead_track !== "smb_direct" ? (
            <span className="inline-flex h-6 shrink-0 items-center rounded bg-secondary px-2 text-[0.8125rem] font-medium">
              {TRACK_LABELS[d.lead_track] ?? d.lead_track}
            </span>
          ) : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-2 text-[0.9375rem] text-muted-foreground">
          <ChannelIcon channel={d.channel} className="size-4" />
          <span>
            {channelLabel(d.channel)} to {[d.contact_name, d.contact_title].filter(Boolean).join(", ") || "no contact"}
          </span>
          {d.run_date ? <span className="tabular text-ink-3">drafted {timeAgo(d.run_date.toISOString())}</span> : null}
        </p>
      </div>

      {rejected ? (
        <Panel title={gate ? "Why the engine skipped it" : "Why it was rejected"}>
          <dl className="space-y-3">
            <Fact
              term="Scope"
              value={
                d.reject_scope
                  ? (REJECT_SCOPE_LABELS[d.reject_scope] ?? d.reject_scope)
                  : "Not recorded. An older rejection counts as bad company."
              }
            />
            <Fact term="Notes" value={d.notes} />
          </dl>
        </Panel>
      ) : null}

      {needsRedraft ? (
        <Panel title="Why it needs a re-draft">
          <p className="min-w-0 whitespace-pre-wrap wrap-anywhere text-muted-foreground">
            {failure || (template ? "Every LLM step failed, so the template fallback wrote this draft." : "The engine did not record a reason.")}
          </p>
          <p className="text-[0.8125rem] text-ink-3">Edit the draft or ask for a re-draft. It cannot be approved as it is.</p>
        </Panel>
      ) : null}

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

      {gig ? (
        <Panel title="Gig post">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact term="Platform" value={d.gig_platform ? (PLATFORM_LABELS[d.gig_platform] ?? d.gig_platform) : null} />
            <Fact term="Posted" value={d.gig_posted_at ? timeAgo(d.gig_posted_at.toISOString()) : null} />
            <Fact term="Replies" value={d.gig_reply_count == null ? "Unknown" : String(d.gig_reply_count)} />
            <Fact term="Gig score" value={d.gig_score == null ? null : String(d.gig_score)} />
            <Fact term="Matched stack" value={d.gig_matched_stack} />
            <Fact term="Budget" value={d.gig_stated_budget || "Not stated"} />
            <Fact term="Post status" value={d.gig_status ? d.gig_status.replace(/_/g, " ") : null} />
          </dl>
          {postUrl ? (
            <a
              href={postUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-1.5 font-medium underline underline-offset-4 sm:h-auto"
            >
              Open the post
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          ) : null}
          <p className="text-[0.8125rem] text-ink-3">Nothing is sent from here. Reply on the platform, then mark it sent.</p>
        </Panel>
      ) : null}

      {meta ? (
        <Panel title="Directory profile">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact term="Directory" value={meta.directory === "n8n" ? "n8n experts" : meta.directory === "clay" ? "Clay experts" : (meta.directory ?? null)} />
            <Fact term="Tier" value={meta.tier ?? null} />
            <Fact term="Services" value={list(meta.services)} />
            <Fact term="Languages" value={list(meta.languages)} />
            <Fact term="Pricing" value={list(meta.pricing)?.replace(/-/g, " ") ?? null} />
          </dl>
          {profileUrl ? (
            <a
              href={profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-1.5 font-medium underline underline-offset-4 sm:h-auto"
            >
              Open the profile
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          ) : null}
        </Panel>
      ) : null}

      {sample.length || sampleDropped > 0 ? <SampleList rows={sample} dropped={sampleDropped} mode={mode} /> : null}

      {agentSources ? (
        <Panel title="Agent sources">
          <dl className="space-y-3">
            <Fact term="Lane" value={lane ? (LANE_LABELS[lane] ?? idWords(lane)) : null} />
            <Fact term="Signal by" value={authorText} />
            {signalUrl ? (
              <div className="space-y-0.5">
                <dt className="text-[0.8125rem] font-medium text-muted-foreground">Signal</dt>
                <dd>
                  <SourceLink url={signalUrl} />
                </dd>
              </div>
            ) : null}
            {sourceUrls.length ? (
              <div className="space-y-0.5">
                <dt className="text-[0.8125rem] font-medium text-muted-foreground">Sources</dt>
                <dd>
                  <ul className="space-y-1">
                    {sourceUrls.map((u) => (
                      <li key={u}>
                        <SourceLink url={u} />
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
            <Fact term="What they sell" value={whatTheySell} />
            <Fact term="Sells to" value={sellsTo} />
            {/* Prompt v3 step 5: a full first Clay page is recorded as 20, a minimum rather than a count. */}
            <Fact
              term="Buyer pool"
              value={
                buyerPool === null
                  ? null
                  : `${buyerPool === 20 ? "20 or more" : buyerPool} matching companies in Clay search`
              }
            />
            <Fact
              term="GTM people"
              value={gtmPeople === null ? null : gtmPeople === 0 ? "None found" : `${gtmPeople} in sales, growth, BD or RevOps`}
            />
            {fundingText ? (
              <div className="space-y-0.5">
                <dt className="text-[0.8125rem] font-medium text-muted-foreground">Funding</dt>
                <dd className="space-y-1">
                  <span className="block wrap-anywhere">{fundingText}</span>
                  {fundingUrl ? <SourceLink url={fundingUrl} /> : null}
                </dd>
              </div>
            ) : null}
            <Fact term="Revenue signal" value={revenueSignal} />
          </dl>
          {scoreIn !== null ? (
            <p className="tabular text-[0.8125rem] text-ink-3">Score sent by the agent: {scoreIn}</p>
          ) : null}
        </Panel>
      ) : null}

      {/* The pane is narrower than the page, so its side column only appears from xl. */}
      <div
        className={cn(
          "grid gap-4",
          mode === "page" ? "lg:grid-cols-[minmax(0,1fr)_22rem]" : "xl:grid-cols-[minmax(0,1fr)_18rem]",
        )}
      >
        <Panel title="Why this person, why now">
          <dl className="space-y-3">
            <Fact term="Angle" value={d.angle ? (ANGLE_LABELS[d.angle] ?? idWords(d.angle)) : null} />
            <Fact term="Angle basis" value={sameBasis ? null : d.angle_basis} />
            <Fact term="Account type" value={idWords(d.account_type)} />
            <Fact term="Product category" value={idWords(d.product_category)} />
            <Fact term="Trigger" value={sameTrigger ? null : d.trigger} />
            <ClayTriggerFact
              trigger={d.clay_trigger}
              source={d.clay_trigger_source}
              date={d.clay_trigger_date}
              label={d.clay_trigger_source === "claude agent" ? "Trigger" : undefined}
            />
            <Fact term="Pain point" value={d.pain_point} />
            <Fact term="Value proposition" value={d.value_proposition} />
            <Fact term="Proof point" value={d.proof_point} />
            <Fact term="Why it matches" value={d.why_match} />
            <Fact term="Red flags" value={d.red_flags} warn />
            <Fact term="Clay summary" value={d.clay_summary} />
            <Fact term="Tech stack" value={d.tech_stack} />
            {hubspot ? <CrmStatus inScope={inCrmScope} row={crm[0] ?? null} cfg={hubspot} /> : null}
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
              {template
                ? "Drafted by the template fallback, not an LLM"
                : gate
                  ? `Not drafted. The ${gate} gate stopped it before any LLM call.`
                  : agent
                    ? "Drafted by the Claude lead digest"
                    : `Drafted by ${d.llm_provider ?? "unknown"}`}
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
