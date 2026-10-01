import { describe, expect, it } from 'vitest';
import { checkSupabase, classifyKey } from '../../scripts/check-supabase.mjs';

const jwt = (role: string) => `x.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.y`;
type Route = (url: string, init?: RequestInit) => { status: number; body: unknown };
const fakeFetch = (route: Route) => (async (url: string, init?: RequestInit) => {
  const { status, body } = route(url, init);
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}) as unknown as typeof fetch;

const URL_ = 'https://abcd1234.supabase.co';
const KEY = 'sb_publishable_abc123';

describe('Supabase 설정 점검 스크립트', () => {
  it('키 종류 판정: 공개 키만 통과, 비밀 키는 거부', () => {
    expect(classifyKey('sb_publishable_x').safe).toBe(true);
    expect(classifyKey(jwt('anon'))).toEqual({ kind: 'legacy-anon', safe: true });
    expect(classifyKey('sb_secret_x').safe).toBe(false);
    expect(classifyKey(jwt('service_role'))).toEqual({ kind: 'legacy-service_role', safe: false });
    expect(classifyKey('').kind).toBe('missing');
  });
  it('올바른 설정: Google 켜짐 + migration 적용 + anon 차단 → 통과', async () => {
    const r = await checkSupabase({ url: URL_, key: KEY, fetch: fakeFetch((u) => {
      if (u.endsWith('/auth/v1/settings')) return { status: 200, body: { external: { google: true }, disable_signup: false } };
      if (u.includes('/rest/v1/reward_catalog')) return { status: 401, body: { code: '42501', message: 'permission denied for table reward_catalog' } };
      if (u.endsWith('/rpc/award_xp')) return { status: 401, body: { code: '42501' } };
      return { status: 500, body: {} };
    }) });
    expect(r.ok).toBe(true);
    expect(r.checks.filter((c) => c.status === 'fail')).toEqual([]);
  });
  it('migration 미적용·Google 꺼짐을 각각 찾아낸다', async () => {
    const r = await checkSupabase({ url: URL_, key: KEY, fetch: fakeFetch((u) => {
      if (u.endsWith('/auth/v1/settings')) return { status: 200, body: { external: { google: false } } };
      if (u.includes('/rest/v1/reward_catalog')) return { status: 404, body: { code: 'PGRST205' } };
      if (u.endsWith('/rpc/award_xp')) return { status: 404, body: { code: 'PGRST202' } };
      return { status: 500, body: {} };
    }) });
    expect(r.ok).toBe(false);
    expect(r.checks.filter((c) => c.status === 'fail').map((c) => c.name)).toEqual(['Google 로그인', 'migration(테이블)', 'migration(XP 함수)']);
  });
  it('비밀 키를 넣으면 네트워크 요청 없이 즉시 실패', async () => {
    let called = false;
    const r = await checkSupabase({ url: URL_, key: 'sb_secret_zzz', fetch: fakeFetch(() => { called = true; return { status: 200, body: {} }; }) });
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });
  it('URL에 경로가 붙어 있으면 실패', async () => {
    const r = await checkSupabase({ url: `${URL_}/rest/v1`, key: KEY });
    expect(r.ok).toBe(false);
  });
});
