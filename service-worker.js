// できるだけシンプルなSW（静的ファイルのみキャッシュ）
// /api/appraise はキャッシュしない

const CACHE_NAME = "kogu-app-v2";
const ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE_NAME ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // APIは常にネットワーク
  if (url.pathname.startsWith("/api/")) return;

  // GETのみキャッシュ
  if (req.method !== "GET") return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;

    const fresh = await fetch(req);
    // 同一オリジンのみ保存
    if (fresh.ok && url.origin === self.location.origin) {
      cache.put(req, fresh.clone());
    }
    return fresh;
  })());
});
