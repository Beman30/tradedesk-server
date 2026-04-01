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

  // Azione "Apri IBKR" — apre il link direttamente
  if (event.action === 'open-ibkr' && ibkrLink) {
    event.waitUntil(self.clients.openWindow(ibkrLink));
    return;
  }

  // Click sul corpo della notifica — apre/focus l'app e inietta il segnale
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(async clientList => {
        // Costruisci URL app con segnale come parametro
        const appUrl = self.registration.scope +
          'client-app.html?signal=' + encodeURIComponent(JSON.stringify(signal)) +
          '&ibkr=' + encodeURIComponent(ibkrLink || '');

        // Se l'app è già aperta mandagli il messaggio e fai focus
        for (const client of clientList) {
          if (client.url.includes('client-app')) {
            await client.focus();
            client.postMessage({ type: 'NEW_SIGNAL', signal, ibkrLink });
            return;
          }
        }
        // Altrimenti apri l'app con i parametri nel URL
        return self.clients.openWindow(appUrl);
      })
  );
});
