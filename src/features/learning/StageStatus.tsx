import { useLearner } from '../../app/LearnerContext';
import type { UnitId } from '../../content/types';
import { stageOpen, stagePassed, type StageNo } from '../progress/model';

/** 단원 단계 상태 표시(통과·잠김·최고 점수·열림) */
export function StageStatus({ unitId, n }: { unitId: UnitId; n: StageNo }) {
  const { state } = useLearner();
  if (stagePassed(state, unitId, n)) {
    const r = n === 4 ? undefined : state.stages?.[unitId]?.[`s${n}` as 's1'];
    return <span className="badge badge-exec">통과{r?.best !== undefined && n === 2 ? ` ${r.best}/${r.total}` : ''}</span>;
  }
  if (!stageOpen(state, unitId, n)) return <span className="badge badge-plain">잠김</span>;
  const r = n === 4 ? undefined : state.stages?.[unitId]?.[`s${n}` as 's1'];
  if (r?.best !== undefined) return <span className="badge badge-sim">{n === 2 ? `최고 ${r.best}/${r.total}` : `${r.best}/${r.total}`}</span>;
  return <span className="badge badge-dialect">열림</span>;
}

