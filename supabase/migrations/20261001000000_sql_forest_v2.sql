-- =====================================================================
-- SQL 숲 키우기 v2 — 사용자 진도·XP 원장 스키마 (Supabase Postgres)
-- 적용: Supabase Dashboard > SQL Editor 또는 `supabase db push`
-- 원칙
--  * 모든 사용자 테이블은 RLS로 auth.uid() = user_id 인 행만 접근.
--  * XP 원장(xp_events)·배지(badge_awards)는 클라이언트가 직접 쓰지 못하고
--    SECURITY DEFINER RPC(award_xp, award_badge)로만 기록된다.
--  * RPC는 user_id·XP 액수를 인자로 받지 않는다(auth.uid()와 reward_catalog 사용).
--  * 학습용 SQL은 이 DB에서 실행하지 않는다(브라우저 SQLite Worker 전용).
--  * 신뢰 경계: 클라이언트 채점 결과(활동 완료 등)를 받아들이는 교육용 설계이며
--    시험 보안 시스템이 아니다. RLS·원장 중복 방지는 타인 데이터 접근과 중복 지급을 막는다.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------
-- 1. 사용자 진도 테이블
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 60),
  created_at timestamptz not null default now()
);

create table if not exists public.unit_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  unit_id text not null check (unit_id ~ '^U(0[1-9]|1[0-2])$'),
  content_version integer not null check (content_version > 0),
  status text not null check (status in ('locked', 'ready', 'in-progress', 'complete', 'review')),
  completed_activity_ids text[] not null default '{}',
  checkpoint_score integer not null default 0 check (checkpoint_score between 0 and 3),
  updated_at timestamptz not null default now(),
  unique (user_id, unit_id, content_version)
);

create table if not exists public.activity_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_id text not null check (activity_id ~ '^(U(0[1-9]|1[0-2])-A0[1-4]|CH-U(0[1-9]|1[0-2]))$'),
  content_version integer not null check (content_version > 0),
  state_json jsonb not null default '{}'::jsonb check (octet_length(state_json::text) <= 65536),
  draft_sql text not null default '' check (char_length(draft_sql) <= 20480),
  attempts integer not null default 0 check (attempts >= 0),
  hint_level integer not null default 0 check (hint_level between 0 and 3),
  completion_kind text check (completion_kind in ('independent', 'guided')),
  active_seconds integer not null default 0 check (active_seconds >= 0),
  revision integer not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  unique (user_id, activity_id, content_version)
);

create table if not exists public.learning_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  active_seconds integer not null default 0 check (active_seconds >= 0)
);
create index if not exists learning_sessions_user_idx on public.learning_sessions(user_id, started_at desc);

create table if not exists public.assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('pre', 'final')),
  content_version integer not null check (content_version > 0),
  answers_json jsonb not null default '{}'::jsonb check (octet_length(answers_json::text) <= 65536),
  score integer not null check (score >= 0),
  submitted_at timestamptz not null default now()
);
create index if not exists assessment_attempts_user_idx on public.assessment_attempts(user_id, submitted_at desc);

-- 기기 간 이어하기용 학습 상태 스냅샷(문항 진행·도전 기록 등)
create table if not exists public.learner_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null check (octet_length(state::text) <= 524288),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. 보상 카탈로그·원장·배지·숙련 기록
-- ---------------------------------------------------------------------
create table if not exists public.reward_catalog (
  reward_id text primary key,
  xp integer not null check (xp > 0),
  entitlement_version integer not null check (entitlement_version > 0),
  prerequisite_type text not null check (prerequisite_type in ('none', 'unit', 'final', 'course'))
);

create table if not exists public.xp_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  reward_id text not null references public.reward_catalog(reward_id),
  entitlement_version integer not null,
  awarded_at timestamptz not null default now(),
  primary key (user_id, reward_id, entitlement_version)
);

create table if not exists public.badge_awards (
  user_id uuid not null references auth.users(id) on delete cascade,
  badge_id text not null check (badge_id ~ '^badge:(unit-U(0[1-9]|1[0-2])|retry-success|self-solved|mission-complete|forest)$'),
  awarded_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

create table if not exists public.mastery_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_id text not null check (challenge_id ~ '^CH-U(0[1-9]|1[0-2])$'),
  status text not null check (status in ('solved', 'learned')),
  updated_at timestamptz not null default now(),
  primary key (user_id, challenge_id)
);

-- 총 9,900 XP: 활동 100×48, 체크포인트 50×36, 단원 100×12, 최종 진단 100×12, 과정 마무리 900
insert into public.reward_catalog (reward_id, xp, entitlement_version, prerequisite_type) values
  ('activity:U01-A01', 100, 1, 'none'),
  ('activity:U01-A02', 100, 1, 'none'),
  ('activity:U01-A03', 100, 1, 'none'),
  ('activity:U01-A04', 100, 1, 'none'),
  ('activity:U02-A01', 100, 1, 'none'),
  ('activity:U02-A02', 100, 1, 'none'),
  ('activity:U02-A03', 100, 1, 'none'),
  ('activity:U02-A04', 100, 1, 'none'),
  ('activity:U03-A01', 100, 1, 'none'),
  ('activity:U03-A02', 100, 1, 'none'),
  ('activity:U03-A03', 100, 1, 'none'),
  ('activity:U03-A04', 100, 1, 'none'),
  ('activity:U04-A01', 100, 1, 'none'),
  ('activity:U04-A02', 100, 1, 'none'),
  ('activity:U04-A03', 100, 1, 'none'),
  ('activity:U04-A04', 100, 1, 'none'),
  ('activity:U05-A01', 100, 1, 'none'),
  ('activity:U05-A02', 100, 1, 'none'),
  ('activity:U05-A03', 100, 1, 'none'),
  ('activity:U05-A04', 100, 1, 'none'),
  ('activity:U06-A01', 100, 1, 'none'),
  ('activity:U06-A02', 100, 1, 'none'),
  ('activity:U06-A03', 100, 1, 'none'),
  ('activity:U06-A04', 100, 1, 'none'),
  ('activity:U07-A01', 100, 1, 'none'),
  ('activity:U07-A02', 100, 1, 'none'),
  ('activity:U07-A03', 100, 1, 'none'),
  ('activity:U07-A04', 100, 1, 'none'),
  ('activity:U08-A01', 100, 1, 'none'),
  ('activity:U08-A02', 100, 1, 'none'),
  ('activity:U08-A03', 100, 1, 'none'),
  ('activity:U08-A04', 100, 1, 'none'),
  ('activity:U09-A01', 100, 1, 'none'),
  ('activity:U09-A02', 100, 1, 'none'),
  ('activity:U09-A03', 100, 1, 'none'),
  ('activity:U09-A04', 100, 1, 'none'),
  ('activity:U10-A01', 100, 1, 'none'),
  ('activity:U10-A02', 100, 1, 'none'),
  ('activity:U10-A03', 100, 1, 'none'),
  ('activity:U10-A04', 100, 1, 'none'),
  ('activity:U11-A01', 100, 1, 'none'),
  ('activity:U11-A02', 100, 1, 'none'),
  ('activity:U11-A03', 100, 1, 'none'),
  ('activity:U11-A04', 100, 1, 'none'),
  ('activity:U12-A01', 100, 1, 'none'),
  ('activity:U12-A02', 100, 1, 'none'),
  ('activity:U12-A03', 100, 1, 'none'),
  ('activity:U12-A04', 100, 1, 'none'),
  ('checkpoint:U01-Q01', 50, 1, 'none'),
  ('checkpoint:U01-Q02', 50, 1, 'none'),
  ('checkpoint:U01-Q03', 50, 1, 'none'),
  ('checkpoint:U02-Q01', 50, 1, 'none'),
  ('checkpoint:U02-Q02', 50, 1, 'none'),
  ('checkpoint:U02-Q03', 50, 1, 'none'),
  ('checkpoint:U03-Q01', 50, 1, 'none'),
  ('checkpoint:U03-Q02', 50, 1, 'none'),
  ('checkpoint:U03-Q03', 50, 1, 'none'),
  ('checkpoint:U04-Q01', 50, 1, 'none'),
  ('checkpoint:U04-Q02', 50, 1, 'none'),
  ('checkpoint:U04-Q03', 50, 1, 'none'),
  ('checkpoint:U05-Q01', 50, 1, 'none'),
  ('checkpoint:U05-Q02', 50, 1, 'none'),
  ('checkpoint:U05-Q03', 50, 1, 'none'),
  ('checkpoint:U06-Q01', 50, 1, 'none'),
  ('checkpoint:U06-Q02', 50, 1, 'none'),
  ('checkpoint:U06-Q03', 50, 1, 'none'),
  ('checkpoint:U07-Q01', 50, 1, 'none'),
  ('checkpoint:U07-Q02', 50, 1, 'none'),
  ('checkpoint:U07-Q03', 50, 1, 'none'),
  ('checkpoint:U08-Q01', 50, 1, 'none'),
  ('checkpoint:U08-Q02', 50, 1, 'none'),
  ('checkpoint:U08-Q03', 50, 1, 'none'),
  ('checkpoint:U09-Q01', 50, 1, 'none'),
  ('checkpoint:U09-Q02', 50, 1, 'none'),
  ('checkpoint:U09-Q03', 50, 1, 'none'),
  ('checkpoint:U10-Q01', 50, 1, 'none'),
  ('checkpoint:U10-Q02', 50, 1, 'none'),
  ('checkpoint:U10-Q03', 50, 1, 'none'),
  ('checkpoint:U11-Q01', 50, 1, 'none'),
  ('checkpoint:U11-Q02', 50, 1, 'none'),
  ('checkpoint:U11-Q03', 50, 1, 'none'),
  ('checkpoint:U12-Q01', 50, 1, 'none'),
  ('checkpoint:U12-Q02', 50, 1, 'none'),
  ('checkpoint:U12-Q03', 50, 1, 'none'),
  ('unit:U01', 100, 1, 'unit'),
  ('unit:U02', 100, 1, 'unit'),
  ('unit:U03', 100, 1, 'unit'),
  ('unit:U04', 100, 1, 'unit'),
  ('unit:U05', 100, 1, 'unit'),
  ('unit:U06', 100, 1, 'unit'),
  ('unit:U07', 100, 1, 'unit'),
  ('unit:U08', 100, 1, 'unit'),
  ('unit:U09', 100, 1, 'unit'),
  ('unit:U10', 100, 1, 'unit'),
  ('unit:U11', 100, 1, 'unit'),
  ('unit:U12', 100, 1, 'unit'),
  ('final:F01', 100, 1, 'final'),
  ('final:F02', 100, 1, 'final'),
  ('final:F03', 100, 1, 'final'),
  ('final:F04', 100, 1, 'final'),
  ('final:F05', 100, 1, 'final'),
  ('final:F06', 100, 1, 'final'),
  ('final:F07', 100, 1, 'final'),
  ('final:F08', 100, 1, 'final'),
  ('final:F09', 100, 1, 'final'),
  ('final:F10', 100, 1, 'final'),
  ('final:F11', 100, 1, 'final'),
  ('final:F12', 100, 1, 'final'),
  ('course:complete', 900, 1, 'course')on conflict (reward_id) do nothing;

-- ---------------------------------------------------------------------
-- 3. revision 자동 증가(직접 UPDATE도 compare-and-set이 깨지지 않게)
-- ---------------------------------------------------------------------
create or replace function private.bump_revision() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  new.user_id := old.user_id;
  return new;
end $$;

drop trigger if exists activity_progress_bump on public.activity_progress;
create trigger activity_progress_bump before update on public.activity_progress
  for each row execute function private.bump_revision();

-- ---------------------------------------------------------------------
-- 4. 권한·RLS
-- ---------------------------------------------------------------------
revoke all on public.profiles, public.unit_progress, public.activity_progress, public.learning_sessions,
  public.assessment_attempts, public.learner_state, public.reward_catalog, public.xp_events,
  public.badge_awards, public.mastery_progress from anon, authenticated;

grant select, insert, update, delete on public.profiles, public.unit_progress, public.activity_progress,
  public.learning_sessions, public.assessment_attempts, public.learner_state to authenticated;
-- 원장·배지·숙련 기록·카탈로그는 읽기만 허용(쓰기는 RPC 전용)
grant select on public.reward_catalog, public.xp_events, public.badge_awards, public.mastery_progress to authenticated;

alter table public.profiles enable row level security;
alter table public.unit_progress enable row level security;
alter table public.activity_progress enable row level security;
alter table public.learning_sessions enable row level security;
alter table public.assessment_attempts enable row level security;
alter table public.learner_state enable row level security;
alter table public.reward_catalog enable row level security;
alter table public.xp_events enable row level security;
alter table public.badge_awards enable row level security;
alter table public.mastery_progress enable row level security;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'unit_progress', 'activity_progress', 'learning_sessions', 'assessment_attempts', 'learner_state'] loop
    execute format('drop policy if exists own_select on public.%I', t);
    execute format('drop policy if exists own_insert on public.%I', t);
    execute format('drop policy if exists own_update on public.%I', t);
    execute format('drop policy if exists own_delete on public.%I', t);
    execute format('create policy own_select on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('create policy own_insert on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t);
    execute format('create policy own_update on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('create policy own_delete on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t);
  end loop;
  foreach t in array array['xp_events', 'badge_awards', 'mastery_progress'] loop
    execute format('drop policy if exists own_select on public.%I', t);
    execute format('create policy own_select on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

drop policy if exists catalog_read on public.reward_catalog;
create policy catalog_read on public.reward_catalog for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- 5. 내부 함수(외부 노출 안 됨)
-- ---------------------------------------------------------------------
create or replace function private.require_uid() returns uuid
language plpgsql stable set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null then
    raise exception '로그인이 필요합니다' using errcode = '28000';
  end if;
  return v;
end $$;

create or replace function private.total_xp(p_uid uuid) returns integer
language sql stable set search_path = '' as $$
  select coalesce(sum(c.xp), 0)::integer
  from public.xp_events e join public.reward_catalog c on c.reward_id = e.reward_id
  where e.user_id = p_uid;
$$;

create or replace function private.has_reward(p_uid uuid, p_reward text) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from public.xp_events where user_id = p_uid and reward_id = p_reward);
$$;

-- 선행 조건: 원장에 이미 기록된 보상만으로 판단(클라이언트 TS rewards.ts와 동일 규칙)
create or replace function private.prereq_met(p_uid uuid, p_reward text, p_type text) returns boolean
language plpgsql stable set search_path = '' as $$
declare v_unit text; n_act int; n_act_need int; n_cp int;
begin
  if p_type = 'none' then
    return true;
  elsif p_type = 'unit' then
    v_unit := substring(p_reward from 6);
    select count(*) into n_act_need from public.reward_catalog where reward_id like 'activity:' || v_unit || '-A%';
    select count(*) into n_act from public.xp_events where user_id = p_uid and reward_id like 'activity:' || v_unit || '-A%';
    select count(*) into n_cp from public.xp_events where user_id = p_uid and reward_id like 'checkpoint:' || v_unit || '-Q%';
    return n_act_need > 0 and n_act = n_act_need and n_cp >= 2;
  elsif p_type = 'final' then
    return (select count(*) from public.xp_events where user_id = p_uid and reward_id like 'unit:%')
         = (select count(*) from public.reward_catalog where reward_id like 'unit:%');
  elsif p_type = 'course' then
    return (select count(*) from public.xp_events where user_id = p_uid and reward_id like 'unit:%') = (select count(*) from public.reward_catalog where reward_id like 'unit:%')
       and (select count(*) from public.xp_events where user_id = p_uid and reward_id like 'checkpoint:%') = (select count(*) from public.reward_catalog where reward_id like 'checkpoint:%')
       and (select count(*) from public.xp_events where user_id = p_uid and reward_id like 'final:%') = (select count(*) from public.reward_catalog where reward_id like 'final:%');
  end if;
  return false;
end $$;

-- ---------------------------------------------------------------------
-- 6. RPC (authenticated 전용)
-- ---------------------------------------------------------------------

-- XP 지급: 보상 ID만 받는다. 같은 (user, reward, entitlement_version)은 한 번만 기록된다.
create or replace function public.award_xp(p_reward_id text)
returns table (status text, total_xp integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_cat public.reward_catalog%rowtype;
  v_rows integer;
begin
  select * into v_cat from public.reward_catalog where reward_id = p_reward_id;
  if not found then
    return query select 'rejected'::text, private.total_xp(v_uid);
    return;
  end if;
  -- 같은 사용자의 지급 요청을 직렬화: 선행 조건 확인과 원장 INSERT를 한 트랜잭션에서 원자적으로
  perform pg_advisory_xact_lock(hashtextextended('award:' || v_uid::text, 0));
  if exists (select 1 from public.xp_events where user_id = v_uid and reward_id = p_reward_id and entitlement_version = v_cat.entitlement_version) then
    return query select 'duplicate'::text, private.total_xp(v_uid);
    return;
  end if;
  if not private.prereq_met(v_uid, p_reward_id, v_cat.prerequisite_type) then
    return query select 'rejected'::text, private.total_xp(v_uid);
    return;
  end if;
  insert into public.xp_events (user_id, reward_id, entitlement_version)
  values (v_uid, p_reward_id, v_cat.entitlement_version)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  return query select (case when v_rows = 1 then 'awarded' else 'duplicate' end)::text, private.total_xp(v_uid);
end $$;

create or replace function public.record_mastery(p_challenge_id text, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid();
begin
  if p_status not in ('solved', 'learned') then raise exception 'invalid status'; end if;
  insert into public.mastery_progress (user_id, challenge_id, status) values (v_uid, p_challenge_id, p_status)
  on conflict (user_id, challenge_id) do update
    set status = case when public.mastery_progress.status = 'solved' then 'solved' else excluded.status end,
        updated_at = now();
end $$;

create or replace function public.award_badge(p_badge_id text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); v_ok boolean := false; v_rows integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('badge:' || v_uid::text, 0));
  if exists (select 1 from public.badge_awards where user_id = v_uid and badge_id = p_badge_id) then
    return 'duplicate';
  end if;
  if p_badge_id ~ '^badge:unit-U(0[1-9]|1[0-2])$' then
    v_ok := private.has_reward(v_uid, 'unit:' || substring(p_badge_id from 12));
  elsif p_badge_id = 'badge:retry-success' then
    v_ok := true;
  elsif p_badge_id = 'badge:self-solved' then
    v_ok := (select count(*) from public.mastery_progress where user_id = v_uid and status = 'solved') >= 3;
  elsif p_badge_id = 'badge:mission-complete' then
    v_ok := (select count(*) from public.xp_events where user_id = v_uid and reward_id like 'activity:U12-A%') = 4;
  elsif p_badge_id = 'badge:forest' then
    v_ok := private.has_reward(v_uid, 'course:complete');
  end if;
  if not v_ok then return 'rejected'; end if;
  insert into public.badge_awards (user_id, badge_id) values (v_uid, p_badge_id) on conflict do nothing;
  get diagnostics v_rows = row_count;
  return case when v_rows = 1 then 'awarded' else 'duplicate' end;
end $$;

-- 활동 진도 저장: revision compare-and-set. 다른 기기가 먼저 바꿨으면 conflict와 서버본을 돌려준다.
create or replace function public.save_activity_progress(
  p_activity_id text, p_content_version integer, p_state jsonb, p_draft_sql text, p_attempts integer,
  p_hint_level integer, p_completion_kind text, p_active_seconds integer, p_expected_revision integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := private.require_uid(); r public.activity_progress%rowtype;
begin
  select * into r from public.activity_progress
   where user_id = v_uid and activity_id = p_activity_id and content_version = p_content_version for update;
  if not found then
    insert into public.activity_progress (user_id, activity_id, content_version, state_json, draft_sql, attempts, hint_level, completion_kind, active_seconds, revision)
    values (v_uid, p_activity_id, p_content_version, coalesce(p_state, '{}'::jsonb), coalesce(p_draft_sql, ''), greatest(p_attempts, 0), least(greatest(p_hint_level, 0), 3), p_completion_kind, greatest(p_active_seconds, 0), 1)
    returning * into r;
    return jsonb_build_object('status', 'ok', 'revision', r.revision);
  end if;
  if r.revision <> p_expected_revision then
    return jsonb_build_object('status', 'conflict', 'revision', r.revision, 'draft_sql', r.draft_sql, 'state', r.state_json, 'updated_at', r.updated_at);
  end if;
  update public.activity_progress set
    state_json = coalesce(p_state, '{}'::jsonb),
    draft_sql = coalesce(p_draft_sql, ''),
    attempts = greatest(attempts, p_attempts),
    hint_level = greatest(hint_level, least(greatest(p_hint_level, 0), 3)),
    completion_kind = coalesce(completion_kind, p_completion_kind),  -- 완료는 단조 증가
    active_seconds = greatest(active_seconds, p_active_seconds)
  where user_id = v_uid and activity_id = p_activity_id and content_version = p_content_version
  returning * into r;
  return jsonb_build_object('status', 'ok', 'revision', r.revision);
end $$;

create or replace function public.save_unit_progress(p_unit_id text, p_content_version integer, p_status text, p_completed_activity_ids text[], p_checkpoint_score integer)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := private.require_uid();
begin
  insert into public.unit_progress (user_id, unit_id, content_version, status, completed_activity_ids, checkpoint_score)
  values (v_uid, p_unit_id, p_content_version, p_status, coalesce(p_completed_activity_ids, '{}'), p_checkpoint_score)
  on conflict (user_id, unit_id, content_version) do update set
    status = excluded.status,
    completed_activity_ids = array(select distinct x from unnest(public.unit_progress.completed_activity_ids || excluded.completed_activity_ids) as x order by x),
    checkpoint_score = greatest(public.unit_progress.checkpoint_score, excluded.checkpoint_score),
    updated_at = now();
end $$;

create or replace function public.save_learner_state(p_state jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := private.require_uid();
begin
  insert into public.learner_state (user_id, state) values (v_uid, p_state)
  on conflict (user_id) do update set state = excluded.state, updated_at = now();
end $$;

create or replace function public.start_learning_session()
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := private.require_uid(); v_id uuid;
begin
  insert into public.learning_sessions (user_id) values (v_uid) returning id into v_id;
  return v_id;
end $$;

-- 세션별 누적 활성 시간: 증가만 허용하고 실제 경과 시간(+60초 여유)을 넘지 못한다.
create or replace function public.update_learning_session(p_id uuid, p_active_seconds integer)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := private.require_uid();
begin
  update public.learning_sessions s set
    active_seconds = greatest(s.active_seconds, least(p_active_seconds, (extract(epoch from (now() - s.started_at)))::integer + 60)),
    ended_at = now()
  where s.id = p_id and s.user_id = v_uid;
end $$;

create or replace function public.submit_assessment(p_type text, p_content_version integer, p_answers jsonb, p_score integer)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := private.require_uid(); v_id uuid;
begin
  insert into public.assessment_attempts (user_id, type, content_version, answers_json, score)
  values (v_uid, p_type, p_content_version, coalesce(p_answers, '{}'::jsonb), p_score) returning id into v_id;
  return v_id;
end $$;

-- 본인 학습 기록 전체 삭제(원장 포함). 계정(auth.users) 삭제는 운영 관리자가 수행.
create or replace function public.delete_my_progress()
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid();
begin
  delete from public.xp_events where user_id = v_uid;
  delete from public.badge_awards where user_id = v_uid;
  delete from public.mastery_progress where user_id = v_uid;
  delete from public.activity_progress where user_id = v_uid;
  delete from public.unit_progress where user_id = v_uid;
  delete from public.learning_sessions where user_id = v_uid;
  delete from public.assessment_attempts where user_id = v_uid;
  delete from public.learner_state where user_id = v_uid;
end $$;

-- 실행 권한: PUBLIC/anon 제거, authenticated에만 부여
revoke all on function public.award_xp(text), public.record_mastery(text, text), public.award_badge(text),
  public.save_activity_progress(text, integer, jsonb, text, integer, integer, text, integer, integer),
  public.save_unit_progress(text, integer, text, text[], integer), public.save_learner_state(jsonb),
  public.start_learning_session(), public.update_learning_session(uuid, integer),
  public.submit_assessment(text, integer, jsonb, integer), public.delete_my_progress() from public, anon;
grant execute on function public.award_xp(text), public.record_mastery(text, text), public.award_badge(text),
  public.save_activity_progress(text, integer, jsonb, text, integer, integer, text, integer, integer),
  public.save_unit_progress(text, integer, text, text[], integer), public.save_learner_state(jsonb),
  public.start_learning_session(), public.update_learning_session(uuid, integer),
  public.submit_assessment(text, integer, jsonb, integer), public.delete_my_progress() to authenticated;

-- 내부 스키마 함수는 RPC(SECURITY DEFINER 소유자)만 사용. invoker RPC가 쓰는 require_uid만 실행 허용
revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.require_uid() to authenticated;
