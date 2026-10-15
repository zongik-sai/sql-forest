import type { DatasetId, StatementType } from '../../content/types';
import type { ExecOutput, GradeOutput, GradeRequest, SessionBase } from '../engine';
import type { ResultSet } from '../grader/compare';
import type { DbSchema } from '../schema';

export type WorkerOp =
  | { op: 'init' }
  /** 콘텐츠의 신뢰된 SQL을 새 읽기 전용 DB(main seed)에서 실행 */
  | { op: 'query'; dataset: DatasetId; sql: string }
  /** 학생 SQL을 새 DB에서 실행 (표시용 결과) */
  | { op: 'run'; dataset: DatasetId; sql: string; allow: StatementType[] }
  | { op: 'grade'; req: GradeRequest }
  /** 세션 DB(자유 실습장·트랜잭션). log로 상태를 재현한다. dataset은 학습 데이터셋 id 또는 'preset:<id>' */
  | { op: 'session-exec'; sessionId: string; dataset: SessionBase; log: string[]; sql: string; allow: StatementType[] }
  | { op: 'session-close'; sessionId: string }
  /** 스키마(표·열·외래키) 읽기. session이 있으면 그 세션 DB의 현재 상태, 없으면 시작 데이터 그대로 */
  | { op: 'schema'; base: SessionBase; session?: { id: string; log: string[] } };

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
  | { op: 'session-close' }
  | { op: 'schema'; schema: DbSchema };

export type WorkerResponse =
  | { requestId: number; generation: number; ok: true; data: WorkerData }
  | { requestId: number; generation: number; ok: false; error: string };
