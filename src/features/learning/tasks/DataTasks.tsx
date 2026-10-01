import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GroupVisualizerConfig, HierarchyConfig, JoinVisualizerConfig, PivotConfig, TransactionConfig, WindowVisualizerConfig } from '../../../content/types';
import { DialectBlock, ResultTable, RunnableSql, SqlErrorView } from '../../../components/common';
import type { SqlError } from '../../../sql/engine';
import { compareResults, formatCell, type Cell, type ResultSet } from '../../../sql/grader/compare';
import { outcomeMessage, sqlClient } from '../../../sql/worker/sqlClient';
import { useFocusGate } from '../../focus/FocusContext';
import { cellKey, useQuery } from '../useQuery';
import type { TaskProps } from './types';

const label = (row: Cell[]) => row.slice(1).map(formatCell).join(' · ');

function parseNum(s: string): number | null | 'bad' {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : 'bad';
}
const numEq = (a: Cell, b: number | null | 'bad') => (a === null ? b === null : typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 0.01 + 1e-9 * Math.abs(a));

/* ---------------- 조인 연결 ---------------- */
export function JoinTask(props: TaskProps<JoinVisualizerConfig>) {
  const { config: c, progress } = props;
  const ds = props.activity.datasetId;
  const left = useQuery(ds, c.leftSql);
  const right = useQuery(ds, c.rightSql);
  const answer = useQuery(ds, c.pairsSql);
  const [pairs, setPairs] = useState<[string, string | null][]>((progress.state.pairs as [string, string | null][]) ?? []);
  const [sel, setSel] = useState<string | null>(null);
  const [solved, setSolved] = useState(false);
  const gate = useFocusGate();
  const save = (p: [string, string | null][]) => {
    setPairs(p);
    setSolved(false);
    props.saveState({ pairs: p });
  };
  const has = (l: string, r: string | null) => pairs.some(([a, b]) => a === l && b === r);
  const toggle = (l: string, r: string | null) => {
    if (has(l, r)) save(pairs.filter(([a, b]) => !(a === l && b === r)));
    else save([...pairs.filter(([a, b]) => !(a === l && (b === null || r === null))), [l, r]]);
  };
  const lname = (id: string) => label(left.data?.rows.find((r) => cellKey(r[0]) === id) ?? []);
  const rname = (id: string | null) => (id === null ? 'NULL(짝 없음)' : label(right.data?.rows.find((r) => cellKey(r[0]) === id) ?? []));

  const submit = () => {
    if (!gate.canAct() || !answer.data) return;
    const want = new Set(answer.data.rows.map((r) => `${cellKey(r[0])}|${r[1] === null ? 'NULL' : cellKey(r[1])}`));
    const got = new Set(pairs.map(([a, b]) => `${a}|${b ?? 'NULL'}`));
    const missing = [...want].find((k) => !got.has(k));
    const extra = [...got].find((k) => !want.has(k));
    const ok = !missing && !extra;
    setSolved(ok);
    let msg = `모든 짝(${want.size}쌍)을 맞게 연결했어요.`;
    if (extra) { const [l, r] = extra.split('|'); msg = `'${lname(l)}' ↔ '${rname(r === 'NULL' ? null : r)}'는 키 값이 같지 않거나 이 조인에서는 생기지 않는 짝이에요.`; }
    else if (missing) { const [l, r] = missing.split('|'); msg = r === 'NULL' ? `'${lname(l)}'는 짝이 없어요. LEFT JOIN에서는 어떻게 남겨야 할까요?` : `아직 연결하지 않은 짝이 있어요. '${lname(l)}'와 키가 같은 행을 찾아보세요.`; }
    props.report({ correct: ok, meaningful: true, message: msg });
  };

  return (
    <div className="stack">
      <p className="small muted">① 왼쪽 행을 고르고 ② 키 값이 같은 오른쪽 행을 누르면 연결돼요. 다시 누르면 연결이 풀려요.</p>
      <div className="join-cols">
        <div>
          <p className="step-label">{c.leftTitle}</p>
          {left.data?.rows.map((r) => {
            const id = cellKey(r[0]);
            return (
              <button key={id} type="button" className={`rowbtn${pairs.some(([a]) => a === id) ? ' linked' : ''}`} aria-pressed={sel === id} onClick={() => setSel(sel === id ? null : id)}>
                {label(r)}
              </button>
            );
          })}
          {c.keepUnmatchedLeft && (
            <button type="button" className="btn btn-small" disabled={!sel} onClick={() => sel && toggle(sel, null)}>
              선택한 행을 NULL로 남기기
            </button>
          )}
        </div>
        <div>
          <p className="step-label">{c.rightTitle} {sel ? `← '${lname(sel)}'와 연결할 행 선택` : ''}</p>
          {right.data?.rows.map((r) => {
            const id = cellKey(r[0]);
            return (
              <button key={id} type="button" className={`rowbtn${pairs.some(([, b]) => b === id) ? ' linked' : ''}`} aria-pressed={!!sel && has(sel, id)} disabled={!sel} onClick={() => sel && toggle(sel, id)}>
                {label(r)}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className="step-label">연결한 짝 {pairs.length}개</p>
        <div className="pairs" aria-live="polite">
          {pairs.map(([l, r]) => (
            <button key={`${l}|${r}`} type="button" className="chip" onClick={() => toggle(l, r)} aria-label={`${lname(l)}와 ${rname(r)} 연결 풀기`}>
              {lname(l)} ↔ {rname(r)} ✕
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <button className="btn btn-primary" disabled={!pairs.length || !gate.active} onClick={submit}>연결 제출</button>
        <button className="btn" disabled={!pairs.length} onClick={() => save([])}>모두 지우기</button>
      </div>
      {solved && (
        <div className="stack">
          <p className="step-label">실제 JOIN 실행으로 확인</p>
          <RunnableSql label="JOIN" sql={c.joinSql} dataset={ds} />
          {c.altJoinSql?.map((a) => <RunnableSql key={a.label} label={a.label} sql={a.sql} dataset={ds} />)}
        </div>
      )}
    </div>
  );
}

/* ---------------- 그룹 상자 ---------------- */
export function GroupTask(props: TaskProps<GroupVisualizerConfig>) {
  const { config: c, progress } = props;
  const ds = props.activity.datasetId;
  const rows = useQuery(ds, c.rowsSql);
  const groupOf = useQuery(ds, c.groupOfRowSql);
  const agg = useQuery(ds, c.aggregateSql);
  const [assign, setAssign] = useState<Record<string, string>>((progress.state.assign as Record<string, string>) ?? {});
  const [vals, setVals] = useState<Record<string, string>>((progress.state.vals as Record<string, string>) ?? {});
  const [solved, setSolved] = useState(false);
  const gate = useFocusGate();
  const groups = useMemo(() => [...new Set(groupOf.data?.rows.map((r) => String(r[1])) ?? [])].sort(), [groupOf.data]);
  const save = (a: Record<string, string>, v: Record<string, string>) => {
    setAssign(a);
    setVals(v);
    setSolved(false);
    props.saveState({ assign: a, vals: v });
  };
  const submit = () => {
    if (!gate.canAct() || !groupOf.data || !agg.data || !rows.data) return;
    const want = Object.fromEntries(groupOf.data.rows.map((r) => [cellKey(r[0]), String(r[1])]));
    const wrongRow = rows.data.rows.find((r) => assign[cellKey(r[0])] !== want[cellKey(r[0])]);
    if (wrongRow) return props.report({ correct: false, meaningful: true, message: `행 (${label(wrongRow)})이 들어갈 상자를 다시 보세요. 묶는 기준 열의 값이 같은 상자로 가요.` });
    const wrongAgg = agg.data.rows.find((r) => !numEq(r[1], parseNum(vals[String(r[0])] ?? '')));
    if (wrongAgg) return props.report({ correct: false, meaningful: true, message: `'${wrongAgg[0]}' 상자의 ${c.aggregateLabel} 값을 다시 세어 보세요.` });
    setSolved(true);
    props.report({ correct: true, meaningful: true, message: `행을 ${groups.length}개 그룹으로 묶고 ${c.aggregateLabel}를 맞게 계산했어요.` });
  };
  return (
    <div className="stack">
      <div className="table-wrap">
        <table className="data">
          <caption>행마다 들어갈 그룹 상자를 고르세요</caption>
          <thead><tr>{rows.data?.columns.slice(1).map((h) => <th scope="col" key={h}>{h}</th>)}<th scope="col">그룹 상자</th></tr></thead>
          <tbody>
            {rows.data?.rows.map((r) => {
              const id = cellKey(r[0]);
              return (
                <tr key={id}>
                  {r.slice(1).map((v, i) => <td key={i} className={v === null ? 'null' : undefined}>{formatCell(v)}</td>)}
                  <td>
                    <select aria-label={`행 ${label(r)}의 그룹`} value={assign[id] ?? ''} onChange={(e) => save({ ...assign, [id]: e.target.value }, vals)}>
                      <option value="">선택</option>
                      {groups.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="kpis">
        {groups.map((g) => (
          <div className="kpi" key={g}>
            <span>{g} 상자 · {Object.values(assign).filter((x) => x === g).length}행 넣음</span>
            <label className="small">{c.aggregateLabel} = <input type="number" inputMode="decimal" value={vals[g] ?? ''} onChange={(e) => save(assign, { ...vals, [g]: e.target.value })} aria-label={`${g}의 ${c.aggregateLabel}`} /></label>
          </div>
        ))}
      </div>
      <div className="row"><button className="btn btn-primary" disabled={!gate.active} onClick={submit}>그룹 제출</button></div>
      {solved && <RunnableSql label="GROUP BY 실행" sql={c.groupSql} dataset={ds} />}
    </div>
  );
}

/* ---------------- 윈도우 값 채우기 ---------------- */
export function WindowTask(props: TaskProps<WindowVisualizerConfig>) {
  const { config: c, progress } = props;
  const ds = props.activity.datasetId;
  const rows = useQuery(ds, c.rowsSql);
  const ans = useQuery(ds, c.answerSql);
  const [vals, setVals] = useState<Record<string, string>>((progress.state.vals as Record<string, string>) ?? {});
  const [solved, setSolved] = useState(false);
  const gate = useFocusGate();
  const cols = ans.data?.columns.slice(1) ?? [];
  const submit = () => {
    if (!gate.canAct() || !ans.data || !rows.data) return;
    for (const r of ans.data.rows) {
      for (let ci = 1; ci < r.length; ci++) {
        const key = `${cellKey(r[0])}:${ci}`;
        if (!numEq(r[ci], parseNum(vals[key] ?? ''))) {
          const row = rows.data.rows.find((x) => cellKey(x[0]) === cellKey(r[0]));
          return props.report({ correct: false, meaningful: true, message: `행 (${row ? label(row) : r[0]})의 ${ans.data.columns[ci]} 값을 다시 생각해 보세요. 동점이 있는지, 앞에 몇 행이 있는지 세어 보세요.` });
        }
      }
    }
    setSolved(true);
    props.report({ correct: true, meaningful: true, message: '모든 행에 순위를 맞게 붙였어요. 행 수는 그대로예요.' });
  };
  return (
    <div className="stack">
      <div className="table-wrap">
        <table className="data">
          <caption>각 행의 값을 채우세요</caption>
          <thead><tr>{rows.data?.columns.slice(1).map((h) => <th scope="col" key={h}>{h}</th>)}{cols.map((h) => <th scope="col" key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.data?.rows.map((r) => {
              const id = cellKey(r[0]);
              return (
                <tr key={id}>
                  {r.slice(1).map((v, i) => <td key={i}>{formatCell(v)}</td>)}
                  {cols.map((h, ci) => (
                    <td key={h}>
                      <input type="number" inputMode="numeric" aria-label={`행 ${label(r)}의 ${h}`} value={vals[`${id}:${ci + 1}`] ?? ''} onChange={(e) => { const n = { ...vals, [`${id}:${ci + 1}`]: e.target.value }; setVals(n); setSolved(false); props.saveState({ vals: n }); }} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row"><button className="btn btn-primary" disabled={!gate.active} onClick={submit}>순위 제출</button></div>
      {solved && <RunnableSql label="윈도우 함수 실행" sql={c.windowSql} dataset={ds} />}
    </div>
  );
}

/* ---------------- 트랜잭션 ---------------- */
export function TransactionTask(props: TaskProps<TransactionConfig>) {
  const { config: c, progress } = props;
  const ds = props.activity.datasetId;
  const [log, setLog] = useState<string[]>((progress.state.log as string[]) ?? c.initialLog);
  const [view, setView] = useState<{ state?: ResultSet; inTx?: boolean; error?: SqlError; info?: string }>({});
  const [busy, setBusy] = useState(false);
  const gate = useFocusGate();
  const sessionId = `tx:${props.activity.id}`;

  const refresh = useCallback(async (l: string[]) => {
    const o = await sqlClient().sessionExec(sessionId, ds, l, c.stateSql, ['select']);
    if (o.status === 'stale') return;
    if (o.status !== 'ok') return setView({ info: outcomeMessage(o) ?? '' });
    setView((v) => ({ ...v, state: o.data.output.ok ? o.data.output.last : undefined, inTx: o.data.inTransaction }));
  }, [sessionId, ds, c.stateSql]);

  useEffect(() => {
    void refresh(log);
  }, [refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (sql: string) => {
    if (!gate.canAct() || busy) return;
    setBusy(true);
    const o = await sqlClient().sessionExec(sessionId, ds, log, sql, ['insert', 'update', 'delete', 'tcl', 'select']);
    setBusy(false);
    if (o.status === 'stale') return;
    if (o.status !== 'ok') return setView((v) => ({ ...v, info: outcomeMessage(o) ?? '' }));
    if (!o.data.output.ok) return setView((v) => ({ ...v, error: o.data.output.ok ? undefined : o.data.output.error, info: undefined }));
    const next = [...log, sql];
    setLog(next);
    props.saveState({ log: next });
    setView({});
    await refresh(next);
  };
  const reset = async () => {
    setLog(c.initialLog);
    props.saveState({ log: c.initialLog });
    setView({});
    await refresh(c.initialLog);
  };
  const submit = async () => {
    if (!gate.canAct()) return;
    const t = await sqlClient().sessionExec(`target:${props.activity.id}`, ds, [...c.initialLog, ...c.solutionActions], c.stateSql, ['select']);
    if (t.status !== 'ok' || !t.data.output.ok || !t.data.output.last || !view.state) return;
    if (c.requireClosed && view.inTx) return props.report({ correct: false, meaningful: true, message: '아직 트랜잭션이 열려 있어요. 변경을 확정하거나 취소해 트랜잭션을 끝내야 해요.' });
    const cmp = compareResults(t.data.output.last, view.state, { ordered: true });
    props.report({ correct: cmp.pass, meaningful: true, message: cmp.pass ? '원하는 변경만 남기고 트랜잭션을 마쳤어요.' : '표 상태가 목표와 달라요. 어떤 변경이 남았거나 사라졌는지 실행 기록을 보며 확인해 보세요. 처음 상태로 돌아가 다시 해도 돼요.' });
  };
  return (
    <div className="stack">
      <div className="panel">
        <p className="step-label">실행 기록 (위에서부터 실행됨)</p>
        <ol className="mono small" style={{ margin: 0 }}>{log.map((l, i) => <li key={i}>{l}</li>)}</ol>
        <p className="small" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
          트랜잭션 상태: <b>{view.inTx === undefined ? '확인 중' : view.inTx ? '열려 있음(아직 확정 안 됨)' : '닫혀 있음'}</b>
        </p>
      </div>
      <div className="row">
        {c.actions.map((a) => <button key={a.id} className="btn" disabled={busy || !gate.active} onClick={() => void act(a.sql)}>{a.label}</button>)}
      </div>
      <div aria-live="polite">
        {view.error && <SqlErrorView error={view.error} />}
        {view.info && <p className="notice notice-warn">{view.info}</p>}
      </div>
      {view.state && <ResultTable result={view.state} caption="지금 camp_signup 상태(실제 SQLite 실행)" />}
      <div className="row">
        <button className="btn btn-primary" disabled={!gate.active || !view.state} onClick={() => void submit()}>이 상태로 제출</button>
        <button className="btn" onClick={() => void reset()}>처음 상태로</button>
      </div>
    </div>
  );
}

/* ---------------- 피벗 ---------------- */
export function PivotTask(props: TaskProps<PivotConfig>) {
  const { config: c, progress } = props;
  const ds = props.activity.datasetId;
  const src = useQuery(ds, c.sourceSql);
  const ans = useQuery(ds, c.answerSql);
  const [vals, setVals] = useState<Record<string, string>>((progress.state.vals as Record<string, string>) ?? {});
  const [solved, setSolved] = useState(false);
  const gate = useFocusGate();
  const submit = () => {
    if (!gate.canAct() || !ans.data) return;
    for (const r of ans.data.rows) for (let ci = 1; ci < r.length; ci++) {
      if (!numEq(r[ci], parseNum(vals[`${cellKey(r[0])}:${ci}`] ?? ''))) {
        return props.report({ correct: false, meaningful: true, message: `${r[0]}의 ${ans.data.columns[ci]} 칸을 다시 보세요. 원본에 그 학과·월 행이 없다면 비워 둬요(NULL).` });
      }
    }
    setSolved(true);
    props.report({ correct: true, meaningful: true, message: '교차표를 맞게 채웠어요.' });
  };
  return (
    <div className="stack">
      <div className="join-cols">
        {src.data && <ResultTable result={src.data} caption="원본(세로로 쌓인 데이터)" />}
        <div className="table-wrap">
          <table className="data">
            <caption>교차표(빈 칸 = NULL)</caption>
            <thead><tr>{ans.data?.columns.map((h) => <th scope="col" key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {ans.data?.rows.map((r) => (
                <tr key={cellKey(r[0])}>
                  <th scope="row">{formatCell(r[0])}</th>
                  {r.slice(1).map((_, i) => (
                    <td key={i}>
                      <input type="number" aria-label={`${r[0]} ${ans.data!.columns[i + 1]}`} value={vals[`${cellKey(r[0])}:${i + 1}`] ?? ''} onChange={(e) => { const n = { ...vals, [`${cellKey(r[0])}:${i + 1}`]: e.target.value }; setVals(n); setSolved(false); props.saveState({ vals: n }); }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="row"><button className="btn btn-primary" disabled={!gate.active} onClick={submit}>교차표 제출</button></div>
      <DialectBlock sql={c.dialectSql} />
      {solved && <RunnableSql label="SQLite 대안(조건부 집계) 실제 실행" sql={c.equivalentSql} dataset={ds} />}
    </div>
  );
}

/* ---------------- 계층 트리 ---------------- */
export function HierarchyTask(props: TaskProps<HierarchyConfig>) {
  const { config: c, progress } = props;
  const ds = props.activity.datasetId;
  const nodes = useQuery(ds, c.nodesSql);
  const ans = useQuery(ds, c.answerSql);
  const [picked, setPicked] = useState<string[]>((progress.state.picked as string[]) ?? []);
  const [solved, setSolved] = useState(false);
  const gate = useFocusGate();
  const children = useMemo(() => {
    const m = new Map<string, Cell[][]>();
    for (const r of nodes.data?.rows ?? []) {
      const p = r[1] === null ? 'root' : cellKey(r[1]);
      m.set(p, [...(m.get(p) ?? []), r]);
    }
    return m;
  }, [nodes.data]);
  const toggle = (id: string) => {
    const n = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setPicked(n);
    setSolved(false);
    props.saveState({ picked: n });
  };
  const render = (parent: string): React.ReactNode => {
    const kids = children.get(parent);
    if (!kids?.length) return null;
    return (
      <ul className={parent === 'root' ? 'tree' : undefined}>
        {kids.map((r) => {
          const id = cellKey(r[0]);
          return (
            <li key={id}>
              <label className="row" style={{ gap: '0.4rem' }}>
                <input type="checkbox" checked={picked.includes(id)} onChange={() => toggle(id)} />
                <span>{String(r[2])} <span className="muted small mono">(id {id}{r[1] !== null ? `, 부모 ${r[1]}` : ''})</span></span>
              </label>
              {render(id)}
            </li>
          );
        })}
      </ul>
    );
  };
  const submit = () => {
    if (!gate.canAct() || !ans.data) return;
    const want = new Set(ans.data.rows.map((r) => cellKey(r[0])));
    const got = new Set(picked);
    const extra = picked.find((p) => !want.has(p));
    const missing = [...want].find((w) => !got.has(w));
    const name = (id: string) => String(nodes.data?.rows.find((r) => cellKey(r[0]) === id)?.[2] ?? id);
    const ok = !extra && !missing;
    setSolved(ok);
    props.report({ correct: ok, meaningful: true, message: ok ? `${want.size}개 하위 동아리를 모두 찾았어요.` : extra ? `'${name(extra)}'는 ${c.question}에 속하지 않아요. 부모를 따라 올라가 보세요.` : `빠진 동아리가 있어요. 자식의 자식(손자)까지 확인해 보세요.` });
  };
  return (
    <div className="stack">
      <div className="panel">
        <p className="step-label">{c.question}을(를) 모두 고르세요</p>
        {render('root')}
      </div>
      <div className="row"><button className="btn btn-primary" disabled={!picked.length || !gate.active} onClick={submit}>선택 제출</button></div>
      {c.dialectSql && <DialectBlock sql={c.dialectSql} />}
      {solved && c.runnable.map((r) => <RunnableSql key={r.label} label={r.label} sql={r.sql} dataset={ds} />)}
    </div>
  );
}
