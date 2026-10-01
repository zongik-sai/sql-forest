// Supabase 설정 점검(읽기 전용, 데이터를 쓰지 않음)
// 사용: npm run check:supabase   (.env.local 또는 환경변수의 VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY 사용)
import { existsSync, readFileSync } from 'node:fs';

/** 키 종류 판정: 브라우저에 넣어도 되는 공개 키인지 */
export function classifyKey(key) {
  if (!key) return { kind: 'missing', safe: false };
  if (key.startsWith('sb_publishable_')) return { kind: 'publishable', safe: true };
  if (key.startsWith('sb_secret_')) return { kind: 'secret', safe: false };
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      if (payload.role === 'anon') return { kind: 'legacy-anon', safe: true };
      if (payload.role === 'service_role') return { kind: 'legacy-service_role', safe: false };
    } catch {
      /* 아래로 */
    }
  }
  return { kind: 'unknown', safe: false };
}

/**
 * 응답이 정말 Supabase(JSON)에서 온 것인지 확인하고 본문을 읽는다.
 * problem이 있으면 그 응답으로는 판정하지 않는다(방화벽 페이지, 잘못된 키 등).
 * @param {Response} r
 */
async function readSupabase(r) {
  const type = (typeof r.headers?.get === 'function' ? r.headers.get('content-type') : null) ?? 'application/json';
  const text = await (typeof r.text === 'function' ? r.text() : r.json().then((b) => JSON.stringify(b)));
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  const snippet = String(text ?? '').replace(/\s+/g, ' ').slice(0, 120);
  if (body === undefined || !/json/i.test(type)) {
    return { ok: false, status: r.status, problem: `Supabase가 아닌 곳에서 온 응답이에요(HTTP ${r.status}: ${snippet}). 학교·회사 방화벽이나 프록시가 *.supabase.co를 막고 있는지 확인하세요.` };
  }
  const msg = String(body?.message ?? body?.msg ?? '');
  if (/invalid api key|no api key/i.test(msg)) {
    return { ok: false, status: r.status, body, problem: `키가 이 프로젝트 것이 아니에요(${msg}). Supabase → Settings → API Keys의 publishable 키를 다시 복사하세요.` };
  }
  return { ok: r.ok, status: r.status, body };
}

/**
 * @param {{ url: string, key: string, fetch?: typeof fetch }} opts
 * @returns {Promise<{ ok: boolean, checks: { name: string, status: 'pass'|'fail'|'warn', detail: string }[] }>}
 */
export async function checkSupabase({ url, key, fetch: f = globalThis.fetch }) {
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });
  const base = (url ?? '').trim().replace(/\/+$/, '');

  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) {
    add('프로젝트 URL', 'fail', `VITE_SUPABASE_URL 형식이 이상해요: '${url ?? ''}' (예: https://abcd1234.supabase.co, 끝에 경로 없이)`);
    return { ok: false, checks };
  }
  add('프로젝트 URL', 'pass', base);

  const k = classifyKey(key);
  if (!k.safe) {
    const why = k.kind === 'missing' ? '키가 비어 있어요.' : k.kind === 'secret' || k.kind === 'legacy-service_role' ? '비밀(secret/service_role) 키예요. 브라우저 앱에 넣으면 안 돼요. 즉시 빼고, 노출됐다면 Supabase에서 키를 재발급하세요.' : '키 형식을 알 수 없어요.';
    add('공개 키 종류', 'fail', why);
    return { ok: false, checks };
  }
  add('공개 키 종류', 'pass', k.kind === 'publishable' ? 'publishable 키(sb_publishable_…)' : '예전 anon 키(사용 가능, 2026년 말까지 publishable로 교체 권장)');

  const headers = { apikey: key, Authorization: k.kind === 'legacy-anon' ? `Bearer ${key}` : undefined };
  for (const h of Object.keys(headers)) if (headers[h] === undefined) delete headers[h];

  // 1) Google 로그인 사용 여부(공개 설정 엔드포인트)
  try {
    const res = await readSupabase(await f(`${base}/auth/v1/settings`, { headers }));
    if (res.problem) add('Google 로그인', 'fail', res.problem);
    else if (!res.ok) add('Google 로그인', 'fail', `인증 설정을 읽지 못했어요(HTTP ${res.status}). URL과 키가 같은 프로젝트 것인지 확인하세요.`);
    else {
      const s = res.body;
      if (s?.external?.google) add('Google 로그인', 'pass', 'Authentication → Sign In / Providers에서 Google이 켜져 있어요.');
      else add('Google 로그인', 'fail', 'Google provider가 꺼져 있어요. Authentication → Sign In / Providers → Google을 켜고 Client ID/Secret을 넣으세요.');
      if (s?.disable_signup) add('신규 가입', 'warn', '신규 가입이 막혀 있어요. 학생이 처음 로그인할 수 없으니 의도한 설정인지 확인하세요.');
    }
  } catch (e) {
    add('Google 로그인', 'fail', `연결 실패: ${e?.message ?? e}`);
  }

  // 2) migration 적용 + 비로그인 차단(쓰기 없이 확인)
  //    통과는 PostgREST가 직접 돌려준 '권한 없음'(42501)일 때만. 방화벽·프록시의 401/403이나
  //    잘못된 키 응답을 '차단됨'으로 착각하지 않는다.
  try {
    const res = await readSupabase(await f(`${base}/rest/v1/reward_catalog?select=reward_id&limit=1`, { headers }));
    const code = res.body?.code;
    if (res.problem) add('migration(테이블)', 'fail', res.problem);
    else if (res.status === 404 || code === 'PGRST205' || code === '42P01') add('migration(테이블)', 'fail', 'reward_catalog 테이블이 없어요. SQL Editor에서 supabase/migrations/20261001000000_sql_forest_v2.sql을 실행하세요.');
    else if (res.ok) add('migration(테이블)', 'fail', '비로그인(anon) 상태에서 보상 카탈로그가 읽혀요. migration의 권한(REVOKE/GRANT) 부분이 적용됐는지 확인하세요.');
    else if (code === '42501') add('migration(테이블)', 'pass', '테이블이 있고 비로그인 접근은 막혀 있어요.');
    else add('migration(테이블)', 'fail', `예상하지 못한 응답(HTTP ${res.status} ${code ?? ''} ${res.body?.message ?? ''})`.trim());
  } catch (e) {
    add('migration(테이블)', 'fail', `연결 실패: ${e?.message ?? e}`);
  }
  try {
    const res = await readSupabase(await f(`${base}/rest/v1/rpc/award_xp`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_reward_id: 'activity:U01-A01' }) }));
    const code = res.body?.code;
    if (res.problem) add('migration(XP 함수)', 'fail', res.problem);
    else if (res.status === 404 || code === 'PGRST202') add('migration(XP 함수)', 'fail', 'award_xp 함수가 없어요. migration SQL을 실행하세요.');
    else if (res.ok) add('migration(XP 함수)', 'fail', '비로그인 상태에서 award_xp가 실행돼요. migration의 함수 권한 부분을 다시 적용하세요.');
    else if (code === '42501' || code === '28000') add('migration(XP 함수)', 'pass', '함수가 있고 비로그인 실행은 막혀 있어요.');
    else add('migration(XP 함수)', 'fail', `예상하지 못한 응답(HTTP ${res.status} ${code ?? ''} ${res.body?.message ?? ''})`.trim());
  } catch (e) {
    add('migration(XP 함수)', 'fail', `연결 실패: ${e?.message ?? e}`);
  }

  add('Redirect URL', 'warn', '자동 확인 불가: Authentication → URL Configuration에 앱 주소(끝의 / 포함)와 http://localhost:5173/ 이 정확히 있는지 직접 확인하세요.');
  return { ok: !checks.some((c) => c.status === 'fail'), checks };
}

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, '')]));
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const env = { ...readEnvFile('.env.local'), ...process.env };
  const res = await checkSupabase({ url: env.VITE_SUPABASE_URL, key: env.VITE_SUPABASE_PUBLISHABLE_KEY });
  const icon = { pass: '✓', fail: '✗', warn: '!' };
  for (const c of res.checks) console.log(`${icon[c.status]} ${c.name}: ${c.detail}`);
  console.log(res.ok ? '\n설정 점검 통과(Redirect URL은 직접 확인)' : '\n고칠 항목이 있어요(✗).');
  process.exitCode = res.ok ? 0 : 1;
}
