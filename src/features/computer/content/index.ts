import matchRaw from './card_match.json' with { type: 'json' };
import raw from './pc_bank.json' with { type: 'json' };
import { makeCourse, type CourseConfig } from '../course';
import { CG_AREA_LABEL, CG_AREAS, type CgCardMatch, type CgMcq, type CgUnit, type CgUnitId } from '../types';
import { adaptUnits, type RawUnit } from './adapt';

/**
 * 컴퓨터 일반 8단원 문제은행.
 * 원본: 선생님의 'PC정비사 자기학습' 페이지에 들어 있던 데이터(pc_bank.json, 형식 그대로 보관)를
 * 앱 표준 형태로 바꾼다. 문항 ID는 단원 안에서만 고유하므로 'U1-b1'처럼 단원을 붙인다.
 * 카드별 개념 맞추기(card_match.json)는 원본과 따로 보관한다(카드 ID 'U1-t1' 기준, 선생님 검토용).
 */
export function adaptBank(units: RawUnit[], matches: Record<string, CgCardMatch> = {}): CgUnit[] {
  // 모르는 영역은 예전처럼 '컴퓨터 일반(GEN)'으로
  return adaptUnits(units, { areas: CG_AREAS, fallbackArea: 'GEN', matches });
}

export const CG_UNITS: CgUnit[] = adaptBank(raw as unknown as RawUnit[], matchRaw as Record<string, CgCardMatch>);

/** 컴퓨터 일반 과목 정의: 저장 키 'cg:'·cg_progress·모의고사 시드 'cg-mock-…'는 예전 그대로 */
export const CG_COURSE: CourseConfig = makeCourse({
  id: 'cg', name: '컴퓨터 일반', basePath: '/computer', units: CG_UNITS,
  areas: CG_AREAS.map((id) => ({ id, label: CG_AREA_LABEL[id] })),
  remote: { kind: 'cg' }, storage: 'cg', mockSeed: 'cg',
});

export const CG_UNIT_BY_ID: Partial<Record<CgUnitId, CgUnit>> = Object.fromEntries(CG_UNITS.map((u) => [u.id, u]));
/** 문항 찾기(없는 ID·'constructor' 같은 키는 undefined) */
export const mcqById = (id: string): CgMcq | undefined => CG_COURSE.mcqById(id);
