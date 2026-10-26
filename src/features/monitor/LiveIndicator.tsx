import { useId, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { isSupabaseConfigured } from '../../lib/config';
import { useAuth } from '../auth/AuthContext';
import { useReporterStatus, useSharing } from './liveStore';
import { useIsTeacher } from './useTeacher';

export const LIVE_TIP = '선생님이 지금 공부 중인 과목·단원·단계를 볼 수 있어요(화면 내용은 아님)';

/** 학생 상단바: 로그인해 있으면 항상 보이는 '학습 위치 공유 중' 표시(누르면 설명) */
export function LiveIndicator() {
  const auth = useAuth();
  const status = useReporterStatus();
  const sharing = useSharing();
  const [open, setOpen] = useState(false);
  const tipId = useId();
  if (auth.identity?.kind !== 'user' || !isSupabaseConfigured || status === 'unavailable') return null;
  return (
    <span className="live-flag-wrap">
      <button
        type="button"
        className={`live-flag${sharing ? ' sharing' : ''}`}
        title={LIVE_TIP}
        aria-expanded={open}
        aria-describedby={tipId}
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      >
        <span className="live-dot" aria-hidden="true" />
        학습 위치 공유 중
      </button>
      <span id={tipId} role="tooltip" className={`live-tip${open ? ' open' : ''}`}>{LIVE_TIP}</span>
    </span>
  );
}

/** 선생님 계정에만 보이는 '선생님 화면' 링크(과목 탭을 연다). 권한은 서버가 다시 확인한다 */
export function TeacherLink({ subject }: { subject?: string }) {
  const teacher = useIsTeacher();
  if (!teacher) return null;
  return <NavLink to={subject ? `/teacher?s=${subject}` : '/teacher'} className="teacher-link">선생님 화면</NavLink>;
}
