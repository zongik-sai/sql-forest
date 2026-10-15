import { useMemo, useState } from 'react';

/** 뜻 3개 ↔ 용어 3개(+헷갈리는 용어 1개) */
export interface MatchData {
  pairs: { term: string; desc: string }[];
  distractor: string;
}

/** 순서 섞기(화면용, 매번 다르게) */
function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/** 카드 한 장의 개념 맞추기: 뜻마다 용어 4개(정답 3 + 헷갈리는 용어 1) 중 하나를 고른다. 모두 맞혀야 끝난다. */
export function CardMatch({ id, match: m, onDone, title = '개념 맞추기', help }: { id: string; match: MatchData; onDone: () => void; title?: string; help?: string }) {
  const rows = useMemo(() => shuffle(m.pairs), [m]);
  const terms = useMemo(() => shuffle([...m.pairs.map((p) => p.term), m.distractor]), [m]);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Record<string, boolean> | null>(null);
  const locked = (desc: string) => checked?.[desc] === true;
  const allOk = !!checked && rows.every((r) => checked[r.desc]);
  const choose = (desc: string, term: string) => {
    if (locked(desc) || allOk) return;
    const next: Record<string, string> = {};
    // 같은 용어는 한 뜻에만: 다른 줄에서 고른 것은 빼고 옮긴다(맞힌 줄은 그대로)
    for (const [d, t] of Object.entries(pick)) if (t !== term || locked(d)) next[d] = t;
    next[desc] = term;
    setPick(next);
    if (checked && checked[desc] === false) {
      const ck = { ...checked };
      delete ck[desc];
      setChecked(ck);
    }
  };
  const check = () => {
    const res = Object.fromEntries(rows.map((r) => [r.desc, pick[r.desc] === r.term]));
    setChecked(res);
    if (rows.every((r) => res[r.desc])) onDone();
  };
  const usedByLocked = new Set(rows.filter((r) => locked(r.desc)).map((r) => pick[r.desc]));
  const wrongN = checked ? rows.filter((r) => checked[r.desc] === false).length : 0;
  return (
    <section className="panel stack cg-match" aria-labelledby={`match-${id}`}>
      <h3 id={`match-${id}`} style={{ margin: 0 }}>{title}</h3>
      <p className="small muted" style={{ margin: 0 }}>{help ?? `뜻에 맞는 용어를 고르세요. 용어 ${terms.length}개 중 1개는 헷갈리게 넣은 함정이에요.`}</p>
      <ol className="cg-match-rows">
        {rows.map((r) => {
          const st = checked?.[r.desc];
          return (
            <li key={r.desc} className={st === true ? 'ok' : st === false ? 'bad' : ''}>
              <p className="cg-match-desc">{r.desc}</p>
              <div className="cg-chips" role="group" aria-label={`뜻: ${r.desc}`}>
                {terms.map((t) => {
                  const on = pick[r.desc] === t;
                  const takenElsewhere = !on && usedByLocked.has(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      className={`cg-chip${on ? ' on' : ''}${on && st === true ? ' ok' : ''}${on && st === false ? ' no' : ''}`}
                      aria-pressed={on}
                      disabled={locked(r.desc) || allOk || takenElsewhere}
                      onClick={() => choose(r.desc, t)}
                    >{t}</button>
                  );
                })}
              </div>
              {st === true && <span className="small cg-match-mark">✓ 맞았어요</span>}
              {st === false && <span className="small cg-match-mark">다시 골라 보세요. 카드에서 찾아봐도 돼요.</span>}
            </li>
          );
        })}
      </ol>
      {!allOk && (
        <div className="row">
          <button className="btn btn-primary" disabled={rows.some((r) => !pick[r.desc])} onClick={check}>확인</button>
          {wrongN > 0 && <span className="small muted" aria-live="polite">{wrongN}개가 틀렸어요. 틀린 줄만 다시 고르고 확인을 누르세요.</span>}
        </div>
      )}
    </section>
  );
}

