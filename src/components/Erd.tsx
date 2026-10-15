import { useEffect, useId, useMemo, useState } from 'react';
import type { SessionBase } from '../sql/engine';
import type { DbSchema } from '../sql/schema';
import { loadSchema, type SchemaSource } from '../sql/worker/sqlClient';
import { describeSchema, ERD, layoutErd, type ErdBox, type ErdEdge } from './erdLayout';

/**
 * ERD(개체-관계 다이어그램) 그리기.
 * - ErdDiagram: 이미 읽은 스키마로 그린다(자유 실습장은 실행할 때마다 새 스키마를 넘긴다).
 * - Erd: 학습 데이터셋(또는 실습장 예시)의 스키마를 직접 읽어 그린다. 예) <Erd dataset="school" />
 * - useSchema / loadSchema: 스키마만 필요할 때.
 * 색은 CSS 변수(styles.css의 .erd-*)를 써서 밝은/어두운 화면 모두에서 읽힌다.
 */

export { loadSchema, type SchemaSource } from '../sql/worker/sqlClient';
export type { DbSchema, SchemaColumn, SchemaForeignKey, SchemaTable } from '../sql/schema';

export function useSchema(source: SchemaSource | null): { schema: DbSchema | null; error: string | null } {
  const base = source === null ? null : typeof source === 'string' ? source : source.base;
  const sessionId = source !== null && typeof source !== 'string' ? source.sessionId : null;
  const log = source !== null && typeof source !== 'string' ? source.log : null;
  const [state, setState] = useState<{ schema: DbSchema | null; error: string | null }>({ schema: null, error: null });
  useEffect(() => {
    if (base === null) return;
    let alive = true;
    const src: SchemaSource = sessionId !== null && log !== null ? { base, sessionId, log } : base;
    loadSchema(src).then(
      (schema) => alive && setState({ schema, error: null }),
      (e: unknown) => alive && setState((s) => ({ schema: s.schema, error: (e as Error).message })),
    );
    return () => {
      alive = false;
    };
  }, [base, sessionId, log]);
  return state;
}

function BoxView({ b }: { b: ErdBox }) {
  const r = 6;
  return (
    <g className="erd-box" data-erd-table={b.name} transform={`translate(${b.x} ${b.y})`}>
      <rect className="erd-box-bg" width={b.w} height={b.h} rx={r} />
      <path className="erd-box-head" d={`M0 ${r} a${r} ${r} 0 0 1 ${r} -${r} h${b.w - 2 * r} a${r} ${r} 0 0 1 ${r} ${r} v${ERD.headerH - r} h${-b.w} z`} />
      <line className="erd-sep" x1={0} x2={b.w} y1={ERD.headerH} y2={ERD.headerH} />
      <text className="erd-title" x={ERD.padX} y={20}>
        {b.name}
        <tspan className="erd-count" dx={6}>· {b.rowCount}행</tspan>
      </text>
      {b.rows.map((row) => {
        const y = row.cy - b.y + 4;
        return (
          <g key={row.name}>
            {row.pk && <text className="erd-pk" x={ERD.padX} y={y}>PK</text>}
            {row.fk && <text className="erd-fk" x={ERD.padX + (row.pk ? 18 : 0)} y={y}>FK</text>}
            <text className={row.pk ? 'erd-col erd-col-pk' : 'erd-col'} x={ERD.padX + ERD.markerW} y={y}>{row.name}</text>
            <text className="erd-type" x={b.w - ERD.padX} y={y} textAnchor="end">{row.type || '-'}{row.notnull && !row.pk ? '*' : ''}</text>
          </g>
        );
      })}
    </g>
  );
}

function EdgeView({ e }: { e: ErdEdge }) {
  const a = e.from;
  const b = e.to;
  const fx = a.x + a.dir * 14;
  const bar1 = b.x + b.dir * 7;
  const bar2 = b.x + b.dir * 12;
  return (
    <g className="erd-edge" data-erd-from={a.table} data-erd-to={b.table}>
      <path className="erd-line" d={e.path} />
      {/* '여러 개' 쪽: 까마귀발(갈래) */}
      <path className="erd-line" d={`M${fx} ${a.y} L${a.x} ${a.y - 7} M${fx} ${a.y} L${a.x} ${a.y + 7}`} />
      {/* '하나' 쪽: 세로줄, NULL이 될 수 있으면 동그라미 */}
      <path className="erd-line" d={`M${bar1} ${b.y - 7} V${b.y + 7}`} />
      {e.optional ? <circle className="erd-o" cx={b.x + b.dir * 15} cy={b.y} r={3.5} /> : <path className="erd-line" d={`M${bar2} ${b.y - 7} V${b.y + 7}`} />}
    </g>
  );
}

export function ErdDiagram({ schema, tables, caption = 'ERD' }: {
  schema: DbSchema;
  /** 이 표들만 그린다(없으면 전부). 그림에 없는 표를 가리키는 외래키는 열에 FK로만 표시한다. */
  tables?: string[];
  caption?: string;
}) {
  const id = useId();
  const shown = useMemo<DbSchema>(() => {
    if (!tables) return schema;
    const want = new Set(tables.map((t) => t.toLowerCase()));
    return { tables: schema.tables.filter((t) => want.has(t.name.toLowerCase())) };
  }, [schema, tables]);
  const layout = useMemo(() => layoutErd(shown), [shown]);
  const text = useMemo(() => describeSchema(shown), [shown]);
  if (!shown.tables.length) return <p className="small muted erd-empty">표가 아직 없어요. CREATE TABLE로 표를 만들면 여기에 그려져요.</p>;
  const label = `${caption}: 표 ${layout.boxes.length}개, 관계 선 ${layout.edges.length}개`;
  return (
    <figure className="erd" data-testid="erd">
      <div className="erd-scroll" tabIndex={0} role="region" aria-label={`${caption} 그림, 넓으면 옆으로 밀어 볼 수 있어요`}>
        <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`}>
          <title id={`${id}-t`}>{label}</title>
          <g>{layout.edges.map((e) => <EdgeView key={e.key} e={e} />)}</g>
          {layout.boxes.map((b) => <BoxView key={b.name} b={b} />)}
        </svg>
      </div>
      <figcaption className="erd-legend">
        <span><b className="erd-key-pk">PK</b> 기본키 · <b className="erd-key-fk">FK</b> 외래키 · * 필수(NOT NULL)</span>
        <span>선의 갈래(까마귀발) 쪽이 '여러 개', 세로줄 쪽이 '하나'예요. 동그라미는 '없을 수도 있음'이에요.</span>
      </figcaption>
      <details className="erd-text">
        <summary>ERD를 글로 보기</summary>
        <div id={`${id}-d`}>
          <ul>{text.tables.map((t) => <li key={t}>{t}</li>)}</ul>
          {text.relations.length ? <ul>{text.relations.map((r) => <li key={r}>{r}</li>)}</ul> : <p className="small muted">외래키 관계가 없어요.</p>}
        </div>
      </details>
    </figure>
  );
}

/** 학습 데이터셋·실습장 예시의 시작 상태를 그린다. 예) <Erd dataset="school" tables={DATASET_TABLES.school} /> */
export function Erd({ dataset, tables, caption }: { dataset: SessionBase; tables?: string[]; caption?: string }) {
  const { schema, error } = useSchema(dataset);
  if (!schema) return error ? <p className="notice notice-warn">{error}</p> : <p className="small muted" role="status">ERD를 그리는 중…</p>;
  return <ErdDiagram schema={schema} tables={tables} caption={caption} />;
}
