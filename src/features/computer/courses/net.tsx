import u1 from './net/U1.json' with { type: 'json' };
import u2 from './net/U2.json' with { type: 'json' };
import u3 from './net/U3.json' with { type: 'json' };
import u4 from './net/U4.json' with { type: 'json' };
import u5 from './net/U5.json' with { type: 'json' };
import u6 from './net/U6.json' with { type: 'json' };
import u7 from './net/U7.json' with { type: 'json' };
import u8 from './net/U8.json' with { type: 'json' };
import { CourseRoutes } from '../CourseApp';
import { buildNewCourse } from './build';

/** 과목 "네트워크"(이 chunk에는 이 과목 단원 8개만 들어 있다) */
export const COURSE = buildNewCourse('net', [u1, u2, u3, u4, u5, u6, u7, u8]);

export function NetworkRoutes() {
  return <CourseRoutes course={COURSE} />;
}

export default NetworkRoutes;
