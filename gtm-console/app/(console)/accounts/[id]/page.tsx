import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, ExternalLink, TriangleAlert } from "lucide-react";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { STATE_RULE, displayState, httpUrl, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChannelIcon } from "@/components/channel-icon";
import { ClayTriggerFact } from "@/components/clay-trigger";
import { ScoreLedger } from "@/components/score-ledger";
import { ScoreMeter } from "@/components/score-meter";
import { StatusChip } from "@/components/status-chip";
import { VetoButton } from "@/components/veto-button";

// Per-request private data: the layout's `instant = false` does not cover pages below it.
export const instant = false;

type Account = {
  account_id: string;
  run_date: Date | null;
  source: string | null;
  company_name: string | null;
  domain: string | null;
  website: string | null;
  industry: string | null;
  company_type: string | null;
  employee_count: number | null;
  location_raw: string | null;
  country: string | null;
  timezone_utc_offset: string | null;
  funding_stage: string | null;
  final_score: number | null;
  priority: string | null;
  why_match: string | null;
  red_flags: string | null;
  score_breakdown: string | null;
  confidence: number | null;
  status: string | null;
  linkedin_url: string | null;
  tech_stack: string | null;
  funding_proxy_score: number | null;
  automation_need_score: number | null;
  enrichment_status: string | null;
  clay_summary: string | null;
  clay_status: string | null;
  clay_enriched_at: Date | null;
  contact_feasibility_score: number | null;
  contact_status: string | null;
  dashboard_dirty_at: Date | null;
  synced_at: Date | null;
  clay_trigger: string | null;
  clay_trigger_source: string | null;
  clay_trigger_date: string | null;
  contacts_count: number;
  drafts_count: number;
};

type Contact = {
  contact_id: string;
  full_name: string | null;
  title: string | null;
  role_category: string | null;
  email: string | null;
  email_status: string | null;
  linkedin_url: string | null;
  contact_score: number | null;
  preferred_channel: string | null;
  status: string | null;
};

type DraftRow = {
  outreach_id: string;
  contact_name: string | null;
  channel: string | null;
  approval_status: string;
  send_status: string;
  run_date: Date | null;
  first_line: string | null;
};

type Event = { id: number; action: string; after: Record<string, unknown> | null; created_at: Date };

const words = (v: string | null) => (v ? v.replace(/_/g, " ") : null);
const ago = (d: Date | null) => (d ? timeAgo(d.toISOString()) : null);
const num = (n: number | string | null) => (n === null || n === "" ? null : String(n));

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <h2 className="text-[1.0625rem] leading-snug font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Fact({ term, value, warn = false }: { term: string; value: React.ReactNode; warn?: boolean }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-[0.8125rem] font-medium text-muted-foreground">{term}</dt>
      <dd className={cn(warn && "flex gap-1.5")}>
        {warn ? <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-label="Warning" role="img" /> : null}
        <span className="min-w-0 whitespace-pre-wrap wrap-anywhere">{value}</span>
      </dd>
    </div>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center gap-1 underline underline-offset-4 sm:min-h-0"
    >
      {children}
      <ExternalLink className="size-3.5" aria-hidden />
    </a>
  );
}

export default async function AccountPage({ params }: PageProps<"/accounts/[id]">) {
  await requireSession();
  let id: string;
  try {
    id = decodeURIComponent((await params).id);
  } catch {
    notFound();
  }

  const [a] = (await sql`select * from v_accounts where account_id = ${id}`) as Account[];
  if (!a) notFound();

  const contacts = (await sql`
    select contact_id, full_name, title, role_category, email, email_status, linkedin_url,
           contact_score, preferred_channel, status
    from contacts
    where account_id = ${id}
    order by contact_score desc nulls last, full_name`) as Contact[];

  const drafts = (await sql`
    select outreach_id, contact_name, channel, approval_status, send_status, run_date, first_line
    from v_review_queue
    where account_id = ${id}
    order by run_date desc nulls last`) as DraftRow[];

  const events = (await sql`
    select id::int as id, action, after, created_at
    from console_events
    where entity = 'account' and entity_id = ${id}
    order by created_at desc, id desc
    limit 20`) as Event[];

  const website = httpUrl(a.website);
  const linkedin = httpUrl(a.linkedin_url);
  const vetoed = a.status === "rejected";
  const name = a.company_name ?? a.account_id;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Link href="/accounts" className="text-[0.9375rem] text-muted-foreground hover:text-foreground">
          Back to accounts
        </Link>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-2xl leading-tight font-semibold">{name}</h1>
          <ScoreMeter score={a.final_score} />
          {vetoed ? <StatusChip state="rejected" label="Vetoed" /> : null}
          {a.priority === "true" ? <span className="text-[0.8125rem] font-semibold">Priority</span> : null}
        </div>
        <p className="flex flex-wrap gap-x-3 text-[0.9375rem] text-muted-foreground">
          {a.domain ? <span>{a.domain}</span> : null}
          {website ? <ExtLink href={website}>Website</ExtLink> : null}
          {linkedin ? <ExtLink href={linkedin}>LinkedIn</ExtLink> : null}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Score">
          <ScoreLedger breakdown={a.score_breakdown} />
        </Panel>
        <Panel title="Clay summary">
          {a.clay_summary ? (
            <p className="whitespace-pre-wrap">{a.clay_summary}</p>
          ) : (
            <p className="text-ink-3">No Clay summary yet.</p>
          )}
          {a.clay_trigger?.trim() ? (
            <dl className="border-t pt-3">
              <ClayTriggerFact trigger={a.clay_trigger} source={a.clay_trigger_source} date={a.clay_trigger_date} />
            </dl>
          ) : null}
        </Panel>
      </div>

      <Panel title="Why this account">
        <dl className="space-y-3">
          <Fact term="Why it matches" value={a.why_match} />
          <Fact term="Red flags" value={a.red_flags} warn />
          <Fact term="Tech stack" value={a.tech_stack} />
        </dl>
      </Panel>

      <Panel title="Details">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3">
          <Fact term="Status" value={words(a.status)} />
          <Fact term="Industry" value={a.industry} />
          <Fact term="Company type" value={a.company_type} />
          <Fact term="Employees" value={num(a.employee_count)} />
          <Fact term="Location" value={a.location_raw} />
          <Fact term="Country" value={a.country} />
          <Fact term="UTC offset" value={num(a.timezone_utc_offset)} />
          <Fact term="Funding stage" value={a.funding_stage} />
          <Fact term="Confidence" value={num(a.confidence)} />
          <Fact term="Funding signal" value={num(a.funding_proxy_score)} />
          <Fact term="Automation need" value={num(a.automation_need_score)} />
          <Fact term="Contact reachability" value={num(a.contact_feasibility_score)} />
          <Fact term="Enrichment" value={words(a.enrichment_status)} />
          <Fact term="Clay" value={words(a.clay_status)} />
          <Fact term="Clay enriched" value={ago(a.clay_enriched_at)} />
          <Fact term="Contact search" value={words(a.contact_status)} />
          <Fact term="Source" value={a.source} />
          <Fact term="Added" value={ago(a.run_date)} />
          <Fact term="Last synced" value={ago(a.synced_at)} />
          <Fact term="Waiting to sync since" value={ago(a.dashboard_dirty_at)} />
          <Fact term="Account ID" value={<span className="font-mono text-[0.8125rem]">{a.account_id}</span>} />
        </dl>
      </Panel>

      <Panel title={`Contacts (${a.contacts_count})`}>
        {contacts.length === 0 ? (
          <p className="text-muted-foreground">No contacts found for this account.</p>
        ) : (
          <ul className="divide-y divide-border">
            {contacts.map((c) => {
              const li = httpUrl(c.linkedin_url);
              return (
                <li key={c.contact_id} className="space-y-1 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">{c.full_name ?? "Unnamed contact"}</span>
                    {c.title ? <span className="text-muted-foreground">{c.title}</span> : null}
                    {c.contact_score !== null ? (
                      <span className="tabular ml-auto text-[0.8125rem] text-ink-3">score {c.contact_score}</span>
                    ) : null}
                  </div>
                  {c.email ? (
                    <p className="flex flex-wrap items-center gap-x-2 text-[0.9375rem]">
                      <span className="break-all">{c.email}</span>
                      {c.email_status === "verified" ? (
                        <span className="flex items-center gap-1 text-[0.8125rem] text-muted-foreground">
                          <CircleCheck className="size-3.5" aria-hidden />
                          verified
                        </span>
                      ) : c.email_status ? (
                        <span className="text-[0.8125rem] text-muted-foreground">{words(c.email_status)}</span>
                      ) : null}
                    </p>
                  ) : null}
                  <p className="flex flex-wrap gap-x-3 text-[0.8125rem] text-muted-foreground">
                    {c.role_category ? <span>{words(c.role_category)}</span> : null}
                    {c.preferred_channel ? <span>prefers {words(c.preferred_channel)}</span> : null}
                    {c.status ? <span>{words(c.status)}</span> : null}
                    {li ? <ExtLink href={li}>LinkedIn</ExtLink> : null}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title={`Drafts (${drafts.length})`}>
        {drafts.length === 0 ? (
          <p className="text-muted-foreground">No drafts for this account yet.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-md border">
            {drafts.map((d) => {
              const state = displayState(d.approval_status, d.send_status);
              return (
                <li key={d.outreach_id}>
                  <Link
                    href={`/queue/${encodeURIComponent(d.outreach_id)}`}
                    className={cn("block space-y-1 border-l-[3px] px-3 py-3 hover:bg-secondary", STATE_RULE[state])}
                  >
                    <div className="flex items-center gap-2">
                      <ChannelIcon channel={d.channel} className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 truncate font-semibold">{d.contact_name ?? "No contact"}</span>
                      <StatusChip state={state} />
                      <span className="tabular ml-auto shrink-0 text-[0.8125rem] text-ink-3">{ago(d.run_date)}</span>
                    </div>
                    {d.first_line ? (
                      <p className="line-clamp-2 font-serif text-[1.0625rem] leading-relaxed">{d.first_line}</p>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {events.length > 0 ? (
        <Panel title="History">
          <ol className="divide-y divide-border">
            {events.map((e) => (
              <li key={e.id} className="flex items-baseline gap-3 py-2">
                <span className="font-medium">{e.action}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {typeof e.after?.reason === "string" && e.after.reason ? `reason: ${e.after.reason}` : ""}
                </span>
                <span className="tabular shrink-0 text-[0.8125rem] text-ink-3" title={e.created_at.toISOString()}>
                  {timeAgo(e.created_at.toISOString())}
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}

      {/* Veto sits at the end of the page, never next to navigation. */}
      {vetoed ? (
        <p className="text-[0.9375rem] text-muted-foreground">
          This account is vetoed. The engine skips it on the next run.
        </p>
      ) : (
        <div className="border-t pt-4">
          <VetoButton accountId={a.account_id} companyName={name} />
        </div>
      )}
    </div>
  );
}
