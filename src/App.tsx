import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { koreanCopy, kstLabel, relativeLabel, type FeedResponse, type ResetEvent, type SubscriptionState } from '../shared/reset';
import { api, ApiError } from './api';
import { EmptyMoon, EventIcon, HeroGauge, Logo, StepIcon } from './Art';
import { connectNative, createAuthCode, haptic, isNativeToss, openExternal, requestAgreement, shareApp } from './platform';

/** 알림 종류별 기능성 캠페인 발송 코드. 동의 화면을 띄울 때도 이 코드를 써요. */
const TEMPLATES = {
  reset: import.meta.env.VITE_TOSS_RESET_TEMPLATE as string | undefined,
  planned: import.meta.env.VITE_TOSS_PLAN_TEMPLATE as string | undefined,
};
type SheetKind =
  | { type: 'event'; event: ResetEvent }
  | { type: 'settings' }
  | { type: 'policy'; kind: 'terms' | 'privacy' }
  | null;

/** 1분마다 상대 시간을 다시 그려요. */
function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  return now;
}

export default function App() {
  const now = useNow();
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [feedError, setFeedError] = useState(false);
  const [sub, setSub] = useState<SubscriptionState | null>(null);
  const [busy, setBusy] = useState(false);
  /** 알림을 받기 전, 홈 화면 스위치로 고른 알림 종류 */
  const [draft, setDraft] = useState<SubscriptionState['types']>({ reset: true, planned: false });
  /** 저장 중인 최신 선택과 저장 순서 */
  const latestTypes = useRef<SubscriptionState['types'] | null>(null);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [toast, setToast] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const sheetRef = useRef<SheetKind>(null);
  sheetRef.current = sheet;

  const showToast = useCallback((text: string) => { setToast(text); window.setTimeout(() => setToast(t => (t === text ? null : t)), 2800); }, []);
  const loadFeed = useCallback(() => {
    setFeedError(false);
    api.feed().then(setFeed).catch(() => setFeedError(true));
  }, []);

  useEffect(() => {
    loadFeed();
    if (api.hasSession()) api.subscription().then(setSub).catch(() => setSub(null));
    const t = setInterval(loadFeed, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') loadFeed(); };
    document.addEventListener('visibilitychange', onVisible);
    const off = connectNative(() => { if (sheetRef.current) { setSheet(null); return true; } return false; });
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); off(); };
  }, [loadFeed]);

  /** 토스 사용자 식별(동의 화면 없음). 이미 연결돼 있으면 바로 넘어가요. */
  async function ensureSession() {
    if (api.hasSession()) return true;
    const code = await createAuthCode();
    if (!code) { showToast('토스 앱에서 이용할 수 있어요'); return false; }
    setSub(await api.connect(code));
    return true;
  }

  /**
   * 고른 알림마다 해당 캠페인 코드로 동의를 받아요. 두 캠페인이 같은 동의문을 쓰면
   * 두 번째는 화면 없이 alreadyAgreed로 넘어가요. 막히면 안내하고 false를 돌려줘요.
   */
  async function agreeFor(types: SubscriptionState['types']) {
    for (const kind of ['reset', 'planned'] as const) {
      if (!types[kind]) continue;
      const result = await requestAgreement(TEMPLATES[kind]);
      if (result === 'agreed') continue;
      if (result === 'rejected') showToast('알림을 받으려면 동의가 필요해요');
      else if (result === 'unsupported') showToast(isNativeToss() ? '토스 앱을 최신 버전으로 업데이트해 주세요' : '토스 앱에서 알림을 받을 수 있어요');
      else if (result === 'not-ready') showToast('알림 기능을 준비하고 있어요. 조금만 기다려 주세요');
      else showToast('잠시 후 다시 시도해 주세요');
      return false;
    }
    return true;
  }

  async function subscribe(types: SubscriptionState['types'] = { reset: true, planned: true }) {
    if (busy) return;
    setBusy(true);
    try {
      if (!(await agreeFor(types))) return;
      if (!(await ensureSession())) return;
      const next = await api.save(types);
      setSub(next);
      haptic('success');
      showToast(types.reset && types.planned ? '리셋 예고와 리셋 모두 알려드릴게요' : types.planned ? '리셋 예고를 알려드릴게요' : '이제 리셋되면 바로 알려드릴게요');
    } catch (e) {
      haptic('error');
      showToast(e instanceof ApiError ? e.message : '잠시 후 다시 시도해 주세요');
    } finally { setBusy(false); }
  }

  /**
   * 받는 중일 때 알림 종류 바꾸기. 새로 켜는 알림은 동의부터 받아요.
   * 저장은 순서대로 처리해서, 스위치를 빠르게 연달아 눌러도 마지막 선택이 남아요.
   */
  async function changeTypes(next: SubscriptionState['types'], base = latestTypes.current ?? sub?.types) {
    if (!sub?.subscribed || !base) return false;
    const added = { reset: next.reset && !base.reset, planned: next.planned && !base.planned };
    if (added.reset || added.planned) {
      if (busy) return false;
      setBusy(true);
      try { if (!(await agreeFor(added))) return false; } finally { setBusy(false); }
    }
    latestTypes.current = next;
    const run = saveQueue.current.then(() => saveTypes(next));
    saveQueue.current = run.catch(() => false);
    const ok = await run;
    if (latestTypes.current === next) latestTypes.current = null;
    if (!ok) latestTypes.current = null;
    return ok;
  }

  /**
   * 홈 화면 스위치. 알림을 받기 전에는 고르기만 하고(아래 버튼으로 시작),
   * 이미 받는 중이면 바로 설정을 바꿔요.
   */
  async function toggleType(kind: 'reset' | 'planned', on: boolean) {
    if (!sub?.subscribed) { if (!busy) setDraft(d => ({ ...d, [kind]: on })); return; }
    const base = latestTypes.current ?? sub.types;
    const next = { ...base, [kind]: on };
    const ok = await changeTypes(next, base);
    if (ok && (next.reset || next.planned)) showToast(`${kind === 'reset' ? '리셋 완료' : '리셋 예고'} 알림을 ${on ? '켰어요' : '껐어요'}`);
  }

  async function saveTypes(types: SubscriptionState['types']) {
    try {
      const next = types.reset || types.planned ? await api.save(types) : await api.off();
      setSub(next);
      if (!next.subscribed) { setSheet(null); showToast('알림을 껐어요'); }
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { setSub(null); setSheet(null); showToast('다시 알림 받기를 눌러 주세요'); }
      else showToast('저장하지 못했어요. 다시 시도해 주세요');
      return false;
    }
  }

  async function share() {
    const native = isNativeToss() || typeof navigator.share === 'function';
    showToast((await shareApp()) ? (native ? '공유했어요' : '소개 문구를 복사했어요') : '공유하지 못했어요');
  }

  const events = feed?.events ?? [];
  const latest = events.find(e => e.kind === 'reset');
  const fresh = !!latest && now - Date.parse(latest.postedAt) < 24 * 3600_000;
  const subscribed = !!sub?.subscribed;

  return (
    <div className="app">
      <header className="top-bar">
        <Logo size={26} /><span className="brand-name">GPT 리셋 레이더</span>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <HeroGauge fresh={fresh} />
          <h1 id="hero-title">{fresh ? <>GPT 사용량이<br />리셋됐어요</> : <>GPT 사용량이 리셋되면<br />바로 알려드릴게요</>}</h1>
          <p className="hero-sub">
            {fresh && latest ? `${relativeLabel(latest.postedAt, now)} · ${latest.scope || '전체'} 대상이에요`
              : 'Tibo가 X에 리셋 소식을 올리면 토스 알림으로 알려드려요.'}
          </p>
          <p className="status live"><span className="dot" aria-hidden="true" />리셋되기 전 알려드릴게요</p>
        </section>

        <section className="card alerts" aria-labelledby="alerts-title">
          <h2 id="alerts-title" className="section-title">받을 알림</h2>
          <div className="alert-toggles">
            <Toggle label="리셋 완료 알림" desc="사용량이 리셋되면 바로 알려드려요" checked={subscribed ? !!sub?.types.reset : draft.reset} disabled={busy}
              onChange={v => void toggleType('reset', v)} />
            <Toggle label="리셋 예고 알림" desc="Tibo가 리셋을 예고하면 미리 알려드려요" checked={subscribed ? !!sub?.types.planned : draft.planned} disabled={busy}
              onChange={v => void toggleType('planned', v)} />
          </div>
          <p className="small alerts-note">{subscribed ? '하나만 켜도 되고, 둘 다 켜도 돼요' : '받을 알림을 고르고 아래 버튼을 눌러 주세요'}</p>
        </section>

        {feed && <Stats feed={feed} />}

        <section className="card" aria-labelledby="recent-title">
          <h2 id="recent-title" className="section-title">최근 리셋 소식</h2>
          {!feed && !feedError && <div className="skeleton-list" aria-label="불러오는 중"><span /><span /></div>}
          {feed && events.length === 0 && <div className="empty"><EmptyMoon /><p>아직 새 리셋 소식이 없어요</p></div>}
          {feedError && !feed && <div className="empty"><p>소식을 불러오지 못했어요</p><button className="text-button" onClick={loadFeed}>다시 불러오기</button></div>}
          <ul className="event-list">
            {events.map(e => (
              <li key={e.id}>
                <button className="event-row" onClick={() => setSheet({ type: 'event', event: e })}>
                  <EventIcon kind={e.kind} />
                  <span className="event-texts">
                    <strong>{koreanCopy(e.kind, e.scope).title}</strong>
                    <span>{e.scope || '전체'} · {relativeLabel(e.postedAt, now)}</span>
                  </span>
                  <Chevron />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="card" aria-labelledby="how-title">
          <h2 id="how-title" className="section-title">이렇게 알려드려요</h2>
          <ol className="steps">
            <Step icon="watch" title="리셋 소식을 살펴봐요" text="Tibo(@thsottiaux)가 올리는 리셋 소식을 확인해요." />
            <Step icon="detect" title="리셋 공지만 골라요" text="사용량 리셋 소식일 때만 알림을 보내요." />
            <Step icon="notify" title="토스로 알려드려요" text="밤에도 놓치지 않게 바로 보내드려요." />
          </ol>
        </section>

        <section className="card share-card">
          <div><strong>GPT 쓰는 친구가 있나요?</strong><span>리셋 소식을 같이 받아 보세요</span></div>
          <button className="pill-button" onClick={share}>공유하기</button>
        </section>

        <footer className="footer">
          <p>GPT 리셋 레이더는 OpenAI·X와 관련 없는 개인 서비스예요. 공개 게시물을 바탕으로 알려드리며, 실제 사용량은 GPT에서 확인해 주세요.</p>
          <p className="footer-links">
            <button onClick={() => setSheet({ type: 'policy', kind: 'terms' })}>이용약관</button>
            <button onClick={() => setSheet({ type: 'policy', kind: 'privacy' })}>개인정보 처리방침</button>
          </p>
          <p className="seller">운영 블루씨엘 · 문의 bluecl@bluecl.cloud</p>
        </footer>
      </main>

      <div className="bottom-cta">
        {subscribed
          ? <button className="cta weak" onClick={() => setSheet({ type: 'settings' })}><BellOn /> 알림 받는 중</button>
          : <button className="cta" onClick={() => void subscribe(draft)} disabled={busy || (!draft.reset && !draft.planned)} aria-busy={busy}>{busy ? <span className="spinner" aria-label="연결 중" /> : !draft.reset && !draft.planned ? '받을 알림을 골라 주세요' : '알림 받기'}</button>}
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}

      {sheet?.type === 'event' && <Sheet title={koreanCopy(sheet.event.kind, sheet.event.scope).title} onClose={() => setSheet(null)}><EventDetail event={sheet.event} /></Sheet>}
      {sheet?.type === 'settings' && sub && <Sheet title="알림 설정" onClose={() => setSheet(null)}><Settings sub={sub} onChange={t => void changeTypes(t)} /></Sheet>}
      {sheet?.type === 'policy' && <Sheet title={policyTitle[sheet.kind]} onClose={() => setSheet(null)}><Policy kind={sheet.kind} /></Sheet>}
    </div>
  );
}


function Stats({ feed }: { feed: FeedResponse }) {
  const s = feed.stats;
  if (!s || (s.resets90d === 0 && s.avgGapDays === null)) return null;
  return (
    <section className="card stats" aria-label="리셋 통계">
      <dl>
        <div><dt>최근 90일</dt><dd><b>{s.resets90d}</b>번 리셋</dd></div>
        <div><dt>평균 간격</dt><dd>{s.avgGapDays === null ? '—' : <><b>{s.avgGapDays}</b>일</>}</dd></div>
        <div><dt>알림까지</dt><dd>{s.avgDelayMin === null ? <><b>10</b>분 이내</> : <><b>{s.avgDelayMin}</b>분</>}</dd></div>
      </dl>
    </section>
  );
}

function Step({ icon, title, text }: { icon: 'watch' | 'detect' | 'notify'; title: string; text: string }) {
  return <li className="step"><StepIcon kind={icon} /><span><strong>{title}</strong><span>{text}</span></span></li>;
}

function EventDetail({ event }: { event: ResetEvent }) {
  return (
    <div className="detail">
      <span className={`badge ${event.kind}`}>{event.kind === 'reset' ? '리셋 완료' : '리셋 예고'}</span>
      <h2 className="detail-title">{koreanCopy(event.kind, event.scope).title}</h2>
      <p className="detail-summary">{koreanCopy(event.kind, event.scope).summary}</p>
      <dl className="facts">
        <div><dt>대상</dt><dd>{event.scope || '전체'}</dd></div>
        <div><dt>게시 시각</dt><dd>{kstLabel(event.postedAt)}</dd></div>
        {event.notifiedCount > 0 && <div><dt>알림 받은 사람</dt><dd>{event.notifiedCount.toLocaleString('ko-KR')}명</dd></div>}
      </dl>
      <figure className="quote">
        <blockquote lang="en">{event.text}</blockquote>
        <figcaption>Tibo · @thsottiaux</figcaption>
      </figure>
      <button className="cta weak full" onClick={() => void openExternal(event.url)}>X에서 원문 보기</button>
    </div>
  );
}

function Settings({ sub, onChange }: { sub: SubscriptionState; onChange: (t: SubscriptionState['types']) => void }) {
  return (
    <div className="settings">
      <h2 className="detail-title">알림 설정</h2>
      <Toggle label="리셋 완료 알림" desc="사용량이 리셋되면 바로 알려드려요" checked={sub.types.reset} onChange={v => onChange({ ...sub.types, reset: v })} />
      <Toggle label="리셋 예고 알림" desc="Tibo가 리셋을 예고하면 알려드려요" checked={sub.types.planned} onChange={v => onChange({ ...sub.types, planned: v })} />
      {sub.since && <p className="small">{kstLabel(sub.since)}부터 알림을 받고 있어요</p>}
      <button className="text-button danger" onClick={() => onChange({ reset: false, planned: false })}>알림 끄기</button>
    </div>
  );
}

function Toggle({ label, desc, checked, disabled, onChange }: { label: string; desc: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={`toggle-row ${disabled ? 'is-disabled' : ''}`}>
      <span><strong>{label}</strong><span>{desc}</span></span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

function Sheet({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  // 시트를 연 버튼을 처음 렌더할 때 한 번만 기억해요(StrictMode에서 effect가 두 번 돌아도 안전).
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; if (opener?.isConnected) opener.focus(); };
  }, [opener]);
  return (
    <dialog ref={ref} className="sheet" aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet-inner">
        <div className="sheet-handle" aria-hidden="true" />
        <button className="sheet-close" aria-label="닫기" onClick={onClose}><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></button>
        {children}
      </div>
    </dialog>
  );
}

const policyTitle = { terms: '이용약관', privacy: '개인정보 처리방침' } as const;

function Policy({ kind }: { kind: 'terms' | 'privacy' }) {
  const sections = {
    terms: [
      ['서비스 안내', 'GPT 리셋 레이더는 블루씨엘이 운영하며, Tibo(@thsottiaux)가 공개한 GPT 사용량 리셋 소식을 10분 간격으로 확인해 알려드리는 무료 참고용 서비스예요. 리셋 기록은 독립 트래커 codex-reset.com의 공개 데이터를 사용해요. OpenAI·X·codex-reset.com과 제휴하거나 승인받은 서비스가 아니에요.'],
      ['알림의 한계', '게시물 확인 주기, X·토스 서비스 상태, 자동 분류 오류로 알림이 늦거나 누락되거나 잘못 갈 수 있어요. 리셋 여부와 횟수는 OpenAI가 정하며 GPT 리셋 레이더는 이를 보장하지 않아요. 실제 사용량은 GPT에서 확인해 주세요.'],
      ['알림 해지', '앱의 알림 설정에서 언제든 알림을 끌 수 있어요. GPT 리셋 레이더는 무료로 제공해요.'],
      ['변경과 문의', '서비스 내용이 바뀌거나 중단될 수 있으며 중요한 변경은 시행 7일 전에 앱에서 알려드려요. 문의: bluecl@bluecl.cloud'],
    ],
    privacy: [
      ['수집하는 정보', '알림을 받기로 하면 토스가 이 미니앱 전용으로 발급하는 사용자 식별키와 알림 종류 설정을 저장해요. 이름·전화번호 같은 개인 정보는 받지 않아요.'],
      ['이용 목적', '선택한 리셋 알림을 토스 메시지로 보내는 데만 사용해요.'],
      ['보관 기간', '알림을 끄면 발송 대상에서 바로 제외하고, 30일 안에 알림 설정을 삭제해요. 서버 접속 기록은 14일 후 삭제해요.'],
      ['문의', '열람·삭제 요청은 bluecl@bluecl.cloud로 보내 주세요.'],
    ],
  }[kind];
  return <article className="policy"><h2 className="detail-title">{policyTitle[kind]}</h2><p className="small">시행일 2026년 10월 28일</p>{sections.map(([t, d]) => <section key={t}><h3>{t}</h3><p>{d}</p></section>)}</article>;
}

const Chevron = () => <svg className="chevron" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const BellOn = () => <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 4c-3.3 0-5.5 2.4-5.5 5.7v3L5 15.5h14l-1.5-2.8v-3C17.5 6.4 15.3 4 12 4z" fill="currentColor" /><path d="M10 18a2 2 0 0 0 4 0" fill="currentColor" /></svg>;
