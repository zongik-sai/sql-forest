import { useEffect, useMemo, useState } from 'react';
import type { ClassifyConfig, ErdConfig, NormalizeConfig, PredictResultConfig, RowFilterConfig } from '../../../content/types';
import { fillTemplate, defaultSlotValues } from '../../../content/template';
import { ChoiceGroup, ResultTable, RunnableSql, SegmentedChoice, SqlErrorView } from '../../../components/common';
import type { SqlError } from '../../../sql/engine';
import type { ResultSet } from '../../../sql/grader/compare';
import { outcomeMessage, sqlClient } from '../../../sql/worker/sqlClient';
import { useFocusGate } from '../../focus/FocusContext';
import { cellKey, useQuery } from '../useQuery';
import { useSqlGrader } from './SqlTask';
import type { TaskProps } from './types';

/* ---------------- 결과 예측 + 실제 실행 ---------------- */
export function PredictResultTask(props: TaskProps<PredictResultConfig>) {
  const { config: c, progress } = props;
  const [ran, setRan] = useState<boolean>(!!progress.state.ran);
  const [answer, setAnswer] = useState<number | null>((progress.state.check as number | undefined) ?? null);
  const [submitted, setSubmitted] = useState(false);
  const gate = useFocusGate();
  return (
    <div className="stack">
      <RunnableSql label="이 SQL" sql={c.sql} dataset={props.activity.datasetId} onRan={() => { setRan(true); props.saveState({ ran: true, check: answer }); }} />
      {c.compareSql?.map((x) => (
        <RunnableSql key={x.label} label={x.label} sql={x.sql} dataset={props.activity.datasetId} />
      ))}
      {ran ? (
        <div className="panel stack">
          <ChoiceGroup legend={c.check.prompt} options={c.check.options} value={answer} onChange={(i) => { setAnswer(i); setSubmitted(false); props.saveState({ ran: true, check: i }); }} />
          <div className="row">
            <button className="btn btn-primary" disabled={answer === null || !gate.active} onClick={() => {
              if (!gate.canAct() || answer === null) return;
              setSubmitted(true);
              const ok = answer === c.check.correctIndex;
              props.report({ correct: ok, meaningful: true, message: ok ? c.check.reveal : '실행 결과 표를 다시 보고 어떤 행이 있는지 확인해 볼까요?' });
            }}>답 제출</button>
          </div>
          {submitted && answer === c.check.correctIndex && <p className="notice notice-good">{c.check.reveal}</p>}
        </div>
      ) : (
        <p className="muted small">먼저 위 SQL을 실행해 실제 결과를 확인하세요.</p>
      )}
    </div>
  );
}

/* ---------------- 조건 조작(템플릿 슬롯) ---------------- */
export function RowFilterTask(props: TaskProps<RowFilterConfig>) {
  const { config: c, progress } = props;
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...defaultSlotValues(c.slots), ...((progress.state.slots as Record<string, string>) ?? {}) }));
  const sql = fillTemplate(c.template, values);
  const base = useQuery(props.activity.datasetId, c.baseSql);
  const [live, setLive] = useState<{ result?: ResultSet; error?: SqlError; info?: string }>({});
  const gate = useFocusGate();
  const g = useSqlGrader(props, { solutionSql: c.solutionSql, ordered: c.ordered, allow: ['select'] });
  const isDialect = props.activity.mode === 'dialect-comparison';

  // 조작할 때마다 실제 엔진으로 미리보기 실행
  useEffect(() => {
    if (!gate.active) return;
    let alive = true;
    const t = setTimeout(async () => {
      const o = await sqlClient().run(props.activity.datasetId, sql, ['select']);
      if (!alive || o.status === 'stale') return;
      if (o.status !== 'ok') return setLive({ info: outcomeMessage(o) ?? '' });
      setLive(o.data.ok ? { result: o.data.last } : { error: o.data.error });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [sql, gate.active, props.activity.datasetId]);

  const sameShape = base.data && live.result && base.data.columns.join() === live.result.columns.join();
  const hitKeys = useMemo(() => new Set(sameShape ? live.result!.rows.map((r) => r.map(cellKey).join('|')) : []), [sameShape, live.result]);

  return (
    <div className="stack">
      <div className="panel stack">
        {c.slots.map((s) => (
          <div key={s.id}>
            <p className="step-label" id={`slot-${s.id}`}>{s.label}</p>
            <SegmentedChoice
              name={`${props.activity.id}-${s.id}`}
              label={s.label}
              options={s.options.map((o) => ({ id: o.value, label: o.label }))}
              value={values[s.id]}
              onChange={(v) => {
                const next = { ...values, [s.id]: v };
                setValues(next);
                props.saveState({ slots: next });
              }}
            />
          </div>
        ))}
      </div>
      {isDialect ? (
        <details>
          <summary>실제로 실행되는 SQLite 대안 SQL 보기</summary>
          <pre className="codeblock">{sql}</pre>
        </details>
      ) : (
        <pre className="codeblock" aria-label="만들어진 SQL">{sql}</pre>
      )}
      <div className="join-cols">
        {base.data && <ResultTable result={base.data} caption="원본 데이터 (선택된 행은 초록색)" highlight={(r) => hitKeys.has(r.map(cellKey).join('|'))} />}
        <div aria-live="polite">
          {live.error && <SqlErrorView error={live.error} />}
          {live.info && <p className="notice notice-warn">{live.info}</p>}
          {live.result && <ResultTable result={live.result} caption="지금 조건의 실행 결과" />}
        </div>
      </div>
      <div className="row">
        <button className="btn btn-primary" disabled={g.busy || !g.active} onClick={() => void g.grade(sql)}>이 조건으로 제출</button>
      </div>
    </div>
  );
}

/* ---------------- 분류·순서 ---------------- */
export function ClassifyTask(props: TaskProps<ClassifyConfig>) {
  const { config: c, progress } = props;
  const [map, setMap] = useState<Record<string, string>>((progress.state.map as Record<string, string>) ?? {});
  const sqlAnswer = useQuery(props.activity.datasetId, c.answer.source === 'sql' ? c.answer.sql : null);
  const [checked, setChecked] = useState(false);
  const gate = useFocusGate();
  const answer = useMemo<Record<string, string> | null>(() => {
    if (c.answer.source === 'static') return c.answer.map;
    if (!sqlAnswer.data) return null;
    return Object.fromEntries(sqlAnswer.data.rows.map((r) => [String(r[0]), String(r[1])]));
  }, [c.answer, sqlAnswer.data]);

  const set = (item: string, opt: string) => {
    const next = { ...map, [item]: opt };
    setMap(next);
    setChecked(false);
    props.saveState({ map: next });
  };
  const complete = c.items.every((i) => map[i.id]);
  const submit = () => {
    if (!gate.canAct() || !answer) return;
    setChecked(true);
    const wrong = c.items.filter((i) => map[i.id] !== answer[i.id]);
    if (c.layout === 'order') {
      const used = Object.values(map);
      if (new Set(used).size !== used.length) {
        props.report({ correct: false, meaningful: true, message: '같은 순서 번호를 두 번 썼어요. 번호는 한 번씩만 써요.' });
        return;
      }
    }
    props.report({
      correct: wrong.length === 0,
      meaningful: true,
      message: wrong.length === 0 ? '모두 맞게 배치했어요.' : `${c.items.length}개 중 ${wrong.length}개가 달라요. 처음 다른 항목: '${wrong[0].label}'. 이 항목의 뜻을 설명에서 다시 확인해 볼까요?`,
    });
  };
  return (
    <div className="stack">
      <div className="panel">
        {c.items.map((it) => (
          <div className="assign-row" key={it.id}>
            <div className={c.items.length > 8 ? 'mono small' : 'mono'} id={`it-${props.activity.id}-${it.id}`}>
              {it.label}
              {checked && answer && map[it.id] && (map[it.id] === answer[it.id] ? <span className="status-done"> ✓</span> : <span style={{ color: 'var(--bad)' }}> 다시 보기</span>)}
            </div>
            <SegmentedChoice name={`${props.activity.id}-${it.id}`} label={it.label} options={c.options} value={map[it.id]} onChange={(v) => set(it.id, v)} />
          </div>
        ))}
      </div>
      <div className="row">
        <button className="btn btn-primary" disabled={!complete || !answer || !gate.active} onClick={submit}>배치 제출</button>
        {!complete && <span className="small muted">모든 항목을 고르면 제출할 수 있어요.</span>}
      </div>
      {c.patterns && checked && (
        <div className="panel stack">
          <p className="step-label">브라우저 정규식 엔진으로 패턴 적용 결과(시뮬레이션)</p>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th scope="col">문자열</th>{c.patterns.map((p) => <th scope="col" key={p.optionId}>{c.options.find((o) => o.id === p.optionId)?.label}</th>)}</tr></thead>
              <tbody>
                {c.items.map((it) => (
                  <tr key={it.id}><td>{it.label}</td>{c.patterns!.map((p) => <td key={p.optionId}>{new RegExp(p.regex).test(it.label) ? '맞음' : '-'}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {c.demoSql && <details><summary>실제 SQL로 확인하기</summary><div style={{ marginTop: '0.5rem' }}><RunnableSql label="확인 SQL" sql={c.demoSql} dataset={props.activity.datasetId} /></div></details>}
    </div>
  );
}

/* ---------------- ERD ---------------- */
export function ErdTask(props: TaskProps<ErdConfig>) {
  const { config: c, progress } = props;
  const [map, setMap] = useState<Record<string, string>>((progress.state.map as Record<string, string>) ?? {});
  const gate = useFocusGate();
  const pos: Record<string, { x: number; y: number }> = { dept: { x: 10, y: 10 }, student: { x: 10, y: 150 }, enroll: { x: 330, y: 150 }, course: { x: 330, y: 10 } };
  const center = (id: string) => ({ x: (pos[id]?.x ?? 0) + 140, y: (pos[id]?.y ?? 0) + 50 });
  const lineLabel = (rId: string) => c.relations.find((r) => r.id === rId)?.options.find((o) => o.id === map[rId])?.label ?? '?';
  const drawn = c.relations.filter((r, i, arr) => arr.findIndex((x) => x.from === r.from && x.to === r.to) === i);
  return (
    <div className="stack">
      <svg viewBox="0 0 620 270" className="erd-svg" role="img" aria-label="학과·학생·수강·강좌 ERD">
        {drawn.map((r) => {
          const a = center(r.from), b = center(r.to);
          const labels = c.relations.filter((x) => x.from === r.from && x.to === r.to).map((x) => lineLabel(x.id)).join(' / ');
          return (
            <g key={r.id}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--soil)" strokeWidth="2" strokeDasharray={r.id === 'r2' ? '6 4' : undefined} />
              <text x={(a.x + b.x) / 2 + 6} y={(a.y + b.y) / 2 - 6} fontSize="12" fill="var(--ink)">{labels}</text>
            </g>
          );
        })}
        {c.entities.map((e) => (
          <g key={e.id} transform={`translate(${pos[e.id]?.x ?? 0} ${pos[e.id]?.y ?? 0})`}>
            <rect width="280" height={28 + e.attributes.length * 16} rx="6" fill="var(--surface)" stroke="var(--teal)" />
            <text x="10" y="19" fontSize="13" fontWeight="700" fill="var(--ink)">{e.name}</text>
            {e.attributes.map((a, i) => <text key={a} x="10" y={38 + i * 16} fontSize="11.5" fill="var(--ink-soft)" fontFamily="monospace">{a}</text>)}
          </g>
        ))}
      </svg>
      <div className="panel stack">
        {c.relations.map((r) => (
          <fieldset key={r.id}>
            <legend>{r.question}</legend>
            <SegmentedChoice name={`${props.activity.id}-${r.id}`} label={r.question} options={r.options} value={map[r.id]} onChange={(v) => { const n = { ...map, [r.id]: v }; setMap(n); props.saveState({ map: n }); }} />
          </fieldset>
        ))}
      </div>
      <div className="row">
        <button className="btn btn-primary" disabled={c.relations.some((r) => !map[r.id]) || !gate.active} onClick={() => {
          if (!gate.canAct()) return;
          const wrong = c.relations.filter((r) => map[r.id] !== c.answer[r.id]);
          props.report({ correct: !wrong.length, meaningful: true, message: wrong.length ? `${wrong.length}개 관계가 달라요. 처음 다른 질문: ${wrong[0].question}` : 'ERD 관계를 모두 맞게 정했어요.' });
        }}>ERD 제출</button>
      </div>
      <RunnableSql label="실제 데이터로 선택성 확인(수강 없는 학생)" sql={'SELECT s.student_id, s.student_name\nFROM students s\nWHERE NOT EXISTS (SELECT 1 FROM enrollment e WHERE e.student_id = s.student_id);'} dataset="school" />
    </div>
  );
}

/* ---------------- 정규화 ---------------- */
export function NormalizeTask(props: TaskProps<NormalizeConfig>) {
  const { config: c, progress } = props;
  const [map, setMap] = useState<Record<string, string>>((progress.state.map as Record<string, string>) ?? {});
  const src = useQuery(props.activity.datasetId, c.sourceSql);
  const [done, setDone] = useState(false);
  const gate = useFocusGate();
  return (
    <div className="stack">
      {src.data && <ResultTable result={src.data} caption="비정규 수강표 enrollment_raw (같은 값이 반복돼요)" />}
      <div className="panel">
        {c.columns.map((col) => (
          <div className="assign-row" key={col.id}>
            <div className="mono">{col.label}</div>
            <SegmentedChoice name={`${props.activity.id}-${col.id}`} label={col.label} options={c.tables} value={map[col.id]} onChange={(v) => { const n = { ...map, [col.id]: v }; setMap(n); setDone(false); props.saveState({ map: n }); }} />
          </div>
        ))}
      </div>
      <div className="row">
        <button className="btn btn-primary" disabled={c.columns.some((x) => !map[x.id]) || !gate.active} onClick={() => {
          if (!gate.canAct()) return;
          const wrong = c.columns.filter((x) => map[x.id] !== c.answer[x.id]);
          setDone(!wrong.length);
          props.report({ correct: !wrong.length, meaningful: true, message: wrong.length ? `'${wrong[0].label}' 열의 위치를 다시 생각해 보세요. 이 열은 무엇이 정해지면 하나로 정해지나요?` : '정규화 완료! 각 정보가 한 번만 저장돼요.' });
        }}>표 나누기 제출</button>
      </div>
      {done && (
        <div className="stack">
          <p className="small muted">나눈 표를 다시 조인하면 원래 정보를 그대로 복원할 수 있어요(무손실 분해).</p>
          <RunnableSql label="분해한 표 다시 조인" sql={c.rejoinSql} dataset={props.activity.datasetId} />
        </div>
      )}
    </div>
  );
}

