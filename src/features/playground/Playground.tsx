import { useState } from 'react';
import { ALL_DATASETS, DATASET_LABEL, DATASET_TABLES } from '../../sql/datasets';
import type { DatasetId } from '../../content/types';
import { ResultTable, SqlErrorView } from '../../components/common';
import type { SqlError } from '../../sql/engine';
import type { ResultSet } from '../../sql/grader/compare';
import { outcomeMessage, sqlClient } from '../../sql/worker/sqlClient';
import { useFocusGate } from '../focus/FocusContext';
import { useQuery } from '../learning/useQuery';

/** 자유 실습장: 진도와 별개. 독립 세션 DB에서 실행하며 데이터 변경은 이 화면 안에서만 유지(초기화 가능). */
export function Playground() {
  const [dataset, setDataset] = useState<DatasetId>('school');
  const [sql, setSql] = useState('SELECT * FROM students;');
  const [log, setLog] = useState<string[]>([]);
  const [view, setView] = useState<{ result?: ResultSet; error?: SqlError; info?: string; rows?: number }>({});
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState(1);
  const gate = useFocusGate();
  const schemaSql = `SELECT m.name AS 테이블, group_concat(p.name || ' ' || p.type || CASE WHEN p.pk > 0 THEN ' PK' ELSE '' END, ', ') AS 열
FROM sqlite_schema m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' AND m.name IN (${DATASET_TABLES[dataset].map((t) => `'${t}'`).join(',')}) GROUP BY m.name ORDER BY m.name`;
  const schema = useQuery(dataset, schemaSql);
  const sid = `playground:${session}`;

  const run = async () => {
    if (!gate.canAct() || busy) return;
    setBusy(true);
    const o = await sqlClient().sessionExec(sid, dataset, log, sql, ['select', 'insert', 'update', 'delete', 'create', 'drop', 'alter', 'tcl']);
    setBusy(false);
    if (o.status === 'stale') return;
    if (o.status !== 'ok') {
      // 시간 초과·중단 시 Worker가 재시작되어 세션은 기록(log)으로 다시 만들어진다.
      return setView({ info: outcomeMessage(o) ?? '' });
    }
    const out = o.data.output;
    if (!out.ok) return setView({ error: out.error, info: '오류가 난 실행은 전체를 되돌렸어요.' });
    setLog([...log, sql]);
    setView({ result: out.last, rows: out.rowsModified, info: out.last ? undefined : `실행 완료${out.rowsModified ? ` · 영향받은 행 ${out.rowsModified}개` : ''}${o.data.inTransaction ? ' · 트랜잭션 열림' : ''}` });
  };
  const reset = () => {
    setLog([]);
    setSession((s) => s + 1);
    setView({ info: '데이터를 처음 상태로 되돌렸어요.' });
  };

  return (
    <div className="page stack">
      <h1>자유 실습장</h1>
      <p className="muted">진도·경험치와 관계없는 연습 공간이에요. INSERT/UPDATE/DELETE/CREATE도 실행할 수 있고, 바뀐 데이터는 이 화면에서만 유지돼요. SQLite 엔진이라 Oracle/SQL Server 전용 문법은 실행되지 않아요.</p>
      <div className="learn-grid">
        <aside className="panel stack">
          <label className="stack" style={{ gap: '0.25rem' }}>
            <span className="step-label">데이터셋</span>
            <select value={dataset} onChange={(e) => { setDataset(e.target.value as DatasetId); setLog([]); setSession((s) => s + 1); setView({}); }}>
              {ALL_DATASETS.map((d) => <option key={d} value={d}>{DATASET_LABEL[d]}</option>)}
            </select>
          </label>
          {schema.data && <ResultTable result={schema.data} caption="스키마" />}
          <p className="small muted">실행 기록 {log.length}개</p>
        </aside>
        <section className="stack">
          <label htmlFor="pg-editor" className="step-label">SQL</label>
          <textarea id="pg-editor" className="editor" spellCheck={false} value={sql} onChange={(e) => setSql(e.target.value)} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void run(); } }} />
          <div className="row">
            <button className="btn btn-primary" disabled={busy || !gate.active} onClick={() => void run()}>{busy ? '실행 중…' : '실행 (Ctrl+Enter)'}</button>
            <button className="btn" onClick={reset}>데이터 초기화</button>
          </div>
          <div aria-live="polite" className="stack">
            {view.info && <p className="notice">{view.info}</p>}
            {view.error && <SqlErrorView error={view.error} />}
            {view.result && <ResultTable result={view.result} rowsModified={view.rows} />}
          </div>
        </section>
      </div>
    </div>
  );
}
