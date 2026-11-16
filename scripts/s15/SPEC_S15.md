# SPEC additions for Sprint 15 (to merge into docs/SPEC.md)

`docs/SPEC.md` has uncommitted edits of yours, so Sprint 15 did not touch it. This file holds the SPEC text the plan
asks for (ICP per track, sources, gates, scoring, success metrics). Each heading names the SPEC section it belongs in.
Decisions are in `docs/ADR.md` (ADR-113 to 119); the how is in `docs/ARCHITECTURE.md` (Lead tracks, Gig lane).

## Section 8, Target account profile: one ICP per lead track

`lead_track` on `accounts` and `outreach_queue` says which ICP a row belongs to (ADR-113). Values: `smb_direct`,
`agency_partner`, `gig_post`. A missing or unknown value is read as `smb_direct`.

| Track | Who | Must have | Must not have | Offer |
|---|---|---|---|---|
| `smb_direct` (unchanged) | B2B SaaS and SMBs that could use GTM automation | The Sprint 14 profile | The Sprint 14 exclusions | Small fixed-scope tasks (`offers`) |
| `agency_partner` | Boutique GTM or automation agency (1 to 25 people) that sells Clay, n8n or HubSpot builds | A Clay experts or n8n experts listing; at least one `stack_keywords` hit; English among its languages; UTC -5 to +4 (D1) | Excluded tiers (Clay Elite Studio, n8n Enterprise, Make Platinum); pricing band `10k-a-month`; a known head count above 25 | `white_label_overflow`: scoped build tasks from their client work, under their brand |
| `gig_post` | A person or company posting a paid n8n, Clay, HubSpot or automation task in public | Hiring intent; a stack match; posted within `gig.max_age_hours` (72) | Offers of service (`[FOR HIRE]`), veto words (unpaid, equity only, language or country locks, crypto, casino, adult), more than `gig.max_replies` (25) replies, a stated rate under `gig.min_hourly_usd` (off) | The matching `offers` entry for the post |

## Section 14, Discovery sources

| Source | Track | How | Status |
|---|---|---|---|
| Clay experts directory (`www.clay.com/en/experts`) | `agency_partner` | `Partner Directories Source` reads the listing pages and each new profile once (`seen_directory_profiles`), from the page's embedded `__NUXT_DATA__` JSON, 1.5 s apart, at most `max_profiles_per_run` new profiles per run | On |
| n8n experts directory (`experts.n8n.io`) | `agency_partner` | Same node and parser | On |
| Make partners directory | `agency_partner` | Not built: Cloudflare challenge for non-browser clients | Off (D2) |
| n8n community Jobs category | `gig_post` | The forum's own notification emails (Watching First Post), labelled `gtm-gigs` in Gmail, read by `Read Forum Mail`. No request to the forum: its terms forbid automated access | On once a Gmail credential exists |
| Console **Add a post by hand** | `gig_post` | `gtm_gig_add()`; key `manual:<hash>`, or the forum topic key when the link is a forum topic | On |
| HN "Freelancer? Seeking freelancer?" | `gig_post` | `HN Freelancer Source`, Algolia API | Off (0 hiring posts in 4 months) |
| Make community Hire a Pro | `gig_post` | Not built: same terms as the n8n forum | Off (D2) |

Every source passed a go or no-go check on robots.txt and terms before it was built (ADR-119, `scripts/s15/SPIKE.md`).

## Section 15, Normalized company schema: agency rows

Directory profiles use the same schema as `YC Directory Source`, with `company_type = agency`, `industry = 'gtm agency | <services>'`,
`employee_count` empty (directories give no head count), `funding_stage = unknown`, `lead_track = agency_partner`, and
`source_meta` (JSON: directory, slug, profile_url, tier, services, languages, pricing, min_engagement, icps, regions,
company_focus, rating, reviews, availability, contact_form). The listing itself is the trigger:
`clay_trigger = 'Listed in the <directory> (<tier>): <top 3 services>'`, `clay_trigger_source = directory`, dated the fetch day (ADR-117).

## Section 16, Deterministic hard filters: per track

- `smb_direct`: unchanged.
- `agency_partner` (in `Partner Directories Source` and `Process Accounts`): excluded tier, excluded pricing band
  (`agency_pricing`), required language, UTC offset window, head count above `employee_max` when known
  (`allow_unknown_size` lets unknown through), no stack keyword, score below `min_account_score` (60). Each drop is
  counted in `ops.rejection_summary`. The small-team gate and the product-overlap gate do not apply (ADR-117).
- `gig_post` (in `Gig Gates`, in this order, before any LLM call): seen, intent, freshness, crowding, veto words, stack
  match, hourly rate floor. Gated posts are stored as `gated_out` with `gate_reason` and counted in `gig_ops` (ADR-116).

## Section 21, Scoring per track

**`agency_partner`, at discovery** (`Process Accounts`):
`0.35 stack_fit + 0.25 capacity_need + 0.20 size_fit + 0.20 tz_language_fit`

| Component | Rule |
|---|---|
| stack_fit | `stack_keywords` hits in name, services and description: 3+ = 100, 2 = 75, 1 = 50, 0 = 0 |
| capacity_need | 40, plus 20 for 3+ reviews, plus 20 for hiring, overflow, white-label or subcontract words, plus 20 when the profile says available; a careers page found at enrichment adds 20; max 100 |
| size_fit | By tier (Advanced Artisan, Artisan, Select 100; Studio, Premium 70; other 60); 90 when the pricing band allows small budgets; 100 for a known head count of 10 or less, 80 up to 25 |
| tz_language_fit | UTC 0 to +2 = 100, +3 to +4 = 80, -5 to -4 = 60, other 30, unknown 50; capped at 30 when English is not listed |

**`agency_partner`, after contacts** (`Rescore Accounts`): `0.30 stack + 0.20 capacity + 0.20 size + 0.15 tz_lang + 0.15 contact_feasibility`.
Agency rows go to Contact Finder at `min_account_score` 60 (SMB: 65) and are never queued for Clay research (ADR-118).

**`gig_post`** (`Score Gigs`): `0.35 stack_fit + 0.20 intent + 0.15 freshness + 0.15 competition + 0.10 budget_signal + 0.05 remote_fit`, plus 10, capped at 100.

| Component | Rule |
|---|---|
| stack_fit | Matched stack words: 3+ = 100, 2 = 75, 1 = 50, keyword only = 25 |
| intent | Hiring 100, unclear 40 |
| freshness | Under 12 h 100, under 24 h 80, under 48 h 50, older 20, unknown 50 |
| competition | Replies 0 to 3 = 100, 4 to 10 = 70, more = 40, unknown (mailed posts) = 70 |
| budget_signal | A paid trial, or a stated rate at or above the floor: 100; otherwise 50 |
| remote_fit | Remote mentioned 100, otherwise 60 |
| bonus | 10 for agency, ongoing, retainer, long-term or white-label words |

A post at `gig.min_score` (60) or above gets a draft, highest score first, at most `gig.max_drafts_per_run` per run;
at `gig.discord_ping_min_score` (75) or above it also pings Discord.

## Section 26 and 27, Outreach per track

- `agency_partner`: angles `white_label_overflow`, `stack_specific_help` (their services include n8n, Clay or HubSpot)
  and `hire_bridge` (careers page found). Validator v3 adds: name one of their services outside my own proof sentence,
  offer one small first task, no seniority claims. The no-partnership rule still holds. The signature link is added by
  code after validation (D3). A profile with a contact form gets channel `contact_form` and the profile link in notes.
- `gig_post`: one reply of 60 to 130 words per post, angle `gig_reply`, written with the Draft Outreach LLM router.
  The gig validator rejects links, invented numbers and seniority claims; the signature with two portfolio links is
  added by code. Channel `forum_dm` when the post invites a DM. Ids `gig:<post_key>` (ADR-114).

## Section 6, Success metrics: Sprint 15 targets (2 weeks after the first real run, measured in Neon)

| Metric | Target | Query |
|---|---|---|
| Qualified gig posts surfaced per week (score >= `gig.min_score`) | 5+ | `gig_posts` where `gig_score >= 60`, by `first_seen_at` week |
| Median gig post age when reviewed | under 24 h | `console_events` review time minus `gig_posts.posted_at` |
| Agency accounts scored | 40+ | `accounts` where `lead_track = 'agency_partner'` |
| Agency accounts with a usable channel (email, LinkedIn or contact form) | 20+ | Agency `contacts` with email or LinkedIn, plus `source_meta.contact_form = true` |
| Drafts approved and sent (both new tracks) | 20+ | `outreach_queue` where `lead_track <> 'smb_direct'` and approved or sent |
| Replies | 2+ | `reply_received`, plus gig posts marked Replied |
| Paid tasks | 1 | Gig posts marked Won, or a won agency deal |

Kill rule: 30 agency sends with 0 replies means the pitch or the tier hypothesis is wrong. Stop sending, review the drafts, change one variable.

## Section 11, Workflows

12 active workflows: add `GTM Gig Finder` (26 nodes, folder `1 Core`), called first by `GTM Run` and every 3 hours once published.
Engine 74 nodes, `GTM Run` 10, `GTM Neon Sync` 20.
