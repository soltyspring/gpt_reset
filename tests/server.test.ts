import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.ts';
import { createTossClient, mockCaller } from '../server/toss.ts';
import { isQuietHourKst, pollOnce } from '../server/poller.ts';
import { xApiSource, type PostSource } from '../server/source.ts';
import { createApp } from '../server/app.ts';
import type { Post } from '../shared/reset.ts';

const NOW = Date.parse('2026-10-28T03:00:00Z'); // KST 12:00 (주간)
const templates = { reset: 'tibo-reset', planned: 'tibo-plan' };

function setup(posts: Post[][]) {
  const store = openStore(':memory:');
  const calls: any[] = [];
  const toss = createTossClient(mockCaller(calls), true);
  let call = 0;
  const seen: (string | null)[] = [];
  const source: PostSource = { name: 'fake', fetchRecent: async since => { seen.push(since); return posts[call++] ?? []; } };
  return { store, calls, toss, source, seen };
}
const post = (id: string, text: string, minutesAgo = 5, extra: Partial<Post> = {}): Post => ({ id, text, createdAt: new Date(NOW - minutesAgo * 60_000).toISOString(), ...extra });

test('첫 실행은 기록만 하고 알림을 보내지 않아요', async () => {
  const s = setup([[post('100', 'I have reset Codex limits for everyone')]]);
  s.store.subscribe('u1', { reset: true, planned: true });
  const r = await pollOnce({ ...s, templates, now: () => NOW });
  assert.equal(r.ok, true);
  assert.equal(s.calls.length, 0);
  assert.equal(s.store.publicEvents()[0].notifiedCount, 0);
  assert.equal(s.store.getMeta('sinceId'), '100');
});

test('새 리셋 공지를 구독자에게 보내고 같은 글은 다시 보내지 않아요', async () => {
  const reset = post('200', "We've fully reset usage limits for all paid plans in Codex.");
  const s = setup([[post('100', 'hello codex')], [reset, post('150', 'Codex CLI 0.60 is out')], [reset]]);
  s.store.subscribe('u1', { reset: true, planned: false });
  s.store.subscribe('u2', { reset: true, planned: true });
  s.store.subscribe('u3', { reset: false, planned: true });
  await pollOnce({ ...s, templates, now: () => NOW });
  await pollOnce({ ...s, templates, now: () => NOW });
  await pollOnce({ ...s, templates, now: () => NOW });
  assert.deepEqual(s.seen, [null, '100', '200']);
  const sends = s.calls.filter(l => l.path.endsWith('/send-message'));
  assert.deepEqual(sends.map(l => l.headers['x-anon-key']).sort(), ['u1', 'u2']);
  assert.equal(sends[0].body.templateSetCode, 'tibo-reset');
  assert.equal(sends[0].body.context.title, 'GPT 사용량이 초기화됐어요');
  const [e] = s.store.publicEvents();
  assert.equal(e.status, 'sent');
  assert.equal(e.notifiedCount, 2);
});

test('애매한 글과 오래된 글은 자동 발송하지 않아요', async () => {
  const s = setup([[post('1', 'x')], [post('2', "We'll reset Codex usage limits tonight."), post('3', 'I have reset Codex limits for everyone', 300)]]);
  s.store.subscribe('u1', { reset: true, planned: true });
  await pollOnce({ ...s, templates, now: () => NOW });
  await pollOnce({ ...s, templates, now: () => NOW });
  assert.equal(s.calls.length, 0);
  const all = s.store.allEvents();
  assert.equal(all.find(e => e.postId === '2')?.status, 'pending');
  assert.equal(all.find(e => e.postId === '3')?.status, 'sent');
  assert.equal(s.store.publicEvents().length, 1);
});

test('50명 이상이면 주간에는 대량 발송을 써요', async () => {
  const s = setup([[post('1', 'x')], [post('2', 'I have reset Codex limits for everyone')]]);
  for (let i = 0; i < 60; i++) s.store.subscribe('u' + i, { reset: true, planned: true });
  await pollOnce({ ...s, templates, now: () => NOW });
  await pollOnce({ ...s, templates, now: () => NOW });
  const bulk = s.calls.filter(l => l.path.endsWith('/send-bulk-message'));
  assert.equal(bulk.length, 1);
  assert.equal(bulk[0].body.contextList.length, 60);
  assert.equal(s.store.publicEvents()[0].notifiedCount, 60);
});

test('야간(KST 21~08시)을 구분해요', () => {
  assert.equal(isQuietHourKst(Date.parse('2026-10-28T12:30:00Z')), true); // 21:30
  assert.equal(isQuietHourKst(Date.parse('2026-10-27T22:59:00Z')), true); // 07:59
  assert.equal(isQuietHourKst(Date.parse('2026-10-27T23:00:00Z')), false); // 08:00
});

test('수집 실패 시 기존 기록과 sinceId를 유지해요', async () => {
  const store = openStore(':memory:');
  store.setMeta('sinceId', '500');
  const toss = createTossClient(mockCaller(), true);
  const source = xApiSource({ token: 't', userId: '1', fetcher: (async () => new Response('', { status: 429 })) as typeof fetch });
  const r = await pollOnce({ store, source, toss, templates, now: () => NOW });
  assert.deepEqual([r.ok, store.getMeta('lastError'), store.getMeta('sinceId')], [false, 'X_RATE_LIMITED', '500']);
});

test('X API 응답을 게시물로 바꿔요', async () => {
  let url = '';
  const fetcher = (async (u: URL) => { url = String(u); return Response.json({ data: [
    { id: '9', text: 'short', note_tweet: { text: 'long text' }, created_at: '2026-10-27T00:00:00.000Z', referenced_tweets: [{ type: 'replied_to', id: '1' }] },
  ] }); }) as unknown as typeof fetch;
  const [p] = await xApiSource({ token: 't', userId: '42', fetcher }).fetchRecent('8');
  assert.match(url, /users\/42\/tweets.*since_id=8/);
  assert.deepEqual(p, { id: '9', text: 'long text', createdAt: '2026-10-27T00:00:00.000Z', isReply: true, isRetweet: false });
});

async function withServer(fn: (base: string, store: ReturnType<typeof openStore>) => Promise<void>) {
  const store = openStore(':memory:');
  const app = createApp({ store, toss: createTossClient(mockCaller(), true), allowedOrigins: ['https://tibo.apps.tossmini.com'] });
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const { port } = server.address() as { port: number };
  try { await fn(`http://127.0.0.1:${port}`, store); } finally { server.close(); }
}

test('API: 코드 교환 → 세션 → 구독·해지', async () => withServer(async (base, store) => {
  const bad = await fetch(base + '/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'bad-code-123' }) });
  assert.equal(bad.status, 401);
  const res = await fetch(base + '/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'good-code-123' }) });
  const session = await res.json();
  assert.equal(session.subscription.subscribed, false);
  assert.equal('anonKey' in session, false);
  const h = { 'content-type': 'application/json', authorization: `Bearer ${session.token}` };
  const sub = await (await fetch(base + '/api/subscription', { method: 'PUT', headers: h, body: JSON.stringify({ types: { reset: true, planned: false } }) })).json();
  assert.deepEqual([sub.subscribed, sub.types], [true, { reset: true, planned: false }]);
  assert.deepEqual(store.recipients('reset'), ['mock-anon-good-code-123']);
  assert.deepEqual(store.recipients('planned'), []);
  await fetch(base + '/api/subscription', { method: 'DELETE', headers: h });
  assert.equal(store.subscriberCount(), 0);
  assert.equal((await fetch(base + '/api/subscription', { headers: { authorization: 'Bearer nope' } })).status, 401);
}));

test('API: 허용되지 않은 출처를 막고 피드를 돌려줘요', async () => withServer(async base => {
  assert.equal((await fetch(base + '/api/feed', { headers: { origin: 'https://evil.example' } })).status, 403);
  const ok = await fetch(base + '/api/feed', { headers: { origin: 'https://tibo.apps.tossmini.com' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://tibo.apps.tossmini.com');
  const feed = await ok.json();
  assert.deepEqual([feed.events, feed.intervalMinutes], [[], 10]);
}));


test('알림을 끈 지 30일 지난 식별키를 지워요', () => {
  const store = openStore(':memory:');
  store.subscribe('old', { reset: true, planned: true });
  store.subscribe('recent', { reset: true, planned: true });
  store.unsubscribe('old'); store.unsubscribe('recent');
  store.db.prepare("UPDATE subscribers SET updated_at = '2020-01-01T00:00:00Z' WHERE anon_key = 'old'").run();
  assert.equal(store.purge(), 1);
  assert.equal(Number((store.db.prepare('SELECT COUNT(*) n FROM subscribers').get() as any).n), 1);
});


test('통계: 리셋 횟수·평균 간격·알림 지연', async () => {
  const { feedStats } = await import('../shared/reset.ts');
  const ev = (days: number, delayMin: number) => ({ id: String(days), postId: '1', url: '', text: '', kind: 'reset' as const, scope: '', title: '', summary: '', status: 'sent' as const, notifiedCount: 0,
    postedAt: new Date(NOW - days * 86400_000).toISOString(), detectedAt: new Date(NOW - days * 86400_000 + delayMin * 60000).toISOString() });
  assert.deepEqual(feedStats([ev(1, 4), ev(11, 6), ev(200, 9999)], NOW), { resets90d: 2, avgGapDays: 100, avgDelayMin: 5 });
});


test('codex-reset.com: 확인된 리셋만 받고, 새 리셋이면 바로 보내요', async () => {
  const { codexResetSource } = await import('../server/source.ts');
  let ua = '';
  let events: any[] = [
    { id: '100', group: 'reset', announcement_state: 'announced', announced_at: new Date(NOW - 86400_000).toISOString(), url: 'https://x.com/thsottiaux/status/100', summary: 'old reset', scope: 'global' },
    { id: '101', group: 'boost', announcement_state: 'announced', announced_at: new Date(NOW).toISOString(), url: 'https://x.com/thsottiaux/status/101', summary: 'new model' },
    { id: '102', group: 'reset', announcement_state: 'expected', announced_at: new Date(NOW).toISOString(), url: 'https://x.com/thsottiaux/status/102', summary: 'soon' },
    { id: '103', group: 'reset', announcement_state: 'announced', banked_grant: true, announced_at: new Date(NOW).toISOString(), url: 'https://x.com/thsottiaux/status/103', summary: 'banked' },
  ];
  const fetcher = (async (_u: string, init: RequestInit) => { ua = (init.headers as Record<string, string>)['user-agent']; return Response.json({ events }); }) as unknown as typeof fetch;
  const source = codexResetSource({ fetcher });
  const store = openStore(':memory:');
  const calls: any[] = [];
  const toss = createTossClient(mockCaller(calls), true);
  store.subscribe('u1', { reset: true, planned: true });
  await pollOnce({ store, source, toss, templates, now: () => NOW });
  assert.match(ua, /tibo-reset-alarm.*bluecl/);
  assert.deepEqual(store.allEvents().map(e => e.postId), ['100']); // 첫 실행: 기록만
  assert.equal(calls.length, 0);
  events = [...events, { id: '104', group: 'reset', announcement_state: 'announced', announced_at: new Date(NOW - 5 * 60_000).toISOString(), url: 'https://x.com/thsottiaux/status/104', summary: 'and reset. Enjoy.', scope: 'global' }];
  await pollOnce({ store, source, toss, templates, now: () => NOW });
  const sent = calls.filter(c => c.path.endsWith('/send-message'));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.context.scope, '모든 사용자');
  assert.equal(store.getMeta('sourceName'), 'codex-reset.com');
});
