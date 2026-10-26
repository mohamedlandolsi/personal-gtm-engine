#!/usr/bin/env python3
"""Sprint 12: remove the outreach_queue and digest_ops reads from GTM Neon Sync's Pack Sync Payload.
Usage: python3 s12_edit_pack.py <in.js> <out.js>   (exit 1 and write nothing if any anchor is not found exactly once)"""
import sys
src = open(sys.argv[1], encoding='utf8').read().replace('\r\n', '\n')
EDITS = [
  ("  outreach_queue: { node: 'Read Outreach Tab', key: 'outreach_id', cols: {\n"
   "    outreach_id: T, run_date: D, account_id: T, contact_id: T, company_name: T, contact_name: T,\n"
   "    channel: T, angle: T, trigger: T, pain_point: T, value_proposition: T, proof_point: T, cta: T,\n"
   "    email_subject: T, first_line: T, message_draft: T, follow_up_1: T, follow_up_2: T,\n"
   "    follow_up_3: T, linkedin_note: T, risk_notes: T, approval_status: T, send_status: T,\n"
   "    sent_at: D, reply_received: T, notes: T, llm_provider: T, llm_calls: I, llm_failures: I } },\n", ""),
  ("    llm_calls: I, llm_failures: I } },\n"
   "  digest_ops: { node: 'Read Digest Ops Tab', key: 'run_at', cols: {\n"
   "    run_at: D, config_rev: T, queue_rows: I, candidates: I, embedded: I, overflow: I,\n"
   "    pending_announced: I, approved_announced: I, discord_status: T, error_sample: T } }\n};",
   "    llm_calls: I, llm_failures: I } }\n};"),
  ("  outreach: pushed('Only Outreach Push'),\n", ""),
  ("// Turns the six Sheets reads into one typed JSON payload for gtm_sync_pull().\n",
   "// Turns the four Sheets reads into one typed JSON payload for gtm_sync_pull().\n"
   "// Sprint 12: outreach_queue lives in Neon only (outreach_sor = neon) and the digest is retired,\n"
   "// so those two tabs are no longer read. gtm_sync_pull() treats the missing keys as empty.\n"),
]
for old, new in EDITS:
    n = src.count(old)
    if n != 1:
        sys.exit(f"anchor found {n} times, expected 1: {old[:60]!r}")
    src = src.replace(old, new)
open(sys.argv[2], 'w', encoding='utf8').write(src)
print("ok", len(src), "chars")
