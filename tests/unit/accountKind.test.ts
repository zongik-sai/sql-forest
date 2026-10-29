import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/student-emails.json';
import { readFileSync } from 'node:fs';
import {
  compareStudentNo, defaultFilter, deriveKind, EMAIL_PATTERN, filterCounts, grantBlock, isSchoolEmail, matchFilter, matchQuery, onlyStudents,
  parsedText, RUN_PATTERN, RUN_SPLIT, sortAccounts, studentId, studentIdFrom, studentNoText, toAccount, unknownReason, type AccountRow,
} from '../../src/features/auth/accountKind';

/** 학생 계정(학번 형식) 판정·계정 구분. 서버 private.student_id와 같은 시험 자료(tests/db/roles.test.ts도 같은 파일을 씀) */
describe('학번 형식 판정(공통 시험 자료)', () => {
  it.each(fixture.vectors.map((v) => [JSON.stringify(v.email), v] as const))('%s', (_, v) => {
    const s = studentId(v.email);
    expect(s?.id ?? null, v.why).toBe(v.id);
    expect(parsedText(s), v.why).toBe(v.parsed);
    expect(isSchoolEmail(v.email), v.why).toBe(v.school);
    if (s) {
      expect(s.year).toBe(Number(v.id!.slice(0, 4)));
      expect(s.no).toBe(v.id!.slice(4));
    }
  });
  it('시험 자료에 요구된 경계가 모두 들어 있다', () => {
    const emails = fixture.vectors.map((v) => v.email ?? '');
    for (const needle of ['gmail.com', '.kr.evil.com', '@xseoulai', '_20261010@', '_2026101011@', '_209610101_209610102@', '_199910101@', 'SAI_', '  sai_']) {
      expect(emails.some((e) => e.includes(needle)), needle).toBe(true);
    }
  });
  it('SQL migration과 같은 정규식 문자열을 쓴다', () => {
    const sql = readFileSync('supabase/migrations/20261029000000_roles.sql', 'utf8');
    expect(sql).toContain(`v !~ '${EMAIL_PATTERN.source}'`);
    expect(sql).toContain(`'${RUN_SPLIT.source}'`);
    expect(sql).toContain(`v_runs[1] !~ '${RUN_PATTERN.source}'`);
    expect(sql).toContain(`btrim(p_email, E' \\t\\r\\n')`);
  });
  it('학번 표시: 풀이가 있으면 덧붙이고, 없으면 5자리만', () => {
    expect(studentNoText(studentId('sai_209610101@seoulai.sen.hs.kr'))).toBe('10101 · 1학년 1반 1번');
    expect(studentNoText(studentId('sai_209640101@seoulai.sen.hs.kr'))).toBe('40101');
    expect(studentNoText(null)).toBe('-');
    expect(studentIdFrom(2096, '31240')).toMatchObject({ id: '209631240', grade: 3, cls: 12, num: 40 });
    expect(studentIdFrom(2096, '1234')).toBeNull();
    expect(studentIdFrom(null, '10101')).toBeNull();
  });
});

describe('계정 구분(서버 account_list와 같은 규칙)', () => {
  const base = { google: true, emailVerified: true, listedTeacher: false, listedAdmin: false };
  it('관리자 ⊂ 교사, 학생, 확인 필요', () => {
    expect(deriveKind({ ...base, email: 't@example.com', listedTeacher: true, listedAdmin: true })).toBe('admin');
    expect(deriveKind({ ...base, email: 't@example.com', listedTeacher: true })).toBe('teacher');
    expect(deriveKind({ ...base, email: 't@example.com', listedAdmin: true })).toBe('unknown'); // 관리자 목록만으로는 아님
    expect(deriveKind({ ...base, email: 'sai_209610101@seoulai.sen.hs.kr' })).toBe('student');
    expect(deriveKind({ ...base, email: 'example.teacher@seoulai.sen.hs.kr' })).toBe('unknown');
  });
  it('학생 계정은 교사 목록에 있어도 교사·관리자가 아니다', () => {
    expect(deriveKind({ ...base, email: 'sai_209610101@seoulai.sen.hs.kr', listedTeacher: true, listedAdmin: true })).toBe('student');
  });
  it('Google 로그인·이메일 인증이 없으면 교사·학생이 아니다', () => {
    expect(deriveKind({ ...base, email: 't@example.com', listedTeacher: true, google: false })).toBe('unknown');
    expect(deriveKind({ ...base, email: 't@example.com', listedTeacher: true, emailVerified: false })).toBe('unknown');
    expect(deriveKind({ ...base, email: 'sai_209610101@seoulai.sen.hs.kr', google: false })).toBe('unknown');
    expect(deriveKind({ ...base, email: 'sai_209610101@seoulai.sen.hs.kr', emailVerified: false })).toBe('unknown');
  });
  it('확인 필요 사유: 미인증 → Google 아님 → 학교 계정이지만 학번 형식 아님 → 학교 밖', () => {
    expect(unknownReason({ email: 'sai_209610101@seoulai.sen.hs.kr', google: false, emailVerified: false })).toBe('unverified');
    expect(unknownReason({ email: 'sai_209610101@seoulai.sen.hs.kr', google: false, emailVerified: true })).toBe('not_google');
    expect(unknownReason({ email: 'Example.Teacher@SeoulAI.sen.hs.kr', google: true, emailVerified: true })).toBe('school_no_pattern');
    expect(unknownReason({ email: 'someone@gmail.com', google: true, emailVerified: true })).toBe('outside');
    expect(unknownReason({ email: 'x@seoulai.sen.hs.kr.evil.com', google: true, emailVerified: true })).toBe('outside');
  });
});

const row = (o: Partial<AccountRow> & { user_id: string; email: string }): AccountRow => ({
  name: null, google: true, email_verified: true, created_at: '2026-09-01T00:00:00Z', last_sign_in_at: null, kind: 'unknown',
  student_year: null, student_no: null, has_progress: false, ...o,
});

describe('계정 목록 화면 규칙', () => {
  const list = [
    row({ user_id: 's2', email: 'sai_209610102@seoulai.sen.hs.kr', name: '나래', kind: 'student', student_year: 2096, student_no: '10102', last_sign_in_at: '2026-10-28T00:00:00Z' }),
    row({ user_id: 's1', email: 'sai_209610101@seoulai.sen.hs.kr', name: '가온', kind: 'student', student_year: 2096, student_no: '10101', has_progress: true }),
    row({ user_id: 's0', email: 'sai_209520101@seoulai.sen.hs.kr', name: '다온', kind: 'student', student_year: 2095, student_no: '20101' }),
    row({ user_id: 's3', email: 'sai_209510101@seoulai.sen.hs.kr', name: '라온', kind: 'student', student_year: 2095, student_no: '10101' }),
    row({ user_id: 'a', email: 'admin@example.com', name: '김관리', kind: 'admin', last_sign_in_at: '2026-10-29T00:00:00Z' }),
    row({ user_id: 't', email: 'teacher@example.com', name: '이선생', kind: 'teacher' }),
    row({ user_id: 'u1', email: 'example.new@seoulai.sen.hs.kr', name: '박선생' }),
    row({ user_id: 'u2', email: 'example.pw@seoulai.sen.hs.kr', google: false }),
    row({ user_id: 'u3', email: 'x@example.org', email_verified: false }),
    row({ user_id: 'u4', email: 'weird@example.org', kind: 'superuser' }),
  ].map(toAccount);
  const by = Object.fromEntries(list.map((a) => [a.id, a]));

  it('서버 행 → 화면용: 사유·학번·모르는 kind는 확인 필요', () => {
    expect(by.s1).toMatchObject({ kind: 'student', reason: null, sid: { id: '209610101', no: '10101', year: 2096, grade: 1 }, hasProgress: true });
    expect(by.u1).toMatchObject({ kind: 'unknown', reason: 'school_no_pattern' });
    expect(by.u2).toMatchObject({ kind: 'unknown', reason: 'not_google' });
    expect(by.u3).toMatchObject({ kind: 'unknown', reason: 'unverified' });
    expect(by.u4).toMatchObject({ kind: 'unknown', reason: 'outside' });
    expect(by.u2.name).toBe('example.pw');
  });
  it('필터 개수(교사에는 관리자 포함)와 처음 필터', () => {
    expect(filterCounts(list)).toEqual({ all: 10, unknown: 4, student: 4, teacher: 2, admin: 1 });
    expect(list.filter((a) => matchFilter(a, 'teacher')).map((a) => a.id)).toEqual(['a', 't']);
    expect(defaultFilter(list)).toBe('unknown');
    expect(defaultFilter(list.filter((a) => a.kind !== 'unknown'))).toBe('all');
  });
  it('검색: 이름·이메일·학번(9자리·5자리)·학년 반', () => {
    const q = (t: string) => list.filter((a) => matchQuery(a, t)).map((a) => a.id);
    expect(q('가온')).toEqual(['s1']);
    expect(q('ADMIN@')).toEqual(['a']);
    expect(q('209610102')).toEqual(['s2']);
    expect(q('10101')).toEqual(['s1', 's3']);
    expect(q('2학년 1반')).toEqual(['s0']);
    expect(q('  ')).toHaveLength(10);
  });
  it('학번순: 학번 5자리 → 연도 → 이메일, 학생이 아닌 계정은 뒤', () => {
    const sorted = [...list].sort(compareStudentNo).map((a) => a.id);
    expect(sorted.slice(0, 4)).toEqual(['s3', 's1', 's2', 's0']);
    expect(sorted.slice(4)).toEqual(['a', 'u1', 'u2', 't', 'u4', 'u3']); // admin@ · new@ · pw@ · teacher@ · weird@ · x@
  });
  it('구분순: 확인 필요 → 관리자 → 교사 → 학생(학번순), 최근 로그인순', () => {
    expect(sortAccounts(list, 'kind').map((a) => a.id)).toEqual(['u1', 'u2', 'u4', 'u3', 'a', 't', 's3', 's1', 's2', 's0']);
    expect(sortAccounts(list, 'recent').map((a) => a.id).slice(0, 2)).toEqual(['a', 's2']);
    expect(sortAccounts(list, 'name').map((a) => a.name).slice(0, 2)).toEqual(['가온', '김관리']);
  });
  it('지정 가능 여부 안내: 학생·미인증·Google 아님', () => {
    expect(grantBlock(by.s1)).toMatch(/학생 계정/);
    expect(grantBlock(by.u3)).toMatch(/인증되지 않은/);
    expect(grantBlock(by.u2)).toMatch(/Google/);
    expect(grantBlock(by.u1)).toBeNull();
  });
  it('학생 계정만 보기(기본 켬): 선생님 테스트 계정은 반 통계에서 빠진다', () => {
    const rows = [{ email: 'sai_209610101@seoulai.sen.hs.kr' }, { email: 'teacher@example.com' }, { email: null }];
    expect(onlyStudents(rows, true)).toEqual([rows[0]]);
    expect(onlyStudents(rows, false)).toEqual(rows);
  });
});
