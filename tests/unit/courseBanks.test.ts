import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NEW_COURSES } from '../../src/features/computer/courses/defs';

/**
 * 새 과목(네트워크·프로그래밍·Data) 단원 원본 검사. 컴퓨터 일반 pc_bank.json 단원과 같은 형식 +
 * 이론 카드의 개념 맞추기(match)·선택 code, 문항의 선택 code.
 * 단원 하나만: npx vitest run tests/unit/courseBanks.test.ts -t "net-U3"
 */
interface Match { pairs: { term: string; desc: string }[]; distractor: string }
interface Table { head: string[]; rows: string[][] }
interface RawQ { id: string; q: string; code?: string; o: string[]; a: number; exp: string; area: string; type?: string }
interface RawUnit {
  unit: number; title: string; intro: string;
  theory: { id: string; title: string; points: string[]; table?: Table; tip?: string; code?: string; ext: boolean; match: Match }[];
  bank: string[];
  fill: { id: string; text: string; answer: string; exp: string }[];
  basic: RawQ[];
  summary: { keys: { k: string; v: string }[]; compare: (Table & { title: string })[]; traps: string[] };
  advanced: RawQ[];
}

const COUNTS = { theory: 10, fill: 20, bank: 30, basic: 20, advanced: 15 };
const TYPES = ['계산', '응용', '부정형', '비교', '코드', '확장'];

function checkTable(t: Table | undefined, where: string) {
  if (!t) return;
  expect(t.head.length, `${where} 표 머리`).toBeGreaterThanOrEqual(2);
  for (const r of t.rows) expect(r.length, `${where} 표 열 수`).toBe(t.head.length);
}
function checkCode(code: string | undefined, where: string) {
  if (code === undefined) return;
  expect(code.split('\n').length, `${where} 코드 줄 수`).toBeLessThanOrEqual(16);
  expect(code.length, `${where} 코드 길이`).toBeLessThanOrEqual(700);
}
function checkMatch(m: Match, text: string, where: string) {
  expect(m.pairs, where).toHaveLength(3);
  const terms = m.pairs.map((p) => p.term);
  expect(new Set(terms).size, `${where} 용어 중복`).toBe(3);
  expect(new Set(m.pairs.map((p) => p.desc)).size, `${where} 뜻 중복`).toBe(3);
  expect(terms, `${where} 함정이 정답과 같음`).not.toContain(m.distractor);
  expect(m.distractor.length, `${where} 함정 길이`).toBeGreaterThan(0);
  expect(m.distractor.length, `${where} 함정 길이`).toBeLessThanOrEqual(30);
  for (const p of m.pairs) {
    expect(p.term.length, `${where} 용어 길이: ${p.term}`).toBeLessThanOrEqual(30);
    expect(text.includes(p.term), `${where} 용어가 카드에 없음: ${p.term}`).toBe(true);
    expect(p.desc.length, `${where} 뜻 길이: ${p.desc}`).toBeGreaterThanOrEqual(8);
    expect(p.desc.length, `${where} 뜻 길이: ${p.desc}`).toBeLessThanOrEqual(70);
    for (const t of terms) expect(p.desc.includes(t), `${where} 뜻에 용어가 드러남: "${p.desc}" ⊃ "${t}"`).toBe(false);
  }
}
function checkMcq(q: RawQ, id: string, areas: string[], where: string, check: boolean) {
  expect(q.id, where).toBe(id);
  expect(q.q.length, `${where} 질문 길이`).toBeLessThanOrEqual(260);
  checkCode(q.code, where);
  expect(q.o, where).toHaveLength(4);
  expect(new Set(q.o).size, `${where} 보기 중복`).toBe(4);
  for (const o of q.o) expect(o.length, `${where} 보기 길이`).toBeLessThanOrEqual(120);
  expect(q.a, where).toBeGreaterThanOrEqual(0);
  expect(q.a, where).toBeLessThanOrEqual(3);
  expect(q.exp.length, `${where} 해설`).toBeGreaterThanOrEqual(15);
  expect(areas, `${where} 영역`).toContain(q.area);
  if (check) expect(TYPES, `${where} 유형`).toContain(q.type);
}

for (const c of NEW_COURSES) {
  const areas = c.areas.map((a) => a.id);
  for (const plan of c.units) {
    describe(`${c.id}-U${plan.num} ${plan.title}`, () => {
      const u = JSON.parse(readFileSync(`src/features/computer/courses/${c.id}/U${plan.num}.json`, 'utf8')) as RawUnit;
      const w = `${c.id}-U${plan.num}`;
      it(`${w} 단원 정보`, () => {
        expect(u.unit).toBe(plan.num);
        expect(u.title).toBe(plan.title);
        expect(u.intro.length, `${w} 소개`).toBeGreaterThanOrEqual(30);
        expect(u.intro.length, `${w} 소개`).toBeLessThanOrEqual(220);
      });
      it(`${w} 이론 카드 ${COUNTS.theory}장 + 개념 맞추기`, () => {
        expect(u.theory).toHaveLength(COUNTS.theory);
        u.theory.forEach((t, i) => {
          const where = `${w}-t${i + 1}`;
          expect(t.id, where).toBe(`t${i + 1}`);
          expect(t.title.length, where).toBeLessThanOrEqual(40);
          expect(t.points.length, where).toBeGreaterThanOrEqual(2);
          expect(t.points.length, where).toBeLessThanOrEqual(5);
          for (const p of t.points) expect(p.length, `${where} 문장 길이`).toBeLessThanOrEqual(160);
          if (t.tip !== undefined) expect(t.tip.length, `${where} 팁`).toBeLessThanOrEqual(90);
          expect(typeof t.ext, where).toBe('boolean');
          checkTable(t.table, where);
          checkCode(t.code, where);
          const text = [t.title, ...t.points, t.tip ?? '', t.code ?? '', ...(t.table ? [...t.table.head, ...t.table.rows.flat()] : [])].join('\n');
          checkMatch(t.match, text, where);
        });
      });
      it(`${w} 끼워맞추기 빈칸 ${COUNTS.fill}개 + 예시답안 ${COUNTS.bank}개`, () => {
        expect(u.fill).toHaveLength(COUNTS.fill);
        expect(u.bank).toHaveLength(COUNTS.bank);
        expect(new Set(u.bank).size, `${w} 예시답안 중복`).toBe(COUNTS.bank);
        for (const b of u.bank) expect(b.length, `${w} 예시답안 길이: ${b}`).toBeLessThanOrEqual(30);
        expect(new Set(u.fill.map((f) => f.answer)).size, `${w} 빈칸 정답 중복`).toBe(COUNTS.fill);
        u.fill.forEach((f, i) => {
          const where = `${w}-f${i + 1}`;
          expect(f.id, where).toBe(`f${i + 1}`);
          expect(f.text.split(/_{3,}/).length, `${where} 빈칸은 한 문장에 하나`).toBe(2);
          expect(f.text.length, `${where} 길이`).toBeLessThanOrEqual(170);
          expect(u.bank, `${where} 정답이 예시답안에 없음`).toContain(f.answer);
          expect(f.exp.length, `${where} 해설`).toBeGreaterThanOrEqual(10);
        });
      });
      it(`${w} 기초 객관식 ${COUNTS.basic} · 실력점검 ${COUNTS.advanced}, 정답 번호 고르게`, () => {
        expect(u.basic).toHaveLength(COUNTS.basic);
        expect(u.advanced).toHaveLength(COUNTS.advanced);
        u.basic.forEach((q, i) => checkMcq(q, `b${i + 1}`, areas, `${w}-b${i + 1}`, false));
        u.advanced.forEach((q, i) => checkMcq(q, `a${i + 1}`, areas, `${w}-a${i + 1}`, true));
        const cnt = [0, 0, 0, 0];
        for (const q of [...u.basic, ...u.advanced]) cnt[q.a]++;
        for (const n of cnt) {
          expect(n, `${w} 정답 번호 분포 ${cnt} (각 7~10개)`).toBeGreaterThanOrEqual(7);
          expect(n, `${w} 정답 번호 분포 ${cnt} (각 7~10개)`).toBeLessThanOrEqual(10);
        }
      });
      it(`${w} 단원 요약`, () => {
        expect(u.summary.keys.length).toBeGreaterThanOrEqual(6);
        expect(u.summary.keys.length).toBeLessThanOrEqual(10);
        for (const k of u.summary.keys) {
          expect(k.k.length, `${w} 요약 제목`).toBeLessThanOrEqual(30);
          expect(k.v.length, `${w} 요약 내용`).toBeLessThanOrEqual(150);
        }
        expect(u.summary.compare.length).toBeGreaterThanOrEqual(1);
        expect(u.summary.compare.length).toBeLessThanOrEqual(3);
        u.summary.compare.forEach((t, i) => checkTable(t, `${w} 비교표 ${i + 1}`));
        expect(u.summary.traps.length).toBeGreaterThanOrEqual(4);
        expect(u.summary.traps.length).toBeLessThanOrEqual(8);
        for (const t of u.summary.traps) expect(t.length, `${w} 함정`).toBeLessThanOrEqual(170);
      });
    });
  }
}
