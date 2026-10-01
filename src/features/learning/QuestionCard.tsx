import { useState } from 'react';
import type { Question } from '../../content/types';
import { ChoiceGroup, ResultTable, SqlErrorView } from '../../components/common';
import type { SqlError } from '../../sql/engine';
import { describeDiff, type ResultSet } from '../../sql/grader/compare';
import { outcomeMessage, sqlClient } from '../../sql/worker/sqlClient';
import { useFocusGate } from '../focus/FocusContext';

export interface Graded {
  correct: boolean;
  answer: string | number;
  message: string;
}

/** 문항 하나를 풀고 채점한다. SQL 문항은 Worker에서 결과 기반으로 채점한다. */
export function QuestionCard({ q, onGraded, locked, title, draft, onDraft }: {
  q: Question;
  onGraded: (g: Graded) => void;
  /** 이미 제출해 바꿀 수 없음(최종 진단) */
  locked?: boolean;
  title?: string;
  draft?: string;
  onDraft?: (v: string) => void;
}) {
  const gate = useFocusGate();
  const [choice, setChoice] = useState<number | null>(null);
  const [num, setNum] = useState('');
  const [sql, setSql] = useState(draft ?? (q.body.type === 'sql' ? q.body.starterSql : ''));
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ result?: ResultSet; error?: SqlError; info?: string }>({});

  const submit = async () => {
    if (!gate.canAct() || locked) return;
    const b = q.body;
    if (b.type === 'choice') {
      if (choice === null) return;
      onGraded({ correct: choice === b.correctIndex, answer: choice, message: '' });
    } else if (b.type === 'number') {
      if (num.trim() === '') return;
      onGraded({ correct: Number(num) === b.answer, answer: Number(num), message: '' });
    } else {
      setBusy(true);
      const o = await sqlClient().grade({ dataset: b.datasetId, studentSql: sql, solutionSql: b.solutionSql, ordered: b.ordered, allow: b.allow ?? ['select'], stateCheckSql: b.stateCheckSql });
      setBusy(false);
      if (o.status === 'stale') return;
      if (o.status !== 'ok') return setRes({ info: outcomeMessage(o) ?? '' });
      const g = o.data;
      if (g.status === 'error') {
        setRes({ error: g.error });
        return onGraded({ correct: false, answer: sql, message: 'SQL 실행 오류가 있어요.' });
      }
      setRes({ result: g.display });
      if (g.status === 'no-result') return onGraded({ correct: false, answer: sql, message: '결과 표가 나오지 않았어요.' });
      onGraded({ correct: g.pass, answer: sql, message: g.pass ? '' : g.failedOnAltSeed ? '보이는 데이터에서만 맞아요. 특정 값을 직접 쓰지 말고 조건으로 표현해 보세요.' : describeDiff(g.compare.diff!) });
    }
  };

  const b = q.body;
  return (
    <div className="stack">
      {title && <p className="step-label">{title}</p>}
      <p style={{ fontWeight: 600, margin: 0 }}>{q.prompt}</p>
      {q.code && <pre className="codeblock">{q.code}</pre>}
      {b.type === 'choice' && <ChoiceGroup legend={<span className="sr-only">답 고르기</span>} options={b.options} value={choice} onChange={setChoice} disabled={locked} name={q.id} />}
      {b.type === 'number' && (
        <label>값 입력 <input type="number" value={num} onChange={(e) => setNum(e.target.value)} disabled={locked} /></label>
      )}
      {b.type === 'sql' && (
        <>
          <label htmlFor={`q-${q.id}`} className="step-label">SQL 작성 {b.allow && b.allow.some((a) => a !== 'select') ? '(샌드박스)' : ''}</label>
          <textarea id={`q-${q.id}`} className="editor" spellCheck={false} value={sql} disabled={locked} onChange={(e) => { setSql(e.target.value); onDraft?.(e.target.value); }}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void submit(); } }} />
        </>
      )}
      {!locked && (
        <div className="row">
          <button className="btn btn-primary" disabled={busy || !gate.active} onClick={() => void submit()}>{busy ? '채점 중…' : '제출'}</button>
        </div>
      )}
      <div aria-live="polite">
        {res.info && <p className="notice notice-warn">{res.info}</p>}
        {res.error && <SqlErrorView error={res.error} />}
        {res.result && <ResultTable result={res.result} caption="내 SQL 결과" />}
      </div>
    </div>
  );
}
