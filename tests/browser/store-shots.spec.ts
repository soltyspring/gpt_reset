import { test, expect } from '@playwright/test';

/**
 * 앱인토스 콘솔 업로드용 스크린샷(세로형 636×1048px PNG, 최소 3장).
 * `npm run shots`, 그리고 `npm run build` 때마다 docs/store/ 에 덮어써요.
 * 화면 318×524 × 2배 = 636×1048.
 */
const out = (n: number) => `docs/store/screenshot-${n}.png`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('cleared')) { localStorage.clear(); sessionStorage.setItem('cleared', '1'); } });
  await page.goto('/');
  await expect(page.locator('.event-row').first()).toBeVisible();
});

test('1 홈: 리셋 소식과 통계', async ({ page }) => {
  await page.screenshot({ path: out(1), animations: 'disabled' });
});

test('2 최근 리셋 소식', async ({ page }) => {
  await page.getByRole('heading', { name: '최근 리셋 소식' }).evaluate(el => {
    const top = el.getBoundingClientRect().top + window.scrollY - 12;
    window.scrollTo(0, top);
  });
  await page.screenshot({ path: out(2), animations: 'disabled' });
});

test('3 알림 설정', async ({ page }) => {
  await page.getByRole('button', { name: '리셋되면 가장 빠르게 알려드릴까요?' }).click();
  const sheet = page.getByRole('dialog', { name: '알림 설정' });
  await expect(sheet).toBeVisible();
  await sheet.getByText('리셋 예고 알림').click(); // 두 알림을 모두 켠 모습
  await page.screenshot({ path: out(3), animations: 'disabled' });
});
