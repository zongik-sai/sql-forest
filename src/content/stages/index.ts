import U01 from './U01.json' with { type: 'json' };
import U02 from './U02.json' with { type: 'json' };
import U03 from './U03.json' with { type: 'json' };
import U04 from './U04.json' with { type: 'json' };
import U05 from './U05.json' with { type: 'json' };
import U06 from './U06.json' with { type: 'json' };
import U07 from './U07.json' with { type: 'json' };
import U08 from './U08.json' with { type: 'json' };
import U09 from './U09.json' with { type: 'json' };
import U10 from './U10.json' with { type: 'json' };
import U11 from './U11.json' with { type: 'json' };
import U12 from './U12.json' with { type: 'json' };
import type { UnitId } from '../types';
import type { UnitStages } from './types';

export type { PracticeItem, StageCard, StageMatch, StageQuiz, StageTable, UnitStages } from './types';

export const UNIT_STAGES: Record<UnitId, UnitStages> = {
  U01, U02, U03, U04, U05, U06, U07, U08, U09, U10, U11, U12,
} as Record<UnitId, UnitStages>;

export { quizNeed, STAGE_COUNTS } from './meta';
