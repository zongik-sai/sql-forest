import { expect, test, type Page } from '@playwright/test';
import { FINAL_DIAGNOSTIC, UNITS } from '../../src/content';
import { answerQuestion, completeActivity, emptyLearnerState } from '../../src/features/progress/model';
import { openWithState, readXp, resumeIfPaused, stateWithUnits } from './helpers';

const ALL = UNITS.map((u) => u.id);

async function doFinal(page: Page) {
  for (let i = 0; i < FINAL_DIAGNOSTIC.length; i++) {
    const q = FINAL_DIAGNOSTIC[i];
    await expect(page.getByText(`최종 진단 ${i + 1}/12`)).toBeVisible();
    const b = q.body;
    if (b.type === 'choice') await page.getByLabel(b.options[(b.correctIndex + (i % 3 === 0 ? 1 : 0)) % b.options.length], { exact: true }).check(); // 일부는 일부러 오답
    else if (b.type === 'number') await page.getByLabel('값 입력').fill(String(b.answer));
    else await page.getByLabel(/SQL 작성/).fill(b.solutionSql);
    await page.getByRole('button', { name: '제출' }).click();
    await expect(page.locator('.notice').first()).toBeVisible();
    await page.getByRole('button', { name: '해설 확인 완료 · 다음' }).click();
  }
}

test('12단원+전 체크포인트 완료 상태 → 최종 진단 12문항(정오답 무관) → 9,900XP Lv99·보고서', async ({ page }) => {
  await openWithState(page, stateWithUnits(ALL), '/garden');
  expect(await readXp(page)).toBe(7800);
  await expect(page.locator('.level-num')).toHaveText('Lv78');
  await page.getByRole('link', { name: /최종 진단/ }).click();
  await resumeIfPaused(page);
  await doFinal(page);
  await expect(page.getByRole('heading', { name: '나의 학습 보고서' })).toBeVisible();
  await expect(page.getByText(/나의 SQL 숲을 완성했어요! Lv99/)).toBeVisible();
  await expect(page.getByRole('img', { name: /Lv99 나의 SQL 숲 완성/ }).first()).toBeVisible();
  await expect(page.getByText('SQLD 합격 예측이 아니에요', { exact: false }).first()).toBeVisible();
  await page.getByRole('link', { name: '나의 정원' }).first().click();
  expect(await readXp(page)).toBe(9900);
  await expect(page.getByText('성장 완료')).toBeVisible();
  // 다운로드
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('link', { name: '보고서' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV 다운로드' }).click()]);
  expect(dl.suggestedFilename()).toBe('sql-forest-report.csv');
});

test('체크포인트 2/3씩만 푼 경우: 최종 진단까지 해도 숲 완성(900) 보류 → 숲 완성 복습 후 Lv99', async ({ page }) => {
  let s = emptyLearnerState('demo');
  s = { ...s, pre: { status: 'skipped', answers: {}, score: 0 } };
  for (const u of UNITS) {
    for (const a of u.activityIds) s = completeActivity(s, a);
    s = answerQuestion(s, u.checkpointIds[0], 'x', true);
    s = answerQuestion(s, u.checkpointIds[1], 'x', true);
  }
  await openWithState(page, s, '/final');
  await resumeIfPaused(page);
  await doFinal(page);
  // 단원 12×(400+100+100)=7,200 + 진단 1,200 = 8,400 → Lv84, 마무리 보류
  await page.goto('./#/report');
  await expect(page.getByText(/체크포인트 12문항 해결/)).toBeVisible();
  await expect(page.getByRole('heading', { name: '숲 완성 복습' })).toBeVisible();
  await page.goto('./#/garden');
  expect(await readXp(page)).toBe(8400);

  // 남은 체크포인트(각 단원 3번 문항)를 실제 UI로 해결
  for (const u of UNITS) {
    await page.goto(`./#/learn/${u.id}/checkpoint`);
    await resumeIfPaused(page);
    const q = await import('../../src/content').then((m) => m.QUESTION_BY_ID[u.checkpointIds[2]]);
    const slot = page.locator('section.panel').filter({ has: page.getByRole('heading', { name: /^문항 3/ }) });
    const b = q.body;
    if (b.type === 'choice') await slot.getByLabel(b.options[b.correctIndex], { exact: true }).check();
    else if (b.type === 'number') await slot.getByLabel('값 입력').fill(String(b.answer));
    else await slot.getByLabel(/SQL 작성/).fill(b.solutionSql);
    await slot.getByRole('button', { name: '제출' }).click();
    await expect(slot).toContainText('정답이에요');
  }
  await page.goto('./#/garden');
  expect(await readXp(page)).toBe(9900);
  await expect(page.locator('.level-num')).toHaveText('Lv99');
});

test('잠긴 단원 직접 주소 접근은 안내 후 차단', async ({ page }) => {
  await openWithState(page, stateWithUnits(['U01']), '/learn/U05/U05-A01');
  await expect(page.getByText('아직 열리지 않은 단원이에요')).toBeVisible();
});
