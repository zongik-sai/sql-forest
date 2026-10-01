// 비공개 미리보기용 페이지 만들기: dist-artifact/index.html → dist-artifact/artifact.html
// - 문서 골격(doctype/html/head/body)은 게시 시 감싸지므로 빼고, CSS는 인라인으로 넣는다.
// - JS·Worker·WASM은 assets/ 아래 별도 파일로 함께 게시한다(상대 경로).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist-artifact';
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? 'SQL 숲 키우기';
const fontLinks = [...html.matchAll(/<link[^>]+fonts\.(?:googleapis|gstatic)\.com[^>]*>/g)].map((m) => m[0]).join('\n');
const css = readdirSync(join(dir, 'assets')).filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(dir, 'assets', f), 'utf8')).join('\n');
const entry = html.match(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/)?.[1];
if (!entry) throw new Error('entry script not found');
const page = `<title>${title}</title>
<meta name="description" content="SQLD 입문 12단원 학습 앱 미리보기(개발 데모)">
${fontLinks}
<style>
${css}
</style>
<noscript>이 학습 앱은 JavaScript가 필요해요.</noscript>
<div id="root"></div>
<script type="module" src="${entry.replace(/^\.\//, '')}"></script>
`;
writeFileSync(join(dir, 'artifact.html'), page);
const assets = readdirSync(join(dir, 'assets')).filter((f) => !f.endsWith('.css'));
writeFileSync(join(dir, 'files.json'), JSON.stringify(Object.fromEntries(assets.map((f) => [`assets/${f}`, join(dir, 'assets', f)])), null, 2));
console.log(`artifact.html ${page.length}B, assets: ${assets.join(', ')}`);
