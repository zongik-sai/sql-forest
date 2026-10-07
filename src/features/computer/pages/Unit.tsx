import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { learnerPrefix, readJson, writeJson } from '../../../lib/storage';
import { useAuth } from '../../auth/AuthContext';
import { CG_UNIT_BY_ID } from '../content';
import { McqRunner, ReviewCard, type McqResult } from '../McqRunner';
import { shuffle } from '../mock';
import { isOpen, isPassed, markDone, noteAnswer, passNeed, recordScore, unitLevel } from '../model';
import { useCg } from '../store';
import { BLANK_RE, CG_LEVELS, CG_LEVEL_NAME, type CgLevel, type CgMcq, type CgTable, type CgUnit, type CgUnitId } from '../types';

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
      <p style={{ margin: 0 }}>{u.intro}</p>
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
  const done = isPassed(cg.state, u.id, 1);
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>개념 카드 {u.cards.length}장을 차례로 읽어 보세요. 끝에 있는 "확장" 카드는 시험에 자주 나오는 실무 내용이에요.</p>
      {u.cards.map((c, i) => (
        <article key={c.id} className={`panel stack cg-card${c.ext ? ' ext' : ''}`} aria-labelledby={`card-${c.id}`}>
          <h2 id={`card-${c.id}`} style={{ margin: 0 }}>
            <span className="cg-card-no">{String(i + 1).padStart(2, '0')}</span> {c.title} {c.ext && <span className="badge badge-sim">확장</span>}
          </h2>
          <ul className="cg-points">{c.points.map((p, k) => <li key={k}>{p}</li>)}</ul>
          {c.table && <Table t={c.table} />}
          {c.tip && <p className="cg-tip">💡 {c.tip}</p>}
        </article>
      ))}
      {done ? (
        <><p className="notice notice-good" style={{ margin: 0 }}>이론 학습을 완료했어요.</p><NextStep u={u} lv={1} /></>
      ) : (
        <div className="panel row" style={{ justifyContent: 'space-between' }}>
          <span>모든 카드를 읽었으면 완료를 누르고 개념 끼워맞추기로 넘어가세요.</span>
          <button className="btn btn-primary" onClick={() => cg.commit((s) => markDone(s, u.id, 1))}>이론 학습 완료</button>
        </div>
      )}
    </div>
  );
}

interface BlankDraft { ans: Record<string, string>; order: string[] }

function Blanks({ u }: { u: CgUnit }) {
  const cg = useCg();
  const prefix = useLearnerPrefix();
  const key = `${prefix}cg:blanks:${u.id}`;
  const need = passNeed(2, u.blanks.length);
  const fresh = (): BlankDraft => ({ ans: {}, order: shuffle(u.wordBox) });
  const [draft, setDraft] = useState<BlankDraft>(() => {
    const d = readJson<BlankDraft | null>(key, null);
    return d && Array.isArray(d.order) && d.order.length === u.wordBox.length ? d : fresh();
  });
  const [sel, setSel] = useState<string | null>(u.blanks[0]?.id ?? null);
  const [graded, setGraded] = useState<{ score: number } | null>(null);
  const blankRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    writeJson(key, draft);
  }, [draft, key]);
  const used = new Set(Object.values(draft.ans));
  const filled = u.blanks.filter((b) => draft.ans[b.id]).length;

  const place = (word: string) => {
    if (!sel || graded) return;
    const ans = { ...draft.ans, [sel]: word };
    setDraft({ ...draft, ans });
    // 다음 빈칸(비어 있는 것)으로 이동
    const idx = u.blanks.findIndex((b) => b.id === sel);
    const nextEmpty = [...u.blanks.slice(idx + 1), ...u.blanks.slice(0, idx)].find((b) => !ans[b.id]);
    if (nextEmpty) {
      setSel(nextEmpty.id);
      blankRefs.current[nextEmpty.id]?.scrollIntoView({ block: 'nearest' });
    }
  };
  const submit = () => {
    const score = u.blanks.filter((b) => draft.ans[b.id] === b.answer).length;
    cg.commit((s) => recordScore(s, u.id, 2, score, u.blanks.length).state);
    setGraded({ score });
    window.scrollTo(0, 0);
  };
  const retry = () => {
    setDraft(fresh());
    setGraded(null);
    setSel(u.blanks[0]?.id ?? null);
  };

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>빈칸을 누른 뒤 예시답안에서 알맞은 말을 고르세요. 예시답안 {u.wordBox.length}개 중 {u.wordBox.length - u.blanks.length}개는 헷갈리게 넣은 함정이에요. {u.blanks.length}개 중 {need}개 이상 맞히면 통과예요.</p>
      {graded && (
        <div className={`notice ${graded.score >= need ? 'notice-good' : 'notice-warn'}`} aria-live="polite">
          <b>{graded.score}/{u.blanks.length}개 맞았어요.</b> {graded.score >= need ? '통과! 다음 단계가 열렸어요.' : `통과 기준은 ${need}개예요. 틀린 빈칸의 정답과 해설을 확인하고 다시 풀어 보세요.`}
          <div className="row" style={{ marginTop: '0.5rem' }}>
            <button className="btn btn-small" onClick={retry}>다시 풀기(새 순서)</button>
            {graded.score >= need && <NextStep u={u} lv={2} />}
          </div>
        </div>
      )}
      <div className="cg-fill">
        <ol className="cg-blanks">
          {u.blanks.map((b, i) => {
            const [before, after] = b.text.split(BLANK_RE);
            const v = draft.ans[b.id];
            const ok = graded ? v === b.answer : null;
            return (
              <li key={b.id} className={ok === null ? '' : ok ? 'ok' : 'bad'}>
                <span className="cg-blank-no">{i + 1}</span>
                <span>
                  {before}
                  <button
                    ref={(el) => { blankRefs.current[b.id] = el; }}
                    type="button"
                    className={`cg-blank${sel === b.id && !graded ? ' sel' : ''}${ok === true ? ' ok' : ok === false ? ' no' : ''}`}
                    aria-label={`${i + 1}번 빈칸: ${v ?? '비어 있음'}`}
                    aria-pressed={sel === b.id}
                    disabled={!!graded}
                    onClick={() => setSel(b.id)}
                  >{v ?? '　　　'}</button>
                  {after}
                  {ok === false && <span className="cg-fix">정답: <b>{b.answer}</b> — {b.explanation}</span>}
                </span>
              </li>
            );
          })}
        </ol>
        {!graded && (
          <aside className="cg-bank" aria-label={`예시답안 ${u.wordBox.length}개`}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>예시답안</b>
              <span className="small muted">{filled}/{u.blanks.length} 채움</span>
            </div>
            <div className="cg-chips">
              {draft.order.map((w) => (
                <button key={w} type="button" className={`cg-chip${used.has(w) ? ' used' : ''}`} disabled={!sel} onClick={() => place(w)}>{w}</button>
              ))}
            </div>
            <div className="row">
              <button className="btn btn-primary btn-small" disabled={filled === 0} onClick={submit}>채점하기</button>
              {sel && draft.ans[sel] && <button className="btn btn-small btn-quiet" onClick={() => { const a = { ...draft.ans }; delete a[sel]; setDraft({ ...draft, ans: a }); }}>이 빈칸 비우기</button>}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function Summary({ u }: { u: CgUnit }) {
  const cg = useCg();
  const done = isPassed(cg.state, u.id, 4);
  return (
    <div className="stack">
      <section className="stack">
        <h2 style={{ margin: 0 }}>핵심 {u.summary.keys.length}줄</h2>
        <div className="cg-keys">{u.summary.keys.map((k, i) => <div key={i} className="panel"><b>{k.k}</b><span>{k.v}</span></div>)}</div>
      </section>
      {u.summary.tables.map((t, i) => <div key={i} className="panel"><Table t={t} /></div>)}
      {u.summary.traps.length > 0 && (
        <div className="panel stack">
          <h2 style={{ margin: 0 }}>시험에서 자주 틀리는 포인트</h2>
          <ul className="cg-traps">{u.summary.traps.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </div>
      )}
      {done ? (
        <><p className="notice notice-good" style={{ margin: 0 }}>요약을 확인했어요.</p><NextStep u={u} lv={4} /></>
      ) : (
        <div className="panel row" style={{ justifyContent: 'space-between' }}>
          <span>요약을 확인했으면 실력점검에 도전하세요(통과 {passNeed(5, u.check.length)}/{u.check.length}).</span>
          <button className="btn btn-primary" onClick={() => cg.commit((s) => markDone(s, u.id, 4))}>요약 확인 완료</button>
        </div>
      )}
    </div>
  );
}

function Quiz({ u, lv }: { u: CgUnit; lv: 3 | 5 }) {
  const cg = useCg();
  const prefix = useLearnerPrefix();
  const all = lv === 3 ? u.basic : u.check;
  const need = passNeed(lv, all.length);
  const [items, setItems] = useState<CgMcq[]>(all);
  const [round, setRound] = useState(0);
  const [result, setResult] = useState<(McqResult & { full: boolean }) | null>(null);
  if (result) {
    const wrong = items.filter((q) => result.answers[q.id] !== q.answer);
    const passed = result.full && result.score >= need;
    return (
      <div className="stack" aria-live="polite">
        <div className={`notice ${passed ? 'notice-good' : 'notice-warn'}`}>
          <b>{result.score}/{result.total}개 맞았어요.</b>{' '}
          {!result.full ? '틀린 문항 다시 풀기는 연습이에요(통과 판정은 전체 문항으로).' :
            passed ? (lv === 5 ? '실력점검 통과! 이 단원의 5단계를 모두 마쳤어요.' : '통과! 다음 단계가 열렸어요.') :
            `통과 기준은 ${need}개예요. ${need - result.score}개 더 맞히면 통과해요. 틀린 문항은 오답노트에 모였어요.`}
        </div>
        <div className="row">
          {wrong.length > 0 && <button className="btn btn-primary" onClick={() => { setItems(wrong); setResult(null); setRound((r) => r + 1); }}>틀린 {wrong.length}문항만 다시</button>}
          <button className="btn" onClick={() => { setItems(all); setResult(null); setRound((r) => r + 1); }}>처음부터 다시</button>
          <Link className="btn btn-quiet" to="/computer/wrong">오답노트</Link>
        </div>
        {passed && <NextStep u={u} lv={lv} />}
        {wrong.length > 0 && (
          <section className="stack">
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>틀린 문항 {wrong.length}개</h2>
            {wrong.map((q) => <ReviewCard key={q.id} q={q} n={items.indexOf(q) + 1} picked={result.answers[q.id]} order={result.orders[q.id]} />)}
          </section>
        )}
      </div>
    );
  }
  const full = items.length === all.length;
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>
        {full ? `${all.length}문항을 한 문제씩 풀고 바로 채점해요. ${need}개 이상 맞으면 통과예요.` : `틀린 ${items.length}문항을 다시 풀어요(연습).`} 틀린 문항은 오답노트에 자동으로 모여요.
      </p>
      <McqRunner
        key={round}
        items={items}
        storageKey={`${prefix}cg:run:${u.id}:${lv}${full ? '' : ':retry'}`}
        onAnswer={(q, correct) => cg.commit((s) => noteAnswer(s, q.id, correct))}
        onFinish={(r) => {
          if (full) cg.commit((s) => recordScore(s, u.id, lv, r.score, r.total).state);
          setResult({ ...r, full });
          window.scrollTo(0, 0);
        }}
      />
    </div>
  );
}
