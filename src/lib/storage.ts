/**
 * localStorage 안전 래퍼. 사생활 보호 모드·차단된 저장소에서도 앱이 멈추지 않게 모든 접근을 try/catch.
 * 키 네임스페이스: sqlforest:v1:<learnerKey>:<name>
 */

const memory = new Map<string, string>();

function ls(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function readRaw(key: string): string | null {
  try {
    const s = ls();
    if (s) return s.getItem(key);
  } catch {
    /* 저장소 차단 */
  }
  return memory.get(key) ?? null;
}

export function writeRaw(key: string, value: string): boolean {
  memory.set(key, value);
  try {
    ls()?.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeRaw(key: string): void {
  memory.delete(key);
  try {
    ls()?.removeItem(key);
  } catch {
    /* 무시 */
  }
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = readRaw(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  return writeRaw(key, JSON.stringify(value));
}

export function keysWithPrefix(prefix: string): string[] {
  const out = new Set<string>();
  try {
    const s = ls();
    if (s) for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(prefix)) out.add(k);
    }
  } catch {
    /* 무시 */
  }
  for (const k of memory.keys()) if (k.startsWith(prefix)) out.add(k);
  return [...out];
}

export function removeWithPrefix(prefix: string): void {
  for (const k of keysWithPrefix(prefix)) removeRaw(k);
}

export const STORAGE_PREFIX = 'sqlforest:v1:';
/** 과목 기록이 이 기기에만 있고 아직 서버에 저장되지 않았다는 표시(`<learner prefix><과목>:unsynced`) */
export const UNSYNCED_SUFFIX = ':unsynced';
export const hasUnsynced = (prefix: string) => keysWithPrefix(prefix).some((k) => k.endsWith(UNSYNCED_SUFFIX));
export const learnerPrefix = (learnerKey: string) => `${STORAGE_PREFIX}${learnerKey}:`;

export function sessionGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
export function sessionSet(key: string, v: string): void {
  try {
    sessionStorage.setItem(key, v);
  } catch {
    /* 무시 */
  }
}
export function sessionRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* 무시 */
  }
}
