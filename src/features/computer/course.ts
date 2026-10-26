import { createContext, createElement, useContext, type ReactNode } from 'react';
import type { CourseShape } from './model';
import { CG_PASS, type CgMcq, type CgUnit, type CgUnitId } from './types';

/**
 * 단원 × 5단계 과목 정의(컴퓨터 일반·네트워크·프로그래밍·Data가 같은 학습 구조를 쓴다).
 * 화면·저장소·모의고사·선생님 현황은 모두 지금 과목(useCourse)을 따른다.
 */
export type CourseId = 'cg' | 'net' | 'prog' | 'data';
export type NewCourseKey = Exclude<CourseId, 'cg'>;

export interface CourseArea { id: string; label: string }

/**
 * 서버 저장 위치.
 * - cg: public.cg_progress(학생 한 행) + save_cg_progress + cg_class_overview(예전 그대로)
 * - course: public.course_progress(학생 × 과목 한 행) + save_course_progress(p_course) + course_class_overview(p_course)
 */
export type CourseRemote = { kind: 'cg' } | { kind: 'course'; course: NewCourseKey };

export interface CourseConfig extends CourseShape {
  id: CourseId;
  /** 화면에 보이는 과목 이름 */
  name: string;
  /** 과목 첫 화면 경로('/computer', '/network' …) */
  basePath: string;
  /** 내용 범위 출처(과목 화면에 작게만 표시). 컴퓨터 일반은 없음 */
  basis?: string;
  units: CgUnit[];
  unitById: (id: string) => CgUnit | undefined;
  /** 영역(모의고사 출제 순서) */
  areas: CourseArea[];
  areaLabel: (id: string) => string;
  mcqById: (id: string) => CgMcq | undefined;
  /** 이 기기 저장 키 구간: `${learnerPrefix}${storage}:state` 등(컴퓨터 일반은 'cg') */
  storage: string;
  remote: CourseRemote;
  /** 고정 모의고사 시드 앞부분: `${mockSeed}-mock-set1-v1` */
  mockSeed: string;
  /** 통과 기준(문항 수가 다르면 passNeed가 같은 비율로 올림) */
  pass: typeof CG_PASS;
}

export interface CourseInput {
  id: CourseId;
  name: string;
  basePath: string;
  basis?: string;
  units: CgUnit[];
  areas: CourseArea[];
  remote: CourseRemote;
  /** 기본: 과목 ID */
  storage?: string;
  mockSeed?: string;
}

/** 단원 목록에서 과목 정의를 만든다(ID 찾기 표는 Map이라 'constructor' 같은 키는 undefined) */
export function makeCourse(c: CourseInput): CourseConfig {
  const unitMap = new Map(c.units.map((u) => [u.id as string, u]));
  const mcqMap = new Map(c.units.flatMap((u) => [...u.basic, ...u.check]).map((q) => [q.id, q]));
  const labels = new Map(c.areas.map((a) => [a.id, a.label]));
  const unitIds: CgUnitId[] = c.units.map((u) => u.id);
  return {
    id: c.id, name: c.name, basePath: c.basePath, ...(c.basis ? { basis: c.basis } : {}),
    units: c.units, unitIds, totalSteps: unitIds.length * 5,
    unitById: (id) => unitMap.get(id), mcqById: (id) => mcqMap.get(id),
    areas: c.areas, areaLabel: (id) => labels.get(id) ?? id,
    storage: c.storage ?? c.id, remote: c.remote, mockSeed: c.mockSeed ?? c.id, pass: CG_PASS,
  };
}

/** 내용이 하나라도 있는 단원(다른 에이전트가 아직 쓰는 중인 빈 단원 구분용) */
export const unitHasContent = (u: CgUnit) => u.cards.length + u.blanks.length + u.basic.length + u.check.length > 0;

const Ctx = createContext<CourseConfig | null>(null);

// JSX 없이(e2e 테스트가 이 파일을 거쳐 문제은행을 읽을 수 있게)
export function CourseProvider({ course, children }: { course: CourseConfig; children: ReactNode }) {
  return createElement(Ctx.Provider, { value: course }, children);
}

export function useCourse(): CourseConfig {
  const c = useContext(Ctx);
  if (!c) throw new Error('CourseProvider 없음');
  return c;
}
