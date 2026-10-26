# Architecture Decision Records: Personal GTM Engine

Consolidated from every ADR in the project docs (SPEC, Roadmap, Sprint 1 to 7 guides and patches, Clay Operator guide, project review, run guide, explainer), as of 2026-10-08. `ADR-PGT-NNN` from the sprint guides is written as `ADR-NNN`. When a number was already taken, the later ADR got the next free number after ADR-049 and says what it was originally numbered. If the same decision appears in several docs, it is listed once with all its sources.

## Table of contents

| ADR | Title | Status |
|---|---|---|
| ADR-001 | Separate from Job Radar | Accepted |
| ADR-002 | n8n is the control plane | Accepted |
| ADR-003 | Google Sheets as state layer | Accepted |
| ADR-004 | Deterministic gates before LLM and paid calls | Accepted |
| ADR-005 | HITL before outreach | Accepted |
| ADR-006 | Domain as account identity | Accepted |
| ADR-013 | Enrichment as a post-write update pass with a two-output Code node | Accepted |
| ADR-014 | Deterministic HTML signatures before LLM or paid enrichment | Accepted |
| ADR-015 | Clay v1 is a human-bridged table loop, not API | Accepted |
| ADR-016 | Clay merge is evidence-only, no final re-score yet | Accepted |
| ADR-017 | Pilot-before-batch credit discipline | Accepted |
| ADR-021 | Feasibility enters the account score as max contact_score | Accepted |
| ADR-022 | Guessed is not verified | Accepted |
| ADR-023 | Wrong contacts are rejected, not deleted | Accepted |
| ADR-024 | Deterministic product-term guard before and after the LLM | Accepted |
| ADR-025 | Person discovery degrades to HITL sourcing when providers are plan-gated | Superseded by ADR-066 |
| ADR-026 | Size-aware wording | Accepted |
| ADR-033 | Outreach stage inside the main spine | Accepted |
| ADR-034 | LLM router as one Code node, config-driven chain | Accepted |
| ADR-035 | Template fallback always writes a row | Accepted |
| ADR-036 | autoMap allowed on single-writer outreach_queue | Accepted |
| ADR-037 | Code assembles greeting, CTA and sign-off | Accepted |
| ADR-038 | Channel follows email verification | Accepted |
| ADR-039 | Validator plus tool whitelist before accepting any draft | Accepted |
| ADR-040 | Supersede, do not delete | Accepted |
| ADR-041 | Router stays a Code node | Accepted |
| ADR-042 | One repair retry before provider fallthrough | Accepted |
| ADR-043 | Claim guards in the validator | Accepted |
| ADR-044 | A separate digest workflow | Accepted |
| ADR-045 | digest_log Data Table keyed outreach_id:status | Accepted |
| ADR-046 | HTTP Request, not the Discord node | Accepted |
| ADR-047 | No emails in Discord | Accepted |
| ADR-048 | Approval happens in Sheets, not Discord buttons | Accepted |
| ADR-049 | Main engine stays manual | Accepted |
| ADR-050 | Apollo as a Code node with internal fetch | Accepted |
| ADR-051 | Pluggable source contract | Accepted |
| ADR-052 | Deterministic country-to-UTC map instead of LLM geo inference | Accepted |
| ADR-053 | Waterfall over single provider for email finding | Accepted |
| ADR-054 | $env read in Code nodes | Accepted |
| ADR-055 | Digest posts first, then logs | Accepted |
| ADR-056 | Outreach queue ledger is the source of truth | Accepted |
| ADR-057 | Remove the source-side cap, let gates and the write cap control volume | Accepted |
| ADR-058 | Allow unknown timezone and a score floor of 60, keep spending gates at 65 | Accepted |
| ADR-059 | No job-board APIs | Accepted |
| ADR-060 | Apollo off until proven | Accepted |
| ADR-061 | YC directory as the primary free source | Accepted |
| ADR-062 | Do not retune scoring in the discovery patch | Accepted |
| ADR-063 | HN keeps running behind a strong-keyword gate | Accepted |
| ADR-064 | Apollo labels come from the query, not Apollo's industry field | Accepted |
| ADR-065 | Sources stay as Code nodes | Accepted |
| ADR-066 | Contacts come from a search API with human review, not a people database | Accepted |
| ADR-067 | The contact finder is a separate workflow | Accepted |
| ADR-068 | Manual run order, not one chained workflow | Accepted |
| ADR-069 | Clay is optional for a run | Accepted |
| ADR-070 | Tavily contacts are LinkedIn-only | Accepted |
| ADR-071 | Fix pacing before adding providers | Accepted |
| ADR-072 | Three Groq models on one key instead of a third provider | Accepted |
| ADR-073 | Keep the template as the last resort | Accepted |
| ADR-074 | Homepage facts are fetched inside the Code node | Accepted |
| ADR-075 | One contact per company | Accepted |
| ADR-076 | YC directory before search for founder lookup | Accepted |
| ADR-077 | Deterministic location gate, flag instead of drop on unknown | Accepted |
| ADR-078 | Competitors are filtered at the account stage, not the draft stage | Accepted |
| ADR-079 | Public repo with sanitized exports | Accepted |
| ADR-080 | Recorded walkthrough instead of a hosted demo | Accepted |
| ADR-081 | Sending stays manual during dogfooding | Accepted |
| ADR-082 | Retire the Discord digest; the console is the only review surface | Accepted |
| ADR-083 | Neon is the permanent system of record for outreach | Accepted |
| ADR-084 | Archive before delete | Accepted |
| ADR-085 | Hide Sheet columns, never delete them | Accepted |
| ADR-086 | Keep Sheets as the engine's working store, bridged to Neon | Accepted |
| ADR-087 | Workflow boundaries follow human steps and credit gates | Accepted |
| ADR-088 | Keep the `config` mirror tab and its push | Accepted |
| ADR-089 | Clay on the Free plan: two tables, unused columns removed, auto-run off | Accepted |

---

## ADR-001: Separate from Job Radar
**Status:** Accepted
**Context:** Job Radar ranks job postings. The Personal GTM Engine works on companies, contacts and outreach plans, which is a different object model and a different goal.
**Decision:** The Personal GTM Engine is a standalone workflow and does not need Job Radar as an input.
**Trade-offs / consequences:** Cleaner portfolio and lower coupling. It needs its own discovery sources and config.
**Source:** SPEC.md

## ADR-002: n8n is the control plane
**Status:** Accepted
**Context:** The project has to show GTM engineering skill and keep control deterministic.
**Decision:** n8n owns orchestration, filtering, scoring, fallback routing and output. Clay is only used for enrichment.
**Trade-offs / consequences:** More build work in n8n, with control, logic and fallbacks in one place.
**Source:** SPEC.md. Also in Roadmap.md (as ADR-001) and claude/Project Explainer for NotebookLM.md (unnumbered table).

## ADR-003: Google Sheets as state layer
**Status:** Accepted
**Context:** v1 needs state that is free, easy to inspect and easy to review by hand.
**Decision:** Google Sheets holds config, output, dedupe and ops telemetry.
**Trade-offs / consequences:** Needs Execute Once and batch writes to stay inside quota. Note: the `seen_accounts` and `seen_contacts` ledgers later moved to n8n Data Tables (the R2 refactor, cited in Sprint 6 - Guide.md). No ADR in the project records that move.
**Source:** SPEC.md. Also in claude/Project Explainer for NotebookLM.md (unnumbered table).

## ADR-004: Deterministic gates before LLM and paid calls
**Status:** Accepted
**Context:** The project must cost $0 (NFR-01).
**Decision:** Hard filters (industry, timezone, headcount and the others) run before any enrichment, LLM call, Apollo credit or Clay credit. The project review restates the order for outreach: score, caps, channel rule, validator, then Groq, then Gemini, then the template.
**Trade-offs / consequences:** Some companies that look interesting but have incomplete data get dropped. More code, but spend stays at a predictable $0. The alternative was LLM-first.
**Source:** SPEC.md. Also in Roadmap.md (as ADR-002), Project_Review_and_Fixes_Guide.md (unnumbered table, with an identical copy in claude/) and claude/Project Explainer for NotebookLM.md.

## ADR-005: HITL before outreach
**Status:** Accepted
**Context:** Protect reputation and avoid email and platform risk. Reputation protection is a non-negotiable NFR.
**Decision:** The workflow drafts outreach but never sends it.
**Trade-offs / consequences:** Mohamed reviews the outreach queue by hand, a few minutes a day.
**Source:** SPEC.md. Also in Roadmap.md (as ADR-004) and claude/Project Explainer for NotebookLM.md.

## ADR-006: Domain as account identity
**Status:** Accepted
**Context:** Company names are inconsistent across sources.
**Decision:** The normalized domain is the primary account key.
**Trade-offs / consequences:** Companies without a domain are rejected or marked for manual research.
**Source:** SPEC.md. Also in claude/Project Explainer for NotebookLM.md.

## ADR-013: Enrichment as a post-write update pass with a two-output Code node
**Status:** Accepted
**Context:** Sprint 3 adds website enrichment without touching the proven gate and scoring core. In n8n, a branch with zero items stops the nodes after it.
**Decision:** Enrich rows that are already in `accounts` through an update-in-place pass. The Code node has a second output that always carries the stats package to Run Stats and Append Ops. The alternative was splitting Process Accounts into separate filter and score nodes.
**Trade-offs / consequences:** The core stays untouched and the ledger stays append-only. Note: later docs show the Enrich Companies node was deleted and `Fetch Website` became an HTTP Request node in R2 (Sprint 6 - Guide.md, project review F8). No ADR in the project records that change.
**Source:** Sprint 3 - Guide.md (originally ADR-PGT-013)

## ADR-014: Deterministic HTML signatures before LLM or paid enrichment
**Status:** Accepted
**Context:** Tech-stack and hiring signals were needed at $0.
**Decision:** Regex signatures on the raw website HTML detect CRM, automation, analytics and CMS tools. LLM website summaries are deferred to Sprint 6, per SPEC section 28.
**Trade-offs / consequences:** Costs $0, is explainable and can be cached.
**Source:** Sprint 3 - Guide.md (originally ADR-PGT-014)

## ADR-015: Clay v1 is a human-bridged table loop, not API
**Status:** Accepted
**Context:** On the free tier, Clay API access depends on the plan. The UI loop (tables, waterfalls, Claygent, credit economics) is also what interviews ask about.
**Decision:** Export from Sheets to a Clay table, then export back to Sheets (SPEC section 14, v1 usage). No API push or pull.
**Trade-offs / consequences:** One manual step per batch and zero spend. API automation was deferred to a Sprint 4 extension once credits are verified. The project review and the explainer repeat this decision as "Manual Clay hand-off".
**Source:** Sprint 4 - Guide.md (originally ADR-PGT-015). Also in Project_Review_and_Fixes_Guide.md and claude/Project Explainer for NotebookLM.md.

## ADR-016: Clay merge is evidence-only, no final re-score yet
**Status:** Accepted
**Context:** The 5-component scoring formula in SPEC section 21 needs `contact_feasibility`, which arrives in Sprint 5.
**Decision:** The Clay merge writes evidence only: blank-fill, a tech-stack union, and a funding upgrade from `unknown`. It does not re-score the account.
**Trade-offs / consequences:** Re-scoring twice would break score explainability between sprints. The final re-score comes with ADR-021.
**Source:** Sprint 4 - Guide.md (originally ADR-PGT-016)

## ADR-017: Pilot-before-batch credit discipline
**Status:** Accepted
**Context:** Claygent cost is non-linear and cannot be seen before a run. The free tier is a hard limit (NFR-01).
**Decision:** No enrichment column runs on more than 2 rows until its per-row cost has been measured against the monthly free allowance.
**Trade-offs / consequences:** One extra manual step per batch, which is fine at v1 volumes (10 rows or fewer per run).
**Source:** Clay Operator - Guide.md (originally ADR-PGT-017)

## ADR-021: Feasibility enters the account score as max contact_score
**Status:** Accepted
**Context:** Contact feasibility is the fifth component of the SPEC section 21 formula. Explainability (FR-11) has to survive weight changes between sprints.
**Decision:** `contact_feasibility_score` is the highest contact score for the account. Each account is re-scored once per batch, and `score_breakdown` is extended, never replaced.
**Trade-offs / consequences:** Scores stay explainable across sprints.
**Source:** Sprint 5 - Guide.md (originally ADR-PGT-021)

## ADR-022: Guessed is not verified
**Status:** Accepted
**Context:** SPEC section 25 compliance and protecting deliverability.
**Decision:** Emails that are pattern-based or not verified by the provider are capped at `guessed` (30 points). Only a waterfall verification flag grants `verified`.
**Trade-offs / consequences:** Email confidence stays low until verified emails exist. ADR-038 builds on this rule.
**Source:** Sprint 5 - Guide.md (originally ADR-PGT-022)

## ADR-023: Wrong contacts are rejected, not deleted
**Status:** Accepted
**Context:** The Contact Finder attached the wrong people to companies whose names are common words.
**Decision:** Wrong people stay in `contacts` with status `rejected`. Their `contact_results` rows are removed so the domain gets looked up again.
**Trade-offs / consequences:** A few dead rows in `contacts`, in exchange for a permanent guard against drafting to them again.
**Source:** claude/Sprint 7 Patch 4 - Contact Precision Guide.md

## ADR-024: Deterministic product-term guard before and after the LLM
**Status:** Accepted
**Context:** With only a homepage title and meta description to go on, the model mixed up what a company sells with what it struggles with. Drafts pitched PaletteHQ commission automation and pitched Twenty a CRM.
**Decision:** Fixed rules extract product terms: words the company repeats in its own description, minus filler and the sender's own vocabulary. The terms are passed to the model as `PRODUCT_TERMS`. Any draft that uses them outside `first_line` and `trigger` is rejected.
**Trade-offs / consequences:** A product described only once is missed, so human review stays the last gate. Lead-gen and enrichment vendors are not caught; that belongs to account filtering (ADR-078). Expect more first-attempt rejections and LLM calls. A second LLM call to judge relevance was rejected as costly and non-deterministic.
**Source:** claude/Sprint 7 Patch 5 - Pitch Relevance Guide.md

## ADR-025: Person discovery degrades to HITL sourcing when providers are plan-gated
**Status:** Superseded by ADR-066
**Context:** The Apollo and Datagma people providers in Clay both failed hard on the free tier (two refunded failures logged).
**Decision:** Machines verify, humans discover. Decision-makers are sourced by hand into a manual Clay table, then scored and deduplicated by n8n.
**Trade-offs / consequences:** Costs about 0 to 12 credits, but takes manual effort per company. Superseded when contact discovery moved to the Tavily search finder (ADR-066). Manual entry (`hitl_manual`) remains only as the fallback for `NO_RESULT` accounts.
**Source:** Sprint 5 People - Guide.md (originally ADR-PGT-025)

## ADR-026: Size-aware wording
**Status:** Accepted
**Context:** Drafts said "your ops team" to companies of 11 and 14 people.
**Decision:** At 20 people or fewer, the validator rejects "ops team". Employee count is the only signal used.
**Trade-offs / consequences:** HN accounts default to 15 employees, so the rule applies to them even when the real team is bigger. The cost is slightly more personal wording, which is harmless.
**Source:** claude/Sprint 7 Patch 5 - Pitch Relevance Guide.md

## ADR-033: Outreach stage inside the main spine
**Status:** Accepted
**Context:** Sprint 6 adds outreach drafting to the engine.
**Decision:** Drafting runs as a stage inside the main workflow spine. The alternative was a separate workflow.
**Trade-offs / consequences:** Still one `ops` row per run, the stats-item pattern is reused and there is no cross-workflow state. Each main run gets about 5 to 25 s of LLM latency.
**Source:** Sprint 6 - Guide.md (originally ADR-PGT-033)

## ADR-034: LLM router as one Code node, config-driven chain
**Status:** Accepted
**Context:** Copy the quota-aware fallback from the wavess-core LLM router.
**Decision:** One Code node routes drafts through the provider chain and records failures per provider. The chain is set in config (`outreach.llm.chain`).
**Trade-offs / consequences:** Provider endpoints live in code. Models and chain order live in config.
**Source:** Sprint 6 - Guide.md (originally ADR-PGT-034)

## ADR-035: Template fallback always writes a row
**Status:** Accepted
**Context:** The HITL queue must never be empty without a visible reason.
**Decision:** When every LLM provider fails, a deterministic template draft is written with `llm_provider = template`.
**Trade-offs / consequences:** Template rows need a harder human review, and `risk_notes` flags them. ADR-073 reaffirms this decision.
**Source:** Sprint 6 - Guide.md (originally ADR-PGT-035)

## ADR-036: autoMap allowed on single-writer outreach_queue
**Status:** Accepted
**Context:** `outreach_queue` has exactly one writer, and its headers match the router output exactly.
**Decision:** `Append Outreach Queue` uses Map Automatically.
**Trade-offs / consequences:** Adding columns to the tab later means switching to manual mapping.
**Source:** Sprint 6 - Guide.md (originally ADR-PGT-036)

## ADR-037: Code assembles greeting, CTA and sign-off
**Status:** Accepted
**Context:** One draft had no greeting and another ended with `[Your Name]`. These are structural defects, so they need a structural fix.
**Decision:** The model writes only `first_line` and `body_rest`. Code adds the greeting, the exact CTA from config and the sign-off. The alternative was letting the model write the whole email.
**Trade-offs / consequences:** Every email shares the same skeleton.
**Source:** Sprint 6 Fixes - Guide.md (identical copy in claude/)

## ADR-038: Channel follows email verification
**Status:** Accepted
**Context:** All 4 drafts went to the `email` channel even though every email was only guessed. Guessed addresses bounce and hurt sender reputation.
**Decision:** The channel is `email` only when `email_status` is verified or valid. Otherwise it is `linkedin_manual` if a LinkedIn URL exists, and otherwise the contact is skipped. The alternative was to email whenever an address exists.
**Trade-offs / consequences:** Few email drafts until verified emails exist.
**Source:** Sprint 6 Fixes - Guide.md (identical copy in claude/)

## ADR-039: Validator plus tool whitelist before accepting any draft
**Status:** Accepted
**Context:** Prompts reduce hallucination but do not stop it. Drafts named tools that were not in the data (HubSpot for PostHog, invented Stripe details).
**Decision:** A deterministic validator checks every draft: word counts, placeholders, numbers that are not in the facts, and company tools, which may only come from `tech_stack`, `clay_summary` or the chosen proof point. A failed draft falls through to the next provider. The alternative was trusting the prompt.
**Trade-offs / consequences:** More fallthroughs between providers. The template is the safety net.
**Source:** Sprint 6 Fixes - Guide.md (identical copy in claude/)

## ADR-040: Supersede, do not delete
**Status:** Accepted
**Context:** Re-drafting needs an audit trail and should not require manual row surgery.
**Decision:** Replaced drafts are set to `approval_status = superseded` instead of being deleted.
**Trade-offs / consequences:** The queue keeps growing, so filter on `approval_status`.
**Source:** Sprint 6 Fixes - Guide.md (identical copy in claude/)

## ADR-041: Router stays a Code node
**Status:** Accepted
**Context:** n8n's Basic LLM Chain has no fallback model (only the AI Agent node v2.1+ does), and the router needs custom validation between providers.
**Decision:** The router stays a Code node instead of a native LLM node with a fallback model. This corrects an earlier statement in the project.
**Trade-offs / consequences:** Provider URLs live in code.
**Source:** Sprint 6 Fixes - Guide.md (identical copy in claude/)

## ADR-042: One repair retry before provider fallthrough
**Status:** Accepted
**Context:** The validator rejected 3 of 4 drafts on trivial rules that the model could fix (`first_line_no_company`, `li_words`).
**Decision:** A rejected answer is retried once on the same provider, with the rejection reason added to the prompt. The alternative was to fall through to the next provider immediately.
**Trade-offs / consequences:** Up to 2 calls per contact per provider, so tokens per minute matter. The 2.5 s pause between contacts stays.
**Source:** Sprint 6 Patch 2 - Guide.md (identical copy in claude/)

## ADR-043: Claim guards in the validator
**Status:** Accepted
**Context:** Drafts described the sender's engine as the prospect's, claimed work that was never built, and invented quantified results.
**Decision:** The validator rejects `wrong_perspective`, `overclaims_built` and `quantified_claim`. The alternative was relying on human review alone.
**Trade-offs / consequences:** Regex rules are blunt and can reject a good draft, which then goes through repair or falls to the template.
**Source:** Sprint_6_Patch_3_Guide.md (identical copy as claude/Sprint 6 Patch 3 - Guide.md)

## ADR-044: A separate digest workflow
**Status:** Accepted
**Context:** The digest runs on a different cadence (daily versus on demand), and a Discord outage must not affect discovery or drafting.
**Decision:** Personal GTM Digest is its own workflow. The alternative was appending the digest to the main engine.
**Trade-offs / consequences:** The Sheets reads are duplicated.
**Source:** Sprint 7 - Guide.md (identical copy in claude/)

## ADR-045: digest_log Data Table keyed outreach_id:status
**Status:** Accepted
**Context:** Discord is not a database. Without a ledger, every run would post every pending row again.
**Decision:** A `digest_log` Data Table keyed on `outreach_id:status` records what has been announced. The alternative was a `digested` column in `outreach_queue`.
**Trade-offs / consequences:** Avoids a second writer on the queue and lets a row be announced again once approved. One more table to maintain.
**Source:** Sprint 7 - Guide.md (identical copy in claude/)

## ADR-046: HTTP Request, not the Discord node
**Status:** Accepted
**Context:** The digest needs full control of embeds, size limits and `allowed_mentions`, plus retries and an error output.
**Decision:** Post to the Discord webhook with an HTTP Request node. The alternative was the native Discord node.
**Trade-offs / consequences:** The payload shape is ours to maintain.
**Source:** Sprint 7 - Guide.md (identical copy in claude/)

## ADR-047: No emails in Discord
**Status:** Accepted
**Context:** Guessed emails are low quality, and Discord is a third-party store of personal data.
**Decision:** Digest cards show only the contact's name, title and LinkedIn URL.
**Trade-offs / consequences:** Open the sheet to see the email. Note: the Digest v2 `Build Digest` code (claude/Digest v2 - Full Review Card.md) prints the contact's email and email status in the Contact field when they exist. That contradicts this decision, and no ADR records the change.
**Source:** Sprint 7 - Guide.md (identical copy in claude/)

## ADR-048: Approval happens in Sheets, not Discord buttons
**Status:** Accepted
**Context:** Discord buttons need a public endpoint and a bot application, which breaks the $0, no-exposure constraint.
**Decision:** Approval status is set in the `outreach_queue` sheet. The alternative was Discord interactions.
**Trade-offs / consequences:** One extra click. Digest v2 confirms that approval still happens in the sheet.
**Source:** Sprint 7 - Guide.md (identical copy in claude/)

## ADR-049: Main engine stays manual
**Status:** Accepted
**Context:** Apollo's free tier returns 0 results, the Clay hand-off is a human step, and self-hosted schedules only run while the host is up.
**Decision:** The main engine has no schedule and is run by hand. The alternative was scheduling it like the digest.
**Trade-offs / consequences:** Someone has to click Execute. ADR-068 applies the same idea to the order of the three workflows.
**Source:** Sprint 7 - Guide.md (identical copy in claude/)

## ADR-050: Apollo as a Code node with internal fetch
**Status:** Accepted
**Context:** A pluggable source must not break the Merge or the telemetry when Apollo fails.
**Decision:** Apollo is called from a Code node with `this.helpers.httpRequest` inside try/catch, the same pattern as the Job Radar connectors. The node always returns either data or a typed error marker. The alternative was an HTTP Request node with a separate error branch.
**Trade-offs / consequences:** The node always runs, so Merge and telemetry never break. ADR-065 keeps this pattern for all sources.
**Source:** Sprint 2 - Guide.md (originally numbered ADR-PGT-002 in Sprint 2 - Guide.md)

## ADR-051: Pluggable source contract
**Status:** Accepted
**Context:** Sprint 2 adds Apollo next to the seed list, and more sources are planned. This mirrors the Wavess/Oceanss connector interface.
**Decision:** A pluggable source is a normalized account schema, a config kill-switch and per-source telemetry. A new source only needs a mapper that outputs the normalized schema.
**Trade-offs / consequences:** Gates, scoring, the ledger and outputs stay untouched when sources are added.
**Source:** Sprint 2 - Guide.md (originally numbered ADR-PGT-003 in Sprint 2 - Guide.md)

## ADR-052: Deterministic country-to-UTC map instead of LLM geo inference
**Status:** Accepted
**Context:** The timezone gate needs an offset for each Apollo company at no cost.
**Decision:** A static country-to-UTC table maps the country to an offset.
**Trade-offs / consequences:** Costs nothing, is explainable and needs no cache. Countries not in the table fall through to the existing timezone gate.
**Source:** Sprint 2 - Guide.md (originally numbered ADR-PGT-004 in Sprint 2 - Guide.md)

## ADR-053: Waterfall over single provider for email finding
**Status:** Accepted
**Context:** Find as many emails as possible while keeping the cost per verified email low.
**Decision:** Email finding uses a cascade: Apollo, then Hunter, then an AI guess.
**Trade-offs / consequences:** In practice the Apollo API is blocked on the Free plan (ADR-060) and Tavily contacts are LinkedIn-only (ADR-070). The email waterfall now survives only as an optional Clay Work Email step.
**Source:** Roadmap.md (originally numbered ADR-003 in Roadmap.md)

## ADR-054: $env read in Code nodes
**Status:** Accepted
**Context:** API keys and the webhook URL must stay out of workflow JSON, so Code and expression nodes read them through `$env`.
**Decision:** Set `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`. The alternative was a credential per node.
**Trade-offs / consequences:** Any Code node can read every environment variable, which is acceptable for single-user self-hosting. Since n8n 2.0 the default is `true` (Run Guide), so the setting must be checked after an upgrade or a container rebuild.
**Source:** Project_Review_and_Fixes_Guide.md (unnumbered in its ADR table, identical copy in claude/)

## ADR-055: Digest posts first, then logs
**Status:** Accepted
**Context:** A failed Discord post must never mark rows as announced.
**Decision:** `digest_log` keys are written only after a successful post. The alternative was logging first.
**Trade-offs / consequences:** A crash between the post and the log can repeat one digest. That was chosen over silently losing one.
**Source:** Project_Review_and_Fixes_Guide.md (unnumbered in its ADR table, identical copy in claude/). The order is also described in Sprint 7 - Guide.md, section 5.7.

## ADR-056: Outreach queue ledger is the source of truth
**Status:** Accepted
**Context:** `contacts.status` can drift away from the queue (project review finding F7).
**Decision:** `doneSet`, built from the non-superseded rows of `outreach_queue`, decides whether a contact can be drafted. The alternative was a status flag on the contact.
**Trade-offs / consequences:** The status column can drift without breaking dedupe.
**Source:** Project_Review_and_Fixes_Guide.md (unnumbered in its ADR table, identical copy in claude/)

## ADR-057: Remove the source-side cap, let gates and the write cap control volume
**Status:** Accepted
**Context:** The HN source stopped at 15 posts before checking the ledger, so every run read the same 15 posts again.
**Decision:** The HN cap comes from config (400) and covers 2 monthly threads. Volume is controlled by the gates and the `max_companies_per_run` write cap. The alternative was keeping 15 and rotating through the thread with a saved cursor.
**Trade-offs / consequences:** Stateless and easy to explain. Process Accounts re-checks rejected posts on every run, which costs CPU only. A "rejected" ledger can be added later if this gets slow.
**Source:** claude/Sprint 7 Patch - Discovery Yield Guide.md (originally numbered ADR-1 in that doc)

## ADR-058: Allow unknown timezone and a score floor of 60, keep spending gates at 65
**Status:** Accepted
**Context:** Most HN posts state no timezone, and HN accounts cluster at scores of 58 to 64.
**Decision:** Set `allow_unknown_timezone = true` and `min_account_score = 60`. The contact, Clay and outreach gates stay at 65. The alternative was parsing timezones harder from HN text.
**Trade-offs / consequences:** More low-confidence rows in `accounts`. They cost nothing unless enrichment lifts them to 65 or more.
**Source:** claude/Sprint 7 Patch - Discovery Yield Guide.md (originally numbered ADR-2 in that doc)

## ADR-059: No job-board APIs
**Status:** Accepted
**Context:** The pipeline needs a company domain. Arbeitnow's feed has no company website, and Remotive's free feed is a small, delayed sample with strict call limits.
**Decision:** Do not add job-board APIs (Remotive, Arbeitnow) in this patch. The alternative was adding a domain-resolution step, which needs its own refactor sprint.
**Trade-offs / consequences:** Discovery stays on HN and seeds, and later the YC directory (ADR-061).
**Source:** claude/Sprint 7 Patch - Discovery Yield Guide.md (originally numbered ADR-3 in that doc)

## ADR-060: Apollo off until proven
**Status:** Accepted
**Context:** The Apollo request parameters did not match the docs, and the free credit allowance is small. Later, Apollo answered `API_INACCESSIBLE` on the Free plan (Sprint 7 Patch 2, section 6D).
**Decision:** Keep `sources.apollo.enabled = false` until a 1-credit pilot passes.
**Trade-offs / consequences:** HN and seeds carry discovery in the meantime. The fixed Apollo code stays in the workflow, switched off, for a future paid plan.
**Source:** claude/Sprint 7 Patch - Discovery Yield Guide.md (originally numbered ADR-4 in that doc)

## ADR-061: YC directory as the primary free source
**Status:** Accepted
**Context:** HN gives no headcount or funding and only a weak GTM signal, so the automated accounts it produced were weak.
**Decision:** Add a `YC Directory Source` node that reads the free, keyless yc-oss JSON feed, which includes real headcount, location and topic tags. Alternatives considered: job-board APIs, paid data, more HN threads.
**Trade-offs / consequences:** It is an unofficial community feed that can break or lag. The pool is finite (about 6,270 companies, mostly US), and every company is YC-backed, which is a bias. The node fails soft with an error marker.
**Source:** Sprint 7 Patch 2 - Automated Discovery Guide.md (identical copy in claude/, originally numbered ADR-1 in that doc)

## ADR-062: Do not retune scoring in the discovery patch
**Status:** Accepted
**Context:** The scorer counts generic keywords, so curated sources score high across the board and the score stops ranking them well.
**Decision:** Leave scoring as it is. Remove generic YC tags from the description text and add a keyword gate at the source for HN.
**Trade-offs / consequences:** `priority` will be true for most YC accounts. A scoring recalibration needs its own sprint with before and after evidence.
**Source:** Sprint 7 Patch 2 - Automated Discovery Guide.md (identical copy in claude/, originally numbered ADR-2 in that doc)

## ADR-063: HN keeps running behind a strong-keyword gate
**Status:** Accepted
**Context:** HN is free and occasionally surfaces a real RevOps or GTM hiring signal, but most matches came from one generic keyword.
**Decision:** Keep the HN source, but require at least one `strong_keywords` term as a whole word. The alternative was switching HN off.
**Trade-offs / consequences:** HN volume drops to a handful of accounts a month.
**Source:** Sprint 7 Patch 2 - Automated Discovery Guide.md (identical copy in claude/, originally numbered ADR-3 in that doc)

## ADR-064: Apollo labels come from the query, not Apollo's industry field
**Status:** Accepted
**Context:** Apollo's industry names never match `industries_include`, so even a correct search would be rejected at the gate.
**Decision:** `industry` and `company_type` come from the query's own labels. The raw Apollo industry is kept after a `|` for audit.
**Trade-offs / consequences:** `industry` is our label, not a measured fact.
**Source:** Sprint 7 Patch 2 - Automated Discovery Guide.md (identical copy in claude/, originally numbered ADR-4 in that doc)

## ADR-065: Sources stay as Code nodes
**Status:** Accepted
**Context:** Three sources already share one marker and telemetry pattern, and changing that mid-patch adds risk without improving yield.
**Decision:** The discovery sources stay as Code nodes. The alternative was native HTTP Request plus Loop nodes.
**Trade-offs / consequences:** More code to maintain. It belongs in the planned sub-workflow refactor.
**Source:** Sprint 7 Patch 2 - Automated Discovery Guide.md (identical copy in claude/, originally numbered ADR-5 in that doc)

## ADR-066: Contacts come from a search API with human review, not a people database
**Status:** Accepted
**Context:** The Clay people finder is gated on the Free plan, Apollo People Search is blocked on Free, and Apify LinkedIn scrapers break LinkedIn's terms. The other option was a fully manual lookup.
**Decision:** Tavily search, restricted to linkedin.com and parsed with fixed rules, writes into the same `contact_results` tab the manual path uses. A human reviews the rows.
**Trade-offs / consequences:** Free and recurring (1,000 credits a month, no card), 1 credit per account, and no change to the main workflow. Coverage depends on the search index, titles can be stale, and small firms often return nothing; the `NO_RESULT` marker plus a manual row is the fallback. No emails. Supersedes ADR-025. ADR-076 and ADR-077 amend it.
**Source:** Sprint 7 Patch 2 - Automated Discovery Guide.md (identical copy in claude/, originally numbered ADR-6 in that doc)

## ADR-067: The contact finder is a separate workflow
**Status:** Accepted
**Context:** The hand-off tab (`contact_results`) already exists, and the main workflow is a tested 59-node spine.
**Decision:** GTM Contact Finder is its own workflow. The alternative was adding its nodes to the main workflow.
**Trade-offs / consequences:** Zero risk to the spine, and the finder can be re-run alone. There are now two workflows to run in order. Chaining them with an Execute Workflow node belongs in the sub-workflow refactor.
**Source:** Sprint 7 Patch 2 - Automated Discovery Guide.md (identical copy in claude/, originally numbered ADR-7 in that doc)

## ADR-068: Manual run order, not one chained workflow
**Status:** Accepted
**Context:** A human must review the finder's `contact_results` before the engine uses them.
**Decision:** Run the finder, the engine and the digest by hand, in that order. The alternative was an Execute Workflow node that chains them.
**Trade-offs / consequences:** Three clicks per cycle, and nothing happens while you are away.
**Source:** claude/Run Guide - Sheets, Clay, n8n, Discord.md (originally numbered ADR-1 in that doc)

## ADR-069: Clay is optional for a run
**Status:** Accepted
**Context:** The Clay Free plan covers about 20 to 30 rows a month, and discovery already produces more than that.
**Decision:** Contacts and drafts do not wait for Clay enrichment.
**Trade-offs / consequences:** Drafts for accounts without a Clay summary rely on the tech stack only and read more generic. Clay rows go first to the accounts getting contacts that day.
**Source:** claude/Run Guide - Sheets, Clay, n8n, Discord.md (originally numbered ADR-2 in that doc)

## ADR-070: Tavily contacts are LinkedIn-only
**Status:** Accepted
**Context:** The Tavily finder returns LinkedIn profile URLs, not emails.
**Decision:** Contacts found by the finder carry no email, so every new draft is `linkedin_manual`.
**Trade-offs / consequences:** An honest gap that keeps guessed emails out of the queue.
**Source:** claude/Run Guide - Sheets, Clay, n8n, Discord.md (originally numbered ADR-3 in that doc)

## ADR-071: Fix pacing before adding providers
**Status:** Accepted
**Context:** 8 of 12 LLM calls failed. The cause was Groq's tokens-per-minute limit, and the circuit breaker turned one 429 into an outage that lasted the whole run.
**Decision:** First add pacing, retry-after handling, a cooldown that lets a provider come back, and lower reasoning effort. Extra model buckets are only the safety margin.
**Trade-offs / consequences:** Adding providers without pacing would only move the 429 around. Drafting gets slower (6 s between drafts, waits of up to 20 s within a 4-minute run budget).
**Source:** claude/Sprint 7 Patch 3 - Draft Quality and LLM Fallback Guide.md (originally numbered ADR-1 in that doc)

## ADR-072: Three Groq models on one key instead of a third provider
**Status:** Accepted
**Context:** Mistral and Cerebras now need a card for API access, OpenRouter's free models allow only 50 requests a day, and Groq's limits are per model.
**Decision:** The chain is groq (gpt-oss-120b), groq:qwen/qwen3.8-27b, groq:openai/gpt-oss-20b, gemini:gemini-3.5-flash-lite, then the template.
**Trade-offs / consequences:** Triples capacity at no cost. One provider carries 3 of the 4 buckets, so a Groq outage leaves only Gemini before the template. The Qwen model is a preview and can be withdrawn; that shows up as a logged 404.
**Source:** claude/Sprint 7 Patch 3 - Draft Quality and LLM Fallback Guide.md (originally numbered ADR-2 in that doc)

## ADR-073: Keep the template as the last resort
**Status:** Accepted
**Context:** When every LLM fails, the engine still has to produce a visible result.
**Decision:** Keep the deterministic template at the end of the chain. The alternative was skipping the contact. This reaffirms ADR-035.
**Trade-offs / consequences:** Every contact gets a row, and the failure is visible in telemetry. A template row marks the contact as used, so it has to be superseded to retry. The run budget handles slow providers without using up contacts.
**Source:** claude/Sprint 7 Patch 3 - Draft Quality and LLM Fallback Guide.md (originally numbered ADR-3 in that doc)

## ADR-074: Homepage facts are fetched inside the Code node
**Status:** Accepted
**Context:** Without a Clay summary, the LLM invented details. One free GET of the homepage title and meta description gives it real facts.
**Decision:** The homepage fetch runs inside the `Draft Outreach` Code node, which goes against the "native nodes first" rule.
**Trade-offs / consequences:** No new nodes or wires in the 59-node workflow. More code in one node. It belongs in the sub-workflow refactor.
**Source:** claude/Sprint 7 Patch 3 - Draft Quality and LLM Fallback Guide.md (originally numbered ADR-4 in that doc)

## ADR-075: One contact per company
**Status:** Accepted
**Context:** One run produced 3 drafts for Telli and 2 for Throxy. Several near-identical messages to a 15-person team on the same day look automated.
**Decision:** `outreach.max_contacts_per_account = 1`: only one live draft per company at a time.
**Trade-offs / consequences:** Fewer drafts per run. Rejecting a draft makes the next person at that company eligible.
**Source:** claude/Sprint 7 Patch 3 - Draft Quality and LLM Fallback Guide.md (originally numbered ADR-5 in that doc)

## ADR-076: YC directory before search for founder lookup
**Status:** Accepted
**Context:** A semantic search on a company name cannot tell two companies with the same name apart. The finder picked the wrong people for Twenty, Windmill, Nomi, PaletteHQ and Topo.
**Decision:** Read the public YC company page first, and accept it only when the website it lists equals the account domain. Rejected: Apollo or Clay people search (they cost credits) and LLM verification of each profile (cost, non-deterministic).
**Trade-offs / consequences:** Only covers YC companies, and it depends on YC's page markup. The `yc_lookup` config switch turns it off, and anything unresolved falls through to Tavily.
**Source:** claude/Sprint 7 Patch 4 - Contact Precision Guide.md (originally numbered ADR-021 in that doc)

## ADR-077: Deterministic location gate, flag instead of drop on unknown
**Status:** Accepted
**Context:** Tavily name matches attached people from other companies and countries.
**Decision:** Reject a profile on a clear country mismatch, keep it on a match, and keep it as `tavily_unverified` when neither side states a location.
**Trade-offs / consequences:** Dropping unknowns would cut volume hard, since many snippets carry no location. Flagging keeps volume and moves the decision to HITL review.
**Source:** claude/Sprint 7 Patch 4 - Contact Precision Guide.md (originally numbered ADR-022 in that doc)

## ADR-078: Competitors are filtered at the account stage, not the draft stage
**Status:** Accepted
**Context:** Windmill, a workflow engine that competes with n8n, scored 91 because its site mentions n8n.
**Decision:** Reject competitor accounts by setting their status, and exclude future ones with `keywords_exclude` ("workflow engine", "n8n alternative", "zapier alternative").
**Trade-offs / consequences:** The keyword list is short and maintained by hand. A competitor that describes itself differently still reaches HITL review.
**Source:** claude/Sprint 7 Patch 5 - Pitch Relevance Guide.md (originally numbered ADR-025 in that doc)

## ADR-079: Public repo with sanitized exports
**Status:** Accepted
**Context:** The workflows are the portfolio evidence, but raw n8n exports carry the sheet ID, Data Table IDs, credential IDs, the instance ID and a personal email.
**Decision:** Commit only exports passed through `scripts/sanitize_workflows.py`, which replaces identifiers with placeholders and refuses to write if it finds a key, bearer token or Discord webhook URL. Raw exports live in an ignored `exports/` folder.
**Trade-offs / consequences:** A reader must reconnect the sheet, tables and credentials after import (documented in SETUP.md). Live data (accounts, contacts, drafts) is never committed.
**Source:** claude/Sprint 8 - Portfolio Packaging Guide.md

## ADR-080: Recorded walkthrough instead of a hosted demo
**Status:** Accepted
**Context:** The engine runs on a laptop and touches real API keys and real people's public data. Hosting a live demo would need an always-on server and a sandboxed data set.
**Decision:** Show the system in a short Loom recording plus README screenshots, with contact details kept out of frame.
**Trade-offs / consequences:** A reviewer cannot click through the live system. The repo plus SETUP.md lets anyone reproduce it at $0.
**Source:** claude/Sprint 8 - Portfolio Packaging Guide.md

## ADR-081: Sending stays manual during dogfooding
**Status:** Accepted
**Context:** Free LinkedIn accounts allow only a few personalized connection notes per month, and automated LinkedIn activity breaks LinkedIn's terms (SPEC non-goal).
**Decision:** Send approved drafts by hand, record `send_status`, `sent_at` and `reply_received` in the sheet, and measure reply rate weekly.
**Trade-offs / consequences:** Volume stays low (about 10 to 20 touches a week). Each touch is reviewed and personal, which is the point of the engine. Superseded in part by ADR-083: sent status is recorded in the console with **Mark sent**.
**Source:** claude/Sprint 8 - Portfolio Packaging Guide.md

## ADR-082: Retire the Discord digest; the console is the only review surface
**Status:** Accepted
**Context:** The digest ran 7 times, all by hand; its 08:00 schedule never fired because n8n is off at that hour. Since the console went live it has handled every review, and its draft view shows every field of the Discord card.
**Decision:** Archive `Personal GTM Digest`, delete its `digest_log` Data Table and `digest_ops` tab, and remove the Digest tab and switch from the console. Keep Discord only for `GTM Engine: Error Alerts`.
**Trade-offs / consequences:** No push ping when new drafts land. Engine runs are started by hand, so the person running them already knows when to open the console. Neon keeps the frozen `digest_ops` table because `gtm_sync_pull()` declares a variable of its row type.
**Source:** claude/Sprint 12 - Clean-up and Packaging Guide.md (originally numbered ADR-S12-1 in that doc)

## ADR-083: Neon is the permanent system of record for outreach
**Status:** Accepted
**Context:** Since Phase 4b (`outreach_sor = neon`) drafts are written to Neon. The Sheet `outreach_queue` tab was 14 drafts behind, and the sync read it only to throw the data away.
**Decision:** Delete the Sheet `outreach_queue` tab and its sync reads. Neon `outreach_queue` is the only copy; approvals, edits and **Mark sent** happen in the console.
**Trade-offs / consequences:** Rolling back to `outreach_sor = sheets` now needs the tab restored from the archive copy of the Sheet.
**Source:** claude/Sprint 12 - Clean-up and Packaging Guide.md (originally numbered ADR-S12-2 in that doc)

## ADR-084: Archive before delete
**Status:** Accepted
**Context:** The clean-up removed tabs, workflows, a Data Table and Clay columns from a system in daily use.
**Decision:** Before any removal: a full copy of the Sheet, a Neon branch (`pre-s12`), JSON exports of every workflow, n8n archive instead of delete, and Clay CSV exports.
**Trade-offs / consequences:** About 10 minutes of backups. Every step can be undone.
**Source:** claude/Sprint 12 - Clean-up and Packaging Guide.md (originally numbered ADR-S12-3 in that doc)

## ADR-085: Hide Sheet columns, never delete them
**Status:** Accepted
**Context:** Some Sheet columns look unused, but every append node uses Map Automatically, whose default re-creates a missing column on the next run. `Pack Sync Payload` also maps every `accounts` and `contacts` column into Neon, and the console shows them.
**Decision:** Delete no columns. Hide them if a tab is too wide; the Sheets API still returns hidden columns to n8n.
**Trade-offs / consequences:** Tabs stay wide. The gain from deleting would be close to zero at 6 to 67 rows per tab.
**Source:** claude/Sprint 12 - Clean-up and Packaging Guide.md (originally numbered ADR-S12-4 in that doc)

## ADR-086: Keep Sheets as the engine's working store, bridged to Neon
**Status:** Accepted
**Context:** Two stores (Sheets for the engine, Neon for the console) is the strangler pattern from Sprint 10, half finished. Finishing it means swapping about 20 Sheets nodes in 6 workflows, and Clay reads its two queues from Sheets.
**Decision:** Keep `GTM Neon Sync` (every 15 minutes) and migrate accounts and contacts once, to the final target, after the CRM decision (HubSpot may become the system of record for companies and contacts).
**Trade-offs / consequences:** Two stores, and up to a 15-minute lag on account and contact data in the console.
**Source:** claude/Sprint 12 - Clean-up and Packaging Guide.md (originally numbered ADR-S12-5 in that doc)

## ADR-087: Workflow boundaries follow human steps and credit gates
**Status:** Accepted
**Context:** Eleven workflows looked like too many. Most sit on a real boundary: a human step (Contact Finder results, Clay runs, CSV exports), a paid-credit gate (Tavily, Clay) or an external tool.
**Decision:** Merge only workflows with the same trigger and the same input: `Clay Trigger Import` went into `GTM Clay Bridge` (both read `clay_export_accounts`). Keep the Clay email queue and import apart (a Clay run happens between them) and keep the Contact Finder apart from the Engine (manual Tavily spend gate). Group workflows in n8n folders.
**Trade-offs / consequences:** 8 workflows instead of 5 or 6. Each one is a place to inspect results and stop spend.
**Source:** claude/Sprint 12 - Clean-up and Packaging Guide.md (originally numbered ADR-S12-6 in that doc)

## ADR-088: Keep the `config` mirror tab and its push
**Status:** Accepted
**Context:** Config is owned by the console in Neon (`config_versions`). The Sheet `config` tab is a mirror.
**Decision:** Keep the tab and the sync's config push.
**Trade-offs / consequences:** One extra tab. Dropping it would leave `v_sync_health.pending_push` uncleared without a schema change.
**Source:** claude/Sprint 12 - Clean-up and Packaging Guide.md (originally numbered ADR-S12-7 in that doc)

## ADR-089: Clay on the Free plan: two tables, unused columns removed, auto-run off
**Status:** Accepted
**Context:** After the trial, the Clay Free plan allows 100 Data Credits and 500 Actions a month and 200 rows per table. A source refresh with auto-run on could run enrichments on new rows by itself.
**Decision:** Keep only `Accounts v2` and `Contacts Email`, delete the unused columns (`people_fallback`, `Find people at company`, `signal_ok`) and working views, switch auto-run off on both tables, and run enrichments by selection with `Clay Meter` before and after.
**Trade-offs / consequences:** Every Clay run is a deliberate click. None otherwise.
**Source:** claude/Sprint 12 - Clean-up and Packaging Guide.md (originally numbered ADR-S12-8 in that doc)

---

## Notes

- ADR-PGT-018 is cited in Sprint 5 People - Guide.md (config-screen checks for the Clay email waterfall column), but no doc defines it, so it is not listed here.
- Nothing in the source docs uses numbers 007 to 012, 018 to 020 or 027 to 032. To avoid confusion, renumbered ADRs start at 050 instead of filling those gaps.
- The ADR summaries in Roadmap.md, claude/Project Explainer for NotebookLM.md and Project_Review_and_Fixes_Guide.md were merged into the original ADRs where the decision is the same. Only their new decisions got new numbers (ADR-053 to ADR-056).
