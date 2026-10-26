import { readFileSync } from 'node:fs';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * 실시간 학습 위치(live_status)·화면 공유(screen_share) RPC를 실제 Postgres 엔진(PGlite)에서 검사한다.
 * Supabase 방식(authenticated 역할 + JWT sub)을 흉내 내며, 실제 Supabase 프로젝트 검증은 별도.
 */
const S1 = '11111111-1111-1111-1111-111111111111';
const S2 = '22222222-2222-2222-2222-222222222222';
const T = '33333333-3333-3333-3333-333333333333'; // 선생님(인증된 이메일 + Google)
const FAKE = '44444444-4444-4444-4444-444444444444'; // 선생님 이메일이지만 미인증
const EMAILPW = '55555555-5555-5555-5555-555555555555'; // 선생님 이메일 + 인증됐지만 Google이 아님
const T2 = '66666666-6666-6666-6666-666666666666'; // 다른 선생님
let db: PGlite;

async function as<R>(uid: string | null, fn: (tx: Transaction) => Promise<R>): Promise<R> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
    return fn(tx);
  });
}
const one = async <T,>(uid: string | null, sql: string, params: unknown[] = []) => as(uid, async (tx) => (await tx.query<T>(sql, params)).rows[0]);
const report = (uid: string | null, state: unknown) => as(uid, (tx) => tx.query('select public.report_live_status($1::jsonb)', [JSON.stringify(state)]));
const live = (uid: string | null, minutes?: number | null) =>
  as(uid, async (tx) => (await tx.query<{ user_id: string; name: string; email: string; state: Record<string, unknown> }>(
    minutes === undefined ? 'select * from public.class_live_status()' : 'select * from public.class_live_status($1)', minutes === undefined ? [] : [minutes])).rows);
const request = async (uid: string, student: string) => (await one<{ id: string }>(uid, 'select public.request_screen($1) as id', [student])).id;
const getScreen = (uid: string, id: string) => one<{ status: string; offer: string | null }>(uid, 'select * from public.get_screen($1)', [id]);
const answer = async (uid: string, id: string, sdp: string) => (await one<{ s: string }>(uid, 'select public.answer_screen($1, $2) as s', [id, sdp])).s;
const myRequest = (uid: string) => as(uid, async (tx) => (await tx.query<{ id: string; teacher_name: string }>('select * from public.my_screen_request()')).rows);
const respond = async (uid: string, id: string, accept: boolean) => (await one<{ s: string }>(uid, 'select public.respond_screen($1, $2) as s', [id, accept])).s;
const offer = async (uid: string, id: string, sdp: string) => (await one<{ s: string }>(uid, 'select public.offer_screen($1, $2) as s', [id, sdp])).s;
const getAnswer = (uid: string, id: string) => one<{ status: string; answer: string | null }>(uid, 'select * from public.get_screen_answer($1)', [id]);
const endScreen = (uid: string, id: string) => as(uid, (tx) => tx.query('select public.end_screen($1)', [id]));
/** 관리자 시점(테스트 확인용): 행 그대로 */
const row = async (id: string) => (await db.query<{ status: string; offer: string | null; answer: string | null }>('select status, offer, answer from public.screen_share where id = $1', [id])).rows[0];

const SDP_OFFER = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n';
const SDP_ANSWER = 'v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\ns=-\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n';
const STATE = { v: 1, subject: 'cg', path: '/computer/unit/U3/3', unit: 'U3', step: '3', label: '3단원 · 3단계 기초 객관식', detail: '문항 7/20', focus: 'learning', fs: true, locks: 1 };

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync('tests/db/supabase-shim.sql', 'utf8'));
  for (const f of ['20261001000000_sql_forest_v2.sql', '20261007000000_computer_general.sql', '20261015000000_unit_reset.sql', '20261016000000_unit_reset_stages.sql', '20261026000000_courses.sql']) {
    await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
  }
  const m = readFileSync('supabase/migrations/20261026010000_monitoring.sql', 'utf8');
  await db.exec(m);
  await db.exec(m); // 재적용 안전(멱등)
  await db.exec(`insert into private.teachers(email) values ('teacher@school.example'), ('t2@school.example') on conflict do nothing`);
  await db.query(
    `insert into auth.users(id, email, email_confirmed_at) values
      ($1, 's1@gmail.com', now()), ($2, 's2@school.example', now()), ($3, 'teacher@school.example', now()),
      ($4, 'teacher@school.example', null), ($5, 'teacher@school.example', now()), ($6, 't2@school.example', now())`,
    [S1, S2, T, FAKE, EMAILPW, T2],
  );
  await db.query(
    `insert into auth.identities(user_id, provider, identity_data) values
      ($1, 'google', '{"email":"s1@gmail.com","full_name":"가온"}'),
      ($2, 'google', '{"email":"s2@school.example","name":"나래"}'),
      ($3, 'google', '{"email":"teacher@school.example","full_name":"김선생"}'),
      ($4, 'google', '{"email":"teacher@school.example"}'),
      ($5, 'email', '{"email":"teacher@school.example"}'),
      ($6, 'google', '{"email":"t2@school.example","full_name":"이선생"}')`,
    [S1, S2, T, FAKE, EMAILPW, T2],
  );
}, 60000);

describe('live_status: 학생은 자기 위치만 보낸다', () => {
  it('보내면 한 행을 덮어쓴다(이력 없음), 시각은 서버가 정한다', async () => {
    await report(S1, { ...STATE, detail: '문항 6/20' });
    await report(S1, STATE);
    const rows = await db.query<{ n: number; detail: string; fresh: boolean }>(
      `select count(*) over ()::int as n, state->>'detail' as detail, updated_at > now() - interval '1 minute' as fresh from public.live_status where user_id = $1`, [S1]);
    expect(rows.rows).toEqual([{ n: 1, detail: '문항 7/20', fresh: true }]);
  });
  it('형식이 틀리거나 크거나 모르는 항목이 있으면 거부', async () => {
    await expect(report(S2, [1, 2])).rejects.toThrow(/형식이 올바르지/);
    await expect(report(S2, { v: 1 })).rejects.toThrow(/형식이 올바르지/); // focus 없음
    await expect(report(S2, { ...STATE, focus: 'cheating' })).rejects.toThrow(/형식이 올바르지/);
    await expect(report(S2, { ...STATE, screen: 'data:image/png;base64,AAAA' })).rejects.toThrow(/형식이 올바르지/);
    await expect(report(S2, { ...STATE, label: 'x'.repeat(121) })).rejects.toThrow(/형식이 올바르지/);
    await expect(report(S2, { ...STATE, path: 'x'.repeat(201) })).rejects.toThrow(/형식이 올바르지/);
    await expect(report(S2, { ...STATE, locks: 100 })).rejects.toThrow(/형식이 올바르지/);
    await expect(report(S2, { ...STATE, fs: 'yes' })).rejects.toThrow(/형식이 올바르지/);
    await expect(report(S2, { ...STATE, detail: 'x'.repeat(81) })).rejects.toThrow(/형식이 올바르지/);
    await expect(report(S2, { ...STATE, dev: 'Bad Device!' })).rejects.toThrow(/형식이 올바르지/);
    // 표 제약도 4KB를 막는다(직접 넣을 수 있는 관리자 경로도)
    await expect(db.query(`insert into public.live_status(user_id, state) values ($1, $2::jsonb)`, [S2, JSON.stringify({ big: 'x'.repeat(5000) })])).rejects.toThrow(/check constraint/);
    await report(S2, { v: 1, focus: 'menu', subject: null, unit: null, step: null, detail: null, locks: null, fs: false, sharing: false, path: '/', label: '과목 선택' });
  });
  it('학생은 테이블에 직접 접근할 수 없다(읽기·쓰기·삭제), 비로그인은 RPC도 불가', async () => {
    await expect(as(S1, (tx) => tx.query('select * from public.live_status'))).rejects.toThrow(/permission denied/);
    await expect(as(S1, (tx) => tx.query(`insert into public.live_status(user_id, state) values ($1, '{"focus":"menu"}')`, [S2]))).rejects.toThrow(/permission denied/);
    await expect(as(S1, (tx) => tx.query(`update public.live_status set state = '{}'`))).rejects.toThrow(/permission denied/);
    await expect(as(S1, (tx) => tx.query(`delete from public.live_status`))).rejects.toThrow(/permission denied/);
    await expect(report(null, STATE)).rejects.toThrow(/permission denied/);
    await expect(as(null, (tx) => tx.query('select * from public.live_status'))).rejects.toThrow(/permission denied/);
    await expect(as(S1, (tx) => tx.query(`select private.live_state_ok('{}'::jsonb)`))).rejects.toThrow(/permission denied/);
  });
  it('학생·가짜 선생님(미인증·Google 아님)은 반 상태를 읽을 수 없다', async () => {
    await expect(live(S1)).rejects.toThrow(/선생님 계정만/);
    await expect(live(FAKE)).rejects.toThrow(/선생님 계정만/);
    await expect(live(EMAILPW)).rejects.toThrow(/선생님 계정만/);
    await expect(live(null)).rejects.toThrow(/permission denied/);
  });
  it('선생님은 최근 갱신된 학생들의 위치를 이름·이메일과 함께 읽는다', async () => {
    const rows = await live(T);
    const byId = Object.fromEntries(rows.map((r) => [r.user_id, r]));
    expect(Object.keys(byId).sort()).toEqual([S1, S2]);
    expect(byId[S1]).toMatchObject({ name: '가온', email: 's1@gmail.com', state: STATE });
    expect(byId[S2]).toMatchObject({ name: '나래', state: { focus: 'menu' } });
  });
  it('조회 범위(1~240분) 밖은 거부, 오래된 행은 범위에 따라 빠진다', async () => {
    await expect(live(T, 0)).rejects.toThrow(/1~240/);
    await expect(live(T, 241)).rejects.toThrow(/1~240/);
    await expect(live(T, null)).rejects.toThrow(/1~240/);
    await db.query(`update public.live_status set updated_at = now() - interval '30 minutes' where user_id = $1`, [S2]);
    expect((await live(T)).map((r) => r.user_id)).toEqual([S1]); // 기본 10분
    expect((await live(T, 60)).map((r) => r.user_id).sort()).toEqual([S1, S2]);
    expect((await live(T, 1)).map((r) => r.user_id)).toEqual([S1]);
  });
});

describe('live_status: 여러 기기', () => {
  const S3 = '77777777-7777-7777-7777-777777777777';
  const focusOf = async () => (await db.query<{ f: string; dev: string }>(`select state->>'focus' as f, state->>'dev' as dev from public.live_status where user_id = $1`, [S3])).rows[0];
  beforeAll(async () => {
    await db.query(`insert into auth.users(id, email, email_confirmed_at) values ($1, 's3@school.example', now())`, [S3]);
  });
  it('다른 기기의 자리 비움 보고는 45초 안의 학습 중 보고를 덮어쓰지 않는다', async () => {
    await report(S3, { ...STATE, dev: 'phone1', focus: 'learning' });
    await report(S3, { ...STATE, dev: 'pc1', focus: 'hidden' });
    expect(await focusOf()).toEqual({ f: 'learning', dev: 'phone1' });
    await report(S3, { ...STATE, dev: 'pc1', focus: 'idle' });
    expect(await focusOf()).toEqual({ f: 'learning', dev: 'phone1' });
    // 다른 기기라도 학습 중 보고는 덮어쓴다
    await report(S3, { ...STATE, dev: 'pc1', focus: 'menu' });
    expect(await focusOf()).toEqual({ f: 'menu', dev: 'pc1' });
  });
  it('같은 기기의 자리 비움, 45초가 지난 뒤의 다른 기기 자리 비움은 덮어쓴다', async () => {
    await report(S3, { ...STATE, dev: 'pc1', focus: 'hidden' });
    expect(await focusOf()).toEqual({ f: 'hidden', dev: 'pc1' });
    await report(S3, { ...STATE, dev: 'phone1', focus: 'learning' });
    await db.query(`update public.live_status set updated_at = now() - interval '50 seconds' where user_id = $1`, [S3]);
    await report(S3, { ...STATE, dev: 'pc1', focus: 'hidden' });
    expect(await focusOf()).toEqual({ f: 'hidden', dev: 'pc1' });
  });
});

describe('screen_share: 학생이 허락할 때만', () => {
  let id = '';
  it('학생·가짜 선생님은 요청할 수 없다, 자기 자신·없는 사용자도 불가', async () => {
    await expect(request(S1, S2)).rejects.toThrow(/선생님 계정만/);
    await expect(request(FAKE, S1)).rejects.toThrow(/선생님 계정만/);
    await expect(request(EMAILPW, S1)).rejects.toThrow(/선생님 계정만/);
    await expect(request(T, T)).rejects.toThrow(/학생을 찾을 수 없어요/);
    await expect(request(T, '99999999-9999-9999-9999-999999999999')).rejects.toThrow(/학생을 찾을 수 없어요/);
    await expect(as(null, (tx) => tx.query('select public.request_screen($1)', [S1]))).rejects.toThrow(/permission denied/);
  });
  it('요청 → 학생에게만 보이고(선생님 이름), 다른 학생에게는 보이지 않는다', async () => {
    id = await request(T, S1);
    expect(await myRequest(S1)).toEqual([{ id, teacher_name: '김선생' }]);
    expect(await myRequest(S2)).toEqual([]);
    expect(await getScreen(T, id)).toEqual({ status: 'requested', offer: null });
  });
  it('테이블에 직접 접근할 수 없다', async () => {
    await expect(as(S1, (tx) => tx.query('select * from public.screen_share'))).rejects.toThrow(/permission denied/);
    await expect(as(T, (tx) => tx.query('select * from public.screen_share'))).rejects.toThrow(/permission denied/);
    await expect(as(T, (tx) => tx.query(`update public.screen_share set status = 'answered'`))).rejects.toThrow(/permission denied/);
  });
  it('다른 학생·다른 선생님은 그 요청을 보거나 바꿀 수 없다', async () => {
    await expect(respond(S2, id, true)).rejects.toThrow(/찾을 수 없어요/);
    await expect(getAnswer(S2, id)).rejects.toThrow(/찾을 수 없어요/);
    await expect(endScreen(S2, id)).rejects.toThrow(/찾을 수 없어요/);
    await expect(getScreen(T2, id)).rejects.toThrow(/찾을 수 없어요/);
    await expect(getScreen(S1, id)).rejects.toThrow(/찾을 수 없어요/); // 학생은 선생님용 조회 불가
  });
  it('허락 전에는 제안할 수 없고, 선생님은 제안(offer)할 수 없고, 학생은 응답(answer)할 수 없다', async () => {
    await expect(offer(S1, id, SDP_OFFER)).rejects.toThrow(/제안할 수 없어요/);
    expect(await respond(S1, id, true)).toBe('accepted');
    await expect(respond(S1, id, true)).rejects.toThrow(/이미 응답한/);
    await expect(offer(T, id, SDP_OFFER)).rejects.toThrow(/찾을 수 없어요/);
    await expect(answer(S1, id, SDP_ANSWER)).rejects.toThrow(/찾을 수 없어요/);
    await expect(answer(T, id, SDP_ANSWER)).rejects.toThrow(/응답할 수 없어요/); // 아직 offer 전
    expect(await myRequest(S1)).toEqual([]); // 응답한 요청은 더 이상 '요청'이 아님
  });
  it('연결 정보는 32KB 이하의 SDP만', async () => {
    await expect(offer(S1, id, 'hello')).rejects.toThrow(/연결 정보 형식/);
    await expect(offer(S1, id, `v=0\r\n${'a'.repeat(33000)}`)).rejects.toThrow(/연결 정보 형식/);
  });
  it('제안 → 선생님이 읽고 응답 → 학생이 응답을 읽는다', async () => {
    expect(await offer(S1, id, SDP_OFFER)).toBe('offered');
    await expect(offer(S1, id, SDP_OFFER)).rejects.toThrow(/제안할 수 없어요/);
    expect(await getAnswer(S1, id)).toEqual({ status: 'offered', answer: null });
    expect(await getScreen(T, id)).toEqual({ status: 'offered', offer: SDP_OFFER });
    expect(await answer(T, id, SDP_ANSWER)).toBe('answered');
    expect(await getAnswer(S1, id)).toEqual({ status: 'answered', answer: SDP_ANSWER });
    expect(await getScreen(T, id)).toEqual({ status: 'answered', offer: null });
  });
  it('어느 쪽이든 끝내면 연결 정보를 지운다(여러 번 불러도 안전)', async () => {
    await endScreen(S1, id);
    expect(await row(id)).toEqual({ status: 'ended', offer: null, answer: null });
    await endScreen(T, id);
    expect(await getScreen(T, id)).toEqual({ status: 'ended', offer: null });
    expect(await getAnswer(S1, id)).toEqual({ status: 'ended', answer: null });
    expect(await offer(S1, id, SDP_OFFER)).toBe('ended');
    expect(await answer(T, id, SDP_ANSWER)).toBe('ended');
    expect(await respond(S1, id, true)).toBe('ended');
  });
  it('거절하면 declined(연결 정보 없음)', async () => {
    const r = await request(T, S2);
    expect(await respond(S2, r, false)).toBe('declined');
    expect(await getScreen(T, r)).toEqual({ status: 'declined', offer: null });
    await expect(offer(S2, r, SDP_OFFER)).resolves.toBe('declined');
    expect(await row(r)).toEqual({ status: 'declined', offer: null, answer: null });
  });
  it('같은 선생님의 새 요청은 앞 요청을 끝내고, 학생 한 명에게 열린 공유는 하나뿐', async () => {
    const a = await request(T, S1);
    await respond(S1, a, true);
    await offer(S1, a, SDP_OFFER);
    const b = await request(T, S1);
    expect(await row(a)).toEqual({ status: 'ended', offer: null, answer: null });
    expect(await myRequest(S1)).toEqual([{ id: b, teacher_name: '김선생' }]);
    // 다른 선생님은 열린 공유가 있는 동안 요청할 수 없다
    await expect(request(T2, S1)).rejects.toThrow(/다른 선생님이/);
    const n = await db.query<{ n: number }>(`select count(*)::int as n from public.screen_share where student_id = $1 and status in ('requested','accepted','offered','answered')`, [S1]);
    expect(n.rows[0].n).toBe(1);
    await endScreen(T, b);
    const c = await request(T2, S1);
    expect(await myRequest(S1)).toEqual([{ id: c, teacher_name: '이선생' }]);
    await endScreen(T2, c);
  });
  it('요청은 2분이 지나면 무시되고, 응답하려 하면 끝난다', async () => {
    const r = await request(T, S2);
    await db.query(`update public.screen_share set created_at = now() - interval '3 minutes', updated_at = now() - interval '3 minutes' where id = $1`, [r]);
    expect(await myRequest(S2)).toEqual([]);
    expect(await respond(S2, r, true)).toBe('ended');
    expect(await row(r)).toEqual({ status: 'ended', offer: null, answer: null });
  });
  it('만료된 요청은 다른 선생님의 새 요청을 막지 않는다', async () => {
    const r = await request(T, S2);
    await db.query(`update public.screen_share set created_at = now() - interval '3 minutes' where id = $1`, [r]);
    const r2 = await request(T2, S2);
    expect(await row(r)).toEqual({ status: 'ended', offer: null, answer: null });
    await endScreen(S2, r2);
  });
  it('수락(화면 고르는 중)·제안 상태는 3분이 지나면 끝나 다른 선생님을 오래 막지 않는다', async () => {
    const r = await request(T, S2);
    await respond(S2, r, true);
    await db.query(`update public.screen_share set updated_at = now() - interval '2 minutes 30 seconds' where id = $1`, [r]);
    await expect(request(T2, S2)).rejects.toThrow(/다른 선생님이/); // 아직 3분 전
    await db.query(`update public.screen_share set updated_at = now() - interval '4 minutes' where id = $1`, [r]);
    const r2 = await request(T2, S2);
    expect(await row(r)).toEqual({ status: 'ended', offer: null, answer: null });
    await respond(S2, r2, true);
    await offer(S2, r2, SDP_OFFER);
    await db.query(`update public.screen_share set updated_at = now() - interval '4 minutes' where id = $1`, [r2]);
    expect(await getScreen(T2, r2)).toEqual({ status: 'ended', offer: null });
  });
  it('만료된 열린 행의 연결 정보는 아무 화면 공유 RPC에서나 지워진다(당사자가 다시 오지 않아도)', async () => {
    const r = await request(T, S1);
    await respond(S1, r, true);
    await offer(S1, r, SDP_OFFER);
    await db.query(`update public.screen_share set updated_at = now() - interval '5 minutes' where id = $1`, [r]);
    expect((await row(r)).offer).toBe(SDP_OFFER);
    await myRequest(S2); // 다른 학생의 요청 확인만으로도 정리
    expect(await row(r)).toEqual({ status: 'ended', offer: null, answer: null });
  });
  it('1시간 넘게 변화가 없는 공유는 끝난 것으로 보고 연결 정보를 지운다', async () => {
    const r = await request(T, S1);
    await respond(S1, r, true);
    await offer(S1, r, SDP_OFFER);
    await answer(T, r, SDP_ANSWER);
    await db.query(`update public.screen_share set updated_at = now() - interval '61 minutes' where id = $1`, [r]);
    expect(await getAnswer(S1, r)).toEqual({ status: 'ended', answer: null });
    expect(await row(r)).toEqual({ status: 'ended', offer: null, answer: null });
    // 끝난 행에는 연결 정보를 다시 넣을 수 없다(표 제약)
    await expect(db.query(`update public.screen_share set offer = 'v=0 x' where id = $1`, [r])).rejects.toThrow(/check constraint/);
  });
  it('끝난 지 하루가 지난 행은 다음 화면 공유 RPC 때 정리된다', async () => {
    await db.query(`update public.screen_share set updated_at = now() - interval '2 days' where status in ('ended','declined')`);
    await myRequest(S1);
    const n = await db.query<{ n: number }>(`select count(*)::int as n from public.screen_share`);
    expect(n.rows[0].n).toBe(0);
    const r = await request(T, S2);
    await endScreen(T, r);
  });
  it('선생님 자격을 잃으면 요청·조회·응답을 못 하지만 끝내기는 할 수 있다', async () => {
    const r = await request(T2, S1);
    await db.exec(`delete from private.teachers where email = 't2@school.example'`);
    await expect(getScreen(T2, r)).rejects.toThrow(/찾을 수 없어요/);
    await expect(answer(T2, r, SDP_ANSWER)).rejects.toThrow(/찾을 수 없어요/);
    await expect(request(T2, S2)).rejects.toThrow(/선생님 계정만/);
    await endScreen(T2, r);
    expect(await row(r)).toEqual({ status: 'ended', offer: null, answer: null });
    await db.exec(`insert into private.teachers(email) values ('t2@school.example')`);
  });
  it('도우미 함수는 클라이언트가 직접 부를 수 없다', async () => {
    await expect(as(S1, (tx) => tx.query(`select private.screen_close($1)`, [S1]))).rejects.toThrow(/permission denied/);
    await expect(as(T, (tx) => tx.query(`select private.sdp_ok('v=0')`))).rejects.toThrow(/permission denied/);
    await expect(as(T, (tx) => tx.query(`select private.screen_live('requested', now(), now())`))).rejects.toThrow(/permission denied/);
  });
  it('비로그인은 학생용 RPC도 부를 수 없다', async () => {
    await expect(as(null, (tx) => tx.query('select * from public.my_screen_request()'))).rejects.toThrow(/permission denied/);
    await expect(as(null, (tx) => tx.query('select public.end_screen($1)', [S1]))).rejects.toThrow(/permission denied/);
  });
});
