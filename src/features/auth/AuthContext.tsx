import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { isDemoEnabled, isSupabaseConfigured } from '../../lib/config';
import { learnerPrefix, readRaw, removeRaw, removeWithPrefix, writeRaw } from '../../lib/storage';
import { signInWithGoogle, supabase, takeAuthError } from './supabase';

export type Identity =
  | { kind: 'demo'; learnerKey: 'demo' }
  | { kind: 'user'; learnerKey: string; userId: string; email: string | null; name: string | null };

interface AuthCtx {
  status: 'loading' | 'signed-out' | 'ready';
  identity: Identity | null;
  authError: string | null;
  /** 세션 만료 등으로 로그아웃된 경우(초안은 보존) */
  expired: boolean;
  signIn: (returnPath: string) => Promise<void>;
  signOut: () => Promise<void>;
  startDemo: () => void;
  exitDemo: () => void;
  clearError: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);
export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider 없음');
  return c;
};

const DEMO_FLAG = 'sqlforest:demo-active';
/** 사용자가 직접 로그아웃했는지(아니면 세션 만료로 본다) */
let explicitSignOut = false;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthCtx['status']>('loading');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [authError, setAuthError] = useState<string | null>(() => takeAuthError());
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const sb = supabase();
    const demo = isDemoEnabled && readRaw(DEMO_FLAG) === '1';
    if (!sb) {
      setIdentity(demo ? { kind: 'demo', learnerKey: 'demo' } : null);
      setStatus(demo ? 'ready' : 'signed-out');
      return;
    }
    let alive = true;
    sb.auth.getSession().then(({ data }) => {
      if (!alive) return;
      const u = data.session?.user;
      if (u) {
        setIdentity({ kind: 'user', learnerKey: `user:${u.id}`, userId: u.id, email: u.email ?? null, name: (u.user_metadata?.full_name as string | undefined) ?? null });
        setStatus('ready');
      } else if (demo) {
        setIdentity({ kind: 'demo', learnerKey: 'demo' });
        setStatus('ready');
      } else {
        setStatus('signed-out');
      }
    });
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setIdentity((prev) => {
          if (prev?.kind === 'user' && !explicitSignOut) setExpired(true);
          explicitSignOut = false;
          return prev?.kind === 'user' ? null : prev;
        });
        setStatus((s) => (s === 'ready' ? 'signed-out' : s));
      } else if (session?.user && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION')) {
        const u = session.user;
        setIdentity((prev) => (prev?.kind === 'user' && prev.userId === u.id ? prev : { kind: 'user', learnerKey: `user:${u.id}`, userId: u.id, email: u.email ?? null, name: (u.user_metadata?.full_name as string | undefined) ?? null }));
        setExpired(false);
        setStatus('ready');
      }
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (returnPath: string) => {
    const err = await signInWithGoogle(returnPath);
    if (err) setAuthError(err);
  }, []);

  const signOut = useCallback(async () => {
    const sb = supabase();
    const prev = identity;
    explicitSignOut = true;
    if (sb) await sb.auth.signOut();
    // 로그아웃: 이 사용자의 로컬 캐시를 지워 다음 사용자에게 보이지 않게 한다.
    if (prev?.kind === 'user') removeWithPrefix(learnerPrefix(prev.learnerKey));
    setIdentity(null);
    setExpired(false);
    setStatus('signed-out');
  }, [identity]);

  const startDemo = useCallback(() => {
    if (!isDemoEnabled) return;
    writeRaw(DEMO_FLAG, '1');
    setIdentity({ kind: 'demo', learnerKey: 'demo' });
    setStatus('ready');
  }, []);

  const exitDemo = useCallback(() => {
    removeRaw(DEMO_FLAG);
    setIdentity(null);
    setStatus('signed-out');
  }, []);

  return (
    <Ctx.Provider value={{ status, identity, authError, expired, signIn, signOut, startDemo, exitDemo, clearError: () => setAuthError(null) }}>
      {children}
    </Ctx.Provider>
  );
}

export { isSupabaseConfigured, isDemoEnabled };
