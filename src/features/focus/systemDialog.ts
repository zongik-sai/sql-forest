/**
 * 브라우저 자체 창(화면 공유 선택 창 getDisplayMedia 등) 유예(docs/09_FOCUS_MODE.md '화면 공유 유예').
 * 그 창이 열리면 학습 창이 포커스를 잃거나 전체화면이 풀릴 수 있다. 학생이 선생님 요청에 '화면 공유하기'를 누른 순간부터
 * 스트림이 시작되거나 실패할 때까지는 이 이탈을 잠김으로 세지 않는다(멈추지도 않음).
 * 끝나면(end) 잠시 뒤 FocusProvider가 다시 확인해, 이 창으로 돌아와 있지 않으면 세지 않고 멈춘다(다시 시작 클릭).
 * 공유가 시작된 뒤에는 보통 규칙이 다시 적용된다(공유 중이라도 다른 창으로 가면 잠김).
 * 좁은 장치: 화면 공유 수락 버튼만 부르고, 한 번에 최대 2분이며 그 뒤에는 저절로 끝난다.
 */
const MAX_MS = 120_000;
/** 선택 창이 닫힌 직후 돌아오는 focus 이벤트를 기다리는 시간 */
export const SYSTEM_DIALOG_TAIL_MS = 400;

let until = 0;
let open = 0;
const listeners = new Set<() => void>();

/** 유예 시작. 돌려받은 함수를 스트림이 시작되거나 실패했을 때 부른다(여러 번 불러도 한 번만) */
export function allowSystemDialog(ms = 60_000): () => void {
  const span = Math.min(Math.max(0, ms), MAX_MS);
  open++;
  until = Math.max(until, Date.now() + span);
  let done = false;
  function end() {
    if (done) return;
    done = true;
    clearTimeout(auto);
    open = Math.max(0, open - 1);
    if (open > 0) return;
    until = Math.min(until, Date.now() + SYSTEM_DIALOG_TAIL_MS);
    setTimeout(() => {
      if (open === 0 && !systemDialogActive()) listeners.forEach((l) => l());
    }, SYSTEM_DIALOG_TAIL_MS + 10);
  }
  const auto = setTimeout(end, span);
  return end;
}

/** 지금 유예 중인지 */
export function systemDialogActive(now = Date.now()): boolean {
  return now < until;
}

/** 유예가 끝나 다시 확인할 때(FocusProvider) */
export function onSystemDialogEnd(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
