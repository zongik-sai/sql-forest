import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { buildNewCourse } from '../../src/features/computer/courses/build';
import { MOCK_SIZE, NEW_COURSES, type NewCourseId } from '../../src/features/computer/courses/defs';
import { fixedSetCount, mockOptionsOf } from '../../src/features/computer/mock';

/**
 * 보충 학습(짧은 3단원 과목: 2진법 이해 /binary · IP 이해 /ip), 로그인 없이 둘러보기.
 * 단원 원본(courses/bin·ip/U1~U3.json)이 아직 비어 있으면 과목 화면은 "준비 중"이라 과목 화면 검사는 실패한다.
 */
const SUPPLEMENTS = NEW_COURSES.filter((c) => c.group === 'supplement');
interface RawQ { o: string[]; a: number }
const raw = (c: NewCourseId, n: number) => JSON.parse(readFileSync(`src/features/computer/courses/${c}/U${n}.json`, 'utf8')) as {
  theory: unknown[]; fill: { answer: string }[]; basic: RawQ[]; advanced: RawQ[];
};
const loadCourse = (c: NewCourseId) => buildNewCourse(c, [1, 2, 3].map((n) => raw(c, n)));
const SHORT = MOCK_SIZE.short;

async function fresh(page: Page, path = '/') {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.goto('about:blank');
  await page.goto(`./#${path}`);
}
/** 단원 화면으로 바로 이동: 집중 학습 시작 화면이 뜨면 시작을 누르고(전체화면 전환 유예 1.5초), 식물 알림은 닫는다 */
async function openUnitPath(page: Page, path: string) {
  await page.goto(`./#${path}`);
  const overlay = page.getByTestId('focus-overlay');
  await overlay.waitFor({ state: 'visible', timeout: 1500 }).catch(() => {});
  const start = overlay.getByRole('button', { name: /학습 시작$|다시 시작$|학습 계속하기$/ });
  if (await start.isVisible().catch(() => false)) {
    await start.click();
    await expect(overlay).toHaveCount(0);
    await page.waitForTimeout(1600);
  }
  const grew = page.getByRole('dialog', { name: '식물이 자랐어요' });
  if (await grew.isVisible().catch(() => false)) await grew.getByRole('button', { name: '닫기' }).click();
}
/** 보기 글자로 고르고 채점(보기 순서는 섞여 있음) */
async function answerMcq(page: Page, text: string) {
  const idx = await page.locator('.options .option > span:not(.option-tag)').evaluateAll(
    (els, t) => els.findIndex((e) => (e.textContent ?? '').replace(/^[①②③④⑤]\s/, '') === t), text);
  expect(idx, text).toBeGreaterThanOrEqual(0);
  await page.locator('.options .option').nth(idx).click();
  await page.getByRole('button', { name: '채점' }).click();
}
const overflowX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('첫 화면: 정규 과목 아래 "보충 학습"에 짧은 과목 2개(작은 카드, 자격증 이름 없음)', async ({ page }) => {
  expect(SUPPLEMENTS.map((c) => c.id)).toEqual(['bin', 'ip']);
  await fresh(page);
  // 정규 과목 카드는 그대로 5개
  await expect(page.locator('.subject-card')).toHaveCount(5);
  const sec = page.locator('section.supplement');
  await expect(sec.getByRole('heading', { name: '보충 학습', level: 2 })).toBeVisible();
  await expect(sec.locator('.supplement-card')).toHaveCount(2);
  expect(await sec.locator('.supplement-card h3').allInnerTexts()).toEqual(['2진법 이해', 'IP 이해']);
  for (const c of SUPPLEMENTS) {
    const card = sec.locator('.supplement-card', { hasText: c.name });
    await expect(card).toContainText('3단원 · 짧게');
    await expect(card).toContainText(c.summary.slice(0, 15));
  }
  // 보충 학습 영역이 정규 과목 목록 뒤에 온다
  const [gridY, supY] = await Promise.all([page.locator('.subject-grid').boundingBox(), sec.boundingBox()]);
  expect(supY!.y).toBeGreaterThan(gridY!.y);
  expect(await page.locator('main').innerText()).not.toMatch(/SQLD|PC정비사|정보처리기사|네트워크관리사|정보기기운용|COS ?Pro|YBM/);
  // 들어가면 그 과목, 돌아오면 최근 공부 표시
  await sec.locator('.supplement-card', { hasText: 'IP 이해' }).click();
  await expect(page).toHaveURL(/#\/ip$/);
  await expect(page.locator('.topbar .brand')).toContainText('IP 이해');
  await page.getByRole('link', { name: '과목', exact: true }).click();
  await expect(sec.locator('.supplement-card', { hasText: 'IP 이해' }).getByText('최근 공부')).toBeVisible();
});

for (const def of SUPPLEMENTS) {
  test(`${def.name}: 과목 홈 3단원 · 15단계 · 네트워크 3단원으로 이어 가기`, async ({ page }) => {
    for (const n of [1, 2, 3]) expect(raw(def.id, n).theory.length, `${def.id}/U${n}.json 내용이 아직 없음(다른 작업이 쓰는 중)`).toBeGreaterThan(0);
    await fresh(page, def.path);
    await expect(page.locator('.topbar .brand')).toContainText(def.name);
    await expect(page.locator('.cg-unit')).toHaveCount(3);
    expect((await page.locator('.cg-unit b').allInnerTexts())).toEqual(def.units.map((u) => u.title));
    await expect(page.getByText(/통과한 단계 0 \/ 15/)).toBeVisible();
    await expect(page.getByText(`모의고사 최고 0/${SHORT.total}`)).toBeVisible();
    // 식물 기준(15단계): 1·3·6·11·15단계, 열매는 모의 12점
    const rules = await page.locator('.cg-growth li .small').allInnerTexts();
    expect(rules).toEqual(['시작', '1단계', '3단계', '6단계', '11단계', '15단계', `꽃 + 모의 ${SHORT.need}점`]);
    // 보충 과목 홈: 다 익혔다면 네트워크 3단원으로(보충 안내 상자는 없음)
    const back = page.locator('.cg-bridge-back');
    await expect(back).toContainText('다 익혔다면');
    await expect(back.getByRole('link', { name: '네트워크 3단원' })).toHaveAttribute('href', '#/network/unit/U3');
    await expect(page.locator('.cg-bridge')).toHaveCount(0);
  });

  test(`${def.name}: 모의고사 ${SHORT.total}문항 · ${SHORT.minutes}분, 겹치지 않는 고정 회차만`, async ({ page }) => {
    const course = loadCourse(def.id);
    const sets = fixedSetCount(course.units, mockOptionsOf(course));
    expect(sets, '짧은 과목(기초 10 · 실력점검 8 × 3단원)은 고정 2회').toBe(2);
    await fresh(page, `${def.path}/mock`);
    const main = page.locator('main');
    await expect(main).toContainText(`사지선다 ${SHORT.total}문항 · ${SHORT.minutes}분 · ${SHORT.need}문항 이상이면 합격 기준`);
    await expect(main).not.toContainText('50문항');
    await expect(main).toContainText(def.areas.map((a) => a.label).join(' → '));
    const grid = page.locator('.cg-mock-grid > .panel b');
    await expect(grid).toHaveText(['모의고사 1회', '모의고사 2회', '랜덤 모의고사', '오답 모의고사']);
    await expect(page.locator('.cg-mock-grid .panel', { hasText: '오답 모의고사' })).toContainText(`최대 ${SHORT.total}`);
    // 보이지 않는 3회 주소는 목록으로
    await page.goto(`./#${def.path}/mock/set3`);
    await expect(page).toHaveURL(new RegExp(`#${def.path}/mock$`));
    // 1회 시작: 20문항 · 20분
    await page.locator('.cg-mock-grid .panel', { hasText: '모의고사 1회' }).getByRole('link', { name: '시작' }).click();
    await expect(page).toHaveURL(new RegExp(`#${def.path}/mock/set1$`));
    await expect(page.getByText(/남은 시간 (19|20):/)).toBeVisible();
    await expect(page.locator('.cg-exam-bar')).toContainText(`0/${SHORT.total} 답함`);
    await expect(page.locator('.cg-qgrid button')).toHaveCount(SHORT.total);
  });
}

test('2진법 이해 1단원: 짧은 단원 문항 수와 기준(8/10 · 7/10 · 5/8)으로 단계 안내·채점', async ({ page }) => {
  const u = raw('bin', 1);
  expect(u.theory.length, 'bin/U1.json 내용이 아직 없음').toBeGreaterThan(0);
  await fresh(page, '/binary/unit/U1');
  await expect(page.getByTestId('focus-overlay').getByRole('heading')).toHaveText('1단원 집중 학습');
  await openUnitPath(page, '/binary/unit/U1');
  const levels = page.locator('.cg-levels li');
  await expect(levels).toHaveCount(5);
  await expect(levels.nth(0)).toContainText(`카드 ${u.theory.length}장`);
  await expect(levels.nth(1)).toContainText(`단원 전체 빈칸 ${u.fill.length}개 · 8개 이상`);
  await expect(levels.nth(2)).toContainText(`${u.basic.length}문항 · 7개 이상`);
  await expect(levels.nth(4)).toContainText(`${u.advanced.length}문항 · 5개 이상`);
  await openUnitPath(page, '/binary/unit/U1/1');
  await expect(page.locator('.cg-card-dot')).toHaveCount(u.theory.length);

  // 2단계 끼워맞추기(빈칸 10개): 7개는 기준 미만, 8개면 통과(앞 단계 전이라 "그래도 풀어보기")
  await openUnitPath(page, '/binary/unit/U1/2');
  await page.getByRole('button', { name: '그래도 풀어보기' }).click();
  await expect(page.locator('.cg-blank')).toHaveCount(u.fill.length);
  await expect(page.locator('.cg-chip')).toHaveCount(15);
  const fill = async (n: number) => {
    for (let i = 0; i < n; i++) {
      await page.locator('.cg-blank').nth(i).click();
      await page.locator('.cg-bank').getByRole('button', { name: u.fill[i].answer, exact: true }).click();
    }
  };
  await fill(7);
  await page.getByRole('button', { name: '채점하기' }).click();
  await expect(page.locator('.notice-warn').first()).toContainText('7/10개 맞았어요. 통과 기준은 8개예요.');
  await page.getByRole('button', { name: '다시 풀기(새 순서)' }).click();
  await fill(8);
  await page.getByRole('button', { name: '채점하기' }).click();
  await expect(page.locator('.notice-good').first()).toContainText('8/10개 맞았어요. 통과!');

  // 5단계 실력점검(8문항): 3개 틀리고 5개 맞히면 통과
  await openUnitPath(page, '/binary/unit/U1/5');
  await page.getByRole('button', { name: '그래도 풀어보기' }).click();
  await expect(page.getByText(`${u.advanced.length}문항을 한 문제씩 풀고 바로 채점해요. 5개 이상 맞으면 통과예요.`)).toBeVisible();
  for (let i = 0; i < u.advanced.length; i++) {
    if (i > 0) await page.getByRole('button', { name: '다음 문제' }).click();
    const q = u.advanced[i];
    await answerMcq(page, q.o[i < 3 ? (q.a + 1) % 4 : q.a]);
  }
  await page.getByRole('button', { name: '결과 보기' }).click();
  await expect(page.getByText('5/8개 맞았어요.')).toBeVisible();
  await expect(page.getByText('실력점검 통과!')).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sqlforest:v1:guest:bin:state') ?? '{}'));
  expect(saved.units.U1).toMatchObject({ lv2: { best: 8, total: 10 }, lv5: { best: 5, total: 8 } });
  expect(saved.units.U1.lv5.passedAt).toBeTruthy();
});

test('네트워크·컴퓨터 일반 홈: "기초가 어렵다면" 보충 학습 안내(다른 과목에는 없음)', async ({ page }) => {
  for (const path of ['/network', '/computer']) {
    await fresh(page, path);
    const box = page.locator('.cg-bridge');
    await expect(box).toBeVisible();
    await expect(box).toContainText('기초가 어렵다면: 2진법 이해 · IP 이해 (보충 학습)');
    await expect(box.getByRole('link', { name: '2진법 이해' })).toHaveAttribute('href', '#/binary');
    await expect(box.getByRole('link', { name: 'IP 이해' })).toHaveAttribute('href', '#/ip');
  }
  await page.locator('.cg-bridge').getByRole('link', { name: 'IP 이해' }).click();
  await expect(page).toHaveURL(/#\/ip$/);
  await fresh(page, '/programming');
  await expect(page.locator('.cg-unit').first()).toBeVisible();
  await expect(page.locator('.cg-bridge')).toHaveCount(0);
});

test('가로 스크롤 없음: 첫 화면·보충 과목 홈(1280px·390px)', async ({ page }) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await fresh(page);
    await expect(page.locator('section.supplement .supplement-card')).toHaveCount(2);
    await page.waitForTimeout(150);
    expect(await overflowX(page), `첫 화면 ${width}px`).toBeLessThanOrEqual(1);
    for (const c of SUPPLEMENTS) {
      await fresh(page, c.path);
      await expect(page.locator('.cg-unit')).toHaveCount(3);
      await page.waitForTimeout(150);
      expect(await overflowX(page), `${c.path} ${width}px`).toBeLessThanOrEqual(1);
    }
  }
});
