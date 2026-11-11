-- Sprint 14: how the database treats the rows the new Draft Outreach writes.
-- Run ONLY on branch s14-test, through scripts/s14/neon_branch.mjs rollback (begin ... rollback, nothing is kept).
select outreach_id, approval_status, reject_scope, account_type, product_category, angle_basis,
       message_draft is null as message_is_null, reviewed_at
from gtm_insert_draft('{"run_date":"2026-11-11T10:00:00.000Z","outreach_id":"or_s14_gate_overlap","account_id":"acc_trackingplan_com","contact_id":"ct_s14_a","company_name":"Trackingplan","contact_name":"Test A","channel":"email","angle":"","trigger":"","pain_point":"","value_proposition":"","proof_point":"","cta":"","email_subject":"","first_line":"","message_draft":"","follow_up_1":"","follow_up_2":"","follow_up_3":"","linkedin_note":"","risk_notes":"gate=product_overlap; account_type=other; product_category=crm; tools=none; mentions=none; trigger=none","approval_status":"rejected","reject_scope":"account","send_status":"not_sent","sent_at":"","reply_received":"","notes":"Auto-skipped by the Sprint 14 gate (product_overlap): crm. Add the account_id to outreach.gate_overrides and Re-draft to override.","llm_provider":"gate:product_overlap","llm_calls":0,"llm_failures":0,"angle_basis":"","account_type":"other","product_category":"crm","__draft_stats":{"skipped_site_unreachable":2}}'::jsonb);

select outreach_id, approval_status, reject_scope, account_type, product_category, reviewed_at
from gtm_insert_draft('{"run_date":"2026-11-11T10:00:00.000Z","outreach_id":"or_s14_gate_noangle","account_id":"acc_noloco_io","contact_id":"ct_s14_b","company_name":"Noloco","contact_name":"Test B","channel":"email","message_draft":"","risk_notes":"gate=no_angle","approval_status":"rejected","reject_scope":"pitch","send_status":"not_sent","llm_provider":"gate:no_angle","llm_calls":0,"llm_failures":0,"angle_basis":"","account_type":"other","product_category":"other"}'::jsonb);

select outreach_id, approval_status, angle, angle_basis, account_type, product_category
from gtm_insert_draft('{"run_date":"2026-11-11T10:00:00.000Z","outreach_id":"or_s14_redraft","account_id":"acc_noloco_io","contact_id":"ct_s14_c","company_name":"Noloco","contact_name":"Test C","channel":"email","message_draft":"Hi Test, a template draft.","approval_status":"needs_redraft","reject_scope":"","send_status":"not_sent","llm_provider":"template","llm_calls":2,"llm_failures":2,"angle":"demo_brief","angle_basis":"demo call to action on the homepage: book a demo","account_type":"demo_saas","product_category":"other"}'::jsonb);

-- A stats-only item (no outreach_id) must insert nothing and return nothing.
select count(*)::int as rows_for_item_without_id from gtm_insert_draft('{"__draft_stats":{"skipped_site_unreachable":1}}'::jsonb);

-- Does each gate row block its account?
select account_id, reason, pitch_at from v_outreach_blocks where account_id in ('acc_trackingplan_com', 'acc_noloco_io') order by 1;
