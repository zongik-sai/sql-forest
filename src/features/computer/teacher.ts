import { activeWrongIds, bestRegularMock, normalizeCgState, passedCount, plantStage, unitLevel, type CgState } from './model';
import { CG_PASS, CG_UNIT_IDS, type CgUnitId } from './types';

/** 선생님 반 학습 현황 집계(순수 함수, 테스트 대상) */
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

export function toStudents(rows: CgClassRow[]): CgStudent[] {
  return rows.map((r) => {
    const s = normalizeCgState(r.state);
    const levels = Object.fromEntries(CG_UNIT_IDS.map((u) => [u, unitLevel(s, u)])) as Record<CgUnitId, number>;
    const best = bestRegularMock(s);
    return {
      id: r.user_id, name: r.name || (r.email ?? '').split('@')[0] || '(이름 없음)', email: r.email ?? '', state: s,
      plant: plantStage(s), passed: passedCount(s), levels, mockBest: best, mockPassed: best >= CG_PASS.mock.need,
      wrong: activeWrongIds(s).length, lastAt: r.updated_at,
    };
  });
}

export function classSummary(students: CgStudent[], now = Date.now()) {
  const n = students.length;
  const week = 7 * 24 * 3600 * 1000;
  const active7 = students.filter((s) => now - Date.parse(s.lastAt) <= week).length;
  const avgPassed = n ? students.reduce((a, s) => a + s.passed, 0) / n : 0;
  const mockPassed = students.filter((s) => s.mockPassed).length;
  const unitAvg = Object.fromEntries(CG_UNIT_IDS.map((u) => [u, n ? students.reduce((a, s) => a + s.levels[u], 0) / n : 0])) as Record<CgUnitId, number>;
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
