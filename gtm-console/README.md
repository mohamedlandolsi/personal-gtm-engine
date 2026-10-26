# GTM Console

Private review console for the Personal GTM Engine: Next.js 16 on Vercel, reading and writing Neon Postgres. One user, behind a password gate.

| Page | What it does |
|---|---|
| `/queue` | Drafts to review: approve, edit, reject, re-draft, **Mark sent** |
| `/accounts` | Accounts with score breakdown, Clay summary and trigger; veto an account |
| `/config` | Engine switches, daily draft cap and the full config, saved as a new version |
| `/runs` | Engine runs, sync runs and console activity |

The console writes only through three Postgres functions in `../db/schema.sql`: `gtm_review`, `gtm_veto_account` and `gtm_save_config`. Each checks the state transition and logs to `console_events`.

## Environment

Copy `.env.example` to `.env.local` (git ignores it) and fill in:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon pooled connection string (host contains `-pooler`) |
| `DASHBOARD_PASSWORD` | 12+ characters, used only by you |
| `SESSION_SECRET` | 32+ random characters |

## Run locally

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # must pass before every push
```

On Windows PowerShell, use `npm.cmd` if script execution is blocked.

## Deploy

Vercel: import the repo with **Root Directory** = `gtm-console`, set the three variables, deploy. Vercel rebuilds on every push to `main`. Check: `/queue` in a private window redirects to `/login`.

## Guarded files

The auth, session, database and server-action files must stay byte-identical to the Sprint 10 guide. From the repo root:

```bash
node scripts/s10_extract_console_files.mjs --check
```

It must print `All hand-written files match the guide`.
