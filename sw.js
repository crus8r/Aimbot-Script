/* VANGUARD — service worker
 *
 * Makes the whole game playable with no connection once it has been opened
 * once, which is the point of installing it to a home screen.
 *
 * Strategy is stale-while-revalidate: a cached response goes back
 * immediately, and a fresh copy is fetched in the background for next time.
 * That keeps the game instant offline without pinning it to a stale build
 * forever. Bump CACHE when you ship — the activate step drops every other
 * cache, so the next load picks the new files up.
 *
 * Every path here is relative to the service worker's own scope, so this
 * works unchanged at a domain root or under a GitHub Pages project path.
 */

var CACHE = 'vanguard-v1';

/* The shell: everything needed to boot the menu and play both modes. */
var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './site/icon.svg',
  './site/icon-180.png',
  './site/icon-192.png',
  './site/icon-512.png',
  './site/img/p-savior.webp',
  './site/img/p-exodus.webp',
  './site/img/p-paragon.webp',
  './site/img/p-dominus.webp',
  './site/img/p-vitality.webp',
  './site/img/p-deathbringer.webp',
  './superhero-sim/',
  './superhero-sim/index.html',
  './superhero-sim/css/style.css',
  './superhero-sim/vendor/three.min.js',
  './superhero-sim/src/util.js',
  './superhero-sim/src/audio.js',
  './superhero-sim/src/input.js',
  './superhero-sim/src/entities.js',
  './superhero-sim/src/world.js',
  './superhero-sim/src/heroes.js',
  './superhero-sim/src/enemies.js',
  './superhero-sim/src/render.js',
  './superhero-sim/src/gfx3d.js',
  './superhero-sim/src/models3d.js',
  './superhero-sim/src/specs3d.js',
  './superhero-sim/src/fighters3d.js',
  './superhero-sim/src/sideview.js',
  './superhero-sim/src/versus.js',
  './superhero-sim/src/hud.js',
  './superhero-sim/src/game.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      /* One missing file must not fail the whole install — anything that
         slips through gets picked up by the runtime cache on first use. */
      return Promise.all(SHELL.map(function (url) {
        return c.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(req).then(function (hit) {
        var live = fetch(req).then(function (res) {
          if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
          return res;
        }).catch(function () {
          /* Offline and uncached: a navigation should still land somewhere. */
          return hit || (req.mode === 'navigate' ? cache.match('./index.html') : undefined);
        });
        return hit || live;
      });
    })
  );
});

/* Lets a page trigger an immediate update instead of waiting for a reload. */
self.addEventListener('message', function (e) {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
