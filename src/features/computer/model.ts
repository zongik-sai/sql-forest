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
  /** 마지막 변경 시각 */
  upd: string;
}

export const MOCK_KEEP = 60;

export const emptyCgState = (): CgState => ({ v: 1, units: {}, mock: [], wrong: {}, upd: '' });

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
    for (const [k, v] of Object.entries(r.wrong)) if (v && typeof v.at === 'string') s.wrong[k] = { at: v.at, n: typeof v.n === 'number' ? v.n : 1, ...(typeof v.clearedAt === 'string' ? { clearedAt: v.clearedAt } : {}) };
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
  const cur = s.wrong[qid];
  if (correct) {
    if (!cur || !isWrongActive(cur)) return s;
    return stamp({ ...s, wrong: { ...s.wrong, [qid]: { ...cur, clearedAt: now } } }, now);
  }
  return stamp({ ...s, wrong: { ...s.wrong, [qid]: { at: now, n: (cur?.n ?? 0) + 1 } } }, now);
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
export function mergeCgStates(a: CgState, b: CgState): CgState {
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
  return { v: 1, units, mock, wrong, upd: maxIso(a.upd, b.upd) ?? '' };
}

/** 의미 있는 진행이 있는지(가져오기 안내용) */
export const hasProgress = (s: CgState) => passedCount(s) > 0 || s.mock.length > 0 || Object.keys(s.wrong).length > 0 || Object.values(s.units).some((u) => u && Object.keys(u).length > 0);

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
