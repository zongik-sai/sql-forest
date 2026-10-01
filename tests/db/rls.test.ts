import { readFileSync } from 'node:fs';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { REWARD_CATALOG } from '../../src/features/progress/rewards';

/**
 * 실제 Postgres 엔진(PGlite, PostgreSQL 17 WASM)에 migration을 적용하고,
 * Supabase와 같은 방식(authenticated 역할 + JWT sub)으로 RLS·RPC를 검사한다.
 * 실제 Supabase 프로젝트에서의 검증은 아니다(설정 후 README의 수동 점검 필요).
 * PGlite는 단일 연결이라 진짜 동시 요청은 재현하지 못하며, 동시성은 PK + ON CONFLICT + advisory lock 설계로 보장한다.
 */

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
let db: PGlite;

async function as<T>(uid: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
    return fn(tx);
  });
}
const award = (uid: string, id: string) => as(uid, async (tx) => (await tx.query<{ status: string; total_xp: number }>('select * from public.award_xp($1)', [id])).rows[0]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync('tests/db/supabase-shim.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20261001000000_sql_forest_v2.sql', 'utf8'));
  // migration을 두 번 적용해도 깨지지 않는다(멱등)
  await db.exec(readFileSync('supabase/migrations/20261001000000_sql_forest_v2.sql', 'utf8'));
  await db.query(`insert into auth.users(id, email) values ($1, 'a@example.com'), ($2, 'b@example.com')`, [A, B]);
}, 60000);

describe('reward_catalog', () => {
  it('클라이언트 TS 카탈로그와 정확히 일치(109개, 9,900XP)', async () => {
    const r = await db.query<{ reward_id: string; xp: number; prerequisite_type: string }>('select reward_id, xp, prerequisite_type from public.reward_catalog order by reward_id');
    const ts = [...REWARD_CATALOG].map((x) => ({ reward_id: x.rewardId, xp: x.xp, prerequisite_type: x.prerequisiteType })).sort((a, b) => (a.reward_id < b.reward_id ? -1 : 1));
    expect(r.rows).toEqual(ts);
    expect(r.rows.reduce((s, x) => s + x.xp, 0)).toBe(9900);
  });
});

describe('RLS: 본인 데이터만', () => {
  it('A의 진도를 B는 조회·수정·삭제할 수 없다', async () => {
    await as(A, (tx) => tx.query(`insert into public.activity_progress(user_id, activity_id, content_version, draft_sql) values ($1, 'U01-A01', 1, 'SELECT 1')`, [A]));
    const seen = await as(B, (tx) => tx.query('select * from public.activity_progress'));
    expect(seen.rows.length).toBe(0);
    const upd = await as(B, (tx) => tx.query(`update public.activity_progress set draft_sql = 'hack' where user_id = $1`, [A]));
    expect(upd.affectedRows).toBe(0);
    const del = await as(B, (tx) => tx.query(`delete from public.activity_progress where user_id = $1`, [A]));
    expect(del.affectedRows).toBe(0);
    const mine = await as(A, (tx) => tx.query<{ draft_sql: string }>('select draft_sql from public.activity_progress'));
    expect(mine.rows).toEqual([{ draft_sql: 'SELECT 1' }]);
  });

  it('다른 사용자 user_id로 INSERT 불가', async () => {
    await expect(as(A, (tx) => tx.query(`insert into public.unit_progress(user_id, unit_id, content_version, status) values ($1, 'U01', 1, 'complete')`, [B]))).rejects.toThrow(/row-level security/);
  });

  it('UPDATE로 user_id를 다른 사용자로 바꿀 수 없다(WITH CHECK / 트리거)', async () => {
    await as(A, (tx) => tx.query(`insert into public.unit_progress(user_id, unit_id, content_version, status) values ($1, 'U01', 1, 'ready')`, [A]));
    await expect(as(A, (tx) => tx.query(`update public.unit_progress set user_id = $1`, [B]))).rejects.toThrow(/row-level security/);
    await as(A, (tx) => tx.query(`update public.activity_progress set user_id = $1`, [B]));
    const owner = await db.query<{ user_id: string }>(`select user_id from public.activity_progress where activity_id = 'U01-A01'`);
    expect(owner.rows.map((r) => r.user_id)).toEqual([A]);
  });

  it('anon(비로그인)은 어떤 사용자 데이터도 읽지 못한다', async () => {
    await expect(as(null, (tx) => tx.query('select * from public.activity_progress'))).rejects.toThrow(/permission denied/);
    await expect(as(null, (tx) => tx.query('select * from public.xp_events'))).rejects.toThrow(/permission denied/);
  });
});

describe('XP 원장: 직접 쓰기 금지, RPC로만', () => {
  it('xp_events 직접 INSERT/UPDATE/DELETE 거부', async () => {
    await expect(as(A, (tx) => tx.query(`insert into public.xp_events(user_id, reward_id, entitlement_version) values ($1, 'course:complete', 1)`, [A]))).rejects.toThrow(/permission denied/);
    await expect(as(A, (tx) => tx.query(`update public.xp_events set reward_id = 'course:complete'`))).rejects.toThrow(/permission denied/);
    await expect(as(A, (tx) => tx.query(`delete from public.xp_events`))).rejects.toThrow(/permission denied/);
  });
  it('reward_catalog·badge_awards 직접 쓰기 거부, 카탈로그는 읽기 가능', async () => {
    await expect(as(A, (tx) => tx.query(`update public.reward_catalog set xp = 9999`))).rejects.toThrow(/permission denied/);
    await expect(as(A, (tx) => tx.query(`insert into public.badge_awards(user_id, badge_id) values ($1, 'badge:forest')`, [A]))).rejects.toThrow(/permission denied/);
    const c = await as(A, (tx) => tx.query('select count(*)::int as n from public.reward_catalog'));
    expect(c.rows[0]).toEqual({ n: 109 });
  });
  it('내부 함수(private) 직접 호출 불가', async () => {
    await expect(as(A, (tx) => tx.query(`select private.total_xp($1)`, [A]))).rejects.toThrow(/permission denied/);
  });
  it('로그인 없이 award_xp 거부, anon 실행 권한 없음', async () => {
    await expect(as(null, (tx) => tx.query(`select * from public.award_xp('activity:U01-A01')`))).rejects.toThrow(/permission denied/);
  });
  it('award_xp: 지급 → 중복 → 알 수 없는 ID 거부', async () => {
    expect(await award(A, 'activity:U01-A01')).toEqual({ status: 'awarded', total_xp: 100 });
    expect(await award(A, 'activity:U01-A01')).toEqual({ status: 'duplicate', total_xp: 100 });
    expect((await award(A, 'activity:U99-A01')).status).toBe('rejected');
    expect((await award(A, 'activity:CH-U01')).status).toBe('rejected');
    // 같은 요청 여러 번(재전송·동시 탭 시나리오) — 단일 연결이므로 순차 실행됨
    const many = await Promise.all([1, 2, 3].map(() => award(A, 'activity:U01-A02')));
    expect(many.filter((m) => m.status === 'awarded').length).toBe(1);
  });
  it('선행 조건: 단원은 활동 4 + 체크포인트 2 이후, 최종·마무리는 전부 이후', async () => {
    expect((await award(A, 'unit:U01')).status).toBe('rejected');
    await award(A, 'activity:U01-A03');
    await award(A, 'activity:U01-A04');
    await award(A, 'checkpoint:U01-Q01');
    expect((await award(A, 'unit:U01')).status).toBe('rejected');
    await award(A, 'checkpoint:U01-Q02');
    expect(await award(A, 'unit:U01')).toEqual({ status: 'awarded', total_xp: 650 - 50 });
    expect((await award(A, 'final:F01')).status).toBe('rejected');
    expect((await award(A, 'course:complete')).status).toBe('rejected');
  });
  it('B는 A의 원장을 볼 수 없고, 자기 원장은 비어 있다', async () => {
    const r = await as(B, (tx) => tx.query('select * from public.xp_events'));
    expect(r.rows.length).toBe(0);
  });
  it('전체 과정: 9,900XP, 마무리는 모든 체크포인트 해결 후에만', async () => {
    const ids = [...REWARD_CATALOG].map((r) => r.rewardId);
    const order = [...ids.filter((i) => i.startsWith('activity:') || i.startsWith('checkpoint:')).filter((i) => i !== 'checkpoint:U12-Q03'), ...ids.filter((i) => i.startsWith('unit:')), ...ids.filter((i) => i.startsWith('final:'))];
    for (const id of order) await award(B, id);
    expect((await award(B, 'course:complete')).status).toBe('rejected');
    await award(B, 'checkpoint:U12-Q03');
    expect(await award(B, 'course:complete')).toEqual({ status: 'awarded', total_xp: 9900 });
    expect((await award(B, 'course:complete')).status).toBe('duplicate');
  });
});

describe('배지·숙련 기록', () => {
  it('단원 배지는 단원 보상 후, 스스로 풀었어요는 도전 3개 해결 후', async () => {
    const badge = (uid: string, id: string) => as(uid, async (tx) => (await tx.query<{ award_badge: string }>('select public.award_badge($1)', [id])).rows[0].award_badge);
    expect(await badge(A, 'badge:unit-U02')).toBe('rejected');
    expect(await badge(A, 'badge:unit-U01')).toBe('awarded');
    expect(await badge(A, 'badge:unit-U01')).toBe('duplicate');
    expect(await badge(A, 'badge:self-solved')).toBe('rejected');
    for (const c of ['CH-U01', 'CH-U02']) await as(A, (tx) => tx.query(`select public.record_mastery($1, 'solved')`, [c]));
    await as(A, (tx) => tx.query(`select public.record_mastery('CH-U03', 'learned')`));
    expect(await badge(A, 'badge:self-solved')).toBe('rejected');
    await as(A, (tx) => tx.query(`select public.record_mastery('CH-U03', 'solved')`));
    await as(A, (tx) => tx.query(`select public.record_mastery('CH-U03', 'learned')`)); // 강등되지 않음
    expect(await badge(A, 'badge:self-solved')).toBe('awarded');
    await expect(as(A, (tx) => tx.query(`insert into public.mastery_progress values ($1, 'CH-U04', 'solved', now())`, [A]))).rejects.toThrow(/permission denied/);
    expect(await badge(B, 'badge:forest')).toBe('awarded');
  });
});

describe('진도 저장 RPC', () => {
  const save = (uid: string, draft: string, expected: number, kind: string | null = null) =>
    as(uid, async (tx) => (await tx.query<{ r: { status: string; revision: number; draft_sql?: string } }>(`select public.save_activity_progress('U02-A01', 1, '{}'::jsonb, $1, 1, 2, $3, 30, $2) as r`, [draft, expected, kind])).rows[0].r);
  it('revision compare-and-set: 오래된 revision이면 conflict와 서버본 반환', async () => {
    expect(await save(A, 'v1', 0)).toEqual({ status: 'ok', revision: 1 });
    expect(await save(A, 'v2', 1)).toEqual({ status: 'ok', revision: 2 });
    const c = await save(A, '다른 기기', 1);
    expect(c.status).toBe('conflict');
    expect(c.revision).toBe(2);
    expect(c.draft_sql).toBe('v2');
  });
  it('완료(completion_kind)는 단조 증가', async () => {
    await save(A, 'v3', 2, 'guided');
    await save(A, 'v4', 3, null);
    const r = await as(A, (tx) => tx.query<{ completion_kind: string }>(`select completion_kind from public.activity_progress where activity_id = 'U02-A01'`));
    expect(r.rows[0].completion_kind).toBe('guided');
  });
  it('학습 세션 시간은 증가만, 실제 경과 시간+60초를 넘지 못함', async () => {
    const id = await as(A, async (tx) => (await tx.query<{ id: string }>('select public.start_learning_session() as id')).rows[0].id);
    await as(A, (tx) => tx.query('select public.update_learning_session($1, 30)', [id]));
    await as(A, (tx) => tx.query('select public.update_learning_session($1, 10)', [id]));
    await as(A, (tx) => tx.query('select public.update_learning_session($1, 99999)', [id]));
    const r = await as(A, (tx) => tx.query<{ active_seconds: number }>('select active_seconds from public.learning_sessions where id = $1', [id]));
    expect(r.rows[0].active_seconds).toBeGreaterThanOrEqual(30);
    expect(r.rows[0].active_seconds).toBeLessThanOrEqual(61);
    // B는 A의 세션을 갱신할 수 없다
    await as(B, (tx) => tx.query('select public.update_learning_session($1, 50)', [id]));
    const r2 = await as(A, (tx) => tx.query<{ active_seconds: number }>('select active_seconds from public.learning_sessions where id = $1', [id]));
    expect(r2.rows[0].active_seconds).toBe(r.rows[0].active_seconds);
  });
  it('단원 진도 병합: 완료 활동 합집합, 체크포인트 점수 최댓값', async () => {
    await as(A, (tx) => tx.query(`select public.save_unit_progress('U03', 1, 'in-progress', array['U03-A01'], 2)`));
    await as(A, (tx) => tx.query(`select public.save_unit_progress('U03', 1, 'complete', array['U03-A02'], 1)`));
    const r = await as(A, (tx) => tx.query<{ completed_activity_ids: string[]; checkpoint_score: number }>(`select completed_activity_ids, checkpoint_score from public.unit_progress where unit_id = 'U03'`));
    expect(r.rows[0]).toEqual({ completed_activity_ids: ['U03-A01', 'U03-A02'], checkpoint_score: 2 });
  });
  it('내 기록 삭제는 본인 행만 지운다', async () => {
    const bBefore = await db.query<{ n: number }>(`select count(*)::int as n from public.xp_events where user_id = $1`, [B]);
    await as(A, (tx) => tx.query('select public.delete_my_progress()'));
    const a = await db.query<{ n: number }>(`select count(*)::int as n from public.xp_events where user_id = $1`, [A]);
    const b = await db.query<{ n: number }>(`select count(*)::int as n from public.xp_events where user_id = $1`, [B]);
    expect(a.rows[0].n).toBe(0);
    expect(b.rows[0].n).toBe(bBefore.rows[0].n);
  });
});
