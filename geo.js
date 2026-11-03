// Shared "my location" support for the atlas and trip pages (needs Leaflet).
// Geo.locate(map, onFix) shows a blue dot and follows the device; Geo.times(from, stops) gives road distance and
// driving time from the free OSRM router, falling back to an estimate from straight-line distance when offline.
// Geo.kml(title, places) builds a bookmarks file for offline map apps (maps.me, Organic Maps).
const Geo = (() => {
  const km = (a, b) => { const r = Math.PI / 180, x = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
  let dot, ring, watch, last, box, boxT;
  // Status line floating over the page, so it is visible on phones whatever is on screen.
  function say(msg, ms) {
    if (!box) { box = document.createElement("div"); box.className = "geo-toast"; box.setAttribute("role", "status"); document.body.appendChild(box); }
    clearTimeout(boxT); box.textContent = msg || ""; box.hidden = !msg;
    if (msg && ms) boxT = setTimeout(() => { box.hidden = true; }, ms);
  }
  const ua = navigator.userAgent, ios = /iPhone|iPad|iPod/.test(ua), inApp = /FBAN|FBAV|Instagram|Line\/|Snapchat|TikTok|; wv\)/i.test(ua);
  const denied = () => (ios
    ? "إذن الموقع مقفول. في الآيفون: الإعدادات ← الخصوصية والأمان ← خدمات الموقع (تشغيل) ← مواقع Safari ← «أثناء الاستخدام»، ثم أعد تحميل الصفحة واضغط موقعي."
    : "إذن الموقع مقفول. اضغط رمز القفل بجانب الرابط ← الأذونات ← الموقع ← سماح، وتأكد أن الموقع (GPS) مفعّل في الجوال، ثم أعد تحميل الصفحة.")
    + (inApp ? " وإذا فتحت الرابط من داخل تطبيق (انستقرام أو غيره) افتحه في Safari أو Chrome." : "");
  function stop() { if (watch != null) navigator.geolocation.clearWatch(watch); watch = null; }
  function locate(map, onFix) {
    if (!navigator.geolocation || !window.isSecureContext) { say("هذا المتصفح لا يدعم تحديد الموقع. افتح الرابط في Safari أو Chrome."); return; }
    if (watch != null) { if (last) map.setView([last.lat, last.lng], Math.max(map.getZoom(), 15)); else say("جارٍ تحديد موقعك…"); return; }
    say("جارٍ تحديد موقعك…");
    let first = true;
    const fix = p => {
      const c = p.coords;
      if (last && c.accuracy > last.acc * 3 && !first) return; // a late rough fix after a GPS one
      last = { lat: c.latitude, lng: c.longitude, acc: c.accuracy };
      const ll = [last.lat, last.lng];
      if (!dot) {
        ring = L.circle(ll, { radius: last.acc, color: "#1a73e8", weight: 1, fillOpacity: .12, interactive: false }).addTo(map);
        dot = L.marker(ll, { zIndexOffset: 1000, interactive: false, icon: L.divIcon({ className: "", iconSize: [20, 20], html: '<div class="me"></div>' }) }).addTo(map);
      } else { dot.setLatLng(ll); ring.setLatLng(ll).setRadius(last.acc); }
      if (first) { first = false; say(""); map.setView(ll, Math.max(map.getZoom(), 14)); }
      onFix(last);
    };
    const fail = e => {
      if (e.code === 1) { stop(); say(denied()); }
      else if (first) say("ما زلنا نبحث عن إشارتك… تأكد أن الموقع (GPS) مفعّل في الجوال، ويفضّل مكان مفتوح.");
    };
    // A quick rough fix from wifi / mobile network first, then keep following with GPS (no timeout, so no false errors indoors).
    navigator.geolocation.getCurrentPosition(fix, fail, { enableHighAccuracy: false, maximumAge: 300000, timeout: 10000 });
    watch = navigator.geolocation.watchPosition(fix, fail, { enableHighAccuracy: true, maximumAge: 10000 });
  }
  // Rough fallback: roads are ~35% longer than a straight line; ~25 km/h in cities, ~60 km/h further out.
  const estimate = d => { const road = d * 1.35; return { km: road, min: road < 15 ? road / 25 * 60 + 3 : road / 60 * 60 + 8, exact: false }; };
  async function times(from, stops) {
    const fallback = () => stops.map(s => estimate(km(from, s)));
    if (!stops.length) return [];
    if (!navigator.onLine) return fallback();
    try {
      const coords = [from, ...stops].map(p => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
      const ctl = new AbortController(); setTimeout(() => ctl.abort(), 8000);
      const j = await fetch(`https://router.project-osrm.org/table/v1/driving/${coords}?sources=0&annotations=duration,distance`, { signal: ctl.signal }).then(r => r.json());
      if (j.code !== "Ok") throw 0;
      return stops.map((s, i) => { const d = j.distances[0][i + 1], t = j.durations[0][i + 1];
        return d == null || t == null ? estimate(km(from, s)) : { km: d / 1000, min: t / 60 * 1.3 + 2, exact: true }; }); // router times assume empty roads: add traffic and parking
    } catch { return fallback(); }
  }
  const fmtKm = k => k < 1 ? `${Math.round(k * 1000)} م` : `${k < 10 ? k.toFixed(1) : Math.round(k)} كم`;
  const fmtMin = m => m < 60 ? `${Math.max(1, Math.round(m))} د` : `${Math.floor(m / 60)} س ${Math.round(m % 60)} د`;
  // One line for a stop: road distance when the router answered (else straight line), drive time, and walking time when close.
  function line(from, s, t) {
    const d = km(from, s), walk = d * 1.25 / 4.8 * 60;
    return `<span class="eta">📍 ${fmtKm(t && t.exact ? t.km : d)}${t && t.exact ? " بالطريق" : ""}`
      + (t ? ` · 🚗 ${t.exact ? "" : "~"}${fmtMin(t.min)}${t.exact ? "" : " تقريباً"}` : "")
      + (d < 3 ? ` · 🚶 ${fmtMin(walk)}` : "") + `</span>`;
  }
  // Bookmarks file for maps.me / Organic Maps: they show the pins offline with GPS, distance and turn-by-turn routes.
  // places: [{name, desc, lat, lng, color}] where color is one of the apps' bookmark colours (red, blue, green, …).
  function kml(title, places) {
    const x = t => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${x(title)}</name>`
      + places.map(p => `<Placemark><name>${x(p.name)}</name><description>${x(p.desc)}</description><styleUrl>#placemark-${p.color || "red"}</styleUrl>`
        + `<Point><coordinates>${p.lng},${p.lat}</coordinates></Point></Placemark>`).join("") + `</Document></kml>\n`;
  }
  function download(name, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/vnd.google-earth.kml+xml" }));
    a.download = name.replace(/[\\/:*?"<>|]/g, "-") + ".kml"; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  // Guide screen, like a navigation app: map with the road route drawn from you to the place, the next turn in Arabic,
  // distance and time left, re-routing when you leave the route. Routes come from the free OSRM servers (FOSSGIS, car or
  // foot) and are kept on the phone, so a route opened once still shows offline; with no route the map shows a straight
  // line and a compass arrow. Offline map apps are offered for full offline road navigation.
  const bearing = (a, b) => { const r = Math.PI / 180, y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r),
    x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
    return (Math.atan2(y, x) / r + 360) % 360; };
  const DIRS = ["الشمال", "الشمال الشرقي", "الشرق", "الجنوب الشرقي", "الجنوب", "الجنوب الغربي", "الغرب", "الشمال الغربي"];
  const TURN = { "left": ["انعطف يساراً", "↰"], "right": ["انعطف يميناً", "↱"], "slight left": ["اتجه قليلاً لليسار", "↖"],
    "slight right": ["اتجه قليلاً لليمين", "↗"], "sharp left": ["انعطف بحدة لليسار", "↰"], "sharp right": ["انعطف بحدة لليمين", "↱"],
    "straight": ["استمر للأمام", "↑"], "uturn": ["ارجع للخلف (دوران)", "⤺"] };
  function say1(st) {
    const m = st.maneuver, to = st.name ? ` إلى ${st.name}` : "", t = TURN[m.modifier] || TURN.straight;
    if (m.type === "arrive") return ["🏁", "وصلت إلى وجهتك"];
    if (m.type === "depart") return ["↑", `انطلق${st.name ? " على " + st.name : ""} باتجاه ${DIRS[Math.round(m.bearing_after / 45) % 8]}`];
    if (m.type === "roundabout" || m.type === "rotary" || m.type === "roundabout turn") return ["⟳", `عند الدوار خذ المخرج ${m.exit || 1}${to}`];
    if (m.type === "exit roundabout" || m.type === "exit rotary") return ["↗", `اخرج من الدوار${to}`];
    if (m.type === "continue" || m.type === "new name") return [t[1], (m.modifier && m.modifier !== "straight" ? t[0] : "استمر") + (st.name ? " على " + st.name : "")];
    if (m.type === "merge" || m.type === "on ramp") return [t[1], `ادخل الطريق${to}`];
    if (m.type === "off ramp") return [t[1], `خذ المخرج${to}`];
    if (m.type === "fork") return [t[1], (m.modifier || "").includes("left") ? `التزم اليسار عند التفرع${to}` : `التزم اليمين عند التفرع${to}`];
    return [t[1], t[0] + to];
  }
  const ROUTER = { car: "https://routing.openstreetmap.de/routed-car", foot: "https://routing.openstreetmap.de/routed-foot" };
  async function route(from, to, mode) {
    const key = `route:${mode}:${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
    try {
      const ctl = new AbortController(); setTimeout(() => ctl.abort(), 10000);
      const j = await fetch(`${ROUTER[mode]}/route/v1/driving/${from.lng.toFixed(6)},${from.lat.toFixed(6)};${to.lng.toFixed(6)},${to.lat.toFixed(6)}?overview=full&geometries=geojson&steps=true`, { signal: ctl.signal }).then(r => r.json());
      if (j.code !== "Ok" || !j.routes.length) throw 0;
      const r = j.routes[0], R = { coords: r.geometry.coordinates.map(([x, y]) => ({ lat: y, lng: x })), dur: r.duration, dist: r.distance,
        steps: r.legs[0].steps.map(st => ({ ...st.maneuver.location && { at: { lat: st.maneuver.location[1], lng: st.maneuver.location[0] } }, text: say1(st) })) };
      try { localStorage.setItem(key, JSON.stringify(R)); } catch {}
      return R;
    } catch { // offline or router down: reuse the route saved for this place if it started near here
      try { const R = JSON.parse(localStorage.getItem(key)); if (R && km(from, R.coords[0]) < 1) return { ...R, saved: true }; } catch {}
      return null;
    }
  }
  function guide(s) {
    const el = document.createElement("div"); el.className = "guide"; el.setAttribute("role", "dialog");
    const x = t => String(t ?? "").replace(/</g, "&lt;"), q = encodeURIComponent(s.name), ll = `${s.lat},${s.lng}`;
    el.innerHTML = `<div class="g-top"><button class="g-close" aria-label="إغلاق">✕</button><div class="g-title"><b>${x(s.name)}</b><small>${x(s.city)}</small></div>
        <div class="g-mode"><button data-m="car" aria-pressed="true">🚗</button><button data-m="foot" aria-pressed="false">🚶</button></div></div>
      <div class="g-next"><span class="g-ico">⌖</span><div><b class="g-step">جارٍ تحديد موقعك…</b><small class="g-stepd"></small></div><div class="g-arrow" title="اتجاه المكان">➤</div></div>
      <div class="g-mapbox"><div class="g-map"></div><button class="g-center" hidden>⌖ تتبّع موقعي</button><button class="g-north" title="اتجاهك للأعلى / الشمال للأعلى"><span>▲</span>N</button></div>
      <div class="g-foot"><div class="g-sum"></div><small class="g-awake"></small><button class="btn ghost g-compass" hidden>تفعيل البوصلة</button>
        <details class="g-apps"><summary>تطبيقات الملاحة (تعمل بدون إنترنت بعد تحميل خريطة الدولة)</summary>
          <a class="btn" href="om://route?dll=${ll}&daddr=${q}&type=vehicle">Organic Maps</a>
          <a class="btn" href="mapsme://route?dll=${ll}&daddr=${q}&type=vehicle">maps.me</a>
          <a class="btn ghost" href="${ios ? `https://maps.apple.com/?daddr=${ll}&dirflg=d` : `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`}" target="_blank" rel="noopener">${ios ? "خرائط Apple" : "خرائط Google"}</a></details></div>`;
    document.body.appendChild(el);
    const $g = c => el.querySelector(c);
    const map = L.map($g(".g-map"), { zoomControl: false, attributionControl: false }).setView([s.lat, s.lng], 15);
    // Heading-up: the map is a square as big as the box's diagonal, turned around its centre so the way you face is up.
    const box = $g(".g-mapbox"), mapEl = $g(".g-map");
    const sizeMap = () => { const bw = box.clientWidth, bh = box.clientHeight, D = Math.ceil(Math.hypot(bw, bh));
      Object.assign(mapEl.style, { width: D + "px", height: D + "px", left: (bw - D) / 2 + "px", top: (bh - D) / 2 + "px" }); map.invalidateSize(); };
    sizeMap(); addEventListener("resize", sizeMap);
    // Keep the screen on while guiding (Screen Wake Lock); it is dropped when the page is hidden, so take it again on return.
    let lock = null;
    const awake = async () => { if (!("wakeLock" in navigator)) { $g(".g-awake").textContent = ios
        ? "متصفحك لا يسمح بإبقاء الشاشة مضاءة. حدّث الآيفون، أو اضبط: الإعدادات ← شاشة العرض والإضاءة ← القفل التلقائي ← أبداً، أثناء الرحلة."
        : "متصفحك لا يسمح بإبقاء الشاشة مضاءة. استخدم Chrome، أو أطل مدة إطفاء الشاشة من إعدادات الجوال أثناء الرحلة."; return; }
      try { if (document.visibilityState === "visible") { lock = await navigator.wakeLock.request("screen"); $g(".g-awake").textContent = "☀️ الشاشة تبقى مضاءة أثناء التوجيه"; } }
      catch { $g(".g-awake").textContent = "تعذر إبقاء الشاشة مضاءة (وضع توفير الطاقة؟)."; } };
    const onVis = () => { if (document.visibilityState === "visible") awake(); };
    awake(); document.addEventListener("visibilitychange", onVis);
    L.tileLayer(location.protocol === "file:" ? "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png" : "https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, subdomains: "abcd" }).addTo(map);
    L.marker([s.lat, s.lng], { icon: L.divIcon({ className: "", iconSize: [30, 30], iconAnchor: [15, 30], html: '<div class="g-dest">🏁</div>' }) }).addTo(map);
    // You: blue dot with a cone showing the way you face (GPS course while moving, else the compass).
    const youIcon = L.divIcon({ className: "", iconSize: [44, 44], html: '<div class="me-wrap"><div class="me-cone" hidden></div><div class="me"></div></div>' });
    let me = last, you = null, heading = null, w = null, mode = "car", R = null, line = null, done = null, busy = false, lastTry = 0, follow = true;
    // Follow mode like a navigation app: the map stays centred on you, zoomed in; moving the map by hand pauses it
    // and shows a button to come back.
    let course = null;
    const center = () => { if (me) map.setView([me.lat, me.lng], Math.max(map.getZoom(), mode === "car" ? 16 : 17), { animate: true }); };
    const setFollow = on => { follow = on; $g(".g-center").hidden = on; turn(); if (on) center(); };
    // Turn the map so your direction points up (while following); north-up when you move the map yourself or tap N.
    let rot = 0, up = true;
    const turn = () => { const h = course ?? heading, target = up && follow && h != null ? -h : 0;
      const d = ((target - rot) % 360 + 540) % 360 - 180; if (Math.abs(d) < 3 && target !== 0) return;
      rot += d; mapEl.style.transform = `rotate(${rot}deg)`; box.style.setProperty("--unrot", `${-rot}deg`);
      $g(".g-north").style.transform = `rotate(${rot}deg)`; };
    $g(".g-north").onclick = () => { up = !up; $g(".g-north").classList.toggle("off", !up); turn(); };
    map.on("dragstart", () => setFollow(false));
    $g(".g-center").onclick = () => setFollow(true);
    const faceTo = () => { const h = course ?? heading, c = you && you.getElement() && you.getElement().querySelector(".me-cone");
      if (c) { c.hidden = h == null; if (h != null) c.style.transform = `rotate(${h}deg)`; } turn(); };
    const routeFor = async () => {
      if (!me || busy) return; busy = true; lastTry = Date.now();
      if (km(me, s) > 300) { busy = false; paint(); return; }
      $g(".g-stepd").textContent = "جارٍ رسم الطريق…";
      R = await route(me, s, mode); busy = false;
      if (line) line.remove(); if (done) done.remove();
      const pts = R ? R.coords.map(p => [p.lat, p.lng]) : [[me.lat, me.lng], [s.lat, s.lng]];
      line = L.polyline(pts, R ? { color: "#1a73e8", weight: 7, opacity: .9 } : { color: "#1a73e8", weight: 4, dashArray: "8 10" }).addTo(map);
      done = L.polyline([], { color: "#9aa0a6", weight: 7, opacity: .8 }).addTo(map);
      if (R) { // per point: distance to the end, to find where you are on the route
        R.left = new Array(R.coords.length).fill(0);
        for (let i = R.coords.length - 2; i >= 0; i--) R.left[i] = R.left[i + 1] + km(R.coords[i], R.coords[i + 1]);
        R.stepAt = R.steps.map(st => { let bi = 0, bd = Infinity; R.coords.forEach((p, i) => { const d = km(p, st.at); if (d < bd) { bd = d; bi = i; } }); return bi; });
      }
      // Show the whole route for a moment, then zoom in on you and follow.
      map.fitBounds(L.latLngBounds(pts).pad(0.15)); follow = true; $g(".g-center").hidden = true;
      setTimeout(() => { if (follow) center(); }, 2500);
      paint();
    };
    const paint = () => {
      if (!me) return;
      const d = km(me, s), b = bearing(me, s);
      $g(".g-arrow").style.transform = `rotate(${(heading == null ? b : b - heading) - 90}deg)`; // the glyph points east
      if (d > 300) { $g(".g-ico").textContent = "🧭"; $g(".g-step").textContent = `المكان على بعد ${fmtKm(d)} باتجاه ${DIRS[Math.round(b / 45) % 8]}`;
        $g(".g-stepd").textContent = "أنت بعيد عنه (في مدينة أو دولة أخرى)، والطريق يُرسم لما تكون قريب منه في رحلتك."; $g(".g-sum").textContent = ""; return; }
      if (d < 0.04) { $g(".g-ico").textContent = "🏁"; $g(".g-step").textContent = "وصلت! 🎉"; $g(".g-stepd").textContent = ""; $g(".g-sum").textContent = ""; return; }
      if (!R) {
        $g(".g-ico").textContent = "🧭"; $g(".g-step").textContent = `${fmtKm(d)} باتجاه ${DIRS[Math.round(b / 45) % 8]}`;
        $g(".g-stepd").textContent = busy ? "جارٍ رسم الطريق…" : "تعذر رسم الطريق الآن (لا يوجد إنترنت؟). اتبع السهم والخط المتقطع، أو افتح تطبيق ملاحة.";
        $g(".g-sum").textContent = `🚶 ${fmtMin(d * 1.25 / 4.8 * 60)} · 🚗 ~${fmtMin(estimate(d).min)}`; return;
      }
      // Where am I on the route: the nearest route point; far from it means you left the route.
      let bi = 0, bd = Infinity; R.coords.forEach((p, i) => { const dd = km(me, p); if (dd < bd) { bd = dd; bi = i; } });
      if (bd > (mode === "car" ? 0.08 : 0.05) && Date.now() - lastTry > 15000 && navigator.onLine) { routeFor(); return; }
      done.setLatLngs(R.coords.slice(0, bi + 1).map(p => [p.lat, p.lng]));
      const n = R.stepAt.findIndex((ci, k) => k > 0 && ci > bi), st = n < 0 ? R.steps[R.steps.length - 1] : R.steps[n];
      const toTurn = n < 0 ? R.left[bi] : R.left[bi] - R.left[R.stepAt[n]];
      $g(".g-ico").textContent = st.text[0]; $g(".g-step").textContent = st.text[1];
      $g(".g-stepd").textContent = `بعد ${fmtKm(Math.max(0, toTurn))}` + (R.saved ? " · طريق محفوظ" : "");
      const leftKm = R.left[bi] + bd, frac = R.dist ? leftKm * 1000 / R.dist : 1;
      $g(".g-sum").textContent = `المتبقي ${fmtKm(leftKm)} · ${mode === "car" ? "🚗" : "🚶"} ${fmtMin(R.dur / 60 * frac * (mode === "car" ? 1.3 : 1))}`
        + (me.acc > 100 ? ` · دقة الموقع ${Math.round(me.acc)} م` : "");
    };
    const onFix = p => {
      const first = !me; me = last = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
      if (!you) you = L.marker([me.lat, me.lng], { icon: youIcon, zIndexOffset: 1000, interactive: false }).addTo(map); else you.setLatLng([me.lat, me.lng]);
      course = p.coords.speed > 1 && p.coords.heading != null && !isNaN(p.coords.heading) ? p.coords.heading : null; faceTo();
      if (first || (!R && !busy && Date.now() - lastTry > 30000 && navigator.onLine)) routeFor();
      else { if (follow) map.panTo([me.lat, me.lng], { animate: true }); paint(); }
    };
    $g(".g-mode").onclick = e => { const b = e.target.closest("[data-m]"); if (!b || b.dataset.m === mode) return; mode = b.dataset.m;
      for (const k of $g(".g-mode").children) k.setAttribute("aria-pressed", k === b); R = null; routeFor(); };
    // Quick rough fix from wifi / mobile network first, then GPS; say so if nothing comes.
    const slow = setTimeout(() => { if (!me) $g(".g-stepd").textContent = "ما وصلتنا إشارة الموقع بعد. تأكد أن الموقع (GPS) مفعّل في الجوال ومسموح للمتصفح، وجرّب مكان مفتوح."; }, 15000);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(p => { if (!me) onFix(p); }, () => {}, { enableHighAccuracy: false, maximumAge: 300000, timeout: 10000 });
      w = navigator.geolocation.watchPosition(onFix, e => { if (e.code === 1) { $g(".g-step").textContent = "إذن الموقع مقفول"; $g(".g-stepd").textContent = denied(); } },
        { enableHighAccuracy: true, maximumAge: 5000 });
    }
    // Compass for the small arrow: iPhone gives webkitCompassHeading after a tap-to-allow; Android gives an absolute alpha.
    const onTurn = e => { const h = e.webkitCompassHeading ?? (e.absolute && e.alpha != null ? 360 - e.alpha : null); if (h != null) { heading = h; $g(".g-compass").hidden = true; faceTo(); paint(); } };
    const listen = () => { addEventListener("deviceorientationabsolute", onTurn); addEventListener("deviceorientation", onTurn); };
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") {
      $g(".g-compass").hidden = false;
      $g(".g-compass").onclick = () => DeviceOrientationEvent.requestPermission().then(r => { if (r === "granted") { listen(); $g(".g-compass").hidden = true; } }).catch(() => {});
    }
    listen(); // where no permission is needed (Android) this starts at once; on iPhone after the tap
    $g(".g-close").onclick = () => { clearTimeout(slow); if (lock) lock.release().catch(() => {}); document.removeEventListener("visibilitychange", onVis); removeEventListener("resize", sizeMap); if (w != null) navigator.geolocation.clearWatch(w);
      removeEventListener("deviceorientationabsolute", onTurn); removeEventListener("deviceorientation", onTurn); map.remove(); el.remove(); };
    if (me) { const m0 = me; me = null; onFix({ coords: { latitude: m0.lat, longitude: m0.lng, accuracy: m0.acc } }); }
  }
  return { km, locate, say, times, line, fmtKm, fmtMin, kml, download, guide, get last() { return last; } };
})();
