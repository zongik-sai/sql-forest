import { describe, expect, it } from 'vitest';
import {
  activeWrongIds, addMock, emptyCgState, isOpen, markDone, mergeCgStates, nextPlantGoal, normalizeCgState, noteAnswer,
  passNeed, passedCount, plantStage, recordScore, scoreMock, unitLevel, type CgState, type MockRecord,
} from '../../src/features/computer/model';
import { buildMock, orderByArea, seededRandom, unitQuota } from '../../src/features/computer/mock';
import { CG_AREAS, CG_UNIT_IDS, type CgArea, type CgMcq, type CgUnit, type CgUnitId } from '../../src/features/computer/types';

const T = (n: number) => `2026-10-07T00:00:${String(n).padStart(2, '0')}.000Z`;

function fakeUnits(): CgUnit[] {
  return CG_UNIT_IDS.map((u, ui) => {
    const mk = (set: 'basic' | 'check', n: number): CgMcq[] =>
      Array.from({ length: n }, (_, i) => ({ id: `${u}-${set}-${i + 1}`, unitId: u, set, question: 'q', options: ['a', 'b', 'c', 'd'], answer: i % 4, explanation: 'e', area: CG_AREAS[(i + ui) % 5] }));
    return { id: u, title: u, cards: [], blanks: [], wordBox: [], basic: mk('basic', 40), summary: { lines: [], tables: [], pitfalls: [] }, check: mk('check', 25) };
  });
}

function passAll(s: CgState, upToStep = 40): CgState {
  let n = 0;
  for (const u of CG_UNIT_IDS) {
    for (const lv of [1, 2, 3, 4, 5] as const) {
      if (n++ >= upToStep) return s;
      s = lv === 1 || lv === 4 ? markDone(s, u, lv, T(1)) : recordScore(s, u, lv, 40, lv === 2 ? 30 : lv === 3 ? 40 : 25, T(1)).state;
    }
  }
  return s;
}

describe('통과 기준', () => {
  it('끼워맞추기 24/30, 기초 28/40, 실력점검 15/25(문항 수가 다르면 같은 비율로 올림)', () => {
    expect(passNeed(2, 30)).toBe(24);
    expect(passNeed(3, 40)).toBe(28);
    expect(passNeed(5, 25)).toBe(15);
    expect(passNeed(3, 39)).toBe(Math.ceil(0.7 * 39));
    expect(passNeed(1, 0)).toBe(0);
  });
  it('기준 미만은 기록만, 기준 이상이면 통과(처음 한 번만 firstPass), 최고 점수 유지', () => {
    let s = emptyCgState();
    let r = recordScore(s, 'U1', 3, 27, 40, T(1));
    expect(r.passed).toBe(false);
    expect(r.state.units.U1?.lv3).toEqual({ best: 27, total: 40, lastAt: T(1) });
    s = r.state;
    r = recordScore(s, 'U1', 3, 28, 40, T(2));
    expect(r).toMatchObject({ passed: true, firstPass: true });
    s = r.state;
    r = recordScore(s, 'U1', 3, 20, 40, T(3));
    expect(r.firstPass).toBe(false);
    expect(r.state.units.U1?.lv3).toMatchObject({ best: 28, passedAt: T(2), lastAt: T(3) });
  });
  it('앞 단계를 통과해야 다음 단계가 열림, 단원 레벨은 연속 통과 수', () => {
    let s = emptyCgState();
    expect(isOpen(s, 'U2', 1)).toBe(true);
    expect(isOpen(s, 'U2', 2)).toBe(false);
    s = markDone(s, 'U2', 1, T(1));
    expect(isOpen(s, 'U2', 2)).toBe(true);
    // 3단계를 먼저 통과("그래도 풀어보기")해도 통과로 센다. 단원 레벨은 연속 통과 기준
    s = recordScore(s, 'U2', 3, 40, 40, T(2)).state;
    expect(passedCount(s)).toBe(2);
    expect(unitLevel(s, 'U2')).toBe(1);
  });
});

describe('성장 식물(통과 단계 수 기준)', () => {
  it('씨앗 0 · 새싹 1 · 줄기 8 · 어린 나무 16 · 큰 나무 28 · 꽃 40', () => {
    expect(plantStage(emptyCgState())).toBe(0);
    expect(plantStage(passAll(emptyCgState(), 1))).toBe(1);
    expect(plantStage(passAll(emptyCgState(), 7))).toBe(1);
    expect(plantStage(passAll(emptyCgState(), 8))).toBe(2);
    expect(plantStage(passAll(emptyCgState(), 16))).toBe(3);
    expect(plantStage(passAll(emptyCgState(), 28))).toBe(4);
    expect(plantStage(passAll(emptyCgState(), 39))).toBe(4);
    expect(plantStage(passAll(emptyCgState(), 40))).toBe(5);
    expect(nextPlantGoal(passAll(emptyCgState(), 10))).toBe('6단계 더 통과하면 다음 모습으로 자라요.');
  });
  it('열매: 꽃 + 정규 모의고사 30/50 이상(오답 모의고사는 제외)', () => {
    const mock = (kind: MockRecord['kind'], score: number, id: string): MockRecord => ({ id, kind, at: T(5), score, total: 50, seconds: 100, perUnit: {}, perArea: {} });
    let s = passAll(emptyCgState(), 40);
    s = addMock(s, mock('wrong', 45, 'w1'));
    expect(plantStage(s)).toBe(5);
    s = addMock(s, mock('set1', 29, 'm1'));
    expect(plantStage(s)).toBe(5);
    s = addMock(s, mock('random', 30, 'm2'));
    expect(plantStage(s)).toBe(6);
    expect(nextPlantGoal(s)).toBeNull();
  });
});

describe('오답노트', () => {
  it('틀리면 들어가고, 다시 맞히면 빠지고, 또 틀리면 다시 들어간다', () => {
    let s = noteAnswer(emptyCgState(), 'q1', false, T(1));
    s = noteAnswer(s, 'q2', false, T(2));
    expect(activeWrongIds(s)).toEqual(['q2', 'q1']);
    s = noteAnswer(s, 'q1', true, T(3));
    expect(activeWrongIds(s)).toEqual(['q2']);
    s = noteAnswer(s, 'q1', false, T(4));
    expect(activeWrongIds(s)).toEqual(['q1', 'q2']);
    expect(s.wrong.q1.n).toBe(2);
  });
  it('오답노트에 없는 문항을 맞히면 아무 변화 없음', () => {
    const s = emptyCgState();
    expect(noteAnswer(s, 'q9', true, T(1))).toBe(s);
  });
});

describe('기기 간 병합', () => {
  it('통과는 사라지지 않고, 최고 점수는 큰 쪽, 모의고사는 합집합, 오답은 최근 사건 기준', () => {
    let a = recordScore(emptyCgState(), 'U1', 3, 30, 40, T(5)).state;
    a = noteAnswer(a, 'q1', false, T(1));
    a = noteAnswer(a, 'q1', true, T(6)); // a 기기에서 나중에 맞힘
    a = addMock(a, { id: 'm1', kind: 'set1', at: T(2), score: 20, total: 50, seconds: 1, perUnit: {}, perArea: {} });
    let b = recordScore(emptyCgState(), 'U1', 3, 35, 40, T(3)).state;
    b = noteAnswer(b, 'q1', false, T(4));
    b = noteAnswer(b, 'q2', false, T(4));
    b = addMock(b, { id: 'm2', kind: 'random', at: T(1), score: 31, total: 50, seconds: 1, perUnit: {}, perArea: {} });
    const m = mergeCgStates(a, b);
    expect(m.units.U1?.lv3).toMatchObject({ best: 35, passedAt: T(3), lastAt: T(5) });
    expect(m.mock.map((x) => x.id)).toEqual(['m2', 'm1']);
    expect(activeWrongIds(m)).toEqual(['q2']); // q1은 T6에 맞힘 > T4 틀림
    expect(mergeCgStates(b, a)).toEqual(m); // 순서 무관
  });
  it('모의고사는 최근 60회만 보관', () => {
    let s = emptyCgState();
    for (let i = 0; i < 65; i++) s = addMock(s, { id: `m${i}`, kind: 'random', at: `2026-10-07T01:${String(i).padStart(2, '0')}:00.000Z`, score: i, total: 50, seconds: 1, perUnit: {}, perArea: {} });
    expect(s.mock.length).toBe(60);
    expect(s.mock[0].id).toBe('m5');
  });
  it('저장된 JSON이 이상해도 안전하게 읽는다', () => {
    expect(normalizeCgState(null)).toEqual(emptyCgState());
    expect(normalizeCgState({ units: { U1: { lv2: { best: 'x', passedAt: 3 } }, U99: {} }, mock: [{ bad: 1 }], wrong: { q: { at: T(1) } } })).toEqual({
      v: 1, units: { U1: { lv2: {} } }, mock: [], wrong: { q: { at: T(1), n: 1 } }, upd: '',
    });
  });
});

describe('모의고사 구성', () => {
  const units = fakeUnits();
  it('50문항, 단원별 6~7문항으로 고르게, 영역 순서(OS→HW→MAINT→NET→GEN)', () => {
    const q = buildMock(units, 'set1');
    expect(q.length).toBe(50);
    const perUnit = new Map<CgUnitId, number>();
    for (const x of q) perUnit.set(x.unitId, (perUnit.get(x.unitId) ?? 0) + 1);
    expect([...perUnit.values()].every((n) => n === 6 || n === 7)).toBe(true);
    const areaIdx = q.map((x) => CG_AREAS.indexOf(x.area as CgArea));
    expect([...areaIdx].sort((a, b) => a - b)).toEqual(areaIdx);
    expect(new Set(q.map((x) => x.id)).size).toBe(50);
  });
  it('고정 회차는 항상 같은 문항, 1~3회는 서로 겹치지 않음', () => {
    const s1 = buildMock(units, 'set1').map((x) => x.id);
    expect(buildMock(units, 'set1').map((x) => x.id)).toEqual(s1);
    const s2 = buildMock(units, 'set2').map((x) => x.id);
    const s3 = buildMock(units, 'set3').map((x) => x.id);
    expect(s1.filter((x) => s2.includes(x) || s3.includes(x))).toEqual([]);
    expect(s2.filter((x) => s3.includes(x))).toEqual([]);
  });
  it('랜덤은 시드마다 다르고, 오답 모의고사는 오답노트 문항만(최대 50)', () => {
    expect(buildMock(units, 'random', { seed: 'a' }).map((x) => x.id)).not.toEqual(buildMock(units, 'random', { seed: 'b' }).map((x) => x.id));
    const w = buildMock(units, 'wrong', { wrongIds: ['U3-basic-2', 'U1-check-1', 'nope'] });
    expect(w.map((x) => x.id).sort()).toEqual(['U1-check-1', 'U3-basic-2']);
    const many = units.flatMap((u) => u.basic.map((x) => x.id));
    expect(buildMock(units, 'wrong', { wrongIds: many }).length).toBe(50);
  });
  it('채점: 단원별·영역별 정답률', () => {
    const items = orderByArea(buildMock(units, 'set2'));
    const answers = Object.fromEntries(items.map((q, i) => [q.id, i < 30 ? q.answer : (q.answer + 1) % 4]));
    const r = scoreMock(items, answers);
    expect(r.score).toBe(30);
    expect(Object.values(r.perUnit).reduce((s, [, t]) => s + t, 0)).toBe(50);
    expect(Object.values(r.perArea).reduce((s, [c]) => s + c, 0)).toBe(30);
  });
  it('단원 배분 합계는 항상 전체 문항 수', () => {
    const q = unitQuota(50, CG_UNIT_IDS, seededRandom('x'));
    expect(Object.values(q).reduce((a, b) => a + b, 0)).toBe(50);
  });
});
