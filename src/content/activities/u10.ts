import { defineActivity } from '../define';

const DETAIL = 'SELECT dept_name, month, SUM(participants) AS total FROM camp_monthly GROUP BY dept_name, month';
const BY_DEPT = 'SELECT dept_name, NULL, SUM(participants) FROM camp_monthly GROUP BY dept_name';
const BY_MONTH = 'SELECT NULL, month, SUM(participants) FROM camp_monthly GROUP BY month';
const GRAND = 'SELECT NULL, NULL, SUM(participants) FROM camp_monthly';
const ORDER = ' ORDER BY dept_name IS NULL, dept_name, month IS NULL, month';
const wrap = (inner: string) => `SELECT dept_name, month, total FROM (${inner})${ORDER}`;
const ROLLUP_SQL = `${DETAIL} UNION ALL ${BY_DEPT} UNION ALL ${GRAND}`;

export const U10 = [
  defineActivity({
    id: 'U10-A01', unitId: 'U10', title: '소계 조합 토글',
    objective: 'ROLLUP, CUBE, GROUPING SETS가 만드는 소계 행을 비교한다.',
    estimatedMinutes: 6,
    explanation: 'ROLLUP(A, B)는 (A,B) 상세, A별 소계, 전체 총계를 한 번에 만들어요. CUBE(A, B)는 B별 소계까지 모든 조합을 만들고, GROUPING SETS는 원하는 조합만 골라요. 소계 행의 빈 칸은 NULL로 나오고, GROUPING(열) 함수로 소계용 NULL인지 구별해요.',
    glossary: [
      { term: 'ROLLUP', meaning: '오른쪽 열부터 하나씩 빼며 소계와 총계를 만드는 GROUP BY 확장' },
      { term: 'CUBE', meaning: '가능한 모든 열 조합의 소계를 만드는 확장' },
      { term: 'GROUPING SETS', meaning: '필요한 그룹 조합만 나열해 만드는 확장' },
      { term: 'GROUPING(열)', meaning: '그 열이 소계 때문에 NULL이면 1, 아니면 0' },
    ],
    mode: 'dialect-comparison', datasetId: 'monthly',
    prompt: '"학과·월 상세 + 학과별 소계 + 전체 총계"가 나오는 확장 문법을 고르세요. SQLite에는 이 문법이 없어 같은 결과를 내는 UNION ALL 쿼리가 실제로 실행돼요.',
    prediction: {
      prompt: 'ROLLUP(dept_name, month) 결과는 몇 행일까요? (상세 5행, 학과 3개)',
      options: ['5행', '8행', '9행'],
      correctIndex: 2,
      reveal: '상세 5행 + 학과별 소계 3행 + 총계 1행 = 9행이에요.',
      verifySql: `SELECT COUNT(*) || '행' FROM (${ROLLUP_SQL})`,
    },
    hints: [
      '"학과별 소계"는 월을 뺀 묶음, "전체 총계"는 모두 뺀 묶음이에요.',
      '오른쪽 열부터 차례로 빼는 확장이 필요해요. 월별 소계는 필요 없어요.',
      'ROLLUP(dept_name, month)',
    ],
    solution: { sql: `-- Oracle/SQL Server: SELECT dept_name, month, SUM(participants) FROM camp_monthly GROUP BY ROLLUP(dept_name, month);\n${wrap(ROLLUP_SQL)};`, reasoning: 'ROLLUP(dept_name, month)은 (학과,월), (학과), () 세 묶음을 만들어요. CUBE는 월별 소계까지 더해 행이 더 많아요.', commonMistakes: ['CUBE를 골라 월별 소계까지 나오는 것'] },
    conceptTags: ['ROLLUP/CUBE/GROUPING SETS/GROUPING'],
    dialectNotes: ['ROLLUP/CUBE/GROUPING SETS/GROUPING은 표준 SQL이며 Oracle·SQL Server 등은 지원하지만 SQLite에는 없어요. 그래서 같은 결과의 UNION ALL 쿼리로 바꿔 실행했어요.', 'SQL Server는 GROUP BY dept_name, month WITH ROLLUP 형태도 지원해요.'],
    successMessage: 'ROLLUP으로 학과별 소계와 총계를 만들었어요.',
    config: {
      kind: 'row-filter',
      baseSql: 'SELECT dept_name, month, participants FROM camp_monthly',
      template: '{grouping}',
      slots: [{ id: 'grouping', label: 'GROUP BY 확장 (시험 문법)', options: [
        { label: 'GROUP BY dept_name, month', value: wrap(DETAIL) },
        { label: 'GROUP BY ROLLUP(dept_name, month)', value: wrap(ROLLUP_SQL) },
        { label: 'GROUP BY CUBE(dept_name, month)', value: wrap(`${DETAIL} UNION ALL ${BY_DEPT} UNION ALL ${BY_MONTH} UNION ALL ${GRAND}`) },
        { label: 'GROUP BY GROUPING SETS((dept_name), ())', value: wrap(`SELECT dept_name, NULL AS month, SUM(participants) AS total FROM camp_monthly GROUP BY dept_name UNION ALL ${GRAND}`) },
      ] }],
      solutionSql: wrap(ROLLUP_SQL),
      ordered: true,
    },
  }),
  defineActivity({
    id: 'U10-A02', unitId: 'U10', title: '부모-자식 트리와 셀프조인',
    objective: '계층형 데이터에서 하위 노드를 찾고, 셀프조인으로 부모를 연결한다.',
    estimatedMinutes: 6,
    explanation: '한 표 안에서 parent_id가 같은 표의 club_id를 가리키면 트리(계층) 구조가 돼요. 같은 표를 두 번 불러 이어 붙이는 것을 셀프조인이라 해요. Oracle은 START WITH … CONNECT BY PRIOR로 트리를 내려가고, SQLite는 WITH RECURSIVE로 같은 결과를 만들어요.',
    glossary: [
      { term: '계층형 질의', meaning: '부모-자식으로 이어진 데이터를 위에서 아래로 따라가는 질의' },
      { term: '셀프조인', meaning: '같은 표에 별칭을 두 개 붙여 자기 자신과 조인' },
      { term: 'WITH RECURSIVE', meaning: '자기 자신을 다시 참조하며 반복하는 CTE. SQLite의 계층 질의 대안' },
    ],
    mode: 'dialect-comparison', datasetId: 'clubs',
    prompt: '학술부 아래에 있는 모든 동아리(자식과 손자까지)를 트리에서 고르세요.',
    prediction: {
      prompt: '학술부의 바로 아래(자식) 동아리는 몇 개일까요?',
      options: ['1개', '2개', '4개'],
      correctIndex: 1,
      reveal: 'parent_id가 학술부(2)인 행은 SQL동아리와 로봇동아리 2개예요.',
      verifySql: "SELECT COUNT(*) || '개' FROM clubs_tree WHERE parent_id = 2",
    },
    hints: [
      'parent_id가 학술부의 club_id인 행이 자식이에요.',
      '자식의 자식(손자)도 포함해야 해요.',
      'SQL동아리 아래에는 스터디가 두 개 있어요.',
    ],
    solution: { sql: 'WITH RECURSIVE sub(club_id) AS (\n  SELECT club_id FROM clubs_tree WHERE parent_id = 2\n  UNION ALL\n  SELECT c.club_id FROM clubs_tree c JOIN sub ON c.parent_id = sub.club_id\n)\nSELECT club_id FROM sub;', reasoning: '학술부의 자식(SQL동아리, 로봇동아리)과 SQL동아리의 자식(SQL스터디A, B)까지 4개예요.', commonMistakes: ['손자 노드를 빼는 것', '학술부 자신을 포함하는 것'] },
    conceptTags: ['계층형 질의·셀프조인'],
    dialectNotes: ['Oracle의 START WITH / CONNECT BY PRIOR / LEVEL은 SQLite에서 실행되지 않아요. 같은 결과를 WITH RECURSIVE로 실제 실행해 비교했어요.'],
    successMessage: '트리에서 하위 동아리를 모두 찾았어요.',
    config: {
      kind: 'hierarchy',
      nodesSql: 'SELECT club_id, parent_id, club_name FROM clubs_tree ORDER BY club_id',
      answerSql: 'WITH RECURSIVE sub(club_id) AS (SELECT club_id FROM clubs_tree WHERE parent_id = 2 UNION ALL SELECT c.club_id FROM clubs_tree c JOIN sub ON c.parent_id = sub.club_id) SELECT club_id FROM sub',
      question: '학술부(2) 아래의 모든 동아리',
      dialectSql: "-- Oracle (SQLite에서 실행 안 됨)\n-- START WITH 행(학술부)도 LEVEL 1로 결과에 포함돼요\nSELECT LEVEL, club_name\nFROM clubs_tree\nSTART WITH club_id = 2\nCONNECT BY PRIOR club_id = parent_id;",
      runnable: [
        { label: 'WITH RECURSIVE로 하위 트리(LEVEL 포함)', sql: '-- 시작 행(학술부)도 lvl 1로 포함돼요\nWITH RECURSIVE sub(club_id, club_name, lvl) AS (\n  SELECT club_id, club_name, 1 FROM clubs_tree WHERE club_id = 2\n  UNION ALL\n  SELECT c.club_id, c.club_name, sub.lvl + 1\n  FROM clubs_tree c JOIN sub ON c.parent_id = sub.club_id\n)\nSELECT lvl, club_name FROM sub;' },
        { label: '셀프조인으로 부모 이름 붙이기', sql: 'SELECT c.club_name AS 동아리, p.club_name AS 부모\nFROM clubs_tree c LEFT JOIN clubs_tree p ON c.parent_id = p.club_id\nORDER BY c.club_id;' },
      ],
    },
  }),
  defineActivity({
    id: 'U10-A03', unitId: 'U10', title: '행↔열 피벗',
    objective: '세로로 쌓인 데이터를 월별 열로 펼친 결과를 직접 채운다.',
    estimatedMinutes: 6,
    explanation: 'PIVOT은 행으로 쌓인 값(3월, 4월)을 열 제목으로 펼쳐요. UNPIVOT은 반대로 여러 열을 행으로 접어요. SQLite에는 PIVOT이 없어서 CASE를 넣은 조건부 집계로 같은 표를 만들어요.',
    glossary: [
      { term: 'PIVOT', meaning: '행의 값을 열로 펼쳐 교차표를 만드는 연산' },
      { term: 'UNPIVOT', meaning: '여러 열을 행으로 접는 연산(PIVOT의 반대)' },
      { term: '조건부 집계', meaning: 'SUM(CASE WHEN 조건 THEN 값 END)처럼 조건에 맞는 값만 집계' },
    ],
    mode: 'dialect-comparison', datasetId: 'monthly',
    prompt: '학과별 3월·4월 참여 인원 교차표를 채우세요. 기록이 없는 칸은 비워 두세요(NULL).',
    hints: [
      '원본에서 학과와 월이 같은 행의 participants를 찾아 해당 칸에 적어요.',
      '같은 학과·월 행은 하나뿐이라 SUM해도 그 값이에요.',
      'AI콘텐츠디자인은 3월 기록이 없어 그 칸은 비워 둬요.',
    ],
    solution: { sql: "SELECT dept_name,\n  SUM(CASE WHEN month = '3월' THEN participants END) AS \"3월\",\n  SUM(CASE WHEN month = '4월' THEN participants END) AS \"4월\"\nFROM camp_monthly GROUP BY dept_name ORDER BY dept_name;", reasoning: '월 값이 열 제목이 되고 각 칸에 그 학과·월의 인원이 들어가요. 기록이 없으면 NULL이에요.', commonMistakes: ['기록 없는 칸에 0을 적는 것(NULL과 0은 달라요)'] },
    conceptTags: ['PIVOT/UNPIVOT', '조건부 집계'],
    dialectNotes: ["Oracle은 PIVOT (SUM(participants) FOR month IN ('3월', '4월')), SQL Server는 FOR month IN ([3월], [4월])처럼 대괄호를 써요. 둘 다 SQLite에서는 실행되지 않아 조건부 집계로 같은 표를 만들어 비교해요."],
    successMessage: '세로 데이터를 월별 열로 펼쳤어요.',
    config: {
      kind: 'pivot',
      sourceSql: 'SELECT dept_name, month, participants FROM camp_monthly ORDER BY dept_name, month',
      answerSql: "SELECT dept_name, SUM(CASE WHEN month = '3월' THEN participants END) AS \"3월\", SUM(CASE WHEN month = '4월' THEN participants END) AS \"4월\" FROM camp_monthly GROUP BY dept_name ORDER BY dept_name",
      dialectSql: "-- Oracle (SQLite에서 실행 안 됨)\nSELECT *\nFROM camp_monthly\nPIVOT (SUM(participants) FOR month IN ('3월' AS \"3월\", '4월' AS \"4월\"));",
      equivalentSql: "SELECT dept_name,\n  SUM(CASE WHEN month = '3월' THEN participants END) AS \"3월\",\n  SUM(CASE WHEN month = '4월' THEN participants END) AS \"4월\"\nFROM camp_monthly\nGROUP BY dept_name\nORDER BY dept_name;",
    },
  }),
  defineActivity({
    id: 'U10-A04', unitId: 'U10', title: '정규표현식으로 문자열 분류',
    objective: '정규표현식 패턴이 어떤 문자열과 맞는지 판단한다.',
    estimatedMinutes: 6,
    explanation: '정규표현식은 문자열의 모양을 기호로 적은 패턴이에요. ^는 시작, $는 끝, [0-9]는 숫자 한 개, {4}는 앞의 것이 4번이라는 뜻이에요. Oracle은 REGEXP_LIKE(열, 패턴)으로 행을 걸러요.',
    glossary: [
      { term: '정규표현식', meaning: '문자열 패턴을 기호로 표현한 것. 예: ^[0-9]{3}$ = 숫자 3개만' },
      { term: '^ / $', meaning: '문자열의 시작 / 끝' },
      { term: '[0-9]{4}', meaning: '숫자가 정확히 4번' },
    ],
    mode: 'simulation', datasetId: 'school',
    prompt: '아래 세 패턴을 보고 각 문자열이 어떤 형식에 맞는지 고르세요. 어느 것에도 맞지 않으면 "해당 없음"이에요.',
    prediction: {
      prompt: "'02-123-4567'은 전화번호 패턴 ^010-[0-9]{4}-[0-9]{4}$ 에 맞을까요?",
      options: ['맞다', '맞지 않다'],
      correctIndex: 1,
      reveal: "패턴은 '010-'으로 시작하고 숫자 4개-4개여야 해서 맞지 않아요.",
    },
    hints: [
      '이메일: ^[A-Za-z0-9._]+@[A-Za-z0-9.]+\\.[a-z]{2,}$',
      '전화: ^010-[0-9]{4}-[0-9]{4}$ / 날짜: ^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
      '^와 $가 있으면 문자열 전체가 패턴과 정확히 맞아야 해요.',
    ],
    solution: { reasoning: '패턴을 문자열 전체에 적용해 처음 맞는 형식을 골라요. 02-123-4567과 SQL캠프는 어느 패턴에도 맞지 않아요.', commonMistakes: ['일부만 비슷하면 맞는다고 생각하는 것(^$는 전체 일치)'] },
    conceptTags: ['정규표현식'],
    dialectNotes: ['SQLite 기본 빌드에는 REGEXP 함수가 없어요. 이 활동은 브라우저 정규식 엔진으로 같은 패턴을 적용한 시뮬레이션이에요.', 'Oracle: REGEXP_LIKE, REGEXP_SUBSTR, REGEXP_REPLACE, REGEXP_INSTR, REGEXP_COUNT'],
    successMessage: '정규표현식으로 문자열을 분류했어요.',
    config: {
      kind: 'classify', layout: 'bins',
      items: [
        { id: 's1', label: 'sql2026@school.kr' }, { id: 's2', label: '010-1234-5678' }, { id: 's3', label: '2026-03-02' },
        { id: 's4', label: 'SQL캠프' }, { id: 's5', label: '02-123-4567' }, { id: 's6', label: 'ai.bot@forest.org' },
      ],
      options: [{ id: 'email', label: '이메일 형식' }, { id: 'phone', label: '전화번호 형식' }, { id: 'date', label: '날짜 형식' }, { id: 'none', label: '해당 없음' }],
      answer: { source: 'static', map: { s1: 'email', s2: 'phone', s3: 'date', s4: 'none', s5: 'none', s6: 'email' } },
      patterns: [
        { optionId: 'email', regex: '^[A-Za-z0-9._]+@[A-Za-z0-9.]+\\.[a-z]{2,}$' },
        { optionId: 'phone', regex: '^010-[0-9]{4}-[0-9]{4}$' },
        { optionId: 'date', regex: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
      ],
      fallbackOptionId: 'none',
    },
  }),
];
