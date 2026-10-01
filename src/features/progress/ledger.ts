import { BADGE_BY_ID, REWARD_BY_ID, badgePrereqMet, prerequisiteMet, sumXp } from './rewards';
import { readJson, writeJson } from '../../lib/storage';

/**
 * XP 원장. 원장 합계가 진실값이고 화면은 이를 캐시한다.
 * - LocalLedger: 개발 데모용. 서버 award_xp와 같은 규칙(카탈로그·선행조건·1회 기록)을 로컬에 적용.
 * - 로그인 사용자는 SupabaseLedger(features/auth/supabaseLedger.ts)가 서버 RPC로 지급한다.
 */

export type AwardStatus = 'awarded' | 'duplicate' | 'rejected' | 'pending';

export interface AwardResult {
  status: AwardStatus;
  rewardId: string;
  xp: number;
  reason?: string;
}

export interface LedgerSnapshot {
  rewards: Record<string, string>; // rewardId -> awardedAt
  badges: Record<string, string>;
  /** 서버 확인 전(오프라인 등) 임시 표시 */
  pendingRewards: string[];
}

export interface Ledger {
  readonly kind: 'local' | 'supabase';
  snapshot(): LedgerSnapshot;
  award(rewardId: string): Promise<AwardResult>;
  awardBadge(badgeId: string, solvedChallenges: number): Promise<AwardResult>;
  subscribe(fn: () => void): () => void;
}

export function totalXpOf(s: LedgerSnapshot, includePending = true): number {
  const ids = new Set(Object.keys(s.rewards));
  if (includePending) s.pendingRewards.forEach((r) => ids.add(r));
  return sumXp(ids);
}

export const emptySnapshot = (): LedgerSnapshot => ({ rewards: {}, badges: {}, pendingRewards: [] });

/** 같은 규칙의 순수 판정(서버 award_xp와 동일). */
export function decideAward(rewardId: string, awarded: ReadonlySet<string>): { ok: true } | { ok: false; status: 'duplicate' | 'rejected'; reason: string } {
  if (!REWARD_BY_ID[rewardId]) return { ok: false, status: 'rejected', reason: '알 수 없는 보상 ID' };
  if (awarded.has(rewardId)) return { ok: false, status: 'duplicate', reason: '이미 받은 보상' };
  if (!prerequisiteMet(rewardId, awarded)) return { ok: false, status: 'rejected', reason: '선행 조건 미충족' };
  return { ok: true };
}

export class LocalLedger implements Ledger {
  readonly kind = 'local' as const;
  private listeners = new Set<() => void>();
  private onStorage = (e: StorageEvent) => {
    if (e.key === this.key) this.listeners.forEach((l) => l());
  };

  constructor(private key: string, private now: () => string = () => new Date().toISOString()) {
    if (typeof window !== 'undefined') window.addEventListener('storage', this.onStorage);
  }

  snapshot(): LedgerSnapshot {
    return { ...emptySnapshot(), ...readJson<Partial<LedgerSnapshot>>(this.key, {}), pendingRewards: [] };
  }

  private save(s: LedgerSnapshot) {
    writeJson(this.key, { rewards: s.rewards, badges: s.badges });
    this.listeners.forEach((l) => l());
  }

  async award(rewardId: string): Promise<AwardResult> {
    // 매번 저장소에서 다시 읽어 다른 탭의 기록을 반영한다(동시 탭 중복 방지).
    const s = this.snapshot();
    const d = decideAward(rewardId, new Set(Object.keys(s.rewards)));
    const xp = REWARD_BY_ID[rewardId]?.xp ?? 0;
    if (!d.ok) return { status: d.status, rewardId, xp: 0, reason: d.reason };
    s.rewards[rewardId] = this.now();
    this.save(s);
    return { status: 'awarded', rewardId, xp };
  }

  async awardBadge(badgeId: string, solvedChallenges: number): Promise<AwardResult> {
    const s = this.snapshot();
    if (!BADGE_BY_ID[badgeId]) return { status: 'rejected', rewardId: badgeId, xp: 0, reason: '알 수 없는 배지' };
    if (s.badges[badgeId]) return { status: 'duplicate', rewardId: badgeId, xp: 0 };
    if (!badgePrereqMet(badgeId, new Set(Object.keys(s.rewards)), solvedChallenges)) return { status: 'rejected', rewardId: badgeId, xp: 0, reason: '선행 조건 미충족' };
    s.badges[badgeId] = this.now();
    this.save(s);
    return { status: 'awarded', rewardId: badgeId, xp: 0 };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
