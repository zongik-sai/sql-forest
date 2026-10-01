import type { DatasetId, StatementType } from '../../content/types';
import type { ExecOutput, GradeOutput, GradeRequest } from '../engine';
import type { ResultSet } from '../grader/compare';
import type { SessionExecData, WorkerData, WorkerOp, WorkerRequest, WorkerResponse } from './protocol';

/**
 * 메인 스레드의 SQL Worker 클라이언트.
 * - 모든 SQL은 Worker에서만 실행한다.
 * - 기본 2초 제한: 넘으면 Worker를 종료하고 새로 만든다(학습 DB는 seed에서 다시 만들어지므로 복원됨).
 * - generation: 집중모드 일시정지·활동 변경 시 증가. 늦게 도착한 결과는 'stale'로 버려
 *   점수·타이머·완료 상태를 바꾸지 못하게 한다.
 */

export const QUERY_TIMEOUT_MS = 2000;
const INIT_TIMEOUT_MS = 30000;

export type Outcome<T> =
  | { status: 'ok'; data: T }
  | { status: 'timeout' }
  | { status: 'interrupted' }
  | { status: 'stale' }
  | { status: 'failed'; error: string };

interface Pending {
  resolve: (v: Outcome<WorkerData>) => void;
  timer: ReturnType<typeof setTimeout> | null;
  generation: number;
}

export type WorkerFactory = () => Worker;

const defaultFactory: WorkerFactory = () => new Worker(new URL('./sqlWorker.ts', import.meta.url), { type: 'module' });

export class SqlClient {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private generation = 0;
  private listeners = new Set<(e: { type: 'restarted'; reason: 'timeout' | 'interrupted' }) => void>();

  constructor(private factory: WorkerFactory = defaultFactory, private timeoutMs = QUERY_TIMEOUT_MS) {}

  get currentGeneration(): number {
    return this.generation;
  }

  /** 활동 변경·일시정지 시 호출. 이전 요청의 결과는 모두 stale 처리된다. */
  bumpGeneration(): number {
    this.generation += 1;
    return this.generation;
  }

  onRestart(fn: (e: { type: 'restarted'; reason: 'timeout' | 'interrupted' }) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get busy(): boolean {
    return this.pending.size > 0;
  }

  private spawn(): void {
    this.worker = this.factory();
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.onMessage(ev.data);
    this.worker.onerror = (ev) => {
      ev.preventDefault?.();
      this.failAll('Worker 오류: ' + (ev.message ?? ''));
    };
    const initId = this.nextId++;
    this.ready = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(initId);
        resolve();
      }, INIT_TIMEOUT_MS);
      this.pending.set(initId, { resolve: () => resolve(), timer, generation: -1 });
      const msg: WorkerRequest = { op: 'init', requestId: initId, generation: -1 };
      this.worker!.postMessage(msg);
    });
  }

  private onMessage(res: WorkerResponse): void {
    const p = this.pending.get(res.requestId);
    if (!p) return;
    this.pending.delete(res.requestId);
    if (p.timer) clearTimeout(p.timer);
    if (p.generation !== -1 && p.generation !== this.generation) {
      p.resolve({ status: 'stale' });
      return;
    }
    p.resolve(res.ok ? { status: 'ok', data: res.data } : { status: 'failed', error: res.error });
  }

  private failAll(error: string): void {
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      p.resolve({ status: 'failed', error });
    }
    this.pending.clear();
  }

  /** Worker를 강제 종료하고 새로 만든다. 진행 중 요청은 reason 상태로 끝난다. */
  restart(reason: 'timeout' | 'interrupted'): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      p.resolve({ status: reason });
    }
    this.pending.clear();
    this.listeners.forEach((l) => l({ type: 'restarted', reason }));
  }

  /** 집중모드 일시정지: 실행 중이면 Worker를 종료(학습 DB 기준 상태로 복원)하고 generation을 올린다. */
  interrupt(): boolean {
    const wasBusy = [...this.pending.values()].some((p) => p.generation !== -1);
    this.bumpGeneration();
    if (wasBusy) this.restart('interrupted');
    return wasBusy;
  }

  async warmup(): Promise<void> {
    if (!this.worker) this.spawn();
    await this.ready;
  }

  private async send(op: WorkerOp): Promise<Outcome<WorkerData>> {
    // 호출 시점의 generation을 기록한다(준비 대기 중 일시정지돼도 결과를 버리기 위해).
    const generation = this.generation;
    if (!this.worker) this.spawn();
    await this.ready;
    if (generation !== this.generation) return { status: 'stale' };
    const requestId = this.nextId++;
    return new Promise<Outcome<WorkerData>>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.has(requestId)) this.restart('timeout');
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, timer, generation });
      const msg = { ...op, requestId, generation } as WorkerRequest;
      this.worker!.postMessage(msg);
    });
  }

  async query(dataset: DatasetId, sql: string): Promise<Outcome<ResultSet>> {
    const r = await this.send({ op: 'query', dataset, sql });
    return r.status === 'ok' && r.data.op === 'query' ? { status: 'ok', data: r.data.result } : (r as Outcome<never>);
  }

  async run(dataset: DatasetId, sql: string, allow: StatementType[]): Promise<Outcome<ExecOutput>> {
    const r = await this.send({ op: 'run', dataset, sql, allow });
    return r.status === 'ok' && r.data.op === 'run' ? { status: 'ok', data: r.data.output } : (r as Outcome<never>);
  }

  async grade(req: GradeRequest): Promise<Outcome<GradeOutput>> {
    const r = await this.send({ op: 'grade', req });
    return r.status === 'ok' && r.data.op === 'grade' ? { status: 'ok', data: r.data.output } : (r as Outcome<never>);
  }

  async sessionExec(sessionId: string, dataset: DatasetId, log: string[], sql: string, allow: StatementType[]): Promise<Outcome<SessionExecData>> {
    const r = await this.send({ op: 'session-exec', sessionId, dataset, log, sql, allow });
    return r.status === 'ok' && r.data.op === 'session-exec' ? { status: 'ok', data: r.data.data } : (r as Outcome<never>);
  }
}

let shared: SqlClient | null = null;
export function sqlClient(): SqlClient {
  shared ??= new SqlClient();
  return shared;
}

export function outcomeMessage(o: Outcome<unknown>): string | null {
  switch (o.status) {
    case 'timeout':
      return '2초 안에 끝나지 않아 실행을 멈추고 학습 데이터를 처음 상태로 되돌렸어요. 조건이나 조인을 확인해 주세요.';
    case 'interrupted':
      return '실행이 중단되었습니다. 다시 실행해주세요.';
    case 'failed':
      return '실행 엔진 오류: ' + o.error;
    default:
      return null;
  }
}
