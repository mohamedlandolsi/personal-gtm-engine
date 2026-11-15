"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/session";
import type { ActionResult } from "../queue/actions";

// Sprint 15: the Gigs page writes only through gtm_gig_add() and gtm_gig_status() in Postgres.
// All rules (link parsing, allowed transitions, the console_events audit row) live in those functions.

const AddInput = z.object({
  url: z.string().trim().min(8).max(500),
  title: z.string().trim().min(5).max(300),
  body: z.string().trim().min(20).max(4000),
});

export async function addGig(input: z.input<typeof AddInput>): Promise<ActionResult> {
  await requireSession();
  const parsed = AddInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const { url, title, body } = parsed.data;
  try {
    await sql`select gtm_gig_add(${url}, ${title}, ${body}, null, 'console')`;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "db_error" };
  }
  revalidatePath("/gigs");
  return { ok: true };
}

const StatusInput = z.object({
  postKey: z.string().min(3).max(200),
  status: z.enum(["replied", "won", "lost", "dismiss"]),
});

export async function setGigStatus(input: z.input<typeof StatusInput>): Promise<ActionResult> {
  await requireSession();
  const parsed = StatusInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const { postKey, status } = parsed.data;
  try {
    await sql`select gtm_gig_status(${postKey}, ${status}, 'console')`;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "db_error" };
  }
  revalidatePath("/gigs");
  revalidatePath("/queue");
  return { ok: true };
}
