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
begin;

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
         max(coalesce(q.reviewed_at, q.run_date)) filter (where q.reject_scope = 'pitch') as pitch_at   -- S14 patch: gate rows have no reviewed_at
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

commit;
