import type { DatasetId } from '../../content/types';

/**
 * 학습용 SQLite 데이터셋.
 * - 모든 데이터셋은 공통 학교 데이터(departments/students/courses/enrollment)를 포함하고,
 *   단원별 추가 테이블을 더한다.
 * - main: 화면에 보이는 기준 seed (docs/04_DATA_AND_SQL.md 그대로)
 * - alt : 채점용 두 번째 seed. 학생 SQL이 특정 값에 맞춘 '하드코딩'이 아닌지 확인한다.
 *         클라이언트에 포함되므로 보안상 비밀 데이터가 아니다(학습용 검증).
 * 학생 이름은 모두 가상이다.
 */

export type SeedId = 'main' | 'alt';

const SCHOOL_SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE departments(dept_id INTEGER PRIMARY KEY, dept_name TEXT NOT NULL UNIQUE);
CREATE TABLE students(student_id INTEGER PRIMARY KEY, student_name TEXT NOT NULL,
 dept_id INTEGER NOT NULL REFERENCES departments(dept_id), grade INTEGER NOT NULL CHECK(grade BETWEEN 1 AND 3));
CREATE TABLE courses(course_id INTEGER PRIMARY KEY, course_name TEXT NOT NULL);
CREATE TABLE enrollment(student_id INTEGER NOT NULL REFERENCES students(student_id),
 course_id INTEGER NOT NULL REFERENCES courses(course_id), score INTEGER CHECK(score BETWEEN 0 AND 100),
 PRIMARY KEY(student_id,course_id));
`;

const SCHOOL_MAIN = `
INSERT INTO departments VALUES(10,'AI컴퓨터'),(20,'AI로봇'),(30,'AI콘텐츠디자인'),(40,'전기에너지');
INSERT INTO students VALUES(1,'가온',10,3),(2,'나래',10,3),(3,'다온',20,2),(4,'라온',20,3),(5,'마루',30,1),(6,'바다',10,2);
INSERT INTO courses VALUES(101,'SQL캠프'),(102,'IoT캠프'),(103,'AI캠프');
INSERT INTO enrollment VALUES(1,101,90),(1,102,80),(2,101,90),(3,101,NULL),(3,102,70),(6,102,80);
`;

/** 검증용 seed: 동점·NULL·미수강·빈 학과 등 같은 구조의 함정을 다른 값으로 배치 */
const SCHOOL_ALT = `
INSERT INTO departments VALUES(10,'AI컴퓨터'),(20,'AI로봇'),(30,'AI콘텐츠디자인'),(40,'전기에너지'),(50,'스마트팩토리');
INSERT INTO students VALUES(1,'하늘',20,1),(2,'노을',10,3),(3,'보라',10,3),(4,'새봄',30,2),(5,'이슬',40,3),(6,'초롱',20,3),(7,'단비',10,1),(8,'여름',40,2);
INSERT INTO courses VALUES(101,'SQL캠프'),(102,'IoT캠프'),(103,'AI캠프'),(104,'로봇캠프');
INSERT INTO enrollment VALUES(2,101,75),(2,103,NULL),(3,101,75),(3,102,95),(4,101,60),(5,102,NULL),(6,101,88),(6,103,70),(8,103,79);
`;

/** U02 정규화: 복합키 (student_id, course_id), 부분종속(student_name, course_name), 이행종속(dept_id→dept_name) */
const NORMAL_SCHEMA = `
CREATE TABLE enrollment_raw(student_id INTEGER NOT NULL, student_name TEXT NOT NULL, dept_id INTEGER NOT NULL,
 dept_name TEXT NOT NULL, course_id INTEGER NOT NULL, course_name TEXT NOT NULL, score INTEGER,
 PRIMARY KEY(student_id, course_id));
`;
const NORMAL_FROM_SCHOOL = `
INSERT INTO enrollment_raw
SELECT s.student_id, s.student_name, s.dept_id, d.dept_name, c.course_id, c.course_name, e.score
FROM enrollment e JOIN students s ON s.student_id=e.student_id
JOIN departments d ON d.dept_id=s.dept_id JOIN courses c ON c.course_id=e.course_id;
`;

/** U09 누적합: 같은 날짜에 여러 행 */
const POINTS_SCHEMA = `
CREATE TABLE point_events(event_id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(student_id),
 event_date TEXT NOT NULL, points INTEGER NOT NULL);
`;
const POINTS_MAIN = `
INSERT INTO point_events VALUES
(1,1,'2026-03-02',10),(2,1,'2026-03-02',5),(3,1,'2026-03-03',20),(4,2,'2026-03-02',15),
(5,2,'2026-03-04',10),(6,3,'2026-03-03',30),(7,3,'2026-03-03',5),(8,6,'2026-03-05',25);
`;
const POINTS_ALT = `
INSERT INTO point_events VALUES
(1,2,'2026-04-01',7),(2,2,'2026-04-01',7),(3,2,'2026-04-02',1),(4,3,'2026-04-01',40),
(5,6,'2026-04-03',12),(6,6,'2026-04-03',3),(7,6,'2026-04-04',9),(8,8,'2026-04-02',11),(9,3,'2026-04-05',2);
`;

/** U10 계층: 동아리 조직도 */
const CLUBS_SCHEMA = `
CREATE TABLE clubs_tree(club_id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES clubs_tree(club_id), club_name TEXT NOT NULL);
`;
const CLUBS_MAIN = `
INSERT INTO clubs_tree VALUES
(1,NULL,'학생회'),(2,1,'학술부'),(3,1,'체육부'),(4,2,'SQL동아리'),(5,2,'로봇동아리'),(6,4,'SQL스터디A'),(7,3,'농구부'),(8,4,'SQL스터디B');
`;
const CLUBS_ALT = `
INSERT INTO clubs_tree VALUES
(1,NULL,'학생회'),(2,1,'학술부'),(3,1,'문화부'),(4,3,'밴드부'),(5,2,'수학동아리'),(6,5,'수학스터디'),(7,2,'SQL동아리'),(8,7,'SQL스터디'),(9,4,'보컬팀');
`;

/** U10 피벗/소계: 학과·월·참여 인원 */
const MONTHLY_SCHEMA = `
CREATE TABLE camp_monthly(dept_name TEXT NOT NULL, month TEXT NOT NULL, participants INTEGER NOT NULL,
 PRIMARY KEY(dept_name, month));
`;
const MONTHLY_MAIN = `
INSERT INTO camp_monthly VALUES
('AI컴퓨터','3월',12),('AI컴퓨터','4월',8),('AI로봇','3월',5),('AI로봇','4월',9),('AI콘텐츠디자인','4월',4);
`;
const MONTHLY_ALT = `
INSERT INTO camp_monthly VALUES
('AI컴퓨터','3월',3),('AI로봇','3월',6),('AI로봇','4월',2),('AI콘텐츠디자인','3월',7),('AI콘텐츠디자인','4월',1),('전기에너지','4월',10);
`;

/** U11 수정 가능한 샌드박스 테이블 */
const SANDBOX_SCHEMA = `
CREATE TABLE camp_signup(signup_id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(student_id),
 camp_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT '신청' CHECK(status IN ('신청','확정','취소')),
 UNIQUE(student_id, camp_name));
`;
const SANDBOX_MAIN = `
INSERT INTO camp_signup VALUES(1,1,'SQL캠프','확정'),(2,2,'SQL캠프','신청'),(3,3,'IoT캠프','신청'),(4,6,'AI캠프','취소');
`;
const SANDBOX_ALT = `
INSERT INTO camp_signup VALUES(1,2,'SQL캠프','신청'),(2,3,'IoT캠프','확정'),(3,5,'AI캠프','신청'),(4,7,'SQL캠프','취소'),(5,8,'AI캠프','신청');
`;

export const DATASET_TABLES: Record<DatasetId, string[]> = {
  school: ['departments', 'students', 'courses', 'enrollment'],
  normal: ['enrollment_raw', 'departments', 'students', 'courses', 'enrollment'],
  points: ['point_events', 'students', 'departments'],
  clubs: ['clubs_tree'],
  monthly: ['camp_monthly'],
  sandbox: ['camp_signup', 'students', 'courses'],
};

export const DATASET_LABEL: Record<DatasetId, string> = {
  school: '학교 기본 데이터',
  normal: '비정규 수강표',
  points: '활동 포인트 기록',
  clubs: '동아리 조직도',
  monthly: '학과·월별 캠프 참여',
  sandbox: '캠프 신청 샌드박스',
};

export function seedSql(dataset: DatasetId, seed: SeedId): string {
  const school = SCHOOL_SCHEMA + (seed === 'main' ? SCHOOL_MAIN : SCHOOL_ALT);
  switch (dataset) {
    case 'school':
      return school;
    case 'normal':
      return school + NORMAL_SCHEMA + NORMAL_FROM_SCHOOL;
    case 'points':
      return school + POINTS_SCHEMA + (seed === 'main' ? POINTS_MAIN : POINTS_ALT);
    case 'clubs':
      return school + CLUBS_SCHEMA + (seed === 'main' ? CLUBS_MAIN : CLUBS_ALT);
    case 'monthly':
      return school + MONTHLY_SCHEMA + (seed === 'main' ? MONTHLY_MAIN : MONTHLY_ALT);
    case 'sandbox':
      return school + SANDBOX_SCHEMA + (seed === 'main' ? SANDBOX_MAIN : SANDBOX_ALT);
  }
}

export const ALL_DATASETS: DatasetId[] = ['school', 'normal', 'points', 'clubs', 'monthly', 'sandbox'];
