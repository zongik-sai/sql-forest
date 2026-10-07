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
| S07 Supabase·OAuth·동기화 | done(코드·실서비스 설정) / 실제 로그인 확인 대기 | supabase/migrations/20261001000000_sql_forest_v2.sql, src/features/auth/** | PGlite(PostgreSQL 17)+Supabase 호환 auth 스텁에서 RLS(타인 조회·수정·삭제 불가, user_id 변경 불가, anon 차단), xp_events 직접 쓰기 거부, award_xp 멱등·선행조건·9,900, 배지·숙련, revision CAS, 세션 시간 상한, 데이터 삭제, 카탈로그=TS 일치, migration 재적용. 가짜 서버로 오프라인 대기·재전송·충돌 처리 테스트 | 실제 로그인/취소/재로그인/세션 만료/다른 기기 이어하기 검증(배포 주소에서) |
| S08 GitHub Pages | done(배포됨) | .github/workflows/deploy-pages.yml, vite.config.ts, scripts/verify-dist.mjs, README.md | `/sql-forest/` 운영 빌드 경로 검증 스크립트 통과, Pages E2E(데모 버튼 없음, 하위 경로 Worker·WASM 실행, hash 직접 링크 새로고침, `?code=`/`?error=` 처리 후 query 제거·외부 복귀 경로 거부), 운영 빌드에서 데모 플래그 거부 확인 | 없음(2026-10-03 배포 확인) |
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

## 후속 작업 기록
- 2026-10-01 17:40 — 비공개 미리보기 게시(Claude 아티팩트, 개발 데모). `npm run build:preview`(상대 경로 + 메모리 라우터 + CSS 인라인). 로컬 하위 경로 서버에서 자유 실습장 SQL 실행·데모 시작·첫 활동 진입 확인. 게시된 미리보기 화면 안에서의 WASM 실행은 직접 확인하지 못함(보기 화면 로그인 필요).
- 앱 개선: 첫 앱 내 이동이 '새로고침 진입'으로 오인되던 경쟁 상태를 layout effect로 수정, 상단바 safe-area 대응, SQL 엔진(WASM) 로드 실패 시 원인 안내. sql.js asm.js 대체 빌드는 Chrome Worker에서 호출 스택 초과가 나서 채택하지 않음.
- 재검증: Vitest 329, Playwright 30(dev 25 + Pages 5) 통과.

- 2026-10-01 19:00 — 로그인 설정 단계 준비: `npm run check:supabase`(scripts/check-supabase.mjs, 읽기 전용 점검) 추가, 가짜 응답으로 통과/미적용/Google 꺼짐/비밀 키 실수 구분 테스트 5개. 단계별 설정 가이드 문서(SQL 숲 로그인 설정 가이드) 작성. 실제 Supabase·Google 설정과 로그인 확인은 선생님 계정 작업 대기.

- 2026-10-02 — 실서비스 설정(선생님 공개 배포 승인 후). 비밀번호·Client Secret·약관 동의·GitHub 앱 권한은 선생님이 직접 처리했고, 비밀 값은 Claude가 보거나 저장하지 않음.
  - Supabase 프로젝트 `sql-forest`(Northeast Asia/Seoul) 생성, "새 테이블 자동 노출" 끔. migration을 원본 파일과 SHA-256 일치 확인 후 SQL Editor에서 실행. 실제 DB 조회: reward_catalog 109행·합계 9,900XP, 사용자 테이블 10개 RLS 켜짐, 정책 28개, anon의 award_xp 실행·카탈로그 조회·delete_my_progress 실행 불가, authenticated의 xp_events 직접 INSERT 불가, private 함수 직접 실행 불가.
  - 실제 REST 응답(브라우저): 비로그인 reward_catalog·award_xp 모두 42501, 잘못된 키 "Invalid API key", publishable 키 정상.
  - Auth: Site URL `https://zongik-sai.github.io/sql-forest/`, Redirect URLs = 그 주소 + `http://localhost:5173/`. Google provider 켜짐(Client ID 입력, Secret은 선생님이 붙여넣기, 저장 확인).
  - Google Cloud 프로젝트 SQLD: Google 인증 플랫폼 앱 "SQL 숲 키우기", 대상=내부(seoulai.sen.hs.kr 계정만), 웹 클라이언트(JS 원본 `https://zongik-sai.github.io`, 리디렉션 URI = Supabase callback).
  - GitHub 공개 저장소 `zongik-sai/sql-forest`, Pages Source=GitHub Actions, Actions Variables(VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY) 등록. 공개 전 추적 파일에서 비밀 키·개인정보 검색: 없음.
  - 발견·수정: `check:supabase`가 프록시/방화벽의 403(text/plain)을 "비로그인 차단됨"으로 통과시키던 거짓 양성 → Supabase JSON + 42501/28000일 때만 통과, 비JSON·Invalid API key는 원인과 함께 실패. 회귀 테스트 3개 추가(Vitest 337).
  - 2026-10-03 10:22 — 선생님이 Claude GitHub 앱을 sql-forest 저장소에 허용한 뒤 main push. Actions "Deploy to GitHub Pages"(run 37085864827) build·deploy 모두 success(typecheck·lint·Vitest·운영 빌드·경로 검증 포함).
  - 배포 주소 확인(브라우저): https://zongik-sai.github.io/sql-forest/ 시작 화면 표시, 개발 데모 버튼 없음, "Google 계정으로 시작" 버튼 표시(Supabase 설정값 반영). `#/playground`에서 JOIN·GROUP BY SQL 실행 → AI컴퓨터 3·AI로봇 2·AI콘텐츠디자인 1(기준 seed와 일치), Worker·WASM 하위 경로 로드 정상.

- 2026-10-07 — 예측 단계 "다른 답 다시 고르기"(선생님 요청): 틀리면 정답을 바로 보이지 않고 다시 고르기/정답 확인 선택, 처음 예측 기록. E2E 2개. 배포 확인.
- 2026-10-07 — 과목 선택 + "컴퓨터 일반" 추가(선생님 요청, 과목명으로 선택·자격증 이름 미표시, 개인 Gmail 허용 요청).
  - 첫 화면 "무엇을 공부할까요?"(데이터베이스·컴퓨터 일반), 사이트 이름 '배움 숲', 데이터베이스 소개는 #/db.
  - 컴퓨터 일반: 선생님의 'PC정비사 자기학습' 아티팩트에 들어 있던 문제은행을 그대로 추출(8단원, 검증 결과 중복·범위 오류 0). 원래 페이지 규칙 재현: 단계 잠금+그래도 풀어보기, 통과 24/30·28/40·15/25, 보기 순서 섞기, 모의고사(단원마다 실력점검4+기초2+여분, 1~3회 고정·랜덤·오답 5개 이상), 열매=40단계+정규 모의 30/50.
  - 저장: Supabase cg_progress(RLS 본인만, revision CAS, 기기 간 병합), 로그인 없이 기기 저장→로그인 시 가져오기, 로그아웃 전 저장 확인.
  - 선생님 반 학습 현황(두 과목 탭, 검색·정렬·CSV): private.teachers + 이메일 인증 + Google identity 요구, 이름은 Google identity에서. 실제 DB에 적용·선생님 1명 등록(이메일은 저장소에 없음), 실제 DB에서 규칙 통과 확인.
  - 독립 검토(별도 에이전트)에서 나온 확인된 결함 10건 모두 수정: 로그아웃 전 미저장, 공용 PC 화면 상태 누수, 만료 시험이 오답노트를 채움, 기기 시계 차이, 이상한 키로 선생님 화면 오류, 선생님 이메일 흉내, 이름 위장, 동시 첫 저장, 휴대폰 빈칸 가림·시험 시간 가림.
  - 검증: Vitest 375(문제은행 검증·병합·시계 차이·선생님 집계 포함), PGlite DB 34(선생님 Google identity 요구·이름 위장 방지 포함), Playwright 전체(컴퓨터 일반 5 + 운영 빌드 하위 경로에서 문제은행 지연 로드 포함).

## 미검증·한계(정직한 보고)
- Supabase·Google 설정은 실제로 완료했지만, 실제 Google 로그인 왕복(로그인·취소·만료·다기기)은 배포 주소에서 선생님 계정으로 확인해야 한다. mock 성공을 실제 검증으로 보고하지 않는다.
- Google 대상이 '내부'라서 seoulai.sen.hs.kr 계정만 로그인할 수 있다. 학생 계정이 다른 도메인이면 대상을 '외부'로 바꿔야 한다.
- 집중모드는 합성 이벤트(visibilitychange/blur/focus)로 자동 검증했다. Chrome/Edge 실제 Alt+Tab·최소화·분할 화면·두 번째 모니터, 키보드만 사용, 태블릿 레이아웃, 가림 스크린샷 대비는 수동 확인 필요.
- PGlite는 단일 연결이라 진짜 동시 RPC 경합은 재현하지 못했다(설계: PK + ON CONFLICT DO NOTHING + 사용자별 advisory lock).
- 공식 SQLD 상세 출제기준과의 대조는 미검증(13_SOURCES).
- 학습용 앱이라 정답 데이터가 클라이언트 번들에 포함되며 시험 보안을 제공하지 않는다.

## 다음 작업
0. Google 인증 플랫폼 대상을 '외부'로 바꿔 개인 Gmail 로그인 허용(선생님 비밀번호 확인 필요)
1. 배포 주소에서 실제 Google 로그인·취소·로그아웃·다른 기기 이어하기 확인
2. 실제 OS 창 전환(Alt+Tab·최소화) 집중모드 수동 점검
