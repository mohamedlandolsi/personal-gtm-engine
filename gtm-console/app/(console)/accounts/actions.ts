"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/session";
import type { ActionResult } from "../queue/actions";

const VetoInput = z.object({
  accountId: z.string().min(3).max(200),
  reason: z.string().max(300).optional(),
});

export async function vetoAccount(input: z.input<typeof VetoInput>): Promise<ActionResult> {
  await requireSession();
  const parsed = VetoInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const { accountId, reason } = parsed.data;
  try {
    await sql`select gtm_veto_account(${accountId}, ${reason ?? null}, 'console')`;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "db_error" };
  }
  revalidatePath("/accounts");
  return { ok: true };
}
