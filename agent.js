// ─────────────────────────────────────────────────────────────
// TradeDesk Agent — gira sul PC del cliente
//
// Prerequisiti:
//   1. Node.js installato (nodejs.org)
//   2. TWS aperta e loggata con API abilitata
//   3. npm install @stoqey/ib ws
//
// Avvio:
//   node agent.js
// ─────────────────────────────────────────────────────────────

const { IBApi, EventName, OrderAction, OrderType, SecType } = require('@stoqey/ib');
const WebSocket = require('ws');

// ─── CONFIGURAZIONE ──────────────────────────────────────────
const CONFIG = {
  // Il tuo server Railway
  serverUrl: 'wss://tradedesk-server-production.up.railway.app',

  // ID univoco di questo cliente — cambia per ogni cliente
  clientId: 'marco-c',
  clientName: 'Marco C.',

  // TWS locale
  twsHost: '127.0.0.1',
  twsPort: 7496,      // 7496 = live, 7497 = paper
  twsClientId: 10,

  // Quanto spesso mandare le posizioni al server (ms)
  positionsInterval: 30000,
};

// ─── STATO ───────────────────────────────────────────────────
let ib = null;
let ws = null;
let twsConnected = false;
let serverConnected = false;
let nextOrderId = null;
let positions = {};
let accountData = {};

// ─── LOG ─────────────────────────────────────────────────────
function log(msg) {
  console.log(`[${new Date().toTimeString().slice(0,8)}] ${msg}`);
}

// ─── CONNESSIONE TWS ─────────────────────────────────────────
function connectTWS() {
  return new Promise((resolve, reject) => {
    log('Connessione a TWS...');
    ib = new IBApi({ host: CONFIG.twsHost, port: CONFIG.twsPort, clientId: CONFIG.twsClientId });

    const timeout = setTimeout(() => {
      reject(new Error('Timeout TWS — assicurati che TWS sia aperta con API abilitata'));
    }, 10000);

    ib.on(EventName.connected, () => {
      log('TWS connessa');
      twsConnected = true;
      ib.reqIds();
      ib.reqAccountUpdates(true, '');
      ib.reqPositions();
    });

    ib.on(EventName.nextValidId, (orderId) => {
      nextOrderId = orderId;
      clearTimeout(timeout);
      log(`TWS pronta. OrderId: ${orderId}`);
      resolve();
    });

    ib.on(EventName.error, (err, code) => {
      if ([2104, 2106, 2158, 2119, 2100].includes(code)) return;
      log(`TWS errore ${code}: ${err?.message || err}`);
    });

    ib.on(EventName.disconnected, () => {
      log('TWS disconnessa — riconnessione in 5s...');
      twsConnected = false;
      setTimeout(connectTWS, 5000);
    });

    // Posizioni
    ib.on(EventName.position, (account, contract, pos, avgCost) => {
      if (pos === 0) { delete positions[contract.symbol]; return; }
      positions[contract.symbol + '_' + (contract.secType || 'STK')] = {
        symbol:   contract.symbol,
        secType:  contract.secType,
        position: pos,
        avgCost,
        strike:   contract.strike,
        right:    contract.right,
        expiry:   contract.lastTradeDateOrContractMonth,
        currency: contract.currency,
      };
    });

    ib.on(EventName.positionEnd, () => {
      log(`Posizioni ricevute: ${Object.keys(positions).length}`);
      sendPositions();
    });

    // Account data (P&L, cash, ecc.)
    ib.on(EventName.updateAccountValue, (key, value, currency) => {
      if (['NetLiquidation', 'UnrealizedPnL', 'RealizedPnL', 'AvailableFunds', 'MaintMarginReq'].includes(key)) {
        accountData[key] = { value, currency };
      }
    });

    // Order status
    ib.on(EventName.orderStatus, (orderId, status, filled, remaining, avgPrice) => {
      log(`Ordine ${orderId}: ${status} | filled: ${filled} | avgPrice: ${avgPrice}`);
      sendToServer({
        type: 'ORDER_STATUS',
        clientId: CONFIG.clientId,
        orderId, status, filled, remaining, avgPrice,
        timestamp: Date.now()
      });
    });

    ib.connect();
  });
}

// ─── ESEGUI ORDINE ───────────────────────────────────────────
function executeOrder(signal) {
  return new Promise((resolve, reject) => {
    if (!twsConnected || !ib) return reject(new Error('TWS non connessa'));

    const orderId = nextOrderId++;
    log(`Eseguo ordine #${orderId}: ${signal.direction} ${signal.ticker}`);

    let contract;

    if (signal.asset === 'OPTIONS') {
      contract = {
        symbol:   signal.ticker,
        secType:  SecType.OPT,
        exchange: 'SMART',
        currency: signal.currency || 'USD',
        lastTradeDateOrContractMonth: (signal.expiry || '').replace(/-/g, ''),
        strike:   parseFloat(signal.strike),
        right:    signal.optionType === 'CALL' ? 'C' : 'P',
        multiplier: '100',
      };
    } else {
      contract = {
        symbol:   signal.ticker,
        secType:  SecType.STK,
        exchange: signal.exchange || 'SMART',
        currency: signal.currency || 'USD',
      };
    }

    const order = {
      action:        signal.direction === 'BUY' ? OrderAction.BUY : OrderAction.SELL,
      totalQuantity: parseInt(signal.asset === 'OPTIONS' ? signal.contracts : signal.qty) || 1,
      orderType:     signal.orderType === 'LMT' ? OrderType.LMT : OrderType.MKT,
      lmtPrice:      signal.orderType === 'LMT' && signal.limitPrice ? parseFloat(signal.limitPrice) : undefined,
      tif:           'DAY',
      transmit:      true,
    };

    let resolved = false;

    ib.on(EventName.orderStatus, (id, status) => {
      if (id !== orderId || resolved) return;
      if (['Submitted', 'PreSubmitted', 'Filled'].includes(status)) {
        resolved = true;
        resolve({ orderId, status });
      }
    });

    ib.on(EventName.error, (err, code, reqId) => {
      if (reqId === orderId && !resolved) {
        resolved = true;
        reject(new Error(`${err?.message || err} (code: ${code})`));
      }
    });

    ib.placeOrder(orderId, contract, order);

    setTimeout(() => {
      if (!resolved) { resolved = true; reject(new Error('Timeout ordine')); }
    }, 15000);
  });
}

// ─── CONNESSIONE SERVER ──────────────────────────────────────
function connectServer() {
  log(`Connessione al server: ${CONFIG.serverUrl}`);

  ws = new WebSocket(CONFIG.serverUrl);

  ws.on('open', () => {
    serverConnected = true;
    log('Server connesso');

    // Registrati
    sendToServer({
      type: 'REGISTER',
      clientId: CONFIG.clientId,
      clientName: CONFIG.clientName,
      timestamp: Date.now()
    });

    // Manda subito le posizioni
    sendPositions();

    // Manda posizioni ogni 30 secondi
    setInterval(() => {
      ib?.reqPositions();
    }, CONFIG.positionsInterval);
  });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);
      log(`Messaggio dal server: ${msg.type}`);

      if (msg.type === 'SIGNAL') {
        log(`Segnale ricevuto: ${msg.signal.direction} ${msg.signal.ticker}`);
        try {
          const result = await executeOrder(msg.signal);
          log(`Ordine eseguito: ${JSON.stringify(result)}`);
          sendToServer({ type: 'ORDER_EXECUTED', clientId: CONFIG.clientId, result, signal: msg.signal });
        } catch(e) {
          log(`Errore ordine: ${e.message}`);
          sendToServer({ type: 'ORDER_ERROR', clientId: CONFIG.clientId, error: e.message, signal: msg.signal });
        }
      }

      if (msg.type === 'GET_POSITIONS') {
        ib?.reqPositions();
      }

    } catch(e) {
      log(`Errore parsing messaggio: ${e.message}`);
    }
  });

  ws.on('close', () => {
    serverConnected = false;
    log('Server disconnesso — riconnessione in 5s...');
    setTimeout(connectServer, 5000);
  });

  ws.on('error', (err) => {
    log(`Errore WebSocket: ${err.message}`);
  });
}

function sendToServer(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function sendPositions() {
  sendToServer({
    type: 'POSITIONS',
    clientId: CONFIG.clientId,
    positions: Object.values(positions),
    accountData,
    timestamp: Date.now()
  });
}

// ─── AVVIO ───────────────────────────────────────────────────
async function main() {
  console.log(`
╔══════════════════════════════════════════╗
║         TradeDesk Agent avviato          ║
║  Cliente: ${CONFIG.clientName.padEnd(30)}║
╚══════════════════════════════════════════╝
`);

  try {
    await connectTWS();
    connectServer();
    log('Agent pronto — in attesa di segnali...');
  } catch(e) {
    log(`ERRORE: ${e.message}`);
    process.exit(1);
  }
}

main();
