// ─────────────────────────────────────────────────────────────
// TradeDesk Server
// Riceve segnali dal pannello trader, costruisce link IBKR
// precompilati, manda push notification ai clienti.
// ─────────────────────────────────────────────────────────────

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const webpush  = require('web-push');
const fs       = require('fs');
const path     = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── MIDDLEWARE ───────────────────────────────────────────────
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : '*'
}));
app.use(express.json());

// ─── WEB PUSH SETUP ──────────────────────────────────────────
// Genera le chiavi VAPID una volta sola con:
//   node -e "const wp=require('web-push'); console.log(wp.generateVAPIDKeys())"
// Poi mettile nel file .env
webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL || 'tu@email.com'}`,
  process.env.VAPID_PUBLIC_KEY  || 'INSERISCI_VAPID_PUBLIC_KEY',
  process.env.VAPID_PRIVATE_KEY || 'INSERISCI_VAPID_PRIVATE_KEY'
);

// ─── STORAGE (file JSON — sostituire con DB in produzione) ────
const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
      clients: {},   // { clientId: { name, subscription, active } }
      signals: [],   // storico segnali inviati
    }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ─── IBKR LINK BUILDER ───────────────────────────────────────
// Costruisce l'URL per aprire IBKR Client Portal Web
// con l'ordine già precompilato.
//
// Per le opzioni IBKR usa il "conid" — ID univoco del contratto.
// Recuperalo dalla loro API di ricerca (non richiede auth cliente):
//   GET https://api.ibkr.com/v1/api/iserver/secdef/search?symbol=SPY
// oppure usa questa funzione che costruisce il link generico
// e lascia che IBKR risolva il contratto dal simbolo leggibile.

function buildIBKRLink(signal) {
  const base = 'https://ndcdyn.interactivebrokers.com/portal/portal.html';

  if (signal.asset === 'OPTIONS') {
    // Per le opzioni costruiamo il link alla pagina ordini
    // con i parametri precompilati nel fragment (lato client)
    const params = new URLSearchParams({
      action:    signal.direction === 'BUY' ? 'Buy' : 'Sell',
      symbol:    signal.ticker,
      secType:   'OPT',
      right:     signal.optionType,          // CALL o PUT
      strike:    signal.strike,
      expiry:    formatIBKRExpiry(signal.expiry),  // YYYYMMDD
      quantity:  signal.contracts || 1,
      orderType: signal.orderType === 'MKT' ? 'MKT' : 'LMT',
      price:     signal.optPrice || '',
      exchange:  'SMART',
      currency:  'USD',
    });
    return `${base}#/trade?${params.toString()}`;
  }

  // Equity / ETF / Futures
  const params = new URLSearchParams({
    action:    signal.direction === 'BUY' ? 'Buy' : 'Sell',
    symbol:    signal.ticker,
    secType:   signal.asset === 'FUTURES' ? 'FUT' : 'STK',
    quantity:  signal.qty || 1,
    orderType: signal.orderType === 'MKT' ? 'MKT' : 'LMT',
    price:     signal.limitPrice || signal.entry || '',
    exchange:  'SMART',
    currency:  'USD',
  });
  return `${base}#/trade?${params.toString()}`;
}

// Converte "2026-06-20" → "20260620" (formato IBKR)
function formatIBKRExpiry(dateStr) {
  if (!dateStr) return '';
  return dateStr.replace(/-/g, '');
}

// ─── COSTRUISCE IL TESTO DELLA NOTIFICA ──────────────────────
function buildNotificationText(signal) {
  if (signal.asset === 'OPTIONS') {
    const dir   = signal.direction;
    const type  = signal.optionType;
    const exp   = signal.expiry
      ? new Date(signal.expiry + 'T00:00:00')
          .toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: '2-digit' })
      : '?';
    return {
      title: `${dir} ${signal.ticker} ${type} ${signal.strike}`,
      body:  `Scad. ${exp} · Premio $${signal.optPrice} · ${signal.contracts} ctr · Stop ${signal.stop || '—'}`,
    };
  }
  return {
    title: `${signal.direction} ${signal.ticker}`,
    body:  `Entry ${signal.entry || 'MKT'} · Stop ${signal.stop || '—'} · TP ${signal.target || '—'}`,
  };
}

// ─── ROUTES ──────────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── VAPID public key (l'app cliente la usa per registrarsi) ──
app.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// ── Registrazione cliente (salva la push subscription) ───────
// Il cliente chiama questo endpoint la prima volta che apre l'app
// dopo aver accettato le notifiche.
app.post('/register-client', (req, res) => {
  const { clientId, name, subscription } = req.body;

  if (!clientId || !subscription) {
    return res.status(400).json({ error: 'clientId e subscription obbligatori' });
  }

  const data = loadData();
  data.clients[clientId] = {
    name:         name || clientId,
    subscription,
    registeredAt: new Date().toISOString(),
    active:       true,
  };
  saveData(data);

  console.log(`[REGISTER] Cliente registrato: ${name} (${clientId})`);
  res.json({ ok: true, message: `Cliente ${name} registrato` });
});

// ── Lista clienti (per il pannello trader) ───────────────────
app.get('/clients', (req, res) => {
  const data = loadData();
  const clients = Object.entries(data.clients).map(([id, c]) => ({
    id,
    name:         c.name,
    active:       c.active,
    registeredAt: c.registeredAt,
  }));
  res.json(clients);
});

// ── INVIA SEGNALE ────────────────────────────────────────────
// Il pannello trader chiama questo endpoint quando premi "Invia segnale".
// Il server:
//   1. Salva il segnale nello storico
//   2. Costruisce il link IBKR precompilato
//   3. Manda push notification a tutti i clienti attivi (o a lista specifica)
app.post('/send-signal', async (req, res) => {
  const signal = req.body;

  // Validazione base
  if (!signal.ticker || !signal.direction) {
    return res.status(400).json({ error: 'ticker e direction obbligatori' });
  }

  // Costruisce link IBKR
  const ibkrLink = buildIBKRLink(signal);
  const { title, body } = buildNotificationText(signal);

  // Salva come ultimo segnale (per polling dal cliente)
  lastSignal = { signal, ibkrLink: buildIBKRLink(signal), timestamp: Date.now() };

  // Salva segnale
  const data = loadData();
  const signalRecord = {
    ...signal,
    id:        Date.now(),
    ibkrLink,
    sentAt:    new Date().toISOString(),
    delivered: [],
    failed:    [],
  };
  data.signals.unshift(signalRecord);
  // Mantieni solo ultimi 100 segnali
  data.signals = data.signals.slice(0, 100);

  // Determina a chi mandare
  const targetClients = signal.targetClients
    ? Object.entries(data.clients).filter(([id]) => signal.targetClients.includes(id))
    : Object.entries(data.clients).filter(([, c]) => c.active);

  console.log(`[SIGNAL] ${title} — invio a ${targetClients.length} clienti`);

  // Manda push a ogni cliente
  const results = await Promise.allSettled(
    targetClients.map(async ([clientId, client]) => {
      const payload = JSON.stringify({
        title,
        body,
        ibkrLink,
        signal: {
          ticker:     signal.ticker,
          direction:  signal.direction,
          asset:      signal.asset,
          optionType: signal.optionType || null,
          strike:     signal.strike     || null,
          expiry:     signal.expiry     || null,
          optPrice:   signal.optPrice   || null,
          contracts:  signal.contracts  || null,
          entry:      signal.entry      || null,
          stop:       signal.stop       || null,
          target:     signal.target     || null,
          orderType:  signal.orderType  || 'MKT',
          limitPrice: signal.limitPrice || null,
          note:       signal.note       || null,
        },
        timestamp: Date.now(),
      });

      try {
        await webpush.sendNotification(client.subscription, payload);
        signalRecord.delivered.push(clientId);
        console.log(`  [OK] ${client.name}`);
      } catch (err) {
        signalRecord.failed.push(clientId);
        console.log(`  [FAIL] ${client.name}: ${err.message}`);
        // Se la subscription è scaduta, disattiva il cliente
        if (err.statusCode === 410) {
          data.clients[clientId].active = false;
          console.log(`  [UNSUB] ${client.name} rimosso (subscription scaduta)`);
        }
        throw err;
      }
    })
  );

  saveData(data);

  const delivered = results.filter(r => r.status === 'fulfilled').length;
  const failed    = results.filter(r => r.status === 'rejected').length;

  res.json({
    ok:        true,
    signalId:  signalRecord.id,
    ibkrLink,
    delivered,
    failed,
    total:     targetClients.length,
  });
});

// ── Storico segnali ──────────────────────────────────────────
app.get('/signals', (req, res) => {
  const data  = loadData();
  const limit = parseInt(req.query.limit) || 20;
  res.json(data.signals.slice(0, limit));
});

// ── Ultimo segnale — il cliente lo legge quando apre l'app ──
// Resta in memoria finché non viene letto dal cliente
let lastSignal = null;

app.get('/latest-signal', (req, res) => {
  if (!lastSignal) return res.json({ signal: null });
  res.json(lastSignal);
  // NON cancelliamo — il cliente può riaprire l'app e trovarlo ancora
});

// ── Link IBKR standalone (per test) ─────────────────────────
app.post('/ibkr-link', (req, res) => {
  const link = buildIBKRLink(req.body);
  res.json({ link });
});

// ─── START ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║         TradeDesk Server avviato         ║
║  http://localhost:${PORT}                    ║
╚══════════════════════════════════════════╝

Endpoints:
  GET  /health              → status server
  GET  /vapid-public-key    → chiave per push notification
  POST /register-client     → registra cliente
  GET  /clients             → lista clienti
  POST /send-signal         → invia segnale + push
  GET  /signals             → storico segnali
  POST /ibkr-link           → genera link IBKR (test)
`);
});
