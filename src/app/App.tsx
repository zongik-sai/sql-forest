import { lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react';
import { HashRouter, Link, MemoryRouter, NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Garden } from '../components/Garden';
import { useAuth } from '../features/auth/AuthContext';
import { FocusGate, FocusProvider, markInAppNavigation, useFocusGate, type StrictScope } from '../features/focus/FocusContext';
import { addActiveSeconds, unitLockCount, UNIT_LOCK_LIMIT } from '../features/progress/model';
import type { UnitId } from '../content/types';
import { stageOf } from '../features/growth/levels';
import { ActivityPage, ChallengePage, CheckpointPage, UnitPage } from '../features/learning/pages';
import { Dashboard, FinalPage, PrePage, ReportPage, ReviewPage } from '../features/progress/pages';
import { Playground } from '../features/playground/Playground';
import { UNIT_BY_ID } from '../content';
import { LearnerProvider, useLearner } from './LearnerContext';
import { AboutPage, SetupPage, StartPage } from './StartPage';
import { LAST_SUBJECT_KEY, SubjectHome, subjectOfPath } from './SubjectHome';
import { writeRaw } from '../lib/storage';
// 컴퓨터 일반은 문제은행이 커서 들어갈 때만 내려받는다
const ComputerRoutes = lazy(() => import('../features/computer/ComputerApp'));
// 같은 단원 × 5단계 엔진을 쓰는 과목들: 과목마다 자기 단원 8개만 담긴 chunk
const NetworkRoutes = lazy(() => import('../features/computer/courses/net'));
const ProgrammingRoutes = lazy(() => import('../features/computer/courses/prog'));
const DataRoutes = lazy(() => import('../features/computer/courses/data'));
const loadingCourse = <div className="page" role="status">불러오는 중…</div>;
// 데이터베이스 단원 단계 콘텐츠(이론 카드·개념 점검·실습 예제)도 단계 화면을 열 때만 내려받는다
const StagePage = lazy(() => import('../features/learning/stages').then((m) => ({ default: m.StagePage })));

function SaveStatus() {
  const L = useLearner();
  const text = L.identity.kind === 'demo' ? '로컬 보관(데모)' : { saving: '저장 중…', saved: '저장됨', local: '로컬 보관(오프라인)', retry: '재시도 필요' }[L.saveStatus];
  return <span className="save-status" aria-live="polite">{text}{L.pendingSync ? ' · 동기화 대기' : ''}</span>;
}

function TopBar({ learning }: { learning?: boolean }) {
  const auth = useAuth();
  const L = useLearner();
  const f = useFocusGate();
  return (
    <header className="topbar">
      <Link to="/garden" className="brand" aria-label={`나의 정원: Lv${L.level} ${stageOf(L.level).name}`}>
        <Garden level={L.level} small className="garden-mini" title={`Lv${L.level}`} />
        <span>Lv{L.level}</span>
      </Link>
      {L.identity.kind === 'demo' && <span className="demo-flag" title="개발용 데모: 이 브라우저에만 저장">개발 데모</span>}
      {!learning && (
        <nav aria-label="주 메뉴">
          <NavLink to="/" end>과목</NavLink>
          <NavLink to="/garden">나의 정원</NavLink>
          <NavLink to="/review">오답 복습</NavLink>
          <NavLink to="/practice">자유 실습장</NavLink>
          <NavLink to="/report">보고서</NavLink>
        </nav>
      )}
      <span className="spacer" />
      <SaveStatus />
      {learning && f.inSession && !f.strict && <button className="btn btn-small" onClick={f.manualBreak}>쉬기</button>}
      {L.identity.kind === 'demo' ? (
        <button className="btn btn-small btn-quiet" onClick={auth.exitDemo}>데모 나가기</button>
      ) : (
        <button className="btn btn-small btn-quiet" onClick={() => void auth.signOut()}>로그아웃</button>
      )}
    </header>
  );
}

function CelebrationLayer() {
  const L = useLearner();
  const f = useFocusGate();
  const showing = !f.inSession || f.active; // 가림 중에는 보상 연출을 멈추고 재개 후 묶어서 표시
  const toasts = L.celebrations.filter((c) => c.kind === 'toast');
  const card = L.celebrations.find((c) => c.kind !== 'toast');
  useEffect(() => {
    if (!showing || !toasts.length) return;
    const t = setTimeout(() => L.dismissCelebration(toasts[0].id), 2000);
    return () => clearTimeout(t);
  }, [showing, toasts, L]);
  if (!showing) return null;
  return (
    <>
      <div className="toasts" role="status" aria-live="polite">
        {toasts.slice(0, 3).map((t) => <div key={t.id} className="toast">{t.text}</div>)}
      </div>
      {card && (
        <div className="milestone" role="dialog" aria-label={card.kind === 'unit' ? '단원 완료' : '성장 변화'}>
          <Garden level={card.kind === 'milestone' ? card.level! : L.level} small />
          <div className="stack" style={{ gap: '0.4rem' }}>
            {card.kind === 'unit' ? (
              <>
                <b>{card.unitId} 완료 · 배지 '{card.text}'</b>
                <span className="small">정원이 자랐어요. 남은 체크포인트도 숲 완성에 필요해요.</span>
              </>
            ) : (
              <>
                <b>Lv{card.level} {stageOf(card.level!).name}</b>
                <span className="small">{stageOf(card.level!).visual}</span>
              </>
            )}
            <div className="row">
              <button className="btn btn-small" onClick={() => L.dismissCelebration(card.id)}>닫기</button>
              {card.kind === 'unit' && card.unitId && UNIT_BY_ID[card.unitId] && <Link className="btn btn-small btn-grow" to="/garden" onClick={() => L.dismissCelebration(card.id)}>정원 보기</Link>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ConflictBanner() {
  const L = useLearner();
  if (!L.conflicts.length) return null;
  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      {L.conflicts.map((c) => (
        <div key={c.activityId} className="notice notice-warn row" role="alert">
          <span>{c.activityId}: 다른 기기에서 더 최근에 수정한 내용이 있어요. 어느 쪽을 쓸까요?</span>
          <button className="btn btn-small" onClick={() => L.resolveConflict(c.activityId, 'server')}>서버(다른 기기) 내용 사용</button>
          <button className="btn btn-small" onClick={() => L.resolveConflict(c.activityId, 'local')}>이 기기 초안 유지</button>
        </div>
      ))}
    </div>
  );
}

function Footer() {
  const L = useLearner();
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <footer className="foot">
      <Link to="/about">저장 방식·도구의 한계</Link>
      {' · '}
      {confirm ? (
        <>
          정말 지울까요? 진도·초안·경험치 기록이 모두 삭제돼요.{' '}
          <button className="btn btn-small" onClick={async () => setErr(await L.resetMyData())}>지우기</button>{' '}
          <button className="btn btn-small btn-quiet" onClick={() => setConfirm(false)}>취소</button>
        </>
      ) : (
        <button className="btn btn-small btn-quiet" onClick={() => setConfirm(true)}>내 학습 기록 지우기</button>
      )}
      {err && <p role="alert">삭제 실패: {err}</p>}
    </footer>
  );
}

function AppLayout() {
  return (
    <div className="app-shell">
      <TopBar />
      <ConflictBanner />
      <main id="main"><Outlet /></main>
      <CelebrationLayer />
      <Footer />
    </div>
  );
}

/** 단원 화면(/learn/U03…, /challenge/CH-U03)이면 그 단원 */
const unitOfPath = (path: string): UnitId | null => {
  const m = /^\/(?:learn\/|challenge\/CH-)(U(?:0[1-9]|1[0-2]))(?:\/|$)/.exec(path);
  return m && UNIT_BY_ID[m[1] as UnitId] ? (m[1] as UnitId) : null;
};

function LearningLayout() {
  const L = useLearner();
  const loc = useLocation();
  const nav = useNavigate();
  const unit = unitOfPath(loc.pathname);
  // 단원 학습은 전체화면 집중 학습: 포커스를 잃으면 잠기고, 한 단원에서 5번 잠기면 그 단원 진도·점수 초기화
  const strict: StrictScope | null = unit ? {
    key: `db:${unit}`,
    label: `${UNIT_BY_ID[unit].order}단원`,
    locks: unitLockCount(L.state, unit),
    limit: UNIT_LOCK_LIMIT,
    onLock: () => {
      const r = L.lockUnit(unit);
      if (r.reset) nav(`/learn/${unit}`, { replace: true });
      return r;
    },
  } : null;
  return (
    <FocusProvider
      onActiveSeconds={(item, sec) => void L.commit((s) => addActiveSeconds(s, item, sec))}
      onPause={L.flushLocal}
      strict={strict}
    >
      <div className="app-shell">
        <TopBar learning />
        <ConflictBanner />
        <FocusGate exit={{ to: '/garden', label: '나의 정원으로 나가기' }}>
          <main id="main" key={unit ? L.state.unitResets?.[unit]?.n ?? 0 : 0}><Outlet /></main>
        </FocusGate>
        <CelebrationLayer />
      </div>
    </FocusProvider>
  );
}

function Protected() {
  const auth = useAuth();
  const loc = useLocation();
  if (auth.status === 'loading') return <div className="page" role="status">로그인 상태를 확인하는 중…</div>;
  if (!auth.identity) return <Navigate to="/db" replace state={{ from: loc.pathname }} />;
  return (
    <LearnerProvider key={auth.identity.learnerKey} identity={auth.identity}>
      <FirstRun />
    </LearnerProvider>
  );
}

function FirstRun() {
  const { state } = useLearner();
  const loc = useLocation();
  if (!state.pre && loc.pathname === '/garden') return <Navigate to="/pre" replace />;
  return <Outlet />;
}

/** 데이터베이스 과목 첫 화면: 로그인했으면 나의 정원으로 */
function DbHome() {
  const auth = useAuth();
  if (auth.status === 'loading') return <div className="page" role="status">불러오는 중…</div>;
  if (auth.identity) return <Navigate to="/garden" replace />;
  return <StartPage />;
}

function NavTracker() {
  const loc = useLocation();
  const [first, setFirst] = useState(loc.pathname);
  // layout effect: 자식(FocusProvider)의 일반 effect보다 먼저 실행되어 첫 앱 내 이동도 정확히 기록된다
  useLayoutEffect(() => {
    if (loc.pathname !== first) {
      markInAppNavigation();
      setFirst(loc.pathname);
    }
    const subj = subjectOfPath(loc.pathname);
    if (subj) writeRaw(LAST_SUBJECT_KEY, subj);
    window.scrollTo(0, 0);
  }, [loc.pathname, first]);
  return null;
}

function PublicShell() {
  const auth = useAuth();
  const loc = useLocation();
  const inDb = subjectOfPath(loc.pathname) === 'db';
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand"><Garden level={30} small className="garden-mini" title="배움 숲" /> 배움 숲</Link>
        {inDb && <span className="crumbs">데이터베이스</span>}
        <span className="spacer" />
        {auth.identity?.kind === 'user' && (
          <>
            <span className="small muted">{auth.identity.name ?? auth.identity.email}</span>
            <button className="btn btn-small btn-quiet" onClick={() => void auth.signOut()}>로그아웃</button>
          </>
        )}
      </header>
      <main id="main"><Outlet /></main>
    </div>
  );
}

function PlaygroundRoute() {
  const auth = useAuth();
  if (auth.identity) return <Navigate to="/practice" replace />;
  return <Playground />;
}

/** 기본은 HashRouter(GitHub Pages). 비공개 미리보기처럼 주소 hash를 쓸 수 없는 곳은 VITE_ROUTER=memory */
const Router = import.meta.env.VITE_ROUTER === 'memory' ? MemoryRouter : HashRouter;

export function App() {
  return (
    <Router>
      <NavTracker />
      <Routes>
        <Route element={<PublicShell />}>
          <Route path="/" element={<SubjectHome />} />
          <Route path="/db" element={<DbHome />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/playground" element={<PlaygroundRoute />} />
        </Route>
        <Route element={<Protected />}>
          <Route element={<AppLayout />}>
            <Route path="/garden" element={<Dashboard />} />
            <Route path="/pre" element={<PrePage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/report" element={<ReportPage />} />
            <Route path="/practice" element={<Playground />} />
          </Route>
          <Route element={<LearningLayout />}>
            <Route path="/learn/:unitId" element={<UnitPage />} />
            <Route path="/learn/:unitId/checkpoint" element={<CheckpointPage />} />
            <Route path="/learn/:unitId/stage/:stage" element={<Suspense fallback={<div className="page" role="status">불러오는 중…</div>}><StagePage /></Suspense>} />
            <Route path="/learn/:unitId/:activityId" element={<ActivityPage />} />
            <Route path="/challenge/:challengeId" element={<ChallengePage />} />
            <Route path="/final" element={<FinalPage />} />
          </Route>
        </Route>
        <Route path="/computer/*" element={<Suspense fallback={loadingCourse}><ComputerRoutes /></Suspense>} />
        <Route path="/network/*" element={<Suspense fallback={loadingCourse}><NetworkRoutes /></Suspense>} />
        <Route path="/programming/*" element={<Suspense fallback={loadingCourse}><ProgrammingRoutes /></Suspense>} />
        {/* 'Data' 과목(/data). 데이터베이스 과목 경로(/db·/garden·/learn …)와 겹치지 않는다 */}
        <Route path="/data/*" element={<Suspense fallback={loadingCourse}><DataRoutes /></Suspense>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}
