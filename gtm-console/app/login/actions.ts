"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { createSession, destroySession } from "@/lib/session";

function samePassword(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function safeNext(value: FormDataEntryValue | null): string {
  const next = String(value ?? "/queue");
  return next.startsWith("/") && !next.startsWith("//") ? next : "/queue";
}

export async function login(formData: FormData): Promise<void> {
  const expected = process.env.DASHBOARD_PASSWORD ?? "";
  const given = String(formData.get("password") ?? "");
  if (expected.length < 12 || !samePassword(given, expected)) {
    await new Promise((r) => setTimeout(r, 800)); // slows down guessing
    redirect("/login?e=1");
  }
  await createSession();
  redirect(safeNext(formData.get("next")));
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
