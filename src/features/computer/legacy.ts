import type { LegacySource } from './courses/defs';
import { emptyCgState, hasProgress, mergeCgStates, normalizeCgState, type CgState, type CourseShape, type SelfCheckRecord, type UnitRecord } from './model';
import type { CgUnitId } from './types';

/**
 * 예전 과목 기록을 새 과목으로 한 번 옮기기(순수 함수, 테스트 대상). 기초 다듬기(2026-11-09): 2진법 이해(bin) 1~3단원 → 1~3단원,
 * IP 이해(ip) 1~3단원 → 6·8·10단원(규칙은 courses/defs.ts의 legacy).
 * - 옮기는 것: 1~4단계 기록, 개념 맞추기를 마친 카드(U?-t?), 오답노트(문항 ID의 단원만 바꿈 — 옮긴 단원의 문항 번호·내용은 그대로),
 *   통과한 예전 5단계(실력점검 8문항, 최고 s/8) → 실력점검 기록 한 번 { best·sum: round(s × 10 / 8), n: 1, 회차: 통과 시각 } + 5단계 마침.
 * - 옮기지 않는 것: 예전 모의고사(문항 수·회차가 다름)·잠김·단원 초기화 표시. 예전 기록(이 기기·서버)은 지우거나 바꾸지 않는다.
 * - 새 과목에 이미 있는 기록은 덮어쓰지 않는다: 같은 병합 규칙(mergeCgStates: 최고 점수는 큰 쪽·통과는 이른 쪽·오답은 더 최근 사건)으로
 *   더 나은 쪽을 남기고, 새 과목에서 초기화된 단원에는 그 전(예전 과목) 기록을 되살리지 않는다.
 */

/** 예전 과목의 모양(그 과목 단원만) */
const oldShape = (src: LegacySource): CourseShape => {
  const ids = Object.keys(src.units) as CgUnitId[];
  return { unitIds: ids, totalSteps: ids.length * 5 };
};

/** 예전 실력점검 최고 점수(문항 total개, 기록이 없으면 8) → size문항 점수(반올림) */
export const scaleOldCheck = (best: number, total: number | undefined, size: number) =>
  Math.max(0, Math.min(size, Math.round((best * size) / (total && total > 0 ? total : 8))));

/**
 * 예전 과목 기록(이 기기 사본·서버 행 등 여러 판) → 새 과목 모양의 기록. 여러 판은 먼저 예전 과목 기준으로 병합한다
 * (한쪽만 아는 예전 단원 초기화가 다른 쪽의 오래된 기록을 되살리지 않게).
 */
export function mapLegacyState(versions: unknown[], src: LegacySource, shape: CourseShape): CgState {
  const os = oldShape(src);
  const old = versions.map((v) => normalizeCgState(v, os)).reduce((a, b) => mergeCgStates(a, b, os), emptyCgState());
  const out = emptyCgState();
  const checks: Partial<Record<CgUnitId, SelfCheckRecord>> = {};
  const size = shape.selfCheck?.size;
  const target = (oldUnit: string): CgUnitId | null => {
    const nu = Object.hasOwn(src.units, oldUnit) ? src.units[oldUnit] : undefined;
    return nu && shape.unitIds.includes(nu) ? nu : null;
  };
  /** 'U2-a5' → 'U8-a5'(옮기지 않는 단원이면 null) */
  const remap = (id: string) => {
    const i = id.indexOf('-');
    const nu = i > 0 ? target(id.slice(0, i)) : null;
    return nu ? `${nu}${id.slice(i)}` : null;
  };
  for (const ou of os.unitIds) {
    const nu = target(ou);
    const ur = old.units[ou];
    if (!nu || !ur) continue;
    const rec: UnitRecord = {};
    for (const lv of [1, 2, 3, 4] as const) {
      const r = ur[`lv${lv}`];
      if (r) rec[`lv${lv}`] = { ...r };
    }
    const l5 = ur.lv5;
    if (l5?.passedAt) {
      if (size) {
        const score = scaleOldCheck(l5.best ?? 0, l5.total, size);
        checks[nu] = { best: score, sum: score, n: 1, hist: [{ at: l5.passedAt, score }] };
        rec.lv5 = { passedAt: l5.passedAt, lastAt: l5.lastAt && l5.lastAt > l5.passedAt ? l5.lastAt : l5.passedAt };
      } else rec.lv5 = { ...l5 };
    }
    if (Object.keys(rec).length) out.units[nu] = rec;
  }
  for (const [k, v] of Object.entries(old.cards)) {
    const id = remap(k);
    if (id) out.cards[id] = v;
  }
  for (const [k, v] of Object.entries(old.wrong)) {
    const id = remap(k);
    if (id) out.wrong[id] = { ...v };
  }
  out.upd = old.upd;
  // 새 과목 규칙으로 한 번 더 읽어 형식을 맞춘다(시각·점수 범위, 이 과목 단원만)
  return normalizeCgState(Object.keys(checks).length ? { ...out, checks } : out, shape);
}

export interface LegacyInput {
  src: LegacySource;
  /** 그 예전 과목 기록의 여러 판(이 기기 사본, 서버 행). 없으면 빈 배열 */
  versions: unknown[];
}

/**
 * 지금 기록에 예전 과목 기록을 합친다. complete(이 기기·서버를 모두 읽음)이면 importedLegacy 표시를 남겨 다시 하지 않는다.
 * 서버를 읽지 못했으면(연결 끊김 등) 표시 없이 이 기기 것만 합치고, 다음에 다시 시도한다(같은 기록을 다시 합쳐도 결과가 같다).
 * 반환: state(바뀐 것이 없으면 cur 그대로), imported(옮겨 온 기록이 있어 무언가 바뀌었는지)
 */
export function importLegacy(cur: CgState, legacy: LegacyInput[], shape: CourseShape, now: string, complete: boolean): { state: CgState; imported: boolean } {
  if (cur.importedLegacy) return { state: cur, imported: false };
  const strip = (s: CgState) => JSON.stringify({ ...s, upd: '' });
  let s = cur;
  for (const l of legacy) {
    if (!l.versions.length) continue;
    const mapped = mapLegacyState(l.versions, l.src, shape);
    if (hasProgress(mapped, shape)) s = mergeCgStates(s, mapped, shape);
  }
  // 병합 결과와 같은 순서(단원 순·시각순)로 맞춘 지금 기록과 비교: 이미 옮겨 온 기록을 다시 합친 경우는 바뀐 것이 아님
  const imported = s !== cur && strip(s) !== strip(mergeCgStates(cur, emptyCgState(), shape));
  if (!imported && !complete) return { state: cur, imported: false };
  const out: CgState = { ...(imported ? s : cur), upd: now };
  if (complete) {
    out.importedLegacy = true;
    out.importedLegacyAt = now;
  }
  return { state: out, imported };
}
