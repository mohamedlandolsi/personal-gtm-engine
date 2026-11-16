# Sprint 15 run report

Covers Phases 0 to 7, built on 2026-11-15 and 2026-11-16 on `main` (local commits, not pushed).
Nothing was published or unpublished in n8n, and no production-mode execution was made. Every n8n run below is a
manual test run (`test_workflow`) with pinned data for Sheets, Postgres and credentialed nodes. The HTTP fetches of the
expert directories and the LLM calls in those runs were real.

## 1. Production state after the sprint (Neon, read 2026-11-16 09:15 UTC)

| Table | Value | Meaning |
|---|---|---|
| `accounts` | 120 `smb_direct`, 0 `agency_partner` | Agency accounts arrive with the first real `GTM Run` |
| `outreach_queue` | 90 `smb_direct`, 0 agency, 0 gig | Same |
| `gig_posts`, `gig_ops` | 0 rows each | The Gig Finder has not run against production yet |
| `sync_ops` last run | 2026-11-16 09:00 UTC | `GTM Neon Sync` keeps running on its published version |
| n8n Data Tables | `seen_directory_profiles` 0 rows, `seen_accounts` unchanged since 2026-11-12 | The test runs did not mark any profile as seen, so the first real run fetches them |

Schema: `db/s15_lead_tracks.sql` and `db/s15_hubspot.sql` are live (applied twice, no-op on the second run).
Config: rev `console-20261115-1301` holds the S15 keys at the plan defaults (D1 to D7) with the two pilot caps.
HubSpot: `gtm_lead_track` exists on companies and deals.

## 2. Per source

| Source | Run | Result |
|---|---|---|
| Clay experts directory | Engine exec 805, live fetch | Listing read, profiles parsed from `__NUXT_DATA__` |
| n8n experts directory | Engine exec 805, live fetch | Same. The first attempt (exec 804) got HTTP 406 for `Accept: text/html`; fixed with a browser-style Accept header |
| Both directories together | Exec 805, `max_profiles_per_run` = 10 | `pages=2 listed=58 seen=0 tier_out=7 fetched=10 no_site=0 errors=0 returned=10`, 30 s with 1.5 s politeness |
| Forum mail | Gig Finder exec 799 | `no mail read (Read Forum Mail disabled, no credential, or no new mail)`: expected until the Gmail credential exists. Posts came from pinned fixtures |
| Manual add (console) | Exec 799, pinned `Load Manual Gigs` | 1 manual post read, gated, scored and drafted like a forum post |
| HN freelancer | Exec 799 | `disabled by config` (Phase 0: 0 hiring posts in 4 months) |
| Make (directory, forum) | Not built | No-go in Phase 0; D2 keeps it off |

## 3. Gate counters

### Gig Finder, exec 799 (`gig_ops` row from `Gig Run Stats`)

| fetched | intent_for_hire | intent_unclear | stale | crowded | vetoed | stack_miss | budget_low | already_seen | scored | drafted | pinged | expired |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 3 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 2 | 1 | 0 |

| Post | Status | Score | Breakdown |
|---|---|---|---|
| n8n forum: HubSpot deals into Google Sheets | drafted, pending | 96 | stack=100 intent=100 fresh=100 comp=70 budget=100 remote=100 bonus=0 |
| Manual: Clay table and HubSpot import (agency) | drafted, pending | 87 | stack=75 intent=100 fresh=80 comp=70 budget=50 remote=60 bonus=10 |
| n8n forum: `[FOR HIRE]` n8n expert | gated_out, `intent_for_hire` | none | never drafted |

`comp=70` is the "replies unknown" value: mailed posts carry no reply count (ADR-119).

### Engine, exec 805 (`Process Accounts` and `Run Stats`)

| Stage | Count |
|---|---|
| Profiles listed / dropped by tier (`exclude_tiers`) / fetched | 58 / 7 / 10 |
| Dropped by `agency_pricing` (`10k-a-month`) | 3 |
| Agency accounts written | 7 (plus 1 pinned SMB seed row) |
| `rejection_summary` | `agency_pricing:3` |

| Agency | Directory, tier | Score | Breakdown |
|---|---|---|---|
| Data4Prime Srl | n8n, Premium | 88 | stack=100 capacity=60 size=90 tz_lang=100 |
| Saleslift Studio | Clay, Studio | 83 | stack=100 capacity=40 size=90 tz_lang=100 |
| OneThousandPieces | Clay, Studio | 83 | stack=100 capacity=40 size=90 tz_lang=100 |
| FastRocket GmbH | n8n, Premium | 75 | stack=75 capacity=60 size=70 tz_lang=100 |
| Avanai | n8n, Premium | 71 | stack=50 capacity=60 size=90 tz_lang=100 |
| SVA System Vertrieb Alexander GmbH | n8n, Premium | 67 | stack=50 capacity=60 size=70 tz_lang=100 |
| Exxeta | n8n, Premium | 67 | stack=50 capacity=60 size=70 tz_lang=100 |

Observation: the last three profiles say "Enterprise focused" and list project budgets from 5,000 USD up. Directory
profiles carry no head count, so they pass the 25-person rule as "unknown size". If the first real run shows more
of these, add a rule on `company_focus` (Enterprise focused) or on the smallest n8n budget band. This is a
config or code decision for later, not changed in this sprint.

## 4. Drafts per track

| Track | Where tested | Drafts | Status |
|---|---|---|---|
| `gig_post` | Exec 799, real Groq calls | 2 | 2 `pending`, 0 `needs_redraft`, 2 LLM calls, 0 failures, 1 above the ping threshold (75) |
| `agency_partner` | `scripts/s15/engine/test_engine_nodes.mjs` (offline, stubbed LLM) | angle cases for `hire_bridge`, `stack_specific_help`, `white_label_overflow` | `pending` after one repair; a draft with no named service and no small first task goes to `needs_redraft` (validator v3) |
| `smb_direct` | Same test, S14 fixtures | Unchanged | Identical to the S14 bodies on every patched node (track keys aside) |

Exec 805 drafted nothing: enrichment and drafting were off in that pinned run (`enrichment disabled by config`), so
it proves discovery, filters and scoring only. The first agency drafts with a real LLM come from the first `GTM Run`.

## 5. Test suites (2026-11-16, all on the final files)

| Suite | Checks | Result |
|---|---|---|
| `node scripts/s13_sql_test.mjs` (PGlite, full `db/schema.sql`) | 29 | All passed |
| `node scripts/s14_sql_test.mjs` (PGlite, schema up to the S15 marker) | 19 | All passed |
| `node scripts/s15_sql_test.mjs` (PGlite; both S15 migrations applied twice) | 44 | All passed. Earlier also run with `--neon` on branch `s15-test` |
| `node scripts/s15/gig/test_gig_nodes.mjs` | 29 | All passed |
| `node scripts/s15/engine/test_engine_nodes.mjs` | 35 | All passed (S14 baselines from `scripts/s14` plus `scripts/s15/engine/s14_baseline`) |
| `node scripts/s10_extract_console_files.mjs --check --guide "../../Sprints/Sprint 10 - Ops Console  Neon Guide.md"` | | All hand-written files match the guide |
| `npm run build` in `gtm-console` (Phase 5) | | Passed |
| Live node bodies vs repo files (docker export, Phases 3 and 4) | Every Code node | Byte for byte equal |

## 6. Acceptance per phase

| Phase | Criterion | Result |
|---|---|---|
| 0 | Go or no-go per source, fixtures, field map | Done (`SPIKE.md`). Gig source decision A + B |
| 1 | Migration idempotent; insert, upsert, expire, mark sent tested | Yes, offline and on `s15-test`; production applied twice with unchanged row counts |
| 2 | Config keys through `gtm_save_config()` | Yes, rev `console-20261115-1301`; `config/config.example.json` updated |
| 3 | Re-run writes 0 new posts and 0 new drafts | Yes on `s15-test`: the second upsert adds 0 rows, the draft select excludes posts with an open draft |
| 3 | `gig_ops` shows every gate counter; `[FOR HIRE]` gated | Yes (section 3) |
| 3 | 2 drafts visible in the console with post link and age | Seen in `v_review_queue` on `s15-test`; the console UI was not opened (needs your login) |
| 4 | No `gate:product_overlap` on agency rows; one agency draft `pending` under validator v3 | Yes in the offline node test; not yet in a live run |
| 4 | SMB drafts unchanged | Yes, S14 fixture diff identical |
| 4 | Re-run writes 0 duplicates | By construction (`seen_directory_profiles`, `seen_accounts`); not yet seen in a live re-run |
| 5 | Build passes; writes only through Postgres functions | Yes; Vercel preview on your phone still to do |
| 6 | One agency account approved, synced, property set; second sync writes nothing | Not run: no agency account exists in production yet. Outbox carries `gtm_lead_track` in the SQL test |
| 7 | `GTM Run` calls the Gig Finder first; docs; schema close-out | Yes |

## 7. Before the first real run (your steps)

1. **Publish `GTM Neon Sync` first.** The published version does not send `lead_track`, and `gtm_sync_pull()` turns a
   missing value into `smb_direct`, so every 15-minute run of the old version would reset agency accounts in Neon to
   `smb_direct` (the Sheet stays right). Publish it before the first `GTM Run`.
2. Optional: publish `GTM Gig Finder` for its 3-hour schedule (D7), and set its **Settings > Error workflow** to
   `GTM Engine: Error Alerts`.
3. Gig mail: Gmail OAuth2 credential, enable `Read Forum Mail`, forum Jobs category on Watching First Post, Gmail
   filter with label `gtm-gigs` (`docs/SETUP.md`, section 8, Sprint 15).
4. Run `GTM Run` by hand. Check console **Runs > Gigs**, `ops.rejection_summary`, and the Agency and Gig chips on Queue.
5. After a clean run, raise the pilot caps: `gig.max_drafts_per_run` 2 to 6, `sources.partner_directories.max_profiles_per_run` 10 to 40.
6. Phase 6 check: approve one agency draft, let `GTM HubSpot Sync` run, confirm `gtm_lead_track = agency_partner` on the company and deal, run again and confirm it writes nothing.
7. Push with your SSH key (this also deploys the console), then check the Gigs page on your phone.
8. Clean-up when done: delete Neon branch `s15-test` (keep `pre-s15` until you trust the release), and reset the
   `neondb_owner` password if you want (it appeared in session commands; update n8n and Vercel after).
