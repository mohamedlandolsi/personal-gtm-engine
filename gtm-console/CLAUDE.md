# GTM Console: rules for Claude Code

@AGENTS.md

## What this is
Private ops console for the Personal GTM Engine. One user. Next.js 16.4 App Router, Tailwind 4,
Neon Postgres through @neondatabase/serverless (HTTP). Deployed on Vercel Hobby, region fra1.
The schema lives in ../db/schema.sql. Read it before writing any query.

## Data rules (hard)
- Never create, alter or drop tables, views or functions from app code. If a feature needs schema work, stop and give me the SQL.
- Read from: v_review_queue, v_accounts, v_sync_health, ops, digest_ops, sync_ops, config_versions, console_events, contacts.
- Write ONLY through Server Actions that call gtm_review(), gtm_veto_account(), gtm_save_config(). Never INSERT, UPDATE or DELETE directly.
- Only use the sql tagged template from lib/db.ts. Never concatenate SQL strings.
- bigint and count(*) arrive as strings: cast with ::int in SQL. timestamptz arrives as Date: convert to ISO strings before passing to Client Components.
- DB access only in Server Components and Server Actions. Never import lib/db.ts from a "use client" file.

## Auth rules (hard)
- Do not edit lib/auth-token.ts, lib/session.ts, lib/db.ts, proxy.ts, app/login/*, or the existing actions.ts files unless I ask.
- Every page, layout, Server Action and route handler that touches data calls await requireSession() first. proxy.ts is not a security boundary.
- No public API routes, no analytics, no third-party scripts.

## Next.js 16.4 rules
- Cache Components is ON. app/(console)/layout.tsx exports `instant = false`; keep it. Any new page outside (console) that reads cookies, params or searchParams also needs `export const instant = false`.
- Do not add "use cache" to anything that reads prospect data.
- params and searchParams are Promises. Check node_modules/next/dist/docs before using an API you are unsure about.

## UI rules
- Mobile first: every screen must work at 390 px wide. Approvals happen on a phone.
- shadcn/ui + Tailwind. Calm, dense ops look. Status colors: pending amber, edited blue, approved green, rejected gray, sent violet, superseded gray with strikethrough.
- Show database error strings verbatim in a toast (they are written to be readable).
- No em dashes in any UI text.

## Workflow
- Before coding, list the files you will create or change, then wait for "go".
- After every change run `npm run build` and fix all errors before saying done.
- Never print or commit secrets. .env.local stays local.
