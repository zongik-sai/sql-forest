import { useState } from 'react';
import { useAuth } from './AuthContext';

/**
 * 로그아웃 버튼(데이터베이스 상단·과목 선택 화면).
 * 컴퓨터 일반·네트워크·프로그래밍·Data 중 서버에 아직 저장되지 않은 기록이 있으면 바로 지우지 않고 먼저 알린다
 * (로그아웃하면 이 기기의 기록 사본을 지우기 때문).
 */
export function LogoutButton() {
  const auth = useAuth();
  const [warn, setWarn] = useState(false);
  const out = async (force = false) => {
    if (await auth.signOut(force)) setWarn(false);
    else setWarn(true);
  };
  return (
    <>
      <button className="btn btn-small btn-quiet" onClick={() => void out()}>로그아웃</button>
      {warn && (
        <div className="notice notice-warn row cg-unsaved" role="alert">
          <span>아직 서버에 저장되지 않은 과목 기록이 있어요(인터넷 연결 확인). 그 과목 화면을 한 번 열면 다시 저장돼요. 지금 로그아웃하면 이 기기의 기록이 지워져요.</span>
          <button className="btn btn-small btn-quiet" onClick={() => void out(true)}>그래도 로그아웃</button>
          <button className="btn btn-small btn-quiet" onClick={() => setWarn(false)}>취소</button>
        </div>
      )}
    </>
  );
}
