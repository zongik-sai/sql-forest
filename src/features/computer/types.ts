/**
 * 과목 "컴퓨터 일반" 콘텐츠 타입(앱 내부 표준 형태).
 * 원본 문제은행(pc_bank.json)은 adapter에서 이 형태로 바꾼다.
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
  title: string;
  /** 문단·목록 줄 */
  lines: string[];
  table?: CgTable;
  /** "PC정비사 확장" 카드 */
  ext?: boolean;
}

export interface CgBlank {
  id: string;
  /** 빈칸 자리는 ___ */
  sentence: string;
  answer: string;
}

export interface CgMcq {
  id: string;
  unitId: CgUnitId;
  /** 기초(3단계) / 실력점검(5단계) */
  set: 'basic' | 'check';
  question: string;
  /** 표나 코드 같은 보조 자료(선택) */
  extra?: string;
  options: string[];
  answer: number;
  explanation: string;
  area: CgArea;
  tag?: string;
}

export interface CgSummary {
  lines: string[];
  tables: CgTable[];
  pitfalls: string[];
}

export interface CgUnit {
  id: CgUnitId;
  title: string;
  cards: CgCard[];
  blanks: CgBlank[];
  /** 끼워맞추기 예시답안(정답 + 헷갈림 용어) */
  wordBox: string[];
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
