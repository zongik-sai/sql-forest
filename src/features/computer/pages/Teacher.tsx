import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { PLANT_STAGES } from '../../../components/Plant';
import { supabase } from '../../auth/supabase';
import { rpcErrorText } from '../../monitor/api';
import { useCourse, type CourseConfig } from '../course';
import { LOCK_LIMIT, MOCK_LABEL, type MockKind } from '../model';
import {
  classSummary, downloadText, lastActivity, questionStats, studentDetail, toCsv, toStudents, unitClassStats, type CgClassRow, type CgStudent,
} from '../teacher';
import { CG_LEVEL_NAME, type CgLevel } from '../types';

/**
 * 선생님 반 학습 현황(선생님 화면 /teacher의 과목 탭). 읽기 전용, 권한은 서버 RPC가 다시 확인한다.
 * 컴퓨터 일반은 cg_class_overview, 다른 단원 × 5단계 과목은 course_class_overview(p_course), 데이터베이스는 db_class_overview.
 * 예전 과목 경로(`/computer/teacher` 등)는 선생님 화면의 그 과목 탭으로 보낸다.
 */
export function TeacherPage() {
  const course = useCourse();
  return <Navigate to={`/teacher?s=${course.id}`} replace />;
}

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');
const pct = (x: number) => `${Math.round(x * 100)}%`;
const today = () => new Date().toISOString().slice(0, 10);

export function useRpc<T>(fn: string, args?: Record<string, string>) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const argKey = JSON.stringify(args ?? null);
  useEffect(() => {
    const sb = supabase();
    if (!sb) return setErr('로그인 설정(Supabase)이 없어요.');
    let alive = true;
    setRows(null);
    setErr(null);
    const a = JSON.parse(argKey) as Record<string, string> | null;
    (a ? sb.rpc(fn, a) : sb.rpc(fn)).then(({ data, error }) => {
      if (!alive) return;
      if (error) setErr(rpcErrorText(fn, error));
      else setRows((data ?? []) as T[]);
    });
    return () => {
      alive = false;
    };
  }, [fn, argKey, tick]);
  return { rows, err, reload: () => setTick((t) => t + 1) };
}

/** 오른쪽 서랍(휴대폰은 전체 화면): 학생 한 명의 자세한 기록 */
export function Drawer({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: ReactNode }) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    btn.current?.focus();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="t-drawer-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="t-drawer" role="dialog" aria-modal="true" aria-labelledby="t-drawer-title">
        <div className="t-drawer-head">
          <div>
            <h2 id="t-drawer-title">{title}</h2>
            {sub && <p className="small muted" style={{ margin: 0 }}>{sub}</p>}
          </div>
          <button ref={btn} className="btn btn-small" onClick={onClose}>닫기</button>
        </div>
        <div className="t-drawer-body stack">{children}</div>
      </aside>
    </div>
  );
}

type SortKey = 'name' | 'passed' | 'mockBest' | 'wrong' | 'lastAt' | 'locks';
const lockSum = (s: CgStudent) => Object.values(s.state.locks).reduce((a, l) => a + (l?.length ?? 0), 0);
const resetSum = (s: CgStudent) => Object.values(s.state.resets).reduce((a, r) => a + (r?.n ?? 0), 0);

/** 단원 × 5단계 과목의 반 현황(더 자세히: 단원별 통과율·문항별 오답·학생별 단원 × 단계) */
export function CourseClass({ course }: { course: CourseConfig }) {
  const units = course.unitIds;
  const total = course.totalSteps;
  const fn = course.remote.kind === 'cg' ? 'cg_class_overview' : 'course_class_overview';
  const args = course.remote.kind === 'cg' ? undefined : { p_course: course.remote.course };
  const { rows, err, reload } = useRpc<CgClassRow>(fn, args);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ k: SortKey; desc: boolean }>({ k: 'lastAt', desc: true });
  const [open, setOpen] = useState<string | null>(null);
  const [allQ, setAllQ] = useState(false);
  const students = useMemo(() => (rows ? toStudents(rows, course) : []), [rows, course]);
  const sum = useMemo(() => classSummary(students, Date.now(), course), [students, course]);
  const ustats = useMemo(() => unitClassStats(students, course), [students, course]);
  const qstats = useMemo(() => questionStats(students), [students]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const f = t ? students.filter((s) => s.name.toLowerCase().includes(t) || s.email.toLowerCase().includes(t)) : students;
    const val = (s: CgStudent) => (sort.k === 'name' ? s.name : sort.k === 'locks' ? lockSum(s) : s[sort.k]);
    return [...f].sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ko');
      return sort.desc ? -c : c;
    });
  }, [students, q, sort]);
  if (err) return <p className="notice notice-warn" role="alert">불러오지 못했어요: {err}</p>;
  if (!rows) return <p role="status">불러오는 중…</p>;
  const th = (k: SortKey, label: string) => (
    <th scope="col" aria-sort={sort.k === k ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button className="btn-quiet thsort" onClick={() => setSort((s) => ({ k, desc: s.k === k ? !s.desc : k !== 'name' }))}>{label}{sort.k === k ? (sort.desc ? ' ▼' : ' ▲') : ''}</button>
    </th>
  );
  const csv = () => downloadText(`${course.name.replace(/\s/g, '')}_반현황_${today()}.csv`, toCsv(
    ['이름', '이메일', '식물', `통과(/${total})`, ...units.map((u) => `${u} 레벨`), '모의 최고', '모의 응시', '오답', '잠김(지금)', '단원 초기화', '최근 활동'],
    list.map((s) => [s.name, s.email, PLANT_STAGES[s.plant], s.passed, ...units.map((u) => s.levels[u]), s.mockBest, s.state.mock.length, s.wrong, lockSum(s), resetSum(s), fmt(s.lastAt)]),
  ));
  const shownQ = allQ ? qstats.slice(0, 30) : qstats.slice(0, 8);
  const sel = open ? students.find((s) => s.id === open) : undefined;
  return (
    <div className="stack">
      <div className="kpis">
        <div className="kpi"><b>{sum.n}</b><span>학생</span></div>
        <div className="kpi"><b>{sum.active7}</b><span>최근 7일 학습</span></div>
        <div className="kpi"><b>{sum.avgPassed.toFixed(1)}</b><span>평균 통과 단계(/{total})</span></div>
        <div className="kpi"><b>{sum.mockPassed}</b><span>모의고사 {course.pass.mock.need}/{course.pass.mock.total} 이상 경험</span></div>
        <div className="kpi"><b className="kpi-small">{fmt(lastActivity(students))}</b><span>마지막 활동</span></div>
      </div>
      {sum.n === 0 ? <p className="notice">아직 이 과목을 공부한(로그인해 저장한) 학생이 없어요.</p> : (
        <div className="cg-result-cols">
          <div className="panel t-wide">
            <h2>단원별 통과율</h2>
            <div className="table-wrap">
              <table className="data t-unit-table">
                <thead><tr><th scope="col">단원</th>{[1, 2, 3, 4, 5].map((lv) => <th scope="col" key={lv} title={CG_LEVEL_NAME[lv as CgLevel]}>{lv}단계</th>)}<th scope="col">평균</th><th scope="col" title="지금 잠김 합계 / 초기화된 학생">잠김·초기화</th></tr></thead>
                <tbody>
                  {ustats.map((u) => (
                    <tr key={u.unitId}>
                      <th scope="row" title={course.unitById(u.unitId)?.title}>{u.unitId.replace('U', '')}. {course.unitById(u.unitId)?.title}</th>
                      {u.passRate.map((r, i) => <td key={i} className="num t-rate" style={{ ['--r' as string]: r }}>{pct(r)}</td>)}
                      <td className="num">{u.avgLevel.toFixed(1)}</td>
                      <td className="num">{u.locksNow} · {u.studentsReset}명</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted" style={{ margin: '0.5rem 0 0' }}>통과율 = 그 단계를 통과한 학생 비율. 잠김은 마지막 초기화 이후 합계, 초기화는 5번 잠겨 단원 기록이 지워진 학생 수예요.</p>
          </div>
          <div className="panel t-wide">
            <h2>많이 틀린 문항</h2>
            {shownQ.length === 0 ? <p className="muted">없어요.</p> : (
              <ol className="cg-top-wrong">
                {shownQ.map((x) => {
                  const mq = course.mcqById(x.id);
                  return (
                    <li key={x.id}>
                      <span className="small muted">{x.id} · 틀린 학생 {x.students}명({pct(x.students / sum.n)}) · 오답노트에 남음 {x.active}명 · 틀린 횟수 {x.times}</span><br />
                      {mq?.question ?? x.id}
                      {mq && <><br /><b className="small">정답: {mq.options[mq.answer]}</b></>}
                    </li>
                  );
                })}
              </ol>
            )}
            {qstats.length > 8 && <button className="btn btn-small btn-quiet" onClick={() => setAllQ((v) => !v)}>{allQ ? '줄이기' : `더 보기(${Math.min(30, qstats.length)}개까지)`}</button>}
            <p className="small muted" style={{ margin: '0.5rem 0 0' }}>학생이 고른 보기는 저장하지 않아서 가장 많이 고른 오답은 보여 줄 수 없어요.</p>
          </div>
        </div>
      )}
      <div className="row">
        <input type="search" placeholder="이름·이메일 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="학생 검색" />
        <button className="btn btn-small" onClick={csv} disabled={!list.length}>CSV 저장</button>
        <button className="btn btn-small btn-quiet" onClick={reload}>새로고침</button>
      </div>
      <div className="table-wrap">
        <table className="data cg-class">
          <thead><tr>
            {th('name', '이름')}<th scope="col">식물</th>{th('passed', '통과')}
            {units.map((u) => <th scope="col" key={u}>{u}</th>)}
            {th('mockBest', '모의 최고')}{th('wrong', '오답')}{th('locks', '잠김')}{th('lastAt', '최근 활동')}
          </tr></thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <th scope="row">
                  <button className="t-name" onClick={() => setOpen(s.id)} aria-haspopup="dialog">{s.name}</button><br />
                  <span className="small muted">{s.email}</span>
                </th>
                <td>{PLANT_STAGES[s.plant]}</td>
                <td>{s.passed}/{total}</td>
                {units.map((u) => <td key={u} className={`lv lv${s.levels[u]}`}>{s.levels[u]}</td>)}
                <td>{s.mockBest || '-'}</td>
                <td>{s.wrong}</td>
                <td>{lockSum(s)}{resetSum(s) ? ` · 초기화 ${resetSum(s)}` : ''}</td>
                <td>{fmt(s.lastAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">이름을 누르면 단원 × 단계 기록·잠김·모의고사·오답노트를 자세히 볼 수 있어요.</p>
      {sel && <CourseStudentDrawer course={course} s={sel} onClose={() => setOpen(null)} />}
    </div>
  );
}

function CourseStudentDrawer({ course, s, onClose }: { course: CourseConfig; s: CgStudent; onClose: () => void }) {
  const d = useMemo(() => studentDetail(s, course), [s, course]);
  return (
    <Drawer title={s.name} sub={`${s.email} · 최근 활동 ${fmt(s.lastAt)}`} onClose={onClose}>
      <div className="kpis">
        <div className="kpi"><b>{s.passed}/{course.totalSteps}</b><span>통과 단계</span></div>
        <div className="kpi"><b>{PLANT_STAGES[s.plant]}</b><span>식물</span></div>
        <div className="kpi"><b>{s.mockBest || '-'}</b><span>모의 최고</span></div>
        <div className="kpi"><b>{d.wrongActive}</b><span>오답노트(전체 {d.wrongTotal})</span></div>
      </div>
      <section>
        <h3>단원 × 단계</h3>
        <div className="table-wrap">
          <table className="data t-detail">
            <thead><tr><th scope="col">단원</th>{[1, 2, 3, 4, 5].map((lv) => <th scope="col" key={lv} title={CG_LEVEL_NAME[lv as CgLevel]}>{lv}단계</th>)}<th scope="col">카드</th><th scope="col">잠김</th><th scope="col">초기화</th></tr></thead>
            <tbody>
              {d.units.map((u) => (
                <tr key={u.unitId}>
                  <th scope="row" title={course.unitById(u.unitId)?.title}>{u.unitId}</th>
                  {u.levels.map((l) => (
                    <td key={l.lv} className={l.passed ? 't-pass' : l.lastAt ? 't-tried' : 't-none'} title={l.passedAt ? `통과 ${fmt(l.passedAt)}` : l.lastAt ? `마지막 시도 ${fmt(l.lastAt)}` : '기록 없음'}>
                      {l.passed ? '✓' : l.lastAt ? '…' : '·'}{l.best !== undefined && l.total ? ` ${l.best}/${l.total}` : ''}
                    </td>
                  ))}
                  <td className="num">{u.cards}</td>
                  <td className="num">{u.locks}/{LOCK_LIMIT}</td>
                  <td className="num" title={u.lastResetAt ? `마지막 초기화 ${fmt(u.lastResetAt)}` : undefined}>{u.resets || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ margin: '0.4rem 0 0' }}>✓ 통과 · … 시도했지만 아직 통과 전 · 숫자는 최고 점수/문항 수. 단계별 시도 횟수는 저장하지 않아요.</p>
      </section>
      <section>
        <h3>모의고사 ({d.mocks.length}회)</h3>
        {d.mocks.length === 0 ? <p className="muted small">아직 응시 기록이 없어요.</p> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th scope="col">날짜</th><th scope="col">종류</th><th scope="col">점수</th><th scope="col">걸린 시간</th></tr></thead>
              <tbody>
                {d.mocks.map((m) => (
                  <tr key={m.id}>
                    <td>{fmt(m.at)}</td>
                    <td>{MOCK_LABEL[m.kind as MockKind] ?? m.kind}{m.timeUp ? ' · 시간 종료' : ''}</td>
                    <td className="num">{m.score}/{m.total}</td>
                    <td className="num">{Math.round((m.seconds ?? 0) / 60)}분</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section>
        <h3>많이 틀린 문항</h3>
        {d.wrongTop.length === 0 ? <p className="muted small">없어요.</p> : (
          <ol className="cg-top-wrong">
            {d.wrongTop.map((w) => (
              <li key={w.id}>
                <span className="small muted">{w.id} · {w.n}번 틀림{w.active ? ' · 오답노트에 남음' : ' · 다시 맞힘'}</span><br />
                {course.mcqById(w.id)?.question ?? w.id}
              </li>
            ))}
          </ol>
        )}
      </section>
    </Drawer>
  );
}

interface DbRow { user_id: string; name: string | null; email: string | null; total_xp: number; activities: number; checkpoints: number; units: number; finals: number; last_activity: string | null }
const DB_TOTAL = { activities: 48, checkpoints: 36, units: 12, finals: 12 };
const dbLevel = (xp: number) => Math.min(99, Math.floor(xp / 100));

/** 데이터베이스 과목 반 현황(db_class_overview: 학생별 XP·활동·체크포인트·단원·최종 진단 수) */
export function DbClass() {
  const { rows, err, reload } = useRpc<DbRow>('db_class_overview');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => !t || (r.name ?? '').toLowerCase().includes(t) || (r.email ?? '').toLowerCase().includes(t));
  }, [rows, q]);
  if (err) return <p className="notice notice-warn" role="alert">불러오지 못했어요: {err}</p>;
  if (!rows) return <p role="status">불러오는 중…</p>;
  const n = rows.length;
  const avg = (k: keyof typeof DB_TOTAL) => (n ? rows.reduce((a, r) => a + r[k], 0) / n : 0);
  const avgXp = n ? rows.reduce((a, r) => a + r.total_xp, 0) / n : 0;
  const week = Date.now() - 7 * 24 * 3600 * 1000;
  const hist = Array.from({ length: 13 }, (_, i) => rows.filter((r) => r.units === i).length);
  const maxH = Math.max(1, ...hist);
  const last = rows.reduce<string | null>((a, r) => (r.last_activity && (!a || r.last_activity > a) ? r.last_activity : a), null);
  const csv = () => downloadText(`데이터베이스_반현황_${today()}.csv`, toCsv(
    ['이름', '이메일', 'XP', '레벨', '활동(/48)', '체크포인트(/36)', '단원 완료(/12)', '최종 진단(/12)', '최근 활동'],
    list.map((r) => [r.name ?? '', r.email ?? '', r.total_xp, dbLevel(r.total_xp), r.activities, r.checkpoints, r.units, r.finals, fmt(r.last_activity)]),
  ));
  const sel = open ? rows.find((r) => r.user_id === open) : undefined;
  return (
    <div className="stack">
      <div className="kpis">
        <div className="kpi"><b>{n}</b><span>학생</span></div>
        <div className="kpi"><b>{rows.filter((r) => r.last_activity && Date.parse(r.last_activity) >= week).length}</b><span>최근 7일 학습</span></div>
        <div className="kpi"><b>Lv{Math.floor(avgXp / 100)}</b><span>평균 레벨</span></div>
        <div className="kpi"><b>{rows.filter((r) => r.units >= 12).length}</b><span>12단원 모두 완료</span></div>
        <div className="kpi"><b className="kpi-small">{fmt(last)}</b><span>마지막 활동</span></div>
      </div>
      {n > 0 && (
        <div className="cg-result-cols">
          <div className="panel">
            <h2>평균 진도</h2>
            <table className="data"><tbody>
              {(Object.keys(DB_TOTAL) as (keyof typeof DB_TOTAL)[]).map((k) => (
                <tr key={k}>
                  <th scope="row">{{ activities: '활동', checkpoints: '체크포인트', units: '단원 완료', finals: '최종 진단' }[k]}</th>
                  <td className="num">{avg(k).toFixed(1)}/{DB_TOTAL[k]}</td>
                  <td><span className="cg-bar"><span style={{ width: `${(avg(k) / DB_TOTAL[k]) * 100}%` }} /></span></td>
                </tr>
              ))}
            </tbody></table>
          </div>
          <div className="panel">
            <h2>완료한 단원 수 분포</h2>
            <div className="t-hist" role="img" aria-label={hist.map((h, i) => `${i}단원 ${h}명`).join(', ')}>
              {hist.map((h, i) => (
                <div key={i} className="t-hist-col" title={`${i}단원 완료: ${h}명`}>
                  <span className="t-hist-n">{h || ''}</span>
                  <span className="t-hist-bar" style={{ height: `${(h / maxH) * 100}%` }} />
                  <span className="t-hist-x">{i}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="row">
        <input type="search" placeholder="이름·이메일 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="학생 검색" />
        <button className="btn btn-small" onClick={csv} disabled={!list.length}>CSV 저장</button>
        <button className="btn btn-small btn-quiet" onClick={reload}>새로고침</button>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th scope="col">이름</th><th scope="col">레벨(XP)</th><th scope="col">활동</th><th scope="col">체크포인트</th><th scope="col">단원 완료</th><th scope="col">최종 진단</th><th scope="col">최근 활동</th></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.user_id}>
                <th scope="row"><button className="t-name" onClick={() => setOpen(r.user_id)} aria-haspopup="dialog">{r.name || (r.email ?? '').split('@')[0]}</button><br /><span className="small muted">{r.email}</span></th>
                <td>Lv{dbLevel(r.total_xp)} ({r.total_xp.toLocaleString()})</td>
                <td>{r.activities}/48</td><td>{r.checkpoints}/36</td><td>{r.units}/12</td><td>{r.finals}/12</td>
                <td>{fmt(r.last_activity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">데이터베이스 과목은 서버가 학생별 합계(경험치·완료 수)만 알려 줘요. 단원별 세부 기록은 학생 기기에 있어요.</p>
      {sel && (
        <Drawer title={sel.name || (sel.email ?? '')} sub={`${sel.email ?? ''} · 최근 활동 ${fmt(sel.last_activity)}`} onClose={() => setOpen(null)}>
          <div className="kpis">
            <div className="kpi"><b>Lv{dbLevel(sel.total_xp)}</b><span>레벨</span></div>
            <div className="kpi"><b>{sel.total_xp.toLocaleString()}</b><span>XP</span></div>
          </div>
          <table className="data"><tbody>
            {(Object.keys(DB_TOTAL) as (keyof typeof DB_TOTAL)[]).map((k) => (
              <tr key={k}>
                <th scope="row">{{ activities: '활동', checkpoints: '체크포인트', units: '단원 완료', finals: '최종 진단' }[k]}</th>
                <td className="num">{sel[k]}/{DB_TOTAL[k]}</td>
                <td><span className="cg-bar"><span style={{ width: `${(sel[k] / DB_TOTAL[k]) * 100}%` }} /></span></td>
                <td className="num small muted">반 평균 {avg(k).toFixed(1)}</td>
              </tr>
            ))}
          </tbody></table>
        </Drawer>
      )}
    </div>
  );
}

