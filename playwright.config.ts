import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  use: { baseURL: 'http://localhost:5174', channel: 'msedge', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
    env: { TOSS_MOCK: 'true', TIBO_DB_PATH: '.data/e2e.sqlite', TIBO_SEED_DEMO: 'true' },
  },
  projects: [
    { name: 'mobile', use: { viewport: { width: 375, height: 812 } } },
    { name: 'tablet', use: { viewport: { width: 768, height: 1024 } }, testMatch: /flows/, grep: /홈|알림 고르기/ },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } }, testMatch: /flows/, grep: /홈/ },
  ],
});
