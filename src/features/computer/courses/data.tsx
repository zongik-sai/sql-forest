import u1 from './data/U1.json' with { type: 'json' };
import u2 from './data/U2.json' with { type: 'json' };
import u3 from './data/U3.json' with { type: 'json' };
import u4 from './data/U4.json' with { type: 'json' };
import u5 from './data/U5.json' with { type: 'json' };
import u6 from './data/U6.json' with { type: 'json' };
import u7 from './data/U7.json' with { type: 'json' };
import u8 from './data/U8.json' with { type: 'json' };
import u9 from './data/U9.json' with { type: 'json' };
import u10 from './data/U10.json' with { type: 'json' };
import u11 from './data/U11.json' with { type: 'json' };
import { CourseRoutes } from '../CourseApp';
import { buildNewCourse } from './build';

/** 과목 "Data"(이 chunk에는 이 과목 단원 11개만 들어 있다) */
export const COURSE = buildNewCourse('data', [u1, u2, u3, u4, u5, u6, u7, u8, u9, u10, u11]);

export function DataRoutes() {
  return <CourseRoutes course={COURSE} />;
}

export default DataRoutes;
