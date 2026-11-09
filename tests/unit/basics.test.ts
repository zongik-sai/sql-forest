import { describe, expect, it } from 'vitest';
import { legacyCoursePath } from '../../src/app/legacyPaths';
import { adaptUnits, type RawQ, type RawUnit } from '../../src/features/computer/content/adapt';
import { CG_COURSE } from '../../src/features/computer/content';
import { buildNewCourse } from '../../src/features/computer/courses/build';
import { NEW_COURSES } from '../../src/features/computer/courses/defs';
import { importLegacy, mapLegacyState, scaleOldCheck } from '../../src/features/computer/legacy';
import { drawSelfCheck, seededRandom } from '../../src/features/computer/mock';
import {
  activeWrongIds, addLock, addMock, emptyCgState, hasProgress, isPassed, markCard, markDone, mergeCgStates, mergeSelfCheck, normalizeCgState, noteAnswer, passedCount,
  plantStage, recordScore, recordSelfCheck, resetUnit, SELF_CHECK_KEEP, unitLevel, type CgState,
} from '../../src/features/computer/model';
import { resumableIds, selfCheckLine } from '../../src/features/computer/selfCheck';
import { selfCheckClassStats, studentDetail, studentSelfChecks, toCsv, toStudents } from '../../src/features/computer/teacher';
import { buildLiveState, deriveLocation, SUBJECT_LIST } from '../../src/features/monitor/liveState';

/**
 * 기초 다듬기(2026-11-09): 10문항 실력점검(자기 점검) 기록·병합·초기화, 예전 과목(2진법 이해·IP 이해) 기록 한 번 옮기기,
 * 예전 주소 바꾸기, 선생님 화면 집계, 실시간 위치 이름. 실제 문제은행이 아니라 작은 픽스처로 검사한다.
 */
const T = (n: number) => `2026-11-09T00:${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000Z`;
const q = (id: string, area: string): RawQ => ({ id, q: `질문 ${id}`, o: ['가', '나', '다', '라'], a: 1, exp: `해설 ${id}`, area, type: '응용' });
const raw = (n: number): RawUnit => ({
  unit: n, title: `단원 ${n}`, intro: '소개',
  theory: [{ id: 't1', title: '카드', points: ['p'], ext: false }, { id: 't2', title: '카드 2', points: ['p'], ext: false }],
  bank: ['답'], fill: [{ id: 'f1', text: '빈칸 ____', answer: '답', exp: '해설' }],
  basic: Array.from({ length: 10 }, (_, i) => q(`b${i + 1}`, 'NUM')),
  summary: { keys: [{ k: 'a', v: 'b' }], compare: [], traps: [] },
  advanced: Array.from({ length: 12 }, (_, i) => q(`a${i + 1}`, 'NUM')),
});
const BASIC = buildNewCourse('basic', Array.from({ length: 10 }, (_, i) => raw(i + 1)));
const BIN = BASIC.legacy!.find((l) => l.course === 'bin')!;
const IP = BASIC.legacy!.find((l) => l.course === 'ip')!;

describe('실력점검(자기 점검) 기록', () => {
  it('제출할 때마다 최고점·누적 합계·횟수·회차 기록, 첫 제출로 5단계를 마친 것으로', () => {
    let s = emptyCgState();
    const r1 = recordSelfCheck(s, 'U1', 6, 10, T(1));
    expect(r1).toMatchObject({ gained: 6, first: true, newBest: false, record: { best: 6, sum: 6, n: 1, hist: [{ at: T(1), score: 6 }] } });
    s = r1.state;
    expect(isPassed(s, 'U1', 5)).toBe(true);
    expect(s.units.U1?.lv5).toEqual({ passedAt: T(1), lastAt: T(1) });
    // 낮은 점수도 누적은 쌓이고 최고점은 그대로, 통과 시각은 첫 제출
    const r2 = recordSelfCheck(s, 'U1', 3, 10, T(2));
    expect(r2).toMatchObject({ gained: 3, first: false, newBest: false, record: { best: 6, sum: 9, n: 2 } });
    const r3 = recordSelfCheck(r2.state, 'U1', 9, 10, T(3));
    expect(r3).toMatchObject({ gained: 9, newBest: true, record: { best: 9, sum: 18, n: 3 } });
    expect(r3.state.units.U1?.lv5).toEqual({ passedAt: T(1), lastAt: T(3) });
    expect(r3.record.hist.map((h) => h.score)).toEqual([6, 3, 9]);
    // 범위 밖 점수는 0~10으로, 시계가 뒤로 가도 회차 순서는 유지
    const r4 = recordSelfCheck(r3.state, 'U1', 14, 10, T(0));
    expect(r4.record.best).toBe(10);
    expect(r4.record.hist.at(-1)!.at > T(3)).toBe(true);
    expect(recordSelfCheck(emptyCgState(), 'U2', -3, 10, T(1)).record).toMatchObject({ best: 0, sum: 0, n: 1 });
  });
  it('5단계(실력점검)도 단계 수·식물에 들어간다', () => {
    let s = markDone(emptyCgState(), 'U1', 1, T(1));
    s = recordScore(s, 'U1', 2, 10, 10, T(1)).state;
    s = recordScore(s, 'U1', 3, 10, 10, T(1)).state;
    s = markDone(s, 'U1', 4, T(1));
    expect(unitLevel(s, 'U1')).toBe(4);
    s = recordSelfCheck(s, 'U1', 0, 10, T(2)).state; // 0점이어도 마친 것으로
    expect(unitLevel(s, 'U1')).toBe(5);
    expect(passedCount(s, BASIC)).toBe(5);
    expect(plantStage(s, BASIC)).toBe(1);
    expect(hasProgress(recordSelfCheck(emptyCgState(), 'U3', 0, 10, T(1)).state, BASIC)).toBe(true);
  });
  it('회차 기록은 최근 50개만, 횟수·합계는 그 전 회차도 포함', () => {
    let s = emptyCgState();
    for (let i = 0; i < 60; i++) s = recordSelfCheck(s, 'U2', i % 11, 10, T(i)).state;
    const c = s.checks!.U2!;
    expect(c.n).toBe(60);
    expect(c.hist).toHaveLength(SELF_CHECK_KEEP);
    expect(c.hist[0].at).toBe(T(10));
    expect(c.sum).toBe(Array.from({ length: 60 }, (_, i) => i % 11).reduce((a, b) => a + b, 0));
    expect(normalizeCgState(JSON.parse(JSON.stringify(s)), BASIC).checks!.U2).toEqual(c);
  });
});

describe('실력점검 기록 읽기(검사)', () => {
  it('selfCheck 과목만: 다른 과목(컴퓨터 일반 등)은 실력점검 기록을 버리고 JSON은 예전 그대로', () => {
    const s = recordSelfCheck(emptyCgState(), 'U1', 7, 10, T(1)).state;
    expect(normalizeCgState(s, BASIC).checks?.U1?.best).toBe(7);
    const cg = normalizeCgState(s, CG_COURSE);
    expect(cg).not.toHaveProperty('checks');
    expect(Object.keys(normalizeCgState({}, CG_COURSE))).toEqual(['v', 'units', 'mock', 'wrong', 'cards', 'locks', 'resets', 'upd']);
    expect(Object.keys(emptyCgState())).not.toContain('checks');
    expect(Object.keys(normalizeCgState({ checks: {} }, BASIC))).not.toContain('checks');
  });
  it('점수 0~10 정수·ISO 시각·과목 단원만, 맞지 않는 값은 줄지 않는 쪽으로 맞춘다', () => {
    const s = normalizeCgState({
      checks: {
        U1: { best: 7, sum: 20, n: 3, hist: [{ at: T(3), score: 7 }, { at: T(1), score: 5 }, { at: 'yesterday', score: 3 }, { at: T(2), score: 11 }, { at: T(4), score: 2.5 }, { at: T(5), score: -1 }, null, 'x'] },
        U2: { best: 99, sum: -4, n: 'many', hist: [{ at: T(1), score: 4 }] }, // best 범위 밖 → 회차에서, 횟수는 회차 수 이상
        U3: { best: 4, sum: 4, n: 0, hist: [] }, // 한 번도 안 풂 → 없음
        U4: { best: 3, sum: 100, n: 2, hist: [] }, // 합계는 횟수 × 10을 넘지 않음
        U5: { hist: [{ at: T(1), score: 3 }, { at: T(1), score: 8 }] }, // 같은 시각은 하나(큰 점수)
        U11: { best: 1, sum: 1, n: 1, hist: [] }, // 이 과목 단원이 아님
        constructor: { best: 1, sum: 1, n: 1, hist: [] },
      },
    }, BASIC);
    expect(s.checks!.U1).toEqual({ best: 7, sum: 20, n: 3, hist: [{ at: T(1), score: 5 }, { at: T(3), score: 7 }] });
    expect(s.checks!.U2).toEqual({ best: 4, sum: 4, n: 1, hist: [{ at: T(1), score: 4 }] });
    expect(s.checks!.U3).toBeUndefined();
    expect(s.checks!.U4).toEqual({ best: 3, sum: 20, n: 2, hist: [] });
    expect(s.checks!.U5).toEqual({ best: 8, sum: 8, n: 1, hist: [{ at: T(1), score: 8 }] });
    expect(Object.keys(s.checks!)).toEqual(['U1', 'U2', 'U4', 'U5']);
    expect(normalizeCgState({ checks: 'x' }, BASIC).checks).toBeUndefined();
    expect(normalizeCgState({ checks: [] }, BASIC).checks).toBeUndefined();
  });
  it('예전 기록 옮김 표시는 true와 ISO 시각만', () => {
    expect(normalizeCgState({ importedLegacy: true, importedLegacyAt: T(1) }, BASIC)).toMatchObject({ importedLegacy: true, importedLegacyAt: T(1) });
    expect(normalizeCgState({ importedLegacy: 'yes', importedLegacyAt: T(1) }, BASIC)).not.toHaveProperty('importedLegacy');
    expect(normalizeCgState({ importedLegacy: true, importedLegacyAt: 'now' }, BASIC)).not.toHaveProperty('importedLegacyAt');
  });
});

describe('실력점검 기록 병합(두 기기)', () => {
  const a = [6, 4].reduce((s, sc, i) => recordSelfCheck(s, 'U1', sc, 10, T(i + 1)).state, emptyCgState());
  const b = [8].reduce((s, sc, i) => recordSelfCheck(s, 'U1', sc, 10, T(i + 10)).state, a);
  const c = [3, 5].reduce((s, sc, i) => recordSelfCheck(s, 'U1', sc, 10, T(i + 20)).state, a); // a에서 갈라진 다른 기기
  it('최고점은 큰 쪽, 회차는 시각으로 합집합, 횟수·합계는 줄지 않음(합친 회차만큼)', () => {
    const m = mergeCgStates(b, c, BASIC);
    expect(m.checks!.U1).toEqual({ best: 8, sum: 6 + 4 + 8 + 3 + 5, n: 5, hist: [T(1), T(2), T(10), T(20), T(21)].map((at, i) => ({ at, score: [6, 4, 8, 3, 5][i] })) });
    expect(mergeCgStates(c, b, BASIC)).toEqual(m);
    expect(mergeCgStates(m, b, BASIC)).toEqual(m); // 같은 기록을 다시 합쳐도 그대로
    expect(m.units.U1?.lv5).toEqual({ passedAt: T(1), lastAt: T(21) });
  });
  it('회차 기록이 50개를 넘은 기기끼리: 횟수·합계는 큰 쪽(실제보다 적을 수 있지만 줄지는 않음)', () => {
    let x = emptyCgState();
    for (let i = 0; i < 55; i++) x = recordSelfCheck(x, 'U2', 10, 10, T(i)).state;
    let y = emptyCgState();
    for (let i = 0; i < 52; i++) y = recordSelfCheck(y, 'U2', 1, 10, T(100 + i)).state;
    const m = mergeSelfCheck(x.checks!.U2, y.checks!.U2)!;
    expect(m.n).toBe(55);
    expect(m.sum).toBe(550);
    expect(m.best).toBe(10);
    expect(m.hist).toHaveLength(SELF_CHECK_KEEP);
    expect(m.hist.every((h) => h.at >= T(102))).toBe(true);
    expect(mergeSelfCheck(undefined, y.checks!.U2)).toBe(y.checks!.U2);
  });
  it('한쪽이 단원을 초기화했으면 그 전의 실력점검 기록은 되살아나지 않는다(다른 단원은 그대로)', () => {
    let other = recordSelfCheck(a, 'U2', 5, 10, T(3)).state;
    other = noteAnswer(other, 'U1-a3', false, T(3));
    const reset = resetUnit(a, 'U1', T(30));
    expect(reset.checks?.U1).toBeUndefined();
    const m = mergeCgStates(reset, other, BASIC);
    expect(m.checks?.U1).toBeUndefined();
    expect(m.units.U1).toBeUndefined();
    expect(m.checks?.U2?.best).toBe(5);
    expect(activeWrongIds(m)).toEqual(['U1-a3']); // 오답노트는 지우지 않는다
    // 초기화 뒤 새로 푼 기록은 남는다
    const again = recordSelfCheck(reset, 'U1', 2, 10, T(40)).state;
    expect(mergeCgStates(again, other, BASIC).checks!.U1).toEqual({ best: 2, sum: 2, n: 1, hist: [{ at: T(40), score: 2 }] });
  });
  it('예전 기록 옮김 표시는 한쪽만 있어도 남고 시각은 이른 쪽', () => {
    const x = { ...emptyCgState(), importedLegacy: true as const, importedLegacyAt: T(5) };
    const y = { ...emptyCgState(), importedLegacy: true as const, importedLegacyAt: T(2) };
    expect(mergeCgStates(x, emptyCgState(), BASIC)).toMatchObject({ importedLegacy: true, importedLegacyAt: T(5) });
    expect(mergeCgStates(x, y, BASIC)).toMatchObject({ importedLegacy: true, importedLegacyAt: T(2) });
    expect(mergeCgStates(emptyCgState(), emptyCgState(), BASIC)).not.toHaveProperty('importedLegacy');
    expect(mergeCgStates(emptyCgState(), emptyCgState(), BASIC)).not.toHaveProperty('checks');
  });
});

describe('5번 잠김 단원 초기화: 그 단원의 진도와 실력점검 기록(점수)까지', () => {
  it('그 단원만 지우고 다른 단원 실력점검·오답노트·모의고사는 그대로', () => {
    const ids = BASIC.unitById('U1')!.cards.map((c) => c.id);
    let s = markCard(emptyCgState(), 'U1', ids[0], ids, T(1)).state;
    s = recordSelfCheck(s, 'U1', 7, 10, T(2)).state;
    s = recordSelfCheck(s, 'U10', 4, 10, T(3)).state;
    s = noteAnswer(s, 'U1-a2', false, T(3));
    s = addMock(s, { id: 'm', kind: 'set1', at: T(4), score: 20, total: 30, seconds: 9, perUnit: {}, perArea: {} });
    for (let i = 0; i < 4; i++) s = addLock(s, 'U1', T(10 + i)).state;
    expect(s.checks!.U1!.best).toBe(7);
    const r = addLock(s, 'U1', T(20));
    expect(r.reset).toBe(true);
    expect(r.state.checks?.U1).toBeUndefined();
    expect(r.state.units.U1).toBeUndefined();
    expect(Object.keys(r.state.cards)).toEqual([]);
    expect(r.state.checks?.U10).toEqual(s.checks!.U10);
    expect(activeWrongIds(r.state)).toEqual(['U1-a2']);
    expect(r.state.mock).toHaveLength(1);
    // 마지막 실력점검 기록을 지우면 필드도 없어진다
    expect(resetUnit(resetUnit(r.state, 'U10', T(30)), 'U1', T(31))).not.toHaveProperty('checks');
  });
});

describe('실력점검 문항 뽑기·이어 풀기·학생 화면 문구', () => {
  const pool = BASIC.unitById('U1')!.check;
  it('12문항 중 10문항(중복 없음), 볼 때마다 새로 뽑음', () => {
    const a = drawSelfCheck(pool, 10, seededRandom('a'));
    expect(a).toHaveLength(10);
    expect(new Set(a.map((x) => x.id)).size).toBe(10);
    expect(a.every((x) => pool.includes(x))).toBe(true);
    const sets = new Set(Array.from({ length: 20 }, (_, i) => drawSelfCheck(pool, 10, seededRandom(`s${i}`)).map((x) => x.id).sort().join()));
    expect(sets.size).toBeGreaterThan(1);
    expect(drawSelfCheck(pool.slice(0, 8), 10)).toHaveLength(8); // 문항이 모자라면 있는 만큼
  });
  it('풀던 회차는 그 단원 실력점검 문항 10개일 때만 이어 푼다', () => {
    const ids = pool.map((x) => x.id);
    const ten = ids.slice(2);
    expect(resumableIds({ ids: ten, idx: 3, answers: {} }, ids, 10)).toEqual(ten);
    expect(resumableIds({ ids: ids.slice(0, 9) }, ids, 10)).toBeNull();
    expect(resumableIds({ ids: [...ids.slice(0, 9), 'U2-a1'] }, ids, 10)).toBeNull();
    expect(resumableIds({ ids: [...ids.slice(0, 9), ids[0]] }, ids, 10)).toBeNull();
    expect(resumableIds(null, ids, 10)).toBeNull();
    expect(resumableIds({ ids: 'x' }, ids, 10)).toBeNull();
  });
  it('학생 화면 한 줄: 최고점·누적만', () => {
    expect(selfCheckLine(undefined, 10)).toBe('실력점검 아직 안 풀었어요');
    expect(selfCheckLine({ best: 8, sum: 23, n: 3, hist: [] }, 10)).toBe('실력점검 최고 8/10 · 누적 23점');
  });
});

/** 예전 과목 기록(2진법 이해·IP 이해)의 모양 */
function oldState(): CgState {
  let s = markDone(emptyCgState(), 'U1', 1, T(1));
  s = recordScore(s, 'U1', 2, 9, 10, T(2)).state;
  s = recordScore(s, 'U1', 3, 8, 10, T(3)).state;
  s = markDone(s, 'U1', 4, T(4));
  s = recordScore(s, 'U1', 5, 7, 8, T(5)).state; // 통과(5/8 이상) 최고 7/8
  s = recordScore(s, 'U2', 2, 6, 10, T(6)).state; // 통과 전 시도 기록도 그대로
  s = recordScore(s, 'U2', 5, 3, 8, T(6)).state; // 통과 못 한 예전 5단계 → 옮기지 않음
  s = { ...s, cards: { ...s.cards, 'U1-t1': T(1), 'U3-t2': T(2) } };
  s = noteAnswer(noteAnswer(s, 'U2-a5', false, T(7)), 'U3-b1', false, T(7));
  s = noteAnswer(s, 'U3-b1', true, T(8));
  s = addMock(s, { id: 'old', kind: 'set1', at: T(9), score: 15, total: 20, seconds: 1, perUnit: {}, perArea: {} });
  s = addLock(s, 'U3', T(9)).state;
  return s;
}

describe('예전 과목 기록 옮기기(한 번): 2진법 이해 → 1~3단원, IP 이해 → 6·8·10단원', () => {
  it('8문항 실력점검 점수를 10문항으로', () => {
    expect([0, 1, 4, 5, 6, 7, 8].map((s) => scaleOldCheck(s, 8, 10))).toEqual([0, 1, 5, 6, 8, 9, 10]);
    expect(scaleOldCheck(5, undefined, 10)).toBe(6);
    expect(scaleOldCheck(9, 8, 10)).toBe(10);
  });
  it('2진법 이해: 1~4단계 기록·카드·오답노트 그대로, 통과한 5단계는 실력점검 1회, 모의고사·잠김은 옮기지 않음', () => {
    const m = mapLegacyState([oldState()], BIN, BASIC);
    expect(m.units.U1).toMatchObject({ lv1: { passedAt: T(1) }, lv2: { best: 9, total: 10, passedAt: T(2) }, lv3: { best: 8, total: 10 }, lv4: { passedAt: T(4) } });
    expect(m.units.U1?.lv5).toEqual({ passedAt: T(5), lastAt: T(5) });
    expect(m.checks?.U1).toEqual({ best: 9, sum: 9, n: 1, hist: [{ at: T(5), score: 9 }] });
    expect(m.units.U2).toEqual({ lv2: { best: 6, total: 10, lastAt: T(6) } });
    expect(m.checks?.U2).toBeUndefined();
    expect(m.cards).toEqual({ 'U1-t1': T(1), 'U3-t2': T(2) });
    expect(Object.keys(m.wrong).sort()).toEqual(['U2-a5', 'U3-b1']);
    expect(activeWrongIds(m)).toEqual(['U2-a5']);
    expect(m.mock).toEqual([]);
    expect(m.locks).toEqual({});
    expect(m.resets).toEqual({});
  });
  it('IP 이해: 단원 번호를 6·8·10으로(문항·카드 번호는 그대로)', () => {
    const m = mapLegacyState([oldState()], IP, BASIC);
    expect(Object.keys(m.units)).toEqual(['U6', 'U8']);
    expect(m.checks?.U6?.best).toBe(9);
    expect(m.cards).toEqual({ 'U6-t1': T(1), 'U10-t2': T(2) });
    expect(Object.keys(m.wrong).sort()).toEqual(['U10-b1', 'U8-a5']);
    expect(m.units.U1).toBeUndefined();
  });
  it('이 기기·서버 두 판은 예전 과목 기준으로 먼저 합친다(한쪽만 아는 예전 초기화가 오래된 기록을 되살리지 않게)', () => {
    const local = oldState();
    const remote = resetUnit(local, 'U1', T(50));
    const m = mapLegacyState([local, remote], BIN, BASIC);
    expect(m.units.U1).toBeUndefined();
    expect(m.checks?.U1).toBeUndefined();
    expect(m.units.U2).toBeDefined();
  });
  it('합치기: 이미 있는 기록은 덮어쓰지 않고 더 나은 쪽, 표시를 남겨 다시 하지 않음', () => {
    let cur = recordScore(emptyCgState(), 'U1', 2, 10, 10, T(30)).state; // 기초 다듬기에서 더 잘함
    cur = recordSelfCheck(cur, 'U1', 4, 10, T(31)).state;
    cur = recordScore(cur, 'U6', 3, 5, 10, T(32)).state;
    const inputs = [{ src: BIN, versions: [oldState()] }, { src: IP, versions: [oldState()] }];
    const r = importLegacy(cur, inputs, BASIC, T(40), true);
    expect(r.imported).toBe(true);
    const s = r.state;
    expect(s).toMatchObject({ importedLegacy: true, importedLegacyAt: T(40), upd: T(40) });
    expect(s.units.U1?.lv2).toMatchObject({ best: 10, passedAt: T(2) }); // 최고 점수는 큰 쪽, 통과 시각은 이른 쪽
    expect(s.units.U1?.lv1?.passedAt).toBe(T(1));
    // 실력점검: 예전 1회(9점) + 기초 다듬기 1회(4점)
    expect(s.checks!.U1).toEqual({ best: 9, sum: 13, n: 2, hist: [{ at: T(5), score: 9 }, { at: T(31), score: 4 }] });
    expect(s.units.U6?.lv3).toMatchObject({ best: 8 });
    expect(s.checks!.U6?.best).toBe(9);
    expect(Object.keys(s.wrong).sort()).toEqual(['U10-b1', 'U2-a5', 'U3-b1', 'U8-a5']);
    expect(s.mock).toEqual([]);
    // 표시가 있으면 다시 하지 않음
    expect(importLegacy(s, inputs, BASIC, T(50), true)).toEqual({ state: s, imported: false });
    // 정규화·병합을 거쳐도 그대로
    expect(normalizeCgState(JSON.parse(JSON.stringify(s)), BASIC)).toEqual(s);
  });
  it('서버를 못 읽었으면 표시 없이 이 기기 것만, 다음에 다시 해도 결과가 같다', () => {
    const inputs = [{ src: BIN, versions: [oldState()] }];
    const first = importLegacy(emptyCgState(), inputs, BASIC, T(40), false);
    expect(first.imported).toBe(true);
    expect(first.state).not.toHaveProperty('importedLegacy');
    const again = importLegacy(first.state, inputs, BASIC, T(41), false);
    expect(again).toEqual({ state: first.state, imported: false });
    const done = importLegacy(first.state, [...inputs, { src: IP, versions: [oldState()] }], BASIC, T(42), true);
    expect(done.imported).toBe(true);
    expect(done.state).toMatchObject({ importedLegacy: true, importedLegacyAt: T(42) });
    expect(done.state.checks!.U1).toEqual(first.state.checks!.U1);
  });
  it('옮길 것이 없으면 표시만(바뀐 기록 없음), 표시 없이 실패하면 그대로', () => {
    const cur = recordSelfCheck(emptyCgState(), 'U4', 5, 10, T(3)).state;
    const r = importLegacy(cur, [{ src: BIN, versions: [] }, { src: IP, versions: [emptyCgState()] }], BASIC, T(9), true);
    expect(r.imported).toBe(false);
    expect(r.state).toEqual({ ...cur, upd: T(9), importedLegacy: true, importedLegacyAt: T(9) });
    expect(importLegacy(cur, [], BASIC, T(9), false)).toEqual({ state: cur, imported: false });
  });
  it('기초 다듬기에서 초기화한 단원에는 예전 기록을 되살리지 않는다(오답노트는 합침)', () => {
    const cur = resetUnit(emptyCgState(), 'U1', T(30));
    const r = importLegacy(cur, [{ src: BIN, versions: [oldState()] }], BASIC, T(40), false);
    expect(r.state.units.U1).toBeUndefined();
    expect(r.state.checks?.U1).toBeUndefined();
    expect(r.state.cards['U1-t1']).toBeUndefined();
    expect(r.state.cards['U3-t2']).toBe(T(2));
    expect(r.state.units.U2).toBeDefined();
  });
  it('이상한 예전 기록(배열·문자열·다른 단원)은 무시', () => {
    expect(hasProgress(mapLegacyState(['x', [1], null, { units: { U9: { lv1: { passedAt: T(1) } } } }], BIN, BASIC), BASIC)).toBe(false);
  });
});

describe('예전 보충 학습 주소 → 기초 다듬기', () => {
  it('과목·단원·단계·모의고사·오답노트', () => {
    expect(legacyCoursePath('/binary')).toBe('/basics');
    expect(legacyCoursePath('/binary/')).toBe('/basics');
    expect(legacyCoursePath('/binary/unit/U1')).toBe('/basics/unit/U1');
    expect(legacyCoursePath('/binary/unit/U2/5')).toBe('/basics/unit/U2/5');
    expect(legacyCoursePath('/binary/unit/U3/3')).toBe('/basics/unit/U3/3');
    expect(legacyCoursePath('/binary/unit/U4')).toBe('/basics');
    expect(legacyCoursePath('/binary/unit/U2/9')).toBe('/basics/unit/U2');
    expect(legacyCoursePath('/ip')).toBe('/basics');
    expect(legacyCoursePath('/ip/unit/U1')).toBe('/basics/unit/U6');
    expect(legacyCoursePath('/ip/unit/U2/4')).toBe('/basics/unit/U8/4');
    expect(legacyCoursePath('/ip/unit/U3')).toBe('/basics/unit/U10');
    expect(legacyCoursePath('/ip/unit/constructor')).toBe('/basics');
    expect(legacyCoursePath('/binary/mock')).toBe('/basics/mock');
    expect(legacyCoursePath('/ip/mock/set2')).toBe('/basics/mock');
    expect(legacyCoursePath('/binary/wrong')).toBe('/basics/wrong');
    expect(legacyCoursePath('/ip/wrong')).toBe('/basics/wrong');
    expect(legacyCoursePath('/ip/teacher')).toBe('/teacher?s=basic');
    expect(legacyCoursePath('/ipx')).toBeNull();
    expect(legacyCoursePath('/basics')).toBeNull();
    expect(legacyCoursePath('/network/unit/U3')).toBeNull();
  });
});

describe('선생님 화면: 기초 다듬기 실력점검(선생님은 모두 봄)', () => {
  let a = recordSelfCheck(emptyCgState(), 'U1', 6, 10, T(1)).state;
  a = recordSelfCheck(a, 'U1', 9, 10, T(5)).state;
  a = recordSelfCheck(a, 'U1', 4, 10, T(9)).state;
  a = recordSelfCheck(a, 'U2', 7, 10, T(3)).state;
  const b = recordSelfCheck(emptyCgState(), 'U1', 8, 10, T(2)).state;
  const students = toStudents([
    { user_id: '1', name: '가온', email: 'a@x.kr', state: a, updated_at: T(9) },
    { user_id: '2', name: '나래', email: 'b@x.kr', state: b, updated_at: T(2) },
    { user_id: '3', name: '다온', email: 'c@x.kr', state: emptyCgState(), updated_at: T(1) },
  ], BASIC);
  it('학생별 누적·응시 합계', () => {
    expect(students.map((s) => [s.checkSum, s.checkN])).toEqual([[26, 4], [8, 1], [0, 0]]);
    expect(toStudents([{ user_id: '1', name: 'x', email: '', state: a, updated_at: T(1) }], CG_COURSE)[0]).toMatchObject({ checkSum: 0, checkN: 0 });
  });
  it('단원별 반 통계: 푼 학생 수·평균 최고점(푼 학생 기준)·응시 합계', () => {
    const st = selfCheckClassStats(students, BASIC);
    expect(st).toHaveLength(10);
    expect(st[0]).toEqual({ unitId: 'U1', students: 2, avgBest: 8.5, attempts: 4 });
    expect(st[1]).toEqual({ unitId: 'U2', students: 1, avgBest: 7, attempts: 1 });
    expect(st[2]).toEqual({ unitId: 'U3', students: 0, avgBest: 0, attempts: 0 });
    expect(selfCheckClassStats(students, CG_COURSE)).toEqual([]);
  });
  it('학생 한 명: 단원별 최고·누적·횟수·마지막 점수와 회차 기록(최근 순)', () => {
    const rows = studentSelfChecks(a, BASIC);
    expect(rows[0]).toEqual({ unitId: 'U1', best: 9, sum: 19, n: 3, last: 4, lastAt: T(9), hist: [{ at: T(9), score: 4 }, { at: T(5), score: 9 }, { at: T(1), score: 6 }] });
    expect(rows[2]).toMatchObject({ unitId: 'U3', n: 0, last: null });
    const d = studentDetail(students[0], BASIC);
    expect(d.checkHist.map((h) => [h.unitId, h.at, h.score])).toEqual([['U1', T(9), 4], ['U1', T(5), 9], ['U2', T(3), 7], ['U1', T(1), 6]]);
    expect(studentDetail(students[0], CG_COURSE).checks).toEqual([]);
  });
  it('CSV에 넣을 값(최고·누적·횟수)은 문자 그대로', () => {
    expect(toCsv(['U1 최고', 'U1 누적'], [[9, 19]]).split('\r\n')[1]).toBe('9,19');
  });
});

describe('실시간 학습 위치: 기초 다듬기', () => {
  it('과목 목록에 기초 다듬기(/basics), 예전 보충 학습은 없음', () => {
    expect(SUBJECT_LIST.find((s) => s.id === 'basic')).toEqual({ id: 'basic', name: '기초 다듬기', path: '/basics' });
    expect(SUBJECT_LIST.map((s) => s.id)).not.toContain('bin');
    expect(NEW_COURSES.find((c) => c.id === 'basic')?.path).toBe('/basics');
  });
  it('실력점검 중: "N단원 · 실력점검 문항 k/10"', () => {
    expect(deriveLocation('/basics/unit/U3/5')).toEqual({ subject: 'basic', unit: 'U3', step: '5', label: '3단원 · 실력점검', activity: true });
    expect(deriveLocation('/basics/unit/U10/3')).toMatchObject({ label: '10단원 · 3단계 기초 객관식' });
    const env = { visible: true, hasFocus: true, idle: false, session: null, fs: true, sharing: false, dev: 'abc' };
    expect(buildLiveState({ ...env, path: '/basics/unit/U3/5', detail: '문항 4/10' })).toMatchObject({ label: '3단원 · 실력점검 문항 4/10', detail: null, step: '5', unit: 'U3' });
    // 결과 화면(문항 위치 없음)
    expect(buildLiveState({ ...env, path: '/basics/unit/U3/5', detail: null })).toMatchObject({ label: '3단원 · 실력점검', detail: null });
    // 다른 과목 5단계는 예전 그대로
    expect(buildLiveState({ ...env, path: '/network/unit/U2/5', detail: '문항 3/15' })).toMatchObject({ label: '2단원 · 5단계 실력점검', detail: '문항 3/15' });
  });
});

describe('픽스처 확인', () => {
  it('기초 다듬기 10단원, 단원마다 실력점검 12문항', () => {
    expect(BASIC.units.map((u) => u.check.length)).toEqual(Array(10).fill(12));
    expect(adaptUnits([raw(1)], { areas: ['NUM'] })[0].check[11].id).toBe('U1-a12');
  });
});
