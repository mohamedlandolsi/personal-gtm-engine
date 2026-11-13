-- Sprint 14 patch: gate rows with scope 'pitch' block their account.
-- Gate rows are written by the engine with no reviewed_at, so pitch_at was NULL and the account was not blocked
-- (Fini got a second gate row on 2026-11-13). pitch_at now falls back to run_date. Same columns and types: safe to re-run.
begin;
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
commit;
