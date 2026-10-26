import { useState } from 'react';
import { Link, NavLink, Navigate, Outlet, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { FocusGate, FocusProvider, type StrictScope } from '../focus/FocusContext';
import { suspendLearning } from '../focus/fullscreen';
import { learnerPrefix, removeRaw, removeWithPrefix } from '../../lib/storage';
import { InAppNotice } from '../../components/InAppNotice';
import { Plant, PLANT_STAGES } from '../../components/Plant';
import { isSupabaseConfigured } from '../../lib/config';
import { useAuth } from '../auth/AuthContext';
import { CourseProvider, unitHasContent, useCourse, type CourseConfig } from './course';
import { activeWrongIds, addLock, lockCount, LOCK_LIMIT, nextPlantGoal, passedCount, plantStage } from './model';
import { CgProvider, useCg, type CgSaveStatus } from './store';
import { CgHome } from './pages/Home';
import { LevelPage, UnitPage } from './pages/Unit';
import { MockExamPage, MockHubPage } from './pages/Mock';
import { WrongNotePage } from './pages/Wrong';
import { TeacherPage } from './pages/Teacher';
import { LiveIndicator } from '../monitor/LiveIndicator';

/**
 * 단원 × 5단계 과목 화면(컴퓨터 일반·네트워크·프로그래밍·Data 공통 엔진).
 * 과목마다 자기 문제은행만 내려받도록 이 파일은 문제은행을 가져오지 않고 CourseRoutes의 course로 받는다.
 */
const SAVE_TEXT: Record<CgSaveStatus, string> = { local: '이 기기에 저장', saving: '저장 중…', saved: '저장됨', offline: '오프라인(이 기기에 보관)', error: '저장 재시도 필요' };

function CourseTopBar() {
  const auth = useAuth();
  const cg = useCg();
  const course = useCourse();
  const base = course.basePath;
  const [unsaved, setUnsaved] = useState(false);
  const logout = async (force = false) => {
    if (!force && !(await cg.flush())) return setUnsaved(true);
    if (!(await auth.signOut(force))) return setUnsaved(true); // 다른 과목에 저장 안 된 기록
    setUnsaved(false);
  };
  const stage = plantStage(cg.state, course);
  const wrong = activeWrongIds(cg.state).length;
  return (
    <header className="topbar">
      <Link to={base} className="brand" aria-label={`${course.name} 홈: 식물 ${PLANT_STAGES[stage]}`}>
        <span className="plant-mini"><Plant stage={stage} size={40} title={PLANT_STAGES[stage]} /></span>
        <span>{course.name}</span>
      </Link>
      <nav aria-label={`${course.name} 메뉴`}>
        <NavLink to="/" end>과목</NavLink>
        <NavLink to={base} end>단원</NavLink>
        <NavLink to={`${base}/mock`}>모의고사</NavLink>
        <NavLink to={`${base}/wrong`}>오답노트{wrong ? ` ${wrong}` : ''}</NavLink>
        {/* 선생님 계정만(서버가 다시 확인): 선생님 화면의 이 과목 탭 */}
        {cg.isTeacher && <NavLink to={`/teacher?s=${course.id}`} className="teacher-link">선생님 화면</NavLink>}
      </nav>
      <span className="spacer" />
      <LiveIndicator />
      <span className="save-status" aria-live="polite">{cg.mode === 'guest' ? '로그인 없이 · 이 기기에만 저장' : SAVE_TEXT[cg.saveStatus]}</span>
      {cg.mode === 'user' ? (
        <button className="btn btn-small btn-quiet" onClick={() => void logout()}>로그아웃</button>
      ) : cg.mode === 'demo' ? (
        <button className="btn btn-small btn-quiet" onClick={auth.exitDemo}>데모 나가기</button>
      ) : isSupabaseConfigured ? (
        <button className="btn btn-small btn-primary" onClick={() => { suspendLearning(); void auth.signIn(base); }}>Google 로그인</button>
      ) : null}
      {unsaved && (
        <div className="notice notice-warn row cg-unsaved" role="alert">
          <span>아직 서버에 저장되지 않은 기록이 있어요(인터넷 연결 확인). 지금 로그아웃하면 이 기기의 기록이 지워져요. 다른 과목이라면 그 과목 화면을 한 번 열면 다시 저장돼요.</span>
          <button className="btn btn-small" onClick={() => void logout()}>다시 저장해 보기</button>
          <button className="btn btn-small btn-quiet" onClick={() => void logout(true)}>그래도 로그아웃</button>
          <button className="btn btn-small btn-quiet" onClick={() => setUnsaved(false)}>취소</button>
        </div>
      )}
    </header>
  );
}

function GrowthToast() {
  const cg = useCg();
  const course = useCourse();
  if (cg.grewTo === null) return null;
  return (
    <div className="milestone" role="dialog" aria-label="식물이 자랐어요">
      <Plant stage={cg.grewTo} size={110} />
      <div className="stack" style={{ gap: '0.4rem' }}>
        <b>식물이 자랐어요: {PLANT_STAGES[cg.grewTo]}</b>
        <span className="small">통과한 단계 {passedCount(cg.state, course)}/{course.totalSteps}. {nextPlantGoal(cg.state, course) ?? '열매까지 맺었어요!'}</span>
        <div className="row"><button className="btn btn-small" onClick={cg.clearGrew}>닫기</button></div>
      </div>
    </div>
  );
}

function GuestImportBanner() {
  const cg = useCg();
  if (!cg.guestToImport || cg.mode !== 'user') return null;
  return (
    <div className="notice row" role="status" style={{ marginBottom: '1rem' }}>
      <span>이 기기에 로그인 없이 공부한 기록이 있어요. 내 계정으로 가져올까요?</span>
      <button className="btn btn-small btn-primary" onClick={cg.importGuest}>내 계정으로 가져오기</button>
      <button className="btn btn-small btn-quiet" onClick={cg.discardGuest}>가져오지 않고 지우기</button>
    </div>
  );
}

function CourseLayout() {
  const cg = useCg();
  const course = useCourse();
  const ready = course.units.some(unitHasContent);
  return (
    <div className="app-shell">
      <CourseTopBar />
      <main id="main" className="page">
        <InAppNotice />
        <GuestImportBanner />
        {cg.loading ? <p role="status">내 기록을 불러오는 중…</p> : ready ? <Outlet /> : (
          <div className="notice notice-warn">{course.name} 문제은행을 준비하고 있어요. 잠시 후 다시 들어와 주세요.</div>
        )}
      </main>
      <GrowthToast />
    </div>
  );
}

const noop = () => {};

/**
 * 단원 화면(단원 보기·1~5단계): 전체화면 집중 학습. 포커스를 잃거나 전체화면을 나가면 잠기고,
 * 한 단원에서 5번 잠기면 그 단원의 진도·점수(단계 기록·카드·풀던 초안)를 초기화한다.
 */
function CourseUnitShell() {
  const { unitId } = useParams();
  const course = useCourse();
  const u = course.unitById(unitId ?? '');
  const cg = useCg();
  const auth = useAuth();
  const nav = useNavigate();
  const prefix = learnerPrefix(auth.identity ? auth.identity.learnerKey : 'guest');
  const base = course.basePath;
  if (!u) return <Navigate to={base} replace />;
  const strict: StrictScope = {
    key: `${course.id}:${u.id}`,
    label: `${u.num}단원`,
    locks: lockCount(cg.state, u.id),
    limit: LOCK_LIMIT,
    onLock: () => {
      let out = { count: 0, reset: false };
      cg.commit((s) => {
        const r = addLock(s, u.id);
        out = { count: r.count, reset: r.reset };
        return r.state;
      });
      if (out.reset) {
        // 풀던 빈칸·객관식 초안도 함께 지운다(U1 초기화가 U10 초안을 지우지 않게 빈칸은 정확한 키로)
        removeRaw(`${prefix}${course.storage}:blanks:${u.id}`);
        removeWithPrefix(`${prefix}${course.storage}:run:${u.id}:`);
        nav(`${base}/unit/${u.id}/1`, { replace: true });
      }
      return out;
    },
  };
  return (
    <FocusProvider strict={strict} interruptSql={false} onActiveSeconds={noop} onPause={noop}>
      <FocusGate exit={{ to: base, label: '단원 목록으로 나가기' }}>
        <div key={cg.state.resets[u.id]?.n ?? 0}><Outlet /></div>
      </FocusGate>
    </FocusProvider>
  );
}

/** 과목 하나의 화면 전체(과목 경로 아래: '/computer/*', '/network/*' …) */
export function CourseRoutes({ course }: { course: CourseConfig }) {
  const auth = useAuth();
  if (auth.status === 'loading') return <div className="page" role="status">불러오는 중…</div>;
  // 사용자가 바뀌면(로그아웃·다른 계정) 화면 상태를 통째로 새로: 앞 사람의 풀이가 다음 사람에게 넘어가지 않게
  return (
    <CourseProvider course={course}>
      <CgProvider key={`${course.id}:${auth.identity?.learnerKey ?? 'guest'}`}>
        <Routes>
          <Route element={<CourseLayout />}>
            <Route index element={<CgHome />} />
            <Route path="unit/:unitId" element={<CourseUnitShell />}>
              <Route index element={<UnitPage />} />
              <Route path=":level" element={<LevelPage />} />
            </Route>
            <Route path="mock" element={<MockHubPage />} />
            <Route path="mock/:kind" element={<MockExamPage />} />
            <Route path="wrong" element={<WrongNotePage />} />
            {/* 예전 '반 학습 현황' 주소: 선생님 화면(/teacher?s=과목)으로 보낸다 */}
            <Route path="teacher" element={<TeacherPage />} />
            <Route path="*" element={<Navigate to={course.basePath} replace />} />
          </Route>
        </Routes>
      </CgProvider>
    </CourseProvider>
  );
}
