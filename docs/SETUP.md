# Setup

Time: about 75 minutes, plus about 60 for the optional HubSpot CRM (section 11). Cost: $0.

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
| HubSpot (optional) | A Free CRM account and a Service Key (section 11) | n8n credential "HubSpot Service Key" |

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

For each of the 8 core files in `workflows/` (not `retired/`, and not the 2 HubSpot files, which section 11 covers): **Workflows > Add workflow > ... > Import from File**. Then in every imported workflow:

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

## 11. HubSpot CRM (optional)

Puts every account you approve in HubSpot as a company, a contact and a deal, logs a note and a follow-up task when you mark a draft sent, and copies deal stages back so a reply you record in HubSpot shows in the console. Without this section the engine and the console work as before. Time: about 60 minutes. Cost: $0.

### 11.1 Account

1. Create a free HubSpot CRM account. Write down the **Hub ID** (account menu) and the **app host** from the browser address bar: `app.hubspot.com`, or `app-eu1.hubspot.com` on the EU data center. The console builds record links from both.
2. Settings > **Account Defaults**: set your time zone (task due dates and the daily API reset use it).
3. Delete the sample contacts and the sample company "HubSpot".
4. Settings > **Data Management > Objects > Companies**: turn off automatic company creation from contact email domains ("Create and associate companies with contacts"). It would be a second writer and create duplicates.

### 11.2 Properties

Settings > **Data Management > Properties** > **Create property**. Use a single-line text or number field, never a dropdown (dropdowns reject values outside their list). Untick "Show property in forms and chatflows".

| Object | Label | Internal name | Field type |
|---|---|---|---|
| Company | GTM Account Key | `gtm_account_key` | Single-line text, **Require unique values** ticked |
| Company | GTM Score | `gtm_score` | Number |
| Company | GTM Trigger | `gtm_trigger` | Multi-line text |
| Contact | GTM Email Status | `gtm_email_status` | Single-line text |

LinkedIn uses the built-in contact property `hs_linkedin_url`; do not create one. Tick "Require unique values" when you create `gtm_account_key`: HubSpot allows it only at creation, and a name that once existed without it can never become unique, even after a permanent delete.

### 11.3 Pipeline stages

Settings > **Data Management > Objects > Deals > Pipelines** > the default pipeline. Rename the stages; do not add or delete any. Renaming keeps the internal id, which is what the config uses.

| Old label | New label | Internal id |
|---|---|---|
| Appointment Scheduled | Approved | `appointmentscheduled` |
| Qualified To Buy | Contacted | `qualifiedtobuy` |
| Presentation Scheduled | Replied | `presentationscheduled` |
| Decision Maker Bought-In | Meeting booked | `decisionmakerboughtin` |
| Contract Sent | Proposal | `contractsent` |
| Closed Won | Won | `closedwon` |
| Closed Lost | Lost | `closedlost` |

### 11.4 Service Key and n8n credential

1. Settings > **Integrations > Service Keys** (or **Development > Keys > Service keys**) > **Create service key**, name `n8n-gtm-engine-sync`, with these scopes:

   | Scope | Why |
   |---|---|
   | `crm.objects.companies.read`, `crm.objects.companies.write` | Search, create and update companies |
   | `crm.objects.contacts.read`, `crm.objects.contacts.write` | Same for contacts |
   | `crm.objects.deals.read`, `crm.objects.deals.write` | Create deals, move and pull stages |
   | `crm.schemas.companies.read`, `crm.schemas.contacts.read`, `crm.schemas.deals.read` | Read properties and pipelines |
   | Any separate **notes** or **tasks** scopes the scope search lists | Notes and tasks on send. If none are listed, the contact and company write scopes cover them |

2. Copy the key into your password manager, not into a file or the repo.
3. n8n > **Credentials > Create credential** > **HubSpot Service Key** (older n8n versions: **HubSpot App Token**). Paste the key, name the credential exactly `HubSpot Service Key`, save. The test must say "Connection tested successfully".

### 11.5 Neon

A fresh install already has the HubSpot layer: it is the last block of `db/schema.sql`. For a database created before Sprint 13, run `db/s13_hubspot.sql` in the Neon SQL Editor (2 tables, 5 functions, 6 views, nothing existing changes, safe to re-run). It already contains patch 1; `db/s13_patch1_legal_basis.sql` only upgraded databases that ran the first version. The editor may show "Cannot read properties of undefined (reading 'map')" after a multi-statement script: it is a display bug, the statements ran.

### 11.6 Config block

Console > **Config** > editor: add this block at the top level, with your Hub ID and app host. Bump the rev and save.

```json
"hubspot": {
  "enabled": false,
  "max_per_run": 1,
  "portal_id": "YOUR_HUB_ID",
  "app_host": "app.hubspot.com",
  "pipeline_id": "default",
  "stages": {
    "approved": "appointmentscheduled",
    "contacted": "qualifiedtobuy",
    "replied": "presentationscheduled",
    "meeting": "decisionmakerboughtin",
    "proposal": "contractsent",
    "won": "closedwon",
    "lost": "closedlost"
  },
  "reply_stage_ids": ["presentationscheduled", "decisionmakerboughtin", "contractsent", "closedwon"],
  "follow_up_days": 3,
  "contact_linkedin_property": "hs_linkedin_url"
}
```

| Key | Meaning |
|---|---|
| `enabled` | Kill switch. `false` stops the sync right after it reads the config: 0 HubSpot calls. Also a switch on the console's Config page |
| `max_per_run` | Cap per outbox step per run. Start at 1, then 10 |
| `portal_id`, `app_host` | Hub ID and app host from 11.1, for the console's record links |
| `stages` | Internal stage ids from 11.3. `approved` and `contacted` are required |
| `reply_stage_ids` | A deal moved to any of these stages marks the account's sent drafts as replied |
| `follow_up_days` | Task due date after you mark a draft sent |
| `contact_linkedin_property` | Contact property for the LinkedIn URL: the built-in `hs_linkedin_url` |
| `contact_legal_basis` | Optional, not in the block above. GDPR legal basis sent on every contact; missing or empty means "Legitimate interest – prospect/lead". Must be one of HubSpot's exact option values. Needed on portals with GDPR features on (EU data center) |

### 11.7 Workflows

1. Import `workflows/hubspot_upsert_record.json` first, then `workflows/gtm_hubspot_sync.json`.
2. **HubSpot Upsert Record**: in the 4 HTTP nodes (`Update By ID`, `Search By Key`, `Create Record`, `Update Found`), select the `HubSpot Service Key` credential.
3. **GTM HubSpot Sync**: select "Neon GTM" in every Postgres node and `HubSpot Service Key` in `Search Changed Deals`. Then **re-select `HubSpot Upsert Record` in the 6 Push nodes** (`Push Companies`, `Push Contacts`, `Push Deals`, `Push Notes`, `Push Tasks`, `Push Stage Moves`): the export points at the original workflow id, which does not exist in your n8n.
4. **GTM HubSpot Sync > Settings > Error workflow** = `GTM Engine: Error Alerts`.
5. Publish both. Optional: put them in a folder `4 CRM`.

### 11.8 First run

| Step | Do | Expected |
|---|---|---|
| 1 | Run `GTM HubSpot Sync` by hand with `enabled: false` | Stops at `HubSpot Enabled`, 0 HTTP calls |
| 2 | Set `enabled: true` (config or switch), approve one draft, run by hand | Console **Runs > HubSpot**: one run with created above 0 and failed 0. The draft page shows Company, Contact and Deal links |
| 3 | Run again | created 0, updated 0: a re-run writes nothing |
| 4 | Raise `max_per_run` to 10 | The schedule (every 30 minutes) catches up the rest |

Failed rows are logged in `hubspot_events` with HubSpot's error text and shown on **Runs > HubSpot**; a row that fails 3 times stops being retried until you fix the cause. Common errors: 401 (key wrong or rotated), 403 `MISSING_SCOPES` (add the scope it names), 400 `PROPERTY_DOESNT_EXIST` (internal name differs from 11.2), 400 missing `hs_legal_basis` (GDPR portal: see `contact_legal_basis`).
