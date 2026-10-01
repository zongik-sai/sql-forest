import type { Unit, UnitId } from '../types';

const ids = (u: UnitId, n: number, p: 'A' | 'Q') => Array.from({ length: n }, (_, i) => `${u}-${p}0${i + 1}`);

function unit(u: Omit<Unit, 'activityIds' | 'checkpointIds' | 'extraMinutes'> & { extraMinutes?: number }): Unit {
  return { ...u, extraMinutes: u.extraMinutes ?? 0, activityIds: ids(u.id, 4, 'A'), checkpointIds: ids(u.id, 3, 'Q') };
}

/** 12단원·360분. 시간은 안내이며 강제 대기나 시간만으로 완료 처리하지 않는다. */
export const UNITS: Unit[] = [
  unit({ id: 'U01', order: 1, title: '표에서 데이터 모델로', minutes: 25, checkpointMinutes: 4, extraMinutes: 5, extraNote: '시작·최초 진단 5분 포함',
    concepts: ['모델링', '추상화·단순화·명확화', '개념/논리/물리 모델', '엔터티', '인스턴스', '속성', '도메인'],
    badgeId: 'badge:unit-U01', badgeName: '데이터 탐험가', intro: '학교 자료를 표로 정리하는 방법, 즉 데이터 모델의 기본 단어를 익혀요.' }),
  unit({ id: 'U02', order: 2, title: '관계·식별자·정규화', minutes: 30, checkpointMinutes: 5,
    concepts: ['관계', '차수·선택성', '식별/비식별 관계', 'PK/FK', '본질/인조 식별자', '함수종속', '1·2·3정규형', '모델과 조인·NULL'],
    badgeId: 'badge:unit-U02', badgeName: '관계 설계자', intro: '표와 표가 어떻게 연결되는지, 왜 표를 나누는지(정규화) 직접 해 봐요.' }),
  unit({ id: 'U03', order: 3, title: 'SELECT 첫 실행', minutes: 30, checkpointMinutes: 5,
    concepts: ['관계형 DB', 'SELECT', 'FROM', '별칭', 'DISTINCT', '산술식', '논리적 처리 순서'],
    badgeId: 'badge:unit-U03', badgeName: '조회 입문자', intro: '처음으로 SQL을 실행해 표에서 원하는 열을 꺼내 봐요.' }),
  unit({ id: 'U04', order: 4, title: 'WHERE와 NULL', minutes: 30, checkpointMinutes: 5,
    concepts: ['비교', 'AND/OR/NOT', '괄호', 'IN', 'BETWEEN', 'LIKE', 'NULL', 'IS NULL', '3값 논리'],
    badgeId: 'badge:unit-U04', badgeName: '조건 탐정', intro: '조건으로 행을 골라내고, NULL이 왜 특별한지 확인해요.' }),
  unit({ id: 'U05', order: 5, title: '함수와 CASE', minutes: 25, checkpointMinutes: 4,
    concepts: ['문자열 함수', '숫자 함수', '날짜 함수', '형변환', 'COALESCE', 'NULLIF', 'CASE', 'Oracle/SQL Server 차이'],
    badgeId: 'badge:unit-U05', badgeName: '함수 조합가', intro: '값을 바꾸고 계산하는 함수와, 조건에 따라 값을 고르는 CASE를 써 봐요.' }),
  unit({ id: 'U06', order: 6, title: 'GROUP BY와 HAVING', minutes: 30, checkpointMinutes: 5,
    concepts: ['COUNT/SUM/AVG/MIN/MAX', 'COUNT(*)와 COUNT(열)', 'NULL 집계', 'GROUP BY', 'HAVING', 'ORDER BY'],
    badgeId: 'badge:unit-U06', badgeName: '집계 분석가', intro: '여러 행을 그룹으로 묶어 개수·평균을 계산해요.' }),
  unit({ id: 'U07', order: 7, title: 'JOIN을 눈으로 이해', minutes: 35, checkpointMinutes: 6,
    concepts: ['INNER/LEFT/RIGHT/FULL/CROSS', '다중 테이블', 'ON/USING', '자연 조인', '다대다 중간 테이블', '외부조인 조건 위치'],
    badgeId: 'badge:unit-U07', badgeName: '조인 연결자', intro: '두 표의 같은 키를 직접 연결하며 JOIN 결과가 만들어지는 과정을 봐요.' }),
  unit({ id: 'U08', order: 8, title: '서브쿼리와 집합', minutes: 30, checkpointMinutes: 5,
    concepts: ['단일행/다중행/상관 서브쿼리', '스칼라·인라인뷰', 'IN/EXISTS/ANY/ALL', 'UNION/UNION ALL/INTERSECT/EXCEPT(MINUS)'],
    badgeId: 'badge:unit-U08', badgeName: '서브쿼리 탐험가', intro: '쿼리 안의 쿼리, 그리고 결과 집합을 더하고 빼는 방법을 익혀요.' }),
  unit({ id: 'U09', order: 9, title: '윈도우 함수와 Top N', minutes: 35, checkpointMinutes: 6,
    concepts: ['OVER', 'PARTITION BY', 'ORDER BY', 'RANK/DENSE_RANK/ROW_NUMBER', 'LAG/LEAD', '누적 집계', 'ROWS/RANGE', 'Top N'],
    badgeId: 'badge:unit-U09', badgeName: '순위 설계자', intro: '행을 줄이지 않고 순위와 누적합을 붙이는 윈도우 함수를 다뤄요.' }),
  unit({ id: 'U10', order: 10, title: '심화 SQL 첫 경험', minutes: 30, checkpointMinutes: 6,
    concepts: ['ROLLUP/CUBE/GROUPING SETS/GROUPING', '계층형 질의·셀프조인', 'PIVOT/UNPIVOT', '정규표현식'],
    badgeId: 'badge:unit-U10', badgeName: '변환 탐험가', intro: 'SQLite에는 없는 시험 문법(소계·계층·피벗·정규표현식)을 같은 결과의 SQLite 대안과 나란히 비교해요.' }),
  unit({ id: 'U11', order: 11, title: '데이터 변경·트랜잭션', minutes: 30, checkpointMinutes: 5,
    concepts: ['INSERT/UPDATE/DELETE/MERGE', 'COMMIT/ROLLBACK/SAVEPOINT', 'ACID', 'DDL·제약조건', 'DCL', 'DELETE/TRUNCATE/DROP'],
    badgeId: 'badge:unit-U11', badgeName: '데이터 관리자', intro: '안전한 샌드박스에서 데이터를 바꾸고 되돌려 봐요.' }),
  unit({ id: 'U12', order: 12, title: '통합 미션과 진단', minutes: 30, checkpointMinutes: 4, extraMinutes: 10, extraNote: '최종 진단 8분·결과 확인 2분 포함',
    concepts: ['모델→조회→집계→조인→서브쿼리→순위 연결', '개념 복습'],
    badgeId: 'badge:unit-U12', badgeName: 'SQL 숲 완성자', intro: '지금까지 배운 것을 연결해 캠프 데이터를 분석해요.' }),
];

export const UNIT_BY_ID: Record<UnitId, Unit> = Object.fromEntries(UNITS.map((u) => [u.id, u])) as Record<UnitId, Unit>;
export const UNIT_IDS: UnitId[] = UNITS.map((u) => u.id);
