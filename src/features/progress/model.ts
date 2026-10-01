import { ACTIVITY_BY_ID, CHALLENGE_BY_ID, CHECKPOINTS, FINAL_DIAGNOSTIC, QUESTION_BY_ID, UNITS, UNIT_IDS, VARIANT_OF } from '../../content';
import type { UnitId } from '../../content/types';

/**
 * 학습자 진도 상태(순수 데이터 + 순수 함수).
 * - 완료 집합은 단조 증가(한 번 완료한 활동은 되돌리지 않음).
 * - 학습 진도와 게임 레벨(XP 원장)은 별개다. 보상은 reconcileRewards로 원장에 요청한다.
 */

export type CompletionKind = 'independent' | 'guided';

export interface ActivityProgress {
  activityId: string;
  contentVersion: number;
  /** 활동 종류별 조작 상태(JSON) */
  state: Record<string, unknown>;
  draftSql: string;
  attempts: number;
  hintLevel: 0 | 1 | 2 | 3;
  predictionAnswer: number | null;
  revealed: boolean;
  completionKind: CompletionKind | null;
  completedAt: string | null;
  /** 완료 후 복습 상태: 정답 보기 후 '설명 확인' / 재도전 정답 '재도전 완료' */
  review: 'explained' | 'retried' | null;
  wrongCount: number;
  activeSeconds: number;
  /** 서버 revision (compare-and-set) */
  serverRevision: number;
  updatedAt: string;
}

export interface QuestionProgress {
  questionId: string;
  attempts: number;
  wrongCount: number;
  /** 정답 공개 전 스스로 맞힘 */
  correct: boolean;
  solvedAt: string | null;
  revealed: boolean;
  lastAnswer: string | number | null;
  lastCorrect: boolean | null;
  /** 최종 진단: 채점 후 해설 확인 */
  explanationViewed: boolean;
}

export interface LearnerState {
  schema: 1;
  learnerKey: string;
  createdAt: string;
  mode: 'basic' | 'challenge';
  pre: { status: 'done' | 'skipped'; answers: Record<string, number>; score: number } | null;
  activities: Record<string, ActivityProgress>;
  questions: Record<string, QuestionProgress>;
  challenges: Record<string, { status: 'solved' | 'learned'; at: string }>;
  /** 단원 완료 축하를 이미 보여줬는지 */
  celebratedUnits: UnitId[];
  totalActiveSeconds: number;
  lastLocation: string | null;
  wrongLog: { itemId: string; conceptTags: string[]; at: string }[];
}

export function emptyLearnerState(learnerKey: string, now = new Date().toISOString()): LearnerState {
  return {
    schema: 1, learnerKey, createdAt: now, mode: 'basic', pre: null, activities: {}, questions: {}, challenges: {},
    celebratedUnits: [], totalActiveSeconds: 0, lastLocation: null, wrongLog: [],
  };
}

export function emptyActivity(activityId: string, now = new Date().toISOString()): ActivityProgress {
  const a = ACTIVITY_BY_ID[activityId] ?? CHALLENGE_BY_ID[activityId]?.activity;
  return {
    activityId, contentVersion: a?.contentVersion ?? 1, state: {}, draftSql: '', attempts: 0, hintLevel: 0,
    predictionAnswer: null, revealed: false, completionKind: null, completedAt: null, review: null, wrongCount: 0,
    activeSeconds: 0, serverRevision: 0, updatedAt: now,
  };
}

export function emptyQuestion(questionId: string): QuestionProgress {
  return { questionId, attempts: 0, wrongCount: 0, correct: false, solvedAt: null, revealed: false, lastAnswer: null, lastCorrect: null, explanationViewed: false };
}

/* ---------------- 파생 상태 ---------------- */

export const isActivityComplete = (s: LearnerState, id: string) => !!s.activities[id]?.completedAt;

/** 체크포인트 해결: 원문 또는 대응 변형을 정답 공개 전에 맞힘 */
export function checkpointSolved(s: LearnerState, checkpointId: string): boolean {
  const v = VARIANT_OF[checkpointId];
  return !!s.questions[checkpointId]?.correct || (!!v && !!s.questions[v.id]?.correct);
}

export function unitCheckpointScore(s: LearnerState, unitId: UnitId): number {
  return UNITS.find((u) => u.id === unitId)!.checkpointIds.filter((q) => checkpointSolved(s, q)).length;
}

export function unitActivitiesDone(s: LearnerState, unitId: UnitId): number {
  return UNITS.find((u) => u.id === unitId)!.activityIds.filter((a) => isActivityComplete(s, a)).length;
}

export function isUnitComplete(s: LearnerState, unitId: UnitId): boolean {
  return unitActivitiesDone(s, unitId) === 4 && unitCheckpointScore(s, unitId) >= 2;
}

export function isUnitUnlocked(s: LearnerState, unitId: UnitId): boolean {
  const i = UNIT_IDS.indexOf(unitId);
  if (i <= 0) return true;
  return isUnitComplete(s, UNIT_IDS[i - 1]) || isUnitComplete(s, unitId);
}

export type UnitStatus = 'locked' | 'ready' | 'in-progress' | 'complete' | 'review';

/** 잠김/진행 가능/진행중/완료/복습(완료했지만 미해결 체크포인트 있음) */
export function unitStatus(s: LearnerState, unitId: UnitId): UnitStatus {
  if (!isUnitUnlocked(s, unitId)) return 'locked';
  if (isUnitComplete(s, unitId)) return unitCheckpointScore(s, unitId) === 3 ? 'complete' : 'review';
  const unit = UNITS.find((u) => u.id === unitId)!;
  const touched = unit.activityIds.some((a) => s.activities[a]?.attempts || s.activities[a]?.completedAt) || unit.checkpointIds.some((q) => s.questions[q]?.attempts);
  return touched ? 'in-progress' : 'ready';
}

export const allUnitsComplete = (s: LearnerState) => UNIT_IDS.every((u) => isUnitComplete(s, u));
export const allCheckpointsSolved = (s: LearnerState) => CHECKPOINTS.every((q) => checkpointSolved(s, q.id));
export const finalUnlocked = allUnitsComplete;
export const finalComplete = (s: LearnerState) => FINAL_DIAGNOSTIC.every((q) => s.questions[q.id]?.explanationViewed);
export const courseComplete = (s: LearnerState) => allUnitsComplete(s) && allCheckpointsSolved(s) && finalComplete(s);

export function unsolvedCheckpoints(s: LearnerState): string[] {
  return CHECKPOINTS.filter((q) => !checkpointSolved(s, q.id)).map((q) => q.id);
}

/** 이어하기 위치: 첫 미완료 활동 → 체크포인트 → 다음 단원 */
export function nextStep(s: LearnerState): string {
  for (const u of UNITS) {
    if (!isUnitUnlocked(s, u.id)) break;
    if (isUnitComplete(s, u.id)) continue;
    const a = u.activityIds.find((id) => !isActivityComplete(s, id));
    if (a) return `/learn/${u.id}/${a}`;
    return `/learn/${u.id}/checkpoint`;
  }
  if (!finalComplete(s)) return '/final';
  if (!allCheckpointsSolved(s)) return '/review';
  return '/report';
}

/* ---------------- 상태 변경(불변) ---------------- */

function touchActivity(s: LearnerState, id: string, f: (a: ActivityProgress) => ActivityProgress, now: string): LearnerState {
  const cur = s.activities[id] ?? emptyActivity(id, now);
  return { ...s, activities: { ...s.activities, [id]: { ...f(cur), updatedAt: now } } };
}

export function saveActivityDraft(s: LearnerState, id: string, patch: Partial<Pick<ActivityProgress, 'draftSql' | 'state' | 'predictionAnswer'>>, now = new Date().toISOString()): LearnerState {
  return touchActivity(s, id, (a) => ({ ...a, ...patch }), now);
}

export function revealHint(s: LearnerState, id: string, now = new Date().toISOString()): LearnerState {
  // 힌트는 순서대로만 펼친다. 힌트 사용은 XP에 영향을 주지 않는다.
  return touchActivity(s, id, (a) => ({ ...a, hintLevel: Math.min(3, a.hintLevel + 1) as ActivityProgress['hintLevel'] }), now);
}

export function revealSolution(s: LearnerState, id: string, now = new Date().toISOString()): LearnerState {
  return touchActivity(s, id, (a) => ({ ...a, revealed: true, review: a.completedAt ? 'explained' : a.review }), now);
}

/** 의미 있는 수행(예측 제출/조작/실행) 기록 */
export function recordAttempt(s: LearnerState, id: string, correct: boolean, conceptTags: string[], now = new Date().toISOString()): LearnerState {
  let next = touchActivity(s, id, (a) => ({ ...a, attempts: a.attempts + 1, wrongCount: a.wrongCount + (correct ? 0 : 1) }), now);
  if (!correct) next = { ...next, wrongLog: [...next.wrongLog, { itemId: id, conceptTags, at: now }].slice(-300) };
  return next;
}

/**
 * 활동 완료. 정답 공개 전이면 independent, 공개 후 후속 수행(재수행 + 확인)을 마쳤으면 guided.
 * 이미 완료한 활동을 다시 하면 completionKind를 바꾸지 않고 review만 갱신한다.
 */
export function completeActivity(s: LearnerState, id: string, now = new Date().toISOString()): LearnerState {
  return touchActivity(s, id, (a) => {
    if (a.completedAt) return { ...a, review: 'retried' };
    return { ...a, completedAt: now, completionKind: a.revealed ? 'guided' : 'independent' };
  }, now);
}

export function addActiveSeconds(s: LearnerState, id: string | null, seconds: number, now = new Date().toISOString()): LearnerState {
  if (seconds <= 0) return s;
  const next = { ...s, totalActiveSeconds: s.totalActiveSeconds + seconds };
  return id ? touchActivity(next, id, (a) => ({ ...a, activeSeconds: a.activeSeconds + seconds }), now) : next;
}

export function answerQuestion(s: LearnerState, qid: string, answer: string | number, correct: boolean, now = new Date().toISOString()): LearnerState {
  const cur = s.questions[qid] ?? emptyQuestion(qid);
  const q = QUESTION_BY_ID[qid];
  // 정답 공개 후 같은 문항을 맞혀도 '스스로 맞힘'으로 기록하지 않는다(체크포인트 정답 조건은 완화하지 않음).
  const countsAsSolved = correct && !cur.revealed;
  const next: QuestionProgress = {
    ...cur,
    attempts: cur.attempts + 1,
    wrongCount: cur.wrongCount + (correct ? 0 : 1),
    correct: cur.correct || countsAsSolved,
    solvedAt: cur.solvedAt ?? (countsAsSolved ? now : null),
    lastAnswer: answer,
    lastCorrect: correct,
  };
  let out: LearnerState = { ...s, questions: { ...s.questions, [qid]: next } };
  if (!correct && q) out = { ...out, wrongLog: [...out.wrongLog, { itemId: qid, conceptTags: q.conceptTags, at: now }].slice(-300) };
  return out;
}

export function revealQuestion(s: LearnerState, qid: string): LearnerState {
  const cur = s.questions[qid] ?? emptyQuestion(qid);
  return { ...s, questions: { ...s.questions, [qid]: { ...cur, revealed: true } } };
}

export function viewExplanation(s: LearnerState, qid: string): LearnerState {
  const cur = s.questions[qid] ?? emptyQuestion(qid);
  if (cur.attempts === 0) return s; // 답 제출·채점 전에는 인정하지 않음
  return { ...s, questions: { ...s.questions, [qid]: { ...cur, explanationViewed: true } } };
}

export function recordChallenge(s: LearnerState, id: string, status: 'solved' | 'learned', now = new Date().toISOString()): LearnerState {
  const cur = s.challenges[id];
  if (cur?.status === 'solved') return s;
  return { ...s, challenges: { ...s.challenges, [id]: { status, at: now } } };
}

export const solvedChallengeCount = (s: LearnerState) => Object.values(s.challenges).filter((c) => c.status === 'solved').length;

/** 오답 후 재도전 성공 여부(배지 '다시 해냈어요') */
export function hasRetrySuccess(s: LearnerState): boolean {
  const q = Object.values(s.questions).some((x) => x.wrongCount > 0 && x.correct);
  const a = Object.values(s.activities).some((x) => x.wrongCount > 0 && x.completedAt && x.completionKind === 'independent');
  return q || a;
}

/* ---------------- 보상 대상 계산 ---------------- */

/** 현재 학습 상태로 받을 자격이 있는 보상 ID(지급 순서대로). 원장이 중복·선행조건을 최종 판정한다. */
export function eligibleRewards(s: LearnerState): string[] {
  const out: string[] = [];
  for (const u of UNITS) {
    for (const a of u.activityIds) if (isActivityComplete(s, a)) out.push(`activity:${a}`);
    for (const q of u.checkpointIds) if (checkpointSolved(s, q)) out.push(`checkpoint:${q}`);
    if (isUnitComplete(s, u.id)) out.push(`unit:${u.id}`);
  }
  for (const q of FINAL_DIAGNOSTIC) if (s.questions[q.id]?.explanationViewed) out.push(`final:${q.id}`);
  if (courseComplete(s)) out.push('course:complete');
  return out;
}

export function eligibleBadges(s: LearnerState): string[] {
  const out: string[] = [];
  for (const u of UNITS) if (isUnitComplete(s, u.id)) out.push(u.badgeId);
  if (hasRetrySuccess(s)) out.push('badge:retry-success');
  if (solvedChallengeCount(s) >= 3) out.push('badge:self-solved');
  if (['U12-A01', 'U12-A02', 'U12-A03', 'U12-A04'].every((a) => isActivityComplete(s, a))) out.push('badge:mission-complete');
  if (courseComplete(s)) out.push('badge:forest');
  return out;
}

/** 두 기기의 상태를 합친다: 완료는 합집합(단조 증가), 초안은 최신 updatedAt */
export function mergeLearnerStates(local: LearnerState, remote: LearnerState): LearnerState {
  const activities: Record<string, ActivityProgress> = { ...remote.activities };
  for (const [id, la] of Object.entries(local.activities)) {
    const ra = activities[id];
    if (!ra) { activities[id] = la; continue; }
    const newer = la.updatedAt >= ra.updatedAt ? la : ra;
    const done = la.completedAt ? la : ra.completedAt ? ra : null;
    activities[id] = {
      ...newer,
      completedAt: done?.completedAt ?? null,
      completionKind: done?.completionKind ?? null,
      attempts: Math.max(la.attempts, ra.attempts),
      hintLevel: Math.max(la.hintLevel, ra.hintLevel) as ActivityProgress['hintLevel'],
      revealed: la.revealed || ra.revealed,
      activeSeconds: Math.max(la.activeSeconds, ra.activeSeconds),
      serverRevision: Math.max(la.serverRevision, ra.serverRevision),
    };
  }
  const questions: Record<string, QuestionProgress> = { ...remote.questions };
  for (const [id, lq] of Object.entries(local.questions)) {
    const rq = questions[id];
    questions[id] = rq ? {
      ...lq,
      attempts: Math.max(lq.attempts, rq.attempts),
      wrongCount: Math.max(lq.wrongCount, rq.wrongCount),
      correct: lq.correct || rq.correct,
      solvedAt: lq.solvedAt ?? rq.solvedAt,
      revealed: lq.revealed || rq.revealed,
      explanationViewed: lq.explanationViewed || rq.explanationViewed,
    } : lq;
  }
  const challenges = { ...remote.challenges };
  for (const [id, c] of Object.entries(local.challenges)) if (!challenges[id] || c.status === 'solved') challenges[id] = c;
  return {
    ...local,
    pre: local.pre ?? remote.pre,
    activities, questions, challenges,
    celebratedUnits: [...new Set([...local.celebratedUnits, ...remote.celebratedUnits])],
    totalActiveSeconds: Math.max(local.totalActiveSeconds, remote.totalActiveSeconds),
    wrongLog: local.wrongLog.length >= remote.wrongLog.length ? local.wrongLog : remote.wrongLog,
  };
}
