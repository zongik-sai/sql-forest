import type { DatasetId, StatementType } from '../../content/types';
import type { ExecOutput, GradeOutput, GradeRequest } from '../engine';
import type { ResultSet } from '../grader/compare';

export type WorkerOp =
  | { op: 'init' }
  /** 콘텐츠의 신뢰된 SQL을 새 읽기 전용 DB(main seed)에서 실행 */
  | { op: 'query'; dataset: DatasetId; sql: string }
  /** 학생 SQL을 새 DB에서 실행 (표시용 결과) */
  | { op: 'run'; dataset: DatasetId; sql: string; allow: StatementType[] }
  | { op: 'grade'; req: GradeRequest }
  /** 세션 DB(자유 실습장·트랜잭션). log로 상태를 재현한다. */
  | { op: 'session-exec'; sessionId: string; dataset: DatasetId; log: string[]; sql: string; allow: StatementType[] }
  | { op: 'session-close'; sessionId: string };

export type WorkerRequest = WorkerOp & { requestId: number; generation: number };

export interface SessionExecData {
  output: ExecOutput;
  inTransaction: boolean;
}

export type WorkerData =
  | { op: 'init' }
  | { op: 'query'; result: ResultSet }
  | { op: 'run'; output: ExecOutput }
  | { op: 'grade'; output: GradeOutput }
  | { op: 'session-exec'; data: SessionExecData }
  | { op: 'session-close' };

export type WorkerResponse =
  | { requestId: number; generation: number; ok: true; data: WorkerData }
  | { requestId: number; generation: number; ok: false; error: string };
