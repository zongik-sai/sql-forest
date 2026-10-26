import { describe, expect, it } from 'vitest';
import { adaptUnits, type RawQ, type RawUnit } from '../../src/features/computer/content/adapt';
import { makeCourse, unitHasContent } from '../../src/features/computer/course';
import { buildNewCourse } from '../../src/features/computer/courses/build';
import { NEW_COURSES } from '../../src/features/computer/courses/defs';
import { buildMock, mockSeedOf, orderByArea } from '../../src/features/computer/mock';
import {
  activeWrongIds, addLock, addMock, emptyCgState, hasProgress, markCard, markDone, mergeCgStates, nextPlantGoal, normalizeCgState, noteAnswer,
  passedCount, plantStage, plantThresholds, recordScore, resetUnit, TOTAL_STEPS, type CgState, type MockRecord,
} from '../../src/features/computer/model';
import { classSummary, toStudents } from '../../src/features/computer/teacher';
import type { CgUnitId } from '../../src/features/computer/types';

/**
 * 단원 × 5단계 엔진 일반화(새 과목: 네트워크·프로그래밍·Data) 검사.
 * 실제 문제은행이 아니라 이 파일 안의 작은 3단원 과목(영역 A·B·C)으로 검사한다.
 */
const T = (n: number) => `2026-10-26T00:00:${String(n).padStart(2, '0')}.000Z`;
const AREAS = [{ id: 'A', label: '영역 가' }, { id: 'B', label: '영역 나' }, { id: 'C', label: '영역 다' }];

const q = (id: string, area: string, extra: Partial<RawQ> = {}): RawQ => ({ id, q: `질문 ${id}`, o: ['가', '나', '다', '라'], a: 1, exp: `해설 ${id}`, area, ...extra });
function rawUnit(n: number, opts: { basic?: number; adv?: number } = {}): RawUnit {
  const areas = ['A', 'B', 'C'];
  return {
    unit: n, title: `단원 ${n}`, intro: `단원 ${n} 소개`,
    theory: [
      { id: 't1', title: '[확장] 첫 카드', points: ['p1', 'p2'], ext: true, code: 'print("hi")\nfor i in range(3):\n    print(i)',
        match: { pairs: [{ term: '용어1', desc: '뜻 하나입니다' }, { term: '용어2', desc: '뜻 둘입니다' }, { term: '용어3', desc: '뜻 셋입니다' }], distractor: '함정' } },
      { id: 't2', title: '두 번째 카드', points: ['p'], ext: false, table: { head: ['a', 'b'], rows: [['1', '2']] }, tip: '팁' },
    ],
    bank: ['정답1', '함정1'],
    fill: [{ id: 'f1', text: '빈칸 ____ 문장', answer: '정답1', exp: '해설' }],
    basic: Array.from({ length: opts.basic ?? 10 }, (_, i) => q(`b${i + 1}`, areas[(i + n) % 3], i === 0 ? { code: 'x = 1' } : {})),
    summary: { keys: [{ k: '핵심', v: '내용' }], compare: [{ title: '비교', head: ['x', 'y'], rows: [['1', '2']] }], traps: ['함정 포인트'] },
    advanced: Array.from({ length: opts.adv ?? 12 }, (_, i) => q(`a${i + 1}`, i === 3 ? 'ZZZ' : areas[i % 3], { type: '응용' })),
  };
}
const RAW = [rawUnit(1), rawUnit(2), rawUnit(3)];
const UNITS = adaptUnits(RAW, { areas: AREAS.map((a) => a.id) });
const COURSE = makeCourse({ id: 'net', name: '시험 과목', basePath: '/test', units: UNITS, areas: AREAS, remote: { kind: 'course', course: 'net' } });

describe('새 형식 원본 → 앱 표준 형태', () => {
  it('ID 앞에 단원(U<n>-t·f·b·a), 카드 원본의 match·code, 문항 code, [확장] 제목 정리', () => {
    const u = UNITS[0];
    expect(u.id).toBe('U1');
    expect(u.cards.map((c) => c.id)).toEqual(['U1-t1', 'U1-t2']);
    expect(u.cards[0]).toMatchObject({ title: '첫 카드', ext: true, code: 'print("hi")\nfor i in range(3):\n    print(i)' });
    expect(u.cards[0].match?.pairs).toHaveLength(3);
    expect(u.cards[0].match?.distractor).toBe('함정');
    expect(u.cards[1].match).toBeUndefined();
    expect(u.cards[1].code).toBeUndefined();
    expect(u.cards[1].table).toEqual({ header: ['a', 'b'], rows: [['1', '2']] });
    expect(u.blanks[0].id).toBe('U1-f1');
    expect(u.basic[0]).toMatchObject({ id: 'U1-b1', unitId: 'U1', set: 'basic', code: 'x = 1', question: '질문 b1', explanation: '해설 b1' });
    expect(u.basic[1].code).toBeUndefined();
    expect(u.check[0]).toMatchObject({ id: 'U1-a1', set: 'check', tag: '응용' });
    expect(u.summary.tables[0]).toEqual({ caption: '비교', header: ['x', 'y'], rows: [['1', '2']] });
  });
  it('과목 영역이 아닌 영역은 첫 영역으로', () => {
    expect(UNITS[0].check[3].area).toBe('A');
    expect(UNITS.flatMap((u) => [...u.basic, ...u.check]).every((x) => ['A', 'B', 'C'].includes(x.area))).toBe(true);
  });
  it('쓰는 중인 빈 단원(배열이 비었거나 빠짐)도 멈추지 않는다', () => {
    const stub = { unit: 4, title: '(작성 중)', intro: '', theory: [], bank: [], fill: [], basic: [], summary: { keys: [], compare: [], traps: [] }, advanced: [] };
    const broken = { unit: 5 } as unknown as RawUnit;
    const out = adaptUnits([stub, broken], { areas: ['A'] });
    expect(out.map((u) => [u.id, u.cards.length, u.basic.length, u.check.length, u.summary.keys.length])).toEqual([['U4', 0, 0, 0, 0], ['U5', 0, 0, 0, 0]]);
    expect(out.some(unitHasContent)).toBe(false);
    expect(unitHasContent(UNITS[0])).toBe(true);
  });
  it('과목 정의: 단원·문항 찾기(Map이라 이상한 키는 undefined), 영역 이름, 전체 단계 = 단원 수 × 5', () => {
    expect(COURSE.unitIds).toEqual(['U1', 'U2', 'U3']);
    expect(COURSE.totalSteps).toBe(15);
    expect(COURSE.unitById('U2')?.title).toBe('단원 2');
    expect(COURSE.unitById('constructor')).toBeUndefined();
    expect(COURSE.mcqById('U3-a2')?.unitId).toBe('U3');
    expect(COURSE.mcqById('constructor')).toBeUndefined();
    expect(COURSE.areaLabel('B')).toBe('영역 나');
    expect(COURSE).toMatchObject({ storage: 'net', mockSeed: 'net', remote: { kind: 'course', course: 'net' } });
  });
  it('새 과목 정의(defs) → 이름·경로·영역·저장 키·서버 위치', () => {
    for (const d of NEW_COURSES) {
      const c = buildNewCourse(d.id, [rawUnit(2), rawUnit(1)]);
      expect(c).toMatchObject({ id: d.id, name: d.name, basePath: d.path, basis: d.basis, storage: d.id, mockSeed: d.id, remote: { kind: 'course', course: d.id } });
      expect(c.unitIds).toEqual(['U1', 'U2']); // 원본 unit 번호 순
      expect(c.areas.map((a) => a.id)).toEqual(d.areas.map((a) => a.id));
      // 픽스처 영역(A·B·C)은 이 과목 영역이 아니므로 모두 첫 영역
      expect(new Set(c.units.flatMap((u) => u.basic.map((x) => x.area)))).toEqual(new Set([d.areas[0].id]));
    }
    expect(NEW_COURSES.map((c) => c.path)).toEqual(['/network', '/programming', '/data']);
  });
});

/** 3단원 과목에서 n단계를 차례로 통과 */
function passSteps(s: CgState, n: number, units: CgUnitId[] = COURSE.unitIds as CgUnitId[]): CgState {
  let k = 0;
  for (const u of units) for (const lv of [1, 2, 3, 4, 5] as const) {
    if (k++ >= n) return s;
    s = lv === 1 || lv === 4 ? markDone(s, u, lv, T(1)) : recordScore(s, u, lv, 40, 40, T(1)).state;
  }
  return s;
}
const mock = (kind: MockRecord['kind'], score: number, id: string): MockRecord => ({ id, kind, at: T(5), score, total: 50, seconds: 1, perUnit: {}, perArea: {} });

describe('3단원 과목의 기록 모델', () => {
  it('식물 기준은 전체 단계 수에 비례(40단계는 예전 그대로 1·8·16·28·40)', () => {
    expect(plantThresholds(TOTAL_STEPS)).toEqual([1, 8, 16, 28, 40]);
    expect(plantThresholds(15)).toEqual([1, 3, 6, 11, 15]);
    expect(plantThresholds(5)).toEqual([1, 2, 3, 4, 5]);
    for (const [n, st] of [[0, 0], [1, 1], [2, 1], [3, 2], [6, 3], [10, 3], [11, 4], [14, 4], [15, 5]] as const) {
      expect(plantStage(passSteps(emptyCgState(), n), COURSE), `${n}단계`).toBe(st);
    }
    expect(passedCount(passSteps(emptyCgState(), 15), COURSE)).toBe(15);
    expect(nextPlantGoal(passSteps(emptyCgState(), 4), COURSE)).toBe('2단계 더 통과하면 다음 모습으로 자라요.');
    const full = addMock(passSteps(emptyCgState(), 15), mock('set1', 30, 'm1'));
    expect(plantStage(full, COURSE)).toBe(6);
    // 같은 기록을 컴퓨터 일반(40단계) 기준으로 보면 아직 15/40(줄기)
    expect(plantStage(full)).toBe(2);
  });
  it('읽기: 이 과목 단원만 받고 이상한 키는 버린다', () => {
    const s = normalizeCgState({
      units: { U1: { lv1: { passedAt: T(1) } }, U4: { lv1: { passedAt: T(1) } }, constructor: {} },
      wrong: { 'U3-a2': { at: T(1) }, 'U4-b1': { at: T(1) }, 'U12-b1': { at: T(1) }, constructor: { at: T(1) } },
      cards: { 'U2-t1': T(1), 'U9-t1': T(1), 'U2-x1': T(1) },
      locks: { U3: [T(1)], U4: [T(1)] },
      resets: { U1: { at: T(2), n: 2 }, constructor: { at: T(3) } },
    }, COURSE);
    expect(Object.keys(s.units)).toEqual(['U1']);
    expect(Object.keys(s.wrong)).toEqual(['U3-a2']);
    expect(Object.keys(s.cards)).toEqual(['U2-t1']);
    expect(s.locks).toEqual({ U3: [T(1)] });
    expect(s.resets).toEqual({ U1: { at: T(2), n: 2 } });
    // 단원이 12개인 과목이면 U12 문항도 받는다(ID 형식은 U1~U12)
    const twelve = { unitIds: Array.from({ length: 12 }, (_, i) => `U${i + 1}` as CgUnitId), totalSteps: 60 };
    expect(Object.keys(normalizeCgState({ wrong: { 'U12-b1': { at: T(1) }, 'U10-a3': { at: T(1) } }, cards: { 'U11-t2': T(1) } }, twelve).wrong).sort()).toEqual(['U10-a3', 'U12-b1']);
    expect(Object.keys(normalizeCgState({ cards: { 'U11-t2': T(1) } }, twelve).cards)).toEqual(['U11-t2']);
  });
  it('병합: 과목 단원 기준으로 합치고, 초기화를 모르는 쪽의 그 단원 기록은 버린다', () => {
    const ids = UNITS[2].cards.map((c) => c.id);
    let a = recordScore(emptyCgState(), 'U3', 3, 10, 20, T(3)).state;
    a = markCard(a, 'U3', ids[0], ids, T(4)).state;
    a = noteAnswer(a, 'U3-b2', false, T(4));
    const b = resetUnit(recordScore(emptyCgState(), 'U2', 2, 18, 20, T(5)).state, 'U3', T(6));
    const m = mergeCgStates(a, b, COURSE);
    expect(m.units.U3).toBeUndefined();
    expect(m.units.U2?.lv2).toMatchObject({ best: 18, passedAt: T(5) });
    expect(m.cards).toEqual({});
    expect(activeWrongIds(m)).toEqual(['U3-b2']);
    expect(mergeCgStates(b, a, COURSE)).toEqual(m);
    expect(hasProgress(m, COURSE)).toBe(true);
  });
  it('잠김 5번이면 그 단원만 초기화(다른 단원·오답노트 유지)', () => {
    let s = noteAnswer(passSteps(emptyCgState(), 7), 'U1-b1', false, T(2));
    for (let i = 0; i < 4; i++) s = addLock(s, 'U2', T(10 + i)).state;
    const r = addLock(s, 'U2', T(20));
    expect(r).toMatchObject({ count: 5, reset: true });
    expect(r.state.units.U2).toBeUndefined();
    expect(passedCount(r.state, COURSE)).toBe(5);
    expect(activeWrongIds(r.state)).toEqual(['U1-b1']);
  });
});

describe('과목 모의고사 구성', () => {
  const opts = { seedPrefix: COURSE.mockSeed, areas: COURSE.areas.map((a) => a.id) };
  it('단원마다 실력점검 4 + 기초 2, 나머지는 실력점검으로 채워 50문항(문항이 모자라면 있는 만큼), 영역 순서, 중복 없음', () => {
    const { items, orders } = buildMock(UNITS, 'set1', opts);
    // 3단원 × (실력점검 12 + 기초 10) = 66문항 중: 단원별 4+2 = 18, 남은 실력점검 24 → 42문항
    expect(items.length).toBe(18 + 24);
    expect(orders.length).toBe(items.length);
    for (const u of COURSE.unitIds) expect(items.filter((x) => x.unitId === u && x.set === 'basic').length).toBe(2);
    const idx = items.map((x) => ['A', 'B', 'C'].indexOf(x.area));
    expect([...idx].sort((p, q2) => p - q2)).toEqual(idx);
    expect(new Set(items.map((x) => x.id)).size).toBe(items.length);
  });
  it('문항이 충분하면 50문항, 고정 회차는 과목 시드로 늘 같고 회차끼리 겹치지 않음', () => {
    const big = adaptUnits([1, 2, 3, 4, 5, 6, 7, 8].map((n) => rawUnit(n, { basic: 20, adv: 15 })), { areas: ['A', 'B', 'C'] });
    const s1 = buildMock(big, 'set1', opts);
    expect(s1.items.length).toBe(50);
    expect(buildMock(big, 'set1', opts)).toEqual(s1);
    const ids = (k: 'set1' | 'set2' | 'set3') => buildMock(big, k, opts).items.map((x) => x.id);
    const [a, b, c] = [ids('set1'), ids('set2'), ids('set3')];
    expect(a.filter((x) => b.includes(x) || c.includes(x))).toEqual([]);
    expect(b.filter((x) => c.includes(x))).toEqual([]);
    // 시드가 과목마다 다르다(같은 문항 은행이라도 cg 시드와 다른 회차)
    expect(mockSeedOf('net', 'set2')).toBe('net-mock-set2-v1');
    expect(mockSeedOf('cg', 'set2')).toBe('cg-mock-set2-v1');
    expect(buildMock(big, 'set1', { ...opts, seedPrefix: 'cg' }).items.map((x) => x.id)).not.toEqual(a);
  });
  it('오답 모의고사는 오답노트 문항만, 빈 과목은 0문항', () => {
    const w = buildMock(UNITS, 'wrong', { ...opts, wrongIds: ['U2-a1', 'U1-b3', 'U9-a1'] });
    expect(w.items.map((x) => x.id).sort()).toEqual(['U1-b3', 'U2-a1']);
    expect(buildMock(adaptUnits([{ unit: 1 } as unknown as RawUnit], { areas: ['A'] }), 'set1', opts).items).toEqual([]);
  });
  it('영역 순서는 과목 영역 순(모르는 영역은 맨 뒤), 같은 영역 안에서는 단원 순', () => {
    const items = UNITS.flatMap((u) => u.check.slice(0, 3)).reverse();
    const out = orderByArea([...items, { ...items[0], id: 'U1-a99', area: 'ZZ' }], ['C', 'B', 'A']);
    expect(out.map((x) => x.area)).toEqual(['C', 'C', 'C', 'B', 'B', 'B', 'A', 'A', 'A', 'ZZ']);
    expect(out.filter((x) => x.area === 'C').map((x) => x.unitId)).toEqual(['U1', 'U2', 'U3']);
  });
});

describe('선생님 반 현황(과목 단원 기준)', () => {
  it('학생별 단원 레벨·통과 수·식물, 단원 평균은 과목 단원만', () => {
    const a = addMock(passSteps(emptyCgState(), 15), mock('random', 33, 'm'));
    const b = noteAnswer(passSteps(emptyCgState(), 3), 'U2-a1', false, T(1));
    const students = toStudents([
      { user_id: '1', name: '가온', email: 'a@x.kr', state: a, updated_at: '2026-10-26T00:00:00Z' },
      { user_id: '2', name: null, email: 'nare@x.kr', state: { ...b, units: { ...b.units, U7: { lv1: { passedAt: T(1) } } } }, updated_at: '2026-10-01T00:00:00Z' },
    ], COURSE);
    expect(students.map((s) => [s.name, s.passed, s.plant, s.mockPassed, s.wrong])).toEqual([['가온', 15, 6, true, 0], ['nare', 3, 2, false, 1]]);
    expect(Object.keys(students[0].levels)).toEqual(['U1', 'U2', 'U3']);
    const sum = classSummary(students, Date.parse('2026-10-26T12:00:00Z'), COURSE);
    expect(sum).toMatchObject({ n: 2, active7: 1, mockPassed: 1 });
    expect(Object.keys(sum.unitAvg)).toEqual(['U1', 'U2', 'U3']);
    expect(sum.unitAvg.U1).toBeCloseTo((5 + 3) / 2);
    expect(sum.unitAvg.U2).toBeCloseTo(5 / 2);
    expect(sum.topWrong).toEqual([['U2-a1', 1]]);
  });
});
