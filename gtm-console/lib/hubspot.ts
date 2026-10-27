// HubSpot helpers (Sprint 13). Pure functions, no DB: pages read v_crm_status and the
// "hubspot" block of config_versions, then build record links and stage labels from them.

export type HubspotKind = "company" | "contact" | "deal";

// HubSpot object type ids used in record URLs.
const TYPE_IDS: Record<HubspotKind, string> = { company: "0-2", contact: "0-1", deal: "0-3" };

export type HubspotCfg = {
  appHost: string | null;
  portalId: string | null;
  stages: Record<string, string>;
  replyStageIds: string[];
};

const text = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

// The jsonb "hubspot" block as it arrives from pg (object or null). Null when the block is missing.
export function readHubspotCfg(raw: unknown): HubspotCfg | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const h = raw as Record<string, unknown>;
  const stages: Record<string, string> = {};
  if (h.stages && typeof h.stages === "object" && !Array.isArray(h.stages)) {
    for (const [k, v] of Object.entries(h.stages)) if (typeof v === "string") stages[k] = v;
  }
  return {
    appHost: text(h.app_host),
    portalId: text(h.portal_id),
    stages,
    replyStageIds: Array.isArray(h.reply_stage_ids) ? h.reply_stage_ids.filter((s): s is string => typeof s === "string") : [],
  };
}

// https://{appHost}/contacts/{portalId}/record/{typeId}/{id}, or null when any part is missing.
export function recordUrl(
  appHost: string | null | undefined,
  portalId: string | null | undefined,
  kind: HubspotKind,
  id: string | null | undefined,
): string | null {
  if (!appHost || !portalId || !id) return null;
  return `https://${appHost}/contacts/${encodeURIComponent(portalId)}/record/${TYPE_IDS[kind]}/${encodeURIComponent(id)}`;
}

// The config key whose value is stageId, title-cased ("meeting" -> "Meeting"); the raw id when unknown.
export function stageLabel(stages: Record<string, string> | null | undefined, stageId: string): string {
  const key = Object.entries(stages ?? {}).find(([, v]) => v === stageId)?.[0];
  if (!key) return stageId;
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
