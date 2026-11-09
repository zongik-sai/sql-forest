import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { MOCK_SIZE, NEW_COURSES } from '../../src/features/computer/courses/defs';

/**
 * 기초 다듬기(/basics, 2026-11-09: 예전 보충 학습 2진법 이해·IP 이해를 합친 10단원), 로그인 없이 둘러보기(이 기기에만 저장).
 * 5단계는 10문항 실력점검(볼 때마다 12문항 중 10개를 새로 뽑음): 학생 화면에는 이번에 쌓인 점수·누적 합계·최고점만.
 * 정답은 테스트할 때 원본(courses/basic/U<n>.json)에서 읽는다. 원본을 다른 작업이 아직 쓰는 중이면 그 검사는 실패한다.
 */
const DEF = NEW_COURSES.find((c) => c.id === 'basic')!;
interface RawQ { q: string; o: string[]; a: number; exp: string }
const raw = (n: number) => JSON.parse(readFileSync(`src/features/computer/courses/basic/U${n}.json`, 'utf8')) as { title: string; theory: unknown[]; advanced: RawQ[] };
const STATE = 'sqlforest:v1:guest:basic:state';
const AT = '2026-11-01T00:00:00.000Z';
const passed = { passedAt: AT, lastAt: AT };
/** 1~4단계를 마친 1단원(실력점검이 바로 열림) */
const READY = { v: 1, upd: AT, mock: [], wrong: {}, cards: {}, locks: {}, resets: {}, units: { U1: { lv1: passed, lv2: { best: 10, total: 10, ...passed }, lv3: { best: 10, total: 10, ...passed }, lv4: passed } } };

async function fresh(page: Page, path = '/', state?: Record<string, unknown>) {
  await page.goto('./');
  await page.evaluate((s) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(s ?? {})) localStorage.setItem(k, JSON.stringify(v));
  }, state);
  await page.goto('about:blank');
  await page.goto(`./#${path}`);
}
/** 단원 화면: 집중 학습 시작 화면이 뜨면 시작을 누르고(전체화면 전환 유예 1.5초), 식물 알림은 닫는다 */
async function startIfAsked(page: Page) {
  const overlay = page.getByTestId('focus-overlay');
  await overlay.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
  const start = overlay.getByRole('button', { name: /학습 시작$|다시 시작$|학습 계속하기$/ });
  if (await start.isVisible().catch(() => false)) {
    await start.click();
    await expect(overlay).toHaveCount(0);
    await page.waitForTimeout(1600);
  }
  const grew = page.getByRole('dialog', { name: '식물이 자랐어요' });
  if (await grew.isVisible().catch(() => false)) await grew.getByRole('button', { name: '닫기' }).click();
}
/** 창 크기를 바꾸기 전에 전체화면(단원 집중 학습)을 끝낸다 */
async function resize(page: Page, width: number, height: number) {
  await page.evaluate(() => (document.fullscreenElement ? document.exitFullscreen() : undefined)).catch(() => {});
  await page.goto('about:blank');
  await page.setViewportSize({ width, height });
}
const overflowX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const saved = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), STATE);

/** 지금 화면의 문항(보기 순서는 섞여 있음)을 원본에서 찾는다 */
async function currentQ(page: Page, pool: RawQ[]) {
  const head = (await page.locator('h2.cg-q').innerText()).replace(/^\d+\.\s*/, '').trim();
  const q = pool.find((x) => x.q.trim() === head) ?? pool.find((x) => head.startsWith(x.q.trim().slice(0, 30)));
  expect(q, `원본에서 문항을 찾지 못함: ${head}`).toBeTruthy();
  return q!;
}
async function choose(page: Page, text: string) {
  const idx = await page.locator('.options .option > span:not(.option-tag)').evaluateAll(
    (els, t) => els.findIndex((e) => (e.textContent ?? '').replace(/^[①②③④⑤]\s/, '') === t), text);
  expect(idx, text).toBeGreaterThanOrEqual(0);
  await page.locator('.options .option').nth(idx).click();
  await page.getByRole('button', { name: '채점' }).click();
}
/** 실력점검 한 문항 풀기(wrong이면 틀린 보기) → 문항 글자 */
async function answerOne(page: Page, pool: RawQ[], wrong: boolean) {
  const q = await currentQ(page, pool);
  await choose(page, q.o[wrong ? (q.a + 1) % 4 : q.a]);
  return q.q;
}

test('첫 화면: 기초 다듬기는 다른 과목과 같은 큰 카드로 맨 아래(작은 보충 학습 묶음 없음, 자격증 이름 없음)', async ({ page }) => {
  await fresh(page);
  const cards = page.locator('.subject-card');
  await expect(cards).toHaveCount(6);
  await expect(cards.last().locator('h2')).toHaveText('기초 다듬기');
  const card = cards.last();
  for (const f of ['10단원 × 5단계', '단원마다 10문항 실력점검', `모의고사 ${MOCK_SIZE.foundation.total}문항 · ${MOCK_SIZE.foundation.minutes}분`]) await expect(card.locator('.subject-facts')).toContainText(f);
  await expect(card.locator('.subject-art svg')).toBeVisible();
  // 같은 카드 모양·크기(첫 줄 카드와 같은 너비, 그림 칸 같은 크기)
  const [a, b] = await Promise.all([cards.nth(1).boundingBox(), card.boundingBox()]);
  expect(Math.abs(a!.width - b!.width)).toBeLessThanOrEqual(2);
  const [artA, artB] = await Promise.all([cards.nth(1).locator('.subject-art').boundingBox(), card.locator('.subject-art').boundingBox()]);
  expect(Math.abs(artA!.width - artB!.width)).toBeLessThanOrEqual(1);
  expect(await card.getAttribute('class')).toBe(await cards.nth(1).getAttribute('class'));
  await expect(page.locator('.supplement, .supplement-card')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '보충 학습' })).toHaveCount(0);
  expect(await page.locator('main').innerText()).not.toMatch(/2진법 이해|IP 이해|SQLD|PC정비사|정보처리기사|네트워크관리사|정보기기운용|COS ?Pro|YBM/);
  await card.click();
  await expect(page).toHaveURL(/#\/basics$/);
  await expect(page.locator('.topbar .brand')).toContainText('기초 다듬기');
  await page.getByRole('link', { name: '과목', exact: true }).click();
  await expect(page.locator('.subject-card').last().getByText('최근 공부')).toBeVisible();
});

test('기초 다듬기 홈: 10단원 순서(진법 → 오류 정정 → IP → 클래스 → 서브네팅), 50단계, 네트워크로 이어 가기', async ({ page }) => {
  await fresh(page, '/basics');
  await expect(page.locator('.cg-unit')).toHaveCount(10);
  expect(await page.locator('.cg-unit b').allInnerTexts()).toEqual(DEF.units.map((u) => u.title));
  expect(await page.locator('.cg-unit .cg-unit-num').allInnerTexts()).toEqual(DEF.units.map((u) => String(u.num)));
  await expect(page.getByText(/통과한 단계 0 \/ 50/)).toBeVisible();
  await expect(page.getByText(`모의고사 최고 0/${MOCK_SIZE.foundation.total}`)).toBeVisible();
  await expect(page.getByText('단원마다 이론·개념 맞추기 → 전체 끼워맞추기 → 기초 → 요약 → 10문항 실력점검')).toBeVisible();
  // 단원 카드: 실력점검은 아직 안 풀었어요(내용이 있는 단원)
  await expect(page.locator('.cg-unit').first()).toContainText('실력점검 아직 안 풀었어요');
  const back = page.locator('.cg-bridge-back');
  await expect(back).toHaveText('다 익혔다면 네트워크 2단원(오류 제어)·3단원(IP·서브네팅)으로');
  await expect(back.getByRole('link', { name: '네트워크 2단원(오류 제어)' })).toHaveAttribute('href', '#/network/unit/U2');
  await expect(back.getByRole('link', { name: '3단원(IP·서브네팅)' })).toHaveAttribute('href', '#/network/unit/U3');
  await expect(page.locator('.cg-bridge')).toHaveCount(0);
  await expect(page.locator('.cg-basis')).toContainText('기초 다듬기');
});

test('네트워크·컴퓨터 일반 홈: "기초 다듬기" 안내(네트워크는 오류 제어·서브네팅 단원으로 바로), 다른 과목에는 없음', async ({ page }) => {
  for (const path of ['/network', '/computer']) {
    await fresh(page, path);
    const box = page.locator('.cg-bridge');
    await expect(box).toBeVisible();
    await expect(box).toContainText('기초 다듬기: 진법·오류 정정(패리티·해밍 코드·CRC)·IP·서브네팅을 짧게 먼저 익혀요.');
    await expect(box).not.toContainText(/기초가 어렵다면|보충 학습|2진법 이해|IP 이해/);
    await expect(box.getByRole('link', { name: '기초 다듬기' })).toHaveAttribute('href', '#/basics');
    if (path === '/network') {
      await expect(box.getByRole('link', { name: '패리티·해밍 코드' })).toHaveAttribute('href', '#/basics/unit/U4');
      await expect(box.getByRole('link', { name: '서브네팅 계산' })).toHaveAttribute('href', '#/basics/unit/U9');
      await expect(box).toContainText('2단원(오류 제어) 전에 패리티·해밍 코드');
      await expect(box).toContainText('3단원(IP·서브네팅) 전에 서브네팅 계산');
    } else await expect(box.getByRole('link')).toHaveCount(1);
  }
  await page.locator('.cg-bridge').getByRole('link', { name: '기초 다듬기' }).click();
  await expect(page).toHaveURL(/#\/basics$/);
  await fresh(page, '/programming');
  await expect(page.locator('.cg-unit').first()).toBeVisible();
  await expect(page.locator('.cg-bridge')).toHaveCount(0);
});

test('예전 주소(/binary·/ip)는 기초 다듬기의 같은 자리로', async ({ page }) => {
  await fresh(page, '/binary/unit/U2');
  await expect(page).toHaveURL(/#\/basics\/unit\/U2$/);
  await expect(page.getByTestId('focus-overlay').getByRole('heading')).toHaveText('2단원 집중 학습');
  await page.goto('./#/ip/unit/U2');
  await expect(page).toHaveURL(/#\/basics\/unit\/U8$/);
  await expect(page.getByTestId('focus-overlay').getByRole('heading')).toHaveText('8단원 집중 학습');
  await page.goto('./#/ip/unit/U3/4');
  await expect(page).toHaveURL(/#\/basics\/unit\/U10\/4$/);
  for (const [from, to] of [['/binary', /#\/basics$/], ['/ip', /#\/basics$/], ['/ip/mock/set1', /#\/basics\/mock$/], ['/binary/wrong', /#\/basics\/wrong$/]] as const) {
    await page.goto(`./#${from}`);
    await expect(page, from).toHaveURL(to);
  }
});

test('예전 2진법 이해·IP 이해 기록을 처음 한 번 옮겨 온다(예전 기록은 그대로)', async ({ page }) => {
  const old = (lv5: number) => ({
    v: 1, upd: AT, mock: [{ id: 'm', kind: 'set1', at: AT, score: 15, total: 20, seconds: 1, perUnit: {}, perArea: {} }], locks: {}, resets: {},
    units: { U1: { lv1: passed, lv2: { best: 9, total: 10, ...passed }, lv5: { best: lv5, total: 8, ...passed } } },
    cards: { 'U1-t1': AT }, wrong: { 'U1-a2': { at: AT, n: 1 } },
  });
  const bin = old(7), ip = old(5);
  await fresh(page, '/basics', { 'sqlforest:v1:guest:bin:state': bin, 'sqlforest:v1:guest:ip:state': ip });
  await expect(page.getByRole('status').filter({ hasText: '예전에 공부한 기록을 기초 다듬기로 옮겨 왔어요' })).toContainText('2진법 이해 1·2·3단원 → 1·2·3단원, IP 이해 1·2·3단원 → 6·8·10단원');
  const units = page.locator('.cg-unit');
  await expect(units.nth(0)).toContainText('실력점검 최고 9/10 · 누적 9점');
  await expect(units.nth(5)).toContainText('실력점검 최고 6/10 · 누적 6점');
  await expect(units.nth(1)).toContainText('실력점검 아직 안 풀었어요');
  await expect(page.getByText(/통과한 단계 6 \/ 50/)).toBeVisible();
  await expect(page.locator('.topbar nav')).toContainText('오답노트 2');
  const s = await saved(page);
  expect(s).toMatchObject({ importedLegacy: true, checks: { U1: { best: 9, n: 1 }, U6: { best: 6, n: 1 } }, cards: { 'U1-t1': AT, 'U6-t1': AT } });
  expect(Object.keys(s.wrong).sort()).toEqual(['U1-a2', 'U6-a2']);
  expect(s.mock).toEqual([]);
  // 예전 기록은 지우거나 바꾸지 않는다, 다시 열어도 한 번만
  const after = await page.evaluate(() => [localStorage.getItem('sqlforest:v1:guest:bin:state'), localStorage.getItem('sqlforest:v1:guest:ip:state')]);
  expect(after).toEqual([JSON.stringify(bin), JSON.stringify(ip)]);
  await page.getByRole('status').filter({ hasText: '예전에 공부한 기록을' }).getByRole('button', { name: '닫기' }).click();
  await page.reload();
  await expect(page.locator('.cg-unit').first()).toContainText('누적 9점');
  await expect(page.getByText('예전에 공부한 기록을')).toHaveCount(0);
});

test('1단원 실력점검: 10문항 · 이어 풀기 · 결과는 누적·최고점만(통과·불합격 없음) · 다시 하면 누적이 쌓이고 새로 뽑음', async ({ page }) => {
  const u = raw(1);
  expect(u.advanced.length, 'basic/U1.json 실력점검이 아직 12문항이 아님(다른 작업이 쓰는 중)').toBe(12);
  await fresh(page, '/basics/unit/U1', { [STATE]: READY });
  await startIfAsked(page);
  await expect(page.locator('main')).toContainText('실력점검 아직 안 풀었어요');
  const lv5 = page.locator('.cg-levels li').nth(4);
  await expect(lv5).toContainText('10문항 · 풀 때마다 새로 뽑아요 · 점수가 누적돼요');
  await lv5.getByRole('link', { name: '시작' }).click();
  await expect(page).toHaveURL(/#\/basics\/unit\/U1\/5$/);
  await expect(page.getByText('실력점검 문항 12개 중 10문항을 새로 뽑았어요.', { exact: false })).toBeVisible();
  await expect(page.getByText(/^1 \/ 10문항$/)).toBeVisible(); // 풀이 중 '맞힘 n'은 보이지 않음

  // 1회: 3문항 틀리고, 4번째에서 새로고침(잠김 1회로 셈) → 같은 회차를 이어 푼다
  const first: string[] = [];
  for (let i = 0; i < 3; i++) {
    first.push(await answerOne(page, u.advanced, true));
    await page.getByRole('button', { name: '다음 문제' }).click();
  }
  const fourth = await page.locator('h2.cg-q').innerText();
  await page.reload();
  await startIfAsked(page);
  await expect(page.getByText(/^4 \/ 10문항$/)).toBeVisible();
  await expect(page.locator('h2.cg-q')).toHaveText(fourth);
  for (let i = 3; i < 10; i++) {
    first.push(await answerOne(page, u.advanced, false));
    if (i < 9) await page.getByRole('button', { name: '다음 문제' }).click();
  }
  expect(new Set(first).size).toBe(10);
  await page.getByRole('button', { name: '점검 마치고 결과 보기' }).click();
  const res = page.getByTestId('selfcheck-result');
  await expect(res).toContainText('누적 점수 +7점');
  await expect(res).toContainText('이번 점검으로 쌓인 점수');
  await expect(res.locator('.kpi').filter({ hasText: '누적 합계 점수' })).toContainText('7점');
  await expect(res.locator('.kpi').filter({ hasText: '최고점' })).toContainText('7/10');
  await expect(res).toContainText('또 풀면 누적 점수가 계속 쌓여요');
  await expect(res).not.toContainText(/불합격|합격|통과|아쉬워요|마지막|평균/);
  expect(await page.locator('main').innerText()).not.toMatch(/불합격|합격|아쉬워요/);
  // 문항 다시 보기: 10문항 모두, 틀린 3문항은 펼쳐 둠(정답·해설), 오답노트에 3문항
  await expect(page.locator('.cg-review')).toHaveCount(10);
  await expect(page.locator('details.cg-review[open]')).toHaveCount(3);
  await expect(page.locator('details.cg-review[open]').first()).toContainText('← 정답');
  await expect(page.locator('.topbar nav')).toContainText('오답노트 3');
  await expect(page.locator('.badge', { hasText: '최고 7/10 · 누적 7점' })).toBeVisible();

  // 2회: 새로 뽑힌 문제, 모두 맞히면 누적 7 + 10 = 17, 최고점 10/10
  await page.getByRole('button', { name: '새 문제로 다시 점검하기' }).click();
  await expect(page.getByText(/^1 \/ 10문항$/)).toBeVisible();
  const second: string[] = [];
  for (let i = 0; i < 10; i++) {
    second.push(await answerOne(page, u.advanced, false));
    if (i < 9) await page.getByRole('button', { name: '다음 문제' }).click();
  }
  expect(second.join('\n'), '두 번째 회차는 새로 뽑힌 문항(순서)').not.toBe(first.join('\n'));
  await page.getByRole('button', { name: '점검 마치고 결과 보기' }).click();
  await expect(res).toContainText('누적 점수 +10점');
  await expect(res.locator('.kpi').filter({ hasText: '누적 합계 점수' })).toContainText('17점');
  await expect(res.locator('.kpi').filter({ hasText: '최고점' })).toContainText('10/10');
  await expect(res).toContainText('최고점을 새로 세웠어요!');
  await expect(res).not.toContainText(/불합격|합격|통과|아쉬워요|마지막|평균/);
  await expect(page.locator('details.cg-review[open]')).toHaveCount(0);

  const s = await saved(page);
  expect(s.checks.U1).toMatchObject({ best: 10, sum: 17, n: 2 });
  expect(s.checks.U1.hist.map((h: { score: number }) => h.score)).toEqual([7, 10]);
  expect(s.units.U1.lv5.passedAt).toBeTruthy();
  expect(s.locks.U1).toHaveLength(1); // 새로고침 1회
  // 단원 목록·단원 화면: "최고 X/10 · 누적 Y점"(마지막 점수는 보이지 않음)
  await page.getByRole('link', { name: '단원 목록으로' }).click();
  await expect(page).toHaveURL(/#\/basics$/);
  await expect(page.locator('.cg-unit').first()).toContainText('실력점검 최고 10/10 · 누적 17점');
  await expect(page.locator('.cg-unit').first()).toContainText('레벨 5/5 · 모두 마침');
  await expect(page.locator('.cg-unit').nth(1)).toContainText('실력점검 아직 안 풀었어요');
  await expect(page.getByText(/통과한 단계 5 \/ 50/)).toBeVisible();
  await page.locator('.cg-unit').first().click();
  await startIfAsked(page);
  await expect(page.locator('main')).toContainText('실력점검 최고 10/10 · 누적 17점');
  await expect(page.locator('.cg-levels li').nth(4).locator('.badge')).toHaveText('최고 10/10 · 누적 17점');
});

test('1단원 5번째 잠김: 그 단원의 진도·실력점검 기록·풀던 실력점검만 지운다(다른 단원·오답노트는 그대로)', async ({ page }) => {
  const at = (i: number) => `2026-11-01T00:00:0${i}.000Z`;
  const check = (best: number) => ({ best, sum: best + 3, n: 2, hist: [{ at: at(1), score: 3 }, { at: at(2), score: best }] });
  await fresh(page, '/basics/unit/U1/5', {
    [STATE]: { ...READY, units: { ...READY.units, U10: { lv1: passed } }, checks: { U1: check(8), U10: check(6) }, locks: { U1: [at(1), at(2), at(3), at(4)] }, wrong: { 'U1-a1': { at: AT, n: 1 } } },
    'sqlforest:v1:guest:basic:run:U1:check': { ids: ['U1-a1'], idx: 0, answers: {}, orders: {} },
    'sqlforest:v1:guest:basic:run:U10:check': { ids: ['U10-a1'], idx: 0, answers: {}, orders: {} },
  });
  const overlay = page.getByTestId('focus-overlay');
  await expect(overlay).toContainText('지금까지 이 단원 잠김 4/5');
  await startIfAsked(page);
  await page.evaluate(() => { document.hasFocus = () => false; window.dispatchEvent(new Event('blur')); });
  await expect(overlay.getByRole('heading')).toHaveText('이 단원 기록이 처음으로 돌아갔어요');
  await expect(page).toHaveURL(/#\/basics\/unit\/U1\/1$/);
  const s = await saved(page);
  expect(s.checks.U1).toBeUndefined();
  expect(s.units.U1).toBeUndefined();
  expect(s.checks.U10).toMatchObject({ best: 6, n: 2 });
  expect(s.units.U10.lv1.passedAt).toBeTruthy();
  expect(Object.keys(s.wrong)).toEqual(['U1-a1']);
  const drafts = await page.evaluate(() => [localStorage.getItem('sqlforest:v1:guest:basic:run:U1:check'), localStorage.getItem('sqlforest:v1:guest:basic:run:U10:check')]);
  expect(drafts[0]).toBeNull();
  expect(drafts[1]).not.toBeNull();
});

test(`모의고사: ${MOCK_SIZE.foundation.total}문항 · ${MOCK_SIZE.foundation.minutes}분, 고정 1~3회`, async ({ page }) => {
  for (const n of DEF.units.map((x) => x.num)) expect(raw(n).theory.length, `basic/U${n}.json 내용이 아직 없음(다른 작업이 쓰는 중)`).toBeGreaterThan(0);
  const m = MOCK_SIZE.foundation;
  await fresh(page, '/basics/mock');
  const main = page.locator('main');
  await expect(main).toContainText(`사지선다 ${m.total}문항 · ${m.minutes}분 · ${m.need}문항 이상이면 합격 기준`);
  await expect(page.locator('.cg-mock-grid > .panel b')).toHaveText(['모의고사 1회', '모의고사 2회', '모의고사 3회', '랜덤 모의고사', '오답 모의고사']);
  await page.locator('.cg-mock-grid .panel', { hasText: '모의고사 1회' }).getByRole('link', { name: '시작' }).click();
  await expect(page.getByText(/남은 시간 (29|30):/)).toBeVisible();
  await expect(page.locator('.cg-qgrid button')).toHaveCount(m.total);
});

test('가로 스크롤 없음(1280px·390px): 첫 화면·기초 다듬기 홈·실력점검 화면', async ({ page }) => {
  for (const width of [1280, 390]) {
    await resize(page, width, 900);
    await fresh(page);
    await expect(page.locator('.subject-card')).toHaveCount(6);
    await page.waitForTimeout(150);
    expect(await overflowX(page), `첫 화면 ${width}px`).toBeLessThanOrEqual(1);
    await fresh(page, '/basics');
    await expect(page.locator('.cg-unit')).toHaveCount(10);
    await page.waitForTimeout(150);
    expect(await overflowX(page), `/basics ${width}px`).toBeLessThanOrEqual(1);
    await fresh(page, '/basics/unit/U1/5', { [STATE]: READY });
    await startIfAsked(page);
    await expect(page.locator('h2.cg-q')).toBeVisible();
    expect(await overflowX(page), `실력점검 ${width}px`).toBeLessThanOrEqual(1);
  }
});

test('스크린샷(첫 화면·기초 다듬기 홈·실력점검 결과): 1280px·390px', async ({ page }) => {
  const dir = process.env.BASICS_SHOTS;
  test.skip(!dir, 'BASICS_SHOTS=저장 폴더를 주면 스크린샷을 남긴다');
  const u = raw(1);
  for (const w of [1280, 390]) {
    await resize(page, w, w > 600 ? 900 : 844);
    await fresh(page);
    await expect(page.locator('.subject-card')).toHaveCount(6);
    await page.screenshot({ path: `${dir}/home-${w}.png`, fullPage: true });
    const check = { best: 9, sum: 25, n: 3, hist: [{ at: AT, score: 7 }, { at: '2026-11-02T00:00:00.000Z', score: 9 }, { at: '2026-11-03T00:00:00.000Z', score: 9 }] };
    await fresh(page, '/basics', { [STATE]: { ...READY, checks: { U1: check } } });
    await expect(page.locator('.cg-unit')).toHaveCount(10);
    await page.screenshot({ path: `${dir}/basics-${w}.png`, fullPage: true });
    await fresh(page, '/basics/unit/U1/5', { [STATE]: { ...READY, checks: { U1: check } } });
    await startIfAsked(page);
    for (let i = 0; i < Math.min(10, u.advanced.length); i++) {
      await answerOne(page, u.advanced, i % 4 === 1);
      if (await page.getByRole('button', { name: '다음 문제' }).isVisible()) await page.getByRole('button', { name: '다음 문제' }).click();
    }
    await page.getByRole('button', { name: '점검 마치고 결과 보기' }).click();
    await expect(page.getByTestId('selfcheck-result')).toBeVisible();
    await page.screenshot({ path: `${dir}/selfcheck-result-${w}.png`, fullPage: true });
    expect(await overflowX(page), `결과 ${w}px`).toBeLessThanOrEqual(1);
  }
});
