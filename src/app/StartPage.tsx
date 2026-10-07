import { Link, useLocation } from 'react-router-dom';
import { Garden } from '../components/Garden';
import { InAppNotice } from '../components/InAppNotice';
import { useAuth } from '../features/auth/AuthContext';
import { isDemoEnabled, isSupabaseConfigured } from '../lib/config';

export function StartPage() {
  const auth = useAuth();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/garden';
  return (
    <div className="page">
      <InAppNotice />
      <p className="crumbs" style={{ margin: 0 }}><Link to="/">과목 선택</Link> / 데이터베이스</p>
      <section className="hero">
        <div className="stack">
          <h1>작은 씨앗으로 시작해 나만의 SQL 숲을 키워보세요.</h1>
          <p>SQL을 처음 배우는 학생을 위한 SQLD 입문 코스예요. 12단원에서 표를 직접 연결하고, 묶고, 순위를 매기며 실제 SQL을 실행해요. 배울 때마다 정원이 레벨 0 씨앗에서 레벨 99 숲으로 자라요.</p>
          {auth.authError && (
            <div className="notice notice-warn" role="alert">
              로그인을 마치지 못했어요: {auth.authError}. 다시 시도해 주세요. 입력하던 초안은 이 기기에 남아 있어요.
              <button className="btn btn-small btn-quiet" onClick={auth.clearError}>닫기</button>
            </div>
          )}
          {auth.expired && <div className="notice notice-warn">로그인이 만료되었어요. 다시 로그인하면 이어서 저장돼요. 이 기기의 초안은 보존했어요.</div>}
          <div className="row">
            {isSupabaseConfigured ? (
              <button className="btn btn-primary" onClick={() => void auth.signIn(from)}>Google 계정으로 시작</button>
            ) : (
              <Link className="btn btn-primary" to="/setup">Google 로그인 설정 필요</Link>
            )}
            {isDemoEnabled && (
              <button className="btn" onClick={auth.startDemo} title="개발용: 이 브라우저에만 저장되고 운영 데이터와 분리돼요">
                개발 데모로 시작
              </button>
            )}
            <Link className="btn btn-quiet" to="/playground">로그인 없이 자유 실습장</Link>
          </div>
          {isDemoEnabled && <p className="small muted">개발 데모는 개발 환경에서만 보이며, 진도는 이 브라우저에만 저장돼요(운영 사용자 데이터와 분리).</p>}
        </div>
        <div className="growth-strip" aria-label="성장 미리보기">
          {[0, 25, 65, 99].map((l) => (
            <figure key={l}>
              <Garden level={l} small />
              <figcaption>Lv{l}</figcaption>
            </figure>
          ))}
        </div>
      </section>
      <div className="facts">
        <div className="panel">
          <h3>약 6시간, 12단원</h3>
          <p className="small">휴식을 뺀 예상 시간이에요. 다시 도전하는 만큼 더 걸릴 수 있고, 시간만으로 완료되지는 않아요.</p>
        </div>
        <div className="panel">
          <h3>힌트를 써도 괜찮아요</h3>
          <p className="small">힌트·오답으로 경험치가 줄지 않아요. 기본 모드만으로 레벨 99까지 갈 수 있어요.</p>
        </div>
        <div className="panel">
          <h3>집중모드</h3>
          <p className="small">학습 중 다른 탭이나 창으로 이동해 이 창의 포커스가 사라지면 화면을 가리고 시간·실행을 멈춰요. 돌아와 "학습 계속하기"를 누르면 이어져요. 다른 프로그램이 열려 있는지는 알 수 없고 감시하지 않아요.</p>
        </div>
        <div className="panel">
          <h3>레벨 99의 의미</h3>
          <p className="small">과정 전체를 경험했다는 뜻이에요. SQLD 합격이나 완전한 숙달을 보장하지 않아요.</p>
        </div>
      </div>
      <p className="small muted" style={{ marginTop: '1.5rem' }}><Link to="/about">개인정보·저장 방식·도구의 한계 안내</Link></p>
    </div>
  );
}

export function SetupPage() {
  return (
    <div className="page page-narrow stack">
      <h1>로그인 설정이 필요해요</h1>
      <p>이 배포에는 Supabase 연결 정보(VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY)가 없어 Google 로그인을 쓸 수 없어요. 관리자(선생님)가 저장소의 docs/12_SETUP_GUIDE.md와 README의 순서대로 설정하면 로그인이 열려요.</p>
      <ol>
        <li>Supabase 프로젝트를 만들고 supabase/migrations의 SQL을 적용합니다.</li>
        <li>Supabase Auth에서 Google provider를 켜고, Google Cloud의 웹 OAuth 클라이언트 redirect URI에 Supabase callback URL을 등록합니다.</li>
        <li>Supabase의 Site URL·Redirect URL에 앱 주소(예: https://OWNER.github.io/REPO/)와 http://localhost:5173/ 을 등록합니다.</li>
        <li>GitHub 저장소 Variables에 VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY를 넣고 다시 배포합니다.</li>
      </ol>
      <p className="small muted">service_role(secret) 키나 Google client secret은 이 앱이나 저장소에 넣지 않아요.</p>
      <div className="row"><Link className="btn" to="/playground">로그인 없이 자유 실습장 쓰기</Link><Link className="btn btn-quiet" to="/">처음으로</Link></div>
    </div>
  );
}

export function AboutPage() {
  return (
    <div className="page page-narrow stack">
      <h1>저장 방식과 도구의 한계</h1>
      <h2>무엇을 저장하나요</h2>
      <p>Google 로그인 사용자는 진도, SQL 초안, 활동 시간, 경험치 원장, 배지, 진단 답안을 Supabase에 저장해요. 학번·실명은 받지 않고, Google 계정의 이름·이메일만 로그인에 쓰여요. 다른 사이트 목록이나 화면 캡처는 저장하지 않아요. 같은 내용을 이 브라우저에도 임시로 보관해 오프라인에서도 이어갈 수 있어요.</p>
      <h2>SQL 실습은 어디서 실행되나요</h2>
      <p>모든 SQL 실습은 이 브라우저 안의 SQLite(WebAssembly) Worker에서만 실행돼요. 학습용 SQL을 서버로 보내 실행하지 않아요.</p>
      <h2>집중모드의 범위</h2>
      <p>이 창이 숨겨지거나 포커스를 잃으면 화면을 가리고 멈춰요. 웹앱은 다른 프로그램 목록, 다른 탭의 주소, 분할 화면의 다른 창, 두 번째 모니터를 알 수 없어요. 감시·차단 기능이 아니고, 일시정지에 벌점은 없어요. 화면이 숨겨지는 순간 운영체제가 보여준 마지막 화면까지 지울 수 있다고 보장하지 않아요.</p>
      <h2>신뢰 경계</h2>
      <p>학습용 앱이라 채점은 브라우저에서 이뤄지고, 서버는 보상 ID 중복과 선행 조건만 확인해요. 시험 보안 시스템이나 출석 증거가 아니에요.</p>
      <h2>데이터 삭제</h2>
      <p>나의 정원 화면 아래 "내 학습 기록 지우기"로 본인 기록을 지울 수 있어요. 계정 자체 삭제는 운영 관리자에게 요청하세요.</p>
      <Link className="btn" to="/">처음으로</Link>
    </div>
  );
}
