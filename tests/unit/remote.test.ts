import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { RemoteProgress, SupabaseLedger } from '../../src/features/auth/remote';
import { emptyActivity } from '../../src/features/progress/model';
import { totalXpOf } from '../../src/features/progress/ledger';
import { keysWithPrefix, learnerPrefix, removeWithPrefix, writeJson } from '../../src/lib/storage';

/** 서버 award_xp/save_activity_progress의 동작을 흉내 내는 가짜 클라이언트 */
function fakeServer() {
  const ledger = new Set<string>();
  const acts = new Map<string, { revision: number; draft: string }>();
  let online = true;
  const calls: string[] = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push(name);
      if (!online) throw new TypeError('Failed to fetch');
      if (name === 'award_xp') {
        const id = args.p_reward_id as string;
        if (ledger.has(id)) return { data: [{ status: 'duplicate', total_xp: 0 }], error: null };
        ledger.add(id);
        return { data: [{ status: 'awarded', total_xp: 0 }], error: null };
      }
      if (name === 'save_activity_progress') {
        const id = args.p_activity_id as string;
        const cur = acts.get(id);
        if (!cur) {
          acts.set(id, { revision: 1, draft: args.p_draft_sql as string });
          return { data: { status: 'ok', revision: 1 }, error: null };
        }
        if (cur.revision !== args.p_expected_revision) return { data: { status: 'conflict', revision: cur.revision, draft_sql: cur.draft, state: {} }, error: null };
        cur.revision += 1;
        cur.draft = args.p_draft_sql as string;
        return { data: { status: 'ok', revision: cur.revision }, error: null };
      }
      return { data: null, error: null };
    },
    from: () => ({ select: async () => ({ data: [], error: null }) }),
  };
  return { client: client as unknown as SupabaseClient, ledger, acts, calls, setOnline: (v: boolean) => (online = v) };
}

describe('SupabaseLedger (오프라인 동기화 대기)', () => {
  it('네트워크 실패 → 동기화 대기로 임시 성장 표시 → 재전송 시 1회만 지급', async () => {
    const srv = fakeServer();
    const l = new SupabaseLedger(srv.client, 'test:sl:1');
    srv.setOnline(false);
    const r = await l.award('activity:U01-A01');
    expect(r.status).toBe('pending');
    expect(totalXpOf(l.snapshot())).toBe(100); // 임시 표시
    expect(totalXpOf(l.snapshot(), false)).toBe(0); // 서버 확인 전
    await l.award('activity:U01-A01'); // 오프라인 재요청
    srv.setOnline(true);
    await l.flush();
    await l.flush(); // 중복 재전송
    expect([...srv.ledger]).toEqual(['activity:U01-A01']);
    expect(l.snapshot().pendingRewards).toEqual([]);
    expect(totalXpOf(l.snapshot(), false)).toBe(100);
  });
  it('이미 받은 보상은 서버에 다시 요청하지 않음', async () => {
    const srv = fakeServer();
    const l = new SupabaseLedger(srv.client, 'test:sl:2');
    await l.award('activity:U01-A01');
    const n = srv.calls.length;
    expect((await l.award('activity:U01-A01')).status).toBe('duplicate');
    expect(srv.calls.length).toBe(n);
  });
});

describe('RemoteProgress (revision compare-and-set)', () => {
  it('저장 중 큐에 들어간 초안도 최신 revision으로 저장(거짓 충돌 없음)', async () => {
    const srv = fakeServer();
    const rp = new RemoteProgress(srv.client);
    const a = { ...emptyActivity('U01-A01'), draftSql: 'v1' };
    rp.saveActivity(a, true);
    await rp.flush();
    rp.saveActivity({ ...a, draftSql: 'v2' }, true); // serverRevision은 여전히 0인 오래된 객체
    await rp.flush();
    expect(rp.conflicts).toEqual([]);
    expect(srv.acts.get('U01-A01')).toEqual({ revision: 2, draft: 'v2' });
  });
  it('다른 기기가 먼저 바꾸면 conflict로 알리고 자동 덮어쓰지 않음', async () => {
    const srv = fakeServer();
    srv.acts.set('U01-A02', { revision: 5, draft: '다른 기기 초안' });
    const rp = new RemoteProgress(srv.client);
    rp.saveActivity({ ...emptyActivity('U01-A02'), draftSql: '이 기기', serverRevision: 3 }, true);
    await rp.flush();
    expect(rp.conflicts[0]).toMatchObject({ activityId: 'U01-A02', server: { revision: 5, draftSql: '다른 기기 초안' } });
    expect(srv.acts.get('U01-A02')!.draft).toBe('다른 기기 초안');
    // '이 기기 초안 유지' 선택 → 서버 revision 기준으로 저장
    rp.resolveConflict('U01-A02', 5);
    rp.saveActivity({ ...emptyActivity('U01-A02'), draftSql: '이 기기', serverRevision: 3 }, true);
    await rp.flush();
    expect(srv.acts.get('U01-A02')).toEqual({ revision: 6, draft: '이 기기' });
  });
  it('오프라인이면 로컬 보관 상태로 표시', async () => {
    const srv = fakeServer();
    srv.setOnline(false);
    const rp = new RemoteProgress(srv.client);
    rp.saveActivity({ ...emptyActivity('U01-A03'), draftSql: 'x' }, true);
    await rp.flush();
    expect(rp.status).toBe('local');
  });
});

describe('사용자 전환', () => {
  it('로그아웃 시 그 사용자의 로컬 캐시만 제거', () => {
    writeJson(`${learnerPrefix('user:a')}state`, { x: 1 });
    writeJson(`${learnerPrefix('user:a')}ledger`, { x: 1 });
    writeJson(`${learnerPrefix('user:b')}state`, { y: 1 });
    removeWithPrefix(learnerPrefix('user:a'));
    expect(keysWithPrefix(learnerPrefix('user:a'))).toEqual([]);
    expect(keysWithPrefix(learnerPrefix('user:b')).length).toBe(1);
  });
});
