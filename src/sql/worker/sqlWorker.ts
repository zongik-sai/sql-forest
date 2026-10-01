/// <reference lib="webworker" />
/**
 * SQL 실행 전용 Worker. 학습용 SQLite(sql.js WASM)만 다룬다.
 * Supabase 인증 토큰이나 진도 DB 접근 정보를 받지 않는다.
 */
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { createHandler } from './handler';
import type { WorkerRequest, WorkerResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let sqlPromise: Promise<SqlJsStatic> | null = null;
function getSql(): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs({ locateFile: () => wasmUrl });
  return sqlPromise;
}
const handle = createHandler(getSql);

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  let res: WorkerResponse;
  try {
    res = { requestId: req.requestId, generation: req.generation, ok: true, data: await handle(req) };
  } catch (e) {
    res = { requestId: req.requestId, generation: req.generation, ok: false, error: (e as Error).message };
  }
  self.postMessage(res);
};
