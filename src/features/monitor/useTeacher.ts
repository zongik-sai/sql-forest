import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../auth/supabase';

/**
 * 선생님 계정인지(am_i_teacher RPC, 사용자마다 한 번만 묻고 기억). 화면 메뉴를 보일지 정하는 데만 쓴다:
 * 실제 권한은 선생님용 RPC(class_live_status·cg_class_overview …)가 서버에서 다시 확인한다.
 * 결과: true/false, 아직 모르면 null.
 */
const cache = new Map<string, Promise<boolean>>();

export function askTeacher(userId: string): Promise<boolean> {
  const sb = supabase();
  if (!sb) return Promise.resolve(false);
  let p = cache.get(userId);
  if (!p) {
    p = Promise.resolve(sb.rpc('am_i_teacher')).then(
      ({ data, error }) => {
        if (error) cache.delete(userId); // 다음에 다시 물어봄(일시적 오류)
        return !error && data === true;
      },
      () => {
        cache.delete(userId);
        return false;
      },
    );
    cache.set(userId, p);
  }
  return p;
}

export function useIsTeacher(): boolean | null {
  const auth = useAuth();
  const uid = auth.identity?.kind === 'user' ? auth.identity.userId : null;
  const [known, setKnown] = useState<{ uid: string; value: boolean } | null>(null);
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    void askTeacher(uid).then((value) => {
      if (alive) setKnown({ uid, value });
    });
    return () => {
      alive = false;
    };
  }, [uid]);
  if (auth.status === 'loading') return null;
  if (!uid) return false;
  return known?.uid === uid ? known.value : null;
}
