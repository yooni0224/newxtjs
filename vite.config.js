// 개발 서버 설정: npm run dev 하면 브라우저가 자동으로 열림
import { defineConfig } from 'vite';
import { blendConverter } from './server/blendConvert.js';

export default defineConfig({
  // BLEND(Blender) 파일 → 이 컴퓨터의 Blender 로 GLB 변환 (server/blendConvert.js)
  plugins: [blendConverter()],
  server: { open: true },
  build: { chunkSizeWarningLimit: 2000 },
  // SKP 읽기(openskp)는 작업자(Web Worker)에서만 써서 개발 서버가 처음엔 모름 →
  // 처음 SKP 를 열 때 '새 라이브러리 발견, 새로고침' 으로 불러온 게 날아가지 않게 미리 준비
  optimizeDeps: { include: ['openskp'] },
});
