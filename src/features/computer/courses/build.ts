import { adaptUnits, type RawUnit } from '../content/adapt';
import { makeCourse, type CourseConfig } from '../course';
import { NEW_COURSES, type NewCourseId } from './defs';

/**
 * 새 과목(네트워크·프로그래밍·Data) 정의 + 단원 원본 8개 → 과목 정의.
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
  return makeCourse({
    id, name: def.name, basePath: def.path, basis: def.basis, units, areas: def.areas,
    remote: { kind: 'course', course: id }, storage: id, mockSeed: id,
  });
}
