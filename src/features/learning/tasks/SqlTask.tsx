import { useEffect, useMemo, useRef, useState } from 'react';
import type { SqlBlocksConfig, SqlEditorConfig, StatementType } from '../../../content/types';
import { ResultTable, RunnableSql, SqlErrorView } from '../../../components/common';
import type { SqlError } from '../../../sql/engine';
import { describeDiff, type ResultSet } from '../../../sql/grader/compare';
import { outcomeMessage, sqlClient } from '../../../sql/worker/sqlClient';
import { useFocusGate } from '../../focus/FocusContext';
import type { TaskProps } from './types';

/** 결정적 섞기(같은 활동이면 같은 순서) */
function shuffle<T>(arr: T[], seed: string): T[] {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) >>> 0;
    const j = h % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface SqlGradeView {
  error?: SqlError;
  result?: ResultSet;
  rowsModified?: number;
  info?: string;
}

/** 학생 SQL을 채점하고 결과 화면 정보를 돌려주는 공통 로직 */
export function useSqlGrader(props: TaskProps, opts: { solutionSql: string; ordered: boolean; allow: StatementType[]; stateCheckSql?: string; checkColumnNames?: boolean }) {
  const gate = useFocusGate();
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<SqlGradeView>({});
  const lastRunFocus = useRef(gate.interruptedRun);

  useEffect(() => {
    if (gate.interruptedRun !== lastRunFocus.current) {
      lastRunFocus.current = gate.interruptedRun;
      setBusy(false);
      setView({ info: '실행이 중단되었습니다. 다시 실행해주세요.' });
    }
  }, [gate.interruptedRun]);

  const grade = async (studentSql: string) => {
    if (!gate.canAct() || busy) return;
    setBusy(true);
    const o = await sqlClient().grade({ dataset: props.activity.datasetId, studentSql, ...opts });
    setBusy(false);
    if (o.status === 'stale') return; // 일시정지·활동 변경 뒤 도착한 결과는 무시
    if (o.status !== 'ok') {
      setView({ info: outcomeMessage(o) ?? '' });
      return;
    }
    const g = o.data;
    if (g.status === 'error') {
      setView({ error: g.error });
      props.report({ correct: false, message: 'SQL을 실행하지 못했어요. 오류 위치와 설명을 확인해 보세요.', meaningful: true });
      return;
    }
    setView({ result: g.display, rowsModified: g.rowsModified });
    if (g.status === 'no-result') {
      props.report({ correct: false, message: '결과 표가 나오지 않았어요. 조회 결과가 나오는 SQL인지 확인해 보세요.', meaningful: true });
      return;
    }
    const isDml = opts.allow.some((a) => a !== 'select');
    if (g.pass) {
      const rows = g.display?.rows.length ?? 0;
      props.report({
        correct: true,
        meaningful: true,
        message: isDml ? `정답이에요. 실행 후 표 상태가 목표와 같아요(영향받은 행 ${g.rowsModified}개).` : `정답이에요. 결과 ${rows}행이 조건을 모두 만족했어요. 다른 데이터로도 확인했어요.`,
        followUp: isDml
          ? { question: '방금 실행에서 영향받은 행은 몇 개였나요?', answer: g.rowsModified }
          : { question: '방금 실행한 결과는 몇 행이었나요?', answer: rows },
      });
    } else if (g.failedOnAltSeed) {
      props.report({ correct: false, meaningful: true, message: '보이는 데이터에서는 맞지만, 데이터가 바뀌면 결과가 달라져요. 특정 값(번호·점수)을 직접 쓰지 말고 조건으로 표현해 보세요.' });
    } else {
      props.report({ correct: false, meaningful: true, message: describeDiff(g.compare.diff!) });
    }
  };
  return { grade, busy, view, active: gate.active };
}

function ResultArea({ view }: { view: SqlGradeView }) {
  return (
    <div aria-live="polite" className="stack">
      {view.info && <p className="notice notice-warn">{view.info}</p>}
      {view.error && <SqlErrorView error={view.error} />}
      {view.result && <ResultTable result={view.result} caption="내 SQL 실행 결과" rowsModified={view.rowsModified} />}
    </div>
  );
}

export function SqlEditorTask(props: TaskProps<SqlEditorConfig>) {
  const { config: c, progress } = props;
  const [sql, setSql] = useState(progress.draftSql || c.starterSql);
  const ta = useRef<HTMLTextAreaElement>(null);
  const escaped = useRef(false);
  const allow = c.allow ?? ['select'];
  const g = useSqlGrader(props, { solutionSql: c.solutionSql, ordered: c.ordered, allow, stateCheckSql: c.stateCheckSql, checkColumnNames: c.checkColumnNames });

  const change = (v: string) => {
    setSql(v);
    props.saveDraft(v);
  };
  const insert = (text: string) => {
    const el = ta.current;
    if (!el) return change(sql + ' ' + text);
    const { selectionStart: a, selectionEnd: b } = el;
    const next = sql.slice(0, a) + text + sql.slice(b);
    change(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = a + text.length;
    });
  };

  return (
    <div className="stack">
      {c.explore && c.explore.length > 0 && (
        <details>
          <summary>탐색용 SQL 실행해 보기 ({c.explore.length})</summary>
          <div className="stack" style={{ marginTop: '0.5rem' }}>
            {c.explore.map((e) => <RunnableSql key={e.label} label={e.label} sql={e.sql} dataset={props.activity.datasetId} />)}
          </div>
        </details>
      )}
      <label htmlFor={`ed-${props.activity.id}`} className="step-label">
        SQL 편집기 {allow.some((a) => a !== 'select') ? '(연습용 샌드박스: 실행할 때마다 처음 데이터에서 시작)' : '(조회 전용)'}
      </label>
      {c.blocks && c.blocks.length > 0 && (
        <div className="chips" aria-label="자주 쓰는 조각 넣기">
          {c.blocks.map((b) => (
            <button key={b} type="button" className="chip" onClick={() => insert(b + ' ')}>{b}</button>
          ))}
        </div>
      )}
      <textarea
        id={`ed-${props.activity.id}`}
        ref={ta}
        className="editor"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        value={sql}
        rows={Math.max(6, sql.split('\n').length + 1)}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            escaped.current = true;
            return;
          }
          if (e.key === 'Tab' && escaped.current) {
            escaped.current = false;
            return; // Esc 다음 Tab은 기본 포커스 이동
          }
          escaped.current = false;
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            void g.grade(sql);
          } else if (e.key === 'Tab' && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            insert('  ');
          }
        }}
        aria-describedby={`ed-help-${props.activity.id}`}
      />
      <p id={`ed-help-${props.activity.id}`} className="small muted" style={{ margin: 0 }}>
        Ctrl+Enter로 실행·채점. Tab은 들여쓰기(편집기 밖으로 나가려면 Esc 후 Tab).
      </p>
      <div className="row">
        <button className="btn btn-primary" onClick={() => void g.grade(sql)} disabled={g.busy || !g.active}>
          {g.busy ? '실행 중…' : '실행하고 채점'}
        </button>
        <button className="btn" onClick={() => change(c.starterSql)}>처음 SQL로</button>
      </div>
      <ResultArea view={g.view} />
    </div>
  );
}

export function SqlBlocksTask(props: TaskProps<SqlBlocksConfig>) {
  const { config: c, progress } = props;
  const palette = useMemo(() => shuffle(c.blocks.map((b, i) => ({ id: i, text: b })), props.activity.id), [c.blocks, props.activity.id]);
  const saved = (progress.state.assembly as number[] | undefined) ?? [];
  const [assembly, setAssembly] = useState<number[]>(saved);
  const [freeMode, setFreeMode] = useState<boolean>(!!progress.state.freeMode);
  const [free, setFree] = useState<string>(progress.draftSql || '');
  const g = useSqlGrader(props, { solutionSql: c.solutionSql, ordered: c.ordered, allow: ['select'] });
  const assembled = assembly.map((i) => c.blocks[i]).join(' ').replace(/ ,/g, ',');

  const set = (a: number[]) => {
    setAssembly(a);
    props.saveState({ assembly: a, freeMode });
  };

  if (freeMode) {
    return (
      <div className="stack">
        <label htmlFor={`free-${props.activity.id}`} className="step-label">직접 입력</label>
        <textarea id={`free-${props.activity.id}`} className="editor" value={free} spellCheck={false} onChange={(e) => { setFree(e.target.value); props.saveDraft(e.target.value); }} />
        <div className="row">
          <button className="btn btn-primary" onClick={() => void g.grade(free)} disabled={g.busy || !g.active}>실행하고 채점</button>
          <button className="btn" onClick={() => { setFreeMode(false); props.saveState({ assembly, freeMode: false }); }}>블록으로 돌아가기</button>
        </div>
        <ResultArea view={g.view} />
      </div>
    );
  }

  return (
    <div className="stack">
      <div>
        <p className="step-label">블록 (누르면 아래에 차례로 붙어요)</p>
        <div className="chips">
          {palette.map((b) => {
            const used = assembly.includes(b.id);
            return (
              <button key={b.id} type="button" className={`chip${used ? ' used' : ''}`} disabled={used} onClick={() => set([...assembly, b.id])} aria-label={`블록 ${b.text} 추가`}>
                {b.text}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className="step-label">조립한 SQL</p>
        <div className="assembly" aria-live="polite" aria-label="조립한 SQL">
          {assembly.length === 0 ? <span className="muted small">블록을 눌러 SQL을 만들어 보세요.</span> : assembly.map((i, k) => (
            <button key={k} type="button" className="chip" onClick={() => set(assembly.filter((_, j) => j !== k))} aria-label={`${c.blocks[i]} 빼기`}>{c.blocks[i]}</button>
          ))}
        </div>
      </div>
      <div className="row">
        <button className="btn btn-primary" disabled={!assembly.length || g.busy || !g.active} onClick={() => void g.grade(assembled)}>실행하고 채점</button>
        <button className="btn" disabled={!assembly.length} onClick={() => set(assembly.slice(0, -1))}>마지막 블록 빼기</button>
        <button className="btn" disabled={!assembly.length} onClick={() => set([])}>비우기</button>
        <button className="btn btn-quiet" onClick={() => { setFree(assembled); setFreeMode(true); props.saveState({ assembly, freeMode: true }); }}>직접 입력으로 전환</button>
      </div>
      {assembly.length > 0 && <pre className="codeblock">{assembled}</pre>}
      <ResultArea view={g.view} />
    </div>
  );
}
