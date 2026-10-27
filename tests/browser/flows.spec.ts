import { test, expect } from '@playwright/test';

// 테스트마다 새 사용자로 시작해요. 새로고침에서는 세션을 유지해요.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('cleared')) { localStorage.clear(); sessionStorage.setItem('cleared', '1'); } });
});
const shot = (name: string, project: string) => `docs/screenshots/${project}-${name}.png`;

test('홈: 리셋 소식·통계·전체 기록 (모두 무료)', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('리셋됐어요');
  await expect(page.getByText('리셋되기 전 알려드릴게요')).toBeVisible();
  await expect(page.getByText(/확인했어요|분마다|codex-reset\.com/)).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('Codex'); // 용어는 GPT로 통일
  await expect(page.locator('.event-row').first()).toContainText('GPT 사용량이 리셋됐어요');
  await expect(page.getByRole('region', { name: '리셋 통계' })).toContainText('최근 90일');
  expect(await page.locator('.event-row').count()).toBeGreaterThan(3);
  await expect(page.getByText(/플러스|결제|이용권/)).toHaveCount(0);
  await page.screenshot({ path: shot('home', info.project.name), fullPage: true, animations: 'disabled' });
});

test('상세: 원문과 요약', async ({ page }, info) => {
  await page.goto('/');
  await page.locator('.event-row').first().click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('리셋 완료')).toBeVisible();
  await expect(sheet.getByText('@thsottiaux')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'X에서 원문 보기' })).toBeVisible();
  await page.screenshot({ path: shot('detail', info.project.name), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('알림 고르기 → 버튼으로 시작 → 홈에서 바꾸기 → 새로고침 유지 → 끄기', async ({ page }, info) => {
  await page.goto('/');
  const card = page.getByRole('region', { name: '받을 알림' });
  const reset = card.getByRole('switch', { name: /리셋 완료 알림/ });
  const planned = card.getByRole('switch', { name: /리셋 예고 알림/ });
  // 기본은 리셋 완료만 선택. 스위치를 눌러도 아직 등록하지 않아요.
  await expect(reset).toBeChecked();
  await expect(planned).not.toBeChecked();
  await card.getByText('리셋 예고 알림').click();
  await card.getByText('리셋 완료 알림').click();
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '알림 받는 중' })).toHaveCount(0);
  // 예고만 고르고 시작
  await page.getByRole('button', { name: '알림 받기', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('리셋 예고를 알려드릴게요');
  await expect(planned).toBeChecked();
  await expect(reset).not.toBeChecked();
  await page.screenshot({ path: shot('settings', info.project.name), fullPage: true, animations: 'disabled' });
  // 받는 중에는 홈 스위치가 바로 저장돼요
  await card.getByText('리셋 완료 알림').click();
  await expect(page.getByRole('status')).toHaveText('리셋 완료 알림을 켰어요');
  await page.reload();
  await expect(reset).toBeChecked();
  await expect(planned).toBeChecked();
  // 둘 다 끄면 알림이 꺼져요
  await card.getByText('리셋 완료 알림').click();
  await card.getByText('리셋 예고 알림').click();
  await expect(page.getByRole('status')).toHaveText('알림을 껐어요');
  await expect(page.getByRole('button', { name: /알림 받기|받을 알림을 골라 주세요/ })).toBeVisible();
});

test('아무 알림도 고르지 않으면 시작 버튼이 꺼져요', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('region', { name: '받을 알림' }).getByText('리셋 완료 알림').click();
  await expect(page.getByRole('button', { name: '받을 알림을 골라 주세요' })).toBeDisabled();
});

test('약관과 처리방침', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '개인정보 처리방침' }).click();
  await expect(page.getByRole('dialog').getByText('수집하는 정보')).toBeVisible();
});

test('키보드: 시트를 닫으면 원래 버튼으로 초점이 돌아와요', async ({ page }) => {
  await page.goto('/');
  const row = page.locator('.event-row').first();
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(row).toBeFocused();
});
