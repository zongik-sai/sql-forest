import { expect, test, type Page } from '@playwright/test';
import { CG_UNITS } from '../../src/features/computer/content';
import { buildMock } from '../../src/features/computer/mock';

/**
 * 과목 선택 → 컴퓨터 일반(로그인 없이 둘러보기: 이 기기에만 저장) 흐름.
 * 정답은 문제은행 데이터에서 읽어 실제 화면 조작으로 푼다.
 */
const U1 = CG_UNITS[0];
const GUEST_STATE = 'sqlforest:v1:guest:cg:state';

async function fresh(page: Page, path = '/') {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.goto('about:blank');
  await page.goto(`./#${path}`);
}

/** 보기 순서가 섞이므로 보기 글자로 고른다 */
async function pickText(page: Page, text: string) {
  const idx = await page.locator('.options .option > span:not(.option-tag)').evaluateAll(
    (els, t) => els.findIndex((e) => (e.textContent ?? '').replace(/^[①②③④⑤]\s/, '') === t), text);
  expect(idx, text).toBeGreaterThanOrEqual(0);
  await page.locator('.options .option').nth(idx).click();
}
async function answerMcq(page: Page, text: string) {
  await pickText(page, text);
  await page.getByRole('button', { name: '채점' }).click();
}

test('첫 화면은 과목명으로 고른다(자격증 이름 없음)', async ({ page }) => {
  await fresh(page);
  await expect(page.getByRole('heading', { name: '무엇을 공부할까요?' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '데이터베이스' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '컴퓨터 일반' })).toBeVisible();
  const main = await page.locator('main').innerText();
  expect(main).not.toMatch(/SQLD|PC정비사|정보처리/);
  await page.getByRole('link', { name: /데이터베이스/ }).click();
  await expect(page).toHaveURL(/#\/db$/);
  await expect(page.getByRole('heading', { name: /작은 씨앗으로 시작해/ })).toBeVisible();
  await page.getByRole('link', { name: '과목 선택' }).click();
  await page.getByRole('link', { name: /컴퓨터 일반/ }).click();
  await expect(page).toHaveURL(/#\/computer$/);
  await expect(page.getByRole('heading', { name: '씨앗' })).toBeVisible();
  // 최근 공부한 과목 표시
  await page.getByRole('link', { name: '과목', exact: true }).click();
  await expect(page.locator('.subject-card', { hasText: '컴퓨터 일반' }).getByText('최근 공부')).toBeVisible();
});

test('이론 → 끼워맞추기 → 기초 객관식: 통과 기준·잠금·식물 성장·오답노트', async ({ page }) => {
  await fresh(page, `/computer/unit/${U1.id}`);
  // 2단계는 잠김 → "그래도 풀어보기" 가능
  await page.goto(`./#/computer/unit/${U1.id}/2`);
  await expect(page.getByText('앞 단계 1단계 이론를 통과하면 열려요.')).toBeVisible();
  await expect(page.getByRole('button', { name: '그래도 풀어보기' })).toBeVisible();

  // 1단계 이론: 카드 전체를 읽고 완료
  await page.goto(`./#/computer/unit/${U1.id}/1`);
  await expect(page.locator('.cg-card')).toHaveCount(U1.cards.length);
  await page.getByRole('button', { name: '이론 학습 완료' }).click();
  await expect(page.getByRole('dialog', { name: '식물이 자랐어요' })).toContainText('새싹');
  await page.getByRole('button', { name: '닫기' }).click();

  // 2단계 끼워맞추기: 빈칸을 누르고 예시답안을 고른다. 기준 미만 → 정답·해설 공개 → 다시 풀어 통과
  await page.getByRole('button', { name: /다음 단계: 개념 끼워맞추기/ }).click();
  const need = Math.ceil(0.8 * U1.blanks.length);
  const fill = async (n: number) => {
    for (let i = 0; i < n; i++) {
      await page.locator('.cg-blank').nth(i).click();
      await page.locator('.cg-bank').getByRole('button', { name: U1.blanks[i].answer, exact: true }).click();
    }
  };
  await fill(need - 1);
  await page.getByRole('button', { name: '채점하기' }).click();
  await expect(page.locator('.notice-warn').first()).toContainText(`${need - 1}/${U1.blanks.length}개 맞았어요.`);
  await expect(page.locator('.cg-fix').first()).toContainText(`정답: ${U1.blanks[need - 1].answer}`);
  await page.getByRole('button', { name: '다시 풀기(새 순서)' }).click();
  await fill(need);
  await page.getByRole('button', { name: '채점하기' }).click();
  await expect(page.locator('.notice-good').first()).toContainText('통과! 다음 단계가 열렸어요.');

  // 3단계 기초 객관식: 첫 문제는 일부러 틀리고 나머지는 맞힘
  await page.getByRole('button', { name: /다음 단계: 기초 객관식/ }).click();
  const qs = U1.basic;
  await answerMcq(page, qs[0].options[(qs[0].answer + 1) % 4]);
  await expect(page.getByText(/틀렸어요. 정답은/)).toBeVisible();
  for (let i = 1; i < qs.length; i++) {
    await page.getByRole('button', { name: '다음 문제' }).click();
    await answerMcq(page, qs[i].options[qs[i].answer]);
  }
  await page.getByRole('button', { name: '결과 보기' }).click();
  await expect(page.getByText(`${qs.length - 1}/${qs.length}개 맞았어요.`)).toBeVisible();
  await expect(page.getByText('통과! 다음 단계가 열렸어요.')).toBeVisible();
  await expect(page.getByRole('heading', { name: '틀린 문항 1개' })).toBeVisible();

  // 오답노트: 틀린 1문항 → 다시 풀어 맞히면 빠짐
  await page.getByRole('link', { name: '오답노트' }).first().click();
  await expect(page.getByRole('heading', { name: /오답노트/ })).toContainText('1문항');
  await page.getByRole('button', { name: '1문항 다시 풀기' }).click();
  await answerMcq(page, qs[0].options[qs[0].answer]);
  await page.getByRole('button', { name: '끝내기' }).click();
  await expect(page.getByText('오답노트가 비어 있어요.')).toBeVisible();

  // 새로고침해도 기록 유지(이 기기 저장)
  await page.goto('./#/computer');
  await page.reload();
  await expect(page.getByText(/통과한 단계 3 \/ 40/)).toBeVisible();
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), GUEST_STATE);
  expect(Object.keys(saved.units.U1)).toEqual(expect.arrayContaining(['lv1', 'lv2', 'lv3']));
});

test('모의고사: 50문항·제출·단원별/영역별 정답률·틀린 문항은 오답노트로', async ({ page }) => {
  await fresh(page, '/computer/mock');
  await page.locator('.cg-mock-grid .panel', { hasText: '모의고사 1회' }).getByRole('link', { name: '시작' }).click();
  await expect(page.getByText(/남은 시간 (49|50):/)).toBeVisible();
  const { items } = buildMock(CG_UNITS, 'set1');
  expect(items.length).toBe(50);
  for (let i = 0; i < items.length; i++) {
    await expect(page.locator('.cg-q')).toContainText(items[i].question.slice(0, 20));
    await pickText(page, items[i].options[i < 31 ? items[i].answer : (items[i].answer + 1) % 4]);
    if (i < items.length - 1) await page.getByRole('button', { name: '다음', exact: true }).click();
  }
  await page.locator('.cg-exam-bar').getByRole('button', { name: '제출' }).click();
  await page.getByRole('button', { name: '제출하기' }).click();
  await expect(page.getByText('31 / 50')).toBeVisible();
  await expect(page.getByText('합격 기준(30문항) 이상이에요!')).toBeVisible();
  await expect(page.getByRole('heading', { name: '단원별 정답률' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '영역별 정답률' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '틀린 문항 19개 (오답노트에 저장됨)' })).toBeVisible();
  await page.getByRole('link', { name: '모의고사 목록' }).click();
  await expect(page.locator('table')).toContainText('31/50');
  await expect(page.locator('.cg-mock-grid .panel', { hasText: '오답 모의고사' })).toContainText('오답노트 19문항');
});

test('모의고사: 50분이 지나면 자동 제출(시간 종료)', async ({ page }) => {
  await fresh(page, '/computer/mock/set2');
  await expect(page.getByText(/남은 시간/)).toBeVisible();
  // 시작 시각을 51분 전으로 바꿔 다시 열기
  await page.evaluate(() => {
    const k = 'sqlforest:v1:guest:cg:mock:current';
    const e = JSON.parse(localStorage.getItem(k)!);
    e.startedAt = Date.now() - 51 * 60 * 1000;
    localStorage.setItem(k, JSON.stringify(e));
  });
  await page.reload();
  await expect(page.getByText('(시간 종료로 자동 제출)')).toBeVisible();
  await expect(page.getByText('0 / 50')).toBeVisible();
});

test('휴대폰 너비에서도 가로 스크롤 없이 보인다', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const path of ['/', '/computer', `/computer/unit/${U1.id}`, '/computer/mock']) {
    await fresh(page, path);
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
});
