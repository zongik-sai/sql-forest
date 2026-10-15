import type { DatasetId } from '../content/types';
import { isPresetId, type PresetId } from '../features/playground/presets';

/**
 * 세션 DB(자유 실습장 등)의 시작 데이터: 학습 데이터셋 id(main seed) 또는 자유 실습장 예시('preset:<id>').
 * 예시 seed는 Worker 번들에 들어 있는 신뢰된 SQL만 쓴다(id로 찾는다).
 */
export type SessionBase = DatasetId | `preset:${PresetId}`;

export const presetBase = (id: PresetId): SessionBase => `preset:${id}`;

export function presetOfBase(base: SessionBase): PresetId | null {
  if (!base.startsWith('preset:')) return null;
  const id = base.slice('preset:'.length);
  return isPresetId(id) ? id : null;
}
