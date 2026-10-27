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
