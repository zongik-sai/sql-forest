-- =====================================================================
-- 계정 구분(학생 학번 형식) + 선생님용 계정 목록 + 관리자(교사 권한 지정·해제) (2026-10-29)
-- 적용: 20261026010000_monitoring.sql 다음에 SQL Editor에서 실행(여러 번 실행해도 안전).
--       20261001000000_sql_forest_v2.sql(private.require_uid)·20261007000000_computer_general.sql(private.teachers·display_name)이 먼저 있어야 한다.
--       ※ 20261007000000_computer_general.sql을 나중에 다시 실행하면 그 파일이 private.is_teacher()를 예전 정의(학번 형식 제외 없음)로
--         되돌리므로, 그 뒤에 반드시 이 파일도 다시 실행한다. (이 파일의 RPC는 is_teacher()가 아니라 is_teacher_uid·is_admin_uid로
--         확인하고, 학번 형식 이메일은 표 제약으로 목록에 들어갈 수 없어 그사이에도 계정 관리 권한은 열리지 않는다)
-- 원칙
--  * 학생 계정 = 이메일 도메인이 정확히 seoulai.sen.hs.kr(대소문자 무관)이고, 앞부분의 숫자 묶음 중 길이 9 또는 10인 묶음이
--    딱 하나 있으며 그 묶음의 마지막 9자리가 20으로 시작(연도 2000~2099 + 학번 5자리).
--    예(가짜 연도): sai_209610101@… → 연도 2096, 학번 10101. 'sai?+연도+학번'의 ?가 숫자인 경우(sai1209610101 → 10자리)도 마지막 9자리로 인정.
--    11자리 이상 묶음, 8자리 이하, 9·10자리 묶음이 둘 이상(애매함)은 학생 계정이 아니다.
--    판정은 private.student_id(email) 하나(IMMUTABLE). 클라이언트 src/features/auth/accountKind.ts와 같은 규칙이며
--    공통 시험 자료 tests/fixtures/student-emails.json으로 두 쪽을 함께 검사한다. 학번은 이메일에서 읽어 보여 줄 뿐 따로 저장하지 않는다.
--    교사·관리자 제외 판정(private.is_student_email)은 저장된 이메일 그대로와 lower(이메일)을 모두 본다.
--  * 학생 계정은 교사·관리자가 될 수 없다:
--      - 지정 RPC(set_teacher·set_admin)가 거부하고,
--      - 표 제약 teachers_not_student·admins_not_student가 학번 형식 이메일을 넣지 못하게 하며(SQL Editor로 넣어도),
--      - private.is_teacher_uid(그리고 같은 정의로 바꾼 private.is_teacher())가 학번 형식 계정을 선생님으로 보지 않는다.
--    이 파일을 실행할 때 교사·관리자 목록에 이미 학번 형식 이메일이 있으면 지우고(권한 변경 기록에 actor 없이 note와 함께 남김,
--    WARNING으로 개수 안내) 제약을 바로 검사(VALIDATE)한다. NOT VALID 제약은 남기지 않는다.
--  * 관리자(private.admins) = 선생님(교사 목록 + 이메일 인증 + 같은 이메일의 Google 로그인 + 학번 형식 아님) 중 관리자 목록에도 있는 사람.
--    관리자만 앱에서 set_teacher·set_admin·revoke_listed_email로 교사·관리자를 지정·해제한다.
--    관리자 지정은 이미 교사인 계정만(교사 지정 → 관리자 지정, 두 단계를 따로 기록). 교사 해제는 관리자 권한도 함께 해제한다.
--    계정 단위 해제는 그 계정에 묶인 모든 이메일(계정 이메일 + 그 계정의 Google 로그인 이메일들, 소문자)을 목록에서 지운다.
--    목록에만 있고 그 이메일로 로그인한 계정이 없는 항목은 account_list에 kind 'listed'(user_id 없음)로 보이고,
--    revoke_listed_email(이메일)로 해제한다.
--  * 처음 적용할 때 이미 등록된 선생님이 관리자가 된다; 이후 관리자는 앱에서 지정.
--    = private.admins가 비어 있으면 지금 private.teachers(사이트 운영자가 SQL Editor로 직접 넣은 이메일)를 복사한다.
--    복사는 한 번만: 관리자가 생기면 private.role_flags에 'admins_bootstrapped' 표시를 남기고, 그 뒤로는 다시 실행해도 복사하지 않는다
--    (앱에서 해제한 관리자가 되살아나지 않고, 관리자 표를 SQL로 비워도 다시 채우지 않는다 → 아래 비상용 SQL로 지정).
--    선생님이 한 명도 없을 때 적용했다면 표시를 남기지 않으므로, 선생님을 넣은 뒤 다시 실행하면 그때 복사한다.
--    공개 가입 사용자는 관리자가 되지 않는다(관리자 목록은 운영자의 교사 목록 또는 기존 관리자만 바꾼다).
--  * 마지막 관리자는 해제할 수 없다(자기 자신 포함). '관리자 수'는 실제로 관리자 권한이 있는(선생님 조건을 만족하는) 계정의 이메일 수.
--  * 권한 변경은 advisory lock을 먼저 얻고, 그다음 한 번만 호출한 사람이 관리자인지 확인한다(잠금 전 확인 없음:
--    기다리는 동안 다른 관리자가 내 권한을 해제했어도 잠금 뒤 확인에서 걸러진다. 두 관리자가 서로를 동시에 해제해
--    관리자가 0명이 되지 않게. Supabase 기본 격리 수준 READ COMMITTED 기준).
--  * 모든 지정·해제는 private.role_audit에 남는다(언제·누가·누구를·무엇을·비고). 선생님은 role_audit_list로 읽기만 한다.
--  * 계정 목록(account_list)은 선생님만: 이메일·표시 이름(Google)·Google 로그인 여부·이메일 인증·가입일·마지막 로그인·구분·학번·
--    학습 기록 유무·목록 등록 여부(listed_as).
--  * 비상용(SQL Editor, 공개 저장소에 실제 이메일을 남기지 않음):
--      insert into private.admins(email) values ('관리자@학교.kr') on conflict do nothing;
--    (그 이메일이 교사 목록에도 있고 Google 로그인·이메일 인증이 된 계정이어야 관리자 권한이 생긴다)
-- =====================================================================

create schema if not exists private;

-- ---------------------------------------------------------------------
-- 1. 학생 계정(학번 형식) 판정: 9자리(연도 4 + 학번 5) 또는 null
--    1) 앞뒤 ASCII 공백·탭·줄바꿈 제거, 영문 대문자 A~Z만 소문자로(다른 글자는 바꾸지 않음: 흉내 글자가 영문이 되지 않게)
--    2) 전체가 '^[^@ \t\r\n]+@seoulai\.sen\.hs\.kr$' (@ 하나, 정확히 학교 도메인)
--    3) 앞부분을 '[^0-9]+'로 나눈 묶음 중 길이 9 또는 10인 것이 딱 하나, 그 묶음의 마지막 9자리(right(…, 9))가 '^20[0-9]{7}$'
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
   where length(r) in (9, 10);
  if cardinality(v_runs) <> 1 or right(v_runs[1], 9) !~ '^20[0-9]{7}$' then
    return null;
  end if;
  return right(v_runs[1], 9);
end $$;

-- 교사·관리자 제외용: 저장된 그대로와 lower() 둘 다 학번 형식인지 본다(lower가 영문 밖 글자를 영문으로 바꾸는 경우까지)
create or replace function private.is_student_email(p_email text) returns boolean
language sql immutable set search_path = '' as $$
  select private.student_id(p_email) is not null or private.student_id(lower(p_email)) is not null;
$$;

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
  actor uuid,          -- 바꾼 관리자(migration이 자동으로 한 일은 null)
  actor_email text,
  target uuid,         -- 바뀐 계정(그 이메일의 계정이 없으면 null)
  target_email text,
  action text not null check (action in ('grant_teacher', 'revoke_teacher', 'grant_admin', 'revoke_admin')),
  note text            -- 자동 처리·이메일로 해제 등 까닭
);
alter table private.role_audit add column if not exists note text;
create index if not exists role_audit_at on private.role_audit (at desc, id desc);
revoke all on private.role_audit from public, anon, authenticated;
alter table private.role_audit enable row level security;

-- ---------------------------------------------------------------------
-- 3. 학생 계정은 교사·관리자 목록에 넣을 수 없다: 이미 있는 학번 형식 행은 지우고(기록), 제약을 바로 검사해서 건다
-- ---------------------------------------------------------------------
alter table private.teachers drop constraint if exists teachers_not_student;
alter table private.admins drop constraint if exists admins_not_student;

do $$
declare n_t integer; n_a integer;
begin
  with d as (delete from private.admins a where private.is_student_email(a.email) returning a.email)
  insert into private.role_audit (actor, actor_email, target, target_email, action, note)
    select null, null, (select u.id from auth.users u where lower(u.email) = d.email order by (u.email_confirmed_at is not null) desc, u.id limit 1), d.email, 'revoke_admin',
           '학생 계정(학번 형식)이라 migration이 자동으로 지움'
    from d;
  get diagnostics n_a = row_count;
  with d as (delete from private.teachers t where private.is_student_email(t.email) returning t.email)
  insert into private.role_audit (actor, actor_email, target, target_email, action, note)
    select null, null, (select u.id from auth.users u where lower(u.email) = d.email order by (u.email_confirmed_at is not null) desc, u.id limit 1), d.email, 'revoke_teacher',
           '학생 계정(학번 형식)이라 migration이 자동으로 지움'
    from d;
  get diagnostics n_t = row_count;
  if n_t + n_a > 0 then
    raise warning '교사 목록에서 %개, 관리자 목록에서 %개의 학생 계정(학번 형식) 이메일을 지웠어요(권한 변경 기록에 남김). 학생 계정은 교사·관리자가 될 수 없어요.', n_t, n_a;
  end if;
end $$;

alter table private.teachers add constraint teachers_not_student check (not private.is_student_email(email));
alter table private.admins add constraint admins_not_student check (not private.is_student_email(email));

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

-- 선생님 = 교사 목록의 이메일 + 이메일 인증 + 같은 이메일의 Google 로그인 + 학번 형식 아님(저장된 이메일·소문자·목록 이메일 모두)
create or replace function private.is_teacher_uid(p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u
    join private.teachers t on t.email = lower(u.email)
    join auth.identities i on i.user_id = u.id and i.provider = 'google' and lower(i.identity_data ->> 'email') = t.email
    where u.id = p_uid and u.email_confirmed_at is not null
      and not private.is_student_email(u.email) and not private.is_student_email(t.email)
  );
$$;

-- 기존 함수(20261007000000_computer_general.sql)를 같은 이름·같은 모양으로 바꾼다: 학번 형식 계정 제외가 더해짐.
-- (예전 RPC cg_class_overview 등이 이 함수를 쓴다. 이 파일의 RPC는 is_teacher_uid를 직접 쓴다)
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

-- 한 계정에 묶인 모든 이메일(소문자): 계정 이메일 + 그 계정의 Google 로그인 이메일들
create or replace function private.user_emails(p_uid uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x.e) filter (where x.e is not null and x.e <> ''), '{}')
  from (
    select lower(u.email) as e from auth.users u where u.id = p_uid
    union all select lower(btrim(u.email)) from auth.users u where u.id = p_uid
    union all select lower(i.identity_data ->> 'email') from auth.identities i where i.user_id = p_uid and i.provider = 'google'
    union all select lower(btrim(i.identity_data ->> 'email')) from auth.identities i where i.user_id = p_uid and i.provider = 'google'
  ) x;
$$;

-- 이 이메일들을 빼고 남는 실제 관리자(권한이 살아 있는 계정)의 이메일 수
drop function if exists private.admins_left(text);
create or replace function private.admins_left(p_except text[]) returns integer
language sql stable security definer set search_path = '' as $$
  select count(distinct a.email)::integer
  from private.admins a join auth.users u on lower(u.email) = a.email
  where not (a.email = any(coalesce(p_except, '{}'::text[]))) and private.is_admin_uid(u.id);
$$;

-- ---------------------------------------------------------------------
-- 5. 처음 적용할 때: 관리자 목록이 비어 있으면 지금의 교사 목록을 복사. 한 번만('admins_bootstrapped')
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from private.role_flags f where f.key = 'admins_bootstrapped') then
    if not exists (select 1 from private.admins) then
      with added as (
        insert into private.admins (email)
          select t.email from private.teachers t where not private.is_student_email(t.email)
          on conflict do nothing
          returning email
      )
      insert into private.role_audit (actor, actor_email, target, target_email, action, note)
        select null, null, (select u.id from auth.users u where lower(u.email) = added.email order by private.is_teacher_uid(u.id) desc, u.id limit 1), added.email, 'grant_admin',
               '처음 적용 때 교사 목록에서 자동 복사'
        from added;
    end if;
    if exists (select 1 from private.admins) then
      insert into private.role_flags (key) values ('admins_bootstrapped') on conflict do nothing;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. RPC (권한 확인은 모두 is_teacher_uid·is_admin_uid(auth.uid()): 20261007을 다시 실행해 is_teacher()가 바뀌어도 영향 없음)
-- ---------------------------------------------------------------------
-- 화면에 권한 변경 버튼을 보일지 판단(권한 자체는 set_teacher·set_admin·revoke_listed_email이 다시 확인)
create or replace function public.am_i_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and private.is_admin_uid(auth.uid());
$$;

-- 선생님: 모든 계정 목록 + 목록에만 있는 이메일(kind 'listed', user_id 없음). 읽기 전용.
-- 순서: 확인 필요 → 등록만 됨 → 관리자 → 교사 → 학생, 그 안에서 학번 → 연도 → 이메일
drop function if exists public.account_list();
create function public.account_list()
returns table (user_id uuid, email text, name text, google boolean, email_verified boolean,
               created_at timestamptz, last_sign_in_at timestamptz, kind text,
               student_year integer, student_no text, has_progress boolean, listed_as text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := private.require_uid(); v_with uuid[] := '{}'; v_part uuid[]; v_t text;
begin
  if not private.is_teacher_uid(v_uid) then
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
      select u.id, u.email::text as em, (u.email_confirmed_at is not null) as verified,
             u.created_at as c_at, u.last_sign_in_at as l_at, private.student_id(u.email) as sid,
             private.has_google(u.id, u.email) as g, private.is_teacher_uid(u.id) as t,
             private.user_emails(u.id) as ems
      from auth.users u
    ), prog as (
      select distinct w.uid from unnest(v_with) as w(uid)
    ), accts as (
      select b.id as uid, b.em, private.display_name(b.id, b.em) as nm, b.g, b.verified as ver, b.c_at, b.l_at,
             case
               when b.t and exists (select 1 from private.admins a where a.email = lower(b.em)) then 'admin'
               when b.t then 'teacher'
               when b.sid is not null and b.verified and b.g then 'student'
               else 'unknown' end as knd,
             case when b.sid is not null then left(b.sid, 4)::integer end as sy,
             case when b.sid is not null then right(b.sid, 5) end as sn,
             (p.uid is not null) as hp,
             case
               when exists (select 1 from private.admins a where a.email = any(b.ems)) then 'admin'
               when exists (select 1 from private.teachers t2 where t2.email = any(b.ems)) then 'teacher' end as la
      from base b left join prog p on p.uid = b.id
    ), listed as (
      select null::uuid as uid, l.email as em, null::text as nm, false as g, false as ver, null::timestamptz as c_at,
             null::timestamptz as l_at, 'listed'::text as knd, null::integer as sy, null::text as sn, false as hp,
             case when exists (select 1 from private.admins a where a.email = l.email) then 'admin' else 'teacher' end as la
      from (select t.email from private.teachers t union select a.email from private.admins a) l
      where not exists (select 1 from auth.users u where lower(u.email) = l.email)
    )
    select z.uid, z.em, z.nm, z.g, z.ver, z.c_at, z.l_at, z.knd, z.sy, z.sn, z.hp, z.la
    from (select * from accts union all select * from listed) z
    order by case z.knd when 'unknown' then 0 when 'listed' then 1 when 'admin' then 2 when 'teacher' then 3 else 4 end,
             z.sn nulls last, z.sy nulls last, lower(z.em) nulls last, z.uid;
end $$;

-- 관리자: 교사 지정(p_on = true)·해제(false). 바뀌었으면 true, 이미 그 상태면 false(기록 없음)
--  지정: 계정이 있고, 이메일 인증, 같은 이메일의 Google 로그인, 학번 형식 아님 → 교사 목록에 이메일(소문자)
--  해제: 그 계정에 묶인 모든 이메일을 교사·관리자 목록에서 지움. 마지막 관리자는 해제할 수 없음(자기 자신 포함)
create or replace function public.set_teacher(p_user uuid, p_on boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_actor text; v_raw text; v_email text; v_verified boolean; v_emails text[]; v_n integer; v_changed boolean := false;
begin
  -- 권한 변경은 한 번에 하나씩: 잠금을 먼저 얻고, 그다음 한 번만 관리자인지 확인(기다리는 동안 해제됐을 수 있음)
  perform pg_advisory_xact_lock(hashtextextended('private.roles', 0));
  if not private.is_admin_uid(v_uid) then
    raise exception '관리자만 권한을 바꿀 수 있어요' using errcode = '42501';
  end if;
  if p_user is null or p_on is null then
    raise exception '계정과 지정·해제를 정해 주세요' using errcode = '22023';
  end if;
  select u.email, lower(u.email), (u.email_confirmed_at is not null) into v_raw, v_email, v_verified from auth.users u where u.id = p_user;
  if not found then
    raise exception '계정을 찾을 수 없어요' using errcode = '22023';
  end if;
  select lower(u.email) into v_actor from auth.users u where u.id = v_uid;

  if p_on then
    if v_email is null or v_email !~ '^[^@ \t\r\n]+@[^@ \t\r\n]+$' then
      raise exception '이메일이 없는 계정은 교사로 지정할 수 없어요' using errcode = '22023';
    end if;
    if private.is_student_email(v_raw) then
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

  v_emails := private.user_emails(p_user);
  if exists (select 1 from private.admins a where a.email = any(v_emails)) and private.admins_left(v_emails) = 0 then
    raise exception '마지막 관리자는 해제할 수 없어요. 다른 관리자를 먼저 지정해 주세요' using errcode = '55000';
  end if;
  with d as (delete from private.admins a where a.email = any(v_emails) returning a.email)
  insert into private.role_audit (actor, actor_email, target, target_email, action) select v_uid, v_actor, p_user, d.email, 'revoke_admin' from d;
  get diagnostics v_n = row_count;
  v_changed := v_n > 0;
  with d as (delete from private.teachers t where t.email = any(v_emails) returning t.email)
  insert into private.role_audit (actor, actor_email, target, target_email, action) select v_uid, v_actor, p_user, d.email, 'revoke_teacher' from d;
  get diagnostics v_n = row_count;
  return v_changed or v_n > 0;
end $$;

-- 관리자: 관리자 지정(p_on = true)·해제(false). 바뀌었으면 true, 이미 그 상태면 false(기록 없음)
--  지정: 이미 교사인 계정만(먼저 교사로 지정), 학번 형식 아님. 해제: 그 계정에 묶인 모든 이메일을 관리자 목록에서 지움(교사 권한은 그대로),
--  마지막 관리자는 해제할 수 없음
create or replace function public.set_admin(p_user uuid, p_on boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_actor text; v_raw text; v_email text; v_emails text[]; v_n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('private.roles', 0));
  if not private.is_admin_uid(v_uid) then
    raise exception '관리자만 권한을 바꿀 수 있어요' using errcode = '42501';
  end if;
  if p_user is null or p_on is null then
    raise exception '계정과 지정·해제를 정해 주세요' using errcode = '22023';
  end if;
  select u.email, lower(u.email) into v_raw, v_email from auth.users u where u.id = p_user;
  if not found then
    raise exception '계정을 찾을 수 없어요' using errcode = '22023';
  end if;
  select lower(u.email) into v_actor from auth.users u where u.id = v_uid;

  if p_on then
    if private.is_student_email(v_raw) then
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

  v_emails := private.user_emails(p_user);
  if not exists (select 1 from private.admins a where a.email = any(v_emails)) then
    return false;
  end if;
  if private.admins_left(v_emails) = 0 then
    raise exception '마지막 관리자는 해제할 수 없어요. 다른 관리자를 먼저 지정해 주세요' using errcode = '55000';
  end if;
  with d as (delete from private.admins a where a.email = any(v_emails) returning a.email)
  insert into private.role_audit (actor, actor_email, target, target_email, action) select v_uid, v_actor, p_user, d.email, 'revoke_admin' from d;
  return true;
end $$;

-- 관리자: 목록의 이메일 하나를 교사·관리자 목록에서 지운다(그 이메일로 로그인한 계정이 없는 '등록만 됨' 항목 정리용).
--  바뀌었으면 true, 목록에 없으면 false. 마지막 관리자는 해제할 수 없음
create or replace function public.revoke_listed_email(p_email text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_actor text; v_email text := lower(btrim(p_email)); v_target uuid; v_n integer; v_changed boolean := false;
  c_note constant text := '목록의 이메일로 해제';
begin
  perform pg_advisory_xact_lock(hashtextextended('private.roles', 0));
  if not private.is_admin_uid(v_uid) then
    raise exception '관리자만 권한을 바꿀 수 있어요' using errcode = '42501';
  end if;
  if v_email is null or v_email = '' then
    raise exception '이메일을 정해 주세요' using errcode = '22023';
  end if;
  if exists (select 1 from private.admins a where a.email = v_email) and private.admins_left(array[v_email]) = 0 then
    raise exception '마지막 관리자는 해제할 수 없어요. 다른 관리자를 먼저 지정해 주세요' using errcode = '55000';
  end if;
  select lower(u.email) into v_actor from auth.users u where u.id = v_uid;
  select u.id into v_target from auth.users u where lower(u.email) = v_email order by private.is_teacher_uid(u.id) desc, u.id limit 1;
  delete from private.admins a where a.email = v_email;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    insert into private.role_audit (actor, actor_email, target, target_email, action, note) values (v_uid, v_actor, v_target, v_email, 'revoke_admin', c_note);
    v_changed := true;
  end if;
  delete from private.teachers t where t.email = v_email;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    insert into private.role_audit (actor, actor_email, target, target_email, action, note) values (v_uid, v_actor, v_target, v_email, 'revoke_teacher', c_note);
    v_changed := true;
  end if;
  return v_changed;
end $$;

-- 선생님: 권한 변경 기록(최근 순, 1~200개)
drop function if exists public.role_audit_list(integer);
create function public.role_audit_list(p_limit integer default 50)
returns table (at timestamptz, actor uuid, actor_email text, actor_name text, target uuid, target_email text, target_name text, action text, note text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := private.require_uid();
begin
  if not private.is_teacher_uid(v_uid) then
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
           r.action, r.note
    from private.role_audit r
    order by r.at desc, r.id desc
    limit p_limit;
end $$;

-- ---------------------------------------------------------------------
-- 7. 실행 권한: RPC는 authenticated만. private 도우미는 클라이언트가 직접 부를 수 없다
-- ---------------------------------------------------------------------
revoke all on function public.am_i_admin(), public.account_list(), public.set_teacher(uuid, boolean),
  public.set_admin(uuid, boolean), public.revoke_listed_email(text), public.role_audit_list(integer) from public, anon;
grant execute on function public.am_i_admin(), public.account_list(), public.set_teacher(uuid, boolean),
  public.set_admin(uuid, boolean), public.revoke_listed_email(text), public.role_audit_list(integer) to authenticated;
revoke all on function private.student_id(text), private.is_student_email(text), private.has_google(uuid, text),
  private.is_teacher_uid(uuid), private.is_teacher(), private.is_admin_uid(uuid), private.is_admin(),
  private.user_emails(uuid), private.admins_left(text[])
  from public, anon, authenticated;
