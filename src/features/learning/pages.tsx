import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ACTIVITY_BY_ID, CHALLENGE_BY_ID, QUESTION_BY_ID, UNIT_BY_ID, VARIANT_OF, activitiesOf, challengeOf, checkpointsOf, nextUnit } from '../../content';
import type { Question, UnitId } from '../../content/types';
import { useLearner, xpGained } from '../../app/LearnerContext';
import { ModeBadge } from '../../components/common';
import { useFocusGate } from '../focus/FocusContext';
import {
  answerQuestion, checkpointSolved, isActivityComplete, isUnitComplete, isUnitUnlocked, revealQuestion, unitCheckpointScore, unitStatus,
  type LearnerState,
} from '../progress/model';
import { ActivityRunner } from './ActivityRunner';
import { QuestionCard, type Graded } from './QuestionCard';

const isUnitId = (u: string | undefined): u is UnitId => !!u && u in UNIT_BY_ID;

function Crumbs({ unitId, here }: { unitId: UnitId; here?: string }) {
  const u = UNIT_BY_ID[unitId];
  return (
    <nav className="crumbs" aria-label="위치">
      <Link to="/garden">나의 정원</Link> / <Link to={`/learn/${unitId}`}>{u.id} {u.title}</Link>
      {here ? ` / ${here}` : ''}
    </nav>
  );
}

function LockedNotice() {
  return (
    <div className="page page-narrow">
      <div className="notice notice-warn">
        <p>아직 열리지 않은 단원이에요. 이전 단원의 활동 4개와 체크포인트 2문항 이상을 마치면 열려요.</p>
        <Link className="btn" to="/garden">나의 정원으로</Link>
      </div>
    </div>
  );
}

/* ---------------- 단원 ---------------- */
export function UnitPage() {
  const { unitId } = useParams();
  const { state } = useLearner();
  if (!isUnitId(unitId)) return <Navigate to="/garden" replace />;
  if (!isUnitUnlocked(state, unitId)) return <LockedNotice />;
  const u = UNIT_BY_ID[unitId];
  const acts = activitiesOf(unitId);
  const ch = challengeOf(unitId);
  const score = unitCheckpointScore(state, unitId);
  const st = unitStatus(state, unitId);
  const nu = nextUnit(unitId);
  return (
    <div className="page page-narrow stack">
      <Crumbs unitId={unitId} />
      <div>
        <h1>{u.id} {u.title}</h1>
        <p>{u.intro}</p>
        <p className="small muted">예상 {u.minutes}분{u.extraNote ? ` (${u.extraNote})` : ''} · 핵심 개념: {u.concepts.join(', ')}</p>
      </div>
      <ul className="unit-acts">
        {acts.map((a, i) => {
          const p = state.activities[a.id];
          return (
            <li key={a.id}>
              <Link to={`/learn/${unitId}/${a.id}`}>
                <span><b>활동 {i + 1}.</b> {a.title} <ModeBadge mode={a.mode} /></span>
                <span className={p?.completedAt ? 'status-done' : 'muted small'}>{p?.completedAt ? (p.completionKind === 'guided' ? '안내 학습 완료' : '완료') : p?.attempts ? '진행 중' : `약 ${a.estimatedMinutes}분`}</span>
              </Link>
            </li>
          );
        })}
        <li>
          <Link to={`/learn/${unitId}/checkpoint`}>
            <span><b>체크포인트</b> 3문항 (2문항 이상 맞히면 단원 완료)</span>
            <span className={score >= 2 ? 'status-done' : 'muted small'}>{score}/3 해결</span>
          </Link>
        </li>
      </ul>
      {(st === 'complete' || st === 'review') && (
        <div className="notice notice-good row" style={{ justifyContent: 'space-between' }}>
          <span>단원 완료! 배지: {u.badgeName}{score < 3 ? ` · 남은 체크포인트 ${3 - score}문항은 숲 완성에 필요해요.` : ''}</span>
          {nu ? <Link className="btn btn-grow" to={`/learn/${nu}`}>다음 단원 {nu}</Link> : <Link className="btn btn-grow" to="/final">최종 진단</Link>}
        </div>
      )}
      {ch && (
        <div className="panel">
          <h2 style={{ fontSize: '1.05rem' }}>도전 모드 (선택 복습)</h2>
          <p className="small">같은 목표의 변형 문제를 설명·힌트 없이 풀어 봐요. 경험치는 늘지 않고 숙련 기록과 배지만 남아요. 언제든 기본 모드로 돌아올 수 있어요.</p>
          <Link className="btn" to={`/challenge/${ch.id}`}>{ch.activity.title}{state.challenges[ch.id] ? ` (${state.challenges[ch.id].status === 'solved' ? '스스로 해결' : '배움'})` : ''}</Link>
        </div>
      )}
    </div>
  );
}

/* ---------------- 활동 ---------------- */
export function ActivityPage() {
  const { unitId, activityId } = useParams();
  const { state } = useLearner();
  const nav = useNavigate();
  if (!isUnitId(unitId) || !activityId || !ACTIVITY_BY_ID[activityId] || ACTIVITY_BY_ID[activityId].unitId !== unitId) return <Navigate to="/garden" replace />;
  if (!isUnitUnlocked(state, unitId)) return <LockedNotice />;
  const a = ACTIVITY_BY_ID[activityId];
  const ids = UNIT_BY_ID[unitId].activityIds;
  const idx = ids.indexOf(activityId);
  const next = idx < ids.length - 1 ? `/learn/${unitId}/${ids[idx + 1]}` : `/learn/${unitId}/checkpoint`;
  return (
    <div className="page">
      <div className="learn-head">
        <Crumbs unitId={unitId} here={`활동 ${idx + 1}/4`} />
        <span className="small muted">단원 진도 {ids.filter((id) => isActivityComplete(state, id)).length}/4 · 체크포인트 {unitCheckpointScore(state, unitId)}/3</span>
      </div>
      <ActivityRunner key={a.id} activity={a} onNext={() => nav(next)} nextLabel={idx < ids.length - 1 ? '다음 활동' : '체크포인트로'} />
    </div>
  );
}

/* ---------------- 도전 ---------------- */
export function ChallengePage() {
  const { challengeId } = useParams();
  const { state } = useLearner();
  const ch = challengeId ? CHALLENGE_BY_ID[challengeId] : undefined;
  if (!ch) return <Navigate to="/garden" replace />;
  if (!isUnitUnlocked(state, ch.unitId)) return <LockedNotice />;
  return (
    <div className="page">
      <div className="learn-head">
        <Crumbs unitId={ch.unitId} here="도전 모드" />
        <span className="badge badge-plain">선택 복습 · 경험치 없음</span>
      </div>
      <ActivityRunner key={ch.id} activity={ch.activity} challenge />
    </div>
  );
}

/* ---------------- 체크포인트 ---------------- */

/** 지금 보여줄 문항: 원문 또는 변형. 정답을 본 문항 대신 대응 문항을 풀어야 한다. */
export function currentItem(s: LearnerState, originalId: string): { q: Question; canReveal: boolean } {
  const o = QUESTION_BY_ID[originalId];
  const v = VARIANT_OF[originalId];
  const po = s.questions[o.id];
  const pv = s.questions[v.id];
  if (po?.revealed) return { q: v, canReveal: false };
  if (pv?.revealed) return { q: o, canReveal: false };
  if (checkpointSolved(s, originalId)) return { q: pv?.correct ? v : o, canReveal: true };
  return (po?.wrongCount ?? 0) > (pv?.wrongCount ?? 0) ? { q: v, canReveal: true } : { q: o, canReveal: true };
}

function CheckpointSlot({ originalId, index }: { originalId: string; index: number }) {
  const { state, commit } = useLearner();
  const gate = useFocusGate();
  const solved = checkpointSolved(state, originalId);
  const { q, canReveal } = currentItem(state, originalId);
  const [phase, setPhase] = useState<'answer' | 'wrong' | 'right'>('answer');
  const [msg, setMsg] = useState('');
  const [confirm, setConfirm] = useState(false);
  const revealed = state.questions[q.id]?.revealed;

  const onGraded = async (g: Graded) => {
    if (!gate.canAct()) return;
    const results = await commit((s) => answerQuestion(s, q.id, g.answer, g.correct), { immediate: true });
    if (g.correct) {
      const xp = xpGained(results, 'checkpoint:') + xpGained(results, 'unit:');
      setPhase('right');
      setMsg(`정답이에요. ${q.explanation}${xp ? ` +${xp}XP` : ''}`);
    } else {
      setPhase('wrong');
      setMsg(g.message);
    }
  };

  return (
    <section className="panel stack" aria-labelledby={`cp-${originalId}`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 id={`cp-${originalId}`} style={{ fontSize: '1.05rem', margin: 0 }}>문항 {index + 1}{q.set === 'variant' ? ' (재도전 문항)' : ''}</h2>
        {solved && <span className="status-done">해결</span>}
      </div>
      {solved && phase !== 'right' ? (
        <p className="small muted" style={{ margin: 0 }}>이미 해결한 문항이에요. {QUESTION_BY_ID[originalId].explanation}</p>
      ) : phase === 'wrong' ? (
        <div className="stack" aria-live="polite">
          <p className="notice notice-warn" style={{ margin: 0 }}>결과가 조금 달라요. {msg}</p>
          <div className="notice">
            <b className="small">짧은 개념 복습</b>
            <p style={{ margin: '0.25rem 0 0' }}>{q.review}</p>
          </div>
          <div className="row">
            <button className="btn btn-primary" onClick={() => setPhase('answer')}>다시 도전 (비슷한 문항)</button>
          </div>
        </div>
      ) : phase === 'right' ? (
        <p className="notice notice-good" aria-live="polite" style={{ margin: 0 }}>{msg}</p>
      ) : (
        <>
          <QuestionCard key={q.id} q={q} onGraded={(g) => void onGraded(g)} />
          {revealed ? (
            <div className="notice"><b className="small">해설</b><p style={{ margin: 0 }}>{q.explanation}</p></div>
          ) : canReveal ? (
            confirm ? (
              <div className="row">
                <span className="small">정답을 보면 이 문항 대신 비슷한 재도전 문항을 풀어야 해결로 인정돼요.</span>
                <button className="btn btn-small" onClick={() => { setConfirm(false); void commit((s) => revealQuestion(s, q.id), { immediate: true }); }}>정답 보기</button>
                <button className="btn btn-small btn-quiet" onClick={() => setConfirm(false)}>취소</button>
              </div>
            ) : (
              <button className="btn btn-quiet" style={{ justifySelf: 'start' }} onClick={() => setConfirm(true)}>정답 보기</button>
            )
          ) : (
            <p className="small muted">앞 문항의 정답을 봤기 때문에 이 재도전 문항은 스스로 풀어야 해결로 인정돼요. 개념 복습: {q.review}</p>
          )}
        </>
      )}
    </section>
  );
}

export function CheckpointPage() {
  const { unitId } = useParams();
  const { state } = useLearner();
  if (!isUnitId(unitId)) return <Navigate to="/garden" replace />;
  if (!isUnitUnlocked(state, unitId)) return <LockedNotice />;
  const u = UNIT_BY_ID[unitId];
  const actsDone = u.activityIds.filter((a) => isActivityComplete(state, a)).length;
  const score = unitCheckpointScore(state, unitId);
  const nu = nextUnit(unitId);
  return (
    <div className="page page-narrow stack">
      <Crumbs unitId={unitId} here="체크포인트" />
      <h1>{u.id} 체크포인트</h1>
      <p className="muted">시간·횟수 제한은 없어요. 2문항 이상 맞히고 활동 4개를 마치면 단원이 완료되고 다음 단원이 열려요. 숲을 완성하려면 결국 3문항 모두 해결해야 해요.</p>
      {actsDone < 4 && <p className="notice">활동 {actsDone}/4 완료. 체크포인트는 먼저 풀어도 되지만, 단원 완료에는 활동 4개가 모두 필요해요.</p>}
      {checkpointsOf(unitId).map((q, i) => <CheckpointSlot key={q.id} originalId={q.id} index={i} />)}
      <div className="row">
        <span className="small">해결 {score}/3</span>
        {isUnitComplete(state, unitId) && (nu ? <Link className="btn btn-grow" to={`/learn/${nu}`}>다음 단원 {nu}</Link> : <Link className="btn btn-grow" to="/final">최종 진단으로</Link>)}
        <Link className="btn" to={`/learn/${unitId}`}>단원으로</Link>
      </div>
    </div>
  );
}
