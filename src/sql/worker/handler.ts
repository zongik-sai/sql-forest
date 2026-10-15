import type { Database, SqlJsStatic } from 'sql.js';
import { DISPLAY_ROW_LIMIT, execSql, gradeSql, inTransaction, limitForDisplay, openBaseDb, openDb, openSessionDb, queryFresh, type SessionBase } from '../engine';
import { readSchema } from '../schema';
import type { WorkerData, WorkerRequest } from './protocol';

/** Worker 메시지 처리기. 브라우저 Worker와 Node 테스트(가짜 Worker)가 같은 코드를 쓴다. */
export function createHandler(getSql: () => Promise<SqlJsStatic>) {
  const sessions = new Map<string, { db: Database; logLength: number; dataset: string }>();

  /** 세션 DB를 log 상태로 맞춘다(기록 길이·시작 데이터가 다르면 다시 만든다). */
  const ensureSession = (SQL: SqlJsStatic, id: string, base: SessionBase, log: string[]) => {
    let s = sessions.get(id);
    if (!s || s.logLength !== log.length || s.dataset !== base) {
      s?.db.close();
      s = { db: openSessionDb(SQL, base, log), logLength: log.length, dataset: base };
      sessions.set(id, s);
    }
    return s;
  };

  return async function handle(req: WorkerRequest): Promise<WorkerData> {
    const SQL = await getSql();
    switch (req.op) {
      case 'init':
        return { op: 'init' };
      case 'query':
        return { op: 'query', result: queryFresh(SQL, req.dataset, 'main', req.sql) };
      case 'run': {
        const isWrite = req.allow.some((a) => a !== 'select');
        const db = openDb(SQL, req.dataset, 'main', { readOnly: !isWrite });
        try {
          const output = execSql(db, req.sql, req.allow);
          if (output.ok) {
            output.last = limitForDisplay(output.last);
            output.statements = output.statements.map((s) => ({ ...s, result: limitForDisplay(s.result) }));
          }
          return { op: 'run', output };
        } finally {
          db.close();
        }
      }
      case 'grade': {
        const output = gradeSql(SQL, req.req);
        if (output.status !== 'error') {
          output.display = limitForDisplay(output.display);
          if (output.status === 'graded') output.expectedDisplay = limitForDisplay(output.expectedDisplay);
        }
        return { op: 'grade', output };
      }
      case 'session-exec': {
        let s = ensureSession(SQL, req.sessionId, req.dataset, req.log);
        const output = execSql(s.db, req.sql, req.allow, DISPLAY_ROW_LIMIT);
        if (output.ok) {
          s.logLength += 1;
        } else {
          // 실패한 실행은 전체를 되돌린다(부분 실행 방지): 기록으로 다시 만든다.
          s.db.close();
          s = { db: openSessionDb(SQL, req.dataset, req.log), logLength: req.log.length, dataset: req.dataset };
          sessions.set(req.sessionId, s);
        }
        return { op: 'session-exec', data: { output, inTransaction: inTransaction(s.db) } };
      }
      case 'session-close': {
        sessions.get(req.sessionId)?.db.close();
        sessions.delete(req.sessionId);
        return { op: 'session-close' };
      }
      case 'schema': {
        if (req.session) return { op: 'schema', schema: readSchema(ensureSession(SQL, req.session.id, req.base, req.session.log).db) };
        const db = openBaseDb(SQL, req.base);
        try {
          return { op: 'schema', schema: readSchema(db) };
        } finally {
          db.close();
        }
      }
    }
  };
}
