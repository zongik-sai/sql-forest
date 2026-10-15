import { expect, test, type Page } from '@playwright/test';
import { UNIT_STAGES } from '../../src/content/stages';
import { emptyLearnerState } from '../../src/features/progress/model';
import { STATE_KEY, openWithState, resumeIfPaused } from './helpers';

/**
 * 데이터베이스 단원 새 구조(2026-10-15): 1 이론·개념 맞추기 → 2 개념 점검 문제 → 3 실습 설명·실습 맞추기 → 4 실습 점검 문제.
 * 정답은 콘텐츠 데이터(src/content/stages/U01.json)에서 읽어 실제 화면 조작으로 푼다.
 */
const S = UNIT_STAGES.U01;

async function matchAll(page: Page, pairs: { term: string; desc: string }[]) {
  const row = (desc: string) => page.locator('.cg-match-rows li').filter({ has: page.locator('.cg-match-desc', { hasText: desc }) });
  for (const p of pairs) await row(p.desc).getByRole('button', { name: p.term, exact: true }).click();
  await page.getByRole('button', { name: '확인', exact: true }).click();
}

async function pickText(page: Page, text: string) {
  const idx = await page.locator('.options .option > span:not(.option-tag)').evaluateAll(
    (els, t) => els.findIndex((e) => (e.textContent ?? '').replace(/^[①②③④⑤]\s/, '') === t), text);
  expect(idx, text).toBeGreaterThanOrEqual(0);
  await page.locator('.options .option').nth(idx).click();
  await page.getByRole('button', { name: '채점' }).click();
}

test('새 단원 구조: 이론·개념 맞추기 → 개념 점검 → 실습 설명·맞추기 → 실습 점검 문제가 열린다', async ({ page }) => {
  const fresh = { ...emptyLearnerState('demo'), pre: { status: 'skipped' as const, answers: {}, score: 0 } };
  await openWithState(page, fresh, '/learn/U01', { stages: false });
  await resumeIfPaused(page);
  await expect(page.getByText('단계 0/4')).toBeVisible();
  const levels = page.locator('.cg-levels li');
  await expect(levels).toHaveCount(4);
  await expect(levels.nth(1)).toContainText('잠김');
  // 4단계 활동은 잠김 안내 + 그래도 풀어보기
  await page.goto('./#/learn/U01/U01-A01');
  await expect(page.getByText('실습 점검 문제는 1~3단계')).toBeVisible();
  await page.getByRole('link', { name: '1단계로' }).click();

  // 1단계: 카드마다 읽고 개념 맞추기
  await expect(page.getByRole('heading', { name: '1단계 이론·개념 맞추기' })).toBeVisible();
  for (let i = 0; i < S.cards.length; i++) {
    await expect(page.locator('.cg-card h2')).toContainText(S.cards[i].title);
    await page.getByRole('button', { name: '다 읽었어요 → 개념 맞추기' }).click();
    await matchAll(page, S.cards[i].match.pairs);
    if (i < S.cards.length - 1) {
      await expect(page.getByText(`${i + 1}번 카드 완료!`)).toBeVisible();
      await page.getByRole('button', { name: '다음 카드 →' }).click();
    }
  }
  await expect(page.getByText(`카드 ${S.cards.length}장을 모두 마쳤어요. 1단계 통과!`)).toBeVisible();
  await page.getByRole('button', { name: /다음 단계: 개념 점검 문제/ }).click();

  // 2단계: 객관식 10문항(첫 문항은 일부러 틀림 → 9/10 통과)
  await expect(page.getByRole('heading', { name: '2단계 개념 점검 문제' })).toBeVisible();
  const qs = S.quiz;
  await pickText(page, qs[0].options[(qs[0].answer + 1) % 4]);
  for (let i = 1; i < qs.length; i++) {
    await page.getByRole('button', { name: '다음 문제' }).click();
    await pickText(page, qs[i].options[qs[i].answer]);
  }
  await page.getByRole('button', { name: '결과 보기' }).click();
  await expect(page.getByText(`${qs.length - 1}/${qs.length}개 맞았어요.`)).toBeVisible();
  await expect(page.getByText('통과! 다음 단계가 열렸어요.')).toBeVisible();
  await expect(page.getByRole('heading', { name: '틀린 문항 1개' })).toBeVisible();
  await page.getByRole('button', { name: /다음 단계: 실습 설명·실습 맞추기/ }).click();

  // 3단계: 예제 실행 → 설명 → 실습 맞추기(SQL 조각 ↔ 역할)
  await expect(page.getByRole('heading', { name: '3단계 실습 설명·실습 맞추기' })).toBeVisible();
  for (let i = 0; i < S.practice.length; i++) {
    const p = S.practice[i];
    await expect(page.locator('.cg-card h2')).toContainText(p.title);
    if (p.run) {
      await page.getByRole('button', { name: '실행해 보기' }).click();
      await expect(page.locator('table.data caption', { hasText: '실행 결과' })).toBeVisible();
    }
    if (i === 0) {
      // 데이터 보기: 표와 ERD
      await page.locator('.data-panel summary').click();
      await expect(page.locator('.data-panel table.data caption').first()).toContainText('행)');
      await page.locator('.data-panel').getByRole('button', { name: 'ERD 보기' }).click();
      await expect(page.locator('.data-panel [data-testid=erd]')).toBeVisible();
    }
    await page.getByRole('button', { name: '다 읽었어요 → 실습 맞추기' }).click();
    await expect(page.getByRole('heading', { name: '실습 맞추기', exact: true })).toBeVisible();
    await matchAll(page, p.match.pairs);
    if (i < S.practice.length - 1) await page.getByRole('button', { name: '다음 예제 →' }).click();
  }
  await expect(page.getByText(`예제 ${S.practice.length}개를 모두 마쳤어요. 3단계 통과!`)).toBeVisible();
  await page.getByRole('button', { name: /다음 단계: 실습 점검 문제/ }).click();

  // 단원 화면: 1~3단계 통과, 4단계(실습 활동·체크포인트) 열림
  await expect(page.getByText('단계 3/4')).toBeVisible();
  await expect(page.locator('.cg-levels li').nth(3)).toContainText('열림');
  await page.getByRole('link', { name: /활동 1\./ }).click();
  await expect(page.getByRole('heading', { name: '엔터티·속성·값 나누기' })).toBeVisible();
  await expect(page.getByText('실습 점검 문제는 1~3단계')).toHaveCount(0);
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), STATE_KEY);
  expect(Object.keys(saved.stages.U01).sort()).toEqual(['s1', 's2', 's3']);
  expect(saved.stages.U01.s2.best).toBe(qs.length - 1);
});

test('실습 활동 문제에 데이터 보기(표·ERD)가 있어 문제만으로 풀 수 있다(U01-A02)', async ({ page }) => {
  await openWithState(page, null, '/learn/U01/U01-A02');
  await resumeIfPaused(page);
  await expect(page.getByText("아래 '데이터 보기'의 students 표")).toBeVisible();
  await page.locator('.data-panel summary').click();
  await expect(page.locator('.data-panel table.data caption', { hasText: 'students (6행)' })).toBeVisible();
});
