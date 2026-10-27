import { request, Agent } from 'node:https';
import { readFileSync } from 'node:fs';

const BASE = 'https://apps-in-toss-api.toss.im';

export class TossError extends Error {
  constructor(public code: string, message = code) { super(message); }
}

export interface SendResult { sent: number; failed: number }

export interface TossClient {
  mock: boolean;
  exchangeCode(code: string): Promise<string>;
  /** 같은 템플릿을 여러 사용자에게 보내요. 2,500건 단위로 나눠요. */
  sendBulk(templateSetCode: string, items: { anonKey: string; context: Record<string, string> }[]): Promise<SendResult>;
  sendOne(templateSetCode: string, anonKey: string, context: Record<string, string>): Promise<boolean>;
}

type Call = (path: string, body: unknown, headers?: Record<string, string>) => Promise<any>;

function mtlsCaller(certPath: string, keyPath: string): Call {
  const agent = new Agent({ cert: readFileSync(certPath), key: readFileSync(keyPath), keepAlive: true });
  return (path, body, headers = {}) => new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = request(BASE + path, {
      method: 'POST', agent, timeout: 15000,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...headers },
    }, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: any = null;
        try { json = JSON.parse(text); } catch { /* 비JSON 응답 */ }
        if ((res.statusCode ?? 500) >= 400) return reject(new TossError(`TOSS_HTTP_${res.statusCode}`));
        resolve(json);
      });
    });
    req.on('timeout', () => req.destroy(new TossError('TOSS_TIMEOUT')));
    req.on('error', e => reject(e instanceof TossError ? e : new TossError('TOSS_NETWORK')));
    req.end(payload);
  });
}

/** 응답 봉투 해석. 비즈니스 오류도 HTTP 200으로 와서 resultType을 꼭 확인해요. */
function unwrap(json: any) {
  if (json && json.resultType === 'SUCCESS') return json.success;
  if (json && json.resultType && json.resultType !== 'SUCCESS') throw new TossError(`TOSS_${json.error?.errorCode ?? json.resultType}`);
  return json; // 메시지 API는 봉투 없이 msgCount 등을 바로 돌려줄 수 있어요.
}
function countSent(r: any): number {
  const v = r?.msgCount ?? r?.success?.msgCount;
  return typeof v === 'number' ? v : 0;
}

export function createTossClient(call: Call, mock = false): TossClient {
  return {
    mock,
    async exchangeCode(code) {
      if (!/^[\w.-]{8,512}$/.test(code)) throw new TossError('TOSS_BAD_CODE');
      const success = unwrap(await call('/api-partner/v1/apps-in-toss/users/anon-key/exchange', { code }));
      const anonKey = success?.anonKey;
      if (typeof anonKey !== 'string' || !anonKey) throw new TossError('TOSS_BAD_RESPONSE');
      return anonKey;
    },
    async sendBulk(templateSetCode, items) {
      let sent = 0, failed = 0;
      for (let i = 0; i < items.length; i += 2500) {
        const chunk = items.slice(i, i + 2500);
        try {
          const r = unwrap(await call('/api-partner/v1/apps-in-toss/messenger/send-bulk-message', {
            templateSetCode, contextList: chunk.map(x => ({ anonKey: x.anonKey, context: x.context })),
          }));
          const n = countSent(r) || chunk.length;
          sent += Math.min(n, chunk.length); failed += Math.max(0, chunk.length - n);
        } catch { failed += chunk.length; }
      }
      return { sent, failed };
    },
    async sendOne(templateSetCode, anonKey, context) {
      try {
        unwrap(await call('/api-partner/v1/apps-in-toss/messenger/send-message', { templateSetCode, context }, { 'x-anon-key': anonKey }));
        return true;
      } catch { return false; }
    },
  };
}

/** 로컬·테스트용 가짜 토스 서버. 보낸 내용을 기록해요. */
export function mockCaller(log: { path: string; body: any; headers?: Record<string, string> }[] = []): Call {
  return async (path, body: any, headers) => {
    log.push({ path, body, headers });
    if (path.endsWith('/anon-key/exchange')) {
      if (String(body.code).startsWith('bad')) return { resultType: 'FAIL', error: { errorCode: '4011', reason: 'invalid' } };
      return { resultType: 'SUCCESS', success: { anonKey: 'mock-anon-' + String(body.code).slice(0, 24) } };
    }
    if (path.endsWith('/send-bulk-message')) return { resultType: 'SUCCESS', success: { msgCount: body.contextList.length } };
    return { resultType: 'SUCCESS', success: { msgCount: 1 } };
  };
}

/** 인증서가 아직 없을 때. 피드 조회는 되고, 식별·발송만 503으로 막아요. */
export function unavailableToss(reason = 'TOSS_MTLS_MISSING'): TossClient {
  const fail = async (): Promise<never> => { throw new TossError(reason); };
  return { mock: false, exchangeCode: fail, sendBulk: fail, sendOne: async () => false };
}

/** 운영 시작용: 설정이 빠졌으면 죽지 않고 unavailable로 돌아요. 운영 중 mock은 여전히 거부해요. */
export function tossOrUnavailable(env = process.env, log: (m: string) => void = console.warn): TossClient {
  try { return tossFromEnv(env); }
  catch (e) {
    if (e instanceof TossError && e.code === 'TOSS_MOCK_IN_PRODUCTION') throw e;
    log(`[toss] ${(e as Error).message} → 알림 기능 없이 시작해요`);
    return unavailableToss();
  }
}

export function tossFromEnv(env = process.env): TossClient {
  if (env.TOSS_MOCK === 'true') {
    if (env.NODE_ENV === 'production') throw new TossError('TOSS_MOCK_IN_PRODUCTION', '운영 환경에서는 TOSS_MOCK을 쓸 수 없어요.');
    return createTossClient(mockCaller(), true);
  }
  if (!env.TOSS_MTLS_CERT || !env.TOSS_MTLS_KEY) throw new TossError('TOSS_MTLS_MISSING', 'TOSS_MTLS_CERT·TOSS_MTLS_KEY를 설정해 주세요.');
  return createTossClient(mtlsCaller(env.TOSS_MTLS_CERT, env.TOSS_MTLS_KEY));
}
