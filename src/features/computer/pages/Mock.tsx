import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { learnerPrefix, readJson, removeRaw, writeJson } from '../../../lib/storage';
import { useAuth } from '../../auth/AuthContext';
import { CG_MCQ_BY_ID, CG_UNIT_BY_ID, CG_UNITS } from '../content';
import { buildMock } from '../mock';
import { activeWrongIds, addMock, isRegularMock, MOCK_LABEL, noteAnswer, scoreMock, type MockKind, type MockRecord } from '../model';
import { useCg } from '../store';
import { CG_AREA_LABEL, CG_AREAS, CG_PASS, CG_UNIT_IDS, type CgMcq } from '../types';

const KINDS: MockKind[] = ['set1', 'set2', 'set3', 'random', 'wrong'];
const pct = (c: number, t: number) => (t ? Math.round((c / t) * 100) : 0);
const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.max(0, sec % 60)).padStart(2, '0')}`;

function usePrefix() {
  const id = useAuth().identity;
  return learnerPrefix(id ? id.learnerKey : 'guest');
}

export function MockHubPage() {
  const cg = useCg();
  const prefix = usePrefix();
  const current = readJson<ExamState | null>(`${prefix}cg:mock:current`, null);
  const wrongN = activeWrongIds(cg.state).length;
  const hist = [...cg.state.mock].reverse();
  const best = (k: MockKind) => cg.state.mock.filter((m) => m.kind === k).reduce((b, m) => Math.max(b, m.score), -1);
  return (
    <div className="stack" style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <p className="crumbs" style={{ margin: 0 }}><Link to="/computer">컴퓨터 일반</Link> / 모의고사</p>
      <h1 style={{ margin: 0 }}>모의고사</h1>
      <p className="muted" style={{ margin: 0 }}>
        사지선다 {CG_PASS.mock.total}문항 · {CG_PASS.mock.minutes}분 · {CG_PASS.mock.need}문항 이상이면 합격 기준이에요.
        단원별로 고르게 뽑아 영역 순서(운영체제 → 주변기기 → 유지보수 → 네트워크 → 컴퓨터 일반)로 나와요.
      </p>
      {current && (
        <div className="notice row">
          <span>{MOCK_LABEL[current.kind]}을(를) 풀던 중이에요.</span>
          <Link className="btn btn-small btn-primary" to={`/computer/mock/${current.kind}`}>이어서 풀기</Link>
        </div>
      )}
      <div className="cg-mock-grid">
        {KINDS.map((k) => {
          const b = best(k);
          const disabled = k === 'wrong' && wrongN === 0;
          return (
            <div key={k} className="panel stack" style={{ gap: '0.4rem' }}>
              <b>{MOCK_LABEL[k]}</b>
              <span className="small muted">
                {k === 'random' ? '볼 때마다 새로 뽑아요' : k === 'wrong' ? `오답노트 ${wrongN}문항에서 출제(최대 ${CG_PASS.mock.total})` : '고정 문항(다시 풀어도 같은 문제)'}
              </span>
              <span className="small">{b >= 0 ? `최고 ${b}/${k === 'wrong' ? '…' : CG_PASS.mock.total}` : '아직 안 봤어요'}</span>
              {disabled ? <span className="small muted">틀린 문항이 생기면 열려요.</span> : (
                <Link className="btn btn-small btn-primary" to={`/computer/mock/${k}`} onClick={() => { if (current && current.kind !== k) removeRaw(`${prefix}cg:mock:current`); }}>
                  {current?.kind === k ? '이어서 풀기' : '시작'}
                </Link>
              )}
            </div>
          );
        })}
      </div>
      <section className="stack">
        <h2 style={{ margin: 0 }}>지난 기록</h2>
        {hist.length === 0 ? <p className="muted">아직 기록이 없어요.</p> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th scope="col">날짜</th><th scope="col">종류</th><th scope="col">점수</th><th scope="col">결과</th><th scope="col">걸린 시간</th></tr></thead>
              <tbody>
                {hist.slice(0, 20).map((m) => (
                  <tr key={m.id}>
                    <td>{new Date(m.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{MOCK_LABEL[m.kind]}</td>
                    <td>{m.score}/{m.total}</td>
                    <td>{m.total === CG_PASS.mock.total ? (m.score >= CG_PASS.mock.need ? '합격 기준 이상' : '기준 미만') : '-'}</td>
                    <td>{mmss(m.seconds)}{m.timeUp ? ' (시간 종료)' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

interface ExamState {
  kind: MockKind;
  ids: string[];
  answers: Record<string, number>;
  startedAt: number;
  idx: number;
}

export function MockExamPage() {
  const { kind } = useParams();
  const k = kind as MockKind;
  if (!KINDS.includes(k)) return <Navigate to="/computer/mock" replace />;
  return <Exam kind={k} key={k} />;
}

function Exam({ kind }: { kind: MockKind }) {
  const cg = useCg();
  const prefix = usePrefix();
  const key = `${prefix}cg:mock:current`;
  const nav = useNavigate();
  const [exam, setExam] = useState<ExamState | null>(() => {
    const saved = readJson<ExamState | null>(key, null);
    if (saved && saved.kind === kind && saved.ids.every((id) => CG_MCQ_BY_ID[id])) return saved;
    const items = buildMock(CG_UNITS, kind, { wrongIds: activeWrongIds(cg.state) });
    if (!items.length) return null;
    return { kind, ids: items.map((q) => q.id), answers: {}, startedAt: Date.now(), idx: 0 };
  });
  const [result, setResult] = useState<{ rec: MockRecord; items: CgMcq[]; answers: Record<string, number> } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [confirm, setConfirm] = useState(false);
  const submitted = useRef(false);
  const items = useMemo(() => (exam ? exam.ids.map((id) => CG_MCQ_BY_ID[id]).filter(Boolean) : []), [exam]);
  const limit = CG_PASS.mock.minutes * 60;
  const elapsed = exam ? Math.floor((now - exam.startedAt) / 1000) : 0;
  const left = limit - elapsed;

  useEffect(() => {
    if (exam && !result) writeJson(key, exam);
  }, [exam, key, result]);

  const submit = (timeUp: boolean) => {
    if (!exam || submitted.current) return;
    submitted.current = true;
    const r = scoreMock(items, exam.answers);
    const rec: MockRecord = {
      id: `${exam.startedAt.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      kind, at: new Date().toISOString(), score: r.score, total: items.length,
      seconds: Math.min(limit, Math.floor((Date.now() - exam.startedAt) / 1000)), ...(timeUp ? { timeUp: true } : {}),
      perUnit: r.perUnit, perArea: r.perArea,
    };
    cg.commit((s) => {
      let n = addMock(s, rec);
      for (const x of r.results) if (exam.answers[x.id] !== undefined || !x.correct) n = noteAnswer(n, x.id, x.correct);
      return n;
    });
    removeRaw(key);
    setResult({ rec, items, answers: exam.answers });
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    if (result) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [result]);
  useEffect(() => {
    if (exam && !result && left <= 0) submit(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left <= 0, exam, result]);

  if (!exam) return (
    <div className="stack">
      <p className="notice">오답노트에 문항이 없어 오답 모의고사를 만들 수 없어요.</p>
      <Link className="btn" to="/computer/mock">모의고사 목록</Link>
    </div>
  );
  if (result) return <MockResult {...result} />;

  const q = items[exam.idx];
  const answeredN = Object.keys(exam.answers).length;
  const setAns = (i: number) => setExam((e) => (e ? { ...e, answers: { ...e.answers, [q.id]: i } } : e));
  const go = (idx: number) => setExam((e) => (e ? { ...e, idx } : e));
  return (
    <div className="stack" style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <div className="cg-exam-bar">
        <b>{MOCK_LABEL[kind]}</b>
        <span className={`cg-timer${left < 300 ? ' warn' : ''}`} role="timer" aria-live="off">남은 시간 {mmss(Math.max(0, left))}</span>
        <span className="small">{answeredN}/{items.length} 답함</span>
        <button className="btn btn-small btn-primary" onClick={() => setConfirm(true)}>제출</button>
      </div>
      {confirm && (
        <div className="notice notice-warn row" role="alert">
          <span>{answeredN < items.length ? `아직 ${items.length - answeredN}문항을 안 풀었어요. ` : ''}제출하면 바로 채점해요. 제출할까요?</span>
          <button className="btn btn-small btn-primary" onClick={() => submit(false)}>제출하기</button>
          <button className="btn btn-small btn-quiet" onClick={() => setConfirm(false)}>계속 풀기</button>
        </div>
      )}
      <div className="panel stack">
        <p className="small muted" style={{ margin: 0 }}>{exam.idx + 1}번 · {CG_AREA_LABEL[q.area]}</p>
        <h2 className="cg-q" style={{ margin: 0 }}>{exam.idx + 1}. {q.question}</h2>
        {q.extra && <pre className="codeblock">{q.extra}</pre>}
        <fieldset>
          <legend className="sr-only">보기</legend>
          <div className="options">
            {q.options.map((o, i) => (
              <label key={i} className="option">
                <input type="radio" name={`mock-${q.id}`} checked={exam.answers[q.id] === i} onChange={() => setAns(i)} />
                <span>{'①②③④⑤'[i]} {o}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="row">
          <button className="btn" disabled={exam.idx === 0} onClick={() => go(exam.idx - 1)}>이전</button>
          {exam.idx < items.length - 1 ? <button className="btn btn-primary" onClick={() => go(exam.idx + 1)}>다음</button> : <button className="btn btn-primary" onClick={() => setConfirm(true)}>제출</button>}
        </div>
      </div>
      <nav aria-label="문항 바로가기" className="cg-qgrid">
        {items.map((x, i) => (
          <button key={x.id} className={`${exam.answers[x.id] !== undefined ? 'done' : ''}${i === exam.idx ? ' cur' : ''}`} aria-current={i === exam.idx ? 'true' : undefined} aria-label={`${i + 1}번${exam.answers[x.id] !== undefined ? ' 답함' : ''}`} onClick={() => go(i)}>{i + 1}</button>
        ))}
      </nav>
      <p className="small muted">풀던 답은 이 기기에 저장돼요. 시간은 시작한 때부터 계속 흘러요. <button className="btn btn-small btn-quiet" onClick={() => { removeRaw(key); nav('/computer/mock'); }}>그만두기(기록 없이 나가기)</button></p>
    </div>
  );
}

function MockResult({ rec, items, answers }: { rec: MockRecord; items: CgMcq[]; answers: Record<string, number> }) {
  const pass = rec.total === CG_PASS.mock.total && rec.score >= CG_PASS.mock.need;
  const wrong = items.filter((q) => answers[q.id] !== q.answer);
  return (
    <div className="stack" style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <h1 style={{ margin: 0 }}>{MOCK_LABEL[rec.kind]} 결과</h1>
      <div className={`notice ${pass ? 'notice-good' : 'notice-warn'}`}>
        <b style={{ fontSize: '1.3rem' }}>{rec.score} / {rec.total}</b>{' '}
        {rec.total === CG_PASS.mock.total ? (pass ? `합격 기준(${CG_PASS.mock.need}문항) 이상이에요!` : `합격 기준까지 ${CG_PASS.mock.need - rec.score}문항 남았어요.`) : ''}
        {' '}· 걸린 시간 {mmss(rec.seconds)}{rec.timeUp ? ' (시간 종료로 자동 제출)' : ''}
        {isRegularMock(rec.kind) && pass && <span> · 정규 모의고사 기준을 넘어 열매 조건을 채웠어요.</span>}
      </div>
      <div className="cg-result-cols">
        <div className="panel">
          <h2>단원별 정답률</h2>
          <table className="data"><tbody>
            {CG_UNIT_IDS.filter((u) => rec.perUnit[u]).map((u) => {
              const [c, t] = rec.perUnit[u]!;
              return <tr key={u}><th scope="row">{u.replace('U', '')}단원 {CG_UNIT_BY_ID[u]?.title}</th><td>{c}/{t}</td><td><Bar v={pct(c, t)} /></td></tr>;
            })}
          </tbody></table>
        </div>
        <div className="panel">
          <h2>영역별 정답률</h2>
          <table className="data"><tbody>
            {CG_AREAS.filter((a) => rec.perArea[a]).map((a) => {
              const [c, t] = rec.perArea[a]!;
              return <tr key={a}><th scope="row">{CG_AREA_LABEL[a]}</th><td>{c}/{t}</td><td><Bar v={pct(c, t)} /></td></tr>;
            })}
          </tbody></table>
        </div>
      </div>
      <section className="stack">
        <h2 style={{ margin: 0 }}>틀린 문항 {wrong.length}개 (오답노트에 저장됨)</h2>
        {wrong.map((q) => (
          <details key={q.id} className="panel">
            <summary>{items.indexOf(q) + 1}. {q.question}</summary>
            <p className="small" style={{ marginTop: '0.5rem' }}>
              고른 답: {answers[q.id] !== undefined ? `${'①②③④'[answers[q.id]]} ${q.options[answers[q.id]]}` : '(안 풂)'}<br />
              <b>정답: {'①②③④'[q.answer]} {q.options[q.answer]}</b>
            </p>
            <p className="small" style={{ margin: 0 }}>{q.explanation}</p>
          </details>
        ))}
      </section>
      <div className="row">
        <Link className="btn btn-primary" to="/computer/mock">모의고사 목록</Link>
        <Link className="btn" to="/computer/wrong">오답노트</Link>
      </div>
    </div>
  );
}

function Bar({ v }: { v: number }) {
  return <span className="cg-bar" aria-label={`${v}%`}><span style={{ width: `${v}%` }} /><em>{v}%</em></span>;
}
