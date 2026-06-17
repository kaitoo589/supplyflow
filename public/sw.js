// Minimale service worker — maakt Flowva installeerbaar (PWA).
// Bewust GÉÉN agressieve cache: we serveren altijd vers van het netwerk,
// zodat nieuwe versies meteen doorkomen (geen "vastgevroren" oude app).
// De (lege) fetch-handler is genoeg om in Chrome installeerbaar te zijn.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
