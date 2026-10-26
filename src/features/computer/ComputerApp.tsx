import { CG_COURSE } from './content';
import { CourseRoutes } from './CourseApp';

/** 과목 "컴퓨터 일반"(/computer/*): 공통 단원 × 5단계 엔진 + 컴퓨터 일반 문제은행(이 chunk에만 들어 있음) */
export function ComputerRoutes() {
  return <CourseRoutes course={CG_COURSE} />;
}

export default ComputerRoutes;
