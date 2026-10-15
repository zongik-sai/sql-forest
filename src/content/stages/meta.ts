import type { UnitId } from '../types';

/**
 * 단원 단계 콘텐츠의 개수(진도 계산용). 내용(JSON 12개)은 단계 화면을 열 때만 내려받고,
 * 기록·이어하기 계산은 이 작은 표만 쓴다. tests/unit/dbStages.test.ts가 JSON과 일치하는지 검사한다.
 */
export const STAGE_COUNTS: Record<UnitId, { cards: number; quiz: number; practice: number }> = {
  U01: { cards: 6, quiz: 10, practice: 4 },
  U02: { cards: 7, quiz: 10, practice: 4 },
  U03: { cards: 6, quiz: 10, practice: 4 },
  U04: { cards: 7, quiz: 10, practice: 4 },
  U05: { cards: 7, quiz: 10, practice: 4 },
  U06: { cards: 7, quiz: 10, practice: 4 },
  U07: { cards: 6, quiz: 10, practice: 4 },
  U08: { cards: 7, quiz: 10, practice: 4 },
  U09: { cards: 7, quiz: 10, practice: 4 },
  U10: { cards: 7, quiz: 10, practice: 4 },
  U11: { cards: 7, quiz: 10, practice: 4 },
  U12: { cards: 7, quiz: 10, practice: 4 },
};

/** 개념 점검 통과 기준: 10문항 중 7개(문항 수가 다르면 같은 비율로 올림) */
export const quizNeed = (n: number) => Math.ceil(n * 0.7);
