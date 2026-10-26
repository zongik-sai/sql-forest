-- =====================================================================
-- 새 과목(네트워크·프로그래밍·Data) 학습 기록 + 선생님 반 학습 현황(2026-10-26)
-- 세 과목은 컴퓨터 일반과 같은 구조(단원 × 5단계 · 모의고사 · 오답노트)이고 기록 형식(JSON 문서)도 같다.
-- 적용: 20261007000000_computer_general.sql 다음에 SQL Editor에서 실행(여러 번 실행해도 안전)
-- 원칙(컴퓨터 일반 cg_progress와 같음)
--  * 학생: 본인 기록(과목마다 한 행)만 읽기·쓰기(RLS).
--  * 선생님: private.is_teacher()(목록 이메일 + 이메일 인증 + Google 로그인)만, RPC로 과목별 전체 기록을 "읽기만".
--  * 학생 이메일은 auth.users, 이름은 Google identity(private.display_name)에서 읽는다.
--  * 점수는 학생 브라우저가 계산해 저장하는 자기 학습 기록이며 평가 근거가 아니다.
-- 기존 함수(save_cg_progress·cg_class_overview·is_teacher·display_name 등)는 바꾸지 않는다.
-- =====================================================================

create schema if not exists private;

-- ---------------------------------------------------------------------
-- 1. 학생 기록: 한 학생 × 한 과목 = 한 행(문서형 JSON)
-- ---------------------------------------------------------------------
create table if not exists public.course_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  course text not null check (course in ('net', 'prog', 'data')),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 262144),
  revision integer not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  primary key (user_id, course)
);

create or replace function private.course_bump_revision() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  -- 행의 주인·과목은 바꿀 수 없다
  new.user_id := old.user_id;
  new.course := old.course;
  return new;
end $$;

drop trigger if exists course_progress_bump on public.course_progress;
create trigger course_progress_bump before update on public.course_progress
  for each row execute function private.course_bump_revision();

revoke all on public.course_progress from anon, authenticated;
grant select, insert, update, delete on public.course_progress to authenticated;
alter table public.course_progress enable row level security;

drop policy if exists own_select on public.course_progress;
drop policy if exists own_insert on public.course_progress;
drop policy if exists own_update on public.course_progress;
drop policy if exists own_delete on public.course_progress;
create policy own_select on public.course_progress for select to authenticated using ((select auth.uid()) = user_id);
create policy own_insert on public.course_progress for insert to authenticated with check ((select auth.uid()) = user_id);
create policy own_update on public.course_progress for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy own_delete on public.course_progress for delete to authenticated using ((select auth.uid()) = user_id);

-- 저장: revision compare-and-set(save_cg_progress와 같은 방식). 다른 기기가 먼저 저장했으면 conflict와 서버본을 돌려준다.
create or replace function public.save_course_progress(p_course text, p_state jsonb, p_expected_revision integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := private.require_uid(); r public.course_progress%rowtype;
begin
  if p_course is null or p_course not in ('net', 'prog', 'data') then
    raise exception '알 수 없는 과목입니다' using errcode = '22023';
  end if;
  select * into r from public.course_progress where user_id = v_uid and course = p_course for update;
  if not found then
    -- 두 기기가 동시에 첫 저장을 해도 오류 대신 conflict로 돌려준다
    insert into public.course_progress (user_id, course, state) values (v_uid, p_course, coalesce(p_state, '{}'::jsonb))
      on conflict (user_id, course) do nothing returning * into r;
    if found then
      return jsonb_build_object('status', 'ok', 'revision', r.revision);
    end if;
    select * into r from public.course_progress where user_id = v_uid and course = p_course for update;
  end if;
  if r.revision <> coalesce(p_expected_revision, 0) then
    return jsonb_build_object('status', 'conflict', 'revision', r.revision, 'state', r.state);
  end if;
  update public.course_progress set state = coalesce(p_state, '{}'::jsonb)
    where user_id = v_uid and course = p_course returning * into r;
  return jsonb_build_object('status', 'ok', 'revision', r.revision);
end $$;

-- ---------------------------------------------------------------------
-- 2. 선생님: 과목별 반 전체 기록(읽기 전용). 선생님 판정·표시 이름은 컴퓨터 일반과 같은 private 함수
-- ---------------------------------------------------------------------
create or replace function public.course_class_overview(p_course text)
returns table (user_id uuid, name text, email text, state jsonb, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_uid();
  if not private.is_teacher() then
    raise exception '선생님 계정만 볼 수 있어요' using errcode = '42501';
  end if;
  if p_course is null or p_course not in ('net', 'prog', 'data') then
    raise exception '알 수 없는 과목입니다' using errcode = '22023';
  end if;
  return query
    select p.user_id, private.display_name(p.user_id, u.email), u.email::text, p.state, p.updated_at
    from public.course_progress p join auth.users u on u.id = p.user_id
    where p.course = p_course
    order by p.updated_at desc;
end $$;

-- ---------------------------------------------------------------------
-- 3. 실행 권한: authenticated만(새로 만든 private 함수는 클라이언트가 직접 부를 수 없게)
-- ---------------------------------------------------------------------
revoke all on function public.save_course_progress(text, jsonb, integer), public.course_class_overview(text) from public, anon;
grant execute on function public.save_course_progress(text, jsonb, integer), public.course_class_overview(text) to authenticated;
revoke all on function private.course_bump_revision() from public, anon, authenticated;
