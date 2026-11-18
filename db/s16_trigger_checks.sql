-- =====================================================================
-- Personal GTM Engine: Sprint 16 trigger and account checks (ADR-120, ADR-128, ADR-130, ADR-131)
-- Additive, one transaction, safe to re-run. Run on branch s16-test first, then production.
-- What it adds:
--   trigger_checks, v_trigger_latest, gtm_trigger_upsert():          cached Tavily news triggers
--   account_checks, v_account_check_latest, v_clay_usage,
--   gtm_account_check_upsert():                                      Clay account checks and the 30-day result count
--   outreach_queue: contact_verified_at, contact_verified_title, gtm_people
--   gtm_insert_draft(), v_review_queue, n8n_outreach_queue_sheet:    the 3 columns appended at the end
-- The last three are the live production definitions of 2026-11-17 (pg_get_functiondef / pg_get_viewdef)
-- with only the 3 columns added; build: node scripts/s16/build_sql.mjs.
-- S16 STOP B: Clay headcount is not fetched, so account_checks.employee_count stays null for now.
-- =====================================================================
begin;

-- Sprint 16: trigger checks (ADR-120)
create table if not exists trigger_checks (
  account_id   text        not null,
  checked_at   timestamptz not null default now(),
  source       text        not null default 'tavily',
  trigger_type text,                    -- funding | hiring | launch | none
  trigger_text text,                    -- result title, max 300 chars
  trigger_date date,                    -- published date of the result
  trigger_url  text,
  stage_signal text not null default 'unknown',   -- early | late | unknown
  amount_musd  numeric,                 -- round size in millions, when stated
  query        text,
  primary key (account_id, checked_at)
);
create index if not exists trigger_checks_acc_idx on trigger_checks (account_id, checked_at desc);

create or replace view v_trigger_latest as
  select distinct on (account_id) *
  from trigger_checks
  order by account_id, checked_at desc;

create or replace function gtm_trigger_upsert(p jsonb) returns integer
language sql as $$
  with rows as (
    select x from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else jsonb_build_array(p) end) as t(x)
    where coalesce(x->>'account_id', '') <> ''
  ), ins as (
    insert into trigger_checks (account_id, source, trigger_type, trigger_text, trigger_date, trigger_url,
                                stage_signal, amount_musd, query)
    select x->>'account_id', coalesce(x->>'source', 'tavily'), coalesce(x->>'trigger_type', 'none'),
           left(x->>'trigger_text', 300),
           case when x->>'trigger_date' ~ '^\d{4}-\d{2}-\d{2}$' then (x->>'trigger_date')::date end,
           x->>'trigger_url', coalesce(x->>'stage_signal', 'unknown'),
           case when x->>'amount_musd' ~ '^\d+(\.\d+)?$' then (x->>'amount_musd')::numeric end,
           left(x->>'query', 300)
    from rows
    returning 1
  )
  select count(*)::int from ins
$$;

-- Sprint 16: Clay account checks (ADR-128, ADR-130, ADR-131)
create table if not exists account_checks (
  account_id     text        not null,
  checked_at     timestamptz not null default now(),
  source         text        not null default 'clay_api',  -- clay_api | clay_mcp | manual
  status         text        not null default 'ok',        -- ok | budget | error
  gtm_people     integer,                                  -- current non-founder GTM people (search capped at gtm_limit)
  gtm_titles     text,                                     -- titles only, comma list
  leaders        jsonb,                                    -- [{name, title, linkedin_url, started}] current founders / C-suite
  employee_count integer,                                  -- Clay company headcount (S16 STOP B: not fetched, stays null)
  results_used   integer     not null default 0,           -- Clay search results this check consumed
  note           text,
  primary key (account_id, checked_at)
);
create index if not exists account_checks_acc_idx on account_checks (account_id, checked_at desc);

create or replace view v_account_check_latest as
  select distinct on (account_id) * from account_checks
  where status = 'ok'
  order by account_id, checked_at desc;

create or replace view v_clay_usage as
  select coalesce(sum(results_used), 0)::int as results_30d
  from account_checks
  where source in ('clay_api', 'clay_mcp') and checked_at > now() - interval '30 days';

create or replace function gtm_account_check_upsert(p jsonb) returns integer
language sql as $$
  with rows as (
    select x from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else jsonb_build_array(p) end) as t(x)
    where coalesce(x->>'account_id', '') <> ''
  ), ins as (
    insert into account_checks (account_id, source, status, gtm_people, gtm_titles, leaders, employee_count, results_used, note)
    select x->>'account_id', coalesce(x->>'source', 'clay_api'), coalesce(x->>'status', 'ok'),
           case when x->>'gtm_people' ~ '^\d+$' then (x->>'gtm_people')::int end,
           left(x->>'gtm_titles', 500),
           case when jsonb_typeof(x->'leaders') = 'array' then x->'leaders' else '[]'::jsonb end,
           case when x->>'employee_count' ~ '^\d+$' then (x->>'employee_count')::int end,
           case when x->>'results_used' ~ '^\d+$' then (x->>'results_used')::int else 0 end,
           left(x->>'note', 500)
    from rows
    returning 1
  )
  select count(*)::int from ins
$$;

-- What the draft was checked against (shown in the console)
alter table outreach_queue add column if not exists contact_verified_at    timestamptz;
alter table outreach_queue add column if not exists contact_verified_title text;
alter table outreach_queue add column if not exists gtm_people             integer;

-- gtm_insert_draft(): live definition, 3 columns appended (S16)
CREATE OR REPLACE FUNCTION public.gtm_insert_draft(p jsonb)
 RETURNS SETOF outreach_queue
 LANGUAGE sql
AS $function$
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
      lead_track,                                                                   -- S15
      contact_verified_at, contact_verified_title, gtm_people)                      -- S16
    select x.outreach_id, x.run_date, x.account_id, x.contact_id, x.company_name, x.contact_name, x.channel,
      x.angle, x.trigger, x.pain_point, x.value_proposition, x.proof_point, x.cta, x.email_subject, x.first_line,
      x.message_draft, x.follow_up_1, x.follow_up_2, x.follow_up_3, x.linkedin_note, x.risk_notes,
      coalesce(x.approval_status, 'pending'), coalesce(x.send_status, 'not_sent'), x.sent_at,
      x.reply_received, x.notes, x.llm_provider, x.llm_calls, x.llm_failures,
      x.reject_scope, x.angle_basis, x.account_type, x.product_category,
      coalesce(x.lead_track, 'smb_direct'),                                         -- S15: missing key or "" = smb_direct
      x.contact_verified_at, x.contact_verified_title, x.gtm_people                 -- S16: "" = null (clean step)
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
$function$;

-- v_review_queue: live definition, 3 columns appended at the end (S16)
create or replace view v_review_queue as
SELECT q.outreach_id,
    q.run_date,
    q.account_id,
    q.contact_id,
    q.company_name,
    q.contact_name,
    q.channel,
    q.angle,
    q.trigger,
    q.pain_point,
    q.value_proposition,
    q.proof_point,
    q.cta,
    q.email_subject,
    q.first_line,
    q.message_draft,
    q.follow_up_1,
    q.follow_up_2,
    q.follow_up_3,
    q.linkedin_note,
    q.risk_notes,
    q.approval_status,
    q.send_status,
    q.sent_at,
    q.reply_received,
    q.notes,
    q.llm_provider,
    q.llm_calls,
    q.llm_failures,
    q.reviewed_at,
    q.dashboard_dirty_at,
    q.synced_at,
    a.final_score,
    a.priority,
    a.why_match,
    a.red_flags,
    a.score_breakdown,
    a.clay_summary,
    a.tech_stack,
    a.country,
    a.website,
    a.domain,
    a.employee_count,
    a.industry,
    a.status AS account_status,
    c.title AS contact_title,
    c.email AS contact_email,
    c.email_status,
    c.linkedin_url AS contact_linkedin,
    c.contact_score,
    c.role_category,
    a.clay_trigger,
    a.clay_trigger_source,
    a.clay_trigger_date,
    q.reject_scope,
    q.angle_basis,
    q.account_type,
    q.product_category,
    q.lead_track,
    a.source_meta,
    g.platform AS gig_platform,
    g.url AS gig_url,
    g.posted_at AS gig_posted_at,
    g.reply_count AS gig_reply_count,
    g.matched_stack AS gig_matched_stack,
    g.stated_budget AS gig_stated_budget,
    g.status AS gig_status,
    g.gig_score,
    q.contact_verified_at,
    q.contact_verified_title,
    q.gtm_people
   FROM outreach_queue q
     LEFT JOIN accounts a ON a.account_id = q.account_id
     LEFT JOIN contacts c ON c.contact_id = q.contact_id
     LEFT JOIN gig_posts g ON q.lead_track = 'gig_post'::text AND q.account_id ~~ 'gig:%'::text AND g.post_key = substr(q.account_id, 5);

-- n8n_outreach_queue_sheet: live definition, 3 columns appended at the end (S16)
create or replace view n8n_outreach_queue_sheet as
SELECT COALESCE(gtm_iso(run_date), ''::text) AS run_date,
    outreach_id,
    COALESCE(account_id, ''::text) AS account_id,
    COALESCE(contact_id, ''::text) AS contact_id,
    COALESCE(company_name, ''::text) AS company_name,
    COALESCE(contact_name, ''::text) AS contact_name,
    COALESCE(channel, ''::text) AS channel,
    COALESCE(angle, ''::text) AS angle,
    COALESCE(trigger, ''::text) AS trigger,
    COALESCE(pain_point, ''::text) AS pain_point,
    COALESCE(value_proposition, ''::text) AS value_proposition,
    COALESCE(proof_point, ''::text) AS proof_point,
    COALESCE(cta, ''::text) AS cta,
    COALESCE(email_subject, ''::text) AS email_subject,
    COALESCE(first_line, ''::text) AS first_line,
    COALESCE(message_draft, ''::text) AS message_draft,
    COALESCE(follow_up_1, ''::text) AS follow_up_1,
    COALESCE(follow_up_2, ''::text) AS follow_up_2,
    COALESCE(follow_up_3, ''::text) AS follow_up_3,
    COALESCE(linkedin_note, ''::text) AS linkedin_note,
    COALESCE(risk_notes, ''::text) AS risk_notes,
    approval_status,
    send_status,
    COALESCE(gtm_iso(sent_at), ''::text) AS sent_at,
    COALESCE(reply_received, ''::text) AS reply_received,
    COALESCE(notes, ''::text) AS notes,
    COALESCE(llm_provider, ''::text) AS llm_provider,
    COALESCE(llm_calls, 0) AS llm_calls,
    COALESCE(llm_failures, 0) AS llm_failures,
    COALESCE(reject_scope, ''::text) AS reject_scope,
    COALESCE(gtm_iso(reviewed_at), ''::text) AS reviewed_at,
    lead_track,
    COALESCE(gtm_iso(contact_verified_at), ''::text) AS contact_verified_at,
    COALESCE(contact_verified_title, ''::text) AS contact_verified_title,
    gtm_people
   FROM outreach_queue
  ORDER BY (COALESCE(gtm_iso(run_date), ''::text)) NULLS FIRST, outreach_id;

commit;
