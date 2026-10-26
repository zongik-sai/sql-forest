import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { UNIT_BY_ID } from '../../content';
import { UNIT_STAGES, quizNeed, type PracticeItem, type StageCard } from '../../content/stages';
import type { UnitId } from '../../content/types';
import { useLearner } from '../../app/LearnerContext';
import { useLiveDetail } from '../monitor/liveStore';
import { CardMatch } from '../../components/CardMatch';
import { DataPanel } from '../../components/DataPanel';
import { InfoTable } from '../../components/InfoTable';
import { ResultTable, SqlErrorView } from '../../components/common';
import { learnerPrefix } from '../../lib/storage';
import type { SqlError } from '../../sql/engine';
import type { ResultSet } from '../../sql/grader/compare';
import { outcomeMessage, sqlClient } from '../../sql/worker/sqlClient';
import { McqRunner, ReviewCard, type McqResult } from '../computer/McqRunner';
import { useFocusGate } from '../focus/FocusContext';
import { StageStatus } from './StageStatus';
import {
  isUnitUnlocked, markStageItem, recordStageQuiz, STAGE_NAME, stageItemDone, stageOpen, stagePassed, type StageNo,
} from '../progress/model';

/**
 * 데이터베이스 단원 단계(2026-10-15 구조 개편)
 * 1 이론·개념 맞추기 → 2 개념 점검 문제 → 3 실습 설명·실습 맞추기 → 4 실습 점검 문제(기존 활동 4개 + 체크포인트)
 * 앞 단계를 통과하면 다음 단계가 열리고, 잠겨 있어도 "그래도 풀어보기"로 들어갈 수 있다(컴퓨터 일반과 같은 방식).
 */
const isUnitId = (u: string | undefined): u is UnitId => !!u && u in UNIT_BY_ID;

export function StageCrumbs({ unitId, here }: { unitId: UnitId; here?: string }) {
  const u = UNIT_BY_ID[unitId];
  return (
    <nav className="crumbs" aria-label="위치">
      <Link to="/garden">나의 정원</Link> / <Link to={`/learn/${unitId}`}>{u.id} {u.title}</Link>
      {here ? ` / ${here}` : ''}
    </nav>
  );
}

/** 잠긴 단계: 앞 단계로 가거나 그래도 풀어보기 */
export function StageLock({ unitId, n, onForce }: { unitId: UnitId; n: StageNo; onForce: () => void }) {
  return (
    <div className="panel stack">
      <p style={{ margin: 0 }}>앞 단계 <b>{n - 1}단계 {STAGE_NAME[(n - 1) as StageNo]}</b>를 통과하면 열려요.</p>
      <div className="row">
        <Link className="btn btn-primary" to={`/learn/${unitId}/stage/${n - 1}`}>앞 단계로</Link>
        <button className="btn" onClick={onForce}>그래도 풀어보기</button>
      </div>
    </div>
  );
}

function NextStage({ unitId, n }: { unitId: UnitId; n: 1 | 2 | 3 }) {
  const nav = useNavigate();
  return (
    <div className="row">
      <button className="btn btn-primary btn-grow" onClick={() => nav(n < 3 ? `/learn/${unitId}/stage/${n + 1}` : `/learn/${unitId}`)}>
        다음 단계: {STAGE_NAME[(n + 1) as StageNo]}
      </button>
      <Link className="btn btn-quiet" to={`/learn/${unitId}`}>단원 보기</Link>
    </div>
  );
}

export function StagePage() {
  const { unitId, stage } = useParams();
  // 단원·단계가 바뀌면 화면 상태(보던 카드·풀던 문항·그래도 풀어보기)를 새로
  return <StagePageInner key={`${unitId}:${stage}`} />;
}

function StagePageInner() {
  const { unitId, stage } = useParams();
  const { state } = useLearner();
  const n = Number(stage) as StageNo;
  const [force, setForce] = useState(false);
  if (!isUnitId(unitId) || ![1, 2, 3].includes(n)) return <Navigate to={isUnitId(unitId) ? `/learn/${unitId}` : '/garden'} replace />;
  if (!isUnitUnlocked(state, unitId)) return <Navigate to="/garden" replace />;
  const open = stageOpen(state, unitId, n);
  return (
    <div className="page stack" style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="learn-head">
        <StageCrumbs unitId={unitId} here={`${n}단계`} />
        <StageStatus unitId={unitId} n={n} />
      </div>
      <h1 style={{ margin: 0, fontSize: '1.5rem' }}>{n}단계 {STAGE_NAME[n]}</h1>
      {!open && !force ? <StageLock unitId={unitId} n={n} onForce={() => setForce(true)} /> :
        n === 1 ? <TheoryStage u={unitId} /> : n === 2 ? <QuizStage u={unitId} /> : <PracticeStage u={unitId} />}
    </div>
  );
}

/* ---------------- 1단계: 이론 카드 → 개념 맞추기 ---------------- */
function CardView({ c, n }: { c: StageCard; n: number }) {
  return (
    <>
      <h2 id={`card-${c.id}`} style={{ margin: 0 }}>
        <span className="cg-card-no">{String(n).padStart(2, '0')}</span> {c.title}
      </h2>
      <ul className="cg-points">{c.points.map((p, k) => <li key={k}>{p}</li>)}</ul>
      {c.table && <InfoTable t={c.table} />}
      {c.tip && <p className="cg-tip">💡 {c.tip}</p>}
    </>
  );
}

/** 카드·예제를 한 장씩 넘기는 공통 틀(번호 버튼·완료 표시·다음 항목 안내) */
function useStepper(ids: string[]) {
  const { state } = useLearner();
  const firstTodo = () => Math.max(0, ids.findIndex((id) => !stageItemDone(state, id)));
  const [idx, setIdx] = useState(firstTodo);
  const [phase, setPhase] = useState<'read' | 'match'>('read');
  const [round, setRound] = useState(0);
  const [justDone, setJustDone] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (justDone) doneRef.current?.scrollIntoView({ block: 'nearest' });
  }, [justDone]);
  const go = (i: number) => {
    setIdx(i);
    setPhase('read');
    setJustDone(false);
    setRound((r) => r + 1);
    top.current?.scrollIntoView({ block: 'start' });
  };
  const startMatch = () => {
    setPhase('match');
    requestAnimationFrame(() => top.current?.scrollIntoView({ block: 'start' }));
  };
  const isDone = (id: string) => stageItemDone(state, id);
  const nextTodo = () => {
    const after = [...ids.slice(idx + 1), ...ids.slice(0, idx)].find((x) => !isDone(x));
    return after ? ids.indexOf(after) : -1;
  };
  return { idx, phase, round, justDone, setJustDone, top, doneRef, go, startMatch, isDone, nextTodo, doneN: ids.filter(isDone).length };
}

function StepNav({ ids, idx, isDone, go, doneN, word }: { ids: string[]; idx: number; isDone: (id: string) => boolean; go: (i: number) => void; doneN: number; word: string }) {
  useLiveDetail(ids.length ? `${word} ${idx + 1}/${ids.length}` : null); // 선생님 화면 실시간 학습 위치
  return (
    <div className="cg-card-nav" role="group" aria-label={`${word} 고르기`}>
      {ids.map((id, i) => (
        <button key={id} type="button" className={`cg-card-dot${i === idx ? ' cur' : ''}${isDone(id) ? ' done' : ''}`} aria-current={i === idx ? 'step' : undefined} aria-label={`${i + 1}번 ${word}${isDone(id) ? ' (맞추기 완료)' : ''}`} onClick={() => go(i)}>
          {isDone(id) ? '✓' : i + 1}
        </button>
      ))}
      <span className="small muted">맞춘 {word} {doneN}/{ids.length}</span>
    </div>
  );
}

function TheoryStage({ u }: { u: UnitId }) {
  const L = useLearner();
  const cards = UNIT_STAGES[u].cards;
  const ids = useMemo(() => cards.map((c) => c.id), [cards]);
  const st = useStepper(ids);
  const c = cards[st.idx];
  const passed = stagePassed(L.state, u, 1);
  const cardDone = st.isDone(c.id);
  const finish = () => {
    void L.commit((s) => markStageItem(s, u, 1, c.id).state);
    st.setJustDone(true);
  };
  const nt = st.nextTodo();
  return (
    <div className="stack" ref={st.top} style={{ scrollMarginTop: '4.5rem' }}>
      <p className="muted" style={{ margin: 0 }}>이론 카드를 한 장씩 읽고, 바로 아래 개념 맞추기를 모두 맞히면 다음 카드로 넘어가요. {cards.length}장을 모두 마치면 1단계 통과예요.</p>
      <StepNav ids={ids} idx={st.idx} isDone={st.isDone} go={st.go} doneN={st.doneN} word="카드" />
      {st.phase === 'read' ? (
        <article className="panel stack cg-card" aria-labelledby={`card-${c.id}`}>
          <CardView c={c} n={st.idx + 1} />
          <div className="row">
            <button className="btn btn-primary" onClick={st.startMatch}>{cardDone ? '개념 맞추기 다시 하기' : '다 읽었어요 → 개념 맞추기'}</button>
            {cardDone && <span className="badge badge-exec">맞추기 완료</span>}
            {cardDone && st.idx < cards.length - 1 && <button className="btn" onClick={() => st.go(st.idx + 1)}>다음 카드 →</button>}
          </div>
        </article>
      ) : (
        <>
          <details className="panel cg-card-peek">
            <summary>{String(st.idx + 1).padStart(2, '0')} {c.title} — 카드 다시 보기</summary>
            <div className="stack" style={{ marginTop: '0.5rem' }}><CardView c={c} n={st.idx + 1} /></div>
          </details>
          <CardMatch key={`${c.id}:${st.round}`} id={c.id} match={c.match} onDone={finish} />
        </>
      )}
      {st.justDone && (
        <div ref={st.doneRef} className="notice notice-good stack" aria-live="polite" style={{ margin: 0 }}>
          {passed && nt < 0 ? (
            <><b>카드 {cards.length}장을 모두 마쳤어요. 1단계 통과!</b><NextStage unitId={u} n={1} /></>
          ) : (
            <>
              <b>{st.idx + 1}번 카드 완료! ({st.doneN}/{cards.length})</b>
              {nt >= 0 && <div className="row"><button className="btn btn-primary" onClick={() => st.go(nt)}>{nt === st.idx + 1 ? '다음 카드 →' : `${nt + 1}번 카드로 →`}</button></div>}
            </>
          )}
        </div>
      )}
      {passed && !st.justDone && <><p className="notice notice-good" style={{ margin: 0 }}>1단계를 통과했어요. 카드를 다시 보거나 개념 맞추기를 복습할 수 있어요.</p><NextStage unitId={u} n={1} /></>}
    </div>
  );
}

/* ---------------- 2단계: 개념 점검 문제 ---------------- */
function QuizStage({ u }: { u: UnitId }) {
  const L = useLearner();
  const prefix = learnerPrefix(L.identity.learnerKey);
  const all = UNIT_STAGES[u].quiz;
  const need = quizNeed(all.length);
  const [items, setItems] = useState(all);
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
            passed ? '통과! 다음 단계가 열렸어요.' : `통과 기준은 ${need}개예요. 틀린 문항의 해설을 읽고 다시 풀어 보세요.`}
        </div>
        <div className="row">
          {wrong.length > 0 && <button className="btn btn-primary" onClick={() => { setItems(wrong); setResult(null); setRound((r) => r + 1); }}>틀린 {wrong.length}문항만 다시</button>}
          <button className="btn" onClick={() => { setItems(all); setResult(null); setRound((r) => r + 1); }}>처음부터 다시</button>
          <Link className="btn btn-quiet" to={`/learn/${u}/stage/1`}>이론 카드 다시 보기</Link>
        </div>
        {(passed || stagePassed(L.state, u, 2)) && <NextStage unitId={u} n={2} />}
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
        {full ? `이론에서 배운 개념을 ${all.length}문항으로 점검해요. 한 문제씩 풀고 바로 채점해요. ${need}개 이상 맞히면 통과예요.` : `틀린 ${items.length}문항을 다시 풀어요(연습).`}
      </p>
      <McqRunner
        key={round}
        items={items}
        storageKey={`${prefix}db:quiz:${u}${full ? '' : ':retry'}`}
        onAnswer={() => {}}
        onFinish={(r) => {
          if (full) void L.commit((s) => recordStageQuiz(s, u, r.score, r.total).state, { immediate: true });
          setResult({ ...r, full });
          window.scrollTo(0, 0);
        }}
      />
    </div>
  );
}

/* ---------------- 3단계: 실습 설명 → 실습 맞추기 ---------------- */
const ALL_TYPES = ['select', 'insert', 'update', 'delete', 'create', 'drop', 'alter', 'tcl'] as const;

function PracticeRun({ p }: { p: PracticeItem }) {
  const gate = useFocusGate();
  const [res, setRes] = useState<ResultSet | null>(null);
  const [err, setErr] = useState<SqlError | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!gate.canAct()) return;
    setBusy(true);
    setMsg(null);
    const o = await sqlClient().run(p.dataset, p.sql, [...ALL_TYPES]);
    setBusy(false);
    if (o.status === 'stale') return;
    if (o.status !== 'ok') return setMsg(outcomeMessage(o));
    if (!o.data.ok) {
      setErr(o.data.error);
      setRes(null);
    } else {
      setErr(null);
      setRes(o.data.last ?? { columns: [], rows: [] });
    }
  };
  return (
    <div className="stack" style={{ gap: '0.5rem' }}>
      <pre className="codeblock">{p.sql}</pre>
      {p.run ? (
        <div className="row">
          <button className="btn btn-primary btn-small" onClick={() => void run()} disabled={busy || !gate.active}>{busy ? '실행 중…' : res ? '다시 실행' : '실행해 보기'}</button>
          <span className="small muted">처음 상태의 데이터로 실행해요(바꿔도 저장되지 않아요).</span>
        </div>
      ) : (
        <p className="notice small" style={{ margin: 0 }}>시험에 나오는 문법이에요. 이 사이트의 SQLite에서는 실행되지 않아요(문법 비교).</p>
      )}
      {msg && <p className="notice notice-warn">{msg}</p>}
      {err && <SqlErrorView error={err} />}
      {res && <ResultTable result={res} caption="실행 결과" />}
    </div>
  );
}

function PracticeView({ p, n }: { p: PracticeItem; n: number }) {
  return (
    <>
      <h2 id={`card-${p.id}`} style={{ margin: 0 }}>
        <span className="cg-card-no">{String(n).padStart(2, '0')}</span> {p.title}{' '}
        <span className={`badge ${p.run ? 'badge-exec' : 'badge-dialect'}`}>{p.run ? '실제 실행' : '문법 비교'}</span>
      </h2>
      <p style={{ margin: 0 }}><b>목표</b> {p.goal}</p>
      <PracticeRun p={p} />
      <div>
        <p className="step-label" style={{ margin: '0 0 0.3rem' }}>SQL 읽는 순서</p>
        <ol className="cg-points" style={{ listStyle: 'decimal' }}>{p.steps.map((s, k) => <li key={k}>{s}</li>)}</ol>
      </div>
      <DataPanel dataset={p.dataset} />
    </>
  );
}

function PracticeStage({ u }: { u: UnitId }) {
  const L = useLearner();
  const items = UNIT_STAGES[u].practice;
  const ids = useMemo(() => items.map((p) => p.id), [items]);
  const st = useStepper(ids);
  const p = items[st.idx];
  const passed = stagePassed(L.state, u, 3);
  const done = st.isDone(p.id);
  const finish = () => {
    void L.commit((s) => markStageItem(s, u, 3, p.id).state);
    st.setJustDone(true);
  };
  const nt = st.nextTodo();
  return (
    <div className="stack" ref={st.top} style={{ scrollMarginTop: '4.5rem' }}>
      <p className="muted" style={{ margin: 0 }}>예제 SQL을 실행해 보며 설명을 읽고, 실습 맞추기(SQL 조각 ↔ 역할)를 모두 맞히면 다음 예제로 넘어가요. {items.length}개를 모두 마치면 3단계 통과, 이어서 4단계 실습 점검 문제로 가요.</p>
      <StepNav ids={ids} idx={st.idx} isDone={st.isDone} go={st.go} doneN={st.doneN} word="예제" />
      {st.phase === 'read' ? (
        <article className="panel stack cg-card" aria-labelledby={`card-${p.id}`}>
          <PracticeView p={p} n={st.idx + 1} />
          <div className="row">
            <button className="btn btn-primary" onClick={st.startMatch}>{done ? '실습 맞추기 다시 하기' : '다 읽었어요 → 실습 맞추기'}</button>
            {done && <span className="badge badge-exec">맞추기 완료</span>}
            {done && st.idx < items.length - 1 && <button className="btn" onClick={() => st.go(st.idx + 1)}>다음 예제 →</button>}
          </div>
        </article>
      ) : (
        <>
          <details className="panel cg-card-peek">
            <summary>{String(st.idx + 1).padStart(2, '0')} {p.title} — 예제 다시 보기</summary>
            <div className="stack" style={{ marginTop: '0.5rem' }}><PracticeView p={p} n={st.idx + 1} /></div>
          </details>
          <CardMatch
            key={`${p.id}:${st.round}`}
            id={p.id}
            match={p.match}
            onDone={finish}
            title="실습 맞추기"
            help="SQL 조각마다 하는 일을 골라 짝지으세요. 조각 4개 중 1개는 헷갈리게 넣은 함정이에요."
          />
        </>
      )}
      {st.justDone && (
        <div ref={st.doneRef} className="notice notice-good stack" aria-live="polite" style={{ margin: 0 }}>
          {passed && nt < 0 ? (
            <><b>예제 {items.length}개를 모두 마쳤어요. 3단계 통과!</b><NextStage unitId={u} n={3} /></>
          ) : (
            <>
              <b>{st.idx + 1}번 예제 완료! ({st.doneN}/{items.length})</b>
              {nt >= 0 && <div className="row"><button className="btn btn-primary" onClick={() => st.go(nt)}>{nt === st.idx + 1 ? '다음 예제 →' : `${nt + 1}번 예제로 →`}</button></div>}
            </>
          )}
        </div>
      )}
      {passed && !st.justDone && <><p className="notice notice-good" style={{ margin: 0 }}>3단계를 통과했어요. 이제 4단계 실습 점검 문제(실습 활동 4개 + 체크포인트)를 풀어 보세요.</p><NextStage unitId={u} n={3} /></>}
    </div>
  );
}
