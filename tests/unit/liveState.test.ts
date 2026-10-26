import { describe, expect, it } from 'vitest';
import {
  agoText, buildLiveState, chipOf, cleanPath, deriveFocus, deriveLocation, normalizeLiveState, OFFLINE_AFTER_MS, sortLive, SUBJECT_LIST, toLiveStudents, type LiveState,
} from '../../src/features/monitor/liveState';
import { isMissingFunction, rpcErrorText } from '../../src/features/monitor/api';
import type { FocusSnapshot } from '../../src/features/focus/focusSignal';

const strict = (status: FocusSnapshot['status'], reason: FocusSnapshot['reason'], locks = 2): FocusSnapshot => ({ status, reason, strict: { key: 'cg:U3', label: '3단원', locks, limit: 5 } });
const on = { visible: true, hasFocus: true, idle: false };

describe('학습 위치: 경로 → 과목·단원·단계 이름', () => {
  it('단원 × 5단계 과목', () => {
    expect(deriveLocation('/computer/unit/U3/3')).toEqual({ subject: 'cg', unit: 'U3', step: '3', label: '3단원 · 3단계 기초 객관식', activity: true });
    expect(deriveLocation('/network/unit/U1')).toMatchObject({ subject: 'net', unit: 'U1', step: null, label: '1단원 · 단원 보기' });
    expect(deriveLocation('/binary/unit/U2/5')).toMatchObject({ subject: 'bin', label: '2단원 · 5단계 실력점검' });
    expect(deriveLocation('/ip/mock/set1')).toMatchObject({ subject: 'ip', step: 'mock:set1', label: '모의고사 1회', activity: true });
    expect(deriveLocation('/data/mock')).toMatchObject({ subject: 'data', label: '모의고사 목록', activity: false });
    expect(deriveLocation('/programming/wrong')).toMatchObject({ subject: 'prog', label: '오답노트' });
    expect(deriveLocation('/programming')).toMatchObject({ subject: 'prog', label: '단원 목록' });
  });
  it('데이터베이스', () => {
    expect(deriveLocation('/learn/U03/U03-A02')).toEqual({ subject: 'db', unit: 'U03', step: 'activity:U03-A02', label: '3단원 · 활동 2', activity: true });
    expect(deriveLocation('/learn/U12/checkpoint')).toMatchObject({ unit: 'U12', step: 'checkpoint', label: '12단원 · 체크포인트' });
    expect(deriveLocation('/learn/U01/stage/2')).toMatchObject({ step: 'stage:2', label: '1단원 · 2단계 개념 점검 문제' });
    expect(deriveLocation('/challenge/CH-U05')).toMatchObject({ unit: 'U05', step: 'challenge', label: '5단원 · 도전' });
    expect(deriveLocation('/garden')).toMatchObject({ subject: 'db', label: '나의 정원', activity: false });
    expect(deriveLocation('/final')).toMatchObject({ subject: 'db', label: '최종 진단', activity: true });
  });
  it('그 밖의 화면, 이상한 문자는 버림', () => {
    expect(deriveLocation('/')).toMatchObject({ subject: null, label: '과목 선택' });
    expect(deriveLocation('/teacher')).toMatchObject({ subject: null, label: '선생님 화면' });
    expect(cleanPath('/computer/unit/U1?x=<script>#a')).toBe('/computer/unit/U1');
    expect(cleanPath('/a b<>"c')).toBe('/abc');
    expect(cleanPath('/'.repeat(300)).length).toBe(200);
  });
  it('과목 목록: 데이터베이스·컴퓨터 일반 + defs.ts의 모든 과목(보충 학습 포함)', () => {
    expect(SUBJECT_LIST.map((s) => s.id)).toEqual(['db', 'cg', 'net', 'prog', 'data', 'bin', 'ip']);
    expect(SUBJECT_LIST.map((s) => s.name)).toEqual(['데이터베이스', '컴퓨터 일반', '네트워크', '프로그래밍', 'Data', '2진법 이해', 'IP 이해']);
  });
});

describe('집중 상태 판정', () => {
  it('단원 집중 학습: 학습 중·잠김·쉬기·시작 전·화면 공유 창', () => {
    expect(deriveFocus({ ...on, session: strict('active', null), activity: true })).toBe('learning');
    for (const r of ['blur', 'hidden', 'fullscreen', 'pagehide'] as const) {
      expect(deriveFocus({ ...on, session: strict('paused', r), activity: true })).toBe('locked');
      expect(deriveFocus({ ...on, session: strict('readyToResume', r), activity: true })).toBe('locked');
    }
    for (const r of ['manual', 'gate', 'start', 'reload', 'system'] as const) expect(deriveFocus({ ...on, session: strict('paused', r), activity: true })).toBe('break');
  });
  it('숨긴 탭은 언제나 hidden, 2분 입력 없음은 idle', () => {
    expect(deriveFocus({ visible: false, hasFocus: false, idle: false, session: strict('active', null), activity: true })).toBe('hidden');
    expect(deriveFocus({ ...on, idle: true, session: strict('active', null), activity: true })).toBe('idle');
    expect(deriveFocus({ ...on, idle: true, session: null, activity: false })).toBe('idle');
  });
  it('세션 밖: 메뉴, 모의고사 같은 활동 화면은 learning, 다른 창을 보면 hidden', () => {
    expect(deriveFocus({ ...on, session: null, activity: false })).toBe('menu');
    expect(deriveFocus({ ...on, session: null, activity: true })).toBe('learning');
    expect(deriveFocus({ visible: true, hasFocus: false, idle: false, session: null, activity: true })).toBe('hidden');
  });
  it('보내는 상태: 화면 내용 없이 위치·문항·잠김 횟수만', () => {
    const s = buildLiveState({ path: '/computer/unit/U3/3', detail: '문항 7/20', fs: true, sharing: false, ...on, session: strict('active', null, 3) });
    expect(s).toEqual({
      v: 1, subject: 'cg', path: '/computer/unit/U3/3', unit: 'U3', step: '3', label: '3단원 · 3단계 기초 객관식', detail: '문항 7/20',
      focus: 'learning', fs: true, locks: 3, sharing: false,
    });
    expect(Object.keys(s).sort()).toEqual(['detail', 'focus', 'fs', 'label', 'locks', 'path', 'sharing', 'step', 'subject', 'unit', 'v']);
    expect(JSON.stringify(s).length).toBeLessThan(4096);
    const m = buildLiveState({ path: '/', detail: null, fs: false, sharing: true, ...on, session: null });
    expect(m).toMatchObject({ subject: null, focus: 'menu', locks: null, sharing: true, label: '과목 선택' });
    expect(buildLiveState({ path: '/x', detail: 'x'.repeat(200), fs: false, sharing: false, ...on, session: null }).detail).toHaveLength(80);
  });
});

describe('선생님 화면 상태 표시', () => {
  const now = Date.parse('2026-10-26T10:00:00Z');
  const ago = (s: number) => new Date(now - s * 1000).toISOString();
  const st = (focus: LiveState['focus']) => normalizeLiveState({ focus, subject: 'cg', label: 'x' });
  it('2분 넘게 소식이 없으면 오프라인, idle·hidden은 자리 비움', () => {
    expect(chipOf(st('learning'), ago(10), now)).toBe('learning');
    expect(chipOf(st('learning'), ago(OFFLINE_AFTER_MS / 1000 + 1), now)).toBe('offline');
    expect(chipOf(st('idle'), ago(10), now)).toBe('away');
    expect(chipOf(st('hidden'), ago(10), now)).toBe('away');
    expect(chipOf(st('locked'), ago(10), now)).toBe('locked');
    expect(chipOf(st('learning'), 'garbage', now)).toBe('offline');
  });
  it('N초 전', () => {
    expect(agoText(ago(2), now)).toBe('방금');
    expect(agoText(ago(42), now)).toBe('42초 전');
    expect(agoText(ago(125), now)).toBe('2분 전');
    expect(agoText(ago(7300), now)).toBe('2시간 전');
  });
  it('서버 상태를 안전하게 읽고, 상태순 정렬(잠김·자리 비움 먼저)', () => {
    expect(normalizeLiveState({ focus: 'weird', subject: 'zzz', locks: 'x', label: 5 })).toMatchObject({ focus: 'menu', subject: null, locks: null, label: '' });
    const list = toLiveStudents([
      { user_id: '1', name: '가온', email: 'a@x', state: { focus: 'learning' }, updated_at: ago(5) },
      { user_id: '2', name: null, email: 'nare@x', state: { focus: 'locked' }, updated_at: ago(5) },
      { user_id: '3', name: '다온', email: 'c@x', state: { focus: 'learning' }, updated_at: ago(500) },
      { user_id: '4', name: '라온', email: 'd@x', state: { focus: 'idle' }, updated_at: ago(30) },
    ], now);
    expect(list.map((s) => [s.name, s.chip])).toEqual([['가온', 'learning'], ['nare', 'locked'], ['다온', 'offline'], ['라온', 'away']]);
    expect(sortLive(list, 'status').map((s) => s.id)).toEqual(['2', '4', '1', '3']);
    expect(sortLive(list, 'name').map((s) => s.name)).toEqual(['가온', '다온', '라온', 'nare']);
    expect(sortLive(list, 'recent').map((s) => s.id).slice(0, 2)).toEqual(['1', '2']);
  });
  it('migration 미적용 오류는 분명하게 안내', () => {
    const missing = { code: 'PGRST202', message: 'Could not find the function public.class_live_status(p_minutes) in the schema cache' };
    expect(isMissingFunction(missing)).toBe(true);
    expect(rpcErrorText('class_live_status', missing)).toContain('20261026010000_monitoring.sql');
    expect(rpcErrorText('course_class_overview', { code: '22023', message: '알 수 없는 과목입니다' })).toContain('20261026000000_courses.sql');
    expect(rpcErrorText('cg_class_overview', { code: '42501', message: 'x' })).toBe('선생님 계정만 볼 수 있어요.');
    expect(isMissingFunction({ code: '42501', message: '선생님 계정만 볼 수 있어요' })).toBe(false);
  });
});
