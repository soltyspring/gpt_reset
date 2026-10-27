/**
 * Tibo(@thsottiaux)의 게시물에서 GPT(Codex) 사용량 리셋 공지를 찾아요.
 * 규칙 기반이라 결과를 설명할 수 있고, 테스트로 고정할 수 있어요.
 */
export type ResetKind = 'reset' | 'planned' | 'none';

export interface Classification {
  kind: ResetKind;
  /** auto: 확실해서 바로 발송해도 됨 / review: 운영자 확인 필요 */
  confidence: 'auto' | 'review' | 'none';
  scope: string;
  reasons: string[];
}

export interface Post {
  id: string;
  text: string;
  createdAt: string; // ISO
  isReply?: boolean;
  isRetweet?: boolean;
  /** 외부 검증 소스가 이미 리셋으로 확인한 글. 분류 규칙을 건너뛰어요. */
  verified?: { kind: 'reset'; scope: string };
}

export interface ResetEvent {
  id: string;
  postId: string;
  url: string;
  text: string;
  postedAt: string;
  detectedAt: string;
  kind: Exclude<ResetKind, 'none'>;
  scope: string;
  title: string;
  summary: string;
  /** pending: 운영자 확인 대기 / sent: 발송 완료 / skipped: 발송하지 않음 */
  status: 'pending' | 'sent' | 'skipped';
  notifiedCount: number;
}

export interface FeedResponse {
  events: ResetEvent[];
  stats: FeedStats;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  intervalMinutes: number;
  source: { name: string; url: string };
}

export interface SubscriptionState {
  subscribed: boolean;
  types: { reset: boolean; planned: boolean };
  since: string | null;
}

export interface FeedStats {
  /** 최근 90일 리셋 횟수 */
  resets90d: number;
  /** 리셋 간 평균 간격(일). 2회 미만이면 null */
  avgGapDays: number | null;
  /** 감지부터 평균 알림까지 걸린 시간(분). 기록이 없으면 null */
  avgDelayMin: number | null;
}

const RESET_WORD = /\breset(?:s|ting)?\b/i;
const LIMIT_WORD = /\b(limits?|usage|rate[- ]?limits?|quota|weekly|5[- ]?h(?:our)?|window)\b/i;
const CODEX_WORD = /\b(codex|gpt-?\d[\w.-]*|chatgpt)\b/i;

/** 과거·완료형: 이미 리셋됨 */
const DONE_PATTERNS: RegExp[] = [
  /\b(i|we)(?:'ve| have| just| had)?\s+(?:just\s+|now\s+|also\s+|fully\s+)*reset\b/i,
  /\b(?:have|has|had|'ve|got|been)\s+(?:just\s+|now\s+|fully\s+|all\s+)*(?:been\s+)?reset\b/i,
  /\b(?:limits?|usage)\s+(?:are|is|were|was)\s+(?:now\s+|fully\s+)?reset\b/i,
  /\breset\s+(?:has|have)\s+(?:been\s+)?(?:propagated|rolled out|applied|completed|done)\b/i,
  /\bfully reset\b/i,
  /\bjust reset\b/i,
  /\breset (?:is|are) (?:live|done|complete|out)\b/i,
  /\bdid it again\b.*\breset\b|\breset\b.*\bdid it again\b/i,
];

/** 미래·예고형 */
const PLAN_PATTERNS: RegExp[] = [
  /\b(?:will|'ll|going to|gonna|about to|plan(?:ning)? to)\s+(?:be\s+)?(?:\w+\s+){0,2}reset/i,
  /\bresetting\b.*\b(?:tonight|today|tomorrow|soon|shortly|later|in \d+|this (?:evening|morning|afternoon|week))\b/i,
  /\breset(?:s)?\b.*\b(?:tonight|tomorrow|later today|shortly|soon|in (?:a few|\d+) (?:minutes|hours))\b/i,
  /\bexpect (?:a|another) reset\b/i,
];

/** 리셋 공지가 아닌데 reset 단어가 들어가는 경우 */
const EXCLUDE_PATTERNS: RegExp[] = [
  /\bwhen (?:your\s+)?(?:limits?|usage)\s+resets?\b/i,
  /\bsee when\b.*\breset/i,
  /\breset (?:time|timer|date) (?:is|shows|displays)\b/i,
  /\b(?:no|not|won't|will not|don't|didn't|isn't|aren't|never)\s+(?:\w+\s+){0,2}reset/i,
  /\breset (?:your|the) (?:password|session|config|settings|branch|git|state)\b/i,
  /\bgit reset\b/i,
  /\bshould we reset\b|\bwould you (?:like|want)\b.*\breset/i,
];

const SCOPES: [RegExp, string][] = [
  [/\ball paid (?:plans|users|subscribers|tiers)\b/i, '모든 유료 플랜'],
  [/\b(?:everyone|all users|all codex users|for all|everybody)\b/i, '모든 사용자'],
  [/\bbusiness\b|\benterprise\b|\bedu\b|\bteam plan\b/i, '비즈니스·엔터프라이즈'],
  [/\bpro\b/i, 'Pro'],
  [/\bplus\b/i, 'Plus'],
];

export function classify(post: Pick<Post, 'text' | 'isReply' | 'isRetweet'>): Classification {
  const text = normalize(post.text);
  const reasons: string[] = [];
  const none = (reason: string): Classification => ({ kind: 'none', confidence: 'none', scope: '', reasons: [reason] });
  if (post.isRetweet) return none('retweet');
  if (!RESET_WORD.test(text)) return none('no-reset-word');
  if (EXCLUDE_PATTERNS.some(p => p.test(text))) return none('excluded-phrase');
  const hasLimit = LIMIT_WORD.test(text);
  const hasCodex = CODEX_WORD.test(text);
  if (!hasLimit && !hasCodex && !/\breset has been propagated\b/i.test(text)) return none('no-limit-context');
  if (hasLimit) reasons.push('limit-context');
  if (hasCodex) reasons.push('codex-context');

  const planned = PLAN_PATTERNS.some(p => p.test(text));
  const done = DONE_PATTERNS.some(p => p.test(text));
  const question = /\?\s*$/.test(text.trim()) && !done;
  if (question) return none('question');

  let kind: ResetKind = 'none';
  if (done) { kind = 'reset'; reasons.push('done-phrase'); }
  else if (planned) { kind = 'planned'; reasons.push('plan-phrase'); }
  else return none('no-announcement-phrase');

  // 답글은 문맥이 부족해서 사람이 확인해요. 사용량 문맥이 없어도 확인이 필요해요.
  const confident = !post.isReply && hasLimit && kind === 'reset';
  if (post.isReply) reasons.push('reply');
  return { kind, confidence: confident ? 'auto' : 'review', scope: scopeOf(text), reasons };
}

export function scopeOf(text: string) {
  const found: string[] = [];
  for (const [pattern, label] of SCOPES) {
    if (pattern.test(text) && !found.includes(label)) found.push(label);
    if (label === '모든 유료 플랜' && found.length) break;
  }
  if (found.includes('모든 유료 플랜') || found.includes('모든 사용자')) return found[0];
  return found.join('·');
}

/** 토스 문구 규칙: 해요체, 짧게, 결과 먼저. */
export function koreanCopy(kind: Exclude<ResetKind, 'none'>, scope: string) {
  const who = scope ? `${scope} ` : '';
  if (kind === 'reset') return {
    title: 'GPT 사용량이 리셋됐어요',
    summary: `${who}사용량이 다시 채워졌어요. 지금 바로 써 보세요.`.replace(/^\s+/, ''),
  };
  return {
    title: '곧 GPT 사용량이 리셋돼요',
    summary: `${who}리셋이 예고됐어요. 리셋되면 다시 알려드릴게요.`,
  };
}

export function postUrl(username: string, id: string) {
  return `https://x.com/${username}/status/${id}`;
}

function normalize(text: string) {
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[’‘]/g, "'").replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 한국 시간 표기: "10월 28일 오전 1:13" */
export function kstLabel(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
}

export function relativeLabel(iso: string, now = Date.now()) {
  const diff = Math.max(0, now - Date.parse(iso));
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day}일 전`;
  return kstLabel(iso);
}


/** 리셋 통계. 리셋 완료 이벤트만 셈해요. */
export function feedStats(events: ResetEvent[], now = Date.now()): FeedStats {
  const resets = events.filter(e => e.kind === 'reset').map(e => ({ at: Date.parse(e.postedAt), detected: Date.parse(e.detectedAt) }))
    .filter(e => Number.isFinite(e.at)).sort((a, b) => a.at - b.at);
  const resets90d = resets.filter(e => now - e.at <= 90 * 86400_000).length;
  const gaps = resets.slice(1).map((e, i) => (e.at - resets[i].at) / 86400_000);
  const avgGapDays = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null;
  // 첫 수집 때 기록만 한 과거 글은 감지 지연이 커서 제외해요(2시간 이내만).
  const delays = resets.map(e => (e.detected - e.at) / 60000).filter(d => d >= 0 && d <= 120);
  const avgDelayMin = delays.length ? Math.max(1, Math.round(delays.reduce((a, b) => a + b, 0) / delays.length)) : null;
  return { resets90d, avgGapDays, avgDelayMin };
}
