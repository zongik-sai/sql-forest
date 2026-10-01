import { expect, type Page } from '@playwright/test';
import { UNITS } from '../../src/content';
import { answerQuestion, completeActivity, emptyLearnerState, type LearnerState } from '../../src/features/progress/model';

export const STATE_KEY = 'sqlforest:v1:demo:state';

/** 단원들을 완료한(그리고 체크포인트를 모두 푼) 데모 학습자 상태 */
export function stateWithUnits(unitIds: string[], opts: { pre?: boolean } = {}): LearnerState {
  let s = emptyLearnerState('demo');
  s = { ...s, pre: opts.pre === false ? null : { status: 'skipped', answers: {}, score: 0 } };
  for (const u of UNITS.filter((x) => unitIds.includes(x.id))) {
    for (const a of u.activityIds) s = completeActivity(s, a);
    for (const q of u.checkpointIds) s = answerQuestion(s, q, 'x', true);
  }
  return s;
}

/** 데모 상태를 주입하고 해당 경로를 연다 */
export async function openWithState(page: Page, state: LearnerState | null, path: string) {
  await page.goto('./');
  await page.evaluate(([k, v]) => {
    localStorage.clear();
    localStorage.setItem('sqlforest:demo-active', '1');
    if (v) localStorage.setItem(k, v);
  }, [STATE_KEY, state ? JSON.stringify(state) : '']);
  await page.goto('about:blank');
  await page.goto(`./#${path}`);
}

/** 새로고침/직접 진입 시 보이는 '학습 계속하기'를 누른다 */
export async function resumeIfPaused(page: Page) {
  const btn = page.getByRole('button', { name: '학습 계속하기' });
  if (await btn.isVisible().catch(() => false)) await btn.click();
  await expect(page.getByTestId('focus-overlay')).toHaveCount(0);
}

export async function simulateLeave(page: Page, how: 'hidden' | 'blur') {
  await page.evaluate((h) => {
    if (h === 'hidden') {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    } else {
      document.hasFocus = () => false;
      window.dispatchEvent(new Event('blur'));
    }
  }, how);
}

export async function simulateReturn(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.hasFocus = () => true;
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
}

export async function pickPrediction(page: Page, optionText: string) {
  await page.getByLabel(optionText, { exact: true }).check();
  await page.getByRole('button', { name: '예측 제출' }).click();
}

/** radiogroup(aria-label=항목)에서 선택지 고르기 */
export async function choose(page: Page, groupLabel: string, optionLabel: string) {
  await page.getByRole('radiogroup', { name: groupLabel, exact: true }).getByText(optionLabel, { exact: true }).click();
}

export async function expectSuccess(page: Page, text: string | RegExp) {
  await expect(page.locator('.feedback .notice-good')).toContainText(text);
}

export async function readXp(page: Page): Promise<number> {
  const t = await page.locator('text=/[0-9,]+ \\/ 9,900 XP/').first().innerText();
  return Number(t.split('/')[0].replace(/[^0-9]/g, ''));
}
