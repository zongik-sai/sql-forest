import { defineActivity } from '../define';
import type { Challenge, LessonActivity } from '../types';

/**
 * 도전 모드 12문제(단원당 1개). 6시간 필수 코스 바깥의 선택 복습이며
 * 정규 48개 활동과 별도 ID(CH-Uxx)를 가진다. XP를 주지 않고 숙련 기록·배지만 남긴다.
 */
const acts: LessonActivity[] = [
  defineActivity({
    id: 'CH-U01', unitId: 'U01', title: '도전: 동아리 자료 분류',
    objective: '새 상황(동아리)에서 엔터티·속성·속성값을 구분한다.', estimatedMinutes: 4,
    explanation: '엔터티는 관리할 대상의 묶음, 속성은 그 특징, 속성값은 실제 값이에요.',
    glossary: [], mode: 'simulation', datasetId: 'clubs',
    prompt: '동아리 관리 자료의 각 카드를 엔터티·속성·속성값으로 분류하세요.',
    hints: ['"~들"로 셀 수 있는 대상 묶음이 엔터티예요.', '"동아리의 ○○"에서 ○○이 속성이에요.', "따옴표 안의 값과 숫자는 속성값이에요."],
    solution: { reasoning: '동아리·부원은 엔터티, 동아리명·가입일은 속성, 로봇동아리·12는 속성값이에요.', commonMistakes: [] },
    conceptTags: ['엔터티', '속성'], successMessage: '도전 성공: 새 자료도 분류했어요.',
    config: {
      kind: 'classify', layout: 'bins',
      items: [{ id: 'a', label: '동아리' }, { id: 'b', label: '동아리명' }, { id: 'c', label: "'로봇동아리'" }, { id: 'd', label: '부원' }, { id: 'e', label: '가입일' }, { id: 'f', label: '12 (부원 수)' }],
      options: [{ id: 'entity', label: '엔터티' }, { id: 'attribute', label: '속성' }, { id: 'value', label: '속성값' }],
      answer: { source: 'static', map: { a: 'entity', b: 'attribute', c: 'value', d: 'entity', e: 'attribute', f: 'value' } },
    },
  }),
  defineActivity({
    id: 'CH-U02', unitId: 'U02', title: '도전: 정규형 위반 찾기',
    objective: '표 설명을 보고 어떤 정규형을 위반했는지 판단한다.', estimatedMinutes: 5,
    explanation: '1정규형은 칸마다 값 하나, 2정규형은 부분 종속 없음, 3정규형은 이행 종속 없음이에요.',
    glossary: [], mode: 'simulation', datasetId: 'normal',
    prompt: '각 표 설명이 가장 먼저 위반하는 정규형을 고르세요.',
    hints: ['한 칸에 여러 값이 있으면 가장 기본 규칙 위반이에요.', '복합키의 일부에만 종속되면 2정규형, 일반 열을 거치면 3정규형 위반이에요.', '키가 열 하나뿐인 표에는 부분 종속이 생길 수 없어요.'],
    solution: { reasoning: '값 여러 개 → 1NF, 복합키 일부 종속 → 2NF, 일반 열을 거친 종속 → 3NF 위반이에요.', commonMistakes: [] },
    conceptTags: ['1·2·3정규형'], successMessage: '도전 성공: 정규형 위반을 찾아냈어요.',
    config: {
      kind: 'classify', layout: 'bins',
      items: [
        { id: 't1', label: "students(student_id PK, 수강강좌='SQL캠프, IoT캠프')" },
        { id: 't2', label: 'enrollment((student_id, course_id) 복합 PK, course_name, score) — course_name은 course_id만으로 정해짐' },
        { id: 't3', label: 'students(student_id PK, dept_id, dept_name) — dept_name은 dept_id가 정함' },
        { id: 't4', label: 'courses(course_id PK, course_name) — 모든 열이 키에만 종속' },
      ],
      options: [{ id: '1nf', label: '1정규형 위반' }, { id: '2nf', label: '2정규형 위반' }, { id: '3nf', label: '3정규형 위반' }, { id: 'ok', label: '위반 없음' }],
      answer: { source: 'static', map: { t1: '1nf', t2: '2nf', t3: '3nf', t4: 'ok' } },
    },
  }),
  ...([
    ['CH-U03', 'U03', '도전: 학과 번호 내림차순', '학생들이 속한 학과 번호를 중복 없이, 큰 번호부터 조회하세요.', 'SELECT DISTINCT dept_id FROM students ORDER BY dept_id DESC', true, ['DISTINCT', 'ORDER BY'], 'school'],
    ['CH-U04', 'U04', '도전: 범위와 NULL 조건', '점수가 80 이상 90 미만이거나 점수가 없는(NULL) 수강 행의 student_id, course_id를 조회하세요.', 'SELECT student_id, course_id FROM enrollment WHERE (score >= 80 AND score < 90) OR score IS NULL', false, ['AND/OR/NOT', 'IS NULL'], 'school'],
    ['CH-U05', 'U05', '도전: 세 갈래 CASE', "수강 행마다 점수 90 이상은 '우수', NULL은 '미입력', 나머지는 '보통'으로 student_id, course_id, 평가를 조회하세요.", "SELECT student_id, course_id, CASE WHEN score IS NULL THEN '미입력' WHEN score >= 90 THEN '우수' ELSE '보통' END FROM enrollment", false, ['CASE', 'NULL'], 'school'],
    ['CH-U06', 'U06', '도전: 강좌별 최고·최저', '수강 기록이 있는 강좌(course_id)별로 enrollment에서 최고 점수, 최저 점수, 두 점수의 차이를 조회하세요.', 'SELECT course_id, MAX(score), MIN(score), MAX(score) - MIN(score) FROM enrollment GROUP BY course_id', false, ['GROUP BY', '집계 함수'], 'school'],
    ['CH-U07', 'U07', '도전: 강좌별 수강 인원(0명 포함)', '모든 강좌의 강좌명과 수강 인원(0명 포함)을 강좌명 순으로 조회하세요.', 'SELECT c.course_name, COUNT(e.student_id) FROM courses c LEFT JOIN enrollment e ON e.course_id = c.course_id GROUP BY c.course_id, c.course_name ORDER BY c.course_name', true, ['LEFT JOIN', 'COUNT(*)와 COUNT(열)'], 'school'],
    ['CH-U08', 'U08', '도전: 우리 학과 평균보다 높은 학년', '자기 학과의 평균 학년보다 학년이 높은 학생의 이름을 조회하세요.', 'SELECT s.student_name FROM students s WHERE s.grade > (SELECT AVG(t.grade) FROM students t WHERE t.dept_id = s.dept_id)', false, ['상관 서브쿼리'], 'school'],
    ['CH-U09', 'U09', '도전: 포인트 합계 순위', '학생별(student_id) 포인트 합계와, 합계가 높은 순 DENSE_RANK를 student_id, 합계, 순위로 조회하세요.', 'SELECT student_id, SUM(points), DENSE_RANK() OVER (ORDER BY SUM(points) DESC) FROM point_events GROUP BY student_id', false, ['RANK/DENSE_RANK/ROW_NUMBER', 'GROUP BY'], 'points'],
    ['CH-U10', 'U10', '도전: 부모 동아리 이름', '모든 동아리의 이름과 부모 동아리 이름(최상위는 NULL)을 club_id 순으로 조회하세요.', 'SELECT c.club_name, p.club_name FROM clubs_tree c LEFT JOIN clubs_tree p ON p.club_id = c.parent_id ORDER BY c.club_id', true, ['계층형 질의·셀프조인'], 'clubs'],
    ['CH-U12', 'U12', '도전: 강좌별 1등(동점 포함)', '강좌마다 점수 1등 학생(동점 모두)의 강좌명과 학생 이름을 강좌명, 학생 이름 순으로 조회하세요.', 'SELECT c.course_name, s.student_name FROM (SELECT e.*, RANK() OVER (PARTITION BY course_id ORDER BY score DESC) AS r FROM enrollment e WHERE score IS NOT NULL) t JOIN students s ON s.student_id = t.student_id JOIN courses c ON c.course_id = t.course_id WHERE t.r = 1 ORDER BY c.course_name, s.student_name', true, ['PARTITION BY', 'Top N'], 'school'],
  ] as const).map(([id, unitId, title, prompt, solutionSql, ordered, tags, ds]) =>
    defineActivity({
      id, unitId, title, objective: '안내 없이 같은 목표의 변형 문제를 해결한다.', estimatedMinutes: 5,
      explanation: '도전 문제예요. 막히면 "기본 모드로 배우기"를 눌러 설명과 힌트를 볼 수 있어요.',
      glossary: [], mode: 'executable', datasetId: ds, prompt,
      hints: ['문제에서 필요한 열과 표를 먼저 정리해 보세요.', '같은 단원의 핵심 활동을 떠올려 보세요.', `정답 구조: ${solutionSql.split(' ').slice(0, 6).join(' ')} …`],
      solution: { sql: solutionSql + ';', reasoning: '결과 기반으로 채점해요. 같은 결과를 내는 다른 SQL도 정답이에요.', commonMistakes: [] },
      conceptTags: [...tags], successMessage: '도전 성공: 스스로 SQL을 완성했어요.',
      config: { kind: 'sql-editor', starterSql: '', solutionSql, ordered },
    }),
  ),
  defineActivity({
    id: 'CH-U11', unitId: 'U11', title: '도전: 필요한 신청만 확정',
    objective: '트랜잭션 제어로 원하는 변경만 남긴다.', estimatedMinutes: 5,
    explanation: '트랜잭션은 BEGIN으로 시작해 COMMIT 또는 ROLLBACK으로 끝나요. SAVEPOINT로 일부만 되돌릴 수 있어요.',
    glossary: [], mode: 'executable', datasetId: 'sandbox',
    prompt: '마루의 SQL캠프 신청(INSERT)은 COMMIT으로 저장하고, 바다의 IoT캠프 신청은 남기지 마세요. 마지막에는 트랜잭션이 닫혀 있어야 해요.',
    hints: ['BEGIN으로 시작하세요.', '두 INSERT 사이에 저장점을 만들면 뒤쪽만 되돌릴 수 있어요.', 'BEGIN → 마루 INSERT → (바다 INSERT를 하지 않거나 ROLLBACK TO) → COMMIT'],
    solution: { sql: "BEGIN;\nINSERT INTO camp_signup(student_id, camp_name) VALUES (5, 'SQL캠프');\nCOMMIT;", reasoning: '마루 신청만 남긴 상태로 COMMIT하면 돼요. 바다 신청을 넣었다면 저장점으로 되돌려요.', commonMistakes: [] },
    conceptTags: ['COMMIT/ROLLBACK/SAVEPOINT'], successMessage: '도전 성공: 트랜잭션을 원하는 상태로 확정했어요.',
    config: {
      kind: 'transaction', initialLog: [],
      actions: [
        { id: 'begin', label: 'BEGIN', sql: 'BEGIN' },
        { id: 'ins_maru', label: '마루 SQL캠프 INSERT', sql: "INSERT INTO camp_signup(student_id, camp_name) VALUES (5, 'SQL캠프')" },
        { id: 'sp', label: 'SAVEPOINT a', sql: 'SAVEPOINT a' },
        { id: 'ins_bada', label: '바다 IoT캠프 INSERT', sql: "INSERT INTO camp_signup(student_id, camp_name) VALUES (6, 'IoT캠프')" },
        { id: 'rb_to', label: 'ROLLBACK TO a', sql: 'ROLLBACK TO a' },
        { id: 'commit', label: 'COMMIT', sql: 'COMMIT' },
        { id: 'rollback', label: 'ROLLBACK', sql: 'ROLLBACK' },
      ],
      stateSql: 'SELECT signup_id, student_id, camp_name, status FROM camp_signup ORDER BY signup_id',
      solutionActions: ['BEGIN', "INSERT INTO camp_signup(student_id, camp_name) VALUES (5, 'SQL캠프')", 'COMMIT'],
      requireClosed: true,
    },
  }),
];

export const CHALLENGES: Challenge[] = acts
  .sort((a, b) => a.id.localeCompare(b.id))
  .map((a) => ({ id: a.id, unitId: a.unitId, contentVersion: a.contentVersion, activity: a }));
