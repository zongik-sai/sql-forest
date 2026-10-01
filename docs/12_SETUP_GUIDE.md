# GitHub Pages + Supabase 설정과 배포 준비

## 권장 구성
GitHub Pages는 정적 학습 화면과 JS/WASM을 제공하고 Supabase는 Google 인증·진도·XP 원장을 저장한다. SQL은 학생 브라우저 Worker에서만 실행한다. GitHub Pages 자체에 서버 DB/OAuth 비밀키를 넣지 않는다. Vercel 등은 후속 대안이며 기본 구현은 Pages용이다.

## 프로젝트 경로와 라우팅
프로젝트 사이트 `https://OWNER.github.io/REPO/`에서는 Vite base=`/REPO/`, 사용자 사이트·커스텀 도메인은 `/`. 실제 저장소명을 설정값에서 읽어 결정한다. Router는 HashRouter를 사용하여 `/#/learn/U01` 경로를 만든다. GitHub Pages에는 SPA rewrite가 없으므로 /auth/callback 같은 새 서버 경로에 의존하지 않는다. 모든 에셋·Worker·WASM URL은 Vite base를 반영한다. 저장소명이 달라도 수정할 곳을 한 곳으로 제한한다.

## Google OAuth callback: 프로젝트 루트
1. Supabase Google provider를 설정한다. Google 웹 OAuth 클라이언트의 승인 redirect URI는 Supabase에서 제공한 정확한 callback URL이다.
2. Supabase Site URL 및 허용 redirect에는 `https://OWNER.github.io/REPO/`와 로컬 `http://localhost:5173/`를 정확히 등록한다.
3. 앱 signInWithOAuth의 redirectTo는 앱 프로젝트 루트다. hash를 callback으로 등록하지 않는다. Google secret은 Supabase provider에만 넣는다.
4. 로그인 요청 전에 안전한 상대 hash 경로(예: /learn/U01)를 sessionStorage에 저장한다. 외부 URL은 허용하지 않는다.
5. 앱 부팅 시 `?code=...`가 있으면 Router 렌더보다 먼저 PKCE exchangeCodeForSession을 수행한다. Supabase 자동 URL 처리와 수동 exchange 중 하나를 선택하여 이중 exchange를 막는다.
6. 성공/실패 후 history.replaceState로 code query를 제거하고 검증한 내부 hash 경로로 복귀한다. 없는 경우 대시보드. 처음 인증 시 Router와 집중모드를 활성화하지 않는다.
7. 실제 계정 로그인·취소·루트 callback 새로고침·hash 복귀·로그아웃을 확인한다. 학교 Workspace 관리 정책 때문에 외부 앱이 제한되면 관리자의 허용 절차를 운영 안내에 적는다.

## Supabase와 환경변수
migration의 사용자 테이블/RLS/원장/RPC를 적용한다. 공개 환경변수는 VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY. 키 공개 여부와 RLS 정책을 함께 검증한다. service_role/secret/Google client secret은 Vite 변수나 저장소에 넣지 않는다. .env.example은 빈 값 설명만, .env.local은 gitignore.
개발 데모 활성 변수는 운영 build에서 거부한다. 실제 서비스 설정이 없으면 운영 로그인 화면에 설정 필요를 표시한다. 데모는 별도 학습자 캐시를 사용한다.

## GitHub Actions
Claude는 `.github/workflows/deploy-pages.yml`을 생성한다. npm ci→typecheck→핵심 테스트→build→Pages artifact upload→deploy 순서. package lockfile과 설치한 Node 버전을 고정한다. 최신 공식 문서로 Actions 버전을 확인한다. permissions는 contents:read, pages:write, id-token:write. github-pages environment와 concurrency를 설정한다. 배포 job은 기본 브랜치 push 또는 workflow_dispatch만 실행하고 PR은 검증만 수행한다. GitHub 저장소 Settings→Pages→Source는 GitHub Actions.
공개 Supabase 변수는 GitHub Actions variables 또는 secrets로 받아 빌드에 전달한다. Pages URL 경로, 로그인 allowlist, Worker 경로를 빌드 후 확인한다. PR 코드에서 production credentials를 다루는 pull_request_target workflow를 사용하지 않는다.

## 외부 계정이 없을 때
코드·workflow·migration·테스트·설정 안내를 모두 완성한다. 저장소 생성/push/Pages 활성화/실제 OAuth는 계정과 사용자의 배포 지시가 있을 때 진행한다. 완료 보고서에 설정 대기 항목을 구분한다. 현재 요청은 MD와 프롬프트 제작이므로 이 패키지 자체는 배포하지 않는다.

## README에 적을 실행 명령
npm install / npm run dev / npm run build / npm run test / npm run test:e2e. 개발 데모, 실제 서비스, GitHub Pages의 각 검증 절차와 서버 비용·운영 중 데이터 삭제 방법을 제공한다.
