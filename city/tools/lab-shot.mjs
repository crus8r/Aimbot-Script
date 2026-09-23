// node tools/lab-shot.mjs "<query>" out.png [WxH] [--info]
import { withPage, waitReady } from './harness.mjs';
const q = process.argv[2] || '';
const out = process.argv[3] || 'lab.png';
const [width, height] = (process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : '1600x1000').split('x').map(Number);
await withPage(`lab.html${q}`, async (page, logs) => {
  try { await waitReady(page, 240000); } finally { const e = logs.filter((l) => /error/i.test(l)); if (e.length) console.log(e.join('\n')); }
  if (process.argv.includes('--info')) console.log(JSON.stringify(await page.evaluate(() => window.__info)));
  await page.screenshot({ path: out });
}, { entries: ['lab'], width, height });
