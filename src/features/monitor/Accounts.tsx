import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import {
  defaultFilter, filterCounts, FILTER_LABEL, FILTER_ORDER, grantBlock, KIND_LABEL, matchFilter, matchQuery, parsedText, REASON_LABEL, sortAccounts, toAccount,
  type Account, type AccountFilter, type AccountSort,
} from '../auth/accountKind';
import { rpcErrorText, type AccountsApi, type RoleAction, type RoleAuditRow } from './api';
import { forgetTeacher } from './useTeacher';

/**
 * 선생님 화면 '계정 관리' 탭. 선생님은 모든 계정을 구분(관리자·교사·학생·확인 필요)과 함께 읽기만 하고,
 * 관리자만 교사·관리자를 지정·해제한다(서버 set_teacher·set_admin이 다시 확인, 모든 변경은 권한 변경 기록에 남음).
 * 학번은 이메일(학번 형식)에서 읽어 보여 줄 뿐 따로 저장하지 않는다.
 */
const AUDIT_LIMIT = 20;
const dateText = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric' }) : '-');
const timeText = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');

const ACTION_LABEL: Record<RoleAction, string> = { grant_teacher: '교사로 지정', revoke_teacher: '교사 해제', grant_admin: '관리자로 지정', revoke_admin: '관리자 해제' };

interface Pending {
  action: RoleAction;
  account: Account;
}

/** 확인 창에 보여 줄 효과(무엇이 바뀌는지) */
function effectText(p: Pending, me: string | null): string {
  const self = p.account.id === me;
  switch (p.action) {
    case 'grant_teacher':
      return '이 계정은 선생님 화면(모든 학생의 학습 기록·실시간 학습 위치·계정 목록)을 볼 수 있게 돼요.';
    case 'revoke_teacher':
      return `이 계정은 선생님 화면을 더 이상 볼 수 없어요.${p.account.kind === 'admin' ? ' 관리자 권한도 함께 해제돼요.' : ''}${self ? ' 내 계정이라 해제하면 바로 이 화면을 쓸 수 없어요.' : ''}`;
    case 'grant_admin':
      return '이 계정은 다른 계정을 교사·관리자로 지정하거나 해제할 수 있게 돼요.';
    case 'revoke_admin':
      return `교사 권한은 그대로 남고, 권한을 바꾸는 버튼만 사라져요.${self ? ' 내 계정이에요.' : ''}`;
  }
}

export function AccountsPanel({ api }: { api: AccountsApi }) {
  const auth = useAuth();
  const me = auth.identity?.kind === 'user' ? auth.identity.userId : null;
  const [rows, setRows] = useState<Account[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);
  const [audit, setAudit] = useState<RoleAuditRow[] | null>(null);
  const [auditErr, setAuditErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<AccountFilter | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<AccountSort>('kind');
  const [pending, setPending] = useState<Pending | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [lostAccess, setLostAccess] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    setErr(null);
    void Promise.all([
      api.list().then(
        (r) => {
          if (!alive) return;
          const list = r.map(toAccount);
          setRows(list);
          // 처음 필터는 처음 불러올 때 한 번만 정한다(확인 필요가 있으면 그것, 없으면 전체)
          setFilter((f) => f ?? defaultFilter(list));
        },
        (e) => alive && setErr(rpcErrorText('account_list', e)),
      ),
      api.amIAdmin().then((a) => alive && setAdmin(a)),
      api.audit(AUDIT_LIMIT).then(
        (r) => {
          if (!alive) return;
          setAudit(r);
          setAuditErr(null);
        },
        (e) => alive && setAuditErr(rpcErrorText('role_audit_list', e)),
      ),
    ]);
    return () => {
      alive = false;
    };
  }, [api, tick]);

  // 알림은 4초 뒤 사라짐
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const counts = useMemo(() => filterCounts(rows ?? []), [rows]);
  const adminCount = counts.admin;
  const shownFilter: AccountFilter = filter ?? 'all';
  const list = useMemo(
    () => sortAccounts((rows ?? []).filter((a) => matchFilter(a, shownFilter) && matchQuery(a, q)), sort),
    [rows, shownFilter, q, sort],
  );

  const run = async (p: Pending) => {
    const on = p.action.startsWith('grant');
    const changed = p.action.endsWith('teacher') ? await api.setTeacher(p.account.id, on) : await api.setAdmin(p.account.id, on);
    setPending(null);
    setToast(changed ? `${p.account.name} 계정: ${ACTION_LABEL[p.action]}했어요.` : `${p.account.name} 계정은 이미 그 상태예요(바뀐 것 없음).`);
    if (changed && p.action === 'revoke_teacher' && p.account.id === me) {
      // 내 교사 권한을 해제함 → 이 화면의 자료를 더 읽지 않는다
      if (me) forgetTeacher(me);
      setLostAccess(true);
      setRows(null);
      return;
    }
    reload();
  };

  if (lostAccess) {
    return (
      <div className="stack">
        <p className="notice notice-warn" role="alert">내 교사 권한을 해제했어요. 이 화면을 다시 열면 선생님 화면이 보이지 않아요.</p>
        <Toast text={toast} />
      </div>
    );
  }
  if (err) return <p className="notice notice-warn" role="alert">불러오지 못했어요: {err}</p>;
  if (!rows) return <p role="status">계정 목록을 불러오는 중…</p>;

  return (
    <div className="stack acc">
      <p className="muted" style={{ margin: 0 }}>
        로그인한 적 있는 모든 계정이에요. 학번은 학교 학생 계정 이메일(연도 4자리 + 학번 5자리)에서 읽어 보여 줄 뿐 따로 저장하지 않아요.
        학번 형식이 아니거나 Google 로그인·이메일 인증이 안 된 계정은 '확인 필요'로 보여요.
      </p>
      {admin ? (
        <p className="notice small" style={{ margin: 0 }}>관리자는 교사·관리자를 지정하거나 해제할 수 있어요. 학생 계정(학번 형식)은 교사·관리자로 지정할 수 없어 버튼이 없어요. 바꾼 내용은 아래 '권한 변경 기록'에 남아요.</p>
      ) : (
        <p className="notice small" style={{ margin: 0 }}>권한 변경은 관리자만 할 수 있어요.</p>
      )}
      <div className="acc-filters" role="group" aria-label="구분 필터">
        {FILTER_ORDER.map((f) => (
          <button key={f} className={`acc-filter${shownFilter === f ? ' on' : ''}`} aria-pressed={shownFilter === f} onClick={() => setFilter(f)}>
            {FILTER_LABEL[f]} <span className="acc-count">{counts[f]}</span>
          </button>
        ))}
      </div>
      <div className="row acc-tools">
        <input type="search" placeholder="이름·이메일·학번 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="계정 검색" />
        <label className="small">정렬{' '}
          <select value={sort} onChange={(e) => setSort(e.target.value as AccountSort)}>
            <option value="kind">구분·학번순</option>
            <option value="name">이름순</option>
            <option value="recent">최근 로그인순</option>
            <option value="created">가입일순</option>
          </select>
        </label>
        <button className="btn btn-small btn-quiet" onClick={reload}>새로고침</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>교사 수에는 관리자도 들어 있어요(관리자는 교사 중에서 지정).</p>
      {list.length === 0 ? (
        <p className="notice">조건에 맞는 계정이 없어요.</p>
      ) : (
        <div className="table-wrap acc-wrap">
          <table className="data acc-table" aria-label="계정 목록">
            <thead>
              <tr>
                <th scope="col">구분</th><th scope="col">이름</th><th scope="col">이메일</th><th scope="col">학번(연도·학번)</th>
                <th scope="col">가입일</th><th scope="col">마지막 로그인</th><th scope="col">학습 기록</th>
                {admin && <th scope="col">권한</th>}
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} data-kind={a.kind}>
                  <Cell label="구분">
                    <span className={`acc-kind kind-${a.kind}`}>{KIND_LABEL[a.kind]}</span>
                    {a.reason && <span className="acc-reason small">{REASON_LABEL[a.reason]}</span>}
                  </Cell>
                  <th scope="row" data-label="이름"><div className="acc-v">{a.name}{a.id === me ? ' (나)' : ''}</div></th>
                  <Cell label="이메일" className="acc-email">{a.email || '-'}</Cell>
                  <Cell label="학번">
                    {a.sid ? <><span className="acc-sid">{a.sid.year} · {a.sid.no}</span>{parsedText(a.sid) && <span className="acc-sid-p small muted">{parsedText(a.sid)}</span>}</> : '-'}
                  </Cell>
                  <Cell label="가입일" className="acc-date">{dateText(a.createdAt)}</Cell>
                  <Cell label="마지막 로그인" className="acc-date">{timeText(a.lastSignInAt)}</Cell>
                  <Cell label="학습 기록">{a.hasProgress ? '있음' : '없음'}</Cell>
                  {admin && <Cell label="권한" className="acc-actions"><RowActions a={a} me={me} adminCount={adminCount} onPick={setPending} /></Cell>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <section className="panel acc-audit" aria-labelledby="acc-audit-h">
        <h2 id="acc-audit-h">권한 변경 기록</h2>
        {auditErr ? <p className="small muted" role="alert">기록을 불러오지 못했어요: {auditErr}</p> : !audit ? <p className="small muted" role="status">불러오는 중…</p> : audit.length === 0 ? (
          <p className="small muted">아직 기록이 없어요.</p>
        ) : (
          <ol className="acc-audit-list">
            {audit.map((r, i) => (
              <li key={`${r.at}-${i}`}>
                <span className="small muted">{timeText(r.at)}</span>{' '}
                <b>{r.actor ? r.actor_name || r.actor_email || '관리자' : '처음 적용(자동)'}</b> → {r.target_name || r.target_email || '-'}
                {r.target_email && r.target_name && r.target_name !== r.target_email && <span className="small muted"> ({r.target_email})</span>}
                : <span className={`acc-act act-${r.action}`}>{ACTION_LABEL[r.action] ?? r.action}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="small muted" style={{ margin: '0.4rem 0 0' }}>최근 {AUDIT_LIMIT}건까지 보여요. 처음 적용(자동)은 서버 설정 때 이미 등록된 선생님을 관리자로 옮긴 기록이에요.</p>
      </section>
      {pending && <ConfirmDialog p={pending} me={me} onCancel={() => setPending(null)} onConfirm={run} />}
      <Toast text={toast} />
    </div>
  );
}

/** 표 칸: 휴대폰에서는 '이름표 | 값' 두 칸 카드 줄이 되도록 값을 한 덩어리로 감싼다 */
function Cell({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return <td data-label={label} className={className}><div className="acc-v">{children}</div></td>;
}

function Toast({ text }: { text: string | null }) {
  return (
    <div className="toasts acc-toasts" role="status" aria-live="polite">
      {text && <div className="toast">{text}</div>}
    </div>
  );
}

/** 한 계정의 권한 버튼(관리자만). 학생 계정(학번 형식)에는 버튼이 없다 */
function RowActions({ a, me, adminCount, onPick }: { a: Account; me: string | null; adminCount: number; onPick: (p: Pending) => void }) {
  if (a.sid) return <span className="small muted" title="학생 계정(학번 형식)은 교사·관리자로 지정할 수 없어요">학생 계정 · 지정 불가</span>;
  const lastAdmin = a.kind === 'admin' && adminCount <= 1;
  const lastTitle = '마지막 관리자는 해제할 수 없어요. 다른 관리자를 먼저 지정해 주세요.';
  const btn = (action: RoleAction, extra: { disabled?: boolean; title?: string } = {}) => (
    <button key={action} className={`btn btn-small${action.startsWith('revoke') ? ' acc-revoke' : ''}`} disabled={extra.disabled} title={extra.title}
      onClick={() => onPick({ action, account: a })} aria-label={`${a.name} ${ACTION_LABEL[action]}`}>
      {ACTION_LABEL[action]}
    </button>
  );
  if (a.kind === 'admin') {
    return (
      <div className="acc-btns">
        {btn('revoke_admin', { disabled: lastAdmin, title: lastAdmin ? lastTitle : undefined })}
        {btn('revoke_teacher', { disabled: lastAdmin, title: lastAdmin ? lastTitle : undefined })}
        {lastAdmin && <span className="small muted">마지막 관리자{a.id === me ? '(나)' : ''}</span>}
      </div>
    );
  }
  if (a.kind === 'teacher') return <div className="acc-btns">{btn('grant_admin')}{btn('revoke_teacher')}</div>;
  const block = grantBlock(a);
  return (
    <div className="acc-btns">
      {btn('grant_teacher', { disabled: !!block, title: block ?? undefined })}
      {block && <span className="small muted">{block}</span>}
    </div>
  );
}

/** 앱 안 확인 창: 어떤 계정에 무엇이 바뀌는지 보여 주고, 확인해야 바꾼다 */
function ConfirmDialog({ p, me, onCancel, onConfirm }: { p: Pending; me: string | null; onCancel: () => void; onConfirm: (p: Pending) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(false);
  // 부모가 다시 그려져도(목록·기록 불러오기) 포커스가 튀지 않게 열릴 때 한 번만 등록
  const cancelFn = useRef(onCancel);
  useEffect(() => {
    cancelFn.current = onCancel;
  });
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) cancelFn.current();
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      prev?.focus?.();
    };
  }, []);
  // Tab이 창 밖으로 나가지 않게
  const trap = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>('button:not([disabled])')];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  const go = async () => {
    setBusy(true);
    busyRef.current = true;
    setErr(null);
    try {
      await onConfirm(p);
    } catch (e) {
      setErr(rpcErrorText(p.action.endsWith('teacher') ? 'set_teacher' : 'set_admin', e));
      setBusy(false);
      busyRef.current = false;
    }
  };
  const revoke = p.action.startsWith('revoke');
  return (
    <div className="monitor-modal-back acc-modal-back" onClick={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div ref={box} className="monitor-modal acc-modal" role="dialog" aria-modal="true" aria-labelledby="acc-dlg-title" aria-describedby="acc-dlg-desc" onKeyDown={trap}>
        <h2 id="acc-dlg-title">{ACTION_LABEL[p.action]}</h2>
        <div id="acc-dlg-desc" className="stack" style={{ gap: '0.4rem' }}>
          <p style={{ margin: 0 }}>
            <b>{p.account.name}</b>{p.account.id === me ? ' (나)' : ''}<br />
            <span className="small acc-email">{p.account.email}</span>
          </p>
          <p style={{ margin: 0 }}>{ACTION_LABEL[p.action]}할까요? {effectText(p, me)}</p>
          <p className="small muted" style={{ margin: 0 }}>바꾼 내용은 권한 변경 기록에 남아요.</p>
        </div>
        {err && <p className="notice notice-bad small" role="alert" style={{ margin: '0.6rem 0 0' }}>{err}</p>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: '0.9rem' }}>
          <button ref={cancel} className="btn" onClick={onCancel} disabled={busy}>취소</button>
          <button className={`btn btn-primary${revoke ? ' acc-danger' : ''}`} onClick={() => void go()} disabled={busy}>
            {busy ? '바꾸는 중…' : ACTION_LABEL[p.action]}
          </button>
        </div>
      </div>
    </div>
  );
}
