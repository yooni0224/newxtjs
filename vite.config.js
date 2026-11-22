// 개발 서버 설정: npm run dev 하면 브라우저가 자동으로 열림
import { defineConfig } from 'vite';

export default defineConfig({
  server: { open: true },
  build: { chunkSizeWarningLimit: 2000 },
});
