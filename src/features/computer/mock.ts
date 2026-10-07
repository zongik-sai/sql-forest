import { CG_AREAS, CG_PASS, CG_UNIT_IDS, type CgMcq, type CgUnit } from './types';
import type { MockKind } from './model';

/** 문자열 시드 → 결정적 난수(mulberry32) */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rnd: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 보기 순서 섞기(화면 위치 ①~④ → 원래 보기 번호). 정답 위치를 외우지 않게 한다 */
export const optionOrder = (n: number, rnd: () => number = Math.random) => shuffle(Array.from({ length: n }, (_, i) => i), rnd);

const AREA_ORDER = Object.fromEntries(CG_AREAS.map((a, i) => [a, i])) as Record<string, number>;
const UNIT_ORDER = Object.fromEntries(CG_UNIT_IDS.map((u, i) => [u, i])) as Record<string, number>;

/** 영역 순서(운영체제 → 주변기기 → 유지보수 → 네트워크 → 컴퓨터 일반)로 묶기. 같은 영역 안에서는 단원 순 */
export function orderByArea(items: CgMcq[]): CgMcq[] {
  return [...items].sort((x, y) => AREA_ORDER[x.area] - AREA_ORDER[y.area] || UNIT_ORDER[x.unitId] - UNIT_ORDER[y.unitId]);
}

/** 단원마다 실력점검 4 + 기초 2(=6), 나머지는 실력점검에서 채워 50문항(원래 페이지와 같은 구성) */
export const MOCK_PER_UNIT = { check: 4, basic: 2 } as const;

export interface MockPaper {
  items: CgMcq[];
  /** 문항별 보기 순서 */
  orders: number[][];
}

/**
 * 모의고사 문항 뽑기.
 * - set1~3: 고정 문항(같은 시드 → 같은 문항·같은 보기 순서). 세 회차는 서로 겹치지 않게 뽑는다.
 * - random: 볼 때마다 새로 뽑기
 * - wrong: 오답노트 문항(최대 50)
 */
export function buildMock(units: CgUnit[], kind: MockKind, opts: { wrongIds?: string[]; seed?: string } = {}): MockPaper {
  const total = CG_PASS.mock.total;
  if (kind === 'wrong') {
    const byId = new Map(units.flatMap((u) => [...u.basic, ...u.check]).map((q) => [q.id, q]));
    const rnd = opts.seed ? seededRandom(opts.seed) : Math.random;
    const items = orderByArea(shuffle((opts.wrongIds ?? []).map((id) => byId.get(id)).filter((q): q is CgMcq => !!q), rnd).slice(0, total));
    return { items, orders: items.map((q) => optionOrder(q.options.length, rnd)) };
  }
  if (kind === 'random') return pick(units, seededRandom(opts.seed ?? `${Date.now()}-${Math.random()}`), new Set());
  // 고정 회차: 1회부터 차례로 뽑으며 앞 회차 문항을 제외한다
  const used = new Set<string>();
  let paper: MockPaper = { items: [], orders: [] };
  for (const k of ['set1', 'set2', 'set3'] as const) {
    paper = pick(units, seededRandom(`cg-mock-${k}-v1`), used);
    for (const q of paper.items) used.add(q.id);
    if (k === kind) break;
  }
  return paper;
}

function pick(units: CgUnit[], rnd: () => number, exclude: Set<string>): MockPaper {
  const total = CG_PASS.mock.total;
  const take = (qs: CgMcq[], n: number) => {
    const fresh = shuffle(qs.filter((q) => !exclude.has(q.id)), rnd);
    const reuse = shuffle(qs.filter((q) => exclude.has(q.id)), rnd);
    return [...fresh, ...reuse].slice(0, n);
  };
  const picked: CgMcq[] = [];
  for (const u of units) picked.push(...take(u.check, MOCK_PER_UNIT.check), ...take(u.basic, MOCK_PER_UNIT.basic));
  const usedNow = new Set(picked.map((q) => q.id));
  const extraPool = units.flatMap((u) => u.check).filter((q) => !usedNow.has(q.id));
  picked.push(...take(extraPool, Math.max(0, total - picked.length)));
  const items = orderByArea(shuffle(picked, rnd));
  return { items, orders: items.map((q) => optionOrder(q.options.length, rnd)) };
}
