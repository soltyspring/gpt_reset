import express, { type Request, type Response, type NextFunction } from 'express';
import { feedStats, type FeedResponse } from '../shared/reset.ts';
import type { Store } from './store.ts';
import type { TossClient } from './toss.ts';
import { TossError } from './toss.ts';
import { CODEX_RESET_CREDIT } from './source.ts';

export interface AppOptions {
  store: Store;
  toss: TossClient;
  allowedOrigins?: string[];
  intervalMinutes?: number;
  username?: string;
  staticDir?: string;
}

const DEFAULT_ORIGINS = ['https://tibo.apps.tossmini.com', 'https://tibo.private-apps.tossmini.com'];

/** IP별 간단한 고정 창 제한. 프록시 뒤에서는 X-Real-IP를 써요. */
function rateLimit(limit: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = String(req.headers['x-real-ip'] || req.socket.remoteAddress || 'local');
    const now = Date.now();
    const h = hits.get(ip);
    if (!h || h.reset < now) hits.set(ip, { n: 1, reset: now + windowMs });
    else if (++h.n > limit) return res.status(429).json({ code: 'TOO_MANY', error: '잠시 후 다시 시도해 주세요.' });
    if (hits.size > 10000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    next();
  };
}

export function createApp(o: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  const allowed = new Set(o.allowedOrigins ?? DEFAULT_ORIGINS);
  const local = /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+):\d+$/;

  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      if (!allowed.has(origin) && !(process.env.NODE_ENV !== 'production' && local.test(origin)))
        return res.status(403).json({ code: 'ORIGIN', error: '허용되지 않은 요청이에요.' });
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use('/api', express.json({ limit: '4kb' }));

  const auth = (req: Request, res: Response, next: NextFunction) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    const anonKey = o.store.sessionUser(token);
    if (!anonKey) return res.status(401).json({ code: 'SESSION', error: '다시 연결해 주세요.' });
    res.locals.anonKey = anonKey;
    next();
  };

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.get('/api/feed', (_req, res) => {
    const events = o.store.publicEvents(50);
    const body: FeedResponse = {
      events,
      stats: feedStats(events),
      lastCheckedAt: o.store.getMeta('lastCheckedAt'),
      lastSuccessAt: o.store.getMeta('lastSuccessAt'),
      intervalMinutes: o.intervalMinutes ?? 10,
      source: o.store.getMeta('sourceName') === CODEX_RESET_CREDIT.name
        ? { ...CODEX_RESET_CREDIT }
        : { name: `X @${o.username ?? 'thsottiaux'}`, url: `https://x.com/${o.username ?? 'thsottiaux'}` },
    };
    res.json(body);
  });
  /** 미니앱이 발급한 일회용 코드를 anonKey로 바꾸고, 앱 전용 세션을 줘요. anonKey는 앱에 돌려주지 않아요. */
  app.post('/api/session', rateLimit(20, 60_000), async (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code : '';
    if (!code) return res.status(400).json({ code: 'BAD_REQUEST', error: '요청이 올바르지 않아요.' });
    try {
      const anonKey = await o.toss.exchangeCode(code);
      const session = o.store.createSession(anonKey);
      res.json({ token: session.token, expiresAt: session.expiresAt, subscription: o.store.subscription(anonKey) });
    } catch (e) {
      const invalid = e instanceof TossError && (e.code === 'TOSS_4011' || e.code === 'TOSS_BAD_CODE');
      if (e instanceof TossError && e.code === 'TOSS_MTLS_MISSING') return res.status(503).json({ code: 'NOTIFY_UNAVAILABLE', error: '알림 기능을 준비하고 있어요. 조금만 기다려 주세요.' });
      res.status(invalid ? 401 : 502).json({ code: invalid ? 'CODE_INVALID' : 'TOSS_UNAVAILABLE', error: invalid ? '다시 시도해 주세요.' : '토스와 연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.' });
    }
  });

  app.get('/api/subscription', auth, (_req, res) => res.json(o.store.subscription(res.locals.anonKey)));

  app.put('/api/subscription', rateLimit(30, 60_000), auth, (req, res) => {
    const reset = req.body?.types?.reset, planned = req.body?.types?.planned;
    if (typeof reset !== 'boolean' || typeof planned !== 'boolean') return res.status(400).json({ code: 'BAD_REQUEST', error: '요청이 올바르지 않아요.' });
    if (!reset && !planned) o.store.unsubscribe(res.locals.anonKey);
    else o.store.subscribe(res.locals.anonKey, { reset, planned });
    res.json(o.store.subscription(res.locals.anonKey));
  });

  app.delete('/api/subscription', auth, (_req, res) => {
    o.store.unsubscribe(res.locals.anonKey);
    res.json(o.store.subscription(res.locals.anonKey));
  });

  app.use('/api', (_req, res) => res.status(404).json({ code: 'NOT_FOUND', error: '찾을 수 없어요.' }));
  if (o.staticDir) app.use(express.static(o.staticDir));
  return app;
}
