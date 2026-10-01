/**
 * 결과 기반 채점기(순수 함수).
 * - 텍스트 동일성이 아니라 실행 결과를 비교한다.
 * - 별칭(열 이름)은 요구할 때만 비교하고, 열 개수·위치·값을 비교한다.
 * - ordered=false면 multiset(중복 보존) 비교, true면 행 순서까지 비교.
 * - NULL, 빈 문자열, 0을 서로 다른 값으로 본다. 문자열 '90'과 숫자 90도 다르다.
 * - 숫자는 허용오차(기본 1e-6) 안이면 같은 값으로 본다.
 */

export type Cell = number | string | null;

export interface ResultSet {
  columns: string[];
  rows: Cell[][];
  /** 화면 표시용으로 잘렸는지 */
  truncated?: boolean;
}

export const FLOAT_TOLERANCE = 1e-6;

export type Diff =
  | { kind: 'columns-count'; expected: number; actual: number }
  | { kind: 'column-names'; expected: string[]; actual: string[] }
  | { kind: 'missing-row'; row: Cell[]; expectedCount: number; actualCount: number }
  | { kind: 'extra-row'; row: Cell[]; expectedCount: number; actualCount: number }
  | { kind: 'order'; index: number; expected: Cell[]; actual: Cell[] }
  | { kind: 'value'; index: number; expected: Cell[]; actual: Cell[] };

export interface CompareResult {
  pass: boolean;
  diff?: Diff;
}

export interface CompareOptions {
  ordered: boolean;
  checkColumnNames?: boolean;
  tolerance?: number;
}

export function cellEquals(a: Cell, b: Cell, tol = FLOAT_TOLERANCE): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
  }
  if (typeof a !== typeof b) return false;
  return a === b;
}

function rowEquals(a: Cell[], b: Cell[], tol: number): boolean {
  return a.length === b.length && a.every((c, i) => cellEquals(c, b[i], tol));
}

export function compareResults(expected: ResultSet, actual: ResultSet, opts: CompareOptions): CompareResult {
  const tol = opts.tolerance ?? FLOAT_TOLERANCE;
  if (expected.columns.length !== actual.columns.length) {
    return { pass: false, diff: { kind: 'columns-count', expected: expected.columns.length, actual: actual.columns.length } };
  }
  if (opts.checkColumnNames) {
    const norm = (s: string) => s.trim().toLowerCase();
    if (!expected.columns.every((c, i) => norm(c) === norm(actual.columns[i]))) {
      return { pass: false, diff: { kind: 'column-names', expected: expected.columns, actual: actual.columns } };
    }
  }

  // 1) multiset 비교 (중복 보존). ordered여도 먼저 집합 차이를 찾아 '어떤 행' 피드백을 준다.
  const remaining = actual.rows.map((r) => r);
  const used = new Array<boolean>(remaining.length).fill(false);
  for (const er of expected.rows) {
    const idx = remaining.findIndex((ar, i) => !used[i] && rowEquals(er, ar, tol));
    if (idx < 0) {
      return { pass: false, diff: { kind: 'missing-row', row: er, expectedCount: expected.rows.length, actualCount: actual.rows.length } };
    }
    used[idx] = true;
  }
  const extraIdx = used.findIndex((u) => !u);
  if (extraIdx >= 0) {
    return { pass: false, diff: { kind: 'extra-row', row: actual.rows[extraIdx], expectedCount: expected.rows.length, actualCount: actual.rows.length } };
  }

  // 2) 순서 비교
  if (opts.ordered) {
    for (let i = 0; i < expected.rows.length; i++) {
      if (!rowEquals(expected.rows[i], actual.rows[i], tol)) {
        return { pass: false, diff: { kind: 'order', index: i, expected: expected.rows[i], actual: actual.rows[i] } };
      }
    }
  }
  return { pass: true };
}

export function formatCell(c: Cell): string {
  if (c === null) return 'NULL';
  if (c === '') return "''(빈 문자열)";
  return String(c);
}

export function formatRow(r: Cell[]): string {
  return '(' + r.map(formatCell).join(', ') + ')';
}

/** 학생에게 보여줄 '첫 차이 행 + 개념 이유' 문장 */
export function describeDiff(d: Diff): string {
  switch (d.kind) {
    case 'columns-count':
      return `결과의 열 개수가 달라요. 필요한 열은 ${d.expected}개인데 지금은 ${d.actual}개예요. SELECT 뒤에 쓴 열 목록을 확인해 보세요.`;
    case 'column-names':
      return `열 이름(별칭)이 요구와 달라요. 필요한 이름: ${d.expected.join(', ')} / 지금: ${d.actual.join(', ')}`;
    case 'missing-row':
      return `결과가 조금 달라요. 정답에는 있는 행 ${formatRow(d.row)}이(가) 빠졌어요. (필요 ${d.expectedCount}행, 지금 ${d.actualCount}행) 조건이 이 행을 걸러내지 않았는지 확인해볼까요?`;
    case 'extra-row':
      return `결과가 조금 달라요. 정답에 없는 행 ${formatRow(d.row)}이(가) 추가됐어요. (필요 ${d.expectedCount}행, 지금 ${d.actualCount}행) 어떤 조건이 이 행을 남겼는지 함께 확인해볼까요?`;
    case 'order':
      return `행은 모두 맞지만 순서가 달라요. ${d.index + 1}번째 행이 ${formatRow(d.expected)}여야 하는데 ${formatRow(d.actual)}예요. ORDER BY를 확인해 보세요.`;
    case 'value':
      return `${d.index + 1}번째 행의 값이 달라요.`;
  }
}
