#!/usr/bin/env node
/* server.js — static host + Anthropic proxy. No dependencies.
 *
 *   ANTHROPIC_API_KEY=sk-... node server.js
 *   → http://localhost:4173
 *
 * The key stays in this process. The browser only ever talks to /api/anthropic,
 * so nothing sensitive reaches the client. Without a key the site still runs —
 * manual mode and the offline fallbacks cover everything.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
// Override to route through a gateway, or to point at a mock in tests.
const ANTHROPIC_URL = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages';
const API_VERSION = '2023-06-01';
const MAX_BODY = 1024 * 512;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';

  // Resolve, then confirm the result is still inside PUBLIC_DIR.
  const target = path.resolve(PUBLIC_DIR, '.' + rel);
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache'
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {

  if (req.url === '/api/status') {
    json(res, 200, { ok: true, hasKey: Boolean(API_KEY), model: 'claude-opus-5' });
    return;
  }

  if (req.url === '/api/anthropic') {
    if (req.method !== 'POST') { json(res, 405, { error: 'POST only' }); return; }
    if (!API_KEY) { json(res, 503, { error: 'ANTHROPIC_API_KEY is not set on the server' }); return; }

    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (e) {
      json(res, 400, { error: 'bad request: ' + e.message });
      return;
    }

    // Pin the model server-side; the browser cannot ask for a different one.
    payload.model = 'claude-opus-5';

    try {
      const upstream = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': API_VERSION
        },
        body: JSON.stringify(payload)
      });

      const text = await upstream.text();
      res.writeHead(upstream.status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(text);
    } catch (e) {
      json(res, 502, { error: 'upstream failure: ' + e.message });
    }
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log('  X-Gene Sequencing');
  console.log('  http://' + HOST + ':' + PORT);
  console.log('  model access: ' + (API_KEY ? 'enabled (server-side key)' : 'DISABLED — set ANTHROPIC_API_KEY for AI-assist'));
});
