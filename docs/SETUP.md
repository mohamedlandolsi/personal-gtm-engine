# Setup

Time: about 45 minutes. Cost: $0.

## 1. Accounts and keys

| Service | What you need | Where it goes |
|---|---|---|
| Google Cloud | A service account with the Google Sheets API enabled, JSON key | n8n credential "Google Service Account" |
| Groq | API key (free tier) | `GROQ_API_KEY` env var |
| Google AI Studio | Gemini API key (free tier) | `GEMINI_API_KEY` env var |
| Tavily | API key (free credits) | n8n credential "Header Auth": name `Authorization`, value `Bearer <key>` |
| Discord | A channel webhook URL | `DISCORD_DIGEST_WEBHOOK_URL` env var |
| Clay (optional) | Free workspace | Used by hand, no key in n8n |

## 2. n8n

Self-hosted n8n in Docker. Add the variables from `.env.example` to the container, including `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` (the Code nodes read `$env`). Restart the container.

## 3. Google Sheet

1. Create a sheet, for example `personal-gtm-engine`.
2. Create every tab in [SHEET_SCHEMA.md](SHEET_SCHEMA.md) and paste its header row into A1.
3. In `clay_results` and `contact_results`, add one row under the headers with `domain = __placeholder__`, `credits_used` or `clay_credits_used = 0` and `enriched_at = 2026-01-01T00:00:00.000Z`. It keeps the read nodes from returning nothing on a fresh sheet and is ignored everywhere else.
4. In `config`: A1 `key`, B1 `value`, A2 `config_json`, B2 the full content of `config/config.example.json`.
5. Edit in that JSON: `outreach.sender_name`, `outreach.proof_points`, `digest.sheet_url` (your sheet URL) and `digest.outreach_gid` (the number after `gid=` when the `outreach_queue` tab is open).
6. Share the sheet with the service account email as Editor.

## 4. n8n Data Tables

Create three Data Tables with these string columns:

| Table | Columns |
|---|---|
| `seen_accounts` | `domain`, `company_name`, `first_seen_at`, `last_seen_at`, `source` |
| `seen_contacts` | `contact_key`, `account_domain`, `full_name`, `email`, `linkedin_url`, `first_seen_at`, `last_seen_at`, `source` |
| `digest_log` | `digest_key`, `outreach_id`, `status`, `announced_at` |

## 5. Import the workflows

For each file in `workflows/`: **Workflows > Add workflow > ... > Import from File**. Then in every imported workflow:

| Node type | Fix |
|---|---|
| Google Sheets | Select your credential, pick your document (it was replaced with `YOUR_SPREADSHEET_ID`), and re-pick the tab by name |
| Data Table | Pick the matching table (`YOUR_..._TABLE_ID` placeholders) |
| Tavily Search (Contact Finder) | Select your Header Auth credential |
| HTTP "Fetch Website" (Engine) | Replace `you@example.com` in the User-Agent header with your contact email |

Save each workflow.

## 6. First run and what to expect

| Step | Run | Check | Expected |
|---|---|---|---|
| 1 | Personal GTM Engine | `ops` last row | `accounts_written` above 0, `errors_sample` empty |
| 2 | GTM Contact Finder | `YC Founders` node output, last item | `yc founders: lookups=... found_on_yc=...` |
| 3 | Personal GTM Engine | `ops` last row | `contacts_written` and `outreach_drafts_written` above 0 |
| 4 | Personal GTM Digest | Discord | One card per new draft |
| 5 | You | `outreach_queue.approval_status` | `approved` or `rejected` per draft, then send by hand |

## 7. Troubleshooting

| Symptom | Where to look | Usual cause |
|---|---|---|
| Nothing written | `ops.rejection_summary` | Filters too strict for your sources |
| No drafts | `Select Outreach Pairs` output, stats item | Daily cap reached, contact score below `min_contact_score`, or account not `contacts_done` |
| Every draft says `provider=template` | `risk_notes`, `llm_errors` part | Missing key (`key_missing`), wrong model name (`http_404`), or rate limits (`429_cooldown`) |
| Discord shows nothing | `digest_ops.discord_status` | Webhook variable missing, or nothing new since the last digest |
| `Referenced node doesn't exist` | Error message | A node was renamed. Code nodes read other nodes by exact name. |

## 8. Exporting your own changes

Export the workflows into an `exports/` folder (ignored by git), then:

```bash
python3 scripts/sanitize_workflows.py exports/*.json --out workflows/
```

The script replaces sheet IDs, Data Table IDs, credential IDs and emails, and refuses to write anything if it finds an API key, bearer token or Discord webhook URL.
