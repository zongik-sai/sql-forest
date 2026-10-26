import { Link } from 'react-router-dom';
import { Plant, PLANT_STAGES } from '../../../components/Plant';
import { isSupabaseConfigured } from '../../../lib/config';
import { useAuth } from '../../auth/AuthContext';
import { unitHasContent, useCourse } from '../course';
import { activeWrongIds, bestRegularMock, isPassed, nextPlantGoal, passedCount, plantStage, plantThresholds, unitLevel } from '../model';
import { useCg } from '../store';
import { CG_LEVELS, CG_LEVEL_NAME, CG_PASS } from '../types';

const stageRule = (total: number) => ['시작', ...plantThresholds(total).map((n) => `${n}단계`), `꽃 + 모의 ${CG_PASS.mock.need}점`];

export function CgHome() {
  const cg = useCg();
  const auth = useAuth();
  const course = useCourse();
  const base = course.basePath;
  const total = course.totalSteps;
  const s = cg.state;
  const stage = plantStage(s, course);
  const passed = passedCount(s, course);
  const wrong = activeWrongIds(s).length;
  const best = bestRegularMock(s);
  const rule = stageRule(total);
  return (
    <div className="stack" style={{ gap: '1.25rem' }}>
      <p className="crumbs" style={{ margin: 0 }}><Link to="/">과목 선택</Link> / {course.name}</p>

      <section className="cg-hero panel">
        <div className="cg-plant"><Plant stage={stage} size={190} /></div>
        <div className="stack" style={{ gap: '0.5rem' }}>
          <p className="step-label" style={{ margin: 0 }}>나의 식물</p>
          <h1 style={{ margin: 0 }}>{PLANT_STAGES[stage]}</h1>
          <p style={{ margin: 0 }}>통과한 단계 <b>{passed}</b> / {total} · 오답노트 {wrong}문항 · 모의고사 최고 {best}/{CG_PASS.mock.total}</p>
          <div className="xpbar" role="progressbar" aria-label="통과한 단계" aria-valuemin={0} aria-valuemax={total} aria-valuenow={passed}><span style={{ width: `${total ? (passed / total) * 100 : 0}%` }} /></div>
          <p className="small muted" style={{ margin: 0 }}>{nextPlantGoal(s, course) ?? '열매까지 맺었어요! 오답노트와 모의고사로 실력을 다져 보세요.'}</p>
          {cg.mode === 'guest' && (
            <div className="notice small" style={{ marginTop: '0.25rem' }}>
              로그인 없이 둘러보는 중이에요. 기록은 이 기기에만 저장돼요.
              {isSupabaseConfigured && <> <button className="btn btn-small btn-primary" onClick={() => void auth.signIn(base)}>Google 계정으로 로그인</button> 하면 다른 기기에서도 이어지고, 지금 기록도 가져올 수 있어요.</>}
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
              <span className="small muted">{rule[i]}</span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="units-h" className="stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="units-h" style={{ margin: 0 }}>단원</h2>
          <span className="small muted">단원마다 이론·개념 맞추기 → 전체 끼워맞추기 → 기초 → 요약 → 실력점검</span>
        </div>
        <div className="cg-units">
          {course.units.map((u, i) => {
            const lv = unitLevel(s, u.id);
            const nextLv = CG_LEVELS.find((l) => !isPassed(s, u.id, l));
            // 이 단원 문항이 가장 많이 속한 영역(최대 2개)
            const cnt = new Map<string, number>();
            for (const q of [...u.basic, ...u.check]) cnt.set(q.area, (cnt.get(q.area) ?? 0) + 1);
            const areas = [...cnt.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2).map(([a]) => course.areaLabel(a));
            return (
              <Link key={u.id} to={`${base}/unit/${u.id}`} className="panel cg-unit">
                <span className="cg-unit-num">{i + 1}</span>
                <span className="stack" style={{ gap: '0.3rem' }}>
                  <b>{u.title}</b>
                  <span className="cg-steps" aria-label={`레벨 ${lv}/5`}>
                    {CG_LEVELS.map((l) => (
                      <span key={l} className={isPassed(s, u.id, l) ? 'on' : ''} title={`${l}단계 ${CG_LEVEL_NAME[l]}${isPassed(s, u.id, l) ? ' 통과' : ''}`} />
                    ))}
                  </span>
                  <span className="small muted">
                    {unitHasContent(u) ? <>레벨 {lv}/5{nextLv ? ` · 다음: ${CG_LEVEL_NAME[nextLv]}` : ' · 모두 통과'}</> : '내용 준비 중'}
                    {course.id !== 'cg' && areas.length > 0 && ` · ${areas.join(', ')}`}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="row">
        <Link className="btn btn-primary" to={`${base}/mock`}>모의고사 보기</Link>
        <Link className="btn" to={`${base}/wrong`}>오답노트 {wrong}문항</Link>
        {cg.isTeacher && <Link className="btn" to={`${base}/teacher`}>반 학습 현황(선생님)</Link>}
      </section>
      <p className="small muted">점수는 이 브라우저가 계산해 저장하는 자기 학습 기록이에요. 시험 점수나 평가 근거가 아니에요.</p>
      {course.basis && <p className="small muted cg-basis" style={{ margin: 0 }}>내용 범위: {course.basis}</p>}
    </div>
  );
}
