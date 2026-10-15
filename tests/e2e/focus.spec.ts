import { expect, test } from '@playwright/test';
import { STATE_KEY, openWithState, resumeIfPaused, simulateLeave, simulateReturn, stateWithUnits } from './helpers';

/**
 * 집중모드 E2E. 탭 전환·창 포커스 상실은 visibilitychange / blur 이벤트를 합성해 재현한다.
 * 실제 OS 수준의 Alt+Tab·최소화·분할 화면은 자동화로 대체할 수 없어 수동 확인 항목으로 남긴다.
 * 단원 화면은 전체화면 집중 학습(잠김 n/5, 5번째에 그 단원 초기화), 최종 진단은 예전처럼 가림·다시 시작만.
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
  await expect(overlay.getByRole('heading')).toHaveText('화면이 잠겼어요 (1/5)');
  await expect(overlay).toContainText('5번 잠기면 진도와 점수가 처음으로');
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
  await resumeIfPaused(page);
  // 초안 보존
  await expect(editor).toHaveValue('SELECT dept_id FROM students; -- 초안');
  await expect(page.locator('[data-focus-status]')).not.toHaveAttribute('inert', '');
});

test('창 blur(다른 프로그램으로 전환)도 잠김, 쉬기는 세지 않고 같은 방식으로 재개', async ({ page }) => {
  await openWithState(page, stateWithUnits(['U01']), '/learn/U02/U02-A01');
  await expect(page.getByTestId('focus-overlay')).toContainText('2단원 집중 학습');
  await resumeIfPaused(page);
  await simulateLeave(page, 'blur');
  await expect(page.getByTestId('focus-overlay')).toContainText('(1/5)');
  await simulateReturn(page);
  await resumeIfPaused(page);
  await page.locator('.strict-bar').getByRole('button', { name: '쉬기' }).click();
  await expect(page.getByTestId('focus-overlay')).toContainText('쉬는 중이에요');
  await simulateLeave(page, 'blur');
  await simulateReturn(page);
  await resumeIfPaused(page);
  await expect(page.locator('.strict-bar')).toContainText('2단원 잠김 1/5');
});

test('데이터베이스 단원: 5번째 잠김에 그 단원 진도·경험치만 초기화(앞 단원은 그대로)', async ({ page }) => {
  await openWithState(page, stateWithUnits(['U01', 'U02']), '/learn/U02');
  await resumeIfPaused(page);
  // 시작할 때 정산된 경험치(데모 원장): U01·U02 각각 활동 400 + 체크포인트 150 + 단원 100
  const ledgerKey = 'sqlforest:v1:demo:ledger';
  await expect.poll(() => page.evaluate((k) => Object.keys(JSON.parse(localStorage.getItem(k) ?? '{}').rewards ?? {}).length, ledgerKey)).toBe(16);
  for (let i = 1; i <= 5; i++) {
    await simulateLeave(page, 'blur');
    await expect(page.getByTestId('focus-overlay').getByRole('heading')).toHaveText(i < 5 ? `화면이 잠겼어요 (${i}/5)` : '이 단원 기록이 처음으로 돌아갔어요');
    await simulateReturn(page);
    if (i < 5) await resumeIfPaused(page);
  }
  const st = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), STATE_KEY);
  expect(Object.keys(st.activities).filter((k: string) => k.startsWith('U02'))).toEqual([]);
  expect(Object.keys(st.activities).filter((k: string) => k.startsWith('U01'))).toHaveLength(4);
  expect(st.unitResets.U02.n).toBe(1);
  const rewards = await page.evaluate((k) => Object.keys(JSON.parse(localStorage.getItem(k) ?? '{}').rewards ?? {}), ledgerKey);
  expect(rewards.filter((r: string) => r.includes('U02'))).toEqual([]);
  expect(rewards.filter((r: string) => r.includes('U01'))).toHaveLength(8);
  await resumeIfPaused(page);
  await expect(page.locator('.strict-bar')).toContainText('2단원 잠김 0/5');
});

test('최종 진단은 단원 밖: 예전처럼 가림·다시 시작만(잠김으로 세지 않음)', async ({ page }) => {
  const UNITS_ALL = ['U01', 'U02', 'U03', 'U04', 'U05', 'U06', 'U07', 'U08', 'U09', 'U10', 'U11', 'U12'];
  await openWithState(page, stateWithUnits(UNITS_ALL), '/final');
  await resumeIfPaused(page);
  await simulateLeave(page, 'blur');
  await expect(page.getByTestId('focus-overlay').getByRole('heading')).toHaveText('학습이 일시정지되었습니다.');
  await simulateReturn(page);
  await page.getByRole('button', { name: '학습 계속하기' }).click();
  await expect(page.getByTestId('focus-overlay')).toHaveCount(0);
  const st = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), STATE_KEY);
  expect(st.unitLocks ?? {}).toEqual({});
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
  await resumeIfPaused(page);
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
  // 시작 직후 유예(1.6초) + 2.2초 동안만 활성
  expect(secs).toBeGreaterThanOrEqual(3);
  expect(secs).toBeLessThanOrEqual(5);
  await simulateReturn(page);
  await page.getByTestId('focus-overlay').getByRole('button').first().click();
  const after = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}').totalActiveSeconds as number, STATE_KEY);
  expect(after).toBe(secs);
});
