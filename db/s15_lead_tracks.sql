-- =====================================================================
-- Personal GTM Engine: Sprint 15 lead tracks (ADR-113, ADR-114)
-- Additive and safe to re-run. Run on branch s15-test first, then production.
-- What it adds:
--   accounts:        lead_track (default smb_direct), source_meta
--   outreach_queue:  lead_track (default smb_direct) with a check
--   gig_posts, gig_ops: new tables for the GTM Gig Finder workflow
--   gtm_track():        normalizes a track value; blank or unknown becomes smb_direct
--   gtm_insert_draft(): writes lead_track; a gig_post draft moves its post from new to drafted
--   gtm_sync_pull():    carries lead_track and source_meta from the Sheet mirror (normalized, never NULL)
--   gtm_review():       mark_sent on a gig draft sets the post to sent; redraft sets it back to new
--   gtm_gig_upsert():   insert or refresh gig posts; never downgrades drafted, sent, replied, won, lost, expired
--   gtm_gig_expire():   old new/drafted posts become expired; their unreviewed drafts become superseded
--   v_review_queue, n8n_outreach_queue_sheet: new columns appended at the end
--   v_accounts:         dropped and re-created so a.* picks up the new columns
--   v_hubspot_scope:    gig_post drafts never reach HubSpot
--   gtm_gig_add(), gtm_gig_status(), v_gig_posts: console Gigs page (manual add, status buttons)
-- =====================================================================
begin;

-- 1. Track columns -------------------------------------------------------------------
alter table accounts       add column if not exists lead_track  text not null default 'smb_direct';
alter table accounts       add column if not exists source_meta text;   -- short JSON: directory, tier, services, languages, pricing band
alter table outreach_queue add column if not exists lead_track  text not null default 'smb_direct';
alter table outreach_queue drop constraint if exists outreach_track_chk;
alter table outreach_queue add  constraint outreach_track_chk check (lead_track in ('smb_direct','agency_partner','gig_post'));
-- No check on accounts.lead_track on purpose: one bad Sheet value would fail the whole sync batch.
-- gtm_sync_pull() normalizes the value with gtm_track() instead.

create or replace function gtm_track(t text) returns text
language sql immutable as $$
  select case when lower(trim(coalesce(t, ''))) in ('smb_direct','agency_partner','gig_post')
              then lower(trim(t)) else 'smb_direct' end
$$;

-- 2. Gig tables ----------------------------------------------------------------------
create table if not exists gig_posts (
  post_key        text primary key,            -- n8n:<topic_id> | make:<topic_id> | hn:<comment_id>
  platform        text not null,               -- n8n_forum | make_forum | hn_freelancer | manual
  url             text not null,
  title           text,
  body_text       text,                        -- plain text, cut to 4000 chars by gtm_gig_upsert()
  poster          text,
  poster_company  text,
  posted_at       timestamptz,
  reply_count     integer,
  contact_email   text,                        -- only if written in the post
  contact_hint    text,                        -- dm_invited | reply | email | form
  stated_budget   text,
  remote_hint     text,
  matched_stack   text,                        -- comma list
  intent          text,                        -- hiring | for_hire | unclear
  gig_score       integer,
  score_breakdown text,
  status          text not null default 'new', -- new | gated_out | drafted | sent | replied | won | lost | expired
  gate_reason     text,
  first_seen_at   timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint gig_status_chk   check (status in ('new','gated_out','drafted','sent','replied','won','lost','expired')),
  constraint gig_platform_chk check (platform in ('n8n_forum','make_forum','hn_freelancer','manual')),
  constraint gig_intent_chk   check (intent is null or intent in ('hiring','for_hire','unclear')),
  constraint gig_hint_chk     check (contact_hint is null or contact_hint in ('dm_invited','reply','email','form'))
);
create index if not exists gig_posts_status_idx on gig_posts (status, posted_at desc);
-- Phase 0 outcome: posts can also be added by hand in the console (platform manual). Re-assert on re-run.
alter table gig_posts drop constraint if exists gig_platform_chk;
alter table gig_posts add  constraint gig_platform_chk check (platform in ('n8n_forum','make_forum','hn_freelancer','manual'));

create table if not exists gig_ops (
  run_id          text primary key,
  run_at          timestamptz not null default now(),
  config_rev      text,                        -- same meaning as ops.config_rev: which config produced this run
  fetched         integer,
  intent_for_hire integer,
  intent_unclear  integer,
  stale           integer,
  crowded         integer,
  vetoed          integer,
  stack_miss      integer,
  budget_low      integer,
  already_seen    integer,
  scored          integer,
  drafted         integer,
  pinged          integer,                     -- Discord pings sent (D4)
  expired         integer,                     -- posts moved to expired by gtm_gig_expire()
  errors          text,
  source_stats    text
);

-- 3. gtm_insert_draft: writes lead_track; a gig draft marks its post drafted -----------
create or replace function gtm_insert_draft(p jsonb) returns setof outreach_queue
language sql as $$
  with clean as (
    select jsonb_object_agg(e.key, case when e.value = '""'::jsonb then 'null'::jsonb else e.value end) as j
    from jsonb_each(p) as e
  ),
  ins as (
    insert into outreach_queue (outreach_id, run_date, account_id, contact_id, company_name, contact_name, channel,
      angle, trigger, pain_point, value_proposition, proof_point, cta, email_subject, first_line, message_draft,
      follow_up_1, follow_up_2, follow_up_3, linkedin_note, risk_notes, approval_status, send_status, sent_at,
      reply_received, notes, llm_provider, llm_calls, llm_failures,
      reject_scope, angle_basis, account_type, product_category,
      lead_track)                                                                   -- S15
    select x.outreach_id, x.run_date, x.account_id, x.contact_id, x.company_name, x.contact_name, x.channel,
      x.angle, x.trigger, x.pain_point, x.value_proposition, x.proof_point, x.cta, x.email_subject, x.first_line,
      x.message_draft, x.follow_up_1, x.follow_up_2, x.follow_up_3, x.linkedin_note, x.risk_notes,
      coalesce(x.approval_status, 'pending'), coalesce(x.send_status, 'not_sent'), x.sent_at,
      x.reply_received, x.notes, x.llm_provider, x.llm_calls, x.llm_failures,
      x.reject_scope, x.angle_basis, x.account_type, x.product_category,
      coalesce(x.lead_track, 'smb_direct')                                          -- S15: missing key or "" = smb_direct
    from clean, jsonb_populate_record(null::outreach_queue, clean.j) as x
    where x.outreach_id is not null
    on conflict (outreach_id) do nothing
    returning *
  ),
  gig as (                                                                          -- S15: runs once, even unread
    update gig_posts g set status = 'drafted', updated_at = now()
    from ins
    where ins.lead_track = 'gig_post' and ins.account_id like 'gig:%'
      and g.post_key = substr(ins.account_id, 5) and g.status = 'new'
    returning g.post_key
  )
  select * from ins
  union all
  select q.* from outreach_queue q
  where q.outreach_id = p->>'outreach_id' and not exists (select 1 from ins)
$$;

-- 4. gtm_sync_pull: copied from the S10 body, only the accounts block changes (marked S15)
create or replace function gtm_sync_pull(p jsonb) returns jsonb
language plpgsql as $$
declare
  t0         timestamptz := clock_timestamp();
  n_mark_cfg int := 0; n_mark_out int := 0; n_mark_con int := 0; n_mark_acc int := 0;
  n_acc      int := 0; n_con int := 0; n_out int := 0; n_ops int := 0; n_dig int := 0;
  cfg_text   text;
  latest     config_versions%rowtype;
  cfg_state  text := 'not_read';
  warns      jsonb := coalesce(p->'warnings', '[]'::jsonb);
  warn_text  text;
begin
  -- 1. Mark what the push branches wrote to Sheets (exact version match)
  update config_versions c set pushed_to_sheet_at = now()
  where c.pushed_to_sheet_at is null
    and c.id <= coalesce((select max(x.key::bigint)
                          from jsonb_to_recordset(coalesce(p->'pushed'->'config', '[]'::jsonb)) as x(key text, version text)), 0);
  get diagnostics n_mark_cfg = row_count;

  update outreach_queue q set dashboard_dirty_at = null
  from jsonb_to_recordset(coalesce(p->'pushed'->'outreach', '[]'::jsonb)) as x(key text, version text)
  where q.outreach_id = x.key and q.dashboard_dirty_at = x.version::timestamptz;
  get diagnostics n_mark_out = row_count;

  update contacts c set dashboard_dirty_at = null
  from jsonb_to_recordset(coalesce(p->'pushed'->'contacts', '[]'::jsonb)) as x(key text, version text)
  where c.contact_id = x.key and c.dashboard_dirty_at = x.version::timestamptz;
  get diagnostics n_mark_con = row_count;

  update accounts a set dashboard_dirty_at = null
  from jsonb_to_recordset(coalesce(p->'pushed'->'accounts', '[]'::jsonb)) as x(key text, version text)
  where a.account_id = x.key and a.dashboard_dirty_at = x.version::timestamptz;
  get diagnostics n_mark_acc = row_count;

  -- 2. Accounts: engine owns every column; status is kept while a console veto is unpushed
  insert into accounts (account_id, run_date, source, company_name, domain, website, industry, company_type,
    employee_count, location_raw, country, timezone_utc_offset, funding_stage, final_score, priority, why_match,
    red_flags, score_breakdown, confidence, status, linkedin_url, tech_stack, funding_proxy_score,
    automation_need_score, enrichment_status, clay_summary, clay_status, clay_enriched_at,
    contact_feasibility_score, contact_status, clay_trigger, clay_trigger_source, clay_trigger_date, synced_at,
    lead_track, source_meta)                                                       -- S15
  select x.account_id, x.run_date, x.source, x.company_name, x.domain, x.website, x.industry, x.company_type,
    x.employee_count, x.location_raw, x.country, x.timezone_utc_offset, x.funding_stage, x.final_score, x.priority,
    x.why_match, x.red_flags, x.score_breakdown, x.confidence, x.status, x.linkedin_url, x.tech_stack,
    x.funding_proxy_score, x.automation_need_score, x.enrichment_status, x.clay_summary, x.clay_status,
    x.clay_enriched_at, x.contact_feasibility_score, x.contact_status,
    x.clay_trigger, x.clay_trigger_source, x.clay_trigger_date, now(),
    gtm_track(x.lead_track), nullif(trim(coalesce(x.source_meta, '')), '')         -- S15
  from jsonb_populate_recordset(null::accounts, coalesce(p->'accounts', '[]'::jsonb)) as x
  on conflict (account_id) do update set
    run_date = excluded.run_date, source = excluded.source, company_name = excluded.company_name,
    domain = excluded.domain, website = excluded.website, industry = excluded.industry,
    company_type = excluded.company_type, employee_count = excluded.employee_count,
    location_raw = excluded.location_raw, country = excluded.country,
    timezone_utc_offset = excluded.timezone_utc_offset, funding_stage = excluded.funding_stage,
    final_score = excluded.final_score, priority = excluded.priority, why_match = excluded.why_match,
    red_flags = excluded.red_flags, score_breakdown = excluded.score_breakdown, confidence = excluded.confidence,
    status = case when accounts.dashboard_dirty_at is null then excluded.status else accounts.status end,
    linkedin_url = excluded.linkedin_url, tech_stack = excluded.tech_stack,
    funding_proxy_score = excluded.funding_proxy_score, automation_need_score = excluded.automation_need_score,
    enrichment_status = excluded.enrichment_status, clay_summary = excluded.clay_summary,
    clay_status = excluded.clay_status, clay_enriched_at = excluded.clay_enriched_at,
    contact_feasibility_score = excluded.contact_feasibility_score, contact_status = excluded.contact_status,
    clay_trigger = excluded.clay_trigger, clay_trigger_source = excluded.clay_trigger_source,
    clay_trigger_date = excluded.clay_trigger_date,
    lead_track = excluded.lead_track, source_meta = excluded.source_meta,          -- S15
    synced_at = now();
  get diagnostics n_acc = row_count;

  -- 3. Contacts: same rule for status (re-draft sets it back to new)
  insert into contacts (contact_id, run_date, account_id, company_name, domain, full_name, title, role_category,
    email, email_status, linkedin_url, phone, source, confidence, contact_score, preferred_channel, status,
    contact_key, account_domain, synced_at)
  select x.contact_id, x.run_date, x.account_id, x.company_name, x.domain, x.full_name, x.title, x.role_category,
    x.email, x.email_status, x.linkedin_url, x.phone, x.source, x.confidence, x.contact_score, x.preferred_channel,
    x.status, x.contact_key, x.account_domain, now()
  from jsonb_populate_recordset(null::contacts, coalesce(p->'contacts', '[]'::jsonb)) as x
  on conflict (contact_id) do update set
    run_date = excluded.run_date, account_id = excluded.account_id, company_name = excluded.company_name,
    domain = excluded.domain, full_name = excluded.full_name, title = excluded.title,
    role_category = excluded.role_category, email = excluded.email, email_status = excluded.email_status,
    linkedin_url = excluded.linkedin_url, phone = excluded.phone, source = excluded.source,
    confidence = excluded.confidence, contact_score = excluded.contact_score,
    preferred_channel = excluded.preferred_channel,
    status = case when contacts.dashboard_dirty_at is null then excluded.status else contacts.status end,
    contact_key = excluded.contact_key, account_domain = excluded.account_domain, synced_at = now();
  get diagnostics n_con = row_count;

  -- 4. Outreach drafts: insert-only. Once a row exists, review fields belong to the console.
  if gtm_setting('outreach_sor') = 'sheets' then
    insert into outreach_queue (outreach_id, run_date, account_id, contact_id, company_name, contact_name, channel,
      angle, trigger, pain_point, value_proposition, proof_point, cta, email_subject, first_line, message_draft,
      follow_up_1, follow_up_2, follow_up_3, linkedin_note, risk_notes, approval_status, send_status, sent_at,
      reply_received, notes, llm_provider, llm_calls, llm_failures, synced_at)
    select x.outreach_id, x.run_date, x.account_id, x.contact_id, x.company_name, x.contact_name, x.channel,
      x.angle, x.trigger, x.pain_point, x.value_proposition, x.proof_point, x.cta, x.email_subject, x.first_line,
      x.message_draft, x.follow_up_1, x.follow_up_2, x.follow_up_3, x.linkedin_note, x.risk_notes,
      coalesce(x.approval_status, 'pending'), coalesce(x.send_status, 'not_sent'), x.sent_at,
      x.reply_received, x.notes, x.llm_provider, x.llm_calls, x.llm_failures, now()
    from jsonb_populate_recordset(null::outreach_queue, coalesce(p->'outreach_queue', '[]'::jsonb)) as x
    on conflict (outreach_id) do nothing;
    get diagnostics n_out = row_count;
  end if;

  -- 5. Telemetry tabs: append-only
  insert into ops (run_at, config_rev, source, seed_rows, seen_rows_pre, after_filters, accounts_written,
    min_account_score, warnings, errors_sample, rejection_summary, apollo_companies, source_errors, enriched_rows,
    enrich_errors, clay_queued, clay_merged, contacts_discovered, contacts_written, outreach_drafts_written,
    llm_calls, llm_failures, synced_at)
  select x.run_at, x.config_rev, x.source, x.seed_rows, x.seen_rows_pre, x.after_filters, x.accounts_written,
    x.min_account_score, x.warnings, x.errors_sample, x.rejection_summary, x.apollo_companies, x.source_errors,
    x.enriched_rows, x.enrich_errors, x.clay_queued, x.clay_merged, x.contacts_discovered, x.contacts_written,
    x.outreach_drafts_written, x.llm_calls, x.llm_failures, now()
  from jsonb_populate_recordset(null::ops, coalesce(p->'ops', '[]'::jsonb)) as x
  on conflict (run_at) do nothing;
  get diagnostics n_ops = row_count;

  insert into digest_ops (run_at, config_rev, queue_rows, candidates, embedded, overflow, pending_announced,
    approved_announced, discord_status, error_sample, synced_at)
  select x.run_at, x.config_rev, x.queue_rows, x.candidates, x.embedded, x.overflow, x.pending_announced,
    x.approved_announced, x.discord_status, x.error_sample, now()
  from jsonb_populate_recordset(null::digest_ops, coalesce(p->'digest_ops', '[]'::jsonb)) as x
  on conflict (run_at) do nothing;
  get diagnostics n_dig = row_count;

  -- 6. Config: first sync imports Sheets config!B2; afterwards the console owns it and we only report drift
  cfg_text := nullif(trim(coalesce(p->>'config_value', '')), '');
  select * into latest from config_versions order by id desc limit 1;
  if cfg_text is not null then
    begin
      if latest.id is null then
        insert into config_versions (rev, payload_text, note, created_by, pushed_to_sheet_at)
        values (coalesce(cfg_text::jsonb->>'rev', 'sheet-import'), cfg_text,
                'bootstrap import from Sheets config!B2', 'sheet_import', now());
        cfg_state := 'imported';
      elsif latest.pushed_to_sheet_at is null then
        cfg_state := 'pending_push';
      elsif cfg_text::jsonb = latest.payload then
        cfg_state := 'in_sync';
      else
        cfg_state := 'drift';
        warns := warns || to_jsonb('config_drift: Sheets config!B2 differs from console rev ' || latest.rev);
      end if;
    exception when others then
      cfg_state := 'sheet_invalid_json';
      warns := warns || to_jsonb('Sheets config!B2 is not valid JSON'::text);
    end;
  end if;

  select string_agg(w, ' | ') into warn_text from jsonb_array_elements_text(warns) as t(w);

  insert into sync_ops (pushed_config, pushed_outreach, pushed_contacts, pushed_accounts, pulled_accounts,
    pulled_contacts, new_outreach, new_ops, new_digest_ops, config_state, warnings, duration_ms)
  values (n_mark_cfg, n_mark_out, n_mark_con, n_mark_acc, n_acc, n_con, n_out, n_ops, n_dig, cfg_state,
    left(warn_text, 2000), (extract(epoch from clock_timestamp() - t0) * 1000)::int);

  return jsonb_build_object(
    'pushed', jsonb_build_object('config', n_mark_cfg, 'outreach', n_mark_out, 'contacts', n_mark_con, 'accounts', n_mark_acc),
    'pulled', jsonb_build_object('accounts', n_acc, 'contacts', n_con, 'new_outreach', n_out, 'new_ops', n_ops, 'new_digest_ops', n_dig),
    'config_state', cfg_state,
    'warnings', coalesce(warn_text, ''));
end $$;

-- 5. gtm_review: copied from the S14 body, one block added after the update (marked S15)
create or replace function gtm_review(p_id text, p_action text, p_edits jsonb default '{}'::jsonb, p_actor text default 'console')
returns jsonb language plpgsql as $$
declare
  r                outreach_queue%rowtype;
  content_keys     text[] := array['email_subject','message_draft','follow_up_1','follow_up_2','follow_up_3','linkedin_note'];
  allowed_keys     text[] := array['email_subject','message_draft','follow_up_1','follow_up_2','follow_up_3','linkedin_note','notes'];
  k                text;
  new_approval     text;
  new_send         text;
  content_changed  boolean := false;
  before_j         jsonb;
  after_j          jsonb;
  dirty            timestamptz;
begin
  p_edits := coalesce(p_edits, '{}'::jsonb);
  if jsonb_typeof(p_edits) <> 'object' then raise exception 'edits_must_be_object'; end if;

  select * into r from outreach_queue where outreach_id = p_id for update;
  if not found then raise exception 'not_found: %', p_id; end if;
  if r.approval_status = 'superseded' then raise exception 'superseded_is_final'; end if;

  for k in select jsonb_object_keys(p_edits) loop
    if not (k = any(allowed_keys)) then raise exception 'unknown_field: %', k; end if;
  end loop;
  if p_action <> 'save_edits' and p_edits <> '{}'::jsonb then
    raise exception 'edits_only_with_save_edits';
  end if;

  new_approval := r.approval_status;
  new_send     := r.send_status;

  if p_action = 'approve' then
    if r.send_status <> 'not_sent' then raise exception 'already_sent'; end if;
    -- S14: a failed draft must be edited or re-drafted first
    if r.approval_status = 'needs_redraft' then
      raise exception 'needs_redraft: edit the draft or ask for a re-draft before approving'; end if;
    if r.approval_status not in ('pending','edited') then
      raise exception 'invalid_transition: % -> approve', r.approval_status; end if;
    new_approval := 'approved';

  elsif p_action = 'reject' then
    if r.send_status <> 'not_sent' then raise exception 'already_sent'; end if;
    -- S14: needs_redraft can be rejected
    if r.approval_status not in ('pending','edited','approved','needs_redraft') then
      raise exception 'invalid_transition: % -> reject', r.approval_status; end if;
    new_approval := 'rejected';

  elsif p_action = 'reopen' then
    if r.approval_status <> 'rejected' then
      raise exception 'invalid_transition: % -> reopen', r.approval_status; end if;
    new_approval := 'pending';

  elsif p_action = 'save_edits' then
    if r.send_status <> 'not_sent' then raise exception 'already_sent'; end if;
    if r.approval_status = 'rejected' then raise exception 'invalid_transition: rejected -> save_edits (reopen first)'; end if;
    if p_edits = '{}'::jsonb then raise exception 'no_changes'; end if;
    if p_edits ? 'message_draft' and length(trim(coalesce(p_edits->>'message_draft', ''))) < 20 then
      raise exception 'message_draft_too_short'; end if;
    for k in select jsonb_object_keys(p_edits) loop
      if k = any(content_keys) and (to_jsonb(r)->>k) is distinct from (p_edits->>k) then
        content_changed := true;
      end if;
    end loop;
    if content_changed then new_approval := 'edited'; end if;   -- edited content must be re-approved

  elsif p_action = 'mark_sent' then
    if r.approval_status <> 'approved' then raise exception 'not_approved: only approved drafts can be marked sent'; end if;
    if r.send_status <> 'not_sent' then raise exception 'already_sent'; end if;
    new_send := 'sent';

  elsif p_action = 'redraft' then
    if r.send_status <> 'not_sent' then raise exception 'already_sent'; end if;
    new_approval := 'superseded';

  else
    raise exception 'unknown_action: %', p_action;
  end if;

  before_j := jsonb_build_object('approval_status', r.approval_status, 'send_status', r.send_status)
           || coalesce((select jsonb_object_agg(t.k, to_jsonb(r)->t.k) from jsonb_object_keys(p_edits) as t(k)), '{}'::jsonb);

  dirty := case when gtm_setting('outreach_sor') = 'sheets' then now() else null end;

  update outreach_queue set
    approval_status    = new_approval,
    send_status        = new_send,
    sent_at            = case when new_send = 'sent' and r.send_status <> 'sent' then now() else sent_at end,
    email_subject      = case when p_edits ? 'email_subject' then p_edits->>'email_subject' else email_subject end,
    message_draft      = case when p_edits ? 'message_draft' then p_edits->>'message_draft' else message_draft end,
    follow_up_1        = case when p_edits ? 'follow_up_1'   then p_edits->>'follow_up_1'   else follow_up_1 end,
    follow_up_2        = case when p_edits ? 'follow_up_2'   then p_edits->>'follow_up_2'   else follow_up_2 end,
    follow_up_3        = case when p_edits ? 'follow_up_3'   then p_edits->>'follow_up_3'   else follow_up_3 end,
    linkedin_note      = case when p_edits ? 'linkedin_note' then p_edits->>'linkedin_note' else linkedin_note end,
    notes              = case when p_edits ? 'notes'         then p_edits->>'notes'         else notes end,
    reject_scope       = case when p_action = 'reopen' then null else reject_scope end,   -- S14
    reviewed_at        = now(),
    dashboard_dirty_at = coalesce(dirty, dashboard_dirty_at)
  where outreach_id = p_id
  returning * into r;

  -- S15: gig drafts keep gig_posts.status in step (account_id = 'gig:' || post_key)
  if r.lead_track = 'gig_post' and r.account_id like 'gig:%' then
    if p_action = 'mark_sent' then
      update gig_posts set status = 'sent', updated_at = now()
      where post_key = substr(r.account_id, 5) and status not in ('replied','won','lost');
    elsif p_action = 'redraft' then
      update gig_posts set status = 'new', updated_at = now()
      where post_key = substr(r.account_id, 5) and status = 'drafted';
    end if;
  end if;

  if p_action = 'redraft' and r.contact_id is not null then
    update contacts set status = 'new', dashboard_dirty_at = now() where contact_id = r.contact_id;
  end if;

  after_j := jsonb_build_object('approval_status', r.approval_status, 'send_status', r.send_status) || p_edits;
  insert into console_events (entity, entity_id, action, before, after, actor)
  values ('outreach', p_id, p_action, before_j, after_j, p_actor);

  return to_jsonb(r);
end $$;

-- 6. Gig functions ---------------------------------------------------------------------
-- Insert or refresh posts. p is one post object or an array of them; "" becomes NULL.
-- Content fields always refresh. Score, gate and status fields refresh only while the post is still open:
-- drafted keeps its status against new/gated_out, and sent, replied, won, lost, expired never change here.
create or replace function gtm_gig_upsert(p jsonb) returns jsonb
language sql as $$
  with arr as (
    select el from jsonb_array_elements(case jsonb_typeof(p) when 'array' then p
                                             when 'object' then jsonb_build_array(p)
                                             else '[]'::jsonb end) as el
    where jsonb_typeof(el) = 'object'
  ),
  clean as (
    select (select jsonb_object_agg(e.key, case when e.value = '""'::jsonb then 'null'::jsonb else e.value end)
            from jsonb_each(arr.el) as e) as j
    from arr
  ),
  recs as (
    select distinct on (x.post_key) x.*
    from clean, jsonb_populate_record(null::gig_posts, clean.j) as x
    where x.post_key is not null
    order by x.post_key
  ),
  up as (
    insert into gig_posts as g (post_key, platform, url, title, body_text, poster, poster_company, posted_at,
      reply_count, contact_email, contact_hint, stated_budget, remote_hint, matched_stack, intent, gig_score,
      score_breakdown, status, gate_reason)
    select r.post_key, r.platform, r.url, r.title, left(r.body_text, 4000), r.poster, r.poster_company, r.posted_at,
      r.reply_count, r.contact_email, r.contact_hint, r.stated_budget, r.remote_hint, r.matched_stack, r.intent,
      r.gig_score, r.score_breakdown, coalesce(r.status, 'new'), r.gate_reason
    from recs r
    on conflict (post_key) do update set
      url            = coalesce(excluded.url, g.url),
      title          = coalesce(excluded.title, g.title),
      body_text      = coalesce(excluded.body_text, g.body_text),
      poster         = coalesce(excluded.poster, g.poster),
      poster_company = coalesce(excluded.poster_company, g.poster_company),
      posted_at      = coalesce(excluded.posted_at, g.posted_at),
      reply_count    = coalesce(excluded.reply_count, g.reply_count),
      contact_email  = coalesce(excluded.contact_email, g.contact_email),
      contact_hint   = coalesce(excluded.contact_hint, g.contact_hint),
      stated_budget  = coalesce(excluded.stated_budget, g.stated_budget),
      remote_hint    = coalesce(excluded.remote_hint, g.remote_hint),
      matched_stack  = case when g.status in ('new','gated_out') then excluded.matched_stack   else g.matched_stack end,
      intent         = case when g.status in ('new','gated_out') then excluded.intent          else g.intent end,
      gig_score      = case when g.status in ('new','gated_out') then excluded.gig_score       else g.gig_score end,
      score_breakdown= case when g.status in ('new','gated_out') then excluded.score_breakdown else g.score_breakdown end,
      gate_reason    = case when g.status in ('new','gated_out') then excluded.gate_reason     else g.gate_reason end,
      status         = case when g.status in ('new','gated_out') then excluded.status          else g.status end,
      updated_at     = now()
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object('inserted', count(*) filter (where inserted),
                            'updated',  count(*) filter (where not inserted))
  from up
$$;

-- new or drafted posts older than p_hours (posted_at, else first_seen_at) become expired.
-- Their drafts still waiting for review (pending, edited, needs_redraft, not sent) become superseded,
-- with one console_events row each. Approved drafts are kept: you meant to send them.
create or replace function gtm_gig_expire(p_hours int) returns jsonb
language plpgsql as $$
declare
  hrs   int := greatest(coalesce(p_hours, 144), 1);
  keys  text[];
  n_sup int := 0;
  dirty timestamptz := case when gtm_setting('outreach_sor') = 'sheets' then now() else null end;
begin
  with e as (
    update gig_posts set status = 'expired', updated_at = now()
    where status in ('new','drafted')
      and coalesce(posted_at, first_seen_at) < now() - make_interval(hours => hrs)
    returning post_key
  )
  select coalesce(array_agg('gig:' || post_key), '{}') into keys from e;

  insert into console_events (entity, entity_id, action, before, after, actor)
  select 'outreach', q.outreach_id, 'gig_expire',
         jsonb_build_object('approval_status', q.approval_status),
         jsonb_build_object('approval_status', 'superseded'), 'gig_expire'
  from outreach_queue q
  where q.lead_track = 'gig_post' and q.account_id = any (keys)
    and q.approval_status in ('pending','edited','needs_redraft') and q.send_status = 'not_sent';

  update outreach_queue q set approval_status = 'superseded',
                              dashboard_dirty_at = coalesce(dirty, q.dashboard_dirty_at)
  where q.lead_track = 'gig_post' and q.account_id = any (keys)
    and q.approval_status in ('pending','edited','needs_redraft') and q.send_status = 'not_sent';
  get diagnostics n_sup = row_count;

  return jsonb_build_object('expired', cardinality(keys), 'superseded', n_sup);
end $$;

-- 7. Views: new columns appended at the end ---------------------------------------------
create or replace view n8n_outreach_queue_sheet as
select coalesce(gtm_iso(run_date), '') as run_date, outreach_id,
       coalesce(account_id, '') as account_id, coalesce(contact_id, '') as contact_id,
       coalesce(company_name, '') as company_name, coalesce(contact_name, '') as contact_name,
       coalesce(channel, '') as channel, coalesce(angle, '') as angle, coalesce(trigger, '') as trigger,
       coalesce(pain_point, '') as pain_point, coalesce(value_proposition, '') as value_proposition,
       coalesce(proof_point, '') as proof_point, coalesce(cta, '') as cta,
       coalesce(email_subject, '') as email_subject, coalesce(first_line, '') as first_line,
       coalesce(message_draft, '') as message_draft, coalesce(follow_up_1, '') as follow_up_1,
       coalesce(follow_up_2, '') as follow_up_2, coalesce(follow_up_3, '') as follow_up_3,
       coalesce(linkedin_note, '') as linkedin_note, coalesce(risk_notes, '') as risk_notes,
       approval_status, send_status, coalesce(gtm_iso(sent_at), '') as sent_at,
       coalesce(reply_received, '') as reply_received, coalesce(notes, '') as notes,
       coalesce(llm_provider, '') as llm_provider, coalesce(llm_calls, 0) as llm_calls,
       coalesce(llm_failures, 0) as llm_failures,
       coalesce(reject_scope, '') as reject_scope,                 -- S14
       coalesce(gtm_iso(reviewed_at), '') as reviewed_at,          -- S14
       lead_track                                                  -- S15
from outreach_queue
order by coalesce(gtm_iso(run_date), '') nulls first, outreach_id;

create or replace view v_review_queue as
select q.outreach_id, q.run_date, q.account_id, q.contact_id, q.company_name, q.contact_name, q.channel,
       q.angle, q.trigger, q.pain_point, q.value_proposition, q.proof_point, q.cta, q.email_subject,
       q.first_line, q.message_draft, q.follow_up_1, q.follow_up_2, q.follow_up_3, q.linkedin_note,
       q.risk_notes, q.approval_status, q.send_status, q.sent_at, q.reply_received, q.notes,
       q.llm_provider, q.llm_calls, q.llm_failures, q.reviewed_at, q.dashboard_dirty_at, q.synced_at,
       a.final_score, a.priority, a.why_match, a.red_flags, a.score_breakdown, a.clay_summary,
       a.tech_stack, a.country, a.website, a.domain, a.employee_count, a.industry,
       a.status as account_status,
       c.title as contact_title, c.email as contact_email, c.email_status,
       c.linkedin_url as contact_linkedin, c.contact_score, c.role_category,
       a.clay_trigger, a.clay_trigger_source, a.clay_trigger_date,
       q.reject_scope, q.angle_basis, q.account_type, q.product_category,     -- S14
       q.lead_track, a.source_meta,                                           -- S15
       g.platform as gig_platform, g.url as gig_url, g.posted_at as gig_posted_at,
       g.reply_count as gig_reply_count, g.matched_stack as gig_matched_stack,
       g.stated_budget as gig_stated_budget, g.status as gig_status, g.gig_score
from outreach_queue q
left join accounts a on a.account_id = q.account_id
left join contacts c on c.contact_id = q.contact_id
left join gig_posts g on q.lead_track = 'gig_post' and q.account_id like 'gig:%'
                     and g.post_key = substr(q.account_id, 5);

-- v_accounts expands a.*, so it is dropped and re-created to show lead_track and source_meta
drop view if exists v_accounts;
create view v_accounts as
select a.*,
       (select count(*)::int from contacts c where c.account_id = a.account_id) as contacts_count,
       (select count(*)::int from outreach_queue q
         where q.account_id = a.account_id and q.approval_status <> 'superseded') as drafts_count,
       (select b.reason from v_outreach_blocks b where b.account_id = a.account_id) as block_reason   -- S14
from accounts a;

-- Gig drafts have no accounts row, so the inner join already drops them; the filter states the rule.
create or replace view v_hubspot_scope as
select q.outreach_id, q.account_id, q.contact_id, q.send_status, q.sent_at, q.channel, q.company_name,
       q.angle, q.trigger, q.value_proposition, q.email_subject, q.message_draft, q.linkedin_note, q.follow_up_1
from outreach_queue q
join accounts a on a.account_id = q.account_id
where (q.approval_status = 'approved' or q.send_status = 'sent')
  and coalesce(a.status, '') <> 'rejected'
  and q.lead_track <> 'gig_post';                                             -- S15

-- 8. Console gig functions (Phase 5) --------------------------------------------------
-- Add a post by hand (Phase 0 outcome: the forums cannot be fetched by a program).
-- The key comes from the URL when it is a known forum or HN link, else manual:<hash>.
-- gig_score stays NULL: the next GTM Gig Finder run gates and scores it like any other post.
create or replace function gtm_gig_add(p_url text, p_title text, p_body text,
                                       p_posted_at timestamptz default null, p_actor text default 'console')
returns jsonb language plpgsql as $$
declare
  u     text := trim(coalesce(p_url, ''));
  ttl   text := trim(coalesce(p_title, ''));
  body  text := trim(coalesce(p_body, ''));
  m     text[];
  k     text;
  plat  text;
  res   jsonb;
begin
  if u !~* '^https?://[^ ]+$' then raise exception 'invalid_url: use the full link to the post'; end if;
  if length(ttl) < 5 then raise exception 'title_too_short'; end if;
  if length(body) < 20 then raise exception 'body_too_short: paste the post text'; end if;
  m := regexp_match(u, '^https?://community\.n8n\.io/t/[^/]+/(\d+)', 'i');
  if m is not null then k := 'n8n:' || m[1]; plat := 'n8n_forum'; end if;
  if k is null then
    m := regexp_match(u, '^https?://community\.make\.com/t/[^/]+/(\d+)', 'i');
    if m is not null then k := 'make:' || m[1]; plat := 'make_forum'; end if;
  end if;
  if k is null then
    m := regexp_match(u, '^https?://news\.ycombinator\.com/item\?id=(\d+)', 'i');
    if m is not null then k := 'hn:' || m[1]; plat := 'hn_freelancer'; end if;
  end if;
  if k is null then k := 'manual:' || left(md5(lower(u)), 12); plat := 'manual'; end if;

  res := gtm_gig_upsert(jsonb_build_object('post_key', k, 'platform', plat, 'url', u, 'title', ttl,
           'body_text', body, 'posted_at', coalesce(p_posted_at, now()), 'status', 'new'));

  insert into console_events (entity, entity_id, action, before, after, actor)
  values ('gig', k, 'add', null, jsonb_build_object('url', u, 'title', ttl, 'result', res), coalesce(p_actor, 'console'));

  return (select to_jsonb(g) from gig_posts g where g.post_key = k);
end $$;

-- Gigs page buttons: replied, won, lost, or dismiss (gated_out with reason dismissed).
-- won and lost are final except for switching between them; dismiss only works before a reply was sent.
create or replace function gtm_gig_status(p_post_key text, p_status text, p_actor text default 'console')
returns jsonb language plpgsql as $$
declare
  g gig_posts%rowtype;
begin
  if p_status is null or p_status not in ('replied','won','lost','dismiss') then
    raise exception 'invalid_status: % (use replied, won, lost or dismiss)', coalesce(p_status, 'null'); end if;
  select * into g from gig_posts where post_key = p_post_key for update;
  if not found then raise exception 'not_found: %', p_post_key; end if;
  if g.status in ('won','lost') and p_status not in ('won','lost') then
    raise exception 'invalid_transition: % -> %', g.status, p_status; end if;
  if p_status = 'dismiss' and g.status not in ('new','drafted','expired') then
    raise exception 'invalid_transition: % -> dismiss', g.status; end if;

  update gig_posts set
    status      = case when p_status = 'dismiss' then 'gated_out' else p_status end,
    gate_reason = case when p_status = 'dismiss' then 'dismissed' else gate_reason end,
    updated_at  = now()
  where post_key = p_post_key;

  insert into console_events (entity, entity_id, action, before, after, actor)
  values ('gig', p_post_key, p_status, jsonb_build_object('status', g.status),
          jsonb_build_object('status', case when p_status = 'dismiss' then 'gated_out' else p_status end),
          coalesce(p_actor, 'console'));

  return (select to_jsonb(x) from gig_posts x where x.post_key = p_post_key);
end $$;

-- Gigs page: one row per post with its age and its live draft, if any.
create or replace view v_gig_posts as
select g.post_key, g.platform, g.url, g.title, g.body_text, g.poster, g.poster_company, g.posted_at,
       g.reply_count, g.contact_email, g.contact_hint, g.stated_budget, g.remote_hint, g.matched_stack,
       g.intent, g.gig_score, g.score_breakdown, g.status, g.gate_reason, g.first_seen_at, g.updated_at,
       round(extract(epoch from (now() - coalesce(g.posted_at, g.first_seen_at))) / 3600)::int as age_hours,
       d.outreach_id, d.approval_status as draft_status, d.send_status as draft_send_status
from gig_posts g
left join lateral (
  select q.outreach_id, q.approval_status, q.send_status
  from outreach_queue q
  where q.lead_track = 'gig_post' and q.account_id = 'gig:' || g.post_key and q.approval_status <> 'superseded'
  order by q.run_date desc nulls last, q.outreach_id desc
  limit 1
) d on true;

commit;
