/**
 * OAuth 복귀 경로 처리(순수 함수, 테스트 대상).
 * GitHub Pages에는 SPA rewrite가 없으므로 Google/Supabase는 앱 프로젝트 루트(…/REPO/)로 돌아오고,
 * 앱은 Router 렌더 전에 ?code=를 처리한 뒤 안전한 내부 hash 경로로 이동한다.
 */

const SAFE = /^\/[A-Za-z0-9/_-]*$/;

/** 내부 hash 경로만 허용: '/learn/U01' 같은 형태. 외부 URL·스킴·'//'·'..'는 거부. */
export function sanitizeReturnPath(p: string | null | undefined): string | null {
  if (!p) return null;
  const s = p.trim();
  if (!s.startsWith('/') || s.startsWith('//') || s.includes('..') || s.includes('\\')) return null;
  if (!SAFE.test(s)) return null;
  if (s.length > 100) return null;
  return s;
}

export interface CallbackParams {
  code: string | null;
  error: string | null;
}

export function readCallbackParams(search: string): CallbackParams {
  const q = new URLSearchParams(search);
  const error = q.get('error_description') || q.get('error');
  return { code: q.get('code'), error };
}

/** code·error 등 OAuth query를 제거하고 hash 경로로 복귀할 URL */
export function cleanUrl(baseUrl: string, returnPath: string | null): string {
  const path = sanitizeReturnPath(returnPath) ?? '/'; // 복귀 경로가 없으면 과목 선택
  return `${baseUrl}#${path}`;
}

/** 앱 루트 redirect URL (hash를 callback으로 쓰지 않는다) */
export function appRootUrl(origin: string, baseUrl: string): string {
  return origin + baseUrl;
}

export const RETURN_KEY = 'sqlforest:returnTo';
export const AUTH_ERROR_KEY = 'sqlforest:authError';
