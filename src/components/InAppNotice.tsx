import { useState } from 'react';

/**
 * 카카오톡 등 앱 안의 브라우저(웹뷰)에서는 Google이 로그인을 막는다(disallowed_useragent).
 * 감지되면 기본 브라우저로 여는 방법을 안내한다. 감시 목적이 아니라 로그인 안내용이다.
 */
export type InAppKind = 'kakao' | 'other' | null;

export function detectInApp(ua: string): InAppKind {
  if (/KAKAOTALK/i.test(ua)) return 'kakao';
  if (/(NAVER\(inapp|Instagram|FBAN|FBAV|FB_IAB|Line\/|everytimeApp|DaumApps|; wv\))/i.test(ua)) return 'other';
  return null;
}

/** 기본 브라우저로 여는 주소. 카카오톡은 전용 주소, 안드로이드는 Chrome intent, 그 밖에는 없음(복사 안내). */
export function externalOpenUrl(kind: InAppKind, url: string, ua: string): string | null {
  if (kind === 'kakao') return `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`;
  if (kind === 'other' && /Android/i.test(ua)) {
    const u = new URL(url);
    return `intent://${u.host}${u.pathname}${u.search}${u.hash}#Intent;scheme=${u.protocol.replace(':', '')};package=com.android.chrome;end`;
  }
  return null;
}

export function InAppNotice() {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const kind = detectInApp(ua);
  const [copied, setCopied] = useState(false);
  if (!kind) return null;
  const href = typeof location === 'undefined' ? '' : location.href;
  const ext = externalOpenUrl(kind, href, ua);
  return (
    <div className="notice notice-warn inapp" role="alert">
      <b>{kind === 'kakao' ? '카카오톡' : '앱'} 안에서 열려 있어요.</b> 여기서는 Google 로그인이 막혀요. 기본 브라우저(Chrome·Safari 등)로 열어 주세요.
      <div className="row" style={{ marginTop: '0.4rem' }}>
        {ext && <a className="btn btn-small btn-primary" href={ext}>기본 브라우저로 열기</a>}
        <button
          className="btn btn-small"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(href);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          주소 복사
        </button>
        {copied && <span className="small">복사했어요. 브라우저 주소창에 붙여 넣으세요.</span>}
        {!ext && <span className="small">오른쪽 위 메뉴(⋮ 또는 ⋯) → "다른 브라우저로 열기"</span>}
      </div>
    </div>
  );
}
