// 빌드 결과 경로 검증: 모든 에셋·Worker·WASM URL이 BASE_PATH를 반영하는지 확인한다.
// 사용: BASE_PATH=/sql-forest/ node scripts/verify-dist.mjs dist
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist';
const base = (process.env.BASE_PATH ?? '/').replace(/\/?$/, '/');
const fail = (m) => { console.error('✗ ' + m); process.exitCode = 1; };
const ok = (m) => console.log('✓ ' + m);

const html = readFileSync(join(dir, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('http') && !u.startsWith('data:'));
for (const r of refs) {
  if (!r.startsWith(base)) fail(`index.html 참조가 base(${base})로 시작하지 않음: ${r}`);
  else if (!existsSync(join(dir, r.slice(base.length)))) fail(`참조 파일 없음: ${r}`);
}
ok(`index.html 로컬 참조 ${refs.length}개가 ${base} 아래에 존재`);

const assets = readdirSync(join(dir, 'assets'));
const wasm = assets.filter((f) => f.endsWith('.wasm'));
const worker = assets.filter((f) => /sqlWorker.*\.js$/.test(f));
if (wasm.length !== 1) fail(`WASM 파일 수 ${wasm.length}`); else ok(`WASM: assets/${wasm[0]}`);
if (worker.length !== 1) fail(`Worker 파일 수 ${worker.length}`); else ok(`Worker: assets/${worker[0]}`);
if (worker[0] && wasm[0]) {
  const w = readFileSync(join(dir, 'assets', worker[0]), 'utf8');
  if (!w.includes(wasm[0])) fail('Worker가 WASM 파일을 참조하지 않음');
  else ok('Worker가 해시된 WASM 파일을 참조');
}
const mainJs = assets.filter((f) => f.endsWith('.js') && !worker.includes(f));
const workerRef = mainJs.some((f) => readFileSync(join(dir, 'assets', f), 'utf8').includes(worker[0] ?? '__none__'));
if (!workerRef) fail('메인 번들이 Worker 파일을 참조하지 않음'); else ok('메인 번들이 Worker를 참조');
// 비밀 키가 번들에 들어가지 않았는지: service_role JWT의 role 클레임(base64) 또는 sb_secret_ 키 형태
const all = mainJs.map((f) => readFileSync(join(dir, 'assets', f), 'utf8')).join('\n');
if (/InJvbGUiOiJzZXJ2aWNlX3JvbGUi|sb_secret_[A-Za-z0-9_-]{10,}/.test(all)) fail('번들에 service_role/secret 키 흔적'); else ok('번들에 service_role/secret 키 흔적 없음');
if (process.exitCode) console.error('빌드 경로 검증 실패'); else console.log('빌드 경로 검증 통과');
