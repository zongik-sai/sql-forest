import { readFileSync } from 'node:fs';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import fixture from '../fixtures/student-emails.json';

/**
 * 계정 구분(학번 형식)·계정 목록·관리자(교사 권한 지정·해제)·권한 변경 기록(20261029000000_roles.sql)을 실제 Postgres 엔진(PGlite)에서 검사한다.
 * Supabase 방식(authenticated 역할 + JWT sub)을 흉내 내며, 실제 Supabase 프로젝트 검증은 별도. 모든 이메일은 가짜.
 * PGlite는 연결이 하나라 두 관리자의 진짜 동시 실행(advisory lock 경합)은 재현하지 못하고, 순서대로 실행했을 때의 결과만 본다.
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
interface Acc { user_id: string; email: string; name: string; google: boolean; email_verified: boolean; created_at: string | Date; last_sign_in_at: string | Date | null; kind: string; student_year: number | null; student_no: string | null; has_progress: boolean }
const accounts = (uid: string, d: PGlite = db) => as(uid, async (tx) => (await tx.query<Acc>('select * from public.account_list()')).rows, d);
interface Audit { at: Date; actor: string | null; actor_email: string | null; actor_name: string | null; target: string | null; target_email: string; target_name: string | null; action: string }
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
    await expect(as(ADMIN, (tx) => tx.query(`select private.admins_left('x')`))).rejects.toThrow(/permission denied/);
  });
});

describe('처음 적용: 관리자 복사 · 학번 형식 행 표시', () => {
  it('교사 목록이 관리자 목록으로 한 번 복사됐다(학번 형식 행 제외), 나중에 넣은 선생님은 관리자가 아니다', async () => {
    expect(await lists()).toEqual({
      teachers: ['sai_209699999@seoulai.sen.hs.kr', 'teacher2@example.com', 'teacher@example.com'],
      admins: ['teacher@example.com'],
    });
    expect(await amAdmin(ADMIN)).toBe(true);
    expect(await amTeacher(T2)).toBe(true);
    expect(await amAdmin(T2)).toBe(false);
  });
  it('이미 있던 학번 형식 교사 행은 migration을 멈추지 않고 경고만, 권한도 주지 않는다', async () => {
    expect(warnings.some((w) => /WARNING/.test(w) && /학생 계정\(학번 형식\) 이메일이 1개/.test(w))).toBe(true);
    expect(await amTeacher(SFLAG)).toBe(false);
    expect(await amAdmin(SFLAG)).toBe(false);
    await expect(as(SFLAG, (tx) => tx.query('select * from public.cg_class_overview()'))).rejects.toThrow(/선생님 계정만/);
    const c = await db.query<{ conname: string; convalidated: boolean }>(
      `select conname, convalidated from pg_constraint where conname in ('teachers_not_student', 'admins_not_student') order by conname`);
    expect(c.rows).toEqual([{ conname: 'admins_not_student', convalidated: true }, { conname: 'teachers_not_student', convalidated: false }]);
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
    expect(by[S1]).toMatchObject({ kind: 'student', name: '가온', student_year: 2096, student_no: '10101', has_progress: true, google: true });
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
    expect(kinds).toEqual([...kinds].sort((a, b) => ['unknown', 'admin', 'teacher', 'student'].indexOf(a) - ['unknown', 'admin', 'teacher', 'student'].indexOf(b)));
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
    expect((await lists()).teachers).toEqual(['sai_209699999@seoulai.sen.hs.kr', 'teacher2@example.com', 'teacher@example.com']);
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
  it('잘못 들어 있던 학번 형식 교사 행은 해제(정리)할 수 있다', async () => {
    expect(await setTeacher(ADMIN, SFLAG, false)).toBe(true);
    expect((await lists()).teachers).not.toContain('sai_209699999@seoulai.sen.hs.kr');
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
    // 처음 적용 때 자동 복사도 남는다(누가: 없음)
    const boot = rows[rows.length - 1];
    expect(boot).toMatchObject({ actor: null, actor_email: null, actor_name: null, target: null, target_email: 'teacher@example.com', action: 'grant_admin' });
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
