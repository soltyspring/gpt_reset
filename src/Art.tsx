/** 토스 스타일의 부드러운 3D 느낌 일러스트. 모두 장식용이라 aria-hidden이에요. */

export function Logo({ size = 28 }: { size?: number }) {
  return <img src={`${import.meta.env.BASE_URL}logo.png`} width={size} height={size} alt="" aria-hidden="true" className="logo" />;
}

/** 다시 채워지는 사용량 게이지 */
export function HeroGauge({ fresh }: { fresh: boolean }) {
  return (
    <svg className={`hero-gauge ${fresh ? 'is-fresh' : ''}`} viewBox="0 0 240 180" aria-hidden="true">
      <defs>
        <linearGradient id="g-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#eef3fa" /></linearGradient>
        <linearGradient id="g-fill" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#1b64da" /><stop offset="1" stopColor="#64a8ff" /></linearGradient>
        <filter id="g-shadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#1b64da" floodOpacity=".16" /></filter>
      </defs>
      <ellipse cx="120" cy="164" rx="70" ry="9" fill="#d9e6f7" />
      <g filter="url(#g-shadow)">
        <rect x="70" y="26" width="100" height="132" rx="26" fill="url(#g-body)" />
        <rect x="102" y="14" width="36" height="18" rx="8" fill="#dbe7f5" />
      </g>
      <clipPath id="g-clip"><rect x="82" y="38" width="76" height="108" rx="16" /></clipPath>
      <g clipPath="url(#g-clip)">
        <rect x="82" y="38" width="76" height="108" fill="#e8f0fb" />
        <rect className="gauge-level" x="82" y="38" width="76" height="108" fill="url(#g-fill)" />
      </g>
      <path d="M126 62l-24 36h16l-6 28 26-38h-17z" fill="#ffffff" />
      <g className="sparkles" fill="#ffc342">
        <path d="M40 54l5 11 11 5-11 5-5 11-5-11-11-5 11-5z" />
        <path d="M196 34l3.5 8 8 3.5-8 3.5-3.5 8-3.5-8-8-3.5 8-3.5z" />
        <circle cx="204" cy="112" r="5" fill="#9ccaff" />
        <circle cx="34" cy="122" r="4" fill="#9ccaff" />
      </g>
    </svg>
  );
}

/** 단계 아이콘: 확인 · 감지 · 알림 */
export function StepIcon({ kind }: { kind: 'watch' | 'detect' | 'notify' }) {
  return (
    <svg className="step-icon" viewBox="0 0 48 48" aria-hidden="true">
      <rect width="48" height="48" rx="16" fill={kind === 'notify' ? '#e8f3ff' : kind === 'detect' ? '#fff4e0' : '#eefaf3'} />
      {kind === 'watch' && <g fill="none" stroke="#14b86d" strokeWidth="3.2" strokeLinecap="round"><circle cx="24" cy="24" r="11" /><path d="M24 17v7l5 3" /></g>}
      {kind === 'detect' && <g><circle cx="22" cy="22" r="9" fill="none" stroke="#f59a00" strokeWidth="3.2" /><path d="M29 29l6 6" stroke="#f59a00" strokeWidth="3.6" strokeLinecap="round" /><path d="M22 17l-4 6h4l-1 4 4-6h-4z" fill="#f59a00" /></g>}
      {kind === 'notify' && <g><path d="M24 13c-5.5 0-9 4-9 9.5v5L13 31h22l-2-3.5v-5c0-5.5-3.5-9.5-9-9.5z" fill="#3182f6" /><path d="M20.5 33.5a3.5 3.5 0 0 0 7 0" fill="#3182f6" /></g>}
    </svg>
  );
}

/** 목록용 이벤트 아이콘 */
export function EventIcon({ kind }: { kind: 'reset' | 'planned' }) {
  return (
    <svg className="event-icon" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="20" fill={kind === 'reset' ? '#e8f3ff' : '#fff4e0'} />
      {kind === 'reset'
        ? <g fill="none" stroke="#3182f6" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M28 20a8 8 0 1 1-2.6-5.9" /><path d="M26 9.5v5h-5" /></g>
        : <g fill="none" stroke="#f59a00" strokeWidth="2.8" strokeLinecap="round"><circle cx="20" cy="20" r="8.5" /><path d="M20 15.5V20l3 2" /></g>}
    </svg>
  );
}

/** 빈 상태 */
export function EmptyMoon() {
  return (
    <svg className="empty-art" viewBox="0 0 120 96" aria-hidden="true">
      <ellipse cx="60" cy="88" rx="34" ry="5" fill="#eef1f5" />
      <path d="M72 18a30 30 0 1 0 22 46 26 26 0 1 1-22-46z" fill="#ffd66b" />
      <circle cx="26" cy="22" r="3" fill="#c9d8ea" /><circle cx="98" cy="30" r="2.5" fill="#c9d8ea" />
    </svg>
  );
}


