import { readFileSync } from 'node:fs';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * 컴퓨터 일반 기록(cg_progress)·선생님 반 현황 RPC를 실제 Postgres 엔진(PGlite)에서 검사한다.
 * Supabase 방식(authenticated 역할 + JWT sub)을 흉내 내며, 실제 Supabase 프로젝트 검증은 별도.
 */
const S1 = '11111111-1111-1111-1111-111111111111';
const S2 = '22222222-2222-2222-2222-222222222222';
const T = '33333333-3333-3333-3333-333333333333'; // 선생님(인증된 이메일)
const FAKE = '44444444-4444-4444-4444-444444444444'; // 선생님 이메일이지만 미인증
const EMAILPW = '55555555-5555-5555-5555-555555555555'; // 선생님 이메일 + 인증됐지만 Google 로그인이 아님
let db: PGlite;

async function as<T>(uid: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
    return fn(tx);
  });
}
type Save = { status: string; revision: number; state?: unknown };
const save = (uid: string, state: unknown, rev: number) =>
  as(uid, async (tx) => (await tx.query<{ r: Save }>('select public.save_cg_progress($1::jsonb, $2) as r', [JSON.stringify(state), rev])).rows[0].r);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync('tests/db/supabase-shim.sql', 'utf8'));
  const m1 = readFileSync('supabase/migrations/20261001000000_sql_forest_v2.sql', 'utf8');
  const m2 = readFileSync('supabase/migrations/20261007000000_computer_general.sql', 'utf8');
  await db.exec(m1);
  await db.exec(m2);
  await db.exec(m2); // 재적용 안전(멱등)
  // 선생님 등록은 migration 밖에서(운영에서는 SQL Editor로) — 공개 저장소에 실제 이메일을 남기지 않는다
  await db.exec(`insert into private.teachers(email) values ('teacher@school.example') on conflict do nothing`);
  await db.query(
    `insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data) values
      ($1, 's1@gmail.com', now(), '{"full_name":"가온"}'),
      ($2, 's2@school.example', now(), '{"name":"나래"}'),
      ($3, 'Teacher@School.example', now(), '{"full_name":"선생님"}'),
      ($4, 'teacher@school.example.fake', null, '{}'),
      ($5, 'teacher@school.example.pw', now(), '{"full_name":"가짜 선생님"}')`,
    [S1, S2, T, FAKE, EMAILPW],
  );
  // 이메일·비밀번호로 가입해 인증까지 된 계정이 선생님 이메일을 쓰는 경우(Google identity 없음)
  await db.query(`update auth.users set email = 'teacher@school.example' where id = $1`, [EMAILPW]);
  // 이메일은 같지만 인증되지 않은 계정(가짜) — 선생님 목록 이메일로 바꿔 둔다
  await db.query(`update auth.users set email = 'teacher@school.example' where id = $1`, [FAKE]);
  // Google 로그인 identity(실제 Supabase가 만드는 것과 같은 형태)
  await db.query(
    `insert into auth.identities(user_id, provider, identity_data) values
      ($1, 'google', '{"email":"s1@gmail.com","full_name":"가온"}'),
      ($2, 'google', '{"email":"s2@school.example","name":"나래"}'),
      ($3, 'google', '{"email":"teacher@school.example","full_name":"선생님"}'),
      ($4, 'email', '{"email":"teacher@school.example"}')`,
    [S1, S2, T, EMAILPW],
  );
}, 60000);

describe('cg_progress: 본인 기록만', () => {
  it('저장(첫 저장 → revision 1, CAS 갱신 → 2)', async () => {
    expect(await save(S1, { v: 1, units: { U1: { lv1: true } } }, 0)).toEqual({ status: 'ok', revision: 1 });
    expect(await save(S1, { v: 1, units: { U1: { lv1: true, lv2: 26 } } }, 1)).toEqual({ status: 'ok', revision: 2 });
  });
  it('오래된 revision으로 저장하면 conflict와 서버본을 돌려준다(덮어쓰지 않음)', async () => {
    const r = await save(S1, { v: 1, units: {} }, 1);
    expect(r.status).toBe('conflict');
    expect(r.revision).toBe(2);
    expect(r.state).toEqual({ v: 1, units: { U1: { lv1: true, lv2: 26 } } });
  });
  it('다른 학생의 기록은 조회·수정·삭제 불가', async () => {
    await save(S2, { v: 1, units: { U3: { lv1: true } } }, 0);
    const seen = await as(S1, (tx) => tx.query<{ user_id: string }>('select user_id from public.cg_progress'));
    expect(seen.rows.map((r) => r.user_id)).toEqual([S1]);
    const upd = await as(S1, (tx) => tx.query(`update public.cg_progress set state = '{}' where user_id = $1`, [S2]));
    expect(upd.affectedRows).toBe(0);
    const del = await as(S1, (tx) => tx.query(`delete from public.cg_progress where user_id = $1`, [S2]));
    expect(del.affectedRows).toBe(0);
    await expect(as(S1, (tx) => tx.query(`insert into public.cg_progress(user_id, state) values ($1, '{}')`, [S2]))).rejects.toThrow(/row-level security/);
  });
  it('비로그인은 읽기·저장 모두 불가', async () => {
    await expect(as(null, (tx) => tx.query('select * from public.cg_progress'))).rejects.toThrow(/permission denied/);
    await expect(as(null, (tx) => tx.query(`select public.save_cg_progress('{}'::jsonb, 0)`))).rejects.toThrow(/permission denied/);
  });
  it('배열·너무 큰 기록은 거부', async () => {
    await expect(save(S2, [1, 2], 1)).rejects.toThrow(/check constraint/);
    await expect(save(S2, { big: 'x'.repeat(300000) }, 1)).rejects.toThrow(/check constraint/);
  });
  it('본인 기록 삭제 가능', async () => {
    const del = await as(S2, (tx) => tx.query('delete from public.cg_progress'));
    expect(del.affectedRows).toBe(1);
    await save(S2, { v: 1, units: { U3: { lv1: true } } }, 0);
  });
});

describe('선생님 반 학습 현황(읽기 전용)', () => {
  it('학생은 선생님이 아니고, 반 현황 RPC는 거부된다', async () => {
    expect((await as(S1, (tx) => tx.query<{ t: boolean }>('select public.am_i_teacher() as t'))).rows[0].t).toBe(false);
    await expect(as(S1, (tx) => tx.query('select * from public.cg_class_overview()'))).rejects.toThrow(/선생님 계정만/);
    await expect(as(S1, (tx) => tx.query('select * from public.db_class_overview()'))).rejects.toThrow(/선생님 계정만/);
  });
  it('목록 이메일이어도 이메일 미인증 계정은 선생님이 아니다', async () => {
    expect((await as(FAKE, (tx) => tx.query<{ t: boolean }>('select public.am_i_teacher() as t'))).rows[0].t).toBe(false);
    await expect(as(FAKE, (tx) => tx.query('select * from public.cg_class_overview()'))).rejects.toThrow(/선생님 계정만/);
  });
  it('이메일·비밀번호 가입 계정은 선생님 이메일이어도 선생님이 아니다(Google identity 필요)', async () => {
    expect((await as(EMAILPW, (tx) => tx.query<{ t: boolean }>('select public.am_i_teacher() as t'))).rows[0].t).toBe(false);
    await expect(as(EMAILPW, (tx) => tx.query('select * from public.db_class_overview()'))).rejects.toThrow(/선생님 계정만/);
  });
  it('학생이 user_metadata 이름을 바꿔도 반 현황에는 Google 이름이 나온다', async () => {
    await db.query(`update auth.users set raw_user_meta_data = '{"full_name":"선생님"}' where id = $1`, [S1]);
    const rows = (await as(T, (tx) => tx.query<{ user_id: string; name: string }>('select user_id, name from public.cg_class_overview()'))).rows;
    expect(rows.find((r) => r.user_id === S1)?.name).toBe('가온');
  });
  it('선생님(대소문자 무관, 인증됨)은 전체 기록을 이름·이메일과 함께 읽는다', async () => {
    expect((await as(T, (tx) => tx.query<{ t: boolean }>('select public.am_i_teacher() as t'))).rows[0].t).toBe(true);
    const rows = (await as(T, (tx) => tx.query<{ user_id: string; name: string; email: string; state: unknown }>('select user_id, name, email, state from public.cg_class_overview()'))).rows;
    const byId = Object.fromEntries(rows.map((r) => [r.user_id, r]));
    expect(byId[S1]).toMatchObject({ name: '가온', email: 's1@gmail.com' });
    expect(byId[S2]).toMatchObject({ name: '나래', email: 's2@school.example', state: { v: 1, units: { U3: { lv1: true } } } });
  });
  it('선생님도 학생 기록을 직접 수정·삭제할 수 없다(읽기만)', async () => {
    const upd = await as(T, (tx) => tx.query(`update public.cg_progress set state = '{}' where user_id = $1`, [S1]));
    expect(upd.affectedRows).toBe(0);
    const del = await as(T, (tx) => tx.query(`delete from public.cg_progress where user_id = $1`, [S1]));
    expect(del.affectedRows).toBe(0);
  });
  it('선생님 목록은 클라이언트에서 읽기·추가 불가', async () => {
    await expect(as(S1, (tx) => tx.query(`insert into private.teachers(email) values ('s1@gmail.com')`))).rejects.toThrow(/permission denied/);
    await expect(as(S1, (tx) => tx.query('select * from private.teachers'))).rejects.toThrow(/permission denied/);
    await expect(as(S1, (tx) => tx.query('select private.is_teacher()'))).rejects.toThrow(/permission denied/);
  });
  it('데이터베이스 과목 요약: XP 원장에서 계산', async () => {
    for (const id of ['activity:U01-A01', 'activity:U01-A02', 'checkpoint:U01-Q01']) await as(S1, (tx) => tx.query('select * from public.award_xp($1)', [id]));
    const rows = (await as(T, (tx) => tx.query<{ user_id: string; total_xp: number; activities: number; checkpoints: number; units: number }>('select * from public.db_class_overview()'))).rows;
    expect(rows.find((r) => r.user_id === S1)).toMatchObject({ total_xp: 250, activities: 2, checkpoints: 1, units: 0 });
  });
  it('비로그인은 선생님 RPC 실행 권한 자체가 없다', async () => {
    await expect(as(null, (tx) => tx.query('select * from public.cg_class_overview()'))).rejects.toThrow(/permission denied/);
    await expect(as(null, (tx) => tx.query('select public.am_i_teacher()'))).rejects.toThrow(/permission denied/);
  });
});
