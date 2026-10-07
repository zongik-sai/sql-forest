import { chromium } from '@playwright/test';
const [,, url, out, w='1280', h='900', dark=''] = process.argv;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: +w, height: +h }, colorScheme: dark ? 'dark' : 'light', locale: 'ko-KR' });
await p.goto(url); await p.waitForTimeout(1200);
await p.screenshot({ path: out, fullPage: true });
await b.close();
