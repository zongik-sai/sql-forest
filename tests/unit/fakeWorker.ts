import { createHandler } from '../../src/sql/worker/handler';
import type { WorkerRequest, WorkerResponse } from '../../src/sql/worker/protocol';
import { loadSql } from './sqljs';

/** 테스트용 가짜 Worker: 같은 handler를 같은 프로세스에서 비동기로 실행. SQL에 slow 표시 주석이 있으면 지연. */
export class FakeWorker {
  onmessage: ((ev: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  terminated = false;
  static created = 0;
  private handle = createHandler(loadSql);
  constructor(private slowMs = 300) {
    FakeWorker.created++;
  }
  postMessage(req: WorkerRequest) {
    const text = 'sql' in req ? req.sql : 'req' in req ? req.req.studentSql : '';
    const delay = text.includes('/*slow*/') ? this.slowMs : 1;
    setTimeout(async () => {
      if (this.terminated) return;
      let res: WorkerResponse;
      try {
        res = { requestId: req.requestId, generation: req.generation, ok: true, data: await this.handle(req) };
      } catch (e) {
        res = { requestId: req.requestId, generation: req.generation, ok: false, error: (e as Error).message };
      }
      if (!this.terminated) this.onmessage?.({ data: res } as MessageEvent<WorkerResponse>);
    }, delay);
  }
  terminate() {
    this.terminated = true;
  }
}
