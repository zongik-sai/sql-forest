import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { loadLegacyRemote } from '../../src/features/computer/store';

/** 예전 과목(bin·ip) 서버 행 읽기: 다시 해도 같은 오류만 '끝남', 일시 오류·연결 실패는 다음에 다시 시도 */
const fake = (res: unknown, throws = false) => ({
  from: () => ({ select: () => ({ in: async () => { if (throws) throw new Error('offline'); return res; } }) }),
}) as unknown as SupabaseClient;

describe('loadLegacyRemote', () => {
  it('행을 읽으면 그 과목 행만 돌려주고 끝남', async () => {
    const r = await loadLegacyRemote(fake({ data: [{ course: 'bin', state: { v: 1 } }, { course: 'net', state: {} }], error: null }), ['bin', 'ip']);
    expect(r).toEqual({ rows: { bin: { v: 1 } }, complete: true });
  });
  it.each(['42P01', 'PGRST205', '42501'])('다시 해도 같은 오류(%s)는 끝남', async (code) => {
    expect(await loadLegacyRemote(fake({ data: null, error: { code, message: 'x' } }), ['bin'])).toEqual({ rows: {}, complete: true });
  });
  it.each(['', 'PGRST301', 'PGRST303', 'PGRST002', 'PGRST000', '57014', '53300'])('일시 오류·연결 실패(%s)는 다시 시도', async (code) => {
    expect(await loadLegacyRemote(fake({ data: null, error: { code, message: 'x' } }), ['bin'])).toEqual({ rows: {}, complete: false });
  });
  it('요청이 던지면 다시 시도', async () => {
    expect(await loadLegacyRemote(fake(null, true), ['bin'])).toEqual({ rows: {}, complete: false });
  });
});
