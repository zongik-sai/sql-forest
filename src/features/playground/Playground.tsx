import { useEffect, useMemo, useRef, useState } from 'react';
import { ALL_DATASETS, DATASET_LABEL, DATASET_TABLES } from '../../sql/datasets';
import type { DatasetId } from '../../content/types';
import { ResultTable, SqlErrorView } from '../../components/common';
import { ErdDiagram, useSchema } from '../../components/Erd';
import type { SqlError } from '../../sql/engine';
import type { ResultSet } from '../../sql/grader/compare';
import { quoteIdent } from '../../sql/schema';
import { presetBase, presetOfBase, type SessionBase } from '../../sql/sessionBase';
import { outcomeMessage, sqlClient } from '../../sql/worker/sqlClient';
import { useFocusGate } from '../focus/FocusContext';
import { PLAYGROUND_PRESETS, PRESET_BY_ID, type StarterSql } from './presets';
import { TableBuilder } from './TableBuilder';

const ALLOW = ['select', 'insert', 'update', 'delete', 'create', 'drop', 'alter', 'tcl'] as const;

interface BaseInfo {
  title: string;
  summary: string;
  starters: StarterSql[];
}

function baseInfo(base: SessionBase): BaseInfo {
  const p = presetOfBase(base);
  if (p) return PRESET_BY_ID[p];
  const d = base as DatasetId;
  const tables = DATASET_TABLES[d];
  const starters: StarterSql[] =
    d === 'school'
      ? [
          { label: '학생 목록', sql: 'SELECT * FROM students;' },
          { label: '학생과 학과 이름 (JOIN)', sql: 'SELECT s.student_name AS 이름, d.dept_name AS 학과, s.grade AS 학년\nFROM students s\nJOIN departments d ON d.dept_id = s.dept_id\nORDER BY s.student_id;' },
        ]
      : [{ label: `${tables[0]} 전체 보기`, sql: `SELECT * FROM ${tables[0]};` }];
  return { title: DATASET_LABEL[d], summary: `단원 학습에서 쓰는 데이터예요. 주로 쓰는 표: ${tables.join(', ')}`, starters };
}

type Tab = 'erd' | 'builder';

/**
 * 자유 실습장: 진도와 별개. 독립 세션 DB에서 실행하며 데이터 변경은 이 화면 안에서만 유지(초기화 가능).
 * 시작 데이터는 학습 데이터셋 또는 학교 예시(presets.ts). 실행할 때마다 스키마·ERD를 새로 읽는다.
 */
export function Playground() {
  const [base, setBase] = useState<SessionBase>('school');
  const [pending, setPending] = useState<SessionBase | null>(null);
  const [sql, setSql] = useState('SELECT * FROM students;');
  const [log, setLog] = useState<string[]>([]);
  const [changes, setChanges] = useState(0);
  const [view, setView] = useState<{ result?: ResultSet; error?: SqlError; info?: string; rows?: number }>({});
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState(1);
  const [tab, setTab] = useState<Tab>('erd');
  // 좁은 화면에서는 스키마 목록을 접어 두어 편집기가 먼저 보이게 한다
  const [schemaOpen] = useState(() => typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(min-width: 861px)').matches);
  const gate = useFocusGate();
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const sid = `playground:${session}`;
  const info = useMemo(() => baseInfo(base), [base]);
  const schemaSource = useMemo(() => ({ base, sessionId: sid, log }), [base, sid, log]);
  const { schema, error: schemaError } = useSchema(schemaSource);

  // 바뀐 세션 DB는 Worker에서 닫는다
  useEffect(() => () => void sqlClient().closeSession(sid), [sid]);

  /** 실습 DB에서 실행. 성공하면 기록(log)에 더하고 스키마·ERD가 다시 그려진다. */
  const execute = async (text: string): Promise<{ ok: boolean; rowsModified?: number }> => {
    if (!gate.canAct() || busy) return { ok: false };
    setBusy(true);
    const o = await sqlClient().sessionExec(sid, base, log, text, [...ALLOW]);
    setBusy(false);
    if (o.status === 'stale') return { ok: false };
    if (o.status !== 'ok') {
      // 시간 초과·중단 시 Worker가 재시작되어 세션은 기록(log)으로 다시 만들어진다.
      setView({ info: outcomeMessage(o) ?? '' });
      return { ok: false };
    }
    const out = o.data.output;
    if (!out.ok) {
      setView({ error: out.error, info: '오류가 난 실행은 전체를 되돌렸어요.' });
      return { ok: false };
    }
    setLog([...log, text]);
    if (out.statements.some((s) => s.type !== 'select')) setChanges((n) => n + 1);
    setView({ result: out.last, rows: out.rowsModified, info: out.last ? undefined : `실행 완료${out.rowsModified ? ` · 영향받은 행 ${out.rowsModified}개` : ''}${o.data.inTransaction ? ' · 트랜잭션 열림' : ''}` });
    return { ok: true, rowsModified: out.rowsModified };
  };

  const run = () => void execute(sql);

  const loadBase = (next: SessionBase) => {
    const ni = baseInfo(next);
    setBase(next);
    setPending(null);
    setLog([]);
    setChanges(0);
    setSession((s) => s + 1);
    setSql(ni.starters[0]?.sql ?? '');
    setView({ info: `'${ni.title}' 데이터를 불러왔어요. 편집기의 SQL을 실행해 보세요.` });
  };

  const choose = (next: SessionBase) => {
    if (next === base) return setPending(null);
    if (changes > 0) return setPending(next);
    loadBase(next);
  };

  const reset = () => {
    setLog([]);
    setChanges(0);
    setPending(null);
    setSession((s) => s + 1);
    setView({ info: '데이터를 처음 상태로 되돌렸어요.' });
  };

  const putInEditor = (text: string) => {
    setSql(text);
    editorRef.current?.focus();
  };

  const tables = schema?.tables ?? [];

  return (
    <div className="page stack pg-page">
      <h1>자유 실습장</h1>
      <p className="muted" style={{ margin: 0 }}>진도·경험치와 관계없는 연습 공간이에요. INSERT/UPDATE/DELETE/CREATE도 실행할 수 있고, 바뀐 데이터는 이 화면에서만 유지돼요. SQLite 엔진이라 Oracle/SQL Server 전용 문법은 실행되지 않아요.</p>
      <div className="pg-layout">
        <aside className="panel stack pg-side" aria-label="실습 데이터">
          <label className="stack" style={{ gap: '0.25rem' }}>
            <span className="step-label">예시 데이터 불러오기</span>
            <select value={pending ?? base} onChange={(e) => choose(e.target.value as SessionBase)}>
              <optgroup label="학교 예시">
                {PLAYGROUND_PRESETS.map((p) => <option key={p.id} value={presetBase(p.id)}>{p.title}</option>)}
              </optgroup>
              <optgroup label="단원 학습 데이터">
                {ALL_DATASETS.map((d) => <option key={d} value={d}>{DATASET_LABEL[d]}</option>)}
              </optgroup>
            </select>
          </label>
          {pending && (
            <div className="notice notice-warn stack" role="alert" style={{ gap: '0.5rem' }}>
              <span>지금까지 바꾼 내용({changes}번 실행)이 사라지고 '{baseInfo(pending).title}' 데이터로 바뀌어요. 바꿀까요?</span>
              <div className="row">
                <button className="btn btn-small btn-primary" onClick={() => loadBase(pending)}>바꾸기</button>
                <button className="btn btn-small" onClick={() => setPending(null)}>취소</button>
              </div>
            </div>
          )}
          <div className="stack pg-about" style={{ gap: '0.4rem' }}>
            <h2 className="pg-h2">{info.title}</h2>
            <p className="small" style={{ margin: 0 }}>{info.summary}</p>
            <span className="step-label">이렇게 시작해 보세요</span>
            <ul className="pg-starters">
              {info.starters.map((s) => (
                <li key={s.label}>
                  <button className="btn btn-small btn-quiet" title={s.sql} onClick={() => putInEditor(s.sql)}>{s.label}</button>
                </li>
              ))}
            </ul>
          </div>
          <details className="pg-schema" open={schemaOpen}>
            <summary><span className="step-label">스키마</span> <span className="small muted">표 {tables.length}개</span></summary>
            {schemaError && <p className="small notice notice-warn">{schemaError}</p>}
            <ul className="pg-schema-list" aria-label="스키마">
              {tables.map((t) => {
                const fkOf = new Map(t.fks.map((f) => [f.from.toLowerCase(), f]));
                return (
                  <li key={t.name}>
                    <div className="pg-schema-head">
                      <button className="btn btn-small btn-quiet mono" title={`SELECT * FROM ${t.name}`} onClick={() => putInEditor(`SELECT * FROM ${/^[\p{L}_][\p{L}\p{N}_]*$/u.test(t.name) ? t.name : quoteIdent(t.name)};`)}>{t.name}</button>
                      <span className="small muted">{t.rowCount}행</span>
                    </div>
                    <ul className="pg-cols">
                      {t.columns.map((c) => {
                        const fk = fkOf.get(c.name.toLowerCase());
                        return (
                          <li key={c.name}>
                            <code>{c.name}</code> <span className="muted">{c.type || '-'}</span>
                            {c.pk && <span className="pg-tag pg-tag-pk">PK</span>}
                            {fk && <span className="pg-tag pg-tag-fk">FK → {fk.table}.{fk.to}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </details>
          <p className="small muted" style={{ margin: 0 }}>실행 기록 {log.length}개 · 바뀐 실행 {changes}개</p>
        </aside>
        <section className="stack pg-main" aria-label="SQL 실행">
          <label htmlFor="pg-editor" className="step-label">SQL</label>
          <textarea id="pg-editor" ref={editorRef} className="editor" spellCheck={false} value={sql} onChange={(e) => setSql(e.target.value)} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); } }} />
          <div className="row">
            <button className="btn btn-primary" disabled={busy || !gate.active} onClick={run}>{busy ? '실행 중…' : '실행 (Ctrl+Enter)'}</button>
            <button className="btn" onClick={reset}>데이터 초기화</button>
          </div>
          <div aria-live="polite" className="stack pg-output">
            {view.info && <p className="notice" style={{ margin: 0 }}>{view.info}</p>}
            {view.error && <SqlErrorView error={view.error} />}
            {view.result && <ResultTable result={view.result} rowsModified={view.rows} />}
          </div>
        </section>
      </div>

      <section className="panel stack pg-tools" aria-label="ERD와 표 만들기">
        <div className="pg-tabs" role="tablist" aria-label="도구">
          <button role="tab" id="pg-tab-erd" aria-controls="pg-panel-erd" aria-selected={tab === 'erd'} tabIndex={tab === 'erd' ? 0 : -1} className={tab === 'erd' ? 'on' : ''} onClick={() => setTab('erd')}
            onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { setTab('builder'); document.getElementById('pg-tab-builder')?.focus(); } }}>ERD 보기</button>
          <button role="tab" id="pg-tab-builder" aria-controls="pg-panel-builder" aria-selected={tab === 'builder'} tabIndex={tab === 'builder' ? 0 : -1} className={tab === 'builder' ? 'on' : ''} onClick={() => setTab('builder')}
            onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { setTab('erd'); document.getElementById('pg-tab-erd')?.focus(); } }}>직접 표 만들기</button>
        </div>
        <div role="tabpanel" id="pg-panel-erd" aria-labelledby="pg-tab-erd" hidden={tab !== 'erd'}>
          <p className="small muted" style={{ marginTop: 0 }}>지금 실습 DB의 구조예요. 표를 만들거나 지우면 바로 다시 그려져요.</p>
          {schema ? <ErdDiagram schema={schema} caption={`${info.title} ERD`} /> : <p className="small muted" role="status">ERD를 그리는 중…</p>}
        </div>
        <div role="tabpanel" id="pg-panel-builder" aria-labelledby="pg-tab-builder" hidden={tab !== 'builder'}>
          <TableBuilder
            schema={schema}
            busy={busy || !gate.active}
            onToEditor={putInEditor}
            onCreate={async (text, name, rowCount) => {
              const r = await execute(text);
              if (r.ok) setView({ info: `'${name}' 표를 만들었어요${rowCount ? `. 행 ${rowCount}개를 넣었어요` : ''}. 스키마와 ERD에서 확인해 보세요.` });
              return r.ok;
            }}
          />
        </div>
      </section>
    </div>
  );
}
