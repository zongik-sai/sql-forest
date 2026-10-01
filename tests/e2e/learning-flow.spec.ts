import { expect, test } from '@playwright/test';
import { choose, expectSuccess, openWithState, pickPrediction, readXp, resumeIfPaused } from './helpers';

test('데모: 시작 → 최초 진단 건너뛰기 → U01 활동 4개(실제 조작) → 체크포인트 → U02 해제, 650XP/Lv6', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: '개발 데모로 시작' }).click();
  await expect(page.getByRole('heading', { name: '최초 진단 (5문항)' })).toBeVisible();
  await page.getByRole('button', { name: '처음부터 배우기' }).click();

  // U01-A01 분류
  await expect(page.getByRole('heading', { name: '엔터티·속성·값 나누기' })).toBeVisible();
  await pickPrediction(page, '열(세로 한 줄)');
  const a1: [string, string][] = [['학생', '엔터티'], ['학번', '속성'], ["'가온'", '속성값'], ['강좌', '엔터티'], ['강좌명', '속성'], ["'SQL캠프'", '속성값'], ['학과', '엔터티'], ['학년', '속성'], ['3', '속성값']];
  // 일부러 하나 틀리게 제출 → 오답 피드백(감점 없음)
  for (const [i, o] of a1) await choose(page, i, i === '학년' ? '속성값' : o);
  await page.getByRole('button', { name: '배치 제출' }).click();
  await expect(page.locator('.feedback')).toContainText('9개 중 1개가 달라요');
  await choose(page, '학년', '속성');
  await page.getByRole('button', { name: '배치 제출' }).click();
  await expectSuccess(page, '엔터티·속성·값을 구분했어요. +100XP');
  await page.getByRole('button', { name: '다음 활동' }).click();

  // U01-A02 행·열 선택(실제 SQL 실행)
  await pickPrediction(page, '6개');
  await choose(page, '열(속성)', 'grade (학년)');
  await choose(page, '행(인스턴스)', 'student_id = 3');
  await expect(page.locator('pre.codeblock').first()).toContainText('SELECT grade FROM students WHERE student_id = 3');
  await page.getByRole('button', { name: '이 조건으로 제출' }).click();
  await expectSuccess(page, '+100XP');
  await page.getByRole('button', { name: '다음 활동' }).click();

  // U01-A03 모델 단계 연결 — 힌트 3개를 모두 써도 XP 동일
  for (let i = 1; i <= 3; i++) await page.getByRole('button', { name: `힌트 ${i} 보기` }).click();
  await expect(page.getByRole('list', { name: '힌트' }).locator('li')).toHaveCount(3);
  const a3: [string, string][] = [
    ['담당 선생님과 이야기하며 학생·강좌·학과가 필요하다고 정리', '개념 모델'],
    ['학생이 여러 강좌를 수강한다는 핵심 규칙을 그림으로 표현', '개념 모델'],
    ['수강(학생ID, 강좌ID, 점수)에서 (학생ID, 강좌ID)를 주식별자로 결정', '논리 모델'],
    ['반복되는 학과명을 별도 엔터티로 분리(정규화)', '논리 모델'],
    ['student_id는 INTEGER, student_name은 TEXT로 데이터 타입 결정', '물리 모델'],
    ['CREATE TABLE enrollment(...) 문장으로 실제 테이블 생성', '물리 모델'],
  ];
  for (const [i, o] of a3) await choose(page, i, o);
  await page.getByRole('button', { name: '배치 제출' }).click();
  await expectSuccess(page, '모델링 3단계를 연결했어요. +100XP');
  await page.getByRole('button', { name: '다음 활동' }).click();

  // U01-A04 SQL 편집기(INSERT, 결과 기반 상태 채점) — 먼저 원래 SQL을 실행해 오류 확인
  await pickPrediction(page, '제약조건 오류로 저장되지 않는다');
  await page.getByRole('button', { name: '실행하고 채점' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '실행 오류' })).toBeVisible();
  await page.getByLabel(/SQL 편집기/).fill("INSERT INTO students VALUES (9, '사랑', 20, 1);");
  await page.getByRole('button', { name: '실행하고 채점' }).click();
  await expectSuccess(page, '+100XP');
  await page.getByRole('button', { name: '체크포인트로' }).click();

  // 체크포인트: 1문항은 오답 → 개념 복습 → 변형 문항으로 재도전
  const slot = (n: number) => page.locator('section.panel').filter({ has: page.getByRole('heading', { name: new RegExp(`^문항 ${n}`) }) });
  await slot(1).getByLabel('추상화').check();
  await slot(1).getByRole('button', { name: '제출' }).click();
  await expect(slot(1)).toContainText('짧은 개념 복습');
  await slot(1).getByRole('button', { name: '다시 도전 (비슷한 문항)' }).click();
  await expect(slot(1)).toContainText('재도전 문항');
  await slot(1).getByLabel('명확화').check();
  await slot(1).getByRole('button', { name: '제출' }).click();
  await expect(slot(1)).toContainText('+50XP');
  await slot(2).getByLabel('인스턴스').check();
  await slot(2).getByRole('button', { name: '제출' }).click();
  await expect(slot(2)).toContainText('+150XP'); // 2/3 해결 → 문항 50 + 단원 완료 100
  await slot(3).getByLabel('물리 모델').check();
  await slot(3).getByRole('button', { name: '제출' }).click();
  await expect(slot(3)).toContainText('+50XP');
  await expect(page.getByRole('link', { name: '다음 단원 U02' })).toBeVisible();

  // 축하 카드(단원 완료)·레벨업 토스트
  await expect(page.getByRole('dialog', { name: '단원 완료' })).toBeVisible();

  await page.getByRole('link', { name: '나의 정원' }).first().click();
  expect(await readXp(page)).toBe(650);
  await expect(page.locator('.level-num')).toHaveText('Lv6');
  await expect(page.getByRole('link', { name: /관계·식별자·정규화.*시작 가능/ })).toBeVisible();
  await expect(page.locator('.stop.locked').first()).toContainText('SELECT 첫 실행');
});

test('초안 저장 → 새로고침 → 단계·초안 복구, 사용자 클릭으로 재개', async ({ page }) => {
  await openWithState(page, null, '/learn/U01/U01-A04');
  await resumeIfPaused(page);
  await pickPrediction(page, '그대로 저장된다');
  await page.getByLabel(/SQL 편집기/).fill("INSERT INTO students VALUES (9, '임시초안'");
  await page.waitForTimeout(300);
  await page.reload();
  // 새로고침 후에는 자동 시작하지 않는다
  await expect(page.getByTestId('focus-overlay')).toBeVisible();
  await expect(page.getByTestId('focus-overlay')).toContainText('저장된 단계와 초안을 불러왔어요');
  await page.getByRole('button', { name: '학습 계속하기' }).click();
  await expect(page.getByLabel(/SQL 편집기/)).toHaveValue("INSERT INTO students VALUES (9, '임시초안'");
  // 예측 제출 상태도 복구
  await expect(page.locator('text=예측과 달라요')).toBeVisible();
});

test('정답 보기 후에는 직접 다시 수행 + 결과 확인을 해야 안내 학습 완료로 XP 지급', async ({ page }) => {
  await openWithState(page, null, '/learn/U01/U01-A04');
  await resumeIfPaused(page);
  await pickPrediction(page, '제약조건 오류로 저장되지 않는다');
  await page.getByRole('button', { name: '정답 보기' }).click();
  await page.getByRole('button', { name: '정답 보기' }).click();
  await expect(page.locator('text=해설').first()).toBeVisible();
  await page.getByLabel(/SQL 편집기/).fill("INSERT INTO students VALUES (9, '사랑', 20, 1);");
  await page.getByRole('button', { name: '실행하고 채점' }).click();
  // 아직 XP 없음: 후속 확인 필요
  await expect(page.locator('.feedback')).toContainText('마지막으로 결과를 직접 확인');
  await page.getByLabel('방금 실행에서 영향받은 행은 몇 개였나요?').fill('1');
  await page.getByRole('button', { name: '확인' }).click();
  await expectSuccess(page, /\+100XP 안내 학습 완료/);
});
