import { ExternalLink } from "lucide-react";
import { type HubspotCfg, type HubspotKind, recordUrl, stageLabel } from "@/lib/hubspot";
import { cn } from "@/lib/utils";

// "HubSpot" fact (Sprint 13): where this draft stands in the CRM, from one v_crm_status row.
// Renders a dt/dd pair, so it sits inside the same <dl> as the other facts, like ClayTriggerFact.
// The stage chip is neutral provenance; a reply stage gets green text so a reply shows at a glance.

export type CrmRow = {
  company_hs_id: string | null;
  contact_hs_id: string | null;
  deal_hs_id: string | null;
  deal_stage: string | null;
  last_error: string | null;
};

const LINKS: { kind: HubspotKind; label: string; key: keyof CrmRow }[] = [
  { kind: "company", label: "Company", key: "company_hs_id" },
  { kind: "contact", label: "Contact", key: "contact_hs_id" },
  { kind: "deal", label: "Deal", key: "deal_hs_id" },
];

export function StageChip({ stage, cfg }: { stage: string; cfg: HubspotCfg | null }) {
  const replied = cfg?.replyStageIds.includes(stage) ?? false;
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded bg-secondary px-2 text-[0.8125rem] font-medium",
        replied ? "text-state-approved" : "text-foreground",
      )}
    >
      {stageLabel(cfg?.stages, stage)}
    </span>
  );
}

export function HubspotLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center gap-1 font-medium underline underline-offset-4 sm:min-h-0"
    >
      {children}
      <ExternalLink className="size-3.5" aria-hidden />
    </a>
  );
}

export function CrmStatus({ inScope, row, cfg }: { inScope: boolean; row: CrmRow | null; cfg: HubspotCfg | null }) {
  let body: React.ReactNode;
  if (!inScope) {
    body = <span className="text-muted-foreground">Not in HubSpot. Syncs after approval.</span>;
  } else {
    const links = LINKS.map((l) => ({ ...l, href: recordUrl(cfg?.appHost, cfg?.portalId, l.kind, row?.[l.key]) })).filter(
      (l): l is typeof l & { href: string } => l.href !== null,
    );
    body = (
      <>
        {!row?.company_hs_id ? <span className="text-muted-foreground">Queued for HubSpot</span> : null}
        {links.map((l) => (
          <HubspotLink key={l.kind} href={l.href}>
            {l.label}
          </HubspotLink>
        ))}
        {row?.deal_stage ? <StageChip stage={row.deal_stage} cfg={cfg} /> : null}
        {row?.last_error ? (
          <span className="basis-full text-[0.8125rem] whitespace-pre-wrap wrap-anywhere text-danger">{row.last_error}</span>
        ) : null}
      </>
    );
  }
  return (
    <div className="space-y-0.5">
      <dt className="text-[0.8125rem] font-medium text-muted-foreground">HubSpot</dt>
      <dd className="flex flex-wrap items-center gap-x-3 gap-y-1">{body}</dd>
    </div>
  );
}
