import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ActiveTimer, afterSystemDialog, classifyLeave, focusReducer, initialFocus, lockNotice, type FocusState, type LockEvent } from './focusMachine';
import { publishFocus } from './focusSignal';
import { onSystemDialogEnd, systemDialogActive } from './systemDialog';
import { Link } from 'react-router-dom';
import { exitFullscreen, fullscreenElement, fullscreenSupported, lockEscapeKey, requestFullscreen, requestWakeLock, SUSPEND_EVENT, unlockEscapeKey } from './fullscreen';
import { sqlClient } from '../../sql/worker/sqlClient';

/** 단원 집중 학습 범위(전체화면 + 잠김 횟수). 없으면 예전처럼 가림·다시 시작만 한다 */
export interface StrictScope {
  /** 범위 식별자(단원). 바뀌면 시작 화면부터 */
  key: string;
  /** 안내 문구용 이름(예: '3단원') */
  label: string;
  /** 지금까지 잠긴 횟수(초기화 후 0부터) */
  locks: number;
  limit: number;
  /** 잠김 1회 기록(동기적으로 이 기기에 저장해야 한다). 기록 후 횟수와 초기화 여부를 돌려준다 */
  onLock: () => { count: number; reset: boolean };
}

interface FocusCtx {
  /** 학습 세션 안에 있는지(밖이면 항상 active) */
  inSession: boolean;
  state: FocusState;
  active: boolean;
  /** 입력·실행·제출 직전에 호출: 활성 상태가 아니면 false */
  canAct: () => boolean;
  manualBreak: () => void;
  resume: () => void;
  /** 일시정지로 SQL 실행이 중단되었는지(학생 안내용) */
  interruptedRun: number;
  /** 현재 학습 항목(활동 시간 기록용) */
  setCurrentItem: (id: string | null) => void;
  /** 단원 집중 학습 범위(없으면 null) */
  strict: StrictScope | null;
  /** 방금 잠긴 결과(안내 표시용) */
  lastLock: { count: number; reset: boolean } | null;
  /** 이 기기에서 전체화면을 쓸 수 있는지 */
  fullscreenOk: boolean;
}

const outside: FocusCtx = {
  inSession: false,
  state: { status: 'active', reason: null, pauses: 0 },
  active: true,
  canAct: () => true,
  manualBreak: () => {},
  resume: () => {},
  interruptedRun: 0,
  setCurrentItem: () => {},
  strict: null,
  lastLock: null,
  fullscreenOk: false,
};

const Ctx = createContext<FocusCtx>(outside);

export const useFocusGate = () => useContext(Ctx);

const env = () => ({ visible: document.visibilityState === 'visible', hasFocus: document.hasFocus() });

/** 페이지를 새로 연 뒤 앱 안에서 이동한 적이 있는지(없으면 '새로고침 후 진입'으로 보고 클릭으로 시작) */
let navigatedInApp = false;
/** 페이지를 처음 불러온 시점의 hash 경로 */
const LOAD_HASH = typeof window !== 'undefined' ? window.location.hash : '';
export function markInAppNavigation() {
  navigatedInApp = true;
}
/** 새로고침(또는 직접 주소 입력)으로 바로 이 학습 화면에 들어왔는지 */
function enteredByReload(): boolean {
  return !navigatedInApp && window.location.hash === LOAD_HASH;
}

interface Props {
  children: ReactNode;
  onActiveSeconds: (itemId: string | null, seconds: number) => void;
  /** 일시정지 직전: 초안을 동기적으로 로컬에 기록 */
  onPause: () => void;
  /** 단원 집중 학습(전체화면·잠김 횟수). 경로에 따라 바뀔 수 있다 */
  strict?: StrictScope | null;
  /** SQL 실습이 없는 과목은 false */
  interruptSql?: boolean;
}

/** 전체화면에 들어가거나 시작한 직후 잠시 생기는 포커스 흔들림은 세지 않고, 끝난 뒤 다시 확인한다 */
const GRACE_MS = 1500;

/**
 * 학습 세션 집중모드. 이 창의 visibility/focus만 사용한다.
 * 다른 프로그램 실행 여부·다른 탭 주소는 알 수 없고, 감시·차단하지 않는다.
 */
export function FocusProvider({ children, onActiveSeconds, onPause, strict = null, interruptSql = true }: Props) {
  const [state, dispatch] = useReducer(focusReducer, initialFocus);
  const [interruptedRun, setInterrupted] = useState(0);
  const [lastLock, setLastLock] = useState<{ count: number; reset: boolean } | null>(null);
  const strictRef = useRef(strict);
  strictRef.current = strict;
  const strictKey = strict?.key ?? null;
  /** 이 세션에서 전체화면에 들어갔는지(나가면 잠김) */
  const fsWanted = useRef(false);
  const graceUntil = useRef(0);
  const graceTimer = useRef<number | null>(null);
  /** 이번 이탈을 이미 셌는지(다시 시작하면 지움) */
  const countedRef = useRef(false);
  const timer = useRef(new ActiveTimer());
  const item = useRef<string | null>(null);
  const cb = useRef({ onActiveSeconds, onPause });
  cb.current = { onActiveSeconds, onPause };
  const statusRef = useRef(state.status);

  const flushTime = useCallback(() => {
    const sec = timer.current.takeSeconds();
    if (sec > 0) cb.current.onActiveSeconds(item.current, sec);
  }, []);

  /**
   * 이탈 이벤트. 단원 집중 학습 중이면 잠김 1회로 센다(같은 이탈의 blur·hidden이 연달아 와도 한 번만).
   * 이벤트 처리기 안에서 바로 기록한다(pagehide 뒤에는 화면이 다시 그려지지 않을 수 있으므로).
   */
  const leave = useCallback((ev: LockEvent) => {
    const sc = strictRef.current;
    const decision = classifyLeave(ev, {
      strict: !!sc,
      status: statusRef.current,
      // 화면 공유 선택 창(브라우저 자체 창)이 열려 있는 동안: 세지 않고, 끝난 뒤 onSystemDialogEnd에서 다시 확인
      systemDialog: systemDialogActive(),
      // 유예는 전체화면 전환 때 생길 수 있는 blur·전체화면 흔들림에만(창을 닫거나 새로고침하는 hidden·pagehide는 바로 셈)
      fsGrace: performance.now() < graceUntil.current,
      counted: countedRef.current,
    });
    if (decision === 'system') return systemPauseRef.current();
    if (decision === 'defer') {
      if (systemDialogActive()) return;
      // 전체화면 전환 직후의 흔들림일 수 있다: 유예가 끝나면 실제로 떠나 있는지 다시 확인
      if (graceTimer.current === null) {
        graceTimer.current = window.setTimeout(() => {
          graceTimer.current = null;
          const e = env();
          if (statusRef.current !== 'active') return;
          if (!e.visible) leaveRef.current('hidden');
          else if (!e.hasFocus) leaveRef.current('blur');
          else if (fsWanted.current && !fullscreenElement()) leaveRef.current('fullscreen');
        }, Math.max(0, graceUntil.current - performance.now()) + 50);
      }
      return;
    }
    if (decision === 'lock' && sc) {
      countedRef.current = true;
      const r = sc.onLock();
      setLastLock(r);
    }
    dispatch({ type: ev });
  }, []);
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  /** 세지 않고 멈춤(화면 공유 선택 창 때문): 전체화면도 끝내고, 다시 시작 클릭으로 돌아온다 */
  const systemPause = () => {
    countedRef.current = true; // 곧 이어질 같은 이탈의 이벤트를 세지 않음(다시 시작하면 지움)
    if (fsWanted.current) {
      fsWanted.current = false;
      unlockEscapeKey();
      exitFullscreen();
    }
    dispatch({ type: 'systemPause' });
  };
  const systemPauseRef = useRef(systemPause);
  systemPauseRef.current = systemPause;

  // 시작
  useEffect(() => {
    // StrictMode에서 두 번 실행돼도 같은 결과가 되도록 부수효과 없이 판정한다.
    dispatch({ type: 'start', env: env(), reload: enteredByReload(), strict: !!strictRef.current });
  }, []);

  // 단원 범위가 바뀜: 새 단원이면(전체화면 중이 아니면) 시작 화면, 범위를 벗어나면 전체화면 종료
  useEffect(() => {
    if (!strictKey) {
      if (fsWanted.current) {
        fsWanted.current = false;
        unlockEscapeKey();
        exitFullscreen();
      }
      return;
    }
    setLastLock(null);
    if (!(fsWanted.current && fullscreenElement())) dispatch({ type: 'gate' });
  }, [strictKey]);

  // 화면을 떠날 때 전체화면을 끝낸다(잠김으로 세지 않음)
  useEffect(() => () => {
    if (graceTimer.current !== null) window.clearTimeout(graceTimer.current);
    if (fsWanted.current) {
      fsWanted.current = false;
      unlockEscapeKey();
      exitFullscreen();
    }
  }, []);

  // 상태 전이에 따른 부수효과
  useEffect(() => {
    const prev = statusRef.current;
    statusRef.current = state.status;
    if (state.status === 'active') {
      countedRef.current = false;
      timer.current.start();
    } else if (prev === 'active') {
      timer.current.stop();
      flushTime();
      cb.current.onPause();
      // 진행 중 SQL은 Worker를 종료해 기준 상태로 복원하고, 늦은 결과는 generation으로 버린다.
      if (interruptSql && sqlClient().interrupt()) setInterrupted((n) => n + 1);
    }
    document.documentElement.classList.toggle('paused-app', state.status !== 'active');
    return () => document.documentElement.classList.remove('paused-app');
  }, [state.status, flushTime, interruptSql]);

  // 이벤트
  useEffect(() => {
    const onVis = () => (document.visibilityState === 'hidden' ? leave('hidden') : dispatch({ type: 'visible', env: env() }));
    const onBlur = () => leave('blur');
    const onFocus = () => dispatch({ type: 'focus', env: env() });
    const onHide = () => {
      leave('pagehide');
      timer.current.stop();
      flushTime();
      cb.current.onPause();
    };
    // 전체화면을 나가면(Esc 등) 잠김. 우리가 끝낸 경우(fsWanted=false)는 세지 않는다
    const onFs = () => {
      if (!fullscreenElement() && fsWanted.current && strictRef.current) leave('fullscreen');
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', onHide);
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    const t = timer.current;
    const iv = window.setInterval(() => {
      if (statusRef.current === 'active') flushTime();
    }, 15000);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('webkitfullscreenchange', onFs);
      window.clearInterval(iv);
      t.stop();
      flushTime();
    };
  }, [flushTime, leave]);

  // 앱 안의 버튼이 페이지를 떠나게 할 때(로그인·다른 브라우저로 열기): 잠김 없이 멈춘다
  useEffect(() => {
    const on = () => {
      if (!strictRef.current) return;
      countedRef.current = true; // 곧 이어질 hidden·pagehide를 세지 않음
      if (fsWanted.current) {
        fsWanted.current = false;
        unlockEscapeKey();
        exitFullscreen();
      }
      dispatch({ type: 'manualBreak' });
    };
    window.addEventListener(SUSPEND_EVENT, on);
    return () => window.removeEventListener(SUSPEND_EVENT, on);
  }, []);

  // 화면 공유 선택 창이 닫힌 뒤: 이 창으로 돌아와 있으면 그대로 계속, 아니면 세지 않고 멈춘다(다시 시작 클릭으로 전체화면)
  useEffect(() => onSystemDialogEnd(() => {
    if (statusRef.current !== 'active') return;
    const e = env();
    const fullscreenOk = !(strictRef.current && fsWanted.current && !fullscreenElement());
    if (afterSystemDialog({ ...e, fullscreenOk }) === 'continue') return;
    systemPauseRef.current();
  }), []);

  // 실시간 학습 위치(선생님 화면)용: 지금 집중 학습 상태를 알린다(화면 내용은 아님)
  const strictLabel = strict?.label ?? null;
  const strictLocks = strict?.locks ?? 0;
  const strictLimit = strict?.limit ?? 0;
  useEffect(() => {
    publishFocus({
      status: state.status,
      reason: state.reason,
      strict: strictKey ? { key: strictKey, label: strictLabel ?? '', locks: strictLocks, limit: strictLimit } : null,
    });
  }, [state.status, state.reason, strictKey, strictLabel, strictLocks, strictLimit]);
  useEffect(() => () => publishFocus(null), []);

  // 단원 집중 학습 중에는 화면 꺼짐 방지(휴대폰 자동 잠금이 이탈로 세지지 않게). 멈추면 해제
  const strictActive = !!strictKey && state.status === 'active';
  useEffect(() => {
    if (!strictActive) return;
    let lock: { release: () => Promise<void> } | null = null;
    let alive = true;
    void requestWakeLock().then((l) => {
      if (alive) lock = l;
      else void l?.release().catch(() => {});
    });
    return () => {
      alive = false;
      void lock?.release().catch(() => {});
    };
  }, [strictActive]);

  /** 시작·다시 시작(버튼 클릭 안에서): 단원 집중 학습이면 전체화면을 요청한다 */
  const resume = () => {
    if (strictRef.current && fullscreenSupported()) {
      graceUntil.current = performance.now() + GRACE_MS;
      if (fullscreenElement()) fsWanted.current = true;
      else {
        requestFullscreen().then(
          () => {
            fsWanted.current = true;
            lockEscapeKey();
          },
          () => { fsWanted.current = false; },
        );
      }
    } else if (strictRef.current) graceUntil.current = performance.now() + 300;
    setLastLock(null);
    dispatch({ type: 'resume', env: env() });
  };
  const manualBreak = () => {
    // 쉬기는 잠김으로 세지 않는다. 전체화면도 함께 끝낸다
    if (fsWanted.current) {
      fsWanted.current = false;
      unlockEscapeKey();
      exitFullscreen();
    }
    dispatch({ type: 'manualBreak' });
  };

  const value: FocusCtx = {
    inSession: true,
    state,
    active: state.status === 'active',
    canAct: () => statusRef.current === 'active' && !countedRef.current && document.visibilityState === 'visible',
    manualBreak,
    resume,
    interruptedRun,
    setCurrentItem: (id) => {
      if (item.current !== id) {
        flushTime();
        item.current = id;
        if (interruptSql) sqlClient().bumpGeneration();
      }
    },
    strict,
    lastLock,
    fullscreenOk: fullscreenSupported(),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 학습 루트를 가리는 불투명 오버레이 + 학습 영역 inert */
export function FocusGate({ children, exit }: { children: ReactNode; exit?: { to: string; label: string } }) {
  const f = useFocusGate();
  const btn = useRef<HTMLButtonElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const paused = f.inSession && !f.active;
  const root = useRef<HTMLDivElement>(null);

  // inert: 가림 중 학습 영역의 포커스 이동·클릭·입력을 막는다.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (paused) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }, [paused]);

  useEffect(() => {
    if (paused) {
      if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) lastFocus.current = document.activeElement;
      btn.current?.focus();
    } else if (lastFocus.current) {
      lastFocus.current.focus();
      lastFocus.current = null;
    }
  }, [paused]);

  // 가림 중에는 단축키(Ctrl+Enter 등)도 무효화
  useEffect(() => {
    if (!paused) return;
    const block = (e: KeyboardEvent) => {
      // 가림 화면 자체, 화면 공유 허락 창(.monitor-modal)·공유 중 표시(.share-banner, '공유 중지')의 키 입력은 그대로
      if (e.target instanceof Node && (e.target as HTMLElement).closest?.('.focus-overlay, .monitor-modal, .share-banner')) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', block, true);
    return () => window.removeEventListener('keydown', block, true);
  }, [paused]);

  const ready = f.state.status === 'readyToResume' || (f.state.status === 'paused' && (f.state.reason === 'manual' || f.state.reason === 'system'));
  const sc = f.strict;
  return (
    <>
      <div ref={root} aria-hidden={paused || undefined} data-focus-status={f.state.status}>
        {sc && f.active && (
          <div className="strict-bar" role="status">
            <span>🔒 집중 학습 중 · {sc.label} 잠김 <b>{Math.min(sc.locks, sc.limit - 1)}/{sc.limit}</b></span>
            <button className="btn btn-small btn-quiet" onClick={f.manualBreak}>쉬기</button>
          </div>
        )}
        {children}
      </div>
      {paused && (
        <div className={`focus-overlay${sc ? ' strict' : ''}`} role="dialog" aria-modal="true" aria-labelledby="focus-title" aria-describedby="focus-desc" data-testid="focus-overlay">
          <div className="focus-card">
            {sc ? <StrictCard btn={btn} exit={exit} /> : (
              <>
                <h2 id="focus-title">학습이 일시정지되었습니다.</h2>
                <p id="focus-desc">
                  {f.state.reason === 'manual'
                    ? '쉬는 중이에요. 준비되면 계속할 수 있습니다.'
                    : f.state.reason === 'system'
                      ? SYSTEM_PAUSE_TEXT
                    : f.state.reason === 'reload' || f.state.reason === 'start'
                      ? '저장된 단계와 초안을 불러왔어요. 준비되면 학습을 시작하세요.'
                      : '돌아오면 계속할 수 있습니다. 입력한 초안과 힌트 단계는 그대로 보존돼요.'}
                </p>
                {f.interruptedRun > 0 && <p className="small muted">진행 중이던 SQL 실행은 중단했어요. 다시 실행해주세요.</p>}
                <button ref={btn} className="btn btn-primary" onClick={f.resume}>
                  학습 계속하기
                </button>
                {!ready && <p className="small muted" style={{ marginTop: '0.75rem' }}>이 창으로 돌아오면 버튼을 눌러 계속할 수 있어요.</p>}
                <p className="small muted" style={{ marginTop: '1rem', marginBottom: 0 }}>
                  이 화면은 집중을 돕는 기능이에요. 벌점이나 기록 감점은 없어요.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

const SYSTEM_PAUSE_TEXT = '공유할 화면을 고르는 동안은 잠김으로 세지 않았어요. 이 창으로 돌아왔으면 다시 시작하세요.';

/** 단원 집중 학습의 시작·잠김·쉬기 화면 */
function StrictCard({ btn, exit }: { btn: RefObject<HTMLButtonElement>; exit?: { to: string; label: string } }) {
  const f = useFocusGate();
  const sc = f.strict!;
  const reason = f.state.reason;
  const fsWord = f.fullscreenOk ? '전체화면으로 ' : '';
  const locked = f.lastLock ?? (reason === 'hidden' || reason === 'blur' || reason === 'pagehide' || reason === 'fullscreen' ? { count: Math.min(sc.locks, sc.limit - 1), reset: false } : null);
  const note = locked ? lockNotice(locked.count, sc.limit, locked.reset) : null;
  const rules = (
    <ul className="strict-rules">
      <li>공부하는 동안 다른 창·탭·앱으로 가거나{f.fullscreenOk ? ' 전체화면을 나가면(Esc)' : ''} 화면이 잠겨요.</li>
      <li>이 단원에서 <b>{sc.limit}번</b> 잠기면 이 단원의 진도와 점수가 처음으로 돌아가요. 오답노트는 그대로예요.</li>
      <li>그만할 때는 <b>쉬기</b>를 누르거나 위 메뉴로 단원을 나가세요. 이때는 세지 않아요.</li>
    </ul>
  );
  return (
    <>
      {reason === 'system' ? (
        <>
          <h2 id="focus-title">화면 공유 창 때문에 멈췄어요</h2>
          <p id="focus-desc">{SYSTEM_PAUSE_TEXT} (이 단원 잠김 {Math.min(sc.locks, sc.limit - 1)}/{sc.limit})</p>
        </>
      ) : reason === 'manual' ? (
        <>
          <h2 id="focus-title">쉬는 중이에요</h2>
          <p id="focus-desc">쉬는 동안은 잠김으로 세지 않아요. 준비되면 다시 시작하세요. (이 단원 잠김 {Math.min(sc.locks, sc.limit - 1)}/{sc.limit})</p>
        </>
      ) : note ? (
        <>
          <h2 id="focus-title" className={note.last || locked?.reset ? 'strict-warn' : undefined}>{note.title}</h2>
          <p id="focus-desc">{note.body}</p>
        </>
      ) : (
        <>
          <h2 id="focus-title">{sc.label} 집중 학습</h2>
          <p id="focus-desc">이 단원은 {f.fullscreenOk ? '전체화면으로' : '한 화면에 집중해서'} 공부해요. 지금까지 이 단원 잠김 <b>{Math.min(sc.locks, sc.limit - 1)}/{sc.limit}</b></p>
          {rules}
          {!f.fullscreenOk && <p className="small muted">이 기기(브라우저)는 웹페이지 전체화면을 지원하지 않아요. 전체화면 없이 진행하지만, 다른 앱으로 가면 똑같이 잠겨요.</p>}
        </>
      )}
      {f.interruptedRun > 0 && <p className="small muted">진행 중이던 SQL 실행은 중단했어요. 다시 실행해주세요.</p>}
      <button ref={btn} className="btn btn-primary" onClick={f.resume}>
        {reason === 'gate' || reason === 'start' || reason === 'reload' ? `${fsWord}학습 시작` : `${fsWord}다시 시작`}
      </button>
      {f.state.status !== 'readyToResume' && reason !== 'manual' && reason !== 'system' && <p className="small muted" style={{ marginTop: '0.75rem' }}>이 창으로 돌아오면 버튼을 눌러 계속할 수 있어요.</p>}
      {exit && <p style={{ margin: '1rem 0 0' }}><Link className="btn btn-small btn-quiet" to={exit.to}>{exit.label}</Link></p>}
    </>
  );
}
