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

-- Sprint 14 appends columns to this view at the end of the file. Dropping it first keeps the file safe to re-run
-- (create or replace cannot remove columns). Nothing depends on it.
drop view if exists v_review_queue;
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

-- Sprint 14 appends columns to this view at the end of the file. Dropping it first keeps the file safe to re-run
-- (create or replace cannot remove columns). Nothing depends on it.
drop view if exists n8n_outreach_queue_sheet;
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

-- =====================================================================
-- Sprint 14: engine fixes
-- Copied from db/s14_engine_fixes.sql without its begin/commit lines, so this
-- file stays safe to re-run. db/s14_engine_fixes.sql stays as the migration.
-- =====================================================================

-- =====================================================================
-- Personal GTM Engine: Sprint 14 engine fixes (Draft Review 2026-11-03)
-- Additive and safe to re-run. Run on branch s14-test first, then production.
-- What it adds:
--   outreach_queue: reject_scope, angle_basis, account_type, product_category; status needs_redraft
--   gtm_insert_draft(): writes the 4 new columns
--   gtm_review():       reject allowed from needs_redraft, approve refused with a clear message, reopen clears reject_scope
--   gtm_reject():       reject with a scope (contact | pitch | account); account scope also vetoes the account
--   v_outreach_blocks:  accounts the drafter must skip, with the reason
--   n8n_outreach_queue_sheet, v_review_queue, v_accounts: new columns appended at the end
-- =====================================================================

-- 1. New columns and the wider status check -------------------------------------------
alter table outreach_queue
  add column if not exists reject_scope     text,   -- contact | pitch | account; NULL on old rows = account
  add column if not exists angle_basis      text,   -- the business-model fact the angle comes from
  add column if not exists account_type     text,   -- lead_seller | agency | demo_saas | self_serve_saas | hardware | other
  add column if not exists product_category text;   -- sales_tech | crm | enrichment | outbound | deliverability | automation | other

alter table outreach_queue drop constraint if exists outreach_reject_scope_chk;
alter table outreach_queue add constraint outreach_reject_scope_chk
  check (reject_scope is null or reject_scope in ('contact','pitch','account'));

alter table outreach_queue drop constraint if exists outreach_approval_chk;
alter table outreach_queue add constraint outreach_approval_chk
  check (approval_status in ('pending','approved','edited','rejected','superseded','needs_redraft'));

-- 2. gtm_insert_draft: same as Sprint 10, plus the 4 new columns ----------------------
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
      reject_scope, angle_basis, account_type, product_category)
    select x.outreach_id, x.run_date, x.account_id, x.contact_id, x.company_name, x.contact_name, x.channel,
      x.angle, x.trigger, x.pain_point, x.value_proposition, x.proof_point, x.cta, x.email_subject, x.first_line,
      x.message_draft, x.follow_up_1, x.follow_up_2, x.follow_up_3, x.linkedin_note, x.risk_notes,
      coalesce(x.approval_status, 'pending'), coalesce(x.send_status, 'not_sent'), x.sent_at,
      x.reply_received, x.notes, x.llm_provider, x.llm_calls, x.llm_failures,
      x.reject_scope, x.angle_basis, x.account_type, x.product_category
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

-- 3. gtm_review: three small changes, marked S14 ----------------------------------------
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

  if p_action = 'redraft' and r.contact_id is not null then
    update contacts set status = 'new', dashboard_dirty_at = now() where contact_id = r.contact_id;
  end if;

  after_j := jsonb_build_object('approval_status', r.approval_status, 'send_status', r.send_status) || p_edits;
  insert into console_events (entity, entity_id, action, before, after, actor)
  values ('outreach', p_id, p_action, before_j, after_j, p_actor);

  return to_jsonb(r);
end $$;

-- 4. gtm_reject: reject with a scope. account = also veto the account ----------------
create or replace function gtm_reject(p_id text, p_scope text, p_reason text default null, p_actor text default 'console')
returns jsonb language plpgsql as $$
declare
  acc    text;
  st     text;
  reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if p_scope is null or p_scope not in ('contact','pitch','account') then
    raise exception 'invalid_scope: % (use contact, pitch or account)', coalesce(p_scope, 'null'); end if;
  if reason is not null and length(reason) > 500 then raise exception 'reason_too_long'; end if;

  perform gtm_review(p_id, 'reject', '{}'::jsonb, p_actor);   -- all transition rules + audit row

  update outreach_queue set
    reject_scope = p_scope,
    notes = case when reason is null then notes
                 else concat_ws(E'\n', nullif(notes, ''),
                      'Rejected (' || p_scope || ', ' || to_char(now() at time zone 'Africa/Tunis', 'YYYY-MM-DD') || '): ' || reason) end
  where outreach_id = p_id
  returning account_id into acc;

  insert into console_events (entity, entity_id, action, before, after, actor)
  values ('outreach', p_id, 'reject_scope', null, jsonb_build_object('reject_scope', p_scope, 'reason', reason), p_actor);

  if p_scope = 'account' and acc is not null then
    select status into st from accounts where account_id = acc;
    if found and coalesce(st, '') <> 'rejected' then
      perform gtm_veto_account(acc, coalesce(reason, 'draft rejected with scope account'), p_actor);
    end if;
  end if;

  return (select to_jsonb(q) from outreach_queue q where q.outreach_id = p_id);
end $$;

-- 5. v_outreach_blocks: accounts the drafter must skip ---------------------------------
-- account_vetoed          accounts.status = rejected
-- draft_rejected_account  a rejected draft with scope account, or an old rejection with no scope (ADR-103)
-- draft_rejected_pitch    a pitch rejection and no dated trigger newer than that rejection
create or replace view v_outreach_blocks as
with rej as (
  select q.account_id,
         bool_or(coalesce(q.reject_scope, 'account') = 'account')        as hard,
         max(q.reviewed_at) filter (where q.reject_scope = 'pitch')      as pitch_at
  from outreach_queue q
  where q.approval_status = 'rejected' and q.account_id is not null
  group by q.account_id
)
select a.account_id,
       a.company_name,
       case when a.status = 'rejected' then 'account_vetoed'
            when r.hard                then 'draft_rejected_account'
            else                            'draft_rejected_pitch' end as reason,
       r.pitch_at
from accounts a
left join rej r on r.account_id = a.account_id
where a.status = 'rejected'
   or coalesce(r.hard, false)
   or (r.pitch_at is not null
       and not (coalesce(a.clay_trigger_date, '') ~ '^\d{4}-\d{2}-\d{2}$'
                and a.clay_trigger_date::date > (r.pitch_at at time zone 'UTC')::date));

-- 6. Views the engine and the console read: new columns appended at the end ------------
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
       coalesce(gtm_iso(reviewed_at), '') as reviewed_at           -- S14
from outreach_queue
order by coalesce(gtm_iso(run_date), '') nulls first, outreach_id;

-- In schema.sql the Sprint 10 view above expands q.*, which already holds the S14 columns on a re-run,
-- so this definition drops and re-creates the view instead of replacing it.
drop view if exists v_review_queue;
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
       q.reject_scope, q.angle_basis, q.account_type, q.product_category      -- S14
from outreach_queue q
left join accounts a on a.account_id = q.account_id
left join contacts c on c.contact_id = q.contact_id;

-- v_accounts expands a.*, so it is dropped and re-created (nothing depends on it)
drop view if exists v_accounts;
create view v_accounts as
select a.*,
       (select count(*)::int from contacts c where c.account_id = a.account_id) as contacts_count,
       (select count(*)::int from outreach_queue q
         where q.account_id = a.account_id and q.approval_status <> 'superseded') as drafts_count,
       (select b.reason from v_outreach_blocks b where b.account_id = a.account_id) as block_reason   -- S14
from accounts a;

-- =====================================================================
-- Sprint 14 patch
-- Copied from db/s14_patch_blocks.sql without its begin/commit lines, so this
-- file stays safe to re-run. db/s14_patch_blocks.sql stays as the migration.
-- =====================================================================
-- Sprint 14 patch: gate rows with scope 'pitch' block their account.
-- Gate rows are written by the engine with no reviewed_at, so pitch_at was NULL and the account was not blocked
-- (Fini got a second gate row on 2026-11-13). pitch_at now falls back to run_date. Same columns and types: safe to re-run.
create or replace view v_outreach_blocks as
with rej as (
  select q.account_id,
         bool_or(coalesce(q.reject_scope, 'account') = 'account') as hard,
         max(coalesce(q.reviewed_at, q.run_date)) filter (where q.reject_scope = 'pitch') as pitch_at
  from outreach_queue q
  where q.approval_status = 'rejected' and q.account_id is not null
  group by q.account_id
)
select a.account_id,
       a.company_name,
       case when a.status = 'rejected' then 'account_vetoed'
            when r.hard then 'draft_rejected_account'
            else 'draft_rejected_pitch' end as reason,
       r.pitch_at
from accounts a
left join rej r on r.account_id = a.account_id
where a.status = 'rejected'
   or coalesce(r.hard, false)
   or (r.pitch_at is not null
       and not (coalesce(a.clay_trigger_date, '') ~ '^\d{4}-\d{2}-\d{2}$'
                and a.clay_trigger_date::date > (r.pitch_at at time zone 'UTC')::date));

-- =====================================================================
-- Sprint 15: lead tracks, gig lane, console gig functions, HubSpot lead track
-- Copied from db/s15_lead_tracks.sql and db/s15_hubspot.sql without their begin/commit lines, so this
-- file stays safe to re-run. The two db/s15_*.sql files stay as the migrations.
-- =====================================================================
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

-- =====================================================================
-- Personal GTM Engine: Sprint 15 Phase 6, HubSpot lead track (ADR-113)
-- Run after db/s15_lead_tracks.sql. Safe to re-run: same columns, so dependent views are untouched.
-- Needs the HubSpot property gtm_lead_track (single-line text) on companies and deals FIRST,
-- otherwise HubSpot rejects the company updates (created 2026-11-15 through the HubSpot connector).
-- What it changes in v_hubspot_outbox:
--   companies: payload gains gtm_lead_track (smb_direct or agency_partner). The payload hash changes, so every
--              linked company is updated once on the next GTM HubSpot Sync runs (10 per run), then nothing.
--   deals:     new deals carry gtm_lead_track. Existing deals are not touched (HubSpot owns a deal after create).
-- gig_post drafts never reach HubSpot (v_hubspot_scope, db/s15_lead_tracks.sql); a won gig gets a manual company + deal.
-- =====================================================================

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
           'gtm_trigger',           nullif(a.clay_trigger, ''),
           'gtm_lead_track',        nullif(a.lead_track, ''))) as props   -- S15
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
         lc.hubspot_id as company_hs_id, lp.hubspot_id as contact_hs_id,
         (select a.lead_track from accounts a where a.account_id = s.account_id) as lead_track   -- S15
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
           'gtm_lead_track', nullif(dl.lead_track, ''),   -- S15
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

-- =====================================================================
-- Sprint 17: agent ingest
-- Copied from db/s17_agent_ingest.sql without its begin/commit lines, so this
-- file stays safe to re-run. db/s17_agent_ingest.sql stays as the migration.
-- =====================================================================
-- =====================================================================
-- Personal GTM Engine: Sprint 17 agent lead ingest (ADR-133 to ADR-136)
-- Additive, one transaction, safe to re-run. Run on branch s17-test first, then production.
-- What it adds:
--   agent_ingest_log, v_agent_ingest_runs:    one row per call from the Claude lead digest, per-run rollup
--   gtm_norm_domain(), gtm_norm_li(), gtm_clamp_int(), gtm_words(), gtm_slug(), gtm_role_category(),
--   gtm_gig_key(), gtm_agent_owned():         small pure helpers
-- Tested on branch s17-test (2026-11-18): 9 Notion leads inserted, 12 edge cases (dedupe, gates,
-- validator, gig path, veto sync exclusion, HubSpot outbox) behaved as designed.
--   gtm_agent_check():                        dedupe pre-check the agent calls BEFORE it spends enrichment credits
--   gtm_ingest_agent_lead():                  the only write path for the agent: gates, dedupe, validator, inserts
--   v_agent_domains:                          agent-owned domains, for an optional engine dedupe read later
-- What it changes:
--   gig_posts.gig_platform_chk:               adds 'agent_web' (widening only)
--   gtm_sync_push_rows(), v_sync_health:      agent-owned accounts and contacts never go to the Sheet
--                                             (they are not in it, so an Update Row there has nothing to match)
-- Agent-owned = accounts.source / contacts.source = 'claude_digest'. Neon is their system of record.
-- =====================================================================

-- 1. Ingest log ---------------------------------------------------------
create table if not exists agent_ingest_log (
  id              bigserial primary key,
  run_id          text,
  agent           text not null,
  lead_type       text,
  domain          text,
  post_key        text,
  result          text not null,        -- inserted | duplicate:<where> | rejected:<reason> | error:<message>
  account_id      text,
  contact_id      text,
  outreach_id     text,
  approval_status text,                 -- pending | needs_redraft (inserted rows only)
  issues          text[],
  score           integer,
  payload         jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists agent_ingest_log_domain_idx on agent_ingest_log (domain);
create index if not exists agent_ingest_log_run_idx on agent_ingest_log (run_id);

-- 2. Helpers ------------------------------------------------------------
-- 'https://www.Acme.io/pricing?x=1' -> 'acme.io'
create or replace function gtm_norm_domain(t text) returns text
language sql immutable as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(trim(coalesce(t, ''))), '^[a-z][a-z0-9+.-]*://', ''),
      '^www\.', ''),
    '[/:?#].*$', ''),
  '')
$$;

-- 'https://fr.linkedin.com/in/Jane-Doe/?utm=x' -> 'linkedin.com/in/jane-doe'; anything else -> null
create or replace function gtm_norm_li(t text) returns text
language sql immutable as $$
  select case when x ~ '^linkedin\.com/(in|company)/[^/]+$' then x end
  from (select rtrim(regexp_replace(split_part(split_part(lower(trim(coalesce(t, ''))), '?', 1), '#', 1),
                     '^(https?://)?([a-z]{2,3}\.)?', ''), '/') as x) s
$$;

create or replace function gtm_clamp_int(t text, lo int, hi int) returns int
language sql immutable as $$
  select case when t ~ '^\s*\d+(\.\d+)?\s*$' then least(hi, greatest(lo, round(trim(t)::numeric)::int)) end
$$;

create or replace function gtm_words(t text) returns int
language sql immutable as $$
  select case when nullif(trim(coalesce(t, '')), '') is null then 0
              else array_length(regexp_split_to_array(trim(t), '\s+'), 1) end
$$;

-- 'JB Jézéquel' -> 'jb_jezequel' (same shape as the engine's contact ids)
create or replace function gtm_slug(t text) returns text
language sql immutable as $$
  select nullif(trim(both '_' from left(regexp_replace(
    translate(lower(coalesce(t, '')), 'áàâäãåāçćčéèêëēęíìîïīñńóòôöõøōśšúùûüūýÿžźżłß',
                                     'aaaaaaaccceeeeeeiiiiinnooooooossuuuuuyyzzzls'),
    '[^a-z0-9]+', '_', 'g'), 40)), '')
$$;

create or replace function gtm_role_category(title text) returns text
language sql immutable as $$
  select case
    when title ~* 'founder' then 'founder'
    when title ~* '\y(ceo|chief executive)\y' then 'ceo'
    when title ~* 'rev ?ops|revenue op' then 'revops'
    when title ~* '\ygtm\y|go.to.market' then 'gtm'
    when title ~* 'sales|business development|account exec' then 'sales'
    when title ~* 'growth|marketing|demand gen' then 'mkt'
    when title ~* 'managing (partner|director)|\yowner\y' then 'founder'
    else 'other' end
$$;

-- Same keys as gtm_gig_add(), so a post pasted by hand and found by the agent collide on purpose.
create or replace function gtm_gig_key(u text) returns text
language sql immutable as $$
  select case
    when u ~* '^https?://community\.n8n\.io/t/[^/]+/\d+'
      then 'n8n:'  || (regexp_match(u, '^https?://community\.n8n\.io/t/[^/]+/(\d+)', 'i'))[1]
    when u ~* '^https?://community\.make\.com/t/[^/]+/\d+'
      then 'make:' || (regexp_match(u, '^https?://community\.make\.com/t/[^/]+/(\d+)', 'i'))[1]
    when u ~* '^https?://news\.ycombinator\.com/item\?id=\d+'
      then 'hn:'   || (regexp_match(u, '^https?://news\.ycombinator\.com/item\?id=(\d+)', 'i'))[1]
    else 'manual:' || left(md5(lower(trim(u))), 12) end
$$;

create or replace function gtm_agent_owned(src text) returns boolean
language sql immutable as $$
  select coalesce(src, '') = 'claude_digest'
$$;

-- 3. Gig platform: widen the check ---------------------------------------
alter table gig_posts drop constraint if exists gig_platform_chk;
alter table gig_posts add constraint gig_platform_chk
  check (platform = any (array['n8n_forum','make_forum','hn_freelancer','manual','agent_web']));

-- 4. Pre-check (read only) -------------------------------------------------
-- The agent calls this with every candidate BEFORE enrichment. Only 'new' rows are worth credits.
create or replace function gtm_agent_check(p_domains text[] default '{}', p_post_urls text[] default '{}')
returns table(input text, normalized text, status text)
language sql stable as $$
  select x, gtm_norm_domain(x),
    case
      when coalesce(gtm_norm_domain(x), '') !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' then 'invalid'
      when exists (select 1 from accounts a where gtm_norm_domain(a.domain) = gtm_norm_domain(x)) then 'known:accounts'
      when exists (select 1 from contacts c where gtm_norm_domain(coalesce(c.account_domain, c.domain)) = gtm_norm_domain(x)) then 'known:contacts'
      when exists (select 1 from agent_ingest_log l where l.domain = gtm_norm_domain(x)
                     and l.result like 'rejected:%' and l.created_at > now() - interval '30 days') then 'recently_rejected'
      else 'new' end
  from unnest(coalesce(p_domains, '{}'::text[])) as t(x)
  union all
  select u, gtm_gig_key(u),
    case
      when u !~* '^https?://[^ ]+$' then 'invalid'
      when exists (select 1 from gig_posts g where g.post_key = gtm_gig_key(u)) then 'known:gig_posts'
      else 'new' end
  from unnest(coalesce(p_post_urls, '{}'::text[])) as t(u)
$$;

-- 5. The write path --------------------------------------------------------
-- Payload (one lead per call):
-- { "run_id": "claude-digest-2026-11-20",
--   "lead_type": "outbound_account" | "agency_partner" | "seeking_freelancer",
--   "company_name", "domain", "website", "company_linkedin", "country", "industry", "employee_count",
--   "what_they_sell", "signal", "signal_date": "YYYY-MM-DD", "signal_url", "why_chosen",
--   "sources": ["HN","Clay"], "source_urls": ["https://..."],
--   "score": 78, "score_parts": {"need":22,"icp":25,"reach":10,"timing":6,"practical":15},
--   "best_channel": "email" | "linkedin_connection" | "linkedin_inmail" | "reply_to_post",
--   "contact": {"full_name","title","linkedin_url","email",
--               "email_status": "verified" | "found_unverified" | "pattern_guess" | "not_found"},
--   "drafts":  {"email_subject","email_body","follow_up_day4","linkedin_note",
--               "inmail_subject","inmail_body","reply_to_post","first_project","proof_point"},
--   "post":    {"url","title","body","poster","posted_at","stated_budget","remote_hint","matched_stack"} }
create or replace function gtm_ingest_agent_lead(p jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_agent    constant text := 'claude_digest';
  v_day      text := to_char(now() at time zone 'UTC', 'YYYYMMDD');
  v_run      text;
  v_type     text;
  v_track    text;
  v_dom      text;
  v_company  text;
  v_acc      text;
  v_ct       text;
  v_out      text;
  v_key      text;
  v_plat     text;
  v_url      text;
  c          jsonb;
  d          jsonb;
  sp         jsonb;
  pst        jsonb;
  v_need     int; v_icp int; v_reach int; v_timing int; v_prac int;
  v_score_in int;
  v_score    int;
  v_bd       text;
  v_emp      int;
  v_name     text; v_title text; v_li text; v_email text; v_estat text; v_slug text;
  v_best     text; v_channel text;
  v_subject  text; v_body text; v_fu text; v_note text; v_inm_s text; v_inm_b text; v_reply text;
  v_msg      text; v_subj_out text; v_first text; v_notes text; v_risk text; v_all text;
  v_issues   text[] := '{}';
  v_sig_date text;
  v_posted   text;
  v_meta     jsonb;
  v_approval text;
  v_result   text;
  v_pos      int;
  n          int;
begin
  <<main>>
  begin
    if p is null or jsonb_typeof(p) <> 'object' then v_result := 'rejected:payload_not_object'; exit main; end if;

    v_run   := left(nullif(trim(coalesce(p->>'run_id', '')), ''), 80);
    v_type  := lower(trim(coalesce(p->>'lead_type', '')));
    v_track := case v_type when 'outbound_account'   then 'smb_direct'
                           when 'agency_partner'     then 'agency_partner'
                           when 'seeking_freelancer' then 'gig_post' end;
    if v_track is null then v_result := 'rejected:invalid_lead_type'; exit main; end if;

    c   := case when jsonb_typeof(p->'contact')     = 'object' then p->'contact'     else '{}'::jsonb end;
    d   := case when jsonb_typeof(p->'drafts')      = 'object' then p->'drafts'      else '{}'::jsonb end;
    sp  := case when jsonb_typeof(p->'score_parts') = 'object' then p->'score_parts' else '{}'::jsonb end;
    pst := case when jsonb_typeof(p->'post')        = 'object' then p->'post'        else '{}'::jsonb end;

    v_dom      := gtm_norm_domain(p->>'domain');
    v_company  := left(coalesce(nullif(trim(p->>'company_name'), ''), v_dom), 200);
    v_emp      := gtm_clamp_int(p->>'employee_count', 0, 10000000);
    v_sig_date := case when (p->>'signal_date') ~ '^\d{4}-\d{2}-\d{2}$' then p->>'signal_date' end;

    -- Gate 1: score. Recomputed from the five parts when all are present: never trust LLM arithmetic.
    v_score_in := gtm_clamp_int(p->>'score', 0, 100);
    v_need     := gtm_clamp_int(sp->>'need', 0, 35);
    v_icp      := gtm_clamp_int(sp->>'icp', 0, 25);
    v_reach    := gtm_clamp_int(sp->>'reach', 0, 15);
    v_timing   := gtm_clamp_int(sp->>'timing', 0, 10);
    v_prac     := gtm_clamp_int(sp->>'practical', 0, 15);
    if v_need is not null and v_icp is not null and v_reach is not null and v_timing is not null and v_prac is not null then
      v_score := v_need + v_icp + v_reach + v_timing + v_prac;
      -- Ledger values are percent of each factor's max, like the engine's breakdown.
      v_bd := format('need=%s; icp=%s; feasibility=%s; timing=%s; practical=%s',
                round(v_need * 100.0 / 35), round(v_icp * 100.0 / 25), round(v_reach * 100.0 / 15),
                round(v_timing * 100.0 / 10), round(v_prac * 100.0 / 15));
    else
      v_score := v_score_in;
    end if;
    if v_score is null then v_result := 'rejected:no_score'; exit main; end if;
    if v_score < 55 then v_result := 'rejected:score_below_55'; exit main; end if;
    if v_emp > 200 then v_result := 'rejected:over_200_people'; exit main; end if;

    -- Contact and drafts
    v_name  := left(nullif(trim(coalesce(c->>'full_name', '')), ''), 120);
    v_title := left(nullif(trim(coalesce(c->>'title', '')), ''), 160);
    v_li    := gtm_norm_li(c->>'linkedin_url');
    v_email := lower(trim(coalesce(c->>'email', '')));
    if v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then v_email := null; end if;
    v_estat := case lower(trim(coalesce(c->>'email_status', '')))
                 when 'verified' then 'verified'
                 when 'found_unverified' then 'unverified'
                 when 'unverified' then 'unverified'
                 when 'pattern_guess' then 'pattern_guess'
                 else 'not_found' end;
    if v_email is null then v_estat := 'not_found'; end if;

    v_subject := nullif(trim(coalesce(d->>'email_subject', '')), '');
    v_body    := nullif(trim(coalesce(d->>'email_body', '')), '');
    v_fu      := nullif(trim(coalesce(d->>'follow_up_day4', '')), '');
    v_note    := nullif(trim(coalesce(d->>'linkedin_note', '')), '');
    v_inm_s   := nullif(trim(coalesce(d->>'inmail_subject', '')), '');
    v_inm_b   := nullif(trim(coalesce(d->>'inmail_body', '')), '');
    v_reply   := nullif(trim(coalesce(d->>'reply_to_post', '')), '');
    v_best    := lower(trim(coalesce(p->>'best_channel', '')));

    if v_track <> 'gig_post' then
      -- Gate 2: account leads need a real domain and a named person
      if v_dom is null or v_dom !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' then v_result := 'rejected:no_domain'; exit main; end if;
      if v_name is null then v_result := 'rejected:no_contact'; exit main; end if;
      if v_best = 'email' and v_estat in ('verified', 'unverified') and v_body is not null then
        v_channel := 'email';           v_msg := v_body;                    v_subj_out := v_subject;
      else
        v_channel := 'linkedin_manual'; v_msg := coalesce(v_inm_b, v_body); v_subj_out := v_inm_s;
      end if;
      if v_msg is null then v_result := 'rejected:no_draft'; exit main; end if;

      -- Gate 3: dedupe against everything the engine and the console already hold
      if exists (select 1 from accounts a where gtm_norm_domain(a.domain) = v_dom) then
        v_result := 'duplicate:accounts'; exit main; end if;
      if exists (select 1 from contacts x where gtm_norm_domain(coalesce(x.account_domain, x.domain)) = v_dom) then
        v_result := 'duplicate:contacts_domain'; exit main; end if;
      if v_li is not null and exists (select 1 from contacts x
           where gtm_norm_li(x.linkedin_url) = v_li
              or (x.contact_key like 'li:%' and gtm_norm_li(substr(x.contact_key, 4)) = v_li)) then
        v_result := 'duplicate:contact_linkedin'; exit main; end if;
      if v_email is not null and exists (select 1 from contacts x where lower(trim(x.email)) = v_email) then
        v_result := 'duplicate:contact_email'; exit main; end if;
    else
      -- Gate 2 for gig posts: a real post URL and a reply
      v_url := nullif(trim(coalesce(pst->>'url', p->>'post_url', '')), '');
      if v_url is null or v_url !~* '^https?://[^ ]+$' then v_result := 'rejected:no_post_url'; exit main; end if;
      v_key  := gtm_gig_key(v_url);
      v_plat := case split_part(v_key, ':', 1) when 'n8n' then 'n8n_forum' when 'make' then 'make_forum'
                                              when 'hn' then 'hn_freelancer' else 'agent_web' end;
      if v_best = 'email' and v_email is not null and v_body is not null then
        v_channel := 'email';       v_msg := v_body;                     v_subj_out := v_subject;
      else
        v_channel := 'forum_reply'; v_msg := coalesce(v_reply, v_body);  v_subj_out := null;
      end if;
      if v_msg is null then v_result := 'rejected:no_draft'; exit main; end if;
      if exists (select 1 from gig_posts g where g.post_key = v_key) then
        v_result := 'duplicate:gig_posts'; exit main; end if;
      v_posted := case when (pst->>'posted_at') ~ '^\d{4}-\d{2}-\d{2}' then pst->>'posted_at' end;
    end if;

    -- Validator: problems park the draft in Re-draft instead of dropping the lead
    v_all := concat_ws(E'\n', v_subj_out, v_msg, v_fu, v_note, v_inm_s, v_inm_b, v_reply, v_body);
    if strpos(v_all, chr(8212)) > 0 or strpos(v_all, chr(8211)) > 0 then v_issues := array_append(v_issues, 'dash'); end if;
    if v_all ~* '\{\{|\[(first ?name|name|company|your name)\]|lorem ipsum|\yTODO\y' then
      v_issues := array_append(v_issues, 'placeholder'); end if;
    if v_channel = 'email' then
      if v_subj_out is null then v_issues := array_append(v_issues, 'no_subject'); end if;
      if gtm_words(v_msg) not between 40 and 150 then v_issues := array_append(v_issues, 'email_length'); end if;
    end if;
    if v_channel = 'forum_reply' and gtm_words(v_msg) < 25 then v_issues := array_append(v_issues, 'reply_too_short'); end if;
    if length(v_note) > 300 then v_issues := array_append(v_issues, 'note_length'); end if;
    if gtm_words(v_fu) > 80 then v_issues := array_append(v_issues, 'follow_up_length'); end if;
    v_approval := case when cardinality(v_issues) > 0 then 'needs_redraft' else 'pending' end;

    v_meta := jsonb_strip_nulls(jsonb_build_object(
      'agent', v_agent, 'run_id', v_run,
      'signal', left(p->>'signal', 500), 'signal_date', v_sig_date, 'signal_url', nullif(trim(p->>'signal_url'), ''),
      'sources', case when jsonb_typeof(p->'sources') = 'array' then p->'sources' end,
      'source_urls', case when jsonb_typeof(p->'source_urls') = 'array' then p->'source_urls' end,
      'what_they_sell', left(p->>'what_they_sell', 300),
      'score_in', v_score_in,
      'score_parts', jsonb_build_object('need', v_need, 'icp', v_icp, 'reach', v_reach, 'timing', v_timing, 'practical', v_prac),
      'best_channel', nullif(v_best, ''), 'email_status_raw', c->>'email_status',
      'ingested_at', now()));

    if v_track <> 'gig_post' then
      v_acc := 'acc_' || regexp_replace(v_dom, '[^a-z0-9]', '_', 'g');
      insert into accounts (account_id, run_date, source, company_name, domain, website, industry, company_type,
        employee_count, location_raw, country, final_score, priority, why_match, score_breakdown, confidence, status,
        linkedin_url, enrichment_status, contact_status, clay_trigger, clay_trigger_source, clay_trigger_date,
        lead_track, source_meta)
      values (v_acc, now(), v_agent, v_company, v_dom,
        coalesce(case when p->>'website' ~* '^https?://' then trim(p->>'website') end, 'https://' || v_dom),
        left(nullif(trim(p->>'industry'), ''), 120),
        case when v_track = 'agency_partner' then 'agency' else 'startup' end,
        v_emp, left(nullif(trim(p->>'country'), ''), 120), left(nullif(trim(p->>'country'), ''), 120),
        v_score, (v_score >= 80)::text, left(nullif(trim(p->>'why_chosen'), ''), 1000), v_bd, 60, 'contact_found',
        case when gtm_norm_li(p->>'company_linkedin') like 'linkedin.com/company/%' then 'https://www.' || gtm_norm_li(p->>'company_linkedin') end,
        'agent', 'contacts_done', left(nullif(trim(p->>'signal'), ''), 500), 'claude agent', v_sig_date,
        v_track, v_meta::text)
      on conflict (account_id) do nothing;
      get diagnostics n = row_count;
      if n = 0 then v_result := 'duplicate:account_id'; exit main; end if;

      v_slug := gtm_slug(v_name);
      v_ct   := 'ct_' || substr(v_acc, 5) || '_' || coalesce(v_slug, left(md5(v_name), 8));
      insert into contacts (contact_id, run_date, account_id, company_name, domain, full_name, title, role_category,
        email, email_status, linkedin_url, source, confidence, preferred_channel, status, contact_key, account_domain)
      values (v_ct, now(), v_acc, v_company, v_dom, v_name, v_title, gtm_role_category(v_title),
        v_email, v_estat, case when v_li like 'linkedin.com/in/%' then 'https://www.' || v_li end, v_agent,
        case v_estat when 'verified' then 90 when 'unverified' then 70 when 'pattern_guess' then 40 else 60 end,
        case when v_channel = 'email' then 'email' else 'linkedin_manual' end, 'used_in_outreach',
        case when v_li like 'linkedin.com/in/%' then 'li:https://www.' || v_li
             when v_email is not null then 'em:' || v_email end,
        v_dom)
      on conflict (contact_id) do nothing;
      v_out := 'or_agent_' || substr(v_ct, 4) || '_' || v_day;
    else
      perform gtm_gig_upsert(jsonb_build_object(
        'post_key', v_key, 'platform', v_plat, 'url', v_url,
        'title', left(coalesce(nullif(trim(pst->>'title'), ''), v_company, 'Untitled post'), 300),
        'body_text', nullif(trim(pst->>'body'), ''),
        'poster', left(coalesce(nullif(trim(pst->>'poster'), ''), v_name), 120),
        'poster_company', v_company, 'posted_at', v_posted, 'contact_email', v_email,
        'contact_hint', case when v_email is not null then 'email' else 'reply' end,
        'stated_budget', left(nullif(trim(pst->>'stated_budget'), ''), 120),
        'remote_hint', left(nullif(trim(pst->>'remote_hint'), ''), 120),
        'matched_stack', left(nullif(trim(pst->>'matched_stack'), ''), 200),
        'intent', 'hiring', 'gig_score', v_score, 'score_breakdown', v_bd, 'status', 'new'));
      v_acc := 'gig:' || v_key;
      v_out := 'or_agent_gig_' || regexp_replace(v_key, '[^a-z0-9]', '_', 'g') || '_' || v_day;
    end if;

    -- First line for the queue list: first sentence after a greeting line
    v_first := trim(regexp_replace(v_msg, '^\s*(hi|hey|hello|dear)\y[^\n]*\n+', '', 'i'));
    v_first := split_part(v_first, E'\n', 1);
    v_first := regexp_replace(v_first, '^(hi|hey|hello|dear)\s+[^,\n]{1,40},\s*', '', 'i');   -- inline greeting
    v_first := upper(left(v_first, 1)) || substr(v_first, 2);
    v_pos   := position('. ' in v_first);
    if v_pos > 0 then v_first := left(v_first, v_pos); end if;
    v_first := left(v_first, 220);

    v_notes := left(concat_ws(E'\n\n',
      case when v_channel <> 'email' and v_body is not null and v_body is distinct from v_msg
           then 'Alt email' || coalesce(' (' || v_subject || ')', '') || E':\n' || v_body end,
      case when v_inm_b is not null and v_inm_b is distinct from v_msg
           then 'LinkedIn InMail, needs Premium or Sales Navigator' || coalesce(' (' || v_inm_s || ')', '') || E':\n' || v_inm_b end,
      case when v_estat = 'pattern_guess' then 'Email ' || v_email || ' is a pattern guess, not verified.' end,
      'Found by the Claude lead digest' || coalesce(' (' || v_run || ')', '') || '.'
        || coalesce(' Signal: ' || nullif(trim(p->>'signal_url'), ''), '')), 4000);

    v_risk := format('provider=%s; run=%s; email_status=%s; score=%s; score_in=%s; validator=%s',
                v_agent, coalesce(v_run, 'none'), v_estat, v_score, coalesce(v_score_in::text, 'none'),
                coalesce(nullif(array_to_string(v_issues, '+'), ''), 'ok'));

    perform 1 from gtm_insert_draft(jsonb_build_object(
      'outreach_id', v_out, 'run_date', now(), 'account_id', v_acc, 'contact_id', v_ct,
      'company_name', v_company, 'contact_name', coalesce(v_name, nullif(trim(pst->>'poster'), '')),
      'channel', v_channel, 'angle', 'agent_signal', 'trigger', left(nullif(trim(p->>'signal'), ''), 500),
      'value_proposition', left(nullif(trim(d->>'first_project'), ''), 500),
      'proof_point', left(nullif(trim(d->>'proof_point'), ''), 500),
      'email_subject', v_subj_out, 'first_line', v_first, 'message_draft', left(v_msg, 4000),
      'follow_up_1', v_fu, 'linkedin_note', v_note, 'risk_notes', v_risk,
      'approval_status', v_approval, 'send_status', 'not_sent', 'notes', v_notes,
      'llm_provider', v_agent, 'llm_calls', 0, 'llm_failures', 0,
      'angle_basis', left(nullif(trim(p->>'signal_url'), ''), 500), 'lead_track', v_track));

    v_result := 'inserted';
  exception when others then
    v_result := 'error:' || left(sqlerrm, 300);
  end;

  if v_result <> 'inserted' then
    v_acc := null; v_ct := null; v_out := null; v_approval := null;
  end if;

  insert into agent_ingest_log (run_id, agent, lead_type, domain, post_key, result, account_id, contact_id,
    outreach_id, approval_status, issues, score, payload)
  values (v_run, v_agent, v_type, v_dom, v_key, v_result, v_acc, v_ct, v_out, v_approval,
    case when v_result = 'inserted' then v_issues end, v_score, p);

  return jsonb_strip_nulls(jsonb_build_object(
    'result', v_result, 'company', v_company, 'domain', v_dom, 'post_key', v_key, 'score', v_score,
    'account_id', v_acc, 'contact_id', v_ct, 'outreach_id', v_out,
    'approval_status', v_approval,
    'issues', case when v_result = 'inserted' and cardinality(v_issues) > 0 then to_jsonb(v_issues) end));
end $$;

-- 6. Read models -----------------------------------------------------------
create or replace view v_agent_ingest_runs as
select coalesce(run_id, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD')) as run_id,
       agent,
       min(created_at) as started_at,
       max(created_at) as finished_at,
       count(*)::int as calls,
       count(*) filter (where result = 'inserted')::int as inserted,
       count(*) filter (where result = 'inserted' and approval_status = 'needs_redraft')::int as needs_redraft,
       count(*) filter (where result like 'duplicate:%')::int as duplicates,
       count(*) filter (where result like 'rejected:%')::int as rejected,
       count(*) filter (where result like 'error:%')::int as errors
from agent_ingest_log
group by 1, 2;

create or replace view v_agent_domains as
select account_id, domain, run_date, lead_track, status
from accounts
where gtm_agent_owned(source);

-- 7. Sync: agent-owned rows stay in Neon -----------------------------------
-- Live definition of 2026-11-18 with one extra condition on the contacts and accounts branches.
create or replace function gtm_sync_push_rows()
returns table(tab text, key text, version text, data jsonb)
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
  where c.dashboard_dirty_at is not null and not gtm_agent_owned(c.source)          -- S17
  union all
  select 'accounts', a.account_id, gtm_iso_us(a.dashboard_dirty_at),
         jsonb_build_object('account_id', a.account_id, 'status', coalesce(a.status, ''))
  from accounts a
  where a.dashboard_dirty_at is not null and not gtm_agent_owned(a.source)          -- S17
$$;

create or replace view v_sync_health as
select id, run_at, config_state, warnings,
       (extract(epoch from (now() - run_at)))::integer as age_seconds,
       ((((select count(*) from outreach_queue
            where outreach_queue.dashboard_dirty_at is not null and gtm_setting('outreach_sor') = 'sheets')
         + (select count(*) from contacts
            where contacts.dashboard_dirty_at is not null and not gtm_agent_owned(contacts.source)))      -- S17
         + (select count(*) from accounts
            where accounts.dashboard_dirty_at is not null and not gtm_agent_owned(accounts.source)))     -- S17
         + (select count(*) from config_versions where config_versions.pushed_to_sheet_at is null))::integer as pending_push
from sync_ops s
order by id desc
limit 1;


-- =====================================================================
-- Sprint 18: pipeline lane
-- Copied from db/s18_pipeline_lane.sql without its begin/commit lines, so this
-- file stays safe to re-run. db/s18_pipeline_lane.sql stays as the migration.
-- =====================================================================
-- =====================================================================
-- Personal GTM Engine: Sprint 18 pipeline-build lane and review fixes (ADR-137 to ADR-142)
-- Additive, one transaction, safe to re-run. Needs s17_agent_ingest.sql first.
-- Run on branch s18-test first, then production.
-- What it adds:
--   gtm_safe_date(), gtm_overlap_category():   helpers (ADR-106 overlap rules ported from the engine)
--   v_agent_job_openings:                      full-time roles the agent routed to you instead of pitching
-- What it changes:
--   gtm_ingest_agent_lead():   new lead types pipeline_build and job_opening; overlap gate; pipeline gates
--                              (buyer pool, budget signal, sales team, sample list); post-attribution and
--                              fresh-funding validators; DB-rendered sample block and signature
--   v_agent_ingest_runs:       adds a routed column at the end
-- No change to the engine, the Sheet sync, HubSpot or lead_track values (pipeline_build is smb_direct).
-- =====================================================================

-- 1. Helpers ------------------------------------------------------------
create or replace function gtm_safe_date(t text) returns date
language plpgsql immutable as $$
begin
  if t is null or t !~ '^\d{4}-\d{2}-\d{2}' then return null; end if;
  return left(t, 10)::date;
exception when others then
  return null;
end $$;

-- Engine Sprint 14 CATS rules (Draft Outreach), ported to Postgres regex. The enrichment rule also
-- catches lead-list and email-finder tools (the Evaboot case of 2026-11-18).
create or replace function gtm_overlap_category(t text) returns text
language sql immutable as $$
  select case
    when x ~ '\ycrm\y|customer relationship management' then 'crm'
    when x ~ 'outbound (sales )?(platform|software|tool|engine|outreach|service)|cold email|\yai sdr|sales sequences?|multichannel sequences?|prospecting (tool|platform|software)' then 'outbound'
    when x ~ 'enrichment|contact data|b2b data|data provider|intent (data|signals?)|verified data|email (finder|verif)|lead (lists?|data|cleaning)|sales navigator' then 'enrichment'
    when x ~ 'deliverability|email warm-?up|inbox placement' then 'deliverability'
    when x ~ 'sales engagement|sales enablement|revenue intelligence|conversation intelligence|sales coach|sales copilot|ai sales (agent|assistant)|coaches reps|demo automation' then 'sales_tech'
    when x ~ 'workflow automation|no-code automation|document (automation|processing)|\yrpa\y|integration platform|ai agents? for (sales|gtm|revenue)' then 'automation'
  end
  from (select lower(coalesce(t, '')) as x) s
$$;

-- 2. The write path, v2 ----------------------------------------------------
-- New payload keys (all optional unless the lead type needs them):
--   site_tagline       homepage title or meta description, verbatim, max 200 chars (feeds the overlap gate)
--   sells_to           the startup's buyer in one line (pipeline_build)
--   signal_author      {"name","role"}: who wrote the post or announcement
--   funding            {"stage","amount_musd","date","lead_investor","url"}
--   revenue_signal     one line with a source (pipeline_build budget gate, when there is no recent round)
--   gtm_people         people in sales, growth or RevOps roles found at the startup
--   buyer_pool         contacts matching the startup's buyer in Clay search (free)
--   news_checked       true after the 30-day news search on this company
--   sample             3 to 5 x {"company","domain","trigger","trigger_date","trigger_url","buyer_title"}
--   job                {"title","url","location","remote","salary","posted_at","why_fit"} (job_opening)
create or replace function gtm_ingest_agent_lead(p jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_agent    constant text := 'claude_digest';
  v_sign     constant text := E'Mohamed Landolsi\nGTM Automation Engineer\nmohamedlandolsi.tech';
  v_day      text := to_char(now() at time zone 'UTC', 'YYYYMMDD');
  v_run      text;
  v_type     text;
  v_track    text;
  v_lane     text;
  v_dom      text;
  v_company  text;
  v_acc      text;
  v_ct       text;
  v_out      text;
  v_key      text;
  v_plat     text;
  v_url      text;
  c          jsonb;
  d          jsonb;
  sp         jsonb;
  pst        jsonb;
  fnd        jsonb;
  job        jsonb;
  r          jsonb;
  v_need     int; v_icp int; v_reach int; v_timing int; v_prac int;
  v_score_in int;
  v_score    int;
  v_bd       text;
  v_emp      int;
  v_pool     int;
  v_gtm      int;
  v_overlap  text;
  v_fund_date date;
  v_investor text;
  v_author   text;
  v_name     text; v_title text; v_li text; v_email text; v_estat text; v_slug text;
  v_best     text; v_channel text;
  v_subject  text; v_body text; v_fu text; v_note text; v_inm_s text; v_inm_b text; v_reply text;
  v_msg      text; v_subj_out text; v_first text; v_notes text; v_risk text; v_all text;
  v_issues   text[] := '{}';
  v_warn     text[] := '{}';
  v_sig_date text;
  v_posted   text;
  v_meta     jsonb;
  v_sample   jsonb := '[]'::jsonb;
  v_lines    text[];
  v_dropped  int := 0;
  s_dom      text;
  s_date     date;
  v_approval text;
  v_result   text;
  v_pos      int;
  n          int;
begin
  <<main>>
  begin
    if p is null or jsonb_typeof(p) <> 'object' then v_result := 'rejected:payload_not_object'; exit main; end if;

    v_run     := left(nullif(trim(coalesce(p->>'run_id', '')), ''), 80);
    v_type    := lower(trim(coalesce(p->>'lead_type', '')));
    v_track   := case v_type when 'outbound_account'   then 'smb_direct'
                             when 'pipeline_build'     then 'smb_direct'      -- S18: same track, own angle
                             when 'agency_partner'     then 'agency_partner'
                             when 'seeking_freelancer' then 'gig_post' end;
    v_lane    := case v_type when 'outbound_account' then 'hiring_signal' else v_type end;
    v_dom     := gtm_norm_domain(p->>'domain');
    v_company := left(coalesce(nullif(trim(p->>'company_name'), ''), v_dom), 200);

    -- S18: a full-time role he can apply to is logged for him, never pitched (ADR-141)
    if v_type = 'job_opening' then
      job   := case when jsonb_typeof(p->'job') = 'object' then p->'job' else '{}'::jsonb end;
      v_url := nullif(trim(coalesce(job->>'url', '')), '');
      if v_url is null or v_url !~* '^https?://[^ ]+$' then v_result := 'rejected:no_job_url'; exit main; end if;
      if nullif(trim(coalesce(job->>'title', '')), '') is null or v_company is null then
        v_result := 'rejected:job_incomplete'; exit main; end if;
      if exists (select 1 from agent_ingest_log l
                 where l.result = 'routed:job_opening' and lower(l.payload->'job'->>'url') = lower(v_url)) then
        v_result := 'duplicate:job_opening'; exit main; end if;
      v_result := 'routed:job_opening'; exit main;
    end if;
    if v_track is null then v_result := 'rejected:invalid_lead_type'; exit main; end if;

    c   := case when jsonb_typeof(p->'contact')     = 'object' then p->'contact'     else '{}'::jsonb end;
    d   := case when jsonb_typeof(p->'drafts')      = 'object' then p->'drafts'      else '{}'::jsonb end;
    sp  := case when jsonb_typeof(p->'score_parts') = 'object' then p->'score_parts' else '{}'::jsonb end;
    pst := case when jsonb_typeof(p->'post')        = 'object' then p->'post'        else '{}'::jsonb end;
    fnd := case when jsonb_typeof(p->'funding')     = 'object' then p->'funding'     else '{}'::jsonb end;

    v_emp       := gtm_clamp_int(p->>'employee_count', 0, 10000000);
    v_sig_date  := case when (p->>'signal_date') ~ '^\d{4}-\d{2}-\d{2}$' then p->>'signal_date' end;
    v_fund_date := gtm_safe_date(fnd->>'date');
    v_investor  := nullif(trim(coalesce(fnd->>'lead_investor', '')), '');
    v_author    := nullif(trim(coalesce(p->'signal_author'->>'name', '')), '');
    v_gtm       := gtm_clamp_int(p->>'gtm_people', 0, 100000);
    v_pool      := gtm_clamp_int(p->>'buyer_pool', 0, 100000000);

    -- Gate 1: score. Recomputed from the five parts when all are present: never trust LLM arithmetic.
    v_score_in := gtm_clamp_int(p->>'score', 0, 100);
    v_need     := gtm_clamp_int(sp->>'need', 0, 35);
    v_icp      := gtm_clamp_int(sp->>'icp', 0, 25);
    v_reach    := gtm_clamp_int(sp->>'reach', 0, 15);
    v_timing   := gtm_clamp_int(sp->>'timing', 0, 10);
    v_prac     := gtm_clamp_int(sp->>'practical', 0, 15);
    if v_need is not null and v_icp is not null and v_reach is not null and v_timing is not null and v_prac is not null then
      v_score := v_need + v_icp + v_reach + v_timing + v_prac;
      v_bd := format('need=%s; icp=%s; feasibility=%s; timing=%s; practical=%s',
                round(v_need * 100.0 / 35), round(v_icp * 100.0 / 25), round(v_reach * 100.0 / 15),
                round(v_timing * 100.0 / 10), round(v_prac * 100.0 / 15));
    else
      v_score := v_score_in;
    end if;
    if v_score is null then v_result := 'rejected:no_score'; exit main; end if;
    if v_score < 55 then v_result := 'rejected:score_below_55'; exit main; end if;
    if v_emp > 200 then v_result := 'rejected:over_200_people'; exit main; end if;

    -- Gate 2 (S18, ADR-139): product overlap. Agencies (ADR-117) and gig posts are exempt.
    if v_type in ('outbound_account', 'pipeline_build') then
      v_overlap := gtm_overlap_category(concat_ws(' ', v_company, p->>'site_tagline', p->>'what_they_sell', p->>'industry'));
      if v_overlap is not null then v_result := 'rejected:product_overlap_' || v_overlap; exit main; end if;
    end if;

    -- Contact and drafts
    v_name  := left(nullif(trim(coalesce(c->>'full_name', '')), ''), 120);
    v_title := left(nullif(trim(coalesce(c->>'title', '')), ''), 160);
    v_li    := gtm_norm_li(c->>'linkedin_url');
    v_email := lower(trim(coalesce(c->>'email', '')));
    if v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then v_email := null; end if;
    v_estat := case lower(trim(coalesce(c->>'email_status', '')))
                 when 'verified' then 'verified'
                 when 'found_unverified' then 'unverified'
                 when 'unverified' then 'unverified'
                 when 'pattern_guess' then 'pattern_guess'
                 else 'not_found' end;
    if v_email is null then v_estat := 'not_found'; end if;

    v_subject := nullif(trim(coalesce(d->>'email_subject', '')), '');
    v_body    := nullif(trim(coalesce(d->>'email_body', '')), '');
    v_fu      := nullif(trim(coalesce(d->>'follow_up_day4', '')), '');
    v_note    := nullif(trim(coalesce(d->>'linkedin_note', '')), '');
    v_inm_s   := nullif(trim(coalesce(d->>'inmail_subject', '')), '');
    v_inm_b   := nullif(trim(coalesce(d->>'inmail_body', '')), '');
    v_reply   := nullif(trim(coalesce(d->>'reply_to_post', '')), '');
    v_best    := lower(trim(coalesce(p->>'best_channel', '')));
    if v_type = 'pipeline_build' and v_body is not null then
      -- the database adds the sample and the signature, so drop a signature the agent wrote
      v_body := nullif(trim(regexp_replace(v_body, '\n+\s*Mohamed Landolsi.*$', '', 's')), '');
    end if;

    if v_track <> 'gig_post' then
      if v_dom is null or v_dom !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' then v_result := 'rejected:no_domain'; exit main; end if;
      if v_name is null then v_result := 'rejected:no_contact'; exit main; end if;
      if v_best = 'email' and v_estat in ('verified', 'unverified') and v_body is not null then
        v_channel := 'email';           v_msg := v_body;                    v_subj_out := v_subject;
      else
        v_channel := 'linkedin_manual'; v_msg := coalesce(v_inm_b, v_body); v_subj_out := v_inm_s;
      end if;
      if v_msg is null then v_result := 'rejected:no_draft'; exit main; end if;

      -- Gate 3 (S18, ADR-138): pipeline_build needs a findable buyer, a budget signal, no sales team, a sample
      if v_type = 'pipeline_build' then
        if v_pool is null or v_pool < 20 then v_result := 'rejected:buyer_not_findable'; exit main; end if;
        if not (coalesce(v_fund_date >= current_date - 365, false)
                or nullif(trim(coalesce(p->>'revenue_signal', '')), '') is not null) then
          v_result := 'rejected:no_budget_signal'; exit main; end if;
        if v_gtm >= 3 then v_result := 'rejected:has_sales_team'; exit main; end if;
        for r in select el from jsonb_array_elements(
                   case when jsonb_typeof(p->'sample') = 'array' then p->'sample' else '[]'::jsonb end) el loop
          s_dom  := gtm_norm_domain(r->>'domain');
          s_date := gtm_safe_date(r->>'trigger_date');
          if jsonb_typeof(r) <> 'object'
             or nullif(trim(coalesce(r->>'company', '')), '') is null
             or coalesce(s_dom, '') !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' or s_dom = v_dom
             or nullif(trim(coalesce(r->>'trigger', '')), '') is null
             or coalesce(r->>'trigger_url', '') !~* '^https?://[^ ]+$'
             or s_date is null or s_date > current_date or s_date < current_date - 120
             or nullif(trim(coalesce(r->>'buyer_title', '')), '') is null
             or exists (select 1 from jsonb_array_elements(v_sample) x where x->>'domain' = s_dom)
             or jsonb_array_length(v_sample) >= 5 then
            v_dropped := v_dropped + 1;
            continue;
          end if;
          -- company-level facts only: no person names or emails of third parties (ADR-140)
          v_sample := v_sample || jsonb_build_array(jsonb_build_object(
            'company', left(trim(r->>'company'), 120), 'domain', s_dom,
            'trigger', left(trim(r->>'trigger'), 200), 'trigger_date', s_date,
            'trigger_url', left(trim(r->>'trigger_url'), 500), 'buyer_title', left(trim(r->>'buyer_title'), 80)));
        end loop;
        if jsonb_array_length(v_sample) < 3 then v_result := 'rejected:sample_too_small'; exit main; end if;
      end if;

      -- Gate 4: dedupe against everything the engine and the console already hold
      if exists (select 1 from accounts a where gtm_norm_domain(a.domain) = v_dom) then
        v_result := 'duplicate:accounts'; exit main; end if;
      if exists (select 1 from contacts x where gtm_norm_domain(coalesce(x.account_domain, x.domain)) = v_dom) then
        v_result := 'duplicate:contacts_domain'; exit main; end if;
      if v_li is not null and exists (select 1 from contacts x
           where gtm_norm_li(x.linkedin_url) = v_li
              or (x.contact_key like 'li:%' and gtm_norm_li(substr(x.contact_key, 4)) = v_li)) then
        v_result := 'duplicate:contact_linkedin'; exit main; end if;
      if v_email is not null and exists (select 1 from contacts x where lower(trim(x.email)) = v_email) then
        v_result := 'duplicate:contact_email'; exit main; end if;
    else
      v_url := nullif(trim(coalesce(pst->>'url', p->>'post_url', '')), '');
      if v_url is null or v_url !~* '^https?://[^ ]+$' then v_result := 'rejected:no_post_url'; exit main; end if;
      v_key  := gtm_gig_key(v_url);
      v_plat := case split_part(v_key, ':', 1) when 'n8n' then 'n8n_forum' when 'make' then 'make_forum'
                                              when 'hn' then 'hn_freelancer' else 'agent_web' end;
      if v_best = 'email' and v_email is not null and v_body is not null then
        v_channel := 'email';       v_msg := v_body;                     v_subj_out := v_subject;
      else
        v_channel := 'forum_reply'; v_msg := coalesce(v_reply, v_body);  v_subj_out := null;
      end if;
      if v_msg is null then v_result := 'rejected:no_draft'; exit main; end if;
      if exists (select 1 from gig_posts g where g.post_key = v_key) then
        v_result := 'duplicate:gig_posts'; exit main; end if;
      v_posted := case when (pst->>'posted_at') ~ '^\d{4}-\d{2}-\d{2}' then pst->>'posted_at' end;
      v_author := coalesce(v_author, nullif(trim(pst->>'poster'), ''), v_name);   -- the poster wrote the post
    end if;

    -- Validator: problems park the draft in Re-draft instead of dropping the lead
    v_all := concat_ws(E'\n', v_subj_out, v_msg, v_fu, v_note, v_inm_s, v_inm_b, v_reply, v_body);
    if strpos(v_all, chr(8212)) > 0 or strpos(v_all, chr(8211)) > 0 then v_issues := array_append(v_issues, 'dash'); end if;
    if v_all ~* '\{\{|\[(first ?name|name|company|your name)\]|lorem ipsum|\yTODO\y' then
      v_issues := array_append(v_issues, 'placeholder'); end if;
    if v_channel = 'email' then
      if v_subj_out is null then v_issues := array_append(v_issues, 'no_subject'); end if;
      if gtm_words(v_msg) not between 40 and (case when v_type = 'pipeline_build' then 130 else 150 end) then
        v_issues := array_append(v_issues, 'email_length'); end if;
    end if;
    if v_channel = 'forum_reply' and gtm_words(v_msg) < 25 then v_issues := array_append(v_issues, 'reply_too_short'); end if;
    if length(v_note) > 300 then v_issues := array_append(v_issues, 'note_length'); end if;
    if gtm_words(v_fu) > 80 then v_issues := array_append(v_issues, 'follow_up_length'); end if;
    -- S18 (ADR-142): "your post" only when the contact wrote it
    if v_all ~* '\y(your|you)\s+((recent|hn|job|linkedin|community|launch|show hn)\s+)*(post|posted|comment|thread)\y'
       and (v_author is null or gtm_slug(v_author) is distinct from gtm_slug(v_name)) then
      v_issues := array_append(v_issues, 'post_attribution'); end if;
    -- S18 (ADR-142): a round announced in the last 30 days must be used
    if v_fund_date >= current_date - 30
       and not (v_all ~* '\y(pre-seed|seed|series [a-d]|round|raised?|raising|funding)\y'
                or (v_investor is not null and strpos(lower(v_all), lower(v_investor)) > 0)) then
      v_issues := array_append(v_issues, 'fresh_funding_unused'); end if;
    if coalesce(p->>'news_checked', '') <> 'true' then v_warn := array_append(v_warn, 'news_not_checked'); end if;
    v_approval := case when cardinality(v_issues) > 0 then 'needs_redraft' else 'pending' end;

    -- First line for the queue list: first sentence after a greeting line (before the sample is added)
    v_first := trim(regexp_replace(v_msg, '^\s*(hi|hey|hello|dear)\y[^\n]*\n+', '', 'i'));
    v_first := split_part(v_first, E'\n', 1);
    v_first := regexp_replace(v_first, '^(hi|hey|hello|dear)\s+[^,\n]{1,40},\s*', '', 'i');
    v_first := upper(left(v_first, 1)) || substr(v_first, 2);
    v_pos   := position('. ' in v_first);
    if v_pos > 0 then v_first := left(v_first, v_pos); end if;
    v_first := left(v_first, 220);

    -- S18: the database renders the sample (5 rows by email, 3 on LinkedIn) and the email signature
    if v_type = 'pipeline_build' then
      select array_agg(format('%s. %s (%s): %s, %s. Buyer: %s', t.i, t.x->>'company', t.x->>'domain',
                              t.x->>'trigger', to_char((t.x->>'trigger_date')::date, 'Mon FMDD'),
                              t.x->>'buyer_title') order by t.i)
        into v_lines
        from jsonb_array_elements(v_sample) with ordinality as t(x, i)
       where v_channel = 'email' or t.i <= 3;
      v_msg := v_msg || E'\n\nA few accounts that match your buyer right now:\n' || array_to_string(v_lines, E'\n');
      if v_channel = 'email' then v_msg := v_msg || E'\n\n' || v_sign; end if;
    end if;

    v_meta := jsonb_strip_nulls(jsonb_build_object(
      'agent', v_agent, 'run_id', v_run, 'lane', v_lane,
      'signal', left(p->>'signal', 500), 'signal_date', v_sig_date, 'signal_url', nullif(trim(p->>'signal_url'), ''),
      'signal_author', case when jsonb_typeof(p->'signal_author') = 'object' then p->'signal_author' end,
      'sources', case when jsonb_typeof(p->'sources') = 'array' then p->'sources' end,
      'source_urls', case when jsonb_typeof(p->'source_urls') = 'array' then p->'source_urls' end,
      'what_they_sell', left(p->>'what_they_sell', 300), 'site_tagline', left(p->>'site_tagline', 200),
      'sells_to', left(p->>'sells_to', 200),
      'funding', case when fnd <> '{}'::jsonb then fnd end,
      'revenue_signal', left(p->>'revenue_signal', 300),
      'gtm_people', v_gtm, 'buyer_pool', v_pool,
      'sample', case when jsonb_array_length(v_sample) > 0 then v_sample end,
      'sample_dropped', case when v_dropped > 0 then v_dropped end,
      'score_in', v_score_in,
      'score_parts', jsonb_build_object('need', v_need, 'icp', v_icp, 'reach', v_reach, 'timing', v_timing, 'practical', v_prac),
      'best_channel', nullif(v_best, ''), 'email_status_raw', c->>'email_status',
      'ingested_at', now()));

    if v_track <> 'gig_post' then
      v_acc := 'acc_' || regexp_replace(v_dom, '[^a-z0-9]', '_', 'g');
      insert into accounts (account_id, run_date, source, company_name, domain, website, industry, company_type,
        employee_count, location_raw, country, final_score, priority, why_match, score_breakdown, confidence, status,
        linkedin_url, enrichment_status, contact_status, clay_trigger, clay_trigger_source, clay_trigger_date,
        lead_track, source_meta)
      values (v_acc, now(), v_agent, v_company, v_dom,
        coalesce(case when p->>'website' ~* '^https?://' then trim(p->>'website') end, 'https://' || v_dom),
        left(nullif(trim(p->>'industry'), ''), 120),
        case when v_track = 'agency_partner' then 'agency' else 'startup' end,
        v_emp, left(nullif(trim(p->>'country'), ''), 120), left(nullif(trim(p->>'country'), ''), 120),
        v_score, (v_score >= 80)::text, left(nullif(trim(p->>'why_chosen'), ''), 1000), v_bd, 60, 'contact_found',
        case when gtm_norm_li(p->>'company_linkedin') like 'linkedin.com/company/%' then 'https://www.' || gtm_norm_li(p->>'company_linkedin') end,
        'agent', 'contacts_done', left(nullif(trim(p->>'signal'), ''), 500), 'claude agent', v_sig_date,
        v_track, v_meta::text)
      on conflict (account_id) do nothing;
      get diagnostics n = row_count;
      if n = 0 then v_result := 'duplicate:account_id'; exit main; end if;

      v_slug := gtm_slug(v_name);
      v_ct   := 'ct_' || substr(v_acc, 5) || '_' || coalesce(v_slug, left(md5(v_name), 8));
      insert into contacts (contact_id, run_date, account_id, company_name, domain, full_name, title, role_category,
        email, email_status, linkedin_url, source, confidence, preferred_channel, status, contact_key, account_domain)
      values (v_ct, now(), v_acc, v_company, v_dom, v_name, v_title, gtm_role_category(v_title),
        v_email, v_estat, case when v_li like 'linkedin.com/in/%' then 'https://www.' || v_li end, v_agent,
        case v_estat when 'verified' then 90 when 'unverified' then 70 when 'pattern_guess' then 40 else 60 end,
        case when v_channel = 'email' then 'email' else 'linkedin_manual' end, 'used_in_outreach',
        case when v_li like 'linkedin.com/in/%' then 'li:https://www.' || v_li
             when v_email is not null then 'em:' || v_email end,
        v_dom)
      on conflict (contact_id) do nothing;
      v_out := 'or_agent_' || substr(v_ct, 4) || '_' || v_day;
    else
      perform gtm_gig_upsert(jsonb_build_object(
        'post_key', v_key, 'platform', v_plat, 'url', v_url,
        'title', left(coalesce(nullif(trim(pst->>'title'), ''), v_company, 'Untitled post'), 300),
        'body_text', nullif(trim(pst->>'body'), ''),
        'poster', left(coalesce(nullif(trim(pst->>'poster'), ''), v_name), 120),
        'poster_company', v_company, 'posted_at', v_posted, 'contact_email', v_email,
        'contact_hint', case when v_email is not null then 'email' else 'reply' end,
        'stated_budget', left(nullif(trim(pst->>'stated_budget'), ''), 120),
        'remote_hint', left(nullif(trim(pst->>'remote_hint'), ''), 120),
        'matched_stack', left(nullif(trim(pst->>'matched_stack'), ''), 200),
        'intent', 'hiring', 'gig_score', v_score, 'score_breakdown', v_bd, 'status', 'new'));
      v_acc := 'gig:' || v_key;
      v_out := 'or_agent_gig_' || regexp_replace(v_key, '[^a-z0-9]', '_', 'g') || '_' || v_day;
    end if;

    v_notes := left(concat_ws(E'\n\n',
      case when v_channel <> 'email' and v_body is not null and v_body is distinct from v_inm_b
           then 'Alt email' || coalesce(' (' || v_subject || ')', '') || E':\n' || v_body end,
      case when v_inm_b is not null and v_channel = 'email'
           then 'LinkedIn InMail, needs Premium or Sales Navigator' || coalesce(' (' || v_inm_s || ')', '') || E':\n' || v_inm_b end,
      case when v_estat = 'pattern_guess' then 'Email ' || v_email || ' is a pattern guess, not verified.' end,
      'Found by the Claude lead digest' || coalesce(' (' || v_run || ')', '') || '.'
        || coalesce(' Signal: ' || nullif(trim(p->>'signal_url'), ''), '')), 4000);

    v_risk := format('provider=%s; run=%s; lane=%s; email_status=%s; score=%s; score_in=%s; validator=%s%s%s',
                v_agent, coalesce(v_run, 'none'), v_lane, v_estat, v_score, coalesce(v_score_in::text, 'none'),
                coalesce(nullif(array_to_string(v_issues, '+'), ''), 'ok'),
                case when v_type = 'pipeline_build'
                     then format('; sample=%s; sample_dropped=%s; buyer_pool=%s', jsonb_array_length(v_sample), v_dropped, v_pool) else '' end,
                case when cardinality(v_warn) > 0 then '; warn=' || array_to_string(v_warn, '+') else '' end);

    perform 1 from gtm_insert_draft(jsonb_build_object(
      'outreach_id', v_out, 'run_date', now(), 'account_id', v_acc, 'contact_id', v_ct,
      'company_name', v_company, 'contact_name', coalesce(v_name, nullif(trim(pst->>'poster'), '')),
      'channel', v_channel,
      'angle', case when v_type = 'pipeline_build' then 'sample_list' else 'agent_signal' end,
      'trigger', left(nullif(trim(p->>'signal'), ''), 500),
      'value_proposition', left(nullif(trim(d->>'first_project'), ''), 500),
      'proof_point', left(nullif(trim(d->>'proof_point'), ''), 500),
      'email_subject', v_subj_out, 'first_line', v_first, 'message_draft', left(v_msg, 4000),
      'follow_up_1', v_fu, 'linkedin_note', v_note, 'risk_notes', v_risk,
      'approval_status', v_approval, 'send_status', 'not_sent', 'notes', v_notes,
      'llm_provider', v_agent, 'llm_calls', 0, 'llm_failures', 0, 'gtm_people', v_gtm,
      'angle_basis', left(nullif(trim(p->>'signal_url'), ''), 500), 'lead_track', v_track));

    v_result := 'inserted';
  exception when others then
    v_result := 'error:' || left(sqlerrm, 300);
  end;

  if v_result <> 'inserted' then
    v_acc := null; v_ct := null; v_out := null; v_approval := null;
  end if;

  insert into agent_ingest_log (run_id, agent, lead_type, domain, post_key, result, account_id, contact_id,
    outreach_id, approval_status, issues, score, payload)
  values (v_run, v_agent, v_type, v_dom, v_key, v_result, v_acc, v_ct, v_out, v_approval,
    case when v_result = 'inserted' then v_issues end, v_score, p);

  return jsonb_strip_nulls(jsonb_build_object(
    'result', v_result, 'company', v_company, 'domain', v_dom, 'post_key', v_key, 'score', v_score,
    'account_id', v_acc, 'contact_id', v_ct, 'outreach_id', v_out,
    'approval_status', v_approval,
    'issues', case when v_result = 'inserted' and cardinality(v_issues) > 0 then to_jsonb(v_issues) end,
    'warnings', case when v_result = 'inserted' and cardinality(v_warn) > 0 then to_jsonb(v_warn) end));
end $$;

-- 3. Read models -------------------------------------------------------------
create or replace view v_agent_ingest_runs as
select coalesce(run_id, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD')) as run_id,
       agent,
       min(created_at) as started_at,
       max(created_at) as finished_at,
       count(*)::int as calls,
       count(*) filter (where result = 'inserted')::int as inserted,
       count(*) filter (where result = 'inserted' and approval_status = 'needs_redraft')::int as needs_redraft,
       count(*) filter (where result like 'duplicate:%')::int as duplicates,
       count(*) filter (where result like 'rejected:%')::int as rejected,
       count(*) filter (where result like 'error:%')::int as errors,
       count(*) filter (where result like 'routed:%')::int as routed                  -- S18
from agent_ingest_log
group by 1, 2;

create or replace view v_agent_job_openings as
select l.id, l.created_at, l.run_id,
       l.payload->>'company_name'      as company,
       l.domain,
       l.payload->'job'->>'title'      as title,
       l.payload->'job'->>'url'        as url,
       l.payload->'job'->>'location'   as location,
       l.payload->'job'->>'remote'     as remote,
       l.payload->'job'->>'salary'     as salary,
       l.payload->'job'->>'posted_at'  as posted_at,
       l.payload->'job'->>'why_fit'    as why_fit
from agent_ingest_log l
where l.result = 'routed:job_opening';

