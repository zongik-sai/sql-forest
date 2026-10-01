import { useEffect, useRef, useState } from 'react';
import type { LessonActivity } from '../../content/types';
import { ChoiceGroup, ModeBadge } from '../../components/common';
import { useLearner, xpGained } from '../../app/LearnerContext';
import { useFocusGate } from '../focus/FocusContext';
import {
  completeActivity, emptyActivity, recordAttempt, recordChallenge, revealHint, revealSolution, saveActivityDraft,
} from '../progress/model';
import { ClassifyTask, ErdTask, NormalizeTask, PredictResultTask, RowFilterTask } from './tasks/ChoiceTasks';
import { GroupTask, HierarchyTask, JoinTask, PivotTask, TransactionTask, WindowTask } from './tasks/DataTasks';
import { SqlBlocksTask, SqlEditorTask } from './tasks/SqlTask';
import type { TaskProps, TaskResult } from './tasks/types';

function TaskView(p: TaskProps) {
  const c = p.config;
  switch (c.kind) {
    case 'sql-editor': return <SqlEditorTask {...p} config={c} />;
    case 'sql-blocks': return <SqlBlocksTask {...p} config={c} />;
    case 'predict-result': return <PredictResultTask {...p} config={c} />;
    case 'row-filter': return <RowFilterTask {...p} config={c} />;
    case 'classify': return <ClassifyTask {...p} config={c} />;
    case 'erd': return <ErdTask {...p} config={c} />;
    case 'normalize': return <NormalizeTask {...p} config={c} />;
    case 'join-visualizer': return <JoinTask {...p} config={c} />;
    case 'group-visualizer': return <GroupTask {...p} config={c} />;
    case 'window-visualizer': return <WindowTask {...p} config={c} />;
    case 'transaction': return <TransactionTask {...p} config={c} />;
    case 'pivot': return <PivotTask {...p} config={c} />;
    case 'hierarchy': return <HierarchyTask {...p} config={c} />;
  }
}

interface Props {
  activity: LessonActivity;
  /** 도전 모드: 설명 접기, 힌트·정답 숨김, XP 없음 */
  challenge?: boolean;
  onNext?: () => void;
  nextLabel?: string;
}

type Feedback = { tone: 'good' | 'bad' | 'info'; text: string } | null;

export function ActivityRunner({ activity, challenge = false, onNext, nextLabel }: Props) {
  const { state, commit } = useLearner();
  const gate = useFocusGate();
  const progress = state.activities[activity.id] ?? emptyActivity(activity.id);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [followUp, setFollowUp] = useState<{ question: string; answer: number } | null>(null);
  const [followVal, setFollowVal] = useState('');
  const [confirmReveal, setConfirmReveal] = useState(false);
  const [basicHelp, setBasicHelp] = useState(!challenge);
  const [taskKey, setTaskKey] = useState(0);
  const [pred, setPred] = useState<number | null>(progress.predictionAnswer);
  const completedBefore = !!progress.completedAt;
  const feedbackRef = useRef<HTMLDivElement>(null);
  const isSqlKind = activity.kind === 'sql-editor' || activity.kind === 'sql-blocks' || activity.kind === 'row-filter';
  const guided = progress.revealed && !progress.completedAt;

  useEffect(() => {
    gate.setCurrentItem(activity.id);
    return () => gate.setCurrentItem(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity.id]);

  const predictionDone = !activity.prediction || progress.predictionAnswer !== null;

  const finish = async (kind: 'normal' | 'followup') => {
    if (challenge) {
      await commit((s) => recordChallenge(completeActivity(s, activity.id), activity.id, basicHelp || progress.revealed ? 'learned' : 'solved'), { activityId: activity.id, immediate: true });
      setFeedback({ tone: 'good', text: `${activity.successMessage} 도전 기록에 남겼어요(경험치 없음, 숙련 기록).` });
      return;
    }
    const results = await commit((s) => completeActivity(s, activity.id), { activityId: activity.id, immediate: true });
    const xp = xpGained(results, 'activity:');
    const pending = results.some((r) => r.status === 'pending');
    const suffix = completedBefore ? ' (복습: 재도전 완료)' : xp ? ` +${xp}XP${pending ? ' (동기화 대기)' : ''}` : '';
    const guidedNote = kind === 'followup' ? ' 안내 학습 완료로 기록했어요.' : '';
    setFeedback({ tone: 'good', text: `${activity.successMessage}${suffix}${guidedNote}` });
  };

  const report = async (r: TaskResult) => {
    if (!gate.canAct()) return;
    if (r.meaningful) await commit((s) => recordAttempt(s, activity.id, r.correct, activity.conceptTags), { activityId: activity.id, immediate: true });
    if (!r.correct) {
      setFeedback({ tone: 'bad', text: r.message });
      return;
    }
    // 정답 공개 후 SQL 활동: 결과의 핵심(행 수)을 직접 확인해야 안내 학습 완료로 인정
    if (progress.revealed && !completedBefore && isSqlKind && r.followUp) {
      setFollowUp(r.followUp);
      setFollowVal('');
      setFeedback({ tone: 'info', text: `${r.message} 마지막으로 결과를 직접 확인해 볼까요?` });
      return;
    }
    setFeedback({ tone: 'good', text: r.message });
    await finish('normal');
  };

  useEffect(() => {
    if (feedback) feedbackRef.current?.focus();
  }, [feedback]);

  const submitPrediction = async () => {
    if (pred === null || !gate.canAct()) return;
    await commit((s) => saveActivityDraft(s, activity.id, { predictionAnswer: pred }), { activityId: activity.id, immediate: true });
  };

  const doReveal = async () => {
    setConfirmReveal(false);
    await commit((s) => {
      let n = revealSolution(s, activity.id);
      // 조작형 활동은 상태를 비워 다시 수행하게 한다(정답을 본 뒤 의미 있는 후속 행동 필요)
      if (!isSqlKind && !n.activities[activity.id]?.completedAt) n = saveActivityDraft(n, activity.id, { state: {} });
      return n;
    }, { activityId: activity.id, immediate: true });
    setTaskKey((k) => k + 1);
    setFeedback({ tone: 'info', text: completedBefore ? '해설을 확인했어요(설명 확인).' : '해설을 열었어요. 이제 직접 다시 수행하면 "안내 학습 완료"로 인정돼요. 경험치는 똑같이 받아요.' });
  };

  const showHelp = !challenge || basicHelp;
  const hintsShown = activity.hints.slice(0, progress.hintLevel);

  return (
    <div className="learn-grid">
      <aside className="explain panel" aria-label="설명">
        <div className="row" style={{ marginBottom: '0.5rem' }}>
          <ModeBadge mode={activity.mode} />
          <span className="badge badge-plain">약 {activity.estimatedMinutes}분</span>
          {completedBefore && <span className="badge badge-exec">{progress.completionKind === 'guided' ? '안내 학습 완료' : '완료'}{progress.review === 'explained' ? ' · 설명 확인' : progress.review === 'retried' ? ' · 재도전 완료' : ''}</span>}
        </div>
        <p className="objective">{activity.objective}</p>
        {showHelp ? (
          <>
            <p>{activity.explanation}</p>
            {activity.glossary.length > 0 && (
              <ul className="glossary">
                {activity.glossary.map((g) => <li key={g.term}><b>{g.term}</b>{g.meaning}</li>)}
              </ul>
            )}
            {activity.dialectNotes && (
              <div className="notice" style={{ marginTop: '0.75rem' }}>
                <b className="small">DBMS 차이</b>
                <ul className="small" style={{ margin: '0.25rem 0 0', paddingLeft: '1.1rem' }}>{activity.dialectNotes.map((d) => <li key={d}>{d}</li>)}</ul>
              </div>
            )}
          </>
        ) : (
          <details>
            <summary>설명 펼치기</summary>
            <p>{activity.explanation}</p>
          </details>
        )}
      </aside>

      <section className="task" aria-labelledby={`t-${activity.id}`}>
        <div>
          <h1 id={`t-${activity.id}`} style={{ fontSize: '1.4rem' }}>{activity.title}</h1>
          <p className="task-prompt">{activity.prompt}</p>
        </div>

        {activity.prediction && (
          <div className="panel stack">
            <p className="step-label">먼저 예측해 보세요</p>
            <ChoiceGroup legend={activity.prediction.prompt} options={activity.prediction.options} value={pred} onChange={setPred} disabled={progress.predictionAnswer !== null} correctIndex={progress.predictionAnswer !== null ? activity.prediction.correctIndex : undefined} />
            {progress.predictionAnswer === null ? (
              <div className="row"><button className="btn btn-primary" disabled={pred === null || !gate.active} onClick={() => void submitPrediction()}>예측 제출</button></div>
            ) : (
              <p className={`notice ${progress.predictionAnswer === activity.prediction.correctIndex ? 'notice-good' : ''}`}>
                {progress.predictionAnswer === activity.prediction.correctIndex ? '예측이 맞았어요. ' : '예측과 달라요 — 괜찮아요, 직접 확인해 봐요. '}
                {activity.prediction.reveal}
              </p>
            )}
          </div>
        )}

        {predictionDone ? (
          <TaskView
            key={taskKey}
            activity={activity}
            config={activity.config}
            progress={progress}
            guided={guided}
            saveState={(patch) => void commit((s) => saveActivityDraft(s, activity.id, { state: { ...(s.activities[activity.id]?.state ?? {}), ...patch } }), { activityId: activity.id })}
            saveDraft={(sql) => void commit((s) => saveActivityDraft(s, activity.id, { draftSql: sql }), { activityId: activity.id })}
            report={(r) => void report(r)}
          />
        ) : (
          <p className="muted">예측을 제출하면 활동이 열려요.</p>
        )}

        <div className="feedback-bar">
          <div ref={feedbackRef} tabIndex={-1} aria-live="polite" className="feedback">
            {feedback && <p className={`notice ${feedback.tone === 'good' ? 'notice-good' : feedback.tone === 'bad' ? 'notice-warn' : ''}`} style={{ margin: 0 }}>{feedback.text}</p>}
          </div>

          {followUp && (
            <div className="panel row">
              <label>
                {followUp.question}{' '}
                <input type="number" value={followVal} onChange={(e) => setFollowVal(e.target.value)} />
              </label>
              <button className="btn btn-primary" disabled={!gate.active} onClick={() => {
                if (!gate.canAct()) return;
                if (Number(followVal) === followUp.answer) {
                  setFollowUp(null);
                  void finish('followup');
                } else setFeedback({ tone: 'bad', text: '결과 표를 다시 보고 세어 볼까요?' });
              }}>확인</button>
            </div>
          )}

          {showHelp ? (
            <div className="stack">
              {hintsShown.length > 0 && (
                <ol className="hint-list" aria-label="힌트">
                  {hintsShown.map((h, i) => <li key={i}><b>힌트 {i + 1}{i === 0 ? '(개념)' : i === 1 ? '(방향)' : '(구조)'}:</b> {h}</li>)}
                </ol>
              )}
              <div className="row">
                {progress.hintLevel < 3 && (
                  <button className="btn" disabled={!gate.active} onClick={() => void commit((s) => revealHint(s, activity.id), { activityId: activity.id, immediate: true })}>
                    힌트 {progress.hintLevel + 1} 보기
                  </button>
                )}
                {!progress.revealed && !confirmReveal && <button className="btn btn-quiet" onClick={() => setConfirmReveal(true)}>정답 보기</button>}
                {confirmReveal && (
                  <span className="row">
                    <span className="small">정답을 보면 직접 다시 수행해야 완료돼요. 볼까요?</span>
                    <button className="btn btn-small" onClick={() => void doReveal()}>정답 보기</button>
                    <button className="btn btn-small btn-quiet" onClick={() => setConfirmReveal(false)}>취소</button>
                  </span>
                )}
                {challenge && <span className="small muted">기본 모드 도움을 켰어요(숙련 기록은 '배움'으로 남아요).</span>}
              </div>
              <p className="small muted" style={{ margin: 0 }}>힌트를 써도 경험치는 줄지 않아요.</p>
            </div>
          ) : (
            <div className="row">
              <button className="btn" onClick={() => setBasicHelp(true)}>기본 모드로 배우기</button>
              <span className="small muted">설명·힌트를 펼쳐요. 진행 기록은 그대로예요.</span>
            </div>
          )}

          {progress.revealed && (
            <div className="panel stack">
              <p className="step-label">해설</p>
              <p style={{ margin: 0 }}>{activity.solution.reasoning}</p>
              {activity.solution.sql && <pre className="codeblock">{activity.solution.sql}</pre>}
              {activity.solution.commonMistakes.length > 0 && (
                <div className="small"><b>자주 하는 실수</b><ul style={{ margin: '0.2rem 0 0', paddingLeft: '1.1rem' }}>{activity.solution.commonMistakes.map((m) => <li key={m}>{m}</li>)}</ul></div>
              )}
            </div>
          )}

          {onNext && (
            <div className="row">
              <button className={`btn ${progress.completedAt ? 'btn-grow' : ''}`} onClick={onNext}>{nextLabel ?? '다음'}</button>
              {!progress.completedAt && <span className="small muted">이 활동은 아직 완료 전이에요. 나중에 돌아와도 돼요.</span>}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
