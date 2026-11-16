# Sprint 15 Phase 0: source spike

Date: 2026-11-15. Fetched with curl from the same machine that runs n8n (Docker), generic user agent, 2 s between requests.
Fixtures are in `scripts/s15/fixtures/`. No workflow was edited.

## 1. Go / no-go

| Source | robots.txt | Terms | Fetch result | Decision |
|---|---|---|---|---|
| Clay experts (`www.clay.com/en/experts`, `/en/experts/partner/<slug>`) | Allowed. Only `/*_page=` is disallowed; the directory paginates with `?page=N`, which is allowed | `clay.com/legal/terms-of-service` covers use of the Clay product ("Services"). No clause on browsing or fetching the public website | 200, data embedded in the page | **Go**, low volume, 1.5 s politeness |
| n8n experts (`experts.n8n.io/?page=N`, `/partner/<slug>`) | `Allow: /` | n8n publishes no website terms (`n8n.io/legal/` lists product terms only). No clause found | 200, data embedded in the page | **Go**, low volume, 1.5 s politeness |
| Make partners directory (`www.make.com/en/partners-directory`) | Allowed for the directory path | Not readable: the site answers non-browser clients with a Cloudflare challenge ("Just a moment...", HTTP 403) | 403 | **No-go** for automation. D2 keeps Make off anyway; if turned on, Cowork does a manual sweep into `seed_accounts` |
| n8n community Jobs (`community.n8n.io/c/jobs/13`) | Allowed (only `/c/*.rss`, `/t/*/*.rss`, `/search` and account paths are disallowed) | **Forbidden.** `/tos`: "You may not automate access to the forum, or monitor the forum, such as with a web crawler, browser plug-in or add-on, or other computer program that is not a web browser." | Not fetched (terms) | **No-go** for automated fetch. See section 4 for the replacement |
| Make community Hire a Pro (`community.make.com/c/hire-a-pro/50`) | Same Discourse rules as above | Same clause in `/tos` | Not fetched (terms) | **No-go** for automated fetch |
| HN "Freelancer? Seeking freelancer?" | Public Algolia and HN APIs, built for programmatic use | No restriction | 200 | **Technically go, but no yield**: 0 `SEEKING FREELANCER` posts in the last 4 monthly threads (Aug 15, Sep 24, Oct 21, Nov 18 top-level comments, all `SEEKING WORK`). Recommend off |
| HN "Who is hiring" as a contract source (checked as a fallback) | Same | Same | 200 | **No yield**: November 2026 has 244 top-level posts, 33 mention contract/freelance/part-time, 3 of those also match a stack word, and all 3 are false positives ("contract automation" products, full-time roles) |

Note on the plan: robots.txt alone would have allowed both forums. The terms are what rule them out, so ADR-119 should cover every source (directories and forums), not only directories.

## 2. Where the data sits

### Clay experts and n8n experts (same platform)

Both directories are hosted by PartnerPage (a Nuxt app). Each page embeds its data as JSON in
`<script type="application/json" id="__NUXT_DATA__">`, in Nuxt's devalue format: one flat array where objects
hold indexes into the array instead of values. A 25-line resolver turns it back into plain objects (the Python
version used for this spike is in section 6; the Code node needs the same in JavaScript).

The page also calls a JSON API on `admin.partnerpage.io`. That is a third-party host the directory owners do not
control, so the parser reads only the directory pages themselves.

| Page | Path | What it holds |
|---|---|---|
| Clay listing | `/en/experts?page=N` (29 per page, 196 results, 7 pages, sorted by tier) | `count`, `next`, `results[]` with `title`, `slug`, `website`, `headline`, `description` (HTML), `tier.title`, `availability`, `rating`, `numberOfReviews` |
| Clay profile | `/en/experts/partner/<slug>` | All listing fields plus `location` (free text, e.g. "San Jose, CA"), `assignedFilterOptions` grouped by `filters` (Expertise, ICPs, Industry, Language, Pricing, Minimum Engagement), `contactRequestsEnabled`, `supportEmail` |
| n8n listing | `/?page=N` (29 per page, 48 results with the default `availability=true` filter, 2 pages) | Same listing fields |
| n8n profile | `/partner/<slug>` | Same profile fields; filters are Services, Project Budget, Region, Language, Company Type Focus; location is `locations[]` with `title`, `countryName`, `cityName` |

Tiers seen on page 1: Clay `Elite Studio` 6, `Studio` 14, `Advanced Artisan` 9 (later pages hold the lower tiers).
n8n `Enterprise` 1, `Premium` 9, `Select` 19. The config's `exclude_tiers` (`clay:elite studio`, `n8n:enterprise`) match these names.

Pricing is the best size signal: the Clay profile sample (CS2) says "$10k+ a month" and "6 months" minimum
engagement, so it is not a boutique. Clay pricing options are `any-budget`, `5k-a-month`, `10k-a-month`.

### HN

`hn.algolia.com/api/v1/search_by_date?query="Freelancer? Seeking freelancer?"&tags=story` returns the monthly
threads (two posters in September: pick the hit with the most comments in the latest month), then
`/api/v1/items/<id>` returns `children[]` with `id`, `author`, `created_at`, `text` (HTML).

## 3. Field maps

### Directory profile to the normalized company schema (SPEC section 15, same shape as `YC Directory Source`)

| Engine field | Clay experts | n8n experts |
|---|---|---|
| `source` | `clay_experts` | `n8n_experts` |
| `company_name` | `title` | `title` |
| `domain` | host of `website` (same `toDomain` as the YC node) | same |
| `website` | `website` | `website` |
| `industry` | `'gtm agency \| ' + Expertise names` | `'gtm agency \| ' + Services names` |
| `company_type` | `agency` | `agency` |
| `employee_count` | empty (unknown) | empty (unknown) |
| `location_raw` | `location` | `locations[].title` joined with `; ` |
| `country` | last part of `location` (US state codes map to United States) | `locations[0].countryName` |
| `timezone_utc_offset` | YC node `PLACES` matcher on `location_raw` | same; fallback from Region (Europe 1, North America -5) |
| `funding_stage` | `unknown` | `unknown` |
| `description_text` | headline + description (HTML stripped) + Expertise + tier + languages + pricing + minimum engagement, max 2500 chars | headline + description + Services + tier + languages + project budget + company type focus |
| `status`, `linkedin_url` | `new`, empty | `new`, empty |
| `lead_track` | `agency_partner` | `agency_partner` |
| `source_meta` (JSON) | `{directory, slug, profile_url, tier, services, languages, pricing, min_engagement, icps, rating, reviews, contact_form}` | `{directory, slug, profile_url, tier, services, languages, budget, regions, company_focus, rating, reviews, availability, contact_form}` |
| Trigger (ADR-117) | `clay_trigger = 'Listed in the Clay experts directory (<tier>): <top 3 services>'`, `clay_trigger_source = directory`, `clay_trigger_date` = fetch date | same with "n8n experts directory" |
| Contact channel hint | `contactRequestsEnabled = true` means the profile has a contact form: `contact_form` with `profile_url` | same |

Seen-profile key for the `seen_directory_profiles` Data Table: `clay:<slug>` / `n8n:<slug>`.

### Gig post to `gig_posts`

| Column | From a forum notification email (section 4, option A) | From HN (if ever turned on) |
|---|---|---|
| `post_key` | `n8n:<topic_id>` from the topic link `/t/<slug>/<topic_id>` | `hn:<comment id>` |
| `platform` | `n8n_forum` (or `make_forum`) | `hn_freelancer` |
| `url` | topic link | `https://news.ycombinator.com/item?id=<id>` |
| `title` | subject without the `[n8n Community] [Jobs]` prefix | first line of `text` |
| `body_text` | email body, plain text, max 4000 | `text`, HTML stripped |
| `poster` | sender display name | `author` |
| `posted_at` | email `Date` | `created_at` |
| `reply_count` | NULL (not in the email; competition score uses "unknown") | NULL |
| `contact_email`, `contact_hint`, `stated_budget`, `remote_hint`, `matched_stack`, `intent`, `gig_score` | computed by `Gig Gates` / `Score Gigs` from title + body, as planned | same |

## 4. Impact on the gig lane (decision for Mohamed)

As planned, the gig lane has no usable automated source: both forums forbid automated access, and HN has no
hiring posts. Options:

| Option | How | Cost | Compliance |
|---|---|---|---|
| **A. Forum email notifications** (recommended) | You set the n8n community Jobs category to "Watching First Post" with email notifications on. The forum emails you every new topic. `GTM Gig Finder` reads those emails from Gmail (a Gmail trigger or a Gmail "get many" node with a label filter), parses them, then runs the planned gates, scoring and drafting | You create a Gmail OAuth2 credential in n8n (free; none exists today) and a Gmail filter that labels the forum mails. Reply counts are unknown, so the crowding gate only uses age | The forum sends the email; n8n reads your own inbox. No automated access to the forum |
| B. Manual add | A small "Add gig" form in the console (paste URL + text) calls `gtm_gig_upsert()`; the Gig Finder drafts replies for posts you added | Phase 5 form, no new credential | Fully manual on the forum side |
| C. Defer the gig lane | Ship the agency lane first, keep the gig tables for later | None | n/a |

A and B can be combined (B is a cheap fallback for posts you find elsewhere). HN stays coded as a config switch,
off by default, or is not built at all. Make stays off (D2).

What changes in the plan if you pick A: Phase 3 swaps `n8n Forum Source` / `Make Forum Source` for one
`Forum Mail Source` node, `HN Freelancer Source` is built but disabled, and the pilot fixture becomes a saved
notification email instead of Discourse JSON. Nothing changes in the Phase 1 tables.

**Decision (2026-11-15): A + B.** Forum notification emails read by the `Read Forum Mail` Gmail node (shipped
disabled until a Gmail OAuth2 credential exists), plus the console **Add a post by hand** form (`gtm_gig_add()`).
`HN Freelancer Source` is built and off by config (`gig.sources.hn_freelancer.enabled = false`). Make stays off (D2).
Recorded in ADR-119; setup steps in `docs/SETUP.md`, section 8, Sprint 15.

## 5. Fixtures

| File | Source | Note |
|---|---|---|
| `clay_list.html` | `https://www.clay.com/experts` (redirects to `/en/experts`) | Trimmed to the `__NUXT_DATA__` block; parser input is identical |
| `clay_profile.html` | `https://www.clay.com/experts/partner/cs2` | Trimmed the same way |
| `n8n_experts_list.html` | `https://experts.n8n.io/` | Trimmed the same way |
| `n8n_experts_profile.html` | `https://experts.n8n.io/partner/2v-automation` | Trimmed the same way |
| `n8n_experts_sitemap.xml` | `https://experts.n8n.io/sitemap.xml` | 52 locations, profile slugs included |
| `hn_search.json` | Algolia `search_by_date` for the freelancer thread title | Shows the two September posters |
| `hn_freelancer.json` | Algolia `items/50338744` (November 2026) | 18 top-level comments, 0 hiring posts |

Not saved: forum JSON (terms), Make pages (403), Clay `sitemap.xml` (16 MB and lists no partner profiles).

## 6. Nuxt payload resolver (reference for the Code node)

```python
def resolve(arr):
    memo = {}
    WRAP = ('ShallowReactive', 'Reactive', 'Ref', 'ShallowRef', 'EmptyRef', 'EmptyShallowRef')
    def r(i):
        if not isinstance(i, int) or i < 0: return None
        if i in memo: return memo[i]
        v = arr[i]
        if isinstance(v, list):
            if v and isinstance(v[0], str) and v[0] in WRAP: out = r(v[1]) if len(v) > 1 else None
            elif v and v[0] == 'Set': out = [r(x) for x in v[1:]]
            elif v and v[0] == 'Date': out = v[1]
            else:
                memo[i] = out = []
                out.extend(r(x) for x in v)
        elif isinstance(v, dict):
            memo[i] = out = {}
            for k, x in v.items(): out[k] = r(x)
        else: out = v
        memo[i] = out
        return out
    return r(0)
# root = resolve(json.loads(<__NUXT_DATA__ text>)); listing = the dict in root['data'] with 'count' and the most 'results'
```
