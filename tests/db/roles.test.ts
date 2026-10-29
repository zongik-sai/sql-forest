import { readFileSync } from 'node:fs';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import fixture from '../fixtures/student-emails.json';

/**
 * 계정 구분(학번 형식)·계정 목록·관리자(교사 권한 지정·해제)·권한 변경 기록(20261029000000_roles.sql)을 실제 Postgres 엔진(PGlite)에서 검사한다.
 * Supabase 방식(authenticated 역할 + JWT sub)을 흉내 내며, 실제 Supabase 프로젝트 검증은 별도. 모든 이메일은 가짜.
 * PGlite는 연결이 하나라 두 관리자의 진짜 동시 실행(advisory lock 경합)이나 '확인과 잠금 사이에 권한이 바뀌는' 끼어들기를 재현하지 못한다.
 * 그래서 권한 변경 RPC는 잠금을 먼저 얻고 그 뒤에 한 번만 관리자 확인을 하도록 만들었고(잠금 전 확인 없음),
 * 이 파일은 (1) 그 확인을 빼면 실패하는 거부 시험과 (2) 함수 본문에서 확인이 잠금 뒤에만 있는지를 함께 검사한다.
 */
const ADMIN = 'a0000000-0000-4000-8000-000000000001'; // 처음 적용 때 교사 목록에 있던 선생님 → 관리자
const T2 = 'a0000000-0000-4000-8000-000000000002'; // 나중에 SQL로 넣은 선생님(관리자 아님)
const S1 = 'a0000000-0000-4000-8000-000000000003'; // 학생(cg_progress 있음)
const S2 = 'a0000000-0000-4000-8000-000000000004'; // 학생(course_progress 있음)
const SFLAG = 'a0000000-0000-4000-8000-000000000005'; // 학생인데 교사 목록에 잘못 들어 있던 계정
const NEWT = 'a0000000-0000-4000-8000-000000000006'; // 학교 계정, 학번 형식 아님(아직 등록 안 된 선생님)
const OUTSIDE = 'a0000000-0000-4000-8000-000000000007'; // 학교 밖 Google 계정
const EMAILPW = 'a0000000-0000-4000-8000-000000000008'; // 이메일·비밀번호 가입(Google 아님)
const UNVER = 'a0000000-0000-4000-8000-000000000009'; // 이메일 미인증
const STUNOG = 'a0000000-0000-4000-8000-00000000000a'; // 학번 형식이지만 Google 아님
const FAKEADMIN = 'a0000000-0000-4000-8000-00000000000b'; // 관리자 이메일이지만 미인증
const PWADMIN = 'a0000000-0000-4000-8000-00000000000c'; // 관리자 이메일 + 인증됐지만 Google 아님
const NOBODY = 'a0000000-0000-4000-8000-0000000000ff';
const GID = 'a0000000-0000-4000-8000-00000000000d'; // 계정 이메일과 Google 로그인 이메일이 다른 계정(예전 선생님 이메일)
const KELVIN = 'a0000000-0000-4000-8000-00000000000e'; // 도메인의 k가 켈빈 기호: 저장값은 학번 형식이 아니지만 lower()하면 학번 형식

const MIGRATIONS = ['20261001000000_sql_forest_v2.sql', '20261007000000_computer_general.sql', '20261015000000_unit_reset.sql',
  '20261016000000_unit_reset_stages.sql', '20261026000000_courses.sql', '20261026010000_monitoring.sql'];
const ROLES = readFileSync('supabase/migrations/20261029000000_roles.sql', 'utf8');
const SHIM = readFileSync('tests/db/supabase-shim.sql', 'utf8');

let db: PGlite;
const warnings: string[] = [];

async function as<R>(uid: string | null, fn: (tx: Transaction) => Promise<R>, on: PGlite = db): Promise<R> {
  return on.transaction(async (tx) => {
    await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
    return fn(tx);
  });
}
const one = async <T,>(uid: string | null, sql: string, params: unknown[] = [], on: PGlite = db) => as(uid, async (tx) => (await tx.query<T>(sql, params)).rows[0], on);
const amAdmin = async (uid: string, on: PGlite = db) => (await one<{ a: boolean }>(uid, 'select public.am_i_admin() as a', [], on)).a;
const amTeacher = async (uid: string, on: PGlite = db) => (await one<{ t: boolean }>(uid, 'select public.am_i_teacher() as t', [], on)).t;
const setTeacher = async (uid: string, target: string, on: boolean, d: PGlite = db) => (await one<{ c: boolean }>(uid, 'select public.set_teacher($1, $2) as c', [target, on], d)).c;
const setAdmin = async (uid: string, target: string, on: boolean, d: PGlite = db) => (await one<{ c: boolean }>(uid, 'select public.set_admin($1, $2) as c', [target, on], d)).c;
interface Acc { user_id: string | null; email: string; name: string | null; google: boolean; email_verified: boolean; created_at: string | Date | null; last_sign_in_at: string | Date | null; kind: string; student_year: number | null; student_no: string | null; has_progress: boolean; listed_as: string | null }
const accounts = (uid: string, d: PGlite = db) => as(uid, async (tx) => (await tx.query<Acc>('select * from public.account_list()')).rows, d);
interface Audit { at: Date; actor: string | null; actor_email: string | null; actor_name: string | null; target: string | null; target_email: string; target_name: string | null; action: string; note: string | null }
const revokeListed = async (uid: string, email: string, d: PGlite = db) => (await one<{ c: boolean }>(uid, 'select public.revoke_listed_email($1) as c', [email], d)).c;
const audit = (uid: string, limit?: number | null, d: PGlite = db) =>
  as(uid, async (tx) => (await tx.query<Audit>(limit === undefined ? 'select * from public.role_audit_list()' : 'select * from public.role_audit_list($1)', limit === undefined ? [] : [limit])).rows, d);
const lists = async (d: PGlite = db) => ({
  teachers: (await d.query<{ email: string }>('select email from private.teachers')).rows.map((r) => r.email).sort(),
  admins: (await d.query<{ email: string }>('select email from private.admins')).rows.map((r) => r.email).sort(),
});

/** 가짜 계정(이메일, 인증 여부, Google identity 이메일 또는 'email' provider) */
async function addUser(d: PGlite, id: string, email: string, o: { verified?: boolean; google?: string | null; provider?: string; name?: string; signIn?: string } = {}) {
  await d.query(`insert into auth.users(id, email, email_confirmed_at, created_at, last_sign_in_at) values ($1, $2, $3, $4, $5)`,
    [id, email, o.verified === false ? null : '2026-10-01T00:00:00Z', '2026-09-01T00:00:00Z', o.signIn ?? null]);
  const provider = o.provider ?? 'google';
  const idEmail = o.google === undefined ? email : o.google;
  if (idEmail !== null) {
    await d.query(`insert into auth.identities(user_id, provider, identity_data) values ($1, $2, $3::jsonb)`,
      [id, provider, JSON.stringify({ email: idEmail, ...(o.name ? { full_name: o.name } : {}) })]);
  }
}

async function freshDb(files = MIGRATIONS): Promise<PGlite> {
  const d = new PGlite();
  await d.exec(SHIM);
  for (const f of files) await d.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
  return d;
}

beforeAll(async () => {
  db = await freshDb();
  // 운영자가 SQL Editor로 넣은 교사 목록(잘못 넣은 학생 계정 하나 포함) — 이 상태에서 처음 적용
  await db.exec(`insert into private.teachers(email) values ('teacher@example.com'), ('sai_209699999@seoulai.sen.hs.kr') on conflict do nothing`);
  await addUser(db, ADMIN, 'Teacher@Example.com', { name: '김관리', google: 'teacher@example.com', signIn: '2026-10-29T08:00:00Z' });
  await addUser(db, T2, 'teacher2@example.com', { name: '이선생' });
  await addUser(db, S1, 'sai_209610101@seoulai.sen.hs.kr', { name: '가온', signIn: '2026-10-28T09:00:00Z' });
  await addUser(db, S2, 'SAI_209610102@seoulai.sen.hs.kr', { name: '나래', google: 'sai_209610102@seoulai.sen.hs.kr' });
  await addUser(db, SFLAG, 'sai_209699999@seoulai.sen.hs.kr', { name: '잘못 등록된 학생' });
  await addUser(db, NEWT, 'example.newteacher@seoulai.sen.hs.kr', { name: '박선생' });
  await addUser(db, OUTSIDE, 'outside@example.org', { name: '바깥' });
  await addUser(db, EMAILPW, 'example.pw@seoulai.sen.hs.kr', { provider: 'email' });
  await addUser(db, UNVER, 'example.unverified@seoulai.sen.hs.kr', { verified: false, name: '미인증' });
  await addUser(db, STUNOG, 'sai_209610103@seoulai.sen.hs.kr', { provider: 'email' });
  await addUser(db, FAKEADMIN, 'teacher@example.com', { verified: false });
  await addUser(db, PWADMIN, 'teacher@example.com', { provider: 'email' });
  await db.exec(ROLES, { onNotice: (n) => warnings.push(`${n.severity}: ${n.message}`) });
  await db.exec(ROLES); // 재적용 안전(멱등)
  // 처음 적용 뒤 SQL Editor로 넣은 선생님(관리자 복사는 한 번만이므로 관리자가 아님)
  await db.exec(`insert into private.teachers(email) values ('teacher2@example.com')`);
  await db.exec(ROLES);
  // 학습 기록
  await as(S1, (tx) => tx.query(`select public.save_cg_progress('{"v":1}'::jsonb, 0)`));
  await as(S2, (tx) => tx.query(`select public.save_course_progress('net', '{"v":1}'::jsonb, 0)`));
}, 60000);

describe('학생 계정(학번 형식) 판정: TS와 같은 시험 자료', () => {
  it('private.student_id가 공통 시험 자료와 모두 같다', async () => {
    for (const v of fixture.vectors) {
      const r = await db.query<{ id: string | null }>('select private.student_id($1) as id', [v.email]);
      expect(r.rows[0].id, `${JSON.stringify(v.email)} (${v.why})`).toBe(v.id);
    }
  });
  it('IMMUTABLE이고 클라이언트가 직접 부를 수 없다', async () => {
    const r = await db.query<{ v: string }>(`select provolatile as v from pg_proc where oid = 'private.student_id(text)'::regprocedure`);
    expect(r.rows[0].v).toBe('i');
    await expect(as(S1, (tx) => tx.query(`select private.student_id('sai_209610101@seoulai.sen.hs.kr')`))).rejects.toThrow(/permission denied/);
    await expect(as(ADMIN, (tx) => tx.query(`select private.is_admin()`))).rejects.toThrow(/permission denied/);
    await expect(as(ADMIN, (tx) => tx.query(`select private.admins_left('{x}'::text[])`))).rejects.toThrow(/permission denied/);
    await expect(as(ADMIN, (tx) => tx.query(`select private.is_student_email('x')`))).rejects.toThrow(/permission denied/);
    await expect(as(ADMIN, (tx) => tx.query(`select private.user_emails($1)`, [ADMIN]))).rejects.toThrow(/permission denied/);
  });
  it('교사 제외 판정은 저장값과 lower() 둘 다 본다(켈빈 기호 k)', async () => {
    const e = 'sai_209610199@seoulai.sen.hs.\u212Ar';
    const r = await db.query<{ sid: string | null; low: string | null; stu: boolean }>(
      'select private.student_id($1) as sid, private.student_id(lower($1)) as low, private.is_student_email($1) as stu', [e]);
    expect(r.rows[0]).toEqual({ sid: null, low: '209610199', stu: true });
  });
});

describe('이 migration의 함수 권한(proacl)', () => {
  it('이 migration이 만들거나 바꾼 private 함수는 모두 public·anon·authenticated 실행 권한이 없다(pg_proc에서 모두 찾아 확인)', async () => {
    const d = await freshDb();
    type P = { oid: number; proname: string; sig: string; has_acl: boolean; anon: boolean; auth: boolean; pub: boolean };
    const q = `select p.oid::int as oid, p.proname, p.oid::regprocedure::text as sig, p.proacl is not null as has_acl,
                      has_function_privilege('anon', p.oid, 'EXECUTE') as anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
                      coalesce((select bool_or(x.grantee = 0) from aclexplode(p.proacl) x where x.privilege_type = 'EXECUTE'), false) as pub
               from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private'`;
    const before = new Set((await d.query<P>(q)).rows.map((r) => r.oid));
    await d.exec(ROLES);
    await d.exec(ROLES);
    const after = (await d.query<P>(q)).rows;
    const named = new Set([...ROLES.matchAll(/create or replace function private\.(\w+)\(/g)].map((m) => m[1]));
    const mine = after.filter((r) => !before.has(r.oid) || named.has(r.proname));
    expect(new Set(mine.map((r) => r.proname))).toEqual(named);
    expect(mine).toHaveLength(named.size); // 이름마다 함수 하나(예전 admins_left(text)는 지움)
    for (const r of mine) expect({ sig: r.sig, has_acl: r.has_acl, anon: r.anon, auth: r.auth, pub: r.pub }).toEqual({ sig: r.sig, has_acl: true, anon: false, auth: false, pub: false });
    // 이 schema의 다른 함수도 마찬가지(authenticated는 invoker RPC가 쓰는 require_uid만)
    for (const r of after) {
      expect({ sig: r.sig, anon: r.anon, pub: r.pub, auth: r.auth }).toEqual({ sig: r.sig, anon: false, pub: false, auth: r.proname === 'require_uid' });
    }
    await d.close();
  });
  it('권한 변경 RPC는 잠금을 먼저 얻고, 관리자 확인은 잠금 뒤에 한 번만 한다', async () => {
    for (const fn of ['public.set_teacher(uuid,boolean)', 'public.set_admin(uuid,boolean)', 'public.revoke_listed_email(text)']) {
      const src = (await db.query<{ s: string }>(`select prosrc as s from pg_proc where oid = $1::regprocedure`, [fn])).rows[0].s;
      const lock = src.indexOf('pg_advisory_xact_lock(');
      const check = src.indexOf('private.is_admin_uid(v_uid)');
      expect(lock, fn).toBeGreaterThan(-1);
      expect(check, fn).toBeGreaterThan(lock);
      expect(src.slice(0, lock), fn).not.toMatch(/is_admin|is_teacher/);
    }
    // 이 파일의 RPC는 private.is_teacher()/is_admin()(예전 migration이 바꿀 수 있는 함수)을 쓰지 않는다
    for (const fn of ['public.account_list()', 'public.role_audit_list(integer)', 'public.am_i_admin()', 'public.set_teacher(uuid,boolean)', 'public.set_admin(uuid,boolean)', 'public.revoke_listed_email(text)']) {
      const src = (await db.query<{ s: string }>(`select prosrc as s from pg_proc where oid = $1::regprocedure`, [fn])).rows[0].s;
      expect(src, fn).not.toMatch(/private\.is_teacher\(\)|private\.is_admin\(\)/);
    }
  });
});

describe('처음 적용: 학번 형식 행 정리 · 관리자 복사', () => {
  it('교사 목록이 관리자 목록으로 한 번 복사됐다(학번 형식 행은 지움), 나중에 넣은 선생님은 관리자가 아니다', async () => {
    expect(await lists()).toEqual({
      teachers: ['teacher2@example.com', 'teacher@example.com'],
      admins: ['teacher@example.com'],
    });
    expect(await amAdmin(ADMIN)).toBe(true);
    expect(await amTeacher(T2)).toBe(true);
    expect(await amAdmin(T2)).toBe(false);
  });
  it('이미 있던 학번 형식 교사 행은 migration이 지우고(경고·기록) 제약을 바로 검사해서 건다(NOT VALID 없음)', async () => {
    expect(warnings.some((w) => /WARNING/.test(w) && /교사 목록에서 1개, 관리자 목록에서 0개의 학생 계정/.test(w))).toBe(true);
    expect(await amTeacher(SFLAG)).toBe(false);
    expect(await amAdmin(SFLAG)).toBe(false);
    await expect(as(SFLAG, (tx) => tx.query('select * from public.cg_class_overview()'))).rejects.toThrow(/선생님 계정만/);
    const c = await db.query<{ conname: string; convalidated: boolean }>(
      `select conname, convalidated from pg_constraint where conname in ('teachers_not_student', 'admins_not_student') order by conname`);
    expect(c.rows).toEqual([{ conname: 'admins_not_student', convalidated: true }, { conname: 'teachers_not_student', convalidated: true }]);
    const auto = await db.query<{ actor: string | null; target: string | null; target_email: string; action: string; note: string }>(
      `select actor, target, target_email, action, note from private.role_audit where note like '%학생 계정%'`);
    expect(auto.rows).toEqual([{ actor: null, target: SFLAG, target_email: 'sai_209699999@seoulai.sen.hs.kr', action: 'revoke_teacher', note: '학생 계정(학번 형식)이라 migration이 자동으로 지움' }]);
  });
  it('새로 넣는 학번 형식 이메일은 표 제약이 막는다(SQL Editor로 넣어도)', async () => {
    await expect(db.exec(`insert into private.teachers(email) values ('sai_209610101@seoulai.sen.hs.kr')`)).rejects.toThrow(/teachers_not_student/);
    await expect(db.exec(`insert into private.admins(email) values ('sai_209610101@seoulai.sen.hs.kr')`)).rejects.toThrow(/admins_not_student/);
    await expect(db.exec(`insert into private.admins(email) values ('x209510101@seoulai.sen.hs.kr')`)).rejects.toThrow(/admins_not_student/);
    // 학교 계정이어도 학번 형식이 아니면 넣을 수 있다
    await db.exec(`insert into private.admins(email) values ('example.nobody@seoulai.sen.hs.kr')`);
    await db.exec(`delete from private.admins where email = 'example.nobody@seoulai.sen.hs.kr'`);
  });
});

describe('권한 없는 사용자', () => {
  it('비로그인은 모든 RPC 실행 권한이 없다', async () => {
    for (const sql of ['select public.am_i_admin()', 'select * from public.account_list()', `select public.set_teacher('${S1}', true)`,
      `select public.set_admin('${S1}', true)`, 'select * from public.role_audit_list()', 'select * from public.role_audit_list(10)']) {
      await expect(as(null, (tx) => tx.query(sql)), sql).rejects.toThrow(/permission denied/);
    }
  });
  it('학생은 목록·기록을 볼 수 없고 권한을 바꿀 수 없다', async () => {
    expect(await amAdmin(S1)).toBe(false);
    await expect(accounts(S1)).rejects.toThrow(/선생님 계정만/);
    await expect(audit(S1)).rejects.toThrow(/선생님 계정만/);
    await expect(setTeacher(S1, S1, true)).rejects.toThrow(/관리자만/);
    await expect(setTeacher(S1, ADMIN, false)).rejects.toThrow(/관리자만/);
    await expect(setAdmin(S1, S1, true)).rejects.toThrow(/관리자만/);
  });
  it('관리자 목록·기록 표는 클라이언트가 직접 읽거나 쓸 수 없다', async () => {
    await expect(as(ADMIN, (tx) => tx.query('select * from private.admins'))).rejects.toThrow(/permission denied/);
    await expect(as(ADMIN, (tx) => tx.query(`insert into private.admins(email) values ('x@example.com')`))).rejects.toThrow(/permission denied/);
    await expect(as(ADMIN, (tx) => tx.query('select * from private.role_audit'))).rejects.toThrow(/permission denied/);
    await expect(as(ADMIN, (tx) => tx.query('select * from private.role_flags'))).rejects.toThrow(/permission denied/);
  });
  it('관리자 이메일이어도 이메일 미인증·Google 아님이면 관리자(선생님)가 아니다', async () => {
    expect(await amAdmin(FAKEADMIN)).toBe(false);
    expect(await amAdmin(PWADMIN)).toBe(false);
    expect(await amTeacher(PWADMIN)).toBe(false);
    await expect(setTeacher(FAKEADMIN, NEWT, true)).rejects.toThrow(/관리자만/);
    await expect(setTeacher(PWADMIN, NEWT, true)).rejects.toThrow(/관리자만/);
    await expect(accounts(PWADMIN)).rejects.toThrow(/선생님 계정만/);
  });
});

describe('계정 목록(선생님 읽기 전용)', () => {
  it('관리자 아닌 선생님도 모든 계정을 구분·학번·학습 기록 유무와 함께 본다', async () => {
    const rows = await accounts(T2);
    const by = Object.fromEntries(rows.map((r) => [r.user_id, r]));
    expect(rows).toHaveLength(12);
    expect(by[ADMIN]).toMatchObject({ kind: 'admin', name: '김관리', email: 'Teacher@Example.com', google: true, email_verified: true, student_year: null, student_no: null, has_progress: false });
    expect(by[T2]).toMatchObject({ kind: 'teacher', name: '이선생' });
    expect(by[S1]).toMatchObject({ kind: 'student', name: '가온', student_year: 2096, student_no: '10101', has_progress: true, google: true, listed_as: null });
    expect(by[ADMIN].listed_as).toBe('admin');
    expect(by[T2]).toMatchObject({ listed_as: 'teacher' });
    // 관리자 이메일을 쓰지만 권한이 없는 계정: 구분은 확인 필요, 목록 등록은 보임
    expect(by[FAKEADMIN]).toMatchObject({ kind: 'unknown', listed_as: 'admin' });
    expect(by[S2]).toMatchObject({ kind: 'student', student_year: 2096, student_no: '10102', has_progress: true });
    expect(by[SFLAG]).toMatchObject({ kind: 'student', student_no: '99999', has_progress: false });
    expect(by[NEWT]).toMatchObject({ kind: 'unknown', google: true, email_verified: true });
    expect(by[OUTSIDE]).toMatchObject({ kind: 'unknown', google: true });
    expect(by[EMAILPW]).toMatchObject({ kind: 'unknown', google: false, email_verified: true });
    expect(by[UNVER]).toMatchObject({ kind: 'unknown', google: true, email_verified: false });
    expect(by[STUNOG]).toMatchObject({ kind: 'unknown', google: false, student_year: 2096, student_no: '10103' });
    expect(by[FAKEADMIN]).toMatchObject({ kind: 'unknown', email_verified: false });
    expect(by[PWADMIN]).toMatchObject({ kind: 'unknown', google: false });
    expect(new Date(by[S1].last_sign_in_at as string).toISOString()).toBe('2026-10-28T09:00:00.000Z');
    expect(new Date(by[S1].created_at as string).toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });
  it('순서: 확인 필요 → 관리자 → 교사 → 학생, 학생은 학번순', async () => {
    const rows = await accounts(ADMIN);
    const kinds = rows.map((r) => r.kind);
    const rank = ['unknown', 'listed', 'admin', 'teacher', 'student'];
    expect(kinds).toEqual([...kinds].sort((a, b) => rank.indexOf(a) - rank.indexOf(b)));
    expect(rows.filter((r) => r.kind === 'student').map((r) => r.student_no)).toEqual(['10101', '10102', '99999']);
  });
  it('데이터베이스 과목 학습 상태 스냅샷(learner_state)도 학습 기록으로 센다', async () => {
    await as(T2, (tx) => tx.query(`select public.save_learner_state('{"v":1}'::jsonb)`));
    expect((await accounts(T2)).find((r) => r.user_id === T2)?.has_progress).toBe(true);
  });
});

describe('관리자: 교사·관리자 지정과 해제', () => {
  it('관리자 아닌 선생님은 바꿀 수 없다', async () => {
    await expect(setTeacher(T2, NEWT, true)).rejects.toThrow(/관리자만/);
    await expect(setAdmin(T2, T2, true)).rejects.toThrow(/관리자만/);
    expect((await lists()).teachers).not.toContain('example.newteacher@seoulai.sen.hs.kr');
  });
  it('학생 계정(학번 형식)은 교사·관리자로 지정할 수 없다(Google·인증이 있어도)', async () => {
    await expect(setTeacher(ADMIN, S1, true)).rejects.toThrow(/학생 계정\(학번 형식\)은 교사로/);
    await expect(setTeacher(ADMIN, S2, true)).rejects.toThrow(/학생 계정/); // 대문자 이메일도
    await expect(setTeacher(ADMIN, STUNOG, true)).rejects.toThrow(/학생 계정/);
    await expect(setAdmin(ADMIN, S1, true)).rejects.toThrow(/학생 계정\(학번 형식\)은 관리자로/);
    await expect(setAdmin(ADMIN, SFLAG, true)).rejects.toThrow(/학생 계정/);
  });
  it('Google 로그인이 아니거나 이메일 미인증이면 교사로 지정할 수 없다, 없는 계정·빈 인자도 거부', async () => {
    await expect(setTeacher(ADMIN, EMAILPW, true)).rejects.toThrow(/Google로 로그인한 계정만/);
    await expect(setTeacher(ADMIN, UNVER, true)).rejects.toThrow(/이메일이 인증되지 않은/);
    await expect(setTeacher(ADMIN, NOBODY, true)).rejects.toThrow(/계정을 찾을 수 없어요/);
    await expect(as(ADMIN, (tx) => tx.query('select public.set_teacher(null, true)'))).rejects.toThrow(/정해 주세요/);
    await expect(as(ADMIN, (tx) => tx.query('select public.set_admin($1, null)', [NEWT]))).rejects.toThrow(/정해 주세요/);
    expect((await lists()).teachers).toEqual(['teacher2@example.com', 'teacher@example.com']);
  });
  it('관리자 지정은 이미 교사인 계정만', async () => {
    await expect(setAdmin(ADMIN, NEWT, true)).rejects.toThrow(/먼저 교사로 지정/);
    await expect(setAdmin(ADMIN, OUTSIDE, true)).rejects.toThrow(/먼저 교사로 지정/);
  });
  it('교사 지정 → 그 계정이 바로 선생님, 같은 지정을 또 하면 바뀐 것 없음(false, 기록 없음)', async () => {
    expect(await amTeacher(NEWT)).toBe(false);
    expect(await setTeacher(ADMIN, NEWT, true)).toBe(true);
    expect(await amTeacher(NEWT)).toBe(true);
    expect(await amAdmin(NEWT)).toBe(false);
    expect(await setTeacher(ADMIN, NEWT, true)).toBe(false);
    expect((await lists()).teachers).toContain('example.newteacher@seoulai.sen.hs.kr');
  });
  it('관리자 지정 → 그 계정이 권한을 바꿀 수 있다', async () => {
    expect(await setAdmin(ADMIN, NEWT, true)).toBe(true);
    expect(await setAdmin(ADMIN, NEWT, true)).toBe(false);
    expect(await amAdmin(NEWT)).toBe(true);
    expect(await setTeacher(NEWT, OUTSIDE, true)).toBe(true);
    expect((await accounts(NEWT)).find((r) => r.user_id === OUTSIDE)?.kind).toBe('teacher');
  });
  it('관리자 해제는 교사 권한을 남기고, 교사 해제는 관리자 권한도 함께 지운다', async () => {
    expect(await setAdmin(ADMIN, NEWT, false)).toBe(true);
    expect(await amAdmin(NEWT)).toBe(false);
    expect(await amTeacher(NEWT)).toBe(true);
    expect(await setAdmin(ADMIN, NEWT, false)).toBe(false); // 이미 관리자 아님
    await setAdmin(ADMIN, NEWT, true);
    expect(await setTeacher(ADMIN, NEWT, false)).toBe(true);
    expect(await amTeacher(NEWT)).toBe(false);
    expect(await amAdmin(NEWT)).toBe(false);
    expect(await lists()).toMatchObject({ admins: ['teacher@example.com'] });
    expect((await lists()).teachers).not.toContain('example.newteacher@seoulai.sen.hs.kr');
    expect(await setTeacher(ADMIN, NEWT, false)).toBe(false);
  });
  it('migration이 이미 지운 학번 형식 교사 행은 다시 해제할 것이 없다', async () => {
    expect(await setTeacher(ADMIN, SFLAG, false)).toBe(false);
    expect((await lists()).teachers).not.toContain('sai_209699999@seoulai.sen.hs.kr');
  });
  it('lower()하면 학번 형식이 되는 이메일(켈빈 기호 k)도 학생 계정으로 보고 거부한다', async () => {
    await addUser(db, KELVIN, 'sai_209610199@seoulai.sen.hs.\u212Ar', { name: '흉내' });
    await expect(setTeacher(ADMIN, KELVIN, true)).rejects.toThrow(/학생 계정\(학번 형식\)은 교사로/);
    await db.query('delete from auth.users where id = $1', [KELVIN]);
  });
});

describe('마지막 관리자 보호', () => {
  it('관리자가 한 명이면 자기 자신의 관리자·교사 권한을 해제할 수 없다', async () => {
    expect(await lists()).toMatchObject({ admins: ['teacher@example.com'] });
    await expect(setAdmin(ADMIN, ADMIN, false)).rejects.toThrow(/마지막 관리자/);
    await expect(setTeacher(ADMIN, ADMIN, false)).rejects.toThrow(/마지막 관리자/);
    // 같은 이메일의 다른(권한 없는) 계정을 골라도 그 이메일의 관리자 행을 지우게 되므로 거부
    await expect(setTeacher(ADMIN, PWADMIN, false)).rejects.toThrow(/마지막 관리자/);
    await expect(setAdmin(ADMIN, FAKEADMIN, false)).rejects.toThrow(/마지막 관리자/);
    expect(await amAdmin(ADMIN)).toBe(true);
  });
  it('관리자가 둘이면 자기 자신을 해제할 수 있고, 남은 한 명은 다시 보호된다', async () => {
    await setTeacher(ADMIN, NEWT, true);
    await setAdmin(ADMIN, NEWT, true);
    expect(await setAdmin(ADMIN, ADMIN, false)).toBe(true);
    expect(await amAdmin(ADMIN)).toBe(false);
    expect(await amTeacher(ADMIN)).toBe(true);
    await expect(setAdmin(NEWT, NEWT, false)).rejects.toThrow(/마지막 관리자/);
    await expect(setTeacher(NEWT, NEWT, false)).rejects.toThrow(/마지막 관리자/);
  });
  it('두 관리자가 서로를 해제하면 두 번째 해제는 거부된다(이미 관리자가 아님)', async () => {
    await setAdmin(NEWT, ADMIN, true);
    expect(await setAdmin(ADMIN, NEWT, false)).toBe(true);
    await expect(setAdmin(NEWT, ADMIN, false)).rejects.toThrow(/관리자만/);
    expect(await amAdmin(ADMIN)).toBe(true);
    expect((await lists()).admins).toEqual(['teacher@example.com']);
  });
  it('관리자 목록의 이메일이라도 권한이 살아 있지 않으면(로그인한 적 없음) 관리자 수에 넣지 않는다', async () => {
    await db.exec(`insert into private.teachers(email) values ('ghost@example.com'); insert into private.admins(email) values ('ghost@example.com')`);
    await expect(setAdmin(ADMIN, ADMIN, false)).rejects.toThrow(/마지막 관리자/);
    await db.exec(`delete from private.admins where email = 'ghost@example.com'; delete from private.teachers where email = 'ghost@example.com'`);
  });
});

describe('권한 변경 기록', () => {
  it('모든 변경이 최근 순으로 남고 선생님(관리자 아님 포함)이 읽는다', async () => {
    const rows = await audit(T2);
    expect(rows.length).toBeGreaterThanOrEqual(10);
    const last = rows[0];
    expect(last).toMatchObject({ actor: ADMIN, actor_email: 'teacher@example.com', actor_name: '김관리', target: NEWT, target_email: 'example.newteacher@seoulai.sen.hs.kr', target_name: '박선생', action: 'revoke_admin' });
    // 처음 적용 때 자동 복사도 남는다(누가: 없음, 비고). 같은 이메일 계정이 여럿이면 권한이 살아 있는 계정을 대상으로
    const boot = rows.find((r) => r.note === '처음 적용 때 교사 목록에서 자동 복사');
    expect(boot).toMatchObject({ actor: null, actor_email: null, actor_name: null, target: ADMIN, target_name: '김관리', target_email: 'teacher@example.com', action: 'grant_admin' });
    expect(rows.find((r) => r.note?.includes('학생 계정'))).toMatchObject({ actor: null, target: SFLAG, action: 'revoke_teacher' });
    const actions = rows.map((r) => r.action);
    for (const a of ['grant_teacher', 'revoke_teacher', 'grant_admin', 'revoke_admin']) expect(actions).toContain(a);
    // 교사 해제(관리자였던 계정)는 관리자 해제 + 교사 해제 두 줄
    const t = rows.filter((r) => r.target === NEWT).map((r) => r.action);
    expect(t).toContain('revoke_teacher');
    // 최근 순(같은 시각이면 나중에 쓴 것 먼저)
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].at.getTime()).toBeGreaterThanOrEqual(rows[i].at.getTime());
  });
  it('조회 개수는 1~200, 학생·비로그인은 읽을 수 없다', async () => {
    expect(await audit(ADMIN, 1)).toHaveLength(1);
    await expect(audit(ADMIN, 0)).rejects.toThrow(/1~200/);
    await expect(audit(ADMIN, 201)).rejects.toThrow(/1~200/);
    await expect(audit(ADMIN, null)).rejects.toThrow(/1~200/);
    await expect(audit(S1, 10)).rejects.toThrow(/선생님 계정만/);
  });
  it('바뀐 것이 없는 호출·거부된 호출은 기록하지 않는다', async () => {
    const n = (await db.query<{ n: number }>('select count(*)::int as n from private.role_audit')).rows[0].n;
    expect(await setTeacher(ADMIN, OUTSIDE, true)).toBe(false);
    await expect(setTeacher(ADMIN, S1, true)).rejects.toThrow();
    await expect(setTeacher(T2, NEWT, true)).rejects.toThrow();
    expect((await db.query<{ n: number }>('select count(*)::int as n from private.role_audit')).rows[0].n).toBe(n);
  });
});

describe('목록에만 있는 이메일 · 이메일이 여러 개인 계정', () => {
  beforeAll(async () => {
    // 계정 이메일을 바꾼 예전 선생님: 목록에는 Google 로그인 이메일(예전 이메일)이 남아 있음
    await addUser(db, GID, 'changed.teacher@example.org', { name: '정선생', google: 'former.teacher@example.com' });
    await db.exec(`insert into private.teachers(email) values ('former.teacher@example.com'), ('old.teacher@example.com');
                   insert into private.admins(email) values ('former.teacher@example.com')`);
  });
  it('목록에만 있는 이메일은 kind listed(계정 없음)로, 그 이메일이 묶인 계정은 listed_as로 보인다', async () => {
    const rows = await accounts(T2);
    const listed = rows.filter((r) => r.kind === 'listed');
    expect(listed).toEqual([
      expect.objectContaining({ user_id: null, email: 'former.teacher@example.com', name: null, kind: 'listed', listed_as: 'admin', google: false, email_verified: false, has_progress: false }),
      expect.objectContaining({ user_id: null, email: 'old.teacher@example.com', kind: 'listed', listed_as: 'teacher' }),
    ]);
    expect(rows.find((r) => r.user_id === GID)).toMatchObject({ kind: 'unknown', listed_as: 'admin', email: 'changed.teacher@example.org' });
    // 순서: 확인 필요 → 등록만 됨 → …
    const kinds = rows.map((r) => r.kind);
    expect(kinds.indexOf('listed')).toBeGreaterThan(kinds.lastIndexOf('unknown'));
    expect(kinds.lastIndexOf('listed')).toBeLessThan(kinds.indexOf('admin'));
  });
  it('계정 단위 해제는 그 계정의 Google 로그인 이메일 항목까지 지운다', async () => {
    expect(await setAdmin(ADMIN, GID, false)).toBe(true);
    expect((await lists()).admins).toEqual(['teacher@example.com']);
    expect(await setTeacher(ADMIN, GID, false)).toBe(true);
    expect((await lists()).teachers).not.toContain('former.teacher@example.com');
    const a = await audit(T2, 2);
    expect(a.map((r) => [r.action, r.target, r.target_email])).toEqual([['revoke_teacher', GID, 'former.teacher@example.com'], ['revoke_admin', GID, 'former.teacher@example.com']]);
    expect(await setTeacher(ADMIN, GID, false)).toBe(false);
  });
  it('이메일로 해제(revoke_listed_email): 관리자만, 대소문자·공백 무관, 기록, 없는 이메일은 false', async () => {
    await expect(as(null, (tx) => tx.query(`select public.revoke_listed_email('old.teacher@example.com')`))).rejects.toThrow(/permission denied/);
    await expect(revokeListed(S1, 'old.teacher@example.com')).rejects.toThrow(/관리자만/);
    await expect(revokeListed(T2, 'old.teacher@example.com')).rejects.toThrow(/관리자만/);
    await expect(revokeListed(ADMIN, '  ')).rejects.toThrow(/이메일을 정해 주세요/);
    expect(await revokeListed(ADMIN, '  Old.Teacher@Example.com ')).toBe(true);
    expect((await lists()).teachers).not.toContain('old.teacher@example.com');
    expect((await audit(T2, 1))[0]).toMatchObject({ actor: ADMIN, target: null, target_email: 'old.teacher@example.com', action: 'revoke_teacher', note: '목록의 이메일로 해제' });
    expect(await revokeListed(ADMIN, 'old.teacher@example.com')).toBe(false);
    expect((await accounts(T2)).filter((r) => r.kind === 'listed')).toEqual([]);
  });
  it('이메일로 해제도 마지막 관리자는 지울 수 없다', async () => {
    expect((await lists()).admins).toEqual(['teacher@example.com']);
    await expect(revokeListed(ADMIN, 'TEACHER@example.com')).rejects.toThrow(/마지막 관리자/);
    expect(await amAdmin(ADMIN)).toBe(true);
  });
  it('관리자 권한이 지워진 뒤 들어온 요청은 거부된다(잠금 뒤의 유일한 확인)', async () => {
    await setAdmin(ADMIN, T2, true);
    await db.exec(`delete from private.admins where email = 'teacher2@example.com'`); // 다른 관리자가 먼저 해제했다고 가정
    await expect(setTeacher(T2, NEWT, true)).rejects.toThrow(/관리자만/);
    await expect(setAdmin(T2, ADMIN, false)).rejects.toThrow(/관리자만/);
    await expect(revokeListed(T2, 'teacher@example.com')).rejects.toThrow(/관리자만/);
    expect(await amAdmin(ADMIN)).toBe(true);
    await db.query('delete from private.role_audit where target = $1 and action = $2', [T2, 'grant_admin']);
  });
});

describe('다시 적용(자료가 있는 상태)', () => {
  it('목록·기록·제약이 그대로이고, 앱에서 해제한 관리자가 되살아나지 않는다', async () => {
    const before = await lists();
    const n = (await db.query<{ n: number }>('select count(*)::int as n from private.role_audit')).rows[0].n;
    warnings.length = 0;
    await db.exec(ROLES, { onNotice: (x) => warnings.push(`${x.severity}: ${x.message}`) });
    expect(await lists()).toEqual(before);
    expect(before.admins).toEqual(['teacher@example.com']);
    expect((await db.query<{ n: number }>('select count(*)::int as n from private.role_audit')).rows[0].n).toBe(n);
    // 학번 형식 행을 정리했으므로 이번에는 경고 없이 제약을 VALIDATE
    expect(warnings.filter((w) => /WARNING/.test(w))).toEqual([]);
    const c = await db.query<{ v: boolean }>(`select bool_and(convalidated) as v from pg_constraint where conname in ('teachers_not_student', 'admins_not_student')`);
    expect(c.rows[0].v).toBe(true);
    expect(await amAdmin(ADMIN)).toBe(true);
    expect(await amTeacher(T2)).toBe(true);
  });
});

describe('처음 적용 규칙(따로 만든 DB)', () => {
  it('관리자 복사는 한 번만: 관리자 표를 비워도 다시 실행해서 채우지 않는다', async () => {
    const d = await freshDb();
    await d.exec(`insert into private.teachers(email) values ('a@example.com'), ('b@example.com')`);
    await addUser(d, ADMIN, 'a@example.com');
    await addUser(d, T2, 'b@example.com');
    await d.exec(ROLES);
    expect((await lists(d)).admins).toEqual(['a@example.com', 'b@example.com']);
    // 앱에서 b의 관리자 권한을 해제 → 다시 실행해도 되살아나지 않음
    expect(await setAdmin(ADMIN, T2, false, d)).toBe(true);
    await d.exec(ROLES);
    expect((await lists(d)).admins).toEqual(['a@example.com']);
    // SQL로 관리자 표를 비워도 다시 실행해서 교사 목록을 복사하지 않는다(한 번만 표시)
    await d.exec('delete from private.admins');
    await d.exec(ROLES);
    expect((await lists(d)).admins).toEqual([]);
    expect(await amAdmin(ADMIN, d)).toBe(false);
    // 비상용 한 줄 SQL로 관리자 지정
    await d.exec(`insert into private.admins(email) values ('a@example.com') on conflict do nothing`);
    expect(await amAdmin(ADMIN, d)).toBe(true);
    await d.close();
  });
  it('선생님이 없을 때 적용했다면 선생님을 넣은 뒤 다시 실행할 때 복사한다', async () => {
    const d = await freshDb();
    await addUser(d, ADMIN, 'a@example.com');
    await d.exec(ROLES);
    expect((await lists(d)).admins).toEqual([]);
    expect((await d.query('select * from private.role_flags')).rows).toEqual([]);
    await d.exec(`insert into private.teachers(email) values ('a@example.com')`);
    await d.exec(ROLES);
    expect((await lists(d)).admins).toEqual(['a@example.com']);
    expect(await amAdmin(ADMIN, d)).toBe(true);
    await d.close();
  });
  it('20261007을 다시 실행해 is_teacher()가 예전 정의로 돌아가도 계정 관리 RPC는 열리지 않고, 20261029를 다시 실행하면 되돌아온다', async () => {
    const STU = 'a0000000-0000-4000-8000-0000000000aa';
    const d = await freshDb();
    await d.exec(`insert into private.teachers(email) values ('a@example.com')`);
    await addUser(d, ADMIN, 'a@example.com', { name: '관리' });
    await addUser(d, STU, 'sai_209610150@seoulai.sen.hs.kr', { name: '학생' });
    await d.exec(ROLES);
    const src = async () => (await d.query<{ s: string }>(`select prosrc as s from pg_proc where oid = 'private.is_teacher()'::regprocedure`)).rows[0].s;
    expect(await src()).toContain('is_teacher_uid');
    // SQL Editor에서 제약을 지우고 학생 이메일을 넣은 뒤(실수), 예전 migration을 다시 실행
    await d.exec(`alter table private.teachers drop constraint teachers_not_student; insert into private.teachers(email) values ('sai_209610150@seoulai.sen.hs.kr')`);
    await d.exec(readFileSync('supabase/migrations/20261007000000_computer_general.sql', 'utf8'));
    expect(await src()).not.toContain('is_teacher_uid');
    expect(await amTeacher(STU, d)).toBe(true); // 예전 is_teacher()는 학번 형식을 거르지 않는다(이 위험을 보여 줌)
    // 이 파일의 RPC는 is_teacher_uid·is_admin_uid로 확인하므로 열리지 않는다
    await expect(accounts(STU, d)).rejects.toThrow(/선생님 계정만/);
    await expect(audit(STU, 10, d)).rejects.toThrow(/선생님 계정만/);
    await expect(setTeacher(STU, STU, true, d)).rejects.toThrow(/관리자만/);
    expect(await amAdmin(STU, d)).toBe(false);
    // 관리자는 그대로 동작. 학생 계정은 목록에 걸려 있어도(listed_as) 구분은 학생
    expect((await accounts(ADMIN, d)).map((r) => [r.kind, r.listed_as])).toEqual([['admin', 'admin'], ['student', 'teacher']]);
    // 20261029를 다시 실행: 학번 형식 행을 지우고(기록) 제약을 다시 걸며 is_teacher()를 되돌린다
    await d.exec(ROLES);
    expect(await src()).toContain('is_teacher_uid');
    expect(await amTeacher(STU, d)).toBe(false);
    await expect(as(STU, (tx) => tx.query('select * from public.cg_class_overview()'), d)).rejects.toThrow(/선생님 계정만/);
    expect((await lists(d)).teachers).toEqual(['a@example.com']);
    const c = await d.query<{ v: boolean }>(`select convalidated as v from pg_constraint where conname = 'teachers_not_student'`);
    expect(c.rows).toEqual([{ v: true }]);
    expect((await audit(ADMIN, 1, d))[0]).toMatchObject({ actor: null, target: STU, action: 'revoke_teacher', note: '학생 계정(학번 형식)이라 migration이 자동으로 지움' });
    await d.close();
  });
  it('뒤 migration(과목·모니터링)이 없어도 계정 목록이 동작한다(학습 기록 표 확인 생략)', async () => {
    const d = await freshDb(['20261001000000_sql_forest_v2.sql', '20261007000000_computer_general.sql']);
    await d.exec(`insert into private.teachers(email) values ('a@example.com')`);
    await addUser(d, ADMIN, 'a@example.com', { name: '관리' });
    await addUser(d, S1, 'sai_209610101@seoulai.sen.hs.kr');
    await d.exec(ROLES);
    await as(S1, (tx) => tx.query(`select public.save_cg_progress('{"v":1}'::jsonb, 0)`), d);
    const rows = await accounts(ADMIN, d);
    expect(rows.map((r) => [r.kind, r.has_progress])).toEqual([['admin', false], ['student', true]]);
    await d.close();
  });
});
