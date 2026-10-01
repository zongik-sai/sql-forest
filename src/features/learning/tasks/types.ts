import type { ActivityConfig, LessonActivity } from '../../../content/types';
import type { ActivityProgress } from '../../progress/model';

export interface TaskResult {
  correct: boolean;
  /** 정답이면 어떤 데이터가 조건을 만족했는지, 오답이면 첫 차이와 개념 이유 */
  message: string;
  /** 정답 공개 후 안내 학습 인정을 위한 후속 확인(결과 행 수 등) */
  followUp?: { question: string; answer: number };
  /** 예측 제출/의미 있는 조작/SQL 실행이었는지(단순 클릭은 false) */
  meaningful: boolean;
}

export interface TaskProps<C extends ActivityConfig = ActivityConfig> {
  activity: LessonActivity;
  config: C;
  progress: ActivityProgress;
  saveState: (patch: Record<string, unknown>) => void;
  saveDraft: (sql: string) => void;
  report: (r: TaskResult) => void;
  /** 정답 공개 후 다시 수행하는 중 */
  guided: boolean;
}
