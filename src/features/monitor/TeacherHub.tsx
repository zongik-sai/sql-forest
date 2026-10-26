import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isSupabaseConfigured } from '../../lib/config';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../auth/supabase';
import type { CourseConfig } from '../computer/course';
import { CourseClass, DbClass } from '../computer/pages/Teacher';
import { supabaseMonitorApi } from './api';
import { LiveMonitor } from './LiveMonitor';
import { SUBJECT_LIST } from './liveState';
import { useIsTeacher } from './useTeacher';

/**
 * 선생님 화면(/teacher, ?s=과목 ID로 그 탭을 연다). 지정된 선생님 계정만(am_i_teacher), 다른 사람에게는 설명만 보이고 자료는 읽지 않는다.
 * 자료를 읽는 RPC도 서버가 선생님인지 다시 확인한다. 과목 탭은 defs.ts의 과목 목록에서 만든다(새 과목은 자동으로 추가).
 */
const COURSE_MODULES = import.meta.glob<{ COURSE: CourseConfig }>('../computer/courses/*.tsx');

export async function loadCourse(id: string): Promise<CourseConfig> {
  if (id === 'cg') return (await import('../computer/content')).CG_COURSE;
  const load = COURSE_MODULES[`../computer/courses/${id}.tsx`];
  if (!load) throw new Error(`과목을 찾을 수 없어요: ${id}`);
  return (await load()).COURSE;
}

const TABS = [{ id: 'live', name: '실시간 모니터링' }, ...SUBJECT_LIST.map((s) => ({ id: s.id as string, name: s.name }))];

export function TeacherHub() {
  const auth = useAuth();
  const teacher = useIsTeacher();
  const [params, setParams] = useSearchParams();
  const raw = params.get('s');
  const tab = TABS.some((t) => t.id === raw) ? raw! : 'live';
  const api = useMemo(() => {
    const sb = supabase();
    return sb ? supabaseMonitorApi(sb) : null;
  }, []);

  if (!isSupabaseConfigured || !api) {
    return <div className="page page-narrow"><h1>선생님 화면</h1><p className="notice notice-warn">로그인 설정(Supabase)이 없어 선생님 화면을 쓸 수 없어요.</p></div>;
  }
  if (auth.status === 'loading' || (auth.identity?.kind === 'user' && teacher === null)) {
    return <div className="page" role="status">선생님 계정인지 확인하는 중…</div>;
  }
  if (!teacher) {
    return (
      <div className="page page-narrow stack">
        <h1>선생님 화면</h1>
        <p className="notice">이 화면은 학교에서 지정한 선생님 계정만 볼 수 있어요. 학생 기록은 선생님 계정이 확인된 뒤에만 서버가 보내 줘요.</p>
        {auth.identity?.kind !== 'user' && (
          <div className="row"><button className="btn btn-primary" onClick={() => void auth.signIn('/teacher')}>선생님 Google 계정으로 로그인</button></div>
        )}
      </div>
    );
  }
  const go = (id: string) => setParams({ s: id }, { replace: true });
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    go(next.id);
    document.getElementById(`t-tab-${next.id}`)?.focus();
  };
  return (
    <div className="page stack t-hub">
      <h1 style={{ margin: 0 }}>선생님 화면</h1>
      <div className="seg t-tabs" role="tablist" aria-label="선생님 화면 메뉴" onKeyDown={onKey}>
        {TABS.map((t) => (
          <button key={t.id} id={`t-tab-${t.id}`} role="tab" aria-selected={tab === t.id} aria-controls="t-panel" tabIndex={tab === t.id ? 0 : -1} className={tab === t.id ? 'on' : ''} onClick={() => go(t.id)}>
            {t.name}
          </button>
        ))}
      </div>
      <section id="t-panel" role="tabpanel" aria-labelledby={`t-tab-${tab}`}>
        {tab === 'live' ? <LiveMonitor api={api} /> : tab === 'db' ? <DbClass /> : <CourseTab key={tab} id={tab} />}
      </section>
      <p className="small muted">점수는 학생 브라우저가 저장한 자기 학습 기록이라 조작될 수 있어요. 평가 근거가 아니라 학습 지원용으로 활용해 주세요.</p>
    </div>
  );
}

function CourseTab({ id }: { id: string }) {
  const [course, setCourse] = useState<CourseConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadCourse(id).then((c) => alive && setCourse(c), (e) => alive && setErr(String((e as Error).message ?? e)));
    return () => {
      alive = false;
    };
  }, [id]);
  if (err) return <p className="notice notice-warn">과목을 불러오지 못했어요: {err}</p>;
  if (!course) return <p role="status">과목 문제은행을 불러오는 중…</p>;
  return <CourseClass course={course} />;
}

export default TeacherHub;
