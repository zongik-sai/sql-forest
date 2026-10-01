import initSqlJs, { type SqlJsStatic } from 'sql.js';

let cached: Promise<SqlJsStatic> | null = null;
/** Node 테스트용 sql.js 로더 (브라우저 Worker와 같은 SQLite WASM 빌드) */
export function loadSql(): Promise<SqlJsStatic> {
  cached ??= initSqlJs();
  return cached;
}
