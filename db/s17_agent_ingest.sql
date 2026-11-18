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
begin;

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

commit;
