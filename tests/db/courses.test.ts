import { readFileSync } from 'node:fs';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * 새 과목(네트워크·프로그래밍·Data) 기록(course_progress)·선생님 과목별 반 현황 RPC를 실제 Postgres 엔진(PGlite)에서 검사한다.
 * Supabase 방식(authenticated 역할 + JWT sub)을 흉내 내며, 실제 Supabase 프로젝트 검증은 별도.
 */
const S1 = '11111111-1111-1111-1111-111111111111';
const S2 = '22222222-2222-2222-2222-222222222222';
const T = '33333333-3333-3333-3333-333333333333'; // 선생님(인증된 이메일 + Google)
const FAKE = '44444444-4444-4444-4444-444444444444'; // 선생님 이메일이지만 미인증
let db: PGlite;

async function as<R>(uid: string | null, fn: (tx: Transaction) => Promise<R>): Promise<R> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
    return fn(tx);
  });
}
type Save = { status: string; revision: number; state?: unknown };
const save = (uid: string, course: string, state: unknown, rev: number) =>
  as(uid, async (tx) => (await tx.query<{ r: Save }>('select public.save_course_progress($1, $2::jsonb, $3) as r', [course, JSON.stringify(state), rev])).rows[0].r);
const overview = (uid: string | null, course: string) =>
  as(uid, async (tx) => (await tx.query<{ user_id: string; name: string; email: string; state: unknown }>('select user_id, name, email, state from public.course_class_overview($1)', [course])).rows);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync('tests/db/supabase-shim.sql', 'utf8'));
  for (const f of ['20261001000000_sql_forest_v2.sql', '20261007000000_computer_general.sql', '20261015000000_unit_reset.sql', '20261016000000_unit_reset_stages.sql']) {
    await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
  }
  const m = readFileSync('supabase/migrations/20261026000000_courses.sql', 'utf8');
  await db.exec(m);
  await db.exec(m); // 재적용 안전(멱등)
  await db.exec(`insert into private.teachers(email) values ('teacher@school.example') on conflict do nothing`);
  await db.query(
    `insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data) values
      ($1, 's1@gmail.com', now(), '{"full_name":"가온"}'),
      ($2, 's2@school.example', now(), '{"name":"나래"}'),
      ($3, 'Teacher@School.example', now(), '{"full_name":"선생님"}'),
      ($4, 'teacher@school.example.fake', null, '{}')`,
    [S1, S2, T, FAKE],
  );
  await db.query(`update auth.users set email = 'teacher@school.example' where id = $1`, [FAKE]);
  await db.query(
    `insert into auth.identities(user_id, provider, identity_data) values
      ($1, 'google', '{"email":"s1@gmail.com","full_name":"가온"}'),
      ($2, 'google', '{"email":"s2@school.example","name":"나래"}'),
      ($3, 'google', '{"email":"teacher@school.example","full_name":"선생님"}')`,
    [S1, S2, T],
  );
}, 60000);

describe('course_progress: 본인 기록만, 과목마다 한 행', () => {
  it('과목마다 따로 저장(첫 저장 → revision 1, CAS 갱신 → 2)', async () => {
    expect(await save(S1, 'net', { v: 1, units: { U1: { lv1: { passedAt: 'x' } } } }, 0)).toEqual({ status: 'ok', revision: 1 });
    expect(await save(S1, 'net', { v: 1, units: { U1: {}, U2: {} } }, 1)).toEqual({ status: 'ok', revision: 2 });
    // 다른 과목은 별개의 행(revision 1부터)
    expect(await save(S1, 'prog', { v: 1, units: { U3: {} } }, 0)).toEqual({ status: 'ok', revision: 1 });
    const rows = await as(S1, (tx) => tx.query<{ course: string; revision: number }>('select course, revision from public.course_progress order by course'));
    expect(rows.rows).toEqual([{ course: 'net', revision: 2 }, { course: 'prog', revision: 1 }]);
  });
  it('오래된 revision으로 저장하면 conflict와 서버본을 돌려준다(덮어쓰지 않음)', async () => {
    const r = await save(S1, 'net', { v: 1, units: {} }, 1);
    expect(r).toEqual({ status: 'conflict', revision: 2, state: { v: 1, units: { U1: {}, U2: {} } } });
    // 아직 행이 없는 과목에 0이 아닌 revision으로 저장해도 첫 저장으로 받는다(cg와 같음)
    expect(await save(S1, 'data', { v: 1 }, 5)).toEqual({ status: 'ok', revision: 1 });
  });
  it('모르는 과목(cg 포함)은 거부', async () => {
    await expect(save(S1, 'cg', { v: 1 }, 0)).rejects.toThrow(/알 수 없는 과목/);
    await expect(save(S1, 'NET', { v: 1 }, 0)).rejects.toThrow(/알 수 없는 과목/);
    await expect(as(S1, (tx) => tx.query(`insert into public.course_progress(user_id, course, state) values ($1, 'math', '{}')`, [S1]))).rejects.toThrow(/check constraint/);
  });
  it('배열·너무 큰 기록은 거부', async () => {
    await expect(save(S2, 'net', [1, 2], 0)).rejects.toThrow(/check constraint/);
    await expect(save(S2, 'net', { big: 'x'.repeat(300000) }, 0)).rejects.toThrow(/check constraint/);
  });
  it('다른 학생의 기록은 조회·수정·삭제 불가, 행의 주인·과목은 바꿀 수 없다', async () => {
    await save(S2, 'net', { v: 1, units: { U5: {} } }, 0);
    const seen = await as(S1, (tx) => tx.query<{ user_id: string }>('select distinct user_id from public.course_progress'));
    expect(seen.rows.map((r) => r.user_id)).toEqual([S1]);
    const upd = await as(S1, (tx) => tx.query(`update public.course_progress set state = '{}' where user_id = $1`, [S2]));
    expect(upd.affectedRows).toBe(0);
    const del = await as(S1, (tx) => tx.query(`delete from public.course_progress where user_id = $1`, [S2]));
    expect(del.affectedRows).toBe(0);
    await expect(as(S1, (tx) => tx.query(`insert into public.course_progress(user_id, course, state) values ($1, 'data', '{}')`, [S2]))).rejects.toThrow(/row-level security/);
    // 본인 행의 과목을 바꾸려 해도 트리거가 원래 과목으로 되돌린다
    await as(S1, (tx) => tx.query(`update public.course_progress set course = 'data' where course = 'prog'`));
    const mine = await as(S1, (tx) => tx.query<{ course: string }>('select course from public.course_progress order by course'));
    expect(mine.rows.map((r) => r.course)).toEqual(['data', 'net', 'prog']);
  });
  it('본인 기록 삭제 가능', async () => {
    const del = await as(S2, (tx) => tx.query(`delete from public.course_progress where course = 'net'`));
    expect(del.affectedRows).toBe(1);
    await save(S2, 'net', { v: 1, units: { U5: {} } }, 0);
  });
  it('비로그인은 읽기·저장 모두 불가', async () => {
    await expect(as(null, (tx) => tx.query('select * from public.course_progress'))).rejects.toThrow(/permission denied/);
    await expect(as(null, (tx) => tx.query(`select public.save_course_progress('net', '{}'::jsonb, 0)`))).rejects.toThrow(/permission denied/);
  });
  it('컴퓨터 일반 기록(cg_progress)과는 따로 저장된다', async () => {
    const r = await as(S1, async (tx) => (await tx.query<{ r: Save }>('select public.save_cg_progress($1::jsonb, 0) as r', [JSON.stringify({ v: 1 })])).rows[0].r);
    expect(r).toEqual({ status: 'ok', revision: 1 });
    const n = await as(S1, (tx) => tx.query<{ n: number }>('select count(*)::int as n from public.course_progress'));
    expect(n.rows[0].n).toBe(3);
  });
});

describe('선생님 과목별 반 학습 현황(읽기 전용)', () => {
  it('학생·미인증 계정은 거부된다', async () => {
    await expect(overview(S1, 'net')).rejects.toThrow(/선생님 계정만/);
    await expect(overview(FAKE, 'net')).rejects.toThrow(/선생님 계정만/);
  });
  it('선생님은 그 과목 학생만 이름·이메일과 함께 읽는다', async () => {
    const net = await overview(T, 'net');
    const byId = Object.fromEntries(net.map((r) => [r.user_id, r]));
    expect(Object.keys(byId).sort()).toEqual([S1, S2]);
    expect(byId[S1]).toMatchObject({ name: '가온', email: 's1@gmail.com', state: { v: 1, units: { U1: {}, U2: {} } } });
    expect(byId[S2]).toMatchObject({ name: '나래', email: 's2@school.example', state: { v: 1, units: { U5: {} } } });
    expect((await overview(T, 'prog')).map((r) => r.user_id)).toEqual([S1]);
    expect((await overview(T, 'data')).map((r) => r.user_id)).toEqual([S1]);
  });
  it('모르는 과목은 거부', async () => {
    await expect(overview(T, 'cg')).rejects.toThrow(/알 수 없는 과목/);
  });
  it('선생님도 학생 기록을 직접 수정·삭제할 수 없다(읽기만)', async () => {
    const upd = await as(T, (tx) => tx.query(`update public.course_progress set state = '{}' where user_id = $1`, [S1]));
    expect(upd.affectedRows).toBe(0);
    const del = await as(T, (tx) => tx.query(`delete from public.course_progress where user_id = $1`, [S1]));
    expect(del.affectedRows).toBe(0);
  });
  it('비로그인은 선생님 RPC 실행 권한 자체가 없다', async () => {
    await expect(overview(null, 'net')).rejects.toThrow(/permission denied/);
  });
  it('트리거 함수는 클라이언트가 직접 부를 수 없다', async () => {
    await expect(as(S1, (tx) => tx.query('select private.course_bump_revision()'))).rejects.toThrow(/permission denied|trigger functions can only be called as triggers/);
  });
});
