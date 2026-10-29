import { expect, test, type Page } from '@playwright/test';
import { loadEnv } from 'vite';

/**
 * 선생님 화면 '계정 관리' 탭(계정 구분·교사/관리자 지정·해제)을 가짜 Supabase로 검증한다(dev 프로젝트, teacher.spec.ts와 같은 방식).
 * - 로그인: supabase-js가 읽는 localStorage 세션을 미리 넣는다(실제 OAuth·실제 서버 아님).
 * - 서버: /auth/v1·/rest/v1 요청을 page.route로 가로채 RPC별 가짜 응답(메모리 속 목록·기록)을 준다.
 *   권한 판단·학번 판정·마지막 관리자 보호는 실제로는 서버가 한다(tests/db/roles.test.ts). 여기서는 화면 흐름만 본다.
 * 모든 이메일은 가짜. 개발 서버에 Supabase 설정(.env.local)이 없으면 건너뛴다.
 */
const env = loadEnv('development', process.cwd(), 'VITE_');
const SB_URL = (env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const configured = !!SB_URL && !!(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
const STORAGE_KEY = configured ? `sb-${new URL(SB_URL).hostname.split('.')[0]}-auth-token` : '';
test.skip(!configured, '개발 서버에 Supabase 설정(VITE_SUPABASE_URL)이 없어 가짜 로그인 테스트를 건너뜀');

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sessionFor(u: { id: string; email: string; name: string }) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = {
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: '2026-10-01T00:00:00Z',
    app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: { full_name: u.name }, identities: [],
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
  };
  return { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, exp, role: 'authenticated', aud: 'authenticated', email: u.email })}.fake`, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'fake-refresh', user };
}

const ME = { id: 'aaaaaaaa-0000-4000-8000-000000000001', email: 'teacher@school.example', name: '김선생' };
const STUDENT = { id: 'bbbbbbbb-0000-4000-8000-000000000002', email: 'sai_209610101@seoulai.sen.hs.kr', name: '가온' };

type Row = { user_id: string; email: string; name: string; google: boolean; email_verified: boolean; created_at: string; last_sign_in_at: string | null; kind: string; student_year: number | null; student_no: string | null; has_progress: boolean };
const acc = (o: Partial<Row> & Pick<Row, 'user_id' | 'email' | 'name'>): Row => ({
  google: true, email_verified: true, created_at: '2026-09-02T00:00:00Z', last_sign_in_at: '2026-10-28T09:00:00Z', kind: 'unknown',
  student_year: null, student_no: null, has_progress: false, ...o,
});
/** 계정 10개: 확인 필요 4(학교 계정·학교 밖·Google 아님·미인증), 학생 3, 교사(나)·다른 교사·관리자 */
function accountRows(meKind: 'teacher' | 'admin'): Row[] {
  return [
    acc({ user_id: 'n1', email: 'example.newteacher@seoulai.sen.hs.kr', name: '박선생' }),
    acc({ user_id: 'n2', email: 'friend@example.org', name: '바깥', last_sign_in_at: null }),
    acc({ user_id: 'n3', email: 'example.pw@seoulai.sen.hs.kr', name: 'pw', google: false }),
    acc({ user_id: 'n4', email: 'unverified@example.org', name: '미인증', email_verified: false }),
    acc({ user_id: ME.id, email: ME.email, name: ME.name, kind: meKind, last_sign_in_at: '2026-10-29T01:00:00Z' }),
    acc({ user_id: 'a1', email: 'principal@school.example', name: '최관리', kind: 'admin' }),
    acc({ user_id: 't2', email: 'teacher2@school.example', name: '이선생', kind: 'teacher' }),
    acc({ user_id: 's2', email: 'sai_209610102@seoulai.sen.hs.kr', name: '나래', kind: 'student', student_year: 2096, student_no: '10102' }),
    acc({ user_id: 's1', email: 'sai_209610101@seoulai.sen.hs.kr', name: '가온', kind: 'student', student_year: 2096, student_no: '10101', has_progress: true }),
    acc({ user_id: 's3', email: 'sai_209520115@seoulai.sen.hs.kr', name: '다온', kind: 'student', student_year: 2095, student_no: '20115', has_progress: true }),
  ];
}
type Audit = { at: string; actor: string | null; actor_email: string | null; actor_name: string | null; target: string | null; target_email: string; target_name: string | null; action: string };
const BOOT_AUDIT: Audit[] = [{ at: '2026-10-29T00:00:00Z', actor: null, actor_email: null, actor_name: null, target: null, target_email: 'principal@school.example', target_name: null, action: 'grant_admin' }];

type Handler = (body: Record<string, unknown> | null) => { status?: number; json: unknown };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-expose-headers': '*' };

/** 가짜 로그인 + 가짜 Supabase(계정 목록·권한 변경을 메모리에서 흉내). calls에 RPC 호출이 쌓이고, setHandler로 응답을 바꾼다(실제 서버로는 보내지 않음) */
async function fakeSupabase(page: Page, who: typeof ME, o: { teacher: boolean; admin: boolean }, extra: Record<string, Handler> = {}) {
  const calls: { fn: string; body: Record<string, unknown> | null }[] = [];
  const rows = accountRows(o.admin ? 'admin' : 'teacher');
  const audit = [...BOOT_AUDIT];
  const session = sessionFor(who);
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(session)] as const);
  const change = (fn: 'set_teacher' | 'set_admin') => (body: Record<string, unknown> | null) => {
    const r = rows.find((x) => x.user_id === body?.p_user);
    if (!r) return { status: 400, json: { code: '22023', message: '계정을 찾을 수 없어요' } };
    const on = body?.p_on === true;
    const before = r.kind;
    if (fn === 'set_teacher') r.kind = on ? (r.kind === 'admin' ? 'admin' : 'teacher') : 'unknown';
    else r.kind = on ? 'admin' : 'teacher';
    if (before === r.kind) return { json: false };
    audit.unshift({ at: new Date().toISOString(), actor: who.id, actor_email: who.email, actor_name: who.name, target: r.user_id, target_email: r.email, target_name: r.name, action: `${on ? 'grant' : 'revoke'}_${fn === 'set_teacher' ? 'teacher' : 'admin'}` });
    return { json: true };
  };
  const forbidden = { status: 403, json: { code: '42501', message: '선생님 계정만 볼 수 있어요' } };
  const handlers: Record<string, Handler> = {
    am_i_teacher: () => ({ json: o.teacher }),
    am_i_admin: () => ({ json: o.admin }),
    my_screen_request: () => ({ json: [] }),
    report_live_status: () => ({ json: null }),
    class_live_status: () => ({ json: [] }),
    account_list: () => (o.teacher ? { json: rows } : forbidden),
    role_audit_list: () => (o.teacher ? { json: audit } : forbidden),
    set_teacher: o.admin ? change('set_teacher') : () => ({ status: 403, json: { code: '42501', message: '관리자만 권한을 바꿀 수 있어요' } }),
    set_admin: o.admin ? change('set_admin') : () => ({ status: 403, json: { code: '42501', message: '관리자만 권한을 바꿀 수 있어요' } }),
    ...extra,
  };
  await page.route(`${SB_URL}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const p = new URL(req.url()).pathname;
    if (p.startsWith('/auth/v1/')) return route.fulfill({ headers: CORS, json: p.endsWith('/user') ? session.user : {} });
    const m = /^\/rest\/v1\/rpc\/(\w+)$/.exec(p);
    if (m) {
      let body: Record<string, unknown> | null = null;
      try {
        body = req.postDataJSON() as Record<string, unknown> | null;
      } catch {
        body = null;
      }
      calls.push({ fn: m[1], body });
      const h = handlers[m[1]];
      if (h) {
        const r = h(body);
        return route.fulfill({ status: r.status ?? 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(r.json) });
      }
      if (m[1].startsWith('save_')) return route.fulfill({ headers: CORS, json: { status: 'ok', revision: 1 } });
      return route.fulfill({ headers: CORS, contentType: 'application/json', body: 'null' });
    }
    if (p.startsWith('/rest/v1/')) return route.fulfill({ headers: CORS, json: [] });
    return route.fulfill({ status: 404, headers: CORS, body: '' });
  });
  const setHandler = (fn: string, h: Handler) => {
    handlers[fn] = h;
  };
  return Object.assign(calls, { setHandler });
}

const open = (page: Page, path: string) => page.goto(`./#${path}`);
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const table = (page: Page) => page.getByRole('table', { name: '계정 목록' });
const filter = (page: Page, name: RegExp) => page.getByRole('group', { name: '구분 필터' }).getByRole('button', { name });

test.describe('선생님 화면: 계정 관리(가짜 로그인)', () => {
  test('학생(선생님 아님): 계정 관리 탭이 없고 계정 목록을 읽지 않는다', async ({ page }) => {
    const calls = await fakeSupabase(page, STUDENT, { teacher: false, admin: false });
    await open(page, '/teacher?s=accounts');
    await expect(page.getByText('이 화면은 학교에서 지정한 선생님 계정만 볼 수 있어요.')).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: '계정 관리' })).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(calls.some((c) => ['account_list', 'role_audit_list', 'am_i_admin', 'set_teacher', 'set_admin'].includes(c.fn))).toBe(false);
  });

  test('선생님(관리자 아님): 목록 읽기 전용 — 구분·사유·학번·필터·검색·기록', async ({ page }) => {
    const calls = await fakeSupabase(page, ME, { teacher: true, admin: false });
    await open(page, '/teacher');
    await page.getByRole('tab', { name: '계정 관리' }).click();
    await expect(page).toHaveURL(/#\/teacher\?s=accounts$/);
    await expect(page.getByText('권한 변경은 관리자만 할 수 있어요.')).toBeVisible();
    // 처음 필터: 확인 필요가 있으니 확인 필요
    await expect(filter(page, /^확인 필요/)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('group', { name: '구분 필터' }).getByRole('button')).toHaveText(['전체 10', '확인 필요 4', '학생 3', '교사 3', '관리자 1']);
    const rows = table(page).locator('tbody tr');
    await expect(rows).toHaveCount(4);
    await expect(rows.filter({ hasText: '박선생' })).toContainText('학교 계정이지만 학번 형식 아님');
    await expect(rows.filter({ hasText: '바깥' })).toContainText('학교 밖 계정');
    await expect(rows.filter({ hasText: 'example.pw@seoulai.sen.hs.kr' })).toContainText('Google 로그인 아님');
    await expect(rows.filter({ hasText: '미인증' })).toContainText('이메일 미인증');
    // 읽기 전용: 권한 버튼·열이 없다
    await expect(table(page).getByRole('columnheader', { name: '권한' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /교사로 지정|교사 해제|관리자로 지정|관리자 해제/ })).toHaveCount(0);
    // 학생: 학번(연도·학번) 표시, 학번순
    await filter(page, /^학생/).click();
    await expect(rows).toHaveCount(3);
    await expect(rows.locator('th')).toHaveText(['가온', '나래', '다온']);
    await expect(rows.first().locator('td[data-label="학번"]')).toHaveText('2096 · 101011학년 1반 1번');
    await expect(rows.first().locator('.acc-sid-p')).toHaveText('1학년 1반 1번');
    await expect(rows.first()).toContainText('있음');
    // 검색: 이름·이메일·학번·학년 반
    await filter(page, /^전체/).click();
    await expect(rows).toHaveCount(10);
    const search = page.getByRole('searchbox', { name: '계정 검색' });
    await search.fill('10102');
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('나래');
    await search.fill('2학년 1반');
    await expect(rows.locator('th')).toHaveText(['다온']);
    await search.fill('principal@');
    await expect(rows).toContainText('최관리');
    await expect(rows).toContainText('관리자');
    await search.fill('');
    // 교사 필터에는 관리자도 포함, 나는 (나)
    await filter(page, /^교사/).click();
    await expect(rows.locator('th')).toHaveText(['최관리', '김선생 (나)', '이선생']);
    // 권한 변경 기록(처음 적용)
    await expect(page.getByRole('heading', { name: '권한 변경 기록' })).toBeVisible();
    await expect(page.locator('.acc-audit-list li')).toHaveCount(1);
    await expect(page.locator('.acc-audit-list li').first()).toContainText('처음 적용(자동) → principal@school.example: 관리자로 지정');
    expect(calls.find((c) => c.fn === 'role_audit_list')!.body).toEqual({ p_limit: 20 });
    expect(calls.some((c) => c.fn === 'set_teacher' || c.fn === 'set_admin')).toBe(false);

    await page.setViewportSize({ width: 390, height: 844 });
    await filter(page, /^전체/).click();
    await expect(rows).toHaveCount(10);
    expect(await noOverflow(page)).toBe(true);
  });

  test('관리자: 권한 버튼 → 확인 창(계정·효과) → 바꾸고 목록 새로고침·알림, 학생은 버튼 없음, 마지막 관리자 보호', async ({ page }) => {
    const calls = await fakeSupabase(page, ME, { teacher: true, admin: true });
    await open(page, '/teacher?s=accounts');
    await expect(page.getByText('관리자는 교사·관리자를 지정하거나 해제할 수 있어요.', { exact: false })).toBeVisible();
    const rows = table(page).locator('tbody tr');
    await expect(rows).toHaveCount(4);
    // Google 아님·미인증은 지정 버튼이 꺼져 있고 까닭을 보여 줌
    await expect(page.getByRole('button', { name: 'pw 교사로 지정' })).toBeDisabled();
    await expect(rows.filter({ hasText: 'example.pw@seoulai.sen.hs.kr' })).toContainText('Google로 로그인한 계정만 지정할 수 있어요.');
    await expect(page.getByRole('button', { name: '미인증 교사로 지정' })).toBeDisabled();

    // 취소하면 아무것도 바뀌지 않음
    const grant = page.getByRole('button', { name: '박선생 교사로 지정' });
    await grant.click();
    let dlg = page.getByRole('dialog', { name: '교사로 지정' });
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('박선생');
    await expect(dlg).toContainText('example.newteacher@seoulai.sen.hs.kr');
    await expect(dlg).toContainText('교사로 지정할까요? 이 계정은 선생님 화면(모든 학생의 학습 기록·실시간 학습 위치·계정 목록)을 볼 수 있게 돼요.');
    await expect(dlg.getByRole('button', { name: '취소' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(grant).toBeFocused();
    expect(calls.some((c) => c.fn === 'set_teacher')).toBe(false);

    // 지정
    const listCalls = () => calls.filter((c) => c.fn === 'account_list').length;
    const before = listCalls();
    await grant.click();
    dlg = page.getByRole('dialog', { name: '교사로 지정' });
    await dlg.getByRole('button', { name: '교사로 지정' }).click();
    await expect(dlg).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: '박선생 계정: 교사로 지정했어요.' })).toBeVisible();
    expect(calls.find((c) => c.fn === 'set_teacher')!.body).toEqual({ p_user: 'n1', p_on: true });
    await expect.poll(listCalls).toBeGreaterThan(before);
    await expect(rows).toHaveCount(3); // 확인 필요에서 빠짐
    await expect(page.locator('.acc-audit-list li').first()).toContainText('김선생 → 박선생');
    await expect(page.locator('.acc-audit-list li').first()).toContainText('교사로 지정');

    // 서버가 거부하면 확인 창 안에 까닭을 보여 주고 그대로 둠
    calls.setHandler('set_teacher', () => ({ status: 400, json: { code: '22023', message: '이메일이 인증되지 않은 계정은 교사로 지정할 수 없어요' } }));
    await page.getByRole('button', { name: '바깥 교사로 지정' }).click();
    dlg = page.getByRole('dialog', { name: '교사로 지정' });
    await dlg.getByRole('button', { name: '교사로 지정' }).click();
    await expect(dlg.getByRole('alert')).toContainText('이메일이 인증되지 않은 계정은 교사로 지정할 수 없어요');
    await dlg.getByRole('button', { name: '취소' }).click();
    await expect(dlg).toHaveCount(0);
  });

  test('관리자: 관리자 해제 후 남은 관리자(나)는 해제 버튼이 꺼지고, 학생 계정에는 버튼이 없다', async ({ page }) => {
    const calls = await fakeSupabase(page, ME, { teacher: true, admin: true });
    await open(page, '/teacher?s=accounts');
    const rows = table(page).locator('tbody tr');
    await filter(page, /^학생/).click();
    await expect(rows).toHaveCount(3);
    await expect(table(page).locator('tbody button')).toHaveCount(0);
    await expect(rows.first()).toContainText('학생 계정 · 지정 불가');
    await expect(page.getByText('학생 계정(학번 형식)은 교사·관리자로 지정할 수 없어 버튼이 없어요.', { exact: false })).toBeVisible();

    await filter(page, /^관리자/).click();
    await expect(rows).toHaveCount(2);
    await expect(page.getByRole('button', { name: '김선생 관리자 해제' })).toBeEnabled();
    await page.getByRole('button', { name: '최관리 관리자 해제' }).click();
    const dlg = page.getByRole('dialog', { name: '관리자 해제' });
    await expect(dlg).toContainText('최관리');
    await expect(dlg).toContainText('principal@school.example');
    await expect(dlg).toContainText('관리자 해제할까요? 교사 권한은 그대로 남고, 권한을 바꾸는 버튼만 사라져요.');
    await dlg.getByRole('button', { name: '관리자 해제' }).click();
    await expect(page.getByRole('status').filter({ hasText: '최관리 계정: 관리자 해제했어요.' })).toBeVisible();
    expect(calls.find((c) => c.fn === 'set_admin')!.body).toEqual({ p_user: 'a1', p_on: false });
    await expect(rows).toHaveCount(1);
    await expect(page.getByRole('button', { name: '김선생 관리자 해제' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '김선생 교사 해제' })).toBeDisabled();
    await expect(rows).toContainText('마지막 관리자(나)');
    // 교사가 된 최관리는 다시 관리자로 지정할 수 있다
    await filter(page, /^교사/).click();
    await page.getByRole('button', { name: '최관리 관리자로 지정' }).click();
    await expect(page.getByRole('dialog', { name: '관리자로 지정' })).toContainText('다른 계정을 교사·관리자로 지정하거나 해제할 수 있게 돼요.');
    await page.getByRole('dialog', { name: '관리자로 지정' }).getByRole('button', { name: '관리자로 지정' }).click();
    await expect(page.getByRole('status').filter({ hasText: '최관리 계정: 관리자로 지정했어요.' })).toBeVisible();

    // 휴대폰 너비: 카드 모양, 가로 넘침 없음(확인 창 포함)
    await page.setViewportSize({ width: 390, height: 844 });
    await filter(page, /^전체/).click();
    await expect(rows).toHaveCount(10);
    expect(await noOverflow(page)).toBe(true);
    await page.getByRole('button', { name: '이선생 교사 해제' }).click();
    await expect(page.getByRole('dialog', { name: '교사 해제' })).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
    const box = await page.getByRole('dialog', { name: '교사 해제' }).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });

  test('서버에 계정 관리 migration이 아직 없으면 분명하게 안내', async ({ page }) => {
    const missing = (fn: string) => () => ({ status: 404, json: { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` } });
    await fakeSupabase(page, ME, { teacher: true, admin: true }, { account_list: missing('account_list'), am_i_admin: missing('am_i_admin'), role_audit_list: missing('role_audit_list(p_limit)') });
    await open(page, '/teacher?s=accounts');
    await expect(page.getByRole('alert')).toContainText('supabase/migrations/20261029000000_roles.sql');
    await expect(page.getByRole('button', { name: /교사로 지정/ })).toHaveCount(0);
  });

  test('스크린샷(계정 관리, 가짜 자료): 1280px·390px', async ({ page }) => {
    const dir = process.env.ACCOUNTS_SHOTS;
    test.skip(!dir, 'ACCOUNTS_SHOTS=저장 폴더를 주면 스크린샷을 남긴다');
    await fakeSupabase(page, ME, { teacher: true, admin: true });
    for (const w of [1280, 390]) {
      await page.setViewportSize({ width: w, height: w > 600 ? 900 : 844 });
      await open(page, '/teacher?s=accounts');
      await filter(page, /^전체/).click();
      await expect(table(page).locator('tbody tr')).toHaveCount(10);
      await page.screenshot({ path: `${dir}/accounts-${w}.png`, fullPage: true });
      await page.getByRole('button', { name: '박선생 교사로 지정' }).click();
      await expect(page.getByRole('dialog', { name: '교사로 지정' })).toBeVisible();
      await page.screenshot({ path: `${dir}/accounts-confirm-${w}.png` });
      await page.keyboard.press('Escape');
      expect(await noOverflow(page)).toBe(true);
    }
  });
});
