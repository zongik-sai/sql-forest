import { CHECKPOINTS, FINAL_DIAGNOSTIC, UNITS } from '../../content';
import type { QuestionArea } from '../../content/types';
import { levelOf } from '../growth/levels';
import { totalXpOf, type LedgerSnapshot } from './ledger';
import { checkpointSolved, isUnitComplete, type LearnerState } from './model';

/** 본인 학습 결과(JSON/CSV 다운로드). 이메일 전송은 하지 않는다. */
export function buildReport(s: LearnerState, ledger: LedgerSnapshot, who: string) {
  const areas: QuestionArea[] = ['modeling', 'basic', 'aggregate-join', 'advanced', 'management'];
  const acts = Object.values(s.activities).filter((a) => a.completedAt && !a.activityId.startsWith('CH-'));
  const tagCount = new Map<string, number>();
  for (const w of s.wrongLog) for (const t of w.conceptTags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  for (const q of FINAL_DIAGNOSTIC) if (s.questions[q.id]?.attempts && !s.questions[q.id]?.lastCorrect) for (const t of q.conceptTags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  return {
    generatedAt: new Date().toISOString(),
    learner: who,
    note: '학습 기록 요약입니다. SQLD 합격 예측이나 공식 점수가 아닙니다.',
    level: levelOf(totalXpOf(ledger)),
    xp: totalXpOf(ledger),
    completedUnits: UNITS.filter((u) => isUnitComplete(s, u.id)).map((u) => u.id),
    activities: { independent: acts.filter((a) => a.completionKind === 'independent').length, guided: acts.filter((a) => a.completionKind === 'guided').length },
    checkpointsSolved: CHECKPOINTS.filter((q) => checkpointSolved(s, q.id)).length,
    activeSeconds: s.totalActiveSeconds,
    finalByArea: areas.map((area) => {
      const qs = FINAL_DIAGNOSTIC.filter((q) => q.area === area);
      return { area, total: qs.length, correct: qs.filter((q) => s.questions[q.id]?.lastCorrect).length };
    }),
    weakConcepts: [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tag, count]) => ({ tag, count })),
    badges: Object.keys(ledger.badges),
    challenges: s.challenges,
  };
}

export type Report = ReturnType<typeof buildReport>;

export function reportCsv(r: Report): string {
  const rows: string[][] = [
    ['항목', '값'],
    ['학습자', r.learner],
    ['레벨', String(r.level)],
    ['XP', String(r.xp)],
    ['완료 단원', r.completedUnits.join(' ')],
    ['스스로 완료 활동', String(r.activities.independent)],
    ['안내 학습 완료 활동', String(r.activities.guided)],
    ['체크포인트 해결', `${r.checkpointsSolved}/36`],
    ['실제 활동 시간(초)', String(r.activeSeconds)],
    ...r.finalByArea.map((a) => [`최종 진단 ${a.area}`, `${a.correct}/${a.total}`]),
    ['보완 개념', r.weakConcepts.map((w) => w.tag).join(' ')],
    ['비고', r.note],
  ];
  return '﻿' + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
}

export function downloadText(name: string, text: string, type: string) {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
