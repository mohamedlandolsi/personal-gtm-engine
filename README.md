# Personal GTM Engine

An outbound engine built in n8n that finds B2B startups likely to need GTM automation, verifies who their founders are, writes a grounded first message for each, and sends every draft to Discord for human approval. It runs on free tiers only and never sends anything by itself.

> **Demo:** [3-minute Loom walkthrough](LOOM_LINK_HERE)

## What it does

| Stage | Output |
|---|---|
| **Discover** | Companies from Y Combinator's public directory, Hacker News "Who is hiring" threads and a hand-picked seed list |
| **Filter** | Deterministic gates (domain, size, industry, keywords, timezone, seen-before) run before any paid or LLM call |
| **Score** | An explainable 0-100 account score with its breakdown and reasons |
| **Enrich** | Tech stack and hiring signals from the company's own website, then a metered Clay enrichment layer (below) |
| **Find people** | Founders read from the company's YC page (verified by website domain), Tavily search as a gated fallback |
| **Draft** | A LinkedIn note, a long message and three follow-ups, written by a Groq/Gemini fallback chain and checked by a rule-based validator |
| **Review** | One Discord card per draft with everything needed to decide; approval happens in the sheet |

Clay enrichment layer: one structured AI call per account (1.0 credit, was 2.8), Work Email waterfall with Conservative validation (19/20 founders verified, about 0.5 credit per verified email), credits metered by n8n through Clay's Public API.

```mermaid
flowchart LR
    A["Sources: YC, HN, seeds"] --> B["Hard filters + score"]
    B --> C["Website enrichment"]
    C --> D["Founder lookup: YC page, then Tavily"]
    D --> E["LLM draft + validator"]
    E --> F["Discord review card"]
    F --> G{{"Human approves, sends by hand"}}
```

Full diagrams: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Results from the live runs

Numbers below come from the engine's own telemetry (`ops` and `digest_ops` tabs), October 2026.

| Metric | Value |
|---|---|
| YC directory rows screened per run | 377, of which 23 pass the gates |
| Hacker News job posts screened per run | 495, of which 14 pass the gates |
| Accounts in the sheet | 48, each with a score breakdown |
| Founders found from YC pages | 19 people at 10 companies, 0 search credits |
| Drafts in the last run | 8 of 8 accepted by the validator, 0 fell back to the template |
| LLM calls in the last run | 27, of which 19 were retries after a validator rejection or a rate-limit wait. No draft lost. |
| Messages sent without approval | 0 |
| Monthly cost | $0 |

## Screenshots

**Discord review card**: one per draft, with everything needed to decide.

![Discord review card](screenshots/discord-card.png)

**Workflows in n8n**

| Personal GTM Engine | GTM Contact Finder | Personal GTM Digest |
|---|---|---|
| ![Personal GTM Engine workflow](screenshots/Personal-GTM-Engine-Canva.png) | ![GTM Contact Finder workflow](<screenshots/GTM-Contact Finder-Canva.png>) | ![Personal GTM Digest workflow](screenshots/Persona-GTM-Digest-Canva.png) |

**Google Sheet**: accounts with score breakdowns, and the `ops` telemetry tab.

![Accounts tab](screenshots/sheet-accounts.png)

![Ops tab](screenshots/ops.png)

**Clay enrichment layer**: one structured research call per account, a run condition that skips low-score rows, and the email waterfall's cost history.

| Research column config | Accounts v2 table |
|---|---|
| ![Clay research column config](screenshots/c1-research-config.png) | ![Accounts v2 table](screenshots/c1-table.png) |

| Work Email waterfall config | Waterfall cost history |
|---|---|
| ![Work Email waterfall config](screenshots/c2-waterfall-config.png) | ![Clay History for the email waterfall](screenshots/c2-history.png) |

**Clay workflows in n8n**

| Clay Meter | GTM Clay Bridge | Clay Email Queue | Clay Email Import |
|---|---|---|---|
| ![Clay Meter workflow](screenshots/Clay-Meter-Canva.png) | ![GTM Clay Bridge workflow](screenshots/GTM-Clay-Bridge-Canva.png) | ![Clay Email Queue workflow](screenshots/Clay-Email-Queue-Canva.png) | ![Clay Email Import workflow](screenshots/Clay-Email-Import-Canva.png) |

## Why it is built this way

| Principle | Where it shows |
|---|---|
| Deterministic gates before LLMs | Filters, scoring, tool detection, product-term guard and validation are plain code. The LLM only writes text from facts it is given. |
| Fallback chains | 3 Groq models, then Gemini, then a deterministic template. A draft row is always written. |
| Explainable scoring | Every account carries `score_breakdown`, `why_match` and `red_flags`. |
| Idempotent runs | Ledgers in n8n Data Tables and the outreach queue mean a re-run never duplicates rows or messages. |
| Telemetry first | Every run appends counters and error samples to `ops`. Debugging starts there. |
| Human in the loop | The system drafts and alerts. A person approves and sends. |

Decision log: [docs/ADR.md](docs/ADR.md) (66 architecture decision records). Original design: [docs/SPEC.md](docs/SPEC.md).

## Stack

| Layer | Tool | Plan |
|---|---|---|
| Orchestration | n8n, self-hosted in Docker | Free |
| State and review | Google Sheets via a service account, n8n Data Tables | Free |
| Discovery | YC public directory, HN Algolia API, seed sheet | Free |
| Enrichment | Website fetch with regex signatures, Clay (structured AI research, Work Email waterfall, Public API meter) | Free / free credits |
| People | YC company pages, Tavily Search | Free / free credits |
| LLM | Groq (`openai/gpt-oss-120b`, `qwen/qwen3.8-27b`, `openai/gpt-oss-20b`), Gemini | Free tiers |
| Review | Discord webhook | Free |

## Repository layout

```text
workflows/                    sanitized n8n exports (import these)
  personal_gtm_engine.json    discovery, scoring, enrichment, contacts, drafting
  gtm_contact_finder.json     founder lookup: YC pages, then Tavily
  personal_gtm_digest.json    Discord review cards
  clay_meter.json             reads the Clay credit balance into clay_ops
  gtm_clay_bridge.json        imports the Clay accounts export into clay_results
  clay_email_queue.json       picks one primary contact per account for Clay
  clay_email_import.json      applies Clay email results to contacts
config/config.example.json    the full runtime config (lives in the sheet's config tab)
docs/ARCHITECTURE.md          diagrams and stage details
docs/SHEET_SCHEMA.md          every tab, header row and status value
docs/SETUP.md                 step-by-step install
docs/ADR.md                   architecture decisions
docs/SPEC.md                  original specification
scripts/sanitize_workflows.py strips IDs, emails and secrets from n8n exports
.env.example                  environment variables the workflows read
```

## Quick start

1. Create the Google Sheet with the tabs in [docs/SHEET_SCHEMA.md](docs/SHEET_SCHEMA.md) and paste `config/config.example.json` into `config!B2`.
2. Set the variables from `.env.example` in your n8n container.
3. Import the three files in `workflows/`, then reconnect credentials, the sheet and the Data Tables.
4. Run: Engine, then Contact Finder, then Engine again, then Digest.

Details and expected outputs: [docs/SETUP.md](docs/SETUP.md)

## Known limits

- Runs on demand. Scheduling needs n8n to be running, which is not worth an always-on host at this volume.
- Founder lookup is strongest for YC companies. Others rely on search with name, company and location gates, and a human check.
- The product-term guard catches companies that describe their product with repeated words. A product named once can slip through, which the review step catches.
- Free LinkedIn accounts allow only a handful of personalized connection notes per month, so the daily draft cap is deliberately low.

## License

MIT
