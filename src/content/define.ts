import type { ActivityConfig, ActivityKind, LessonActivity, Question, Rubric } from './types';

type ActivityInput = Omit<LessonActivity, 'contentVersion' | 'kind' | 'rubric'> & {
  contentVersion?: number;
  rubric?: Rubric;
};

function defaultRubric(id: string, c: ActivityConfig): Rubric {
  switch (c.kind) {
    case 'sql-editor':
    case 'sql-blocks':
    case 'row-filter':
      return { type: 'result', ordered: c.ordered, targetId: `${id}:solution` };
    case 'predict-result':
    case 'classify':
    case 'erd':
    case 'normalize':
      return { type: 'choices', targetId: `${id}:answer` };
    default:
      return { type: 'state', targetId: `${id}:state` };
  }
}

/** 활동 정의 도우미: kind는 config.kind와 항상 같게, rubric 기본값을 채운다. */
export function defineActivity(a: ActivityInput): LessonActivity {
  return {
    ...a,
    contentVersion: a.contentVersion ?? 1,
    kind: a.config.kind as ActivityKind,
    rubric: a.rubric ?? defaultRubric(a.id, a.config),
  };
}

type QuestionInput = Omit<Question, 'contentVersion'> & { contentVersion?: number };

export function defineQuestion(q: QuestionInput): Question {
  return { ...q, contentVersion: q.contentVersion ?? 1 };
}

/** 원문 문항과 변형 문항을 한 번에 정의 */
export function defineCheckpointPair(original: QuestionInput, variant: Omit<QuestionInput, 'unitId' | 'set' | 'variantOf' | 'id' | 'area' | 'conceptTags'> & Partial<Pick<QuestionInput, 'conceptTags' | 'area'>>): [Question, Question] {
  const o = defineQuestion({ ...original, set: 'checkpoint' });
  const v = defineQuestion({
    ...variant,
    id: `${original.id}V`,
    unitId: original.unitId,
    set: 'variant',
    variantOf: original.id,
    area: variant.area ?? original.area,
    conceptTags: variant.conceptTags ?? original.conceptTags,
  });
  return [o, v];
}
