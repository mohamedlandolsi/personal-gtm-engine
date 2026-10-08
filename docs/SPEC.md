# SPEC — Personal GTM Engine  
**Project type:** Personal GTM / outbound company discovery + contact enrichment + outreach strategy  
**Owner:** Mohamed Landolsi  
**Version:** v1.0  
**Status:** Draft for build  
**Constraint:** Zero-cost, free tiers only, HITL before any outreach, no dependency on Job Radar  

---

## 1. Project mission

Build an independent Personal GTM Engine that discovers companies, startups, and agencies that may need a **GTM Automation / Integration / RevOps Engineer**, then outputs:

1. Company details: name, website, domain, location, size, industry, funding proxies, timezone fit, score, reasons, red flags.
2. Decision-maker details: name, title, email, LinkedIn, confidence, source.
3. Cold outreach strategy: angle, hook, value proposition, channel plan, first message draft, follow-up sequence.

The system must be fully configurable through a dynamic config file/sheet so filters can be changed without rewriting the workflow.

---

## 2. Core objective

The engine should find organizations that are likely to:

- Be small enough to respond to a remote contractor.
- Have enough budget or business maturity to hire external automation help.
- Have a plausible need for GTM automation, RevOps, integration, lead enrichment, CRM cleanup, workflow building, or AI-assisted sales/marketing operations.
- Be in a compatible timezone for Mohamed.
- Be reachable through public business contact data.

This is not a job application engine. It is an **outbound opportunity discovery engine**.

---

## 3. Non-goals

The system will not:

- Mass-send cold emails automatically.
- Automate LinkedIn connection requests or messages.
- Scrape private/authenticated platforms.
- Buy or use paid data providers in v1.
- Replace a full CRM.
- Guarantee funding or hiring intent.
- Send any outreach without human approval.

---

## 4. Relationship to Job Radar

This project is **separate from Job Radar**.

| System | Purpose | Object | Output |
|---|---|---|---|
| Job Radar | Find job postings matching Mohamed | Job posting | Ranked job matches |
| Personal GTM Engine | Find companies likely to need GTM automation | Company + contact + outreach plan | Target account list + decision-maker + strategy |

They may share infrastructure later, but Personal GTM must not require Job Radar as an input source.

---

## 5. Primary user

Mohamed Landolsi, Automation & Integration Engineer, targeting remote B2B contract roles in GTM/RevOps/Automation.

Target outcome:

- Generate qualified companies to pitch.
- Identify the correct person to contact.
- Produce a personalized outreach angle.
- Reduce manual research time.
- Build a portfolio-grade GTM engineering artifact.

---

## 6. Success metrics

| Metric | Definition | Target |
|---|---|---|
| Account match rate | Companies passing filters / total companies discovered | ≥ 20% after tuning |
| Contact found rate | Companies with at least one usable contact / matched companies | ≥ 40% |
| Email found rate | Contacts with email or strong email guess / contacts found | ≥ 30% |
| Outreach readiness | Accounts with company + contact + strategy ready for review | ≥ 25 per week after stabilization |
| False positive rate | Manually rejected accounts / total reviewed | < 25% after tuning |
| Cost | Paid spend | $0 |
| HITL compliance | Messages sent without approval | 0 |

---

## 7. Scope

### In scope

- Dynamic ICP configuration.
- Company discovery from pluggable sources.
- Company normalization and deduplication.
- Deterministic filtering before paid/LLM calls.
- Company enrichment.
- Decision-maker discovery.
- Email/LinkedIn enrichment.
- Explainable account scoring.
- Explainable contact scoring.
- Outreach strategy generation.
- Google Sheets output.
- Discord digest.
- Ops telemetry.
- Human-in-the-loop approval fields.

### Out of scope for v1

- Automatic email sending.
- LinkedIn automation.
- Full CRM sync.
- Reply detection.
- Meeting booking.
- Multi-language outreach.
- Paid data providers.

---

## 8. Target account profile

Default ICP:

### Company type

- SMB
- Startup
- Agency
- Boutique consultancy
- Small B2B SaaS
- RevOps / GTM / marketing operations agency

### Company size

- 2 to 100 employees preferred.
- 100 to 200 allowed only if strong automation signal.
- Exclude enterprise unless explicitly enabled.

### Budget proxies

The system cannot verify bank balance. It must use proxies:

- Funded startup stage: pre-seed, seed, Series A.
- Revenue band if available.
- Employee count not too small.
- Active website.
- Tech stack usage.
- Public hiring or growth signals.
- Agency model with clients.
- B2B SaaS with sales motion.

### Need proxies

Signals that the company may need automation/GTM engineering:

- Uses HubSpot, Salesforce, Pipedrive, Close, Attio.
- Mentions RevOps, GTM, sales ops, marketing ops.
- Uses n8n, Make, Zapier, Clay, Apollo.
- Has sales team but small operations team.
- Agency managing multiple clients.
- B2B company with lead generation motion.
- Public content about outbound, demand gen, CRM, AI workflows.

### Timezone compatibility

Default compatible offsets relative to UTC:

```text
UTC+0, UTC+1, UTC+2, UTC+3, UTC+4
```

This covers Tunisia and most of Europe, Middle East, and nearby Africa. Configurable.

### Vertical boost

Optional higher score for:

- Fitness tech
- Health tech
- Wellness SaaS
- Gym/fitness platforms
- B2B SaaS
- RevOps agencies
- Marketing automation agencies

This leverages Mohamed’s hypertrophy/fitness domain knowledge.

---

## 9. Dynamic configuration requirement

All filters must be editable without changing the workflow.

### Recommended config storage

Google Sheet tab:

```text
config
```

Columns:

```text
key
value
type
description
updated_at
```

The workflow reads this sheet on every run.

For complex nested settings, store a JSON string under:

```text
key = icp_json
```

The workflow parses and validates it.

---

## 10. Default configuration schema

```json
{
  "rev": "personal-gtm-v1",
  "enabled": true,
  "max_companies_per_run": 25,
  "max_contacts_per_company": 3,
  "min_account_score": 65,
  "min_contact_score": 60,
  "allow_agencies": true,
  "allow_startups": true,
  "allow_smb": true,
  "allow_enterprise": false,
  "timezone": {
    "allowed_utc_offsets": [0, 1, 2, 3, 4],
    "allow_unknown_timezone": false,
    "unknown_timezone_penalty": 15
  },
  "company": {
    "employee_min": 2,
    "employee_max": 150,
    "industries_include": [
      "B2B SaaS",
      "Software",
      "FinTech",
      "HealthTech",
      "FitnessTech",
      "Marketing Agency",
      "Sales Agency",
      "RevOps Consulting",
      "GTM Consulting",
      "Marketing Automation",
      "AI Software"
    ],
    "industries_exclude": [
      "Recruiting",
      "Staffing",
      "Adult",
      "Gambling",
      "Crypto Trading",
      "MLM",
      "Dating",
      "Political Campaigns"
    ],
    "keywords_include": [
      "automation",
      "integration",
      "revops",
      "gtm",
      "sales operations",
      "marketing operations",
      "crm",
      "hubspot",
      "salesforce",
      "clay",
      "n8n",
      "make",
      "zapier",
      "lead generation",
      "demand generation",
      "b2b",
      "saas",
      "ai workflows"
    ],
    "keywords_exclude": [
      "hiring senior only",
      "must be based in usa",
      "security clearance",
      "fluent german required",
      "fluent french required"
    ],
    "funding_stage_include": [
      "bootstrapped",
      "pre_seed",
      "seed",
      "series_a",
      "unknown_but_viable"
    ],
    "must_have_website": true,
    "must_have_domain": true
  },
  "contact": {
    "roles_priority": [
      "Founder",
      "Co-Founder",
      "CEO",
      "CTO",
      "Head of RevOps",
      "RevOps Lead",
      "Head of Sales",
      "VP Sales",
      "Head of Growth",
      "Head of Marketing",
      "Marketing Operations Lead",
      "Sales Operations Lead",
      "GTM Lead",
      "Operations Lead",
      "Head of Automation"
    ],
    "roles_exclude": [
      "Recruiter",
      "Talent Acquisition",
      "HR",
      "People Ops",
      "Intern"
    ],
    "require_email_or_linkedin": true,
    "prefer_founder_for_small_teams": true
  },
  "outreach": {
    "channel_priority": [
      "email",
      "linkedin_manual"
    ],
    "max_new_outreach_per_day": 10,
    "follow_ups_max": 3,
    "tone": "direct, concise, evidence-first",
    "cta_style": "low-friction",
    "proof_points": [
      "Built a federated B2B GTM SaaS platform with FastAPI, Supabase, and LLM routing",
      "Built an n8n job radar with multi-source ingestion, fallback LLM router, scoring, dedupe, and Discord delivery",
      "Can build Clay/n8n/Apollo/HubSpot workflows for lead enrichment, scoring, and outreach ops"
    ]
  },
  "scoring": {
    "weights": {
      "icp_fit": 0.30,
      "budget_proxy": 0.20,
      "automation_need": 0.20,
      "timezone_fit": 0.15,
      "contact_feasibility": 0.15
    },
    "vertical_boost": {
      "enabled": true,
      "bonus": 5,
      "keywords": [
        "fitness",
        "health",
        "wellness",
        "gym",
        "training",
        "hypertrophy",
        "sports tech"
      ]
    }
  },
  "providers": {
    "company_discovery": [
      "apollo",
      "manual_seed",
      "clay_optional"
    ],
    "contact_enrichment": [
      "apollo",
      "hunter",
      "clay_optional",
      "llm_inference_low_confidence"
    ],
    "llm_chain": [
      "groq",
      "gemini",
      "openrouter_free"
    ]
  }
}
```

---

## 11. System architecture

```text
Schedule / Manual Trigger
        ↓
Load Config
        ↓
Discovery Sources
  - Apollo company search
  - Manual seed list
  - Optional Clay import
  - Optional public directory
        ↓
Normalize Companies
        ↓
Dedupe Accounts by domain
        ↓
Deterministic Hard Filters
        ↓
Batch Cap
        ↓
Company Enrichment
  - website
  - industry
  - employees
  - location
  - timezone
  - tech stack
  - funding proxy
        ↓
Account Scoring
        ↓
Contact Discovery
  - role search
  - founder search
  - hiring team search
        ↓
Contact Enrichment
  - email
  - LinkedIn
  - confidence
        ↓
Contact Scoring
        ↓
Outreach Strategy Generation
  - LLM with fallback
  - deterministic template fallback
        ↓
Write Outputs
  - accounts sheet
  - contacts sheet
  - outreach_queue sheet
        ↓
Discord Digest
        ↓
Ops Telemetry
```

---

## 12. Functional requirements

### FR-01 Dynamic config

The system shall read all targeting rules from a config source at runtime.

### FR-02 Source independence

The system shall not require Job Radar as an input.

### FR-03 Pluggable discovery

The system shall support multiple discovery sources through a common normalized schema.

### FR-04 Company normalization

The system shall normalize every company into a common structure before filtering.

### FR-05 Account deduplication

The system shall deduplicate companies using domain as primary key.

### FR-06 Hard filters

The system shall apply deterministic filters before enrichment, LLM, or paid calls.

### FR-07 Batch cap

The system shall limit the number of companies processed per run.

### FR-08 Company enrichment

The system shall enrich surviving companies with website, location, size, industry, and funding proxies where available.

### FR-09 Contact discovery

The system shall attempt to find up to `max_contacts_per_company` contacts per account.

### FR-10 Contact prioritization

The system shall prioritize founders for small companies and functional leads for larger companies.

### FR-11 Explainable scoring

The system shall produce account and contact scores with named components, confidence, red flags, and reasons.

### FR-12 Outreach drafting

The system shall generate a cold outreach strategy for approved accounts.

### FR-13 HITL status

Every outreach draft shall have an approval status.

### FR-14 Telemetry

Every run shall write operational metrics.

### FR-15 Failure tolerance

A failed source shall not kill the full run.

---

## 13. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-01 | $0 paid spend in v1 |
| NFR-02 | No outreach without human approval |
| NFR-03 | Deterministic gates before LLM/paid enrichment |
| NFR-04 | All config changes usable without workflow edits |
| NFR-05 | Dedupe must prevent repeated company/contact rows |
| NFR-06 | Provider failures must be captured in telemetry |
| NFR-07 | Output must be reviewable in Google Sheets |
| NFR-08 | Workflow must be portable to n8n self-hosted |
| NFR-09 | No mass LinkedIn automation |
| NFR-10 | Public business data only |

---

## 14. Discovery sources

### Source 1: Apollo company search

Primary source if free credits/API access available.

Use filters:

- Industry
- Employee count
- Location
- Keywords
- Company website
- Funding stage if available

Output:

```text
company_name
domain
website
industry
employees
location
funding_stage
source
```

### Source 2: Manual seed list

A Google Sheet tab where Mohamed can add companies manually.

Useful for:

- High-value targets
- Fitness/health companies
- Agencies
- Startups found manually
- Companies from LinkedIn research

### Source 3: Optional Clay import

Clay can be used as an enrichment and discovery assistant, but not as the only system.

v1 usage:

- Export filtered company list from Sheets.
- Import into Clay table.
- Run limited Clay enrichment on small batches.
- Export enriched rows back to Sheets.

### Source 4: Optional public directories

Possible later sources:

- Y Combinator public company directory
- Product Hunt
- Open startup directories
- Public B2B agency lists
- Google Maps via Apify sample only

These are optional and should be disabled by default until stable.

---

## 15. Normalized company schema

Every discovered company must be converted into:

```json
{
  "account_id": "hash_domain",
  "source": "apollo",
  "company_name": "Example GmbH",
  "domain": "example.com",
  "website": "https://example.com",
  "linkedin_url": "",
  "industry": "B2B SaaS",
  "company_type": "startup",
  "employee_count": 25,
  "location_raw": "Berlin, Germany",
  "country": "Germany",
  "timezone_utc_offset": 1,
  "funding_stage": "seed",
  "funding_proxy_score": 0,
  "automation_need_score": 0,
  "icp_fit_score": 0,
  "timezone_fit_score": 0,
  "contact_feasibility_score": 0,
  "final_score": 0,
  "why_match": "",
  "red_flags": "",
  "confidence": 0,
  "status": "new"
}
```

---

## 16. Deterministic hard filters

Run before enrichment or LLM.

### Reject if:

- No company name.
- No domain or website when `must_have_domain = true`.
- Employee count outside allowed range.
- Industry is excluded.
- Location is excluded.
- Timezone is incompatible and `allow_unknown_timezone = false`.
- Company type is disabled.
- Keyword veto matches excluded keywords.
- Already exists in `seen_accounts`.
- Source data is malformed.

### Keep if:

- Company name exists.
- Domain exists.
- Industry or keyword signals pass.
- Employee range passes.
- Timezone passes or unknown is allowed.
- Not duplicate.

---

## 17. Company enrichment layer

Only for companies that pass hard filters.

### Fields to enrich

```text
website_status
website_summary
country
timezone_utc_offset
employee_count
linkedin_company_url
tech_stack
crm_detected
automation_tools_detected
funding_stage
funding_proxy
hiring_page_detected
contact_page_detected
description_clean
```

### Enrichment priority

1. Existing source data.
2. Website metadata.
3. Apollo company data.
4. Clay enrichment on capped subset.
5. LLM inference only for structuring, not inventing facts.

### Rules

- Do not re-enrich companies already in `seen_accounts`.
- Cache enriched results.
- Cap enrichment per run.
- Store provider used.
- Store enrichment timestamp.

---

## 18. Funding/budget proxy model

The system should not claim a company has funds. It should estimate likelihood.

### Positive proxies

| Proxy | Weight |
|---|---|
| Employee count 5–100 | +20 |
| Funded stage: seed/Series A | +25 |
| B2B SaaS business model | +15 |
| Agency with clients | +15 |
| Detected CRM/sales stack | +10 |
| Active website | +10 |
| Hiring page detected | +5 |

### Negative proxies

| Proxy | Weight |
|---|---|
| Employee count 0–1 | -20 |
| No website | -30 |
| Recruiting/staffing only | -30 |
| Non-B2B local business | -20 |
| Enterprise but no contact path | -10 |

Output:

```text
funding_proxy_score: 0-100
funding_proxy_label: low | medium | high
funding_proxy_reasons: []
```

---

## 19. Automation need model

### Positive signals

| Signal | Weight |
|---|---|
| Mentions RevOps/GTM/sales ops | +25 |
| Uses HubSpot/Salesforce/Pipedrive | +20 |
| Uses Clay/n8n/Make/Zapier | +20 |
| Agency managing multiple clients | +15 |
| B2B sales motion | +10 |
| Mentions AI workflows | +10 |

### Negative signals

| Signal | Weight |
|---|---|
| No sales/marketing motion | -20 |
| Pure content site | -15 |
| Non-B2B | -20 |
| No digital presence | -15 |

Output:

```text
automation_need_score: 0-100
automation_need_label: low | medium | high
automation_need_reasons: []
```

---

## 20. Timezone model

Use country/city mapping.

Default allowed offsets:

```text
0, +1, +2, +3, +4
```

### Scoring

| Condition | Score |
|---|---|
| Exact Tunisia UTC+1 | 100 |
| UTC+0 to UTC+3 | 90 |
| UTC+4 | 75 |
| Unknown | 0 or reduced depending on config |
| Outside range | reject or 0 |

Config can override.

---

## 21. Account scoring model

Final account score:

```text
final_score =
  0.30 * icp_fit_score +
  0.20 * budget_proxy_score +
  0.20 * automation_need_score +
  0.15 * timezone_fit_score +
  0.15 * contact_feasibility_score +
  vertical_boost
```

Clamp to 0–100.

### Output must include:

```text
final_score
score_breakdown
why_match
red_flags
confidence
priority
```

### Priority thresholds

| Score | Label |
|---|---|
| ≥ 80 | hot |
| 65–79 | warm |
| 50–64 | review |
| < 50 | rejected |

---

## 22. Contact discovery

For each qualified account, find the best contact.

### Contact priority for SMB/startup

1. Founder
2. Co-Founder
3. CEO
4. CTO
5. Head of Operations
6. Head of Growth

### Contact priority for larger company

1. Head of RevOps
2. Sales Operations Lead
3. Marketing Operations Lead
4. Head of Sales
5. Head of Growth
6. GTM Lead

### Agency priority

1. Founder
2. Head of Operations
3. Head of Client Delivery
4. Head of Growth
5. Marketing Lead

### Exclude

- Recruiters
- Talent acquisition
- HR
- Interns
- Generic support roles unless no alternative

---

## 23. Contact schema

```json
{
  "contact_id": "hash_email_or_linkedin",
  "account_id": "hash_domain",
  "full_name": "Jane Doe",
  "title": "Founder",
  "role_category": "founder",
  "email": "",
  "email_status": "verified | guessed | not_found",
  "linkedin_url": "",
  "phone": "",
  "source": "apollo",
  "confidence": 0,
  "contact_score": 0,
  "preferred_channel": "email",
  "status": "new"
}
```

---

## 24. Contact scoring model

```text
contact_score =
  0.35 * role_authority +
  0.25 * relevance_to_automation_gtm +
  0.20 * email_confidence +
  0.10 * linkedin_presence +
  0.10 * timezone_language_fit
```

### Role authority examples

| Role | Score |
|---|---|
| Founder/CEO | 100 |
| Head of RevOps | 90 |
| Head of Sales | 85 |
| Head of Growth | 80 |
| Marketing Ops Lead | 75 |
| Recruiter | 0 |

### Email confidence

| Status | Score |
|---|---|
| Verified | 100 |
| High-confidence pattern | 70 |
| AI guess | 30 |
| Not found | 0 |

---

## 25. Contact enrichment waterfall

Order:

```text
Apollo person search
  ↓
Hunter email search
  ↓
Clay email waterfall, capped
  ↓
LLM email pattern inference, low confidence only
```

Rules:

- Do not mark guessed emails as verified.
- Store confidence.
- Store provider.
- Do not enrich contacts for rejected accounts.
- Max 3 contacts per company by default.

---

## 26. Outreach strategy generation

Only generate outreach strategy for accounts that pass:

```text
final_score >= min_account_score
AND at least one contact_score >= min_contact_score
```

### Strategy output schema

```json
{
  "outreach_id": "uuid",
  "account_id": "hash_domain",
  "contact_id": "hash_email_or_linkedin",
  "channel": "email",
  "angle": "",
  "trigger": "",
  "pain_point": "",
  "value_proposition": "",
  "proof_point": "",
  "cta": "",
  "email_subject": "",
  "first_line": "",
  "message_draft": "",
  "follow_up_1": "",
  "follow_up_2": "",
  "follow_up_3": "",
  "linkedin_note": "",
  "risk_notes": "",
  "approval_status": "pending",
  "send_status": "not_sent"
}
```

---

## 27. Outreach strategy rules

### First line formula

The first line must reference:

1. One specific observation about the company.
2. One likely GTM/automation pain.
3. One relevant capability proof.

No flattery. No generic “I hope you are well.”

### CTA style

Low friction:

```text
Would it be useful if I sent a short 2-minute breakdown of how I’d automate this?
```

or:

```text
Open to seeing a quick workflow example relevant to your sales stack?
```

### Message length

- Cold email: 70–120 words.
- LinkedIn note: 20–40 words.
- Follow-up: shorter than previous touch.

### Follow-up sequence

| Touch | Purpose |
|---|---|
| 1 | Specific observation + capability proof + soft CTA |
| 2 | Add one concrete workflow idea |
| 3 | Short breakup / door-open message |

Stop after reply or after max follow-ups.

---

## 28. LLM usage

LLM is used only after deterministic filtering.

### LLM tasks

- Summarize company description.
- Infer automation need from public text.
- Generate outreach angle.
- Draft first line.
- Draft follow-ups.

### LLM constraints

- Temperature low: 0.2–0.4.
- JSON-only output.
- No invented facts.
- Must use only provided fields.
- Fallback to deterministic template if all providers fail.

### LLM fallback chain

```text
Groq
  ↓
Gemini
  ↓
OpenRouter free model
  ↓
Template fallback
```

---

## 29. Clay usage policy

Clay is optional and must not burn credits on unfiltered data.

### Clay role

- Enrich company website.
- Detect tech stack.
- Find funding signals.
- Enrich contacts.
- Generate AI summaries on small filtered batches.

### Clay rules

- Only enrich companies that passed hard filters.
- Cap rows per run.
- Do not re-enrich cached rows.
- Prefer n8n for orchestration.
- Store Clay output back into Sheets.

---

## 30. Google Sheets data model

Create one Google Sheet:

```text
personal-gtm-engine
```

Tabs:

```text
config
seed_accounts
accounts
contacts
outreach_queue
seen_accounts
seen_contacts
ops
```

---

### `config`

```text
key
value
type
description
updated_at
```

---

### `seed_accounts`

```text
company_name
domain
website
industry
notes
added_at
status
```

---

### `accounts`

```text
run_date
account_id
source
company_name
domain
website
linkedin_url
industry
company_type
employee_count
location_raw
country
timezone_utc_offset
funding_stage
funding_proxy_score
automation_need_score
icp_fit_score
timezone_fit_score
contact_feasibility_score
final_score
priority
why_match
red_flags
confidence
status
```

---

### `contacts`

```text
run_date
contact_id
account_id
company_name
domain
full_name
title
role_category
email
email_status
linkedin_url
phone
source
confidence
contact_score
preferred_channel
status
```

---

### `outreach_queue`

```text
run_date
outreach_id
account_id
contact_id
company_name
contact_name
channel
angle
trigger
pain_point
value_proposition
proof_point
cta
email_subject
first_line
message_draft
follow_up_1
follow_up_2
follow_up_3
linkedin_note
risk_notes
approval_status
send_status
sent_at
reply_received
notes
```

---

### `seen_accounts`

```text
domain
company_name
first_seen_at
last_seen_at
source
```

---

### `seen_contacts`

```text
contact_key
account_domain
full_name
email
linkedin_url
first_seen_at
last_seen_at
source
```

---

### `ops`

```text
run_at
config_rev
source
companies_discovered
companies_normalized
companies_after_hard_filters
companies_enriched
accounts_written
contacts_discovered
contacts_written
outreach_drafts_written
llm_calls
llm_failures
apollo_calls
hunter_calls
clay_rows
errors_sample
duration_seconds
```

---

## 31. Deduplication rules

### Account dedupe key

```text
domain
```

Normalize:

```text
https://www.example.com/
www.example.com
example.com
```

All become:

```text
example.com
```

### Contact dedupe key

Priority:

```text
email
linkedin_url
full_name + domain
```

If none exist, do not create a contact row.

---

## 32. Status lifecycle

### Account status

```text
new
enriched
qualified
contact_found
outreach_ready
approved
rejected
contacted
replied
closed
```

### Contact status

```text
new
enriched
qualified
rejected
used_in_outreach
```

### Outreach status

```text
pending
approved
edited
rejected
sent
replied
bounced
stopped
```

---

## 33. Discord digest

Send a daily or manual digest.

### Digest content

For each top account:

```text
Company:
Domain:
Score:
Industry:
Size:
Location:
Timezone:
Why:
Contact:
Contact title:
Email/LinkedIn:
Outreach angle:
```

### Color coding

| Score | Color |
|---|---|
| ≥ 80 | Green |
| 65–79 | Yellow |
| < 65 | Grey or skip |

---

## 34. Ops telemetry

Every run must append to `ops`:

```text
run_at
config_rev
companies_discovered
companies_after_hard_filters
accounts_written
contacts_written
outreach_drafts_written
llm_calls
llm_failures
provider_failures
errors_sample
```

Telemetry is mandatory. Do not debug blindly.

---

## 35. Error handling

### Source failure

If Apollo fails:

- Log error.
- Continue with seed accounts if available.
- Do not stop the run.

### Enrichment failure

If enrichment provider fails:

- Mark field as unknown.
- Continue with available data.
- Lower confidence.

### LLM failure

If all LLM providers fail:

- Use deterministic template.
- Mark `outreach_strategy_provider = template`.

### Missing contact

If no contact is found:

- Keep account if score is high.
- Set `contact_feasibility_score = 0`.
- Output note: `manual_research_needed`.

---

## 36. Security and privacy rules

- Store only public business contact information.
- Do not scrape authenticated pages.
- Do not mass automate LinkedIn.
- Do not send automatically.
- Keep API keys in n8n environment variables.
- Do not hardcode secrets.
- Use service account for Google Sheets.
- Respect rate limits.
- Keep volume low.

---

## 37. Compliance notes

This is not legal advice.

For outreach:

- Use public B2B contact data.
- Keep messages relevant.
- Include honest identity.
- Provide opt-out/unsubscribe if sending email at scale later.
- Avoid EU personal data misuse.
- Do not fabricate claims.

---

## 38. Technology stack

| Layer | Tool |
|---|---|
| Orchestration | n8n |
| Config/state | Google Sheets |
| Discovery | Apollo, manual seeds, optional Clay |
| Enrichment | Apollo, Hunter, Clay optional |
| LLM | Groq, Gemini, OpenRouter free |
| Digest | Discord webhook |
| Storage | Google Sheets |
| HITL | Sheet approval columns |
| CRM later | HubSpot free |

---

## 39. n8n workflow design

### Trigger

```text
Schedule Trigger
```

Example:

```text
08:00 daily
```

Also include:

```text
Manual Trigger
```

### Node sequence

1. `Load Config`
2. `Fetch Seed Accounts`
3. `Apollo Company Search`
4. `Normalize Companies`
5. `Merge Sources`
6. `Fetch Seen Accounts`
7. `Dedupe & Hard Filters`
8. `Batch Cap`
9. `Enrich Company`
10. `Score Accounts`
11. `Filter Qualified Accounts`
12. `Discover Contacts`
13. `Enrich Contacts`
14. `Score Contacts`
15. `Build Outreach Prompts`
16. `LLM Router`
17. `Write Accounts`
18. `Write Contacts`
19. `Write Outreach Queue`
20. `Append Seen Accounts`
21. `Append Seen Contacts`
22. `Run Stats`
23. `Discord Digest`
24. `Append Ops`

---

## 40. Critical n8n rules

- Sheet read nodes must use **Execute Once**.
- HTTP nodes must have **On Error: Continue using error output**.
- Code nodes must return `{ json: {...} }`.
- Do not place reserved key `json` inside payload.
- Lock node names early.
- Add error objects before rewriting logic.
- Use deterministic gates before LLM/paid calls.
- Cap every batch.
- Write seen rows even if no matches.

---

## 41. Milestones

### M0 — Setup

Create:

- Google Sheet.
- Tabs.
- Config JSON.
- n8n credentials.
- Discord webhook.

### M1 — Config and source

Build:

- Load Config.
- Seed accounts.
- Apollo search.
- Normalize.

### M2 — Filtering

Build:

- Dedupe.
- Hard filters.
- Batch cap.
- Seen accounts.

### M3 — Enrichment and scoring

Build:

- Company enrichment.
- Account scoring.
- Qualified filter.

### M4 — Contacts

Build:

- Contact discovery.
- Contact enrichment.
- Contact scoring.
- Seen contacts.

### M5 — Outreach

Build:

- Outreach prompt.
- LLM router.
- Outreach queue.
- Discord digest.

### M6 — Ops and hardening

Build:

- Ops row.
- Error sample.
- Provider failure tracking.
- Config warnings.

---

## 42. Acceptance criteria

The project is complete when:

1. Changing config in the sheet changes the next run without editing n8n.
2. The workflow does not depend on Job Radar.
3. Duplicate companies are not appended.
4. Rejected companies never trigger enrichment or LLM calls.
5. Every account row has a score breakdown.
6. Every contact row has source and confidence.
7. Every outreach draft has `approval_status = pending`.
8. No message can be sent from the workflow.
9. Discord digest shows top qualified accounts.
10. Ops row is appended every run.
11. Provider failure does not kill the run.
12. The system works with seed accounts if Apollo fails.

---

## 43. Architecture Decision Records

### ADR-001: Separate from Job Radar

**Decision:** Personal GTM Engine is a standalone workflow.

**Reason:** Different object model, different goal, cleaner portfolio, lower coupling.

**Consequence:** Must have its own discovery sources and config.

---

### ADR-002: n8n is the control plane

**Decision:** n8n owns orchestration, filtering, scoring, routing, and output.

**Reason:** Shows GTM engineering capability and allows deterministic control.

**Consequence:** Clay is used only as enrichment, not as the full system.

---

### ADR-003: Google Sheets as state layer

**Decision:** Use Google Sheets for config, output, dedupe, and ops.

**Reason:** Free, inspectable, easy HITL, enough for v1.

**Consequence:** Must use Execute Once and batch writes to avoid quota issues.

---

### ADR-004: Deterministic gates before LLM/paid calls

**Decision:** Hard filters run before enrichment, LLM, Apollo credits, or Clay credits.

**Reason:** Zero-cost constraint.

**Consequence:** Some potentially interesting but incomplete companies may be dropped.

---

### ADR-005: HITL before outreach

**Decision:** Workflow drafts outreach but never sends.

**Reason:** Protects reputation and avoids platform/email risk.

**Consequence:** Mohamed must review the outreach queue manually.

---

### ADR-006: Domain as account identity

**Decision:** Use normalized domain as primary account key.

**Reason:** Company names are inconsistent.

**Consequence:** Companies without domains are rejected or marked manual research.

---

## 44. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Apollo free credits insufficient | Low discovery volume | Seed accounts, caching, caps, optional Clay import |
| Poor contact data | Weak outreach | Contact confidence fields, manual review |
| LLM hallucination | Bad outreach | JSON-only prompt, facts-only rule, template fallback |
| Duplicate rows | Noisy sheet | Seen accounts/contacts tables |
| Sheet quota limits | Workflow failure | Execute Once, batch writes, caching |
| Timezone inference wrong | Bad targeting | Configurable offsets, unknown penalty |
| Overbroad ICP | Noise | Strict keywords and employee filters |
| Outreach feels spammy | Reputation risk | HITL, low volume, personalized angle |

---

## 45. Portfolio positioning

This project should be presented as:

> **Personal GTM Engine**  
> Built an n8n + Clay + Apollo outbound GTM pipeline that discovers SMB/startup/agency accounts, applies dynamic ICP filters, enriches decision-makers, scores accounts with explainable logic, and generates human-approved cold outreach strategies.

Narrative bridge to Wavess:

| Wavess component | Personal GTM equivalent |
|---|---|
| Oceanss | Signal-based account scoring and target discovery |
| Tropicc | Personalized content/outreach generation |
| wavess-core | LLM fallback router, config, orchestration discipline |
| Portal | HITL governance and status control |

---

## 46. Definition of Done

The project is portfolio-ready when it has:

1. Working n8n workflow.
2. Dynamic config sheet.
3. Account output sheet.
4. Contact output sheet.
5. Outreach queue with approval status.
6. Ops telemetry.
7. Discord digest.
8. Architecture diagram.
9. SPEC.md.
10. ADR.md.
11. GitHub repo.
12. Short Loom walkthrough.

---

**Next step: create a Google Sheet named `personal-gtm-engine` with tabs `config`, `seed_accounts`, `accounts`, `contacts`, `outreach_queue`, `seen_accounts`, `seen_contacts`, and `ops`, then paste the `DEFAULT_CONFIG` JSON into the `config` tab.**