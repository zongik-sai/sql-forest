import u1 from './ip/U1.json' with { type: 'json' };
import u2 from './ip/U2.json' with { type: 'json' };
import u3 from './ip/U3.json' with { type: 'json' };
import { CourseRoutes } from '../CourseApp';
import { buildNewCourse } from './build';

/** 보충 과목 "IP 이해"(이 chunk에는 이 과목 단원 3개만 들어 있다) */
export const COURSE = buildNewCourse('ip', [u1, u2, u3]);

export function IpRoutes() {
  return <CourseRoutes course={COURSE} />;
}

export default IpRoutes;
