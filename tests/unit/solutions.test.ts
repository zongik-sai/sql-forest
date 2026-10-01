import { beforeAll, describe, expect, it } from 'vitest';
import type { SqlJsStatic } from 'sql.js';
import { ACTIVITIES, CHALLENGES, CHECKPOINTS, FINAL_DIAGNOSTIC, VARIANTS } from '../../src/content';
import { executableSqlOf } from '../../src/content/validate';
import type { LessonActivity, Prediction } from '../../src/content/types';
import { execSql, gradeSql, inTransaction, openDb, openSessionDb, queryFresh } from '../../src/sql/engine';
import { fillTemplate, slotCombinations } from '../../src/content/template';
import { compareResults } from '../../src/sql/grader/compare';
import { loadSql } from './sqljs';

let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await loadSql();
});

const ALL_ACTIVITIES: LessonActivity[] = [...ACTIVITIES, ...CHALLENGES.map((c) => c.activity)];

function firstValue(ds: LessonActivity['datasetId'], sql: string): string {
  const r = queryFresh(SQL, ds, 'main', sql);
  return String(r.rows[0]?.[0]);
}

function checkPrediction(a: LessonActivity, p: Prediction | undefined) {
  if (!p?.verifySql) return;
  const v = firstValue(a.datasetId, p.verifySql);
  const opt = p.options[p.correctIndex];
  expect(opt.includes(v), `${a.id} 예측 정답 '${opt}'에 실제 값 '${v}'가 없음`).toBe(true);
  // 다른 선택지에는 같은 값이 없어야 한다
  p.options.forEach((o, i) => {
    if (i !== p.correctIndex) expect(o === v, `${a.id} 오답 선택지가 실제 값과 같음`).toBe(false);
  });
}

describe.each(ALL_ACTIVITIES.map((a) => [a.id, a] as const))('활동 %s', (_id, a) => {
  it('설정의 모든 SQL이 실제 엔진에서 실행된다(main/alt seed)', () => {
    const c = a.config;
    for (const seed of ['main', 'alt'] as const) {
      if (c.kind === 'transaction') {
        const db = openSessionDb(SQL, a.datasetId, c.initialLog);
        expect(execSql(db, c.stateSql, ['select']).ok).toBe(true);
        db.close();
        continue;
      }
      for (const s of executableSqlOf(a)) {
        const isWrite = !/^\s*(SELECT|WITH|--)/i.test(s) && !/^\s*VALUES/i.test(s);
        const db = openDb(SQL, a.datasetId, seed, { readOnly: !isWrite });
        const out = execSql(db, s, ['select', 'insert', 'update', 'delete', 'tcl']);
        expect(out.ok, `${a.id} [${seed}] 실행 실패: ${!out.ok ? out.error.raw : ''}\n${s}`).toBe(true);
        db.close();
      }
    }
  });

  it('예측/확인 질문의 데이터 의존 정답이 실제 결과와 일치', () => {
    checkPrediction(a, a.prediction);
    if (a.config.kind === 'predict-result') checkPrediction(a, a.config.check);
  });

  it('정답이 채점기를 통과하고, 의미 있는 오답은 걸러진다', () => {
    const c = a.config;
    switch (c.kind) {
      case 'sql-editor':
      case 'sql-blocks': {
        const allow = c.kind === 'sql-editor' ? c.allow ?? ['select'] : ['select' as const];
        const stateCheckSql = c.kind === 'sql-editor' ? c.stateCheckSql : undefined;
        const g = gradeSql(SQL, { dataset: a.datasetId, studentSql: c.solutionSql, solutionSql: c.solutionSql, ordered: c.ordered, allow, stateCheckSql });
        expect(g.status === 'graded' && g.pass, `${a.id} 정답 자기채점 실패`).toBe(true);
        if (a.solution.sql && !a.solution.sql.trim().startsWith('--')) {
          const g2 = gradeSql(SQL, { dataset: a.datasetId, studentSql: a.solution.sql, solutionSql: c.solutionSql, ordered: c.ordered, allow, stateCheckSql });
          expect(g2.status === 'graded' && g2.pass, `${a.id} 표시용 정답 SQL이 채점 정답과 다름: ${JSON.stringify(g2)}`).toBe(true);
        }
        if (c.kind === 'sql-editor' && c.starterSql.trim()) {
          const g3 = gradeSql(SQL, { dataset: a.datasetId, studentSql: c.starterSql, solutionSql: c.solutionSql, ordered: c.ordered, allow, stateCheckSql });
          expect(g3.status === 'graded' && g3.pass, `${a.id} 시작 SQL이 이미 정답`).toBe(false);
        }
        if (c.kind === 'sql-blocks') {
          // 블록만으로 정답을 조립할 수 있어야 한다
          const tokens = c.solutionSql.replace(/,/g, ' , ').split(/\s+/).filter(Boolean);
          for (const t of tokens) expect(c.blocks, `${a.id} 블록에 ${t} 없음`).toContain(t);
        }
        break;
      }
      case 'row-filter': {
        const combos = slotCombinations(c.slots);
        let passCount = 0;
        for (const combo of combos) {
          const sql = fillTemplate(c.template, combo);
          const g = gradeSql(SQL, { dataset: a.datasetId, studentSql: sql, solutionSql: c.solutionSql, ordered: c.ordered, allow: ['select'] });
          if (g.status === 'graded' && g.pass) passCount++;
        }
        expect(passCount, `${a.id} 어떤 조합도 정답이 아님`).toBeGreaterThan(0);
        expect(passCount, `${a.id} 모든 조합이 정답(의미 없는 조작)`).toBeLessThan(combos.length);
        break;
      }
      case 'classify': {
        if (c.answer.source === 'sql') {
          const r = queryFresh(SQL, a.datasetId, 'main', c.answer.sql);
          const map = Object.fromEntries(r.rows.map((row) => [String(row[0]), String(row[1])]));
          for (const it of c.items) {
            expect(map[it.id], `${a.id} 항목 ${it.id}의 SQL 정답 없음`).toBeDefined();
            expect(c.options.map((o) => o.id), `${a.id} SQL 정답 ${map[it.id]}가 선택지에 없음`).toContain(map[it.id]);
          }
        }
        if (c.patterns && c.answer.source === 'static') {
          for (const it of c.items) {
            const hit = c.patterns.find((p) => new RegExp(p.regex).test(it.label));
            expect(hit?.optionId ?? c.fallbackOptionId, `${a.id} 정규식 시뮬레이션 결과와 정답 불일치: ${it.label}`).toBe(c.answer.map[it.id]);
          }
        }
        break;
      }
      case 'join-visualizer': {
        const left = queryFresh(SQL, a.datasetId, 'main', c.leftSql).rows.map((r) => String(r[0]));
        const right = queryFresh(SQL, a.datasetId, 'main', c.rightSql).rows.map((r) => String(r[0]));
        const pairs = queryFresh(SQL, a.datasetId, 'main', c.pairsSql).rows;
        expect(pairs.length).toBeGreaterThan(0);
        for (const [l, r] of pairs) {
          expect(left).toContain(String(l));
          if (r !== null) expect(right).toContain(String(r));
          else expect(c.keepUnmatchedLeft, `${a.id} INNER인데 NULL 짝`).toBe(true);
        }
        break;
      }
      case 'group-visualizer': {
        const rows = queryFresh(SQL, a.datasetId, 'main', c.rowsSql).rows.map((r) => String(r[0]));
        const g = queryFresh(SQL, a.datasetId, 'main', c.groupOfRowSql).rows;
        expect(g.map((r) => String(r[0])).sort()).toEqual([...rows].sort());
        const groups = new Set(g.map((r) => String(r[1])));
        const agg = queryFresh(SQL, a.datasetId, 'main', c.aggregateSql).rows;
        expect(new Set(agg.map((r) => String(r[0])))).toEqual(groups);
        break;
      }
      case 'window-visualizer': {
        const rows = queryFresh(SQL, a.datasetId, 'main', c.rowsSql).rows.map((r) => String(r[0]));
        const ans = queryFresh(SQL, a.datasetId, 'main', c.answerSql);
        expect(ans.rows.map((r) => String(r[0])).sort()).toEqual([...rows].sort());
        expect(ans.columns.length).toBeGreaterThan(1);
        break;
      }
      case 'transaction': {
        const db = openSessionDb(SQL, a.datasetId, [...c.initialLog, ...c.solutionActions]);
        if (c.requireClosed) expect(inTransaction(db)).toBe(false);
        const target = execSql(db, c.stateSql, ['select']);
        db.close();
        // 시작 상태 그대로 COMMIT/ROLLBACK만 하면 오답이어야 한다
        for (const naive of ['COMMIT', 'ROLLBACK']) {
          const d2 = openSessionDb(SQL, a.datasetId, c.initialLog);
          try { d2.exec(naive); } catch { /* 열린 트랜잭션이 없으면 무시 */ }
          const st = execSql(d2, c.stateSql, ['select']);
          d2.close();
          if (target.ok && st.ok && target.last && st.last && c.initialLog.length) {
            expect(compareResults(target.last, st.last, { ordered: true }).pass, `${a.id} '${naive}'만으로 정답이 됨`).toBe(false);
          }
        }
        // 정답 동작이 모두 버튼으로 존재
        for (const s of c.solutionActions) expect(c.actions.map((x) => x.sql)).toContain(s);
        break;
      }
      case 'pivot': {
        const ans = queryFresh(SQL, a.datasetId, 'main', c.answerSql);
        const eq = queryFresh(SQL, a.datasetId, 'main', c.equivalentSql);
        expect(compareResults(ans, eq, { ordered: false }).pass).toBe(true);
        break;
      }
      case 'hierarchy': {
        const nodes = queryFresh(SQL, a.datasetId, 'main', c.nodesSql).rows.map((r) => String(r[0]));
        const ans = queryFresh(SQL, a.datasetId, 'main', c.answerSql).rows.map((r) => String(r[0]));
        expect(ans.length).toBeGreaterThan(0);
        for (const id of ans) expect(nodes).toContain(id);
        break;
      }
      case 'erd':
      case 'normalize':
      case 'predict-result':
        break;
    }
  });
});

describe('문항 정답 검증', () => {
  const qs = [...CHECKPOINTS, ...VARIANTS, ...FINAL_DIAGNOSTIC];
  it.each(qs.filter((q) => q.body.type === 'sql').map((q) => [q.id, q] as const))('%s SQL 정답이 main/alt에서 실행되고 자기채점 통과', (_id, q) => {
    if (q.body.type !== 'sql') return;
    const g = gradeSql(SQL, { dataset: q.body.datasetId, studentSql: q.body.solutionSql, solutionSql: q.body.solutionSql, ordered: q.body.ordered, allow: q.body.allow ?? ['select'], stateCheckSql: q.body.stateCheckSql });
    expect(g.status === 'graded' && g.pass, JSON.stringify(g)).toBe(true);
    if (q.body.starterSql.trim()) {
      const s = gradeSql(SQL, { dataset: q.body.datasetId, studentSql: q.body.starterSql, solutionSql: q.body.solutionSql, ordered: q.body.ordered, allow: q.body.allow ?? ['select'], stateCheckSql: q.body.stateCheckSql });
      expect(s.status === 'graded' && s.pass).toBe(false);
    }
  });
  it.each(qs.filter((q) => q.verify).map((q) => [q.id, q] as const))('%s 데이터 의존 정답 확인', (_id, q) => {
    const r = queryFresh(SQL, q.verify!.datasetId, 'main', q.verify!.sql);
    const v = r.rows[0]?.[0];
    if (q.body.type === 'number') expect(v).toBe(q.body.answer);
    if (q.body.type === 'choice') expect(q.body.options[q.body.correctIndex]).toContain(String(v));
  });
});
