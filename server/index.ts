import { createApp } from './app.ts';
import { openStore } from './store.ts';
import { tossOrUnavailable } from './toss.ts';
import { seedDemo } from './demo.ts';

const store = openStore();
if (process.env.TIBO_SEED_DEMO === 'true' && process.env.NODE_ENV !== 'production') seedDemo(store);

const app = createApp({
  store,
  toss: tossOrUnavailable(),
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean),
  username: process.env.X_USERNAME || 'thsottiaux',
  staticDir: 'dist',
});
const port = Number(process.env.PORT || 3002);
app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`리셋알림 API: http://localhost:${port}`));
