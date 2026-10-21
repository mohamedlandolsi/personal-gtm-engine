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
