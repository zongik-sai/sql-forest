import { CG_AREAS, CG_PASS, CG_UNIT_IDS, type CgMcq, type CgUnit, type CgUnitId } from './types';
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

export function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const AREA_ORDER = Object.fromEntries(CG_AREAS.map((a, i) => [a, i])) as Record<string, number>;
const UNIT_ORDER = Object.fromEntries(CG_UNIT_IDS.map((u, i) => [u, i])) as Record<string, number>;

/** 영역 순서(운영체제 → 주변기기 → 유지보수 → 네트워크 → 컴퓨터 일반), 같은 영역 안에서는 단원 순 */
export function orderByArea(items: CgMcq[]): CgMcq[] {
  return [...items].sort((x, y) => AREA_ORDER[x.area] - AREA_ORDER[y.area] || UNIT_ORDER[x.unitId] - UNIT_ORDER[y.unitId]);
}

/** 단원별 문항 수를 고르게 나눈다(50 ÷ 8 → 6~7) */
export function unitQuota(total: number, units: CgUnitId[], rnd: () => number): Record<CgUnitId, number> {
  const base = Math.floor(total / units.length);
  const extra = total - base * units.length;
  const lucky = new Set(shuffle(units, rnd).slice(0, extra));
  return Object.fromEntries(units.map((u) => [u, base + (lucky.has(u) ? 1 : 0)])) as Record<CgUnitId, number>;
}

/**
 * 모의고사 문항 뽑기.
 * - set1~3: 고정 문항(같은 시드 → 같은 문항). 세 회차는 서로 겹치지 않게 뽑는다(문항이 충분할 때).
 * - random: 매번 새로 뽑기
 * - wrong: 오답노트 문항(최대 50)
 */
export function buildMock(units: CgUnit[], kind: MockKind, opts: { wrongIds?: string[]; seed?: string } = {}): CgMcq[] {
  const total = CG_PASS.mock.total;
  const pool = units.flatMap((u) => [...u.basic, ...u.check]);
  if (kind === 'wrong') {
    const byId = new Map(pool.map((q) => [q.id, q]));
    return orderByArea((opts.wrongIds ?? []).map((id) => byId.get(id)).filter((q): q is CgMcq => !!q).slice(0, total));
  }
  const unitIds = units.map((u) => u.id);
  if (kind === 'random') {
    const rnd = seededRandom(opts.seed ?? `${Date.now()}-${Math.random()}`);
    return pickBalanced(units, unitIds, total, rnd, new Set());
  }
  // 고정 회차: 1회부터 차례로 뽑으며 앞 회차 문항을 제외한다
  const used = new Set<string>();
  let out: CgMcq[] = [];
  for (const k of ['set1', 'set2', 'set3'] as const) {
    out = pickBalanced(units, unitIds, total, seededRandom(`cg-mock-${k}-v1`), used);
    for (const q of out) used.add(q.id);
    if (k === kind) break;
  }
  return out;
}

function pickBalanced(units: CgUnit[], unitIds: CgUnitId[], total: number, rnd: () => number, exclude: Set<string>): CgMcq[] {
  const quota = unitQuota(total, unitIds, rnd);
  const picked: CgMcq[] = [];
  for (const u of units) {
    const all = [...u.basic, ...u.check];
    const fresh = shuffle(all.filter((q) => !exclude.has(q.id)), rnd);
    const fallback = shuffle(all.filter((q) => exclude.has(q.id)), rnd);
    picked.push(...[...fresh, ...fallback].slice(0, quota[u.id]));
  }
  return orderByArea(picked);
}
