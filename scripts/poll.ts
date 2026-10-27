/**
 * 10분마다 systemd 타이머가 실행하는 수집기. 한 번 실행하고 종료해요.
 *   npm run poll
 */
import { openStore } from '../server/store.ts';
import { codexResetSource, xApiSource } from '../server/source.ts';
import { tossOrUnavailable } from '../server/toss.ts';
import { pollOnce } from '../server/poller.ts';

const token = process.env.X_BEARER_TOKEN?.trim();
// X 토큰이 있으면 X API, 없으면 codex-reset.com 공개 타임라인(검증된 리셋)을 써요.

const store = openStore();
const toss = tossOrUnavailable();
const notifyReady = toss.mock || !!(process.env.TOSS_MTLS_CERT && process.env.TOSS_MTLS_KEY);
try {
  const result = await pollOnce({
    store,
    source: token ? xApiSource({ token, userId: process.env.X_USER_ID || '1953337039510003712' }) : codexResetSource(),
    toss,
    username: process.env.X_USERNAME || 'thsottiaux',
    // 인증서가 없으면 감지만 하고 발송은 건너뛰어요.
    templates: notifyReady ? { reset: process.env.TOSS_RESET_TEMPLATE, planned: process.env.TOSS_PLAN_TEMPLATE } : {},
    mode: process.env.NOTIFY_MODE === 'review' ? 'review' : 'auto',
    maxAgeMinutes: Number(process.env.NOTIFY_MAX_AGE_MIN || 90),
    log: m => console.log(`[poll] ${m}`),
  });
  console.log(`[poll] ${result.ok ? `완료: 새 게시물 ${result.checked}개, 이벤트 ${result.events.length}개` : `실패: ${result.error}`}`);
  store.purge();
  process.exitCode = result.ok ? 0 : 2;
} finally { store.close(); }
