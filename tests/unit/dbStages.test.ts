import { describe, expect, it } from 'vitest';
import { STAGE_COUNTS, UNIT_STAGES, type StageMatch } from '../../src/content/stages';
import { UNIT_IDS } from '../../src/content';
import { ALL_DATASETS, seedSql } from '../../src/sql/datasets';
import { loadSql } from './sqljs';
import { guardSql } from '../../src/sql/guard';

/**
 * 데이터베이스 단원 단계 콘텐츠 검사(단원별: npx vitest run tests/unit/dbStages.test.ts -t U03).
 * 형식·길이·짝 맞추기 규칙과, 실습 SQL이 실제 SQLite(sql.js)에서 실행되는지 확인한다.
 */
function checkMatch(m: StageMatch, text: string, where: string) {
  expect(m.pairs, where).toHaveLength(3);
  const terms = m.pairs.map((p) => p.term);
  expect(new Set(terms).size, `${where} 용어 중복`).toBe(3);
  expect(new Set(m.pairs.map((p) => p.desc)).size, `${where} 뜻 중복`).toBe(3);
  expect(terms, `${where} 함정이 정답과 같음`).not.toContain(m.distractor);
  expect(m.distractor.length, `${where} 함정 길이`).toBeGreaterThan(0);
  expect(m.distractor.length, `${where} 함정 길이`).toBeLessThanOrEqual(30);
  for (const p of m.pairs) {
    expect(p.term.length, `${where} 용어 길이: ${p.term}`).toBeLessThanOrEqual(30);
    expect(text.includes(p.term), `${where} 용어가 본문에 없음: ${p.term}`).toBe(true);
    expect(p.desc.length, `${where} 뜻 길이: ${p.desc}`).toBeGreaterThanOrEqual(8);
    expect(p.desc.length, `${where} 뜻 길이: ${p.desc}`).toBeLessThanOrEqual(70);
    for (const t of terms) expect(p.desc.includes(t), `${where} 뜻에 용어가 드러남: "${p.desc}" ⊃ "${t}"`).toBe(false);
  }
}

describe.each(UNIT_IDS)('%s 단계 콘텐츠', (u) => {
  const st = UNIT_STAGES[u];
  it(`${u} 개수 표(meta.ts)가 내용과 같다`, () => {
    expect(STAGE_COUNTS[u]).toEqual({ cards: st.cards.length, quiz: st.quiz.length, practice: st.practice.length });
  });
  it(`${u} 이론 카드: 5~7장, 짝 맞추기 규칙`, () => {
    expect(st.unit).toBe(u);
    expect(st.cards.length).toBeGreaterThanOrEqual(5);
    expect(st.cards.length).toBeLessThanOrEqual(7);
    st.cards.forEach((c, i) => {
      expect(c.id).toBe(`${u}-t${i + 1}`);
      expect(c.title.length, c.id).toBeLessThanOrEqual(40);
      expect(c.points.length, c.id).toBeGreaterThanOrEqual(2);
      expect(c.points.length, c.id).toBeLessThanOrEqual(5);
      for (const p of c.points) expect(p.length, `${c.id} 문장 길이`).toBeLessThanOrEqual(140);
      if (c.table) for (const r of c.table.rows) expect(r.length, `${c.id} 표 열 수`).toBe(c.table.header.length);
      if (c.tip) expect(c.tip.length, `${c.id} 팁 길이`).toBeLessThanOrEqual(90);
      const text = [c.title, ...c.points, c.tip ?? '', ...(c.table ? [...c.table.header, ...c.table.rows.flat()] : [])].join('\n');
      checkMatch(c.match, text, c.id);
    });
  });
  it(`${u} 개념 점검: 10문항, 보기 4개, 정답 고르게`, () => {
    expect(st.quiz).toHaveLength(10);
    const count = [0, 0, 0, 0];
    st.quiz.forEach((q, i) => {
      expect(q.id).toBe(`${u}-c${i + 1}`);
      expect(q.options, q.id).toHaveLength(4);
      expect(new Set(q.options).size, `${q.id} 보기 중복`).toBe(4);
      expect(q.answer, q.id).toBeGreaterThanOrEqual(0);
      expect(q.answer, q.id).toBeLessThanOrEqual(3);
      expect(q.question.length, q.id).toBeLessThanOrEqual(220);
      expect(q.explanation.length, `${q.id} 해설`).toBeGreaterThanOrEqual(15);
      expect(q.tag.length, `${q.id} 태그`).toBeGreaterThan(0);
      count[q.answer]++;
    });
    for (const n of count) expect(n, `${u} 정답 번호 분포 ${count}`).toBeLessThanOrEqual(4);
  });
  it(`${u} 실습 예제: 3~4개, SQL 실제 실행, SQL 조각 맞추기`, async () => {
    expect(st.practice.length).toBeGreaterThanOrEqual(3);
    expect(st.practice.length).toBeLessThanOrEqual(4);
    const SQL = await loadSql();
    st.practice.forEach((p, i) => expect(p.id).toBe(`${u}-p${i + 1}`));
    for (const p of st.practice) {
      expect(ALL_DATASETS, p.id).toContain(p.dataset);
      expect(p.sql.length, `${p.id} SQL 길이`).toBeLessThanOrEqual(700);
      expect(p.goal.length, `${p.id} 목표`).toBeLessThanOrEqual(120);
      expect(p.steps.length, p.id).toBeGreaterThanOrEqual(2);
      expect(p.steps.length, p.id).toBeLessThanOrEqual(5);
      for (const s of p.steps) expect(s.length, `${p.id} 설명 길이`).toBeLessThanOrEqual(160);
      checkMatch(p.match, p.sql, p.id);
      if (p.run) {
        // 화면의 '실행해 보기'는 앱의 SQL 검사(guardSql)를 거친다
        const g = guardSql(p.sql, ['select', 'insert', 'update', 'delete', 'create', 'drop', 'alter', 'tcl']);
        expect(g.ok, `${p.id} SQL 검사 통과: ${'message' in g ? g.message : ''}`).toBe(true);
        const db = new SQL.Database();
        db.run(seedSql(p.dataset, 'main'));
        let res: ReturnType<typeof db.exec> = [];
        expect(() => { res = db.exec(p.sql); }, `${p.id} 실행 오류`).not.toThrow();
        // 조회 예제는 결과가 1행 이상이어야 읽을 수 있다(변경 예제는 마지막에 확인용 SELECT를 붙인다)
        expect(res.length, `${p.id} 결과 없음`).toBeGreaterThan(0);
        expect(res[res.length - 1].values.length, `${p.id} 결과 0행`).toBeGreaterThan(0);
        db.close();
      }
    }
  });
});
