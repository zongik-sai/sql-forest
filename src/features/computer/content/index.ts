import raw from './pc_bank.json' with { type: 'json' };
import { CG_AREAS, type CgArea, type CgMcq, type CgTable, type CgUnit, type CgUnitId } from '../types';

/**
 * 컴퓨터 일반 8단원 문제은행.
 * 원본: 선생님의 'PC정비사 자기학습' 페이지에 들어 있던 데이터(pc_bank.json, 형식 그대로 보관)를
 * 앱 표준 형태로 바꾼다. 문항 ID는 단원 안에서만 고유하므로 'U1-b1'처럼 단원을 붙인다.
 */
interface RawTable { head: string[]; rows: string[][] }
interface RawQ { id: string; q: string; o: string[]; a: number; exp: string; area: string; type?: string }
interface RawUnit {
  unit: number;
  title: string;
  intro: string;
  theory: { id: string; title: string; points: string[]; table?: RawTable; tip?: string; ext: boolean }[];
  bank: string[];
  fill: { id: string; text: string; answer: string; exp: string }[];
  basic: RawQ[];
  summary: { keys: { k: string; v: string }[]; compare: (RawTable & { title: string })[]; traps: string[] };
  advanced: RawQ[];
}

const table = (t: RawTable | undefined, caption?: string): CgTable | undefined =>
  t ? { ...(caption ? { caption } : {}), header: t.head, rows: t.rows } : undefined;

const area = (a: string): CgArea => (CG_AREAS.includes(a as CgArea) ? (a as CgArea) : 'GEN');

function mcq(unitId: CgUnitId, set: 'basic' | 'check', q: RawQ): CgMcq {
  return {
    id: `${unitId}-${q.id}`, unitId, set, question: q.q, options: q.o, answer: q.a,
    explanation: q.exp, area: area(q.area), ...(q.type ? { tag: q.type } : {}),
  };
}

export function adaptBank(units: RawUnit[]): CgUnit[] {
  return units.map((u) => {
    const id = `U${u.unit}` as CgUnitId;
    return {
      id, num: u.unit, title: u.title, intro: u.intro,
      cards: u.theory.map((t) => ({
        id: `${id}-${t.id}`, title: t.title.replace(/^\[확장\]\s*/, ''), points: t.points,
        ...(t.table ? { table: table(t.table) } : {}), ...(t.tip ? { tip: t.tip } : {}), ext: !!t.ext,
      })),
      wordBox: u.bank,
      blanks: u.fill.map((f) => ({ id: `${id}-${f.id}`, text: f.text, answer: f.answer, explanation: f.exp })),
      basic: u.basic.map((q) => mcq(id, 'basic', q)),
      summary: { keys: u.summary.keys, tables: u.summary.compare.map((c) => table(c, c.title)!), traps: u.summary.traps },
      check: u.advanced.map((q) => mcq(id, 'check', q)),
    };
  });
}

export const CG_UNITS: CgUnit[] = adaptBank(raw as RawUnit[]);
export const CG_UNIT_BY_ID: Partial<Record<CgUnitId, CgUnit>> = Object.fromEntries(CG_UNITS.map((u) => [u.id, u]));
const MCQ_MAP = new Map(CG_UNITS.flatMap((u) => [...u.basic, ...u.check]).map((q) => [q.id, q]));
/** 문항 찾기(없는 ID·'constructor' 같은 키는 undefined) */
export const mcqById = (id: string): CgMcq | undefined => MCQ_MAP.get(id);
