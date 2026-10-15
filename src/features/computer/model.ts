import { CG_AREAS, CG_LEVELS, CG_PASS, CG_UNIT_IDS, type CgArea, type CgLevel, type CgUnitId } from './types';

/**
 * 컴퓨터 일반 학습 기록(학생 한 명 = 문서 하나). Supabase cg_progress.state 또는 이 기기에 저장.
 * 모든 함수는 순수 함수다(입력 상태를 바꾸지 않는다).
 */
export interface LevelRecord {
  /** 점수형 단계의 최고 점수(이론·요약은 없음) */
  best?: number;
  /** 문항 수(채점 당시) */
  total?: number;
  /** 처음 통과한 시각 */
  passedAt?: string;
  /** 마지막으로 시도·확인한 시각 */
  lastAt?: string;
}

export type UnitRecord = Partial<Record<`lv${CgLevel}`, LevelRecord>>;

export type MockKind = 'set1' | 'set2' | 'set3' | 'random' | 'wrong';
export const MOCK_LABEL: Record<MockKind, string> = { set1: '모의고사 1회', set2: '모의고사 2회', set3: '모의고사 3회', random: '랜덤 모의고사', wrong: '오답 모의고사' };
/** 정규 모의고사(열매 조건): 고정 1~3회와 랜덤. 오답 모의고사는 제외 */
export const isRegularMock = (k: MockKind) => k !== 'wrong';

export interface MockRecord {
  id: string;
  kind: MockKind;
  at: string;
  score: number;
  total: number;
  seconds: number;
  /** 시간이 다 돼서 자동 제출됐는지 */
  timeUp?: boolean;
  perUnit: Partial<Record<CgUnitId, [number, number]>>;
  perArea: Partial<Record<CgArea, [number, number]>>;
}

export interface WrongEntry {
  /** 마지막으로 틀린 시각 */
  at: string;
  /** 틀린 횟수 */
  n: number;
  /** 다시 맞혀 오답노트에서 빠진 시각(이후 다시 틀리면 at이 더 늦어져 다시 들어온다) */
  clearedAt?: string;
}

export interface CgState {
  v: 1;
  units: Partial<Record<CgUnitId, UnitRecord>>;
  mock: MockRecord[];
  wrong: Record<string, WrongEntry>;
  /** 개념 맞추기를 마친 이론 카드(카드 ID → 처음 마친 시각) */
  cards: Record<string, string>;
  /** 단원 집중 학습 중 잠긴 시각들(마지막 초기화 이후) */
  locks: Partial<Record<CgUnitId, string[]>>;
  /** 단원 초기화: 마지막 시각과 누적 횟수. 병합할 때 이 시각을 모르는(더 오래된) 쪽의 그 단원 기록은 버린다 */
  resets: Partial<Record<CgUnitId, { at: string; n: number }>>;
  /** 마지막 변경 시각 */
  upd: string;
}

export const MOCK_KEEP = 60;

/** 문항 ID 형식: 단원 + 기초(b)/실력점검(a) 번호 */
export const QID_RE = /^U[1-8]-[ab]\d{1,3}$/;
/** 이론 카드 ID 형식 */
export const CARD_ID_RE = /^U[1-8]-t\d{1,3}$/;

/** 기기 시계가 서로 달라도 사건 순서가 뒤집히지 않게: 앞 사건보다 최소 1ms 뒤 시각 */
const after = (now: string, prev?: string) => (prev && prev >= now ? new Date(Date.parse(prev) + 1).toISOString() : now);

export const emptyCgState = (): CgState => ({ v: 1, units: {}, mock: [], wrong: {}, cards: {}, locks: {}, resets: {}, upd: '' });

/** 한 단원에서 이만큼 잠기면 그 단원의 진도·점수를 초기화한다(선생님 결정) */
export const LOCK_LIMIT = 5;

/** 저장된 JSON을 안전하게 읽는다(모르는 필드·잘못된 값은 버림) */
export function normalizeCgState(raw: unknown): CgState {
  const s = emptyCgState();
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Partial<CgState>;
  if (r.units && typeof r.units === 'object') {
    for (const u of CG_UNIT_IDS) {
      const ur = (r.units as Record<string, UnitRecord>)[u];
      if (!ur || typeof ur !== 'object') continue;
      const out: UnitRecord = {};
      for (const lv of CG_LEVELS) {
        const x = ur[`lv${lv}`];
        if (x && typeof x === 'object') out[`lv${lv}`] = {
          ...(typeof x.best === 'number' ? { best: x.best } : {}),
          ...(typeof x.total === 'number' ? { total: x.total } : {}),
          ...(typeof x.passedAt === 'string' ? { passedAt: x.passedAt } : {}),
          ...(typeof x.lastAt === 'string' ? { lastAt: x.lastAt } : {}),
        };
      }
      s.units[u] = out;
    }
  }
  if (Array.isArray(r.mock)) s.mock = r.mock.filter((m) => m && typeof m.id === 'string' && typeof m.score === 'number').slice(-MOCK_KEEP);
  if (r.wrong && typeof r.wrong === 'object') {
    // 문항 ID 형식(U1-b1, U8-a25)만 받는다: 'constructor' 같은 키로 화면이 깨지지 않게
    for (const [k, v] of Object.entries(r.wrong)) if (QID_RE.test(k) && v && typeof v.at === 'string') s.wrong[k] = { at: v.at, n: typeof v.n === 'number' ? v.n : 1, ...(typeof v.clearedAt === 'string' ? { clearedAt: v.clearedAt } : {}) };
  }
  if (r.cards && typeof r.cards === 'object') {
    for (const [k, v] of Object.entries(r.cards)) if (CARD_ID_RE.test(k) && typeof v === 'string') s.cards[k] = v;
  }
  for (const u of CG_UNIT_IDS) {
    const l = r.locks && typeof r.locks === 'object' ? (r.locks as Record<string, unknown>)[u] : undefined;
    if (Array.isArray(l)) {
      const ok = l.filter((x): x is string => typeof x === 'string').slice(-50);
      if (ok.length) s.locks[u] = ok;
    }
    const z = r.resets && typeof r.resets === 'object' ? (r.resets as Record<string, unknown>)[u] : undefined;
    if (z && typeof z === 'object' && typeof (z as { at?: unknown }).at === 'string') {
      const n = (z as { n?: unknown }).n;
      s.resets[u] = { at: (z as { at: string }).at, n: typeof n === 'number' && n > 0 ? n : 1 };
    }
  }
  if (typeof r.upd === 'string') s.upd = r.upd;
  return s;
}

/** 단계별 통과에 필요한 정답 수(문항 수가 기준과 다르면 같은 비율로 올림) */
export function passNeed(level: CgLevel, count: number): number {
  const base = level === 2 ? CG_PASS.blanks : level === 3 ? CG_PASS.basic : level === 5 ? CG_PASS.check : null;
  if (!base) return 0;
  if (count === base.total) return base.need;
  return Math.ceil((base.need / base.total) * count);
}

export const isPassed = (s: CgState, u: CgUnitId, lv: CgLevel) => !!s.units[u]?.[`lv${lv}`]?.passedAt;

/** 앞 단계를 통과해야 열린다(1단계는 항상 열림). 잠겨 있어도 "그래도 풀어보기"로 도전할 수 있다. */
export const isOpen = (s: CgState, u: CgUnitId, lv: CgLevel) => lv === 1 || isPassed(s, u, (lv - 1) as CgLevel);

/** 단원 레벨 = 통과한 단계 수(0~5). "그래도 풀어보기"로 먼저 통과한 단계도 센다 */
export function unitLevel(s: CgState, u: CgUnitId): number {
  return CG_LEVELS.filter((lv) => isPassed(s, u, lv)).length;
}

/** 통과한 단계 수(전체 40) — 순서와 관계없이 센다 */
export function passedCount(s: CgState): number {
  let n = 0;
  for (const u of CG_UNIT_IDS) for (const lv of CG_LEVELS) if (isPassed(s, u, lv)) n++;
  return n;
}

export const TOTAL_STEPS = CG_UNIT_IDS.length * CG_LEVELS.length; // 40

/** 성장 식물 단계(0 씨앗 ~ 6 열매) */
export function plantStage(s: CgState): number {
  const n = passedCount(s);
  if (n >= TOTAL_STEPS) return bestRegularMock(s) >= CG_PASS.mock.need ? 6 : 5;
  if (n >= 28) return 4;
  if (n >= 16) return 3;
  if (n >= 8) return 2;
  if (n >= 1) return 1;
  return 0;
}
/** 다음 식물 단계까지 남은 조건 설명 */
export function nextPlantGoal(s: CgState): string | null {
  const n = passedCount(s);
  const st = plantStage(s);
  if (st === 6) return null;
  if (st === 5) return `정규 모의고사(1~3회·랜덤)에서 ${CG_PASS.mock.need}/${CG_PASS.mock.total} 이상이면 열매가 맺혀요.`;
  const next = [1, 8, 16, 28, TOTAL_STEPS][st];
  return `${next - n}단계 더 통과하면 다음 모습으로 자라요.`;
}

/** 정규 모의고사(50문항 전체) 최고 점수 */
export function bestRegularMock(s: CgState): number {
  return s.mock.filter((m) => isRegularMock(m.kind) && m.total === CG_PASS.mock.total).reduce((b, m) => Math.max(b, m.score), 0);
}

/** 오답 모의고사를 열 수 있는 최소 오답 수 */
export const WRONG_MOCK_MIN = 5;

const stamp = (s: CgState, now: string): CgState => ({ ...s, upd: now });

function setLevel(s: CgState, u: CgUnitId, lv: CgLevel, f: (r: LevelRecord) => LevelRecord, now: string): CgState {
  const ur = { ...(s.units[u] ?? {}) };
  ur[`lv${lv}`] = f(ur[`lv${lv}`] ?? {});
  return stamp({ ...s, units: { ...s.units, [u]: ur } }, now);
}

/** 단원 잠김 횟수(마지막 초기화 이후) */
export const lockCount = (s: CgState, u: CgUnitId) => s.locks[u]?.length ?? 0;

const unitCardPrefix = (u: CgUnitId) => `${u}-t`;

/** 단원의 진도·점수(단계 기록·카드)와 잠김 횟수를 지운다. 오답노트·모의고사·다른 단원은 그대로 */
export function resetUnit(s: CgState, u: CgUnitId, now = new Date().toISOString()): CgState {
  const units = { ...s.units };
  delete units[u];
  const cards = Object.fromEntries(Object.entries(s.cards).filter(([k]) => !k.startsWith(unitCardPrefix(u))));
  const locks = { ...s.locks };
  delete locks[u];
  const prev = s.resets[u];
  return stamp({ ...s, units, cards, locks, resets: { ...s.resets, [u]: { at: after(now, prev?.at), n: (prev?.n ?? 0) + 1 } } }, now);
}

/** 잠김 1회 기록. 한도에 닿으면 그 단원을 초기화한다 */
export function addLock(s: CgState, u: CgUnitId, now = new Date().toISOString()): { state: CgState; count: number; reset: boolean } {
  const list = [...(s.locks[u] ?? []), after(now, s.locks[u]?.at(-1))];
  if (list.length >= LOCK_LIMIT) return { state: resetUnit(s, u, now), count: list.length, reset: true };
  return { state: stamp({ ...s, locks: { ...s.locks, [u]: list } }, now), count: list.length, reset: false };
}

/** 병합 전: 상대가 아는 더 최근 초기화를 모르는 쪽이면 그 단원 기록을 버린다(초기화가 되살아나지 않게) */
function dropStaleUnits(x: CgState, latest: CgState['resets']): CgState {
  let out = x;
  for (const u of CG_UNIT_IDS) {
    const r = latest[u];
    if (r && (x.resets[u]?.at ?? '') < r.at) {
      const units = { ...out.units };
      delete units[u];
      const locks = { ...out.locks };
      delete locks[u];
      out = { ...out, units, locks, cards: Object.fromEntries(Object.entries(out.cards).filter(([k]) => !k.startsWith(unitCardPrefix(u)))) };
    }
  }
  return out;
}

/** 카드 목록 중 개념 맞추기를 마친 장 수 */
export const cardsDone = (s: CgState, cardIds: string[]) => cardIds.filter((id) => Object.hasOwn(s.cards, id)).length;

/**
 * 카드 한 장의 개념 맞추기를 마쳤을 때. 단원 카드를 모두 마치면 1단계 통과로 기록한다.
 * unitCardIds: 이 단원의 모든 카드 ID
 */
export function markCard(s: CgState, u: CgUnitId, cardId: string, unitCardIds: string[], now = new Date().toISOString()): { state: CgState; unitDone: boolean; firstPass: boolean } {
  let state = Object.hasOwn(s.cards, cardId) ? stamp(s, now) : stamp({ ...s, cards: { ...s.cards, [cardId]: now } }, now);
  const unitDone = cardsDone(state, unitCardIds) === unitCardIds.length;
  const firstPass = unitDone && !isPassed(state, u, 1);
  if (unitDone) state = setLevel(state, u, 1, (r) => ({ ...r, best: unitCardIds.length, total: unitCardIds.length, passedAt: r.passedAt ?? now, lastAt: now }), now);
  return { state, unitDone, firstPass };
}

/** 이론(1)·요약(4) 확인 표시 */
export function markDone(s: CgState, u: CgUnitId, lv: 1 | 4, now = new Date().toISOString()): CgState {
  return setLevel(s, u, lv, (r) => ({ ...r, passedAt: r.passedAt ?? now, lastAt: now }), now);
}

/** 점수형 단계(2·3·5) 결과 기록. 최고 점수 유지, 기준 이상이면 통과 */
export function recordScore(s: CgState, u: CgUnitId, lv: 2 | 3 | 5, score: number, total: number, now = new Date().toISOString()): { state: CgState; passed: boolean; firstPass: boolean } {
  const need = passNeed(lv, total);
  const passed = score >= need;
  const prev = s.units[u]?.[`lv${lv}`];
  const firstPass = passed && !prev?.passedAt;
  const state = setLevel(s, u, lv, (r) => ({
    best: Math.max(r.best ?? 0, score),
    total,
    passedAt: r.passedAt ?? (passed ? now : undefined),
    lastAt: now,
  }), now);
  // undefined 필드 제거(저장 JSON을 깔끔하게)
  const rec = state.units[u]![`lv${lv}`]!;
  if (rec.passedAt === undefined) delete rec.passedAt;
  return { state, passed, firstPass };
}

/** 문항 하나를 풀었을 때 오답노트 갱신: 틀리면 넣고, 오답노트에 있던 문항을 맞히면 뺀다 */
export function noteAnswer(s: CgState, qid: string, correct: boolean, now = new Date().toISOString()): CgState {
  const cur = Object.hasOwn(s.wrong, qid) ? s.wrong[qid] : undefined;
  if (correct) {
    if (!cur || !isWrongActive(cur)) return s;
    return stamp({ ...s, wrong: { ...s.wrong, [qid]: { ...cur, clearedAt: after(now, cur.at) } } }, now);
  }
  return stamp({ ...s, wrong: { ...s.wrong, [qid]: { at: after(now, cur?.clearedAt), n: (cur?.n ?? 0) + 1 } } }, now);
}

export const isWrongActive = (w: WrongEntry) => !w.clearedAt || w.clearedAt < w.at;

/** 오답노트에 남아 있는 문항 ID(최근 틀린 순) */
export function activeWrongIds(s: CgState): string[] {
  return Object.entries(s.wrong).filter(([, w]) => isWrongActive(w)).sort((a, b) => (a[1].at < b[1].at ? 1 : -1)).map(([k]) => k);
}

export function addMock(s: CgState, m: MockRecord, now = new Date().toISOString()): CgState {
  if (s.mock.some((x) => x.id === m.id)) return s;
  return stamp({ ...s, mock: [...s.mock, m].slice(-MOCK_KEEP) }, now);
}

const minIso = (a?: string, b?: string) => (!a ? b : !b ? a : a < b ? a : b);
const maxIso = (a?: string, b?: string) => (!a ? b : !b ? a : a > b ? a : b);

/**
 * 두 기기의 기록 병합(같은 학생). 통과는 사라지지 않고, 최고 점수는 큰 쪽, 모의고사는 합집합,
 * 오답노트는 문항별로 더 최근 사건(틀림/다시 맞힘)을 따른다.
 */
export function mergeCgStates(a0: CgState, b0: CgState): CgState {
  const resets: CgState['resets'] = {};
  for (const u of CG_UNIT_IDS) {
    const ra = a0.resets[u], rb = b0.resets[u];
    if (!ra && !rb) continue;
    const at = maxIso(ra?.at, rb?.at)!;
    resets[u] = { at, n: Math.max(ra?.n ?? 0, rb?.n ?? 0) };
  }
  const a = dropStaleUnits(a0, resets), b = dropStaleUnits(b0, resets);
  const locks: CgState['locks'] = {};
  for (const u of CG_UNIT_IDS) {
    const l = [...new Set([...(a.locks[u] ?? []), ...(b.locks[u] ?? [])])].sort();
    if (l.length) locks[u] = l.slice(-50);
  }
  const units: CgState['units'] = {};
  for (const u of CG_UNIT_IDS) {
    const ua = a.units[u], ub = b.units[u];
    if (!ua && !ub) continue;
    const out: UnitRecord = {};
    for (const lv of CG_LEVELS) {
      const ra = ua?.[`lv${lv}`], rb = ub?.[`lv${lv}`];
      if (!ra && !rb) continue;
      const best = Math.max(ra?.best ?? -1, rb?.best ?? -1);
      const rec: LevelRecord = {};
      if (best >= 0) rec.best = best;
      const total = (ra?.best ?? -1) >= (rb?.best ?? -1) ? ra?.total ?? rb?.total : rb?.total ?? ra?.total;
      if (total !== undefined) rec.total = total;
      const passedAt = minIso(ra?.passedAt, rb?.passedAt);
      if (passedAt) rec.passedAt = passedAt;
      const lastAt = maxIso(ra?.lastAt, rb?.lastAt);
      if (lastAt) rec.lastAt = lastAt;
      out[`lv${lv}`] = rec;
    }
    units[u] = out;
  }
  const byId = new Map<string, MockRecord>();
  for (const m of [...a.mock, ...b.mock]) if (!byId.has(m.id)) byId.set(m.id, m);
  const mock = [...byId.values()].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0)).slice(-MOCK_KEEP);
  const wrong: CgState['wrong'] = {};
  for (const k of new Set([...Object.keys(a.wrong), ...Object.keys(b.wrong)])) {
    const wa = a.wrong[k], wb = b.wrong[k];
    if (!wa || !wb) { wrong[k] = (wa ?? wb)!; continue; }
    const at = maxIso(wa.at, wb.at)!;
    const clearedAt = maxIso(wa.clearedAt, wb.clearedAt);
    wrong[k] = { at, n: Math.max(wa.n, wb.n), ...(clearedAt ? { clearedAt } : {}) };
  }
  const cards: CgState['cards'] = {};
  for (const k of new Set([...Object.keys(a.cards), ...Object.keys(b.cards)])) cards[k] = minIso(a.cards[k], b.cards[k])!;
  return { v: 1, units, mock, wrong, cards, locks, resets, upd: maxIso(a.upd, b.upd) ?? '' };
}

/** 의미 있는 진행이 있는지(가져오기 안내용) */
export const hasProgress = (s: CgState) => passedCount(s) > 0 || s.mock.length > 0 || Object.keys(s.wrong).length > 0 || Object.keys(s.cards).length > 0 || Object.values(s.units).some((u) => u && Object.keys(u).length > 0);

/** 모의고사 결과 집계 */
export function scoreMock(
  items: { id: string; unitId: CgUnitId; area: CgArea; answer: number }[],
  answers: Record<string, number | undefined>,
): { score: number; perUnit: MockRecord['perUnit']; perArea: MockRecord['perArea']; results: { id: string; correct: boolean }[] } {
  const perUnit: MockRecord['perUnit'] = {};
  const perArea: MockRecord['perArea'] = {};
  let score = 0;
  const results = items.map((q) => {
    const correct = answers[q.id] === q.answer;
    if (correct) score++;
    const pu = (perUnit[q.unitId] ??= [0, 0]);
    pu[1]++;
    if (correct) pu[0]++;
    const pa = (perArea[q.area] ??= [0, 0]);
    pa[1]++;
    if (correct) pa[0]++;
    return { id: q.id, correct };
  });
  return { score, perUnit, perArea, results };
}

export { CG_AREAS };
