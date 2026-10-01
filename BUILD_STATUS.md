# BUILD_STATUS — SQL 숲 키우기 v2

기록일: 2026-10-01 · 상태 값: todo / in_progress / done / blocked
검증 환경: Linux 컨테이너, Node 22.22, Chromium 141(Playwright 1.56 headless)

| 단계 | 상태 | 관련 파일 | 실행한 검증 | 남은 외부 설정 |
|---|---|---|---|---|
| S01 구조·타입·데모 | done | package.json, vite.config.ts, tsconfig*.json, src/content/types.ts, src/lib/config.ts | `npm run typecheck` 통과, 개발 서버 실행, 데모 시작 E2E | 없음 |
| S02 seed DB·Worker·채점기·U03 세로 흐름 | done | src/sql/{engine,guard}.ts, src/sql/grader/compare.ts, src/sql/worker/*, src/sql/datasets/index.ts | 기준 SQL A~E 결과 일치, 채점(별칭·중복·NULL·순서·빈 결과·부동소수·대체 정답·하드코딩 검출), 금지 SQL, Worker 시간초과·late result(stale)·interrupt·세션 복원 테스트 | 없음 |
| S03 전체 콘텐츠 | done | src/content/** | 콘텐츠 검증기(분류별 수량 48/36/36/5/12/12, ID 중복·참조·힌트·해설·설명 길이·시간 합계 360·핵심 주제·미지원 문법 표시), 모든 활동·문항 SQL을 main/alt seed에서 실행, 예측 정답 데이터 검증, 템플릿 조합별 정답/오답 존재, 시작 SQL이 정답이 아님 | 공식 상세 출제기준 대조(미검증, 13_SOURCES) |
| S04 학습 흐름 UI | done | src/features/learning/**, src/features/progress/pages.tsx, src/app/** | E2E: 데모 시작→진단 건너뛰기→U01 4활동 실제 조작→체크포인트 오답·개념 복습·변형 재도전→U02 해제, 정답 보기 후 안내 학습 완료, 잠긴 단원 차단, 활동 13종 각 1개 이상 조작, 도전 모드 | 없음 |
| S05 원장·XP·정원·배지 | done | src/features/progress/{rewards,ledger,model}.ts, src/features/growth/levels.ts, src/components/Garden.tsx | XP 경계(0/99/100/9899/9900), Lv0~99 모든 레벨의 단계 이름·정원 형태 변화, U01 650XP/Lv6 → 7,800/Lv78 → 9,000/Lv90 → 9,900/Lv99, 2/3 해제·마무리 보류, 힌트 무감점, 중복 지급 방지(재제출·재로딩·동시·모드 변경), E2E로 최종 진단→Lv99 보고서·CSV | 없음 |
| S06 집중모드·초안 복구·접근성 | done | src/features/focus/** | 상태기계·타이머 단위 테스트, E2E: 탭 숨김/창 blur → 불투명 가림·inert·단축키 차단·자동 재개 없음·초안 보존, 수동 휴식, 실행 중 SQL 중단+late result 무시, 2초 시간초과 복원, 숨김 시간 미포함, 새로고침 후 클릭으로 재개 | 실제 OS 창 전환(Alt+Tab·최소화·분할화면) 수동 확인 필요 |
| S07 Supabase·OAuth·동기화 | done(코드) / 설정 대기(실서비스) | supabase/migrations/20261001000000_sql_forest_v2.sql, src/features/auth/** | PGlite(PostgreSQL 17)+Supabase 호환 auth 스텁에서 RLS(타인 조회·수정·삭제 불가, user_id 변경 불가, anon 차단), xp_events 직접 쓰기 거부, award_xp 멱등·선행조건·9,900, 배지·숙련, revision CAS, 세션 시간 상한, 데이터 삭제, 카탈로그=TS 일치, migration 재적용. 가짜 서버로 오프라인 대기·재전송·충돌 처리 테스트 | 실제 Supabase 프로젝트·Google OAuth 클라이언트 생성, 실제 로그인/취소/재로그인/세션 만료/다른 기기 이어하기 검증 |
| S08 GitHub Pages 준비 | done(코드) / 설정 대기(배포) | .github/workflows/deploy-pages.yml, vite.config.ts, scripts/verify-dist.mjs, README.md | `/sql-forest/` 운영 빌드 경로 검증 스크립트 통과, Pages E2E(데모 버튼 없음, 하위 경로 Worker·WASM 실행, hash 직접 링크 새로고침, `?code=`/`?error=` 처리 후 query 제거·외부 복귀 경로 거부), 운영 빌드에서 데모 플래그 거부 확인 | 저장소 생성·push·Pages Source=Actions·Variables 등록(사용자 배포 지시 후) |
| S09 전체 QA·보고 | done | BUILD_STATUS.md, README.md | typecheck·lint·Vitest·Playwright(dev+pages)·build 전체 재실행(아래 결과) | 위 '설정 대기' 항목 |

## 설계 결정 기록
- 에디터: CodeMirror 대신 라벨 있는 textarea(번들·접근성). Tab 들여쓰기, Esc→Tab 탈출, Ctrl+Enter 실행.
- 문장 판정: 정규식 한 줄이 아닌 토크나이저(주석·문자열·괄호 깊이 처리) + SQLite `iterateStatements`로 문장 분할 후 재판정 + 읽기 활동은 `PRAGMA query_only=1`로 엔진 차단(이중 방어).
- 채점: 학생·정답 SQL을 각각 새 DB 인스턴스에서 실행, main seed와 다른 값의 alt seed에서도 비교(하드코딩·LIMIT 동점 누락 검출).
- 세션 DB(트랜잭션·자유 실습장): 성공한 문장 기록(log)으로 상태를 재현 → Worker를 종료해도 같은 상태로 복원, 실패한 실행은 전체 되돌림.
- 체크포인트: 원문 오답 후 재도전은 변형 문항으로, 한 쌍에서 정답 공개는 한 문항만 가능(공개 후 대응 문항을 스스로 풀어야 XP) → 막다른 길 없이 Lv99 가능.
- 안내 학습 인정: 정답 공개 후 조작형은 상태를 비우고 다시 수행, SQL형은 직접 실행 + 결과 행 수/영향 행 수 확인까지 해야 완료(guided).
- 원장 정산: 학습 상태에서 받을 자격이 있는 보상 ID를 계산해 원장(로컬/서버)에 요청 → 원장이 카탈로그·선행조건·중복을 최종 판정(멱등).
- 집중모드 '새로고침 진입' 판정: 페이지 로드 시 hash와 앱 내 이동 여부로 판정(StrictMode 이중 실행에도 동일).
- 콘텐츠 독립 검토(별도 에이전트) 결과 반영: SQL Server PIVOT 문법·ROWNUM 동점 설명 수정, SQLite 관대함(WHERE 별칭·GROUP BY 밖 열) 문법 비교 메모 추가, 모호한 문항 4개 문구 수정, 체크포인트에만 있던 개념(모델링 특징·본질/인조 식별자·BETWEEN/IN·ACID·날짜 함수)을 활동 용어·조작에 추가.

## 미검증·한계(정직한 보고)
- 실제 Google OAuth·Supabase 프로젝트 연동(로그인·취소·만료·다기기)은 자격정보가 없어 실행하지 않았다. mock 성공을 실제 검증으로 보고하지 않는다.
- 집중모드는 합성 이벤트(visibilitychange/blur/focus)로 자동 검증했다. Chrome/Edge 실제 Alt+Tab·최소화·분할 화면·두 번째 모니터, 키보드만 사용, 태블릿 레이아웃, 가림 스크린샷 대비는 수동 확인 필요.
- PGlite는 단일 연결이라 진짜 동시 RPC 경합은 재현하지 못했다(설계: PK + ON CONFLICT DO NOTHING + 사용자별 advisory lock).
- 공식 SQLD 상세 출제기준과의 대조는 미검증(13_SOURCES).
- 학습용 앱이라 정답 데이터가 클라이언트 번들에 포함되며 시험 보안을 제공하지 않는다.

## 다음 작업
1. Supabase 프로젝트 생성·migration 적용·Google provider 설정(README 2절)
2. GitHub 저장소에 push → Pages Source=Actions, Variables 등록 → 배포
3. 실제 로그인·다기기·OS 창 전환 수동 점검
