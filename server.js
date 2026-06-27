require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const webpush  = require('web-push');
const fs       = require('fs');
const path     = require('path');
const http     = require('http');
const WebSocket = require('ws');

const { analyzeCreditSpread, rankCreditSpreads } = require('./spread-engine');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });
const PORT   = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(__dirname));

webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL || 'tu@email.com'}`,
  process.env.VAPID_PUBLIC_KEY  || 'INSERISCI',
  process.env.VAPID_PRIVATE_KEY || 'INSERISCI'
);

const DATA_FILE = path.join(__dirname, 'data.json');
function loadData() {
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ clients: {}, signals: [] }, null, 2));
  return JSON.parse(fs.readFileSync(DATA_FILE));
}
function saveData(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

let lastSignal = null;

// ─── AGENTI CONNESSI (WebSocket) ─────────────────────────────
const agents = new Map(); // clientId → { ws, name, positions, accountData }

wss.on('connection', (ws) => {
  let agentClientId = null;
  console.log('[WS] Nuova connessione agente');

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.type === 'REGISTER') {
        agentClientId = msg.clientId;
        agents.set(agentClientId, { ws, name: msg.clientName, positions: [], accountData: {} });
        console.log(`[WS] Agente registrato: ${msg.clientName} (${agentClientId})`);
      }

      if (msg.type === 'POSITIONS') {
        const agent = agents.get(msg.clientId);
        if (agent) { agent.positions = msg.positions; agent.accountData = msg.accountData; }
      }

      if (msg.type === 'ORDER_EXECUTED') {
        console.log(`[WS] Ordine eseguito da ${msg.clientId}:`, msg.result);
      }

      if (msg.type === 'ORDER_ERROR') {
        console.log(`[WS] Errore ordine da ${msg.clientId}:`, msg.error);
      }

      if (msg.type === 'ORDER_STATUS') {
        console.log(`[WS] Status ordine ${msg.orderId}: ${msg.status}`);
      }

    } catch(e) { console.error('[WS] Errore parsing:', e.message); }
  });

  ws.on('close', () => {
    if (agentClientId) { agents.delete(agentClientId); console.log(`[WS] Agente disconnesso: ${agentClientId}`); }
  });
});

function sendToAgent(clientId, data) {
  const agent = agents.get(clientId);
  if (agent && agent.ws.readyState === WebSocket.OPEN) {
    agent.ws.send(JSON.stringify(data));
    return true;
  }
  return false;
}

function broadcastSignal(signal) {
  let sent = 0;
  agents.forEach((agent, clientId) => {
    if (agent.ws.readyState === WebSocket.OPEN) {
      agent.ws.send(JSON.stringify({ type: 'SIGNAL', signal }));
      sent++;
      console.log(`[WS] Segnale inviato a ${agent.name}`);
    }
  });
  return sent;
}

// ─── ENDPOINTS ───────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', agents: agents.size, time: new Date().toISOString() }));
app.get('/vapid-public-key', (req, res) => res.json({ publicKey: process.env.VAPID_PUBLIC_KEY }));

app.post('/register-client', (req, res) => {
  const { clientId, name, subscription } = req.body;
  if (!clientId || !subscription) return res.status(400).json({ error: 'dati mancanti' });
  const data = loadData();
  data.clients[clientId] = { name: name || clientId, subscription, registeredAt: new Date().toISOString(), active: true };
  saveData(data);
  res.json({ ok: true });
});

app.get('/clients', (req, res) => {
  const data = loadData();
  const clients = Object.entries(data.clients).map(([id, c]) => ({
    id, name: c.name, active: c.active,
    agentConnected: agents.has(id),
    positions: agents.get(id)?.positions || [],
    accountData: agents.get(id)?.accountData || {},
  }));
  res.json(clients);
});

app.get('/agents', (req, res) => {
  const list = [];
  agents.forEach((agent, id) => {
    list.push({ id, name: agent.name, positions: agent.positions, accountData: agent.accountData });
  });
  res.json(list);
});

app.post('/send-signal', async (req, res) => {
  const signal = req.body;
  if (!signal.ticker || !signal.direction) return res.status(400).json({ error: 'dati mancanti' });

  lastSignal = { signal, timestamp: Date.now() };

  // Invia a tutti gli agenti connessi via WebSocket
  const agentsSent = broadcastSignal(signal);

  // Invia push notification ai clienti registrati
  const data = loadData();
  const record = { ...signal, id: Date.now(), sentAt: new Date().toISOString(), delivered: [], failed: [] };
  data.signals.unshift(record);
  data.signals = data.signals.slice(0, 100);

  const targets = Object.entries(data.clients).filter(([, c]) => c.active);
  await Promise.allSettled(targets.map(async ([clientId, client]) => {
    const title = `${signal.direction} ${signal.ticker}${signal.optionType ? ' ' + signal.optionType + ' ' + signal.strike : ''}`;
    const body  = signal.asset === 'OPTIONS'
      ? `Scad. ${signal.expiry} · Premio $${signal.optPrice} · ${signal.contracts} ctr`
      : `Entry ${signal.entry || 'MKT'} · Stop ${signal.stop || '—'}`;
    try {
      await webpush.sendNotification(client.subscription, JSON.stringify({ title, body, signal, timestamp: Date.now() }));
      record.delivered.push(clientId);
    } catch(e) {
      record.failed.push(clientId);
      if (e.statusCode === 410) data.clients[clientId].active = false;
    }
  }));

  saveData(data);
  res.json({ ok: true, signalId: record.id, agentsSent, pushSent: record.delivered.length });
});

// ─── SPREAD ENGINE ──────────────────────────────────────────
app.post('/analyze-spread', (req, res) => {
  try {
    const result = analyzeCreditSpread(req.body);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/rank-spreads', (req, res) => {
  try {
    const { spreads } = req.body;
    if (!Array.isArray(spreads) || !spreads.length) return res.status(400).json({ error: 'spreads array richiesto' });
    const ranked = rankCreditSpreads(spreads);
    res.json(ranked);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const SPREAD_CANDIDATES_FILE = path.join(__dirname, 'data', 'spread-candidates.json');

app.get('/spread-candidates', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(SPREAD_CANDIDATES_FILE, 'utf8'));
    res.json(data);
  } catch {
    res.json([]);
  }
});

app.post('/spread-candidates', (req, res) => {
  const { candidates } = req.body;
  if (!Array.isArray(candidates)) return res.status(400).json({ error: 'candidates array richiesto' });
  fs.writeFileSync(SPREAD_CANDIDATES_FILE, JSON.stringify(candidates, null, 2));
  res.json({ ok: true, count: candidates.length });
});

app.get('/latest-signal', (req, res) => res.json(lastSignal || { signal: null }));
app.get('/signals', (req, res) => { const data = loadData(); res.json(data.signals.slice(0, 20)); });

// ─── START ───────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║         TradeDesk Server avviato         ║
║  http://localhost:${PORT}                    ║
╚══════════════════════════════════════════╝

Endpoints:
  GET  /health
  GET  /agents          → agenti connessi + posizioni
  GET  /clients
  POST /send-signal     → invia a agenti + push
  POST /analyze-spread  → analisi singolo spread
  POST /rank-spreads    → classifica spread multipli
  GET  /latest-signal
  GET  /signals
`);
});
