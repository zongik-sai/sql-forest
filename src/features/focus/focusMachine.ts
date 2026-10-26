/**
 * 집중모드 상태기계 (docs/09_FOCUS_MODE.md)
 * active → (hidden | blur | pagehide | 수동 휴식) → paused → (visible && hasFocus) → readyToResume
 * → '학습 계속하기'(visible && hasFocus 재확인) → active. 자동 재개는 하지 않는다.
 *
 * 이 기능은 이 학습 창의 포커스/표시 상태만 안다. 다른 프로그램 실행 여부, 다른 탭 주소,
 * 분할 화면의 다른 창, 두 번째 모니터는 알 수 없고 감지한다고 주장하지 않는다.
 *
 * 단원 집중 학습(strict, 선생님 결정 2026-10-15): 단원 화면은 시작 화면(gate)에서 클릭으로 전체화면에 들어간다.
 * 학습 중(active) 포커스를 잃거나 전체화면을 나가면 잠김 1회로 세고(같은 이탈의 연속 이벤트는 한 번만),
 * 단원에서 정해진 횟수(5회)가 되면 그 단원의 진도·점수를 초기화한다(호출하는 쪽이 처리).
 * '쉬기'와 메뉴로 단원을 나가는 것은 세지 않는다. 자동 제출은 하지 않는다.
 */

export type FocusStatus = 'active' | 'paused' | 'readyToResume';
/** system: 브라우저 자체 창(화면 공유 선택 창 등)이 닫힌 뒤 이 창으로 돌아오지 않아 멈춤(잠김으로 세지 않음) */
export type PauseReason = 'hidden' | 'blur' | 'pagehide' | 'fullscreen' | 'manual' | 'start' | 'reload' | 'gate' | 'system';

export interface FocusState {
  status: FocusStatus;
  reason: PauseReason | null;
  /** 지금까지 일시정지된 횟수(표시·디버그용). 단원 잠김 횟수는 학습 기록에 따로 저장한다 */
  pauses: number;
}

export interface Env {
  visible: boolean;
  hasFocus: boolean;
}

export type FocusEvent =
  | { type: 'start'; env: Env; reload?: boolean; strict?: boolean }
  | { type: 'hidden' }
  | { type: 'blur' }
  | { type: 'pagehide' }
  | { type: 'fullscreen' }
  /** 단원 집중 학습 범위에 들어옴: 클릭으로 시작(전체화면)할 때까지 가린다(잠김으로 세지 않음) */
  | { type: 'gate' }
  | { type: 'visible'; env: Env }
  | { type: 'focus'; env: Env }
  | { type: 'resume'; env: Env }
  | { type: 'manualBreak' }
  /** 화면 공유 선택 창 등이 끝난 뒤 이 창에 돌아와 있지 않음: 세지 않고 멈춘다 */
  | { type: 'systemPause' };

export const initialFocus: FocusState = { status: 'paused', reason: 'start', pauses: 0 };

const canRun = (e: Env) => e.visible && e.hasFocus;

export function focusReducer(s: FocusState, ev: FocusEvent): FocusState {
  switch (ev.type) {
    case 'start':
      if (ev.strict) return { ...s, status: canRun(ev.env) ? 'readyToResume' : 'paused', reason: 'gate' };
      if (ev.reload) return { ...s, status: canRun(ev.env) ? 'readyToResume' : 'paused', reason: 'reload' };
      return canRun(ev.env) ? { ...s, status: 'active', reason: null } : { ...s, status: 'paused', reason: 'start' };
    case 'hidden':
    case 'blur':
    case 'pagehide':
    case 'fullscreen':
      if (s.status === 'paused' && s.reason !== 'manual' && s.reason !== 'system' && s.reason !== 'reload' && s.reason !== 'gate') return s;
      if (s.status !== 'active' && (s.reason === 'gate' || s.reason === 'manual' || s.reason === 'system')) return { ...s, status: 'paused' };
      return { status: 'paused', reason: ev.type, pauses: s.status === 'active' ? s.pauses + 1 : s.pauses };
    case 'gate':
      if (s.status === 'active') return { ...s, status: 'paused', reason: 'gate' };
      return { ...s, reason: 'gate' };
    case 'manualBreak':
      if (s.status !== 'active') return s;
      return { status: 'paused', reason: 'manual', pauses: s.pauses + 1 };
    case 'systemPause':
      if (s.status !== 'active') return s;
      return { status: 'paused', reason: 'system', pauses: s.pauses + 1 };
    case 'visible':
    case 'focus':
      // 돌아와도 자동 재개하지 않는다. 재개 준비 상태로만 바꾼다.
      if (s.status === 'paused' && canRun(ev.env)) return { ...s, status: 'readyToResume' };
      return s;
    case 'resume':
      if (s.status !== 'active' && canRun(ev.env)) return { ...s, status: 'active', reason: null };
      return s;
  }
}

/**
 * 활성 학습 시간 측정. performance.now() 기반 delta만 사용하므로 컴퓨터 시각을 바꿔도 시간이 부풀지 않는다.
 * active 동안만 누적하고, 일시정지 시 마지막 delta를 확정한 뒤 기준점(anchor)을 비운다.
 * 복귀할 때 숨겨져 있던 시간은 더하지 않는다.
 */
export class ActiveTimer {
  private anchor: number | null = null;
  private pendingMs = 0;

  constructor(private now: () => number = () => performance.now()) {}

  start(): void {
    if (this.anchor === null) this.anchor = this.now();
  }

  /** 일시정지: 지금까지의 delta를 확정하고 anchor를 비운다. */
  stop(): void {
    if (this.anchor !== null) {
      const d = this.now() - this.anchor;
      if (d > 0 && d < 6 * 60 * 60 * 1000) this.pendingMs += d;
      this.anchor = null;
    }
  }

  get running(): boolean {
    return this.anchor !== null;
  }

  /** 확정된 정수 초를 꺼낸다(남은 소수는 다음으로 이월). 실행 중이면 지금까지를 먼저 확정. */
  takeSeconds(): number {
    if (this.anchor !== null) {
      const t = this.now();
      const d = t - this.anchor;
      if (d > 0 && d < 6 * 60 * 60 * 1000) this.pendingMs += d;
      this.anchor = t;
    }
    const sec = Math.floor(this.pendingMs / 1000);
    this.pendingMs -= sec * 1000;
    return sec;
  }
}

/** 학습 중(active)에 이 이벤트가 오면 단원 잠김 1회로 센다 */
export const LOCK_EVENTS = ['hidden', 'blur', 'pagehide', 'fullscreen'] as const;
export type LockEvent = (typeof LOCK_EVENTS)[number];
export const countsAsLock = (status: FocusStatus, ev: string): ev is LockEvent => status === 'active' && (LOCK_EVENTS as readonly string[]).includes(ev);

/** 단원 잠김 안내 문구(남은 횟수·마지막 경고·초기화) */
export function lockNotice(count: number, limit: number, reset: boolean): { title: string; body: string; last: boolean } {
  if (reset) return { title: '이 단원 기록이 처음으로 돌아갔어요', body: `${limit}번 잠겨서 이 단원의 진도와 점수를 지웠어요. 오답노트·모의고사·다른 단원 기록은 그대로예요. 처음부터 다시 시작해요.`, last: false };
  const left = Math.max(1, limit - count);
  if (left === 1) return { title: `화면이 잠겼어요 (${Math.min(count, limit - 1)}/${limit})`, body: `마지막 경고예요! 한 번 더 잠기면 이 단원의 진도와 점수가 처음으로 돌아가요.`, last: true };
  return { title: `화면이 잠겼어요 (${count}/${limit})`, body: `학습 중에 다른 창·앱으로 가거나 전체화면을 나가면 잠겨요. 이 단원에서 ${limit}번 잠기면 진도와 점수가 처음으로 돌아가요(${left}번 남음).`, last: false };
}

/**
 * 이탈 이벤트를 어떻게 처리할지(순수 함수, 테스트 대상).
 * - defer: 지금은 세지도 멈추지도 않고, 유예가 끝난 뒤 실제로 떠나 있는지 다시 확인한다.
 *   · 브라우저 자체 창(화면 공유 선택 창, allowSystemDialog)이 열려 있는 동안의 blur·전체화면 나감
 *   · 단원 집중 학습 시작 직후(전체화면 전환 흔들림)의 blur·전체화면 나감
 * - system: 선택 창이 열려 있는데 탭이 숨겨짐(다른 탭·앱으로 감) → 유예하지 않고 바로 멈춘다(잠김으로는 세지 않음)
 * - lock: 단원 집중 학습 중(active) 이번 이탈의 첫 이벤트 → 잠김 1회로 센다(창 닫기·새로고침 pagehide는 언제나)
 * - pause: 세지 않고 상태기계에만 전달(이미 멈춤·같은 이탈의 연속 이벤트·단원 밖 학습)
 */
export type LeaveDecision = 'defer' | 'system' | 'lock' | 'pause';
export function classifyLeave(ev: LockEvent, o: { strict: boolean; status: FocusStatus; systemDialog: boolean; fsGrace: boolean; counted: boolean }): LeaveDecision {
  if (o.status === 'active' && o.systemDialog) {
    if (ev === 'blur' || ev === 'fullscreen') return 'defer';
    if (ev === 'hidden') return 'system';
  }
  if (o.strict && o.status === 'active' && o.fsGrace && (ev === 'blur' || ev === 'fullscreen')) return 'defer';
  if (o.strict && !o.counted && countsAsLock(o.status, ev)) return 'lock';
  return 'pause';
}

/**
 * 브라우저 자체 창(화면 공유 선택 창 등)이 닫힌 뒤: 이 창이 보이고 포커스가 있고(필요하면) 전체화면이면 그대로 계속,
 * 아니면 세지 않고 멈춘다(systemPause). 공유가 시작된 뒤에는 보통 규칙(떠나면 잠김)이 다시 적용된다.
 */
export function afterSystemDialog(e: { visible: boolean; hasFocus: boolean; fullscreenOk: boolean }): 'continue' | 'pause' {
  return e.visible && e.hasFocus && e.fullscreenOk ? 'continue' : 'pause';
}
