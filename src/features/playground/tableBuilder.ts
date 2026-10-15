import { quoteIdent } from '../../sql/schema';

/**
 * '직접 표 만들기' 양식 → CREATE TABLE + INSERT SQL 생성기(순수 함수).
 * - 이름은 글자(한글 포함)·숫자·밑줄만 허용하고, 생성 SQL에서는 항상 큰따옴표로 감싼다(따옴표는 두 번 써서 이스케이프).
 * - 값은 자료형에 맞게 검사하고 문자열은 작은따옴표를 두 번 써서 넣는다. 빈 칸은 NULL.
 * - 오류는 학생이 바로 고칠 수 있는 짧은 한국어 문장으로 돌려준다.
 */

export const COLUMN_TYPES = ['INTEGER', 'TEXT', 'REAL'] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export interface FkRef {
  table: string;
  column: string;
}

export interface BuilderColumn {
  /** 화면용 안정 키(이름과 무관) */
  key: string;
  name: string;
  type: ColumnType;
  pk: boolean;
  fk: FkRef | null;
}

export interface BuilderRow {
  key: string;
  /** 열 key → 입력값 */
  cells: Record<string, string>;
}

export interface BuilderDraft {
  tableName: string;
  columns: BuilderColumn[];
  rows: BuilderRow[];
}

export interface BuilderContext {
  /** 지금 DB에 있는 표 이름 */
  existingTables: string[];
  /** 외래키가 가리킬 수 있는 열(단일 기본키·UNIQUE 열) */
  fkTargets: FkRef[];
}

export interface BuildResult {
  sql: string;
  errors: string[];
  /** 실제로 넣을 행 수(완전히 빈 행은 건너뜀) */
  rowCount: number;
}

export const MAX_NAME_LENGTH = 30;
export const MAX_COLUMNS = 12;
export const MAX_ROWS = 30;

/** 이름으로 쓰면 헷갈리는 SQL 예약어(따옴표 없이 쓰면 오류가 나는 것 위주) */
const RESERVED = new Set(
  ('ABORT ADD ALL ALTER AND AS ASC BETWEEN BY CASE CHECK COLLATE COLUMN COMMIT CONSTRAINT CREATE CROSS DEFAULT DELETE DESC DISTINCT DROP ELSE END ESCAPE EXCEPT EXISTS FOREIGN FROM FULL GROUP HAVING IN INDEX INNER INSERT INTERSECT INTO IS JOIN KEY LEFT LIKE LIMIT NATURAL NOT NULL OFFSET ON OR ORDER OUTER PRIMARY REFERENCES RIGHT ROLLBACK SELECT SET TABLE THEN TO TRANSACTION UNION UNIQUE UPDATE USING VALUES VIEW WHEN WHERE WITH PRAGMA ATTACH DETACH ISNULL NOTNULL RETURNING NOTHING DEFERRABLE AUTOINCREMENT EXPLAIN ANALYZE VACUUM REINDEX REPLACE TEMP TEMPORARY TRIGGER BEGIN SAVEPOINT RELEASE')
    .split(' '),
);

const NAME_RE = /^[\p{L}_][\p{L}\p{N}_]*$/u;

/** 이름 검사. 문제가 없으면 null, 있으면 한국어 안내 */
export function checkName(name: string, what: string): string | null {
  const n = name.trim();
  if (!n) return `${what}을 입력해 주세요.`;
  if (n.length > MAX_NAME_LENGTH) return `${what}은 ${MAX_NAME_LENGTH}자 이하로 써 주세요.`;
  if (/^\p{N}/u.test(n)) return `${what} '${n}': 숫자로 시작할 수 없어요.`;
  if (!NAME_RE.test(n)) return `${what} '${n}': 글자(한글 포함), 숫자, 밑줄(_)만 쓸 수 있어요. 띄어쓰기 대신 밑줄을 써 보세요.`;
  if (RESERVED.has(n.toUpperCase())) return `${what} '${n}': SQL 예약어라 이름으로 쓸 수 없어요.`;
  if (/^sqlite_/i.test(n)) return `${what} '${n}': sqlite_로 시작하는 이름은 SQLite가 쓰는 이름이에요.`;
  return null;
}

export { quoteIdent };

const INT_RE = /^[+-]?\d+$/;
const REAL_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** 입력값 하나를 SQL 값으로. 빈 칸은 NULL */
export function sqlLiteral(raw: string, type: ColumnType): { ok: true; sql: string } | { ok: false; error: string } {
  const v = raw.trim();
  if (v === '') return { ok: true, sql: 'NULL' };
  if (type === 'INTEGER') {
    if (!INT_RE.test(v)) return { ok: false, error: `'${v}'는 정수(INTEGER)가 아니에요.` };
    if (!Number.isSafeInteger(Number(v))) return { ok: false, error: `'${v}'는 너무 큰 수예요.` };
    return { ok: true, sql: String(Number(v)) };
  }
  if (type === 'REAL') {
    if (!REAL_RE.test(v) || !Number.isFinite(Number(v))) return { ok: false, error: `'${v}'는 숫자(REAL)가 아니에요.` };
    return { ok: true, sql: String(Number(v)) };
  }
  // 문자열: 작은따옴표를 두 번 써서 이스케이프. 제어 문자는 뺀다.
  // eslint-disable-next-line no-control-regex
  return { ok: true, sql: `'${v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/'/g, "''")}'` };
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function buildTableSql(draft: BuilderDraft, ctx: BuilderContext): BuildResult {
  const errors: string[] = [];
  const tableName = draft.tableName.trim();
  const tErr = checkName(tableName, '표 이름');
  if (tErr) errors.push(tErr);
  else if (ctx.existingTables.some((t) => same(t, tableName))) errors.push(`'${tableName}' 표가 이미 있어요. 다른 이름을 써 주세요.`);

  const cols = draft.columns.map((c) => ({ ...c, name: c.name.trim() }));
  if (!cols.length) errors.push('열을 하나 이상 만들어 주세요.');
  if (cols.length > MAX_COLUMNS) errors.push(`열은 ${MAX_COLUMNS}개까지 만들 수 있어요.`);
  cols.forEach((c, i) => {
    const e = checkName(c.name, `${i + 1}번 열 이름`);
    if (e) errors.push(e);
    else if (cols.findIndex((o) => same(o.name, c.name)) !== i) errors.push(`열 이름 '${c.name}'이 두 번 나와요. 열 이름은 서로 달라야 해요.`);
    if (c.fk && !ctx.fkTargets.some((t) => same(t.table, c.fk!.table) && same(t.column, c.fk!.column))) {
      errors.push(`${i + 1}번 열이 가리키는 ${c.fk.table}.${c.fk.column}을 찾을 수 없어요. 연결할 열을 다시 골라 주세요.`);
    }
  });

  const pkCols = cols.filter((c) => c.pk);
  const lines = cols.map((c) => {
    let line = `  ${quoteIdent(c.name)} ${c.type}`;
    if (c.pk && pkCols.length === 1) line += ' PRIMARY KEY';
    if (c.fk) line += ` REFERENCES ${quoteIdent(c.fk.table)} (${quoteIdent(c.fk.column)})`;
    return line;
  });
  if (pkCols.length > 1) lines.push(`  PRIMARY KEY (${pkCols.map((c) => quoteIdent(c.name)).join(', ')})`);
  let sql = `CREATE TABLE ${quoteIdent(tableName)} (\n${lines.join(',\n')}\n);`;

  // 행: 완전히 빈 행은 건너뛴다
  const filled = draft.rows.filter((r) => cols.some((c) => (r.cells[c.key] ?? '').trim() !== ''));
  if (filled.length > MAX_ROWS) errors.push(`행은 ${MAX_ROWS}개까지 넣을 수 있어요.`);
  const autoPk = pkCols.length === 1 && pkCols[0].type === 'INTEGER'; // INTEGER PRIMARY KEY는 비우면 번호가 자동으로 붙어요
  const seenPk = new Map<string, number>();
  const valueRows: string[] = [];
  draft.rows.forEach((r, ri) => {
    if (!filled.includes(r)) return;
    const vals: string[] = [];
    cols.forEach((c) => {
      const lit = sqlLiteral(r.cells[c.key] ?? '', c.type);
      if (!lit.ok) {
        errors.push(`${ri + 1}행 '${c.name || `${cols.indexOf(c) + 1}번 열`}': ${lit.error}`);
        vals.push('NULL');
      } else {
        vals.push(lit.sql);
      }
    });
    if (pkCols.length) {
      const pkVals = pkCols.map((c) => (r.cells[c.key] ?? '').trim());
      if (pkVals.some((v) => v === '') && !autoPk) {
        errors.push(`${ri + 1}행: 기본키(PK) 열 ${pkCols.map((c) => c.name).join(', ')}은 비워 둘 수 없어요.`);
      } else if (!pkVals.some((v) => v === '')) {
        const k = JSON.stringify(pkVals.map((v, i) => (pkCols[i].type === 'TEXT' ? v : String(Number(v)))));
        const prev = seenPk.get(k);
        if (prev !== undefined) errors.push(`${ri + 1}행: 기본키 값이 ${prev + 1}행과 같아요. 기본키는 행마다 달라야 해요.`);
        else seenPk.set(k, ri);
      }
    }
    valueRows.push(`  (${vals.join(', ')})`);
  });
  if (valueRows.length) {
    sql += `\nINSERT INTO ${quoteIdent(tableName)} (${cols.map((c) => quoteIdent(c.name)).join(', ')}) VALUES\n${valueRows.join(',\n')};`;
  }
  return { sql, errors: [...new Set(errors)], rowCount: valueRows.length };
}

let seq = 0;
export const newKey = (prefix: string) => `${prefix}${++seq}`;

export function emptyDraft(): BuilderDraft {
  const id = newKey('c');
  const name = newKey('c');
  return {
    tableName: '',
    columns: [
      { key: id, name: '번호', type: 'INTEGER', pk: true, fk: null },
      { key: name, name: '이름', type: 'TEXT', pk: false, fk: null },
    ],
    rows: [{ key: newKey('r'), cells: {} }],
  };
}
