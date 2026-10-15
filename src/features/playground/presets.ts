/**
 * 자유 실습장 예시 데이터(학교 예시).
 * - 학습 단원 데이터셋(src/sql/datasets)과 별개로, 실습장에서만 쓰는 작은 학교 DB들이다.
 * - id는 안정적인 문자열이다(배열 위치를 쓰지 않는다). 내용이 바뀌면 version을 올린다.
 * - seedSql은 Worker에서 PRAGMA foreign_keys = ON 상태로 실행된다. 부모 테이블부터 넣는다.
 * - 학생·교사 이름은 모두 가상이다.
 * 이 모듈은 Worker에서도 import하므로 React 등 화면 코드를 넣지 않는다.
 */

export type PresetId = 'student-scores' | 'student-clubs' | 'class-schedule' | 'library-loans' | 'afterschool' | 'lunch-survey';

export interface StarterSql {
  /** 버튼에 보일 짧은 설명 */
  label: string;
  sql: string;
}

export interface PlaygroundPreset {
  id: PresetId;
  version: number;
  /** 고르기 목록에 보일 이름 */
  title: string;
  /** 1~2문장 설명(해요체) */
  summary: string;
  /** seed가 만드는 테이블(만드는 순서) */
  tables: string[];
  seedSql: string;
  /** 첫 번째 SQL은 불러올 때 편집기에 넣는다. JOIN 예시를 하나 이상 둔다. */
  starters: StarterSql[];
}

const STUDENT_SCORES: PlaygroundPreset = {
  id: 'student-scores',
  version: 1,
  title: '학생-성적',
  summary: '학생과 과목을 성적 표가 이어 줘요. 한 학생이 여러 과목 점수를 가지는 1:N 관계 두 개를 연습해요. 점수가 비어 있는(NULL) 행도 있어요.',
  tables: ['students', 'subjects', 'scores'],
  seedSql: `
CREATE TABLE students (
  student_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  grade INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 3),
  class_no INTEGER NOT NULL
);
CREATE TABLE subjects (
  subject_id INTEGER PRIMARY KEY,
  subject_name TEXT NOT NULL UNIQUE,
  credits INTEGER NOT NULL
);
CREATE TABLE scores (
  student_id INTEGER NOT NULL REFERENCES students(student_id),
  subject_id INTEGER NOT NULL REFERENCES subjects(subject_id),
  score INTEGER CHECK (score BETWEEN 0 AND 100),
  PRIMARY KEY (student_id, subject_id)
);
INSERT INTO students VALUES
 (1,'김가온',2,1),(2,'이나래',2,1),(3,'박다온',2,2),(4,'최라온',2,2),
 (5,'정마루',1,3),(6,'강바다',1,3),(7,'조사랑',3,1),(8,'윤아름',3,2);
INSERT INTO subjects VALUES (1,'국어',4),(2,'수학',4),(3,'영어',4),(4,'정보',2),(5,'과학',3);
INSERT INTO scores VALUES
 (1,1,88),(1,2,92),(1,4,95),(2,1,76),(2,2,81),(3,2,67),
 (3,3,90),(4,4,NULL),(5,1,85),(5,3,73),(6,4,100),(7,2,58);
`,
  starters: [
    {
      label: '학생별 과목 점수 보기 (JOIN)',
      sql: `SELECT s.name AS 이름, j.subject_name AS 과목, c.score AS 점수
FROM scores c
JOIN students s ON s.student_id = c.student_id
JOIN subjects j ON j.subject_id = c.subject_id
ORDER BY s.name, j.subject_name;`,
    },
    {
      label: '과목별 평균 점수 (GROUP BY)',
      sql: `SELECT j.subject_name AS 과목, COUNT(c.score) AS 응시, ROUND(AVG(c.score), 1) AS 평균
FROM subjects j
LEFT JOIN scores c ON c.subject_id = j.subject_id
GROUP BY j.subject_id
ORDER BY 평균 DESC;`,
    },
    {
      label: '점수가 하나도 없는 학생 (LEFT JOIN)',
      sql: `SELECT s.name AS 이름
FROM students s
LEFT JOIN scores c ON c.student_id = s.student_id
WHERE c.student_id IS NULL;`,
    },
  ],
};

const STUDENT_CLUBS: PlaygroundPreset = {
  id: 'student-clubs',
  version: 1,
  title: '학생-동아리',
  summary: '한 학생이 여러 동아리에, 한 동아리에 여러 학생이 들어가는 N:M 관계예요. 가운데 club_members 표가 둘을 이어 줘요.',
  tables: ['students', 'clubs', 'club_members'],
  seedSql: `
CREATE TABLE students (
  student_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  grade INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 3),
  class_no INTEGER NOT NULL
);
CREATE TABLE clubs (
  club_id INTEGER PRIMARY KEY,
  club_name TEXT NOT NULL UNIQUE,
  room TEXT,
  max_members INTEGER NOT NULL
);
CREATE TABLE club_members (
  student_id INTEGER NOT NULL REFERENCES students(student_id),
  club_id INTEGER NOT NULL REFERENCES clubs(club_id),
  role TEXT NOT NULL DEFAULT '부원' CHECK (role IN ('부장','차장','부원')),
  joined_on TEXT NOT NULL,
  PRIMARY KEY (student_id, club_id)
);
INSERT INTO students VALUES
 (1,'김가온',2,1),(2,'이나래',2,1),(3,'박다온',2,2),(4,'최라온',1,2),
 (5,'정마루',1,3),(6,'강바다',3,3),(7,'조사랑',3,1),(8,'윤아름',1,1);
INSERT INTO clubs VALUES
 (1,'코딩부','정보실1',10),(2,'로봇부','메이커실',8),(3,'방송부','방송실',6),
 (4,'밴드부','음악실',5),(5,'독서토론부',NULL,12);
INSERT INTO club_members VALUES
 (1,1,'부장','2026-03-04'),(2,1,'부원','2026-03-04'),(3,1,'부원','2026-03-05'),
 (3,2,'차장','2026-03-05'),(4,2,'부원','2026-03-06'),(6,2,'부장','2025-03-03'),
 (1,3,'부원','2026-03-10'),(5,3,'부원','2026-03-10'),(7,3,'부장','2025-03-04'),
 (2,4,'부원','2026-03-12'),(7,4,'부원','2025-04-01');
`,
  starters: [
    {
      label: '동아리별 부원 명단 (JOIN 3개 표)',
      sql: `SELECT c.club_name AS 동아리, s.name AS 이름, m.role AS 역할
FROM club_members m
JOIN students s ON s.student_id = m.student_id
JOIN clubs c ON c.club_id = m.club_id
ORDER BY c.club_name, m.role;`,
    },
    {
      label: '동아리별 인원 수 (빈 동아리 포함)',
      sql: `SELECT c.club_name AS 동아리, COUNT(m.student_id) AS 인원, c.max_members AS 정원
FROM clubs c
LEFT JOIN club_members m ON m.club_id = c.club_id
GROUP BY c.club_id
ORDER BY 인원 DESC;`,
    },
    {
      label: '동아리를 2개 이상 하는 학생 (HAVING)',
      sql: `SELECT s.name AS 이름, COUNT(*) AS 동아리_수
FROM students s
JOIN club_members m ON m.student_id = s.student_id
GROUP BY s.student_id
HAVING COUNT(*) >= 2;`,
    },
  ],
};

const CLASS_SCHEDULE: PlaygroundPreset = {
  id: 'class-schedule',
  version: 1,
  title: '교사-수업-과목-학생',
  summary: '수업(classes)은 "어떤 선생님이 어떤 과목을 언제, 어느 교실에서" 가르치는지 나타내요. 학생은 class_students로 여러 수업을 들어요.',
  tables: ['teachers', 'subjects', 'students', 'classes', 'class_students'],
  seedSql: `
CREATE TABLE teachers (
  teacher_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  office TEXT
);
CREATE TABLE subjects (
  subject_id INTEGER PRIMARY KEY,
  subject_name TEXT NOT NULL UNIQUE
);
CREATE TABLE students (
  student_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  grade INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 3)
);
CREATE TABLE classes (
  class_id INTEGER PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES teachers(teacher_id),
  subject_id INTEGER NOT NULL REFERENCES subjects(subject_id),
  day TEXT NOT NULL CHECK (day IN ('월','화','수','목','금')),
  period INTEGER NOT NULL CHECK (period BETWEEN 1 AND 7),
  room TEXT NOT NULL,
  UNIQUE (day, period, room)
);
CREATE TABLE class_students (
  class_id INTEGER NOT NULL REFERENCES classes(class_id),
  student_id INTEGER NOT NULL REFERENCES students(student_id),
  PRIMARY KEY (class_id, student_id)
);
INSERT INTO teachers VALUES
 (1,'한지수','본관 201'),(2,'서민준','본관 202'),(3,'오하린','신관 105'),(4,'문도윤','본관 310'),(5,'배서연',NULL);
INSERT INTO subjects VALUES (1,'데이터베이스'),(2,'프로그래밍'),(3,'인공지능 기초'),(4,'국어'),(5,'수학');
INSERT INTO students VALUES
 (1,'김가온',2),(2,'이나래',2),(3,'박다온',2),(4,'최라온',2),(5,'정마루',1),(6,'강바다',1),(7,'조사랑',3);
INSERT INTO classes VALUES
 (1,1,1,'월',1,'정보실1'),(2,1,1,'수',3,'정보실1'),(3,2,2,'화',2,'정보실2'),
 (4,3,3,'목',4,'AI실'),(5,4,4,'월',2,'2-1'),(6,5,5,'금',5,'2-2'),(7,2,2,'금',1,'정보실2');
INSERT INTO class_students VALUES
 (1,1),(1,2),(1,3),(2,4),(3,1),(3,5),(4,2),(4,6),(5,1),(5,2),(6,7),(7,3);
`,
  starters: [
    {
      label: '수업 시간표 (JOIN 3개 표)',
      sql: `SELECT c.day AS 요일, c.period AS 교시, j.subject_name AS 과목, t.name AS 선생님, c.room AS 교실
FROM classes c
JOIN teachers t ON t.teacher_id = c.teacher_id
JOIN subjects j ON j.subject_id = c.subject_id
ORDER BY CASE c.day WHEN '월' THEN 1 WHEN '화' THEN 2 WHEN '수' THEN 3 WHEN '목' THEN 4 ELSE 5 END, c.period;`,
    },
    {
      label: '학생별로 듣는 수업 (JOIN 4개 표)',
      sql: `SELECT s.name AS 학생, j.subject_name AS 과목, t.name AS 선생님, c.day || ' ' || c.period || '교시' AS 시간
FROM class_students cs
JOIN students s ON s.student_id = cs.student_id
JOIN classes c ON c.class_id = cs.class_id
JOIN subjects j ON j.subject_id = c.subject_id
JOIN teachers t ON t.teacher_id = c.teacher_id
ORDER BY s.name;`,
    },
    {
      label: '선생님별 수업 수와 학생 수',
      sql: `SELECT t.name AS 선생님, COUNT(DISTINCT c.class_id) AS 수업_수, COUNT(cs.student_id) AS 학생_수
FROM teachers t
LEFT JOIN classes c ON c.teacher_id = t.teacher_id
LEFT JOIN class_students cs ON cs.class_id = c.class_id
GROUP BY t.teacher_id;`,
    },
  ],
};

const LIBRARY_LOANS: PlaygroundPreset = {
  id: 'library-loans',
  version: 1,
  title: '도서 대출',
  summary: '학교 도서관의 대출 기록이에요. loans 표는 누가(학생) 무엇을(책) 언제 빌렸는지, 반납했는지(returned 0/1) 기록해요. 오늘은 2026-10-15로 생각해요.',
  tables: ['students', 'books', 'loans'],
  seedSql: `
CREATE TABLE students (
  student_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  grade INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 3),
  class_no INTEGER NOT NULL
);
CREATE TABLE books (
  book_id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  category TEXT NOT NULL,
  published_year INTEGER
);
CREATE TABLE loans (
  loan_id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(student_id),
  book_id INTEGER NOT NULL REFERENCES books(book_id),
  loan_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  returned INTEGER NOT NULL DEFAULT 0 CHECK (returned IN (0, 1)),
  return_date TEXT
);
INSERT INTO students VALUES
 (1,'김가온',2,1),(2,'이나래',2,1),(3,'박다온',2,2),(4,'최라온',1,2),(5,'정마루',1,3),(6,'강바다',3,1);
INSERT INTO books VALUES
 (1,'어린 왕자','생텍쥐페리','소설',1943),(2,'데미안','헤르만 헤세','소설',1919),
 (3,'코스모스','칼 세이건','과학',1980),(4,'이기적 유전자','리처드 도킨스','과학',1976),
 (5,'난중일기','이순신','역사',NULL),(6,'숲에서 배우는 SQL','배움숲 편집부','정보',2026),
 (7,'파이썬으로 만드는 게임','한코딩','정보',2024),(8,'우리말 바로 쓰기','국어연구회','언어',2021);
INSERT INTO loans VALUES
 (1,1,6,'2026-09-01','2026-09-15',1,'2026-09-14'),
 (2,1,3,'2026-10-01','2026-10-15',0,NULL),
 (3,2,1,'2026-09-20','2026-10-04',0,NULL),
 (4,3,6,'2026-09-16','2026-09-30',1,'2026-10-02'),
 (5,3,7,'2026-10-06','2026-10-20',0,NULL),
 (6,4,2,'2026-09-05','2026-09-19',1,'2026-09-18'),
 (7,5,4,'2026-09-25','2026-10-09',0,NULL),
 (8,2,6,'2026-10-08','2026-10-22',0,NULL),
 (9,4,1,'2026-10-10','2026-10-24',0,NULL),
 (10,1,5,'2026-08-20','2026-09-03',1,'2026-09-01');
`,
  starters: [
    {
      label: '아직 반납하지 않은 책 (JOIN)',
      sql: `SELECT s.name AS 학생, b.title AS 책, l.loan_date AS 대출일, l.due_date AS 반납_예정일
FROM loans l
JOIN students s ON s.student_id = l.student_id
JOIN books b ON b.book_id = l.book_id
WHERE l.returned = 0
ORDER BY l.due_date;`,
    },
    {
      label: '연체된 대출 (오늘 2026-10-15 기준)',
      sql: `SELECT s.name AS 학생, b.title AS 책, l.due_date AS 반납_예정일
FROM loans l
JOIN students s ON s.student_id = l.student_id
JOIN books b ON b.book_id = l.book_id
WHERE l.returned = 0 AND l.due_date < '2026-10-15';`,
    },
    {
      label: '많이 빌린 책 순위 (GROUP BY)',
      sql: `SELECT b.title AS 책, COUNT(l.loan_id) AS 대출_횟수
FROM books b
LEFT JOIN loans l ON l.book_id = b.book_id
GROUP BY b.book_id
ORDER BY 대출_횟수 DESC, b.title;`,
    },
  ],
};

const AFTERSCHOOL: PlaygroundPreset = {
  id: 'afterschool',
  version: 1,
  title: '방과후 신청',
  summary: '방과후 프로그램 신청 기록이에요. 정원(capacity)이 차면 대기가 되고, 신청 상태는 신청·확정·대기·취소 중 하나예요.',
  tables: ['students', 'programs', 'applications'],
  seedSql: `
CREATE TABLE students (
  student_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  grade INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 3),
  class_no INTEGER NOT NULL
);
CREATE TABLE programs (
  program_id INTEGER PRIMARY KEY,
  program_name TEXT NOT NULL UNIQUE,
  teacher_name TEXT NOT NULL,
  day TEXT NOT NULL CHECK (day IN ('월','화','수','목','금')),
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  fee INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE applications (
  application_id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(student_id),
  program_id INTEGER NOT NULL REFERENCES programs(program_id),
  applied_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '신청' CHECK (status IN ('신청','확정','대기','취소')),
  UNIQUE (student_id, program_id)
);
INSERT INTO students VALUES
 (1,'김가온',2,1),(2,'이나래',2,1),(3,'박다온',2,2),(4,'최라온',1,2),
 (5,'정마루',1,3),(6,'강바다',3,3),(7,'조사랑',3,1),(8,'윤아름',1,1);
INSERT INTO programs VALUES
 (1,'파이썬 게임 만들기','한지수','월',3,0),(2,'드론 코딩','서민준','화',4,20000),
 (3,'3D 프린팅','오하린','수',2,15000),(4,'영상 편집','문도윤','목',5,0),(5,'수학 탐구','배서연','금',6,0);
INSERT INTO applications VALUES
 (1,1,1,'2026-09-01 09:00','확정'),(2,2,1,'2026-09-01 09:02','확정'),(3,3,1,'2026-09-01 09:05','확정'),
 (4,4,1,'2026-09-01 09:10','대기'),(5,1,3,'2026-09-02 10:00','확정'),(6,5,3,'2026-09-02 10:01','확정'),
 (7,6,3,'2026-09-02 10:30','대기'),(8,2,2,'2026-09-03 13:00','신청'),(9,7,2,'2026-09-03 13:20','신청'),
 (10,5,4,'2026-09-04 15:00','확정'),(11,3,4,'2026-09-04 15:05','취소'),(12,6,5,'2026-09-05 08:40','신청');
`,
  starters: [
    {
      label: '학생별 신청 목록 (JOIN)',
      sql: `SELECT s.name AS 학생, p.program_name AS 프로그램, p.day AS 요일, a.status AS 상태
FROM applications a
JOIN students s ON s.student_id = a.student_id
JOIN programs p ON p.program_id = a.program_id
ORDER BY s.name;`,
    },
    {
      label: '프로그램별 확정 인원과 정원',
      sql: `SELECT p.program_name AS 프로그램, p.capacity AS 정원,
       SUM(CASE WHEN a.status = '확정' THEN 1 ELSE 0 END) AS 확정,
       SUM(CASE WHEN a.status = '대기' THEN 1 ELSE 0 END) AS 대기
FROM programs p
LEFT JOIN applications a ON a.program_id = p.program_id
GROUP BY p.program_id;`,
    },
    {
      label: '아무것도 신청하지 않은 학생 (NOT EXISTS)',
      sql: `SELECT s.name AS 이름
FROM students s
WHERE NOT EXISTS (SELECT 1 FROM applications a WHERE a.student_id = s.student_id);`,
    },
  ],
};

const LUNCH_SURVEY: PlaygroundPreset = {
  id: 'lunch-survey',
  version: 1,
  title: '급식 만족도',
  summary: '한 주 동안의 급식 메뉴와 학생들이 남긴 별점(1~5)이에요. 한 학생은 한 메뉴에 별점을 한 번만 줄 수 있어요(복합 기본키).',
  tables: ['students', 'menus', 'ratings'],
  seedSql: `
CREATE TABLE students (
  student_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  grade INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 3),
  class_no INTEGER NOT NULL
);
CREATE TABLE menus (
  menu_id INTEGER PRIMARY KEY,
  served_on TEXT NOT NULL UNIQUE,
  rice TEXT NOT NULL,
  main_dish TEXT NOT NULL,
  dessert TEXT,
  kcal INTEGER NOT NULL
);
CREATE TABLE ratings (
  student_id INTEGER NOT NULL REFERENCES students(student_id),
  menu_id INTEGER NOT NULL REFERENCES menus(menu_id),
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment TEXT,
  PRIMARY KEY (student_id, menu_id)
);
INSERT INTO students VALUES
 (1,'김가온',2,1),(2,'이나래',2,1),(3,'박다온',2,2),(4,'최라온',1,2),(5,'정마루',1,3),(6,'강바다',3,3);
INSERT INTO menus VALUES
 (1,'2026-10-12','쌀밥','돈가스','요구르트',820),(2,'2026-10-13','잡곡밥','된장찌개와 생선구이',NULL,710),
 (3,'2026-10-14','볶음밥','짜장 소스','귤',850),(4,'2026-10-15','쌀밥','닭갈비','아이스크림',880),
 (5,'2026-10-16','카레라이스','돈가스','바나나',900);
INSERT INTO ratings VALUES
 (1,1,5,'바삭해요'),(2,1,4,NULL),(3,1,5,'또 나왔으면'),(1,2,3,NULL),(4,2,2,'생선 가시가 많아요'),
 (2,3,4,NULL),(5,3,5,'최고'),(1,4,5,NULL),(3,4,4,'조금 매워요'),(4,4,5,NULL),(2,5,3,'카레가 싱거워요'),(5,5,4,NULL);
`,
  starters: [
    {
      label: '메뉴별 평균 별점 (JOIN + GROUP BY)',
      sql: `SELECT m.served_on AS 날짜, m.main_dish AS 메뉴, COUNT(r.stars) AS 응답, ROUND(AVG(r.stars), 2) AS 평균_별점
FROM menus m
LEFT JOIN ratings r ON r.menu_id = m.menu_id
GROUP BY m.menu_id
ORDER BY 평균_별점 DESC;`,
    },
    {
      label: '의견을 남긴 응답만 보기',
      sql: `SELECT s.name AS 학생, m.main_dish AS 메뉴, r.stars AS 별점, r.comment AS 의견
FROM ratings r
JOIN students s ON s.student_id = r.student_id
JOIN menus m ON m.menu_id = r.menu_id
WHERE r.comment IS NOT NULL;`,
    },
    {
      label: '한 번도 응답하지 않은 학생',
      sql: `SELECT s.name AS 이름
FROM students s
LEFT JOIN ratings r ON r.student_id = s.student_id
WHERE r.student_id IS NULL;`,
    },
  ],
};

export const PLAYGROUND_PRESETS: PlaygroundPreset[] = [STUDENT_SCORES, STUDENT_CLUBS, CLASS_SCHEDULE, LIBRARY_LOANS, AFTERSCHOOL, LUNCH_SURVEY];

export const PRESET_BY_ID: Record<PresetId, PlaygroundPreset> = Object.fromEntries(PLAYGROUND_PRESETS.map((p) => [p.id, p])) as Record<PresetId, PlaygroundPreset>;

export function isPresetId(id: string): id is PresetId {
  return Object.prototype.hasOwnProperty.call(PRESET_BY_ID, id);
}
