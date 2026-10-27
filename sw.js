// Service worker SOLO para notificaciones push: no tiene manejador «fetch» ni guarda nada en caché,
// así que no interfiere con las actualizaciones (version.txt / watchVersion en app.js).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Castalla C.F.', {
    body: d.body || '',
    icon: 'assets/icon-192.png',
    badge: 'assets/icon-192.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || './' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope) && 'focus' in c) {
        c.postMessage({ type: 'abrir', url });
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
