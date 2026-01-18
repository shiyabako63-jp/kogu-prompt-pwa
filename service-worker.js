/* service-worker.js
 * - Cloudflare Pages の静的配信向け
 * - 基本ファイルをキャッシュしてオフライン動作
 * - 重要：このSWは「アプリ自体」をオフラインにするだけ。画像解析や外部APIは行わない。
 */

const CACHE_NAME = "kogu-prompt-pwa-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json"
];

// アイコンを置く場合はキャッシュに含める（存在しなくてもSWは動くが、404が増える）
const OPTIONAL_ASSETS = [
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);

    // optional assets: 失敗してもインストール継続
    for (const url of OPTIONAL_ASSETS) {
      try { await cache.add(url); } catch (_) {}
    }
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map((k) => (k === CACHE_NAME ? Promise.resolve() : caches.delete(k)))
    );
    self.clients.claim();
  })());
});

// 取得戦略：
// - ナビゲーション（HTML）は network-first（更新優先、失敗時キャッシュ）
// - それ以外は cache-first（高速/オフライン優先）
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 同一オリジンのみ
  if (url.origin !== self.location.origin) return;

  // HTMLナビゲーション
  const isNav = req.mode === "navigate" || (req.destination === "document");

  if (isNav) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put("./index.html", fresh.clone());
        return fresh;
      } catch (_) {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match("./index.html");
        return cached || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    })());
    return;
  }

  // それ以外
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;

    try {
      const fresh = await fetch(req);
      // css/js/json/png などはキャッシュ
      if (fresh && fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    } catch (_) {
      return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  })());
});
