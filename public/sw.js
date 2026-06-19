// Flowva service worker — installeerbaarheid + push-notificaties.
// Bewust GÉÉN fetch-handler: zo zit de SW NIET in het laadpad. Dat voorkomt de
// iOS-PWA koude-start-hang (app laadde pas na sluiten/heropenen) én er wordt
// nooit een oude versie geserveerd (altijd vers van het netwerk).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Inkomende push → toon de notificatie.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Flowva', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Flowva';
  const options = {
    body: data.body || '',
    icon: '/icon-512.png',
    badge: '/icon-512.png',
    data: { url: data.url || '/' },
    tag: data.tag || undefined,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tik op de notificatie → open de app (of focus een bestaand venster).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
