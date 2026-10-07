import { describe, expect, it } from 'vitest';
import {
  activeWrongIds, addMock, emptyCgState, isOpen, markDone, mergeCgStates, nextPlantGoal, normalizeCgState, noteAnswer,
  passNeed, passedCount, plantStage, recordScore, scoreMock, unitLevel, type CgState, type MockRecord,
} from '../../src/features/computer/model';
import { buildMock, optionOrder, orderByArea, seededRandom } from '../../src/features/computer/mock';
import { CG_UNITS } from '../../src/features/computer/content';
import { BLANK_RE, CG_AREAS, CG_UNIT_IDS, type CgArea } from '../../src/features/computer/types';

const T = (n: number) => `2026-10-07T00:00:${String(n).padStart(2, '0')}.000Z`;

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
    expect(unitLevel(s, 'U2')).toBe(2); // 원래 페이지와 같이 통과한 단계 수
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
    expect(normalizeCgState({ units: { U1: { lv2: { best: 'x', passedAt: 3 } }, U99: {} }, mock: [{ bad: 1 }], wrong: { 'U2-a3': { at: T(1) } } })).toEqual({
      v: 1, units: { U1: { lv2: {} } }, mock: [], wrong: { 'U2-a3': { at: T(1), n: 1 } }, upd: '',
    });
  });
});

describe('모의고사 구성(실제 문제은행)', () => {
  const units = CG_UNITS;
  it('50문항: 단원마다 실력점검 4 + 기초 2 이상, 영역 순서(OS→HW→MAINT→NET→GEN), 중복 없음', () => {
    const { items, orders } = buildMock(units, 'set1');
    expect(items.length).toBe(50);
    expect(orders.length).toBe(50);
    for (const u of CG_UNIT_IDS) {
      expect(items.filter((x) => x.unitId === u && x.set === 'check').length).toBeGreaterThanOrEqual(4);
      expect(items.filter((x) => x.unitId === u && x.set === 'basic').length).toBe(2);
    }
    const areaIdx = items.map((x) => CG_AREAS.indexOf(x.area as CgArea));
    expect([...areaIdx].sort((a, b) => a - b)).toEqual(areaIdx);
    expect(new Set(items.map((x) => x.id)).size).toBe(50);
    for (const o of orders) expect([...o].sort()).toEqual([0, 1, 2, 3]);
  });
  it('고정 회차는 항상 같은 문항·같은 보기 순서, 1~3회는 서로 겹치지 않음', () => {
    const s1 = buildMock(units, 'set1');
    expect(buildMock(units, 'set1')).toEqual(s1);
    const ids = (k: 'set1' | 'set2' | 'set3') => buildMock(units, k).items.map((x) => x.id);
    const [a, b, c] = [ids('set1'), ids('set2'), ids('set3')];
    expect(a.filter((x) => b.includes(x) || c.includes(x))).toEqual([]);
    expect(b.filter((x) => c.includes(x))).toEqual([]);
  });
  it('랜덤은 시드마다 다르고, 오답 모의고사는 오답노트 문항만(최대 50)', () => {
    expect(buildMock(units, 'random', { seed: 'a' }).items.map((x) => x.id)).not.toEqual(buildMock(units, 'random', { seed: 'b' }).items.map((x) => x.id));
    const w = buildMock(units, 'wrong', { wrongIds: ['U3-b2', 'U1-a1', 'nope'] });
    expect(w.items.map((x) => x.id).sort()).toEqual(['U1-a1', 'U3-b2']);
    const many = units.flatMap((u) => u.basic.map((x) => x.id));
    expect(buildMock(units, 'wrong', { wrongIds: many }).items.length).toBe(50);
  });
  it('채점: 단원별·영역별 정답률', () => {
    const items = orderByArea(buildMock(units, 'set2').items);
    const answers = Object.fromEntries(items.map((q, i) => [q.id, i < 30 ? q.answer : (q.answer + 1) % 4]));
    const r = scoreMock(items, answers);
    expect(r.score).toBe(30);
    expect(Object.values(r.perUnit).reduce((s, x) => s + x![1], 0)).toBe(50);
    expect(Object.values(r.perArea).reduce((s, x) => s + x![0], 0)).toBe(30);
  });
  it('보기 순서 섞기는 항상 0~3의 순열', () => {
    const r = seededRandom('x');
    for (let i = 0; i < 20; i++) expect([...optionOrder(4, r)].sort()).toEqual([0, 1, 2, 3]);
  });
});

describe('문제은행 검증(선생님 원본 데이터)', () => {
  it('8단원, 단원마다 이론 13~14장·빈칸 30·예시답안 50·기초 40·실력점검 25', () => {
    expect(CG_UNITS.map((u) => u.id)).toEqual(CG_UNIT_IDS);
    for (const u of CG_UNITS) {
      expect(u.cards.length, u.id).toBeGreaterThanOrEqual(13);
      expect(u.cards.length, u.id).toBeLessThanOrEqual(14);
      expect(u.blanks.length).toBe(30);
      expect(u.wordBox.length).toBe(50);
      expect(new Set(u.wordBox).size).toBe(50);
      expect(u.basic.length).toBe(40);
      expect(u.check.length).toBe(25);
      expect(u.summary.keys.length).toBe(16);
      expect(u.summary.traps.length).toBeGreaterThan(0);
      expect(u.cards.filter((c) => c.ext).length).toBeGreaterThanOrEqual(2);
    }
    expect(CG_UNITS.reduce((s, u) => s + u.basic.length, 0)).toBe(320);
    expect(CG_UNITS.reduce((s, u) => s + u.check.length, 0)).toBe(200);
  });
  it('빈칸: 문장마다 빈칸 하나, 정답은 예시답안 안에 있음', () => {
    for (const u of CG_UNITS) for (const b of u.blanks) {
      expect(b.text.split(BLANK_RE).length, b.id).toBe(2);
      expect(u.wordBox, b.id).toContain(b.answer);
    }
  });
  it('객관식: 보기 4개(중복 없음), 정답 번호 범위, 해설·영역, 전체 ID 고유', () => {
    const all = CG_UNITS.flatMap((u) => [...u.basic, ...u.check]);
    for (const q of all) {
      expect(q.options.length, q.id).toBe(4);
      expect(new Set(q.options).size, q.id).toBe(4);
      expect(q.answer >= 0 && q.answer < 4, q.id).toBe(true);
      expect(q.explanation.length, q.id).toBeGreaterThan(5);
      expect(CG_AREAS, q.id).toContain(q.area);
    }
    expect(new Set(all.map((q) => q.id)).size).toBe(all.length);
  });
  it('정답 번호가 한쪽에 몰리지 않음(단원마다 각 번호 25% ± 5%p)', () => {
    for (const u of CG_UNITS) {
      const qs = [...u.basic, ...u.check];
      for (let k = 0; k < 4; k++) {
        const share = qs.filter((q) => q.answer === k).length / qs.length;
        expect(Math.abs(share - 0.25), `${u.id} ${k}`).toBeLessThan(0.05);
      }
    }
  });
});

describe('첫 화면 과목 판정', () => {
  it('경로로 과목 구분', async () => {
    const { subjectOfPath } = await import('../../src/app/SubjectHome');
    expect(subjectOfPath('/computer/unit/U1')).toBe('cg');
    expect(subjectOfPath('/learn/U01/U01-A02')).toBe('db');
    expect(subjectOfPath('/garden')).toBe('db');
    expect(subjectOfPath('/')).toBeNull();
    expect(subjectOfPath('/about')).toBeNull();
  });
});

describe('선생님 반 학습 현황 집계', () => {
  it('학생 수·최근 7일·평균 통과·모의 합격·단원 평균·오답 Top8·CSV', async () => {
    const { classSummary, toCsv, toStudents } = await import('../../src/features/computer/teacher');
    const now = Date.parse('2026-10-07T12:00:00Z');
    const a = addMock(passAll(emptyCgState(), 40), { id: 'm', kind: 'set1', at: T(1), score: 31, total: 50, seconds: 1, perUnit: {}, perArea: {} });
    let b = passAll(emptyCgState(), 6);
    b = noteAnswer(noteAnswer(b, 'U1-b1', false, T(1)), 'U2-a3', false, T(2));
    const c = noteAnswer(emptyCgState(), 'U1-b1', false, T(3));
    const students = toStudents([
      { user_id: '1', name: '가온', email: 'a@x.kr', state: a, updated_at: '2026-10-07T00:00:00Z' },
      { user_id: '2', name: null, email: 'nare@x.kr', state: b, updated_at: '2026-10-05T00:00:00Z' },
      { user_id: '3', name: '다온', email: 'c@x.kr', state: c, updated_at: '2026-09-01T00:00:00Z' },
    ]);
    expect(students.map((s) => [s.name, s.passed, s.plant, s.mockPassed, s.wrong])).toEqual([
      ['가온', 40, 6, true, 0], ['nare', 6, 1, false, 2], ['다온', 0, 0, false, 1],
    ]);
    const sum = classSummary(students, now);
    expect(sum).toMatchObject({ n: 3, active7: 2, mockPassed: 1 });
    expect(sum.avgPassed).toBeCloseTo(46 / 3);
    expect(sum.unitAvg.U1).toBeCloseTo((5 + 5 + 0) / 3);
    expect(sum.topWrong[0]).toEqual(['U1-b1', 2]);
    const csv = toCsv(['이름', '메모'], [['=HYPERLINK("x")', '쉼표,있음']]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"쉼표,있음"');
  });
});

describe('오답노트: 기기 시계가 서로 달라도', () => {
  it('하루 앞선 시계에서 틀린 문항을 다른 기기에서 맞히면 빠진다', () => {
    const fast = noteAnswer(emptyCgState(), 'U1-b1', false, '2026-10-08T09:00:00.000Z');
    const home = noteAnswer(fast, 'U1-b1', true, '2026-10-07T20:00:00.000Z');
    expect(activeWrongIds(home)).toEqual([]);
    // 그 뒤 다시 틀리면(시계가 늦은 기기라도) 다시 들어온다
    const again = noteAnswer(home, 'U1-b1', false, '2026-10-07T21:00:00.000Z');
    expect(activeWrongIds(again)).toEqual(['U1-b1']);
  });
  it("'constructor' 같은 이상한 키는 읽을 때 버린다", () => {
    expect(normalizeCgState({ wrong: { constructor: { at: T(1) }, 'U1-b1': { at: T(1) }, 'U9-x1': { at: T(1) } } }).wrong).toEqual({ 'U1-b1': { at: T(1), n: 1 } });
  });
});
