import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { learnerPrefix } from '../../../lib/storage';
import { useAuth } from '../../auth/AuthContext';
import { CG_MCQ_BY_ID, CG_UNIT_BY_ID } from '../content';
import { McqRunner } from '../McqRunner';
import { activeWrongIds, noteAnswer } from '../model';
import { useCg } from '../store';
import { CG_AREA_LABEL, CG_UNIT_IDS, type CgMcq, type CgUnitId } from '../types';

export function WrongNotePage() {
  const cg = useCg();
  const id = useAuth().identity;
  const prefix = learnerPrefix(id ? id.learnerKey : 'guest');
  const ids = activeWrongIds(cg.state);
  const all = useMemo(() => ids.map((x) => CG_MCQ_BY_ID[x]).filter((q): q is CgMcq => !!q), [ids]);
  const [unit, setUnit] = useState<CgUnitId | 'all'>('all');
  const [retry, setRetry] = useState<CgMcq[] | null>(null);
  const [done, setDone] = useState<{ score: number; total: number } | null>(null);
  const shown = unit === 'all' ? all : all.filter((q) => q.unitId === unit);
  const countBy = (u: CgUnitId) => all.filter((q) => q.unitId === u).length;

  if (retry) {
    return (
      <div className="stack" style={{ maxWidth: 860, margin: '0 auto', width: '100%' }}>
        <p className="crumbs" style={{ margin: 0 }}><Link to="/computer">컴퓨터 일반</Link> / <button className="btn btn-quiet btn-small" onClick={() => setRetry(null)}>오답노트</button> / 다시 풀기</p>
        <h1 style={{ margin: 0 }}>오답 다시 풀기</h1>
        <p className="muted" style={{ margin: 0 }}>맞히면 오답노트에서 빠져요.</p>
        <McqRunner
          items={retry}
          storageKey={`${prefix}cg:run:wrong:${retry.map((q) => q.id).join(',').slice(0, 60)}`}
          onAnswer={(q, correct) => cg.commit((s) => noteAnswer(s, q.id, correct))}
          onFinish={(score, total) => { setDone({ score, total }); setRetry(null); }}
          finishLabel="끝내기"
        />
      </div>
    );
  }

  return (
    <div className="stack" style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <p className="crumbs" style={{ margin: 0 }}><Link to="/computer">컴퓨터 일반</Link> / 오답노트</p>
      <h1 style={{ margin: 0 }}>오답노트 <span className="muted" style={{ fontSize: '1rem' }}>{all.length}문항</span></h1>
      <p className="muted" style={{ margin: 0 }}>기초 객관식·실력점검·모의고사에서 틀린 문항이 자동으로 모여요. 다시 맞히면 빠져요.</p>
      {done && <p className="notice notice-good" style={{ margin: 0 }}>{done.total}문항 중 {done.score}문항을 맞혀 오답노트에서 뺐어요.</p>}
      {all.length === 0 ? (
        <p className="notice">오답노트가 비어 있어요. 👏</p>
      ) : (
        <>
          <div className="row">
            <label className="small">단원
              <select value={unit} onChange={(e) => setUnit(e.target.value as CgUnitId | 'all')} style={{ marginLeft: '0.4rem' }}>
                <option value="all">전체 ({all.length})</option>
                {CG_UNIT_IDS.filter((u) => countBy(u)).map((u) => <option key={u} value={u}>{u.replace('U', '')}단원 {CG_UNIT_BY_ID[u]?.title} ({countBy(u)})</option>)}
              </select>
            </label>
            <button className="btn btn-primary" onClick={() => { setDone(null); setRetry(shown.slice(0, 40)); }}>
              {shown.length > 40 ? '최근 40문항 다시 풀기' : `${shown.length}문항 다시 풀기`}
            </button>
            <Link className="btn" to="/computer/mock/wrong">오답 모의고사</Link>
          </div>
          <ol className="cg-wrong-list">
            {shown.map((q) => {
              const w = cg.state.wrong[q.id];
              return (
                <li key={q.id} className="panel">
                  <details>
                    <summary>
                      <span className="small muted">{q.unitId.replace('U', '')}단원 · {CG_AREA_LABEL[q.area]} · {q.set === 'basic' ? '기초' : '실력점검'} · 틀린 횟수 {w?.n ?? 1}</span><br />
                      {q.question}
                    </summary>
                    {q.extra && <pre className="codeblock">{q.extra}</pre>}
                    <ol className="cg-opts">{q.options.map((o, i) => <li key={i} className={i === q.answer ? 'ans' : ''}>{o}{i === q.answer ? ' ← 정답' : ''}</li>)}</ol>
                    <p className="small" style={{ margin: 0 }}>{q.explanation}</p>
                  </details>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
