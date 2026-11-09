import { adaptUnits, type RawUnit } from '../content/adapt';
import { makeCourse, type CourseConfig } from '../course';
import { passNeed, type CoursePass } from '../model';
import { MOCK_SIZE, NEW_COURSES, selfCheckOf, UNIT_COUNTS, type CourseSize, type NewCourseId } from './defs';

/**
 * 과목 크기별 통과 기준: 단계 기준은 컴퓨터 일반과 같은 비율(passNeed)로 과목 기본 문항 수에서,
 * 모의고사는 MOCK_SIZE에서. full: 끼워맞추기 16/20·기초 14/20·실력점검 9/15·모의 30/50(50분),
 * foundation: 8/10·7/10·(5단계는 10문항 실력점검: 통과 기준 없음)·모의 18/30(30분)
 */
export function coursePass(size: CourseSize): CoursePass {
  const n = UNIT_COUNTS[size];
  const rule = (lv: 2 | 3 | 5, total: number) => ({ need: passNeed(lv, total), total });
  return { blanks: rule(2, n.fill), basic: rule(3, n.basic), check: rule(5, n.advanced), mock: { ...MOCK_SIZE[size] } };
}

/**
 * 새 과목(네트워크·프로그래밍·Data·기초 다듬기) 정의 + 단원 원본 → 과목 정의.
 * 기초 다듬기(foundation)는 5단계가 10문항 실력점검(selfCheck)이고, 처음 열 때 예전 2진법 이해·IP 이해 기록을 옮겨 온다(legacy).
 * 이름·경로·영역·내용 범위는 defs.ts, 저장 키는 과목 ID('net:' …), 서버는 course_progress(p_course).
 * 영역이 이 과목 영역이 아니면 첫 영역으로 본다. 단원은 원본의 unit 번호 순.
 */
export function buildNewCourse(id: NewCourseId, raw: unknown[]): CourseConfig {
  const def = NEW_COURSES.find((c) => c.id === id);
  if (!def) throw new Error(`알 수 없는 과목: ${id}`);
  const units = adaptUnits(
    (raw as RawUnit[]).filter((u) => u && typeof u === 'object' && Number.isInteger(u.unit)).sort((a, b) => a.unit - b.unit),
    { areas: def.areas.map((a) => a.id) },
  );
  const size = def.size ?? 'full';
  return makeCourse({
    id, name: def.name, basePath: def.path, basis: def.basis, units, areas: def.areas,
    remote: { kind: 'course', course: id }, storage: id, mockSeed: id, size, pass: coursePass(size),
    selfCheck: selfCheckOf(def), legacy: def.legacy,
  });
}
