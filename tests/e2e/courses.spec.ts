import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { buildNewCourse } from '../../src/features/computer/courses/build';
import { NEW_COURSES, type NewCourseId } from '../../src/features/computer/courses/defs';
import { buildMock } from '../../src/features/computer/mock';

/**
 * 컴퓨터 일반과 같은 엔진을 쓰는 새 과목(네트워크·프로그래밍·Data): 로그인 없이 둘러보기(이 기기에만 저장).
 * 정답·카드 제목은 테스트할 때 과목 원본(courses/<과목>/U1~U8.json)에서 읽는다.
 * 원본을 다른 작업이 아직 쓰는 중이면(빈 단원) 그 단원 검사는 "내용 없음"으로 실패한다.
 */
interface RawCard { id: string; title: string; code?: string; match?: { pairs: { term: string; desc: string }[]; distractor: string } }
const rawUnit = (c: NewCourseId, n: number) => JSON.parse(readFileSync(`src/features/computer/courses/${c}/U${n}.json`, 'utf8')) as { title: string; theory: RawCard[] };
/** 정규 과목(8단원). 보충 학습(2진법 이해·IP 이해, 3단원)은 supplement.spec.ts */
const MAIN_COURSES = NEW_COURSES.filter((c) => (c.group ?? 'main') === 'main');
const loadCourse = (c: NewCourseId) => buildNewCourse(c, [1, 2, 3, 4, 5, 6, 7, 8].map((n) => JSON.parse(readFileSync(`src/features/computer/courses/${c}/U${n}.json`, 'utf8'))));

async function fresh(page: Page, path = '/') {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.goto('about:blank');
  await page.goto(`./#${path}`);
}
/** 단원 화면의 집중 학습 시작 화면에서 시작을 누른다(전체화면 전환 직후 유예 1.5초를 기다림) */
async function startUnit(page: Page) {
  const overlay = page.getByTestId('focus-overlay');
  await expect(overlay).toBeVisible();
  await overlay.getByRole('button', { name: /학습 시작$|다시 시작$/ }).click();
  await expect(overlay).toHaveCount(0);
  await page.waitForTimeout(1600);
}
const overflowX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('첫 화면: 과목 5개(과목 이름만, 자격증 이름 없음), 새 과목으로 들어가고 최근 공부 표시', async ({ page }) => {
  await fresh(page);
  await expect(page.getByRole('heading', { name: '무엇을 공부할까요?' })).toBeVisible();
  await expect(page.locator('.subject-card')).toHaveCount(5);
  const names = await page.locator('.subject-card h2').allInnerTexts();
  expect(names).toEqual(['데이터베이스', '컴퓨터 일반', '네트워크', '프로그래밍', 'Data']);
  const main = await page.locator('main').innerText();
  expect(main).not.toMatch(/SQLD|PC정비사|정보처리기사|네트워크관리사|정보기기운용|COS ?Pro|YBM/);
  for (const c of MAIN_COURSES) await expect(page.locator('.subject-card', { hasText: c.name }).first()).toContainText('8단원 × 5단계');
  // Data(/data)는 데이터베이스 과목(/db)과 다른 과목
  await page.locator('.subject-card', { has: page.getByRole('heading', { name: 'Data', exact: true }) }).click();
  await expect(page).toHaveURL(/#\/data$/);
  await expect(page.locator('.topbar .brand')).toContainText('Data');
  await page.getByRole('link', { name: '과목', exact: true }).click();
  await expect(page.locator('.subject-card', { has: page.getByRole('heading', { name: 'Data', exact: true }) }).getByText('최근 공부')).toBeVisible();
  await expect(page.locator('.subject-card', { hasText: '데이터베이스' }).first().getByText('최근 공부')).toHaveCount(0);
});

for (const def of MAIN_COURSES) {
  test(`${def.name}: 과목 홈 → 1단원 집중 학습 → 첫 카드 개념 맞추기 → 모의고사 1회 50문항`, async ({ page }) => {
    const u1 = rawUnit(def.id, 1);
    expect(u1.theory.length, `${def.id}/U1.json 내용이 아직 없음(다른 작업이 쓰는 중)`).toBeGreaterThan(0);
    const card = u1.theory[0];
    expect(card.match, `${def.id}-U1-t1 개념 맞추기 없음`).toBeTruthy();

    await fresh(page, def.path);
    await expect(page.locator('.topbar .brand')).toContainText(def.name);
    const nav = page.locator('.topbar nav');
    for (const t of ['과목', '단원', '모의고사', '오답노트']) await expect(nav.getByRole('link', { name: t, exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: '반 학습 현황' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '씨앗' })).toBeVisible();
    await expect(page.getByText(/통과한 단계 0 \/ 40/)).toBeVisible();
    await expect(page.locator('.cg-unit')).toHaveCount(def.units.length);
    await expect(page.locator('.cg-unit').first()).toContainText(def.units[0].title);
    // 내용 범위(출처)는 과목 화면에만 작게
    await expect(page.locator('.cg-basis')).toContainText(def.basis.slice(0, 12));

    // 1단원 → 집중 학습 시작 화면(규칙: 5번 잠기면 초기화)
    await page.locator('.cg-unit').first().click();
    await expect(page).toHaveURL(new RegExp(`#${def.path}/unit/U1$`));
    const overlay = page.getByTestId('focus-overlay');
    await expect(overlay.getByRole('heading')).toHaveText('1단원 집중 학습');
    await expect(overlay).toContainText('5번');
    await startUnit(page);
    await expect(page.getByRole('heading', { name: u1.title })).toBeVisible();

    // 1단계: 첫 카드 읽기 → 개념 맞추기 → 1번 카드 완료
    await page.goto(`./#${def.path}/unit/U1/1`);
    await expect(page.locator('.cg-card-dot')).toHaveCount(u1.theory.length);
    await expect(page.locator('.cg-card h2')).toContainText(card.title.replace(/^\[확장\]\s*/, ''));
    await page.getByRole('button', { name: '다 읽었어요 → 개념 맞추기' }).click();
    const row = (desc: string) => page.locator('.cg-match-rows li').filter({ has: page.locator('.cg-match-desc', { hasText: desc }) });
    await expect(page.locator('.cg-match-rows li')).toHaveCount(3);
    for (const p of card.match!.pairs) await row(p.desc).getByRole('button', { name: p.term, exact: true }).click();
    await page.getByRole('button', { name: '확인' }).click();
    await expect(page.getByText(`1번 카드 완료! (1/${u1.theory.length})`)).toBeVisible();
    // 이 과목 키에만 저장(컴퓨터 일반 기록과 섞이지 않음)
    const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), `sqlforest:v1:guest:${def.id}:state`);
    expect(Object.keys(saved.cards ?? {})).toEqual(['U1-t1']);
    expect(await page.evaluate(() => localStorage.getItem('sqlforest:v1:guest:cg:state'))).toBeNull();

    // 모의고사 1회: 50문항
    await page.locator('.topbar').getByRole('link', { name: '모의고사', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#${def.path}/mock$`));
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
    for (const a of def.areas.slice(0, 2)) await expect(page.locator('main')).toContainText(a.label);
    await page.locator('.cg-mock-grid .panel', { hasText: '모의고사 1회' }).getByRole('link', { name: '시작' }).click();
    await expect(page.getByText(/남은 시간 (49|50):/)).toBeVisible();
    await expect(page.locator('.cg-exam-bar')).toContainText('0/50 답함');
    await expect(page.locator('.cg-qgrid button')).toHaveCount(50);
  });
}

test('휴대폰 너비(390px): 과목 홈·코드가 있는 카드·코드가 있는 모의고사 문항에서 가로 스크롤 없음', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const c of MAIN_COURSES) {
    await fresh(page, c.path);
    await expect(page.locator('.cg-unit').first()).toBeVisible();
    await page.waitForTimeout(200);
    expect(await overflowX(page), c.path).toBeLessThanOrEqual(1);
  }
  // 프로그래밍: 코드가 있는 이론 카드(긴 줄은 코드 블록 안에서만 스크롤)
  let found: { n: number; i: number } | null = null;
  for (let n = 1; n <= 8 && !found; n++) {
    const th = rawUnit('prog', n).theory;
    const i = th.findIndex((t) => t.code);
    if (i >= 0) found = { n, i };
  }
  expect(found, '프로그래밍 원본에 코드가 있는 카드가 아직 없음').not.toBeNull();
  await fresh(page, `/programming/unit/U${found!.n}`);
  await startUnit(page);
  await page.goto(`./#/programming/unit/U${found!.n}/1`);
  await page.getByRole('button', { name: new RegExp(`^${found!.i + 1}번 카드`) }).click();
  const code = page.locator('.cg-card pre.codeblock');
  await expect(code).toBeVisible();
  await expect(code).toHaveCSS('white-space', 'pre');
  expect(await overflowX(page), 'prog 코드 카드').toBeLessThanOrEqual(1);

  // 프로그래밍 모의고사: 코드가 있는 문항으로 이동
  const prog = loadCourse('prog');
  const paper = buildMock(prog.units, 'set1', { seedPrefix: prog.mockSeed, areas: prog.areas.map((a) => a.id) });
  const qi = paper.items.findIndex((q) => q.code);
  expect(qi, '프로그래밍 모의고사 1회에 코드가 있는 문항이 없음').toBeGreaterThanOrEqual(0);
  await fresh(page, '/programming/mock/set1');
  await expect(page.locator('.cg-exam-bar')).toBeVisible();
  await page.locator('.cg-qgrid').getByRole('button', { name: `${qi + 1}번`, exact: true }).click();
  await expect(page.locator('.cg-q')).toContainText(paper.items[qi].question.slice(0, 15));
  await expect(page.locator('main pre.codeblock')).toBeVisible();
  await page.waitForTimeout(200);
  expect(await overflowX(page), 'prog 모의고사').toBeLessThanOrEqual(1);
});
