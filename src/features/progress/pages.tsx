import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ACTIVITY_BY_ID, CHECKPOINTS, FINAL_DIAGNOSTIC, PRE_DIAGNOSTIC, QUESTION_BY_ID, UNITS, UNIT_BY_ID } from '../../content';
import type { QuestionArea } from '../../content/types';
import { useLearner, xpGained } from '../../app/LearnerContext';
import { Garden } from '../../components/Garden';
import { ChoiceGroup, formatDuration } from '../../components/common';
import { displayXp, stageOf, xpToNextLevel } from '../growth/levels';
import { QuestionCard } from '../learning/QuestionCard';
import { useFocusGate } from '../focus/FocusContext';
import {
  allUnitsComplete, answerQuestion, checkpointSolved, courseComplete, finalComplete, finalUnlocked, isActivityComplete, isUnitComplete,
  nextStep, unitCheckpointScore, unitStatus, unsolvedCheckpoints, viewExplanation,
} from './model';
import { BADGES } from './rewards';
import { buildReport, downloadText, reportCsv } from './report';

const STATUS_LABEL = { locked: '잠김', ready: '시작 가능', 'in-progress': '진행 중', complete: '완료', review: '완료 · 복습 남음' } as const;

export function Dashboard() {
  const L = useLearner();
  const { state, totalXp, level } = L;
  const nav = useNavigate();
  const stage = stageOf(level);
  const next = xpToNextLevel(totalXp);
  const doneActs = Object.values(state.activities).filter((a) => a.completedAt && ACTIVITY_BY_ID[a.activityId]).length;
  const solvedCps = CHECKPOINTS.filter((q) => checkpointSolved(state, q.id)).length;
  const progressPct = Math.round(((doneActs + solvedCps) / (48 + 36)) * 100);
  const finalAnswered = FINAL_DIAGNOSTIC.filter((q) => state.questions[q.id]?.attempts);
  const finalCorrect = finalAnswered.filter((q) => state.questions[q.id]?.lastCorrect).length;
  const badges = UNITS.map((u) => !!L.ledger.badges[u.badgeId]);
  const nextPath = nextStep(state);
  const currentUnit = nextPath.startsWith('/learn/') ? nextPath.split('/')[2] : null;

  return (
    <div className="page stack" style={{ gap: '1.25rem' }}>
      <section className="garden-card" aria-labelledby="garden-h">
        <Garden level={level} unitBadges={badges} />
        <div className="stack">
          <h1 id="garden-h" className="sr-only">나의 정원</h1>
          <div className="level-line">
            <span className="level-num">Lv{level}</span>
            <span style={{ fontSize: '1.2rem', fontWeight: 700 }}>{stage.name}</span>
          </div>
          <p className="muted" style={{ margin: 0 }}>{stage.visual}</p>
          <div>
            <div className="xpbar" role="progressbar" aria-label="경험치" aria-valuemin={0} aria-valuemax={9900} aria-valuenow={displayXp(totalXp)}>
              <span style={{ width: `${(displayXp(totalXp) / 9900) * 100}%` }} />
            </div>
            <p className="small" style={{ margin: '0.3rem 0 0' }}>
              {displayXp(totalXp).toLocaleString()} / 9,900 XP · {next === null ? '성장 완료' : `다음 레벨까지 ${next} XP`}
              {L.pendingSync && <span className="badge badge-sim" style={{ marginLeft: '0.4rem' }}>동기화 대기</span>}
            </p>
          </div>
          <div className="row">
            <button className="btn btn-primary" onClick={() => nav(nextPath)}>계속 배우기</button>
            <Link className="btn" to="/review">오답 복습</Link>
            <Link className="btn" to="/practice">자유 실습장</Link>
            {finalComplete(state) && <Link className="btn" to="/report">학습 보고서</Link>}
          </div>
          <div className="kpis">
            <div className="kpi"><b>{progressPct}%</b><span>학습 진도 (활동 {doneActs}/48 · 체크포인트 {solvedCps}/36)</span></div>
            <div className="kpi"><b>{formatDuration(state.totalActiveSeconds)}</b><span>실제 활동 시간(가림·숨김 시간 제외)</span></div>
            <div className="kpi"><b>{finalAnswered.length ? `${finalCorrect}/${finalAnswered.length}` : '-'}</b><span>최종 진단 정답(레벨과 별개)</span></div>
          </div>
        </div>
      </section>

      <section aria-labelledby="trail-h" className="stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="trail-h" style={{ margin: 0 }}>단원길</h2>
          <span className="small muted">이미 연 단원은 자유롭게 오갈 수 있어요.</span>
        </div>
        <ol className="trail-list">
          {UNITS.map((u) => {
            const st = unitStatus(state, u.id);
            const inner = (
              <>
                <span className="dot" aria-hidden="true">{u.order}</span>
                <span>
                  <b>{u.title}</b>
                  <span className="st" style={{ display: 'block' }}>{STATUS_LABEL[st]} · 활동 {u.activityIds.filter((a) => isActivityComplete(state, a)).length}/4 · 체크 {unitCheckpointScore(state, u.id)}/3</span>
                </span>
              </>
            );
            return (
              <li key={u.id}>
                {st === 'locked' ? (
                  <div className={`stop ${st}`} aria-label={`${u.id} ${u.title}: 잠김`}>{inner}</div>
                ) : (
                  <Link className={`stop ${st}${currentUnit === u.id ? ' current' : ''}`} to={`/learn/${u.id}`} aria-current={currentUnit === u.id ? 'step' : undefined}>{inner}</Link>
                )}
              </li>
            );
          })}
          <li>
            {finalUnlocked(state) ? (
              <Link className={`stop ${finalComplete(state) ? 'complete' : 'ready'}`} to="/final"><span className="dot">F</span><span><b>최종 진단</b><span className="st" style={{ display: 'block' }}>12문항 · 결과표</span></span></Link>
            ) : (
              <div className="stop locked"><span className="dot">F</span><span><b>최종 진단</b><span className="st" style={{ display: 'block' }}>12단원 완료 후 열림</span></span></div>
            )}
          </li>
        </ol>
      </section>

      <section aria-labelledby="badge-h">
        <h2 id="badge-h">배지</h2>
        <ul className="row" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {BADGES.map((b) => (
            <li key={b.badgeId}>
              <span className={`badge ${L.ledger.badges[b.badgeId] ? 'badge-exec' : 'badge-plain'}`} title={b.description}>
                {L.ledger.badges[b.badgeId] ? '' : '미획득 · '}{b.name}
              </span>
            </li>
          ))}
        </ul>
        <p className="small muted">레벨99는 과정 전체를 경험했다는 뜻이에요. SQLD 합격이나 완전한 숙달을 보장하지 않아요.</p>
      </section>
    </div>
  );
}

/* ---------------- 최초 진단 ---------------- */
export function PrePage() {
  const { state, commit, remote } = useLearner();
  const nav = useNavigate();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  if (state.pre) {
    return (
      <div className="page page-narrow stack">
        <h1>최초 진단</h1>
        <p>{state.pre.status === 'skipped' ? '처음부터 배우기를 골랐어요.' : `5문항 중 ${state.pre.score}문항을 맞혔어요. 점수와 관계없이 모든 학생이 U01부터 시작해요.`}</p>
        <Link className="btn btn-primary" to="/garden">나의 정원으로</Link>
      </div>
    );
  }
  const done = PRE_DIAGNOSTIC.every((q) => answers[q.id] !== undefined);
  return (
    <div className="page page-narrow stack">
      <h1>최초 진단 (5문항)</h1>
      <p className="muted">지금 알고 있는 것을 가볍게 확인해요. 점수로 단원을 잠그지 않고 경험치도 주지 않아요. SQL이 처음이라면 바로 시작해도 돼요.</p>
      <div className="row">
        <button className="btn" onClick={async () => { await commit((s) => ({ ...s, pre: { status: 'skipped', answers: {}, score: 0 } }), { immediate: true }); nav('/learn/U01/U01-A01'); }}>처음부터 배우기</button>
      </div>
      {PRE_DIAGNOSTIC.map((q, i) => q.body.type === 'choice' && (
        <div className="panel" key={q.id}>
          <ChoiceGroup legend={`${i + 1}. ${q.prompt}`} options={q.body.options} value={answers[q.id] ?? null} onChange={(v) => setAnswers({ ...answers, [q.id]: v })} name={q.id} />
        </div>
      ))}
      <div className="row">
        <button className="btn btn-primary" disabled={!done} onClick={async () => {
          const score = PRE_DIAGNOSTIC.filter((q) => q.body.type === 'choice' && answers[q.id] === q.body.correctIndex).length;
          await commit((s) => ({ ...s, pre: { status: 'done', answers, score } }), { immediate: true });
          void remote?.submitAssessment('pre', answers, score);
          nav('/pre');
        }}>제출하고 결과 보기</button>
      </div>
    </div>
  );
}

/* ---------------- 최종 진단 ---------------- */
export function FinalPage() {
  const { state, commit, remote } = useLearner();
  const gate = useFocusGate();
  const nav = useNavigate();
  if (!finalUnlocked(state)) {
    return (
      <div className="page page-narrow">
        <p className="notice">최종 진단은 12개 단원을 모두 완료하면 열려요.</p>
        <Link className="btn" to="/garden">나의 정원으로</Link>
      </div>
    );
  }
  const idx = FINAL_DIAGNOSTIC.findIndex((q) => !state.questions[q.id]?.explanationViewed);
  if (idx < 0) {
    return (
      <div className="page page-narrow stack">
        <h1>최종 진단 완료</h1>
        <p>12문항을 모두 마쳤어요. 결과표에서 영역별 성취와 보완할 개념을 확인하세요.</p>
        <Link className="btn btn-primary" to="/report">학습 보고서 보기</Link>
      </div>
    );
  }
  const q = FINAL_DIAGNOSTIC[idx];
  const qp = state.questions[q.id];
  const answered = !!qp?.attempts;
  return (
    <div className="page page-narrow stack">
      <p className="crumbs"><Link to="/garden">나의 정원</Link> / 최종 진단 {idx + 1}/12</p>
      <h1>최종 진단</h1>
      <p className="small muted">자체 제작 12문항이에요. 공식 모의고사가 아니며 점수는 SQLD 합격 예측이 아니에요. 답을 제출하고 해설을 확인하면 문항마다 참여 경험치를 받아요(정답 여부와 무관).</p>
      <div className="panel">
        {!answered ? (
          <QuestionCard key={q.id} q={q} title={`문항 ${idx + 1}`} onGraded={(g) => void commit((s) => answerQuestion(s, q.id, g.answer, g.correct), { immediate: true })} />
        ) : (
          <div className="stack" aria-live="polite">
            <p style={{ fontWeight: 600, margin: 0 }}>{q.prompt}</p>
            {q.code && <pre className="codeblock">{q.code}</pre>}
            <p className={`notice ${qp.lastCorrect ? 'notice-good' : 'notice-warn'}`} style={{ margin: 0 }}>{qp.lastCorrect ? '정답이에요.' : '이번에는 정답과 달라요.'}</p>
            <div className="notice"><b className="small">해설</b><p style={{ margin: 0 }}>{q.explanation}</p>{!qp.lastCorrect && <p className="small" style={{ margin: '0.3rem 0 0' }}>{q.review}</p>}</div>
            <div className="row">
              <button className="btn btn-primary" disabled={!gate.active} onClick={async () => {
                if (!gate.canAct()) return;
                const results = await commit((s) => viewExplanation(s, q.id), { immediate: true });
                if (idx === FINAL_DIAGNOSTIC.length - 1 && remote) {
                  const answers = Object.fromEntries(FINAL_DIAGNOSTIC.map((x) => [x.id, state.questions[x.id]?.lastAnswer ?? null]));
                  const score = FINAL_DIAGNOSTIC.filter((x) => state.questions[x.id]?.lastCorrect).length;
                  void remote.submitAssessment('final', answers, score);
                }
                if (xpGained(results, 'course:') && idx === FINAL_DIAGNOSTIC.length - 1) nav('/report');
              }}>해설 확인 완료 · 다음</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- 보고서 ---------------- */
const AREA_LABEL: Record<QuestionArea, string> = { modeling: '데이터 모델링', basic: '기본 조회·함수', 'aggregate-join': '집계·조인', advanced: '활용(서브쿼리·윈도우·심화)', management: '관리 구문' };

export function ReportPage() {
  const L = useLearner();
  const { state, level } = L;
  const rep = useMemo(() => buildReport(state, L.ledger, L.identity.kind === 'demo' ? '개발 데모' : (L.identity.kind === 'user' ? L.identity.name ?? L.identity.email ?? '학습자' : '')), [state, L.ledger, L.identity]);
  const unsolved = unsolvedCheckpoints(state);
  return (
    <div className="page stack" style={{ gap: '1.25rem' }}>
      <section className="garden-card">
        <Garden level={level} unitBadges={UNITS.map((u) => !!L.ledger.badges[u.badgeId])} />
        <div className="stack">
          <h1>나의 학습 보고서</h1>
          {courseComplete(state) ? <p className="notice notice-good">나의 SQL 숲을 완성했어요! Lv{level}</p> : <p className="notice">숲 완성까지: {!allUnitsComplete(state) ? '단원 완료, ' : ''}{unsolved.length ? `체크포인트 ${unsolved.length}문항 해결, ` : ''}{!finalComplete(state) ? '최종 진단 완료' : ''}</p>}
          <p className="small muted">진단 점수와 숲 성장은 별개예요. 점수가 낮아도 숲은 사라지지 않아요. 이 보고서는 SQLD 합격 예측이 아니에요.</p>
          <div className="row">
            <button className="btn" onClick={() => downloadText('sql-forest-report.json', JSON.stringify(rep, null, 2), 'application/json')}>JSON 다운로드</button>
            <button className="btn" onClick={() => downloadText('sql-forest-report.csv', reportCsv(rep), 'text/csv')}>CSV 다운로드</button>
          </div>
        </div>
      </section>
      <div className="kpis">
        <div className="kpi"><b>{rep.completedUnits.length}/12</b><span>완료 단원</span></div>
        <div className="kpi"><b>{rep.activities.independent + rep.activities.guided}/48</b><span>활동 (스스로 {rep.activities.independent} · 안내 {rep.activities.guided})</span></div>
        <div className="kpi"><b>{rep.checkpointsSolved}/36</b><span>체크포인트 해결</span></div>
        <div className="kpi"><b>{formatDuration(rep.activeSeconds)}</b><span>실제 활동 시간</span></div>
      </div>
      <section className="panel">
        <h2>최종 진단 영역별 성취</h2>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th scope="col">영역</th><th scope="col">정답 / 문항</th></tr></thead>
            <tbody>{rep.finalByArea.map((a) => <tr key={a.area}><td>{AREA_LABEL[a.area]}</td><td className="num">{a.correct} / {a.total}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <h2>보완할 개념</h2>
        {rep.weakConcepts.length ? <ul>{rep.weakConcepts.map((w) => <li key={w.tag}>{w.tag} (다시 본 횟수 {w.count})</li>)}</ul> : <p className="muted">특별히 반복해서 틀린 개념이 없어요.</p>}
        <Link className="btn" to="/review">보완 개념 복습</Link>
      </section>
      {unsolved.length > 0 && (
        <section className="panel">
          <h2>숲 완성 복습</h2>
          <p className="small">숲을 완성하려면 아래 체크포인트를 해결하세요(대응 재도전 문항으로 풀어도 돼요).</p>
          <ul>{unsolved.map((id) => <li key={id}><Link to={`/learn/${QUESTION_BY_ID[id].unitId}/checkpoint`}>{id} · {UNIT_BY_ID[QUESTION_BY_ID[id].unitId!].title}</Link></li>)}</ul>
        </section>
      )}
    </div>
  );
}

/* ---------------- 오답 복습 ---------------- */
export function ReviewPage() {
  const { state } = useLearner();
  const byTag = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const w of state.wrongLog) for (const t of w.conceptTags) m.set(t, (m.get(t) ?? new Set()).add(w.itemId));
    return [...m.entries()].sort((a, b) => b[1].size - a[1].size);
  }, [state.wrongLog]);
  const unsolved = unsolvedCheckpoints(state);
  const link = (id: string) => {
    if (ACTIVITY_BY_ID[id]) return `/learn/${ACTIVITY_BY_ID[id].unitId}/${id}`;
    const q = QUESTION_BY_ID[id];
    if (q?.unitId) return `/learn/${q.unitId}/checkpoint`;
    if (id.startsWith('CH-')) return `/challenge/${id}`;
    return null;
  };
  const label = (id: string) => ACTIVITY_BY_ID[id]?.title ?? QUESTION_BY_ID[id]?.prompt.slice(0, 40) ?? id;
  return (
    <div className="page page-narrow stack">
      <h1>오답 복습</h1>
      <p className="muted">틀렸던 활동과 문항을 개념별로 모았어요. 다시 도전해도 경험치가 줄지 않아요. 정답을 보면 '설명 확인', 다시 맞히면 '재도전 완료'로 기록돼요.</p>
      {unsolved.length > 0 && allUnitsComplete(state) && (
        <div className="notice"><b>숲 완성 복습</b> — 남은 체크포인트 {unsolved.length}문항: {unsolved.map((id) => <Link key={id} to={`/learn/${QUESTION_BY_ID[id].unitId}/checkpoint`} style={{ marginRight: '0.5rem' }}>{id}</Link>)}</div>
      )}
      {byTag.length === 0 && <p>아직 복습할 오답이 없어요. 계속 배우다 막힌 곳이 생기면 여기 모여요.</p>}
      {byTag.map(([tag, ids]) => (
        <section className="panel" key={tag}>
          <h2 style={{ fontSize: '1.05rem' }}>{tag}</h2>
          <ul className="unit-acts">
            {[...ids].map((id) => {
              const to = link(id);
              const a = state.activities[id];
              const qd = state.questions[id];
              const status = a?.review === 'explained' ? '설명 확인' : a?.review === 'retried' ? '재도전 완료' : a?.completedAt ? '완료' : qd?.correct ? '해결' : '다시 도전';
              return to ? <li key={id}><Link to={to}><span>{label(id)}</span><span className="small muted">{status}</span></Link></li> : null;
            })}
          </ul>
        </section>
      ))}
      <p className="small muted">완료 단원: {UNITS.filter((u) => isUnitComplete(state, u.id)).map((u) => u.id).join(', ') || '없음'}</p>
    </div>
  );
}
