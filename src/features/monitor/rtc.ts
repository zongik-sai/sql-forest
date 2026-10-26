import { rpcErrorText, type MonitorApi, type ScreenStatus } from './api';

/**
 * 학생이 허락할 때만 하는 화면 공유(WebRTC). 영상은 브라우저끼리 직접 오가고 서버를 거치지 않으며 녹화·저장하지 않는다.
 * 서버(RPC)는 연결 정보(SDP) 한 번씩만 전달하고, 끝나면 지운다.
 * 흐름: 선생님 request_screen → 학생 허락(브라우저 자체 선택 창 getDisplayMedia) → 학생 offer(ICE를 다 모은 뒤 한 번에, 최대 4초)
 *   → 선생님이 1초마다 확인해 answer → 학생이 1초마다 확인해 연결. 연결 뒤에는 3초마다 상대가 끝냈는지 확인.
 * 한계: TURN 서버가 없어 일부 네트워크(대칭형 NAT 등)에서는 연결되지 않는다 → 15초 뒤 안내.
 */
export const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
export const FAIL_TEXT = '연결하지 못했어요(학교 네트워크 설정 때문일 수 있어요)';

interface Timing {
  /** 연결 전 확인 간격(기본 1초) */
  pollMs?: number;
  /** 연결 뒤 확인 간격(기본 3초) */
  livePollMs?: number;
  /** 연결 정보를 보낸 뒤 이 시간 안에 연결되지 않으면 실패(기본 15초) */
  connectMs?: number;
  /** ICE 모으기 최대 시간(기본 4초) */
  iceMs?: number;
  makePc?: () => RTCPeerConnection;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const defaultPc = () => new RTCPeerConnection({ iceServers: ICE_SERVERS });

/** 트리클 없이: ICE 후보를 다 모으거나(complete) 시간이 다 될 때까지 기다린다 */
export function waitIceComplete(pc: RTCPeerConnection, ms = 4000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(t);
      pc.removeEventListener('icegatheringstatechange', on);
      resolve();
    };
    const on = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const t = setTimeout(done, ms);
    pc.addEventListener('icegatheringstatechange', on);
  });
}

type Listener<S> = (s: S) => void;
class Observable<S> {
  private ls = new Set<Listener<S>>();
  constructor(public state: S) {}
  subscribe(fn: Listener<S>) {
    this.ls.add(fn);
    return () => {
      this.ls.delete(fn);
    };
  }
  protected set(p: Partial<S>) {
    this.state = { ...this.state, ...p };
    this.ls.forEach((l) => l(this.state));
  }
}

/* ---------------- 선생님 ---------------- */

export type ViewerPhase = 'requesting' | 'waiting' | 'choosing' | 'connecting' | 'live' | 'declined' | 'ended' | 'expired' | 'failed' | 'error';
export interface ViewerState { phase: ViewerPhase; stream: MediaStream | null; message: string | null }
const VIEWER_DONE: ViewerPhase[] = ['declined', 'ended', 'expired', 'failed', 'error'];

export class ViewerSession extends Observable<ViewerState> {
  id: string | null = null;
  private pc: RTCPeerConnection | null = null;
  private closed = false;
  private wasLive = false;

  constructor(private api: MonitorApi, private studentId: string, private t: Timing & { requestTtlMs?: number } = {}) {
    super({ phase: 'requesting', stream: null, message: null });
  }

  get done() {
    return VIEWER_DONE.includes(this.state.phase);
  }

  async start(): Promise<void> {
    try {
      this.id = await this.api.requestScreen(this.studentId);
    } catch (e) {
      this.set({ phase: 'error', message: rpcErrorText('request_screen', e) });
      return;
    }
    if (this.closed) {
      void this.api.endScreen(this.id).catch(() => {});
      return;
    }
    this.set({ phase: 'waiting' });
    const started = Date.now();
    let answeredAt = 0;
    let misses = 0;
    while (!this.closed) {
      let r: { status: ScreenStatus; offer: string | null };
      try {
        r = await this.api.getScreen(this.id);
        misses = 0;
      } catch (e) {
        if (++misses >= 5) return this.finish('error', rpcErrorText('get_screen', e));
        await sleep(this.t.pollMs ?? 1000);
        continue;
      }
      if (this.closed) return;
      if (r.status === 'requested') {
        if (Date.now() - started > (this.t.requestTtlMs ?? 120_000)) return this.finish('expired', '학생이 2분 안에 응답하지 않았어요.');
      } else if (r.status === 'accepted') {
        if (this.state.phase === 'waiting') this.set({ phase: 'choosing' });
      } else if (r.status === 'offered') {
        if (!this.pc && r.offer) {
          try {
            await this.answer(r.offer);
          } catch (e) {
            return this.finish('error', rpcErrorText('answer_screen', e));
          }
          answeredAt = Date.now();
        }
      } else if (r.status === 'answered') {
        if (!this.wasLive && answeredAt && Date.now() - answeredAt > (this.t.connectMs ?? 15_000)) return this.finish('failed', FAIL_TEXT);
      } else if (r.status === 'declined') {
        return this.finish('declined', '학생이 화면 공유를 거절했어요.');
      } else {
        return this.finish('ended', this.wasLive ? '학생이 화면 공유를 멈췄어요.' : '화면 공유가 끝났어요.');
      }
      if (this.done) return;
      await sleep(this.state.phase === 'live' ? this.t.livePollMs ?? 3000 : this.t.pollMs ?? 1000);
    }
  }

  private async answer(offer: string) {
    const pc = (this.t.makePc ?? defaultPc)();
    this.pc = pc;
    pc.ontrack = (ev) => this.set({ stream: ev.streams[0] ?? new MediaStream([ev.track]) });
    pc.onconnectionstatechange = () => {
      if (this.closed) return;
      if (pc.connectionState === 'connected') {
        this.wasLive = true;
        this.set({ phase: 'live', message: null });
      } else if (pc.connectionState === 'failed') {
        this.finish(this.wasLive ? 'ended' : 'failed', this.wasLive ? '연결이 끊겼어요.' : FAIL_TEXT);
      }
    };
    await pc.setRemoteDescription({ type: 'offer', sdp: offer });
    await pc.setLocalDescription(await pc.createAnswer());
    await waitIceComplete(pc, this.t.iceMs ?? 4000);
    if (this.closed) return this.finish('ended', null);
    const st = await this.api.answerScreen(this.id!, pc.localDescription!.sdp);
    if (st !== 'answered') return this.finish('ended', '화면 공유가 끝났어요.');
    if (this.state.phase !== 'live') this.set({ phase: 'connecting' });
  }

  /** 끝내기: 연결은 언제나 닫고, 상태·서버 정리는 한 번만 */
  private finish(phase: ViewerPhase, message: string | null) {
    this.pc?.close();
    this.pc = null;
    if (this.closed) return;
    this.closed = true;
    this.set({ phase, message, stream: null });
    if (this.id) void this.api.endScreen(this.id).catch(() => {});
  }

  /** 선생님이 '중지'를 누름(또는 화면을 떠남) */
  close() {
    if (this.closed) return;
    this.finish('ended', null);
  }
}

/* ---------------- 학생 ---------------- */

export type SharePhase = 'starting' | 'connecting' | 'live' | 'ended' | 'failed' | 'cancelled' | 'error';
export interface ShareState { phase: SharePhase; message: string | null }
const SHARE_DONE: SharePhase[] = ['ended', 'failed', 'cancelled', 'error'];

export class ShareSession extends Observable<ShareState> {
  private pc: RTCPeerConnection | null = null;
  private stream: MediaStream | null = null;
  private closed = false;
  private wasLive = false;

  constructor(
    private api: MonitorApi,
    public id: string,
    private o: Timing & {
      /** 화면 고르기(브라우저 선택 창). start()가 클릭 처리기 안에서 바로 부른다 */
      capture: () => Promise<MediaStream>;
      /** 선택 창이 열려 있는 동안 집중 학습 잠김을 세지 않게(끝낼 함수를 돌려줌) */
      grace?: () => () => void;
    },
  ) {
    super({ phase: 'starting', message: null });
  }

  get done() {
    return SHARE_DONE.includes(this.state.phase);
  }

  /** 클릭 처리기 안에서 바로 부른다(선택 창은 사용자 클릭이 있어야 열림) */
  async start(): Promise<void> {
    const endGrace = this.o.grace?.() ?? (() => {});
    let captureP: Promise<MediaStream>;
    try {
      captureP = this.o.capture();
    } catch (e) {
      captureP = Promise.reject(e);
    }
    const [m, r] = await Promise.allSettled([captureP, this.api.respond(this.id, true)]);
    endGrace();
    if (m.status === 'rejected') {
      const name = (m.reason as { name?: string } | null)?.name;
      return this.finish('cancelled', name === 'NotAllowedError' || name === 'AbortError' ? '화면 공유를 취소했어요.' : '화면 공유를 시작하지 못했어요.');
    }
    const stream = m.value;
    this.stream = stream;
    if (r.status === 'rejected' || r.value !== 'accepted') return this.finish('ended', '요청이 이미 끝났어요.');
    if (this.closed) return this.finish('ended', null);
    // 브라우저의 '공유 중지' 버튼(트랙 종료) → 공유 끝
    for (const tr of stream.getTracks()) tr.addEventListener('ended', () => this.close('화면 공유를 멈췄어요.'));
    const pc = (this.o.makePc ?? defaultPc)();
    this.pc = pc;
    for (const tr of stream.getTracks()) pc.addTrack(tr, stream);
    pc.onconnectionstatechange = () => {
      if (this.closed) return;
      if (pc.connectionState === 'connected') {
        this.wasLive = true;
        this.set({ phase: 'live', message: null });
      } else if (pc.connectionState === 'failed') {
        this.finish(this.wasLive ? 'ended' : 'failed', this.wasLive ? '연결이 끊겨 화면 공유를 멈췄어요.' : FAIL_TEXT);
      }
    };
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await waitIceComplete(pc, this.o.iceMs ?? 4000);
      if (this.closed) return this.finish('ended', null);
      this.set({ phase: 'connecting' });
      const st = await this.api.offerScreen(this.id, pc.localDescription!.sdp);
      if (st !== 'offered') return this.finish('ended', '선생님이 화면 보기를 끝냈어요.');
    } catch (e) {
      return this.finish('error', rpcErrorText('offer_screen', e));
    }
    const t0 = Date.now();
    let remoteSet = false;
    let misses = 0;
    while (!this.closed) {
      try {
        const a = await this.api.getAnswer(this.id);
        misses = 0;
        if (this.closed) return this.finish('ended', null);
        if (a.status === 'answered' && a.answer && !remoteSet) {
          remoteSet = true;
          await pc.setRemoteDescription({ type: 'answer', sdp: a.answer });
        } else if (a.status === 'ended' || a.status === 'declined') {
          return this.finish('ended', '선생님이 화면 보기를 끝냈어요.');
        }
      } catch {
        if (++misses >= 5) return this.finish('error', '서버에 연결하지 못해 화면 공유를 멈췄어요.');
      }
      if (!this.wasLive && Date.now() - t0 > (this.o.connectMs ?? 15_000)) return this.finish('failed', FAIL_TEXT);
      await sleep(this.wasLive ? this.o.livePollMs ?? 3000 : this.o.pollMs ?? 1000);
    }
  }

  /** 끝내기: 화면 스트림·연결은 언제나 멈추고, 상태·서버 정리는 한 번만 */
  private finish(phase: SharePhase, message: string | null) {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.pc?.close();
    this.pc = null;
    if (this.closed) return;
    this.closed = true;
    this.set({ phase, message });
    void this.api.endScreen(this.id).catch(() => {});
  }

  /** 학생이 '공유 중지'를 누름(또는 브라우저 중지 버튼) */
  close(message: string | null = '화면 공유를 멈췄어요.') {
    if (this.closed) return;
    this.finish('ended', message);
  }
}

/** 브라우저의 화면 선택 창. 탭·창을 공유해도 포커스가 이 학습 창에 머물게 한다(크롬 Conditional Focus, 지원하는 브라우저만) */
export function captureScreen(): Promise<MediaStream> {
  const md = navigator.mediaDevices as MediaDevices | undefined;
  if (!md?.getDisplayMedia) return Promise.reject(Object.assign(new Error('getDisplayMedia 없음'), { name: 'NotSupportedError' }));
  type Ctl = { setFocusBehavior?: (b: string) => void };
  const CC = (window as unknown as { CaptureController?: new () => Ctl }).CaptureController;
  const controller = CC ? new CC() : undefined;
  const opts = { video: true, audio: false, selfBrowserSurface: 'include', ...(controller ? { controller } : {}) } as DisplayMediaStreamOptions;
  return md.getDisplayMedia(opts).then((stream) => {
    try {
      controller?.setFocusBehavior?.('no-focus-change');
    } catch {
      /* 전체 화면 공유 등은 지원하지 않음 */
    }
    return stream;
  });
}

export const screenShareSupported = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
