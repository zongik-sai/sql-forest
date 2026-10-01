# 근거 자료와 검증 상태

작성일: 2026-10-01. 최신 서비스 API와 자격 상세 출제기준은 실제 구현 시 다시 확인한다.

| 자료 | URL | 작성 시 확인 상태 |
|---|---|---|
| K-DATA SQLD 자격 안내/상세 출제기준 | https://www.dataq.or.kr/www/sub/a_04.do | 상세 페이지 직접 읽기 실패. 최신 세부 출제기준 대조 완료로 주장하지 않음 |
| K-DATA 데이터자격 소개 | https://www.dataq.or.kr/www/sub/introduction.do | 검색 결과에서 SQLD의 두 과목 구조 확인 |
| Supabase Google 로그인 | https://supabase.com/docs/guides/auth/social-login/auth-google | 공식 문서 검색 결과에서 Google OAuth 지원·provider/redirect 설정 확인 |
| Supabase Auth | https://supabase.com/docs/guides/auth | 공식 문서 검색 결과에서 인증과 RLS 연계 확인 |
| Supabase RLS | https://supabase.com/docs/guides/database/postgres/row-level-security | 구현 시 API·정책 예시 직접 대조 필요 |
| MDN Page Visibility API | https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API | 공식 문서 검색 결과에서 visibility와 focus 차이 확인 |
| SQLite 문법 | https://www.sqlite.org/lang.html | 구현 시 사용할 엔진 버전으로 문법·실행 결과 검증 필요 |

이 패키지의 12단원 배열, 활동 방식, 360분 시간 배분과 진도 규칙은 수업용 설계이며 공식 SQLD 교육과정의 지정 시수나 공식 시험 배점이 아니다. 명세는 데이터 모델링, SQL 기본·활용·관리구문을 폭넓게 포함한다. 상세 기준 대조 시 빠진 항목을 추가하고 오래된 항목은 비교/선택 학습으로 분리하되 360분 핵심 경험 구조를 유지한다.

콘텐츠·문제·데이터는 자체 제작한다. 기존 교재/기출 지문·해설을 무단 복제하지 않는다. Oracle/SQL Server 고유 문법은 해당 DBMS의 공식 문서와 검증 데이터에 근거해 설명한다.


## v2 배포 근거(2026-10-01 검색 확인)
- Vite static deploy: https://vite.dev/guide/static-deploy.html — 프로젝트 사이트 base와 Actions 빌드 배포.
- GitHub Pages publishing source: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site — Actions 기반 출판.
- Supabase redirect URLs: https://supabase.com/docs/guides/auth/redirect-urls — 로그인 복귀 allowlist.
HashRouter+루트 PKCE callback 조합은 Pages 경로 특성을 고려한 본 패키지의 구현 설계이며 실제 Google 로그인으로 별도 검증해야 한다. 레벨·XP는 수업 설계이며 공식 SQLD 등급이 아니다.

## 구현 시 확인 기록(2026-10-01, Claude)
- K-DATA 상세 출제기준(https://www.dataq.or.kr/www/sub/a_04.do): 자동 조회가 robots.txt로 차단되어 다시 읽지 못함 → **미검증 상태 유지**. 사람이 직접 열어 대조해야 함.
- Vite 정적 배포 문서(https://vite.dev/guide/static-deploy.html): GitHub Pages Actions 예시의 액션 버전 확인 — checkout v7, setup-node v7, configure-pages v6, upload-pages-artifact v5, deploy-pages v5(커밋 SHA 고정). `.github/workflows/deploy-pages.yml`에 반영.
- SQLite 엔진: sql.js 1.14.2에 포함된 SQLite **3.49.1**에서 윈도우 함수·RIGHT/FULL JOIN·재귀 CTE 실행을 테스트로 확인. REGEXP 함수는 없음(정규표현식 활동은 브라우저 정규식 시뮬레이션으로 표시).
- Supabase: `@supabase/supabase-js` 2.117 사용(PKCE, `exchangeCodeForSession`). RLS·RPC는 PGlite(PostgreSQL 17 WASM)와 Supabase 호환 auth 스텁으로 검증했고, **실제 Supabase 프로젝트·Google OAuth는 자격정보가 없어 미검증**.
