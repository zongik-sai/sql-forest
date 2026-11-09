import type { SelfCheckRecord } from './model';

/**
 * 실력점검(자기 점검, 기초 다듬기 5단계) 화면 공통 규칙(순수 함수).
 * 학생 화면에는 최고점과 누적 합계 점수만 보인다(마지막 점수·평균·회차 목록·통과/불합격 없음 — 선생님 요청 2026-11-09).
 */

/** 단원 카드·단원 화면에 보일 한 줄 */
export const selfCheckLine = (rec: SelfCheckRecord | undefined, size: number) =>
  rec && rec.n > 0 ? `실력점검 최고 ${rec.best}/${size} · 누적 ${rec.sum}점` : '실력점검 아직 안 풀었어요';

/** 풀던 실력점검(이 기기 초안)을 이어 풀 수 있는지: 그 단원 실력점검 문항 ID만, 중복 없이, 정한 문항 수만큼 */
export function resumableIds(saved: unknown, pool: readonly string[], count: number): string[] | null {
  if (!saved || typeof saved !== 'object') return null;
  const ids = (saved as { ids?: unknown }).ids;
  if (!Array.isArray(ids) || ids.length !== count || count === 0) return null;
  if (!ids.every((x): x is string => typeof x === 'string' && pool.includes(x))) return null;
  return new Set(ids).size === ids.length ? ids : null;
}
