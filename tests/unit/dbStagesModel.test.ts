import { describe, expect, it } from 'vitest';
import { UNIT_STAGES } from '../../src/content/stages';
import {
  addUnitLock, completeActivity, answerQuestion, emptyLearnerState, markStageItem, mergeLearnerStates, nextStep, recordStageQuiz,
  resetUnitProgress, stageOpen, stagePassed, unitStageLevel, UNIT_LOCK_LIMIT, unitStatus, type LearnerState,
} from '../../src/features/progress/model';
import { UNITS } from '../../src/content';

const T = (n: number) => `2026-10-15T01:00:${String(n).padStart(2, '0')}.000Z`;
const pre = (s: LearnerState): LearnerState => ({ ...s, pre: { status: 'skipped', answers: {}, score: 0 } });

function passTheory(s: LearnerState, u: 'U01' | 'U02') {
  for (const c of UNIT_STAGES[u].cards) s = markStageItem(s, u, 1, c.id, T(1)).state;
  return s;
}

describe('데이터베이스 단원 단계(1 이론·개념 맞추기 → 2 개념 점검 → 3 실습 설명·맞추기 → 4 실습 점검)', () => {
  it('카드를 모두 마쳐야 1단계 통과, 그다음 2단계가 열린다', () => {
    let s = pre(emptyLearnerState('t'));
    expect(stageOpen(s, 'U01', 1)).toBe(true);
    expect(stageOpen(s, 'U01', 2)).toBe(false);
    const cards = UNIT_STAGES.U01.cards;
    for (const c of cards.slice(0, -1)) {
      const r = markStageItem(s, 'U01', 1, c.id, T(1));
      expect(r.stageDone).toBe(false);
      s = r.state;
    }
    const r = markStageItem(s, 'U01', 1, cards[cards.length - 1].id, T(2));
    expect(r).toMatchObject({ stageDone: true, firstPass: true });
    expect(stagePassed(r.state, 'U01', 1)).toBe(true);
    expect(stageOpen(r.state, 'U01', 2)).toBe(true);
    expect(unitStageLevel(r.state, 'U01')).toBe(1);
    expect(unitStatus(r.state, 'U01')).toBe('in-progress');
  });
  it('개념 점검은 10문항 중 7개 이상이면 통과, 최고 점수 유지', () => {
    let s = passTheory(pre(emptyLearnerState('t')), 'U01');
    let r = recordStageQuiz(s, 'U01', 6, 10, T(3));
    expect(r.passed).toBe(false);
    s = r.state;
    r = recordStageQuiz(s, 'U01', 8, 10, T(4));
    expect(r).toMatchObject({ passed: true, firstPass: true });
    r = recordStageQuiz(r.state, 'U01', 5, 10, T(5));
    expect(r.state.stages?.U01?.s2).toMatchObject({ best: 8, passedAt: T(4) });
    expect(stageOpen(r.state, 'U01', 3)).toBe(true);
  });
  it('이어하기: 새 학생은 1단계부터, 3단계까지 통과하면 활동으로', () => {
    let s = pre(emptyLearnerState('t'));
    expect(nextStep(s)).toBe('/learn/U01/stage/1');
    s = passTheory(s, 'U01');
    expect(nextStep(s)).toBe('/learn/U01/stage/2');
    s = recordStageQuiz(s, 'U01', 10, 10, T(6)).state;
    expect(nextStep(s)).toBe('/learn/U01/stage/3');
    for (const p of UNIT_STAGES.U01.practice) s = markStageItem(s, 'U01', 3, p.id, T(7)).state;
    expect(stageOpen(s, 'U01', 4)).toBe(true);
    expect(nextStep(s)).toBe('/learn/U01/U01-A01');
  });
  it('예전 방식으로 활동을 시작한 학생은 1~3단계와 관계없이 4단계가 열려 있다', () => {
    let s = pre(emptyLearnerState('t'));
    s = completeActivity(s, 'U01-A01', T(1));
    expect(stageOpen(s, 'U01', 4)).toBe(true);
    expect(nextStep(s)).toBe('/learn/U01/U01-A02');
    // 단원 완료(활동 4 + 체크포인트 2)는 4단계 통과
    const u = UNITS[0];
    for (const a of u.activityIds) s = completeActivity(s, a, T(2));
    for (const q of u.checkpointIds.slice(0, 2)) s = answerQuestion(s, q, 'x', true, T(3));
    expect(stagePassed(s, 'U01', 4)).toBe(true);
  });
  it('기기 간 병합: 통과는 사라지지 않고 마친 카드는 합집합', () => {
    const a = markStageItem(pre(emptyLearnerState('t')), 'U01', 1, 'U01-t1', T(1)).state;
    const b = recordStageQuiz(markStageItem(pre(emptyLearnerState('t')), 'U01', 1, 'U01-t2', T(2)).state, 'U01', 9, 10, T(3)).state;
    const m = mergeLearnerStates(a, b);
    expect(Object.keys(m.stageItems ?? {}).sort()).toEqual(['U01-t1', 'U01-t2']);
    expect(m.stages?.U01?.s2).toMatchObject({ best: 9, passedAt: T(3) });
    expect(m.stages?.U01?.s1?.lastAt).toBe(T(2));
  });
  it('두 기기에서 나눠 마친 카드가 합쳐져 모두 끝나면 1단계 통과', () => {
    const cards = UNIT_STAGES.U01.cards;
    let a = pre(emptyLearnerState('t'));
    let b = pre(emptyLearnerState('t'));
    cards.forEach((c, i) => {
      if (i % 2) a = markStageItem(a, 'U01', 1, c.id, T(i)).state;
      else b = markStageItem(b, 'U01', 1, c.id, T(i)).state;
    });
    expect(stagePassed(a, 'U01', 1)).toBe(false);
    const m = mergeLearnerStates(a, b);
    expect(stagePassed(m, 'U01', 1)).toBe(true);
    expect(m.stages?.U01?.s1?.passedAt).toBe(T(cards.length - 1));
  });
  it('예전에 활동을 열어 보기만 했어도(초안·시간 기록) 4단계는 열려 있다', () => {
    const s = { ...pre(emptyLearnerState('t')), activities: { 'U02-A01': { ...completeActivity(emptyLearnerState('t'), 'U02-A01').activities['U02-A01'], completedAt: null, attempts: 0 } } };
    expect(stageOpen(s, 'U02', 4)).toBe(true);
  });
  it('단원 초기화(5번 잠김)는 그 단원의 단계 기록과 마친 카드·예제도 지운다', () => {
    let s = passTheory(passTheory(pre(emptyLearnerState('t')), 'U01'), 'U02');
    s = recordStageQuiz(s, 'U01', 9, 10, T(4)).state;
    for (let i = 1; i < UNIT_LOCK_LIMIT; i++) s = addUnitLock(s, 'U01', T(10 + i)).state;
    const r = addUnitLock(s, 'U01', T(20));
    expect(r.reset).toBe(true);
    expect(r.state.stages?.U01).toBeUndefined();
    expect(Object.keys(r.state.stageItems ?? {}).some((k) => k.startsWith('U01-'))).toBe(false);
    expect(stagePassed(r.state, 'U02', 1)).toBe(true);
    // 다른 기기의 예전 기록과 합쳐도 되살아나지 않는다
    const m = mergeLearnerStates(s, resetUnitProgress(s, 'U01', T(30)));
    expect(m.stages?.U01).toBeUndefined();
  });
});
