import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:3002' } },
  preview: { host: '0.0.0.0', port: 4174 },
  build: {
    rollupOptions: {
      output: { manualChunks: { 'toss-sdk': ['@apps-in-toss/web-framework'] } },
    },
  },
});
