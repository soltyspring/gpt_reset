import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, koreanCopy, relativeLabel, scopeOf } from '../shared/reset.ts';

const c = (text: string, extra: { isReply?: boolean; isRetweet?: boolean } = {}) => classify({ text, ...extra });

test('실제 리셋 공지를 즉시 발송 대상으로 분류해요', () => {
  for (const text of [
    "We have reset everyone's limits for gpt-5-codex to allow you all to benefit more from it today",
    'I have reset Codex rate limits for ALL paid plans to celebrate a good week and allow everyone to build more with GPT-5.5.',
    "I've reset the usage limits for all paid users of Codex and ChatGPT Work, so enjoy.",
    "All fixes are now deployed. We've fully reset usage limits again for all users.",
    'Usage limits are now reset for everyone on Codex.',
  ]) {
    const r = c(text);
    assert.equal(r.kind, 'reset', text);
    assert.equal(r.confidence, 'auto', text);
  }
});

test('리셋 예고는 planned로, 운영자 확인을 거쳐요', () => {
  const r = c("We'll reset Codex usage limits tonight once the fix is out.");
  assert.equal(r.kind, 'planned');
  assert.equal(r.confidence, 'review');
});

test('사용량 문맥이 약한 완료 공지는 확인 대상이에요', () => {
  const r = c('Reset has been propagated to accounts and we landed some fixes.');
  assert.equal(r.kind, 'reset');
  assert.equal(r.confidence, 'review');
});

test('리셋 공지가 아닌 게시물은 무시해요', () => {
  for (const text of [
    'Upgrade to the latest Codex CLI 0.41.0 version to see when limits reset by typing /status.',
    'We are prioritizing improving how the Codex rate limit mechanism works to avoid hitting the issue',
    'Codex CLI 0.48 is here. Packs many quality of life improvements',
    'We will not reset limits this week, sorry.',
    'Should we reset limits for everyone?',
    'Codex can now run git reset for you safely.',
  ]) assert.equal(c(text).kind, 'none', text);
});

test('리트윗은 무시하고 답글은 확인 대상으로 돌려요', () => {
  assert.equal(c('I have reset Codex limits for everyone', { isRetweet: true }).kind, 'none');
  const reply = c('@someone I have reset Codex limits for everyone', { isReply: true });
  assert.equal(reply.kind, 'reset');
  assert.equal(reply.confidence, 'review');
});

test('대상 범위를 한국어로 뽑아요', () => {
  assert.equal(scopeOf('reset limits for ALL paid plans'), '모든 유료 플랜');
  assert.equal(scopeOf("reset everyone's limits"), '모든 사용자');
  assert.equal(scopeOf('reset for Plus and Pro'), 'Pro·Plus');
  assert.equal(scopeOf('reset limits'), '');
});

test('토스 문구는 해요체예요', () => {
  assert.deepEqual(koreanCopy('reset', '모든 유료 플랜'), { title: 'GPT 사용량이 초기화됐어요', summary: '모든 유료 플랜 사용량이 다시 채워졌어요. 지금 바로 써 보세요.' });
  assert.match(koreanCopy('planned', '').summary, /알려드릴게요/);
});

test('상대 시간 표기', () => {
  const now = Date.parse('2026-10-28T00:00:00Z');
  assert.equal(relativeLabel('2026-10-27T23:59:40Z', now), '방금');
  assert.equal(relativeLabel('2026-10-27T23:50:00Z', now), '10분 전');
  assert.equal(relativeLabel('2026-10-27T21:00:00Z', now), '3시간 전');
});
