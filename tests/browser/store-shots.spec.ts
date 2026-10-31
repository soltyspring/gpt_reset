import { test, expect, type Page, type Browser } from '@playwright/test';
import { copyFile, mkdir } from 'node:fs/promises';
import { basename } from 'node:path';

/**
 * 앱인토스 콘솔 업로드용 홍보 스크린샷.
 * - 세로형 636×1048 PNG 3장: 설명 문구 + 휴대폰 틀 안의 실제 앱 화면
 * - 가로형 1504×741 PNG 1장: 앱 이름과 화면 3개
 * `npm run shots`, 그리고 `npm run build` 때마다 docs/store/ 에 덮어써요.
 */
const out = (name: string) => `docs/store/${name}.png`;

const SHOTS = [
  { file: 'screenshot-1', title: '귀찮게 확인하지<br>않아도 돼요', sub: 'GPT 사용량이 초기화되면 바로 알려드려요', align: 'top' },
  { file: 'screenshot-2', title: '초기화 소식만<br>모아 봐요', sub: '지난 초기화 날짜와 평균 간격까지 한눈에', align: 'top' },
  // 알림 설정 창은 화면 아래에 떠서, 아래쪽을 보여 주고 휴대폰 아랫부분까지 그려요
  { file: 'screenshot-3', title: '버튼 한 번이면<br>끝이에요', sub: '초기화 소식과 예고를 토스 알림으로 받아요', align: 'bottom' },
] as const;

const FONT = `'Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif`;

/** 실제 앱 화면 3장(375×812, 2배)을 찍어요. */
async function captureScreens(page: Page) {
  await page.addInitScript(() => { if (!sessionStorage.getItem('cleared')) { localStorage.clear(); sessionStorage.setItem('cleared', '1'); } });
  await page.goto('/');
  await expect(page.locator('.event-row').first()).toBeVisible();
  const opts = { animations: 'disabled' as const, type: 'png' as const };
  const home = await page.screenshot(opts);
  await page.getByRole('heading', { name: '최근 초기화 소식' }).evaluate(el => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 16));
  const list = await page.screenshot(opts);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: '초기화되면 가장 빠르게 알려드릴까요?' }).click();
  const sheet = page.getByRole('dialog', { name: '알림 설정' });
  await expect(sheet).toBeVisible();
  const setup = await page.screenshot(opts);
  return [home, list, setup].map(b => `data:image/png;base64,${b.toString('base64')}`);
}

const phone = (src: string, width: number, cssExtra = '', screenHeight?: number, align: 'top' | 'bottom' = 'top') => `
  <div class="phone" style="width:${width}px;${cssExtra}">
    <div class="screen" style="${screenHeight ? `height:${screenHeight}px;` : ''}"><img src="${src}" style="${screenHeight ? `height:100%;object-fit:cover;object-position:center ${align};` : ''}"></div>
  </div>`;

const baseCss = `
  * { box-sizing: border-box; margin: 0; }
  body { font-family: ${FONT}; -webkit-font-smoothing: antialiased; letter-spacing: -.03em; }
  .canvas { position: relative; overflow: hidden; background: linear-gradient(180deg, #eaf3ff 0%, #f6f9ff 70%, #ffffff 100%); }
  .brand { display: inline-flex; align-items: center; gap: 10px; font-weight: 700; color: #1b64da; }
  .brand img { border-radius: 8px; }
  h1 { color: #191f28; font-weight: 800; line-height: 1.28; letter-spacing: -.045em; }
  p { color: #4e5968; font-weight: 500; line-height: 1.45; }
  .phone { position: absolute; padding: 10px; background: #191f28; border-radius: 52px;
    box-shadow: 0 30px 60px rgba(27, 100, 218, .22), 0 6px 18px rgba(0, 0, 0, .12); }
  .screen { border-radius: 42px; overflow: hidden; background: #f2f4f6; }
  .screen img { display: block; width: 100%; }
`;

async function render(browser: Browser, width: number, height: number, html: string, path: string) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.setContent(`<html><head><style>${baseCss}</style></head><body>${html}</body></html>`);
  await p.evaluate(() => Promise.all([...document.images].map(i => i.decode())));
  // 사진 뷰어 등이 파일을 열고 있으면 바로 덮어쓰지 못해요. 임시 파일에 그린 뒤 풀릴 때까지 다시 복사해요.
  await mkdir('test-results/store', { recursive: true });
  const tmp = `test-results/store/${basename(path)}`;
  await p.screenshot({ path: tmp, type: 'png' });
  await ctx.close();
  for (let i = 0; ; i++) {
    try { await copyFile(tmp, path); return; }
    catch (e) {
      if (i >= 14) throw new Error(`${path} 파일이 다른 프로그램에 열려 있어 저장하지 못했어요. 닫고 다시 실행해 주세요.`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

test('콘솔 홍보 스크린샷 (세로 3장 + 가로 1장)', async ({ page, browser, baseURL }) => {
  const screens = await captureScreens(page);
  const logo = `${baseURL}/logo.png`;

  // 세로형 636×1048: 위에 설명, 아래에 화면이 잘려 들어가는 앱스토어 형식
  for (const [i, s] of SHOTS.entries()) {
    await render(browser, 636, 1048, `
      <div class="canvas" style="width:636px;height:1048px;padding:64px 56px 0;">
        <div class="brand" style="font-size:22px;"><img src="${logo}" width="34" height="34">GPT 초기화 레이더</div>
        <h1 style="font-size:50px;margin-top:22px;">${s.title}</h1>
        <p style="font-size:24px;margin-top:16px;">${s.sub}</p>
        ${s.align === 'bottom' ? phone(screens[i], 420, 'left:108px;top:340px;', 640, 'bottom') : phone(screens[i], 420, 'left:108px;top:340px;')}
      </div>`, out(s.file));
  }

  // 가로형 1504×741: 왼쪽에 앱 이름과 한 줄 설명, 오른쪽에 화면 3개
  await render(browser, 1504, 741, `
    <div class="canvas" style="width:1504px;height:741px;padding:0 0 0 88px;background:linear-gradient(120deg,#eaf3ff 0%,#f6f9ff 60%,#ffffff 100%);">
      <div style="position:absolute;left:88px;top:50%;transform:translateY(-50%);width:520px;">
        <div class="brand" style="font-size:24px;"><img src="${logo}" width="40" height="40">GPT 초기화 레이더</div>
        <h1 style="font-size:56px;margin-top:24px;">GPT 사용량 초기화,<br>이제 기다리지 마세요</h1>
        <p style="font-size:26px;margin-top:20px;">초기화되면 토스 알림으로 바로 알려드려요</p>
      </div>
      ${phone(screens[0], 250, 'left:650px;top:110px;', 500)}
      ${phone(screens[1], 250, 'left:928px;top:80px;', 500)}
      ${phone(screens[2], 250, 'left:1206px;top:110px;', 500, 'bottom')}
    </div>`, out('screenshot-wide'));
});
