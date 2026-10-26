# Data model

Three stores, each with one job:

| Store | Holds | Owner |
|---|---|---|
| Google Sheet (13 tabs) | Accounts, contacts, work queues, Clay hand-offs, telemetry | The n8n workflows |
| Neon Postgres (`db/schema.sql`) | Drafts (`outreach_queue`), config (`config_versions`), console audit log, mirrors of accounts, contacts and ops | The console and `GTM Neon Sync` |
| n8n Data Tables (2) | Dedupe ledgers | The engine |

Neon owns `outreach_queue` and `config_versions`; the console writes only through `gtm_review`, `gtm_veto_account` and `gtm_save_config`. Console vetoes, re-drafts and config changes reach the Sheet on the next `GTM Neon Sync` run (every 15 minutes). Accounts, contacts and ops flow the other way, from the Sheet into Neon, through `gtm_sync_pull()`.

## Tabs at a glance

| Tab | Written by | Read by |
|---|---|---|
| `config` | Neon Sync (pushes the console config) | Neon Sync (drift check) |
| `seed_accounts` | You | Engine `Fetch Seeds` |
| `accounts` | Engine (1 append, 5 updates), GTM Clay Bridge (`clay_trigger*`), Neon Sync (console vetoes) | Engine, Contact Finder, Clay Email Queue, GTM Clay Bridge, Neon Sync |
| `contacts_queue` | Engine | Contact Finder |
| `contact_results` | Contact Finder, you (`provider = hitl_manual`) | Engine |
| `contacts` | Engine, Clay Email Import, Neon Sync (re-drafts) | Engine, Clay Email Queue, Clay Email Import, Neon Sync |
| `clay_queue` | Engine, GTM Clay Bridge (`clay_status`) | Clay table `Accounts v2` (source) |
| `clay_export_accounts` | You (CSV import from `Accounts v2`) | GTM Clay Bridge |
| `clay_results` | GTM Clay Bridge | Engine `Fetch Clay Results` |
| `clay_contacts_queue` | Clay Email Queue, Clay Email Import (`clay_status`) | Clay table `Contacts Email` (source), Clay Email Queue |
| `clay_export_contacts` | You (CSV import from `Contacts Email`) | Clay Email Import |
| `ops` | Engine | Neon Sync (to Neon `ops`, console Runs page) |
| `clay_ops` | Clay Meter | You (cost evidence) |

Do not delete Sheet columns: the append nodes use Map Automatically, which re-creates a missing column on the next run. Hide a column instead; n8n still reads hidden columns.

## Status values

| Field | Values |
|---|---|
| `outreach_queue.approval_status` (Neon) | `pending` (new draft), `approved`, `edited` (must be re-approved), `rejected`, `superseded` (frees the contact for a re-draft) |
| `outreach_queue.send_status` (Neon) | `not_sent`, `sent` (set with **Mark sent** in the console, approved drafts only), `bounced` |
| `accounts.status` | `new`, `contact_found`, `contacts_none`, `rejected` (set by you, or by a console veto) |
| `contacts.status` | `new`, `used_in_outreach`, `rejected` |
| `contact_results.provider` | `yc_directory`, `tavily_search`, `tavily_unverified`, `hitl_manual` |
| `clay_contacts_queue.mode` | `find` (no email yet), `verify` (validate a guessed email) |

## Sheet tabs

Create the tabs with exactly these names and header rows (row 1). The headers are tab-separated, so you can paste each line straight into cell A1.

### `config`

Written by: Neon Sync (pushes the console config). Read by: Neon Sync (drift check). Mirror and readable backup of the active config. The console owns config in Neon (`config_versions`); n8n reads it through the `n8n_config_sheet` view. Seed `config!B2` once with `config/config.example.json` on a fresh install.

```text
key	value	type	description	updated_at
```

### `seed_accounts`

Written by: You. Read by: Engine `Fetch Seeds`. Hand-picked target companies, read every engine run.

```text
company_name	domain	website	industry	company_type	employee_count	location_raw	country	timezone_utc_offset	funding_stage	description	notes	status
```

### `accounts`

Written by: Engine (1 append, 5 updates), GTM Clay Bridge (`clay_trigger*`), Neon Sync (console vetoes). Read by: Engine, Contact Finder, Clay Email Queue, GTM Clay Bridge, Neon Sync. One row per company that passed the hard filters. `status = rejected` stops all further work on it.

```text
run_date	source	account_id	company_name	domain	website	industry	company_type	employee_count	location_raw	country	timezone_utc_offset	funding_stage	final_score	priority	why_match	red_flags	score_breakdown	confidence	status	linkedin_url	tech_stack	funding_proxy_score	automation_need_score	enrichment_status	clay_summary	clay_status	clay_enriched_at	contact_feasibility_score	contact_status	clay_trigger	clay_trigger_source	clay_trigger_date
```

### `contacts_queue`

Written by: Engine. Read by: Contact Finder. Accounts that need people.

```text
queued_at	account_id	domain	company_name	website	linkedin_url	employee_count	target_roles	contact_status
```

### `contact_results`

Written by: Contact Finder, you (`provider = hitl_manual`). Read by: Engine. A `NO_RESULT` row stops the domain being searched again. Keep the `__placeholder__` row.

```text
domain	account_id	full_name	title	email	email_status	person_linkedin	provider	credits_used	enriched_at
```

### `contacts`

Written by: Engine, Clay Email Import, Neon Sync (re-drafts). Read by: Engine, Clay Email Queue, Clay Email Import, Neon Sync. Scored people. `status = rejected` means never draft them.

```text
run_date	contact_id	account_id	company_name	domain	full_name	title	role_category	email	email_status	linkedin_url	phone	source	confidence	contact_score	preferred_channel	status	contact_key	account_domain
```

### `clay_queue`

Written by: Engine, GTM Clay Bridge (`clay_status`). Read by: Clay table `Accounts v2` (source). Accounts handed to Clay. Never rename: Clay reads it by name.

```text
queued_at	account_id	domain	company_name	website	linkedin_url	final_score	tech_stack_n8n	clay_status
```

### `clay_export_accounts`

Written by: You (CSV import from `Accounts v2`). Read by: GTM Clay Bridge. Raw Clay CSV headers, replaced on every import. Export from the Default view with the Bridge's columns visible.

No fixed header row: Clay's CSV headers land here as exported.

### `clay_results`

Written by: GTM Clay Bridge. Read by: Engine `Fetch Clay Results`. Merged into `accounts` on the next engine run. Keep the `__placeholder__` row.

```text
domain	company_name	linkedin_url	employee_count_clay	tech_stack_clay	funding_stage_clay	claygent_summary	clay_credits_used	enriched_at	gtm_signal	evidence_url	clay_model
```

### `clay_contacts_queue`

Written by: Clay Email Queue, Clay Email Import (`clay_status`). Read by: Clay table `Contacts Email` (source), Clay Email Queue. Contacts handed to the Clay email waterfall (`mode` = `find` or `verify`). Never rename.

```text
queued_at	contact_id	account_id	domain	company_name	full_name	first_name	last_name	title	linkedin_url	current_email	current_email_status	contact_score	mode	clay_status
```

### `clay_export_contacts`

Written by: You (CSV import from `Contacts Email`). Read by: Clay Email Import. Raw Clay CSV headers, replaced on every import.

No fixed header row: Clay's CSV headers land here as exported.

### `ops`

Written by: Engine. Read by: Neon Sync (to Neon `ops`, console Runs page). One telemetry row per engine run. Read this before debugging.

```text
run_at	config_rev	source	seed_rows	seen_rows_pre	after_filters	accounts_written	min_account_score	warnings	errors_sample	rejection_summary	apollo_companies	source_errors	enriched_rows	enrich_errors	clay_queued	clay_merged	contacts_discovered	contacts_written	outreach_drafts_written	llm_calls	llm_failures
```

### `clay_ops`

Written by: Clay Meter. Read by: You (cost evidence). Clay credit balance before and after each Clay run.

```text
ts	label	module	data_credits	actions	note
```

## n8n Data Tables

| Table | Columns | Written by | Purpose |
|---|---|---|---|
| `seen_accounts` | `domain`, `company_name`, `first_seen_at`, `last_seen_at`, `source` | Engine | A domain is processed once, ever |
| `seen_contacts` | `contact_key`, `account_domain`, `full_name`, `email`, `linkedin_url`, `first_seen_at`, `last_seen_at`, `source` | Engine | A person is added once, ever |
