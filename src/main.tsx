import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './app/App';
import { AuthProvider } from './features/auth/AuthContext';
import { handleOAuthCallback } from './features/auth/supabase';
import { sqlClient } from './sql/worker/sqlClient';

async function boot() {
  // GitHub Pages 루트 callback: Router 렌더 전에 ?code=를 처리하고 query를 지운다.
  // (이때는 학습 세션·집중모드가 시작되지 않는다)
  await handleOAuthCallback();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AuthProvider>
        <App />
      </AuthProvider>
    </StrictMode>,
  );
  // SQL 엔진(WASM)을 미리 불러 둔다
  void sqlClient().warmup();
}

void boot();
