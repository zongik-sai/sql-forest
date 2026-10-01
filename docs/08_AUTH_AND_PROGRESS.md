# Google 로그인·진도 저장

## 인증
Supabase Google OAuth, PKCE redirect/callback을 구현한다. 기본 scope는 openid/email/profile이며 Drive 등 추가 권한은 요청하지 않는다. 세션 초기화 중에는 로딩 상태를 보여주고, 로그인 이후 본인 데이터만 읽는다. 로그인 실패·취소·세션 만료는 입력 초안을 보존하며 재시도 경로를 제공한다.

## 최소 테이블
- profiles: user_id(uuid PK→auth.users), display_name, created_at. 학번·실명 필수 수집은 하지 않는다.
- unit_progress: user_id, unit_id, content_version, status, completed_activity_ids, checkpoint_score, updated_at. UNIQUE(user_id,unit_id,content_version).
- activity_progress: user_id, activity_id, content_version, state_json, draft_sql, attempts, hint_level, completion_kind, active_seconds, revision, updated_at. UNIQUE(user_id,activity_id,content_version).
- learning_sessions: id, user_id, started_at, ended_at, active_seconds. 상세 타 사이트 목록이나 화면 캡처는 저장하지 않는다.
- assessment_attempts: id, user_id, type, content_version, answers_json, score, submitted_at.

스키마 타입·제약조건·인덱스·RLS는 실제 SQL migration으로 생성한다. 모든 사용자 테이블에 RLS를 활성화하고 SELECT/INSERT/UPDATE/DELETE에 `auth.uid()=user_id`를 적용한다. UPDATE는 USING과 WITH CHECK 모두 적용한다. 사용자 변경 가능한 컬럼에 권한/role을 넣지 않는다. 본인 progress만 export 가능하다.

## 저장 정책
활동 제출·완료·단원 이동은 즉시 저장, 에디터 입력은 1초 debounce. 학습 초안은 localStorage/IndexedDB에도 사용자 ID+콘텐츠 버전별로 보관한다. 숨김 전 동기적으로 초안을 로컬 기록하며 네트워크 저장은 best effort다. 온라인 재접속 시 재전송한다. 저장 상태는 저장 중/저장됨/로컬 보관/재시도 필요로 표시한다.

서버 revision 기반 compare-and-set 또는 RPC로 동시 편집 충돌을 감지한다. 동일 활동을 두 기기에서 수정한 경우 자동 덮어쓰기 대신 더 최신 서버본/로컬 초안을 선택하도록 한다. 완료 활동 집합은 단조 증가 합집합, 활성 학습 시간은 고유 세션별 증가량으로 중복 합산을 방지한다. 컴퓨터 시각 변경으로 시간을 부풀리지 않도록 performance.now() 기반 delta를 사용한다.

로그아웃 시 메모리의 사용자 데이터와 접근 가능한 로컬 캐시를 제거한다. 다른 사용자 로그인 시 이전 학생의 진도를 보여주지 않는다. 데이터 삭제 경로와 보관 정책을 운영 안내에 적는다. 이 앱은 자격 평가 보안 시스템이 아니며 클라이언트 기록을 변조 불가능한 출석 증거로 사용하지 않는다.


## v2 성장 저장 추가
reward_catalog(reward_id PK, xp, entitlement_version, prerequisite_type), xp_events(user_id,reward_id,entitlement_version,awarded_at; unique user_id+reward_id+entitlement_version), badge_awards(user_id,badge_id,awarded_at; unique user_id+badge_id), mastery_progress(user_id,challenge_id,status)를 추가한다. xp_events의 authenticated 직접 INSERT/UPDATE/DELETE 권한은 제거하고 본인 SELECT만 허용한다. reward_catalog는 읽기 전용이다.
award_xp RPC는 auth.uid()가 없으면 거부하고 user_id/XP를 클라이언트 인자로 받지 않는다. SECURITY DEFINER 사용 시 search_path를 고정하고 객체를 schema qualify하며 PUBLIC 실행 권한을 제거하고 authenticated에만 부여한다. 선행 조건 확인과 보상 원장 INSERT를 같은 트랜잭션에서 수행한다. badge도 같은 멱등 지급 규칙을 적용한다. 레벨은 원장 합계에서 계산하고 profiles의 임의 숫자를 믿지 않는다. 서버가 클라이언트 채점 제출을 수용하는 교육용 신뢰 경계는 운영 문서에 적는다.
