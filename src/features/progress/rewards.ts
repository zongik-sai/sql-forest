import { CHECKPOINTS, FINAL_DIAGNOSTIC, UNITS, ACTIVITIES } from '../../content';

/**
 * 보상 카탈로그와 선행 조건 — 서버 migration(reward_catalog, award_xp)과 같은 규칙.
 * 보상 ID는 콘텐츠 버전과 분리된 안정적인 문자열이다.
 * 같은 보상 ID + entitlement_version은 원장에 한 번만 기록된다.
 */

export type PrereqType = 'none' | 'unit' | 'final' | 'course';

export interface RewardDef {
  rewardId: string;
  xp: number;
  entitlementVersion: number;
  prerequisiteType: PrereqType;
  label: string;
}

export const ENTITLEMENT_VERSION = 1;

export const REWARD_CATALOG: RewardDef[] = [
  ...ACTIVITIES.map((a) => ({ rewardId: `activity:${a.id}`, xp: 100, entitlementVersion: ENTITLEMENT_VERSION, prerequisiteType: 'none' as const, label: `${a.id} 활동 완료` })),
  ...CHECKPOINTS.map((q) => ({ rewardId: `checkpoint:${q.id}`, xp: 50, entitlementVersion: ENTITLEMENT_VERSION, prerequisiteType: 'none' as const, label: `${q.id} 체크포인트 해결` })),
  ...UNITS.map((u) => ({ rewardId: `unit:${u.id}`, xp: 100, entitlementVersion: ENTITLEMENT_VERSION, prerequisiteType: 'unit' as const, label: `${u.id} 단원 완료` })),
  ...FINAL_DIAGNOSTIC.map((q) => ({ rewardId: `final:${q.id}`, xp: 100, entitlementVersion: ENTITLEMENT_VERSION, prerequisiteType: 'final' as const, label: `최종 진단 ${q.id} 참여` })),
  { rewardId: 'course:complete', xp: 900, entitlementVersion: ENTITLEMENT_VERSION, prerequisiteType: 'course', label: '과정 마무리' },
];

export const REWARD_BY_ID: Record<string, RewardDef> = Object.fromEntries(REWARD_CATALOG.map((r) => [r.rewardId, r]));

/** 선행 조건 확인: 이미 받은 보상 ID 집합만으로 판단한다(서버와 동일). */
export function prerequisiteMet(rewardId: string, awarded: ReadonlySet<string>): boolean {
  const def = REWARD_BY_ID[rewardId];
  if (!def) return false;
  switch (def.prerequisiteType) {
    case 'none':
      return true;
    case 'unit': {
      const u = rewardId.slice('unit:'.length);
      const unit = UNITS.find((x) => x.id === u);
      if (!unit) return false;
      const acts = unit.activityIds.every((id) => awarded.has(`activity:${id}`));
      const cps = unit.checkpointIds.filter((id) => awarded.has(`checkpoint:${id}`)).length;
      return acts && cps >= 2;
    }
    case 'final':
      return UNITS.every((u) => awarded.has(`unit:${u.id}`));
    case 'course':
      return (
        UNITS.every((u) => awarded.has(`unit:${u.id}`)) &&
        CHECKPOINTS.every((q) => awarded.has(`checkpoint:${q.id}`)) &&
        FINAL_DIAGNOSTIC.every((q) => awarded.has(`final:${q.id}`))
      );
  }
}

/* ---------- 배지 ---------- */

export type BadgePrereq = { type: 'reward'; rewardId: string } | { type: 'rewards'; rewardIds: string[] } | { type: 'mastery'; count: number } | { type: 'none' };

export interface BadgeDef {
  badgeId: string;
  name: string;
  description: string;
  prereq: BadgePrereq;
}

export const BADGES: BadgeDef[] = [
  ...UNITS.map((u) => ({ badgeId: u.badgeId, name: u.badgeName, description: `${u.id} ${u.title} 완료`, prereq: { type: 'reward' as const, rewardId: `unit:${u.id}` } })),
  { badgeId: 'badge:retry-success', name: '다시 해냈어요', description: '오답 후 재도전에 성공', prereq: { type: 'none' } },
  { badgeId: 'badge:self-solved', name: '스스로 풀었어요', description: '도전 문제 3개를 안내 없이 해결', prereq: { type: 'mastery', count: 3 } },
  { badgeId: 'badge:mission-complete', name: '끝까지 연결했어요', description: '통합 미션 4개 완료', prereq: { type: 'rewards', rewardIds: ['U12-A01', 'U12-A02', 'U12-A03', 'U12-A04'].map((id) => `activity:${id}`) } },
  { badgeId: 'badge:forest', name: '나의 SQL 숲', description: 'Lv99 숲 완성', prereq: { type: 'reward', rewardId: 'course:complete' } },
];

export const BADGE_BY_ID: Record<string, BadgeDef> = Object.fromEntries(BADGES.map((b) => [b.badgeId, b]));

export function badgePrereqMet(badgeId: string, awarded: ReadonlySet<string>, solvedChallenges: number): boolean {
  const b = BADGE_BY_ID[badgeId];
  if (!b) return false;
  switch (b.prereq.type) {
    case 'none':
      return true;
    case 'reward':
      return awarded.has(b.prereq.rewardId);
    case 'rewards':
      return b.prereq.rewardIds.every((r) => awarded.has(r));
    case 'mastery':
      return solvedChallenges >= b.prereq.count;
  }
}

export function sumXp(rewardIds: Iterable<string>): number {
  let s = 0;
  for (const id of rewardIds) s += REWARD_BY_ID[id]?.xp ?? 0;
  return s;
}
