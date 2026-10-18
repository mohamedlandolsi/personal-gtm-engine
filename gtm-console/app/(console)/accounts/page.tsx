import Link from "next/link";
import { Search } from "lucide-react";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { timeAgo } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScoreMeter } from "@/components/score-meter";
import { SegmentedLinks } from "@/components/segmented-links";
import { StatusChip } from "@/components/status-chip";

// Per-request private data: the layout's `instant = false` does not cover pages below it.
export const instant = false;

const FILTERS = [
  { key: "all", label: "All" },
  { key: "qualified", label: "Qualified" },
  { key: "rejected", label: "Rejected" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];

type Account = {
  account_id: string;
  company_name: string | null;
  domain: string | null;
  final_score: number | null;
  priority: string | null;
  status: string | null;
  enrichment_status: string | null;
  clay_status: string | null;
  contact_status: string | null;
  contacts_count: number;
  drafts_count: number;
  run_date: Date | null;
};

const words = (v: string | null) => (v ? v.replace(/_/g, " ") : "");

function AccountStatus({ status }: { status: string | null }) {
  // A vetoed account is the one account state worth a state color; the rest are plain facts.
  if (status === "rejected") return <StatusChip state="rejected" />;
  return <span>{words(status)}</span>;
}

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function AccountsPage({ searchParams }: PageProps<"/accounts">) {
  await requireSession();
  const sp = await searchParams;
  const q = first(sp.q).trim().slice(0, 100);
  const rawFilter = first(sp.filter);
  const filter: Filter = FILTERS.some((f) => f.key === rawFilter) ? (rawFilter as Filter) : "all";
  // Escape LIKE wildcards so "n8n_io" matches literally.
  const like = q.replace(/[\\%_]/g, "\\$&");

  const rows = (await sql`
    select account_id, company_name, domain, final_score, priority, status, enrichment_status,
           clay_status, contact_status, contacts_count, drafts_count, run_date
    from v_accounts
    where (${q} = '' or company_name ilike '%' || ${like} || '%' or domain ilike '%' || ${like} || '%')
      and (${filter} = 'all'
        or (${filter} = 'qualified' and final_score >= 65 and status is distinct from 'rejected')
        or (${filter} = 'rejected'  and status = 'rejected'))
    order by final_score desc nulls last, company_name
    limit 200`) as Account[];

  const href = (f: Filter) => `/accounts?${new URLSearchParams({ ...(q ? { q } : {}), filter: f })}`;
  const detail = (id: string) => `/accounts/${encodeURIComponent(id)}`;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl leading-tight font-semibold">Accounts</h1>

      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <form action="/accounts" className="flex flex-1 gap-2" role="search">
          <input type="hidden" name="filter" value={filter} />
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search company or domain"
            aria-label="Search company or domain"
            className="h-11 bg-card md:h-9"
          />
          <Button type="submit" variant="outline" className="h-11 md:h-9">
            <Search aria-hidden />
            Search
          </Button>
        </form>
        <SegmentedLinks
          label="Account filter"
          items={FILTERS.map((f) => ({ href: href(f.key), label: f.label, active: f.key === filter }))}
        />
      </div>

      <p className="tabular text-[0.8125rem] text-ink-3">
        {rows.length} {rows.length === 1 ? "account" : "accounts"}
        {q ? ` matching "${q}"` : ""}
      </p>

      {rows.length === 0 ? (
        <div className="rounded-lg border bg-card px-4 py-8 text-center">
          <p>No accounts match this search.</p>
          <Link href="/accounts" className="mt-2 inline-block font-medium underline underline-offset-4">
            Clear search and filter
          </Link>
        </div>
      ) : (
        <>
          {/* Phones and tablets: stacked blocks, never a sideways-scrolling table. */}
          <ul className="divide-y divide-border overflow-hidden rounded-lg border bg-card lg:hidden">
            {rows.map((a) => (
              <li key={a.account_id}>
                <Link href={detail(a.account_id)} className="block space-y-1 px-4 py-3 hover:bg-secondary">
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 truncate font-semibold">{a.company_name ?? a.account_id}</span>
                    <ScoreMeter score={a.final_score} />
                    {a.priority === "true" ? <span className="text-[0.8125rem] font-semibold">Priority</span> : null}
                  </div>
                  <div className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
                    <span className="min-w-0 truncate">{a.domain}</span>
                    <span className="ml-auto shrink-0"><AccountStatus status={a.status} /></span>
                  </div>
                  <p className="tabular flex text-[0.8125rem] text-ink-3">
                    <span>
                      {a.contacts_count} {a.contacts_count === 1 ? "contact" : "contacts"}, {a.drafts_count}{" "}
                      {a.drafts_count === 1 ? "draft" : "drafts"}
                    </span>
                    <span className="ml-auto">{a.run_date ? timeAgo(a.run_date.toISOString()) : ""}</span>
                  </p>
                </Link>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-lg border bg-card lg:block">
            <table className="w-full text-[0.9375rem]">
              <thead>
                <tr className="border-b text-left text-[0.8125rem] font-medium text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Company</th>
                  <th className="px-3 py-2.5 font-medium">Score</th>
                  <th className="px-3 py-2.5 font-medium">Priority</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Enrichment</th>
                  <th className="px-3 py-2.5 font-medium">Clay</th>
                  <th className="px-3 py-2.5 font-medium">Contact search</th>
                  <th className="px-3 py-2.5 text-right font-medium">Contacts</th>
                  <th className="px-3 py-2.5 text-right font-medium">Drafts</th>
                  <th className="px-4 py-2.5 text-right font-medium">Added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((a) => (
                  <tr key={a.account_id} className="hover:bg-secondary">
                    <td className="max-w-[16rem] px-4 py-3">
                      <Link href={detail(a.account_id)} className="block font-semibold hover:underline">
                        <span className="block truncate">{a.company_name ?? a.account_id}</span>
                      </Link>
                      <span className="block truncate text-[0.8125rem] text-muted-foreground">{a.domain}</span>
                    </td>
                    <td className="px-3 py-3"><ScoreMeter score={a.final_score} /></td>
                    <td className="px-3 py-3 font-semibold">{a.priority === "true" ? "Yes" : ""}</td>
                    <td className="px-3 py-3"><AccountStatus status={a.status} /></td>
                    <td className="px-3 py-3 text-muted-foreground">{words(a.enrichment_status)}</td>
                    <td className="px-3 py-3 text-muted-foreground">{words(a.clay_status)}</td>
                    <td className="px-3 py-3 text-muted-foreground">{words(a.contact_status)}</td>
                    <td className="tabular px-3 py-3 text-right">{a.contacts_count}</td>
                    <td className="tabular px-3 py-3 text-right">{a.drafts_count}</td>
                    <td className="tabular px-4 py-3 text-right text-[0.8125rem] whitespace-nowrap text-ink-3">
                      {a.run_date ? timeAgo(a.run_date.toISOString()) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
