import type { Database, SqlValue } from 'sql.js';

/**
 * 학습용 SQLite DB의 구조(스키마) 읽기.
 * sqlite_master + PRAGMA table_info / foreign_key_list / index_list를 신뢰된 코드에서만 실행한다
 * (학생 SQL 가드는 PRAGMA를 막으므로 이 함수는 Worker 안에서 직접 DB를 읽는다).
 * 표 이름은 바인딩 매개변수로 넘겨 이름에 따옴표가 있어도 안전하다.
 */

export interface SchemaColumn {
  name: string;
  /** 선언한 자료형(없으면 빈 문자열) */
  type: string;
  /** 기본키에 속하는 열인지(복합키 포함) */
  pk: boolean;
  notnull: boolean;
  /** 이 열 하나만으로 값이 겹치지 않는지(단일 열 기본키 또는 UNIQUE). 외래키가 가리킬 수 있는 열이다. */
  unique: boolean;
}

export interface SchemaForeignKey {
  /** 이 표의 열 */
  from: string;
  /** 가리키는(참조하는) 표 */
  table: string;
  /** 가리키는 표의 열 */
  to: string;
}

export interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
  fks: SchemaForeignKey[];
  rowCount: number;
}

export interface DbSchema {
  tables: SchemaTable[];
}

function all(db: Database, sql: string, params: SqlValue[] = []): Record<string, SqlValue>[] {
  const st = db.prepare(sql);
  try {
    st.bind(params);
    const out: Record<string, SqlValue>[] = [];
    while (st.step()) out.push(st.getAsObject());
    return out;
  } finally {
    st.free();
  }
}

export const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

export function readSchema(db: Database): DbSchema {
  const names = all(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name").map((r) => String(r.name));
  const tables: SchemaTable[] = names.map((name) => {
    const info = all(db, 'SELECT name, type, "notnull" AS nn, pk FROM pragma_table_info(?) ORDER BY cid', [name]);
    const pkCount = info.filter((c) => Number(c.pk) > 0).length;
    const uniqueCols = new Set<string>();
    for (const idx of all(db, 'SELECT name, "unique" AS u FROM pragma_index_list(?)', [name])) {
      if (Number(idx.u) !== 1) continue;
      const cols = all(db, 'SELECT name FROM pragma_index_info(?)', [String(idx.name)]);
      if (cols.length === 1 && cols[0].name !== null) uniqueCols.add(String(cols[0].name));
    }
    const columns: SchemaColumn[] = info.map((c) => {
      const pk = Number(c.pk) > 0;
      return {
        name: String(c.name),
        type: String(c.type ?? ''),
        pk,
        notnull: Number(c.nn) === 1,
        unique: (pk && pkCount === 1) || uniqueCols.has(String(c.name)),
      };
    });
    return { name, columns, fks: [], rowCount: 0 };
  });
  const byName = new Map(tables.map((t) => [t.name.toLowerCase(), t]));
  for (const t of tables) {
    const rows = all(db, 'SELECT id, seq, "table" AS tbl, "from" AS src, "to" AS dst FROM pragma_foreign_key_list(?) ORDER BY id, seq', [t.name]);
    for (const r of rows) {
      const target = byName.get(String(r.tbl).toLowerCase());
      let to = r.dst === null ? null : String(r.dst);
      // REFERENCES t 처럼 열을 생략하면 그 표의 기본키를 가리킨다
      if (to === null && target) {
        const pkCols = target.columns.filter((c) => c.pk);
        to = pkCols[Number(r.seq)]?.name ?? pkCols[0]?.name ?? null;
      }
      t.fks.push({ from: String(r.src), table: target?.name ?? String(r.tbl), to: to ?? '' });
    }
    // SQLite는 외래키를 선언 역순으로 돌려주므로 열 순서로 정렬한다
    const colIndex = (n: string) => t.columns.findIndex((c) => c.name.toLowerCase() === n.toLowerCase());
    t.fks.sort((a, b) => colIndex(a.from) - colIndex(b.from));
    const cnt = db.exec(`SELECT COUNT(*) FROM ${quoteIdent(t.name)}`);
    t.rowCount = Number(cnt[0]?.values[0]?.[0] ?? 0);
  }
  return { tables };
}
