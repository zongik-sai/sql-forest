import type { DbSchema, SchemaTable } from '../sql/schema';

/**
 * ERD 자동 배치(순수 함수, 화면 코드 없음).
 * - 외래키 의존 단계(level)로 열(column)을 나눈다: 아무 표도 가리키지 않는 표가 왼쪽(0단계),
 *   그 표를 가리키는 표가 오른쪽으로 간다. 그래서 선의 '여러 개' 쪽(까마귀발)은 대개 오른쪽 표에 붙는다.
 * - 같은 단계 안에서는 연결된 표의 위치 평균(barycenter)으로 순서를 정해 선이 덜 엇갈리게 한다.
 * - 서로를 가리키는 순환 관계가 있어도 멈추지 않는다.
 */

export const ERD = {
  margin: 16,
  /** 위아래 여백: 상자를 피해 가는 선이 지나갈 자리 */
  marginY: 30,
  colGap: 96,
  boxGap: 26,
  headerH: 30,
  rowH: 22,
  padX: 10,
  markerW: 38,
  typeGap: 14,
  minBoxW: 140,
  stub: 18,
  selfLoop: 44,
  titlePx: 14,
  colPx: 13,
  typePx: 12,
} as const;

export interface ErdRow {
  name: string;
  type: string;
  pk: boolean;
  fk: boolean;
  notnull: boolean;
  /** 행 가운데의 y(절대 좌표) */
  cy: number;
}

export interface ErdBox {
  name: string;
  level: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rowCount: number;
  rows: ErdRow[];
}

export interface ErdEnd {
  table: string;
  column: string;
  x: number;
  y: number;
  /** 상자 바깥쪽 방향: -1 = 왼쪽 변, 1 = 오른쪽 변 */
  dir: -1 | 1;
}

export interface ErdEdge {
  key: string;
  /** 외래키를 가진 표('여러 개' 쪽, 까마귀발) */
  from: ErdEnd;
  /** 가리키는 표('하나' 쪽) */
  to: ErdEnd;
  self: boolean;
  /** 외래키 열이 NULL을 허용하면 '없을 수도 있음'(동그라미) */
  optional: boolean;
  path: string;
}

export interface ErdLayout {
  width: number;
  height: number;
  boxes: ErdBox[];
  edges: ErdEdge[];
}

const isWide = (cp: number) =>
  (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xff60);

/** 글자 폭 어림값(px): 한글·한자 등 넓은 글자는 1em, 나머지는 0.62em */
export function textWidth(s: string, px: number): number {
  let w = 0;
  for (const ch of s) w += isWide(ch.codePointAt(0) ?? 0) ? px : px * 0.62;
  return Math.ceil(w);
}

const lower = (s: string) => s.toLowerCase();

/** 외래키 의존 단계. 그림에 있는 표끼리의 관계만 센다(자기 자신 참조·순환은 무시). */
export function erdLevels(schema: DbSchema): Map<string, number> {
  const byName = new Map(schema.tables.map((t) => [lower(t.name), t]));
  const level = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (t: SchemaTable): number => {
    const k = lower(t.name);
    const known = level.get(k);
    if (known !== undefined) return known;
    if (visiting.has(k)) return 0; // 순환: 되돌아가는 간선은 무시
    visiting.add(k);
    let lv = 0;
    for (const fk of t.fks) {
      const target = byName.get(lower(fk.table));
      if (!target || lower(target.name) === k) continue;
      lv = Math.max(lv, visit(target) + 1);
    }
    visiting.delete(k);
    level.set(k, lv);
    return lv;
  };
  for (const t of schema.tables) visit(t);
  return new Map(schema.tables.map((t) => [t.name, level.get(lower(t.name)) ?? 0]));
}

function boxSize(t: SchemaTable): { w: number; h: number } {
  let w = textWidth(t.name, ERD.titlePx) + textWidth(` · ${t.rowCount}행`, ERD.typePx) + ERD.padX * 2;
  for (const c of t.columns) {
    w = Math.max(w, ERD.padX * 2 + ERD.markerW + textWidth(c.name, ERD.colPx) + ERD.typeGap + textWidth(c.type || '-', ERD.typePx));
  }
  return { w: Math.max(ERD.minBoxW, Math.ceil(w)), h: ERD.headerH + Math.max(1, t.columns.length) * ERD.rowH + 6 };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** 자기 참조·같은 쪽 변끼리: 바깥으로 불룩한 곡선 */
function loopPath(a: ErdEnd, b: ErdEnd, self: boolean): string {
  const a1 = { x: a.x + a.dir * ERD.stub, y: a.y };
  const b1 = { x: b.x + b.dir * ERD.stub, y: b.y };
  const k = self ? ERD.selfLoop - ERD.stub : 40;
  return `M${r1(a.x)} ${r1(a.y)} L${r1(a1.x)} ${r1(a1.y)} C${r1(a1.x + a.dir * k)} ${r1(a1.y)} ${r1(b1.x + b.dir * k)} ${r1(b1.y)} ${r1(b1.x)} ${r1(b1.y)} L${r1(b.x)} ${r1(b.y)}`;
}

/** 점들을 잇는 선: 처음·마지막은 직선(표시 자리), 가운데는 수평 접선을 가진 S자 곡선 또는 수평선 */
function throughPath(pts: { x: number; y: number }[]): string {
  let d = `M${r1(pts[0].x)} ${r1(pts[0].y)} L${r1(pts[1].x)} ${r1(pts[1].y)}`;
  for (let i = 2; i < pts.length - 1; i++) {
    const p = pts[i - 1];
    const q = pts[i];
    if (Math.abs(p.y - q.y) < 0.5) d += ` L${r1(q.x)} ${r1(q.y)}`;
    else {
      const mx = (p.x + q.x) / 2;
      d += ` C${r1(mx)} ${r1(p.y)} ${r1(mx)} ${r1(q.y)} ${r1(q.x)} ${r1(q.y)}`;
    }
  }
  const last = pts[pts.length - 1];
  return d + ` L${r1(last.x)} ${r1(last.y)}`;
}

export function layoutErd(schema: DbSchema): ErdLayout {
  const tables = schema.tables;
  if (!tables.length) return { width: 0, height: 0, boxes: [], edges: [] };
  const levels = erdLevels(schema);
  const maxLevel = Math.max(...levels.values());
  const cols: SchemaTable[][] = Array.from({ length: maxLevel + 1 }, () => []);
  for (const t of tables) cols[levels.get(t.name) ?? 0].push(t);
  const tableByLower = new Map(tables.map((t) => [lower(t.name), t]));

  // 같은 단계 안의 순서: 연결된 행(열) 위치의 평균(barycenter). 위치는 0~1로 어림한다.
  const pos = new Map<string, number>();
  const span = new Map<string, number>();
  const setPos = (col: SchemaTable[]) =>
    col.forEach((t, i) => {
      pos.set(lower(t.name), (i + 0.5) / col.length);
      span.set(lower(t.name), 1 / col.length);
    });
  const rowY = (t: SchemaTable, column: string) => {
    const i = Math.max(0, t.columns.findIndex((c) => lower(c.name) === lower(column)));
    return pos.get(lower(t.name))! + ((i + 0.5) / Math.max(1, t.columns.length) - 0.5) * span.get(lower(t.name))!;
  };
  const mean = (xs: number[], empty: number) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : empty);
  cols[0].sort((a, b) => a.name.localeCompare(b.name));
  setPos(cols[0]);
  for (let lv = 1; lv < cols.length; lv++) {
    const bary = (t: SchemaTable) =>
      mean(
        t.fks.flatMap((f) => {
          const p = tableByLower.get(lower(f.table));
          return p && p !== t && pos.has(lower(p.name)) ? [rowY(p, f.to)] : [];
        }),
        1,
      );
    cols[lv].sort((a, b) => bary(a) - bary(b) || a.name.localeCompare(b.name));
    setPos(cols[lv]);
  }
  if (cols.length > 1) {
    // 0단계는 자기를 가리키는 표(자식)의 외래키 행 위치로 다시 정렬
    const childY = (t: SchemaTable) =>
      mean(
        tables.flatMap((c) => (c === t ? [] : c.fks.filter((f) => lower(f.table) === lower(t.name)).map((f) => rowY(c, f.from)))),
        2,
      );
    cols[0].sort((a, b) => childY(a) - childY(b) || a.name.localeCompare(b.name));
  }

  const sizes = new Map(tables.map((t) => [t.name, boxSize(t)]));
  const colW = cols.map((c) => Math.max(...c.map((t) => sizes.get(t.name)!.w)));
  const colH = cols.map((c) => c.reduce((s, t) => s + sizes.get(t.name)!.h, 0) + ERD.boxGap * (c.length - 1));
  const maxH = Math.max(...colH);
  const boxes: ErdBox[] = [];
  const boxByLower = new Map<string, ErdBox>();
  const colX: number[] = [];
  let x = ERD.margin;
  cols.forEach((col, ci) => {
    colX.push(x);
    let y = ERD.marginY + (maxH - colH[ci]) / 2;
    for (const t of col) {
      const { h } = sizes.get(t.name)!;
      const fkCols = new Set(t.fks.map((f) => lower(f.from)));
      const by = Math.round(y);
      const box: ErdBox = {
        name: t.name,
        level: ci,
        x,
        y: by,
        w: colW[ci],
        h,
        rowCount: t.rowCount,
        rows: t.columns.map((c, i) => ({
          name: c.name,
          type: c.type,
          pk: c.pk,
          fk: fkCols.has(lower(c.name)),
          notnull: c.notnull || c.pk,
          cy: by + ERD.headerH + i * ERD.rowH + ERD.rowH / 2 + 3,
        })),
      };
      boxes.push(box);
      boxByLower.set(lower(t.name), box);
      y += h + ERD.boxGap;
    }
    x += colW[ci] + ERD.colGap;
  });

  /** 두 칸 이상 떨어진 표를 잇는 선은 가운데 칸의 상자를 피해 빈 가로 길(lane)로 지나간다 */
  const laneUse = new Map<number, number>();
  const pickLane = (lo: number, hi: number, wantY: number): number => {
    const mid = boxes.filter((b) => b.level >= lo && b.level <= hi);
    const occupied = mid.map((b) => [b.y - 8, b.y + b.h + 8] as const);
    const cands = [wantY, Math.min(...mid.map((b) => b.y)) - ERD.boxGap / 2, Math.max(...mid.map((b) => b.y + b.h)) + ERD.boxGap / 2];
    for (let lv = lo; lv <= hi; lv++) {
      const inCol = mid.filter((b) => b.level === lv).sort((a, b) => a.y - b.y);
      for (let i = 0; i + 1 < inCol.length; i++) cands.push((inCol[i].y + inCol[i].h + inCol[i + 1].y) / 2);
    }
    const free = cands.filter((y) => occupied.every(([a, b]) => y < a || y > b));
    const best = free.sort((a, b) => Math.abs(a - wantY) - Math.abs(b - wantY))[0] ?? cands[1];
    const key = Math.round(best);
    const n = laneUse.get(key) ?? 0;
    laneUse.set(key, n + 1);
    return best + (n % 2 ? -1 : 1) * Math.ceil(n / 2) * 6;
  };

  const edges: ErdEdge[] = [];
  for (const t of tables) {
    const fromBox = boxByLower.get(lower(t.name))!;
    t.fks.forEach((fk, i) => {
      const toBox = boxByLower.get(lower(fk.table));
      if (!toBox) return; // 그림에 없는 표를 가리키면 선을 그리지 않는다(열에는 FK 표시)
      const fromRow = fromBox.rows.find((r) => lower(r.name) === lower(fk.from));
      const toRow = toBox.rows.find((r) => lower(r.name) === lower(fk.to));
      const fy = fromRow?.cy ?? fromBox.y + ERD.headerH / 2;
      const ty = toRow?.cy ?? toBox.y + ERD.headerH / 2;
      const self = fromBox === toBox;
      let from: ErdEnd;
      let to: ErdEnd;
      let path: string;
      if (self || fromBox.level === toBox.level) {
        const dir = self ? 1 : -1;
        const ex = (b: ErdBox) => (dir === 1 ? b.x + b.w : b.x);
        from = { table: t.name, column: fk.from, x: ex(fromBox), y: fy, dir };
        to = { table: toBox.name, column: fk.to, x: ex(toBox), y: ty, dir };
        path = loopPath(from, to, self);
      } else {
        const leftward = toBox.level < fromBox.level;
        from = { table: t.name, column: fk.from, x: leftward ? fromBox.x : fromBox.x + fromBox.w, y: fy, dir: leftward ? -1 : 1 };
        to = { table: toBox.name, column: fk.to, x: leftward ? toBox.x + toBox.w : toBox.x, y: ty, dir: leftward ? 1 : -1 };
        const a1 = { x: from.x + from.dir * ERD.stub, y: fy };
        const b1 = { x: to.x + to.dir * ERD.stub, y: ty };
        const lo = Math.min(fromBox.level, toBox.level) + 1;
        const hi = Math.max(fromBox.level, toBox.level) - 1;
        if (lo > hi) path = throughPath([from, a1, b1, to]);
        else {
          const lane = pickLane(lo, hi, (fy + ty) / 2);
          const ix0 = colX[lo] - 10;
          const ix1 = colX[hi] + colW[hi] + 10;
          path = throughPath([from, a1, { x: leftward ? ix1 : ix0, y: lane }, { x: leftward ? ix0 : ix1, y: lane }, b1, to]);
        }
      }
      const col = t.columns.find((c) => lower(c.name) === lower(fk.from));
      edges.push({ key: `${t.name}.${fk.from}->${toBox.name}.${fk.to}#${i}`, from, to, self, optional: !(col?.notnull || col?.pk), path });
    });
  }

  const hasSelfInLast = edges.some((e) => e.self && boxByLower.get(lower(e.from.table))?.level === cols.length - 1);
  const width = x - ERD.colGap + ERD.margin + (hasSelfInLast ? ERD.selfLoop : 0);
  const height = ERD.marginY * 2 + maxH;
  return { width: Math.ceil(width), height: Math.ceil(height), boxes, edges };
}

/** 그림을 볼 수 없는 사람을 위한 글 요약 */
export function describeSchema(schema: DbSchema): { tables: string[]; relations: string[] } {
  const names = new Set(schema.tables.map((t) => lower(t.name)));
  const tables = schema.tables.map((t) => {
    const cols = t.columns.map((c) => {
      const tags = [c.type || '자료형 없음', c.pk ? '기본키' : '', t.fks.some((f) => lower(f.from) === lower(c.name)) ? '외래키' : '', c.notnull && !c.pk ? '필수' : ''].filter(Boolean);
      return `${c.name}(${tags.join(', ')})`;
    });
    return `${t.name} 표, ${t.rowCount}행: ${cols.join(', ')}`;
  });
  const relations: string[] = [];
  for (const t of schema.tables) {
    for (const f of t.fks) {
      const shown = names.has(lower(f.table));
      relations.push(
        lower(f.table) === lower(t.name)
          ? `${t.name}.${f.from} → ${f.table}.${f.to}: 같은 표 안에서 다른 행을 가리켜요(자기 참조).`
          : `${t.name}.${f.from} → ${f.table}.${f.to}: ${f.table} 한 행에 ${t.name} 여러 행이 연결돼요(1:N).${shown ? '' : ' (가리키는 표는 그림에 없어요)'}`,
      );
    }
  }
  return { tables, relations };
}
