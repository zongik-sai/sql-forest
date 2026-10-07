import { expect, test } from '@playwright/test';

/**
 * GitHub Pages 프로젝트 경로(/sql-forest/)의 운영 빌드 검증.
 * - 에셋·Worker·WASM이 하위 경로에서 로드되는지
 * - hash 직접 링크·새로고침
 * - 루트 OAuth callback(?code=, ?error=) 처리 후 query 제거와 안전한 복귀 경로
 * 실제 Google/Supabase 로그인은 자격정보가 없어 여기서 검증하지 않는다(설정 대기).
 */

test('운영 빌드: 데모 버튼 없음, 로그인 설정 필요 안내', async ({ page }) => {
  const failed: string[] = [];
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/sql-forest/')) failed.push(`${r.status()} ${r.url()}`); });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: '무엇을 공부할까요?' })).toBeVisible();
  await page.getByRole('link', { name: /데이터베이스/ }).click();
  await expect(page.getByRole('heading', { name: /작은 씨앗으로 시작해/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '개발 데모로 시작' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Google 로그인 설정 필요' })).toBeVisible();
  await page.getByRole('link', { name: 'Google 로그인 설정 필요' }).click();
  await expect(page).toHaveURL(/\/sql-forest\/#\/setup$/);
  expect(failed).toEqual([]);
});

test('하위 경로에서 Worker·WASM으로 실제 SQL 실행 (자유 실습장, 직접 hash 링크 + 새로고침)', async ({ page }) => {
  const reqs: string[] = [];
  page.on('request', (r) => reqs.push(r.url()));
  await page.goto('./#/playground');
  await page.reload();
  await page.getByLabel('SQL', { exact: true }).fill('SELECT COUNT(*) AS n FROM students;');
  await page.getByRole('button', { name: /실행/ }).click();
  await expect(page.getByRole('cell', { name: '6' })).toBeVisible();
  expect(reqs.some((u) => /\/sql-forest\/assets\/sqlWorker-.*\.js$/.test(u))).toBe(true);
  expect(reqs.some((u) => /\/sql-forest\/assets\/sql-wasm-.*\.wasm$/.test(u))).toBe(true);
  // 데이터 변경은 실습장 세션 안에서만, 초기화 가능
  await page.getByLabel('SQL', { exact: true }).fill("DELETE FROM enrollment;");
  await page.getByRole('button', { name: /실행/ }).click();
  await expect(page.getByText(/영향받은 행 6개/)).toBeVisible();
  await page.getByRole('button', { name: '데이터 초기화' }).click();
  await page.getByLabel('SQL', { exact: true }).fill('SELECT COUNT(*) FROM enrollment;');
  await page.getByRole('button', { name: /실행/ }).click();
  await expect(page.getByRole('cell', { name: '6' })).toBeVisible();
});

test('루트 callback: ?code= 처리 후 query 제거, 설정 없으면 안내(이중 처리 없음)', async ({ page }) => {
  await page.goto('./?code=fake-code-123');
  await expect(page.getByRole('alert')).toContainText('로그인을 마치지 못했어요');
  expect(page.url()).not.toContain('code=');
  expect(new URL(page.url()).pathname).toBe('/sql-forest/');
  // 새로고침해도 다시 처리하지 않음(query가 이미 지워짐)
  await page.reload();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('루트 callback: 취소(error) → query 제거, 저장해 둔 외부 URL 복귀 경로는 무시', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => sessionStorage.setItem('sqlforest:returnTo', 'https://evil.example/'));
  await page.goto('./?error=access_denied&error_description=User+cancelled');
  await expect(page.getByRole('alert')).toContainText('User cancelled');
  expect(page.url()).not.toContain('error=');
  expect(page.url()).not.toContain('evil');
});

test('알 수 없는 hash 경로는 과목 선택 화면으로', async ({ page }) => {
  await page.goto('./#/no/such/page');
  await expect(page.getByRole('heading', { name: '무엇을 공부할까요?' })).toBeVisible();
});

test('운영 빌드: 컴퓨터 일반 문제은행이 하위 경로에서 따로 내려받아져 열린다', async ({ page }) => {
  await page.goto('./#/computer/unit/U1/1');
  await expect(page.getByRole('heading', { name: '1단계 이론' })).toBeVisible();
  await expect(page.locator('.cg-card').first()).toContainText('자료(Data)와 정보(Information)');
});
