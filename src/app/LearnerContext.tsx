import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { UNITS } from '../content';
import type { UnitId } from '../content/types';
import type { Identity } from '../features/auth/AuthContext';
import { RemoteProgress, SupabaseLedger, type ActivityConflict, type SaveStatus } from '../features/auth/remote';
import { supabase } from '../features/auth/supabase';
import { levelOf, MILESTONE_LEVELS } from '../features/growth/levels';
import { LocalLedger, totalXpOf, type AwardResult, type Ledger, type LedgerSnapshot } from '../features/progress/ledger';
import {
  addUnitLock, eligibleBadges, eligibleRewards, emptyLearnerState, isUnitComplete, mergeLearnerStates, solvedChallengeCount, unitCheckpointScore,
  unitItems, unitKeepList, unitRewardIds, type ActivityProgress, type LearnerState,
} from '../features/progress/model';
import { BADGE_BY_ID, REWARD_BY_ID } from '../features/progress/rewards';
import { keysWithPrefix, learnerPrefix, readJson, removeRaw, removeWithPrefix, writeJson } from '../lib/storage';

export interface Celebration {
  id: number;
  kind: 'toast' | 'milestone' | 'unit';
  text: string;
  level?: number;
  unitId?: UnitId;
  /** 레벨업 토스트: 묶음의 시작 레벨 */
  fromLevel?: number;
}

interface LearnerCtx {
  identity: Identity;
  state: LearnerState;
  /** 상태 변경 + 로컬 즉시 저장 + 서버 저장(immediate=false면 1초 debounce) + 보상 정산 */
  commit: (fn: (s: LearnerState) => LearnerState, opts?: { immediate?: boolean; activityId?: string }) => Promise<AwardResult[]>;
  /** 일시정지 등에서 동기적으로 로컬 저장 */
  flushLocal: () => void;
  ledger: LedgerSnapshot;
  totalXp: number;
  level: number;
  pendingSync: boolean;
  saveStatus: SaveStatus;
  conflicts: ActivityConflict[];
  resolveConflict: (activityId: string, choice: 'server' | 'local') => void;
  celebrations: Celebration[];
  dismissCelebration: (id: number) => void;
  /** 데모·내 데이터 초기화 */
  resetMyData: () => Promise<string | null>;
  remote: RemoteProgress | null;
  /** 단원 집중 학습: 잠김 1회 기록(동기 저장). 한도에 닿으면 그 단원 초기화(서버 포함) */
  lockUnit: (unitId: UnitId) => { count: number; reset: boolean };
}

/** 활동 ID → 단원('U03-A02' → 'U03', 'CH-U03' → 'U03') */
const unitOfActivity = (id: string): UnitId | null => (/^(?:CH-)?(U\d\d)/.exec(id)?.[1] as UnitId | undefined) ?? null;

const Ctx = createContext<LearnerCtx | null>(null);
export const useLearner = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('LearnerProvider 없음');
  return c;
};

export function LearnerProvider({ identity, children }: { identity: Identity; children: ReactNode }) {
  const prefix = learnerPrefix(identity.learnerKey);
  const stateKey = `${prefix}state`;
  const [state, setState] = useState<LearnerState>(() => readJson<LearnerState | null>(stateKey, null) ?? emptyLearnerState(identity.learnerKey));
  const stateRef = useRef(state);
  stateRef.current = state;

  const sb = identity.kind === 'user' ? supabase() : null;
  const ledger: Ledger = useMemo(() => (sb ? new SupabaseLedger(sb, `${prefix}ledger`) : new LocalLedger(`${prefix}ledger`)), [sb, prefix]);
  const remote = useMemo(() => (sb ? new RemoteProgress(sb) : null), [sb]);
  const [snap, setSnap] = useState<LedgerSnapshot>(() => ledger.snapshot());
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(remote ? 'saved' : 'local');
  const [conflicts, setConflicts] = useState<ActivityConflict[]>([]);
  const [celebrations, setCelebrations] = useState<Celebration[]>([]);
  const celebId = useRef(1);
  const prevLevel = useRef(levelOf(totalXpOf(ledger.snapshot())));
  /** 서버 원장을 처음 불러오는 동안에는 레벨업 연출을 하지 않는다 */
  const suppressLevelUp = useRef(!!sb);

  useEffect(() => ledger.subscribe(() => setSnap({ ...ledger.snapshot() })), [ledger]);

  // 다른 탭에서 같은 학습자 상태가 바뀌면 반영(동시 탭)
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.key === stateKey && e.newValue) {
        try {
          setState((cur) => mergeLearnerStates(cur, JSON.parse(e.newValue!) as LearnerState));
        } catch {
          /* 무시 */
        }
      }
    };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, [stateKey]);

  /**
   * 단원 초기화 마무리: 초기화한 단원인데 서버에 지금 학습 상태에 없는 그 단원 경험치·배지(또는 활동 행)가 남아 있으면
   * (오프라인·로그아웃 등으로 서버 초기화를 못 한 경우) 학습 상태에 있는 것(초기화 뒤 새로 한 공부)만 남기고 지운다.
   * 어느 기기에서든 이어서 처리된다. staleUnits: 불러온 활동 행 중 학습 상태에 없는 것이 있던 단원
   */
  const syncResets = useCallback(async (s: LearnerState, staleUnits: Set<UnitId> = new Set()) => {
    if (!remote || !(ledger instanceof SupabaseLedger)) return;
    const marks = Object.entries(s.unitResets ?? {}) as [UnitId, { at: string; n: number }][];
    if (!marks.length) return;
    try {
      await ledger.refresh();
    } catch {
      return;
    }
    const snap = ledger.snapshot();
    let changed = false;
    for (const [u, m] of marks) {
      const keep = unitKeepList(s, u);
      const extra = unitRewardIds(u).some((id) => (snap.rewards[id] !== undefined || snap.badges[id] !== undefined) && !keep.includes(id));
      if ((extra || staleUnits.has(u)) && (await remote.resetUnit(u, m.at, m.n, keep))) changed = true;
    }
    if (changed) await ledger.refresh().catch(() => {});
  }, [remote, ledger]);

  useEffect(() => {
    const on = () => void syncResets(stateRef.current);
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [syncResets]);

  // 로그인 사용자: 서버 상태를 불러와 로컬 캐시와 병합
  useEffect(() => {
    if (!remote || !(ledger instanceof SupabaseLedger)) return;
    remote.onRevision = (id, rev) => {
      setState((s) => (s.activities[id] ? { ...s, activities: { ...s.activities, [id]: { ...s.activities[id], serverRevision: rev } } } : s));
    };
    const un = remote.subscribe(() => {
      setSaveStatus(remote.status);
      setConflicts([...remote.conflicts]);
    });
    let alive = true;
    (async () => {
      try {
        await ledger.refresh();
        await ledger.flush();
        prevLevel.current = levelOf(totalXpOf(ledger.snapshot()));
        suppressLevelUp.current = false;
        const { state: rs, activities } = await remote.load();
        if (!alive) return;
        // 병합은 setState 밖에서(바로 이어서 초기화 마무리에 쓰므로). stateRef는 매 렌더·commit마다 최신
        const cur = stateRef.current;
        // 초기화 표시보다 이른 활동 행은 버린다(서버 초기화를 아직 못 했어도 되살아나지 않게. 시계 차이는 syncResets가 보정)
        const marks = { ...(rs?.unitResets ?? {}) };
        for (const [u, mk] of Object.entries(cur.unitResets ?? {})) if (mk && (!marks[u as UnitId] || marks[u as UnitId]!.at < mk.at)) marks[u as UnitId] = mk;
        const rows: Record<string, ActivityProgress> = {};
        for (const [id, a] of Object.entries(activities)) {
          const u = unitOfActivity(id);
          const mk = u ? marks[u] : undefined;
          if (mk && Date.parse(a.updatedAt) <= Date.parse(mk.at)) continue;
          rows[id] = a;
        }
        const server: LearnerState = { ...(rs ?? emptyLearnerState(identity.learnerKey)), learnerKey: identity.learnerKey, activities: { ...(rs?.activities ?? {}), ...rows } };
        const merged = mergeLearnerStates(cur, server);
        stateRef.current = merged;
        setState(merged);
        writeJson(stateKey, merged);
        // 초기화한 단원인데 서버에 학습 상태에 없는 활동 행이 남아 있으면 정리 대상
        const staleUnits = new Set<UnitId>();
        for (const id of Object.keys(activities)) {
          const u = unitOfActivity(id);
          if (u && merged.unitResets?.[u] && !merged.activities[id]) staleUnits.add(u);
        }
        // 서버 스냅샷이 이 기기의 초기화를 모르면 바로 알려 주고, 남은 서버 기록을 정리한다
        if (JSON.stringify(rs?.unitResets ?? {}) !== JSON.stringify(merged.unitResets ?? {})) remote.saveSnapshot(merged, true);
        await syncResets(merged, staleUnits);
        await remote.startSession();
      } catch {
        suppressLevelUp.current = false;
        setSaveStatus('retry');
      }
    })();
    return () => {
      alive = false;
      un();
    };
  }, [remote, ledger, identity.learnerKey, stateKey, syncResets]);

  const totalXp = totalXpOf(snap);
  const level = levelOf(totalXp);

  // 레벨업 연출: 여러 레벨 상승은 한 번에 묶는다(Lv12→Lv15). 10·20·…·99는 성장 카드(가장 최근 단계 하나).
  useEffect(() => {
    const prev = prevLevel.current;
    if (suppressLevelUp.current) return;
    if (level > prev) {
      setCelebrations((c) => {
        const existing = c.find((x) => x.kind === 'toast' && x.fromLevel !== undefined);
        const from = existing?.fromLevel ?? prev;
        const toast: Celebration = { id: existing?.id ?? celebId.current++, kind: 'toast', text: `레벨 업! Lv${from} → Lv${level}`, fromLevel: from };
        let next = existing ? c.map((x) => (x.id === existing.id ? toast : x)) : [...c, toast];
        const crossed = MILESTONE_LEVELS.filter((m) => m > from && m <= level);
        if (crossed.length) {
          next = next.filter((x) => x.kind !== 'milestone');
          next.push({ id: celebId.current++, kind: 'milestone', text: '', level: crossed[crossed.length - 1] });
        }
        return next;
      });
    }
    prevLevel.current = level;
  }, [level]);

  const flushLocal = useCallback(() => {
    writeJson(stateKey, stateRef.current);
  }, [stateKey]);

  const reconcile = useCallback(async (s: LearnerState): Promise<AwardResult[]> => {
    const results: AwardResult[] = [];
    const have = ledger.snapshot();
    for (const r of eligibleRewards(s)) {
      if (have.rewards[r] || have.pendingRewards.includes(r)) continue;
      results.push(await ledger.award(r));
    }
    for (const b of eligibleBadges(s)) {
      if (ledger.snapshot().badges[b]) continue;
      const res = await ledger.awardBadge(b, solvedChallengeCount(s));
      if (res.status === 'awarded') {
        const name = BADGE_BY_ID[b]?.name;
        if (name && !b.startsWith('badge:unit-')) setCelebrations((c) => [...c, { id: celebId.current++, kind: 'toast', text: `배지 획득: ${name}` }]);
      }
    }
    return results;
  }, [ledger]);

  // 시작 시 한 번 정산(오프라인에서 완료한 보상 재요청 등)
  useEffect(() => {
    void reconcile(stateRef.current);
  }, [reconcile]);

  const commit = useCallback<LearnerCtx['commit']>(async (fn, opts) => {
    const before = stateRef.current;
    let next = fn(before);
    // 새로 완료된 단원: 축하 카드(재방문 시 반복하지 않음)
    const newlyDone = UNITS.filter((u) => !isUnitComplete(before, u.id) && isUnitComplete(next, u.id) && !next.celebratedUnits.includes(u.id));
    if (newlyDone.length) {
      next = { ...next, celebratedUnits: [...next.celebratedUnits, ...newlyDone.map((u) => u.id)] };
      setCelebrations((c) => [...c, ...newlyDone.map((u) => ({ id: celebId.current++, kind: 'unit' as const, text: u.badgeName, unitId: u.id }))]);
    }
    stateRef.current = next;
    setState(next);
    writeJson(stateKey, next); // 로컬에는 항상 즉시 기록
    if (remote) {
      if (opts?.activityId && next.activities[opts.activityId]) remote.saveActivity(next.activities[opts.activityId], !!opts.immediate);
      remote.saveSnapshot(next, !!opts?.immediate);
      for (const u of newlyDone) {
        void remote.saveUnit(u.id, 'complete', u.activityIds.filter((a) => next.activities[a]?.completedAt), unitCheckpointScore(next, u.id));
      }
    }
    return reconcile(next);
  }, [stateKey, remote, reconcile]);

  // 활성 학습 시간을 세션 단위로 보고
  useEffect(() => {
    if (!remote) return;
    const iv = window.setInterval(() => void remote.reportSession(stateRef.current.totalActiveSeconds), 60000);
    return () => window.clearInterval(iv);
  }, [remote]);

  const resolveConflict = useCallback((activityId: string, choice: 'server' | 'local') => {
    if (!remote) return;
    const c = remote.conflicts.find((x) => x.activityId === activityId);
    if (!c) return;
    const cur = stateRef.current.activities[activityId];
    if (choice === 'server') {
      void commit((s) => ({ ...s, activities: { ...s.activities, [activityId]: { ...cur, draftSql: c.server.draftSql, state: c.server.state, serverRevision: c.server.revision } } }));
    } else {
      void commit((s) => ({ ...s, activities: { ...s.activities, [activityId]: { ...cur, serverRevision: c.server.revision } } }), { activityId, immediate: true });
    }
    remote.resolveConflict(activityId, c.server.revision);
  }, [remote, commit]);

  const lockUnit = useCallback((u: UnitId) => {
    let out = { count: 0, reset: false };
    void commit((s) => {
      const r = addUnitLock(s, u);
      out = { count: r.count, reset: r.reset };
      return r.state;
    }, { immediate: true });
    if (out.reset) {
      // 저장 대기 중인 그 단원 활동은 버리고, 화면의 경험치·배지 사본에서도 뺀 뒤 서버 기록을 지운다.
      // 실패해도(오프라인 등) 학습 상태의 초기화 표시가 남아 다음 접속 때 syncResets가 마무리한다.
      remote?.dropQueued(unitItems(u).activityIds);
      ledger.forget(unitRewardIds(u));
      // 풀던 개념 점검(2단계) 초안도 지운다(초기화 뒤 이어 풀어 통과하지 않게)
      removeWithPrefix(`${prefix}db:quiz:${u}`);
      const mark = stateRef.current.unitResets?.[u];
      if (remote && mark) {
        void remote.resetUnit(u, mark.at, mark.n, []).then((ok) => {
          if (ok && ledger instanceof SupabaseLedger) void ledger.refresh().catch(() => {});
        });
      }
    }
    return out;
  }, [commit, remote, ledger, prefix]);

  const resetMyData = useCallback(async () => {
    if (remote) {
      const err = await remote.deleteMyData();
      if (err) return err;
    }
    // 데이터베이스 기록만 지운다: 다른 과목(컴퓨터 일반·네트워크·프로그래밍·Data)의 이 기기 사본은 남긴다
    const otherSubjects = ['cg:', 'net:', 'prog:', 'data:'].map((s) => prefix + s);
    for (const k of keysWithPrefix(prefix)) if (!otherSubjects.some((o) => k.startsWith(o))) removeRaw(k);
    const fresh = emptyLearnerState(identity.learnerKey);
    stateRef.current = fresh;
    setState(fresh);
    window.location.reload();
    return null;
  }, [remote, prefix, identity.learnerKey]);

  const value: LearnerCtx = {
    identity, state, commit, flushLocal, ledger: snap, totalXp, level,
    pendingSync: snap.pendingRewards.length > 0,
    saveStatus, conflicts, resolveConflict,
    celebrations, dismissCelebration: (id) => setCelebrations((c) => c.filter((x) => x.id !== id)),
    resetMyData, remote, lockUnit,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 보상 결과 → 화면 문구용 XP 합계 */
export function xpGained(results: AwardResult[], prefix?: string): number {
  return results.filter((r) => (r.status === 'awarded' || r.status === 'pending') && (!prefix || r.rewardId.startsWith(prefix))).reduce((s, r) => s + (REWARD_BY_ID[r.rewardId]?.xp ?? 0), 0);
}
