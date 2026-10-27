import { classify, koreanCopy, postUrl } from '../shared/reset.ts';
import type { Store } from './store.ts';

/**
 * 로컬 화면 확인용 예시 데이터. 문구는 Tibo 공개 게시물을 바탕으로 했지만
 * 첫 항목만 실제 게시물 ID이고 나머지 ID는 화면 확인용 가짜 값이에요.
 * 운영(NODE_ENV=production)에서는 불러오지 않아요.
 */
const SAMPLES = [
  { id: '1968163721034994139', at: '2025-09-17T04:02:52Z', text: "We have reset everyone's limits for gpt-5-codex to allow you all to benefit more from it today and as a way to make up for the slowdowns earlier." },
  { id: '2049080000000000001', at: '2026-04-28T09:10:00Z', text: 'I have reset Codex rate limits for ALL paid plans to celebrate a good week and allow everyone to build more with GPT-5.5.' },
  { id: '2065000000000000001', at: '2026-07-01T11:20:00Z', text: "All fixes are now deployed and we've fully reset usage limits again for all users." },
  { id: '2079000000000000001', at: '2026-10-09T13:05:00Z', text: "We have reset Codex usage limits for everyone. Enjoy the weekend!" },
];

export function seedDemo(store: Store, now = Date.now()) {
  if (store.getMeta('demoSeeded')) return;
  const recent = { id: '2081000000000000001', at: new Date(now - 42 * 60_000).toISOString(), text: "I've reset the usage limits for all paid users of Codex, so enjoy." };
  for (const s of [...SAMPLES, recent]) {
    const c = classify({ text: s.text });
    if (c.kind === 'none') continue;
    const copy = koreanCopy(c.kind, c.scope);
    const e = store.addEvent({ postId: s.id, url: postUrl('thsottiaux', s.id), text: s.text, postedAt: new Date(s.at).toISOString(),
      kind: c.kind, scope: c.scope, title: copy.title, summary: copy.summary, status: 'sent' });
    if (e) {
      store.setEventStatus(e.id, 'sent', 1280 + Math.floor(Number(s.id.slice(-3))));
      // 실제 수집처럼 게시 4분 뒤에 감지한 것으로 기록해요(통계 화면 확인용).
      store.db.prepare('UPDATE events SET detected_at = ? WHERE id = ?').run(new Date(Date.parse(s.at) + 4 * 60_000).toISOString(), e.id);
    }
  }
  store.setMeta('lastCheckedAt', new Date(now - 3 * 60_000).toISOString());
  store.setMeta('lastSuccessAt', new Date(now - 3 * 60_000).toISOString());
  store.setMeta('demoSeeded', '1');
}
