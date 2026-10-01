import { defineConfig, devices } from '@playwright/test';

/**
 * E2E: 개발 데모(npm run dev)로 학습 흐름·집중모드·활동 종류별 조작을 검증한다.
 * pages 프로젝트는 GitHub Pages와 같은 하위 경로(/sql-forest/)로 빌드한 결과를 검증한다(S08).
 * 집중모드의 탭 전환은 visibilitychange/blur 이벤트를 합성해 검증하며, 실제 OS 창 전환(Alt+Tab 등)은 수동 확인 항목이다.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure', ...devices['Desktop Chrome'], locale: 'ko-KR' },
  projects: [
    { name: 'dev', testIgnore: /pages\.spec\.ts/, use: { baseURL: 'http://localhost:5173/' } },
    { name: 'pages', testMatch: /pages\.spec\.ts/, use: { baseURL: 'http://localhost:4173/sql-forest/' } },
  ],
  webServer: [
    { command: 'npm run dev', url: 'http://localhost:5173/', reuseExistingServer: true, timeout: 60_000 },
    { command: 'BASE_PATH=/sql-forest/ npx vite build --mode demo --outDir dist-pages-test && npx vite preview --outDir dist-pages-test --base /sql-forest/ --port 4173 --strictPort', url: 'http://localhost:4173/sql-forest/', reuseExistingServer: true, timeout: 180_000 },
  ],
});
