import { useEffect, useState } from 'react';
import type { DatasetId } from '../content/types';
import { DATASET_LABEL, DATASET_TABLES } from '../sql/datasets';
import type { ResultSet } from '../sql/grader/compare';
import { sqlClient } from '../sql/worker/sqlClient';
import { ResultTable } from './common';
import { Erd } from './Erd';

/**
 * 문제에서 쓰는 데이터(표의 모든 행)와 ERD를 펼쳐 보는 패널.
 * 문제 문장만으로 표 내용을 알 수 없을 때 학생이 직접 확인할 수 있게 한다(처음 상태, 읽기 전용).
 */
export function DataPanel({ dataset, open: initialOpen = false }: { dataset: DatasetId; open?: boolean }) {
  const tables = DATASET_TABLES[dataset];
  const [open, setOpen] = useState(initialOpen);
  const [view, setView] = useState<'tables' | 'erd'>('tables');
  const [data, setData] = useState<Record<string, ResultSet> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || data) return;
    let alive = true;
    setErr(null);
    (async () => {
      const out: Record<string, ResultSet> = {};
      for (const t of tables) {
        if (!alive) return;
        // 화면 잠김 등으로 늦은 결과가 버려지면(stale·interrupted) 한 번 더 읽는다
        let o = await sqlClient().query(dataset, `SELECT * FROM ${t}`);
        if (o.status !== 'ok' && alive) o = await sqlClient().query(dataset, `SELECT * FROM ${t}`);
        if (!alive) return;
        if (o.status !== 'ok') {
          setErr('데이터를 불러오지 못했어요. 접었다가 다시 펼쳐 보세요.');
          return;
        }
        out[t] = o.data;
      }
      if (alive) setData(out);
    })();
    return () => {
      alive = false;
    };
  }, [open, data, dataset, tables]);

  return (
    <details className="data-panel panel" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <b>데이터 보기</b> <span className="small muted">{DATASET_LABEL[dataset]} · {tables.join(', ')} 표</span>
      </summary>
      {open && (
        <div className="stack" style={{ marginTop: '0.6rem' }}>
          <div className="seg" role="group" aria-label="보기 방식">
            <button type="button" className={view === 'tables' ? 'on' : ''} aria-pressed={view === 'tables'} onClick={() => setView('tables')}>표 보기</button>{' '}
            <button type="button" className={view === 'erd' ? 'on' : ''} aria-pressed={view === 'erd'} onClick={() => setView('erd')}>ERD 보기</button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>문제를 풀기 전 처음 상태의 데이터예요(바꿔도 여기에는 반영되지 않아요).</p>
          {view === 'erd' ? (
            <Erd dataset={dataset} tables={tables} caption={`${DATASET_LABEL[dataset]} ERD`} />
          ) : err ? (
            <p className="notice notice-warn">{err}</p>
          ) : !data ? (
            <p className="small muted" role="status">불러오는 중…</p>
          ) : (
            tables.map((t) => <ResultTable key={t} result={data[t]} caption={`${t} (${data[t].rows.length}행)`} />)
          )}
        </div>
      )}
    </details>
  );
}
