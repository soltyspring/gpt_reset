// public/logo.svg → docs/brand/logo-600.png (앱인토스 콘솔 등록용 600×600)
import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';

const svg = await readFile('public/logo.svg', 'utf8');
await mkdir('docs/brand', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', '<svg width="600" height="600" ')}</body></html>`);
await page.screenshot({ path: 'docs/brand/logo-600.png', omitBackground: true });
await browser.close();
console.log('docs/brand/logo-600.png');
