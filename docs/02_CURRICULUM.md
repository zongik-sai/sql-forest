# 12단원·360분 커리큘럼

아래는 SQLD 범위에 맞춘 제작용 설계다. 최신 공식 상세 범위의 대조 상태는 13_SOURCES.md를 따른다. 심화도 첫 경험을 제공하되 숙달은 후속 복습으로 이어진다.

| ID | 분 | 제목 | 핵심 개념 | 4개 필수 인터랙티브 활동 |
|---|---:|---|---|---|
| U01 | 25 | 표에서 데이터 모델로 | 모델링, 추상화·단순화·명확화, 개념/논리/물리 모델, 엔터티, 인스턴스, 속성, 도메인 | ①학교 자료를 엔터티/속성/값으로 분류 ②행·열 클릭으로 인스턴스/속성 찾기 ③개념→논리→물리 모델 카드 연결 ④도메인에 맞지 않는 값 고치기 |
| U02 | 30 | 관계·식별자·정규화 | 관계, 차수·선택성, 식별/비식별 관계, PK/FK, 본질/인조 식별자, 함수종속, 1·2·3정규형, 모델과 조인·NULL·트랜잭션 | ①학생-수강 ERD 연결 ②PK/FK·식별자 선택 ③수강표를 정규화하며 이상현상 제거 ④관계·NULL·트랜잭션을 SQL 결과와 연결 |
| U03 | 30 | SELECT 첫 실행 | 관계형 DB, SELECT, FROM, 별칭, DISTINCT, 산술식, 논리적 처리 순서 | ①SELECT/FROM 블록 조립 ②결과 열·행 예측 ③DISTINCT 중복 변화 비교 ④FROM→WHERE→GROUP BY→HAVING→SELECT→ORDER BY 카드 정렬 |
| U04 | 30 | WHERE와 NULL | 비교, AND/OR/NOT, 괄호, IN, BETWEEN, LIKE, NULL, IS NULL, 3값 논리 | ①조건 슬라이더로 선택 행 보기 ②AND/OR 괄호별 결과 비교 ③LIKE 패턴 맞추기 ④NULL·NOT IN 함정 고치기 |
| U05 | 25 | 함수와 CASE | 문자열/숫자/날짜 함수, 형변환, COALESCE, NULLIF, CASE, Oracle/SQL Server 차이 | ①문자열 함수 입력/출력 연결 ②ROUND·날짜·형변환 실험 ③COALESCE/NULLIF로 값 변화 보기 ④CASE 등급표 만들기 |
| U06 | 30 | GROUP BY와 HAVING | COUNT/SUM/AVG/MIN/MAX, COUNT(*)/COUNT(열), NULL 집계, GROUP BY, HAVING, ORDER BY | ①행을 그룹 상자에 넣고 집계 ②COUNT(*)와 COUNT(score) 비교 ③WHERE와 HAVING 위치 고치기 ④학과별 평균 SQL 완성 |
| U07 | 35 | JOIN을 눈으로 이해 | INNER/LEFT/RIGHT/FULL/CROSS, 다중 테이블, ON/USING, 자연 조인, 다대다 중간 테이블, 외부조인 조건 위치 | ①두 표의 같은 키 연결 ②INNER/LEFT 결과 전환 ③다대다 조인과 중복행 확인 ④LEFT JOIN의 ON/WHERE 차이 고치기 |
| U08 | 30 | 서브쿼리와 집합 | 단일행/다중행/상관 서브쿼리, 스칼라·인라인뷰, IN/EXISTS/ANY/ALL, UNION/UNION ALL/INTERSECT/EXCEPT(MINUS) | ①서브쿼리 결과를 바깥 조건에 넣기 ②EXISTS를 학생별로 단계 실행 ③UNION과 UNION ALL 중복 비교 ④IN·NOT IN·ANY·ALL 결과 예측 |
| U09 | 35 | 윈도우 함수와 Top N | OVER, PARTITION BY, ORDER BY, RANK/DENSE_RANK/ROW_NUMBER, LAG/LEAD, 누적 집계, ROWS/RANGE, Top N | ①동점 순위 번호 붙이기 ②학과별 PARTITION 변화 보기 ③LAG/LEAD·누적합 실행 ④상위 N과 동점 포함 여부 비교 |
| U10 | 30 | 심화 SQL 첫 경험 | ROLLUP/CUBE/GROUPING SETS/GROUPING, 계층형 질의·셀프조인, PIVOT/UNPIVOT, 정규표현식 | ①소계 조합 토글 ②부모-자식 트리와 셀프조인 연결 ③행↔열 피벗 조작 ④정규표현식으로 문자열 분류 |
| U11 | 30 | 데이터 변경·트랜잭션 | INSERT/UPDATE/DELETE/MERGE 개념, COMMIT/ROLLBACK/SAVEPOINT, ACID, DDL·제약조건, DCL, DELETE/TRUNCATE/DROP | ①샌드박스 INSERT/UPDATE/DELETE 전후 비교 ②COMMIT/ROLLBACK/SAVEPOINT 상태 이동 ③제약조건 위반 고치기 ④DDL/DML/TCL/DCL과 권한 카드 분류 |
| U12 | 30 | 통합 미션과 진단 | 모델→조회→집계→조인→서브쿼리→순위 연결, 개념 복습 | ①캠프 참여 학생 조회 ②미참여 학생 찾기 ③학과별 참여·평균 점수 집계 ④동점 순위·상위 학생 조회 |
| 합계 | 360 | | | |

각 단원 시간은 4개 활동, 짧은 설명, 체크포인트를 포함한다. U01은 시작·최초 진단 5분을 포함하며 U12는 통합 미션 16분, 체크포인트 4분, 최종 진단 12문항 8분, 결과 확인 2분이다. 최종 진단은 모델링 2, 기본 조회·함수 3, 집계·조인 3, 활용 3, 관리구문 1문항으로 자체 구성하며 공식 모의고사라고 부르지 않는다.

모든 단원에 3문항 체크포인트를 작성한다. 시간 초과로 미완료 단원을 강제 완료하지 않는다. 6시간은 예상 소요시간이며 속도에 따라 달라진다.
