import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { ActiveTimer, focusReducer, initialFocus, type FocusState } from './focusMachine';
import { sqlClient } from '../../sql/worker/sqlClient';

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
}

/**
 * 학습 세션 집중모드. 이 창의 visibility/focus만 사용한다.
 * 다른 프로그램 실행 여부·다른 탭 주소는 알 수 없고, 감시·차단하지 않는다.
 */
export function FocusProvider({ children, onActiveSeconds, onPause }: Props) {
  const [state, dispatch] = useReducer(focusReducer, initialFocus);
  const [interruptedRun, setInterrupted] = useState(0);
  const timer = useRef(new ActiveTimer());
  const item = useRef<string | null>(null);
  const cb = useRef({ onActiveSeconds, onPause });
  cb.current = { onActiveSeconds, onPause };
  const statusRef = useRef(state.status);

  const flushTime = useCallback(() => {
    const sec = timer.current.takeSeconds();
    if (sec > 0) cb.current.onActiveSeconds(item.current, sec);
  }, []);

  // 시작
  useEffect(() => {
    // StrictMode에서 두 번 실행돼도 같은 결과가 되도록 부수효과 없이 판정한다.
    dispatch({ type: 'start', env: env(), reload: enteredByReload() });
  }, []);

  // 상태 전이에 따른 부수효과
  useEffect(() => {
    const prev = statusRef.current;
    statusRef.current = state.status;
    if (state.status === 'active') {
      timer.current.start();
    } else if (prev === 'active') {
      timer.current.stop();
      flushTime();
      cb.current.onPause();
      // 진행 중 SQL은 Worker를 종료해 기준 상태로 복원하고, 늦은 결과는 generation으로 버린다.
      if (sqlClient().interrupt()) setInterrupted((n) => n + 1);
    }
    document.documentElement.classList.toggle('paused-app', state.status !== 'active');
    return () => document.documentElement.classList.remove('paused-app');
  }, [state.status, flushTime]);

  // 이벤트
  useEffect(() => {
    const onVis = () => dispatch(document.visibilityState === 'hidden' ? { type: 'hidden' } : { type: 'visible', env: env() });
    const onBlur = () => dispatch({ type: 'blur' });
    const onFocus = () => dispatch({ type: 'focus', env: env() });
    const onHide = () => {
      dispatch({ type: 'pagehide' });
      timer.current.stop();
      flushTime();
      cb.current.onPause();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', onHide);
    const t = timer.current;
    const iv = window.setInterval(() => {
      if (statusRef.current === 'active') flushTime();
    }, 15000);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pagehide', onHide);
      window.clearInterval(iv);
      t.stop();
      flushTime();
    };
  }, [flushTime]);

  const value: FocusCtx = {
    inSession: true,
    state,
    active: state.status === 'active',
    canAct: () => statusRef.current === 'active' && document.visibilityState === 'visible',
    manualBreak: () => dispatch({ type: 'manualBreak' }),
    resume: () => dispatch({ type: 'resume', env: env() }),
    interruptedRun,
    setCurrentItem: (id) => {
      if (item.current !== id) {
        flushTime();
        item.current = id;
        sqlClient().bumpGeneration();
      }
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 학습 루트를 가리는 불투명 오버레이 + 학습 영역 inert */
export function FocusGate({ children }: { children: ReactNode }) {
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
      if (e.target instanceof Node && (e.target as HTMLElement).closest?.('.focus-overlay')) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', block, true);
    return () => window.removeEventListener('keydown', block, true);
  }, [paused]);

  const ready = f.state.status === 'readyToResume' || (f.state.status === 'paused' && f.state.reason === 'manual');
  return (
    <>
      <div ref={root} aria-hidden={paused || undefined} data-focus-status={f.state.status}>
        {children}
      </div>
      {paused && (
        <div className="focus-overlay" role="dialog" aria-modal="true" aria-labelledby="focus-title" aria-describedby="focus-desc" data-testid="focus-overlay">
          <div className="focus-card">
            <h2 id="focus-title">학습이 일시정지되었습니다.</h2>
            <p id="focus-desc">
              {f.state.reason === 'manual'
                ? '쉬는 중이에요. 준비되면 계속할 수 있습니다.'
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
          </div>
        </div>
      )}
    </>
  );
}
