import u1 from './bin/U1.json' with { type: 'json' };
import u2 from './bin/U2.json' with { type: 'json' };
import u3 from './bin/U3.json' with { type: 'json' };
import { CourseRoutes } from '../CourseApp';
import { buildNewCourse } from './build';

/** 보충 과목 "2진법 이해"(이 chunk에는 이 과목 단원 3개만 들어 있다) */
export const COURSE = buildNewCourse('bin', [u1, u2, u3]);

export function BinaryRoutes() {
  return <CourseRoutes course={COURSE} />;
}

export default BinaryRoutes;
