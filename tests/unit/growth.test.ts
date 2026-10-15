import { beforeEach, describe, expect, it } from 'vitest';
import { ACTIVITIES, CHECKPOINTS, FINAL_DIAGNOSTIC, UNITS, VARIANT_OF } from '../../src/content';
import { MAX_XP, STAGES, gardenParams, levelOf, stageOf, xpToNextLevel } from '../../src/features/growth/levels';
import { LocalLedger, totalXpOf, type Ledger } from '../../src/features/progress/ledger';
import {
  answerQuestion, completeActivity, eligibleBadges, eligibleRewards, emptyLearnerState, isUnitComplete, isUnitUnlocked,
  revealHint, revealQuestion, revealSolution, viewExplanation, type LearnerState, unitStatus, mergeLearnerStates, recordAttempt,
  addUnitLock, resetUnitProgress, unitLockCount, unitRewardIds, UNIT_LOCK_LIMIT, recordChallenge, unitKeepList,
} from '../../src/features/progress/model';
import { REWARD_CATALOG } from '../../src/features/progress/rewards';
import { removeWithPrefix } from '../../src/lib/storage';

describe('레벨 계산', () => {
  it.each([[0, 0], [99, 0], [100, 1], [9899, 98], [9900, 99], [12000, 99]])('XP %i → Lv%i', (xp, lv) => {
    expect(levelOf(xp)).toBe(lv);
  });
  it('다음 레벨까지 XP, Lv99는 성장 완료(null)', () => {
    expect(xpToNextLevel(0)).toBe(100);
    expect(xpToNextLevel(650)).toBe(50);
    expect(xpToNextLevel(9900)).toBeNull();
  });
  it('0~99 모든 정수 레벨에 성장 단계 이름이 있고 표와 일치', () => {
    for (let l = 0; l <= 99; l++) expect(stageOf(l), `Lv${l}`).toBeDefined();
    expect(stageOf(0).name).toBe('잠든 씨앗');
    expect(stageOf(1).name).toBe('깨어난 씨앗');
    expect(stageOf(9).name).toBe('깨어난 씨앗');
    expect(stageOf(10).name).toBe('새싹');
    expect(stageOf(29).name).toBe('어린 풀');
    expect(stageOf(30).name).toBe('작은 묘목');
    expect(stageOf(60).name).toBe('꽃피는 나무');
    expect(stageOf(70).name).toBe('작은 숲');
    expect(stageOf(89).name).toBe('넓어지는 숲');
    expect(stageOf(98).name).toBe('울창한 숲');
    expect(stageOf(99).name).toBe('나의 SQL 숲 완성');
    expect(STAGES.reduce((n, s) => n + (s.max - s.min + 1), 0)).toBe(100);
  });
  it('레벨마다 정원 파라미터가 최소 한 요소 이상 달라지고, 같은 레벨은 같은 장면', () => {
    for (let l = 0; l < 99; l++) {
      expect(JSON.stringify(gardenParams(l)), `Lv${l}→${l + 1}`).not.toBe(JSON.stringify(gardenParams(l + 1)));
      // 색 외에 형태 요소도 변하는지(구간 내 연속 변화)
      const a = gardenParams(l), b = gardenParams(l + 1);
      const shape = (p: typeof a) => [p.seedOpen, p.rootLength, p.stemHeight, p.leafCount, p.grassCount, p.branchLength, p.flowerCount, p.extraTrees, p.trunkWidth].join();
      expect(shape(a), `Lv${l} 형태 변화 없음`).not.toBe(shape(b));
    }
    expect(gardenParams(42)).toEqual(gardenParams(42));
    expect(gardenParams(99).completed).toBe(true);
    expect(gardenParams(98).completed).toBe(false);
  });
});

describe('보상 카탈로그', () => {
  it('총 9,900 XP: 활동100×48, 문항50×36, 단원100×12, 진단100×12, 마무리900', () => {
    const by = (p: string) => REWARD_CATALOG.filter((r) => r.rewardId.startsWith(p));
    expect(by('activity:').length).toBe(48);
    expect(by('activity:').every((r) => r.xp === 100)).toBe(true);
    expect(by('checkpoint:').length).toBe(36);
    expect(by('checkpoint:').every((r) => r.xp === 50)).toBe(true);
    expect(by('unit:').length).toBe(12);
    expect(by('unit:').every((r) => r.xp === 100)).toBe(true);
    expect(by('final:').length).toBe(12);
    expect(by('final:').every((r) => r.xp === 100)).toBe(true);
    expect(REWARD_CATALOG.find((r) => r.rewardId === 'course:complete')?.xp).toBe(900);
    expect(REWARD_CATALOG.reduce((s, r) => s + r.xp, 0)).toBe(MAX_XP);
  });
});

/* -------- 시나리오: 기본 모드만으로 Lv99 -------- */

let ledger: Ledger;
let n = 0;
beforeEach(() => {
  removeWithPrefix('test:');
  ledger = new LocalLedger(`test:ledger:${n++}`);
});

async function reconcile(s: LearnerState) {
  for (const r of eligibleRewards(s)) await ledger.award(r);
}
const xp = () => totalXpOf(ledger.snapshot());

function doUnit(s: LearnerState, unitId: string, solveAll = true): LearnerState {
  const u = UNITS.find((x) => x.id === unitId)!;
  for (const a of u.activityIds) {
    s = revealHint(revealHint(revealHint(s, a), a), a); // 힌트 3단계 모두 사용해도
    s = completeActivity(s, a);
  }
  u.checkpointIds.forEach((q, i) => {
    if (solveAll || i < 2) s = answerQuestion(s, q, 'x', true);
  });
  return s;
}

describe('XP 시나리오 (05_GROWTH_SYSTEM 테스트 사례)', () => {
  it('U01 활동4+체크포인트3+단원완료 = 650XP / Lv6, 힌트 사용으로 줄지 않음', async () => {
    let s = emptyLearnerState('t');
    s = doUnit(s, 'U01');
    await reconcile(s);
    expect(xp()).toBe(650);
    expect(levelOf(xp())).toBe(6);
  });

  it('체크포인트 2/3로 단원 해제, 남은 문항 XP는 미지급, 마무리 보상 거부', async () => {
    let s = emptyLearnerState('t');
    s = doUnit(s, 'U01', false);
    expect(isUnitComplete(s, 'U01')).toBe(true);
    expect(isUnitUnlocked(s, 'U02')).toBe(true);
    expect(unitStatus(s, 'U01')).toBe('review');
    await reconcile(s);
    expect(xp()).toBe(400 + 100 + 100); // 활동 4, 문항 2, 단원
    const r = await ledger.award('course:complete');
    expect(r.status).toBe('rejected');
  });

  it('체크포인트 1/3이면 단원 미완료·다음 단원 잠김', () => {
    let s = emptyLearnerState('t');
    for (const a of UNITS[0].activityIds) s = completeActivity(s, a);
    s = answerQuestion(s, 'U01-Q01', 'x', true);
    s = answerQuestion(s, 'U01-Q02', 'x', false);
    expect(isUnitComplete(s, 'U01')).toBe(false);
    expect(isUnitUnlocked(s, 'U02')).toBe(false);
    expect(unitStatus(s, 'U02')).toBe('locked');
  });

  it('전 단원 7,800XP/Lv78 → 최종 진단 후 9,000/Lv90 → 마무리 9,900/Lv99', async () => {
    let s = emptyLearnerState('t');
    for (const u of UNITS) s = doUnit(s, u.id);
    await reconcile(s);
    expect(xp()).toBe(7800);
    expect(levelOf(xp())).toBe(78);
    for (const q of FINAL_DIAGNOSTIC) {
      s = answerQuestion(s, q.id, 'x', false); // 정오답 무관
      s = viewExplanation(s, q.id);
    }
    // 마무리 보상 전 상태: eligibleRewards에서 course를 빼고 지급
    for (const r of eligibleRewards(s).filter((r) => r !== 'course:complete')) await ledger.award(r);
    expect(xp()).toBe(9000);
    expect(levelOf(xp())).toBe(90);
    await reconcile(s);
    expect(xp()).toBe(9900);
    expect(levelOf(xp())).toBe(99);
    expect(eligibleBadges(s)).toContain('badge:forest');
  });

  it('최종 진단은 답 제출 전 해설 확인만으로 인정하지 않음', () => {
    let s = emptyLearnerState('t');
    s = viewExplanation(s, 'F01');
    expect(eligibleRewards(s)).not.toContain('final:F01');
  });

  it('최종 진단 보상은 모든 단원 완료 전이면 원장에서 거부', async () => {
    expect((await ledger.award('final:F01')).status).toBe('rejected');
  });

  it('중복 지급 불가: 재제출·재로딩(새 원장 인스턴스)·동시 요청·모드 변경', async () => {
    let s = emptyLearnerState('t');
    s = completeActivity(s, 'U01-A01');
    s = completeActivity(s, 'U01-A01'); // 재제출
    await Promise.all([reconcile(s), reconcile(s), reconcile(s)]); // 동시
    const key = `test:ledger:${n - 1}`;
    const reloaded = new LocalLedger(key); // 페이지 재로딩
    await reloaded.award('activity:U01-A01');
    s = { ...s, mode: 'challenge' };
    await reconcile(s);
    expect(totalXpOf(reloaded.snapshot())).toBe(100);
  });

  it('정답 공개 후 원문을 맞혀도 문항 XP 없음 → 변형 문항을 풀어야 지급', async () => {
    let s = emptyLearnerState('t');
    s = revealQuestion(s, 'U01-Q01');
    s = answerQuestion(s, 'U01-Q01', 'x', true);
    expect(eligibleRewards(s)).not.toContain('checkpoint:U01-Q01');
    s = answerQuestion(s, VARIANT_OF['U01-Q01'].id, 'x', true);
    expect(eligibleRewards(s)).toContain('checkpoint:U01-Q01');
    await reconcile(s);
    expect(xp()).toBe(50);
  });

  it('정답을 본 활동은 guided로 완료되고 XP는 동일(100)', async () => {
    let s = emptyLearnerState('t');
    s = revealSolution(s, 'U03-A01');
    s = completeActivity(s, 'U03-A01');
    expect(s.activities['U03-A01'].completionKind).toBe('guided');
    await reconcile(s);
    expect(xp()).toBe(100);
  });

  it('완료한 활동 재도전: 정답 보기 = 설명 확인, 다시 맞힘 = 재도전 완료, completionKind 유지', () => {
    let s = emptyLearnerState('t');
    s = completeActivity(s, 'U03-A01');
    s = revealSolution(s, 'U03-A01');
    expect(s.activities['U03-A01'].review).toBe('explained');
    s = completeActivity(s, 'U03-A01');
    expect(s.activities['U03-A01'].review).toBe('retried');
    expect(s.activities['U03-A01'].completionKind).toBe('independent');
  });

  it('XP 원장에 없는 보상 ID는 거부', async () => {
    expect((await ledger.award('activity:U99-A01')).status).toBe('rejected');
    expect((await ledger.award('activity:CH-U01')).status).toBe('rejected'); // 도전 문제는 XP 없음
  });

  it('배지: 단원 완료 배지 1회, 다시 해냈어요', async () => {
    let s = emptyLearnerState('t');
    s = recordAttempt(s, 'U01-A01', false, []);
    s = answerQuestion(s, 'U01-Q01', 'x', false);
    s = answerQuestion(s, 'U01-Q01', 'y', true);
    expect(eligibleBadges(s)).toContain('badge:retry-success');
    expect((await ledger.awardBadge('badge:unit-U01', 0)).status).toBe('rejected');
    s = doUnit(s, 'U01');
    await reconcile(s);
    expect((await ledger.awardBadge('badge:unit-U01', 0)).status).toBe('awarded');
    expect((await ledger.awardBadge('badge:unit-U01', 0)).status).toBe('duplicate');
    expect((await ledger.awardBadge('badge:self-solved', 2)).status).toBe('rejected');
    expect((await ledger.awardBadge('badge:self-solved', 3)).status).toBe('awarded');
  });

  it('두 기기 상태 병합: 완료는 합집합(단조 증가)', () => {
    let a = emptyLearnerState('t');
    let b = emptyLearnerState('t');
    a = completeActivity(a, 'U01-A01');
    b = completeActivity(b, 'U01-A02');
    const m = mergeLearnerStates(a, b);
    expect(Object.values(m.activities).filter((x) => x.completedAt).length).toBe(2);
  });

  it('48개 활동·36개 체크포인트 ID가 보상 ID와 1:1', () => {
    expect(new Set(ACTIVITIES.map((a) => `activity:${a.id}`)).size).toBe(48);
    expect(new Set(CHECKPOINTS.map((q) => `checkpoint:${q.id}`)).size).toBe(36);
  });
});

describe('단원 집중 학습: 잠김 5번이면 그 단원 초기화(데이터베이스)', () => {
  const T = (n: number) => `2026-10-15T00:00:${String(n).padStart(2, '0')}.000Z`;
  const studied = () => {
    let s = emptyLearnerState('t');
    for (const u of ['U01', 'U02'] as const) {
      const unit = UNITS.find((x) => x.id === u)!;
      for (const a of unit.activityIds) s = completeActivity(s, a, T(1));
      for (const q of unit.checkpointIds) s = answerQuestion(s, q, 'x', true, T(1));
      s = { ...s, celebratedUnits: [...s.celebratedUnits, u] };
    }
    s = answerQuestion(s, VARIANT_OF['U01-Q03'].id, 'x', false, T(2));
    s = recordChallenge(s, 'CH-U01', 'solved', T(2));
    return s;
  };
  it('5번째 잠김에 그 단원의 활동·체크포인트(변형 포함)·도전·축하 기록을 지우고 오답 기록·다른 단원은 남긴다', () => {
    let s = studied();
    const wrongBefore = s.wrongLog.length;
    for (let i = 1; i < UNIT_LOCK_LIMIT; i++) s = addUnitLock(s, 'U01', T(10 + i)).state;
    expect(unitLockCount(s, 'U01')).toBe(4);
    const r = addUnitLock(s, 'U01', T(20));
    expect(r).toMatchObject({ count: 5, reset: true });
    expect(isUnitComplete(r.state, 'U01')).toBe(false);
    expect(Object.keys(r.state.activities).some((k) => k.startsWith('U01'))).toBe(false);
    expect(Object.keys(r.state.questions).some((k) => k.includes('U01'))).toBe(false);
    expect(r.state.challenges['CH-U01']).toBeUndefined();
    expect(r.state.celebratedUnits).toEqual(['U02']);
    expect(isUnitComplete(r.state, 'U02')).toBe(true);
    expect(r.state.wrongLog.length).toBe(wrongBefore);
    expect(unitLockCount(r.state, 'U01')).toBe(0);
    expect(eligibleRewards(r.state).some((x) => x.includes('U01'))).toBe(false);
  });
  it('다른 기기의 예전 기록과 합쳐도 초기화가 되살아나지 않는다', () => {
    const old = studied();
    const fresh = completeActivity(resetUnitProgress(old, 'U01', T(30)), 'U01-A01', T(31));
    for (const m of [mergeLearnerStates(old, fresh), mergeLearnerStates(fresh, old)]) {
      expect(Object.keys(m.activities).filter((k) => k.startsWith('U01'))).toEqual(['U01-A01']);
      expect(isUnitComplete(m, 'U01')).toBe(false);
      expect(isUnitComplete(m, 'U02')).toBe(true);
      expect(m.unitResets?.U01?.at).toBe(T(30));
    }
  });
  it('단원 초기화로 지우는 보상: 활동 4·체크포인트 3·단원·단원 배지', () => {
    expect(unitRewardIds('U03')).toEqual(['activity:U03-A01', 'activity:U03-A02', 'activity:U03-A03', 'activity:U03-A04', 'checkpoint:U03-Q01', 'checkpoint:U03-Q02', 'checkpoint:U03-Q03', 'unit:U03', 'badge:unit-U03']);
  });
  it('서버 초기화 재전송 때 남길 목록: 초기화 뒤 새로 한 공부만', () => {
    let s = resetUnitProgress(studied(), 'U01', T(30));
    expect(unitKeepList(s, 'U01')).toEqual([]);
    s = completeActivity(s, 'U01-A02', T(31));
    s = recordChallenge(s, 'CH-U01', 'learned', T(32));
    expect(unitKeepList(s, 'U01').sort()).toEqual(['U01-A02', 'activity:U01-A02', 'mastery:CH-U01']);
    expect(unitKeepList(s, 'U02')).toContain('unit:U02');
  });
  it('데모 원장: forget으로 그 단원 보상을 지우면 다시 받을 수 있다', async () => {
    removeWithPrefix('test:forget');
    const ledger = new LocalLedger('test:forget');
    expect((await ledger.award('activity:U01-A01')).status).toBe('awarded');
    ledger.forget(unitRewardIds('U01'));
    expect(totalXpOf(ledger.snapshot())).toBe(0);
    expect((await ledger.award('activity:U01-A01')).status).toBe('awarded');
  });
});
