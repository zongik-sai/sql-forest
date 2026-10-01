export function classifyKey(key: string | undefined): { kind: string; safe: boolean };
export function checkSupabase(opts: { url: string; key: string; fetch?: typeof fetch }): Promise<{ ok: boolean; checks: { name: string; status: 'pass' | 'fail' | 'warn'; detail: string }[] }>;
