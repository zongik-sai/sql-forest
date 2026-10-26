import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { learnerPrefix, readJson, removeRaw, removeWithPrefix, UNSYNCED_SUFFIX, writeJson, writeRaw } from '../../lib/storage';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../auth/supabase';
import { useCourse, type CourseConfig } from './course';
import { hasProgress, mergeCgStates, normalizeCgState, plantStage, type CgState } from './model';

/**
 * 단원 × 5단계 과목 기록 저장소(지금 과목 = useCourse()).
 * - 로그인: 이 기기에 사본을 두고 Supabase에 저장. 컴퓨터 일반은 cg_progress(본인 행)·save_cg_progress,
 *   새 과목은 course_progress(본인 × 과목 행)·save_course_progress(p_course). revision이 다르면 서버본과 병합 후 다시 저장.
 * - 로그인 없이 둘러보기: 이 기기에만 저장(guest). 로그인하면 "내 계정으로 가져오기" 안내(과목별).
 * - 로그아웃하면 AuthContext가 이 사용자의 기기 사본(학습자 키로 시작하는 모든 키)을 지운다.
 * 이 기기 저장 키: `${learnerPrefix}${course.storage}:state`·`:rev`(컴퓨터 일반 'cg:', 네트워크 'net:' …)
 */
export type CgSaveStatus = 'local' | 'saving' | 'saved' | 'offline' | 'error';

interface CgCtx {
  state: CgState;
  commit: (fn: (s: CgState) => CgState) => void;
  mode: 'guest' | 'user' | 'demo';
  saveStatus: CgSaveStatus;
  loading: boolean;
  isTeacher: boolean;
  /** 로그인 사용자에게: 로그인 없이 이 기기에 남긴 기록 */
  guestToImport: CgState | null;
  importGuest: () => void;
  discardGuest: () => void;
  /** 식물 단계가 올라갔을 때 알림(표시 후 지움) */
  grewTo: number | null;
  clearGrew: () => void;
  /** 저장 대기 중인 기록을 지금 서버로 보낸다. 모두 저장됐으면 true(로그아웃 전에 호출) */
  flush: () => Promise<boolean>;
}

const Ctx = createContext<CgCtx | null>(null);
export const useCg = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('CgProvider 없음');
  return c;
};

const GUEST_KEY = 'guest';
const stateKeyOf = (learnerKey: string, seg: string) => `${learnerPrefix(learnerKey)}${seg}:state`;
const revKeyOf = (learnerKey: string, seg: string) => `${learnerPrefix(learnerKey)}${seg}:rev`;
const SAVE_DELAY = 1200;

type SaveResult = { status: 'ok' | 'conflict'; revision: number; state?: unknown };

/** 서버 기록 읽기(본인 행) */
export async function loadRemote(sb: SupabaseClient, course: CourseConfig) {
  const r = course.remote;
  const q = r.kind === 'cg'
    ? sb.from('cg_progress').select('state, revision').maybeSingle()
    : sb.from('course_progress').select('state, revision').eq('course', r.course).maybeSingle();
  const { data, error } = await q;
  return { data: data as { state: unknown; revision: number } | null, error };
}

/** 서버 저장(revision compare-and-set) */
export async function saveRemote(sb: SupabaseClient, course: CourseConfig, state: CgState, expected: number) {
  const r = course.remote;
  const { data, error } = r.kind === 'cg'
    ? await sb.rpc('save_cg_progress', { p_state: state, p_expected_revision: expected })
    : await sb.rpc('save_course_progress', { p_course: r.course, p_state: state, p_expected_revision: expected });
  return { data: data as SaveResult | null, error };
}

export function CgProvider({ children }: { children: ReactNode }) {
  const course = useCourse();
  const seg = course.storage;
  const auth = useAuth();
  const id = auth.identity;
  const mode: CgCtx['mode'] = !id ? 'guest' : id.kind === 'demo' ? 'demo' : 'user';
  const learnerKey = id ? id.learnerKey : GUEST_KEY;
  const stateKey = stateKeyOf(learnerKey, seg);
  const revKey = revKeyOf(learnerKey, seg);
  // 서버 저장이 확인될 때까지 남기는 표시: 다른 화면에서 로그아웃해도 저장 안 된 기록이 있음을 알 수 있게
  const unsyncedKey = `${learnerPrefix(learnerKey)}${seg}${UNSYNCED_SUFFIX}`;
  const courseRef = useRef(course);
  courseRef.current = course;
  const norm = useCallback((raw: unknown) => normalizeCgState(raw, courseRef.current), []);
  const merge = useCallback((a: CgState, b: CgState) => mergeCgStates(a, b, courseRef.current), []);

  const [state, setState] = useState<CgState>(() => normalizeCgState(readJson(stateKey, null), course));
  const [saveStatus, setSaveStatus] = useState<CgSaveStatus>('local');
  const [loading, setLoading] = useState(mode === 'user');
  const [isTeacher, setIsTeacher] = useState(false);
  const [guestToImport, setGuestToImport] = useState<CgState | null>(null);
  const [grewTo, setGrewTo] = useState<number | null>(null);
  const stateRef = useRef(state);
  const revRef = useRef<number>(readJson<number>(revKey, 0));
  const dirtyRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const readyRef = useRef(mode !== 'user');
  const retryRef = useRef<{ t: ReturnType<typeof setTimeout> | null; n: number }>({ t: null, n: 0 });
  const unmountedRef = useRef(false);

  // 사용자 전환 시 다시 읽기
  useEffect(() => {
    const s = norm(readJson(stateKey, null));
    stateRef.current = s;
    setState(s);
    revRef.current = readJson<number>(revKey, 0);
    readyRef.current = mode !== 'user';
    setLoading(mode === 'user');
    setSaveStatus(mode === 'user' ? 'saving' : 'local');
    setIsTeacher(false);
    if (mode === 'user') {
      const g = norm(readJson(stateKeyOf(GUEST_KEY, seg), null));
      setGuestToImport(hasProgress(g, courseRef.current) ? g : null);
    } else setGuestToImport(null);
  }, [stateKey, revKey, mode, seg, norm]);

  const writeLocal = useCallback((s: CgState) => writeJson(stateKey, s), [stateKey]);

  const pushNow = useCallback(async () => {
    const sb = supabase();
    if (mode !== 'user' || !sb || !readyRef.current || savingRef.current) return;
    if (!dirtyRef.current) return;
    savingRef.current = true;
    setSaveStatus('saving');
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        dirtyRef.current = false;
        const snapshot = stateRef.current;
        const { data, error } = await saveRemote(sb, courseRef.current, snapshot, revRef.current);
        if (error || !data) throw error ?? new Error('저장 응답 없음');
        const r = data;
        if (r.status === 'ok') {
          revRef.current = r.revision;
          writeJson(revKey, r.revision);
          if (!dirtyRef.current) {
            removeRaw(unsyncedKey);
            setSaveStatus('saved');
            return;
          }
          continue; // 저장 중에 또 바뀜 → 한 번 더
        }
        // 다른 기기가 먼저 저장: 병합 후 다시
        revRef.current = r.revision;
        const merged = merge(stateRef.current, norm(r.state));
        stateRef.current = merged;
        setState(merged);
        writeLocal(merged);
        dirtyRef.current = true;
      }
      dirtyRef.current = true;
      setSaveStatus('error');
    } catch {
      dirtyRef.current = true;
      setSaveStatus(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error');
    } finally {
      savingRef.current = false;
    }
    // 실패하면 잠시 뒤 다시(5초·15초·45초…, 최대 6번). 다음 변경·온라인 복귀 때도 다시 시도한다
    if (dirtyRef.current && !unmountedRef.current && retryRef.current.n < 6 && !retryRef.current.t) {
      const delay = 5000 * 3 ** retryRef.current.n;
      retryRef.current.n++;
      retryRef.current.t = setTimeout(() => {
        retryRef.current.t = null;
        void pushNowRef.current();
      }, delay);
    } else if (!dirtyRef.current) retryRef.current.n = 0;
  }, [mode, revKey, unsyncedKey, writeLocal, merge, norm]);
  const pushNowRef = useRef(pushNow);
  pushNowRef.current = pushNow;

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void pushNow(), SAVE_DELAY);
  }, [pushNow]);

  // 로그인 사용자: 서버 기록을 읽어 이 기기 사본과 병합
  useEffect(() => {
    if (mode !== 'user') return;
    const sb = supabase();
    if (!sb) {
      setLoading(false);
      setSaveStatus('local');
      return;
    }
    let alive = true;
    (async () => {
      const [row, teacher] = await Promise.all([
        loadRemote(sb, courseRef.current),
        sb.rpc('am_i_teacher'),
      ]);
      if (!alive) return;
      if (!teacher.error) setIsTeacher(teacher.data === true);
      if (row.error) {
        setSaveStatus('error');
        setLoading(false);
        readyRef.current = true;
        return;
      }
      const remote = row.data ? norm(row.data.state) : null;
      revRef.current = row.data?.revision ?? 0;
      writeJson(revKey, revRef.current);
      const local = stateRef.current;
      const merged = remote ? merge(local, remote) : local;
      stateRef.current = merged;
      setState(merged);
      writeLocal(merged);
      readyRef.current = true;
      setLoading(false);
      const differs = !remote || JSON.stringify(merged) !== JSON.stringify(remote);
      if (differs && (hasProgress(merged, courseRef.current) || !remote)) {
        dirtyRef.current = hasProgress(merged, courseRef.current);
        if (dirtyRef.current) {
          writeRaw(unsyncedKey, '1');
          void pushNow();
        }
        else setSaveStatus('saved');
      } else setSaveStatus('saved');
    })().catch(() => {
      if (!alive) return;
      setSaveStatus('error');
      setLoading(false);
      readyRef.current = true;
    });
    return () => {
      alive = false;
    };
  }, [mode, stateKey, revKey, unsyncedKey, pushNow, writeLocal, merge, norm]);

  // 같은 기기의 다른 탭에서 기록이 바뀌면 합친다(한 탭의 오래된 기록이 단원 초기화 등을 덮어쓰지 않게)
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.key !== stateKey || !e.newValue) return;
      try {
        const other = norm(JSON.parse(e.newValue));
        const merged = merge(stateRef.current, other);
        stateRef.current = merged;
        setState(merged);
      } catch {
        /* 무시 */
      }
    };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, [stateKey, merge, norm]);

  // 다시 온라인이 되거나 창을 떠날 때 저장
  useEffect(() => {
    const onOnline = () => void pushNow();
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        writeLocal(stateRef.current);
        void pushNow();
      }
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [pushNow, writeLocal]);

  // 과목을 떠나거나 사용자가 바뀌어 사라질 때: 기다리던 저장을 버리지 않고 바로 보낸다
  useEffect(() => {
    unmountedRef.current = false;
    const retry = retryRef.current;
    return () => {
      unmountedRef.current = true;
      if (timer.current) clearTimeout(timer.current);
      if (retry.t) clearTimeout(retry.t);
      if (dirtyRef.current) void pushNowRef.current();
    };
  }, []);

  const flush = useCallback(async () => {
    if (mode !== 'user') return true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    for (let i = 0; i < 20 && savingRef.current; i++) await new Promise((r) => setTimeout(r, 150));
    await pushNow();
    return !dirtyRef.current;
  }, [mode, pushNow]);

  const commit = useCallback((fn: (s: CgState) => CgState) => {
    const prev = stateRef.current;
    const next = fn(prev);
    if (next === prev) return;
    const before = plantStage(prev, courseRef.current), after = plantStage(next, courseRef.current);
    if (after > before) setGrewTo(after);
    stateRef.current = next;
    setState(next);
    writeLocal(next);
    if (mode === 'user') {
      dirtyRef.current = true;
      writeRaw(unsyncedKey, '1');
      schedule();
    }
  }, [mode, schedule, writeLocal, unsyncedKey]);

  // 로그인 없이 남긴 이 과목 기록(guest 키 `${seg}:` 아래 전부: 기록·풀던 초안·모의고사)만 가져오고 지운다
  const importGuest = useCallback(() => {
    if (!guestToImport) return;
    commit((s) => merge(s, guestToImport));
    removeWithPrefix(`${learnerPrefix(GUEST_KEY)}${seg}:`);
    setGuestToImport(null);
  }, [guestToImport, commit, merge, seg]);

  const discardGuest = useCallback(() => {
    removeWithPrefix(`${learnerPrefix(GUEST_KEY)}${seg}:`);
    setGuestToImport(null);
  }, [seg]);

  const value = useMemo<CgCtx>(() => ({
    state, commit, mode, saveStatus, loading, isTeacher, guestToImport, importGuest, discardGuest,
    grewTo, clearGrew: () => setGrewTo(null), flush,
  }), [state, commit, mode, saveStatus, loading, isTeacher, guestToImport, importGuest, discardGuest, grewTo, flush]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
