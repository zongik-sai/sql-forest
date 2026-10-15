import { expect, test, type Page } from '@playwright/test';
import { CG_UNITS } from '../../src/features/computer/content';
import { buildMock } from '../../src/features/computer/mock';

/**
 * 과목 선택 → 컴퓨터 일반(로그인 없이 둘러보기: 이 기기에만 저장) 흐름.
 * 정답은 문제은행 데이터에서 읽어 실제 화면 조작으로 푼다.
 */
const U1 = CG_UNITS[0];
const GUEST_STATE = 'sqlforest:v1:guest:cg:state';

/** 단원 화면의 집중 학습 시작 화면에서 시작을 누른다(전체화면 전환 직후 유예 1.5초를 기다림) */
async function startUnit(page: Page) {
  const overlay = page.getByTestId('focus-overlay');
  await expect(overlay).toBeVisible();
  await overlay.getByRole('button', { name: /학습 시작$|다시 시작$/ }).click();
  await expect(overlay).toHaveCount(0);
  await page.waitForTimeout(1600);
}
async function leaveAndReturn(page: Page) {
  await page.evaluate(() => { document.hasFocus = () => false; window.dispatchEvent(new Event('blur')); });
  await expect(page.getByTestId('focus-overlay')).toBeVisible();
  await page.evaluate(() => { document.hasFocus = () => true; window.dispatchEvent(new Event('focus')); });
}

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
  expect(main).not.toMatch(/SQLD|PC정비사|정보처리기사/);
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

test('이론·개념 맞추기 → 전체 끼워맞추기 → 기초 객관식: 통과 기준·잠금·식물 성장·오답노트', async ({ page }) => {
  await fresh(page, `/computer/unit/${U1.id}`);
  // 단원은 전체화면 집중 학습: 시작 화면에서 규칙(5번 잠기면 초기화)을 보여 주고 클릭으로 시작
  await expect(page.getByTestId('focus-overlay')).toContainText('5번');
  await startUnit(page);
  // 2단계는 잠김 → "그래도 풀어보기" 가능
  await page.goto(`./#/computer/unit/${U1.id}/2`);
  await expect(page.getByText('앞 단계 1단계 이론·개념 맞추기를 통과하면 열려요.')).toBeVisible();
  await expect(page.getByRole('button', { name: '그래도 풀어보기' })).toBeVisible();
  await page.goto(`./#/computer/unit/${U1.id}/3`);
  await expect(page.getByText('앞 단계 2단계 전체 개념 끼워맞추기를 통과하면 열려요.')).toBeVisible();
  await page.goto(`./#/computer/unit/${U1.id}/4`);
  await expect(page.getByText('앞 단계 3단계 기초 객관식을 통과하면 열려요.')).toBeVisible();

  // 1단계: 카드 한 장씩 읽고 → 개념 맞추기(모두 맞혀야 다음 카드)
  await page.goto(`./#/computer/unit/${U1.id}/1`);
  await expect(page.locator('.cg-card-dot')).toHaveCount(U1.cards.length);
  await expect(page.getByText(`맞춘 카드 0/${U1.cards.length}`)).toBeVisible();
  await expect(page.locator('.cg-card')).toHaveCount(1);
  await expect(page.locator('.cg-card h2')).toContainText(U1.cards[0].title);
  const row = (desc: string) => page.locator('.cg-match-rows li').filter({ has: page.locator('.cg-match-desc', { hasText: desc }) });
  const chip = (desc: string, term: string) => row(desc).getByRole('button', { name: term, exact: true });

  // 첫 카드: 같은 용어는 한 뜻에만(옮겨짐) · 하나 틀리면 그 줄만 다시
  const m0 = U1.cards[0].match!;
  await page.getByRole('button', { name: '다 읽었어요 → 개념 맞추기' }).click();
  await expect(page.locator('.cg-match-rows li')).toHaveCount(3);
  await expect(row(m0.pairs[0].desc).getByRole('button')).toHaveCount(4);
  await chip(m0.pairs[0].desc, m0.pairs[1].term).click();
  await chip(m0.pairs[1].desc, m0.pairs[1].term).click();
  await expect(chip(m0.pairs[0].desc, m0.pairs[1].term)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: '확인' })).toBeDisabled();
  await chip(m0.pairs[0].desc, m0.distractor).click();
  await chip(m0.pairs[2].desc, m0.pairs[2].term).click();
  await page.getByRole('button', { name: '확인' }).click();
  await expect(row(m0.pairs[0].desc)).toHaveClass(/bad/);
  await expect(row(m0.pairs[1].desc)).toHaveClass(/ok/);
  await expect(page.getByText('1개가 틀렸어요.')).toBeVisible();
  await expect(page.getByText(/번 카드 완료/)).toHaveCount(0);
  await chip(m0.pairs[0].desc, m0.pairs[0].term).click();
  await page.getByRole('button', { name: '확인' }).click();
  await expect(page.getByText(`1번 카드 완료! (1/${U1.cards.length})`)).toBeVisible();

  // 나머지 카드
  for (let i = 1; i < U1.cards.length; i++) {
    await page.getByRole('button', { name: '다음 카드 →' }).click();
    await expect(page.locator('.cg-card h2')).toContainText(U1.cards[i].title);
    await page.getByRole('button', { name: '다 읽었어요 → 개념 맞추기' }).click();
    for (const p of U1.cards[i].match!.pairs) await chip(p.desc, p.term).click();
    await page.getByRole('button', { name: '확인' }).click();
    if (i < U1.cards.length - 1) await expect(page.getByText(`${i + 1}번 카드 완료! (${i + 1}/${U1.cards.length})`)).toBeVisible();
  }
  await expect(page.getByRole('dialog', { name: '식물이 자랐어요' })).toContainText('새싹');
  await page.getByRole('button', { name: '닫기' }).click();
  await expect(page.getByText(`카드 ${U1.cards.length}장을 모두 마쳤어요. 1단계 통과!`)).toBeVisible();
  await expect(page.getByText(`맞춘 카드 ${U1.cards.length}/${U1.cards.length}`)).toBeVisible();

  // 2단계 끼워맞추기: 빈칸을 누르고 예시답안을 고른다. 기준 미만 → 정답·해설 공개 → 다시 풀어 통과
  await page.getByRole('button', { name: /다음 단계: 전체 개념 끼워맞추기/ }).first().click();
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
  expect(Object.keys(saved.cards).sort()).toEqual(U1.cards.map((c) => c.id).sort());
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
  await expect(page.getByRole('heading', { name: '틀린 문항 19개 (푼 문항은 오답노트에 저장됨)' })).toBeVisible();
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
  // 하나도 안 푼 시험은 기록·오답노트에 남기지 않는다
  await expect(page.getByText('답한 문항이 없어 기록에 남기지 않았어요.')).toBeVisible();
  await page.getByRole('link', { name: '모의고사 목록' }).click();
  await expect(page.getByText('아직 기록이 없어요.')).toBeVisible();
  await expect(page.locator('.topbar')).toContainText('오답노트');
  await expect(page.locator('.topbar nav')).not.toContainText(/오답노트 \d/);
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

test('단원 집중 학습: 시작 화면 → 전체화면 → 포커스 잃으면 잠김(n/5) → 쉬기는 세지 않음 → 5번째에 그 단원만 초기화', async ({ page }) => {
  // U1·U2를 공부한 기록 + 오답노트 1문항
  await page.goto('./');
  await page.evaluate((k) => {
    localStorage.clear();
    const at = '2026-10-15T00:00:00.000Z';
    localStorage.setItem(k, JSON.stringify({
      v: 1, upd: at, mock: [], locks: {}, resets: {},
      units: { U1: { lv1: { best: 14, total: 14, passedAt: at, lastAt: at }, lv2: { best: 26, total: 30, passedAt: at, lastAt: at } }, U2: { lv1: { passedAt: at, lastAt: at } } },
      cards: { 'U1-t1': at, 'U1-t2': at, 'U2-t1': at },
      wrong: { 'U1-b1': { at, n: 1 } },
    }));
  }, GUEST_STATE);
  await page.goto('about:blank');
  await page.goto(`./#/computer/unit/${U1.id}/2`);
  const overlay = page.getByTestId('focus-overlay');
  await expect(overlay.getByRole('heading')).toHaveText('1단원 집중 학습');
  await expect(overlay).toContainText('지금까지 이 단원 잠김 0/5');
  // 시작 화면에서는 아직 세지 않는다
  await page.evaluate(() => { document.hasFocus = () => false; window.dispatchEvent(new Event('blur')); });
  await page.evaluate(() => { document.hasFocus = () => true; window.dispatchEvent(new Event('focus')); });
  await expect(overlay).toContainText('0/5');
  await startUnit(page);
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await expect(page.locator('.strict-bar')).toContainText('1단원 잠김 0/5');

  // 1번째: 다른 창으로 → 잠김 1/5, 같은 이탈의 연속 이벤트(blur 뒤 hidden)는 한 번만
  await page.evaluate(() => {
    document.hasFocus = () => false;
    window.dispatchEvent(new Event('blur'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(overlay.getByRole('heading')).toHaveText('화면이 잠겼어요 (1/5)');
  await expect(page.locator('[data-focus-status]')).toHaveAttribute('inert', '');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.hasFocus = () => true;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await startUnit(page);
  await expect(page.locator('.strict-bar')).toContainText('1/5');

  // 2번째: 전체화면 나가기(Esc와 같음)
  await page.evaluate(() => document.exitFullscreen());
  await expect(overlay.getByRole('heading')).toHaveText('화면이 잠겼어요 (2/5)');
  await startUnit(page);

  // 쉬기는 세지 않는다
  await page.locator('.strict-bar').getByRole('button', { name: '쉬기' }).click();
  await expect(overlay.getByRole('heading')).toHaveText('쉬는 중이에요');
  await page.evaluate(() => { document.hasFocus = () => false; window.dispatchEvent(new Event('blur')); });
  await page.evaluate(() => { document.hasFocus = () => true; window.dispatchEvent(new Event('focus')); });
  await startUnit(page);
  await expect(page.locator('.strict-bar')).toContainText('2/5');

  // 3·4번째(4번째는 마지막 경고)
  await leaveAndReturn(page);
  await startUnit(page);
  await leaveAndReturn(page);
  await expect(overlay.getByRole('heading')).toHaveText('화면이 잠겼어요 (4/5)');
  await expect(overlay).toContainText('마지막 경고');
  await startUnit(page);

  // 5번째 → 1단원 진도·점수 초기화, 1단계로 이동. 2단원·오답노트는 그대로
  await leaveAndReturn(page);
  await expect(overlay.getByRole('heading')).toHaveText('이 단원 기록이 처음으로 돌아갔어요');
  await expect(page).toHaveURL(new RegExp(`#/computer/unit/${U1.id}/1$`));
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), GUEST_STATE);
  expect(saved.units.U1).toBeUndefined();
  expect(Object.keys(saved.cards)).toEqual(['U2-t1']);
  expect(saved.units.U2.lv1.passedAt).toBeTruthy();
  expect(Object.keys(saved.wrong)).toEqual(['U1-b1']);
  expect(saved.resets.U1.n).toBe(1);
  await startUnit(page);
  await expect(page.locator('.strict-bar')).toContainText('0/5');
  await expect(page.getByText(`맞춘 카드 0/${U1.cards.length}`)).toBeVisible();

  // 단원 밖(모의고사)으로 나가면 전체화면이 끝나고, 세지 않는다
  await page.locator('.topbar').getByRole('link', { name: '모의고사' }).click();
  await expect(page).toHaveURL(/#\/computer\/mock$/);
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await expect(page.getByTestId('focus-overlay')).toHaveCount(0);
  const after = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), GUEST_STATE);
  expect(after.locks.U1 ?? []).toHaveLength(0);
});
