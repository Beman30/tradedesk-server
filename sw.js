// Service Worker — TradeDesk Client
// Gestisce le push notification anche con l'app chiusa.
// Questo file va messo nella root del dominio dell'app cliente.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// ─── RICEZIONE PUSH ──────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: 'Nuovo segnale', body: event.data.text() };
  }

  const options = {
    body:    data.body,
    icon:    '/icon-192.png',
    badge:   '/badge-72.png',
    vibrate: [200, 100, 200, 100, 400],
    tag:     'tradedesk-signal',     // sostituisce notifica precedente
    renotify: true,
    requireInteraction: true,        // resta visibile finché non tocca
    data: {
      ibkrLink: data.ibkrLink,
      signal:   data.signal,
      timestamp: data.timestamp,
    },
    actions: [
      {
        action: 'open-ibkr',
        title:  '▲ Apri IBKR',
      },
      {
        action: 'view-signal',
        title:  'Vedi dettagli',
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ─── CLICK SULLA NOTIFICA ────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const { ibkrLink, signal } = event.notification.data || {};

  if (event.action === 'open-ibkr' && ibkrLink) {
    // Apre IBKR Client Portal Web con ordine precompilato
    event.waitUntil(self.clients.openWindow(ibkrLink));
    return;
  }

  // Apre l'app TradeDesk (o la porta in primo piano se già aperta)
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // Se l'app è già aperta, portala in primo piano e mandagli il segnale
        for (const client of clientList) {
          if (client.url.includes(self.location.origin)) {
            client.focus();
            client.postMessage({ type: 'NEW_SIGNAL', signal, ibkrLink });
            return;
          }
        }
        // Altrimenti apri l'app
        return self.clients.openWindow('/?signal=' + encodeURIComponent(JSON.stringify(signal)));
      })
  );
});
