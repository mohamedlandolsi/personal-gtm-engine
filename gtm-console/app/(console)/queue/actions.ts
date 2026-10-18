"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/session";

const Edits = z
  .object({
    email_subject: z.string().max(160),
    message_draft: z.string().min(20).max(2500),
    follow_up_1: z.string().max(1200),
    follow_up_2: z.string().max(1200),
    follow_up_3: z.string().max(1200),
    linkedin_note: z.string().max(300),
    notes: z.string().max(2000),
  })
  .partial()
  .strict();

const ReviewInput = z.object({
  id: z.string().min(3).max(200),
  action: z.enum(["approve", "reject", "reopen", "save_edits", "mark_sent", "redraft"]),
  edits: Edits.default({}),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

// All rules (allowed transitions, re-approval after edits, audit log) live in gtm_review() in Postgres.
export async function review(input: z.input<typeof ReviewInput>): Promise<ActionResult> {
  await requireSession();
  const parsed = ReviewInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const { id, action, edits } = parsed.data;
  try {
    await sql`select gtm_review(${id}, ${action}, ${JSON.stringify(edits)}::jsonb, 'console')`;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "db_error" };
  }
  revalidatePath("/queue");
  revalidatePath(`/queue/${encodeURIComponent(id)}`);
  return { ok: true };
}
