import { Link } from 'react-router-dom';
import { Plant, PLANT_STAGES } from '../../../components/Plant';
import { isSupabaseConfigured } from '../../../lib/config';
import { useAuth } from '../../auth/AuthContext';
import { CG_UNITS } from '../content';
import { activeWrongIds, bestRegularMock, isPassed, nextPlantGoal, passedCount, plantStage, TOTAL_STEPS, unitLevel } from '../model';
import { useCg } from '../store';
import { CG_LEVELS, CG_LEVEL_NAME, CG_PASS } from '../types';

const STAGE_RULE = ['시작', '1단계', '8단계', '16단계', '28단계', '40단계', `꽃 + 모의 ${CG_PASS.mock.need}점`];

export function CgHome() {
  const cg = useCg();
  const auth = useAuth();
  const s = cg.state;
  const stage = plantStage(s);
  const passed = passedCount(s);
  const wrong = activeWrongIds(s).length;
  const best = bestRegularMock(s);
  return (
    <div className="stack" style={{ gap: '1.25rem' }}>
      <p className="crumbs" style={{ margin: 0 }}><Link to="/">과목 선택</Link> / 컴퓨터 일반</p>

      <section className="cg-hero panel">
        <div className="cg-plant"><Plant stage={stage} size={190} /></div>
        <div className="stack" style={{ gap: '0.5rem' }}>
          <p className="step-label" style={{ margin: 0 }}>나의 식물</p>
          <h1 style={{ margin: 0 }}>{PLANT_STAGES[stage]}</h1>
          <p style={{ margin: 0 }}>통과한 단계 <b>{passed}</b> / {TOTAL_STEPS} · 오답노트 {wrong}문항 · 모의고사 최고 {best}/{CG_PASS.mock.total}</p>
          <div className="xpbar" role="progressbar" aria-label="통과한 단계" aria-valuemin={0} aria-valuemax={TOTAL_STEPS} aria-valuenow={passed}><span style={{ width: `${(passed / TOTAL_STEPS) * 100}%` }} /></div>
          <p className="small muted" style={{ margin: 0 }}>{nextPlantGoal(s) ?? '열매까지 맺었어요! 오답노트와 모의고사로 실력을 다져 보세요.'}</p>
          {cg.mode === 'guest' && (
            <div className="notice small" style={{ marginTop: '0.25rem' }}>
              로그인 없이 둘러보는 중이에요. 기록은 이 기기에만 저장돼요.
              {isSupabaseConfigured && <> <button className="btn btn-small btn-primary" onClick={() => void auth.signIn('/computer')}>Google 계정으로 로그인</button> 하면 다른 기기에서도 이어지고, 지금 기록도 가져올 수 있어요.</>}
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="growth-map">
        <h2 id="growth-map" className="sr-only">성장 지도</h2>
        <ol className="cg-growth">
          {PLANT_STAGES.map((name, i) => (
            <li key={name} className={i <= stage ? 'reached' : ''} aria-current={i === stage ? 'step' : undefined}>
              <Plant stage={i} size={56} title={name} />
              <b>{name}</b>
              <span className="small muted">{STAGE_RULE[i]}</span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="units-h" className="stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="units-h" style={{ margin: 0 }}>단원</h2>
          <span className="small muted">단원마다 이론 → 끼워맞추기 → 기초 → 요약 → 실력점검</span>
        </div>
        <div className="cg-units">
          {CG_UNITS.map((u, i) => {
            const lv = unitLevel(s, u.id);
            return (
              <Link key={u.id} to={`/computer/unit/${u.id}`} className="panel cg-unit">
                <span className="cg-unit-num">{i + 1}</span>
                <span className="stack" style={{ gap: '0.3rem' }}>
                  <b>{u.title}</b>
                  <span className="cg-steps" aria-label={`레벨 ${lv}/5`}>
                    {CG_LEVELS.map((l) => (
                      <span key={l} className={isPassed(s, u.id, l) ? 'on' : ''} title={`${l}단계 ${CG_LEVEL_NAME[l]}${isPassed(s, u.id, l) ? ' 통과' : ''}`} />
                    ))}
                  </span>
                  <span className="small muted">레벨 {lv}/5{lv < 5 ? ` · 다음: ${CG_LEVEL_NAME[(lv + 1) as 1]}` : ' · 모두 통과'}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="row">
        <Link className="btn btn-primary" to="/computer/mock">모의고사 보기</Link>
        <Link className="btn" to="/computer/wrong">오답노트 {wrong}문항</Link>
        {cg.isTeacher && <Link className="btn" to="/computer/teacher">반 학습 현황(선생님)</Link>}
      </section>
      <p className="small muted">점수는 이 브라우저가 계산해 저장하는 자기 학습 기록이에요. 시험 점수나 평가 근거가 아니에요.</p>
    </div>
  );
}
