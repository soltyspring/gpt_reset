import type { FeedResponse, SubscriptionState } from '../shared/reset';

const BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'tibo:session:v1';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function call<T>(path: string, init: RequestInit = {}, auth = false): Promise<T> {
  const headers: Record<string, string> = { ...(init.body ? { 'content-type': 'application/json' } : {}) };
  if (auth) {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) throw new ApiError(401, '다시 연결해 주세요.');
    headers.authorization = `Bearer ${token}`;
  }
  let res: Response;
  try { res = await fetch(BASE + path, { ...init, headers, signal: AbortSignal.timeout(15000) }); }
  catch { throw new ApiError(0, '인터넷 연결을 확인해 주세요.'); }
  const body = await res.json().catch(() => null);
  if (res.status === 401 && auth) localStorage.removeItem(TOKEN_KEY);
  if (!res.ok) throw new ApiError(res.status, body?.error || '잠시 후 다시 시도해 주세요.');
  return body as T;
}

export const api = {
  hasSession: () => !!localStorage.getItem(TOKEN_KEY),
  feed: () => call<FeedResponse>('/api/feed'),
  async connect(code: string) {
    const r = await call<{ token: string; subscription: SubscriptionState }>('/api/session', { method: 'POST', body: JSON.stringify({ code }) });
    localStorage.setItem(TOKEN_KEY, r.token);
    return r.subscription;
  },
  subscription: () => call<SubscriptionState>('/api/subscription', {}, true),
  save: (types: SubscriptionState['types']) => call<SubscriptionState>('/api/subscription', { method: 'PUT', body: JSON.stringify({ types }) }, true),
  off: () => call<SubscriptionState>('/api/subscription', { method: 'DELETE' }, true),
};
