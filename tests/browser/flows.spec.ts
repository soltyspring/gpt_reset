import { test, expect } from '@playwright/test';

// 테스트마다 새 사용자로 시작해요. 새로고침에서는 세션을 유지해요.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('cleared')) { localStorage.clear(); sessionStorage.setItem('cleared', '1'); } });
});
const shot = (name: string, project: string) => `docs/screenshots/${project}-${name}.png`;

test('홈: 초기화 소식·통계·전체 기록 (모두 무료)', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('초기화됐어요');
  // 첫 화면은 같은 말을 반복하지 않아요("알려드"는 제목에서만 한 번까지)
  const heroText = await page.locator('.hero').innerText();
  expect((heroText.match(/알려드/g) ?? []).length).toBeLessThanOrEqual(1);
  await expect(page.getByText('초기화되기 전 알려드릴게요')).toHaveCount(0);
  await expect(page.getByText('이제 귀찮게 확인하지 않아도 돼요')).toBeVisible();
  await expect(page.getByText('바쁘셔도 놓치지 않게 바로 보내드려요.')).toBeVisible();
  await expect(page.getByText(/확인했어요|분마다|codex-reset\.com/)).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('Codex'); // 용어는 GPT로 통일
  await expect(page.locator('main')).not.toContainText(/tibo|thsottiaux/i);
  // 용어는 초기화로 통일(앱 이름 제외), 마지막 초기화 부제는 없어요
  expect((await page.locator('main').innerText()).replaceAll('GPT 리셋 레이더', '')).not.toContain('리셋');
  await expect(page.getByText(/마지막 (리셋|초기화)/)).toHaveCount(0);
  const how = await page.getByRole('heading', { name: '이렇게 알려드려요' }).boundingBox();
  const recent = await page.getByRole('heading', { name: '최근 초기화 소식' }).boundingBox();
  expect(how!.y).toBeLessThan(recent!.y);
  // 목록 제목은 날짜라 줄마다 달라요
  await expect(page.locator('.event-row').first()).toContainText(/\d+월 \d+일/);
  const titles = await page.locator('.event-row strong').allInnerTexts();
  expect(new Set(titles).size).toBe(titles.length);
  await expect(page.getByRole('region', { name: '초기화 통계' })).toContainText('최근 90일');
  await expect(page.getByRole('region', { name: '초기화 통계' })).not.toContainText(/알림까지|알림 속도/);
  // 최근 3개만 보이고, 더보기로 나머지를 펼치고 접어요
  await expect(page.locator('.event-row')).toHaveCount(3);
  const more = page.getByRole('button', { name: /더보기 \(\d+개\)/ });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText(/플러스|결제|이용권/)).toHaveCount(0);
  await page.screenshot({ path: shot('home', info.project.name), fullPage: true, animations: 'disabled' });
  await more.click();
  expect(await page.locator('.event-row').count()).toBeGreaterThan(3);
  await page.getByRole('button', { name: '접기' }).click();
  await expect(page.locator('.event-row')).toHaveCount(3);
});

test('상세: 원문과 요약', async ({ page }, info) => {
  await page.goto('/');
  await page.locator('.event-row').first().click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('초기화 완료')).toBeVisible();
  await expect(sheet.getByText('X 원문')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'X에서 원문 보기' })).toBeVisible();
  await page.screenshot({ path: shot('detail', info.project.name), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('화면 순서: 첫 화면 → 통계 → … → 받을 알림이 맨 아래', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('region', { name: '초기화 통계' })).toBeVisible(); // 데이터가 온 뒤에 순서를 봐요
  const order = await page.locator('main > section, main > footer').evaluateAll(els => els.map(e =>
    e.classList.contains('hero') ? 'hero' : e.classList.contains('stats') ? 'stats' : e.classList.contains('alerts') ? 'alerts' : e.tagName === 'FOOTER' ? 'footer' : 'card'));
  expect(order[0]).toBe('hero');
  expect(order[1]).toBe('stats');
  expect(order.at(-2)).toBe('alerts');
  expect(order.at(-1)).toBe('footer');
});

test('아래 버튼 → 알림 설정 창 → 고르고 시작 → 홈에서 바꾸기 → 새로고침 유지 → 끄기', async ({ page }, info) => {
  await page.goto('/');
  // 고정 버튼은 알림 설정 창을 열기만 해요(바로 등록하지 않아요).
  await page.getByRole('button', { name: '초기화되면 가장 빠르게 알려드릴까요?' }).click();
  const sheet = page.getByRole('dialog', { name: '알림 설정' });
  await expect(sheet).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.screenshot({ path: shot('settings', info.project.name), animations: 'disabled' });
  // 기본은 초기화 완료만 선택. 예고만 고르고 시작
  await expect(sheet.getByRole('switch', { name: /초기화 완료 알림/ })).toBeChecked();
  await sheet.getByText('초기화 예고 알림').click();
  await sheet.getByText('초기화 완료 알림').click();
  await sheet.getByRole('button', { name: '알림 받기', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('초기화 예고를 알려드릴게요');
  await expect(sheet).toBeHidden();
  // 맨 아래 카드에 같은 설정이 보이고, 받는 중에는 바로 저장돼요
  const card = page.getByRole('region', { name: '받을 알림' });
  const reset = card.getByRole('switch', { name: /초기화 완료 알림/ });
  const planned = card.getByRole('switch', { name: /초기화 예고 알림/ });
  await expect(planned).toBeChecked();
  await expect(reset).not.toBeChecked();
  await card.getByText('초기화 완료 알림').click();
  await expect(page.getByRole('status')).toHaveText('초기화 완료 알림을 켰어요');
  await page.reload();
  await expect(reset).toBeChecked();
  await expect(planned).toBeChecked();
  // 둘 다 끄면 알림이 꺼지고 버튼이 다시 나와요
  await card.getByText('초기화 완료 알림').click();
  await card.getByText('초기화 예고 알림').click();
  await expect(page.getByRole('status')).toHaveText('알림을 껐어요');
  await expect(page.getByRole('button', { name: '초기화되면 가장 빠르게 알려드릴까요?' })).toBeVisible();
});

test('알림 설정 창에서 아무것도 고르지 않으면 시작 버튼이 꺼져요', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '초기화되면 가장 빠르게 알려드릴까요?' }).click();
  const sheet = page.getByRole('dialog', { name: '알림 설정' });
  await sheet.getByText('초기화 완료 알림').click();
  await expect(sheet.getByRole('button', { name: '받을 알림을 골라 주세요' })).toBeDisabled();
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
