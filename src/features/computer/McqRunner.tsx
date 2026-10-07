import { useEffect, useMemo, useRef, useState } from 'react';
import { readJson, removeRaw, writeJson } from '../../lib/storage';
import type { CgMcq } from './types';

/**
 * 객관식을 한 문제씩 풀고 즉시 채점·해설을 보여 준다(기초 객관식·실력점검·오답 다시 풀기).
 * 진행 중인 풀이는 이 기기에 저장해 새로고침해도 이어진다.
 */
interface RunState {
  ids: string[];
  idx: number;
  answers: Record<string, number>;
}

export function McqRunner({ items, storageKey, onAnswer, onFinish, finishLabel = '결과 보기' }: {
  items: CgMcq[];
  /** 진행 상태 저장 키(같은 문항 세트일 때만 이어 풀기) */
  storageKey: string;
  onAnswer: (q: CgMcq, correct: boolean) => void;
  onFinish: (score: number, total: number, answers: Record<string, number>) => void;
  finishLabel?: string;
}) {
  const ids = useMemo(() => items.map((q) => q.id), [items]);
  const [run, setRun] = useState<RunState>(() => {
    const saved = readJson<RunState | null>(storageKey, null);
    return saved && saved.ids.join() === ids.join() ? saved : { ids, idx: 0, answers: {} };
  });
  const [pick, setPick] = useState<number | null>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const q = items[run.idx];
  const answered = q ? run.answers[q.id] : undefined;
  const score = items.filter((x) => run.answers[x.id] === x.answer).length;
  const done = items.every((x) => run.answers[x.id] !== undefined);

  useEffect(() => {
    writeJson(storageKey, run);
  }, [run, storageKey]);
  useEffect(() => {
    setPick(null);
    headRef.current?.focus();
  }, [run.idx]);

  if (!q) return <p className="muted">문항이 없어요.</p>;

  const grade = () => {
    if (pick === null || answered !== undefined) return;
    const correct = pick === q.answer;
    setRun((r) => ({ ...r, answers: { ...r.answers, [q.id]: pick } }));
    onAnswer(q, correct);
  };
  const next = () => setRun((r) => ({ ...r, idx: Math.min(items.length - 1, r.idx + 1) }));
  const finish = () => {
    removeRaw(storageKey);
    onFinish(score, items.length, run.answers);
  };

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="small muted">{run.idx + 1} / {items.length}문항 · 맞힘 {score}</span>
        <div className="cg-progress" aria-hidden="true"><span style={{ width: `${(Object.keys(run.answers).length / items.length) * 100}%` }} /></div>
      </div>
      <div className="panel stack">
        <h2 ref={headRef} tabIndex={-1} className="cg-q">{run.idx + 1}. {q.question}</h2>
        {q.extra && <pre className="codeblock">{q.extra}</pre>}
        <fieldset disabled={answered !== undefined}>
          <legend className="sr-only">보기</legend>
          <div className="options">
            {q.options.map((o, i) => {
              const cls = answered === undefined ? '' : i === q.answer ? ' correct' : i === answered ? ' tried-wrong' : '';
              return (
                <label key={i} className={`option${cls}`}>
                  <input type="radio" name={`mcq-${q.id}`} checked={(answered ?? pick) === i} onChange={() => setPick(i)} />
                  <span>{'①②③④⑤'[i] ?? i + 1} {o}</span>
                  {answered !== undefined && i === q.answer && <span className="option-tag option-tag-good">정답</span>}
                  {answered !== undefined && i === answered && i !== q.answer && <span className="option-tag">고른 답</span>}
                </label>
              );
            })}
          </div>
        </fieldset>
        {answered === undefined ? (
          <div className="row"><button className="btn btn-primary" disabled={pick === null} onClick={grade}>채점</button></div>
        ) : (
          <div className="stack" aria-live="polite">
            <p className={`notice ${answered === q.answer ? 'notice-good' : 'notice-warn'}`} style={{ margin: 0 }}>
              <b>{answered === q.answer ? '맞았어요.' : `틀렸어요. 정답은 ${'①②③④⑤'[q.answer]}이에요.`}</b> {q.explanation}
            </p>
            <div className="row">
              {run.idx < items.length - 1 && <button className="btn btn-primary" onClick={next}>다음 문제</button>}
              {done && <button className={`btn ${run.idx === items.length - 1 ? 'btn-primary' : ''}`} onClick={finish}>{finishLabel}</button>}
              {run.idx > 0 && <button className="btn btn-quiet" onClick={() => setRun((r) => ({ ...r, idx: r.idx - 1 }))}>이전 문제 보기</button>}
            </div>
          </div>
        )}
      </div>
      {!done && Object.keys(run.answers).length > 0 && (
        <p className="small muted">풀던 기록은 이 기기에 저장돼요. 나갔다 와도 이어서 풀 수 있어요.</p>
      )}
    </div>
  );
}
