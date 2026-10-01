import { useId, useState, type ReactNode } from 'react';
import type { DatasetId, ExecMode } from '../content/types';
import type { SqlError } from '../sql/engine';
import type { Cell, ResultSet } from '../sql/grader/compare';
import { outcomeMessage, sqlClient } from '../sql/worker/sqlClient';
import { useFocusGate } from '../features/focus/FocusContext';

export function ModeBadge({ mode }: { mode: ExecMode }) {
  if (mode === 'executable') return <span className="badge badge-exec" title="SQLite 엔진에서 실제로 실행합니다">실제 실행</span>;
  if (mode === 'simulation') return <span className="badge badge-sim" title="제한된 예제로 개념을 시뮬레이션합니다(임의 SQL 실행기 아님)">개념 시뮬레이션</span>;
  return <span className="badge badge-dialect" title="SQLite에 없는 시험 문법을 같은 결과의 대안 SQL과 비교합니다">문법 비교</span>;
}

function CellView({ c }: { c: Cell }) {
  if (c === null) return <span className="null">NULL</span>;
  if (c === '') return <span className="null">''</span>;
  if (typeof c === 'number' && !Number.isInteger(c)) return <>{Number(c.toFixed(6))}</>;
  return <>{String(c)}</>;
}

export function ResultTable({ result, caption, highlight, rowsModified }: { result: ResultSet; caption?: string; highlight?: (row: Cell[], i: number) => boolean; rowsModified?: number }) {
  return (
    <div>
      <div className="table-wrap">
        <table className="data">
          {caption && <caption>{caption}</caption>}
          <thead>
            <tr>
              {result.columns.map((c, i) => (
                <th scope="col" key={i}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.length === 0 && (
              <tr>
                <td colSpan={Math.max(1, result.columns.length)} className="null">결과 0행</td>
              </tr>
            )}
            {result.rows.map((r, i) => (
              <tr key={i} className={highlight?.(r, i) ? 'hit' : undefined}>
                {r.map((c, j) => (
                  <td key={j} className={typeof c === 'number' ? 'num' : undefined}>
                    <CellView c={c} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="result-meta">
        {result.rows.length}행{result.truncated ? ' (처음 200행만 표시)' : ''}
        {rowsModified !== undefined && rowsModified > 0 ? ` · 영향받은 행 ${rowsModified}개` : ''}
      </div>
    </div>
  );
}

export function SqlErrorView({ error }: { error: SqlError }) {
  return (
    <div className="notice notice-bad" role="alert">
      <b>실행 오류{error.line ? ` (${error.line}줄 ${error.col ?? ''}칸 근처)` : ''}</b>
      <p style={{ margin: '0.25rem 0 0' }}>{error.message}</p>
      {error.raw && error.raw !== error.message && <p className="small muted mono" style={{ margin: '0.25rem 0 0' }}>SQLite: {error.raw}</p>}
    </div>
  );
}

/** 보기 전용 SQL + 실제 실행 버튼 (읽기 전용 DB에서 실행) */
export function RunnableSql({ label, sql, dataset, onRan }: { label: string; sql: string; dataset: DatasetId; onRan?: () => void }) {
  const [res, setRes] = useState<ResultSet | null>(null);
  const [err, setErr] = useState<SqlError | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const gate = useFocusGate();
  const run = async () => {
    if (!gate.canAct()) return;
    setBusy(true);
    setMsg(null);
    const o = await sqlClient().run(dataset, sql, ['select']);
    setBusy(false);
    if (o.status === 'stale') return;
    if (o.status !== 'ok') return setMsg(outcomeMessage(o));
    if (!o.data.ok) {
      setErr(o.data.error);
      setRes(null);
    } else {
      setErr(null);
      setRes(o.data.last ?? { columns: [], rows: [] });
      onRan?.();
    }
  };
  return (
    <div className="stack" style={{ gap: '0.4rem' }}>
      <div className="row">
        <button className="btn btn-small" onClick={run} disabled={busy || !gate.active}>
          {busy ? '실행 중…' : `실행: ${label}`}
        </button>
      </div>
      <pre className="codeblock">{sql}</pre>
      {msg && <p className="notice notice-warn">{msg}</p>}
      {err && <SqlErrorView error={err} />}
      {res && <ResultTable result={res} />}
    </div>
  );
}

export function DialectBlock({ sql, title = '시험 문법 (SQLite에서 실행되지 않음)' }: { sql: string; title?: string }) {
  return (
    <div>
      <div className="row" style={{ marginBottom: '0.3rem' }}>
        <span className="badge badge-dialect">문법 비교</span>
        <span className="small muted">{title}</span>
      </div>
      <pre className="codeblock dialect">{sql}</pre>
    </div>
  );
}

export function ChoiceGroup({ legend, options, value, onChange, disabled, correctIndex, name }: {
  legend: ReactNode;
  options: string[];
  value: number | null;
  onChange: (i: number) => void;
  disabled?: boolean;
  correctIndex?: number;
  name?: string;
}) {
  const id = useId();
  return (
    <fieldset disabled={disabled}>
      <legend>{legend}</legend>
      <div className="options">
        {options.map((o, i) => (
          <label key={i} className={`option${correctIndex === i ? ' correct' : ''}`}>
            <input type="radio" name={name ?? id} checked={value === i} onChange={() => onChange(i)} />
            <span>{o}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function SegmentedChoice({ name, options, value, onChange, disabled, label }: {
  name: string;
  label: string;
  options: { id: string; label: string }[];
  value: string | undefined;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <label key={o.id}>
          <input type="radio" name={name} value={o.id} checked={value === o.id} disabled={disabled} onChange={() => onChange(o.id)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h) return `${h}시간 ${m}분`;
  if (m) return `${m}분`;
  return `${sec}초`;
}
