// Offline support for trip pages. Pages: network first (a deleted trip disappears once online), cache as fallback.
// Map tiles, photos and fonts: cache first, kept in "trip-runtime" (capped).
const RUNTIME = "trip-runtime", MAX = 1500;
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
// A bus alert notification brings the map page back to the front.
self.addEventListener("notificationclick", e => { e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then(cs => cs.length && cs[0].focus())); });
const isAsset = u => /tile\.openstreetmap\.org|wikimedia\.org|fonts\.(googleapis|gstatic)\.com/.test(u.hostname);
async function trim() {
  const c = await caches.open(RUNTIME), keys = await c.keys();
  for (let i = 0; i < keys.length - MAX; i++) await c.delete(keys[i]);
}
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (isAsset(url)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone(); caches.open(RUNTIME).then(c => c.put(req, copy)).then(trim); return res;
    })));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(fetch(req).then(async res => {
    // A trip removed from the server: drop its saved copy too.
    if (res.status === 404 && /\/t\/[^/]+\//.test(url.pathname)) {
      const id = url.pathname.match(/\/t\/([^/]+)\//)[1]; await caches.delete("trip-" + id);
    }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: false }).then(hit => hit || caches.match(req.url.split("#")[0]))));
});
