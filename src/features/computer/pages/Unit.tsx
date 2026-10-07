import { useMemo, useState, type ReactElement } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { learnerPrefix, readJson, writeJson } from '../../../lib/storage';
import { useAuth } from '../../auth/AuthContext';
import { CG_UNIT_BY_ID } from '../content';
import { McqRunner } from '../McqRunner';
import { isOpen, isPassed, markDone, noteAnswer, passNeed, recordScore, unitLevel } from '../model';
import { useCg } from '../store';
import { CG_LEVELS, CG_LEVEL_NAME, type CgLevel, type CgTable, type CgUnit, type CgUnitId } from '../types';

function useLearnerPrefix() {
  const id = useAuth().identity;
  return learnerPrefix(id ? id.learnerKey : 'guest');
}

export function Table({ t }: { t: CgTable }) {
  return (
    <div className="table-wrap">
      <table className="data cg-table">
        {t.caption && <caption>{t.caption}</caption>}
        <thead><tr>{t.header.map((h, i) => <th scope="col" key={i}>{h}</th>)}</tr></thead>
        <tbody>{t.rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th scope="row" key={j}>{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** 줄 목록을 문단·글머리표로 */
export function Lines({ lines }: { lines: string[] }) {
  const out: ReactElement[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) out.push(<ul key={`u${out.length}`}>{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>);
    bullets = [];
  };
  lines.forEach((l, i) => {
    const m = /^\s*(?:[-•·*]|\d+[.)])\s+(.*)$/.exec(l);
    if (m) bullets.push(m[1]);
    else {
      flush();
      out.push(<p key={`p${i}`}>{l}</p>);
    }
  });
  flush();
  return <>{out}</>;
}

function LevelStatus({ unitId, lv }: { unitId: CgUnitId; lv: CgLevel }) {
  const { state } = useCg();
  const rec = state.units[unitId]?.[`lv${lv}`];
  if (rec?.passedAt) return <span className="badge badge-exec">통과{rec.best !== undefined ? ` ${rec.best}/${rec.total}` : ''}</span>;
  if (!isOpen(state, unitId, lv)) return <span className="badge badge-plain">잠김</span>;
  if (rec?.best !== undefined) return <span className="badge badge-sim">최고 {rec.best}/{rec.total}</span>;
  return <span className="badge badge-dialect">열림</span>;
}

const levelDetail = (u: CgUnit, lv: CgLevel) =>
  lv === 1 ? `개념 카드 ${u.cards.length}장` :
  lv === 2 ? `빈칸 ${u.blanks.length}개 · ${passNeed(2, u.blanks.length)}개 이상` :
  lv === 3 ? `${u.basic.length}문항 · ${passNeed(3, u.basic.length)}개 이상` :
  lv === 4 ? '핵심 정리 · 비교표 · 자주 틀리는 포인트' :
  `${u.check.length}문항 · ${passNeed(5, u.check.length)}개 이상`;

export function UnitPage() {
  const { unitId } = useParams();
  const u = CG_UNIT_BY_ID[unitId as CgUnitId];
  const { state } = useCg();
  if (!u) return <Navigate to="/computer" replace />;
  const lv = unitLevel(state, u.id);
  return (
    <div className="stack page-narrow" style={{ margin: '0 auto' }}>
      <p className="crumbs" style={{ margin: 0 }}><Link to="/computer">컴퓨터 일반</Link> / {u.id.replace('U', '')}단원</p>
      <h1 style={{ margin: 0 }}>{u.title}</h1>
      <p className="muted" style={{ margin: 0 }}>레벨 {lv}/5 · 앞 단계를 통과하면 다음 단계가 열려요.</p>
      <ol className="cg-levels">
        {CG_LEVELS.map((l) => (
          <li key={l} className="panel">
            <span className="cg-lv-num">{l}</span>
            <span className="stack" style={{ gap: '0.15rem' }}>
              <b>{CG_LEVEL_NAME[l]}</b>
              <span className="small muted">{levelDetail(u, l)}</span>
            </span>
            <LevelStatus unitId={u.id} lv={l} />
            <Link className={`btn btn-small ${isOpen(state, u.id, l) && !isPassed(state, u.id, l) ? 'btn-primary' : ''}`} to={`/computer/unit/${u.id}/${l}`}>
              {isPassed(state, u.id, l) ? '다시 보기' : isOpen(state, u.id, l) ? '시작' : '살펴보기'}
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function LevelPage() {
  const { unitId, level } = useParams();
  const u = CG_UNIT_BY_ID[unitId as CgUnitId];
  const lv = Number(level) as CgLevel;
  const { state } = useCg();
  const [force, setForce] = useState(false);
  if (!u || !CG_LEVELS.includes(lv)) return <Navigate to="/computer" replace />;
  const open = isOpen(state, u.id, lv);
  return (
    <div className="stack" style={{ maxWidth: 860, margin: '0 auto', width: '100%' }}>
      <p className="crumbs" style={{ margin: 0 }}>
        <Link to="/computer">컴퓨터 일반</Link> / <Link to={`/computer/unit/${u.id}`}>{u.id.replace('U', '')}단원 {u.title}</Link> / {lv}단계
      </p>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>{lv}단계 {CG_LEVEL_NAME[lv]}</h1>
        <LevelStatus unitId={u.id} lv={lv} />
      </div>
      {!open && !force ? (
        <div className="panel stack">
          <p style={{ margin: 0 }}>앞 단계 <b>{lv - 1}단계 {CG_LEVEL_NAME[(lv - 1) as CgLevel]}</b>를 통과하면 열려요.</p>
          <div className="row">
            <Link className="btn btn-primary" to={`/computer/unit/${u.id}/${lv - 1}`}>앞 단계로</Link>
            <button className="btn" onClick={() => setForce(true)}>그래도 풀어보기</button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>미리 풀어서 기준을 넘으면 이 단계도 통과로 기록돼요.</p>
        </div>
      ) : lv === 1 ? <Theory u={u} /> : lv === 2 ? <Blanks u={u} /> : lv === 4 ? <Summary u={u} /> : <Quiz u={u} lv={lv} />}
    </div>
  );
}

function NextStep({ u, lv }: { u: CgUnit; lv: CgLevel }) {
  const nav = useNavigate();
  return (
    <div className="row">
      {lv < 5 ? <button className="btn btn-grow" onClick={() => nav(`/computer/unit/${u.id}/${lv + 1}`)}>다음 단계: {CG_LEVEL_NAME[(lv + 1) as CgLevel]}</button> : <Link className="btn btn-grow" to="/computer">단원 목록으로</Link>}
      <Link className="btn btn-quiet" to={`/computer/unit/${u.id}`}>단원 보기</Link>
    </div>
  );
}

function Theory({ u }: { u: CgUnit }) {
  const cg = useCg();
  const [i, setI] = useState(0);
  const c = u.cards[i];
  const last = i === u.cards.length - 1;
  const done = isPassed(cg.state, u.id, 1);
  if (!c) return <p className="muted">카드가 없어요.</p>;
  return (
    <div className="stack">
      <div className="panel stack cg-card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="small muted">카드 {i + 1} / {u.cards.length}</span>
          {c.ext && <span className="badge badge-sim">PC정비사 확장</span>}
        </div>
        <h2 style={{ margin: 0 }}>{c.title}</h2>
        <div className="cg-lines"><Lines lines={c.lines} /></div>
        {c.table && <Table t={c.table} />}
      </div>
      <div className="row">
        <button className="btn" disabled={i === 0} onClick={() => setI(i - 1)}>이전</button>
        {!last && <button className="btn btn-primary" onClick={() => setI(i + 1)}>다음 카드</button>}
        {last && !done && <button className="btn btn-primary" onClick={() => cg.commit((s) => markDone(s, u.id, 1))}>이론 완료</button>}
      </div>
      <div className="cg-dots" aria-hidden="true">{u.cards.map((_, k) => <span key={k} className={k === i ? 'on' : k < i ? 'seen' : ''} />)}</div>
      {done && <><p className="notice notice-good" style={{ margin: 0 }}>이론을 완료했어요.</p><NextStep u={u} lv={1} /></>}
    </div>
  );
}

function Blanks({ u }: { u: CgUnit }) {
  const cg = useCg();
  const prefix = useLearnerPrefix();
  const key = `${prefix}cg:blanks:${u.id}`;
  const [ans, setAns] = useState<Record<string, string>>(() => readJson(key, {}));
  const [checked, setChecked] = useState(false);
  const [result, setResult] = useState<{ score: number; passed: boolean } | null>(null);
  const words = useMemo(() => [...u.wordBox].sort((a, b) => a.localeCompare(b, 'ko')), [u.wordBox]);
  const used = new Set(Object.values(ans));
  const need = passNeed(2, u.blanks.length);
  const set = (id: string, v: string) => {
    const n = { ...ans, [id]: v };
    setAns(n);
    writeJson(key, n);
    setChecked(false);
    setResult(null);
  };
  const submit = () => {
    const score = u.blanks.filter((b) => ans[b.id] === b.answer).length;
    cg.commit((s) => recordScore(s, u.id, 2, score, u.blanks.length).state);
    setChecked(true);
    setResult({ score, passed: score >= need });
  };
  const filled = u.blanks.filter((b) => ans[b.id]).length;
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>문장마다 빈칸에 알맞은 말을 예시답안에서 고르세요. {u.blanks.length}개 중 {need}개 이상 맞으면 통과예요. 예시답안에는 헷갈리는 용어도 섞여 있어요.</p>
      <details className="panel">
        <summary>예시답안 {u.wordBox.length}개 보기</summary>
        <ul className="cg-words">{words.map((w) => <li key={w} className={used.has(w) ? 'used' : ''}>{w}</li>)}</ul>
      </details>
      <ol className="cg-blanks">
        {u.blanks.map((b) => {
          const [before, after] = b.sentence.split('___');
          const ok = checked ? ans[b.id] === b.answer : null;
          return (
            <li key={b.id} className={ok === null ? '' : ok ? 'ok' : 'bad'}>
              <span>{before}</span>
              <select aria-label={`빈칸: ${b.sentence.replace('___', '(빈칸)')}`} value={ans[b.id] ?? ''} onChange={(e) => set(b.id, e.target.value)}>
                <option value="">(고르기)</option>
                {words.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
              <span>{after ?? ''}</span>
              {ok === false && <span className="small cg-fix"> → 다시 생각해 보기</span>}
              {ok === true && <span className="status-done"> ✓</span>}
            </li>
          );
        })}
      </ol>
      <div className="row">
        <button className="btn btn-primary" disabled={filled === 0} onClick={submit}>채점하기 ({filled}/{u.blanks.length} 채움)</button>
        {checked && <button className="btn btn-quiet" onClick={() => { setChecked(false); setResult(null); }}>표시 지우고 고치기</button>}
      </div>
      {result && (
        <div aria-live="polite" className="stack">
          <p className={`notice ${result.passed ? 'notice-good' : 'notice-warn'}`} style={{ margin: 0 }}>
            {result.score}/{u.blanks.length}개 맞았어요. {result.passed ? '통과! 다음 단계가 열렸어요.' : `${need - result.score}개 더 맞히면 통과예요. 표시된 빈칸을 고쳐서 다시 채점해 보세요.`}
          </p>
          {result.passed && <NextStep u={u} lv={2} />}
        </div>
      )}
    </div>
  );
}

function Summary({ u }: { u: CgUnit }) {
  const cg = useCg();
  const done = isPassed(cg.state, u.id, 4);
  return (
    <div className="stack">
      <div className="panel stack">
        <h2 style={{ margin: 0 }}>핵심 정리</h2>
        <ol className="cg-summary">{u.summary.lines.map((l, i) => <li key={i}>{l}</li>)}</ol>
      </div>
      {u.summary.tables.map((t, i) => <div key={i} className="panel"><Table t={t} /></div>)}
      {u.summary.pitfalls.length > 0 && (
        <div className="panel stack">
          <h2 style={{ margin: 0 }}>시험에서 자주 틀리는 포인트</h2>
          <ul style={{ margin: 0 }}>{u.summary.pitfalls.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </div>
      )}
      {done ? (
        <><p className="notice notice-good" style={{ margin: 0 }}>요약을 확인했어요.</p><NextStep u={u} lv={4} /></>
      ) : (
        <div className="row"><button className="btn btn-primary" onClick={() => cg.commit((s) => markDone(s, u.id, 4))}>요약 확인 완료</button></div>
      )}
    </div>
  );
}

function Quiz({ u, lv }: { u: CgUnit; lv: 3 | 5 }) {
  const cg = useCg();
  const prefix = useLearnerPrefix();
  const items = lv === 3 ? u.basic : u.check;
  const need = passNeed(lv, items.length);
  const [round, setRound] = useState(0);
  const [result, setResult] = useState<{ score: number; passed: boolean } | null>(null);
  if (result) {
    return (
      <div className="stack" aria-live="polite">
        <div className={`notice ${result.passed ? 'notice-good' : 'notice-warn'}`}>
          <b>{result.score}/{items.length}개 맞았어요.</b>{' '}
          {result.passed ? (lv === 5 ? '실력점검 통과! 이 단원의 5단계를 모두 마쳤어요.' : '통과! 다음 단계가 열렸어요.') : `기준은 ${need}개예요. ${need - result.score}개 더 맞히면 통과해요. 틀린 문항은 오답노트에 모였어요.`}
        </div>
        <div className="row">
          <button className="btn" onClick={() => { setResult(null); setRound((r) => r + 1); }}>다시 풀기</button>
          <Link className="btn" to="/computer/wrong">오답노트</Link>
        </div>
        {result.passed && <NextStep u={u} lv={lv} />}
      </div>
    );
  }
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>{items.length}문항을 한 문제씩 풀고 바로 채점해요. {need}개 이상 맞으면 통과예요. 틀린 문항은 오답노트에 자동으로 모여요.</p>
      <McqRunner
        key={round}
        items={items}
        storageKey={`${prefix}cg:run:${u.id}:${lv}`}
        onAnswer={(q, correct) => cg.commit((s) => noteAnswer(s, q.id, correct))}
        onFinish={(score, total) => {
          cg.commit((s) => recordScore(s, u.id, lv, score, total).state);
          setResult({ score, passed: score >= passNeed(lv, total) });
        }}
      />
    </div>
  );
}
