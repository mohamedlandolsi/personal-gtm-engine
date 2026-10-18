"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/session";
import type { ActionResult } from "../queue/actions";

// Guardrails on the keys that control spend and volume. Everything else passes through untouched.
const ConfigShape = z
  .object({
    rev: z.string().min(3),
    enabled: z.boolean(),
    outreach: z
      .object({
        enabled: z.boolean(),
        max_per_day: z.number().int().min(0).max(10),
        max_pairs_per_run: z.number().int().min(0).max(10),
        min_account_score: z.number().min(0).max(100),
        min_contact_score: z.number().min(0).max(100),
      })
      .passthrough(),
    digest: z.object({ enabled: z.boolean() }).passthrough(),
  })
  .passthrough();

export async function saveConfig(payloadText: string, note?: string): Promise<ActionResult> {
  await requireSession();
  let json: unknown;
  try {
    json = JSON.parse(payloadText);
  } catch {
    return { ok: false, error: "invalid_json" };
  }
  const shape = ConfigShape.safeParse(json);
  if (!shape.success) {
    const first = shape.error.issues[0];
    return { ok: false, error: `${first.path.join(".") || "config"}: ${first.message}` };
  }
  try {
    await sql`select gtm_save_config(${payloadText}, ${note ?? null}, 'console')`;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "db_error" };
  }
  revalidatePath("/config");
  return { ok: true };
}
