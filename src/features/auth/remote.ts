import type { SupabaseClient } from '@supabase/supabase-js';
import { emptySnapshot, type AwardResult, type Ledger, type LedgerSnapshot } from '../progress/ledger';
import { REWARD_BY_ID } from '../progress/rewards';
import type { ActivityProgress, LearnerState } from '../progress/model';
import { readJson, writeJson } from '../../lib/storage';

/**
 * 로그인 사용자의 서버 저장 계층.
 * - XP는 award_xp RPC로만 요청한다(보상 ID만 전달, XP 액수·user_id는 보내지 않음).
 * - 네트워크 실패 시 '동기화 대기' 큐에 보관하고 온라인 복귀 시 재전송한다(서버가 중복을 막음).
 * - 학습 SQL은 서버로 실행 요청하지 않는다. 초안 문자열만 진도 저장 용도로 보관한다.
 */

function isNetworkError(e: unknown): boolean {
  const m = String((e as { message?: string })?.message ?? e);
  return /fetch|network|Failed to fetch|NetworkError|timeout|offline/i.test(m) || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

export class SupabaseLedger implements Ledger {
  readonly kind = 'supabase' as const;
  private snap: LedgerSnapshot;
  private listeners = new Set<() => void>();
  private flushing = false;

  constructor(private sb: SupabaseClient, private cacheKey: string) {
    this.snap = { ...emptySnapshot(), ...readJson<Partial<LedgerSnapshot>>(cacheKey, {}) };
    if (typeof window !== 'undefined') window.addEventListener('online', () => void this.flush());
  }

  private emit() {
    writeJson(this.cacheKey, this.snap);
    this.listeners.forEach((l) => l());
  }

  snapshot(): LedgerSnapshot {
    return this.snap;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 서버 원장(본인 행만 RLS로 조회)을 진실값으로 다시 읽는다 */
  async refresh(): Promise<void> {
    const [xp, badges] = await Promise.all([
      this.sb.from('xp_events').select('reward_id, awarded_at'),
      this.sb.from('badge_awards').select('badge_id, awarded_at'),
    ]);
    if (xp.error || badges.error) throw xp.error ?? badges.error;
    const rewards: Record<string, string> = {};
    for (const r of xp.data ?? []) rewards[r.reward_id as string] = r.awarded_at as string;
    const b: Record<string, string> = {};
    for (const r of badges.data ?? []) b[r.badge_id as string] = r.awarded_at as string;
    this.snap = { rewards, badges: b, pendingRewards: this.snap.pendingRewards.filter((p) => !rewards[p]) };
    this.emit();
  }

  async award(rewardId: string): Promise<AwardResult> {
    const xp = REWARD_BY_ID[rewardId]?.xp ?? 0;
    if (this.snap.rewards[rewardId]) return { status: 'duplicate', rewardId, xp: 0 };
    try {
      const { data, error } = await this.sb.rpc('award_xp', { p_reward_id: rewardId });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as { status: string } | null;
      const status = (row?.status ?? 'rejected') as AwardResult['status'];
      if (status === 'awarded' || status === 'duplicate') this.snap.rewards[rewardId] = new Date().toISOString();
      this.snap.pendingRewards = this.snap.pendingRewards.filter((p) => p !== rewardId);
      this.emit();
      return { status, rewardId, xp: status === 'awarded' ? xp : 0 };
    } catch (e) {
      if (isNetworkError(e)) {
        if (!this.snap.pendingRewards.includes(rewardId)) this.snap.pendingRewards.push(rewardId);
        this.emit();
        return { status: 'pending', rewardId, xp, reason: '동기화 대기' };
      }
      return { status: 'rejected', rewardId, xp: 0, reason: String((e as Error).message ?? e) };
    }
  }

  async awardBadge(badgeId: string): Promise<AwardResult> {
    if (this.snap.badges[badgeId]) return { status: 'duplicate', rewardId: badgeId, xp: 0 };
    try {
      const { data, error } = await this.sb.rpc('award_badge', { p_badge_id: badgeId });
      if (error) throw error;
      if (data === 'awarded' || data === 'duplicate') {
        this.snap.badges[badgeId] = new Date().toISOString();
        this.emit();
      }
      return { status: (data as AwardResult['status']) ?? 'rejected', rewardId: badgeId, xp: 0 };
    } catch {
      return { status: 'pending', rewardId: badgeId, xp: 0 };
    }
  }

  /** 오프라인 대기 보상 재전송. 서버가 ON CONFLICT DO NOTHING으로 중복을 막는다. */
  async flush(): Promise<void> {
    if (this.flushing || !this.snap.pendingRewards.length) return;
    this.flushing = true;
    try {
      for (const id of [...this.snap.pendingRewards]) {
        const r = await this.award(id);
        if (r.status === 'pending') break;
      }
    } finally {
      this.flushing = false;
    }
  }
}

export type SaveStatus = 'saving' | 'saved' | 'local' | 'retry';

export interface ActivityConflict {
  activityId: string;
  server: { revision: number; draftSql: string; state: Record<string, unknown>; updatedAt: string };
}

/** 진도 동기화: 활동 초안은 revision compare-and-set, 나머지 상태는 스냅샷 */
export class RemoteProgress {
  status: SaveStatus = 'saved';
  conflicts: ActivityConflict[] = [];
  private listeners = new Set<() => void>();
  private queue = new Map<string, ActivityProgress>();
  private snapshotPending: LearnerState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sessionId: string | null = null;
  /** 서버가 마지막으로 알려준 활동별 revision(대기 중 초안의 오래된 값 대신 사용) */
  private revs = new Map<string, number>();

  constructor(private sb: SupabaseClient) {
    if (typeof window !== 'undefined') window.addEventListener('online', () => this.schedule(0));
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private set(s: SaveStatus) {
    this.status = s;
    this.listeners.forEach((l) => l());
  }

  async load(): Promise<{ state: LearnerState | null; activities: Record<string, ActivityProgress> }> {
    const [snap, acts] = await Promise.all([
      this.sb.from('learner_state').select('state').maybeSingle(),
      this.sb.from('activity_progress').select('activity_id, content_version, state_json, draft_sql, attempts, hint_level, completion_kind, active_seconds, revision, updated_at'),
    ]);
    if (snap.error) throw snap.error;
    if (acts.error) throw acts.error;
    const activities: Record<string, ActivityProgress> = {};
    for (const r of acts.data ?? []) {
      const st = (r.state_json ?? {}) as Record<string, unknown> & { __meta?: Partial<ActivityProgress> };
      const meta = st.__meta ?? {};
      activities[r.activity_id] = {
        activityId: r.activity_id, contentVersion: r.content_version, state: { ...st, __meta: undefined }, draftSql: r.draft_sql ?? '',
        attempts: r.attempts, hintLevel: r.hint_level, predictionAnswer: meta.predictionAnswer ?? null, predictionTried: meta.predictionTried, predictionRevealed: meta.predictionRevealed, revealed: meta.revealed ?? false,
        completionKind: r.completion_kind, completedAt: meta.completedAt ?? null, review: meta.review ?? null, wrongCount: meta.wrongCount ?? 0,
        activeSeconds: r.active_seconds, serverRevision: r.revision, updatedAt: r.updated_at,
      };
    }
    return { state: (snap.data?.state as LearnerState | undefined) ?? null, activities };
  }

  /** 입력 초안은 1초 debounce, 제출·완료는 immediate */
  saveActivity(a: ActivityProgress, immediate: boolean) {
    this.queue.set(a.activityId, a);
    this.schedule(immediate ? 0 : 1000);
  }

  saveSnapshot(s: LearnerState, immediate: boolean) {
    this.snapshotPending = s;
    this.schedule(immediate ? 0 : 1000);
  }

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  onRevision?: (activityId: string, revision: number) => void;

  async flush(): Promise<void> {
    if (!this.queue.size && !this.snapshotPending) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return this.set('local');
    this.set('saving');
    try {
      for (const [id, a] of [...this.queue]) {
        const state = { ...a.state, __meta: { predictionAnswer: a.predictionAnswer, predictionTried: a.predictionTried, predictionRevealed: a.predictionRevealed, revealed: a.revealed, completedAt: a.completedAt, review: a.review, wrongCount: a.wrongCount } };
        const { data, error } = await this.sb.rpc('save_activity_progress', {
          p_activity_id: id, p_content_version: a.contentVersion, p_state: state, p_draft_sql: a.draftSql,
          p_attempts: a.attempts, p_hint_level: a.hintLevel, p_completion_kind: a.completionKind,
          p_active_seconds: a.activeSeconds, p_expected_revision: Math.max(this.revs.get(id) ?? 0, a.serverRevision),
        });
        if (error) throw error;
        const res = data as { status: 'ok' | 'conflict'; revision: number; draft_sql?: string; state?: Record<string, unknown>; updated_at?: string };
        this.queue.delete(id);
        if (res.status === 'conflict') {
          this.conflicts = [...this.conflicts.filter((c) => c.activityId !== id), { activityId: id, server: { revision: res.revision, draftSql: res.draft_sql ?? '', state: res.state ?? {}, updatedAt: res.updated_at ?? '' } }];
        } else {
          this.revs.set(id, res.revision);
          this.onRevision?.(id, res.revision);
        }
      }
      if (this.snapshotPending) {
        const s = this.snapshotPending;
        this.snapshotPending = null;
        const { error } = await this.sb.rpc('save_learner_state', { p_state: s });
        if (error) {
          this.snapshotPending = s;
          throw error;
        }
      }
      this.set('saved');
    } catch (e) {
      this.set(isNetworkError(e) ? 'local' : 'retry');
      this.schedule(15000);
    }
  }

  resolveConflict(activityId: string, serverRevision?: number) {
    if (serverRevision !== undefined) this.revs.set(activityId, serverRevision);
    this.conflicts = this.conflicts.filter((c) => c.activityId !== activityId);
    this.listeners.forEach((l) => l());
  }

  async startSession(): Promise<void> {
    try {
      const { data } = await this.sb.rpc('start_learning_session');
      this.sessionId = (data as string) ?? null;
    } catch {
      this.sessionId = null;
    }
  }

  /** 고유 세션별 누적 활성 시간(서버는 GREATEST로 증가만 허용) */
  async reportSession(totalActiveSeconds: number): Promise<void> {
    if (!this.sessionId) return;
    try {
      await this.sb.rpc('update_learning_session', { p_id: this.sessionId, p_active_seconds: totalActiveSeconds });
    } catch {
      /* best effort */
    }
  }

  async saveUnit(unitId: string, status: string, completedActivityIds: string[], checkpointScore: number) {
    try {
      await this.sb.rpc('save_unit_progress', { p_unit_id: unitId, p_content_version: 1, p_status: status, p_completed_activity_ids: completedActivityIds, p_checkpoint_score: checkpointScore });
    } catch {
      /* 스냅샷에 포함되어 있으므로 best effort */
    }
  }

  async submitAssessment(type: 'pre' | 'final', answers: Record<string, unknown>, score: number) {
    try {
      await this.sb.rpc('submit_assessment', { p_type: type, p_content_version: 1, p_answers: answers, p_score: score });
    } catch {
      /* best effort */
    }
  }

  async recordMastery(challengeId: string, status: 'solved' | 'learned') {
    try {
      await this.sb.rpc('record_mastery', { p_challenge_id: challengeId, p_status: status });
    } catch {
      /* best effort */
    }
  }

  async deleteMyData(): Promise<string | null> {
    const { error } = await this.sb.rpc('delete_my_progress');
    return error ? error.message : null;
  }
}
