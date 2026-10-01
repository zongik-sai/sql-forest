import { describe, expect, it } from 'vitest';
import { SqlClient } from '../../src/sql/worker/sqlClient';
import { FakeWorker } from './fakeWorker';

const mk = () => new SqlClient(() => new FakeWorker(400) as unknown as Worker, 150);

describe('SqlClient (Worker 경계)', () => {
  it('정상 실행', async () => {
    const c = mk();
    const r = await c.run('school', 'SELECT COUNT(*) FROM students', ['select']);
    expect(r.status).toBe('ok');
    if (r.status === 'ok' && r.data.ok) expect(r.data.last?.rows).toEqual([[6]]);
  });
  it('시간 초과 시 Worker를 재시작하고 timeout을 돌려준다, 이후 다시 정상 실행', async () => {
    const c = mk();
    await c.warmup();
    const before = FakeWorker.created;
    const r = await c.run('school', 'SELECT /*slow*/ 1', ['select']);
    expect(r.status).toBe('timeout');
    const r2 = await c.run('school', 'SELECT 2', ['select']);
    expect(r2.status).toBe('ok');
    expect(FakeWorker.created).toBe(before + 1);
  });
  it('generation 변경 후 도착한 늦은 결과는 stale로 버린다', async () => {
    const c = new SqlClient(() => new FakeWorker(100) as unknown as Worker, 2000);
    await c.warmup();
    const p = c.run('school', 'SELECT /*slow*/ 1', ['select']);
    c.bumpGeneration();
    expect((await p).status).toBe('stale');
  });
  it('interrupt: 실행 중이면 Worker 종료 + interrupted', async () => {
    const c = new SqlClient(() => new FakeWorker(500) as unknown as Worker, 2000);
    await c.warmup();
    const p = c.run('school', 'SELECT /*slow*/ 1', ['select']);
    await new Promise((r) => setTimeout(r, 20));
    expect(c.interrupt()).toBe(true);
    expect((await p).status).toBe('interrupted');
  });
  it('세션 DB: 성공한 문장 기록으로 상태 재현, 실패한 실행은 전체 되돌림', async () => {
    const c = mk();
    const log: string[] = [];
    const a = await c.sessionExec('s1', 'sandbox', log, "INSERT INTO camp_signup(student_id,camp_name) VALUES(4,'AI캠프')", ['insert', 'select']);
    expect(a.status === 'ok' && a.data.output.ok).toBe(true);
    log.push("INSERT INTO camp_signup(student_id,camp_name) VALUES(4,'AI캠프')");
    const b = await c.sessionExec('s1', 'sandbox', log, "INSERT INTO camp_signup(student_id,camp_name) VALUES(5,'AI캠프'); INSERT INTO camp_signup(student_id,camp_name) VALUES(99,'X')", ['insert', 'select']);
    expect(b.status === 'ok' && b.data.output.ok).toBe(false);
    const q = await c.sessionExec('s1', 'sandbox', log, 'SELECT COUNT(*) FROM camp_signup', ['select']);
    expect(q.status === 'ok' && q.data.output.ok && q.data.output.last?.rows).toEqual([[5]]);
    // Worker 재시작 후에도 log로 재현
    c.restart('timeout');
    const q2 = await c.sessionExec('s1', 'sandbox', log, 'SELECT COUNT(*) FROM camp_signup', ['select']);
    expect(q2.status === 'ok' && q2.data.output.ok && q2.data.output.last?.rows).toEqual([[5]]);
  });
});
