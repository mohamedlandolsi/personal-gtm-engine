# Loom segment: Clay enrichment layer (75 seconds)

Add this segment to the walkthrough after the Enrich stage. Numbers are from `clay_ops`, `clay_results` and `contacts` as of 2026-10-14 (claims G16 to G20).

## Before recording

- Open these tabs in order: Google Sheet (`clay_queue`, `clay_contacts_queue`, `clay_ops`), Clay `Accounts v2` (`research` column config), Clay `Contacts Email` (default view), Discord digest.
- Make the Clay window full screen so the toolbar and the **Tools** button are visible.
- Founders' work emails are visible in `Contacts Email` and in the digest. Hide the `Work Email` and `email_clay` columns, or zoom so addresses are unreadable, before you record.

## Script

| Time | Show | Say |
|---|---|---|
| 0:00 to 0:10 | `clay_queue`, then `clay_contacts_queue` | "n8n decides who goes to Clay. Clay never picks targets: only accounts that score high enough, and one founder per account." |
| 0:10 to 0:25 | `Accounts v2` > `research` > Edit column | "One structured AI call per account instead of three, on the cheapest model, with a run condition. That took the cost from 2.8 credits to 1.0 per account, and the 10 low-score rows cost nothing." |
| 0:25 to 0:45 | `Contacts Email` > `Work Email` > Full configuration, then the 24 result rows | "For email, a waterfall that tries providers in order, with Conservative validation. 19 of 20 founders came back verified, and all 4 emails I had guessed were confirmed before being marked verified." |
| 0:45 to 1:00 | `clay_ops` | "Every batch is metered: n8n reads the Clay balance through the Public API before and after. The whole email run cost 11.7 credits, about half a credit per verified email." |
| 1:00 to 1:15 | Discord card showing `(verified)` | "The engine now has an email channel for follow-ups. A person still approves and sends every message." |

## After recording

Paste the Loom link into `README.md` (replace `LOOM_LINK_HERE`) if this segment is part of the main walkthrough.
