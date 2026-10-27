const base = process.env.VITE_API_BASE_URL;
const fail = msg => { console.error(msg); process.exit(1); };
if (!base || !/^https:\/\/[^/?#]+(?:\/[^?#]*)?$/.test(base) || new URL(base).hostname === 'localhost')
  fail('출시용 API 설정이 필요해요. VITE_API_BASE_URL에 외부에서 접근 가능한 HTTPS 주소를 입력해 주세요. 로컬 검토는 npm run bundle:preview를 사용해요.');
for (const name of ['VITE_TOSS_RESET_TEMPLATE', 'VITE_TOSS_PLAN_TEMPLATE'])
  if (!/^tibo-/.test(process.env[name] || '')) fail(name + '에 알림 동의문이 연결된 캠페인 발송 코드(tibo-로 시작)를 입력해 주세요.');
console.log('출시용 설정을 확인했어요. 콘솔 검수와 실기기 테스트는 별도로 진행해 주세요.');
