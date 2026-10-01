import { ACTIVITIES, CHALLENGES, CHECKPOINTS, FINAL_DIAGNOSTIC, PRE_DIAGNOSTIC, UNITS, VARIANTS } from './index';
import { fillTemplate, slotCombinations } from './template';
import type { LessonActivity, Question, QuestionArea } from './types';

/**
 * 콘텐츠 검증기(SQL 실행 없이 구조 검사). 정답 SQL 실행 검증은 tests/unit/solutions.test.ts.
 * 각 분류의 수량을 따로 검사한다(합계만으로 검증하지 않음).
 */

/** 02_CURRICULUM의 핵심 개념이 단원 콘텐츠(활동·체크포인트)에 실제로 등장하는지 확인할 키워드 */
export const REQUIRED_TOPICS: Record<string, string[]> = {
  U01: ['모델링', '추상화', '단순화', '명확화', '개념 모델', '논리 모델', '물리 모델', '엔터티', '인스턴스', '속성', '도메인'],
  U02: ['관계', '차수', '선택성', '식별 관계', '비식별 관계', '기본키', '외래키', '본질 식별자', '인조 식별자', '함수 종속', '1정규형', '2정규형', '3정규형', 'NULL', '트랜잭션'],
  U03: ['관계형 DB', 'SELECT', 'FROM', '별칭', 'DISTINCT', '산술식', '논리적 처리 순서'],
  U04: ['비교 연산자', 'AND', 'OR', 'NOT', '괄호', 'IN', 'BETWEEN', 'LIKE', 'NULL', 'IS NULL', '3값 논리'],
  U05: ['UPPER', 'ROUND', 'DATE', 'CAST', 'COALESCE', 'NULLIF', 'CASE', 'Oracle', 'SQL Server'],
  U06: ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COUNT(*)', 'GROUP BY', 'HAVING', 'ORDER BY'],
  U07: ['INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'USING', 'NATURAL JOIN', '다대다', '중간 테이블', 'ON'],
  U08: ['단일행 서브쿼리', '다중행 서브쿼리', '상관 서브쿼리', '스칼라', '인라인 뷰', 'IN', 'EXISTS', 'ANY', 'ALL', 'UNION', 'UNION ALL', 'INTERSECT', 'EXCEPT', 'MINUS'],
  U09: ['OVER', 'PARTITION BY', 'RANK', 'DENSE_RANK', 'ROW_NUMBER', 'LAG', 'LEAD', '누적', 'ROWS', 'RANGE', 'Top N'],
  U10: ['ROLLUP', 'CUBE', 'GROUPING SETS', 'GROUPING(', '계층형', '셀프조인', 'PIVOT', 'UNPIVOT', '정규표현식'],
  U11: ['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'ACID', 'DDL', '제약조건', 'DCL', 'TRUNCATE', 'DROP'],
  U12: ['EXISTS', 'LEFT JOIN', 'GROUP BY', 'RANK'],
};

/** 실행형(executable)으로 표시하면 안 되는 SQLite 미지원 문법 */
const UNSUPPORTED = [/\bROLLUP\s*\(/i, /\bCUBE\s*\(/i, /\bGROUPING\s+SETS\b/i, /\bPIVOT\s*\(/i, /\bCONNECT\s+BY\b/i, /\bSTART\s+WITH\b/i, /\bMERGE\s+INTO\b/i, /\bREGEXP_\w+/i, /\bNVL\s*\(/i, /\bDECODE\s*\(/i, /\bROWNUM\b/i, /\bSELECT\s+TOP\b/i, /\bGRANT\b/i, /\bREVOKE\b/i, /\bTRUNCATE\s+TABLE\b/i, /\bMINUS\b/];

function sentences(s: string): number {
  return s.split(/(?<=[.?!])\s+/).filter((x) => x.trim().length > 0).length;
}

/** 활동 설정에서 실제로 실행되는 SQL 목록 */
export function executableSqlOf(a: LessonActivity): string[] {
  const c = a.config;
  const out: string[] = [];
  switch (c.kind) {
    case 'sql-editor': out.push(c.solutionSql, ...(c.explore ?? []).map((e) => e.sql)); if (c.stateCheckSql) out.push(c.stateCheckSql); break;
    case 'sql-blocks': out.push(c.solutionSql); break;
    case 'predict-result': out.push(c.sql, ...(c.compareSql ?? []).map((e) => e.sql)); break;
    case 'row-filter': out.push(c.solutionSql, c.baseSql, ...slotCombinations(c.slots).map((v) => fillTemplate(c.template, v))); break;
    case 'join-visualizer': out.push(c.leftSql, c.rightSql, c.pairsSql, c.joinSql, ...(c.altJoinSql ?? []).map((e) => e.sql)); break;
    case 'group-visualizer': out.push(c.rowsSql, c.groupOfRowSql, c.aggregateSql, c.groupSql); break;
    case 'window-visualizer': out.push(c.rowsSql, c.answerSql, c.windowSql); break;
    case 'transaction': out.push(c.stateSql, ...c.initialLog, ...c.actions.map((x) => x.sql)); break;
    case 'pivot': out.push(c.sourceSql, c.answerSql, c.equivalentSql); break;
    case 'hierarchy': out.push(c.nodesSql, c.answerSql, ...c.runnable.map((r) => r.sql)); break;
    case 'classify': if (c.answer.source === 'sql') out.push(c.answer.sql); if (c.demoSql) out.push(c.demoSql); break;
    case 'normalize': out.push(c.sourceSql, c.rejoinSql); break;
    case 'erd': break;
  }
  return out;
}

export function validateContent(): string[] {
  const errors: string[] = [];
  const err = (m: string) => errors.push(m);

  // 1) 수량 — 분류별로 따로
  if (UNITS.length !== 12) err(`단원 수 ${UNITS.length} ≠ 12`);
  if (ACTIVITIES.length !== 48) err(`핵심 활동 수 ${ACTIVITIES.length} ≠ 48`);
  if (CHECKPOINTS.length !== 36) err(`체크포인트 수 ${CHECKPOINTS.length} ≠ 36`);
  if (VARIANTS.length !== 36) err(`변형 문항 수 ${VARIANTS.length} ≠ 36`);
  if (PRE_DIAGNOSTIC.length !== 5) err(`최초 진단 ${PRE_DIAGNOSTIC.length} ≠ 5`);
  if (FINAL_DIAGNOSTIC.length !== 12) err(`최종 진단 ${FINAL_DIAGNOSTIC.length} ≠ 12`);
  if (CHALLENGES.length !== 12) err(`도전 문제 ${CHALLENGES.length} ≠ 12`);

  // 2) ID 중복
  const allIds = [...UNITS.map((u) => u.id), ...ACTIVITIES.map((a) => a.id), ...CHECKPOINTS.map((q) => q.id), ...VARIANTS.map((q) => q.id), ...PRE_DIAGNOSTIC.map((q) => q.id), ...FINAL_DIAGNOSTIC.map((q) => q.id), ...CHALLENGES.map((c) => c.id)];
  const seen = new Set<string>();
  for (const id of allIds) {
    if (seen.has(id)) err(`ID 중복: ${id}`);
    seen.add(id);
  }

  // 3) 단원 참조·시간
  let total = 0;
  for (const u of UNITS) {
    const acts = u.activityIds.map((id) => ACTIVITIES.find((a) => a.id === id));
    acts.forEach((a, i) => { if (!a) err(`${u.id}: 활동 참조 누락 ${u.activityIds[i]}`); else if (a.unitId !== u.id) err(`${a.id}: unitId 불일치`); });
    u.checkpointIds.forEach((id) => { const q = CHECKPOINTS.find((x) => x.id === id); if (!q) err(`${u.id}: 체크포인트 참조 누락 ${id}`); else if (q.unitId !== u.id) err(`${id}: unitId 불일치`); });
    if (u.activityIds.length !== 4) err(`${u.id}: 활동 4개가 아님`);
    if (u.checkpointIds.length !== 3) err(`${u.id}: 체크포인트 3개가 아님`);
    const mins = acts.reduce((s, a) => s + (a?.estimatedMinutes ?? 0), 0) + u.checkpointMinutes + u.extraMinutes;
    if (mins !== u.minutes) err(`${u.id}: 시간 합계 ${mins} ≠ ${u.minutes}`);
    total += u.minutes;
    const interactive = acts.filter((a) => a && a.kind !== 'predict-result').length;
    if (interactive < 2) err(`${u.id}: 직접 SQL/의미 있는 조작 활동이 2개 미만`);
    const unitText = JSON.stringify([acts, u.checkpointIds.map((id) => CHECKPOINTS.find((q) => q.id === id)), VARIANTS.filter((v) => v.unitId === u.id)]);
    for (const topic of REQUIRED_TOPICS[u.id] ?? []) {
      if (!unitText.includes(topic)) err(`${u.id}: 핵심 주제 '${topic}'가 콘텐츠에 없음`);
    }
  }
  if (total !== 360) err(`전체 시간 ${total} ≠ 360`);
  if (CHALLENGES.map((c) => c.unitId).sort().join() !== UNITS.map((u) => u.id).sort().join()) err('도전 문제가 단원당 1개가 아님');

  // 4) 활동 형식
  const checkActivity = (a: LessonActivity, core: boolean) => {
    const p = a.id;
    if (a.kind !== a.config.kind) err(`${p}: kind와 config.kind 불일치`);
    if (core && !a.id.startsWith(a.unitId + '-A')) err(`${p}: ID 형식`);
    if (a.hints.length !== 3 || a.hints.some((h) => !h.trim())) err(`${p}: 힌트 3단계 누락`);
    if (!a.solution.reasoning.trim()) err(`${p}: 해설 누락`);
    if (!a.successMessage.trim()) err(`${p}: 성공 문구 누락`);
    if (core) {
      if (!a.glossary.length) err(`${p}: 용어 정의 누락`);
      const len = a.explanation.length;
      if (len < 90 || len > 260) err(`${p}: 설명 길이 ${len}자 (100~250자 권장)`);
      const n = sentences(a.explanation);
      if (n < 2 || n > 4) err(`${p}: 설명 문장 수 ${n} (2~4)`);
    }
    if (a.prediction) {
      if (a.prediction.correctIndex < 0 || a.prediction.correctIndex >= a.prediction.options.length) err(`${p}: 예측 정답 범위`);
    }
    const c = a.config;
    if (c.kind === 'classify') {
      const itemIds = c.items.map((i) => i.id);
      if (new Set(itemIds).size !== itemIds.length) err(`${p}: 항목 ID 중복`);
      const optIds = new Set(c.options.map((o) => o.id));
      if (c.answer.source === 'static') {
        for (const id of itemIds) if (!c.answer.map[id]) err(`${p}: 항목 ${id} 정답 없음`);
        for (const v of Object.values(c.answer.map)) if (!optIds.has(v)) err(`${p}: 정답 ${v}가 선택지에 없음`);
        if (c.layout === 'order') {
          const vals = Object.values(c.answer.map);
          if (new Set(vals).size !== vals.length) err(`${p}: 순서 정답이 중복`);
        }
      }
    }
    if (c.kind === 'erd') {
      for (const r of c.relations) if (!c.answer[r.id] || !r.options.some((o) => o.id === c.answer[r.id])) err(`${p}: 관계 ${r.id} 정답 오류`);
    }
    if (c.kind === 'normalize') {
      for (const col of c.columns) if (!c.tables.some((t) => t.id === c.answer[col.id])) err(`${p}: 열 ${col.id} 정답 오류`);
    }
    if (c.kind === 'predict-result' && (c.check.correctIndex < 0 || c.check.correctIndex >= c.check.options.length)) err(`${p}: 확인 질문 정답 범위`);
    // 실행형 표시와 미지원 문법
    const sqls = executableSqlOf(a);
    for (const s of sqls) {
      const stripped = s.replace(/--[^\n]*/g, '');
      for (const re of UNSUPPORTED) if (re.test(stripped)) err(`${p}: 실제 실행 SQL에 SQLite 미지원 문법(${re}) 포함`);
    }
    if (a.mode !== 'executable' && !(a.dialectNotes?.length) && a.mode === 'dialect-comparison') err(`${p}: 문법 비교 활동에 dialectNotes 없음`);
  };
  ACTIVITIES.forEach((a) => checkActivity(a, true));
  CHALLENGES.forEach((c) => { checkActivity(c.activity, false); if (!c.id.startsWith('CH-')) err(`${c.id}: 도전 ID 형식`); });

  // 5) 문항 형식
  const checkQuestion = (q: Question) => {
    if (!q.prompt.trim()) err(`${q.id}: 지문 누락`);
    if (!q.explanation.trim()) err(`${q.id}: 해설 누락`);
    if ((q.set === 'checkpoint' || q.set === 'variant' || q.set === 'final') && !q.review.trim()) err(`${q.id}: 복습 문구 누락`);
    if (q.body.type === 'choice' && (q.body.correctIndex < 0 || q.body.correctIndex >= q.body.options.length)) err(`${q.id}: 정답 범위`);
  };
  [...CHECKPOINTS, ...VARIANTS, ...PRE_DIAGNOSTIC, ...FINAL_DIAGNOSTIC].forEach(checkQuestion);
  for (const v of VARIANTS) {
    const o = CHECKPOINTS.find((c) => c.id === v.variantOf);
    if (!o) err(`${v.id}: 원문 ${v.variantOf} 없음`);
    else if (o.unitId !== v.unitId) err(`${v.id}: 원문과 단원 불일치`);
  }
  if (new Set(VARIANTS.map((v) => v.variantOf)).size !== 36) err('모든 체크포인트에 변형이 1개씩 있어야 함');

  const want: Record<QuestionArea, number> = { modeling: 2, basic: 3, 'aggregate-join': 3, advanced: 3, management: 1 };
  for (const [area, n] of Object.entries(want)) {
    const got = FINAL_DIAGNOSTIC.filter((q) => q.area === area).length;
    if (got !== n) err(`최종 진단 ${area} ${got} ≠ ${n}`);
  }
  // 객관식만으로 채우지 않았는지
  const kinds = new Set(ACTIVITIES.map((a) => a.kind));
  for (const k of ['sql-editor', 'sql-blocks', 'predict-result', 'row-filter', 'classify'] as const) if (!kinds.has(k)) err(`활동 종류 ${k} 없음`);
  return errors;
}
