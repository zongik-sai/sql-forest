import { ACTIVITY_BY_ID, CHALLENGE_BY_ID, CHECKPOINTS, FINAL_DIAGNOSTIC, QUESTION_BY_ID, UNITS, UNIT_BY_ID, UNIT_IDS, VARIANT_OF, challengeOf } from '../../content';
import type { UnitId } from '../../content/types';
import { STAGE_COUNTS, quizNeed } from '../../content/stages/meta';

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
  /** 마지막으로 제출한 예측 */
  predictionAnswer: number | null;
  /** 제출한 예측 순서(첫 값이 처음 예측). 틀리면 다른 답을 다시 고를 수 있다 */
  predictionTried?: number[];
  /** 예측 정답을 확인했는지(다시 고르기 대신 정답 보기) */
  predictionRevealed?: boolean;
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
  /** 단원 집중 학습 중 잠긴 시각들(마지막 초기화 이후) */
  unitLocks?: Partial<Record<UnitId, string[]>>;
  /** 단원 초기화: 마지막 시각과 누적 횟수. 병합할 때 이 시각을 모르는(더 오래된) 쪽의 그 단원 기록은 버린다 */
  unitResets?: Partial<Record<UnitId, { at: string; n: number }>>;
  /** 단원 단계(1 이론·개념 맞추기, 2 개념 점검, 3 실습 설명·맞추기) 기록. 4단계는 기존 활동·체크포인트 */
  stages?: Partial<Record<UnitId, Partial<Record<StageKey, StageRecord>>>>;
  /** 마친 이론 카드·실습 예제(ID → 처음 마친 시각) */
  stageItems?: Record<string, string>;
}

/* ---------------- 단원 단계(2026-10-15 구조 개편) ---------------- */
export type StageNo = 1 | 2 | 3 | 4;
export const STAGE_NOS: StageNo[] = [1, 2, 3, 4];
export type StageKey = 's1' | 's2' | 's3';
export const STAGE_NAME: Record<StageNo, string> = { 1: '이론·개념 맞추기', 2: '개념 점검 문제', 3: '실습 설명·실습 맞추기', 4: '실습 점검 문제' };
export interface StageRecord {
  best?: number;
  total?: number;
  passedAt?: string;
  lastAt?: string;
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
  const touched = unit.activityIds.some((a) => s.activities[a]?.attempts || s.activities[a]?.completedAt) || unit.checkpointIds.some((q) => s.questions[q]?.attempts)
    || !!s.stages?.[unitId] || Object.keys(s.stageItems ?? {}).some((k) => k.startsWith(`${unitId}-`));
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
    // 새 단계 구조: 4단계를 아직 시작하지 않았으면 통과하지 못한 첫 단계부터
    if (!stage4Touched(s, u.id)) {
      const n = ([1, 2, 3] as const).find((k) => !stagePassed(s, u.id, k));
      if (n) return `/learn/${u.id}/stage/${n}`;
    }
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

export function saveActivityDraft(s: LearnerState, id: string, patch: Partial<Pick<ActivityProgress, 'draftSql' | 'state' | 'predictionAnswer' | 'predictionTried' | 'predictionRevealed'>>, now = new Date().toISOString()): LearnerState {
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
export function mergeLearnerStates(local0: LearnerState, remote0: LearnerState): LearnerState {
  const resets = latestResets(local0, remote0) ?? {};
  const local = dropStale(local0, resets), remote = dropStale(remote0, resets);
  const unitLocks: NonNullable<LearnerState['unitLocks']> = {};
  for (const u of UNIT_IDS) {
    const l = [...new Set([...(local.unitLocks?.[u] ?? []), ...(remote.unitLocks?.[u] ?? [])])].sort();
    if (l.length) unitLocks[u] = l.slice(-50);
  }
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
    unitLocks,
    unitResets: resets,
    ...mergeStages(local, remote),
  };
}

/* ---------------- 단원 집중 학습: 잠김·초기화 ---------------- */

/** 한 단원에서 이만큼 잠기면 그 단원의 진도·점수를 초기화한다(선생님 결정) */
export const UNIT_LOCK_LIMIT = 5;

export const unitLockCount = (s: LearnerState, u: UnitId) => s.unitLocks?.[u]?.length ?? 0;

/** 단원에 속한 진도 항목: 활동 4개·도전 과제, 체크포인트(+변형 문항) */
export function unitItems(u: UnitId): { activityIds: string[]; questionIds: string[]; challengeId: string | null } {
  const unit = UNIT_BY_ID[u];
  const ch = challengeOf(u)?.id ?? null;
  const qs = unit.checkpointIds.flatMap((q) => (VARIANT_OF[q] ? [q, VARIANT_OF[q].id] : [q]));
  return { activityIds: [...unit.activityIds, ...(ch ? [ch] : [])], questionIds: qs, challengeId: ch };
}

/** 단원 초기화로 지워지는 보상·배지 ID(원장에서 함께 지운다) */
export function unitRewardIds(u: UnitId): string[] {
  const unit = UNIT_BY_ID[u];
  return [...unit.activityIds.map((a) => `activity:${a}`), ...unit.checkpointIds.map((q) => `checkpoint:${q}`), `unit:${u}`, unit.badgeId];
}

function stripUnit(s: LearnerState, u: UnitId): LearnerState {
  const { activityIds, questionIds, challengeId } = unitItems(u);
  const activities = { ...s.activities };
  for (const a of activityIds) delete activities[a];
  const questions = { ...s.questions };
  for (const q of questionIds) delete questions[q];
  const challenges = { ...s.challenges };
  if (challengeId) delete challenges[challengeId];
  const unitLocks = { ...(s.unitLocks ?? {}) };
  delete unitLocks[u];
  const stages = { ...(s.stages ?? {}) };
  delete stages[u];
  const stageItems = Object.fromEntries(Object.entries(s.stageItems ?? {}).filter(([k]) => !k.startsWith(`${u}-`)));
  return { ...s, activities, questions, challenges, unitLocks, stages, stageItems, celebratedUnits: s.celebratedUnits.filter((x) => x !== u) };
}

const later = (now: string, prev?: string) => (prev && prev >= now ? new Date(Date.parse(prev) + 1).toISOString() : now);

/** 단원의 진도·점수(활동·체크포인트·도전 과제 기록)와 잠김 횟수를 지운다. 오답 기록(복습)·다른 단원은 그대로 */
export function resetUnitProgress(s: LearnerState, u: UnitId, now = new Date().toISOString()): LearnerState {
  const prev = s.unitResets?.[u];
  return { ...stripUnit(s, u), unitResets: { ...(s.unitResets ?? {}), [u]: { at: later(now, prev?.at), n: (prev?.n ?? 0) + 1 } } };
}

/** 잠김 1회 기록. 한도에 닿으면 그 단원을 초기화한다 */
export function addUnitLock(s: LearnerState, u: UnitId, now = new Date().toISOString()): { state: LearnerState; count: number; reset: boolean } {
  const cur = s.unitLocks?.[u] ?? [];
  const list = [...cur, later(now, cur[cur.length - 1])];
  if (list.length >= UNIT_LOCK_LIMIT) return { state: resetUnitProgress(s, u, now), count: list.length, reset: true };
  return { state: { ...s, unitLocks: { ...(s.unitLocks ?? {}), [u]: list } }, count: list.length, reset: false };
}

/** 병합 전: 상대가 아는 더 최근 초기화를 모르는 쪽이면 그 단원 기록을 버린다(초기화가 되살아나지 않게) */
function latestResets(a: LearnerState, b: LearnerState): LearnerState['unitResets'] {
  const out: NonNullable<LearnerState['unitResets']> = {};
  for (const u of UNIT_IDS) {
    const ra = a.unitResets?.[u], rb = b.unitResets?.[u];
    if (!ra && !rb) continue;
    out[u] = { at: (ra?.at ?? '') > (rb?.at ?? '') ? ra!.at : rb!.at, n: Math.max(ra?.n ?? 0, rb?.n ?? 0) };
  }
  return out;
}
function dropStale(x: LearnerState, latest: NonNullable<LearnerState['unitResets']>): LearnerState {
  let out = x;
  for (const u of UNIT_IDS) {
    const r = latest[u];
    if (r && (x.unitResets?.[u]?.at ?? '') < r.at) out = stripUnit(out, u);
  }
  return out;
}

/**
 * 서버 단원 초기화를 늦게 다시 보낼 때 지우지 말 항목: 지금 학습 상태(초기화 뒤 새로 한 공부) 기준.
 * 시각을 비교하지 않으므로 기기 시계가 서버와 달라도 된다.
 */
export function unitKeepList(s: LearnerState, u: UnitId): string[] {
  const ids = new Set(unitRewardIds(u));
  const { activityIds, challengeId } = unitItems(u);
  const keep = [...eligibleRewards(s), ...eligibleBadges(s)].filter((r) => ids.has(r));
  for (const a of activityIds) if (s.activities[a]) keep.push(a);
  if (challengeId && s.challenges[challengeId]) keep.push(`mastery:${challengeId}`);
  return keep;
}

/* ---------------- 단원 단계 판정·기록 ---------------- */

export const stageItemDone = (s: LearnerState, id: string) => !!s.stageItems && Object.hasOwn(s.stageItems, id);

/** 4단계(실습 점검)를 이미 시작했는지: 예전 방식으로 공부한 학생은 1~3단계와 관계없이 4단계가 열린다 */
export function stage4Touched(s: LearnerState, u: UnitId): boolean {
  const unit = UNITS.find((x) => x.id === u)!;
  // 예전 방식으로 활동을 열어 본 기록(초안·활동 시간만 있어도)이 있으면 이어서 할 수 있게
  return unit.activityIds.some((a) => !!s.activities[a]) || unit.checkpointIds.some((q) => s.questions[q]?.attempts);
}

export function stagePassed(s: LearnerState, u: UnitId, n: StageNo): boolean {
  if (n === 4) return isUnitComplete(s, u);
  return !!s.stages?.[u]?.[`s${n}`]?.passedAt;
}

/** 앞 단계를 통과해야 열린다(1단계는 항상). 잠겨 있어도 "그래도 풀어보기"로 들어갈 수 있다 */
export function stageOpen(s: LearnerState, u: UnitId, n: StageNo): boolean {
  if (n === 1) return true;
  if (n === 4 && stage4Touched(s, u)) return true;
  return stagePassed(s, u, (n - 1) as StageNo);
}

/** 통과한 단계 수(0~4) */
export const unitStageLevel = (s: LearnerState, u: UnitId) => STAGE_NOS.filter((n) => stagePassed(s, u, n)).length;

function setStage(s: LearnerState, u: UnitId, k: StageKey, f: (r: StageRecord) => StageRecord): LearnerState {
  const cur = { ...(s.stages?.[u] ?? {}) };
  cur[k] = f(cur[k] ?? {});
  return { ...s, stages: { ...(s.stages ?? {}), [u]: cur } };
}

/** 1단계 카드·3단계 예제 하나를 마침. 그 단계의 항목을 모두 마치면 단계 통과 */
/** 1단계 카드·3단계 예제 ID 목록 */
export const stageItemIds = (u: UnitId, n: 1 | 3): string[] => Array.from({ length: n === 1 ? STAGE_COUNTS[u].cards : STAGE_COUNTS[u].practice }, (_, i) => `${u}-${n === 1 ? 't' : 'p'}${i + 1}`);

export function markStageItem(s: LearnerState, u: UnitId, n: 1 | 3, itemId: string, now = new Date().toISOString()): { state: LearnerState; stageDone: boolean; firstPass: boolean } {
  const ids = stageItemIds(u, n);
  let state: LearnerState = stageItemDone(s, itemId) ? s : { ...s, stageItems: { ...(s.stageItems ?? {}), [itemId]: now } };
  const done = ids.filter((id) => stageItemDone(state, id)).length;
  const stageDone = done === ids.length;
  const firstPass = stageDone && !stagePassed(state, u, n);
  state = setStage(state, u, `s${n}`, (r) => ({ ...r, best: done, total: ids.length, ...(stageDone ? { passedAt: r.passedAt ?? now } : {}), lastAt: now }));
  return { state, stageDone, firstPass };
}

/** 2단계 개념 점검 결과. 최고 점수 유지, 기준(70%) 이상이면 통과 */
export function recordStageQuiz(s: LearnerState, u: UnitId, score: number, total: number, now = new Date().toISOString()): { state: LearnerState; passed: boolean; firstPass: boolean } {
  const passed = score >= quizNeed(total);
  const firstPass = passed && !stagePassed(s, u, 2);
  const state = setStage(s, u, 's2', (r) => ({
    best: Math.max(r.best ?? 0, score), total,
    ...(r.passedAt || passed ? { passedAt: r.passedAt ?? now } : {}),
    lastAt: now,
  }));
  return { state, passed, firstPass };
}

const minIso = (a?: string, b?: string) => (!a ? b : !b ? a : a < b ? a : b);
const maxIso = (a?: string, b?: string) => (!a ? b : !b ? a : a > b ? a : b);

/** 단계 기록 병합: 통과는 사라지지 않고(이른 시각), 최고 점수는 큰 쪽, 마친 항목은 합집합 */
function mergeStages(a: LearnerState, b: LearnerState): Pick<LearnerState, 'stages' | 'stageItems'> {
  const stages: NonNullable<LearnerState['stages']> = {};
  for (const u of UNIT_IDS) {
    const ua = a.stages?.[u], ub = b.stages?.[u];
    if (!ua && !ub) continue;
    const out: Partial<Record<StageKey, StageRecord>> = {};
    for (const k of ['s1', 's2', 's3'] as StageKey[]) {
      const ra = ua?.[k], rb = ub?.[k];
      if (!ra && !rb) continue;
      const rec: StageRecord = {};
      const best = Math.max(ra?.best ?? -1, rb?.best ?? -1);
      if (best >= 0) rec.best = best;
      const total = ra?.total ?? rb?.total;
      if (total !== undefined) rec.total = total;
      const passedAt = minIso(ra?.passedAt, rb?.passedAt);
      if (passedAt) rec.passedAt = passedAt;
      const lastAt = maxIso(ra?.lastAt, rb?.lastAt);
      if (lastAt) rec.lastAt = lastAt;
      out[k] = rec;
    }
    stages[u] = out;
  }
  const stageItems: Record<string, string> = {};
  for (const k of new Set([...Object.keys(a.stageItems ?? {}), ...Object.keys(b.stageItems ?? {})])) {
    stageItems[k] = minIso(a.stageItems?.[k], b.stageItems?.[k])!;
  }
  // 두 기기에서 나눠 마친 카드·예제가 합쳐져 모두 끝났으면 그 단계도 통과
  for (const u of UNIT_IDS) {
    for (const [k, ids] of [['s1', stageItemIds(u, 1)], ['s3', stageItemIds(u, 3)]] as const) {
      const times = ids.map((id) => stageItems[id]);
      const rec = stages[u]?.[k];
      if (!ids.length || times.some((t) => !t) || rec?.passedAt) continue;
      const at = times.reduce((m, t) => (t! > m ? t! : m), '');
      stages[u] = { ...(stages[u] ?? {}), [k]: { ...(rec ?? {}), best: ids.length, total: ids.length, passedAt: at, lastAt: maxIso(rec?.lastAt, at) } };
    }
  }
  return { stages, stageItems };
}
