import { Device, Environment, Notification, SafeArea, Screen, Share, User, graniteEvent } from '@apps-in-toss/web-framework';

export function isNativeToss() {
  try { return /^\d+\.\d+/.test(Environment.tossAppVersion); } catch { return false; }
}

export function connectNative(onBack: () => boolean) {
  if (!isNativeToss()) return () => {};
  document.documentElement.dataset.native = 'true';
  const applyInsets = (insets: { top: number; bottom: number }) => {
    document.documentElement.style.setProperty('--safe-top', `${insets.top}px`);
    document.documentElement.style.setProperty('--safe-bottom', `${insets.bottom}px`);
  };
  applyInsets(SafeArea.get());
  const offInsets = SafeArea.subscribe({ onEvent: applyInsets });
  // 열린 시트가 있으면 닫고, 없으면 미니앱을 닫아요.
  const offBack = graniteEvent.addEventListener('backEvent', { onEvent: () => { if (!onBack()) void Screen.close(); } });
  const offHome = graniteEvent.addEventListener('homeEvent', { onEvent: () => { void Screen.close(); } });
  return () => { offInsets(); offBack(); offHome(); };
}

export async function openExternal(url: string) {
  if (!/^https:\/\//.test(url)) return;
  if (isNativeToss()) await Device.openURL(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

export function haptic(type: 'success' | 'tap' | 'error') {
  if (!isNativeToss()) return;
  try { void Device.triggerHaptic({ type }); } catch { /* 지원하지 않는 버전 */ }
}

export type AgreementResult = 'agreed' | 'rejected' | 'unsupported' | 'not-ready' | 'error';

/** 토스 알림 동의문을 띄워요. 브라우저 개발 환경에서는 동의한 것으로 처리해요. */
export function requestAgreement(templateCode: string | undefined): Promise<AgreementResult> {
  if (!isNativeToss()) return Promise.resolve(import.meta.env.DEV ? 'agreed' : 'unsupported');
  // 콘솔 동의문 템플릿 코드를 넣기 전이에요.
  if (!templateCode) return Promise.resolve('not-ready');
  try { if (!Notification.requestAgreement.isSupported()) return Promise.resolve('unsupported'); } catch { return Promise.resolve('unsupported'); }
  return new Promise(resolve => {
    let cleanup: (() => void) | undefined;
    const done = (r: AgreementResult) => { cleanup?.(); cleanup = undefined; resolve(r); };
    try {
      cleanup = Notification.requestAgreement({
        options: { templateCode },
        onEvent: ({ type }) => done(type === 'agreementRejected' ? 'rejected' : 'agreed'),
        onError: (error: unknown) => {
          const code = (error as { code?: string })?.code;
          done(code === 'UNSUPPORTED_APP_VERSION' ? 'unsupported' : code === 'TERMS_DISAGREED_MEMBER' ? 'rejected' : 'error');
        },
      });
    } catch { done('error'); }
  });
}

/** 서버에서 사용자 식별키로 바꿀 일회용 코드. 개발 브라우저에서는 가짜 코드를 써요. */
export async function createAuthCode(): Promise<string | null> {
  if (!isNativeToss()) return import.meta.env.DEV ? `dev-${crypto.randomUUID()}` : null;
  try { return (await User.createAnonymousKeyAuthCode()).code; } catch { return null; }
}


/** 친구에게 앱 공유 */
export async function shareApp() {
  const message = 'GPT 사용량이 리셋되면 토스로 바로 알려줘요. GPT 리셋 레이더';
  if (isNativeToss()) {
    try {
      const link = await Share.createLink({ path: 'intoss://tibo' });
      await Share.sendMessage({ message: `${message}\n${link}` });
      return true;
    } catch { return false; }
  }
  if (typeof navigator.share === 'function') { try { await navigator.share({ title: 'GPT 리셋 레이더', text: message }); return true; } catch { return false; } }
  try { await navigator.clipboard.writeText(message); return true; } catch { return false; }
}
