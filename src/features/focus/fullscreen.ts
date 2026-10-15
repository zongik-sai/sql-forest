/**
 * 전체화면 API(표준 + 사파리 webkit 접두사). 아이폰 사파리·일부 앱 안 브라우저는 웹페이지 전체화면을 지원하지 않는다.
 */
type FsDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export function fullscreenElement(): Element | null {
  if (typeof document === 'undefined') return null;
  return document.fullscreenElement ?? (document as FsDoc).webkitFullscreenElement ?? null;
}

export function fullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const d = document as FsDoc;
  const el = document.documentElement as FsEl;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled) && !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

/** 버튼 클릭 처리기 안에서 불러야 한다(브라우저 규칙) */
export function requestFullscreen(): Promise<void> {
  const el = document.documentElement as FsEl;
  try {
    const r = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.();
    return Promise.resolve(r);
  } catch (e) {
    return Promise.reject(e);
  }
}

export function exitFullscreen(): void {
  if (!fullscreenElement()) return;
  const d = document as FsDoc;
  try {
    const r = d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.();
    if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {});
  } catch {
    /* 이미 나간 경우 */
  }
}

/**
 * 크롬·엣지(데스크톱): 전체화면 중 Esc를 페이지가 받게 한다(Esc를 길게 눌러야 전체화면이 끝남).
 * SQL 편집기의 "Esc 후 Tab"이 잠김이 되지 않게. 지원하지 않는 브라우저는 그냥 넘어간다.
 */
type KbNav = Navigator & { keyboard?: { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void } };
export function lockEscapeKey(): void {
  try {
    void (navigator as KbNav).keyboard?.lock?.(['Escape'])?.catch(() => {});
  } catch {
    /* 지원 안 함 */
  }
}
export function unlockEscapeKey(): void {
  try {
    (navigator as KbNav).keyboard?.unlock?.();
  } catch {
    /* 지원 안 함 */
  }
}

/** 화면 꺼짐 방지(휴대폰이 읽는 도중 자동으로 잠기면 이탈로 세지 않게). 지원하지 않으면 null */
type WakeNav = Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
export async function requestWakeLock(): Promise<{ release: () => Promise<void> } | null> {
  try {
    const w = (navigator as WakeNav).wakeLock;
    if (!w || document.visibilityState !== 'visible') return null;
    return await w.request('screen');
  } catch {
    return null;
  }
}

/** 앱 안의 버튼이 페이지를 떠나기 직전(로그인·다른 브라우저로 열기): 단원 집중 학습을 잠김 없이 멈춘다 */
export const SUSPEND_EVENT = 'learning:suspend';
export const suspendLearning = () => window.dispatchEvent(new Event(SUSPEND_EVENT));
