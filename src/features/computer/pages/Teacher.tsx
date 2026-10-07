import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PLANT_STAGES } from '../../../components/Plant';
import { supabase } from '../../auth/supabase';
import { CG_MCQ_BY_ID, CG_UNIT_BY_ID } from '../content';
import { TOTAL_STEPS } from '../model';
import { useCg } from '../store';
import { classSummary, downloadText, toCsv, toStudents, type CgClassRow, type CgStudent } from '../teacher';
import { CG_PASS, CG_UNIT_IDS } from '../types';

/** 선생님 반 학습 현황: 지정된 선생님 계정만(서버 RPC가 다시 확인). 읽기 전용. */
export function TeacherPage() {
  const cg = useCg();
  const [tab, setTab] = useState<'cg' | 'db'>('cg');
  if (!cg.isTeacher) {
    return (
      <div className="stack">
        <p className="notice">선생님 계정만 볼 수 있는 화면이에요.</p>
        <Link className="btn" to="/computer">컴퓨터 일반 홈</Link>
      </div>
    );
  }
  return (
    <div className="stack">
      <p className="crumbs" style={{ margin: 0 }}><Link to="/computer">컴퓨터 일반</Link> / 반 학습 현황</p>
      <h1 style={{ margin: 0 }}>반 학습 현황</h1>
      <div className="seg" role="tablist" aria-label="과목">
        <button role="tab" aria-selected={tab === 'cg'} className={tab === 'cg' ? 'on' : ''} onClick={() => setTab('cg')}>컴퓨터 일반</button>
        <button role="tab" aria-selected={tab === 'db'} className={tab === 'db' ? 'on' : ''} onClick={() => setTab('db')}>데이터베이스</button>
      </div>
      {tab === 'cg' ? <CgClass /> : <DbClass />}
      <p className="small muted">점수는 학생 브라우저가 저장한 자기 학습 기록이라 조작될 수 있어요. 평가 근거가 아니라 학습 지원용으로 활용해 주세요. 새로고침할 때마다 학생 수만큼 읽어요.</p>
    </div>
  );
}

type SortKey = 'name' | 'passed' | 'mockBest' | 'wrong' | 'lastAt';
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');

function useRpc<T>(fn: string) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const sb = supabase();
    if (!sb) return setErr('로그인 설정이 없어요.');
    let alive = true;
    setRows(null);
    sb.rpc(fn).then(({ data, error }) => {
      if (!alive) return;
      if (error) setErr(error.message);
      else setRows((data ?? []) as T[]);
    });
    return () => {
      alive = false;
    };
  }, [fn, tick]);
  return { rows, err, reload: () => setTick((t) => t + 1) };
}

function CgClass() {
  const { rows, err, reload } = useRpc<CgClassRow>('cg_class_overview');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ k: SortKey; desc: boolean }>({ k: 'lastAt', desc: true });
  const students = useMemo(() => (rows ? toStudents(rows) : []), [rows]);
  const sum = useMemo(() => classSummary(students), [students]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const f = t ? students.filter((s) => s.name.toLowerCase().includes(t) || s.email.toLowerCase().includes(t)) : students;
    const val = (s: CgStudent) => (sort.k === 'name' ? s.name : s[sort.k]);
    return [...f].sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ko');
      return sort.desc ? -c : c;
    });
  }, [students, q, sort]);
  if (err) return <p className="notice notice-warn">불러오지 못했어요: {err}</p>;
  if (!rows) return <p role="status">불러오는 중…</p>;
  const th = (k: SortKey, label: string) => (
    <th scope="col" aria-sort={sort.k === k ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button className="btn-quiet thsort" onClick={() => setSort((s) => ({ k, desc: s.k === k ? !s.desc : k !== 'name' }))}>{label}{sort.k === k ? (sort.desc ? ' ▼' : ' ▲') : ''}</button>
    </th>
  );
  const csv = () => downloadText(`컴퓨터일반_반현황_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(
    ['이름', '이메일', '식물', `통과(/${TOTAL_STEPS})`, ...CG_UNIT_IDS.map((u) => `${u} 레벨`), '모의 최고', '오답', '최근 활동'],
    list.map((s) => [s.name, s.email, PLANT_STAGES[s.plant], s.passed, ...CG_UNIT_IDS.map((u) => s.levels[u]), s.mockBest, s.wrong, fmt(s.lastAt)]),
  ));
  return (
    <div className="stack">
      <div className="kpis">
        <div className="kpi"><b>{sum.n}</b><span>학생</span></div>
        <div className="kpi"><b>{sum.active7}</b><span>최근 7일 학습</span></div>
        <div className="kpi"><b>{sum.avgPassed.toFixed(1)}</b><span>평균 통과 단계(/{TOTAL_STEPS})</span></div>
        <div className="kpi"><b>{sum.mockPassed}</b><span>모의고사 {CG_PASS.mock.need}점 이상 경험</span></div>
      </div>
      <div className="cg-result-cols">
        <div className="panel">
          <h2>단원별 평균 레벨</h2>
          <table className="data"><tbody>
            {CG_UNIT_IDS.map((u) => (
              <tr key={u}><th scope="row">{u.replace('U', '')}. {CG_UNIT_BY_ID[u]?.title}</th><td>{sum.unitAvg[u].toFixed(1)}/5</td>
                <td><span className="cg-bar"><span style={{ width: `${(sum.unitAvg[u] / 5) * 100}%` }} /></span></td></tr>
            ))}
          </tbody></table>
        </div>
        <div className="panel">
          <h2>오답노트에 많이 남은 문항</h2>
          {sum.topWrong.length === 0 ? <p className="muted">없어요.</p> : (
            <ol className="cg-top-wrong">
              {sum.topWrong.map(([id, n]) => {
                const mq = CG_MCQ_BY_ID[id];
                return (
                  <li key={id}>
                    <span className="small muted">{n}명 · {mq?.unitId.replace('U', '')}단원</span><br />
                    {mq?.question ?? id}
                    {mq && <><br /><b className="small">정답: {mq.options[mq.answer]}</b></>}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
      <div className="row">
        <input type="search" placeholder="이름·이메일 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="학생 검색" />
        <button className="btn btn-small" onClick={csv} disabled={!list.length}>CSV 저장</button>
        <button className="btn btn-small btn-quiet" onClick={reload}>새로고침</button>
      </div>
      <div className="table-wrap">
        <table className="data cg-class">
          <thead><tr>
            {th('name', '이름')}<th scope="col">식물</th>{th('passed', '통과')}
            {CG_UNIT_IDS.map((u) => <th scope="col" key={u}>{u}</th>)}
            {th('mockBest', '모의 최고')}{th('wrong', '오답')}{th('lastAt', '최근 활동')}
          </tr></thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <th scope="row"><span title={s.email}>{s.name}</span><br /><span className="small muted">{s.email}</span></th>
                <td>{PLANT_STAGES[s.plant]}</td>
                <td>{s.passed}/{TOTAL_STEPS}</td>
                {CG_UNIT_IDS.map((u) => <td key={u} className={`lv lv${s.levels[u]}`}>{s.levels[u]}</td>)}
                <td>{s.mockBest || '-'}</td>
                <td>{s.wrong}</td>
                <td>{fmt(s.lastAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface DbRow { user_id: string; name: string | null; email: string | null; total_xp: number; activities: number; checkpoints: number; units: number; finals: number; last_activity: string | null }

function DbClass() {
  const { rows, err, reload } = useRpc<DbRow>('db_class_overview');
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => !t || (r.name ?? '').toLowerCase().includes(t) || (r.email ?? '').toLowerCase().includes(t));
  }, [rows, q]);
  if (err) return <p className="notice notice-warn">불러오지 못했어요: {err}</p>;
  if (!rows) return <p role="status">불러오는 중…</p>;
  const n = rows.length;
  const avgXp = n ? rows.reduce((a, r) => a + r.total_xp, 0) / n : 0;
  const csv = () => downloadText(`데이터베이스_반현황_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(
    ['이름', '이메일', 'XP', '레벨', '활동(/48)', '체크포인트(/36)', '단원 완료(/12)', '최종 진단(/12)', '최근 활동'],
    list.map((r) => [r.name ?? '', r.email ?? '', r.total_xp, Math.min(99, Math.floor(r.total_xp / 100)), r.activities, r.checkpoints, r.units, r.finals, fmt(r.last_activity)]),
  ));
  return (
    <div className="stack">
      <div className="kpis">
        <div className="kpi"><b>{n}</b><span>학생</span></div>
        <div className="kpi"><b>Lv{Math.floor(avgXp / 100)}</b><span>평균 레벨</span></div>
        <div className="kpi"><b>{rows.filter((r) => r.units >= 12).length}</b><span>12단원 모두 완료</span></div>
      </div>
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
                <th scope="row">{r.name}<br /><span className="small muted">{r.email}</span></th>
                <td>Lv{Math.min(99, Math.floor(r.total_xp / 100))} ({r.total_xp.toLocaleString()})</td>
                <td>{r.activities}/48</td><td>{r.checkpoints}/36</td><td>{r.units}/12</td><td>{r.finals}/12</td>
                <td>{fmt(r.last_activity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
