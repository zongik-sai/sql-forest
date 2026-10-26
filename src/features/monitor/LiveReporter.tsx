import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { isSupabaseConfigured } from '../../lib/config';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../auth/supabase';
import { getFocusSnapshot, subscribeFocus } from '../focus/focusSignal';
import { fullscreenElement } from '../focus/fullscreen';
import { isMissingFunction, supabaseMonitorApi, type MonitorApi } from './api';
import { buildLiveState } from './liveState';
import { reporterStore, sharingStore, useLiveDetailValue, useSharing } from './liveStore';
import { StudentScreenShare } from './StudentShare';

/**
 * 실시간 학습 위치 보내기(앱 루트에 한 번, 로그인한 사용자만 · 데모 제외).
 * 15초마다, 그리고 바뀌면 1초 뒤에 작은 상태를 보낸다: 과목·경로·단원·단계 이름·문항 위치·집중 상태·전체화면·잠김 횟수.
 * 화면 내용·키 입력·다른 사이트 정보는 보내지 않는다. 서버에는 학생마다 한 행만 남고 덮어쓴다.
 * 함께: 선생님의 화면 보기 요청 확인(5초마다)과 허락 창(StudentScreenShare).
 */
export const HEARTBEAT_MS = 15_000;
export const DEBOUNCE_MS = 1_000;
export const IDLE_MS = 2 * 60 * 1000;

export function LiveReporter() {
  const auth = useAuth();
  const user = auth.identity?.kind === 'user' ? auth.identity : null;
  const api = useMemo(() => {
    const sb = isSupabaseConfigured ? supabase() : null;
    return sb ? supabaseMonitorApi(sb) : null;
  }, []);
  useEffect(() => {
    reporterStore.set(user && api ? 'ok' : 'off');
  }, [user, api]);
  if (!user || !api) return null;
  return (
    <>
      <Reporter key={user.userId} api={api} />
      <StudentScreenShare key={`s:${user.userId}`} api={api} />
    </>
  );
}

const readEnv = () => ({
  visible: document.visibilityState === 'visible',
  hasFocus: document.hasFocus(),
  fs: !!fullscreenElement(),
});

function Reporter({ api }: { api: MonitorApi }) {
  const loc = useLocation();
  const detail = useLiveDetailValue();
  const session = useSyncExternalStore(subscribeFocus, getFocusSnapshot, getFocusSnapshot);
  const sharing = useSharing();
  const [env, setEnv] = useState(readEnv);
  const [idle, setIdle] = useState(false);
  const lastInput = useRef(Date.now());
  const idleRef = useRef(false);

  // 보이기·포커스·전체화면 바뀜, 입력(자리 비움 판정)
  useEffect(() => {
    const upd = () => setEnv((prev) => {
      const n = readEnv();
      return n.visible === prev.visible && n.hasFocus === prev.hasFocus && n.fs === prev.fs ? prev : n;
    });
    const input = () => {
      lastInput.current = Date.now();
      if (idleRef.current) {
        idleRef.current = false;
        setIdle(false);
      }
    };
    const tick = () => {
      upd();
      const now = Date.now() - lastInput.current > IDLE_MS;
      if (now !== idleRef.current) {
        idleRef.current = now;
        setIdle(now);
      }
    };
    const evs = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
    for (const e of evs) window.addEventListener(e, input, { capture: true, passive: true });
    document.addEventListener('visibilitychange', upd);
    window.addEventListener('focus', upd);
    window.addEventListener('blur', upd);
    document.addEventListener('fullscreenchange', upd);
    document.addEventListener('webkitfullscreenchange', upd);
    const iv = window.setInterval(tick, 5000);
    return () => {
      for (const e of evs) window.removeEventListener(e, input, { capture: true });
      document.removeEventListener('visibilitychange', upd);
      window.removeEventListener('focus', upd);
      window.removeEventListener('blur', upd);
      document.removeEventListener('fullscreenchange', upd);
      document.removeEventListener('webkitfullscreenchange', upd);
      window.clearInterval(iv);
    };
  }, []);

  const state = useMemo(
    () => buildLiveState({ path: loc.pathname, detail, session, idle, sharing, ...env }),
    [loc.pathname, detail, session, idle, sharing, env],
  );
  const key = JSON.stringify(state);
  const latest = useRef(state);
  latest.current = state;
  const stopped = useRef(false);

  const send = useCallback(async () => {
    if (stopped.current) return;
    try {
      await api.report(latest.current);
      reporterStore.set('ok');
    } catch (e) {
      // 서버에 아직 기능(migration)이 없으면 이번 접속 동안은 보내지 않고 표시도 숨긴다
      if (isMissingFunction(e)) {
        stopped.current = true;
        reporterStore.set('unavailable');
      }
    }
  }, [api]);

  useEffect(() => {
    const t = window.setTimeout(() => void send(), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [key, send]);
  useEffect(() => {
    const iv = window.setInterval(() => void send(), HEARTBEAT_MS);
    return () => window.clearInterval(iv);
  }, [send]);
  // 로그아웃·계정 전환 때 공유 중 표시를 지운다
  useEffect(() => () => sharingStore.set(false), []);
  return null;
}
