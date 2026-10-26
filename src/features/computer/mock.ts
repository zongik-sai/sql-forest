import { CG_AREAS, CG_PASS, type CgMcq, type CgUnit } from './types';
import type { MockKind } from './model';
import type { CourseConfig } from './course';

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

const unitNum = (id: string) => Number(id.slice(1)) || 0;

/**
 * 영역 순서(컴퓨터 일반: 운영체제 → 주변기기 → 유지보수 → 네트워크 → 컴퓨터 일반, 다른 과목은 그 과목 영역 순)로 묶기.
 * 같은 영역 안에서는 단원 순. 모르는 영역은 맨 뒤.
 */
export function orderByArea(items: CgMcq[], areas: readonly string[] = CG_AREAS): CgMcq[] {
  const order = new Map(areas.map((a, i) => [a, i]));
  const ai = (a: string) => order.get(a) ?? areas.length;
  return [...items].sort((x, y) => ai(x.area) - ai(y.area) || unitNum(x.unitId) - unitNum(y.unitId));
}

/**
 * 단원마다 실력점검 4 + 기초 2(=6), 나머지는 실력점검에서 채워 과목 문항 수(컴퓨터 일반 50)까지(원래 페이지와 같은 구성).
 * 짧은 과목(3단원 · 20문항)은 단원마다 4 + 2 = 18문항, 남는 2문항은 기초에서 채운다(fill: 'basic'):
 * 단원마다 실력점검이 8문항뿐이라 고정 1·2회가 실력점검을 4문항씩 겹치지 않게 나눠 쓰도록.
 */
export const MOCK_PER_UNIT = { check: 4, basic: 2 } as const;

export interface MockPaper {
  items: CgMcq[];
  /** 문항별 보기 순서 */
  orders: number[][];
}

export interface MockOptions {
  wrongIds?: string[];
  seed?: string;
  /** 고정 회차 시드 앞부분(과목 ID). 컴퓨터 일반 'cg' → 'cg-mock-set1-v1' */
  seedPrefix?: string;
  /** 영역 출제 순서(기본: 컴퓨터 일반) */
  areas?: readonly string[];
  /** 문항 수(기본: 컴퓨터 일반 50). 오답 모의고사도 이만큼까지 */
  total?: number;
  /** 단원별 몫을 뽑고 남는 자리를 채울 문항(기본 check: 컴퓨터 일반과 같음) */
  fill?: 'check' | 'basic';
}

/** 화면과 같은 방법으로 과목의 모의고사 옵션을 만든다(시드·영역 순서·문항 수·채우기) */
export function mockOptionsOf(c: Pick<CourseConfig, 'mockSeed' | 'areas' | 'pass' | 'size'>): MockOptions {
  return { seedPrefix: c.mockSeed, areas: c.areas.map((a) => a.id), total: c.pass.mock.total, fill: c.size === 'short' ? 'basic' : 'check' };
}

export const FIXED_SETS = ['set1', 'set2', 'set3'] as const;
export type FixedSet = (typeof FIXED_SETS)[number];

/** 고정 모의고사 시드 */
export const mockSeedOf = (prefix: string, k: FixedSet) => `${prefix}-mock-${k}-v1`;

/**
 * 모의고사 문항 뽑기.
 * - set1~3: 고정 문항(같은 시드 → 같은 문항·같은 보기 순서). 앞 회차 문항을 빼고 뽑는다(모자라면 앞 회차 문항을 다시 씀).
 *   문항이 적은 과목은 겹치지 않게 만들 수 있는 회차만 화면에 보인다(fixedSetCount).
 * - random: 볼 때마다 새로 뽑기
 * - wrong: 오답노트 문항(최대 과목 문항 수)
 */
export function buildMock(units: CgUnit[], kind: MockKind, opts: MockOptions = {}): MockPaper {
  const total = opts.total ?? CG_PASS.mock.total;
  const fill = opts.fill ?? 'check';
  const areas = opts.areas ?? CG_AREAS;
  if (kind === 'wrong') {
    const byId = new Map(units.flatMap((u) => [...u.basic, ...u.check]).map((q) => [q.id, q]));
    const rnd = opts.seed ? seededRandom(opts.seed) : Math.random;
    const items = orderByArea(shuffle((opts.wrongIds ?? []).map((id) => byId.get(id)).filter((q): q is CgMcq => !!q), rnd).slice(0, total), areas);
    return { items, orders: items.map((q) => optionOrder(q.options.length, rnd)) };
  }
  if (kind === 'random') return pick(units, seededRandom(opts.seed ?? `${Date.now()}-${Math.random()}`), new Set(), areas, total, fill);
  // 고정 회차: 1회부터 차례로 뽑으며 앞 회차 문항을 제외한다
  const used = new Set<string>();
  let paper: MockPaper = { items: [], orders: [] };
  for (const k of FIXED_SETS) {
    paper = pick(units, seededRandom(mockSeedOf(opts.seedPrefix ?? 'cg', k)), used, areas, total, fill);
    for (const q of paper.items) used.add(q.id);
    if (k === kind) break;
  }
  return paper;
}

/**
 * 화면에 보일 고정 회차 수(1~3): 앞 회차와 한 문항도 겹치지 않게 만들 수 있는 회차까지.
 * 컴퓨터 일반·새 과목(full)은 3, 짧은 과목(단원마다 기초 10·실력점검 8)은 2. 문항이 없으면 1(준비 중 안내).
 */
export function fixedSetCount(units: CgUnit[], opts: MockOptions = {}): number {
  const total = opts.total ?? CG_PASS.mock.total;
  const used = new Set<string>();
  let n = 0;
  for (const k of FIXED_SETS) {
    const p = pick(units, seededRandom(mockSeedOf(opts.seedPrefix ?? 'cg', k)), used, opts.areas ?? CG_AREAS, total, opts.fill ?? 'check');
    if (!p.items.length || p.items.some((q) => used.has(q.id))) break;
    for (const q of p.items) used.add(q.id);
    n++;
  }
  return Math.max(1, n);
}

function pick(units: CgUnit[], rnd: () => number, exclude: Set<string>, areas: readonly string[], total: number, fill: 'check' | 'basic'): MockPaper {
  const take = (qs: CgMcq[], n: number) => {
    const fresh = shuffle(qs.filter((q) => !exclude.has(q.id)), rnd);
    const reuse = shuffle(qs.filter((q) => exclude.has(q.id)), rnd);
    return [...fresh, ...reuse].slice(0, n);
  };
  const picked: CgMcq[] = [];
  for (const u of units) picked.push(...take(u.check, MOCK_PER_UNIT.check), ...take(u.basic, MOCK_PER_UNIT.basic));
  const usedNow = new Set(picked.map((q) => q.id));
  const extraPool = units.flatMap((u) => (fill === 'basic' ? u.basic : u.check)).filter((q) => !usedNow.has(q.id));
  picked.push(...take(extraPool, Math.max(0, total - picked.length)));
  // 단원이 많아 단원별 몫만으로 문항 수를 넘으면 자른다(컴퓨터 일반 8단원 × 6 = 48 < 50이라 해당 없음)
  const items = orderByArea(shuffle(picked, rnd).slice(0, total), areas);
  return { items, orders: items.map((q) => optionOrder(q.options.length, rnd)) };
}
