# Setup

Time: about 75 minutes. Cost: $0.

## 1. Accounts and keys

| Service | What you need | Where it goes |
|---|---|---|
| Google Cloud | A service account with the Google Sheets API enabled, JSON key | n8n credential "Google Service Account" |
| Neon | A free project (database `neondb`, branch `production`) | n8n Postgres credential "Neon GTM", and `DATABASE_URL` for the console |
| Vercel | A free account linked to your GitHub | Hosts `gtm-console/` |
| Groq | API key (free tier) | `GROQ_API_KEY` env var |
| Google AI Studio | Gemini API key (free tier) | `GEMINI_API_KEY` env var |
| Tavily | API key (free credits) | n8n credential "Header Auth": name `Authorization`, value `Bearer <key>` |
| Clay (optional) | Free workspace, API key from the **API and CLI** page | n8n credential "Clay API Key" (Header Auth, name `clay-api-key`), used by Clay Meter |
| Discord | A channel webhook URL, for workflow failure alerts | n8n credential "Personal GTM Engine Discord Webhook" |

## 2. n8n

Self-hosted n8n in Docker. Add the variables from `.env.example` to the container, including `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` (the Code nodes read `$env`). Restart the container.

## 3. Neon

1. Create the project. In **SQL Editor** (database `neondb`, branch `production`) run all of `db/schema.sql`. It is safe to re-run.
2. Make Neon the system of record for drafts:

   ```sql
   update console_settings set value = 'neon' where key = 'outreach_sor';
   ```

3. **Connect**: use the connection details for the n8n Postgres credential "Neon GTM" (SSL on), and the **pooled** connection string (host contains `-pooler`) for the console's `DATABASE_URL`.

## 4. Google Sheet

1. Create a sheet, for example `personal-gtm-engine`.
2. Create the 13 tabs in [SHEET_SCHEMA.md](SHEET_SCHEMA.md) and paste each header row into A1.
3. In `clay_results` and `contact_results`, add one row under the headers with `domain = __placeholder__`, `credits_used` or `clay_credits_used = 0` and `enriched_at = 2026-01-01T00:00:00.000Z`. It keeps the read nodes from returning nothing on a fresh sheet and is ignored everywhere else.
4. In `config`: A2 `config_json`, B2 the full content of `config/config.example.json`. Before pasting, edit `outreach.sender_name` and `outreach.proof_points`, and set the `digest` block to `{"enabled": false}` (the console requires the key; the digest workflow is retired). The first sync imports this into Neon; after that, change config in the console.
5. Share the sheet with the service account email as Editor.

## 5. n8n Data Tables

Create two Data Tables with these string columns:

| Table | Columns |
|---|---|
| `seen_accounts` | `domain`, `company_name`, `first_seen_at`, `last_seen_at`, `source` |
| `seen_contacts` | `contact_key`, `account_domain`, `full_name`, `email`, `linkedin_url`, `first_seen_at`, `last_seen_at`, `source` |

## 6. Import the workflows

For each of the 8 files in `workflows/` (not `retired/`): **Workflows > Add workflow > ... > Import from File**. Then in every imported workflow:

| Node type | Fix |
|---|---|
| Google Sheets | Select your credential, pick your document (it was replaced with `YOUR_SPREADSHEET_ID`), and re-pick the tab by name |
| Postgres | Select the "Neon GTM" credential |
| Data Table | Pick the matching table (`YOUR_..._TABLE_ID` placeholders) |
| Tavily Search (Contact Finder) | Select your Header Auth credential |
| Clay Balance (Clay Meter) | Select the "Clay API Key" credential |
| Discord (Error Alerts) | Select your Discord webhook credential |
| HTTP "Fetch Website" (Engine) | Replace `you@example.com` in the User-Agent header with your contact email |

Then:

1. In **Personal GTM Engine** and **GTM Neon Sync**: **Settings > Error workflow** = `GTM Engine: Error Alerts`.
2. Publish **GTM Neon Sync** (every 15 minutes) and **GTM Engine: Error Alerts**. Every other workflow runs by hand.
3. Optional: folders `1 Core`, `2 Clay`, `3 Ops` as in [ARCHITECTURE.md](ARCHITECTURE.md).

## 7. Console

1. Vercel: **Add New > Project**, import the repo, **Root Directory** = `gtm-console`.
2. Environment variables, from `gtm-console/.env.example`:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Neon pooled connection string |
   | `DASHBOARD_PASSWORD` | 12+ characters, used only by you |
   | `SESSION_SECRET` | 32+ random characters: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |

3. Deploy. Open `/queue` in a private window: it must redirect to `/login`.
4. Local development: copy `gtm-console/.env.example` to `gtm-console/.env.local` (git ignores it), then `npm install` and `npm run dev` in `gtm-console/`.

## 8. First run and what to expect

| Step | Run | Check | Expected |
|---|---|---|---|
| 1 | GTM Neon Sync | Console **Runs > Sync** | A new row with no warnings |
| 2 | Personal GTM Engine | `ops` last row | `accounts_written` above 0, `errors_sample` empty |
| 3 | GTM Contact Finder | `YC Founders` node output, last item | `yc founders: lookups=... found_on_yc=...` |
| 4 | Personal GTM Engine | `ops` last row | `contacts_written` and `outreach_drafts_written` above 0 |
| 5 | You, in the console | **Queue** | New drafts under Review. Approve, edit or reject; send by hand; **Mark sent** |

Clay, when you use it: run `Clay Meter` before and after, run Clay tables by selection only, and keep auto-run off on both tables (Free plan: 100 Data Credits and 500 Actions a month).

## 9. Troubleshooting

| Symptom | Where to look | Usual cause |
|---|---|---|
| Nothing written | `ops.rejection_summary` | Filters too strict for your sources |
| No drafts | `Select Outreach Pairs` output, stats item | Daily cap reached, contact score below `min_contact_score`, or account not `contacts_done` |
| Every draft says `provider=template` | `risk_notes`, `llm_errors` part | Missing key (`key_missing`), wrong model name (`http_404`), or rate limits (`429_cooldown`) |
| Drafts in n8n but not in the console | Engine draft node output, Neon `outreach_queue` | `outreach_sor` still `sheets`, or the "Neon GTM" credential missing |
| Console vetoes or config not in the Sheet | Console **Runs > Sync**, `v_sync_health.pending_push` | `GTM Neon Sync` not published, or n8n not running |
| Console config save fails with `digest: ...` | Config JSON | The `digest` key was removed; set it to `{"enabled": false}` |
| `Referenced node doesn't exist` | Error message | A node was renamed. Code nodes read other nodes by exact name. |

## 10. Exporting your own changes

Export the workflows into an `exports/` folder (ignored by git), then:

```bash
python3 scripts/sanitize_workflows.py exports/*.json --out workflows/
```

The script replaces sheet IDs, Data Table IDs, credential IDs and emails, and refuses to write anything if it finds an API key, bearer token or Discord webhook URL.
