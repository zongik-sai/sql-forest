/**
 * 로그아웃 직전에 할 일(예: 진행 중인 화면 공유 끝내기). 로그인한 채로 서버 정리(end_screen)를 하려고
 * AuthContext.signOut이 Supabase 로그아웃 전에 기다린다(최대 2초, 실패해도 로그아웃은 계속).
 */
type Hook = () => Promise<void> | void;
const hooks = new Set<Hook>();

export function onBeforeSignOut(fn: Hook): () => void {
  hooks.add(fn);
  return () => {
    hooks.delete(fn);
  };
}

export async function runBeforeSignOut(timeoutMs = 2000): Promise<void> {
  if (!hooks.size) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled([...hooks].map((h) => Promise.resolve().then(h))),
    new Promise<void>((r) => {
      timer = setTimeout(r, timeoutMs);
    }),
  ]);
  clearTimeout(timer);
}
