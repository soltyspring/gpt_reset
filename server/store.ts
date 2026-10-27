import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { ResetEvent, SubscriptionState } from '../shared/reset.ts';

export const dbPath = () => process.env.TIBO_DB_PATH || '.data/tibo.sqlite';

export interface Subscriber { anonKey: string; reset: boolean; planned: boolean; createdAt: string }

/** 앱 세션 토큰은 해시만 저장해요. 유출돼도 원문 토큰을 복원할 수 없어요. */
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function openStore(path = dbPath()) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS subscribers (
      anon_key TEXT PRIMARY KEY,
      reset INTEGER NOT NULL DEFAULT 1,
      planned INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      anon_key TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      seen_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL UNIQUE,
      url TEXT NOT NULL,
      text TEXT NOT NULL,
      posted_at TEXT NOT NULL,
      detected_at TEXT NOT NULL,
      kind TEXT NOT NULL,
      scope TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      notified_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);

  const now = () => new Date().toISOString();
  const rowToEvent = (r: any): ResetEvent => ({
    id: r.id, postId: r.post_id, url: r.url, text: r.text, postedAt: r.posted_at, detectedAt: r.detected_at,
    kind: r.kind, scope: r.scope, title: r.title, summary: r.summary, status: r.status, notifiedCount: Number(r.notified_count),
  });

  return {
    db,
    close: () => db.close(),

    // ── 세션 ──
    createSession(anonKey: string, ttlDays = 30) {
      const token = randomUUID() + randomUUID().replace(/-/g, '');
      const expires = new Date(Date.now() + ttlDays * 86400_000).toISOString();
      db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
      db.prepare('INSERT INTO sessions (token_hash, anon_key, expires_at) VALUES (?, ?, ?)').run(hashToken(token), anonKey, expires);
      return { token, expiresAt: expires };
    },
    sessionUser(token: string | undefined): string | null {
      if (!token || token.length < 40 || token.length > 120) return null;
      const r = db.prepare('SELECT anon_key FROM sessions WHERE token_hash = ? AND expires_at > ?').get(hashToken(token), now()) as any;
      return r?.anon_key ?? null;
    },

    // ── 구독 ──
    subscription(anonKey: string): SubscriptionState {
      const r = db.prepare('SELECT reset, planned, created_at FROM subscribers WHERE anon_key = ? AND active = 1').get(anonKey) as any;
      if (!r) return { subscribed: false, types: { reset: true, planned: true }, since: null };
      return { subscribed: true, types: { reset: !!r.reset, planned: !!r.planned }, since: r.created_at };
    },
    subscribe(anonKey: string, types: { reset: boolean; planned: boolean }) {
      const t = now();
      db.prepare(`INSERT INTO subscribers (anon_key, reset, planned, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)
        ON CONFLICT(anon_key) DO UPDATE SET reset = excluded.reset, planned = excluded.planned, active = 1,
          created_at = CASE WHEN subscribers.active = 1 THEN subscribers.created_at ELSE excluded.created_at END,
          updated_at = excluded.updated_at`).run(anonKey, types.reset ? 1 : 0, types.planned ? 1 : 0, t, t);
    },
    unsubscribe(anonKey: string) {
      db.prepare('UPDATE subscribers SET active = 0, updated_at = ? WHERE anon_key = ?').run(now(), anonKey);
    },
    recipients(kind: 'reset' | 'planned'): string[] {
      const column = kind === 'reset' ? 'reset' : 'planned';
      return (db.prepare(`SELECT anon_key FROM subscribers WHERE active = 1 AND ${column} = 1 ORDER BY created_at`).all() as any[]).map(r => r.anon_key);
    },
    subscriberCount(): number {
      return Number((db.prepare('SELECT COUNT(*) n FROM subscribers WHERE active = 1').get() as any).n);
    },
    /** 알림을 끈 지 30일이 지난 식별키와 만료된 세션을 지워요(개인정보 처리방침). */
    purge(days = 30) {
      const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
      const gone = db.prepare('DELETE FROM subscribers WHERE active = 0 AND updated_at < ?').run(cutoff);
      db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
      return Number(gone.changes);
    },

    // ── 게시물·이벤트 ──
    /** 처음 보는 게시물이면 true. 같은 게시물을 두 번 처리하지 않아요. */
    markPostSeen(id: string, text: string, createdAt: string) {
      const res = db.prepare('INSERT OR IGNORE INTO posts (id, text, created_at, seen_at) VALUES (?, ?, ?, ?)').run(id, text, createdAt, now());
      return Number(res.changes) > 0;
    },
    addEvent(e: Omit<ResetEvent, 'id' | 'detectedAt' | 'notifiedCount'>): ResetEvent | null {
      const event: ResetEvent = { ...e, id: randomUUID(), detectedAt: now(), notifiedCount: 0 };
      const res = db.prepare(`INSERT OR IGNORE INTO events (id, post_id, url, text, posted_at, detected_at, kind, scope, title, summary, status, notified_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`).run(event.id, event.postId, event.url, event.text, event.postedAt, event.detectedAt,
        event.kind, event.scope, event.title, event.summary, event.status);
      return Number(res.changes) > 0 ? event : null;
    },
    event(id: string): ResetEvent | null {
      const r = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
      return r ? rowToEvent(r) : null;
    },
    /** 앱에 보여주는 목록. 운영자가 거른 이벤트(skipped)와 확인 전(pending)은 숨겨요. */
    publicEvents(limit = 30): ResetEvent[] {
      return (db.prepare("SELECT * FROM events WHERE status = 'sent' ORDER BY posted_at DESC LIMIT ?").all(limit) as any[]).map(rowToEvent);
    },
    allEvents(limit = 50): ResetEvent[] {
      return (db.prepare('SELECT * FROM events ORDER BY posted_at DESC LIMIT ?').all(limit) as any[]).map(rowToEvent);
    },
    setEventStatus(id: string, status: ResetEvent['status'], notifiedCount?: number) {
      if (notifiedCount === undefined) db.prepare('UPDATE events SET status = ? WHERE id = ?').run(status, id);
      else db.prepare('UPDATE events SET status = ?, notified_count = ? WHERE id = ?').run(status, notifiedCount, id);
    },

    // ── 메타 ──
    getMeta(key: string): string | null {
      return (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as any)?.value ?? null;
    },
    setMeta(key: string, value: string) {
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
    },
  };
}
export type Store = ReturnType<typeof openStore>;
