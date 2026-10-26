-- =====================================================================
-- 실시간 학습 위치(live_status) + 학생이 허락할 때만 하는 화면 공유(screen_share) (2026-10-26)
-- 적용: 20261007000000_computer_general.sql 다음에 SQL Editor에서 실행(여러 번 실행해도 안전).
--       private.is_teacher()·private.display_name()·private.require_uid()를 그대로 쓴다(바꾸지 않음).
-- 원칙
--  * live_status: 학생 한 명 = 한 행. 보낼 때마다 그 행을 덮어쓴다(이력·과거 위치를 남기지 않음).
--    담는 것: 과목·앱 안 경로·단원·단계(활동) 이름·문항 위치·집중 상태·전체화면 여부·지금 단원 잠김 횟수.
--    화면 내용·키 입력·다른 사이트·다른 프로그램 정보는 받지 않는다(형식 검사로 모르는 항목은 거부).
--    학생은 report_live_status RPC로 "자기 행만" 쓴다. 테이블 직접 접근(읽기 포함)은 없다:
--      - updated_at을 서버 시각(now())으로만 정해 시각을 꾸밀 수 없고,
--      - 형식·크기 검사를 한 곳(RPC)에서만 하며,
--      - 학생이 이 행을 읽거나 지울 필요가 없기 때문(계정을 지우면 cascade로 함께 지워짐).
--    선생님(private.is_teacher)만 class_live_status(p_minutes)로 최근 1~240분 안에 갱신된 행을 읽는다.
--  * screen_share: 선생님이 요청 → 학생이 그때마다 허락 → 브라우저끼리 WebRTC로 직접 연결.
--    서버를 거치는 것은 연결 정보(SDP 텍스트)뿐이고 영상은 서버를 거치지 않으며 녹화·저장하지 않는다.
--    SDP에는 양쪽 기기의 네트워크 주소(IP, ICE 후보)가 들어 있다. 끝나거나(ended) 거절되면(declined) 지운다
--    (null, 표 제약으로도 강제). 모든 화면 공유 RPC가 먼저 정리(private.screen_sweep)를 한다:
--    만료된 열린 행은 끝내고 SDP를 지우며, 끝난 지 하루가 지난 행은 지운다.
--    테이블 직접 접근은 없고, 모든 RPC가 호출한 사람이 그 행의 선생님/학생인지 확인한다.
--    만료: 요청(requested)은 2분, 수락(accepted, 화면 고르는 중)·제안(offered)은 마지막 변화 뒤 3분,
--    연결된 공유(answered)는 연결 뒤 1시간이 지나면 끝난 것으로 본다(한 번에 최대 약 1시간, 다시 요청하면 됨).
--  * 여러 기기: 학생 한 명 = 한 행이라 마지막 보고가 이긴다. 다른 기기(state.dev, 기기마다 임의 번호)의
--    '자리 비움(hidden·idle)' 보고는 45초 안에 받은 학습 중 보고를 덮어쓰지 않는다(휴대폰으로 공부 중인데
--    PC의 숨은 탭이 덮어쓰지 않게). 같은 브라우저의 여러 탭은 클라이언트가 앞에 있는 탭 하나만 보낸다.
-- =====================================================================

create schema if not exists private;

-- ---------------------------------------------------------------------
-- 1. 실시간 학습 위치
-- ---------------------------------------------------------------------
create table if not exists public.live_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 4096),
  updated_at timestamptz not null default now()
);
-- 클라이언트 역할은 테이블에 직접 접근하지 못한다(RPC만). RLS도 켜 두고 정책은 두지 않는다(이중 방어)
revoke all on public.live_status from public, anon, authenticated;
alter table public.live_status enable row level security;

-- 학습 위치 형식: 아는 항목만, 항목마다 자료형·길이 제한(전체 4KB 이하)
create or replace function private.live_state_ok(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare r record; t text;
begin
  if p is null or jsonb_typeof(p) <> 'object' or octet_length(p::text) > 4096 or not (p ? 'focus') then
    return false;
  end if;
  for r in select e.key, e.value from jsonb_each(p) e loop
    t := jsonb_typeof(r.value);
    if r.key = 'v' then
      if t <> 'number' then return false; end if;
    elsif r.key = 'focus' then
      if t <> 'string' or (r.value #>> '{}') not in ('learning', 'locked', 'break', 'menu', 'idle', 'hidden') then return false; end if;
    elsif r.key in ('fs', 'sharing') then
      if t <> 'boolean' then return false; end if;
    elsif r.key = 'locks' then
      if t = 'null' then continue; end if;
      if t <> 'number' or (r.value #>> '{}')::numeric not between 0 and 99 then return false; end if;
    elsif r.key in ('path', 'label') then
      if t <> 'string' or char_length(r.value #>> '{}') > (case r.key when 'path' then 200 else 120 end) then return false; end if;
    elsif r.key = 'dev' then
      if t <> 'string' or (r.value #>> '{}') !~ '^[a-z0-9]{1,16}$' then return false; end if;
    elsif r.key in ('subject', 'unit', 'step', 'detail') then
      if t = 'null' then continue; end if;
      if t <> 'string' or char_length(r.value #>> '{}') > (case r.key when 'subject' then 16 when 'unit' then 32 when 'step' then 64 else 80 end) then return false; end if;
    else
      return false; -- 모르는 항목(화면 내용 등)은 받지 않는다
    end if;
  end loop;
  return true;
end $$;

-- 학생: 자기 학습 위치를 보낸다(행 하나를 덮어씀, 시각은 서버가 정함)
create or replace function public.report_live_status(p_state jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid();
begin
  if not private.live_state_ok(p_state) then
    raise exception '학습 위치 형식이 올바르지 않아요' using errcode = '22023';
  end if;
  insert into public.live_status as l (user_id, state, updated_at) values (v_uid, p_state, now())
    on conflict on constraint live_status_pkey do update set state = excluded.state, updated_at = now()
    -- 다른 기기의 '자리 비움' 보고는 45초 안의 학습 중(자리 비움이 아닌) 보고를 덮어쓰지 않는다
    where not (
      excluded.state ->> 'focus' in ('hidden', 'idle')
      and coalesce(l.state ->> 'focus', '') not in ('hidden', 'idle')
      and coalesce(l.state ->> 'dev', '') <> coalesce(excluded.state ->> 'dev', '')
      and l.updated_at > now() - interval '45 seconds'
    );
end $$;

-- 선생님: 최근 p_minutes분(1~240) 안에 갱신된 학생들의 학습 위치(읽기 전용)
create or replace function public.class_live_status(p_minutes integer default 10)
returns table (user_id uuid, name text, email text, state jsonb, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_uid();
  if not private.is_teacher() then
    raise exception '선생님 계정만 볼 수 있어요' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 240 then
    raise exception '조회 범위는 1~240분이에요' using errcode = '22023';
  end if;
  return query
    select l.user_id, private.display_name(l.user_id, u.email), u.email::text, l.state, l.updated_at
    from public.live_status l join auth.users u on u.id = l.user_id
    where l.updated_at >= now() - make_interval(mins => p_minutes)
    order by l.updated_at desc;
end $$;

-- ---------------------------------------------------------------------
-- 2. 화면 공유(학생이 허락할 때만). 연결 정보(SDP)만 잠시 거쳐 가고, 끝나면 지운다
-- ---------------------------------------------------------------------
create table if not exists public.screen_share (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'requested' check (status in ('requested', 'accepted', 'offered', 'answered', 'declined', 'ended')),
  offer text check (offer is null or octet_length(offer) <= 32768),
  answer text check (answer is null or octet_length(answer) <= 32768),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint screen_share_parties check (teacher_id <> student_id),
  -- 끝난(거절·종료) 공유에는 연결 정보가 남지 않는다
  constraint screen_share_cleared check (status in ('requested', 'accepted', 'offered', 'answered') or (offer is null and answer is null))
);
-- 학생 한 명에게 열린 공유는 하나만(동시 요청도 DB가 막음)
create unique index if not exists screen_share_one_open on public.screen_share (student_id)
  where status in ('requested', 'accepted', 'offered', 'answered');
create index if not exists screen_share_teacher on public.screen_share (teacher_id);
-- 정리(screen_sweep)용: 열린 행·끝난 행을 마지막 변화 시각으로 찾는다
create index if not exists screen_share_open_at on public.screen_share (updated_at)
  where status in ('requested', 'accepted', 'offered', 'answered');
create index if not exists screen_share_closed_at on public.screen_share (updated_at)
  where status in ('declined', 'ended');
revoke all on public.screen_share from public, anon, authenticated;
alter table public.screen_share enable row level security;

-- 아직 유효한 열린 공유인지: 요청 2분, 수락(화면 고르는 중)·제안 3분, 연결된 공유는 연결 뒤 1시간
create or replace function private.screen_live(p_status text, p_created timestamptz, p_updated timestamptz) returns boolean
language sql stable set search_path = '' as $$
  select case
    when p_status = 'requested' then p_created >= now() - interval '2 minutes'
    when p_status in ('accepted', 'offered') then p_updated >= now() - interval '3 minutes'
    when p_status = 'answered' then p_updated >= now() - interval '1 hour'
    else false
  end;
$$;

-- 연결 정보(SDP): 텍스트, 'v=0'으로 시작, 32KB 이하
create or replace function private.sdp_ok(p text) returns boolean
language sql immutable set search_path = '' as $$
  select p is not null and octet_length(p) between 10 and 32768 and p like 'v=0%';
$$;

-- 행 끝내기(연결 정보 지움). 거절된 행은 거절 상태를 그대로 둔다
create or replace function private.screen_close(p_id uuid) returns public.screen_share
language sql set search_path = '' as $$
  update public.screen_share s
     set status = case when s.status = 'declined' then 'declined' else 'ended' end, offer = null, answer = null, updated_at = now()
   where s.id = p_id
  returning s.*;
$$;

-- 정리: 만료된 열린 행은 끝내고 연결 정보(SDP)를 지우며, 끝난 지 하루가 지난 행은 지운다.
-- 모든 화면 공유 RPC가 먼저 부른다(가장 짧은 만료가 2분이라 updated_at 2분 전보다 오래된 열린 행만 살펴봄, 인덱스 사용)
create or replace function private.screen_sweep() returns void
language sql set search_path = '' as $$
  update public.screen_share s set status = 'ended', offer = null, answer = null, updated_at = now()
   where s.status in ('requested', 'accepted', 'offered', 'answered')
     and s.updated_at < now() - interval '2 minutes'
     and not private.screen_live(s.status, s.created_at, s.updated_at);
  delete from public.screen_share s
   where s.status in ('declined', 'ended') and s.updated_at < now() - interval '1 day';
$$;

-- 선생님: 학생에게 화면 보기 요청. 같은 학생에게 내가 열어 둔 요청·만료된 요청은 끝내고 새로 연다
create or replace function public.request_screen(p_student uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := private.require_uid(); v_id uuid;
begin
  if not private.is_teacher() then
    raise exception '선생님 계정만 요청할 수 있어요' using errcode = '42501';
  end if;
  if p_student is null or p_student = v_uid or not exists (select 1 from auth.users u where u.id = p_student) then
    raise exception '학생을 찾을 수 없어요' using errcode = '22023';
  end if;
  perform private.screen_sweep();
  update public.screen_share s set status = 'ended', offer = null, answer = null, updated_at = now()
   where s.student_id = p_student and s.status in ('requested', 'accepted', 'offered', 'answered')
     and (s.teacher_id = v_uid or not private.screen_live(s.status, s.created_at, s.updated_at));
  if exists (select 1 from public.screen_share s where s.student_id = p_student and s.status in ('requested', 'accepted', 'offered', 'answered')) then
    raise exception '다른 선생님이 이 학생과 화면 공유 중이에요' using errcode = '55000';
  end if;
  begin
    insert into public.screen_share (teacher_id, student_id) values (v_uid, p_student) returning id into v_id;
  exception when unique_violation then
    -- 같은 학생에게 동시에 들어온 다른 요청이 먼저 열렸다(학생 한 명에게 열린 공유는 하나)
    raise exception '다른 요청이 동시에 처리되고 있어요. 잠시 뒤 다시 시도해 주세요' using errcode = '55000';
  end;
  return v_id;
end $$;

-- 선생님: 내 요청의 상태와 학생의 연결 제안(offer)
create or replace function public.get_screen(p_id uuid) returns table (status text, offer text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := private.require_uid(); r public.screen_share%rowtype;
begin
  perform private.screen_sweep();
  select * into r from public.screen_share s where s.id = p_id and s.teacher_id = v_uid for update;
  if not found or not private.is_teacher() then
    raise exception '화면 공유 요청을 찾을 수 없어요' using errcode = '42501';
  end if;
  if r.status in ('requested', 'accepted', 'offered', 'answered') and not private.screen_live(r.status, r.created_at, r.updated_at) then
    r := private.screen_close(r.id);
  end if;
  return query select r.status, case when r.status = 'offered' then r.offer end;
end $$;

-- 선생님: 학생의 제안에 응답(answer)
create or replace function public.answer_screen(p_id uuid, p_sdp text) returns text
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := private.require_uid(); r public.screen_share%rowtype;
begin
  perform private.screen_sweep();
  select * into r from public.screen_share s where s.id = p_id and s.teacher_id = v_uid for update;
  if not found or not private.is_teacher() then
    raise exception '화면 공유 요청을 찾을 수 없어요' using errcode = '42501';
  end if;
  if not private.sdp_ok(p_sdp) then
    raise exception '연결 정보 형식이 올바르지 않아요(32KB 이하)' using errcode = '22023';
  end if;
  if r.status in ('declined', 'ended') or not private.screen_live(r.status, r.created_at, r.updated_at) then
    r := private.screen_close(r.id);
    return r.status;
  end if;
  if r.status <> 'offered' then
    raise exception '지금은 응답할 수 없어요(%)', r.status using errcode = '55000';
  end if;
  update public.screen_share s set answer = p_sdp, status = 'answered', updated_at = now() where s.id = r.id;
  return 'answered';
end $$;

-- 학생: 나에게 온 최근 요청(2분 안, 응답 전) 하나와 요청한 선생님 이름
create or replace function public.my_screen_request() returns table (id uuid, teacher_name text)
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid();
begin
  perform private.screen_sweep();
  return query
    select s.id, private.display_name(s.teacher_id, u.email)
    from public.screen_share s join auth.users u on u.id = s.teacher_id
    where s.student_id = v_uid and s.status = 'requested' and s.created_at >= now() - interval '2 minutes'
    order by s.created_at desc
    limit 1;
end $$;

-- 학생: 허락(accepted) 또는 거절(declined). 만료된 요청이면 끝내고 'ended'
create or replace function public.respond_screen(p_id uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := private.require_uid(); r public.screen_share%rowtype;
begin
  perform private.screen_sweep();
  select * into r from public.screen_share s where s.id = p_id and s.student_id = v_uid for update;
  if not found then
    raise exception '화면 공유 요청을 찾을 수 없어요' using errcode = '42501';
  end if;
  if r.status in ('declined', 'ended') or not private.screen_live(r.status, r.created_at, r.updated_at) then
    r := private.screen_close(r.id);
    return r.status;
  end if;
  if r.status <> 'requested' then
    raise exception '이미 응답한 요청이에요' using errcode = '55000';
  end if;
  if coalesce(p_accept, false) then
    update public.screen_share s set status = 'accepted', updated_at = now() where s.id = r.id;
    return 'accepted';
  end if;
  update public.screen_share s set status = 'declined', offer = null, answer = null, updated_at = now() where s.id = r.id;
  return 'declined';
end $$;

-- 학생: 허락한 뒤 연결 제안(offer)을 올린다
create or replace function public.offer_screen(p_id uuid, p_sdp text) returns text
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := private.require_uid(); r public.screen_share%rowtype;
begin
  perform private.screen_sweep();
  select * into r from public.screen_share s where s.id = p_id and s.student_id = v_uid for update;
  if not found then
    raise exception '화면 공유 요청을 찾을 수 없어요' using errcode = '42501';
  end if;
  if not private.sdp_ok(p_sdp) then
    raise exception '연결 정보 형식이 올바르지 않아요(32KB 이하)' using errcode = '22023';
  end if;
  if r.status in ('declined', 'ended') or not private.screen_live(r.status, r.created_at, r.updated_at) then
    r := private.screen_close(r.id);
    return r.status;
  end if;
  if r.status <> 'accepted' then
    raise exception '지금은 연결을 제안할 수 없어요(%)', r.status using errcode = '55000';
  end if;
  update public.screen_share s set offer = p_sdp, status = 'offered', updated_at = now() where s.id = r.id;
  return 'offered';
end $$;

-- 학생: 선생님의 응답(answer)과 상태(선생님이 끝냈는지)
create or replace function public.get_screen_answer(p_id uuid) returns table (status text, answer text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := private.require_uid(); r public.screen_share%rowtype;
begin
  perform private.screen_sweep();
  select * into r from public.screen_share s where s.id = p_id and s.student_id = v_uid for update;
  if not found then
    raise exception '화면 공유 요청을 찾을 수 없어요' using errcode = '42501';
  end if;
  if r.status in ('requested', 'accepted', 'offered', 'answered') and not private.screen_live(r.status, r.created_at, r.updated_at) then
    r := private.screen_close(r.id);
  end if;
  return query select r.status, case when r.status = 'answered' then r.answer end;
end $$;

-- 선생님·학생 누구나(그 행의 당사자만): 공유 끝내기. 연결 정보를 지운다. 여러 번 불러도 안전
create or replace function public.end_screen(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid();
begin
  perform private.screen_sweep();
  if not exists (select 1 from public.screen_share s where s.id = p_id and (s.teacher_id = v_uid or s.student_id = v_uid)) then
    raise exception '화면 공유 요청을 찾을 수 없어요' using errcode = '42501';
  end if;
  perform private.screen_close(p_id);
end $$;

-- ---------------------------------------------------------------------
-- 3. 실행 권한: authenticated만. private 도우미는 클라이언트가 직접 부를 수 없다
-- ---------------------------------------------------------------------
revoke all on function public.report_live_status(jsonb), public.class_live_status(integer),
  public.request_screen(uuid), public.get_screen(uuid), public.answer_screen(uuid, text),
  public.my_screen_request(), public.respond_screen(uuid, boolean), public.offer_screen(uuid, text),
  public.get_screen_answer(uuid), public.end_screen(uuid) from public, anon;
grant execute on function public.report_live_status(jsonb), public.class_live_status(integer),
  public.request_screen(uuid), public.get_screen(uuid), public.answer_screen(uuid, text),
  public.my_screen_request(), public.respond_screen(uuid, boolean), public.offer_screen(uuid, text),
  public.get_screen_answer(uuid), public.end_screen(uuid) to authenticated;
revoke all on function private.live_state_ok(jsonb), private.screen_live(text, timestamptz, timestamptz),
  private.sdp_ok(text), private.screen_close(uuid), private.screen_sweep() from public, anon, authenticated;
