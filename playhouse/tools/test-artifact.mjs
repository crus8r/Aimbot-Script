/** Verify the content-only build inside a host-supplied document skeleton. */
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const content = fs.readFileSync(path.join(root, 'dist/artifact.html'), 'utf8');
// Mimic how a host wraps the page: its own doctype, head and body, plus a reset.
fs.writeFileSync(path.join(root, 'dist/_wrapped.html'),
  `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>*,*::before,*::after{box-sizing:border-box}body{margin:0;font-family:system-ui}</style>
</head><body>${content}</body></html>`);
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
const p = await b.newPage({ viewport:{width:390,height:844}, deviceScaleFactor:2 });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
await p.goto(`file://${path.join(root,'dist/_wrapped.html')}`,{waitUntil:'load'});
await p.waitForFunction(()=>document.getElementById('boot')?.classList.contains('gone'),{timeout:30000})
  .catch(async()=>errs.push('boot: '+await p.locator('#bootMsg').innerText().catch(()=>'?')));
await p.waitForTimeout(2500);
const info = await p.evaluate(()=>({
  ok: !!window.playhouse,
  title: window.playhouse?.production?.script?.meta?.title,
  bodyScrollX: document.body.scrollWidth > window.innerWidth,
  canvasH: document.getElementById('view')?.clientHeight,
}));
console.log('  ', JSON.stringify(info));
await p.screenshot({ path: path.join(root,'shots/artifact-mobile.png') });
await b.close();
const real = errs.filter(e=>!/SwiftShader|deprecated|GroupMarker/i.test(e));
if(real.length){console.error('  ✗',real.slice(0,4).join('\n   '));process.exit(1);}
console.log('  ✓ artifact build clean');
