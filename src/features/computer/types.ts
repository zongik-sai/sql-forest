/**
 * 과목 "컴퓨터 일반" 콘텐츠 타입(앱 내부 표준 형태).
 * 원본 문제은행(pc_bank.json: 선생님의 'PC정비사 자기학습' 페이지 데이터)은 content/index.ts에서 이 형태로 바꾼다.
 */
export type CgUnitId = 'U1' | 'U2' | 'U3' | 'U4' | 'U5' | 'U6' | 'U7' | 'U8';
export const CG_UNIT_IDS: CgUnitId[] = ['U1', 'U2', 'U3', 'U4', 'U5', 'U6', 'U7', 'U8'];

/** 시험 영역: PC 운영체제 · PC와 주변기기 · PC 유지보수 · PC 네트워크 · 컴퓨터 일반 */
export type CgArea = 'OS' | 'HW' | 'MAINT' | 'NET' | 'GEN';
export const CG_AREAS: CgArea[] = ['OS', 'HW', 'MAINT', 'NET', 'GEN'];
export const CG_AREA_LABEL: Record<CgArea, string> = {
  OS: 'PC 운영체제',
  HW: 'PC와 주변기기',
  MAINT: 'PC 유지보수',
  NET: 'PC 네트워크',
  GEN: '컴퓨터 일반',
};

/** 단계: 1 이론 · 2 개념 끼워맞추기 · 3 기초 객관식 · 4 단원 요약 · 5 실력점검 */
export type CgLevel = 1 | 2 | 3 | 4 | 5;
export const CG_LEVELS: CgLevel[] = [1, 2, 3, 4, 5];
export const CG_LEVEL_NAME: Record<CgLevel, string> = { 1: '이론', 2: '개념 끼워맞추기', 3: '기초 객관식', 4: '단원 요약', 5: '실력점검' };

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
