import { useEffect, useRef, useState } from 'react';
import { onBeforeSignOut } from '../auth/signOutHooks';
import { allowSystemDialog } from '../focus/systemDialog';
import { isMissingFunction, type MonitorApi } from './api';
import { sharingStore } from './liveStore';
import { captureScreen, screenShareSupported, ShareSession, type ShareState } from './rtc';

/**
 * 학생 쪽 화면 공유: 선생님 요청 확인(5초마다, 창이 보일 때) → 허락 창 → 브라우저 자체 선택 창에서 학생이 고른 화면만 공유.
 * 공유 중에는 '선생님에게 화면을 보여 주는 중 · 공유 중지' 표시가 항상 보인다(잠김 화면 위에도).
 * 녹화·저장하지 않는다. 선택 창이 열려 있는 동안의 포커스 잃음은 집중 학습 잠김으로 세지 않는다(allowSystemDialog).
 */
export const REQUEST_POLL_MS = 5000;
/** 허락 창이 뜬 직후 이 시간 동안은 버튼을 누를 수 없다(치던 키·클릭이 실수로 허락되지 않게) */
export const ARM_DELAY_MS = 500;
/** 화면 고르기 유예(집중 학습 잠김을 세지 않는 시간, 최대) */
export const PICKER_GRACE_MS = 30_000;

export function StudentScreenShare({ api }: { api: MonitorApi }) {
  const [req, setReq] = useState<{ id: string; teacherName: string } | null>(null);
  const [share, setShare] = useState<ShareState | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const sessionRef = useRef<ShareSession | null>(null);
  const handled = useRef(new Set<string>());
  const [armed, setArmed] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const reqId = req?.id ?? null;

  // 허락 창: 처음에는 창 자체에 포커스(허락 버튼이 아님), 잠시 뒤에 버튼을 누를 수 있게
  useEffect(() => {
    setArmed(false);
    if (!reqId) return;
    dialogRef.current?.focus();
    const t = window.setTimeout(() => setArmed(true), ARM_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [reqId]);

  // 로그아웃 전에 공유를 끝낸다(로그인한 채로 서버 정리)
  useEffect(() => onBeforeSignOut(async () => {
    await sessionRef.current?.closeAndWait(null);
  }), []);

  // 요청 확인: 공유 중이 아니고 창이 보일 때 5초마다
  useEffect(() => {
    let alive = true;
    let timer = 0;
    let inflight = false;
    let stopped = false;
    const poll = async () => {
      window.clearTimeout(timer);
      if (!alive || stopped || inflight) return;
      if (document.visibilityState === 'visible' && !(sessionRef.current && !sessionRef.current.done)) {
        inflight = true;
        try {
          const r = await api.myRequest();
          if (!alive) return;
          setReq((prev) => (r && !handled.current.has(r.id) ? (prev?.id === r.id ? prev : r) : null));
        } catch (e) {
          if (isMissingFunction(e)) stopped = true; // 서버에 기능이 아직 없음
        } finally {
          inflight = false;
        }
      }
      if (alive && !stopped) timer = window.setTimeout(() => void poll(), REQUEST_POLL_MS);
    };
    void poll();
    const onVis = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [api]);

  // 로그아웃·계정 전환으로 사라지면 공유도 멈춘다
  useEffect(() => () => {
    sessionRef.current?.close(null);
    sharingStore.set(false);
  }, []);

  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), 10000);
    return () => window.clearTimeout(t);
  }, [note]);

  const accept = () => {
    if (!req || !armed) return;
    handled.current.add(req.id);
    setReq(null);
    setNote(null);
    const s = new ShareSession(api, req.id, { capture: captureScreen, grace: () => allowSystemDialog(PICKER_GRACE_MS) });
    sessionRef.current = s;
    const unsub = s.subscribe((st) => {
      setShare(st);
      sharingStore.set(st.phase === 'connecting' || st.phase === 'live');
      if (s.done) {
        unsub();
        setShare(null);
        setNote(st.message);
      }
    });
    setShare(s.state);
    // 선택 창은 이 클릭 안에서 바로 열어야 한다(start의 첫 부분이 동기적으로 getDisplayMedia를 부름)
    void s.start();
  };
  const decline = () => {
    if (!req || !armed) return;
    handled.current.add(req.id);
    void api.respond(req.id, false).catch(() => {});
    setReq(null);
  };
  const stop = () => sessionRef.current?.close('화면 공유를 멈췄어요.');

  const supported = screenShareSupported();
  return (
    <>
      {req && (
        <div className="monitor-modal-back">
          <div ref={dialogRef} tabIndex={-1} className="monitor-modal" role="dialog" aria-modal="true" aria-labelledby="share-req-title" aria-describedby="share-req-desc">
            <h2 id="share-req-title">화면 보기 요청</h2>
            <p id="share-req-desc">선생님({req.teacherName})이 화면 보기를 요청했어요. 공유하면 선택한 화면이 선생님에게 실시간으로 보여요(녹화·저장하지 않아요).</p>
            {supported ? (
              <>
                <div className="row">
                  <button className="btn btn-primary" onClick={accept} disabled={!armed}>화면 공유하기</button>
                  <button className="btn" onClick={decline} disabled={!armed}>거절</button>
                </div>
                <p className="small muted" style={{ margin: '0.75rem 0 0' }}>
                  보여 줄 화면(탭·창·전체 화면)은 다음에 뜨는 브라우저 창에서 직접 골라요. 고르는 동안은 집중 학습 잠김으로 세지 않아요. 언제든 '공유 중지'로 멈출 수 있어요.
                </p>
              </>
            ) : (
              <>
                <p className="notice notice-warn">이 기기(브라우저)는 화면 공유를 지원하지 않아요. 컴퓨터의 크롬·엣지에서 할 수 있어요.</p>
                <div className="row"><button className="btn" onClick={decline} disabled={!armed}>확인</button></div>
              </>
            )}
          </div>
        </div>
      )}
      {share && (
        <div className="share-banner" role="status">
          <span className="live-dot" aria-hidden="true" />
          <span>
            {share.phase === 'starting' ? '공유할 화면을 고르는 중…' : share.phase === 'connecting' ? '선생님에게 연결하는 중…' : '선생님에게 화면을 보여 주는 중'}
          </span>
          {share.phase !== 'starting' && <> · <button className="btn btn-small" onClick={stop}>공유 중지</button></>}
        </div>
      )}
      {!share && note && (
        <div className="share-banner share-note" role="status">
          <span>{note}</span>
          <button className="btn btn-small btn-quiet" onClick={() => setNote(null)}>닫기</button>
        </div>
      )}
    </>
  );
}
