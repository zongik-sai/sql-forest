import { describe, expect, it } from 'vitest';
import { ActiveTimer, countsAsLock, focusReducer, initialFocus, lockNotice, type FocusState } from '../../src/features/focus/focusMachine';

const on = { visible: true, hasFocus: true };
const off = { visible: true, hasFocus: false };
const hiddenEnv = { visible: false, hasFocus: false };

describe('집중모드 상태기계', () => {
  it('시작: visible && hasFocus일 때만 active', () => {
    expect(focusReducer(initialFocus, { type: 'start', env: on }).status).toBe('active');
    expect(focusReducer(initialFocus, { type: 'start', env: off }).status).toBe('paused');
  });
  it('새로고침 후에는 사용자 클릭 전까지 active가 되지 않음', () => {
    expect(focusReducer(initialFocus, { type: 'start', env: on, reload: true }).status).toBe('readyToResume');
  });
  it.each(['hidden', 'blur', 'pagehide'] as const)('%s → 즉시 paused', (t) => {
    const s = focusReducer(focusReducer(initialFocus, { type: 'start', env: on }), { type: t });
    expect(s.status).toBe('paused');
  });
  it('복귀해도 자동 재개 금지: readyToResume까지만', () => {
    let s: FocusState = focusReducer(initialFocus, { type: 'start', env: on });
    s = focusReducer(s, { type: 'hidden' });
    s = focusReducer(s, { type: 'visible', env: off });
    expect(s.status).toBe('paused');
    s = focusReducer(s, { type: 'focus', env: on });
    expect(s.status).toBe('readyToResume');
    s = focusReducer(s, { type: 'resume', env: hiddenEnv });
    expect(s.status).toBe('readyToResume');
    s = focusReducer(s, { type: 'resume', env: on });
    expect(s.status).toBe('active');
  });
  it('수동 휴식도 같은 방식으로 돌아옴', () => {
    let s = focusReducer(focusReducer(initialFocus, { type: 'start', env: on }), { type: 'manualBreak' });
    expect(s).toMatchObject({ status: 'paused', reason: 'manual' });
    s = focusReducer(s, { type: 'resume', env: on });
    expect(s.status).toBe('active');
  });
  it('일시정지 횟수는 기록만 하고 상태를 바꾸지 않음(벌점 없음)', () => {
    let s = focusReducer(initialFocus, { type: 'start', env: on });
    for (let i = 0; i < 5; i++) {
      s = focusReducer(s, { type: 'blur' });
      s = focusReducer(s, { type: 'resume', env: on });
    }
    expect(s).toMatchObject({ status: 'active', pauses: 5 });
  });
});

describe('활성 시간 타이머', () => {
  it('active 동안만 누적, 숨겨진 시간은 더하지 않음', () => {
    let t = 0;
    const timer = new ActiveTimer(() => t);
    timer.start();
    t = 5000;
    timer.stop(); // 숨김: 5초 확정
    t = 65000; // 60초 숨김
    timer.start();
    t = 68000;
    expect(timer.takeSeconds()).toBe(8);
  });
  it('소수 초는 이월', () => {
    let t = 0;
    const timer = new ActiveTimer(() => t);
    timer.start();
    t = 1500;
    expect(timer.takeSeconds()).toBe(1);
    t = 2000;
    expect(timer.takeSeconds()).toBe(1);
  });
  it('시계가 뒤로 가거나 비정상 값이면 더하지 않음', () => {
    let t = 1000;
    const timer = new ActiveTimer(() => t);
    timer.start();
    t = 500;
    timer.stop();
    expect(timer.takeSeconds()).toBe(0);
  });
});

describe('단원 집중 학습(strict)', () => {
  it('시작은 항상 클릭 대기(gate), 클릭하면 active', () => {
    let s = focusReducer(initialFocus, { type: 'start', env: on, strict: true });
    expect(s).toMatchObject({ status: 'readyToResume', reason: 'gate' });
    s = focusReducer(s, { type: 'resume', env: on });
    expect(s.status).toBe('active');
  });
  it('시작 화면에서 창을 떠나도 gate 그대로(잠김 아님)', () => {
    let s = focusReducer(initialFocus, { type: 'start', env: on, strict: true });
    s = focusReducer(s, { type: 'blur' });
    expect(s).toMatchObject({ status: 'paused', reason: 'gate' });
  });
  it('전체화면 나가기도 이탈로 처리', () => {
    const s = focusReducer(focusReducer(initialFocus, { type: 'start', env: on }), { type: 'fullscreen' });
    expect(s).toMatchObject({ status: 'paused', reason: 'fullscreen' });
  });
  it('학습 중(active)의 이탈만 잠김으로 센다(쉬기·시작 화면은 세지 않음)', () => {
    expect(countsAsLock('active', 'blur')).toBe(true);
    expect(countsAsLock('active', 'fullscreen')).toBe(true);
    expect(countsAsLock('active', 'manualBreak')).toBe(false);
    expect(countsAsLock('paused', 'blur')).toBe(false);
    expect(countsAsLock('readyToResume', 'hidden')).toBe(false);
  });
  it('새 단원에 들어오면 gate로(학습 중이었어도)', () => {
    const s = focusReducer(focusReducer(initialFocus, { type: 'start', env: on }), { type: 'gate' });
    expect(s).toMatchObject({ status: 'paused', reason: 'gate', pauses: 0 });
  });
  it('안내: n/5, 마지막(4/5) 경고, 초기화', () => {
    expect(lockNotice(2, 5, false)).toMatchObject({ title: '화면이 잠겼어요 (2/5)', last: false });
    expect(lockNotice(2, 5, false).body).toContain('3번 남음');
    expect(lockNotice(4, 5, false)).toMatchObject({ last: true });
    expect(lockNotice(4, 5, false).body).toContain('한 번 더');
    expect(lockNotice(5, 5, true).title).toContain('처음으로');
  });
});
