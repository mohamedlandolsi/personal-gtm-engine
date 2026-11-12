# Sprint 14 unattended run: report

Run on 2026-11-11 and 2026-11-12, git branch `s14-engine-fixes` (7 local commits, nothing pushed, `main` untouched).
Nothing was published, unpublished, archived or executed in n8n. Neon production was only read through the branch copy; every write went to branch `s14-test`. No Sheet, Gmail, HubSpot, console live data or `.env.local` was touched.

## Tools

| Check | Expected | Actual | Pass |
|---|---|---|---|
| Guide found | `../../Sprints/Sprint 14 - Engine Fixes Guide.md` | Found, read in full (934 lines) | yes |
| n8n MCP | get_workflow_details, update_workflow, validate_workflow | All present | yes |
| Neon MCP | create_branch, get_connection_string, run_sql | All present | yes |
| Guide code blocks copied by script | Phase 2 rules, TECH 3.1, rules 4.1, prompt 4.2 | `scripts/s14/extract_guide_blocks.mjs` writes `scripts/s14/guide/*`; every node build checks the block is verbatim inside the node | yes |

## Per step

### 1. Phase 1.1, offline SQL test

| Check | Expected | Actual | Pass |
|---|---|---|---|
| `node scripts/s14_sql_test.mjs` (PGlite in `C:\temp\pgl`, already installed) | 19 PASS, "All checks passed" | 19 PASS, "All checks passed", exit 0 | yes |

### 2. Phase 1.2 and 1.3, branch `s14-test`

Branch `s14-test` (`br-still-snow-b98xnsnb`) created from `production`. The migration was applied with node and `@neondatabase/serverless` (`scripts/s14/neon_branch.mjs`, which refuses any host other than the s14-test endpoint; the connection string was never written to the repo). The branch is kept.

| Check | Expected (Phase 0 not done) | Actual | Pass |
|---|---|---|---|
| Apply `db/s14_engine_fixes.sql`, run 1 | succeeds | succeeded | yes |
| Apply, run 2 | succeeds | succeeded | yes |
| `account_vetoed` | 12 | 12 | yes |
| `draft_rejected_account` | 19 | 19 | yes |
| `outreach_approval_chk` | lists `needs_redraft` | lists `needs_redraft` | yes |
| `v_review_queue` count | 81 | 81 | yes |
| `v_accounts` with `block_reason` | 31 | 31 | yes |

### 3. Phase 2.1 and 2.2, draft selection (`Personal GTM Engine`)

Each node body was built by `scripts/s14/build_phase2.mjs` from the live body plus the guide block, saved to `scripts/s14/<node>.js`, applied with one `update_workflow`, then re-read with `get_workflow_details` and byte-compared with the file (`scripts/s14/live_verify.mjs`).

| Check | Expected | Actual | Pass |
|---|---|---|---|
| New node `Fetch Outreach Blocks` | Postgres, `select account_id, reason from v_outreach_blocks;`, credential Neon GTM, alwaysOutputData, executeOnce | Exactly that; `validate_node_config` valid | yes |
| Rewire | Fetch Outreach Queue -> Fetch Outreach Blocks -> Select Outreach Pairs | Confirmed in the live connections | yes |
| `Select Outreach Pairs` | items a to i of C14-2a | Live body = file, 10443 chars, rules block verbatim | yes |
| `Merge Contact Results` | CEO before founder, Founder/CTO is cto, RA cto 60, REL cto 50 | Live body = file | yes |
| `Select Contact Batch` | sort by final_score + region bonus | Live body = file, EU_UK verbatim | yes |
| `Run Stats` | `outreach_<key>:<n>` in rejection_summary | Live body = file | yes |
| Totals | 4 changed nodes, 1 new node, 2 changed connections | 4 changed, 1 new, 1 connection removed and 2 added | yes |

n8n versions: `S14: Fetch Outreach Blocks`, `S14: Select Outreach Pairs`, `S14: Merge Contact Results`, `S14: Select Contact Batch`, `S14: Run Stats`.

### 4. Phase 2.3, dry run on `s14-test` fixtures (read only)

Fixtures saved by script to `scripts/s14/fixtures/` (git-ignored: they hold prospect data). `node scripts/s14/dry_select_pairs.mjs`.

| Check | Guide | Actual | Pass | Why it differs |
|---|---|---|---|---|
| Pairs at blocked accounts | 0 | 0 | yes | |
| `skipped_blocked` | 12 (9 blocked accounts, incl. Pedro Nascimento, Ad Army) | 12 at 9 accounts (7 `account_vetoed`, 5 `draft_rejected_account`), Pedro Nascimento included | yes | No difference. Phase 0 changes only which reason blocks these accounts, not whether they are blocked |
| Pairs with buyer_score < 60 | 0 | 0 | yes | |
| Pairs under 10 people | only `trigger_ok` | 0 pairs | yes | |
| Pair count | 0; the other 6 unused contacts sit at accounts with a live draft or score below 70 | 0; `skipped_per_account_cap` 3 (Moby, telli x2) + 3 with contact_score under 70 (AdStrategy 69, Close x2 66) | yes | No difference. The 3 low-score ones are dropped by the contact-score filter before the counters |

Blocked accounts in the dry run: Ad Army, Finbar, Servo7, Tenet Industries (draft rejected) and throxy, Topo, Twenty, UserGems, Windmill (vetoed).

### 5. Phase 3.2 steps 1 to 4, enrichment data

| Check | Expected | Actual | Pass |
|---|---|---|---|
| `Score Enriched` | only the TECH array replaced by guide 3.1 | Live body = file, TECH verbatim, nothing else changed | yes |
| `YC Directory Source` | mapping and comment from C14-3 | Both lines copied by script from the guide; live body = file | yes |
| Step 4 on `s14-test` (read only) | 7: Demodesk, Mindee, Parallel, UserGems, Payflow, Oneleet, Humaans | the same 7 | yes |

n8n versions: `S14: YC Directory Source`, `S14: Score Enriched`. The guide's single version name "S14: enrichment data" was split into one version per node, per your one-update-per-node rule.

### 6. Phase 4.3, draft quality

`scripts/s14/build_phase4.mjs` builds both bodies from the live code plus guide 3.1, 4.1 and the 4.2 table (all 6 prompt rows applied from the guide text, not retyped).

| Check | Expected | Actual | Pass |
|---|---|---|---|
| `Draft Outreach` | items 1 to 8 of C14-4 | Live body = file, 44509 chars; TECH, rules block and the 6 validator v2 lines verbatim | yes |
| `Add Outreach Stats` | drafted = pending; needs_redraft; 3 gate counters; site unreachable | Live body = file | yes |
| Offline harness (`scripts/s14/test_draft_outreach.mjs`, mock HTTP and LLM, 9 pairs) | 6 angles, 3 gate kinds, 2 validator rules behave | 25 of 25 checks pass | yes |
| Gate rows through `gtm_insert_draft()` on `s14-test` (`gate_row_db_check.sql`, in a transaction that is rolled back) | rows insert with the new columns; extra `__draft_stats` key ignored | rejected/account, rejected/pitch and needs_redraft rows inserted correctly; 0 rows left after rollback | yes |

n8n versions: `S14: Draft Outreach`, `S14: Add Outreach Stats`.

Decisions I made that the prompt did not spell out:
- `risk_notes` cap raised from 450 to 600 characters (`NOTES_MAX`), because the 5 new flags would otherwise cut off the `llm_errors` part the console shows for `needs_redraft`.
- The Draft Outreach stats counter (`skipped_site_unreachable`) rides on the first output row as `__draft_stats`; `gtm_insert_draft()` ignores the key (checked on the branch).
- The 6 s politeness pause now runs only between LLM drafts, not before gate rows.

### 7. Phase 4.4, label check

`node scripts/s14/label_check.mjs` copies the rules block out of `scripts/s14/Draft Outreach.js` and first checks it equals the guide text (true).

| Account | Category | Type | Outcome (empty site) | Guide 4.1 | Pass |
|---|---|---|---|---|---|
| Adstrategy, IDL Consulting | other | lead_seller | delivery_ops | same | yes |
| Lead Pronto | other | agency | client_reporting | agency without the homepage | yes |
| Parallel, telli | other | other | hire_bridge | other / agency, hire_bridge | yes |
| Unmuted | other | agency | hire_bridge | other / agency, hire_bridge | yes |
| Demodesk, Close | crm | other | gate account | same | yes |
| Topo / throxy | outbound | other / agency | gate account | same | yes |
| Mailwarm | deliverability | other | gate account | same | yes |
| Nomi, Kenobi | sales_tech | other | gate account | same | yes |
| goareo | other | hardware | gate account | same | yes |
| Moby, Trackingplan, Alguna, Newton's Tree | other | other | needs the homepage | same | yes |

18 of 18 rows match. No paste error.

### 8. Phase 5.1, console

| Check | Expected | Actual | Pass |
|---|---|---|---|
| `npm run build` | route table, no errors | passes | yes |
| `node scripts/s10_extract_console_files.mjs --check` | "All hand-written files match the guide" | that line, exit 0 | yes |
| eslint on changed files | clean | clean | yes |
| Files | 0 new, 8 or 9 changed | 1 new, 11 changed (see below) | see note |

The 8 changes: reject action (`rejectDraft`, zod scope enum, reason max 500, revalidates `/queue`, `/queue/<id>`, `/accounts`); scope picker dialog (Wrong person / Weak email, company OK / Bad company with "This also vetoes <company>.", keys R, 1 2 3, Enter, Esc); `needs_redraft` shows Edit, Re-draft, Reject and no Approve; Re-draft tab after Review with its count; `needs_redraft` state "Needs re-draft" in orange (new token, 5.8:1 light, 7.2:1 dark); angle, angle basis, account type, product category in "Why this person, why now", reject scope and notes for rejected drafts, the `llm_errors` text for `needs_redraft`; "Auto" chip for `gate:` rows; "Blocked: <reason>" chip on the accounts list and account page; `gtm-console/CLAUDE.md` lists `gtm_reject()` and `v_outreach_blocks`.

Deviation: `rejectDraft` lives in a new file `app/(console)/queue/reject-action.ts`, not in `actions.ts`. `actions.ts` is one of the files `s10 --check` keeps byte-identical to the Sprint 10 guide, so editing it would have failed the check you required to pass. Extra small edits: `lib/feedback.ts` (toast titles for `needs_redraft`, `invalid_scope`, `reason_too_long`) and `app/globals.css` (the orange token).

Commit: `S14 phase 5`.

### 9. Phase 6.1, run chain

| Check | Expected | Actual | Pass |
|---|---|---|---|
| `get_node_types` | executeWorkflow, executeWorkflowTrigger | v1.3 and v1.2 read before writing; configs pass `validate_node_config` | yes |
| Code nodes reading `$('Manual Trigger')` or `$('Schedule Trigger')` | none, else skip that workflow | none in all 3 workflows | yes |
| Trigger added (accept all data) | 3 workflows, wired to the first node | Engine -> Fetch Config, Contact Finder -> Fetch Config, Neon Sync -> Read Push Rows | yes |
| `GTM Run` | 8 nodes, folder 1 Core, errorWorkflow CEc6gDLm2WD7mgXl | `VMZbk71OhCT74WbR`, 8 nodes + README sticky, folder 1 Core, errorWorkflow set; `validate_workflow` valid | yes |
| Publish state | unchanged | Neon Sync still published on its old version `8dc89b76`; Engine, Contact Finder, GTM Run unpublished | yes |
| Run | not run | not run | yes |

n8n versions: `S14: run chain` on Personal GTM Engine, GTM Contact Finder and GTM Neon Sync; GTM Run created with version `S14: run chain`. Validation needed one fix: the SDK parser refused a helper arrow function, so the 5 sub-workflow nodes are written out (`scripts/s14/gtm_run.sdk.js`).

### 10. Close-out docs (C14-7b items 1 to 5)

| Item | Actual | Pass |
|---|---|---|
| 1. `db/schema.sql` | Migration appended under "Sprint 14: engine fixes" without begin/commit. The plain append broke re-runs (older `create or replace view` statements cannot drop or rename columns), so 3 `drop view if exists` lines were added (Sprint 10 `v_review_queue` and `n8n_outreach_queue_sheet`, S14 copy of `v_review_queue`). Now runs twice in PGlite; S14 test still 19/19. `db/s14_engine_fixes.sql` unchanged | yes |
| 2. `docs/ADR.md` | ADR-103 to ADR-111 generated from the guide table by `scripts/s14/build_adrs.mjs`, in the file's format | yes |
| 3. `docs/ARCHITECTURE.md` | GTM Run row, folder list, Sprint 14 draft path and the needs_redraft branch in the diagram | yes |
| 4. `docs/SETUP.md` | GTM Run paragraph and the config key table | yes |
| 5. Root `CLAUDE.md` | `GTM Run: VMZbk71OhCT74WbR [1 Core ...]` | yes |
| 6. README | skipped as asked (needs your 7.4 numbers) | skipped |

## Skipped or failed, with reasons

| Item | Status | Reason or error |
|---|---|---|
| Phase 0, 1.4, 3.3, 3.4, 5.2, 6.2, 7 | skipped | Yours, per the brief |
| `validate_workflow` after the 13 node edits on existing workflows | not applicable as written | `validate_workflow` only checks SDK code I write (used for GTM Run: valid). For edits to existing workflows I used `update_workflow`'s own validation (0 warnings every time), `validate_node_config` for new nodes, a compile check of every Code body, and a byte-for-byte compare of the live node with the file |
| Console visual check at 390 px and dark mode | not done | Needs a database with data; `.env.local` points at production and is off limits. Covered by your 5.2 |
| LLM behavior of the new prompt | not tested | No runs allowed. Only a mocked LLM was used |
| First tool error | fixed | `neonConfig` undefined in the branch helper (ESM default export); fixed in the helper |
| First patch script for `review-actions.tsx` | replaced | Bash heredoc quoting error ("unexpected EOF"); the same edits were applied with the Edit tool |
| One of my commands | interrupted | The combined check/lint/scan command was stopped mid-run; rerun as separate commands, all passed |

## Found while testing: one rule does not work as the guide intends

A `gate:no_angle` row (scope `pitch`) does not block its account. Gate rows are inserted with `reviewed_at` NULL, and `v_outreach_blocks` only blocks a pitch rejection when `max(reviewed_at)` is set. Verified on `s14-test`: after inserting a `no_angle` row for Noloco, Noloco is not in `v_outreach_blocks`. Effect: the same contact is not drafted again (its rejected row keeps it out), but a second contact at the same account gets another homepage GET and another `no_angle` row on the next run. No LLM calls are wasted. Suggested fix, not applied (schema change, your call), in `v_outreach_blocks`:

```sql
max(coalesce(q.reviewed_at, q.run_date)) filter (where q.reject_scope = 'pitch') as pitch_at
```

## Your turn, in guide order

1. Phase 0: reject the 9 drafts, veto the 8 accounts, Lead Pronto and IDL, then the 0.7 check.
2. Phase 1.4: run `db/s14_engine_fixes.sql` on `production`, repeat the 1.3 checks (after Phase 0: 20 vetoed, 12 draft rejected, 32 blocked). Then delete branch `s14-test` (`br-still-snow-b98xnsnb`). Do this before any engine run: the engine now reads `v_outreach_blocks` and writes the new columns, and fails without them.
3. Phase 3.3: Sheet backfill, the 7 YC rows from `series_b` to `growth`.
4. Phase 3.4: `view-source:https://demodesk.com`, search `hs-scripts` and `pipedrive`.
5. Phase 5.2: console test on a throwaway `s14-console` branch.
6. Phase 6.2: config keys (`min_buyer_score`, `max_contact_age_days`, `small_team_no_trigger`, `gate_overrides`, new proof point, `priority` block).
7. Phase 7: pre-flight, `GTM Run`, acceptance, review, re-run, publish GTM Neon Sync (its draft has the new trigger), exports, README row, merge `s14-engine-fixes` and push (`git push` with your SSH key).
8. Decide on the `no_angle` blocking fix above.

## Rollback for every S14 n8n version

`restore_workflow_version` to the version before the first S14 one:

| Workflow | S14 versions created (oldest first) | Restore to |
|---|---|---|
| Personal GTM Engine `AlDFQcPA9KyItHZq` | S14: Fetch Outreach Blocks `0cdade25`, Select Outreach Pairs `cdf938d6`, Merge Contact Results `99445afb`, Select Contact Batch `8cefeba6`, Run Stats `1844ab0d`, YC Directory Source `c30fed54`, Score Enriched `3142fd47`, Draft Outreach `68b51c63`, Add Outreach Stats `a75dfb28`, run chain `f47f049c` | `b771b071-b472-4b55-adc0-38d30f7dc8a8` (autosave of 2026-11-03) |
| GTM Contact Finder `XZNsJ8Wnhc1CNxPc` | S14: run chain `6c88e349` | `6793e5b1-8a23-492c-9274-8db9508eca7e` |
| GTM Neon Sync `oVuFHj1w20pt9uie` | S14: run chain `1ed50fd0` (draft only) | `8c7fc8dc-46cf-42a4-8ec9-d35bef3c61a1`; the published version `8dc89b76` was never changed |
| GTM Run `VMZbk71OhCT74WbR` | created, `0c912068` | archive it (restorable) |

A single node can also be rolled back alone: the pre-S14 bodies are in the history version above, and every new body is in `scripts/s14/<node>.js`.

Git: all work is on `s14-engine-fixes`; `main` is unchanged. `db/s14_engine_fixes.sql` and `scripts/s14_sql_test.mjs` were untracked before this run and are now committed on the branch, so checking out `main` removes them from the working tree until the branch is merged. Your uncommitted `docs/SPEC.md` and screenshot changes were left as they were.
