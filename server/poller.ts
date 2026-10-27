import { classify, koreanCopy, kstLabel, postUrl, scopeOf, type ResetEvent } from '../shared/reset.ts';
import type { Store } from './store.ts';
import type { PostSource } from './source.ts';
import { maxId, sortById, SourceError } from './source.ts';
import type { TossClient } from './toss.ts';

export interface PollOptions {
  store: Store;
  source: PostSource;
  toss: TossClient;
  username?: string;
  templates: { reset?: string; planned?: string };
  mode?: 'auto' | 'review';
  maxAgeMinutes?: number;
  now?: () => number;
  log?: (msg: string) => void;
}

/** 대량 발송은 21~08시(KST)에 보류돼요. 이 시간에는 단건 발송으로 바로 보내요. */
export function isQuietHourKst(at: number) {
  const hour = (new Date(at).getUTCHours() + 9) % 24;
  return hour >= 21 || hour < 8;
}

export function messageContext(event: ResetEvent): Record<string, string> {
  return { title: event.title, summary: event.summary, scope: event.scope || '전체', postedAt: kstLabel(event.postedAt) };
}

export async function dispatch(event: ResetEvent, o: Pick<PollOptions, 'store' | 'toss' | 'templates' | 'now' | 'log'>) {
  const template = o.templates[event.kind];
  const log = o.log ?? (() => {});
  if (!template) { log(`템플릿 없음(${event.kind}) → 발송 생략`); o.store.setEventStatus(event.id, 'sent', 0); return 0; }
  const recipients = o.store.recipients(event.kind);
  const context = messageContext(event);
  let sent = 0;
  if (recipients.length === 0) sent = 0;
  else if (recipients.length < 50 || isQuietHourKst((o.now ?? Date.now)())) {
    // 단건: 동시 5개씩
    for (let i = 0; i < recipients.length; i += 5) {
      const results = await Promise.all(recipients.slice(i, i + 5).map(k => o.toss.sendOne(template, k, context)));
      sent += results.filter(Boolean).length;
    }
  } else {
    sent = (await o.toss.sendBulk(template, recipients.map(anonKey => ({ anonKey, context })))).sent;
  }
  o.store.setEventStatus(event.id, 'sent', sent);
  log(`발송 ${event.kind} ${sent}/${recipients.length}`);
  return sent;
}

/** 한 번 실행. systemd 타이머가 10분마다 호출해요. */
export async function pollOnce(o: PollOptions) {
  const now = o.now ?? Date.now;
  const log = o.log ?? (() => {});
  const username = o.username ?? 'thsottiaux';
  const maxAge = (o.maxAgeMinutes ?? 90) * 60_000;
  const store = o.store;
  const startedAt = new Date(now()).toISOString();
  store.setMeta('lastCheckedAt', startedAt);
  const sinceId = store.getMeta('sinceId');
  const firstRun = !sinceId;
  const created: ResetEvent[] = [];
  try {
    const posts = sortById(await o.source.fetchRecent(sinceId));
    for (const post of posts) {
      if (!store.markPostSeen(post.id, post.text, post.createdAt)) continue;
      const c = post.verified
        ? { kind: post.verified.kind, confidence: 'auto' as const, scope: post.verified.scope || scopeOf(post.text), reasons: ['verified-source'] }
        : classify(post);
      if (c.kind === 'none') continue;
      const copy = koreanCopy(c.kind, c.scope);
      const fresh = now() - Date.parse(post.createdAt) <= maxAge;
      const autoSend = !firstRun && fresh && c.confidence === 'auto' && (o.mode ?? 'auto') === 'auto';
      // 첫 실행·오래된 글: 알림 없이 기록만(history). 애매한 글: 운영자 확인 대기.
      const status: ResetEvent['status'] = autoSend ? 'pending' : (!fresh || firstRun) && c.confidence === 'auto' ? 'sent' : 'pending';
      const event = store.addEvent({ postId: post.id, url: postUrl(username, post.id), text: post.text, postedAt: post.createdAt,
        kind: c.kind, scope: c.scope, title: copy.title, summary: copy.summary, status });
      if (!event) continue;
      created.push(event);
      log(`감지 ${c.kind}/${c.confidence} ${post.id} ${autoSend ? '→ 발송' : status === 'pending' ? '→ 확인 대기' : '→ 기록만'}`);
      if (autoSend) await dispatch(event, o);
    }
    const next = maxId([sinceId, ...posts.map(p => p.id)]);
    if (next) store.setMeta('sinceId', next);
    store.setMeta('lastSuccessAt', new Date(now()).toISOString());
    store.setMeta('sourceName', o.source.name);
    store.setMeta('lastError', '');
    return { ok: true as const, checked: posts.length, events: created };
  } catch (error) {
    const code = error instanceof SourceError ? error.code : 'POLL_FAILED';
    store.setMeta('lastError', code);
    log(`수집 실패 ${code}`);
    return { ok: false as const, error: code, events: created };
  }
}
