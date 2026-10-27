-- Sprint 13 patch 1: GDPR legal basis on contacts (HubSpot EU portal requires hs_legal_basis).
-- Replaces v_hubspot_outbox only; same columns, so dependent views are untouched.
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
