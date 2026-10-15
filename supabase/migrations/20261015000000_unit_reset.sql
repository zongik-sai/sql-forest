-- =====================================================================
-- 데이터베이스 과목: 단원 집중 학습 초기화(선생님 결정 2026-10-15)
-- 한 단원에서 5번 잠기면 그 단원의 진도·점수를 지운다. 학생 본인 기록만, 그 단원만.
--   지우는 것: 그 단원 활동 4개·체크포인트 3개·단원 완료 경험치, 단원 배지, 활동 진도(도전 과제 포함),
--             단원 진도 요약, 도전 과제 기록
--   남기는 것: 다른 단원, 진단(사전·최종), 과정 마무리 보상, 학습 시간, 오답 기록
-- 인자
--   p_at   : 클라이언트가 기록한 초기화 시각(학습 상태의 unitResets 표시와 같은 값, 표시용으로만 쓰고 삭제 기준으로 쓰지 않음)
--   p_n    : 누적 초기화 횟수(표시용)
--   p_keep : 지우지 말 항목(초기화 뒤 새로 한 공부). 바로 보낼 때는 빈 배열.
--            늦게 다시 보낼 때는 클라이언트의 현재 학습 상태 기준: 보상 ID('activity:U01-A01'·'checkpoint:…'·'unit:U01'),
--            배지('badge:unit-U01'), 활동 ID('U01-A01'·'CH-U01'), 도전 기록('mastery:CH-U01').
--            기기 시계와 서버 시계가 달라도 초기화 뒤 공부를 지우지 않게 시각 대신 목록으로 정한다.
-- 학습 상태 스냅샷(learner_state)이 이 초기화를 아직 모르면(표시가 없거나 더 이르면) 그 단원 기록을 빼고 표시를 남긴다.
-- 이미 아는 스냅샷은 건드리지 않는다(초기화 뒤 새로 한 공부가 들어 있을 수 있음).
-- 원장(xp_events)은 학생이 직접 지울 수 없으므로 SECURITY DEFINER로 본인 행만 지운다. 다시 적용해도 안전(멱등).
-- =====================================================================

drop function if exists public.reset_db_unit(text);
drop function if exists public.reset_db_unit(text, timestamptz);
drop function if exists public.reset_db_unit(text, text, integer, boolean);

create or replace function public.reset_db_unit(p_unit_id text, p_at text, p_n integer default 1, p_keep text[] default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_keep text[] := coalesce(p_keep, '{}');
  v_state jsonb;
  v_prev text;
begin
  if p_unit_id is null or p_unit_id !~ '^U(0[1-9]|1[0-2])$' then
    raise exception '알 수 없는 단원입니다' using errcode = '22023';
  end if;
  if p_at is null or p_at !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?Z$' then
    raise exception '초기화 시각 형식이 올바르지 않습니다' using errcode = '22023';
  end if;
  perform p_at::timestamptz; -- 형식 확인
  if cardinality(v_keep) > 40 then
    raise exception '항목이 너무 많습니다' using errcode = '22023';
  end if;
  -- 같은 사용자의 보상 지급과 겹치지 않게 직렬화(award_xp와 같은 잠금)
  perform pg_advisory_xact_lock(hashtextextended('award:' || v_uid::text, 0));
  delete from public.xp_events
   where user_id = v_uid and reward_id <> all(v_keep)
     and (reward_id like 'activity:' || p_unit_id || '-A%'
       or reward_id like 'checkpoint:' || p_unit_id || '-Q%'
       or reward_id = 'unit:' || p_unit_id);
  delete from public.badge_awards where user_id = v_uid and badge_id = 'badge:unit-' || p_unit_id and badge_id <> all(v_keep);
  delete from public.activity_progress
   where user_id = v_uid and activity_id <> all(v_keep) and (activity_id like p_unit_id || '-A%' or activity_id = 'CH-' || p_unit_id);
  delete from public.unit_progress where user_id = v_uid and unit_id = p_unit_id and not ('unit:' || p_unit_id = any(v_keep));
  delete from public.mastery_progress where user_id = v_uid and challenge_id = 'CH-' || p_unit_id and not ('mastery:CH-' || p_unit_id = any(v_keep));

  -- 학습 상태 스냅샷이 이 초기화를 모르면: 그 단원 기록을 빼고 표시를 남긴다
  select state into v_state from public.learner_state where user_id = v_uid for update;
  if v_state is null or jsonb_typeof(v_state) <> 'object' then
    return;
  end if;
  v_prev := case when jsonb_typeof(v_state->'unitResets') = 'object' and jsonb_typeof(v_state->'unitResets'->p_unit_id) = 'object'
                 then v_state->'unitResets'->p_unit_id->>'at' end;
  if v_prev is not null and v_prev >= p_at then
    return;
  end if;
  if jsonb_typeof(v_state->'activities') = 'object' then
    v_state := jsonb_set(v_state, '{activities}', coalesce((
      select jsonb_object_agg(e.key, e.value) from jsonb_each(v_state->'activities') e
       where not (e.key like p_unit_id || '-%' or e.key = 'CH-' || p_unit_id)), '{}'::jsonb));
  end if;
  if jsonb_typeof(v_state->'questions') = 'object' then
    v_state := jsonb_set(v_state, '{questions}', coalesce((
      select jsonb_object_agg(e.key, e.value) from jsonb_each(v_state->'questions') e
       where e.key not like p_unit_id || '-%'), '{}'::jsonb));
  end if;
  if jsonb_typeof(v_state->'challenges') = 'object' then
    v_state := jsonb_set(v_state, '{challenges}', (v_state->'challenges') - ('CH-' || p_unit_id));
  end if;
  if jsonb_typeof(v_state->'celebratedUnits') = 'array' then
    v_state := jsonb_set(v_state, '{celebratedUnits}', coalesce((
      select jsonb_agg(x) from jsonb_array_elements(v_state->'celebratedUnits') x where x <> to_jsonb(p_unit_id)), '[]'::jsonb));
  end if;
  if jsonb_typeof(v_state->'unitLocks') = 'object' then
    v_state := jsonb_set(v_state, '{unitLocks}', (v_state->'unitLocks') - p_unit_id);
  end if;
  if jsonb_typeof(v_state->'unitResets') <> 'object' or v_state->'unitResets' is null then
    v_state := jsonb_set(v_state, '{unitResets}', '{}'::jsonb);
  end if;
  v_state := jsonb_set(v_state, array['unitResets', p_unit_id], jsonb_build_object('at', p_at, 'n', greatest(coalesce(p_n, 1), 1)));
  update public.learner_state set state = v_state, updated_at = now() where user_id = v_uid;
end $$;

revoke all on function public.reset_db_unit(text, text, integer, text[]) from public, anon;
grant execute on function public.reset_db_unit(text, text, integer, text[]) to authenticated;
