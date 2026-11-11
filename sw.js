/* Seize — fonctionnement hors ligne. Changer VERSION à chaque mise à jour du dictionnaire. */
var VERSION = 'seize-v2';
var SHELL = ['./', 'index.html', 'css/app.css', 'js/phon.js', 'js/dict.js', 'js/rhyme.js', 'js/store.js', 'js/export.js', 'js/app.js',
  'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'fonts/bricolage-latin.woff2'];
var HEAVY = ['data/dict.txt', 'vendor/jspdf.umd.min.js'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return c.addAll(SHELL).then(function () { return c.addAll(HEAVY); });
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  var heavy = HEAVY.some(function (h) { return req.url.indexOf(h) >= 0; }) || req.url.indexOf('/fonts/') >= 0;
  e.respondWith(caches.open(VERSION).then(function (cache) {
    return cache.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (res) { if (res && res.ok) cache.put(req, res.clone()); return res; });
      if (hit) { if (!heavy) net.catch(function () { }); return hit; }       // réponse immédiate, mise à jour en arrière-plan
      return net.catch(function () { return req.mode === 'navigate' ? cache.match('index.html') : Response.error(); });
    });
  }));
});
