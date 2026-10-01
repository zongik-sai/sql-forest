# 기술 설계

## 기본 스택과 구조
React+TypeScript+Vite, Supabase Auth/Postgres, SQLite WASM 또는 sql.js Worker, Vitest, Playwright. 에디터는 CodeMirror 등 접근성·번들 크기를 고려해 선택한다. 현재 공식 문서로 API 호환성을 확인하고 lockfile을 저장한다.

권장 구조: `src/content/{units,activities,questions}`, `src/features/{learning,playground,auth,progress,focus,review}`, `src/sql/{worker,grader,datasets}`, `src/components`, `supabase/migrations`, `tests`. 앱 데이터와 학습 콘텐츠를 분리한다.

## SQL 실행
- SQLite 파일/WASM은 앱에서 제공하고 필요시 lazy load한다. CSP·Worker 경로를 빌드에서도 검증한다.
- SELECT 활동은 실행 가능한 문을 허용 목록으로 제한한다. DML/DDL 활동은 별도 샌드박스에서 필요한 문만 허용한다. 단순 문자열 정규식만으로 SQL을 안전하다고 판정하지 말고 파서 또는 준비된 문 타입 판정을 사용한다.
- ATTACH, 외부 파일 접근, 확장 로딩, 비허용 PRAGMA를 차단한다. SQL 실행은 항상 Worker에서만 수행한다. 제한은 기본 2초, 표시 결과 최대 200행, 쿼리 길이 최대 20KB. 초과 시 명확한 안내와 DB 복원.
- 학습 DB는 매 활동 독립. 자유 실습장은 독립 세션. Supabase 인증 토큰·진도 DB 접근정보를 Worker에 전달하지 않는다.
- Worker 결과에는 requestId, activityId, generation을 포함한다. 가림/활동 변경 뒤 도착한 결과는 점수·타이머·완료 상태를 바꾸지 못한다.

## SQLD 문법과 SQLite 차이
실행: SELECT·조인·집계·CASE·서브쿼리·집합·윈도우·기본 DDL/DML/TCL을 실제 엔진 지원 여부 검증 후 제공한다.
비교/시뮬레이션: Oracle NVL/DECODE/TO_DATE/TO_CHAR/ROWNUM/CONNECT BY/MINUS, SQL Server ISNULL/TOP, ROLLUP/CUBE/GROUPING SETS/GROUPING, PIVOT/UNPIVOT, REGEXP, MERGE, GRANT/REVOKE, TRUNCATE 등 미지원 기능.
SQLite 버전에 따라 RIGHT/FULL JOIN 지원이 다르므로 확인하고 실행 또는 시뮬레이션을 결정한다. 재귀 CTE·조건부 집계는 같은 개념의 대안으로 보여주되 원문 문법과 동일하다고 설명하지 않는다. SQLite 형변환·타입 친화도, 문자열 결합, 날짜 처리, NULL 정렬, 트랜잭션/DDL 동작을 SQLD의 모든 DBMS 규칙으로 일반화하지 않는다.

## 저장과 배포 준비
프로젝트는 정적 앱 빌드로 제공한다. 로컬 개발·운영 환경변수를 분리하고 GitHub Pages는 SPA rewrite가 없으므로 HashRouter와 프로젝트 루트 OAuth callback을 사용한다. 자세한 경로 정책은 12_SETUP_GUIDE.md를 따른다. 외부 OAuth 미설정이어도 개발 데모는 동작하며 실제 로그인은 설정 필요 화면을 보여준다. 운영 배포는 후속 요청 전까지 하지 않는다.
