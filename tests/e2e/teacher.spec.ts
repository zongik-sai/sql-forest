import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { loadEnv } from 'vite';
import { addLock, addMock, emptyCgState, markDone, noteAnswer, recordScore } from '../../src/features/computer/model';

/**
 * 선생님 화면(/teacher)·실시간 학습 위치·학생 표시를 가짜 Supabase로 검증한다(dev 프로젝트).
 * - 로그인: supabase-js가 읽는 localStorage 세션을 미리 넣는다(실제 OAuth·실제 서버 아님).
 * - 서버: 이 페이지의 Supabase 요청(/auth/v1·/rest/v1)을 page.route로 가로채 RPC별로 가짜 응답을 준다.
 *   권한 판단은 실제로는 서버가 한다(tests/db/monitoring.test.ts). 여기서는 화면이 그 응답대로 보이는지만 본다.
 * - WebRTC: 실제 화면 선택 창(getDisplayMedia)은 자동화하지 않고, 같은 페이지 안 두 RTCPeerConnection으로
 *   학생(ShareSession)·선생님(ViewerSession) 흐름을 캔버스 영상으로 끝까지 연결해 본다(메모리 속 가짜 RPC).
 * 개발 서버에 Supabase 설정(.env.local)이 없으면 건너뛴다.
 */
const env = loadEnv('development', process.cwd(), 'VITE_');
const SB_URL = (env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const configured = !!SB_URL && !!(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
const STORAGE_KEY = configured ? `sb-${new URL(SB_URL).hostname.split('.')[0]}-auth-token` : '';

// 같은 페이지 안 두 연결이 서로의 로컬 주소를 바로 쓰도록(mDNS 이름 숨김 끔). WebRTC 테스트에만 영향
test.use({ launchOptions: { args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] } });
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

const TEACHER = { id: 'aaaaaaaa-0000-4000-8000-000000000001', email: 'teacher@school.example', name: '김선생' };
const STUDENT = { id: 'bbbbbbbb-0000-4000-8000-000000000002', email: 's1@school.example', name: '가온' };
const iso = (agoSec: number) => new Date(Date.now() - agoSec * 1000).toISOString();

function liveRows() {
  const st = (o: Record<string, unknown>) => ({ v: 1, path: '/', unit: null, step: null, detail: null, fs: false, locks: null, sharing: false, ...o });
  return [
    { user_id: 'u1', name: '가온', email: 'sai_209610101@seoulai.sen.hs.kr', updated_at: iso(8), state: st({ subject: 'cg', path: '/computer/unit/U3/3', unit: 'U3', step: '3', label: '3단원 · 3단계 기초 객관식', detail: '문항 7/20', focus: 'learning', fs: true, locks: 1 }) },
    { user_id: 'u2', name: '나래', email: 'sai_209610102@seoulai.sen.hs.kr', updated_at: iso(20), state: st({ subject: 'net', path: '/network/unit/U2/5', unit: 'U2', step: '5', label: '2단원 · 5단계 실력점검', detail: '문항 3/15', focus: 'locked', fs: false, locks: 3 }) },
    { user_id: 'u3', name: '다온', email: 'sai_209610103@seoulai.sen.hs.kr', updated_at: iso(40), state: st({ subject: 'db', path: '/learn/U03/U03-A02', unit: 'U03', step: 'activity:U03-A02', label: '3단원 · 활동 2', detail: '활동 2/4', focus: 'idle' }) },
    { user_id: 'u4', name: '라온', email: 'sai_209610104@seoulai.sen.hs.kr', updated_at: iso(300), state: st({ subject: 'ip', path: '/ip', label: '단원 목록', focus: 'menu' }) },
    // 선생님의 테스트 계정(학번 형식 아님): '학생 계정만'(기본 켬)이면 숨김
    { user_id: 'u5', name: '김선생', email: 'teacher@school.example', updated_at: iso(3), state: st({ subject: 'cg', path: '/computer', label: '단원 목록', focus: 'menu' }) },
  ];
}

function cgRows() {
  const T = (n: number) => `2026-10-2${n}T09:00:00.000Z`;
  let a = markDone(emptyCgState(), 'U1', 1, T(1));
  a = recordScore(a, 'U1', 2, 27, 30, T(2)).state;
  a = recordScore(a, 'U1', 3, 31, 40, T(3)).state;
  a = noteAnswer(noteAnswer(a, 'U1-b1', false, T(3)), 'U1-b2', false, T(3));
  a = addMock(a, { id: 'm1', kind: 'set1', at: T(4), score: 33, total: 50, seconds: 2700, perUnit: {}, perArea: {} });
  a = addMock(a, { id: 'm2', kind: 'random', at: T(5), score: 26, total: 50, seconds: 3000, timeUp: true, perUnit: {}, perArea: {} });
  a = addLock(addLock(a, 'U2', T(5)).state, 'U2', T(5)).state;
  let b = markDone(emptyCgState(), 'U1', 1, T(2));
  b = noteAnswer(b, 'U1-b1', false, T(4));
  const t = noteAnswer(emptyCgState(), 'U1-b1', false, T(5)); // 선생님 테스트 계정
  return [
    { user_id: 'u1', name: '가온', email: 'sai_209610101@seoulai.sen.hs.kr', state: a, updated_at: T(5) },
    { user_id: 'u2', name: '나래', email: 'sai_209610102@seoulai.sen.hs.kr', state: b, updated_at: T(4) },
    { user_id: 'u5', name: '김선생', email: 'teacher@school.example', state: t, updated_at: T(5) },
  ];
}

const DB_ROWS = [
  { user_id: 'u1', name: '가온', email: 'sai_209610101@seoulai.sen.hs.kr', total_xp: 2450, activities: 20, checkpoints: 14, units: 5, finals: 0, last_activity: '2026-10-25T09:00:00Z' },
  { user_id: 'u3', name: '다온', email: 'sai_209610103@seoulai.sen.hs.kr', total_xp: 600, activities: 6, checkpoints: 3, units: 1, finals: 0, last_activity: '2026-10-20T09:00:00Z' },
  { user_id: 'u5', name: '김선생', email: 'teacher@school.example', total_xp: 9900, activities: 48, checkpoints: 36, units: 12, finals: 12, last_activity: '2026-10-26T09:00:00Z' },
];

type Handler = (body: Record<string, unknown> | null) => { status?: number; json: unknown };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-expose-headers': '*' };

/** 가짜 로그인 + 가짜 Supabase. 돌려주는 배열에 RPC 호출이 쌓인다 */
async function fakeSupabase(page: Page, who: typeof TEACHER, teacher: boolean, extra: Record<string, Handler> = {}) {
  const calls: { fn: string; body: Record<string, unknown> | null }[] = [];
  const session = sessionFor(who);
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(session)] as const);
  const handlers: Record<string, Handler> = {
    am_i_teacher: () => ({ json: teacher }),
    my_screen_request: () => ({ json: [] }),
    report_live_status: () => ({ status: 200, json: null }),
    class_live_status: () => (teacher ? { json: liveRows() } : { status: 403, json: { code: '42501', message: '선생님 계정만 볼 수 있어요' } }),
    cg_class_overview: () => (teacher ? { json: cgRows() } : { status: 403, json: { code: '42501', message: '선생님 계정만 볼 수 있어요' } }),
    course_class_overview: () => ({ json: [] }),
    db_class_overview: () => ({ json: DB_ROWS }),
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
  return calls;
}

async function open(page: Page, path: string) {
  await page.goto(`./#${path}`);
}

test.describe('선생님 화면·실시간 학습 위치(가짜 로그인)', () => {
  test('학생: 선생님 링크가 없고 /teacher는 자료를 읽지 않으며, 상단에 학습 위치 공유 표시', async ({ page }) => {
    const calls = await fakeSupabase(page, STUDENT, false);
    await open(page, '/computer');
    await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible();
    const flag = page.getByRole('button', { name: '학습 위치 공유 중' });
    await expect(flag).toBeVisible();
    await expect(flag).toHaveAttribute('title', /화면 내용은 아님/);
    await flag.click();
    await expect(page.getByRole('tooltip')).toContainText('선생님이 지금 공부 중인 과목·단원·단계를 볼 수 있어요(화면 내용은 아님)');
    await expect(page.getByRole('link', { name: '선생님 화면' })).toHaveCount(0);
    // 학습 위치를 보낸다: 과목·위치·집중 상태만(화면 내용 없음)
    await expect.poll(() => calls.filter((c) => c.fn === 'report_live_status').length).toBeGreaterThan(0);
    const st = calls.find((c) => c.fn === 'report_live_status')!.body!.p_state as Record<string, unknown>;
    expect(st).toMatchObject({ v: 1, subject: 'cg', path: '/computer', label: '단원 목록', focus: 'menu', sharing: false });
    expect(Object.keys(st).sort()).toEqual(['detail', 'dev', 'focus', 'fs', 'label', 'locks', 'path', 'sharing', 'step', 'subject', 'unit', 'v']);
    expect(st.dev).toMatch(/^[a-z0-9]{1,16}$/); // 기기 구분용 임의 번호
    // 선생님 요청 확인(5초마다)도 돈다
    await expect.poll(() => calls.some((c) => c.fn === 'my_screen_request')).toBe(true);

    await open(page, '/');
    await expect(page.getByRole('heading', { name: '무엇을 공부할까요?' })).toBeVisible();
    await expect(page.getByRole('button', { name: '학습 위치 공유 중' })).toBeVisible();
    await expect(page.getByRole('link', { name: '선생님 화면' })).toHaveCount(0);

    await open(page, '/garden');
    await expect(page.locator('header.topbar')).toBeVisible();
    await expect(page.getByRole('button', { name: '학습 위치 공유 중' })).toBeVisible();
    await expect(page.getByRole('link', { name: '선생님 화면' })).toHaveCount(0);

    // 휴대폰 너비: 공유 표시가 붙어도 상단바가 가로로 넘치지 않는다
    await page.setViewportSize({ width: 390, height: 844 });
    for (const p of ['/computer', '/garden', '/']) {
      await open(page, p);
      await expect(page.getByRole('button', { name: '학습 위치 공유 중' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), p).toBe(true);
    }

    await open(page, '/teacher');
    await expect(page.getByText('이 화면은 학교에서 지정한 선생님 계정만 볼 수 있어요.')).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(0);
    expect(calls.some((c) => ['class_live_status', 'cg_class_overview', 'course_class_overview', 'db_class_overview'].includes(c.fn))).toBe(false);
  });

  test('선생님: 과목마다 선생님 화면 링크 → 그 과목 탭, 7과목 탭, 실시간 모니터링 격자', async ({ page }) => {
    const calls = await fakeSupabase(page, TEACHER, true);
    await open(page, '/computer');
    const link = page.getByRole('link', { name: '선생님 화면' });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/#\/teacher\?s=cg$/);
    await expect(page.getByRole('heading', { name: '선생님 화면' })).toBeVisible();
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveText(['실시간 모니터링', '데이터베이스', '컴퓨터 일반', '네트워크', '프로그래밍', 'Data', '2진법 이해', 'IP 이해', '계정 관리']);
    await expect(page.getByRole('tab', { name: '컴퓨터 일반' })).toHaveAttribute('aria-selected', 'true');

    // 컴퓨터 일반: 더 자세히(단원별 통과율·많이 틀린 문항·학생 서랍)
    await expect(page.getByRole('heading', { name: '단원별 통과율' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '많이 틀린 문항' })).toBeVisible();
    await expect(page.getByText('틀린 학생 2명(100%)')).toBeVisible();
    // 학생 계정만(기본 켬): 선생님 테스트 계정은 반 통계·표에서 빠지고, 학번 열·학번순
    const only = page.getByRole('checkbox', { name: '학생 계정만' });
    await expect(only).toBeChecked();
    await expect(page.getByText('학생 계정(학번 형식)이 아닌 1명은 통계·표·CSV에서 뺐어요.')).toBeVisible();
    const cls = page.locator('table.cg-class');
    await expect(cls.getByRole('columnheader', { name: /학번/ })).toBeVisible();
    await expect(cls.locator('tbody tr')).toHaveCount(2);
    await expect(cls.locator('tbody tr').first()).toContainText('10101');
    await expect(cls.locator('tbody tr').first()).toContainText('2096 · 1학년 1반 1번');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV 저장' }).click()]);
    const csvText = readFileSync((await dl.path())!, 'utf8');
    expect(csvText.split('\r\n')[0]).toContain('이름,이메일,연도,학번,학년·반·번호,식물');
    expect(csvText).toContain('가온,sai_209610101@seoulai.sen.hs.kr,2096,10101,1학년 1반 1번,');
    expect(csvText).not.toContain('teacher@school.example');
    await only.uncheck();
    await expect(page.getByText('틀린 학생 3명(100%)')).toBeVisible();
    await expect(cls.locator('tbody tr')).toHaveCount(3);
    await only.check();
    await expect(page.getByText('틀린 학생 2명(100%)')).toBeVisible();
    await page.getByRole('button', { name: '가온' }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('heading', { name: '가온' })).toBeVisible();
    await expect(drawer).toContainText('학번 2096 · 10101 · 1학년 1반 1번');
    await expect(drawer.getByRole('heading', { name: '모의고사 (2회)' })).toBeVisible();
    await expect(drawer).toContainText('랜덤 모의고사 · 시간 종료');
    await expect(drawer).toContainText('27/30');
    await drawer.getByRole('button', { name: '닫기' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // 실시간 모니터링
    await page.getByRole('tab', { name: '실시간 모니터링' }).click();
    await expect(page).toHaveURL(/#\/teacher\?s=live$/);
    const grid = page.getByRole('list', { name: '학생별 실시간 학습 상태' });
    await expect(grid.getByRole('listitem')).toHaveCount(4);
    // 상태순: 잠김 → 자리 비움 → … → 집중 학습 중 → 오프라인
    await expect(grid.locator('.t-live-name')).toHaveText(['나래', '다온', '가온', '라온']);
    const gaon = grid.getByRole('listitem').filter({ hasText: '가온' });
    await expect(gaon).toContainText('학번 2096 · 10101 · 1학년 1반 1번');
    // 학생 계정만(기본 켬): 선생님 테스트 계정은 숨김, 끄면 보임, 학번순 정렬
    await expect(page.getByText('학생 계정이 아닌 1명 숨김')).toBeVisible();
    await page.getByRole('checkbox', { name: '학생 계정만' }).uncheck();
    await expect(grid.getByRole('listitem')).toHaveCount(5);
    await page.getByLabel('정렬').selectOption('sid');
    await expect(grid.locator('.t-live-name')).toHaveText(['가온', '나래', '다온', '라온', '김선생']);
    await page.getByRole('checkbox', { name: '학생 계정만' }).check();
    await page.getByLabel('정렬').selectOption('status');
    await expect(grid.getByRole('listitem')).toHaveCount(4);
    await expect(gaon).toContainText('집중 학습 중');
    await expect(gaon).toContainText('3단원 · 3단계 기초 객관식');
    await expect(gaon).toContainText('문항 7/20');
    await expect(gaon).toContainText(/\d+초 전/);
    await expect(gaon).toContainText('잠김 1/5');
    await expect(grid.getByRole('listitem').filter({ hasText: '나래' })).toContainText('잠김');
    await expect(grid.getByRole('listitem').filter({ hasText: '다온' })).toContainText('자리 비움');
    const raon = grid.getByRole('listitem').filter({ hasText: '라온' });
    await expect(raon).toContainText('오프라인');
    await expect(raon.getByRole('button', { name: '화면 보기 요청' })).toBeDisabled();
    await expect(gaon.getByRole('button', { name: '화면 보기 요청' })).toBeEnabled();
    await page.getByLabel('과목').selectOption('net');
    await expect(grid.getByRole('listitem')).toHaveCount(1);
    await expect(grid).toContainText('나래');
    // 5초마다 새로고침
    const before = calls.filter((c) => c.fn === 'class_live_status').length;
    await expect.poll(() => calls.filter((c) => c.fn === 'class_live_status').length, { timeout: 12000 }).toBeGreaterThan(before);
    expect(calls.find((c) => c.fn === 'class_live_status')!.body).toEqual({ p_minutes: 10 });

    // 데이터베이스 탭
    await page.getByRole('tab', { name: '데이터베이스' }).click();
    await expect(page.getByRole('heading', { name: '완료한 단원 수 분포' })).toBeVisible();
    // 학생 계정만: 선생님 테스트 계정(9,900XP)은 요약·표에서 빠짐, 학번순
    await expect(page.getByText('학생 계정(학번 형식)이 아닌 1명은 통계·표·CSV에서 뺐어요.')).toBeVisible();
    await expect(page.locator('.kpi').filter({ hasText: '12단원 모두 완료' }).locator('b')).toHaveText('0');
    await expect(page.locator('table.data').last().locator('tbody tr th')).toHaveText([/가온/, /다온/]);
    await page.getByRole('checkbox', { name: '학생 계정만' }).uncheck();
    await expect(page.locator('.kpi').filter({ hasText: '12단원 모두 완료' }).locator('b')).toHaveText('1');
    await page.getByRole('checkbox', { name: '학생 계정만' }).check();
    await page.getByRole('button', { name: '다온' }).click();
    await expect(page.getByRole('dialog')).toContainText('반 평균');
    await page.keyboard.press('Escape');

    // 다른 과목 화면의 상단바에도 링크(그 과목 탭)
    await open(page, '/');
    await expect(page.getByRole('link', { name: '선생님 화면' })).toHaveAttribute('href', '#/teacher');
    await open(page, '/db');
    await expect(page.getByRole('link', { name: '선생님 화면' })).toHaveAttribute('href', '#/teacher?s=db');
    await open(page, '/garden');
    await expect(page.getByRole('link', { name: '선생님 화면' })).toHaveAttribute('href', '#/teacher?s=db');
    await open(page, '/network');
    await expect(page.getByRole('link', { name: '선생님 화면' })).toHaveAttribute('href', '#/teacher?s=net');
    await open(page, '/ip');
    await expect(page.getByRole('link', { name: '선생님 화면' })).toHaveAttribute('href', '#/teacher?s=ip');
    // 예전 '반 학습 현황' 주소는 선생님 화면의 그 과목 탭으로
    await open(page, '/programming/teacher');
    await expect(page).toHaveURL(/#\/teacher\?s=prog$/);
    await expect(page.getByRole('tab', { name: '프로그래밍' })).toHaveAttribute('aria-selected', 'true');
  });

  test('서버에 migration이 아직 없으면 분명하게 안내', async ({ page }) => {
    const missing = (fn: string) => () => ({ status: 404, json: { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` } });
    await fakeSupabase(page, TEACHER, true, {
      class_live_status: missing('class_live_status(p_minutes)'),
      course_class_overview: () => ({ status: 400, json: { code: '22023', message: '알 수 없는 과목입니다' } }),
    });
    await open(page, '/teacher');
    await expect(page.getByRole('alert')).toContainText('supabase/migrations/20261026010000_monitoring.sql');
    await page.getByRole('tab', { name: '2진법 이해' }).click();
    await expect(page.getByRole('alert')).toContainText('20261026000000_courses.sql');
  });

  test('화면 공유 WebRTC: 학생(캔버스 영상) → 선생님 연결·영상 수신 → 학생이 멈추면 선생님 쪽도 끝', async ({ page }) => {
    await page.goto('./');
    const r = await page.evaluate(async (path) => {
      const m = await import(/* @vite-ignore */ path);
      const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
      // 메모리 속 가짜 RPC(상태 전이는 서버와 같은 규칙)
      const row = { status: 'requested', offer: null as string | null, answer: null as string | null };
      let offerSeen = '';
      const api = {
        report: async () => {}, classLive: async () => [], myRequest: async () => null,
        requestScreen: async () => 'id1',
        getScreen: async () => ({ status: row.status, offer: row.status === 'offered' ? row.offer : null }),
        answerScreen: async (_: string, sdp: string) => {
          if (row.status !== 'offered') throw new Error('응답할 수 없어요');
          row.answer = sdp;
          row.status = 'answered';
          return 'answered';
        },
        respond: async (_: string, ok: boolean) => ((row.status = ok ? 'accepted' : 'declined'), row.status),
        offerScreen: async (_: string, sdp: string) => {
          if (row.status !== 'accepted') throw new Error('제안할 수 없어요');
          row.offer = offerSeen = sdp;
          row.status = 'offered';
          return 'offered';
        },
        getAnswer: async () => ({ status: row.status, answer: row.status === 'answered' ? row.answer : null }),
        endScreen: async () => {
          if (row.status !== 'declined') row.status = 'ended';
          row.offer = row.answer = null;
        },
      };
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 200;
      const ctx = canvas.getContext('2d')!;
      let i = 0;
      const iv = setInterval(() => {
        ctx.fillStyle = `hsl(${(i += 20) % 360} 70% 50%)`;
        ctx.fillRect(0, 0, 320, 200);
      }, 50);
      const stream = canvas.captureStream(15);
      const makePc = () => new RTCPeerConnection({ iceServers: [] });
      const viewer = new m.ViewerSession(api, 'student', { pollMs: 100, livePollMs: 200, makePc });
      void viewer.start();
      await sleep(200);
      const share = new m.ShareSession(api, 'id1', { capture: async () => stream, pollMs: 100, livePollMs: 200, makePc });
      void share.start();
      const t0 = Date.now();
      while ((viewer.state.phase !== 'live' || share.state.phase !== 'live') && Date.now() - t0 < 15000) await sleep(100);
      const phases = [viewer.state.phase, share.state.phase];
      let width = 0;
      if (viewer.state.stream) {
        const v = document.createElement('video');
        v.muted = true;
        v.srcObject = viewer.state.stream;
        document.body.append(v);
        await v.play().catch(() => {});
        const t1 = Date.now();
        while (!v.videoWidth && Date.now() - t1 < 5000) await sleep(100);
        width = v.videoWidth;
      }
      share.close();
      const t2 = Date.now();
      while (viewer.state.phase === 'live' && Date.now() - t2 < 5000) await sleep(100);
      clearInterval(iv);
      return { phases, width, nonTrickle: /a=candidate/.test(offerSeen), after: [viewer.state.phase, share.state.phase], cleared: row.offer === null && row.answer === null, trackEnded: stream.getVideoTracks()[0].readyState };
    }, '/src/features/monitor/rtc.ts');
    expect(r.phases).toEqual(['live', 'live']);
    expect(r.width).toBe(320);
    expect(r.nonTrickle).toBe(true); // ICE 후보가 SDP 안에 다 들어 있음(한 번에 전달)
    expect(r.after).toEqual(['ended', 'ended']);
    expect(r.cleared).toBe(true);
    expect(r.trackEnded).toBe('ended'); // 학생 쪽 화면 캡처도 멈춤
  });

  test('화면 공유 요청 허락 창(가짜 요청) · 거절하면 서버에 거절을 알림', async ({ page }) => {
    let asked = false;
    const calls = await fakeSupabase(page, STUDENT, false, {
      my_screen_request: () => ({ json: asked ? [] : [{ id: 'req-1', teacher_name: '김선생' }] }),
      respond_screen: () => {
        asked = true;
        return { json: 'declined' };
      },
    });
    await open(page, '/computer');
    const dlg = page.getByRole('dialog', { name: '화면 보기 요청' });
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('선생님(김선생)이 화면 보기를 요청했어요. 공유하면 선택한 화면이 선생님에게 실시간으로 보여요(녹화·저장하지 않아요).');
    // 처음 포커스는 창 자체(허락 버튼이 아님), 뜬 직후 잠깐은 누를 수 없고 곧 누를 수 있다
    await expect(dlg).toBeFocused();
    await expect(dlg.getByRole('button', { name: '화면 공유하기' })).toBeEnabled();
    await dlg.getByRole('button', { name: '거절' }).click();
    await expect(dlg).toHaveCount(0);
    await expect.poll(() => calls.find((c) => c.fn === 'respond_screen')?.body).toEqual({ p_id: 'req-1', p_accept: false });
  });

  test('단원 집중 학습 중 화면 공유 허락: 선택 창 때문에 포커스를 잃어도 잠김으로 세지 않고, 공유 뒤에는 보통 규칙', async ({ page }) => {
    let requested = false;
    let answer = 'offered';
    const calls = await fakeSupabase(page, STUDENT, false, {
      my_screen_request: () => ({ json: requested ? [{ id: 'req-2', teacher_name: '김선생' }] : [] }),
      respond_screen: () => {
        requested = false;
        return { json: 'accepted' };
      },
      offer_screen: () => ({ json: 'offered' }),
      get_screen_answer: () => ({ json: [{ status: answer, answer: null }] }),
      end_screen: () => ({ json: null }),
    });
    // 브라우저 선택 창 흉내: 열리는 동안 이 창이 포커스를 잃었다가(blur) 돌아온 뒤 캔버스 영상을 준다
    await page.addInitScript(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        document.hasFocus = () => false;
        window.dispatchEvent(new Event('blur'));
        await new Promise((r) => setTimeout(r, 700));
        document.hasFocus = () => true;
        window.dispatchEvent(new Event('focus'));
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 48;
        c.getContext('2d')!.fillRect(0, 0, 64, 48);
        return c.captureStream(5);
      };
    });
    await open(page, '/computer/unit/U1');
    const overlay = page.getByTestId('focus-overlay');
    await overlay.getByRole('button', { name: /학습 시작$/ }).click();
    await expect(overlay).toHaveCount(0);
    await page.waitForTimeout(1700);
    requested = true;
    const dlg = page.getByRole('dialog', { name: '화면 보기 요청' });
    await expect(dlg).toBeVisible({ timeout: 12000 });
    await dlg.getByRole('button', { name: '화면 공유하기' }).click();
    const banner = page.locator('.share-banner');
    await expect(banner).toContainText(/선생님에게 (연결하는 중|화면을 보여 주는 중)/, { timeout: 12000 });
    await expect(banner.getByRole('button', { name: '공유 중지' })).toBeVisible();
    // 선택 창 동안의 blur는 잠김이 아니다
    await expect(overlay).toHaveCount(0);
    await expect(page.locator('.strict-bar')).toContainText('잠김 0/5');
    expect(calls.find((c) => c.fn === 'respond_screen')!.body).toEqual({ p_id: 'req-2', p_accept: true });
    // 화면을 고른 순간 '공유 중지'가 보이고(연결 정보 준비 중), 곧 연결 정보(SDP)를 보낸다
    await expect.poll(() => String(calls.find((c) => c.fn === 'offer_screen')?.body?.p_sdp ?? ''), { timeout: 10000 }).toMatch(/^v=0/);
    await expect.poll(() => calls.some((c) => c.fn === 'report_live_status' && (c.body!.p_state as { sharing?: boolean }).sharing === true)).toBe(true);
    await expect(page.getByRole('button', { name: '학습 위치 공유 중' })).toHaveClass(/sharing/);
    // 선생님이 끝내면 공유도 끝
    answer = 'ended';
    await expect(page.locator('.share-note')).toContainText('선생님이 화면 보기를 끝냈어요.');
    await expect(banner.getByRole('button', { name: '공유 중지' })).toHaveCount(0);
    expect(calls.some((c) => c.fn === 'end_screen')).toBe(true);
    // 그 뒤 다른 창으로 가면 보통처럼 잠김 1회
    await page.evaluate(() => {
      document.hasFocus = () => false;
      window.dispatchEvent(new Event('blur'));
    });
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText('(1/5)');
  });

  test('선택 창 동안 탭이 숨겨지면 유예 없이 바로 멈춤(잠김으로 세지 않음), 잠김 화면 위의 공유 중지는 키보드로 누를 수 있다', async ({ page }) => {
    let requested = false;
    const calls = await fakeSupabase(page, STUDENT, false, {
      my_screen_request: () => ({ json: requested ? [{ id: 'req-3', teacher_name: '김선생' }] : [] }),
      respond_screen: () => {
        requested = false;
        return { json: 'accepted' };
      },
      offer_screen: () => ({ json: 'offered' }),
      get_screen_answer: () => ({ json: [{ status: 'offered', answer: null }] }),
      end_screen: () => ({ json: null }),
    });
    // 선택 창을 연 채로 다른 탭으로 감(hidden) → 돌아와서 화면을 고름
    await page.addInitScript(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        await new Promise((r) => setTimeout(r, 500));
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('focus'));
        const c = document.createElement('canvas');
        c.getContext('2d')!.fillRect(0, 0, 10, 10);
        return c.captureStream(5);
      };
    });
    await open(page, '/computer/unit/U1');
    const overlay = page.getByTestId('focus-overlay');
    await overlay.getByRole('button', { name: /학습 시작$/ }).click();
    await expect(overlay).toHaveCount(0);
    await page.waitForTimeout(1700);
    requested = true;
    const dlg = page.getByRole('dialog', { name: '화면 보기 요청' });
    await expect(dlg).toBeVisible({ timeout: 12000 });
    await dlg.getByRole('button', { name: '화면 공유하기' }).click();
    await expect(overlay).toBeVisible();
    await expect(overlay.getByRole('heading', { name: '화면 공유 창 때문에 멈췄어요' })).toBeVisible();
    await expect(overlay).toContainText('잠김 0/5');
    const stop = page.locator('.share-banner').getByRole('button', { name: '공유 중지' });
    await expect(stop).toBeVisible();
    await stop.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.share-note')).toContainText('화면 공유를 멈췄어요.');
    await expect.poll(() => calls.some((c) => c.fn === 'end_screen')).toBe(true);
    await overlay.getByRole('button', { name: /다시 시작$/ }).click();
    await expect(overlay).toHaveCount(0);
    await expect(page.locator('.strict-bar')).toContainText('잠김 0/5');
  });

  test('스크린샷(선생님 화면, 가짜 자료): 1280px·390px', async ({ page }) => {
    const dir = process.env.TEACHER_SHOTS;
    test.skip(!dir, 'TEACHER_SHOTS=저장 폴더를 주면 스크린샷을 남긴다');
    await fakeSupabase(page, TEACHER, true);
    for (const w of [1280, 390]) {
      await page.setViewportSize({ width: w, height: w > 600 ? 900 : 844 });
      await open(page, '/teacher?s=live');
      await expect(page.getByRole('list', { name: '학생별 실시간 학습 상태' }).getByRole('listitem')).toHaveCount(4);
      await page.screenshot({ path: `${dir}/teacher-live-${w}.png`, fullPage: true });
      await open(page, '/teacher?s=cg');
      await expect(page.getByRole('heading', { name: '단원별 통과율' })).toBeVisible();
      await page.screenshot({ path: `${dir}/teacher-cg-${w}.png`, fullPage: true });
      await page.getByRole('button', { name: '가온' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.screenshot({ path: `${dir}/teacher-cg-drawer-${w}.png` });
      await page.keyboard.press('Escape');
      // 페이지 가로 넘침 없음
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    }
  });
});
