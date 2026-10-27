/**
 * 운영자 도구. 확인 대기 중인 이벤트를 보고 발송하거나 건너뛰어요.
 *   npm run admin -- list
 *   npm run admin -- send <eventId>
 *   npm run admin -- skip <eventId>
 *   npm run admin -- stats
 */
import { openStore } from '../server/store.ts';
import { tossFromEnv } from '../server/toss.ts';
import { dispatch } from '../server/poller.ts';

const [command, id] = process.argv.slice(2);
const store = openStore();
try {
  if (command === 'list') {
    for (const e of store.allEvents(30)) console.log(`${e.status.padEnd(7)} ${e.kind.padEnd(7)} ${e.id}  ${e.postedAt}  ${e.text.slice(0, 80).replace(/\s+/g, ' ')}`);
  } else if (command === 'stats') {
    console.log(`구독자 ${store.subscriberCount()}명 · 마지막 확인 ${store.getMeta('lastCheckedAt')} · 마지막 성공 ${store.getMeta('lastSuccessAt')} · 오류 ${store.getMeta('lastError') || '없음'}`);
  } else if ((command === 'send' || command === 'skip') && id) {
    const event = store.event(id);
    if (!event) throw new Error('이벤트를 찾을 수 없어요.');
    if (event.status !== 'pending') throw new Error(`이미 처리된 이벤트예요 (${event.status}).`);
    if (command === 'skip') { store.setEventStatus(id, 'skipped'); console.log('건너뛰었어요.'); }
    else {
      const sent = await dispatch(event, { store, toss: tossFromEnv(), templates: { reset: process.env.TOSS_RESET_TEMPLATE, planned: process.env.TOSS_PLAN_TEMPLATE }, log: console.log });
      console.log(`${sent}명에게 보냈어요.`);
    }
  } else {
    console.log('사용법: npm run admin -- list | stats | send <id> | skip <id>');
    process.exitCode = 1;
  }
} catch (e) { console.error((e as Error).message); process.exitCode = 1; }
finally { store.close(); }
