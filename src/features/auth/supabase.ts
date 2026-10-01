import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { BASE_URL, SUPABASE_KEY, SUPABASE_URL, isSupabaseConfigured } from '../../lib/config';
import { sessionGet, sessionRemove, sessionSet } from '../../lib/storage';
import { AUTH_ERROR_KEY, RETURN_KEY, appRootUrl, cleanUrl, readCallbackParams, sanitizeReturnPath } from './returnPath';

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  client ??= createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      flowType: 'pkce',
      // 자동 URL 처리 대신 부팅 시 수동 exchange 하나만 사용(이중 exchange 방지)
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  return client;
}

/** Google 로그인 시작. 기본 scope(openid email profile)만 사용하고 Drive 등 추가 권한은 요청하지 않는다. */
export async function signInWithGoogle(returnPath: string): Promise<string | null> {
  const sb = supabase();
  if (!sb) return '로그인 설정(VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY)이 없어요.';
  const safe = sanitizeReturnPath(returnPath) ?? '/garden';
  sessionSet(RETURN_KEY, safe);
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: appRootUrl(window.location.origin, BASE_URL) },
  });
  return error ? error.message : null;
}

let exchanged = false;

/**
 * 앱 부팅 시 Router 렌더보다 먼저 호출. ?code= 가 있으면 PKCE 교환을 한 번만 수행하고,
 * 성공/실패와 관계없이 history.replaceState로 query를 지운 뒤 검증된 내부 hash 경로로 복귀한다.
 */
export async function handleOAuthCallback(): Promise<void> {
  const { code, error } = readCallbackParams(window.location.search);
  if (!code && !error) return;
  const returnTo = sessionGet(RETURN_KEY);
  sessionRemove(RETURN_KEY);
  if (error) sessionSet(AUTH_ERROR_KEY, error);
  const sb = supabase();
  if (code && sb && !exchanged) {
    exchanged = true;
    const { error: exErr } = await sb.auth.exchangeCodeForSession(code);
    if (exErr) sessionSet(AUTH_ERROR_KEY, exErr.message);
  } else if (code && !sb) {
    sessionSet(AUTH_ERROR_KEY, '로그인 설정이 없어 로그인 결과를 처리할 수 없어요.');
  }
  window.history.replaceState(null, '', cleanUrl(BASE_URL, returnTo));
}

export function takeAuthError(): string | null {
  const e = sessionGet(AUTH_ERROR_KEY);
  if (e) sessionRemove(AUTH_ERROR_KEY);
  return e;
}
