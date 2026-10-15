import { useId, useMemo, useState } from 'react';
import type { DbSchema } from '../../sql/schema';
import { buildTableSql, COLUMN_TYPES, emptyDraft, MAX_COLUMNS, MAX_ROWS, newKey, type BuilderColumn, type BuilderDraft, type ColumnType, type FkRef } from './tableBuilder';

/** '직접 표 만들기': 표 이름·열·행을 양식으로 정하면 CREATE TABLE + INSERT SQL을 만들어 실습 DB에서 실행한다. */
export function TableBuilder({ schema, busy, onCreate, onToEditor }: {
  schema: DbSchema | null;
  busy: boolean;
  /** 만든 SQL 실행. 성공하면 true */
  onCreate: (sql: string, tableName: string, rowCount: number) => Promise<boolean>;
  onToEditor: (sql: string) => void;
}) {
  const uid = useId();
  const [draft, setDraft] = useState<BuilderDraft>(emptyDraft);
  const [showErrors, setShowErrors] = useState(false);

  const targets = useMemo<(FkRef & { type: string })[]>(
    () => (schema?.tables ?? []).flatMap((t) => t.columns.filter((c) => c.unique).map((c) => ({ table: t.name, column: c.name, type: c.type.toUpperCase() }))),
    [schema],
  );
  const ctx = useMemo(() => ({ existingTables: schema?.tables.map((t) => t.name) ?? [], fkTargets: targets }), [schema, targets]);
  const result = useMemo(() => buildTableSql(draft, ctx), [draft, ctx]);

  const edit = (fn: (d: BuilderDraft) => BuilderDraft) => setDraft((d) => fn(d));
  const setCol = (key: string, patch: Partial<BuilderColumn>) => edit((d) => ({ ...d, columns: d.columns.map((c) => (c.key === key ? { ...c, ...patch } : c)) }));
  const setCell = (rowKey: string, colKey: string, v: string) =>
    edit((d) => ({ ...d, rows: d.rows.map((r) => (r.key === rowKey ? { ...r, cells: { ...r.cells, [colKey]: v } } : r)) }));

  const create = async () => {
    setShowErrors(true);
    if (result.errors.length || busy) return;
    if (await onCreate(result.sql, draft.tableName.trim(), result.rowCount)) {
      setDraft(emptyDraft());
      setShowErrors(false);
    }
  };

  const colLabel = (c: BuilderColumn, i: number) => c.name.trim() || `${i + 1}번 열`;

  return (
    <div className="stack pg-builder">
      <p className="small muted" style={{ margin: 0 }}>
        표 이름과 열(이름·자료형·기본키·외래키)을 정하고 행을 넣으면 SQL을 만들어 줘요. 이름에는 글자(한글 포함)·숫자·밑줄(_)만 쓸 수 있어요.
      </p>
      <label className="stack pg-field">
        <span className="step-label">표 이름</span>
        <input type="text" value={draft.tableName} placeholder="예: 상담_기록" maxLength={40} onChange={(e) => edit((d) => ({ ...d, tableName: e.target.value }))} />
      </label>

      <fieldset className="stack pg-fieldset">
        <legend>열 <span className="small muted">(PK = 기본키, FK = 다른 표의 열을 가리키는 외래키)</span></legend>
        {draft.columns.map((c, i) => {
          const fkIndex = c.fk ? targets.findIndex((t) => t.table === c.fk!.table && t.column === c.fk!.column) : -1;
          return (
            <div className="pg-colrow" key={c.key}>
              <span className="pg-colno" aria-hidden="true">{i + 1}</span>
              <input type="text" className="pg-colname" aria-label={`${i + 1}번 열 이름`} value={c.name} placeholder="열 이름" maxLength={40} onChange={(e) => setCol(c.key, { name: e.target.value })} />
              <select aria-label={`${i + 1}번 열 자료형`} value={c.type} onChange={(e) => setCol(c.key, { type: e.target.value as ColumnType })}>
                {COLUMN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <label className="pg-check">
                <input type="checkbox" checked={c.pk} onChange={(e) => setCol(c.key, { pk: e.target.checked })} aria-label={`${i + 1}번 열 기본키(PK)`} />
                PK
              </label>
              <select
                className="pg-fk"
                aria-label={`${i + 1}번 열 외래키(FK)로 가리킬 열`}
                value={c.fk ? (fkIndex >= 0 ? String(fkIndex) : 'missing') : ''}
                onChange={(e) => {
                  const t = e.target.value === '' ? null : targets[Number(e.target.value)];
                  if (!t) return setCol(c.key, { fk: null });
                  const type = (COLUMN_TYPES as readonly string[]).includes(t.type) ? (t.type as ColumnType) : c.type;
                  setCol(c.key, { fk: { table: t.table, column: t.column }, type });
                }}
              >
                <option value="">FK 없음</option>
                {c.fk && fkIndex < 0 && <option value="missing" disabled>(없어진 열) {c.fk.table}.{c.fk.column}</option>}
                {targets.map((t, ti) => <option key={`${t.table}.${t.column}`} value={String(ti)}>FK → {t.table}.{t.column}</option>)}
              </select>
              <button type="button" className="btn btn-small btn-quiet" aria-label={`${i + 1}번 열 삭제`} disabled={draft.columns.length <= 1}
                onClick={() => edit((d) => ({ ...d, columns: d.columns.filter((x) => x.key !== c.key) }))}>삭제</button>
            </div>
          );
        })}
        <div className="row">
          <button type="button" className="btn btn-small" disabled={draft.columns.length >= MAX_COLUMNS}
            onClick={() => edit((d) => ({ ...d, columns: [...d.columns, { key: newKey('c'), name: '', type: 'TEXT', pk: false, fk: null }] }))}>열 추가</button>
        </div>
      </fieldset>

      <fieldset className="stack pg-fieldset">
        <legend>행(데이터) <span className="small muted">빈 칸은 NULL, 완전히 빈 행은 넣지 않아요</span></legend>
        <div className="table-wrap">
          <table className="data pg-rows">
            <thead>
              <tr>
                <th scope="col">행</th>
                {draft.columns.map((c, i) => (
                  <th scope="col" key={c.key}>{colLabel(c, i)} <span className="pg-coltype">{c.type}{c.pk ? ' PK' : ''}</span></th>
                ))}
                <th scope="col"><span className="sr-only">행 삭제</span></th>
              </tr>
            </thead>
            <tbody>
              {draft.rows.map((r, ri) => (
                <tr key={r.key}>
                  <th scope="row">{ri + 1}</th>
                  {draft.columns.map((c, ci) => (
                    <td key={c.key}>
                      <input type="text" inputMode={c.type === 'TEXT' ? 'text' : c.type === 'INTEGER' ? 'numeric' : 'decimal'} aria-label={`${ri + 1}행 ${colLabel(c, ci)}`}
                        value={r.cells[c.key] ?? ''} onChange={(e) => setCell(r.key, c.key, e.target.value)} />
                    </td>
                  ))}
                  <td>
                    <button type="button" className="btn btn-small btn-quiet" aria-label={`${ri + 1}행 삭제`} disabled={draft.rows.length <= 1}
                      onClick={() => edit((d) => ({ ...d, rows: d.rows.filter((x) => x.key !== r.key) }))}>삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row">
          <button type="button" className="btn btn-small" disabled={draft.rows.length >= MAX_ROWS}
            onClick={() => edit((d) => ({ ...d, rows: [...d.rows, { key: newKey('r'), cells: {} }] }))}>행 추가</button>
        </div>
      </fieldset>

      <div className="stack" style={{ gap: '0.3rem' }}>
        <span className="step-label" id={`${uid}-pv`}>만들어질 SQL 미리보기</span>
        <pre className="codeblock pg-preview" aria-labelledby={`${uid}-pv`}>{result.sql}</pre>
        <p className="small muted" style={{ margin: 0 }}>큰따옴표(" ")는 표·열 이름을 감싸는 표시예요. 작은따옴표(' ')는 글자 값이에요.</p>
      </div>
      {showErrors && result.errors.length > 0 && (
        <div className="notice notice-warn" role="alert">
          <b>고칠 곳이 있어요</b>
          <ul className="pg-errors">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void create()}>이 표 만들기</button>
        <button type="button" className="btn btn-small btn-quiet" onClick={() => onToEditor(result.sql)}>SQL을 편집기로 보내기</button>
        <button type="button" className="btn btn-small btn-quiet" onClick={() => { setDraft(emptyDraft()); setShowErrors(false); }}>양식 비우기</button>
      </div>
    </div>
  );
}
