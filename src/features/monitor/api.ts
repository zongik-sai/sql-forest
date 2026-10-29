import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountRow } from '../auth/accountKind';
import type { LiveRow, LiveState } from './liveState';

/**
 * 실시간 학습 위치·화면 공유 RPC(supabase/migrations/20261026010000_monitoring.sql).
 * 권한은 모두 서버가 다시 확인한다(선생님 여부·그 행의 당사자인지). 화면은 RPC를 거치지 않고 WebRTC로만 오간다.
 */
export type ScreenStatus = 'requested' | 'accepted' | 'offered' | 'answered' | 'declined' | 'ended';

export interface MonitorApi {
  report(state: LiveState): Promise<void>;
  classLive(minutes: number): Promise<LiveRow[]>;
  /* 선생님 */
  requestScreen(studentId: string): Promise<string>;
  getScreen(id: string): Promise<{ status: ScreenStatus; offer: string | null }>;
  answerScreen(id: string, sdp: string): Promise<ScreenStatus>;
  /* 학생 */
  myRequest(): Promise<{ id: string; teacherName: string } | null>;
  respond(id: string, accept: boolean): Promise<ScreenStatus>;
  offerScreen(id: string, sdp: string): Promise<ScreenStatus>;
  getAnswer(id: string): Promise<{ status: ScreenStatus; answer: string | null }>;
  /* 둘 다 */
  endScreen(id: string): Promise<void>;
}

export class RpcError extends Error {
  constructor(public fn: string, message: string, public code?: string, public status?: number) {
    super(message);
  }
}

/** 서버에 아직 이 기능(migration)이 없음 */
export function isMissingFunction(e: unknown): boolean {
  const x = e as { code?: string; message?: string; status?: number } | null;
  return !!x && (x.code === 'PGRST202' || x.code === '42883' || /Could not find the function|does not exist/i.test(x.message ?? ''));
}

/** 이 기능을 설치하는 migration 파일 */
export const MIGRATION_OF: Record<string, string> = {
  cg_class_overview: '20261007000000_computer_general.sql',
  db_class_overview: '20261007000000_computer_general.sql',
  am_i_teacher: '20261007000000_computer_general.sql',
  course_class_overview: '20261026000000_courses.sql',
  class_live_status: '20261026010000_monitoring.sql',
  report_live_status: '20261026010000_monitoring.sql',
  request_screen: '20261026010000_monitoring.sql',
  am_i_admin: '20261029000000_roles.sql',
  account_list: '20261029000000_roles.sql',
  set_teacher: '20261029000000_roles.sql',
  set_admin: '20261029000000_roles.sql',
  role_audit_list: '20261029000000_roles.sql',
};

/** 선생님에게 보여 줄 오류 문구(migration 미적용은 분명하게) */
export function rpcErrorText(fn: string, e: unknown): string {
  const x = e as { code?: string; message?: string } | null;
  if (isMissingFunction(e)) {
    return `서버에 이 기능(${fn})이 아직 설치되지 않았어요. 관리자가 Supabase SQL Editor에서 supabase/migrations/${MIGRATION_OF[fn] ?? '최신 migration'}을 실행해야 해요.`;
  }
  if (x?.code === '22023' && /알 수 없는 과목/.test(x.message ?? '')) {
    return '서버의 과목 목록에 아직 이 과목이 없어요. 관리자가 최신 supabase/migrations/20261026000000_courses.sql을 다시 실행해야 해요.';
  }
  if (x?.code === '42501') return fn === 'set_teacher' || fn === 'set_admin' ? '관리자 계정만 권한을 바꿀 수 있어요.' : '선생님 계정만 볼 수 있어요.';
  if (x?.code === '23505') return '다른 요청이 동시에 처리되고 있어요. 잠시 뒤 다시 시도해 주세요.';
  return x?.message || String(e);
}

export function supabaseMonitorApi(sb: SupabaseClient): MonitorApi {
  const call = async <T,>(fn: string, args?: Record<string, unknown>): Promise<T> => {
    const { data, error, status } = args ? await sb.rpc(fn, args) : await sb.rpc(fn);
    if (error) throw new RpcError(fn, error.message, error.code, status);
    return data as T;
  };
  const first = <T,>(d: T[] | T | null): T | null => (Array.isArray(d) ? d[0] ?? null : d);
  return {
    report: async (state) => { await call('report_live_status', { p_state: state }); },
    classLive: async (minutes) => (await call<LiveRow[] | null>('class_live_status', { p_minutes: minutes })) ?? [],
    requestScreen: (studentId) => call<string>('request_screen', { p_student: studentId }),
    getScreen: async (id) => {
      const r = first(await call<{ status: ScreenStatus; offer: string | null }[]>('get_screen', { p_id: id }));
      return { status: r?.status ?? 'ended', offer: r?.offer ?? null };
    },
    answerScreen: (id, sdp) => call<ScreenStatus>('answer_screen', { p_id: id, p_sdp: sdp }),
    myRequest: async () => {
      const r = first(await call<{ id: string; teacher_name: string | null }[]>('my_screen_request'));
      return r ? { id: r.id, teacherName: r.teacher_name || '선생님' } : null;
    },
    respond: (id, accept) => call<ScreenStatus>('respond_screen', { p_id: id, p_accept: accept }),
    offerScreen: (id, sdp) => call<ScreenStatus>('offer_screen', { p_id: id, p_sdp: sdp }),
    getAnswer: async (id) => {
      const r = first(await call<{ status: ScreenStatus; answer: string | null }[]>('get_screen_answer', { p_id: id }));
      return { status: r?.status ?? 'ended', answer: r?.answer ?? null };
    },
    endScreen: async (id) => { await call('end_screen', { p_id: id }); },
  };
}

/* ---------------- 계정 관리(supabase/migrations/20261029000000_roles.sql) ---------------- */

export type RoleAction = 'grant_teacher' | 'revoke_teacher' | 'grant_admin' | 'revoke_admin';
export interface RoleAuditRow {
  at: string;
  actor: string | null;
  actor_email: string | null;
  actor_name: string | null;
  target: string | null;
  target_email: string | null;
  target_name: string | null;
  action: RoleAction;
}

/** 계정 목록(선생님 읽기)·교사/관리자 지정·해제(관리자). 권한은 서버가 다시 확인한다 */
export interface AccountsApi {
  amIAdmin(): Promise<boolean>;
  list(): Promise<AccountRow[]>;
  /** 바뀌었으면 true, 이미 그 상태면 false */
  setTeacher(userId: string, on: boolean): Promise<boolean>;
  setAdmin(userId: string, on: boolean): Promise<boolean>;
  audit(limit: number): Promise<RoleAuditRow[]>;
}

export function supabaseAccountsApi(sb: SupabaseClient): AccountsApi {
  const call = async <T,>(fn: string, args?: Record<string, unknown>): Promise<T> => {
    const { data, error, status } = args ? await sb.rpc(fn, args) : await sb.rpc(fn);
    if (error) throw new RpcError(fn, error.message, error.code, status);
    return data as T;
  };
  return {
    // 아직 migration이 없거나 오류면 관리자가 아닌 것으로(버튼만 숨김, 목록 화면이 오류를 따로 보여 줌)
    amIAdmin: async () => (await call<boolean>('am_i_admin').catch(() => false)) === true,
    list: async () => (await call<AccountRow[] | null>('account_list')) ?? [],
    setTeacher: async (userId, on) => (await call<boolean>('set_teacher', { p_user: userId, p_on: on })) === true,
    setAdmin: async (userId, on) => (await call<boolean>('set_admin', { p_user: userId, p_on: on })) === true,
    audit: async (limit) => (await call<RoleAuditRow[] | null>('role_audit_list', { p_limit: limit })) ?? [],
  };
}
