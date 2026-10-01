/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 배포 경로(base)를 결정하는 유일한 곳.
 * - BASE_PATH 환경변수가 있으면 그대로 사용 (예: /sql-forest/). GitHub Actions에서는
 *   actions/configure-pages 의 base_path 출력을 BASE_PATH로 넘긴다.
 * - 없으면 '/' (로컬 개발, 사용자 사이트, 커스텀 도메인)
 */
function resolveBase(raw: string | undefined): string {
  if (!raw || raw === '/') return '/';
  if (raw === './') return './'; // 상대 경로(미리보기 등 하위 경로를 미리 알 수 없을 때)
  let b = raw.trim();
  if (!b.startsWith('/')) b = '/' + b;
  if (!b.endsWith('/')) b = b + '/';
  return b;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  if (mode === 'production' && env.VITE_ENABLE_DEMO === 'true') {
    throw new Error('운영(production) 빌드에서는 VITE_ENABLE_DEMO=true를 사용할 수 없습니다. 개발 데모는 npm run dev 또는 npm run build:demo로만 사용하세요.');
  }
  return {
    base: resolveBase(env.BASE_PATH),
    plugins: [react()],
    worker: { format: 'es' },
    build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 900 },
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
    test: {
      include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/db/**/*.test.ts'],
      environment: 'node',
      testTimeout: 30000,
    },
  };
});
