self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  if (!event.data) return;

  let data;
  try { data = event.data.json(); }
  catch { data = { title: 'Nuovo segnale', body: event.data.text() }; }

  const ibkrLink = data.ibkrLink || '';
  const signal   = data.signal   || {};

  const options = {
    body:             data.body,
    icon:             '/tradedesk-server/icon-192.png',
    badge:            '/tradedesk-server/icon-192.png',
    vibrate:          [300, 100, 300, 100, 600],
    tag:              'tradedesk-signal',
    renotify:         true,
    requireInteraction: true,
    data: { ibkrLink, signal },
    actions: [
      { action: 'open-ibkr',  title: '▲ Apri IBKR' },
      { action: 'view-app',   title: 'Dettagli' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  const { ibkrLink, signal } = event.notification.data || {};

  // Bottone "Apri IBKR" — apre direttamente il link broker
  if (event.action === 'open-ibkr') {
    if (ibkrLink) {
      event.waitUntil(self.clients.openWindow(ibkrLink));
    }
    return;
  }

  // Click sul corpo o "Dettagli" — apre l'app con segnale in localStorage
  event.waitUntil((async () => {
    // Salva il segnale in tutti i client aperti via postMessage
    const allClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    // Trova se l'app è già aperta
    const appClient = allClients.find(c => c.url.includes('client-app'));

    if (appClient) {
      // App già aperta — manda messaggio e porta in primo piano
      appClient.postMessage({ type: 'NEW_SIGNAL', signal, ibkrLink });
      await appClient.focus();
    } else {
      // App chiusa — aprila, il segnale verrà letto da localStorage
      // Prima salviamo il segnale nel cache storage così la pagina lo trova
      const cache = await caches.open('tradedesk-pending');
      await cache.put(
        '/pending-signal',
        new Response(JSON.stringify({ signal, ibkrLink }), {
          headers: { 'Content-Type': 'application/json' }
        })
      );
      await self.clients.openWindow(
        self.registration.scope + 'client-app.html'
      );
    }
  })());
});
