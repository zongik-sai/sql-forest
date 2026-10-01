import { expect, test, type Page } from '@playwright/test';
import { choose, expectSuccess, openWithState, pickPrediction, readXp, resumeIfPaused, stateWithUnits } from './helpers';

const upTo = (n: number) => Array.from({ length: n }, (_, i) => `U${String(i + 1).padStart(2, '0')}`);

async function open(page: Page, unitsDone: number, path: string) {
  await openWithState(page, stateWithUnits(upTo(unitsDone)), path);
  await resumeIfPaused(page);
}

test('sql-blocks: 블록 조립 후 실행', async ({ page }) => {
  await open(page, 2, '/learn/U03/U03-A01');
  await pickPrediction(page, '6행');
  for (const b of ['SELECT', 'student_name', ',', 'grade', 'FROM', 'students']) await page.getByRole('button', { name: `블록 ${b} 추가` }).click();
  await expect(page.locator('pre.codeblock')).toHaveText('SELECT student_name, grade FROM students');
  await page.getByRole('button', { name: '실행하고 채점' }).click();
  await expect(page.getByRole('table').filter({ hasText: '내 SQL 실행 결과' })).toContainText('가온');
  await expectSuccess(page, 'SELECT와 FROM으로 첫 조회를 실행했어요. +100XP');
});

test('predict-result: 실제 실행 후 해석 질문', async ({ page }) => {
  await open(page, 2, '/learn/U03/U03-A02');
  await pickPrediction(page, '3개');
  await page.getByRole('button', { name: '실행: 이 SQL' }).click();
  await expect(page.getByRole('columnheader', { name: 'next_grade' })).toBeVisible();
  await page.getByLabel('조회할 때 grade + 1로 계산해 이름을 붙인 열').check();
  await page.getByRole('button', { name: '답 제출' }).click();
  await expectSuccess(page, '+100XP');
});

test('classify(order): 논리적 처리 순서 카드 정렬', async ({ page }) => {
  await open(page, 2, '/learn/U03/U03-A04');
  const order: [string, string][] = [['FROM', '1번째'], ['WHERE', '2번째'], ['GROUP BY', '3번째'], ['HAVING', '4번째'], ['SELECT', '5번째'], ['ORDER BY', '6번째']];
  for (const [i, o] of order) await choose(page, i, o);
  await page.getByRole('button', { name: '배치 제출' }).click();
  await expectSuccess(page, '+100XP');
});

test('row-filter: 괄호 위치를 바꾸며 실제 결과 미리보기', async ({ page }) => {
  await open(page, 3, '/learn/U04/U04-A02');
  await pickPrediction(page, '4명');
  await expect(page.getByRole('table').filter({ hasText: '지금 조건의 실행 결과' })).toContainText('바다');
  await choose(page, '조건', '(dept_id = 10 OR dept_id = 20) AND grade = 3');
  await expect(page.getByRole('table').filter({ hasText: '지금 조건의 실행 결과' })).not.toContainText('바다');
  await page.getByRole('button', { name: '이 조건으로 제출' }).click();
  await expectSuccess(page, '괄호로 AND/OR 계산 순서를 바로잡았어요. +100XP');
});

test('erd: 관계 차수·선택성·식별 관계', async ({ page }) => {
  await open(page, 1, '/learn/U02/U02-A01');
  await choose(page, '학과 하나에 학생은 몇 명까지 연결될까요? (차수)', '1:N');
  await choose(page, '학생과 강좌의 관계 차수는? (수강 표를 빼고 생각)', 'M:N');
  await choose(page, '학생 쪽에서 수강 행이 없어도 될까요? (선택성)', '선택: 0개도 가능');
  await choose(page, '강좌-수강 관계는? (course_id가 수강의 기본키 일부)', '식별 관계');
  await choose(page, '학과-학생 관계는? (dept_id는 학생의 기본키가 아님)', '비식별 관계');
  await page.getByRole('button', { name: 'ERD 제출' }).click();
  await expectSuccess(page, '+100XP');
});

test('normalize: 열을 표로 나누고 다시 조인해 복원', async ({ page }) => {
  await open(page, 1, '/learn/U02/U02-A03');
  await pickPrediction(page, '2행');
  const m: [string, string][] = [['student_name', 'students(student_id, …)'], ['dept_id', 'students(student_id, …)'], ['dept_name', 'departments(dept_id, …)'], ['course_name', 'courses(course_id, …)'], ['score', 'enrollment(student_id, course_id, …)']];
  for (const [c, t] of m) await choose(page, c, t);
  await page.getByRole('button', { name: '표 나누기 제출' }).click();
  await expectSuccess(page, '+100XP');
  await page.getByRole('button', { name: '실행: 분해한 표 다시 조인' }).click();
  await expect(page.locator('.result-meta').last()).toContainText('6행');
});

test('join-visualizer: 같은 키 짝 직접 연결 → 실제 JOIN', async ({ page }) => {
  await open(page, 6, '/learn/U07/U07-A01');
  await pickPrediction(page, '나오지 않는다 — 짝이 되는 학생이 없어서');
  const students: [string, string][] = [['가온 · 10', '10 · AI컴퓨터'], ['나래 · 10', '10 · AI컴퓨터'], ['다온 · 20', '20 · AI로봇'], ['라온 · 20', '20 · AI로봇'], ['마루 · 30', '30 · AI콘텐츠디자인']];
  for (const [l, r] of students) {
    await page.getByRole('button', { name: l, exact: true }).click();
    await page.getByRole('button', { name: r, exact: true }).click();
  }
  await page.getByRole('button', { name: '연결 제출' }).click();
  await expect(page.locator('.feedback')).toContainText('아직 연결하지 않은 짝');
  await page.getByRole('button', { name: '바다 · 10', exact: true }).click();
  await page.getByRole('button', { name: '10 · AI컴퓨터', exact: true }).click();
  await page.getByRole('button', { name: '연결 제출' }).click();
  await expectSuccess(page, 'JOIN으로 두 표를 연결했어요. +100XP');
  await page.getByRole('button', { name: '실행: JOIN' }).click();
  await expect(page.locator('.result-meta').last()).toContainText('6행');
});

test('join-visualizer(LEFT): 짝 없는 행을 NULL로 남기기', async ({ page }) => {
  await open(page, 6, '/learn/U07/U07-A02');
  await pickPrediction(page, '8행');
  const pairs: [string, string | null][] = [['1 · 가온', '1 · 101 · 90'], ['1 · 가온', '1 · 102 · 80'], ['2 · 나래', '2 · 101 · 90'], ['3 · 다온', '3 · 101 · NULL'], ['3 · 다온', '3 · 102 · 70'], ['4 · 라온', null], ['5 · 마루', null], ['6 · 바다', '6 · 102 · 80']];
  for (const [l, r] of pairs) {
    const lb = page.getByRole('button', { name: l, exact: true });
    if ((await lb.getAttribute('aria-pressed')) !== 'true') await lb.click();
    if (r) await page.getByRole('button', { name: r, exact: true }).click();
    else await page.getByRole('button', { name: '선택한 행을 NULL로 남기기' }).click();
    await lb.click();
  }
  await page.getByRole('button', { name: '연결 제출' }).click();
  await expectSuccess(page, 'LEFT JOIN으로 짝 없는 학생까지 남겼어요. +100XP');
});

test('group-visualizer: 행을 상자에 넣고 COUNT 계산', async ({ page }) => {
  await open(page, 5, '/learn/U06/U06-A01');
  await pickPrediction(page, '2행');
  const selects = page.getByRole('combobox');
  const groups = ['SQL캠프', 'IoT캠프', 'SQL캠프', 'SQL캠프', 'IoT캠프', 'IoT캠프'];
  for (let i = 0; i < groups.length; i++) await selects.nth(i).selectOption(groups[i]);
  await page.getByLabel('SQL캠프의 COUNT(*)').fill('3');
  await page.getByLabel('IoT캠프의 COUNT(*)').fill('2');
  await page.getByRole('button', { name: '그룹 제출' }).click();
  await expect(page.locator('.feedback')).toContainText("'IoT캠프' 상자의 COUNT(*) 값을 다시 세어 보세요");
  await page.getByLabel('IoT캠프의 COUNT(*)').fill('3');
  await page.getByRole('button', { name: '그룹 제출' }).click();
  await expectSuccess(page, '행을 그룹으로 묶고 개수를 셌어요. +100XP');
});

test('window-visualizer: RANK·DENSE_RANK 직접 매기기', async ({ page }) => {
  await open(page, 8, '/learn/U09/U09-A01');
  await pickPrediction(page, '5');
  const vals = ['1', '1', '1', '1', '3', '2', '3', '2', '5', '3'];
  const inputs = page.locator('table input[type=number]');
  for (let i = 0; i < vals.length; i++) await inputs.nth(i).fill(vals[i]);
  await page.getByRole('button', { name: '순위 제출' }).click();
  await expectSuccess(page, 'RANK와 DENSE_RANK로 동점 순위를 매겼어요. +100XP');
});

test('hierarchy: 트리에서 하위 노드 선택(재귀 CTE로 정답 계산)', async ({ page }) => {
  await open(page, 9, '/learn/U10/U10-A02');
  await pickPrediction(page, '2개');
  for (const n of ['SQL동아리', '로봇동아리', 'SQL스터디A']) await page.getByRole('checkbox', { name: new RegExp(`^${n} `) }).check();
  await page.getByRole('button', { name: '선택 제출' }).click();
  await expect(page.locator('.feedback')).toContainText('빠진 동아리');
  await page.getByRole('checkbox', { name: /^SQL스터디B / }).check();
  await page.getByRole('button', { name: '선택 제출' }).click();
  await expectSuccess(page, '+100XP');
  await expect(page.getByText('SQLite에서 실행 안 됨').first()).toBeVisible();
});

test('pivot: 교차표 채우기(빈 칸 = NULL)', async ({ page }) => {
  await open(page, 9, '/learn/U10/U10-A03');
  const cells: [string, string][] = [['AI로봇 3월', '5'], ['AI로봇 4월', '9'], ['AI컴퓨터 3월', '12'], ['AI컴퓨터 4월', '8'], ['AI콘텐츠디자인 4월', '4']];
  for (const [l, v] of cells) await page.getByLabel(l, { exact: true }).fill(v);
  await page.getByLabel('AI콘텐츠디자인 3월', { exact: true }).fill('0');
  await page.getByRole('button', { name: '교차표 제출' }).click();
  await expect(page.locator('.feedback')).toContainText('비워 둬요(NULL)');
  await page.getByLabel('AI콘텐츠디자인 3월', { exact: true }).fill('');
  await page.getByRole('button', { name: '교차표 제출' }).click();
  await expectSuccess(page, '+100XP');
});

test('transaction: 잘못 확정 → 처음 상태로 → ROLLBACK TO + COMMIT', async ({ page }) => {
  await open(page, 10, '/learn/U11/U11-A02');
  await pickPrediction(page, '함께 취소된다');
  await expect(page.getByText('열려 있음(아직 확정 안 됨)')).toBeVisible();
  await page.getByRole('button', { name: 'COMMIT', exact: true }).click();
  await expect(page.getByText('닫혀 있음')).toBeVisible();
  await page.getByRole('button', { name: '이 상태로 제출' }).click();
  await expect(page.locator('.feedback')).toContainText('표 상태가 목표와 달라요');
  await page.getByRole('button', { name: '처음 상태로' }).click();
  await page.getByRole('button', { name: 'ROLLBACK TO sp1' }).click();
  await page.getByRole('button', { name: 'COMMIT', exact: true }).click();
  await page.getByRole('button', { name: '이 상태로 제출' }).click();
  await expectSuccess(page, 'SAVEPOINT로 원하는 변경만 확정했어요. +100XP');
});

test('도전 모드: 설명·힌트 숨김 → 해결 시 XP 없이 숙련 기록', async ({ page }) => {
  await open(page, 2, '/challenge/CH-U03');
  await expect(page.getByRole('button', { name: /힌트 1 보기/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '기본 모드로 배우기' })).toBeVisible();
  await page.getByLabel(/SQL 편집기/).fill('SELECT DISTINCT dept_id FROM students ORDER BY dept_id DESC;');
  await page.getByRole('button', { name: '실행하고 채점' }).click();
  await expectSuccess(page, '도전 기록에 남겼어요(경험치 없음');
  await page.getByRole('link', { name: '나의 정원' }).first().click();
  // U01·U02 완료 상태의 XP(1300)에서 변하지 않음
  expect(await readXp(page)).toBe(1300);
});
