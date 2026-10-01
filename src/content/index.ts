import { U01 } from './activities/u01';
import { U02 } from './activities/u02';
import { U03 } from './activities/u03';
import { U04 } from './activities/u04';
import { U05 } from './activities/u05';
import { U06 } from './activities/u06';
import { U07 } from './activities/u07';
import { U08 } from './activities/u08';
import { U09 } from './activities/u09';
import { U10 } from './activities/u10';
import { U11 } from './activities/u11';
import { U12 } from './activities/u12';
import { CHALLENGES } from './activities/challenges';
import { CHECKPOINTS, VARIANTS } from './questions/checkpoints';
import { FINAL_DIAGNOSTIC, PRE_DIAGNOSTIC } from './questions/diagnostics';
import { UNITS, UNIT_BY_ID, UNIT_IDS } from './units';
import type { Challenge, LessonActivity, Question, UnitId } from './types';

export { UNITS, UNIT_BY_ID, UNIT_IDS, CHECKPOINTS, VARIANTS, PRE_DIAGNOSTIC, FINAL_DIAGNOSTIC, CHALLENGES };

export const ACTIVITIES: LessonActivity[] = [...U01, ...U02, ...U03, ...U04, ...U05, ...U06, ...U07, ...U08, ...U09, ...U10, ...U11, ...U12];

export const ACTIVITY_BY_ID: Record<string, LessonActivity> = Object.fromEntries(ACTIVITIES.map((a) => [a.id, a]));
export const QUESTION_BY_ID: Record<string, Question> = Object.fromEntries(
  [...CHECKPOINTS, ...VARIANTS, ...PRE_DIAGNOSTIC, ...FINAL_DIAGNOSTIC].map((q) => [q.id, q]),
);
export const CHALLENGE_BY_ID: Record<string, Challenge> = Object.fromEntries(CHALLENGES.map((c) => [c.id, c]));
export const VARIANT_OF: Record<string, Question> = Object.fromEntries(VARIANTS.map((v) => [v.variantOf!, v]));

export function activitiesOf(unitId: UnitId): LessonActivity[] {
  return UNIT_BY_ID[unitId].activityIds.map((id) => ACTIVITY_BY_ID[id]);
}
export function checkpointsOf(unitId: UnitId): Question[] {
  return UNIT_BY_ID[unitId].checkpointIds.map((id) => QUESTION_BY_ID[id]);
}
export function challengeOf(unitId: UnitId): Challenge | undefined {
  return CHALLENGES.find((c) => c.unitId === unitId);
}
export function nextUnit(unitId: UnitId): UnitId | null {
  const i = UNIT_IDS.indexOf(unitId);
  return i >= 0 && i < UNIT_IDS.length - 1 ? UNIT_IDS[i + 1] : null;
}

/** 콘텐츠 버전 묶음(로컬 캐시 키 등에 사용). 보상 ID와는 별개. */
export const CONTENT_SET_VERSION = 1;
