import { useState } from 'react';
import { Link, NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { InAppNotice } from '../../components/InAppNotice';
import { Plant, PLANT_STAGES } from '../../components/Plant';
import { isSupabaseConfigured } from '../../lib/config';
import { useAuth } from '../auth/AuthContext';
import { CG_UNITS } from './content';
import { activeWrongIds, nextPlantGoal, passedCount, plantStage, TOTAL_STEPS } from './model';
import { CgProvider, useCg, type CgSaveStatus } from './store';
import { CgHome } from './pages/Home';
import { LevelPage, UnitPage } from './pages/Unit';
import { MockExamPage, MockHubPage } from './pages/Mock';
import { WrongNotePage } from './pages/Wrong';
import { TeacherPage } from './pages/Teacher';

const SAVE_TEXT: Record<CgSaveStatus, string> = { local: '이 기기에 저장', saving: '저장 중…', saved: '저장됨', offline: '오프라인(이 기기에 보관)', error: '저장 재시도 필요' };

function CgTopBar() {
  const auth = useAuth();
  const cg = useCg();
  const [unsaved, setUnsaved] = useState(false);
  const logout = async (force = false) => {
    if (!force && !(await cg.flush())) return setUnsaved(true);
    setUnsaved(false);
    await auth.signOut();
  };
  const stage = plantStage(cg.state);
  const wrong = activeWrongIds(cg.state).length;
  return (
    <header className="topbar">
      <Link to="/computer" className="brand" aria-label={`컴퓨터 일반 홈: 식물 ${PLANT_STAGES[stage]}`}>
        <span className="plant-mini"><Plant stage={stage} size={40} title={PLANT_STAGES[stage]} /></span>
        <span>컴퓨터 일반</span>
      </Link>
      <nav aria-label="컴퓨터 일반 메뉴">
        <NavLink to="/" end>과목</NavLink>
        <NavLink to="/computer" end>단원</NavLink>
        <NavLink to="/computer/mock">모의고사</NavLink>
        <NavLink to="/computer/wrong">오답노트{wrong ? ` ${wrong}` : ''}</NavLink>
        {cg.isTeacher && <NavLink to="/computer/teacher">반 학습 현황</NavLink>}
      </nav>
      <span className="spacer" />
      <span className="save-status" aria-live="polite">{cg.mode === 'guest' ? '로그인 없이 · 이 기기에만 저장' : SAVE_TEXT[cg.saveStatus]}</span>
      {cg.mode === 'user' ? (
        <button className="btn btn-small btn-quiet" onClick={() => void logout()}>로그아웃</button>
      ) : cg.mode === 'demo' ? (
        <button className="btn btn-small btn-quiet" onClick={auth.exitDemo}>데모 나가기</button>
      ) : isSupabaseConfigured ? (
        <button className="btn btn-small btn-primary" onClick={() => void auth.signIn('/computer')}>Google 로그인</button>
      ) : null}
      {unsaved && (
        <div className="notice notice-warn row cg-unsaved" role="alert">
          <span>아직 서버에 저장되지 않은 기록이 있어요(인터넷 연결 확인). 지금 로그아웃하면 이 기기의 기록이 지워져요.</span>
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
  if (cg.grewTo === null) return null;
  return (
    <div className="milestone" role="dialog" aria-label="식물이 자랐어요">
      <Plant stage={cg.grewTo} size={110} />
      <div className="stack" style={{ gap: '0.4rem' }}>
        <b>식물이 자랐어요: {PLANT_STAGES[cg.grewTo]}</b>
        <span className="small">통과한 단계 {passedCount(cg.state)}/{TOTAL_STEPS}. {nextPlantGoal(cg.state) ?? '열매까지 맺었어요!'}</span>
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

function CgLayout() {
  const cg = useCg();
  return (
    <div className="app-shell">
      <CgTopBar />
      <main id="main" className="page">
        <InAppNotice />
        <GuestImportBanner />
        {cg.loading ? <p role="status">내 기록을 불러오는 중…</p> : CG_UNITS.length ? <Outlet /> : (
          <div className="notice notice-warn">컴퓨터 일반 문제은행을 준비하고 있어요. 잠시 후 다시 들어와 주세요.</div>
        )}
      </main>
      <GrowthToast />
    </div>
  );
}

export function ComputerRoutes() {
  const auth = useAuth();
  if (auth.status === 'loading') return <div className="page" role="status">불러오는 중…</div>;
  // 사용자가 바뀌면(로그아웃·다른 계정) 화면 상태를 통째로 새로: 앞 사람의 풀이가 다음 사람에게 넘어가지 않게
  return (
    <CgProvider key={auth.identity?.learnerKey ?? 'guest'}>
      <Routes>
        <Route element={<CgLayout />}>
          <Route index element={<CgHome />} />
          <Route path="unit/:unitId" element={<UnitPage />} />
          <Route path="unit/:unitId/:level" element={<LevelPage />} />
          <Route path="mock" element={<MockHubPage />} />
          <Route path="mock/:kind" element={<MockExamPage />} />
          <Route path="wrong" element={<WrongNotePage />} />
          <Route path="teacher" element={<TeacherPage />} />
          <Route path="*" element={<Navigate to="/computer" replace />} />
        </Route>
      </Routes>
    </CgProvider>
  );
}

export default ComputerRoutes;
