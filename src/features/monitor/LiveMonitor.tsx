import { useEffect, useMemo, useRef, useState } from 'react';
import { studentNoText } from '../auth/accountKind';
import { useAuth } from '../auth/AuthContext';
import { onBeforeSignOut } from '../auth/signOutHooks';
import { rpcErrorText, type MonitorApi } from './api';
import { agoText, CHIP_LABEL, CHIP_ORDER, SUBJECT_LIST, sortLive, subjectName, toLiveStudents, type LiveChip, type LiveRow, type LiveSort, type LiveStudent } from './liveState';
import { ViewerSession, type ViewerState } from './rtc';

/**
 * 선생님 화면 '실시간 모니터링' 탭: 5초마다 새로고침(이 탭이 보일 때만), 학생별 과목·위치·문항·집중 상태·마지막 소식·잠김 횟수.
 * 학생이 허락하면 '화면 보기 요청'으로 실시간 화면을 본다(녹화·저장 없음).
 */
export const LIVE_REFRESH_MS = 5000;

export function LiveMonitor({ api }: { api: MonitorApi }) {
  const auth = useAuth();
  const me = auth.identity?.kind === 'user' ? auth.identity.userId : null;
  const [rows, setRows] = useState<LiveRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [minutes, setMinutes] = useState(10);
  const [subject, setSubject] = useState('all');
  const [sort, setSort] = useState<LiveSort>('status');
  // 학생 계정만(기본 켬): 선생님 테스트 계정 등이 섞이지 않게
  const [onlyStu, setOnlyStu] = useState(true);
  const [viewer, setViewer] = useState<{ session: ViewerSession; name: string; n: number } | null>(null);
  const viewerRef = useRef<ViewerSession | null>(null);
  const seq = useRef(0);

  // 5초마다(이 탭이 보일 때만). 숨겨지면 멈추고, 돌아오면 바로 한 번
  useEffect(() => {
    let alive = true;
    let timer = 0;
    let inflight = false;
    const load = async () => {
      window.clearTimeout(timer);
      if (!alive || inflight) return;
      if (document.visibilityState === 'visible') {
        inflight = true;
        try {
          const r = await api.classLive(minutes);
          if (!alive) return;
          setRows(r);
          setErr(null);
        } catch (e) {
          if (alive) setErr(rpcErrorText('class_live_status', e));
        } finally {
          inflight = false;
        }
        if (alive) setNow(Date.now());
      }
      if (alive && document.visibilityState === 'visible') timer = window.setTimeout(() => void load(), LIVE_REFRESH_MS);
    };
    void load();
    const onVis = () => {
      if (document.visibilityState === 'visible') void load();
      else window.clearTimeout(timer);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [api, minutes]);

  // 'N초 전' 표시는 1초마다
  useEffect(() => {
    const iv = window.setInterval(() => document.visibilityState === 'visible' && setNow(Date.now()), 1000);
    return () => window.clearInterval(iv);
  }, []);

  // 로그아웃 전에 보던 화면 공유를 끝낸다(로그인한 채로 서버 정리)
  useEffect(() => onBeforeSignOut(async () => {
    await viewerRef.current?.closeAndWait();
  }), []);

  // 이 화면을 떠나거나 창을 닫으면 보던 화면 공유를 끝낸다
  useEffect(() => {
    const end = () => viewerRef.current?.close();
    window.addEventListener('pagehide', end);
    return () => {
      window.removeEventListener('pagehide', end);
      end();
    };
  }, []);

  const students = useMemo(() => toLiveStudents(rows ?? [], now), [rows, now]);
  const hidden = onlyStu ? students.filter((s) => !s.sid).length : 0;
  const shown = useMemo(
    () => sortLive(students.filter((s) => (!onlyStu || s.sid) && (subject === 'all' || s.state.subject === subject)), sort),
    [students, subject, sort, onlyStu],
  );
  const counts = useMemo(() => {
    const c = Object.fromEntries(CHIP_ORDER.map((k) => [k, 0])) as Record<LiveChip, number>;
    for (const s of shown) c[s.chip]++;
    return c;
  }, [shown]);

  const view = (s: LiveStudent) => {
    viewerRef.current?.close();
    const session = new ViewerSession(api, s.id);
    viewerRef.current = session;
    setViewer({ session, name: s.name, n: ++seq.current });
    void session.start();
  };
  const closeViewer = () => {
    viewerRef.current?.close();
    viewerRef.current = null;
    setViewer(null);
  };

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>
        로그인한 학생이 지금 어느 과목·단원·단계를 공부하는지 5초마다 새로 보여 줘요. 화면 내용은 오지 않아요. 학생 화면은 학생이 허락할 때만 실시간으로 볼 수 있어요(녹화·저장 없음).
      </p>
      <div className="row t-live-tools">
        <label className="small">과목{' '}
          <select value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="all">전체</option>
            {SUBJECT_LIST.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="small">정렬{' '}
          <select value={sort} onChange={(e) => setSort(e.target.value as LiveSort)}>
            <option value="status">상태순(잠김·자리 비움 먼저)</option>
            <option value="name">이름순</option>
            <option value="sid">학번순</option>
            <option value="recent">최근 소식순</option>
          </select>
        </label>
        <label className="small">범위{' '}
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            <option value={10}>최근 10분</option>
            <option value={30}>최근 30분</option>
            <option value={60}>최근 1시간</option>
          </select>
        </label>
        <label className="small t-only"><input type="checkbox" checked={onlyStu} onChange={(e) => setOnlyStu(e.target.checked)} /> 학생 계정만</label>
        {hidden > 0 && <span className="small muted">학생 계정이 아닌 {hidden}명 숨김</span>}
      </div>
      {err && <p className="notice notice-warn" role="alert">불러오지 못했어요: {err}</p>}
      {!rows && !err ? <p role="status">불러오는 중…</p> : rows && (
        <>
          <ul className="t-chip-sum" aria-label="상태별 학생 수">
            {CHIP_ORDER.map((k) => <li key={k}><span className={`t-chip chip-${k}`}>{CHIP_LABEL[k]}</span> {counts[k]}</li>)}
          </ul>
          {shown.length === 0 ? (
            <p className="notice">최근 {minutes}분 안에 공부한(로그인한) 학생이 없어요.{hidden > 0 && ` 학생 계정(학번 형식)이 아닌 ${hidden}명은 숨겼어요('학생 계정만'을 끄면 보여요).`}</p>
          ) : (
            <ul className="t-live-grid" aria-label="학생별 실시간 학습 상태">
              {shown.map((s) => (
                <li key={s.id} className={`t-live-card panel chip-${s.chip}`}>
                  <div className="t-live-top">
                    <b className="t-live-name" title={s.email}>{s.name}{s.id === me ? ' (나)' : ''}</b>
                    <span className={`t-chip chip-${s.chip}`}>{CHIP_LABEL[s.chip]}</span>
                  </div>
                  {s.sid && <div className="small t-sid">학번 {s.sid.year} · {studentNoText(s.sid)}</div>}
                  <div className="small muted t-ellipsis">{s.email}</div>
                  <div className="t-live-where"><span className="badge badge-plain">{subjectName(s.state.subject) || '과목 밖'}</span> {s.state.label || '-'}</div>
                  <div className="small">{s.state.detail ?? ' '}</div>
                  <div className="small muted">
                    {agoText(s.updatedAt, now)}
                    {s.state.locks !== null && <> · 잠김 {s.state.locks}/5</>}
                    {s.state.fs && ' · 전체화면'}
                    {s.state.sharing && ' · 화면 공유 중'}
                  </div>
                  <button className="btn btn-small" disabled={s.chip === 'offline' || s.id === me} onClick={() => view(s)}>화면 보기 요청</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {viewer && <ScreenViewer key={viewer.n} session={viewer.session} name={viewer.name} onClose={closeViewer} />}
    </div>
  );
}

const PHASE_TEXT: Partial<Record<ViewerState['phase'], string>> = {
  requesting: '요청을 보내는 중…',
  waiting: '학생의 허락을 기다리는 중이에요. 2분 안에 응답이 없으면 끝나요.',
  choosing: '학생이 허락했어요. 보여 줄 화면을 고르는 중…(3분 안에 고르지 않으면 끝나요)',
  connecting: '연결하는 중…',
};

function ScreenViewer({ session, name, onClose }: { session: ViewerSession; name: string; onClose: () => void }) {
  const [st, setSt] = useState(session.state);
  useEffect(() => session.subscribe(setSt), [session]);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current) video.current.srcObject = st.stream;
  }, [st.stream]);
  const done = session.done || ['declined', 'ended', 'expired', 'failed', 'error'].includes(st.phase);
  return (
    <section className="t-viewer panel" aria-label={`${name} 학생 화면`}>
      <div className="t-viewer-head">
        <b>{name} 학생 화면</b>
        {st.phase === 'live' && <span className="t-chip chip-learning">실시간</span>}
        <span className="spacer" />
        {done ? <button className="btn btn-small" onClick={onClose}>닫기</button> : <button className="btn btn-small btn-primary" onClick={() => session.close()}>중지</button>}
      </div>
      <div className="t-viewer-stage">
        <video ref={video} autoPlay playsInline muted aria-label="학생이 공유한 화면" hidden={!st.stream} />
        {!st.stream && <p className="t-viewer-msg" role="status">{PHASE_TEXT[st.phase] ?? st.message ?? '화면 공유가 끝났어요.'}</p>}
      </div>
      <p className="small muted" style={{ margin: 0 }}>녹화·저장하지 않아요. 학생은 언제든 공유를 멈출 수 있어요.</p>
    </section>
  );
}
