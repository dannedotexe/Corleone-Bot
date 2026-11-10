/* Corleone – Service Worker: schneller Start (App-Gerüst im Speicher) und Push-Benachrichtigungen.
   __VERSION__ ersetzt der Server; mit jedem Update entsteht ein neuer Speicher, der alte wird gelöscht. */
const CACHE = "corleone-__VERSION__";
const SHELL = ["/", "/assets/app.js", "/assets/theme.js", "/assets/style.css", "/assets/classic.css", "/assets/corleone.css", "/assets/ui.js",
  "/assets/admin.js", "/assets/people.js", "/assets/announce.js", "/assets/polls.js", "/assets/mine.js", "/assets/tasks.js", "/assets/calendar.js",
  "/assets/eventlogs.js", "/assets/suggestions.js", "/assets/icons/icon-192.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("corleone-") && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

// Daten (/api, Login, Logo) nie aus dem Speicher. Seite und Dateien kommen aus dem Speicher dieser Version (passen also
// immer zusammen); ein Update installiert die neue Version im Hintergrund, danach lädt die Seite einmal neu.
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/oauth") || url.pathname.startsWith("/login") || url.pathname.startsWith("/logout") || url.pathname.startsWith("/brand/")) return;
  if (url.pathname !== "/" && !url.pathname.startsWith("/assets/")) return;
  const key = url.pathname === "/" ? "/" : event.request;
  event.respondWith(caches.open(CACHE).then(cache => cache.match(key, { ignoreSearch: true }).then(hit => hit ?? fetch(event.request).then(response => {
    if (response.ok && response.type === "basic") cache.put(key, response.clone());
    return response;
  }))));
});

// Push: { title, body, url, tag }
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || "Corleone", {
    body: data.body || "", tag: data.tag || undefined, data: { url: data.url || "/" },
    icon: "/assets/icons/icon-192.png", badge: "/assets/icons/icon-192.png",
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", location.origin).href;
  if (!target.startsWith(location.origin)) { event.waitUntil(self.clients.openWindow(target)); return; } // z. B. Discord-Link
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const client of list) if (client.url.startsWith(location.origin)) { client.focus(); return client.navigate(target).catch(() => {}); }
    return self.clients.openWindow(target);
  }));
});
