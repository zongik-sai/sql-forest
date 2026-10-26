import type { FocusStatus, PauseReason } from './focusMachine';

/**
 * 지금 화면의 집중 학습 상태(실시간 학습 위치 보고용, src/features/monitor). FocusProvider가 바뀔 때마다 알린다.
 * 학습 세션 밖이면 null.
 */
export interface FocusSnapshot {
  status: FocusStatus;
  reason: PauseReason | null;
  /** 단원 집중 학습 범위(없으면 null): 이름과 지금까지 잠긴 횟수 */
  strict: { key: string; label: string; locks: number; limit: number } | null;
}

let snap: FocusSnapshot | null = null;
const subs = new Set<() => void>();

export const getFocusSnapshot = () => snap;

export function publishFocus(next: FocusSnapshot | null) {
  if (JSON.stringify(next) === JSON.stringify(snap)) return;
  snap = next;
  subs.forEach((f) => f());
}

export function subscribeFocus(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}
