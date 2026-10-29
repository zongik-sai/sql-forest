-- =====================================================================
-- 계정 구분(학생 학번 형식) + 선생님용 계정 목록 + 관리자(교사 권한 지정·해제) (2026-10-29)
-- 적용: 20261026010000_monitoring.sql 다음에 SQL Editor에서 실행(여러 번 실행해도 안전).
--       20261001000000_sql_forest_v2.sql(private.require_uid)·20261007000000_computer_general.sql(private.teachers·display_name)이 먼저 있어야 한다.
--       더 오래된 migration(20261007…)을 나중에 다시 실행했다면 이 파일도 다시 실행한다(private.is_teacher를 이 파일의 정의로 되돌림).
-- 원칙
--  * 학생 계정 = 이메일 도메인이 정확히 seoulai.sen.hs.kr(대소문자 무관)이고, 앞부분의 숫자 묶음 중 길이가 정확히 9인 묶음이
--    딱 하나 있으며 그 묶음이 20으로 시작(연도 2000~2099 + 학번 5자리). 예: sai_209610101@seoulai.sen.hs.kr → 연도 2026, 학번 10101.
--    판정은 private.student_id(email) 하나(IMMUTABLE). 클라이언트 src/features/auth/accountKind.ts와 같은 규칙이며
--    공통 시험 자료 tests/fixtures/student-emails.json으로 두 쪽을 함께 검사한다. 학번은 이메일에서 읽어 보여 줄 뿐 따로 저장하지 않는다.
--  * 학생 계정은 교사·관리자가 될 수 없다:
--      - 지정 RPC(set_teacher·set_admin)가 거부하고,
--      - 표 제약 teachers_not_student·admins_not_student가 학번 형식 이메일을 넣지 못하게 하며(SQL Editor로 넣어도),
--      - private.is_teacher()가 학번 형식 계정을 선생님으로 보지 않는다.
--    이미 private.teachers에 학번 형식 이메일이 들어 있으면 이 migration은 멈추지 않는다: 제약을 NOT VALID(새로 넣는 행만 검사)로 두고
--    WARNING으로 개수와 확인 SQL을 알린다. 그 행은 아무 권한도 주지 않으며(위 is_teacher 규칙), 관리자 복사에서도 빠진다.
--    지운 뒤 이 파일을 다시 실행하면 제약을 VALIDATE한다.
--  * 관리자(private.admins) = 교사(private.is_teacher: 교사 목록 + 이메일 인증 + 같은 이메일의 Google 로그인 + 학번 형식 아님) 중
--    관리자 목록에도 있는 사람. 관리자만 앱에서 set_teacher·set_admin으로 교사·관리자를 지정·해제한다.
--    관리자 지정은 이미 교사인 계정만(교사 지정 → 관리자 지정, 두 단계를 따로 기록). 교사 해제는 관리자 권한도 함께 해제한다.
--  * 처음 적용할 때 이미 등록된 선생님이 관리자가 된다; 이후 관리자는 앱에서 지정.
--    = private.admins가 비어 있으면 지금 private.teachers(사이트 운영자가 SQL Editor로 직접 넣은 이메일, 학번 형식 제외)를 복사한다.
--    복사는 한 번만: 관리자가 생기면 private.role_flags에 'admins_bootstrapped' 표시를 남기고, 그 뒤로는 다시 실행해도 복사하지 않는다
--    (앱에서 해제한 관리자가 되살아나지 않고, 관리자 표를 SQL로 비워도 다시 채우지 않는다 → 아래 비상용 SQL로 지정).
--    선생님이 한 명도 없을 때 적용했다면 표시를 남기지 않으므로, 선생님을 넣은 뒤 다시 실행하면 그때 복사한다.
--    공개 가입 사용자는 관리자가 되지 않는다(관리자 목록은 운영자의 교사 목록 또는 기존 관리자만 바꾼다).
--  * 마지막 관리자는 해제할 수 없다(자기 자신 포함). '관리자 수'는 실제로 관리자 권한이 있는(교사 조건을 만족하는) 계정의 이메일 수.
--  * 권한 변경은 advisory lock으로 한 번에 하나씩 처리하고, 잠금을 얻은 뒤 호출한 사람이 아직 관리자인지 다시 확인한다
--    (두 관리자가 서로를 동시에 해제해 관리자가 0명이 되지 않게. Supabase 기본 격리 수준 READ COMMITTED 기준).
--  * 모든 지정·해제는 private.role_audit에 남는다(언제·누가·누구를·무엇을). 선생님은 role_audit_list로 읽기만 한다.
--  * 계정 목록(account_list)은 선생님만: 이메일·표시 이름(Google)·Google 로그인 여부·이메일 인증·가입일·마지막 로그인·구분·학번·학습 기록 유무.
--  * 비상용(SQL Editor, 공개 저장소에 실제 이메일을 남기지 않음):
--      insert into private.admins(email) values ('관리자@학교.kr') on conflict do nothing;
--    (그 이메일이 교사 목록에도 있고 Google 로그인·이메일 인증이 된 계정이어야 관리자 권한이 생긴다)
-- =====================================================================

create schema if not exists private;

-- ---------------------------------------------------------------------
-- 1. 학생 계정(학번 형식) 판정: 9자리(연도 4 + 학번 5) 또는 null
--    1) 앞뒤 ASCII 공백·탭·줄바꿈 제거, 영문 대문자 A~Z만 소문자로(다른 글자는 바꾸지 않음: 흉내 글자가 영문이 되지 않게)
--    2) 전체가 '^[^@ \t\r\n]+@seoulai\.sen\.hs\.kr$' (@ 하나, 정확히 학교 도메인)
--    3) 앞부분을 '[^0-9]+'로 나눈 묶음 중 길이 9인 것이 딱 하나, 그것이 '^20[0-9]{7}$'
-- ---------------------------------------------------------------------
create or replace function private.student_id(p_email text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text; v_runs text[];
begin
  if p_email is null then
    return null;
  end if;
  v := translate(btrim(p_email, E' \t\r\n'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
  if v !~ '^[^@ \t\r\n]+@seoulai\.sen\.hs\.kr$' then
    return null;
  end if;
  select coalesce(array_agg(r), '{}') into v_runs
    from regexp_split_to_table(split_part(v, '@', 1), '[^0-9]+') as r
   where length(r) = 9;
  if cardinality(v_runs) <> 1 or v_runs[1] !~ '^20[0-9]{7}$' then
    return null;
  end if;
  return v_runs[1];
end $$;

-- ---------------------------------------------------------------------
-- 2. 관리자 목록·한 번만 하는 일 표시·권한 변경 기록(클라이언트에서 읽기·쓰기 불가)
-- ---------------------------------------------------------------------
create table if not exists private.admins (
  email text primary key check (email = lower(btrim(email)) and email like '%_@_%')
);
revoke all on private.admins from public, anon, authenticated;
alter table private.admins enable row level security;

create table if not exists private.role_flags (
  key text primary key,
  at timestamptz not null default now()
);
revoke all on private.role_flags from public, anon, authenticated;
alter table private.role_flags enable row level security;

create table if not exists private.role_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,          -- 바꾼 관리자(처음 적용 때 자동 복사는 null)
  actor_email text,
  target uuid,         -- 바뀐 계정(처음 적용 때 자동 복사는 null)
  target_email text,
  action text not null check (action in ('grant_teacher', 'revoke_teacher', 'grant_admin', 'revoke_admin'))
);
create index if not exists role_audit_at on private.role_audit (at desc, id desc);
revoke all on private.role_audit from public, anon, authenticated;
alter table private.role_audit enable row level security;

-- ---------------------------------------------------------------------
-- 3. 학생 계정은 교사·관리자 목록에 넣을 수 없다(표 제약).
--    NOT VALID: 새로 넣거나 바꾸는 행만 검사(이미 있는 학번 형식 행 때문에 migration이 멈추지 않게). 깨끗하면 VALIDATE
-- ---------------------------------------------------------------------
alter table private.teachers drop constraint if exists teachers_not_student;
alter table private.teachers add constraint teachers_not_student check (private.student_id(email) is null) not valid;
alter table private.admins drop constraint if exists admins_not_student;
alter table private.admins add constraint admins_not_student check (private.student_id(email) is null) not valid;

do $$
declare n_t integer; n_a integer;
begin
  select count(*) into n_t from private.teachers t where private.student_id(t.email) is not null;
  select count(*) into n_a from private.admins a where private.student_id(a.email) is not null;
  if n_t = 0 then
    alter table private.teachers validate constraint teachers_not_student;
  else
    raise warning '교사 목록(private.teachers)에 학생 계정(학번 형식) 이메일이 %개 있어요. 이 계정들은 교사·관리자 권한이 없는 것으로 처리돼요. 확인: select email from private.teachers where private.student_id(email) is not null; 지운 뒤 이 파일을 다시 실행하세요.', n_t;
  end if;
  if n_a = 0 then
    alter table private.admins validate constraint admins_not_student;
  else
    raise warning '관리자 목록(private.admins)에 학생 계정(학번 형식) 이메일이 %개 있어요(권한 없음으로 처리). 확인: select email from private.admins where private.student_id(email) is not null;', n_a;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. 선생님·관리자 판정
-- ---------------------------------------------------------------------
-- 이메일이 같은 Google 로그인 정보가 있는지
create or replace function private.has_google(p_uid uuid, p_email text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.identities i
    where i.user_id = p_uid and i.provider = 'google' and lower(i.identity_data ->> 'email') = lower(p_email)
  );
$$;

-- 선생님 = 교사 목록의 이메일 + 이메일 인증 + 같은 이메일의 Google 로그인 + 학번 형식 아님
create or replace function private.is_teacher_uid(p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u
    join private.teachers t on t.email = lower(u.email)
    join auth.identities i on i.user_id = u.id and i.provider = 'google' and lower(i.identity_data ->> 'email') = t.email
    where u.id = p_uid and u.email_confirmed_at is not null and private.student_id(u.email) is null
  );
$$;

-- 기존 함수(20261007000000_computer_general.sql)를 같은 이름·같은 모양으로 바꾼다: 학번 형식 계정 제외가 더해짐
create or replace function private.is_teacher() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_teacher_uid(auth.uid());
$$;

-- 관리자 = 선생님 + 관리자 목록
create or replace function private.is_admin_uid(p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_teacher_uid(p_uid) and exists (
    select 1 from auth.users u join private.admins a on a.email = lower(u.email) where u.id = p_uid
  );
$$;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin_uid(auth.uid());
$$;

-- 이 이메일을 빼고 남는 실제 관리자(권한이 살아 있는 계정)의 이메일 수
create or replace function private.admins_left(p_except text) returns integer
language sql stable security definer set search_path = '' as $$
  select count(distinct a.email)::integer
  from private.admins a join auth.users u on lower(u.email) = a.email
  where a.email <> coalesce(p_except, '') and private.is_admin_uid(u.id);
$$;

-- ---------------------------------------------------------------------
-- 5. 처음 적용할 때: 관리자 목록이 비어 있으면 지금의 교사 목록(학번 형식 제외)을 복사. 한 번만('admins_bootstrapped')
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from private.role_flags f where f.key = 'admins_bootstrapped') then
    if not exists (select 1 from private.admins) then
      with added as (
        insert into private.admins (email)
          select t.email from private.teachers t where private.student_id(t.email) is null
          on conflict do nothing
          returning email
      )
      insert into private.role_audit (actor, actor_email, target, target_email, action)
        select null, null, null, added.email, 'grant_admin' from added;
    end if;
    if exists (select 1 from private.admins) then
      insert into private.role_flags (key) values ('admins_bootstrapped') on conflict do nothing;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. RPC
-- ---------------------------------------------------------------------
-- 화면에 권한 변경 버튼을 보일지 판단(권한 자체는 set_teacher·set_admin이 다시 확인)
create or replace function public.am_i_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and private.is_admin();
$$;

-- 선생님: 모든 계정 목록(읽기 전용). 구분 순서: 확인 필요 → 관리자 → 교사 → 학생, 그 안에서 학번 → 연도 → 이메일
create or replace function public.account_list()
returns table (user_id uuid, email text, name text, google boolean, email_verified boolean,
               created_at timestamptz, last_sign_in_at timestamptz, kind text,
               student_year integer, student_no text, has_progress boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_with uuid[] := '{}'; v_part uuid[]; v_t text;
begin
  perform private.require_uid();
  if not private.is_teacher() then
    raise exception '선생님 계정만 볼 수 있어요' using errcode = '42501';
  end if;
  -- 학습 기록 유무: 있는 표만 본다(뒤 migration이 아직 적용되지 않았으면 그 표는 건너뜀)
  foreach v_t in array array['learner_state', 'activity_progress', 'xp_events', 'cg_progress', 'course_progress'] loop
    if to_regclass('public.' || v_t) is not null then
      execute format('select coalesce(array_agg(distinct x.user_id), ''{}''::uuid[]) from public.%I x', v_t) into v_part;
      v_with := v_with || v_part;
    end if;
  end loop;
  return query
    with base as (
      select u.id, u.email::text as em, lower(u.email) as e, (u.email_confirmed_at is not null) as verified,
             u.created_at as c_at, u.last_sign_in_at as l_at, private.student_id(u.email) as sid,
             private.has_google(u.id, u.email) as g, private.is_teacher_uid(u.id) as t
      from auth.users u
    ), k as (
      select b.*, case
               when b.t and exists (select 1 from private.admins a where a.email = b.e) then 'admin'
               when b.t then 'teacher'
               when b.sid is not null and b.verified and b.g then 'student'
               else 'unknown' end as knd
      from base b
    ), prog as (
      select distinct w.uid from unnest(v_with) as w(uid)
    )
    select k.id, k.em, private.display_name(k.id, k.em), k.g, k.verified, k.c_at, k.l_at, k.knd,
           case when k.sid is not null then left(k.sid, 4)::integer end,
           case when k.sid is not null then right(k.sid, 5) end,
           (p.uid is not null)
    from k left join prog p on p.uid = k.id
    order by case k.knd when 'unknown' then 0 when 'admin' then 1 when 'teacher' then 2 else 3 end,
             right(k.sid, 5) nulls last, left(k.sid, 4) nulls last, k.e nulls last, k.id;
end $$;

-- 관리자: 교사 지정(p_on = true)·해제(false). 바뀌었으면 true, 이미 그 상태면 false(기록 없음)
--  지정: 계정이 있고, 이메일 인증, 같은 이메일의 Google 로그인, 학번 형식 아님 → 교사 목록에 이메일(소문자)
--  해제: 교사·관리자 목록에서 모두 지움. 마지막 관리자는 해제할 수 없음(자기 자신 포함)
create or replace function public.set_teacher(p_user uuid, p_on boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_actor text; v_email text; v_verified boolean; v_n integer; v_changed boolean := false;
begin
  if not private.is_admin() then
    raise exception '관리자만 권한을 바꿀 수 있어요' using errcode = '42501';
  end if;
  if p_user is null or p_on is null then
    raise exception '계정과 지정·해제를 정해 주세요' using errcode = '22023';
  end if;
  -- 권한 변경은 한 번에 하나씩. 기다리는 동안 내 관리자 권한이 해제됐을 수 있으니 잠금 뒤 다시 확인
  perform pg_advisory_xact_lock(hashtextextended('private.roles', 0));
  if not private.is_admin() then
    raise exception '관리자만 권한을 바꿀 수 있어요' using errcode = '42501';
  end if;
  select lower(u.email), (u.email_confirmed_at is not null) into v_email, v_verified from auth.users u where u.id = p_user;
  if not found then
    raise exception '계정을 찾을 수 없어요' using errcode = '22023';
  end if;
  select lower(u.email) into v_actor from auth.users u where u.id = v_uid;

  if p_on then
    if v_email is null or v_email !~ '^[^@ \t\r\n]+@[^@ \t\r\n]+$' then
      raise exception '이메일이 없는 계정은 교사로 지정할 수 없어요' using errcode = '22023';
    end if;
    if private.student_id(v_email) is not null then
      raise exception '학생 계정(학번 형식)은 교사로 지정할 수 없어요' using errcode = '22023';
    end if;
    if not v_verified then
      raise exception '이메일이 인증되지 않은 계정은 교사로 지정할 수 없어요' using errcode = '22023';
    end if;
    if not private.has_google(p_user, v_email) then
      raise exception 'Google로 로그인한 계정만 교사로 지정할 수 있어요' using errcode = '22023';
    end if;
    insert into private.teachers (email) values (v_email) on conflict do nothing;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      insert into private.role_audit (actor, actor_email, target, target_email, action) values (v_uid, v_actor, p_user, v_email, 'grant_teacher');
      v_changed := true;
    end if;
    return v_changed;
  end if;

  if v_email is null then
    return false;
  end if;
  if exists (select 1 from private.admins a where a.email = v_email) and private.admins_left(v_email) = 0 then
    raise exception '마지막 관리자는 해제할 수 없어요. 다른 관리자를 먼저 지정해 주세요' using errcode = '55000';
  end if;
  delete from private.admins a where a.email = v_email;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    insert into private.role_audit (actor, actor_email, target, target_email, action) values (v_uid, v_actor, p_user, v_email, 'revoke_admin');
    v_changed := true;
  end if;
  delete from private.teachers t where t.email = v_email;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    insert into private.role_audit (actor, actor_email, target, target_email, action) values (v_uid, v_actor, p_user, v_email, 'revoke_teacher');
    v_changed := true;
  end if;
  return v_changed;
end $$;

-- 관리자: 관리자 지정(p_on = true)·해제(false). 바뀌었으면 true, 이미 그 상태면 false(기록 없음)
--  지정: 이미 교사인 계정만(먼저 교사로 지정), 학번 형식 아님. 해제: 교사 권한은 그대로, 마지막 관리자는 해제할 수 없음
create or replace function public.set_admin(p_user uuid, p_on boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_actor text; v_email text; v_n integer;
begin
  if not private.is_admin() then
    raise exception '관리자만 권한을 바꿀 수 있어요' using errcode = '42501';
  end if;
  if p_user is null or p_on is null then
    raise exception '계정과 지정·해제를 정해 주세요' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('private.roles', 0));
  if not private.is_admin() then
    raise exception '관리자만 권한을 바꿀 수 있어요' using errcode = '42501';
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = p_user;
  if not found then
    raise exception '계정을 찾을 수 없어요' using errcode = '22023';
  end if;
  select lower(u.email) into v_actor from auth.users u where u.id = v_uid;

  if p_on then
    if private.student_id(v_email) is not null then
      raise exception '학생 계정(학번 형식)은 관리자로 지정할 수 없어요' using errcode = '22023';
    end if;
    if not private.is_teacher_uid(p_user) then
      raise exception '먼저 교사로 지정해야 관리자로 지정할 수 있어요' using errcode = '22023';
    end if;
    insert into private.admins (email) values (v_email) on conflict do nothing;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      insert into private.role_audit (actor, actor_email, target, target_email, action) values (v_uid, v_actor, p_user, v_email, 'grant_admin');
    end if;
    return v_n > 0;
  end if;

  if v_email is null or not exists (select 1 from private.admins a where a.email = v_email) then
    return false;
  end if;
  if private.admins_left(v_email) = 0 then
    raise exception '마지막 관리자는 해제할 수 없어요. 다른 관리자를 먼저 지정해 주세요' using errcode = '55000';
  end if;
  delete from private.admins a where a.email = v_email;
  insert into private.role_audit (actor, actor_email, target, target_email, action) values (v_uid, v_actor, p_user, v_email, 'revoke_admin');
  return true;
end $$;

-- 선생님: 권한 변경 기록(최근 순, 1~200개)
create or replace function public.role_audit_list(p_limit integer default 50)
returns table (at timestamptz, actor uuid, actor_email text, actor_name text, target uuid, target_email text, target_name text, action text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform private.require_uid();
  if not private.is_teacher() then
    raise exception '선생님 계정만 볼 수 있어요' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception '조회 개수는 1~200개예요' using errcode = '22023';
  end if;
  return query
    select r.at, r.actor, r.actor_email,
           case when r.actor is not null then private.display_name(r.actor, r.actor_email) end,
           r.target, r.target_email,
           case when r.target is not null then private.display_name(r.target, r.target_email) end,
           r.action
    from private.role_audit r
    order by r.at desc, r.id desc
    limit p_limit;
end $$;

-- ---------------------------------------------------------------------
-- 7. 실행 권한: RPC는 authenticated만. private 도우미는 클라이언트가 직접 부를 수 없다
-- ---------------------------------------------------------------------
revoke all on function public.am_i_admin(), public.account_list(), public.set_teacher(uuid, boolean),
  public.set_admin(uuid, boolean), public.role_audit_list(integer) from public, anon;
grant execute on function public.am_i_admin(), public.account_list(), public.set_teacher(uuid, boolean),
  public.set_admin(uuid, boolean), public.role_audit_list(integer) to authenticated;
revoke all on function private.student_id(text), private.has_google(uuid, text), private.is_teacher_uid(uuid),
  private.is_teacher(), private.is_admin_uid(uuid), private.is_admin(), private.admins_left(text)
  from public, anon, authenticated;
