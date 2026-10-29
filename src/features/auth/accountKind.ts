/**
 * 학생 계정(학번 형식) 판정과 계정 구분(순수 함수, 테스트 대상).
 * 학교 학생 계정은 `sai?209610101@seoulai.sen.hs.kr`처럼 이메일 앞부분에 연도 4자리 + 학번 5자리 = 9자리 숫자가 들어 있다(선생님 안내 2026-10-29).
 *
 * 규칙(서버 supabase/migrations/20261029000000_roles.sql의 private.student_id와 같아야 한다 — 공통 시험 자료 tests/fixtures/student-emails.json):
 *  1. 앞뒤의 공백·탭·줄바꿈(ASCII)을 지우고 영문 대문자(A~Z)만 소문자로 바꾼다(다른 문자는 그대로: 켈빈 기호 같은 흉내 글자를 k로 바꾸지 않음).
 *  2. 주소 전체가 EMAIL_PATTERN이어야 한다: @가 하나, 앞부분은 비어 있지 않고 공백·@ 없음, 도메인은 정확히 seoulai.sen.hs.kr
 *     (하위 도메인·뒤에 덧붙인 주소·비슷한 도메인은 아님).
 *  3. 앞부분을 숫자(0~9)가 아닌 글자로 나눈 묶음 중 길이가 정확히 9인 묶음이 딱 하나여야 한다(8·10자리, 9자리 묶음 둘 = 애매함 → 아님).
 *  4. 그 묶음이 RUN_PATTERN(20으로 시작 = 연도 2000~2099)이어야 한다. 앞 4자리 = 연도, 뒤 5자리 = 학번.
 * 학번 5자리는 그대로 보여 주고, 학년 1~3 · 반 01~20 · 번호 01~40 모양일 때만 'n학년 n반 n번' 풀이를 덧붙인다.
 * 학번은 이메일에서 읽어 화면에 보여 줄 뿐 따로 저장하지 않는다.
 */
export const SCHOOL_DOMAIN = 'seoulai.sen.hs.kr';
/** SQL과 같은 문자열(서버: `v !~ '^[^@ \t\r\n]+@seoulai\.sen\.hs\.kr$'`) */
export const EMAIL_PATTERN = /^[^@ \t\r\n]+@seoulai\.sen\.hs\.kr$/;
/** 숫자 묶음을 나누는 글자(서버: regexp_split_to_table(local, '[^0-9]+')) */
export const RUN_SPLIT = /[^0-9]+/;
/** 9자리 묶음(서버: '^20[0-9]{7}$') */
export const RUN_PATTERN = /^20[0-9]{7}$/;

export interface StudentId {
  /** 9자리 그대로(연도 + 학번) */
  id: string;
  year: number;
  /** 학번 5자리(그대로) */
  no: string;
  /** 학년·반·번호 풀이(모양이 맞을 때만) */
  grade?: number;
  cls?: number;
  num?: number;
}

/** 앞뒤 ASCII 공백 제거 + 영문 대문자만 소문자(서버: translate(btrim(e, E' \t\r\n'), 'A..Z', 'a..z')) */
export function normalizeEmail(email: string | null | undefined): string {
  if (typeof email !== 'string') return '';
  return email.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '').replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** 도메인이 정확히 학교 도메인인 (형식이 맞는) 주소인지 */
export function isSchoolEmail(email: string | null | undefined): boolean {
  return EMAIL_PATTERN.test(normalizeEmail(email));
}

/** 학생 계정이면 연도·학번, 아니면 null */
export function studentId(email: string | null | undefined): StudentId | null {
  const v = normalizeEmail(email);
  if (!EMAIL_PATTERN.test(v)) return null;
  const runs = v.slice(0, v.indexOf('@')).split(RUN_SPLIT).filter((r) => r.length === 9);
  if (runs.length !== 1 || !RUN_PATTERN.test(runs[0])) return null;
  const id = runs[0];
  const no = id.slice(4);
  const grade = Number(no[0]);
  const cls = Number(no.slice(1, 3));
  const num = Number(no.slice(3));
  const parsed = grade >= 1 && grade <= 3 && cls >= 1 && cls <= 20 && num >= 1 && num <= 40;
  return { id, year: Number(id.slice(0, 4)), no, ...(parsed ? { grade, cls, num } : {}) };
}

/** '1학년 1반 1번'(풀이가 없으면 null) */
export function parsedText(s: StudentId | null | undefined): string | null {
  return s && s.grade ? `${s.grade}학년 ${s.cls}반 ${s.num}번` : null;
}

/** 표 한 칸: '10101 · 1학년 1반 1번' (풀이가 없으면 학번만) */
export function studentNoText(s: StudentId | null | undefined): string {
  if (!s) return '-';
  const p = parsedText(s);
  return p ? `${s.no} · ${p}` : s.no;
}

/** 서버가 준 연도·학번(account_list)을 같은 모양으로 */
export function studentIdFrom(year: number | null | undefined, no: string | null | undefined): StudentId | null {
  if (!year || !no || !/^[0-9]{5}$/.test(no)) return null;
  return studentId(`x${year}${no}@${SCHOOL_DOMAIN}`);
}

/**
 * 학번순 비교: 학생 계정 먼저(학번 5자리 → 연도 → 이메일), 학생이 아닌 계정은 뒤에 이메일순.
 * (같은 반 학생이 모이도록 학번을 먼저 본다)
 */
export function compareStudentNo(a: { sid: StudentId | null; email: string | null }, b: { sid: StudentId | null; email: string | null }): number {
  const ea = a.email ?? '';
  const eb = b.email ?? '';
  if (a.sid && b.sid) return a.sid.no.localeCompare(b.sid.no) || a.sid.year - b.sid.year || ea.localeCompare(eb);
  if (a.sid) return -1;
  if (b.sid) return 1;
  return ea.localeCompare(eb);
}

/** '학생 계정만' 보기(기본 켬): 선생님의 테스트 계정 등이 반 통계에 섞이지 않게 */
export function onlyStudents<T extends { email: string | null }>(list: T[], on: boolean): T[] {
  return on ? list.filter((x) => studentId(x.email) !== null) : list;
}

/* ---------------- 계정 구분(선생님 화면 '계정 관리') ---------------- */

/** 관리자 ⊂ 교사. 학생 = 학번 형식 + 이메일 인증 + Google 로그인. 나머지는 '확인 필요' */
export type AccountKind = 'admin' | 'teacher' | 'student' | 'unknown';
export const KIND_LABEL: Record<AccountKind, string> = { admin: '관리자', teacher: '교사', student: '학생', unknown: '확인 필요' };
export type UnknownReason = 'unverified' | 'not_google' | 'school_no_pattern' | 'outside';
export const REASON_LABEL: Record<UnknownReason, string> = {
  unverified: '이메일 미인증',
  not_google: 'Google 로그인 아님',
  school_no_pattern: '학교 계정이지만 학번 형식 아님',
  outside: '학교 밖 계정',
};

export interface KindInput {
  email: string | null;
  /** 이메일이 같은 Google 로그인 정보가 있는지 */
  google: boolean;
  emailVerified: boolean;
  /** 교사 목록·관리자 목록에 이메일이 있는지(서버만 앎) */
  listedTeacher: boolean;
  listedAdmin: boolean;
}

/**
 * 서버(account_list의 kind)와 같은 규칙. 화면은 서버가 준 kind를 쓰고, 이 함수는 규칙을 문서·테스트로 고정한다.
 * 교사 = 교사 목록 + 이메일 인증 + Google 로그인 + 학번 형식 아님(학생 계정은 교사·관리자가 될 수 없음).
 */
export function deriveKind(i: KindInput): AccountKind {
  const sid = studentId(i.email);
  const teacher = i.listedTeacher && i.emailVerified && i.google && !sid;
  if (teacher) return i.listedAdmin ? 'admin' : 'teacher';
  if (sid && i.emailVerified && i.google) return 'student';
  return 'unknown';
}

/** '확인 필요'인 까닭(먼저 걸리는 하나): 이메일 미인증 → Google 로그인 아님 → 학교 계정이지만 학번 형식 아님 → 학교 밖 계정 */
export function unknownReason(i: { email: string | null; google: boolean; emailVerified: boolean }): UnknownReason {
  if (!i.emailVerified) return 'unverified';
  if (!i.google) return 'not_google';
  return isSchoolEmail(i.email) ? 'school_no_pattern' : 'outside';
}

/** account_list() 한 행 */
export interface AccountRow {
  user_id: string;
  email: string | null;
  name: string | null;
  google: boolean;
  email_verified: boolean;
  created_at: string | null;
  last_sign_in_at: string | null;
  kind: string;
  student_year: number | null;
  student_no: string | null;
  has_progress: boolean;
}

export interface Account {
  id: string;
  email: string;
  name: string;
  google: boolean;
  emailVerified: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  kind: AccountKind;
  reason: UnknownReason | null;
  sid: StudentId | null;
  hasProgress: boolean;
}

const KINDS: readonly AccountKind[] = ['admin', 'teacher', 'student', 'unknown'];

/** 서버 행 → 화면용(모르는 kind는 '확인 필요'). 학번은 서버 값을 쓰되 없으면 이메일에서 읽는다 */
export function toAccount(r: AccountRow): Account {
  const kind = KINDS.includes(r.kind as AccountKind) ? (r.kind as AccountKind) : 'unknown';
  const email = r.email ?? '';
  const sid = studentIdFrom(r.student_year, r.student_no) ?? studentId(email);
  return {
    id: r.user_id, email, name: r.name || email.split('@')[0] || '(이름 없음)', google: r.google === true, emailVerified: r.email_verified === true,
    createdAt: r.created_at, lastSignInAt: r.last_sign_in_at, kind,
    reason: kind === 'unknown' ? unknownReason({ email, google: r.google === true, emailVerified: r.email_verified === true }) : null,
    sid, hasProgress: r.has_progress === true,
  };
}

/** 교사로 지정할 수 있는 계정인지(서버 set_teacher와 같은 조건, 화면에서 미리 안내용) */
export function grantBlock(a: Account): string | null {
  if (a.sid) return '학생 계정(학번 형식)은 교사·관리자로 지정할 수 없어요.';
  if (!a.emailVerified) return '이메일이 인증되지 않은 계정은 지정할 수 없어요.';
  if (!a.google) return 'Google로 로그인한 계정만 지정할 수 있어요.';
  return null;
}

/** 계정 목록 필터(교사 필터에는 관리자도 포함: 관리자 ⊂ 교사) */
export type AccountFilter = 'all' | 'unknown' | 'student' | 'teacher' | 'admin';
export const FILTER_LABEL: Record<AccountFilter, string> = { all: '전체', unknown: '확인 필요', student: '학생', teacher: '교사', admin: '관리자' };
export const FILTER_ORDER: AccountFilter[] = ['all', 'unknown', 'student', 'teacher', 'admin'];

export function matchFilter(a: Account, f: AccountFilter): boolean {
  if (f === 'all') return true;
  if (f === 'teacher') return a.kind === 'teacher' || a.kind === 'admin';
  return a.kind === f;
}

export function filterCounts(list: Account[]): Record<AccountFilter, number> {
  return Object.fromEntries(FILTER_ORDER.map((f) => [f, list.filter((a) => matchFilter(a, f)).length])) as Record<AccountFilter, number>;
}

/** 처음 보여 줄 필터: 확인 필요가 있으면 그것, 없으면 전체 */
export const defaultFilter = (list: Account[]): AccountFilter => (list.some((a) => a.kind === 'unknown') ? 'unknown' : 'all');

/** 이름·이메일·학번(9자리·5자리·'1학년 1반') 검색 */
export function matchQuery(a: Account, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return a.name.toLowerCase().includes(t) || a.email.toLowerCase().includes(t) || (!!a.sid && (a.sid.id.includes(t) || (parsedText(a.sid) ?? '').includes(q.trim())));
}

export type AccountSort = 'kind' | 'name' | 'recent' | 'created';
const KIND_RANK: Record<AccountKind, number> = { unknown: 0, admin: 1, teacher: 2, student: 3 };

/** 'kind': 구분(확인 필요 → 관리자 → 교사 → 학생) 다음 학번·이메일순, 'recent': 마지막 로그인 최근순, 'created': 가입 최근순 */
export function sortAccounts(list: Account[], by: AccountSort): Account[] {
  const t = (s: string | null) => (s ? Date.parse(s) || 0 : 0);
  return [...list].sort((a, b) => {
    if (by === 'name') return a.name.localeCompare(b.name, 'ko') || a.email.localeCompare(b.email);
    if (by === 'recent') return t(b.lastSignInAt) - t(a.lastSignInAt) || compareStudentNo(a, b);
    if (by === 'created') return t(b.createdAt) - t(a.createdAt) || compareStudentNo(a, b);
    return KIND_RANK[a.kind] - KIND_RANK[b.kind] || compareStudentNo(a, b);
  });
}
