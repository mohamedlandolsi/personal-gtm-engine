-- =====================================================================
-- Personal GTM Engine: Neon schema v1 (Sprint 10, ops console)
-- Apply once in the Neon SQL Editor (database: neondb, branch: production).
-- Safe to re-run: tables use IF NOT EXISTS, functions and views use
-- CREATE OR REPLACE.
-- Ownership rule: the n8n engine owns every column it writes today.
-- The console owns approval fields, edits, notes and the account veto,
-- and always writes through the gtm_* functions below.
-- =====================================================================

-- ---------- helpers ----------------------------------------------------

-- ISO 8601 UTC with milliseconds, the exact format the engine writes to Sheets
create or replace function gtm_iso(ts timestamptz) returns text
language sql immutable as $$
  select case when ts is null then null
    else to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end
$$;

-- Same, with microseconds. Used as a row version for race-safe sync marks.
create or replace function gtm_iso_us(ts timestamptz) returns text
language sql immutable as $$
  select case when ts is null then null
    else to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end
$$;

-- Cutover switches. outreach_sor = 'sheets' (Phase 3) or 'neon' (Phase 4b).
create table if not exists console_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
insert into console_settings (key, value) values ('outreach_sor', 'sheets')
on conflict (key) do nothing;

create or replace function gtm_setting(p_key text) returns text
language sql stable as $$
  select value from console_settings where key = p_key
$$;

-- ---------- engine tables (mirror the Sheets tabs) ---------------------

create table if not exists accounts (
  account_id                text primary key,
  run_date                  timestamptz,
  source                    text,
  company_name              text,
  domain                    text,
  website                   text,
  industry                  text,
  company_type              text,
  employee_count            integer,
  location_raw              text,
  country                   text,
  timezone_utc_offset       numeric(4,2),
  funding_stage             text,
  final_score               integer,
  priority                  text,
  why_match                 text,
  red_flags                 text,
  score_breakdown           text,
  confidence                integer,
  status                    text,
  linkedin_url              text,
  tech_stack                text,
  funding_proxy_score       integer,
  automation_need_score     integer,
  enrichment_status         text,
  clay_summary              text,
  clay_status               text,
  clay_enriched_at          timestamptz,
  contact_feasibility_score integer,
  contact_status            text,
  dashboard_dirty_at        timestamptz,   -- set by the console, cleared by the sync
  synced_at                 timestamptz,
  clay_trigger              text,          -- Sprint 11: one dated "why now" fact from Clay
  clay_trigger_source       text,          -- hiring | funding | news
  clay_trigger_date         text           -- YYYY-MM-DD or empty; text because Sheets sends "" (ADR-S11-4)
);
-- Sprint 11: adds the trigger columns to an existing accounts table (no-op on a fresh install)
alter table accounts
  add column if not exists clay_trigger text,
  add column if not exists clay_trigger_source text,
  add column if not exists clay_trigger_date text;
create index if not exists accounts_domain_idx on accounts (domain);
create index if not exists accounts_score_idx  on accounts (final_score desc nulls last);

create table if not exists contacts (
  contact_id         text primary key,
  run_date           timestamptz,
  account_id         text,
  company_name       text,
  domain             text,
  full_name          text,
  title              text,
  role_category      text,
  email              text,
  email_status       text,
  linkedin_url       text,
  phone              text,
  source             text,
  confidence         integer,
  contact_score      integer,
  preferred_channel  text,
  status             text,
  contact_key        text,
  account_domain     text,
  dashboard_dirty_at timestamptz,
  synced_at          timestamptz
);
create index if not exists contacts_account_idx on contacts (account_id);

create table if not exists outreach_queue (
  outreach_id        text primary key,
  run_date           timestamptz,
  account_id         text,
  contact_id         text,
  company_name       text,
  contact_name       text,
  channel            text,
  angle              text,
  trigger            text,
  pain_point         text,
  value_proposition  text,
  proof_point        text,
  cta                text,
  email_subject      text,
  first_line         text,
  message_draft      text,
  follow_up_1        text,
  follow_up_2        text,
  follow_up_3        text,
  linkedin_note      text,
  risk_notes         text,
  approval_status    text not null default 'pending',
  send_status        text not null default 'not_sent',
  sent_at            timestamptz,
  reply_received     text,
  notes              text,
  llm_provider       text,
  llm_calls          integer,
  llm_failures       integer,
  reviewed_at        timestamptz,
  dashboard_dirty_at timestamptz,
  synced_at          timestamptz,
  constraint outreach_approval_chk check (approval_status in ('pending','approved','edited','rejected','superseded')),
  constraint outreach_send_chk     check (send_status in ('not_sent','sent','bounced'))
);
create index if not exists outreach_status_idx  on outreach_queue (approval_status, send_status);
create index if not exists outreach_contact_idx on outreach_queue (contact_id);

create table if not exists ops (
  run_at                  timestamptz primary key,
  config_rev              text,
  source                  text,
  seed_rows               integer,
  seen_rows_pre           integer,
  after_filters           integer,
  accounts_written        integer,
  min_account_score       integer,
  warnings                text,
  errors_sample           text,
  rejection_summary       text,
  apollo_companies        integer,
  source_errors           text,
  enriched_rows           integer,
  enrich_errors           text,
  clay_queued             integer,
  clay_merged             integer,
  contacts_discovered     integer,
  contacts_written        integer,
  outreach_drafts_written integer,
  llm_calls               integer,
  llm_failures            integer,
  synced_at               timestamptz
);

create table if not exists digest_ops (
  run_at             timestamptz primary key,
  config_rev         text,
  queue_rows         integer,
  candidates         integer,
  embedded           integer,
  overflow           integer,
  pending_announced  integer,
  approved_announced integer,
  discord_status     text,
  error_sample       text,
  synced_at          timestamptz
);

-- ---------- console-owned tables ---------------------------------------

create table if not exists config_versions (
  id                 bigserial primary key,
  rev                text not null,
  payload_text       text not null,                                        -- exactly as typed
  payload            jsonb generated always as (payload_text::jsonb) stored, -- rejects invalid JSON
  note               text,
  created_by         text not null default 'console',
  created_at         timestamptz not null default now(),
  pushed_to_sheet_at timestamptz
);

create table if not exists console_events (     -- audit log: every human decision
  id         bigserial primary key,
  entity     text not null,                       -- outreach | account | config
  entity_id  text not null,
  action     text not null,
  before     jsonb,
  after      jsonb,
  actor      text not null default 'console',
  created_at timestamptz not null default now()
);
create index if not exists console_events_entity_idx on console_events (entity, entity_id, created_at desc);

create table if not exists sync_ops (            -- telemetry for the GTM Neon Sync workflow
  id               bigserial primary key,
  run_at           timestamptz not null default now(),
  pushed_config    integer,
  pushed_outreach  integer,
  pushed_contacts  integer,
  pushed_accounts  integer,
  pulled_accounts  integer,
  pulled_contacts  integer,
  new_outreach     integer,
  new_ops          integer,
  new_digest_ops   integer,
  config_state     text,
  warnings         text,
  duration_ms      integer
);

-- ---------- console write functions (HITL state machine) ---------------

-- Actions: approve | reject | reopen | save_edits | mark_sent | redraft
create or replace function gtm_review(
  p_id     text,
  p_action text,
  p_edits  jsonb default '{}'::jsonb,
  p_actor  text  default 'console'
) returns jsonb
language plpgsql as $$
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
    if r.approval_status not in ('pending','edited') then
      raise exception 'invalid_transition: % -> approve', r.approval_status; end if;
    new_approval := 'approved';

  elsif p_action = 'reject' then
    if r.send_status <> 'not_sent' then raise exception 'already_sent'; end if;
    if r.approval_status not in ('pending','edited','approved') then
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

  -- In Phase 4b (outreach_sor = 'neon') n8n reads Neon directly, so nothing needs pushing to Sheets.
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
    reviewed_at        = now(),
    dashboard_dirty_at = coalesce(dirty, dashboard_dirty_at)
  where outreach_id = p_id
  returning * into r;

  -- Re-draft: free the contact so the next engine run drafts again (engine reads contacts from Sheets).
  if p_action = 'redraft' and r.contact_id is not null then
    update contacts set status = 'new', dashboard_dirty_at = now() where contact_id = r.contact_id;
  end if;

  after_j := jsonb_build_object('approval_status', r.approval_status, 'send_status', r.send_status) || p_edits;
  insert into console_events (entity, entity_id, action, before, after, actor)
  values ('outreach', p_id, p_action, before_j, after_j, p_actor);

  return to_jsonb(r);
end $$;

-- Manual veto of an account (engine skips status = rejected)
create or replace function gtm_veto_account(p_account_id text, p_reason text default null, p_actor text default 'console')
returns jsonb
language plpgsql as $$
declare
  a accounts%rowtype;
  old_status text;
begin
  select * into a from accounts where account_id = p_account_id for update;
  if not found then raise exception 'not_found: %', p_account_id; end if;
  if a.status = 'rejected' then raise exception 'already_rejected'; end if;
  old_status := a.status;
  update accounts set status = 'rejected', dashboard_dirty_at = now()
  where account_id = p_account_id returning * into a;
  insert into console_events (entity, entity_id, action, before, after, actor)
  values ('account', p_account_id, 'veto', jsonb_build_object('status', old_status),
          jsonb_build_object('status', 'rejected', 'reason', p_reason), p_actor);
  return to_jsonb(a);
end $$;

-- New config version. The "rev" inside the JSON must change on every save.
create or replace function gtm_save_config(p_payload_text text, p_note text default null, p_actor text default 'console')
returns bigint
language plpgsql as $$
declare
  j          jsonb;
  v_rev      text;
  latest_rev text;
  new_id     bigint;
begin
  begin
    j := p_payload_text::jsonb;
  exception when others then
    raise exception 'invalid_json';
  end;
  if jsonb_typeof(j) <> 'object' then raise exception 'config_must_be_object'; end if;
  v_rev := nullif(trim(coalesce(j->>'rev', '')), '');
  if v_rev is null then raise exception 'rev_missing'; end if;
  select rev into latest_rev from config_versions order by id desc limit 1;
  if latest_rev is not distinct from v_rev then raise exception 'rev_unchanged: bump "rev" before saving'; end if;

  insert into config_versions (rev, payload_text, note, created_by)
  values (v_rev, p_payload_text, p_note, p_actor)
  returning id into new_id;

  insert into console_events (entity, entity_id, action, before, after, actor)
  values ('config', new_id::text, 'save', jsonb_build_object('rev', latest_rev), jsonb_build_object('rev', v_rev, 'note', p_note), p_actor);
  return new_id;
end $$;

-- ---------- sync functions (called by the n8n "GTM Neon Sync" workflow) --

-- Rows the console changed that Sheets does not have yet.
-- version = the exact dashboard_dirty_at read, so a change made during the
-- sync is never marked as pushed by mistake.
create or replace function gtm_sync_push_rows()
returns table (tab text, key text, version text, data jsonb)
language sql stable as $$
  select 'config'::text, c.id::text, c.id::text,
         jsonb_build_object('key', 'config_json', 'value', c.payload_text, 'updated_at', gtm_iso(c.created_at))
  from config_versions c
  where c.id = (select max(id) from config_versions) and c.pushed_to_sheet_at is null
  union all
  select 'outreach', q.outreach_id, gtm_iso_us(q.dashboard_dirty_at),
         jsonb_build_object(
           'outreach_id',     q.outreach_id,
           'approval_status', q.approval_status,
           'send_status',     q.send_status,
           'sent_at',         coalesce(gtm_iso(q.sent_at), ''),
           'email_subject',   coalesce(q.email_subject, ''),
           'message_draft',   coalesce(q.message_draft, ''),
           'follow_up_1',     coalesce(q.follow_up_1, ''),
           'follow_up_2',     coalesce(q.follow_up_2, ''),
           'follow_up_3',     coalesce(q.follow_up_3, ''),
           'linkedin_note',   coalesce(q.linkedin_note, ''),
           'notes',           coalesce(q.notes, ''))
  from outreach_queue q
  where q.dashboard_dirty_at is not null and gtm_setting('outreach_sor') = 'sheets'
  union all
  select 'contacts', c.contact_id, gtm_iso_us(c.dashboard_dirty_at),
         jsonb_build_object('contact_id', c.contact_id, 'status', coalesce(c.status, ''))
  from contacts c
  where c.dashboard_dirty_at is not null
  union all
  select 'accounts', a.account_id, gtm_iso_us(a.dashboard_dirty_at),
         jsonb_build_object('account_id', a.account_id, 'status', coalesce(a.status, ''))
  from accounts a
  where a.dashboard_dirty_at is not null
$$;

-- One call per sync: mark pushed rows, upsert everything read from Sheets,
-- check config drift, write one sync_ops row. Returns a summary.
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
    contact_feasibility_score, contact_status, clay_trigger, clay_trigger_source, clay_trigger_date, synced_at)
  select x.account_id, x.run_date, x.source, x.company_name, x.domain, x.website, x.industry, x.company_type,
    x.employee_count, x.location_raw, x.country, x.timezone_utc_offset, x.funding_stage, x.final_score, x.priority,
    x.why_match, x.red_flags, x.score_breakdown, x.confidence, x.status, x.linkedin_url, x.tech_stack,
    x.funding_proxy_score, x.automation_need_score, x.enrichment_status, x.clay_summary, x.clay_status,
    x.clay_enriched_at, x.contact_feasibility_score, x.contact_status,
    x.clay_trigger, x.clay_trigger_source, x.clay_trigger_date, now()
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

-- Phase 4b: the engine's "Append Outreach Queue" node inserts drafts through this function.
-- Ignores unknown keys, turns "" into NULL, never duplicates, and always returns the row,
-- so the next node ("Update Contacts Used") still receives contact_id.
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
      reply_received, notes, llm_provider, llm_calls, llm_failures)
    select x.outreach_id, x.run_date, x.account_id, x.contact_id, x.company_name, x.contact_name, x.channel,
      x.angle, x.trigger, x.pain_point, x.value_proposition, x.proof_point, x.cta, x.email_subject, x.first_line,
      x.message_draft, x.follow_up_1, x.follow_up_2, x.follow_up_3, x.linkedin_note, x.risk_notes,
      coalesce(x.approval_status, 'pending'), coalesce(x.send_status, 'not_sent'), x.sent_at,
      x.reply_received, x.notes, x.llm_provider, x.llm_calls, x.llm_failures
    from clean, jsonb_populate_record(null::outreach_queue, clean.j) as x
    where x.outreach_id is not null
    on conflict (outreach_id) do nothing
    returning *
  )
  select * from ins
  union all
  select q.* from outreach_queue q
  where q.outreach_id = p->>'outreach_id' and not exists (select 1 from ins)
$$;

-- ---------- read views for the console ---------------------------------

create or replace view v_review_queue as
select q.*,
       a.final_score, a.priority, a.why_match, a.red_flags, a.score_breakdown, a.clay_summary,
       a.tech_stack, a.country, a.website, a.domain, a.employee_count, a.industry, a.status as account_status,
       c.title as contact_title, c.email as contact_email, c.email_status, c.linkedin_url as contact_linkedin,
       c.contact_score, c.role_category,
       a.clay_trigger, a.clay_trigger_source, a.clay_trigger_date
from outreach_queue q
left join accounts a on a.account_id = q.account_id
left join contacts c on c.contact_id = q.contact_id;

-- v_accounts selects a.*: when accounts gains columns, Postgres refuses to "replace" the view,
-- so it is dropped and recreated (nothing depends on it; the console reads it on demand).
drop view if exists v_accounts;
create view v_accounts as
select a.*,
       (select count(*)::int from contacts c where c.account_id = a.account_id) as contacts_count,
       (select count(*)::int from outreach_queue q
         where q.account_id = a.account_id and q.approval_status <> 'superseded') as drafts_count
from accounts a;

create or replace view v_sync_health as
select s.id, s.run_at, s.config_state, s.warnings,
       extract(epoch from (now() - s.run_at))::int as age_seconds,
       ((select count(*) from outreach_queue
          where dashboard_dirty_at is not null and gtm_setting('outreach_sor') = 'sheets')
        + (select count(*) from contacts where dashboard_dirty_at is not null)
        + (select count(*) from accounts where dashboard_dirty_at is not null)
        + (select count(*) from config_versions where pushed_to_sheet_at is null))::int as pending_push
from sync_ops s
order by s.id desc
limit 1;

-- ---------- n8n compatibility views (Phase 4 cutover) ------------------
-- Same column names and value formats as the Sheets tabs, so swapping a
-- Google Sheets read node for a Postgres node changes nothing downstream.

create or replace view n8n_config_sheet as
select 'config_json'::text          as key,
       payload_text                 as value,
       'json'::text                 as type,
       ('console rev ' || rev)      as description,
       gtm_iso(created_at)          as updated_at
from config_versions
order by id desc
limit 1;

create or replace view n8n_outreach_queue_sheet as
select coalesce(gtm_iso(run_date), '')     as run_date,
       outreach_id,
       coalesce(account_id, '')            as account_id,
       coalesce(contact_id, '')            as contact_id,
       coalesce(company_name, '')          as company_name,
       coalesce(contact_name, '')          as contact_name,
       coalesce(channel, '')               as channel,
       coalesce(angle, '')                 as angle,
       coalesce(trigger, '')               as trigger,
       coalesce(pain_point, '')            as pain_point,
       coalesce(value_proposition, '')     as value_proposition,
       coalesce(proof_point, '')           as proof_point,
       coalesce(cta, '')                   as cta,
       coalesce(email_subject, '')         as email_subject,
       coalesce(first_line, '')            as first_line,
       coalesce(message_draft, '')         as message_draft,
       coalesce(follow_up_1, '')           as follow_up_1,
       coalesce(follow_up_2, '')           as follow_up_2,
       coalesce(follow_up_3, '')           as follow_up_3,
       coalesce(linkedin_note, '')         as linkedin_note,
       coalesce(risk_notes, '')            as risk_notes,
       approval_status,
       send_status,
       coalesce(gtm_iso(sent_at), '')      as sent_at,
       coalesce(reply_received, '')        as reply_received,
       coalesce(notes, '')                 as notes,
       coalesce(llm_provider, '')          as llm_provider,
       coalesce(llm_calls, 0)              as llm_calls,
       coalesce(llm_failures, 0)           as llm_failures
from outreach_queue
order by run_date nulls first, outreach_id;

-- =====================================================================
-- Sprint 13: HubSpot layer
-- Copied from db/s13_hubspot.sql, which already includes patch 1
-- (db/s13_patch1_legal_basis.sql). Both stay in db/ as migration files.
-- =====================================================================

-- =====================================================================
-- Personal GTM Engine: Sprint 13 HubSpot layer (Neon)
-- Additive only: 2 tables, 5 functions, 6 views. No existing table,
-- view or function is changed. Safe to re-run.
-- Ownership: Neon decides WHAT goes to HubSpot (the outbox views) and
-- remembers WHAT IS THERE (hubspot_links). n8n only carries requests.
-- After a deal exists, HubSpot owns its stage; the pull copies it back.
-- =====================================================================

-- ---------- tables ------------------------------------------------------

-- One row per local record that exists in HubSpot. This is the idempotency
-- key: a row here means "never create this again, update it by id".
create table if not exists hubspot_links (
  link_type        text not null,   -- companies | contacts | deals | notes | tasks | deal_contacted
  local_id         text not null,   -- account_id | contact_id | account_id | outreach_id | outreach_id | outreach_id
  hubspot_id       text not null,
  pushed_hash      text,            -- md5 of the properties last sent (change detection)
  deal_stage       text,            -- deals only: last stage id seen in HubSpot
  stage_changed_at timestamptz,
  first_pushed_at  timestamptz not null default now(),
  pushed_at        timestamptz not null default now(),
  primary key (link_type, local_id)
);
create index if not exists hubspot_links_hs_idx on hubspot_links (link_type, hubspot_id);

-- Append-only log of every push attempt and every stage pull (telemetry).
create table if not exists hubspot_events (
  id         bigserial primary key,
  run_id     text not null,         -- n8n $execution.id
  link_type  text not null,
  local_id   text not null,
  action     text not null,         -- created | updated | adopted | failed | stage_changed | stages_pulled
  hubspot_id text,
  error      text,
  created_at timestamptz not null default now()
);
create index if not exists hubspot_events_key_idx on hubspot_events (link_type, local_id, created_at desc);
create index if not exists hubspot_events_run_idx on hubspot_events (run_id);

-- ---------- helpers -----------------------------------------------------

-- The "hubspot" block of the latest console config ({} when missing).
create or replace function gtm_hubspot_cfg() returns jsonb
language sql stable as $$
  select coalesce((select payload->'hubspot' from config_versions order by id desc limit 1), '{}'::jsonb)
$$;

-- Notes and task bodies are HTML in HubSpot: escape, then keep line breaks.
create or replace function gtm_html(t text) returns text
language sql immutable as $$
  select case when t is null then null else
    replace(replace(replace(replace(t, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), E'\n', '<br>') end
$$;

-- Failed attempts since the last success. 3 or more = quarantined (skipped).
create or replace function gtm_hubspot_failures(p_link_type text, p_local_id text) returns int
language sql stable as $$
  select count(*)::int from hubspot_events e
  where e.link_type = p_link_type and e.local_id = p_local_id and e.action = 'failed'
    and e.created_at > coalesce((select l.pushed_at from hubspot_links l
                                 where l.link_type = p_link_type and l.local_id = p_local_id), '-infinity')
$$;

-- ---------- views read by n8n ------------------------------------------

-- One row: switches and ids for the GTM HubSpot Sync workflow.
create or replace view v_hubspot_config as
select coalesce((h->>'enabled')::boolean, false)                         as enabled,
       least(greatest(coalesce((h->>'max_per_run')::int, 5), 0), 50)     as max_per_run,
       coalesce(h->>'pipeline_id', 'default')                            as pipeline_id,
       h->'stages'                                                       as stages,
       (extract(epoch from coalesce(
          (select max(e.created_at) from hubspot_events e where e.action = 'stages_pulled') - interval '10 minutes',
          now() - interval '30 days')) * 1000)::bigint::text             as stage_pull_since_ms
from (select gtm_hubspot_cfg() as h) c;

-- Drafts in CRM scope: a human approved them (or already sent them), account not vetoed.
create or replace view v_hubspot_scope as
select q.outreach_id, q.account_id, q.contact_id, q.send_status, q.sent_at, q.channel, q.company_name,
       q.angle, q.trigger, q.value_proposition, q.email_subject, q.message_draft, q.linkedin_note, q.follow_up_1
from outreach_queue q
join accounts a on a.account_id = q.account_id
where (q.approval_status = 'approved' or q.send_status = 'sent')
  and coalesce(a.status, '') <> 'rejected';

-- The outbox: every HubSpot write still to do, already shaped as API payloads.
-- step 1 companies, 2 contacts, 3 deals, 4 notes, 5 tasks, 6 deal stage -> contacted.
-- A step only lists rows whose parents are already linked, so the order is enforced by data.
-- Text columns are never NULL (n8n sub-workflow inputs are typed strings): '' means "none".
create or replace view v_hubspot_outbox as
with cfg as (select gtm_hubspot_cfg() as h),
co as (
  select a.account_id, a.domain,
         jsonb_strip_nulls(jsonb_build_object(
           'name',                  nullif(a.company_name, ''),
           'domain',                nullif(a.domain, ''),
           'website',               nullif(a.website, ''),
           'numberofemployees',     a.employee_count::text,
           'country',               nullif(a.country, ''),
           'linkedin_company_page', nullif(a.linkedin_url, ''),
           'description',           left(coalesce(nullif(a.clay_summary, ''), nullif(a.why_match, '')), 2000),
           'gtm_account_key',        a.account_id,
           'gtm_score',             a.final_score::text,
           'gtm_trigger',           nullif(a.clay_trigger, ''))) as props
  from accounts a
  where a.account_id in (select account_id from v_hubspot_scope)
    and coalesce(a.domain, '') <> ''
),
ct as (
  select c.contact_id, lc.hubspot_id as company_hs_id,
         case when c.email_status = 'verified' then nullif(lower(trim(c.email)), '') end as email,
         jsonb_strip_nulls(jsonb_build_object(
           'firstname',        nullif(split_part(trim(c.full_name), ' ', 1), ''),
           'lastname',         nullif(trim(substr(trim(c.full_name), length(split_part(trim(c.full_name), ' ', 1)) + 1)), ''),
           'email',            case when c.email_status = 'verified' then nullif(lower(trim(c.email)), '') end,
           'jobtitle',         nullif(c.title, ''),
           'company',          nullif(c.company_name, ''),
           coalesce((select h->>'contact_linkedin_property' from cfg), 'hs_linkedin_url'), nullif(c.linkedin_url, ''),
           'gtm_email_status', nullif(c.email_status, ''),
           -- GDPR portal (EU): HubSpot rejects contact creates without a legal basis.
           -- Option value must match HubSpot exactly (it contains an en dash).
           'hs_legal_basis',   coalesce(nullif((select h->>'contact_legal_basis' from cfg), ''),
                                        'Legitimate interest ' || chr(8211) || ' prospect/lead'))) as props
  from contacts c
  join hubspot_links lc on lc.link_type = 'companies' and lc.local_id = c.account_id
  where c.contact_id in (select contact_id from v_hubspot_scope)
),
dl as (
  select distinct on (s.account_id) s.account_id, s.company_name, s.angle, s.trigger, s.value_proposition,
         lc.hubspot_id as company_hs_id, lp.hubspot_id as contact_hs_id
  from v_hubspot_scope s
  join hubspot_links lc on lc.link_type = 'companies' and lc.local_id = s.account_id
  join hubspot_links lp on lp.link_type = 'contacts'  and lp.local_id = s.contact_id
  order by s.account_id, s.outreach_id
),
act as (
  select s.*, lc.hubspot_id as company_hs_id, lp.hubspot_id as contact_hs_id,
         ld.hubspot_id as deal_hs_id, ld.deal_stage
  from v_hubspot_scope s
  join hubspot_links lc on lc.link_type = 'companies' and lc.local_id = s.account_id
  join hubspot_links lp on lp.link_type = 'contacts'  and lp.local_id = s.contact_id
  join hubspot_links ld on ld.link_type = 'deals'     and ld.local_id = s.account_id
  where s.send_status = 'sent' and s.sent_at is not null
),
outbox as (
  -- 1. companies: create, or update when the properties changed
  select 1 as step, 'companies'::text as link_type, 'companies'::text as object, co.account_id as local_id,
         coalesce(l.hubspot_id, '') as hubspot_id, 'domain'::text as key_property, co.domain as key_value,
         co.props as properties, '[]'::jsonb as associations, md5(co.props::text) as properties_hash
  from co
  left join hubspot_links l on l.link_type = 'companies' and l.local_id = co.account_id
  where l.hubspot_id is null or l.pushed_hash is distinct from md5(co.props::text)

  union all
  -- 2. contacts: search by email only when the email is verified
  select 2, 'contacts', 'contacts', ct.contact_id, coalesce(l.hubspot_id, ''),
         'email', coalesce(ct.email, ''), ct.props,
         jsonb_build_array(jsonb_build_object('to', jsonb_build_object('id', ct.company_hs_id),
           'types', jsonb_build_array(jsonb_build_object('associationCategory', 'HUBSPOT_DEFINED', 'associationTypeId', 1)))),
         md5(ct.props::text)
  from ct
  left join hubspot_links l on l.link_type = 'contacts' and l.local_id = ct.contact_id
  where l.hubspot_id is null or l.pushed_hash is distinct from md5(ct.props::text)

  union all
  -- 3. deals: created once at the "approved" stage; afterwards HubSpot owns the deal
  select 3, 'deals', 'deals', dl.account_id, '',
         'dealname', dl.company_name || ' - Outbound',
         jsonb_strip_nulls(jsonb_build_object(
           'dealname',    dl.company_name || ' - Outbound',
           'pipeline',    coalesce(cfg.h->>'pipeline_id', 'default'),
           'dealstage',   cfg.h->'stages'->>'approved',
           'description', left(concat_ws(E'\n', 'Angle: ' || dl.angle, 'Trigger: ' || dl.trigger,
                                         'Value: ' || dl.value_proposition), 2000))),
         jsonb_build_array(
           jsonb_build_object('to', jsonb_build_object('id', dl.company_hs_id),
             'types', jsonb_build_array(jsonb_build_object('associationCategory', 'HUBSPOT_DEFINED', 'associationTypeId', 5))),
           jsonb_build_object('to', jsonb_build_object('id', dl.contact_hs_id),
             'types', jsonb_build_array(jsonb_build_object('associationCategory', 'HUBSPOT_DEFINED', 'associationTypeId', 3)))),
         ''
  from dl cross join cfg
  where cfg.h->'stages'->>'approved' is not null
    and not exists (select 1 from hubspot_links l where l.link_type = 'deals' and l.local_id = dl.account_id)

  union all
  -- 4. notes: what was sent, on the contact, company and deal timelines
  select 4, 'notes', 'notes', act.outreach_id, '', '', '',
         jsonb_build_object(
           'hs_timestamp', gtm_iso(act.sent_at),
           'hs_note_body', left(concat_ws('<br>',
              '<b>Sent by hand via ' || replace(coalesce(act.channel, 'unknown'), '_', ' ') || '</b> (outreach ' || act.outreach_id || ')',
              'Subject: ' || gtm_html(nullif(act.email_subject, '')),
              'LinkedIn note: ' || gtm_html(nullif(act.linkedin_note, '')),
              '',
              gtm_html(act.message_draft)), 60000)),
         jsonb_build_array(
           jsonb_build_object('to', jsonb_build_object('id', act.contact_hs_id),
             'types', jsonb_build_array(jsonb_build_object('associationCategory', 'HUBSPOT_DEFINED', 'associationTypeId', 202))),
           jsonb_build_object('to', jsonb_build_object('id', act.company_hs_id),
             'types', jsonb_build_array(jsonb_build_object('associationCategory', 'HUBSPOT_DEFINED', 'associationTypeId', 190))),
           jsonb_build_object('to', jsonb_build_object('id', act.deal_hs_id),
             'types', jsonb_build_array(jsonb_build_object('associationCategory', 'HUBSPOT_DEFINED', 'associationTypeId', 214)))),
         ''
  from act
  where not exists (select 1 from hubspot_links l where l.link_type = 'notes' and l.local_id = act.outreach_id)

  union all
  -- 5. tasks: follow-up 1 as a HubSpot task, due N days after sending (never in the past)
  select 5, 'tasks', 'tasks', act.outreach_id, '', '', '',
         jsonb_build_object(
           'hs_timestamp',     gtm_iso(greatest(act.sent_at + make_interval(days => coalesce((cfg.h->>'follow_up_days')::int, 3)),
                                                now() + interval '1 hour')),
           'hs_task_subject',  left('Follow up 1: ' || coalesce(act.company_name, act.account_id), 250),
           'hs_task_body',     gtm_html(act.follow_up_1),
           'hs_task_status',   'NOT_STARTED',
           'hs_task_priority', 'MEDIUM',
           'hs_task_type',     case when act.channel = 'email' then 'EMAIL' else 'TODO' end),
         jsonb_build_array(
           jsonb_build_object('to', jsonb_build_object('id', act.contact_hs_id),
             'types', jsonb_build_array(jsonb_build_object('associationCategory', 'HUBSPOT_DEFINED', 'associationTypeId', 204))),
           jsonb_build_object('to', jsonb_build_object('id', act.company_hs_id),
             'types', jsonb_build_array(jsonb_build_object('associationCategory', 'HUBSPOT_DEFINED', 'associationTypeId', 192))),
           jsonb_build_object('to', jsonb_build_object('id', act.deal_hs_id),
             'types', jsonb_build_array(jsonb_build_object('associationCategory', 'HUBSPOT_DEFINED', 'associationTypeId', 216)))),
         ''
  from act cross join cfg
  where coalesce(act.follow_up_1, '') <> ''
    and not exists (select 1 from hubspot_links l where l.link_type = 'tasks' and l.local_id = act.outreach_id)

  union all
  -- 6. deal stage -> contacted, only while the deal still sits at "approved" (never move a deal backwards)
  select 6, 'deal_contacted', 'deals', act.outreach_id, act.deal_hs_id, '', '',
         jsonb_build_object('dealstage', cfg.h->'stages'->>'contacted'),
         '[]'::jsonb, ''
  from act cross join cfg
  where cfg.h->'stages'->>'contacted' is not null
    and (act.deal_stage is null or act.deal_stage = cfg.h->'stages'->>'approved')
    and not exists (select 1 from hubspot_links l where l.link_type = 'deal_contacted' and l.local_id = act.outreach_id)
)
select o.* from outbox o
where gtm_hubspot_failures(o.link_type, o.local_id) < 3;

-- Rows that failed 3 times since their last success: fix the cause, then delete their failed events.
create or replace view v_hubspot_quarantine as
select e.link_type, e.local_id, count(*)::int as failures, max(e.created_at) as last_failed_at,
       (array_agg(e.error order by e.id desc))[1] as last_error
from hubspot_events e
left join hubspot_links l on l.link_type = e.link_type and l.local_id = e.local_id
where e.action = 'failed' and e.created_at > coalesce(l.pushed_at, '-infinity')
group by e.link_type, e.local_id
having count(*) >= 3;

-- ---------- write functions called by n8n -------------------------------

-- One call per pushed record: log the attempt, remember the HubSpot id on success.
-- p = { run_id, link_type, local_id, ok, action, hubspot_id, properties_hash, error }
create or replace function gtm_hubspot_record(p jsonb) returns jsonb
language plpgsql as $$
declare
  v_ok     boolean := coalesce((p->>'ok')::boolean, false);
  v_type   text    := p->>'link_type';
  v_local  text    := p->>'local_id';
  v_id     text    := nullif(p->>'hubspot_id', '');
  v_action text    := case when v_ok then coalesce(nullif(p->>'action', ''), 'updated') else 'failed' end;
  cfg      jsonb   := gtm_hubspot_cfg();
begin
  if v_type is null or v_local is null then raise exception 'link_type_and_local_id_required'; end if;

  insert into hubspot_events (run_id, link_type, local_id, action, hubspot_id, error)
  values (coalesce(nullif(p->>'run_id', ''), 'manual'), v_type, v_local, v_action, v_id,
          case when v_ok then null else left(coalesce(p->>'error', 'unknown_error'), 1000) end);

  if v_ok and v_id is not null then
    insert into hubspot_links (link_type, local_id, hubspot_id, pushed_hash)
    values (v_type, v_local, v_id, p->>'properties_hash')
    on conflict (link_type, local_id) do update
      set hubspot_id = excluded.hubspot_id, pushed_hash = excluded.pushed_hash, pushed_at = now();

    if v_type = 'deals' and v_action = 'created' then
      update hubspot_links set deal_stage = cfg->'stages'->>'approved', stage_changed_at = now()
      where link_type = 'deals' and local_id = v_local;
    elsif v_type = 'deal_contacted' then
      update hubspot_links set deal_stage = cfg->'stages'->>'contacted', stage_changed_at = now()
      where link_type = 'deals' and hubspot_id = v_id;
    end if;
  end if;

  return jsonb_build_object('ok', v_ok, 'link_type', v_type, 'local_id', v_local, 'action', v_action);
end $$;

-- One call per sync run with the deals HubSpot changed since the watermark.
-- Copies the stage back; a reply stage marks the sent drafts of that account as replied.
-- p = { run_id, results: [ { id, properties: { dealstage } } ] }
create or replace function gtm_hubspot_pull_stages(p jsonb) returns jsonb
language plpgsql as $$
declare
  cfg        jsonb := gtm_hubspot_cfg();
  v_run      text  := coalesce(nullif(p->>'run_id', ''), 'manual');
  reply_ids  text[];
  r          record;
  n_seen     int := 0;
  n_changed  int := 0;
  n_replied  int := 0;
  n          int;
begin
  reply_ids := array(select jsonb_array_elements_text(coalesce(cfg->'reply_stage_ids', '[]'::jsonb)));

  for r in
    select x.id::text as deal_id, x.properties->>'dealstage' as stage
    from jsonb_to_recordset(coalesce(p->'results', '[]'::jsonb)) as x(id text, properties jsonb)
  loop
    n_seen := n_seen + 1;
    update hubspot_links set deal_stage = r.stage, stage_changed_at = now()
    where link_type = 'deals' and hubspot_id = r.deal_id and deal_stage is distinct from r.stage;
    if found then
      n_changed := n_changed + 1;
      insert into hubspot_events (run_id, link_type, local_id, action, hubspot_id, error)
      select v_run, 'deals', l.local_id, 'stage_changed', r.deal_id, 'stage=' || coalesce(r.stage, '')
      from hubspot_links l where l.link_type = 'deals' and l.hubspot_id = r.deal_id;

      if r.stage = any(reply_ids) then
        with upd as (
          update outreach_queue q set reply_received = 'yes'
          from hubspot_links l
          where l.link_type = 'deals' and l.hubspot_id = r.deal_id and q.account_id = l.local_id
            and q.send_status = 'sent' and coalesce(q.reply_received, '') <> 'yes'
          returning q.outreach_id
        )
        insert into console_events (entity, entity_id, action, before, after, actor)
        select 'outreach', upd.outreach_id, 'crm_reply', jsonb_build_object('reply_received', null),
               jsonb_build_object('reply_received', 'yes', 'deal_stage', r.stage), 'hubspot'
        from upd;
        get diagnostics n = row_count;
        n_replied := n_replied + n;
      end if;
    end if;
  end loop;

  -- Watermark row, written every run, even when nothing changed.
  insert into hubspot_events (run_id, link_type, local_id, action, error)
  values (v_run, 'deals', '*', 'stages_pulled', 'seen=' || n_seen || ' changed=' || n_changed || ' replied=' || n_replied);

  return jsonb_build_object('seen', n_seen, 'changed', n_changed, 'replied', n_replied);
end $$;

-- ---------- views read by the console -----------------------------------

-- One row per sync run.
create or replace view v_hubspot_runs as
select e.run_id,
       min(e.created_at)                                       as started_at,
       count(*) filter (where e.action = 'created')::int       as created,
       count(*) filter (where e.action = 'updated')::int       as updated,
       count(*) filter (where e.action = 'adopted')::int       as adopted,
       count(*) filter (where e.action = 'failed')::int        as failed,
       count(*) filter (where e.action = 'stage_changed')::int as stage_changes,
       string_agg(distinct left(e.error, 160), ' | ') filter (where e.action = 'failed') as errors_sample
from hubspot_events e
group by e.run_id;

-- CRM state per draft, for the queue and account pages.
create or replace view v_crm_status as
select q.outreach_id, q.account_id, q.contact_id,
       lc.hubspot_id as company_hs_id,
       lp.hubspot_id as contact_hs_id,
       ld.hubspot_id as deal_hs_id,
       ld.deal_stage,
       ln.hubspot_id as note_hs_id,
       lt.hubspot_id as task_hs_id,
       (select e.error from hubspot_events e
         where e.action = 'failed'
           and ((e.link_type = 'companies' and e.local_id = q.account_id)
             or (e.link_type = 'contacts'  and e.local_id = q.contact_id)
             or (e.link_type = 'deals'     and e.local_id = q.account_id)
             or (e.link_type in ('notes', 'tasks', 'deal_contacted') and e.local_id = q.outreach_id))
           and e.created_at > coalesce(greatest(lc.pushed_at, lp.pushed_at, ld.pushed_at), '-infinity')
           and e.created_at > now() - interval '1 day'      -- old failures that never retried fade out
         order by e.id desc limit 1) as last_error
from outreach_queue q
left join hubspot_links lc on lc.link_type = 'companies' and lc.local_id = q.account_id
left join hubspot_links lp on lp.link_type = 'contacts'  and lp.local_id = q.contact_id
left join hubspot_links ld on ld.link_type = 'deals'     and ld.local_id = q.account_id
left join hubspot_links ln on ln.link_type = 'notes'     and ln.local_id = q.outreach_id
left join hubspot_links lt on lt.link_type = 'tasks'     and lt.local_id = q.outreach_id;
