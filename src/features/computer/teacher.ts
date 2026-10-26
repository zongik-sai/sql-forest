import { activeWrongIds, bestRegularMock, CG_SHAPE, mockSizeOf, normalizeCgState, passedCount, plantStage, unitLevel, type CgState, type CourseShape } from './model';
import type { CgUnitId } from './types';

/**
 * 선생님 반 학습 현황 집계(순수 함수, 테스트 대상). 과목 단원 목록은 shape로 받는다(생략하면 컴퓨터 일반).
 * 행 형식은 cg_class_overview()와 course_class_overview(p_course)가 같다.
 */
export interface CgClassRow {
  user_id: string;
  name: string | null;
  email: string | null;
  state: unknown;
  updated_at: string;
}

export interface CgStudent {
  id: string;
  name: string;
  email: string;
  state: CgState;
  plant: number;
  passed: number;
  levels: Record<CgUnitId, number>;
  mockBest: number;
  mockPassed: boolean;
  wrong: number;
  lastAt: string;
}

export function toStudents(rows: CgClassRow[], shape: CourseShape = CG_SHAPE): CgStudent[] {
  return rows.map((r) => {
    const s = normalizeCgState(r.state, shape);
    const levels = Object.fromEntries(shape.unitIds.map((u) => [u, unitLevel(s, u)])) as Record<CgUnitId, number>;
    const best = bestRegularMock(s, shape);
    return {
      id: r.user_id, name: r.name || (r.email ?? '').split('@')[0] || '(이름 없음)', email: r.email ?? '', state: s,
      plant: plantStage(s, shape), passed: passedCount(s, shape), levels, mockBest: best, mockPassed: best >= mockSizeOf(shape).need,
      wrong: activeWrongIds(s).length, lastAt: r.updated_at,
    };
  });
}

export function classSummary(students: CgStudent[], now = Date.now(), shape: CourseShape = CG_SHAPE) {
  const n = students.length;
  const week = 7 * 24 * 3600 * 1000;
  const active7 = students.filter((s) => now - Date.parse(s.lastAt) <= week).length;
  const avgPassed = n ? students.reduce((a, s) => a + s.passed, 0) / n : 0;
  const mockPassed = students.filter((s) => s.mockPassed).length;
  const unitAvg = Object.fromEntries(shape.unitIds.map((u) => [u, n ? students.reduce((a, s) => a + (s.levels[u] ?? 0), 0) / n : 0])) as Record<CgUnitId, number>;
  const wrongCount = new Map<string, number>();
  for (const s of students) for (const q of activeWrongIds(s.state)) wrongCount.set(q, (wrongCount.get(q) ?? 0) + 1);
  const topWrong = [...wrongCount.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 8);
  return { n, active7, avgPassed, mockPassed, unitAvg, topWrong };
}

/** CSV(엑셀 한글 깨짐 방지 BOM 포함) */
export function toCsv(header: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const t = String(v);
    // 수식 주입 방지: = + - @ 탭 CR로 시작하면 앞에 작은따옴표
    const safe = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
}

export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------------- 더 자세히(선생님 화면) ---------------- */

const LV = [1, 2, 3, 4, 5] as const;

/** 단원별 반 통계: 단계별 통과율(0~1), 평균 레벨, 지금 잠김 합계, 초기화 합계와 초기화된 학생 수 */
export interface UnitClassStat {
  unitId: CgUnitId;
  passRate: number[];
  avgLevel: number;
  locksNow: number;
  resets: number;
  studentsReset: number;
}

export function unitClassStats(students: CgStudent[], shape: CourseShape = CG_SHAPE): UnitClassStat[] {
  const n = students.length;
  return shape.unitIds.map((u) => ({
    unitId: u,
    passRate: LV.map((lv) => (n ? students.filter((s) => !!s.state.units[u]?.[`lv${lv}`]?.passedAt).length / n : 0)),
    avgLevel: n ? students.reduce((a, s) => a + (s.levels[u] ?? 0), 0) / n : 0,
    locksNow: students.reduce((a, s) => a + (s.state.locks[u]?.length ?? 0), 0),
    resets: students.reduce((a, s) => a + (s.state.resets[u]?.n ?? 0), 0),
    studentsReset: students.filter((s) => (s.state.resets[u]?.n ?? 0) > 0).length,
  }));
}

/**
 * 문항별 오답: 틀린 적 있는 학생 수(오답노트에 한 번이라도 들어간 학생), 지금 오답노트에 남은 학생 수, 틀린 횟수 합.
 * 학생이 고른 보기는 기록하지 않으므로 '가장 많이 고른 오답'은 알 수 없다.
 */
export interface QuestionStat { id: string; students: number; active: number; times: number }

export function questionStats(students: CgStudent[]): QuestionStat[] {
  const m = new Map<string, QuestionStat>();
  for (const s of students) {
    const act = new Set(activeWrongIds(s.state));
    for (const [id, w] of Object.entries(s.state.wrong)) {
      const q = m.get(id) ?? { id, students: 0, active: 0, times: 0 };
      q.students++;
      q.times += w.n;
      if (act.has(id)) q.active++;
      m.set(id, q);
    }
  }
  return [...m.values()].sort((a, b) => b.students - a.students || b.times - a.times || (a.id < b.id ? -1 : 1));
}

/** 반에서 가장 최근 활동 시각 */
export const lastActivity = (students: CgStudent[]): string | null => students.reduce<string | null>((a, s) => (!a || s.lastAt > a ? s.lastAt : a), null);

export interface StudentUnitDetail {
  unitId: CgUnitId;
  levels: { lv: number; passed: boolean; best?: number; total?: number; passedAt?: string; lastAt?: string }[];
  /** 개념 맞추기를 마친 카드 수 */
  cards: number;
  /** 마지막 초기화 이후 잠김 횟수 */
  locks: number;
  /** 단원 초기화 횟수와 마지막 시각 */
  resets: number;
  lastResetAt?: string;
}

/** 학생 한 명의 자세한 기록: 단원 × 단계, 잠김·초기화, 모의고사(최근 순), 오답노트 */
export function studentDetail(s: CgStudent, shape: CourseShape = CG_SHAPE) {
  const st = s.state;
  const units: StudentUnitDetail[] = shape.unitIds.map((u) => ({
    unitId: u,
    levels: LV.map((lv) => {
      const r = st.units[u]?.[`lv${lv}`];
      return { lv, passed: !!r?.passedAt, ...(r?.best !== undefined ? { best: r.best } : {}), ...(r?.total !== undefined ? { total: r.total } : {}), ...(r?.passedAt ? { passedAt: r.passedAt } : {}), ...(r?.lastAt ? { lastAt: r.lastAt } : {}) };
    }),
    cards: Object.keys(st.cards).filter((k) => k.startsWith(`${u}-t`)).length,
    locks: st.locks[u]?.length ?? 0,
    resets: st.resets[u]?.n ?? 0,
    ...(st.resets[u]?.at ? { lastResetAt: st.resets[u]!.at } : {}),
  }));
  const mocks = [...st.mock].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const active = activeWrongIds(st);
  const wrongTop = Object.entries(st.wrong).sort((a, b) => b[1].n - a[1].n || (a[1].at < b[1].at ? 1 : -1)).slice(0, 10).map(([id, w]) => ({ id, n: w.n, active: active.includes(id) }));
  return { units, mocks, wrongActive: active.length, wrongTotal: Object.keys(st.wrong).length, wrongTop };
}
