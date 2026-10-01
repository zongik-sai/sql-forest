# SQL 숲 키우기 v2

레벨 0 씨앗에서 레벨 99 숲까지 성장하며 SQLD 범위를 처음 경험하는 12단원·360분 자기주도 학습 웹앱입니다.
SQL 사전학습이 없는 고등학생을 대상으로, 짧은 설명 → 예측 → 시각 조작/SQL 조립 → 실제 실행 → 피드백 순서로 진행합니다.

- 콘텐츠: 핵심 활동 48 · 체크포인트 36 · 재도전(변형) 36 · 최초 진단 5 · 최종 진단 12 · 도전 12 (모두 자체 제작)
- SQL 실습: 브라우저 안의 SQLite 3.49(sql.js WASM) Worker에서만 실행, 결과 기반 채점
- 성장: 100XP당 1레벨, 최대 9,900XP(Lv99), 코드로 그리는 SVG 정원, 기본 모드만으로 Lv99 가능
- 로그인·저장: Supabase Google OAuth(PKCE) + RLS + 멱등 XP RPC
- 호스팅: GitHub Pages(HashRouter + 프로젝트 루트 OAuth callback)

Lv99는 과정 전체를 경험했다는 뜻이며 SQLD 합격이나 완전한 숙달을 보장하지 않습니다. 6시간은 휴식을 뺀 예상 시간입니다.

## 실행 방법

필요: Node.js 22 (`.nvmrc`), npm

```bash
npm install          # (CI와 같게 하려면 npm ci)
npm run dev          # http://localhost:5173 — 개발 데모 버튼이 보입니다
npm run build        # 운영 빌드(dist/). 데모 버튼 없음
npm run test         # Vitest: 콘텐츠 검증·정답 SQL·채점·XP·집중모드·RLS/RPC(PGlite)
npm run test:e2e     # Playwright: 학습 흐름·집중모드·활동 종류별 조작·Pages 경로
npm run typecheck && npm run lint
```

Playwright 브라우저가 없다면 처음 한 번 `npx playwright install chromium`을 실행하세요.

### 1) 개발 데모(외부 설정 없이)
`npm run dev` → "개발 데모로 시작". 진도·XP는 이 브라우저의 localStorage(`sqlforest:v1:demo:*`)에만 저장되고 운영 사용자 데이터와 분리됩니다.
상단에 "개발 데모" 표시가 있고, 운영(production) 빌드에서 `VITE_ENABLE_DEMO=true`를 쓰면 빌드가 실패합니다.
`npm run build:demo`는 데모가 켜진 별도 빌드로, 학교 내부 시연용이며 공개 배포용이 아닙니다.

### 2) 실제 서비스(Google 로그인)
docs/12_SETUP_GUIDE.md의 순서를 따릅니다. 요약:

1. Supabase 프로젝트 생성 → SQL Editor에서 `supabase/migrations/20261001000000_sql_forest_v2.sql` 실행(여러 번 실행해도 안전).
2. Google Cloud Console에서 "웹 애플리케이션" OAuth 클라이언트 생성 → 승인된 리디렉션 URI에 **Supabase가 보여주는 callback URL**(`https://<project>.supabase.co/auth/v1/callback`)을 등록.
3. Supabase Auth → Providers → Google에 client ID/secret 입력(secret은 Supabase에만).
4. Supabase Auth → URL Configuration: Site URL = `https://OWNER.github.io/REPO/`, Redirect URLs = `https://OWNER.github.io/REPO/`, `http://localhost:5173/` (정확히, 끝의 `/` 포함. hash 경로를 등록하지 않음).
5. 로컬: `.env.example`을 `.env.local`로 복사하고 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`(publishable/anon 키)만 입력. **service_role/secret 키는 절대 넣지 않습니다.**
6. 학교 Google Workspace 계정이 외부 앱을 막는 경우, Workspace 관리자가 관리 콘솔 → 보안 → API 제어 → 앱 액세스 제어에서 이 OAuth 클라이언트를 "신뢰함"으로 허용해야 합니다.

로그인 흐름: 앱 루트로 돌아온 `?code=`를 Router보다 먼저 한 번만 교환(PKCE, `detectSessionInUrl: false`) → `history.replaceState`로 query 제거 → sessionStorage에 저장해 둔 **내부 hash 경로만** 복귀(외부 URL 거부, 없으면 `#/garden`).

### 3) GitHub Pages
1. 저장소 Settings → Pages → Source = **GitHub Actions**
2. Settings → Secrets and variables → Actions → **Variables**에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
3. main 브랜치 push 또는 Actions에서 수동 실행 → `.github/workflows/deploy-pages.yml`이 `npm ci → typecheck → lint → test → build → 경로 검증 → 배포`
4. base 경로는 `actions/configure-pages`가 알려준 값(프로젝트 사이트 `/REPO/`, 사용자 사이트·커스텀 도메인 `/`)을 `BASE_PATH`로 넘겨 `vite.config.ts` 한 곳에서 결정합니다. 저장소 이름이 바뀌어도 코드를 고칠 필요가 없습니다.

배포 후 확인: `https://OWNER.github.io/REPO/` 열기, `#/learn/U01` 직접 링크 새로고침, 자유 실습장에서 SQL 실행(Worker·WASM 로드), 로그인·취소·로그아웃·다른 기기 이어하기.

## 운영 안내

- **비용**: GitHub Pages(공개 저장소)는 무료. Supabase 무료 플랜으로 한 학급 규모는 충분하지만, 무료 프로젝트는 일정 기간 사용이 없으면 일시정지될 수 있으니 학기 중 주기적으로 접속하거나 유료 플랜을 검토하세요(요금·한도는 Supabase 공식 페이지에서 확인).
- **데이터 삭제**: 학생은 "나의 정원" 아래 "내 학습 기록 지우기"로 본인 기록(진도·초안·원장·배지·진단)을 삭제할 수 있습니다(`delete_my_progress` RPC). 계정 자체 삭제는 관리자가 Supabase Auth → Users에서 수행하며 `on delete cascade`로 관련 행이 함께 지워집니다.
- **보관 정책(권장)**: 학기 종료 후 일정 기간(예: 1년) 뒤 `xp_events` 등 사용자 테이블을 정리하세요. 앱은 학번·실명을 받지 않고 다른 사이트 목록·화면 캡처를 저장하지 않습니다.
- **신뢰 경계**: 채점은 브라우저에서 이뤄지고 서버는 보상 ID 카탈로그·선행 조건·중복만 검사합니다. 학생이 개발자도구로 완료를 조작할 수 있는 교육용 설계이며, 시험 보안이나 출석 증거로 쓰지 않습니다. RLS는 다른 학생 데이터 접근과 XP 직접 쓰기를 막습니다.
- **집중모드의 한계**: 이 창의 visibility/focus만 압니다. 다른 프로그램 목록·다른 탭 주소·분할 화면의 다른 창·두 번째 모니터는 알 수 없고, 감시·차단하지 않으며 일시정지에 벌점이 없습니다.

## 구조

```
src/content/        단원·활동(48)·도전(12)·문항(체크포인트 36+변형 36·진단 5+12), 타입, 검증기
src/sql/            SQLite 엔진·문장 판정기·결과 기반 채점기·Worker·데이터셋(main/alt seed)
src/features/       learning(활동 13종 렌더러) · progress(진도 모델·XP 원장·보고서) · growth(레벨·정원)
                    focus(집중모드 상태기계) · auth(Supabase·OAuth·동기화) · playground
supabase/migrations 테이블·RLS·RPC
tests/unit, tests/db, tests/e2e
BUILD_STATUS.md     단계별 구현·검증 기록
```

SQLite에서 실행되지 않는 시험 문법(ROLLUP/CUBE/GROUPING SETS, PIVOT, CONNECT BY, REGEXP, MERGE, GRANT/REVOKE, TRUNCATE, NVL/DECODE, TOP/ROWNUM 등)은 "문법 비교" 또는 "개념 시뮬레이션" 뱃지로 구분하고, 같은 결과의 SQLite 대안(UNION ALL, 조건부 집계, WITH RECURSIVE)을 실제로 실행해 보여줍니다.

에디터는 번들 크기와 접근성(라벨·키보드·스크린리더 호환)을 고려해 CodeMirror 대신 라벨이 있는 textarea(Tab 들여쓰기, Esc 후 Tab으로 빠져나가기, Ctrl+Enter 실행)를 사용했습니다.
