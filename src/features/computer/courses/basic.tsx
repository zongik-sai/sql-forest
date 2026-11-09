import u1 from './basic/U1.json' with { type: 'json' };
import u2 from './basic/U2.json' with { type: 'json' };
import u3 from './basic/U3.json' with { type: 'json' };
import u4 from './basic/U4.json' with { type: 'json' };
import u5 from './basic/U5.json' with { type: 'json' };
import u6 from './basic/U6.json' with { type: 'json' };
import u7 from './basic/U7.json' with { type: 'json' };
import u8 from './basic/U8.json' with { type: 'json' };
import u9 from './basic/U9.json' with { type: 'json' };
import u10 from './basic/U10.json' with { type: 'json' };
import { CourseRoutes } from '../CourseApp';
import { buildNewCourse } from './build';

/**
 * 과목 "기초 다듬기"(/basics, 이 chunk에는 이 과목 단원 10개만 들어 있다). 예전 보충 학습 2진법 이해(/binary)·IP 이해(/ip)를 합쳤다:
 * 진법(1~3) → 진법 응용: 오류 정정(4 패리티·해밍 코드, 5 CRC) → IP(6) → IP 클래스(7) → 서브넷 마스크(8) → 서브네팅(9) → IP 설정(10).
 * 5단계는 10문항 실력점검(최고점·누적 점수만 보임).
 */
export const COURSE = buildNewCourse('basic', [u1, u2, u3, u4, u5, u6, u7, u8, u9, u10]);

export function BasicsRoutes() {
  return <CourseRoutes course={COURSE} />;
}

export default BasicsRoutes;
