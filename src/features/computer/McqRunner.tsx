import { useEffect, useMemo, useRef, useState } from 'react';
import { readJson, removeRaw, writeJson } from '../../lib/storage';
import { optionOrder } from './mock';
import type { CgMcq } from './types';

export const MARK = ['①', '②', '③', '④', '⑤'];

/**
 * 객관식을 한 문제씩 풀고 즉시 채점·해설을 보여 준다(기초 객관식·실력점검·오답 다시 풀기).
 * 보기 순서는 풀 때마다 섞는다(정답 위치를 외우지 않게). 진행 중인 풀이는 이 기기에 저장해 이어 풀 수 있다.
 */
interface RunState {
  ids: string[];
  idx: number;
  /** 문항 ID → 고른 원래 보기 번호 */
  answers: Record<string, number>;
  /** 문항 ID → 화면 순서(원래 보기 번호 배열) */
  orders: Record<string, number[]>;
}

export interface McqResult {
  score: number;
  total: number;
  answers: Record<string, number>;
  orders: Record<string, number[]>;
}

export function McqRunner({ items, storageKey, onAnswer, onFinish, finishLabel = '결과 보기' }: {
  items: CgMcq[];
  /** 진행 상태 저장 키(같은 문항 세트일 때만 이어 풀기) */
  storageKey: string;
  onAnswer: (q: CgMcq, correct: boolean) => void;
  onFinish: (r: McqResult) => void;
  finishLabel?: string;
}) {
  const ids = useMemo(() => items.map((q) => q.id), [items]);
  const [run, setRun] = useState<RunState>(() => {
    const saved = readJson<RunState | null>(storageKey, null);
    if (saved && saved.ids.join() === ids.join() && saved.orders) return saved;
    return { ids, idx: 0, answers: {}, orders: Object.fromEntries(items.map((q) => [q.id, optionOrder(q.options.length)])) };
  });
  const [pick, setPick] = useState<number | null>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const q = items[run.idx];
  const order = q ? run.orders[q.id] ?? q.options.map((_, i) => i) : [];
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
  const pos = (orig: number) => order.indexOf(orig);

  const grade = () => {
    if (pick === null || answered !== undefined) return;
    setRun((r) => ({ ...r, answers: { ...r.answers, [q.id]: pick } }));
    onAnswer(q, pick === q.answer);
  };
  const next = () => setRun((r) => ({ ...r, idx: Math.min(items.length - 1, r.idx + 1) }));
  const finish = () => {
    removeRaw(storageKey);
    onFinish({ score, total: items.length, answers: run.answers, orders: run.orders });
  };

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="small muted">{run.idx + 1} / {items.length}문항 · 맞힘 {score}</span>
        <div className="cg-progress" aria-hidden="true"><span style={{ width: `${(Object.keys(run.answers).length / items.length) * 100}%` }} /></div>
      </div>
      <div className="panel stack">
        <div className="row small muted" style={{ gap: '0.4rem' }}>{q.tag && <span className="badge badge-plain">{q.tag}</span>}</div>
        <h2 ref={headRef} tabIndex={-1} className="cg-q">{run.idx + 1}. {q.question}</h2>
        <fieldset disabled={answered !== undefined}>
          <legend className="sr-only">보기</legend>
          <div className="options">
            {order.map((oi, p) => {
              const cls = answered === undefined ? '' : oi === q.answer ? ' correct' : oi === answered ? ' tried-wrong' : '';
              return (
                <label key={oi} className={`option${cls}`}>
                  <input type="radio" name={`mcq-${q.id}`} checked={(answered ?? pick) === oi} onChange={() => setPick(oi)} />
                  <span>{MARK[p]} {q.options[oi]}</span>
                  {answered !== undefined && oi === q.answer && <span className="option-tag option-tag-good">정답</span>}
                  {answered !== undefined && oi === answered && oi !== q.answer && <span className="option-tag">고른 답</span>}
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
              <b>{answered === q.answer ? '맞았어요.' : `틀렸어요. 정답은 ${MARK[pos(q.answer)]}이에요.`}</b> {q.explanation}
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

/** 풀이 후 틀린 문항 복습 카드 */
export function ReviewCard({ q, n, picked, order, unansweredNote = true }: { q: CgMcq; n?: number; picked: number | undefined; order?: number[]; unansweredNote?: boolean }) {
  const ord = order ?? q.options.map((_, i) => i);
  return (
    <details className="panel cg-review">
      <summary>{n !== undefined ? `${n}. ` : ''}{q.question}</summary>
      <ol className="cg-opts" style={{ listStyle: 'none', paddingLeft: 0 }}>
        {ord.map((oi, p) => (
          <li key={oi} className={oi === q.answer ? 'ans' : oi === picked ? 'picked' : ''}>
            {MARK[p]} {q.options[oi]}{oi === q.answer ? ' ← 정답' : oi === picked ? ' ← 고른 답' : ''}
          </li>
        ))}
      </ol>
      {picked === undefined && unansweredNote && <p className="small muted" style={{ margin: 0 }}>(안 푼 문항)</p>}
      <p className="small" style={{ margin: 0 }}>{q.explanation}</p>
    </details>
  );
}
