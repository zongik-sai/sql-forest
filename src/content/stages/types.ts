import type { DatasetId, UnitId } from '../types';

/**
 * 데이터베이스 단원 단계 콘텐츠(2026-10-15 구조 개편).
 * 1단계 이론·개념 맞추기(cards) · 2단계 개념 점검 문제(quiz) · 3단계 실습 설명·실습 맞추기(practice) · 4단계 실습 점검(기존 활동·체크포인트)
 * 단원별 JSON(src/content/stages/Uxx.json)에 보관하며 ID는 'U01-t1'·'U01-c1'·'U01-p1'처럼 안정적으로 둔다.
 */
export interface StageMatch {
  /** 뜻 3개 ↔ 용어 3개 */
  pairs: { term: string; desc: string }[];
  /** 헷갈리게 넣는 용어 1개 */
  distractor: string;
}

export interface StageTable {
  header: string[];
  rows: string[][];
}

export interface StageCard {
  id: string;
  title: string;
  points: string[];
  table?: StageTable;
  tip?: string;
  match: StageMatch;
}

export interface StageQuiz {
  id: string;
  question: string;
  options: string[];
  /** 정답 번호(0부터) */
  answer: number;
  explanation: string;
  /** 개념 이름(오답 복습 묶음용) */
  tag: string;
}

export interface PracticeItem {
  id: string;
  title: string;
  /** 이 예제로 익힐 것(한 문장) */
  goal: string;
  dataset: DatasetId;
  sql: string;
  /** false면 SQLite에서 실행하지 않는 문법 비교 예제 */
  run: boolean;
  /** 실행 결과를 읽는 순서대로 설명 */
  steps: string[];
  /** SQL 조각 ↔ 역할 맞추기(용어는 sql 안의 조각 그대로) */
  match: StageMatch;
}

export interface UnitStages {
  unit: UnitId;
  cards: StageCard[];
  quiz: StageQuiz[];
  practice: PracticeItem[];
}
