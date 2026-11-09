import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Garden } from '../components/Garden';
import { InAppNotice } from '../components/InAppNotice';
import { Plant } from '../components/Plant';
import { useAuth } from '../features/auth/AuthContext';
import { MOCK_SIZE, NEW_COURSES, selfCheckOf, type NewCourseDef, type NewCourseId } from '../features/computer/courses/defs';
import { readRaw } from '../lib/storage';

export const LAST_SUBJECT_KEY = 'sqlforest:last-subject';
export type SubjectId = 'db' | 'cg' | NewCourseId;

/** 경로로 과목을 판정(최근 과목 표시용) */
export function subjectOfPath(path: string): SubjectId | null {
  if (/^\/computer(\/|$)/.test(path)) return 'cg';
  for (const c of NEW_COURSES) if (path === c.path || path.startsWith(`${c.path}/`)) return c.id;
  if (/^\/(db|garden|learn|challenge|final|pre|review|report|practice)(\/|$)/.test(path)) return 'db';
  return null;
}

interface SubjectCard {
  id: SubjectId;
  name: string;
  summary: string;
  facts: string[];
  to: (signedIn: boolean) => string;
  art: ReactNode;
}

const SUBJECTS: SubjectCard[] = [
  {
    id: 'db',
    name: '데이터베이스',
    summary: '표를 만들고, 조회하고, 연결하고, 묶어 보는 SQL을 12단원에서 직접 실행하며 익혀요. 배울수록 씨앗이 숲으로 자라요.',
    facts: ['12단원 · 약 6시간', '브라우저에서 실제 SQL 실행', '레벨 0 → 99 숲 키우기'],
    to: (signedIn) => (signedIn ? '/garden' : '/db'),
    art: <Garden level={40} small title="데이터베이스: 숲" />,
  },
  {
    id: 'cg',
    name: '컴퓨터 일반',
    summary: '자료 표현·하드웨어·운영체제부터 네트워크·보안까지 8단원을 단계별로 익히고, 모의고사로 실력을 점검해요. 통과할수록 식물이 자라요.',
    facts: ['8단원 × 5단계', '모의고사 50문항 · 50분', '오답노트 자동 정리'],
    to: () => '/computer',
    art: <Plant stage={5} size={150} title="컴퓨터 일반: 꽃 핀 식물" />,
  },
  // 같은 단원 × 5단계 구조의 새 과목들. 첫 화면에는 과목 이름·소개만(자격증 이름은 각 과목 화면에서 작게만)
  ...NEW_COURSES.filter((c) => (c.group ?? 'main') === 'main').map((c, i) => courseCard(c, [3, 4, 6][i] ?? 4)),
  // 기초 다듬기: 정규 과목과 같은 큰 카드로 맨 아래(2026-11-09 선생님 요청)
  ...NEW_COURSES.filter((c) => c.group === 'foundation').map((c) => courseCard(c, 2)),
];

function courseCard(c: NewCourseDef, plant: number): SubjectCard {
  const m = MOCK_SIZE[c.size ?? 'full'];
  const sc = selfCheckOf(c);
  return {
    id: c.id,
    name: c.name,
    summary: c.summary,
    facts: [`${c.units.length}단원 × 5단계`, sc ? `단원마다 ${sc.size}문항 실력점검` : `모의고사 ${m.total}문항 · ${m.minutes}분`, sc ? `모의고사 ${m.total}문항 · ${m.minutes}분` : '오답노트 자동 정리'],
    to: () => c.path,
    art: <Plant stage={plant} size={150} title={`${c.name}: 자라는 식물`} />,
  };
}

/** 예전 보충 학습(2진법 이해·IP 이해)을 마지막으로 공부했으면 기초 다듬기에 '최근 공부' */
const LEGACY_SUBJECT: Record<string, SubjectId> = { bin: 'basic', ip: 'basic' };

export function SubjectHome() {
  const auth = useAuth();
  const signedIn = !!auth.identity;
  const raw = readRaw(LAST_SUBJECT_KEY);
  const last = (raw && Object.hasOwn(LEGACY_SUBJECT, raw) ? LEGACY_SUBJECT[raw] : raw) as SubjectId | null;
  return (
    <div className="page">
      <InAppNotice />
      <section className="subject-head">
        <h1>무엇을 공부할까요?</h1>
        <p className="muted">과목을 고르면 그 과목의 단원과 성장 기록이 열려요. 로그인하면 어느 기기에서든 이어서 할 수 있어요.</p>
        {auth.authError && (
          <div className="notice notice-warn" role="alert">
            로그인을 마치지 못했어요: {auth.authError}. 다시 시도해 주세요.
            <button className="btn btn-small btn-quiet" onClick={auth.clearError}>닫기</button>
          </div>
        )}
      </section>
      <div className="subject-grid">
        {SUBJECTS.map((s) => (
          <Link key={s.id} to={s.to(signedIn)} className="subject-card panel" aria-describedby={`subj-${s.id}`}>
            <div className="subject-art" aria-hidden="true">{s.art}</div>
            <div className="stack" style={{ gap: '0.4rem' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2 style={{ margin: 0 }}>{s.name}</h2>
                {last === s.id && <span className="badge badge-exec">최근 공부</span>}
              </div>
              <p id={`subj-${s.id}`} style={{ margin: 0 }}>{s.summary}</p>
              <ul className="subject-facts">
                {s.facts.map((f) => <li key={f}>{f}</li>)}
              </ul>
              <span className="subject-go">{signedIn ? '이어서 공부하기 →' : '시작하기 →'}</span>
            </div>
          </Link>
        ))}
      </div>
      <p className="small muted" style={{ marginTop: '1.5rem' }}><Link to="/about">저장 방식·도구의 한계 안내</Link> · <a href={`${import.meta.env.BASE_URL}privacy.html`}>개인정보처리방침</a></p>
    </div>
  );
}
