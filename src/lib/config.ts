/** 공개 환경변수만 읽는다. service_role/secret 키는 절대 사용하지 않는다. */
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
export const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() || '';
export const isSupabaseConfigured = !!SUPABASE_URL && !!SUPABASE_KEY;
/** 개발 데모: 개발 서버(npm run dev)와 데모 빌드(npm run build:demo)에서만. 운영 빌드는 vite.config가 거부한다. */
export const isDemoEnabled = import.meta.env.VITE_ENABLE_DEMO === 'true' && import.meta.env.MODE !== 'production';
export const BASE_URL = import.meta.env.BASE_URL;
