import { NEW_COURSES } from '../computer/courses/defs';
import type { CourseId } from '../computer/course';
import { MOCK_LABEL } from '../computer/model';
import { CG_LEVEL_NAME, type CgLevel } from '../computer/types';
import type { FocusSnapshot } from '../focus/focusSignal';
import { STAGE_NAME } from '../progress/model';

/**
 * 실시간 학습 위치(순수 함수, 테스트 대상). 학생 브라우저가 15초마다·바뀔 때 보내는 작은 상태와,
 * 선생님 화면이 그 상태를 읽어 보여 주는 규칙. 화면 내용·키 입력·다른 사이트 정보는 담지 않는다.
 * 서버 형식 검사: supabase/migrations/20261026010000_monitoring.sql private.live_state_ok
 */
export type SubjectKey = 'db' | CourseId;

/** 과목 목록(선생님 화면 탭 순서). 새 과목은 defs.ts에 추가하면 자동으로 들어온다 */
export const SUBJECT_LIST: { id: SubjectKey; name: string; path: string }[] = [
  { id: 'db', name: '데이터베이스', path: '/db' },
  { id: 'cg', name: '컴퓨터 일반', path: '/computer' },
  ...NEW_COURSES.map((c) => ({ id: c.id, name: c.name, path: c.path })),
];
export const subjectName = (id: string | null | undefined) => SUBJECT_LIST.find((s) => s.id === id)?.name ?? '';

/** 집중 상태: learning 학습 중 · locked 잠김(가림) · break 쉬기·시작 전 · menu 메뉴·목록 · idle 2분 동안 입력 없음 · hidden 다른 탭·창 */
export type LiveFocus = 'learning' | 'locked' | 'break' | 'menu' | 'idle' | 'hidden';
export const LIVE_FOCUS: readonly LiveFocus[] = ['learning', 'locked', 'break', 'menu', 'idle', 'hidden'];

export interface LiveState {
  v: 1;
  subject: SubjectKey | null;
  /** 앱 안 경로(예: /computer/unit/U3/3) */
  path: string;
  unit: string | null;
  /** 단계·활동 ID(예: '3', 'stage:2', 'activity:U03-A02', 'mock:set1') */
  step: string | null;
  /** 사람이 읽는 위치(예: '3단원 · 3단계 기초 객관식') */
  label: string;
  /** 문항 위치 등(예: '문항 7/20') */
  detail: string | null;
  focus: LiveFocus;
  /** 전체화면인지 */
  fs: boolean;
  /** 지금 단원에서 잠긴 횟수(단원 집중 학습 중일 때만) */
  locks: number | null;
  /** 선생님에게 화면을 보여 주는 중인지 */
  sharing: boolean;
}

export interface LiveLocation {
  subject: SubjectKey | null;
  unit: string | null;
  step: string | null;
  label: string;
  /** 메뉴가 아니라 학습 활동 화면인지(모의고사·단원·진단) */
  activity: boolean;
}

const COURSE_PATHS: { id: CourseId; path: string }[] = [{ id: 'cg', path: '/computer' }, ...NEW_COURSES.map((c) => ({ id: c.id, path: c.path }))];
const DB_PAGES: Record<string, [string, boolean]> = {
  '/db': ['시작 화면', false], '/garden': ['나의 정원', false], '/pre': ['사전 진단', true], '/review': ['오답 복습', false],
  '/report': ['보고서', false], '/practice': ['자유 실습장', false], '/final': ['최종 진단', true],
};
const OTHER_PAGES: Record<string, string> = { '/': '과목 선택', '/about': '안내', '/setup': '설정 안내', '/playground': '자유 실습장', '/teacher': '선생님 화면' };

/** 서버로 보내는 경로: 앱 안 경로 문자만, 200자 이하 */
export const cleanPath = (p: string) => (p.split(/[?#]/)[0].replace(/[^A-Za-z0-9/_-]/g, '') || '/').slice(0, 200);

/** 경로 → 과목·단원·단계와 사람이 읽는 이름 */
export function deriveLocation(rawPath: string): LiveLocation {
  const path = cleanPath(rawPath);
  const none = (label: string, subject: SubjectKey | null = null, activity = false): LiveLocation => ({ subject, unit: null, step: null, label, activity });
  const course = COURSE_PATHS.find((c) => path === c.path || path.startsWith(`${c.path}/`));
  if (course) {
    const rest = path.slice(course.path.length).split('/').filter(Boolean);
    if (rest.length === 0) return none('단원 목록', course.id);
    if (rest[0] === 'unit' && rest[1]) {
      const unit = rest[1].slice(0, 8);
      const n = /^U(\d{1,2})$/.exec(unit)?.[1];
      const head = n ? `${Number(n)}단원` : unit;
      const lv = Number(rest[2]);
      if (rest[2] && lv >= 1 && lv <= 5) return { subject: course.id, unit, step: String(lv), label: `${head} · ${lv}단계 ${CG_LEVEL_NAME[lv as CgLevel]}`, activity: true };
      return { subject: course.id, unit, step: null, label: `${head} · 단원 보기`, activity: true };
    }
    if (rest[0] === 'mock') {
      if (!rest[1]) return none('모의고사 목록', course.id);
      const kind = rest[1].slice(0, 16);
      return { subject: course.id, unit: null, step: `mock:${kind}`, label: (MOCK_LABEL as Record<string, string>)[kind] ?? '모의고사', activity: true };
    }
    if (rest[0] === 'wrong') return none('오답노트', course.id);
    if (rest[0] === 'teacher') return none('선생님 화면', course.id);
    return none('단원 목록', course.id);
  }
  const learn = /^\/(?:learn\/|challenge\/CH-)(U(\d{2}))(?:\/(.*))?$/.exec(path);
  if (learn) {
    const [, unit, num] = learn;
    const head = `${Number(num)}단원`;
    if (path.startsWith('/challenge/')) return { subject: 'db', unit, step: 'challenge', label: `${head} · 도전`, activity: true };
    const sub = learn[3] ?? '';
    if (!sub) return { subject: 'db', unit, step: null, label: `${head} · 단원 보기`, activity: true };
    if (sub === 'checkpoint') return { subject: 'db', unit, step: 'checkpoint', label: `${head} · 체크포인트`, activity: true };
    const st = /^stage\/([1-4])$/.exec(sub);
    if (st) return { subject: 'db', unit, step: `stage:${st[1]}`, label: `${head} · ${st[1]}단계 ${STAGE_NAME[Number(st[1]) as 1 | 2 | 3 | 4]}`, activity: true };
    const act = /^(U\d{2}-A(\d{2}))$/.exec(sub);
    if (act) return { subject: 'db', unit, step: `activity:${act[1]}`, label: `${head} · 활동 ${Number(act[2])}`, activity: true };
    return { subject: 'db', unit, step: null, label: head, activity: true };
  }
  const db = DB_PAGES[path];
  if (db) return none(db[0], 'db', db[1]);
  return none(OTHER_PAGES[path] ?? '기타 화면');
}

export interface FocusInput {
  visible: boolean;
  hasFocus: boolean;
  /** 2분 동안 입력 없음 */
  idle: boolean;
  /** 학습 세션(집중모드) 상태. 밖이면 null */
  session: FocusSnapshot | null;
  /** 학습 활동 화면(모의고사 등)인지 */
  activity: boolean;
}

/** 집중 상태 판정 */
export function deriveFocus(i: FocusInput): LiveFocus {
  if (!i.visible) return 'hidden';
  if (i.session) {
    if (i.session.status === 'active') return i.idle ? 'idle' : 'learning';
    const r = i.session.reason;
    if (r === 'hidden' || r === 'blur' || r === 'pagehide' || r === 'fullscreen') return 'locked';
    return 'break'; // 쉬기·시작 전·새로고침 뒤·화면 공유 창
  }
  if (!i.hasFocus) return 'hidden'; // 다른 창을 보고 있음
  if (i.idle) return 'idle';
  return i.activity ? 'learning' : 'menu';
}

export function buildLiveState(i: { path: string; detail: string | null; fs: boolean; sharing: boolean } & Omit<FocusInput, 'activity'>): LiveState {
  const loc = deriveLocation(i.path);
  return {
    v: 1,
    subject: loc.subject,
    path: cleanPath(i.path),
    unit: loc.unit,
    step: loc.step,
    label: loc.label.slice(0, 120),
    detail: i.detail ? i.detail.slice(0, 80) : null,
    focus: deriveFocus({ ...i, activity: loc.activity }),
    fs: i.fs,
    locks: i.session?.strict ? Math.max(0, Math.min(99, i.session.strict.locks)) : null,
    sharing: i.sharing,
  };
}

/* ---------------- 선생님 화면 ---------------- */

export type LiveChip = 'learning' | 'locked' | 'break' | 'menu' | 'away' | 'offline';
export const CHIP_LABEL: Record<LiveChip, string> = {
  learning: '집중 학습 중', locked: '잠김', break: '쉬는 중', menu: '메뉴', away: '자리 비움', offline: '오프라인',
};
/** 이 시간 넘게 소식이 없으면 오프라인(학생 브라우저는 15초마다 보냄) */
export const OFFLINE_AFTER_MS = 2 * 60 * 1000;
/** 상태순 정렬: 살펴볼 학생이 먼저 */
export const CHIP_ORDER: LiveChip[] = ['locked', 'away', 'break', 'menu', 'learning', 'offline'];

/** 서버에서 받은 상태를 안전하게 읽는다(모르는 값은 기본값) */
export function normalizeLiveState(raw: unknown): LiveState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : null);
  const subject = SUBJECT_LIST.some((s) => s.id === r.subject) ? (r.subject as SubjectKey) : null;
  return {
    v: 1,
    subject,
    path: str(r.path, 200) ?? '',
    unit: str(r.unit, 32),
    step: str(r.step, 64),
    label: str(r.label, 120) ?? '',
    detail: str(r.detail, 80),
    focus: LIVE_FOCUS.includes(r.focus as LiveFocus) ? (r.focus as LiveFocus) : 'menu',
    fs: r.fs === true,
    locks: typeof r.locks === 'number' ? r.locks : null,
    sharing: r.sharing === true,
  };
}

export function chipOf(s: LiveState, updatedAt: string, now: number): LiveChip {
  const t = Date.parse(updatedAt);
  if (!Number.isFinite(t) || now - t > OFFLINE_AFTER_MS) return 'offline';
  if (s.focus === 'idle' || s.focus === 'hidden') return 'away';
  return s.focus;
}

/** '방금' · 'N초 전' · 'N분 전' · 'N시간 전' */
export function agoText(updatedAt: string, now: number): string {
  const sec = Math.max(0, Math.round((now - Date.parse(updatedAt)) / 1000));
  if (!Number.isFinite(sec)) return '-';
  if (sec < 5) return '방금';
  if (sec < 60) return `${sec}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  return `${Math.floor(sec / 3600)}시간 전`;
}

export interface LiveRow {
  user_id: string;
  name: string | null;
  email: string | null;
  state: unknown;
  updated_at: string;
}

export interface LiveStudent {
  id: string;
  name: string;
  email: string;
  state: LiveState;
  updatedAt: string;
  chip: LiveChip;
}

export function toLiveStudents(rows: LiveRow[], now: number): LiveStudent[] {
  return rows.map((r) => {
    const state = normalizeLiveState(r.state);
    return {
      id: r.user_id, name: r.name || (r.email ?? '').split('@')[0] || '(이름 없음)', email: r.email ?? '',
      state, updatedAt: r.updated_at, chip: chipOf(state, r.updated_at, now),
    };
  });
}

export type LiveSort = 'status' | 'name' | 'recent';
export function sortLive(list: LiveStudent[], by: LiveSort): LiveStudent[] {
  const byName = (a: LiveStudent, b: LiveStudent) => a.name.localeCompare(b.name, 'ko');
  return [...list].sort((a, b) => {
    if (by === 'name') return byName(a, b);
    if (by === 'recent') return b.updatedAt.localeCompare(a.updatedAt) || byName(a, b);
    return CHIP_ORDER.indexOf(a.chip) - CHIP_ORDER.indexOf(b.chip) || byName(a, b);
  });
}
