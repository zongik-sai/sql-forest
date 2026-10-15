import { readFileSync } from 'node:fs';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * 데이터베이스 과목 단원 초기화 RPC(reset_db_unit)를 실제 Postgres 엔진(PGlite)에서 검사한다.
 * 본인 기록·그 단원만 지우고, 다른 단원·다른 학생·진단 기록은 남는다.
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
const award = (uid: string, id: string) => as(uid, async (tx) => (await tx.query<{ status: string }>('select * from public.award_xp($1)', [id])).rows[0].status);
const rewards = (uid: string) => as(uid, async (tx) => (await tx.query<{ reward_id: string }>('select reward_id from public.xp_events order by reward_id')).rows.map((r) => r.reward_id));
const reset = (uid: string | null, unit: string, at = new Date().toISOString(), keep: string[] = []) =>
  as(uid, (tx) => tx.query('select public.reset_db_unit($1, $2, 1, $3::text[])', [unit, at, keep]));
const snapshot = (uid: string) => as(uid, async (tx) => (await tx.query<{ state: Record<string, unknown> }>('select state from public.learner_state')).rows[0]?.state);

async function completeUnit(uid: string, u: string) {
  for (const a of ['A01', 'A02', 'A03', 'A04']) expect(await award(uid, `activity:${u}-${a}`)).toBe('awarded');
  for (const q of ['Q01', 'Q02']) expect(await award(uid, `checkpoint:${u}-${q}`)).toBe('awarded');
  expect(await award(uid, `unit:${u}`)).toBe('awarded');
  await as(uid, (tx) => tx.query(`select public.award_badge($1)`, [`badge:unit-${u}`]));
  await as(uid, (tx) => tx.query(`select public.save_activity_progress($1, 1, '{}'::jsonb, 'select 1', 1, 0, 'independent', 10, 0)`, [`${u}-A01`]));
  await as(uid, (tx) => tx.query(`select public.save_activity_progress($1, 1, '{}'::jsonb, '', 1, 0, null, 0, 0)`, [`CH-${u}`]));
  await as(uid, (tx) => tx.query(`select public.save_unit_progress($1, 1, 'complete', array[$2], 2)`, [u, `${u}-A01`]));
  await as(uid, (tx) => tx.query(`select public.record_mastery($1, 'solved')`, [`CH-${u}`]));
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync('tests/db/supabase-shim.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20261001000000_sql_forest_v2.sql', 'utf8'));
  const m = readFileSync('supabase/migrations/20261015000000_unit_reset.sql', 'utf8');
  await db.exec(m);
  await db.exec(m); // 다시 적용해도 안전(멱등)
  await db.query(`insert into auth.users(id, email) values ($1, 'a@example.com'), ($2, 'b@example.com')`, [A, B]);
  await completeUnit(A, 'U01');
  await completeUnit(A, 'U02');
  await completeUnit(B, 'U01');
  // 학습 상태 스냅샷(초기화를 아직 모름)
  const st = {
    schema: 1, activities: { 'U01-A01': { completedAt: 'x' }, 'CH-U01': {}, 'U02-A01': { completedAt: 'x' }, 'U10-A01': {} },
    questions: { 'U01-Q01': { correct: true }, 'U01-Q01V': {}, 'U02-Q01': { correct: true } },
    challenges: { 'CH-U01': { status: 'solved' }, 'CH-U02': { status: 'solved' } },
    celebratedUnits: ['U01', 'U02'], unitLocks: { U01: ['a', 'b', 'c', 'd'] }, wrongLog: [{ itemId: 'U01-Q01' }],
  };
  await as(A, (tx) => tx.query('select public.save_learner_state($1::jsonb)', [JSON.stringify(st)]));
}, 60000);

describe('reset_db_unit: 단원 초기화(본인·그 단원만)', () => {
  it('그 단원의 경험치·배지·활동/도전 진도·단원 요약·도전 기록만 지운다', async () => {
    await reset(A, 'U01');
    const left = await rewards(A);
    expect(left.filter((r) => r.includes('U01'))).toEqual([]);
    expect(left.filter((r) => r.includes('U02'))).toHaveLength(7);
    const badges = await as(A, async (tx) => (await tx.query<{ badge_id: string }>('select badge_id from public.badge_awards order by 1')).rows.map((r) => r.badge_id));
    expect(badges).toEqual(['badge:unit-U02']);
    const acts = await as(A, async (tx) => (await tx.query<{ activity_id: string }>('select activity_id from public.activity_progress order by 1')).rows.map((r) => r.activity_id));
    expect(acts).toEqual(['CH-U02', 'U02-A01']);
    const units = await as(A, async (tx) => (await tx.query<{ unit_id: string }>('select unit_id from public.unit_progress')).rows.map((r) => r.unit_id));
    expect(units).toEqual(['U02']);
    const mastery = await as(A, async (tx) => (await tx.query<{ challenge_id: string }>('select challenge_id from public.mastery_progress')).rows.map((r) => r.challenge_id));
    expect(mastery).toEqual(['CH-U02']);
  });
  it('스냅샷이 초기화를 모르면 그 단원 기록을 빼고 초기화 표시를 남긴다(U10 같은 비슷한 이름·오답 기록은 그대로)', async () => {
    const st = (await snapshot(A))!;
    expect(Object.keys(st.activities as object).sort()).toEqual(['U02-A01', 'U10-A01']);
    expect(Object.keys(st.questions as object)).toEqual(['U02-Q01']);
    expect(Object.keys(st.challenges as object)).toEqual(['CH-U02']);
    expect(st.celebratedUnits).toEqual(['U02']);
    expect(st.unitLocks).toEqual({});
    expect((st.unitResets as Record<string, { n: number }>).U01.n).toBe(1);
    expect(st.wrongLog).toHaveLength(1);
  });
  it('이미 초기화를 아는 스냅샷은 건드리지 않는다(초기화 뒤 새로 한 공부 보존)', async () => {
    const at = '2026-10-15T01:00:00.000Z';
    const st = { schema: 1, activities: { 'U03-A01': { completedAt: 'new' } }, unitResets: { U03: { at, n: 1 } } };
    await as(A, (tx) => tx.query('select public.save_learner_state($1::jsonb)', [JSON.stringify(st)]));
    await reset(A, 'U03', at);
    expect(Object.keys((await snapshot(A))!.activities as object)).toEqual(['U03-A01']);
  });
  it('늦게 다시 보낸 초기화는 학습 상태에 남아 있는(초기화 뒤 새로 한) 항목을 지우지 않는다(기기 시계와 무관)', async () => {
    expect(await award(A, 'activity:U02-A01')).toBe('duplicate');
    await reset(A, 'U02', '2026-10-15T00:00:00.000Z', ['activity:U02-A02', 'U02-A01', 'mastery:CH-U02']);
    expect((await rewards(A)).filter((r) => r.includes('U02'))).toEqual(['activity:U02-A02']);
    const acts = await as(A, async (tx) => (await tx.query<{ activity_id: string }>('select activity_id from public.activity_progress order by 1')).rows.map((r) => r.activity_id));
    expect(acts.filter((a) => a.includes('U02'))).toEqual(['U02-A01']);
    const mastery = await as(A, async (tx) => (await tx.query<{ challenge_id: string }>('select challenge_id from public.mastery_progress')).rows.map((r) => r.challenge_id));
    expect(mastery).toEqual(['CH-U02']);
    const units = await as(A, async (tx) => (await tx.query<{ unit_id: string }>('select unit_id from public.unit_progress')).rows.map((r) => r.unit_id));
    expect(units).toEqual([]);
  });
  it('다른 학생 기록은 그대로', async () => {
    expect((await rewards(B)).filter((r) => r.includes('U01'))).toHaveLength(7);
  });
  it('초기화한 뒤 다시 공부하면 경험치를 다시 받는다', async () => {
    expect(await award(A, 'activity:U01-A01')).toBe('awarded');
  });
  it('이상한 단원 이름·비로그인은 거부', async () => {
    await expect(reset(A, 'U13')).rejects.toThrow(/알 수 없는 단원/);
    await expect(reset(A, "U01' or 1=1 --")).rejects.toThrow(/알 수 없는 단원/);
    await expect(reset(A, 'U01', 'yesterday')).rejects.toThrow(/형식/);
    await expect(reset(A, 'U01', undefined, Array.from({ length: 41 }, (_, i) => `x${i}`))).rejects.toThrow(/너무 많/);
    await expect(reset(null, 'U01')).rejects.toThrow(/permission denied/);
  });
});
