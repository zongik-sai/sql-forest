-- =====================================================================
-- 과목 "컴퓨터 일반"(PC정비사 2급 필기 대비) 학습 기록 + 선생님 반 학습 현황
-- 적용: 20261001000000_sql_forest_v2.sql 다음에 SQL Editor에서 실행(여러 번 실행해도 안전)
-- 원칙
--  * 학생: 본인 기록(cg_progress 한 행)만 읽기·쓰기(RLS).
--  * 선생님: private.teachers에 적힌 이메일 + 이메일 인증된 계정만, RPC로 전체 기록을 "읽기만".
--    선생님 목록은 클라이언트가 바꿀 수 없다(관리자가 SQL Editor에서만 수정).
--  * 학생 이메일은 auth.users, 이름은 Google identity에서 읽는다(학생이 바꿀 수 있는 값을 쓰지 않음).
--  * 점수는 학생 브라우저가 계산해 저장하는 자기 학습 기록이며 평가 근거가 아니다.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------
-- 1. 학생 기록: 한 학생 = 한 행(문서형 JSON)
-- ---------------------------------------------------------------------
create table if not exists public.cg_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 262144),
  revision integer not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now()
);

create or replace function private.cg_bump_revision() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  new.user_id := old.user_id;
  return new;
end $$;

drop trigger if exists cg_progress_bump on public.cg_progress;
create trigger cg_progress_bump before update on public.cg_progress
  for each row execute function private.cg_bump_revision();

revoke all on public.cg_progress from anon, authenticated;
grant select, insert, update, delete on public.cg_progress to authenticated;
alter table public.cg_progress enable row level security;

drop policy if exists own_select on public.cg_progress;
drop policy if exists own_insert on public.cg_progress;
drop policy if exists own_update on public.cg_progress;
drop policy if exists own_delete on public.cg_progress;
create policy own_select on public.cg_progress for select to authenticated using ((select auth.uid()) = user_id);
create policy own_insert on public.cg_progress for insert to authenticated with check ((select auth.uid()) = user_id);
create policy own_update on public.cg_progress for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy own_delete on public.cg_progress for delete to authenticated using ((select auth.uid()) = user_id);

-- 저장: revision compare-and-set. 다른 기기가 먼저 저장했으면 conflict와 서버본을 돌려준다(클라이언트가 병합 후 재시도).
create or replace function public.save_cg_progress(p_state jsonb, p_expected_revision integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := private.require_uid(); r public.cg_progress%rowtype;
begin
  select * into r from public.cg_progress where user_id = v_uid for update;
  if not found then
    -- 두 기기가 동시에 첫 저장을 해도 오류 대신 conflict로 돌려준다
    insert into public.cg_progress (user_id, state) values (v_uid, coalesce(p_state, '{}'::jsonb))
      on conflict (user_id) do nothing returning * into r;
    if found then
      return jsonb_build_object('status', 'ok', 'revision', r.revision);
    end if;
    select * into r from public.cg_progress where user_id = v_uid for update;
  end if;
  if r.revision <> coalesce(p_expected_revision, 0) then
    return jsonb_build_object('status', 'conflict', 'revision', r.revision, 'state', r.state);
  end if;
  update public.cg_progress set state = coalesce(p_state, '{}'::jsonb) where user_id = v_uid returning * into r;
  return jsonb_build_object('status', 'ok', 'revision', r.revision);
end $$;

-- ---------------------------------------------------------------------
-- 2. 선생님 목록(클라이언트에서 읽기·쓰기 불가)
--    선생님 추가(공개 저장소에 이메일을 남기지 않도록 SQL Editor에서 따로 실행):
--      insert into private.teachers(email) values ('teacher@example.com') on conflict do nothing;
-- ---------------------------------------------------------------------
create table if not exists private.teachers (
  email text primary key check (email = lower(btrim(email)) and email like '%_@_%')
);
revoke all on private.teachers from public, anon, authenticated;
-- 이중 방어: 권한이 없어도 RLS를 켜 둔다(정책 없음 = 클라이언트 역할은 0행). 소유자 함수(is_teacher)는 영향 없음
alter table private.teachers enable row level security;

-- 선생님 = 목록의 이메일 + 이메일 인증 + Google 로그인으로 확인된 계정.
-- (이메일·비밀번호 가입이나 이메일 변경으로 선생님 이메일을 흉내 내지 못하게 Google identity를 요구)
create or replace function private.is_teacher() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u
    join private.teachers t on t.email = lower(u.email)
    join auth.identities i on i.user_id = u.id and i.provider = 'google' and lower(i.identity_data ->> 'email') = t.email
    where u.id = auth.uid() and u.email_confirmed_at is not null
  );
$$;

-- 표시 이름: 사용자가 바꿀 수 있는 user_metadata 대신 Google이 준 identity 정보를 쓴다(이름 위장 방지)
create or replace function private.display_name(p_uid uuid, email text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select coalesce(nullif(btrim(i.identity_data ->> 'full_name'), ''), nullif(btrim(i.identity_data ->> 'name'), ''))
       from auth.identities i where i.user_id = p_uid and i.provider = 'google' limit 1),
    split_part(coalesce(email, ''), '@', 1));
$$;
drop function if exists private.display_name(jsonb, text);

-- 화면에 선생님 메뉴를 보일지 판단(권한 자체는 아래 RPC가 다시 확인)
create or replace function public.am_i_teacher() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and private.is_teacher();
$$;

-- 컴퓨터 일반: 반 전체 기록(읽기 전용)
create or replace function public.cg_class_overview()
returns table (user_id uuid, name text, email text, state jsonb, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_uid();
  if not private.is_teacher() then
    raise exception '선생님 계정만 볼 수 있어요' using errcode = '42501';
  end if;
  return query
    select p.user_id, private.display_name(p.user_id, u.email), u.email::text, p.state, p.updated_at
    from public.cg_progress p join auth.users u on u.id = p.user_id
    order by p.updated_at desc;
end $$;

-- 데이터베이스(SQL 숲): 반 전체 요약(읽기 전용)
create or replace function public.db_class_overview()
returns table (user_id uuid, name text, email text, total_xp integer, activities integer, checkpoints integer,
               units integer, finals integer, last_activity timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_uid();
  if not private.is_teacher() then
    raise exception '선생님 계정만 볼 수 있어요' using errcode = '42501';
  end if;
  return query
    with ev as (
      select e.user_id,
             coalesce(sum(c.xp), 0)::integer as total_xp,
             count(*) filter (where e.reward_id like 'activity:%')::integer as activities,
             count(*) filter (where e.reward_id like 'checkpoint:%')::integer as checkpoints,
             count(*) filter (where e.reward_id like 'unit:%')::integer as units,
             count(*) filter (where e.reward_id like 'final:%')::integer as finals,
             max(e.awarded_at) as last_award
      from public.xp_events e join public.reward_catalog c on c.reward_id = e.reward_id
      group by e.user_id
    ), people as (
      select x.user_id from public.learner_state x
      union select a.user_id from public.activity_progress a
      union select ev.user_id from ev
    )
    select p.user_id, private.display_name(p.user_id, u.email), u.email::text,
           coalesce(ev.total_xp, 0), coalesce(ev.activities, 0), coalesce(ev.checkpoints, 0),
           coalesce(ev.units, 0), coalesce(ev.finals, 0),
           greatest(ev.last_award, ls.updated_at, (select max(a.updated_at) from public.activity_progress a where a.user_id = p.user_id))
    from people p
    join auth.users u on u.id = p.user_id
    left join ev on ev.user_id = p.user_id
    left join public.learner_state ls on ls.user_id = p.user_id
    order by 9 desc nulls last;
end $$;

-- ---------------------------------------------------------------------
-- 3. 실행 권한: authenticated만
-- ---------------------------------------------------------------------
revoke all on function public.save_cg_progress(jsonb, integer), public.am_i_teacher(),
  public.cg_class_overview(), public.db_class_overview() from public, anon;
grant execute on function public.save_cg_progress(jsonb, integer), public.am_i_teacher(),
  public.cg_class_overview(), public.db_class_overview() to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.require_uid() to authenticated;
