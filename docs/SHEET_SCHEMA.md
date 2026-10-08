# Data model

One Google Sheet holds config, state and output. Three n8n Data Tables hold the dedupe ledgers. Create the tabs with exactly these names and header rows (row 1). Column order matters for tabs read by position, so copy the headers as they are.

## Status values

| Field | Values |
|---|---|
| `outreach_queue.approval_status` | `pending` (new draft), `approved`, `edited`, `rejected`, `superseded` (frees the contact for a redraft) |
| `outreach_queue.send_status` | `not_sent`, `sent` (you set it after sending by hand) |
| `accounts.status` | `new`, `contact_found`, `contacts_none`, `rejected` (set by you) |
| `contacts.status` | `new`, `used_in_outreach`, `rejected` (set by you) |
| `contact_results.provider` | `yc_directory`, `tavily_search`, `tavily_unverified`, `hitl_manual` |

## Sheet tabs

### `config`

Who writes: you. One row: `key = config_json`, `value` = the JSON in `config/config.example.json`.

```text
key	value
```

### `seed_accounts`

Who writes: you. Hand-picked target companies. Read every engine run.

```text
company_name	domain	website	industry	company_type	employee_count	location_raw	country	timezone_utc_offset	funding_stage	description	notes	status
```

### `accounts`

Who writes: engine. One row per company that passed the hard filters. `status = rejected` (set by you) stops all further work on it.

```text
run_date	source	account_id	company_name	domain	website	industry	company_type	employee_count	location_raw	country	timezone_utc_offset	funding_stage	final_score	priority	why_match	red_flags	score_breakdown	confidence	status	linkedin_url	tech_stack	funding_proxy_score	automation_need_score	enrichment_status	clay_summary	clay_status	clay_enriched_at	contact_feasibility_score	contact_status
```

### `clay_queue`

Who writes: engine. Accounts handed to Clay (optional, human-bridged).

```text
queued_at	account_id	domain	company_name	website	linkedin_url	final_score	tech_stack_n8n	clay_status
```

### `clay_results`

Who writes: you or Clay export. Merged back into `accounts` on the next run. Keep the `__placeholder__` row.

```text
domain	company_name	linkedin_url	employee_count_clay	tech_stack_clay	funding_stage_clay	claygent_summary	clay_credits_used	enriched_at
```

### `contacts_queue`

Who writes: engine. Accounts that need people. Read by the Contact Finder.

```text
queued_at	account_id	domain	company_name	website	linkedin_url	employee_count	target_roles	contact_status
```

### `contact_results`

Who writes: Contact Finder (or you, `provider = hitl_manual`). A `NO_RESULT` row stops the domain being searched again. Keep the `__placeholder__` row.

```text
domain	account_id	full_name	title	email	email_status	person_linkedin	provider	credits_used	enriched_at
```

### `contacts`

Who writes: engine. Scored people. `status = rejected` (set by you) means never draft them.

```text
run_date	contact_id	account_id	company_name	domain	full_name	title	role_category	email	email_status	linkedin_url	phone	source	confidence	contact_score	preferred_channel	status	contact_key	account_domain
```

### `outreach_queue`

Who writes: engine (drafts), you (`approval_status`, `send_status`, `sent_at`, `reply_received`). The ledger: a contact with a non-superseded row is never redrafted.

```text
run_date	outreach_id	account_id	contact_id	company_name	contact_name	channel	angle	trigger	pain_point	value_proposition	proof_point	cta	email_subject	first_line	message_draft	follow_up_1	follow_up_2	follow_up_3	linkedin_note	risk_notes	approval_status	send_status	sent_at	reply_received	notes	llm_provider	llm_calls	llm_failures
```

### `ops`

Who writes: engine. One telemetry row per run. Read this before debugging.

```text
run_at	config_rev	source	seed_rows	seen_rows_pre	after_filters	accounts_written	min_account_score	warnings	errors_sample	rejection_summary	apollo_companies	source_errors	enriched_rows	enrich_errors	clay_queued	clay_merged	contacts_discovered	contacts_written	outreach_drafts_written	llm_calls	llm_failures
```

### `digest_ops`

Who writes: digest. One row per digest run.

```text
run_at	config_rev	queue_rows	candidates	embedded	overflow	pending_announced	approved_announced	discord_status	error_sample
```

Tip: the headers are tab-separated above, so you can paste each line straight into cell A1.

## n8n Data Tables

| Table | Columns | Written by | Purpose |
|---|---|---|---|
| `seen_accounts` | `domain`, `company_name`, `first_seen_at`, `last_seen_at`, `source` | Engine | A domain is processed once, ever |
| `seen_contacts` | `contact_key`, `account_domain`, `full_name`, `email`, `linkedin_url`, `first_seen_at`, `last_seen_at`, `source` | Engine | A person is added once, ever |
| `digest_log` | `digest_key`, `outreach_id`, `status`, `announced_at` | Digest | A draft is posted to Discord once per status |
