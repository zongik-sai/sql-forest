import { describe, expect, it } from 'vitest';
import { validateContent } from '../../src/content/validate';
import { ACTIVITIES, CHALLENGES, CHECKPOINTS, FINAL_DIAGNOSTIC, PRE_DIAGNOSTIC, UNITS, VARIANTS } from '../../src/content';

describe('콘텐츠 검증기', () => {
  it('구조 오류가 없다', () => {
    const errors = validateContent();
    expect(errors, errors.join('\n')).toEqual([]);
  });
  it('분류별 수량을 따로 확인', () => {
    expect(UNITS.length).toBe(12);
    expect(ACTIVITIES.length).toBe(48);
    expect(CHECKPOINTS.length).toBe(36);
    expect(VARIANTS.length).toBe(36);
    expect(PRE_DIAGNOSTIC.length).toBe(5);
    expect(FINAL_DIAGNOSTIC.length).toBe(12);
    expect(CHALLENGES.length).toBe(12);
  });
});
