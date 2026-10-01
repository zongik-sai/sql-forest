import { expect, test } from '@playwright/test';
import { STATE_KEY, openWithState, resumeIfPaused, simulateLeave, simulateReturn, stateWithUnits } from './helpers';

/**
 * 집중모드 E2E. 탭 전환·창 포커스 상실은 visibilitychange / blur 이벤트를 합성해 재현한다.
 * 실제 OS 수준의 Alt+Tab·최소화·분할 화면은 자동화로 대체할 수 없어 수동 확인 항목으로 남긴다.
 */

test('탭 숨김 → 불투명 가림·입력 차단 → 복귀해도 자동 재개 안 함 → 학습 계속하기', async ({ page }) => {
  await openWithState(page, stateWithUnits(['U01', 'U02']), '/learn/U03/U03-A03');
  await resumeIfPaused(page);
  await page.getByLabel('6행', { exact: true }).check();
  await page.getByRole('button', { name: '예측 제출' }).click();
  const editor = page.getByLabel(/SQL 편집기/);
  await editor.fill('SELECT dept_id FROM students; -- 초안');

  await simulateLeave(page, 'hidden');
  const overlay = page.getByTestId('focus-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay.getByRole('heading')).toHaveText('학습이 일시정지되었습니다.');
  await expect(overlay).toContainText('돌아오면 계속할 수 있습니다.');
  // 불투명(배경색이 투명하지 않음)·최상위
  const bg = await overlay.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toMatch(/rgba\(.*,\s*0\)|transparent/);
  // 학습 영역 inert: 편집기 입력·단축키 제출 불가
  await expect(page.locator('[data-focus-status]')).toHaveAttribute('inert', '');
  await editor.press('Control+Enter', { timeout: 2000 }).catch(() => {});
  await expect(page.locator('.result-meta')).toHaveCount(0);

  // 돌아와도 자동 재개하지 않는다
  await simulateReturn(page);
  await expect(overlay).toBeVisible();
  await page.getByRole('button', { name: '학습 계속하기' }).click();
  await expect(overlay).toHaveCount(0);
  // 초안 보존
  await expect(editor).toHaveValue('SELECT dept_id FROM students; -- 초안');
  await expect(page.locator('[data-focus-status]')).not.toHaveAttribute('inert', '');
});

test('창 blur(다른 프로그램으로 전환)도 가림, 수동 휴식 버튼도 같은 방식으로 재개', async ({ page }) => {
  await openWithState(page, stateWithUnits(['U01']), '/learn/U02/U02-A01');
  await resumeIfPaused(page);
  await simulateLeave(page, 'blur');
  await expect(page.getByTestId('focus-overlay')).toBeVisible();
  await simulateReturn(page);
  await page.getByRole('button', { name: '학습 계속하기' }).click();
  await page.getByRole('button', { name: '쉬기' }).click();
  await expect(page.getByTestId('focus-overlay')).toContainText('쉬는 중이에요');
  await page.getByRole('button', { name: '학습 계속하기' }).click();
  await expect(page.getByTestId('focus-overlay')).toHaveCount(0);
});

test('실행 중인 SQL은 가림 시 중단·복원되고 늦은 결과는 반영되지 않음', async ({ page }) => {
  await openWithState(page, stateWithUnits(['U01', 'U02']), '/learn/U03/U03-A03');
  await resumeIfPaused(page);
  await page.getByLabel('6행', { exact: true }).check();
  await page.getByRole('button', { name: '예측 제출' }).click();
  // 1.5초 이상 걸리는 쿼리
  await page.getByLabel(/SQL 편집기/).fill('WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 3000000) SELECT COUNT(*) FROM c;');
  await page.getByRole('button', { name: '실행하고 채점' }).click();
  await expect(page.getByRole('button', { name: '실행 중…' })).toBeVisible();
  await simulateLeave(page, 'hidden');
  await expect(page.getByTestId('focus-overlay')).toContainText('진행 중이던 SQL 실행은 중단했어요');
  await page.waitForTimeout(2500); // 늦은 결과가 도착할 시간
  await simulateReturn(page);
  await page.getByRole('button', { name: '학습 계속하기' }).click();
  await expect(page.locator('.feedback')).not.toContainText('정답');
  await expect(page.getByText('실행이 중단되었습니다. 다시 실행해주세요.')).toBeVisible();
  // 다시 실행하면 정상 동작(Worker 재시작)
  await page.getByLabel(/SQL 편집기/).fill('SELECT DISTINCT dept_id FROM students;');
  await page.getByRole('button', { name: '실행하고 채점' }).click();
  await expect(page.locator('.feedback .notice-good')).toContainText('+100XP');
});

test('2초 제한 초과 쿼리는 멈추고 학습 DB를 복원', async ({ page }) => {
  await openWithState(page, stateWithUnits(['U01', 'U02']), '/learn/U03/U03-A03');
  await resumeIfPaused(page);
  await page.getByLabel('6행', { exact: true }).check();
  await page.getByRole('button', { name: '예측 제출' }).click();
  await page.getByLabel(/SQL 편집기/).fill('WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT COUNT(*) FROM c;');
  await page.getByRole('button', { name: '실행하고 채점' }).click();
  await expect(page.getByText(/2초 안에 끝나지 않아/)).toBeVisible({ timeout: 8000 });
});

test('활동 시간은 활성 상태에서만 누적(가린 시간 제외)', async ({ page }) => {
  await openWithState(page, stateWithUnits(['U01']), '/learn/U02/U02-A01');
  await resumeIfPaused(page);
  await page.waitForTimeout(2200);
  await simulateLeave(page, 'hidden'); // 여기서 delta 확정
  await page.waitForTimeout(3000); // 숨김 시간(더하면 안 됨)
  const secs = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}').totalActiveSeconds as number, STATE_KEY);
  expect(secs).toBeGreaterThanOrEqual(2);
  expect(secs).toBeLessThanOrEqual(3);
  await simulateReturn(page);
  await page.getByRole('button', { name: '학습 계속하기' }).click();
  const after = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}').totalActiveSeconds as number, STATE_KEY);
  expect(after).toBe(secs);
});
