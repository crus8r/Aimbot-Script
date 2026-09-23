// Headless-browser harness. Every visual claim about this project is checked
// by rendering it here and looking at the pixels, not by reading the code.
import { chromium } from 'playwright-core';
import { build } from './build.mjs';
import { serve } from './serve.mjs';

const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export async function withPage(query, fn, { width = 1280, height = 720, rebuild = true, entries } = {}) {
  if (rebuild) await build({ minify: false, entries });
  const server = await serve(0);
  const port = server.address().port;
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width, height } });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
  try {
    await page.goto(`http://127.0.0.1:${port}/${query}`);
    return await fn(page, logs);
  } finally {
    await browser.close();
    server.close();
  }
}

export async function waitReady(page, timeout = 120000) {
  await page.waitForFunction(() => window.__ready === true || window.__error, null, { timeout, polling: 250 });
  const err = await page.evaluate(() => window.__error);
  if (err) throw new Error(`page failed: ${err}`);
}
