/**
 * 단원 × 5단계 과목(컴퓨터 일반·네트워크·프로그래밍·Data) 공통 콘텐츠 타입(앱 내부 표준 형태).
 * 컴퓨터 일반 원본(pc_bank.json: 선생님의 'PC정비사 자기학습' 페이지 데이터)과 새 과목 원본(courses/<과목>/U1~U8.json)은
 * content/adapt.ts에서 이 형태로 바꾼다. 과목별 단원 목록·영역은 course.tsx의 CourseConfig가 갖는다.
 */
/** 단원 ID: 'U1'~'U12'(과목마다 단원 수가 다를 수 있음) */
export type CgUnitId = `U${number}`;
/** 컴퓨터 일반 8단원 */
export const CG_UNIT_IDS: CgUnitId[] = ['U1', 'U2', 'U3', 'U4', 'U5', 'U6', 'U7', 'U8'];

/** 시험 영역 ID(과목마다 다름). 컴퓨터 일반: PC 운영체제 · PC와 주변기기 · PC 유지보수 · PC 네트워크 · 컴퓨터 일반 */
export type CgArea = string;
export const CG_AREAS: CgArea[] = ['OS', 'HW', 'MAINT', 'NET', 'GEN'];
export const CG_AREA_LABEL: Record<CgArea, string> = {
  OS: 'PC 운영체제',
  HW: 'PC와 주변기기',
  MAINT: 'PC 유지보수',
  NET: 'PC 네트워크',
  GEN: '컴퓨터 일반',
};

/** 단계: 1 이론·개념 맞추기(카드별) · 2 전체 개념 끼워맞추기 · 3 기초 객관식 · 4 단원 요약 · 5 실력점검 */
export type CgLevel = 1 | 2 | 3 | 4 | 5;
export const CG_LEVELS: CgLevel[] = [1, 2, 3, 4, 5];
export const CG_LEVEL_NAME: Record<CgLevel, string> = { 1: '이론·개념 맞추기', 2: '전체 개념 끼워맞추기', 3: '기초 객관식', 4: '단원 요약', 5: '실력점검' };

/** 카드 한 장을 읽고 푸는 개념 맞추기: 뜻 3개 ↔ 용어 3개(+헷갈리는 용어 1개) */
export interface CgCardMatch {
  pairs: { term: string; desc: string }[];
  distractor: string;
}

export interface CgTable {
  caption?: string;
  header: string[];
  rows: string[][];
}

export interface CgCard {
  id: string;
  title: string;
  points: string[];
  table?: CgTable;
  /** 한 줄 요약(외우기 팁) */
  tip?: string;
  /** 시험 대비 확장 카드 */
  ext: boolean;
  /** 카드를 읽은 뒤 푸는 개념 맞추기(컴퓨터 일반은 card_match.json, 새 과목은 카드 원본의 match) */
  match?: CgCardMatch;
  /** 코드 예시(새 과목, 선택) */
  code?: string;
}

export interface CgBlank {
  id: string;
  /** 빈칸 자리는 밑줄(____) */
  text: string;
  answer: string;
  explanation: string;
}

export interface CgMcq {
  id: string;
  unitId: CgUnitId;
  /** 기초(3단계) / 실력점검(5단계) */
  set: 'basic' | 'check';
  question: string;
  /** 문제에 딸린 코드(새 과목, 선택) */
  code?: string;
  options: string[];
  answer: number;
  explanation: string;
  area: CgArea;
  /** 실력점검 유형: 계산·응용·부정형·비교·확장 */
  tag?: string;
}

export interface CgSummary {
  keys: { k: string; v: string }[];
  tables: CgTable[];
  traps: string[];
}

export interface CgUnit {
  id: CgUnitId;
  num: number;
  title: string;
  intro: string;
  cards: CgCard[];
  /** 끼워맞추기 예시답안(정답 30 + 헷갈림 용어 20) */
  wordBox: string[];
  blanks: CgBlank[];
  basic: CgMcq[];
  summary: CgSummary;
  check: CgMcq[];
}

/** 단계별 통과 기준 */
export const CG_PASS = {
  blanks: { need: 24, total: 30 },
  basic: { need: 28, total: 40 },
  check: { need: 15, total: 25 },
  mock: { need: 30, total: 50, minutes: 50 },
} as const;

/** 빈칸 표시 */
export const BLANK_RE = /_{3,}/;
