# 공통 데이터·SQL·채점

## 기준 데이터 SQL(SQLite)
각 활동 시작 시 새 DB 또는 기준 스냅샷으로 초기화한다. 학생 이름은 가상이다.
```sql
PRAGMA foreign_keys = ON;
CREATE TABLE departments(dept_id INTEGER PRIMARY KEY, dept_name TEXT NOT NULL UNIQUE);
CREATE TABLE students(student_id INTEGER PRIMARY KEY, student_name TEXT NOT NULL,
 dept_id INTEGER NOT NULL REFERENCES departments(dept_id), grade INTEGER NOT NULL CHECK(grade BETWEEN 1 AND 3));
CREATE TABLE courses(course_id INTEGER PRIMARY KEY, course_name TEXT NOT NULL);
CREATE TABLE enrollment(student_id INTEGER NOT NULL REFERENCES students(student_id),
 course_id INTEGER NOT NULL REFERENCES courses(course_id), score INTEGER CHECK(score BETWEEN 0 AND 100),
 PRIMARY KEY(student_id,course_id));
INSERT INTO departments VALUES(10,'AI컴퓨터'),(20,'AI로봇'),(30,'AI콘텐츠디자인'),(40,'전기에너지');
INSERT INTO students VALUES(1,'가온',10,3),(2,'나래',10,3),(3,'다온',20,2),(4,'라온',20,3),(5,'마루',30,1),(6,'바다',10,2);
INSERT INTO courses VALUES(101,'SQL캠프'),(102,'IoT캠프'),(103,'AI캠프');
INSERT INTO enrollment VALUES(1,101,90),(1,102,80),(2,101,90),(3,101,NULL),(3,102,70),(6,102,80);
```

불일치 키를 외부조인 예시로 만들기 위해 FK를 위반하는 행을 몰래 추가하지 않는다. 수강 없는 학생·학생 없는 학과·수강 없는 강좌로 외부조인을 설명한다.

## 대표 정답과 예상 결과
```sql
-- A: 기본 조회 결과 ID 1,2
SELECT student_id,student_name FROM students WHERE grade=3 AND dept_id=10 ORDER BY student_id;
-- B: COUNT(*)=6, COUNT(score)=5, AVG(score)=82
SELECT COUNT(*) AS row_count,COUNT(score) AS score_count,AVG(score) AS avg_score FROM enrollment;
-- C: 미수강 학생 ID 4,5
SELECT s.student_id FROM students s WHERE NOT EXISTS
 (SELECT 1 FROM enrollment e WHERE e.student_id=s.student_id) ORDER BY s.student_id;
-- D: LEFT JOIN 결과 총 8행(수강 6행+미수강 2행)
SELECT s.student_id,e.course_id,e.score FROM students s LEFT JOIN enrollment e
 ON s.student_id=e.student_id ORDER BY s.student_id,e.course_id;
-- E: SQL캠프 동점 순위(학생 ID 순): (1,90,1,1,1),(2,90,1,1,2),(3,NULL,3,2,3)
SELECT student_id,score,
 RANK() OVER(ORDER BY score DESC) AS r,
 DENSE_RANK() OVER(ORDER BY score DESC) AS dr,
 ROW_NUMBER() OVER(ORDER BY score DESC,student_id) AS rn
FROM enrollment WHERE course_id=101 ORDER BY student_id;
```
E의 NULL 정렬은 SQLite DESC 기준이다. DBMS마다 기본 NULL 정렬이 다를 수 있음을 표시하고, 시험 문법 비교에는 명시적인 정렬 조건을 사용한다. ROW_NUMBER에는 동점 구분키를 넣되 RANK/DENSE_RANK에는 넣지 않는다.

## 추가 데이터
U02 정규화는 `(student_id,course_id)` 복합키, student_name의 부분 종속, course_name의 부분 종속, dept_id→dept_name의 이행 종속을 보여주는 별도 비정규 수강표를 만든다. U09 누적합은 동일 날짜의 여러 행을 포함한 point_events, U10 계층은 parent_id가 있는 clubs_tree, 피벗은 학과·월·참여인원 데이터, U11은 별도의 수정 가능 테이블을 추가한다. 모든 데이터는 재현 가능한 seed와 예상 결과를 갖춘다.

## 채점
- 쿼리 텍스트 동일성 대신 기준 DB에서 실행한 학생 결과와 정답 결과를 비교한다. 별칭은 과제에서 요구하지 않으면 무시하고 열 개수·위치·값을 비교한다.
- ORDER BY를 요구하는 과제만 행 순서 비교. 나머지는 multiset으로 비교하며 중복을 보존한다.
- NULL과 빈 문자열과 0을 구별한다. 숫자 비교는 지정된 부동소수 허용오차 적용. 날짜·문자열을 임의로 바꾸지 않는다.
- 다른 seed의 숨은 검증 데이터에서도 실행해 결과를 확인한다. 이는 학습용 검증이며 클라이언트에서 보안상 비밀 데이터라는 의미가 아니다.
- DML은 실행 후 상태·제약조건·영향 행수로 판정한다. 기준 정답과 학생 쿼리는 각각 별도의 DB 인스턴스에서 실행한다.
- 구문 오류는 위치와 쉬운 설명을 제공한다. 무한 재귀·장시간 쿼리는 Worker 종료 후 복원한다.
