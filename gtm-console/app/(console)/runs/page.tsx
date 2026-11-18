import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { formatAge, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SegmentedLinks } from "@/components/segmented-links";

// Per-request private data: the layout's `instant = false` does not cover pages below it.
export const instant = false;

const TABS = [
  { key: "engine", label: "Engine" },
  // Sprint 15: one gig_ops row per GTM Gig Finder run
  { key: "gigs", label: "Gigs" },
  { key: "sync", label: "Sync" },
  { key: "hubspot", label: "HubSpot" },
  { key: "activity", label: "Activity" },
] as const;
type Tab = (typeof TABS)[number]["key"];

type Kpis = {
  awaiting: number;
  approved: number;
  sent_7d: number;
  engine_age: number | null;
  sync_age: number | null;
};

type EngineRun = {
  run_at: Date;
  config_rev: string | null;
  accounts_written: number | null;
  contacts_written: number | null;
  outreach_drafts_written: number | null;
  llm_calls: number | null;
  llm_failures: number | null;
  warnings: string | null;
  errors_sample: string | null;
};

type SyncRun = {
  id: number;
  run_at: Date;
  pushed_config: number | null;
  pushed_outreach: number | null;
  pushed_contacts: number | null;
  pushed_accounts: number | null;
  pulled_accounts: number | null;
  pulled_contacts: number | null;
  new_outreach: number | null;
  new_ops: number | null;
  config_state: string | null;
  warnings: string | null;
  duration_ms: number | null;
};

// started_at arrives as a Date; the page turns it into an ISO string before rendering.
type HubspotRun = {
  run_id: string;
  started_at: string;
  created: number;
  updated: number;
  adopted: number;
  failed: number;
  stage_changes: number;
  errors_sample: string | null;
};

// Sprint 15: gig_ops (GTM Gig Finder). Every gate drop is counted (ADR-116).
type GigRun = {
  run_id: string;
  run_at: Date;
  config_rev: string | null;
  fetched: number | null;
  intent_for_hire: number | null;
  intent_unclear: number | null;
  stale: number | null;
  crowded: number | null;
  vetoed: number | null;
  stack_miss: number | null;
  budget_low: number | null;
  already_seen: number | null;
  scored: number | null;
  drafted: number | null;
  pinged: number | null;
  expired: number | null;
  errors: string | null;
  source_stats: string | null;
};

// Sprint 17 (ADR-133): v_agent_ingest_runs, one row per Claude lead digest run.
type AgentRun = {
  run_id: string;
  agent: string;
  started_at: Date;
  inserted: number;
  needs_redraft: number;
  duplicates: number;
  rejected: number;
  errors: number;
};

type Quarantined = { link_type: string; local_id: string; failures: number; last_error: string | null };

type Event = {
  id: number;
  entity: string;
  entity_id: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor: string;
  created_at: Date;
};

const n = (v: number | null) => (v === null ? "" : String(v));

// ---------- small shared bits ----------

function Num({ children }: { children: React.ReactNode }) {
  return <td className="tabular px-3 py-2.5 text-right">{children}</td>;
}

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return <th className={cn("px-3 py-2.5 font-medium whitespace-nowrap", right && "text-right")}>{children}</th>;
}

function Time({ at }: { at: Date }) {
  return (
    <span className="tabular whitespace-nowrap text-ink-3" title={at.toISOString()}>
      {timeAgo(at.toISOString())}
    </span>
  );
}

// Long text: first line visible, the rest behind a native disclosure (no client JS).
function Expandable({ text }: { text: string | null }) {
  if (!text) return null;
  const first = text.length > 80 ? `${text.slice(0, 80)}...` : text;
  if (first === text) return <span className="wrap-anywhere">{text}</span>;
  return (
    <details className="group min-w-0">
      <summary className="cursor-pointer wrap-anywhere text-muted-foreground group-open:mb-1">{first}</summary>
      <p className="whitespace-pre-wrap wrap-anywhere">{text}</p>
    </details>
  );
}

// Failures and drift are errors (danger); warnings are flagged without color.
function Flag({ tone, children }: { tone: "danger" | "warn"; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 font-semibold", tone === "danger" && "text-danger")}>
      <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
      {children}
    </span>
  );
}

function Empty({ text, href, action }: { text: string; href: string; action: string }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-8 text-center">
      <p>{text}</p>
      <Link href={href} className="mt-2 inline-block font-medium underline underline-offset-4">{action}</Link>
    </div>
  );
}

function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="hidden overflow-hidden rounded-lg border bg-card lg:block">
      <table className="w-full text-[0.9375rem]">{children}</table>
    </div>
  );
}

function Blocks({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y divide-border overflow-hidden rounded-lg border bg-card lg:hidden">{children}</ul>;
}

const HEAD = "border-b text-left text-[0.8125rem] text-muted-foreground";
const ROW = "align-top hover:bg-secondary";

// ---------- tabs ----------

function engineFlag(r: EngineRun) {
  const calls = r.llm_calls ?? 0;
  const fails = r.llm_failures ?? 0;
  return calls > 0 && fails >= calls ? (
    <Flag tone="danger">All {calls} LLM {calls === 1 ? "call" : "calls"} failed</Flag>
  ) : null;
}

function EngineTab({ rows }: { rows: EngineRun[] }) {
  if (rows.length === 0) return <Empty text="No engine runs yet. Start n8n on your laptop and run the engine." href="/runs?tab=sync" action="Check sync runs" />;
  return (
    <>
      <TableShell>
        <thead>
          <tr className={HEAD}>
            <Th>Run</Th><Th>Config rev</Th><Th right>Accounts</Th><Th right>Contacts</Th><Th right>Drafts</Th>
            <Th right>LLM calls</Th><Th right>LLM failures</Th><Th>Warnings</Th><Th>Errors</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.run_at.toISOString()} className={ROW}>
              <td className="px-3 py-2.5"><Time at={r.run_at} /></td>
              <td className="max-w-[12rem] px-3 py-2.5 font-mono text-[0.8125rem] wrap-anywhere">{r.config_rev}</td>
              <Num>{n(r.accounts_written)}</Num>
              <Num>{n(r.contacts_written)}</Num>
              <Num>{n(r.outreach_drafts_written)}</Num>
              <Num>{n(r.llm_calls)}</Num>
              <Num>{n(r.llm_failures)}</Num>
              <td className="max-w-[16rem] px-3 py-2.5 text-[0.8125rem]"><Expandable text={r.warnings} /></td>
              <td className="max-w-[20rem] space-y-1 px-3 py-2.5 text-[0.8125rem]">
                {engineFlag(r)}
                <Expandable text={r.errors_sample} />
              </td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      <Blocks>
        {rows.map((r) => (
          <li key={r.run_at.toISOString()} className="space-y-1 px-4 py-3 text-[0.9375rem]">
            <div className="flex items-baseline gap-2">
              <Time at={r.run_at} />
              <span className="ml-auto min-w-0 truncate font-mono text-[0.8125rem] text-muted-foreground">{r.config_rev}</span>
            </div>
            <p className="tabular">
              <strong>{n(r.accounts_written) || 0}</strong> accounts, <strong>{n(r.contacts_written) || 0}</strong> contacts,{" "}
              <strong>{n(r.outreach_drafts_written) || 0}</strong> drafts, LLM {n(r.llm_failures) || 0} of {n(r.llm_calls) || 0} failed
            </p>
            {engineFlag(r)}
            {r.warnings ? <div className="text-[0.8125rem]"><Expandable text={`Warnings: ${r.warnings}`} /></div> : null}
            {r.errors_sample ? <div className="text-[0.8125rem]"><Expandable text={`Errors: ${r.errors_sample}`} /></div> : null}
          </li>
        ))}
      </Blocks>
    </>
  );
}

// Sprint 17: the Claude lead digest is a second lead source, so its runs sit under the engine's.
function AgentDigestCard({ rows }: { rows: AgentRun[] }) {
  const errors = (r: AgentRun) => (r.errors > 0 ? <Flag tone="danger">{r.errors}</Flag> : r.errors);
  return (
    <section className="space-y-2" aria-labelledby="agent-digest-runs">
      <h2 id="agent-digest-runs" className="text-[1.0625rem] leading-snug font-semibold">Claude lead digest</h2>
      {rows.length === 0 ? (
        <Empty
          text="No Claude lead digest runs yet. Each run shows here once the scheduled task saves a lead."
          href="/queue?tab=all&src=agent"
          action="Show Claude drafts"
        />
      ) : (
        <>
          <TableShell>
            <thead>
              <tr className={HEAD}>
                <Th>Run</Th><Th>When</Th><Th right>Inserted</Th><Th right>Re-draft</Th><Th right>Duplicates</Th>
                <Th right>Rejected</Th><Th right>Errors</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={`${r.agent}:${r.run_id}`} className={ROW}>
                  <td className="px-3 py-2.5 font-mono text-[0.8125rem] wrap-anywhere">{r.run_id}</td>
                  <td className="px-3 py-2.5"><Time at={r.started_at} /></td>
                  <Num>{r.inserted}</Num>
                  <Num>{r.needs_redraft}</Num>
                  <Num>{r.duplicates}</Num>
                  <Num>{r.rejected}</Num>
                  <td className="tabular px-3 py-2.5 text-right">{errors(r)}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
          <Blocks>
            {rows.map((r) => (
              <li key={`${r.agent}:${r.run_id}`} className="space-y-1 px-4 py-3 text-[0.9375rem]">
                <div className="flex items-baseline gap-2">
                  <Time at={r.started_at} />
                  <span className="ml-auto min-w-0 truncate font-mono text-[0.8125rem] text-muted-foreground">{r.run_id}</span>
                </div>
                <p className="tabular">
                  <strong>{r.inserted}</strong> inserted, <strong>{r.needs_redraft}</strong> to re-draft,{" "}
                  <strong>{r.duplicates}</strong> {r.duplicates === 1 ? "duplicate" : "duplicates"}, <strong>{r.rejected}</strong> rejected
                </p>
                {r.errors > 0 ? (
                  <Flag tone="danger">
                    {r.errors} {r.errors === 1 ? "error" : "errors"}
                  </Flag>
                ) : null}
              </li>
            ))}
          </Blocks>
        </>
      )}
    </section>
  );
}

function GigsTab({ rows }: { rows: GigRun[] }) {
  if (rows.length === 0) return <Empty text="No Gig Finder runs yet. Run GTM Gig Finder in n8n, or publish it to run every 3 hours." href="/gigs" action="Open gig posts" />;
  const gated = (r: GigRun) =>
    `${n(r.intent_for_hire) || 0} offering services, ${n(r.stale) || 0} too old, ${n(r.crowded) || 0} crowded, ` +
    `${n(r.vetoed) || 0} vetoed, ${n(r.stack_miss) || 0} no stack match, ${n(r.budget_low) || 0} under the rate floor`;
  return (
    <>
      <TableShell>
        <thead>
          <tr className={HEAD}>
            <Th>Run</Th><Th>Config rev</Th><Th right>Fetched</Th><Th right>Seen</Th><Th right>Scored</Th><Th right>Drafted</Th>
            <Th right>Pinged</Th><Th right>Expired</Th><Th>Gated</Th><Th>Errors</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.run_id} className={ROW}>
              <td className="px-3 py-2.5"><Time at={r.run_at} /></td>
              <td className="max-w-[12rem] px-3 py-2.5 font-mono text-[0.8125rem] wrap-anywhere">{r.config_rev}</td>
              <Num>{n(r.fetched)}</Num>
              <Num>{n(r.already_seen)}</Num>
              <Num>{n(r.scored)}</Num>
              <Num>{n(r.drafted)}</Num>
              <Num>{n(r.pinged)}</Num>
              <Num>{n(r.expired)}</Num>
              <td className="max-w-[18rem] px-3 py-2.5 text-[0.8125rem]"><Expandable text={gated(r)} /></td>
              <td className="max-w-[18rem] space-y-1 px-3 py-2.5 text-[0.8125rem]">
                {r.errors ? <Flag tone="danger">Errors</Flag> : null}
                <Expandable text={r.errors} />
              </td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      <Blocks>
        {rows.map((r) => (
          <li key={r.run_id} className="space-y-1 px-4 py-3 text-[0.9375rem]">
            <div className="flex items-baseline gap-2">
              <Time at={r.run_at} />
              <span className="ml-auto min-w-0 truncate font-mono text-[0.8125rem] text-muted-foreground">{r.config_rev}</span>
            </div>
            <p className="tabular">
              <strong>{n(r.fetched) || 0}</strong> fetched, <strong>{n(r.scored) || 0}</strong> scored,{" "}
              <strong>{n(r.drafted) || 0}</strong> drafted, <strong>{n(r.pinged) || 0}</strong> pinged
            </p>
            <div className="text-[0.8125rem] text-muted-foreground"><Expandable text={`Gated: ${gated(r)}`} /></div>
            {r.errors ? (
              <div className="space-y-1 text-[0.8125rem]">
                <Flag tone="danger">Errors</Flag>
                <Expandable text={r.errors} />
              </div>
            ) : null}
          </li>
        ))}
      </Blocks>
    </>
  );
}

function syncFlag(r: SyncRun) {
  if (r.config_state === "drift") return <Flag tone="danger">Config drift</Flag>;
  if (r.warnings && r.warnings.trim() !== "") return <Flag tone="warn">Warnings</Flag>;
  return null;
}

function duration(ms: number | null) {
  if (ms === null) return "";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function SyncTab({ rows }: { rows: SyncRun[] }) {
  if (rows.length === 0) return <Empty text="No sync runs yet. Start n8n on your laptop so GTM Neon Sync can run." href="/runs" action="Back to engine runs" />;
  return (
    <>
      <TableShell>
        <thead>
          <tr className={HEAD}>
            <Th>Run</Th><Th right>Pushed</Th><Th right>Pulled</Th><Th right>New drafts</Th><Th right>New ops</Th>
            <Th>Config</Th><Th>Warnings</Th><Th right>Took</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => {
            const pushed = (r.pushed_config ?? 0) + (r.pushed_outreach ?? 0) + (r.pushed_contacts ?? 0) + (r.pushed_accounts ?? 0);
            const pulled = (r.pulled_accounts ?? 0) + (r.pulled_contacts ?? 0);
            return (
              <tr key={r.id} className={ROW}>
                <td className="px-3 py-2.5"><Time at={r.run_at} /></td>
                <td
                  className="tabular px-3 py-2.5 text-right"
                  title={`config ${n(r.pushed_config) || 0}, outreach ${n(r.pushed_outreach) || 0}, contacts ${n(r.pushed_contacts) || 0}, accounts ${n(r.pushed_accounts) || 0}`}
                >
                  {pushed}
                </td>
                <td
                  className="tabular px-3 py-2.5 text-right"
                  title={`accounts ${n(r.pulled_accounts) || 0}, contacts ${n(r.pulled_contacts) || 0}`}
                >
                  {pulled}
                </td>
                <Num>{n(r.new_outreach)}</Num>
                <Num>{n(r.new_ops)}</Num>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {r.config_state === "drift" ? <Flag tone="danger">Config drift</Flag> : (r.config_state ?? "").replace(/_/g, " ")}
                </td>
                <td className="max-w-[20rem] space-y-1 px-3 py-2.5 text-[0.8125rem]">
                  {r.warnings && r.warnings.trim() !== "" ? <Flag tone="warn">Warnings</Flag> : null}
                  <Expandable text={r.warnings} />
                </td>
                <td className="tabular px-3 py-2.5 text-right text-ink-3">{duration(r.duration_ms)}</td>
              </tr>
            );
          })}
        </tbody>
      </TableShell>
      <Blocks>
        {rows.map((r) => (
          <li key={r.id} className="space-y-1 px-4 py-3 text-[0.9375rem]">
            <div className="flex items-baseline gap-2">
              <Time at={r.run_at} />
              <span className="tabular ml-auto text-[0.8125rem] text-ink-3">{duration(r.duration_ms)}</span>
            </div>
            <p className="tabular">
              Pushed <strong>{(r.pushed_config ?? 0) + (r.pushed_outreach ?? 0) + (r.pushed_contacts ?? 0) + (r.pushed_accounts ?? 0)}</strong>,
              {" "}pulled <strong>{(r.pulled_accounts ?? 0) + (r.pulled_contacts ?? 0)}</strong>, new drafts{" "}
              <strong>{n(r.new_outreach) || 0}</strong>, config {(r.config_state ?? "unknown").replace(/_/g, " ")}
            </p>
            {syncFlag(r)}
            {r.warnings ? <div className="text-[0.8125rem]"><Expandable text={r.warnings} /></div> : null}
          </li>
        ))}
      </Blocks>
    </>
  );
}

function IsoTime({ iso }: { iso: string }) {
  return (
    <span className="tabular whitespace-nowrap text-ink-3" title={iso}>
      {timeAgo(iso)}
    </span>
  );
}

function QuarantineNote({ rows }: { rows: Quarantined[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2 rounded-lg border bg-danger-tint p-4 text-[0.9375rem]">
      <Flag tone="danger">
        {rows.length} {rows.length === 1 ? "record" : "records"} stopped after 3 failures
      </Flag>
      <ul className="space-y-2">
        {rows.map((q) => (
          <li key={`${q.link_type}:${q.local_id}`} className="space-y-0.5">
            <p className="flex flex-wrap gap-x-2">
              <span className="font-medium">{q.link_type}</span>
              <span className="font-mono text-[0.8125rem] wrap-anywhere">{q.local_id}</span>
            </p>
            {q.last_error ? <div className="text-[0.8125rem]"><Expandable text={q.last_error} /></div> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function HubspotTab({ rows, quarantine }: { rows: HubspotRun[]; quarantine: Quarantined[] }) {
  if (rows.length === 0 && quarantine.length === 0) {
    return <Empty text="No HubSpot sync runs yet. Start n8n on your laptop so GTM HubSpot Sync can run." href="/runs?tab=sync" action="Check sync runs" />;
  }
  return (
    <>
      <QuarantineNote rows={quarantine} />
      <TableShell>
        <thead>
          <tr className={HEAD}>
            <Th>Run</Th><Th>Started</Th><Th right>Created</Th><Th right>Updated</Th><Th right>Adopted</Th>
            <Th right>Failed</Th><Th right>Stage changes</Th><Th>Errors</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.run_id} className={ROW}>
              <td className="px-3 py-2.5 font-mono text-[0.8125rem]">{r.run_id}</td>
              <td className="px-3 py-2.5"><IsoTime iso={r.started_at} /></td>
              <Num>{r.created}</Num>
              <Num>{r.updated}</Num>
              <Num>{r.adopted}</Num>
              <td className="tabular px-3 py-2.5 text-right">
                {r.failed > 0 ? <Flag tone="danger">{r.failed}</Flag> : r.failed}
              </td>
              <Num>{r.stage_changes}</Num>
              <td className="max-w-[20rem] px-3 py-2.5 text-[0.8125rem]"><Expandable text={r.errors_sample} /></td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      <Blocks>
        {rows.map((r) => (
          <li key={r.run_id} className="space-y-1 px-4 py-3 text-[0.9375rem]">
            <div className="flex items-baseline gap-2">
              <IsoTime iso={r.started_at} />
              <span className="ml-auto font-mono text-[0.8125rem] text-muted-foreground">run {r.run_id}</span>
            </div>
            <p className="tabular">
              <strong>{r.created}</strong> created, <strong>{r.updated}</strong> updated, <strong>{r.adopted}</strong> adopted,{" "}
              <strong>{r.stage_changes}</strong> stage changes
            </p>
            {r.failed > 0 ? <Flag tone="danger">{r.failed} failed</Flag> : null}
            {r.errors_sample ? <div className="text-[0.8125rem]"><Expandable text={r.errors_sample} /></div> : null}
          </li>
        ))}
      </Blocks>
    </>
  );
}

function entityHref(e: Event): string | null {
  if (e.entity === "outreach") return `/queue/${encodeURIComponent(e.entity_id)}`;
  if (e.entity === "account") return `/accounts/${encodeURIComponent(e.entity_id)}`;
  if (e.entity === "config") return `/config?compare=${encodeURIComponent(e.entity_id)}#v${encodeURIComponent(e.entity_id)}`;
  return null;
}

function describe(e: Event): string {
  const parts: string[] = [];
  for (const k of ["approval_status", "send_status", "status", "rev"]) {
    const b = e.before?.[k];
    const a = e.after?.[k];
    if (a !== undefined && b !== a) parts.push(`${String(b ?? "none")} to ${String(a ?? "none")}`);
  }
  const edited = Object.keys(e.after ?? {}).filter(
    (k) => !["approval_status", "send_status", "status", "rev", "reason", "note"].includes(k),
  );
  if (edited.length) parts.push(`changed ${edited.join(", ")}`);
  const why = e.after?.reason ?? e.after?.note;
  if (typeof why === "string" && why) parts.push(`"${why}"`);
  return parts.join("; ");
}

function ActivityTab({ rows }: { rows: Event[] }) {
  if (rows.length === 0) return <Empty text="No console actions yet. Decisions you make in the queue show up here." href="/queue" action="Open the review queue" />;
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
      {rows.map((e) => {
        const href = entityHref(e);
        return (
          <li key={e.id} className="grid gap-x-3 gap-y-0.5 px-4 py-3 text-[0.9375rem] lg:grid-cols-[7rem_10rem_minmax(0,1fr)_minmax(0,1.2fr)_6rem_6rem] lg:items-baseline">
            <span className="font-medium">{e.entity}</span>
            <span className="font-semibold">{e.action.replace(/_/g, " ")}</span>
            {href ? (
              <Link href={href} className="min-w-0 truncate font-mono text-[0.8125rem] underline underline-offset-4">
                {e.entity_id}
              </Link>
            ) : (
              <span className="min-w-0 truncate font-mono text-[0.8125rem]">{e.entity_id}</span>
            )}
            <span className="min-w-0 text-muted-foreground wrap-anywhere">{describe(e)}</span>
            <span className="text-[0.8125rem] text-muted-foreground">by {e.actor}</span>
            <span className="text-[0.8125rem] lg:text-right"><Time at={e.created_at} /></span>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- page ----------

export default async function RunsPage({ searchParams }: PageProps<"/runs">) {
  await requireSession();
  const raw = (await searchParams).tab;
  const tab: Tab = TABS.some((t) => t.key === raw) ? (raw as Tab) : "engine";

  const [k] = (await sql`
    select
      (select count(*) from v_review_queue
        where approval_status in ('pending','edited') and send_status = 'not_sent')::int as awaiting,
      (select count(*) from v_review_queue
        where approval_status = 'approved' and send_status = 'not_sent')::int as approved,
      (select count(*) from v_review_queue
        where send_status = 'sent' and sent_at > now() - interval '7 days')::int as sent_7d,
      (select extract(epoch from now() - max(run_at)) from ops)::int as engine_age,
      (select extract(epoch from now() - max(run_at)) from sync_ops)::int as sync_age`) as Kpis[];

  let body: React.ReactNode;
  if (tab === "engine") {
    const [rows, agentRuns] = (await Promise.all([
      sql`
        select run_at, config_rev, accounts_written, contacts_written, outreach_drafts_written,
               llm_calls, llm_failures, warnings, errors_sample
        from ops order by run_at desc limit 30`,
      // Sprint 17: the Claude lead digest's runs (ADR-133)
      sql`
        select run_id, agent, started_at, inserted::int as inserted, needs_redraft::int as needs_redraft,
               duplicates::int as duplicates, rejected::int as rejected, errors::int as errors
        from v_agent_ingest_runs order by started_at desc limit 10`,
    ])) as [EngineRun[], AgentRun[]];
    body = (
      <>
        <EngineTab rows={rows} />
        <AgentDigestCard rows={agentRuns} />
      </>
    );
  } else if (tab === "gigs") {
    const rows = (await sql`
      select run_id, run_at, config_rev, fetched, intent_for_hire, intent_unclear, stale, crowded, vetoed, stack_miss,
             budget_low, already_seen, scored, drafted, pinged, expired, errors, source_stats
      from gig_ops order by run_at desc limit 30`) as GigRun[];
    body = <GigsTab rows={rows} />;
  } else if (tab === "sync") {
    const rows = (await sql`
      select id::int as id, run_at, pushed_config, pushed_outreach, pushed_contacts, pushed_accounts,
             pulled_accounts, pulled_contacts, new_outreach, new_ops,
             config_state, warnings, duration_ms
      from sync_ops order by run_at desc, id desc limit 30`) as SyncRun[];
    body = <SyncTab rows={rows} />;
  } else if (tab === "hubspot") {
    const [runs, quarantine] = (await Promise.all([
      sql`
        select run_id, started_at, created, updated, adopted, failed, stage_changes, errors_sample
        from v_hubspot_runs order by started_at desc limit 20`,
      sql`
        select link_type, local_id, failures, last_error
        from v_hubspot_quarantine order by last_failed_at desc`,
    ])) as [(Omit<HubspotRun, "started_at"> & { started_at: Date })[], Quarantined[]];
    const rows: HubspotRun[] = runs.map((r) => ({ ...r, started_at: r.started_at.toISOString() }));
    body = <HubspotTab rows={rows} quarantine={quarantine} />;
  } else {
    const rows = (await sql`
      select id::int as id, entity, entity_id, action, before, after, actor, created_at
      from console_events order by created_at desc, id desc limit 50`) as Event[];
    body = <ActivityTab rows={rows} />;
  }

  const age = (s: number | null) => (s === null ? "never" : formatAge(s));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl leading-tight font-semibold">Runs</h1>
      <p className="tabular max-w-[70ch] text-[0.9375rem]">
        <strong>{k?.awaiting ?? 0}</strong> awaiting review, <strong>{k?.approved ?? 0}</strong> approved not sent,{" "}
        <strong>{k?.sent_7d ?? 0}</strong> sent in the last 7 days. Last engine run <strong>{age(k?.engine_age ?? null)}</strong>,
        last sync{" "}
        <strong className={cn(k?.sync_age != null && k.sync_age > 86400 && "text-danger")}>{age(k?.sync_age ?? null)}</strong>.
      </p>
      <SegmentedLinks
        label="Run type"
        items={TABS.map((t) => ({ href: `/runs?tab=${t.key}`, label: t.label, active: t.key === tab }))}
      />
      {body}
    </div>
  );
}
