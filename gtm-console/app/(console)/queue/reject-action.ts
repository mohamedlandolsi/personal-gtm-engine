"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/session";
import type { ActionResult } from "./actions";

// Sprint 14: reject with a scope. It sits next to actions.ts instead of inside it, because actions.ts is one of
// the hand-written files that scripts/s10_extract_console_files.mjs --check keeps byte-identical to the Sprint 10 guide.
// All rules (allowed transitions, the veto for scope "account", both audit rows) live in gtm_reject() in Postgres.
const RejectInput = z.object({
  id: z.string().min(3).max(200),
  scope: z.enum(["contact", "pitch", "account"]),
  reason: z.string().max(500).optional(),
});

export async function rejectDraft(input: z.input<typeof RejectInput>): Promise<ActionResult> {
  await requireSession();
  const parsed = RejectInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const { id, scope, reason } = parsed.data;
  try {
    await sql`select gtm_reject(${id}, ${scope}, ${reason ?? null}, 'console')`;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "db_error" };
  }
  revalidatePath("/queue");
  revalidatePath(`/queue/${encodeURIComponent(id)}`);
  revalidatePath("/accounts");
  return { ok: true };
}
