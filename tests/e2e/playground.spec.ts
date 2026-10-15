import { expect, test, type Page } from '@playwright/test';
import { openWithState, stateWithUnits } from './helpers';

/**
 * 자유 실습장(#/playground, 로그인 없이): 예시 데이터 불러오기, ERD, 직접 표 만들기, 좁은 화면 배치.
 * SQL은 브라우저 Worker(sql.js)에서 실제로 실행된다.
 */

const editor = (page: Page) => page.getByLabel('SQL', { exact: true });
const runBtn = (page: Page) => page.getByRole('button', { name: /실행/ });
const pick = (page: Page) => page.getByLabel('예시 데이터 불러오기');

async function runSql(page: Page, sql: string) {
  await editor(page).fill(sql);
  await runBtn(page).click();
}

async function noPageOverflow(page: Page) {
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(extra).toBeLessThanOrEqual(0);
}

test('예시 데이터(학생-성적)를 불러와 JOIN 실행 → 결과 표', async ({ page }) => {
  await page.goto('./#/playground');
  await pick(page).selectOption({ label: '학생-성적' });
  await expect(page.getByRole('heading', { name: '학생-성적' })).toBeVisible();
  await expect(page.getByText(/한 학생이 여러 과목 점수를 가지는/)).toBeVisible();
  // 첫 시작 SQL(JOIN)이 편집기에 들어간다
  await expect(editor(page)).toHaveValue(/JOIN students s ON/);
  await runBtn(page).click();
  await expect(page.getByRole('columnheader', { name: '과목' })).toBeVisible();
  await expect(page.getByRole('row', { name: '김가온 수학 92' })).toBeVisible();
  await expect(page.locator('.pg-output .result-meta')).toHaveText('12행');
  // 다른 시작 SQL 버튼
  await page.getByRole('button', { name: '과목별 평균 점수 (GROUP BY)' }).click();
  await expect(editor(page)).toHaveValue(/GROUP BY j.subject_id/);
  await runBtn(page).click();
  await expect(page.getByRole('row', { name: /^과학 0/ })).toBeVisible();
});

test('ERD: 표 상자·관계 선·글 요약, 실행할 때마다 다시 그림', async ({ page }) => {
  await page.goto('./#/playground');
  await pick(page).selectOption({ label: '학생-성적' });
  const erd = page.getByTestId('erd');
  await expect(erd.locator('[data-erd-table]')).toHaveCount(3);
  await expect(erd.locator('[data-erd-table="scores"]')).toContainText('subject_id');
  await expect(erd.locator('.erd-edge[data-erd-from="scores"][data-erd-to="students"]')).toHaveCount(1);
  await expect(erd.locator('.erd-edge[data-erd-from="scores"][data-erd-to="subjects"]')).toHaveCount(1);
  await expect(erd.getByRole('img', { name: '학생-성적 ERD: 표 3개, 관계 선 2개' })).toBeVisible();
  await erd.getByText('ERD를 글로 보기').click();
  await expect(erd).toContainText('scores.student_id → students.student_id: students 한 행에 scores 여러 행이 연결돼요(1:N).');

  // DDL을 실행하면 바로 다시 그려진다
  await runSql(page, 'CREATE TABLE homerooms (room_id INTEGER PRIMARY KEY, leader_id INTEGER REFERENCES students(student_id));');
  await expect(page.getByText('실행 완료')).toBeVisible();
  await expect(erd.locator('[data-erd-table]')).toHaveCount(4);
  await expect(erd.locator('.erd-edge[data-erd-from="homerooms"][data-erd-to="students"]')).toHaveCount(1);
  await expect(page.getByRole('list', { name: '스키마' })).toContainText('homerooms');
  await runSql(page, 'DROP TABLE homerooms;');
  await expect(erd.locator('[data-erd-table]')).toHaveCount(3);

  // 학습 데이터셋도 그린다(자기 참조 포함)
  await pick(page).selectOption({ label: '동아리 조직도' });
  await page.getByRole('button', { name: '바꾸기', exact: true }).click();
  await expect(erd.locator('[data-erd-table="clubs_tree"]')).toBeVisible();
  await expect(erd.locator('.erd-edge[data-erd-from="clubs_tree"][data-erd-to="clubs_tree"]')).toHaveCount(1);
});

test('직접 표 만들기: 양식 → 미리보기 → 실행 → 스키마·ERD에 나타남', async ({ page }) => {
  await page.goto('./#/playground');
  await pick(page).selectOption({ label: '학생-성적' });
  await page.getByRole('tab', { name: '직접 표 만들기' }).click();
  const builder = page.locator('.pg-builder');

  await page.getByLabel('표 이름', { exact: true }).fill('상담 기록');
  await page.getByLabel('2번 열 이름', { exact: true }).fill('메모');
  await page.getByRole('button', { name: '열 추가' }).click();
  await page.getByLabel('3번 열 이름', { exact: true }).fill('student_id');
  await page.getByLabel('3번 열 외래키(FK)로 가리킬 열').selectOption({ label: 'FK → students.student_id' });
  await expect(page.getByLabel('3번 열 자료형')).toHaveValue('INTEGER');
  await page.getByLabel('1행 번호', { exact: true }).fill('1');
  await page.getByLabel('1행 메모', { exact: true }).fill("진로 상담 ('대학')");
  await page.getByLabel('1행 student_id', { exact: true }).fill('2');
  await page.getByRole('button', { name: '행 추가' }).click();
  await page.getByLabel('2행 번호', { exact: true }).fill('2');
  await page.getByLabel('2행 student_id', { exact: true }).fill('3');

  const preview = builder.locator('pre.pg-preview');
  await expect(preview).toContainText('"student_id" INTEGER REFERENCES "students" ("student_id")');
  await expect(preview).toContainText("(1, '진로 상담 (''대학'')', 2)");

  // 띄어쓰기가 있는 이름은 친절하게 거절
  await page.getByRole('button', { name: '이 표 만들기' }).click();
  await expect(builder.getByRole('alert')).toContainText('밑줄');
  await expect(page.getByRole('list', { name: '스키마' })).not.toContainText('상담');

  await page.getByLabel('표 이름', { exact: true }).fill('상담_기록');
  await page.getByRole('button', { name: '이 표 만들기' }).click();
  await expect(page.getByText("'상담_기록' 표를 만들었어요. 행 2개를 넣었어요.")).toBeVisible();
  await expect(page.getByRole('list', { name: '스키마' })).toContainText('상담_기록');
  // 양식은 비워진다
  await expect(page.getByLabel('표 이름', { exact: true })).toHaveValue('');

  await page.getByRole('tab', { name: 'ERD 보기' }).click();
  const erd = page.getByTestId('erd');
  await expect(erd.locator('[data-erd-table="상담_기록"]')).toBeVisible();
  await expect(erd.locator('.erd-edge[data-erd-from="상담_기록"][data-erd-to="students"]')).toHaveCount(1);

  await runSql(page, 'SELECT c.메모, s.name FROM 상담_기록 c JOIN students s ON s.student_id = c.student_id ORDER BY c.번호;');
  await expect(page.getByRole('row', { name: "진로 상담 ('대학') 이나래" })).toBeVisible();
});

test('데이터를 바꾼 뒤 다른 예시를 고르면 확인을 받는다', async ({ page }) => {
  await page.goto('./#/playground');
  await runSql(page, "INSERT INTO students VALUES (7, '새싹', 10, 1);");
  await expect(page.getByText(/영향받은 행 1개/)).toBeVisible();
  await pick(page).selectOption({ label: '도서 대출' });
  const confirm = page.getByRole('alert').filter({ hasText: '바꿀까요?' });
  await expect(confirm).toContainText("지금까지 바꾼 내용(1번 실행)이 사라지고 '도서 대출' 데이터로 바뀌어요.");
  await confirm.getByRole('button', { name: '취소' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(pick(page)).toHaveValue('school');
  await runSql(page, 'SELECT COUNT(*) AS n FROM students;');
  await expect(page.getByRole('cell', { name: '7', exact: true })).toBeVisible();

  await pick(page).selectOption({ label: '도서 대출' });
  await page.getByRole('button', { name: '바꾸기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '도서 대출' })).toBeVisible();
  await expect(page.getByRole('list', { name: '스키마' })).toContainText('loans');
  await runBtn(page).click();
  await expect(page.getByRole('columnheader', { name: '반납_예정일' })).toBeVisible();
});

test('390px 휴대폰: 가로 스크롤 없음, 넓은 ERD·표는 자기 상자 안에서 스크롤', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#/playground');
  await pick(page).selectOption({ label: '교사-수업-과목-학생' });
  await page.getByRole('button', { name: '학생별로 듣는 수업 (JOIN 4개 표)' }).click();
  await runBtn(page).click();
  await expect(page.getByRole('columnheader', { name: '선생님' })).toBeVisible();
  await expect(page.getByTestId('erd').locator('[data-erd-table]')).toHaveCount(5);
  await noPageOverflow(page);
  const scroller = page.locator('.erd-scroll');
  expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  const box = await scroller.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  const table = await page.locator('.pg-output .table-wrap').boundingBox();
  expect(table!.x + table!.width).toBeLessThanOrEqual(390);
  // 표 만들기 양식도 넘치지 않는다
  await page.getByRole('tab', { name: '직접 표 만들기' }).click();
  await page.getByRole('button', { name: '열 추가' }).click();
  await page.getByRole('button', { name: '열 추가' }).click();
  await noPageOverflow(page);

  // 로그인(데모) 상태의 #/practice도 같은 화면
  await openWithState(page, stateWithUnits([]), '/practice');
  await expect(page.getByRole('heading', { name: '자유 실습장' })).toBeVisible();
  await expect(page.getByTestId('erd').locator('[data-erd-table]')).toHaveCount(4);
  await noPageOverflow(page);
});

test('1280px 데스크톱: 스키마가 편집기를 가리지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('./#/playground');
  await expect(page.getByRole('list', { name: '스키마' })).toContainText('enrollment');
  const side = (await page.locator('.pg-side').boundingBox())!;
  const ed = (await editor(page).boundingBox())!;
  expect(side.x + side.width).toBeLessThanOrEqual(ed.x);
  // 스키마 내용은 왼쪽 칸 안에 있다
  const list = (await page.getByRole('list', { name: '스키마' }).boundingBox())!;
  expect(list.x + list.width).toBeLessThanOrEqual(side.x + side.width);
  await noPageOverflow(page);
});

test('기본 흐름(운영 빌드 검사와 같은 조작): 조회 → 삭제 → 초기화', async ({ page }) => {
  await page.goto('./#/playground');
  await runSql(page, 'SELECT COUNT(*) AS n FROM students;');
  await expect(page.getByRole('cell', { name: '6' })).toBeVisible();
  await runSql(page, 'DELETE FROM enrollment;');
  await expect(page.getByText(/영향받은 행 6개/)).toBeVisible();
  await page.getByRole('button', { name: '데이터 초기화' }).click();
  await runSql(page, 'SELECT COUNT(*) FROM enrollment;');
  await expect(page.getByRole('cell', { name: '6' })).toBeVisible();
});
