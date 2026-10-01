import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import type { DatasetId, StatementType } from '../content/types';
import { seedSql, type SeedId } from './datasets';
import { classifyTokens, guardSql, tokenize } from './guard';
import { compareResults, type Cell, type CompareResult, type ResultSet } from './grader/compare';

/**
 * SQLite(sql.js) 실행 엔진. Worker와 Node 테스트가 같은 코드를 사용한다.
 * 이 모듈은 Supabase나 인증 정보에 접근하지 않는다.
 */

export const DISPLAY_ROW_LIMIT = 200;
export const GRADE_ROW_LIMIT = 5000;

export interface SqlError {
  message: string;
  raw: string;
  line?: number;
  col?: number;
}

export interface StatementOutput {
  type: StatementType;
  result?: ResultSet;
  rowsModified: number;
}

export type ExecOutput =
  | { ok: true; statements: StatementOutput[]; last?: ResultSet; rowsModified: number }
  | { ok: false; error: SqlError };

export function openDb(SQL: SqlJsStatic, dataset: DatasetId, seed: SeedId, opts: { readOnly: boolean }): Database {
  const db = new SQL.Database();
  db.exec(seedSql(dataset, seed));
  db.exec('PRAGMA foreign_keys = ON;');
  if (opts.readOnly) db.exec('PRAGMA query_only = 1;');
  return db;
}

function toCell(v: SqlValue): Cell {
  if (v === null || typeof v === 'number' || typeof v === 'string') return v;
  return '[BLOB]';
}

function posToLineCol(sql: string, pos: number): { line: number; col: number } {
  const before = sql.slice(0, pos);
  const line = before.split('\n').length;
  const col = pos - before.lastIndexOf('\n');
  return { line, col };
}

/** SQLite 오류를 쉬운 한국어 설명으로 바꾼다. */
export function friendlyError(raw: string, sql: string): SqlError {
  const err: SqlError = { message: raw, raw };
  let m: RegExpMatchArray | null;
  if ((m = raw.match(/near "([^"]*)": syntax error/))) {
    const token = m[1];
    const idx = sql.toUpperCase().indexOf(token.toUpperCase());
    if (idx >= 0) Object.assign(err, posToLineCol(sql, idx));
    err.message = `'${token}' 근처에서 문법 오류가 있어요. 쉼표, 괄호, 키워드 순서(SELECT→FROM→WHERE→GROUP BY→HAVING→ORDER BY)를 확인해 보세요.`;
  } else if (/incomplete input/.test(raw)) {
    err.message = 'SQL이 중간에 끝났어요. 괄호나 따옴표가 닫혔는지, 문장이 완성됐는지 확인해 보세요.';
  } else if ((m = raw.match(/no such column: (\S+)/))) {
    err.message = `'${m[1]}'라는 열이 없어요. 열 이름의 철자와 어느 테이블의 열인지 확인해 보세요.`;
    const idx = sql.indexOf(m[1]);
    if (idx >= 0) Object.assign(err, posToLineCol(sql, idx));
  } else if ((m = raw.match(/no such table: (\S+)/))) {
    err.message = `'${m[1]}'라는 테이블이 없어요. 왼쪽 스키마에서 테이블 이름을 확인해 보세요.`;
  } else if ((m = raw.match(/ambiguous column name: (\S+)/))) {
    err.message = `'${m[1]}' 열이 여러 테이블에 있어요. s.${m[1]}처럼 테이블 별칭을 앞에 붙여 주세요.`;
  } else if ((m = raw.match(/no such function: (\S+)/))) {
    err.message = `'${m[1]}' 함수는 SQLite에 없어요. Oracle/SQL Server 전용 함수일 수 있어요(문법 비교 활동 참고).`;
  } else if (/misuse of aggregate/.test(raw)) {
    err.message = '집계 함수(COUNT, SUM 등)를 WHERE에서 쓸 수 없어요. 그룹 조건은 HAVING에 써요.';
  } else if (/CHECK constraint failed/.test(raw)) {
    err.message = `CHECK 제약조건 위반이에요. 허용된 값 범위를 확인해 보세요. (${raw.replace(/^.*CHECK constraint failed: ?/, '')})`;
  } else if (/FOREIGN KEY constraint failed/.test(raw)) {
    err.message = 'FOREIGN KEY 제약조건 위반이에요. 참조하는 테이블에 그 키 값이 있는지 확인해 보세요.';
  } else if ((m = raw.match(/UNIQUE constraint failed: (\S+)/))) {
    err.message = `UNIQUE/기본키 제약조건 위반이에요. ${m[1]} 값이 이미 있어요.`;
  } else if ((m = raw.match(/NOT NULL constraint failed: (\S+)/))) {
    err.message = `NOT NULL 제약조건 위반이에요. ${m[1]}에는 값이 꼭 있어야 해요.`;
  } else if (/attempt to write a readonly database/.test(raw)) {
    err.message = '이 활동은 조회(SELECT)만 할 수 있어요.';
  } else if (/no such savepoint/.test(raw)) {
    err.message = '그 이름의 SAVEPOINT가 없어요. 먼저 SAVEPOINT를 만들어야 해요.';
  } else if (/cannot (commit|rollback) - no transaction is active/.test(raw)) {
    err.message = '열려 있는 트랜잭션이 없어요. BEGIN으로 먼저 시작해야 해요.';
  } else if (/cannot start a transaction within a transaction/.test(raw)) {
    err.message = '이미 트랜잭션이 열려 있어요. COMMIT 또는 ROLLBACK으로 먼저 끝내세요.';
  } else if (/sub-select returns \d+ columns/.test(raw)) {
    err.message = '서브쿼리가 돌려주는 열 개수가 맞지 않아요. IN (서브쿼리)는 열 1개를 돌려줘야 해요.';
  } else if (/SELECTs to the left and right of (UNION|INTERSECT|EXCEPT)/.test(raw)) {
    err.message = '집합 연산자 양쪽 SELECT의 열 개수가 같아야 해요.';
  } else if (/a GROUP BY clause is required before HAVING/.test(raw)) {
    err.message = 'HAVING은 GROUP BY와 함께 써요.';
  }
  return err;
}

export function execSql(db: Database, sql: string, allow: StatementType[], maxRows = GRADE_ROW_LIMIT): ExecOutput {
  const g = guardSql(sql, allow);
  if (!g.ok) {
    const err: SqlError = { message: g.message ?? '실행할 수 없는 SQL이에요.', raw: g.message ?? '' };
    if (g.pos !== undefined) Object.assign(err, posToLineCol(sql, g.pos));
    return { ok: false, error: err };
  }
  const statements: StatementOutput[] = [];
  let totalModified = 0;
  try {
    for (const stmt of db.iterateStatements(sql)) {
      const text = stmt.getSQL();
      // 엔진이 나눈 문장마다 다시 종류를 판정한다(이중 확인).
      const type = classifyTokens(tokenize(text));
      if (!allow.includes(type)) {
        stmt.free();
        return { ok: false, error: { message: '허용되지 않은 문장이 포함되어 있어요.', raw: text } };
      }
      const columns = stmt.getColumnNames();
      const rows: Cell[][] = [];
      let truncated = false;
      while (stmt.step()) {
        if (rows.length >= maxRows) {
          truncated = true;
          break;
        }
        rows.push(stmt.get().map(toCell));
      }
      stmt.free();
      const modified = type === 'select' || type === 'tcl' ? 0 : db.getRowsModified();
      totalModified += modified;
      statements.push({ type, rowsModified: modified, result: columns.length ? { columns, rows, truncated } : undefined });
    }
  } catch (e) {
    return { ok: false, error: friendlyError((e as Error).message, sql) };
  }
  const withResult = statements.filter((s) => s.result);
  return { ok: true, statements, last: withResult.length ? withResult[withResult.length - 1].result : undefined, rowsModified: totalModified };
}

/** 내부용: 신뢰하는 SQL(콘텐츠 정답 등)을 읽기 전용 DB에서 실행해 결과를 돌려준다. */
export function queryFresh(SQL: SqlJsStatic, dataset: DatasetId, seed: SeedId, sql: string): ResultSet {
  const db = openDb(SQL, dataset, seed, { readOnly: true });
  try {
    const out = execSql(db, sql, ['select'], GRADE_ROW_LIMIT);
    if (!out.ok) throw new Error(`기준 SQL 오류: ${out.error.raw}\n${sql}`);
    return out.last ?? { columns: [], rows: [] };
  } finally {
    db.close();
  }
}

export interface GradeRequest {
  dataset: DatasetId;
  studentSql: string;
  solutionSql: string;
  ordered: boolean;
  checkColumnNames?: boolean;
  allow: StatementType[];
  /** DML 과제: 실행 후 이 쿼리 결과(상태)를 비교 */
  stateCheckSql?: string;
}

export type GradeOutput =
  | { status: 'error'; error: SqlError }
  | { status: 'no-result'; display?: ResultSet; rowsModified: number }
  | {
      status: 'graded';
      pass: boolean;
      compare: CompareResult;
      /** main seed에선 맞았지만 alt seed에서 틀린 경우 */
      failedOnAltSeed: boolean;
      display?: ResultSet;
      expectedDisplay?: ResultSet;
      rowsModified: number;
    };

function runOnSeed(SQL: SqlJsStatic, req: GradeRequest, seed: SeedId, who: 'student' | 'solution') {
  const isWrite = req.allow.some((a) => a !== 'select');
  const db = openDb(SQL, req.dataset, seed, { readOnly: !isWrite });
  try {
    const out = execSql(db, who === 'student' ? req.studentSql : req.solutionSql, who === 'student' ? req.allow : ['select', 'insert', 'update', 'delete', 'create', 'drop', 'alter', 'tcl']);
    if (!out.ok) return { out, state: undefined };
    let state: ResultSet | undefined;
    if (req.stateCheckSql) {
      const s = execSql(db, req.stateCheckSql, ['select']);
      if (s.ok) state = s.last;
    }
    return { out, state };
  } finally {
    db.close();
  }
}

/** 기준 정답과 학생 SQL을 각각 별도 DB 인스턴스에서 실행하고 결과를 비교한다(main + alt seed). */
export function gradeSql(SQL: SqlJsStatic, req: GradeRequest): GradeOutput {
  let firstDisplay: ResultSet | undefined;
  let firstExpected: ResultSet | undefined;
  let rowsModified = 0;
  for (const seed of ['main', 'alt'] as SeedId[]) {
    const stu = runOnSeed(SQL, req, seed, 'student');
    if (!stu.out.ok) return { status: 'error', error: stu.out.error };
    const sol = runOnSeed(SQL, req, seed, 'solution');
    if (!sol.out.ok) throw new Error(`정답 SQL 오류(${seed}): ${sol.out.error.raw}`);
    const actual = req.stateCheckSql ? stu.state : stu.out.last;
    const expected = req.stateCheckSql ? sol.state : sol.out.last;
    if (seed === 'main') {
      firstDisplay = stu.out.last ?? stu.state;
      firstExpected = expected;
      rowsModified = stu.out.rowsModified;
    }
    if (!actual || !expected) {
      return { status: 'no-result', display: firstDisplay, rowsModified };
    }
    const cmp = compareResults(expected, actual, {
      ordered: req.stateCheckSql ? true : req.ordered,
      checkColumnNames: req.checkColumnNames,
    });
    if (!cmp.pass) {
      return { status: 'graded', pass: false, compare: cmp, failedOnAltSeed: seed === 'alt', display: firstDisplay, expectedDisplay: seed === 'main' ? firstExpected : undefined, rowsModified };
    }
  }
  return { status: 'graded', pass: true, compare: { pass: true }, failedOnAltSeed: false, display: firstDisplay, rowsModified };
}

/** 표시용으로 행 수를 자른다 */
export function limitForDisplay(r: ResultSet | undefined): ResultSet | undefined {
  if (!r) return r;
  if (r.rows.length <= DISPLAY_ROW_LIMIT) return r;
  return { columns: r.columns, rows: r.rows.slice(0, DISPLAY_ROW_LIMIT), truncated: true };
}

/**
 * 세션 DB: 자유 실습장·트랜잭션 활동용. 상태는 '성공한 문장 기록(log)'으로 재현한다.
 * Worker가 종료되어도 같은 seed + log를 다시 실행하면 같은 상태가 된다.
 */
export function openSessionDb(SQL: SqlJsStatic, dataset: DatasetId, log: string[]): Database {
  const db = openDb(SQL, dataset, 'main', { readOnly: false });
  for (const s of log) db.exec(s);
  return db;
}

export function inTransaction(db: Database): boolean {
  // 트랜잭션이 열려 있으면 BEGIN이 실패한다. 열려 있지 않으면 BEGIN 직후 ROLLBACK으로 되돌린다.
  try {
    db.exec('BEGIN; ROLLBACK;');
    return false;
  } catch {
    return true;
  }
}
