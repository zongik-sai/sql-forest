import { useEffect, useSyncExternalStore } from 'react';

/**
 * 실시간 학습 위치에 덧붙이는 작은 값들(화면 어디서나 쓰는 외부 저장소).
 * - detail: 지금 문항 위치 등. 학습 화면이 useLiveDetail('문항 7/20')로 알린다(화면을 떠나면 지워짐).
 * - reporter: 위치 보내기 상태(서버에 기능이 없으면 'unavailable' → 공유 표시를 숨김).
 * - sharing: 선생님에게 화면을 보여 주는 중인지.
 */
function store<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (v: T) => {
      if (Object.is(v, value)) return;
      value = v;
      subs.forEach((f) => f());
    },
    subscribe: (f: () => void) => {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
  };
}

/* ---------- 문항 위치 ---------- */
const details = new Map<number, string>();
let seq = 0;
export const detailStore = store<string | null>(null);
const refreshDetail = () => detailStore.set([...details.values()].at(-1) ?? null);

/** 학습 화면이 지금 위치를 알린다(예: '문항 7/20'). null이면 알리지 않음. 나중에 마운트된 화면의 값이 우선 */
export function useLiveDetail(text: string | null | undefined) {
  const t = text ? text.slice(0, 80) : null;
  useEffect(() => {
    if (!t) return;
    const id = ++seq;
    details.set(id, t);
    refreshDetail();
    return () => {
      details.delete(id);
      refreshDetail();
    };
  }, [t]);
}

export const useLiveDetailValue = () => useSyncExternalStore(detailStore.subscribe, detailStore.get, detailStore.get);

/* ---------- 보내기 상태·화면 공유 중 ---------- */
export type ReporterStatus = 'off' | 'ok' | 'unavailable';
export const reporterStore = store<ReporterStatus>('off');
export const useReporterStatus = () => useSyncExternalStore(reporterStore.subscribe, reporterStore.get, reporterStore.get);

export const sharingStore = store(false);
export const useSharing = () => useSyncExternalStore(sharingStore.subscribe, sharingStore.get, sharingStore.get);
