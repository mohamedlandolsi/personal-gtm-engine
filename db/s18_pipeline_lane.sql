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
begin;

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
--   sample             3 to 5 x {"company","domain","trigger","trigger_date","trigger_url","buyer_title","buyer_name"?} (buyer_name optional, ADR-144)
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
          -- company-level facts plus an optional buyer_name copied from the trigger article; never emails or links (ADR-140, amended by ADR-144)
          v_sample := v_sample || jsonb_build_array(jsonb_build_object(
            'company', left(trim(r->>'company'), 120), 'domain', s_dom,
            'trigger', left(trim(r->>'trigger'), 200), 'trigger_date', s_date,
            'trigger_url', left(trim(r->>'trigger_url'), 500), 'buyer_title', left(trim(r->>'buyer_title'), 80),
            'buyer_name', case when length(trim(coalesce(r->>'buyer_name', ''))) between 3 and 80
                                and trim(r->>'buyer_name') ~ '^[^0-9@/:<>{}\[\]\n]+ [^0-9@/:<>{}\[\]\n]+$'
                               then trim(r->>'buyer_name') end));
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
      select array_agg(format('%s. %s (%s): %s, %s. %s', t.i, t.x->>'company', t.x->>'domain',
                              t.x->>'trigger', to_char((t.x->>'trigger_date')::date, 'Mon FMDD'),
                              case when nullif(t.x->>'buyer_name', '') is not null
                                   then 'Contact: ' || (t.x->>'buyer_name') || ', ' || (t.x->>'buyer_title')
                                   else 'Buyer: ' || (t.x->>'buyer_title') end) order by t.i)
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

commit;
