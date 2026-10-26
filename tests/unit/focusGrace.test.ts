import { afterEach, describe, expect, it, vi } from 'vitest';
import { afterSystemDialog, classifyLeave, focusReducer, initialFocus, type FocusState } from '../../src/features/focus/focusMachine';
import { allowSystemDialog, onSystemDialogEnd, SYSTEM_DIALOG_TAIL_MS, systemDialogActive } from '../../src/features/focus/systemDialog';

/**
 * 화면 공유 유예(docs/09_FOCUS_MODE.md): 학생이 선생님 요청에 '화면 공유하기'를 눌러 브라우저 선택 창이 열린 동안의
 * 포커스 잃음·전체화면 나감·숨김은 잠김으로 세지 않는다. 끝난 뒤 이 창에 돌아와 있지 않으면 세지 않고 멈춘다.
 * 공유가 시작된 뒤에는 보통 규칙(떠나면 잠김)이 다시 적용된다.
 */
const on = { visible: true, hasFocus: true };
const base = { strict: true, status: 'active' as const, systemDialog: false, fsGrace: false, counted: false };

describe('이탈 처리 결정(classifyLeave)', () => {
  it('보통: 단원 집중 학습 중 첫 이탈은 잠김 1회, 같은 이탈의 다음 이벤트는 세지 않음', () => {
    for (const ev of ['blur', 'hidden', 'fullscreen', 'pagehide'] as const) expect(classifyLeave(ev, base)).toBe('lock');
    expect(classifyLeave('hidden', { ...base, counted: true })).toBe('pause');
    expect(classifyLeave('blur', { ...base, status: 'paused' })).toBe('pause');
    expect(classifyLeave('blur', { ...base, strict: false })).toBe('pause');
  });
  it('화면 공유 선택 창이 열린 동안: blur·hidden·전체화면 나감은 세지 않고 미룬다(창 닫기 pagehide는 그대로)', () => {
    const g = { ...base, systemDialog: true };
    expect(classifyLeave('blur', g)).toBe('defer');
    expect(classifyLeave('hidden', g)).toBe('defer');
    expect(classifyLeave('fullscreen', g)).toBe('defer');
    expect(classifyLeave('pagehide', g)).toBe('lock');
    // 단원 밖 학습(가림만 하는 화면)도 선택 창 때문에 멈추지 않는다
    expect(classifyLeave('blur', { ...g, strict: false })).toBe('defer');
  });
  it('전체화면 전환 유예는 blur·전체화면 흔들림만 미룬다(숨김은 바로 셈)', () => {
    const g = { ...base, fsGrace: true };
    expect(classifyLeave('blur', g)).toBe('defer');
    expect(classifyLeave('fullscreen', g)).toBe('defer');
    expect(classifyLeave('hidden', g)).toBe('lock');
  });
  it('선택 창이 닫힌 뒤: 돌아와 있으면 계속, 아니면 세지 않고 멈춤', () => {
    expect(afterSystemDialog({ visible: true, hasFocus: true, fullscreenOk: true })).toBe('continue');
    expect(afterSystemDialog({ visible: true, hasFocus: false, fullscreenOk: true })).toBe('pause');
    expect(afterSystemDialog({ visible: true, hasFocus: true, fullscreenOk: false })).toBe('pause');
    expect(afterSystemDialog({ visible: false, hasFocus: false, fullscreenOk: true })).toBe('pause');
  });
});

describe('세지 않는 멈춤(systemPause)', () => {
  it('active → paused(system), 다시 시작으로 active. 멈춘 동안의 이탈은 잠김 화면으로 바뀌지 않음', () => {
    let s: FocusState = focusReducer(initialFocus, { type: 'start', env: on });
    s = focusReducer(s, { type: 'systemPause' });
    expect(s).toMatchObject({ status: 'paused', reason: 'system' });
    s = focusReducer(s, { type: 'focus', env: on });
    expect(s.status).toBe('readyToResume');
    s = focusReducer(s, { type: 'blur' }); // 준비 상태에서 다시 떠나도 '잠김' 사유로 바뀌지 않음(세지 않음)
    expect(s).toMatchObject({ status: 'paused', reason: 'system' });
    s = focusReducer(s, { type: 'resume', env: on });
    expect(s).toMatchObject({ status: 'active', reason: null });
    // 이미 멈춘 상태에서는 아무 일도 없음
    expect(focusReducer({ status: 'paused', reason: 'blur', pauses: 1 }, { type: 'systemPause' })).toEqual({ status: 'paused', reason: 'blur', pauses: 1 });
  });
  it('공유가 시작된 뒤에는 보통 규칙: 다른 창으로 가면 잠김 1회', () => {
    expect(classifyLeave('blur', { ...base, systemDialog: false })).toBe('lock');
  });
});

describe('유예 시간(allowSystemDialog)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it('끝내면 잠시(선택 창이 닫힌 뒤 돌아오는 focus를 기다림) 뒤 다시 확인을 알린다', () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    const off = onSystemDialogEnd(() => seen.push(Date.now()));
    expect(systemDialogActive()).toBe(false);
    const end = allowSystemDialog(60_000);
    expect(systemDialogActive()).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(systemDialogActive()).toBe(true);
    end();
    end(); // 여러 번 불러도 한 번만
    expect(systemDialogActive()).toBe(true); // 꼬리 시간 동안은 아직 유예
    vi.advanceTimersByTime(SYSTEM_DIALOG_TAIL_MS + 20);
    expect(systemDialogActive()).toBe(false);
    expect(seen).toHaveLength(1);
    off();
  });
  it('끝내지 않아도 정한 시간(최대 2분)이 지나면 저절로 끝난다', () => {
    vi.useFakeTimers();
    let n = 0;
    const off = onSystemDialogEnd(() => n++);
    allowSystemDialog(10 * 60_000); // 10분을 요청해도 2분까지만
    vi.advanceTimersByTime(119_000);
    expect(systemDialogActive()).toBe(true);
    vi.advanceTimersByTime(1000 + SYSTEM_DIALOG_TAIL_MS + 20);
    expect(systemDialogActive()).toBe(false);
    expect(n).toBe(1);
    off();
  });
  it('겹친 유예는 마지막이 끝날 때 한 번만 알린다', () => {
    vi.useFakeTimers();
    let n = 0;
    const off = onSystemDialogEnd(() => n++);
    const a = allowSystemDialog(60_000);
    const b = allowSystemDialog(60_000);
    a();
    vi.advanceTimersByTime(SYSTEM_DIALOG_TAIL_MS + 20);
    expect(systemDialogActive()).toBe(true);
    expect(n).toBe(0);
    b();
    vi.advanceTimersByTime(SYSTEM_DIALOG_TAIL_MS + 20);
    expect(n).toBe(1);
    off();
  });
});
