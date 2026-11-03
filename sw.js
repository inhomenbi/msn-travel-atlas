// Offline support for trip pages. Pages: network first (a deleted trip disappears once online), cache as fallback.
// Map tiles, photos and fonts: cache first, kept in "trip-runtime" (capped).
const RUNTIME = "trip-runtime", MAX = 1500;
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
// A notification brings the map page back to the front (or opens it), and tells the server the alert was seen,
// so it stops ringing again.
self.addEventListener("notificationclick", e => { e.notification.close(); const d = e.notification.data || {};
  e.waitUntil(Promise.all([
    d.url && d.id ? fetch(d.url + "/ack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dev: d.dev, id: d.id }) }).catch(() => {}) : null,
    self.clients.matchAll({ type: "window" }).then(cs => cs.length ? cs[0].focus() : d.page && self.clients.openWindow(d.page))])); });
// Push from the agency's server (sent without content): fetch the new messages of each map on this phone and show them.
// A push with nothing new is a repeat: the alert not acknowledged yet rings again. The map pages keep, in "push-cfg",
// the server address, this phone's device id and the last message seen, per map.
const CFG = self.location.origin + "/__push-cfg", WHO = { lead: "قائد الرحلة", agency: "الوكالة", auto: "تذكير" };
const LONG = [500, 250, 500, 250, 500, 250, 500];
const titleOf = (m, d) => ({ msg: "📣 " + (WHO[m.who] || "الوكالة"), point: "📍 نقطة التقاء" })[m.kind] || "🚌 الباص";
self.addEventListener("push", e => e.waitUntil((async () => {
  let shown = 0;
  try {
    const c = await caches.open("push-cfg"), r = await c.match(CFG), cfg = r ? await r.json() : { devs: [] };
    for (const d of cfg.devs) {
      const j = await (await fetch(`${d.url}/inbox?dev=${encodeURIComponent(d.dev)}&since=${d.since || 0}`)).json();
      const show = (m, again) => self.registration.showNotification(titleOf(m) + (d.title ? " · " + d.title : ""), { body: (again ? "🔔 تذكير: " : "") + m.text,
        tag: "m-" + d.id + "-" + m.id, renotify: true, data: { page: d.page, url: d.url, dev: d.dev, id: m.id }, vibrate: LONG, requireInteraction: m.kind !== "msg" });
      const fresh = (j.msgs || []).slice(-3);
      for (const m of fresh) { await show(m); shown++; }
      if (!fresh.length && j.due) { await show(j.due, true); shown++; }
      if (j.msgs && j.msgs.length) d.since = j.msgs[j.msgs.length - 1].id;
    }
    await c.put(CFG, new Response(JSON.stringify(cfg), { headers: { "content-type": "application/json" } }));
  } catch {}
  if (!shown) await self.registration.showNotification("MSN Travel", { body: "وصلك تنبيه جديد. افتح خريطتك.", vibrate: LONG });
})()));
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
