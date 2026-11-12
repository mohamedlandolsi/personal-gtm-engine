// Pure formatting helpers. Safe to import from Server and Client Components.

// 42 -> "just now", 300 -> "5 min ago", 7200 -> "2 h ago", 172800 -> "2 d ago"
export function formatAge(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "unknown";
  return formatAge((Date.now() - t) / 1000);
}

// "icp=80; budget=95; timezone=100" -> [{ key: "icp", value: 80 }, ...]. Malformed parts are skipped.
export function parseBreakdown(text: string | null): { key: string; value: number }[] {
  if (!text) return [];
  return text
    .split(";")
    .map((part) => part.split("="))
    .filter((kv) => kv.length === 2 && kv[0].trim() !== "" && Number.isFinite(Number(kv[1].trim())))
    .map(([k, v]) => ({ key: k.trim(), value: Number(v.trim()) }));
}

// Human labels for score_breakdown keys; unknown keys show as-is.
export const FACTOR_LABELS: Record<string, string> = {
  icp: "ICP fit",
  budget: "Budget signal",
  automation: "Automation need",
  timezone: "Timezone",
  feasibility: "Reachability",
};

// Only render links that are plain web URLs (data comes from scrapers and Sheets).
export function httpUrl(value: string | null): string | null {
  return value && /^https?:\/\//i.test(value) ? value : null;
}

// One display state per draft: a send outcome wins over approval. Bounced shows as rejected-gray.
// needs_redraft (Sprint 14): a template or invalid draft, parked outside the review tab.
export type DisplayState = "pending" | "edited" | "approved" | "rejected" | "sent" | "superseded" | "needs_redraft";

export function displayState(approval_status: string, send_status: string): DisplayState {
  if (send_status === "sent") return "sent";
  if (send_status === "bounced") return "rejected";
  switch (approval_status) {
    case "pending":
    case "edited":
    case "approved":
    case "rejected":
    case "superseded":
    case "needs_redraft":
      return approval_status;
    default:
      return "pending";
  }
}

// Text + tint classes for a draft's state (gtm-console-ui StatusChip).
export const STATE_CLASSES: Record<DisplayState, string> = {
  pending: "text-state-pending bg-state-pending-tint",
  edited: "text-state-edited bg-state-edited-tint",
  approved: "text-state-approved bg-state-approved-tint",
  rejected: "text-state-rejected bg-state-rejected-tint",
  sent: "text-state-sent bg-state-sent-tint",
  superseded: "text-state-superseded line-through",
  needs_redraft: "text-state-redraft bg-state-redraft-tint",
};

// Left state rule for rows and the message sheet.
export const STATE_RULE: Record<DisplayState, string> = {
  pending: "border-l-state-pending",
  edited: "border-l-state-edited",
  approved: "border-l-state-approved",
  rejected: "border-l-state-rejected",
  sent: "border-l-state-sent",
  superseded: "border-l-state-superseded",
  needs_redraft: "border-l-state-redraft",
};

// Sprint 14: machine labels in words ("demo_brief" -> "demo brief"). Free text is left alone.
export function idWords(value: string | null): string | null {
  if (!value) return null;
  return /^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(value) ? value.replace(/_/g, " ") : value;
}

// Reject scopes (gtm_reject) as the reject dialog words them.
export const REJECT_SCOPE_LABELS: Record<string, string> = {
  contact: "Wrong person",
  pitch: "Weak email, company OK",
  account: "Bad company",
};

// v_accounts.block_reason (v_outreach_blocks) in words.
export const BLOCK_REASON_LABELS: Record<string, string> = {
  account_vetoed: "vetoed",
  draft_rejected_account: "draft rejected (account)",
  draft_rejected_pitch: "waiting for a new trigger",
};

export function blockLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return `Blocked: ${BLOCK_REASON_LABELS[reason] ?? reason.replace(/_/g, " ")}`;
}

// Gate rows (Sprint 14) are written by the engine without an LLM call: llm_provider = "gate:<name>".
export function gateName(llm_provider: string | null | undefined): string | null {
  return llm_provider && llm_provider.startsWith("gate:") ? llm_provider.slice(5).replace(/_/g, " ") : null;
}

export function statusTone(approval_status: string, send_status: string): string {
  return STATE_CLASSES[displayState(approval_status, send_status)];
}
