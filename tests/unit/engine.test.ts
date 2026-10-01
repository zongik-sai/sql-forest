import { beforeAll, describe, expect, it } from 'vitest';
import type { SqlJsStatic } from 'sql.js';
import { execSql, gradeSql, inTransaction, openDb, queryFresh } from '../../src/sql/engine';
import { loadSql } from './sqljs';

let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await loadSql();
});

describe('기준 seed와 대표 정답 A~E (docs/04)', () => {
  it('A: 3학년 AI컴퓨터 → 1,2', () => {
    const r = queryFresh(SQL, 'school', 'main', 'SELECT student_id,student_name FROM students WHERE grade=3 AND dept_id=10 ORDER BY student_id;');
    expect(r.rows).toEqual([[1, '가온'], [2, '나래']]);
  });
  it('B: COUNT(*)=6, COUNT(score)=5, AVG=82', () => {
    const r = queryFresh(SQL, 'school', 'main', 'SELECT COUNT(*) AS row_count,COUNT(score) AS score_count,AVG(score) AS avg_score FROM enrollment;');
    expect(r.rows).toEqual([[6, 5, 82]]);
  });
  it('C: 미수강 학생 4,5', () => {
    const r = queryFresh(SQL, 'school', 'main', 'SELECT s.student_id FROM students s WHERE NOT EXISTS (SELECT 1 FROM enrollment e WHERE e.student_id=s.student_id) ORDER BY s.student_id;');
    expect(r.rows).toEqual([[4], [5]]);
  });
  it('D: LEFT JOIN 8행', () => {
    const r = queryFresh(SQL, 'school', 'main', 'SELECT s.student_id,e.course_id,e.score FROM students s LEFT JOIN enrollment e ON s.student_id=e.student_id ORDER BY s.student_id,e.course_id;');
    expect(r.rows.length).toBe(8);
    expect(r.rows.filter((x) => x[1] === null).map((x) => x[0])).toEqual([4, 5]);
  });
  it('E: SQL캠프 동점 순위', () => {
    const r = queryFresh(SQL, 'school', 'main', `SELECT student_id,score,
 RANK() OVER(ORDER BY score DESC) AS r,
 DENSE_RANK() OVER(ORDER BY score DESC) AS dr,
 ROW_NUMBER() OVER(ORDER BY score DESC,student_id) AS rn
FROM enrollment WHERE course_id=101 ORDER BY student_id;`);
    expect(r.rows).toEqual([[1, 90, 1, 1, 1], [2, 90, 1, 1, 2], [3, null, 3, 2, 3]]);
  });
  it('U04-A04: NOT IN (1, NULL) → 0행', () => {
    const r = queryFresh(SQL, 'school', 'main', 'SELECT student_id FROM students WHERE student_id NOT IN (1, NULL);');
    expect(r.rows).toEqual([]);
  });
  it('alt seed도 제약조건을 만족하며 로드된다', () => {
    for (const ds of ['school', 'normal', 'points', 'clubs', 'monthly', 'sandbox'] as const) {
      const db = openDb(SQL, ds, 'alt', { readOnly: true });
      const fk = db.exec('PRAGMA foreign_key_check;');
      expect(fk.length).toBe(0);
      db.close();
      const db2 = openDb(SQL, ds, 'main', { readOnly: true });
      expect(db2.exec('PRAGMA foreign_key_check;').length).toBe(0);
      db2.close();
    }
  });
});

describe('실행 제한', () => {
  it('읽기 활동에서 DML/PRAGMA/ATTACH 차단', () => {
    const db = openDb(SQL, 'school', 'main', { readOnly: true });
    for (const bad of ['DELETE FROM students', "ATTACH 'x.db' AS x", 'PRAGMA query_only=0', 'SELECT 1; DROP TABLE students', 'WITH t AS (SELECT 1) DELETE FROM students', "SELECT load_extension('x')"]) {
      const out = execSql(db, bad, ['select']);
      expect(out.ok, bad).toBe(false);
    }
    expect(db.exec('SELECT COUNT(*) FROM students')[0].values[0][0]).toBe(6);
    db.close();
  });
  it('주석·문자열 안의 키워드는 문장 종류에 영향을 주지 않는다', () => {
    const db = openDb(SQL, 'school', 'main', { readOnly: true });
    const out = execSql(db, "-- DELETE\nSELECT 'DROP; DELETE' AS t /* UPDATE */;", ['select']);
    expect(out.ok).toBe(true);
    db.close();
  });
  it('query_only가 엔진 수준에서 쓰기를 막는다', () => {
    const db = openDb(SQL, 'school', 'main', { readOnly: true });
    expect(() => db.exec('DELETE FROM students')).toThrow();
    db.close();
  });
  it('구문 오류는 위치와 쉬운 설명', () => {
    const db = openDb(SQL, 'school', 'main', { readOnly: true });
    const out = execSql(db, 'SELECT student_id\nFORM students', ['select']);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.message).toContain('문법 오류');
      expect(out.error.line).toBe(2);
    }
    db.close();
  });
  it('트랜잭션 열림 상태 판정', () => {
    const db = openDb(SQL, 'sandbox', 'main', { readOnly: false });
    expect(inTransaction(db)).toBe(false);
    db.exec('BEGIN');
    expect(inTransaction(db)).toBe(true);
    db.exec('ROLLBACK');
    expect(inTransaction(db)).toBe(false);
    db.close();
  });
});

describe('결과 기반 채점', () => {
  const base = { dataset: 'school' as const, ordered: false, allow: ['select' as const] };
  it('다른 정답 표현(JOIN vs 서브쿼리)을 정답 처리', () => {
    const g = gradeSql(SQL, { ...base, solutionSql: 'SELECT s.student_id FROM students s WHERE NOT EXISTS (SELECT 1 FROM enrollment e WHERE e.student_id=s.student_id)', studentSql: 'SELECT s.student_id FROM students s LEFT JOIN enrollment e ON s.student_id=e.student_id WHERE e.student_id IS NULL' });
    expect(g.status === 'graded' && g.pass).toBe(true);
  });
  it('별칭 차이는 무시', () => {
    const g = gradeSql(SQL, { ...base, solutionSql: 'SELECT COUNT(*) AS cnt FROM students', studentSql: 'select count(*) n from students' });
    expect(g.status === 'graded' && g.pass).toBe(true);
  });
  it('중복행 보존: DISTINCT 누락/추가를 구별', () => {
    const g = gradeSql(SQL, { ...base, solutionSql: 'SELECT DISTINCT dept_id FROM students', studentSql: 'SELECT dept_id FROM students' });
    expect(g.status === 'graded' && !g.pass && g.compare.diff?.kind).toBe('extra-row');
  });
  it('NULL 처리: COUNT(*) vs COUNT(score) 구별', () => {
    const g = gradeSql(SQL, { ...base, solutionSql: 'SELECT COUNT(score) FROM enrollment', studentSql: 'SELECT COUNT(*) FROM enrollment' });
    expect(g.status === 'graded' && g.pass).toBe(false);
  });
  it('순서 요구 시 순서 비교, 아니면 무시', () => {
    const sol = 'SELECT student_id FROM students ORDER BY student_id DESC';
    const stu = 'SELECT student_id FROM students ORDER BY student_id';
    const a = gradeSql(SQL, { ...base, ordered: true, solutionSql: sol, studentSql: stu });
    expect(a.status === 'graded' && a.compare.diff?.kind).toBe('order');
    const b = gradeSql(SQL, { ...base, ordered: false, solutionSql: sol, studentSql: stu });
    expect(b.status === 'graded' && b.pass).toBe(true);
  });
  it('빈 결과도 정확히 채점', () => {
    const g = gradeSql(SQL, { ...base, solutionSql: 'SELECT student_id FROM students WHERE student_id NOT IN (1, NULL)', studentSql: 'SELECT student_id FROM students WHERE 1=0' });
    expect(g.status === 'graded' && g.pass).toBe(true);
  });
  it('하드코딩 답은 alt seed에서 걸러진다', () => {
    const g = gradeSql(SQL, { ...base, solutionSql: 'SELECT s.student_id FROM students s WHERE NOT EXISTS (SELECT 1 FROM enrollment e WHERE e.student_id=s.student_id)', studentSql: 'SELECT student_id FROM students WHERE student_id IN (4,5)' });
    expect(g.status === 'graded' && !g.pass && g.failedOnAltSeed).toBe(true);
  });
  it('부동소수 허용오차', () => {
    const g = gradeSql(SQL, { ...base, solutionSql: 'SELECT AVG(score) FROM enrollment', studentSql: 'SELECT SUM(score)*1.0/COUNT(score) FROM enrollment' });
    expect(g.status === 'graded' && g.pass).toBe(true);
  });
  it('NULL·빈문자열·0 구별', () => {
    const g = gradeSql(SQL, { ...base, solutionSql: 'SELECT NULL', studentSql: "SELECT ''" });
    expect(g.status === 'graded' && g.pass).toBe(false);
    const h = gradeSql(SQL, { ...base, solutionSql: 'SELECT 0', studentSql: "SELECT ''" });
    expect(h.status === 'graded' && h.pass).toBe(false);
  });
  it('잘못된 SQL은 오류', () => {
    const g = gradeSql(SQL, { ...base, solutionSql: 'SELECT 1', studentSql: 'SELEC 1' });
    expect(g.status).toBe('error');
  });
  it('DML은 실행 후 상태로 판정', () => {
    const g = gradeSql(SQL, { dataset: 'sandbox', ordered: true, allow: ['update'], solutionSql: "UPDATE camp_signup SET status='확정' WHERE status='신청'", studentSql: "update camp_signup set status = '확정' where status <> '확정' and status <> '취소'", stateCheckSql: 'SELECT * FROM camp_signup ORDER BY signup_id' });
    expect(g.status === 'graded' && g.pass).toBe(true);
  });
});
