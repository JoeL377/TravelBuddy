// Caches the app shell so TravelBuddy opens instantly and installs like an app.
// API calls always go to the network (tours and Q&As must be fresh).
const CACHE = "travelbuddy-v6-food";
const SHELL = ["/", "/index.html", "/styles.css", "/app.js", "/art.js", "/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png", "/fonts/PlusJakartaSans-normal.woff2", "/fonts/InstrumentSerif-normal.woff2", "/fonts/InstrumentSerif-italic.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // Network first so updates show up, cache as offline fallback.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/index.html")))
  );
});
