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

/**
 * SQLite(WASM) 초기화. 브라우저 보안 정책 등으로 WebAssembly를 쓸 수 없으면 원인을 알려 준다.
 * (sql.js의 asm.js 빌드는 Chrome Worker에서 호출 스택 초과가 나 대체 수단으로 쓰지 않는다.)
 */
function getSql(): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs({ locateFile: () => wasmUrl }).catch((e: unknown) => {
    sqlPromise = null;
    throw new Error(`이 브라우저 환경에서 SQL 엔진(WebAssembly)을 불러오지 못했어요. 최신 Chrome·Edge에서 다시 열어 주세요. (${(e as Error)?.message ?? e})`);
  });
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
