import { useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * '학생 계정만' 보기(선생님 화면의 과목별 반 현황·데이터베이스 반 현황·실시간 모니터링 공통).
 * 이메일이 학생 계정(학번 형식)인 사람만 통계·표·CSV에 넣어 선생님 테스트 계정 등이 섞이지 않게 한다.
 * 처음 값: 지금 자료에 학생 계정이 하나라도 있으면 켬, 없으면 끔(모두 숨겨지지 않게) + 계정 관리에서 확인하라는 안내.
 * 선생님이 직접 바꾸면 그 값을 쓴다.
 */
export function useOnlyStudents(hasStudents: boolean): [boolean, (v: boolean) => void] {
  const [pick, setPick] = useState<boolean | null>(null);
  return [pick ?? hasStudents, setPick];
}

export function OnlyStudentsToggle({ on, set, hidden, none, scope }: {
  on: boolean;
  set: (v: boolean) => void;
  /** 켰을 때 빠지는(학번 형식이 아닌) 사람 수 */
  hidden: number;
  /** 자료는 있는데 학생 계정 형식이 하나도 없음 */
  none: boolean;
  /** 무엇에서 빼는지(예: '통계·표·CSV') */
  scope: string;
}) {
  return (
    <div className="row t-only-row">
      <label className="small t-only"><input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /> 학생 계정만</label>
      <span className="small muted">
        {on ? (hidden > 0 ? `학생 계정(학번 형식)이 아닌 ${hidden}명은 ${scope}에서 뺐어요.` : `${scope}에 학생 계정(학번 형식)만 넣어요.`) : '모든 계정(선생님 테스트 계정 포함)을 넣었어요.'}
      </span>
      {none && (
        <p className="notice notice-warn small t-only-none">
          학생 계정 형식(연도+학번 9자리)으로 확인된 계정이 없어요. <Link to="/teacher?s=accounts">계정 관리</Link>에서 확인해 주세요.
        </p>
      )}
    </div>
  );
}
