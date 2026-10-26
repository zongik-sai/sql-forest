import { describe, expect, it } from 'vitest';
import { addLock, addMock, emptyCgState, markDone, noteAnswer, recordScore, type CgState } from '../../src/features/computer/model';
import { lastActivity, questionStats, studentDetail, toStudents, unitClassStats } from '../../src/features/computer/teacher';
import { CG_COURSE } from '../../src/features/computer/content';

/** 선생님 화면 '더 자세히': 단원별 통과율·문항별 오답·학생 한 명의 단원 × 단계 기록 */
const T = (n: number) => `2026-10-26T00:00:${String(n).padStart(2, '0')}.000Z`;

function sample(): CgState[] {
  let a = markDone(emptyCgState(), 'U1', 1, T(1));
  a = recordScore(a, 'U1', 2, 25, 30, T(2)).state;
  a = recordScore(a, 'U1', 3, 20, 40, T(3)).state; // 기준 미달(시도만)
  a = noteAnswer(noteAnswer(a, 'U1-b1', false, T(4)), 'U1-b1', false, T(5));
  a = noteAnswer(a, 'U1-b2', false, T(6));
  a = addMock(a, { id: 'm1', kind: 'set1', at: T(7), score: 33, total: 50, seconds: 2400, perUnit: {}, perArea: {} });
  a = addMock(a, { id: 'm2', kind: 'random', at: T(9), score: 28, total: 50, seconds: 3000, timeUp: true, perUnit: {}, perArea: {} });
  a = addLock(addLock(a, 'U2', T(8)).state, 'U2', T(9)).state;
  let b = markDone(emptyCgState(), 'U1', 1, T(1));
  b = noteAnswer(noteAnswer(b, 'U1-b1', false, T(4)), 'U1-b1', true, T(5)); // 다시 맞힘
  for (let i = 0; i < 5; i++) b = addLock(b, 'U3', T(10 + i)).state; // 5번 → 초기화
  return [a, b];
}

describe('선생님 화면: 더 자세히', () => {
  const [a, b] = sample();
  const students = toStudents([
    { user_id: '1', name: '가온', email: 'a@x.kr', state: a, updated_at: '2026-10-26T01:00:00Z' },
    { user_id: '2', name: '나래', email: 'b@x.kr', state: b, updated_at: '2026-10-26T02:00:00Z' },
  ], CG_COURSE);

  it('단원별 단계 통과율·평균 레벨·잠김·초기화', () => {
    const u = unitClassStats(students, CG_COURSE);
    expect(u.map((x) => x.unitId)).toEqual(CG_COURSE.unitIds);
    expect(u[0].passRate).toEqual([1, 0.5, 0, 0, 0]);
    expect(u[0].avgLevel).toBeCloseTo(1.5);
    expect(u[1]).toMatchObject({ locksNow: 2, resets: 0, studentsReset: 0 });
    expect(u[2]).toMatchObject({ locksNow: 0, resets: 1, studentsReset: 1 });
  });
  it('문항별: 틀린 학생 수·오답노트에 남은 학생 수·틀린 횟수(많은 순)', () => {
    expect(questionStats(students)).toEqual([
      { id: 'U1-b1', students: 2, active: 1, times: 3 },
      { id: 'U1-b2', students: 1, active: 1, times: 1 },
    ]);
  });
  it('학생 한 명: 단원 × 단계(최고 점수·통과 여부), 잠김·초기화, 모의고사 최근 순, 오답노트', () => {
    const d = studentDetail(students[0], CG_COURSE);
    expect(d.units[0].levels.slice(0, 3)).toEqual([
      { lv: 1, passed: true, passedAt: T(1), lastAt: T(1) },
      { lv: 2, passed: true, best: 25, total: 30, passedAt: T(2), lastAt: T(2) },
      { lv: 3, passed: false, best: 20, total: 40, lastAt: T(3) },
    ]);
    expect(d.units[1]).toMatchObject({ unitId: 'U2', locks: 2, resets: 0 });
    expect(d.mocks.map((m) => m.id)).toEqual(['m2', 'm1']);
    expect(d).toMatchObject({ wrongActive: 2, wrongTotal: 2 });
    expect(d.wrongTop[0]).toEqual({ id: 'U1-b1', n: 2, active: true });
    const e = studentDetail(students[1], CG_COURSE);
    expect(e.units[2]).toMatchObject({ locks: 0, resets: 1 });
    expect(e.units[2].lastResetAt).toBeTruthy();
    expect(e).toMatchObject({ wrongActive: 0, wrongTotal: 1 });
  });
  it('반의 마지막 활동', () => {
    expect(lastActivity(students)).toBe('2026-10-26T02:00:00Z');
    expect(lastActivity([])).toBeNull();
  });
});
