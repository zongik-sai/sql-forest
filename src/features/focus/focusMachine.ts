/**
 * 집중모드 상태기계 (docs/09_FOCUS_MODE.md)
 * active → (hidden | blur | pagehide | 수동 휴식) → paused → (visible && hasFocus) → readyToResume
 * → '학습 계속하기'(visible && hasFocus 재확인) → active. 자동 재개는 하지 않는다.
 *
 * 이 기능은 이 학습 창의 포커스/표시 상태만 안다. 다른 프로그램 실행 여부, 다른 탭 주소,
 * 분할 화면의 다른 창, 두 번째 모니터는 알 수 없고 감지한다고 주장하지 않는다.
 * 포커스 상실은 부정행위 판정이 아니며 벌점·진도 초기화·자동 제출을 하지 않는다.
 */

export type FocusStatus = 'active' | 'paused' | 'readyToResume';
export type PauseReason = 'hidden' | 'blur' | 'pagehide' | 'manual' | 'start' | 'reload';

export interface FocusState {
  status: FocusStatus;
  reason: PauseReason | null;
  /** 지금까지 일시정지된 횟수(표시·디버그용, 벌점에 쓰지 않음) */
  pauses: number;
}

export interface Env {
  visible: boolean;
  hasFocus: boolean;
}

export type FocusEvent =
  | { type: 'start'; env: Env; reload?: boolean }
  | { type: 'hidden' }
  | { type: 'blur' }
  | { type: 'pagehide' }
  | { type: 'visible'; env: Env }
  | { type: 'focus'; env: Env }
  | { type: 'resume'; env: Env }
  | { type: 'manualBreak' };

export const initialFocus: FocusState = { status: 'paused', reason: 'start', pauses: 0 };

const canRun = (e: Env) => e.visible && e.hasFocus;

export function focusReducer(s: FocusState, ev: FocusEvent): FocusState {
  switch (ev.type) {
    case 'start':
      if (ev.reload) return { ...s, status: canRun(ev.env) ? 'readyToResume' : 'paused', reason: 'reload' };
      return canRun(ev.env) ? { ...s, status: 'active', reason: null } : { ...s, status: 'paused', reason: 'start' };
    case 'hidden':
    case 'blur':
    case 'pagehide':
      if (s.status === 'paused' && s.reason !== 'manual' && s.reason !== 'reload') return s;
      return { status: 'paused', reason: ev.type, pauses: s.status === 'active' ? s.pauses + 1 : s.pauses };
    case 'manualBreak':
      if (s.status !== 'active') return s;
      return { status: 'paused', reason: 'manual', pauses: s.pauses + 1 };
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
