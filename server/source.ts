import type { Post } from '../shared/reset.ts';

export class SourceError extends Error {
  constructor(public code: string, message = code) { super(message); }
}

export interface PostSource {
  name: string;
  fetchRecent(sinceId: string | null): Promise<Post[]>;
}

interface XTweet {
  id: string; text: string; created_at: string;
  referenced_tweets?: { type: 'retweeted' | 'quoted' | 'replied_to'; id: string }[];
  note_tweet?: { text: string };
}

/**
 * X API v2 사용자 타임라인. 공식 API만 사용해요(스크래핑 없음).
 * since_id로 새 게시물만 받아 10분 주기에도 읽기 비용을 최소화해요.
 */
export function xApiSource(options: { token: string; userId: string; fetcher?: typeof fetch; timeoutMs?: number }): PostSource {
  const fetcher = options.fetcher ?? fetch;
  return {
    name: 'X API v2',
    async fetchRecent(sinceId) {
      const url = new URL(`https://api.x.com/2/users/${encodeURIComponent(options.userId)}/tweets`);
      url.searchParams.set('max_results', '10');
      url.searchParams.set('tweet.fields', 'created_at,referenced_tweets,note_tweet');
      url.searchParams.set('exclude', 'retweets');
      if (sinceId) url.searchParams.set('since_id', sinceId);
      let res: Response;
      try {
        res = await fetcher(url, {
          headers: { authorization: `Bearer ${options.token}`, 'user-agent': 'tibo-reset-alarm/0.1' },
          signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
        });
      } catch { throw new SourceError('X_NETWORK'); }
      if (res.status === 429) throw new SourceError('X_RATE_LIMITED');
      if (res.status === 401 || res.status === 403) throw new SourceError('X_AUTH');
      if (!res.ok) throw new SourceError('X_HTTP_' + res.status);
      const body = await res.json().catch(() => null) as { data?: XTweet[] } | null;
      if (!body || (body.data !== undefined && !Array.isArray(body.data))) throw new SourceError('X_BAD_RESPONSE');
      return (body.data ?? []).filter(t => /^\d+$/.test(t.id) && typeof t.text === 'string').map(t => ({
        id: t.id,
        text: t.note_tweet?.text || t.text,
        createdAt: new Date(t.created_at).toISOString(),
        isReply: !!t.referenced_tweets?.some(r => r.type === 'replied_to'),
        isRetweet: !!t.referenced_tweets?.some(r => r.type === 'retweeted'),
      }));
    },
  };
}

/**
 * codex-reset.com 공개 타임라인. 키 없이 쓸 수 있고, 조건은 출처 표기와 연락 가능한 User-Agent예요.
 * group=reset, announcement_state=announced 인 항목만 리셋으로 봐요(사이트 문서 기준).
 * https://codex-reset.com/developers
 */
export const CODEX_RESET_CREDIT = { name: 'codex-reset.com', url: 'https://codex-reset.com/' };
export function codexResetSource(options: { fetcher?: typeof fetch; userAgent?: string; timeoutMs?: number } = {}): PostSource {
  const fetcher = options.fetcher ?? fetch;
  return {
    name: CODEX_RESET_CREDIT.name,
    async fetchRecent() {
      let res: Response;
      try {
        res = await fetcher('https://codex-reset.com/api/timeline', {
          headers: { 'user-agent': options.userAgent ?? 'tibo-reset-alarm/0.1 (+https://bluecl.cloud/tibo; bluecl@bluecl.cloud)', accept: 'application/json' },
          signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
        });
      } catch { throw new SourceError('CR_NETWORK'); }
      if (res.status === 429) throw new SourceError('CR_RATE_LIMITED');
      if (!res.ok) throw new SourceError('CR_HTTP_' + res.status);
      const body = await res.json().catch(() => null) as { events?: any[] } | null;
      if (!body || !Array.isArray(body.events)) throw new SourceError('CR_BAD_RESPONSE');
      return body.events
        .filter(e => e && e.group === 'reset' && e.announcement_state === 'announced' && e.banked_grant !== true
          && typeof e.id === 'string' && /^\d+$/.test(e.id) && Number.isFinite(Date.parse(e.announced_at))
          && typeof e.url === 'string' && /^https:\/\/x\.com\/thsottiaux\/status\/\d+$/.test(e.url))
        .map(e => ({
          id: e.id,
          text: String(e.summary ?? '').slice(0, 1000),
          createdAt: new Date(e.announced_at).toISOString(),
          isReply: !!e.is_reply,
          verified: { kind: 'reset' as const, scope: e.scope === 'global' ? '모든 사용자' : '' },
        }));
    },
  };
}

/** 오래된 게시물부터 처리하도록 정렬해요. 트윗 ID는 시간순으로 증가해요. */
export function sortById(posts: Post[]) {
  return [...posts].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0));
}
export function maxId(ids: (string | null)[]) {
  return ids.filter((x): x is string => !!x && /^\d+$/.test(x)).reduce<string | null>((m, x) => (!m || BigInt(x) > BigInt(m) ? x : m), null);
}
