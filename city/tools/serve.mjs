// Minimal static server for dist/. Needed because module scripts and fetch()
// of .glb files refuse file:// URLs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.css': 'text/css',
};

export function serve(port = 0) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      let file = path.join(root, url === '/' ? 'index.html' : url);
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
      // Pages are written as the artifact host expects (no skeleton); wrap
      // them the way it does, so local runs render in standards mode too.
      if (file.endsWith('.html')) {
        const html = fs.readFileSync(file, 'utf8');
        if (/^\s*<!doctype/i.test(html)) { res.end(html); return; }
        res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${html}</body></html>`);
        return;
      }
      fs.createReadStream(file).pipe(res);
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || 8080);
  await serve(port);
  console.log(`serving dist/ on http://127.0.0.1:${port}`);
}
