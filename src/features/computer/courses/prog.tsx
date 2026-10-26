import u1 from './prog/U1.json' with { type: 'json' };
import u2 from './prog/U2.json' with { type: 'json' };
import u3 from './prog/U3.json' with { type: 'json' };
import u4 from './prog/U4.json' with { type: 'json' };
import u5 from './prog/U5.json' with { type: 'json' };
import u6 from './prog/U6.json' with { type: 'json' };
import u7 from './prog/U7.json' with { type: 'json' };
import u8 from './prog/U8.json' with { type: 'json' };
import { CourseRoutes } from '../CourseApp';
import { buildNewCourse } from './build';

/** 과목 "프로그래밍"(이 chunk에는 이 과목 단원 8개만 들어 있다) */
export const COURSE = buildNewCourse('prog', [u1, u2, u3, u4, u5, u6, u7, u8]);

export function ProgrammingRoutes() {
  return <CourseRoutes course={COURSE} />;
}

export default ProgrammingRoutes;
