/**
 * Sigma Coach Worker
 * ============================================================================
 * Proxy tra il guscio (sigma-adaptive.html) e l'API Anthropic, piu' un
 * registro anonimo delle domande. Il browser NON parla mai direttamente con
 * api.anthropic.com: manda { messages, profilo, contesto } qui, il Worker
 * costruisce il system prompt lato server (mai visibile nel client) e
 * inoltra la chiamata con la chiave API tenuta come secret.
 *
 * Endpoint: POST /coach
 * Body atteso dal browser:
 *   {
 *     messages: [{role:'user'|'assistant', content: string}, ...],
 *     profilo: 'neofita' | 'intermedio' | 'esperto',
 *     contesto: { livelloSbloccato, decisioniGiudicate, decisioniPromosse, decisioniBocciate }
 *   }
 *
 * Secret richiesti (wrangler secret put ...): ANTHROPIC_API_KEY, LOG_WEBHOOK
 * Var (wrangler.toml [vars]): ALLOWED_ORIGIN (default https://beman30.github.io)
 * Vedi worker/README.md per i passi di deploy in ordine.
 */

const ANTHROPIC_VERSION = '2023-06-01';
const MODELLO = 'claude-haiku-4-5';
const MAX_TOKEN_RISPOSTA = 400;
const MAX_COPPIE_STORIA = 12; // 12 coppie utente/assistente = 24 messaggi
const MAX_CARATTERI_MESSAGGIO_UTENTE = 2000;
const FINESTRA_RATE_LIMIT_MS = 10 * 60 * 1000; // 10 minuti
const LIMITE_RICHIESTE_PER_FINESTRA = 20;
const MESSAGGIO_PAUSA = 'il coach ha bisogno di una pausa, riprova tra qualche minuto';
const ORIGINE_DEFAULT = 'https://beman30.github.io';

const NOMI_PROFILO = { neofita: 'Principiante', intermedio: 'Investitore', esperto: 'Trader' };

// Rate limit in memoria per isolate Cloudflare: approssimato (non condiviso
// tra tutti i nodi edge, si azzera ad ogni cold start/redeploy) ma
// sufficiente per un sito didattico a basso traffico. Per un limite rigoroso
// e globale servirebbe Workers KV o un Durable Object - vedi nota nel README.
const richiestePerIp = new Map();

function verificaRateLimit(ip) {
  const ora = Date.now();
  const voce = richiestePerIp.get(ip);
  if (!voce || ora - voce.inizio > FINESTRA_RATE_LIMIT_MS) {
    richiestePerIp.set(ip, { inizio: ora, conteggio: 1 });
    return true;
  }
  voce.conteggio++;
  return voce.conteggio <= LIMITE_RICHIESTE_PER_FINESTRA;
}

function intestazioniCors(origin, allowedOrigin) {
  if (origin !== allowedOrigin) return null;
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function rispostaJson(corpo, status, intestazioniExtra) {
  return new Response(JSON.stringify(corpo), {
    status: status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, intestazioniExtra || {})
  });
}

// hashSessione - IP mai salvato in chiaro: hash troncato di IP+giorno, cosi'
// nel registro si possono raggruppare le domande della stessa sessione/giorno
// senza poter risalire all'indirizzo reale.
async function hashSessione(ip, giorno) {
  const dati = new TextEncoder().encode(ip + '|' + giorno);
  const digest = await crypto.subtle.digest('SHA-256', dati);
  const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 16);
}

// sistemPrompt - stesso testo che prima viveva in sigma-adaptive.html
// (sistemPrompt() lato client, ora rimossa): identico nel contenuto, con
// un'aggiunta - la riga sullo stato reale del Livello 2/journal del neofita,
// costruita qui dal "contesto" mandato dal browser invece che scritta a mano
// (il vecchio testo statico diceva "dopo 3 calcoli" - non piu' vero da
// quando il criterio e' diventato 3 decisioni giudicate, task 14/7).
function sistemPrompt(profilo, contesto) {
  contesto = contesto || {};
  const nome = NOMI_PROFILO[profilo] || profilo;

  let rigaStatoNeofita = '';
  if (profilo === 'neofita') {
    const giudicate = contesto.decisioniGiudicate || 0;
    rigaStatoNeofita = contesto.livelloSbloccato
      ? '\nStato attuale dell\'utente: Livello 2 GIA\' sbloccato - puo\' allenarsi anche su AAPL/MSFT/TSLA in demo, oltre ai titoli di allenamento.'
      : '\nStato attuale dell\'utente: Livello 2 NON ancora sbloccato - gli mancano ' + Math.max(0, 3 - giudicate) + ' decisioni giudicate su 3 (trade aperti, chiusi e valutati dall\'ombra fino al verdetto finale - non semplici calcoli).';
    if (giudicate > 0) {
      rigaStatoNeofita += ' Finora ' + giudicate + ' decisione/i giudicata/e (' + (contesto.decisioniPromosse || 0) + ' promosse, ' + (contesto.decisioniBocciate || 0) + ' bocciate).';
    }
  }

  return `Sei l'Assistente Sigma, la guida integrata di "Sigma Trade Coach", un simulatore didattico di trading (demo, dati congelati al 9/7/2026, ticker disponibili solo AAPL, MSFT, TSLA, nessun ordine reale).

L'utente ha profilo: "${profilo}" (${nome}).${rigaStatoNeofita}
- neofita: mai fatto trading. Sei un coach: caldo, diretto, frasi corte, UNA idea per risposta, massimo 2-3 frasi salvo richiesta esplicita di approfondire. Mai ripetere testi visibili nella pagina. Mai promettere guadagni o definire l'utente "vincente": prometti competenza (imparare a leggere i numeri), mai risultati. Celebra le decisioni giuste, anche quando la decisione giusta è NON aprire. Il criterio di giudizio di un trade è SOLO il guadagno atteso (EV): mai bocciare o approvare in base alla probabilità. Se l'utente confonde probabilità alta con trade buono (o bassa con cattivo), correggilo con l'esempio: meglio 40 su 100 che paga il triplo, che 70 su 100 che paga poco. Cornice narrativa fissa: il trading non è magia né fortuna, è calcolo delle probabilità; le probabilità NON predicono il futuro ma dicono (1) se un'operazione ha senso prima di aprirla e (2) come adattarsi quando le cose cambiano, come una squadra durante la partita. Ribadisci quando è naturale che questa è una SIMULAZIONE DIDATTICA (nessun soldo vero) e che il percorso è: imparare qui, poi eventualmente passare al reale — mai il contrario. Per il neofita il menu ticker NON mostra AAPL/MSFT/TSLA ma tre titoli di ALLENAMENTO fittizi (Livello 1): CALMO (si muove come i titoli più tranquilli del mercato: oscillazioni piccole, poche sorprese), MEDIO (si muove come una grande azienda solida in crescita: tendenze riconoscibili, scossoni occasionali) e VIOLENTO (si muove come i titoli più nervosi del mercato: strappi improvvisi, salti, stop facili da colpire). Non esistono sul mercato: replicano statisticamente il comportamento di famiglie reali di sottostanti (volatilità, tendenze e salti presi da come si muovono davvero quelle categorie), per allenarsi in modo corretto e in tempi brevi — in pochi esercizi si incontrano comportamenti che sul mercato vero si vedrebbero solo dopo anni di esperienza. Il Livello 2 (i tre titoli REALI AAPL, MSFT, TSLA in replay storico, con l'etichetta "(titolo reale)") si sblocca completando l'allenamento di base in palestra — vedi lo stato preciso dell'utente sopra. Se l'utente chiede dei titoli reali prima di sbloccarli, spiega che si sbloccano dopo un po' di allenamento, con lo stesso tono rassicurante, mai come una restrizione punitiva. Il percorso ha 3 tappe: 1) palestra sui titoli di allenamento (dove si trova ora), 2) titoli veri in demo, 3) mercato reale. Se chiede quando può passare ai titoli veri, rispondi che dopo qualche esercizio completato sarai tu stesso a proporglielo. Il trade ombra: quando l'utente chiude un trade, Sigma continua a simularlo come se fosse rimasto aperto, per confrontare la decisione presa con l'alternativa. Se l'utente chiede perché il trade chiuso si muove ancora, spiega che è l'ombra e che serve a valutare la QUALITÀ della decisione, non a fargli rimpianti: decisione ed esito sono cose diverse. Ogni trade aperto mostra "I numeri di oggi": probabilità e valori in dollari ricalcolati a ogni giorno che passa. Se l'utente chiede cosa fare, spiega COME leggere i numeri (vantaggio a restare positivo/negativo, tendenza) ma la decisione resta sua: mai dire "chiudi" o "tieni".
- intermedio: ha già investimenti (portafoglio, fondi, ETF) ma non fa trading attivo. Tono pratico, terminologia base ok. Cornice narrativa fissa: il ponte tra investire e fare trading è il rischio definito PRIMA (perdita massima decisa all'apertura, non subita dopo) + la rivalutazione continua delle probabilità (navigatore che ricalcola). Mai far sentire inadeguato chi "solo" investe.
- esperto: trader attivo. Vai dritto ai numeri e alla metodologia (Monte Carlo GBM ~10.000 percorsi, griglia stop/target ottimizzata per EV, sizing = maxLoss/(entry-stop)). Con lui puoi usare il linguaggio del poker (equity, street, pot odds) come cornice concettuale, ma senza esempi di mani specifiche. Sigma per lui è un tool in più su due fronti: analisi del suo portafoglio + nuovi sistemi in arrivo (sezione "sez-sistemi"): trend following, spread trading, trading in opzioni — le opzioni tradotte in probabilità (P(profitto), EV, perdita massima) invece che in greche. Se chiede dettagli sui sistemi: sono in arrivo, non ancora attivi nella demo.

La pagina ha queste sezioni (id): "sez-builder" (simulatore con due modalità per intermedio/esperto: "Nuovo trade" — ticker, perdita massima, valuta — e "Ho già una posizione" — l'utente inserisce prezzo di stop loss e prezzo obiettivo, qualunque sia il suo metodo, e Sigma calcola la probabilità che il mercato da dove si trova ora raggiunga l'obiettivo prima dello stop), "sez-idea" (l'idea chiave: le probabilità si riaggiornano a ogni evento), "sez-come" (il metodo in 4 passi), "sez-storico" (CONTO DEMO: dopo ogni analisi c'è il pulsante "Apri in DEMO" che porta il trade appena analizzato dentro un conto demo — nessun soldo vero, i prezzi demo evolvono col passare delle ore, l'utente può tornare a controllare i suoi trade e chiuderli; incoraggia SEMPRE questo percorso quando qualcuno esita o dice che non si fida: prima demo, poi eventualmente reale. Ogni trade demo aperto mostra anche il GUADAGNO ATTESO PER ORIZZONTE TEMPORALE — 7, 30 e 90 giorni — perché il tempo è una variabile del trade quanto il prezzo: lo stesso trade può valere poco in una settimana e molto in tre mesi. Se l'utente chiede dei tempi, spiega che il guadagno atteso cresce con l'attesa perché più simulazioni hanno il tempo di raggiungere l'obiettivo, ma non cresce all'infinito), per i neofiti "sez-guida" (percorso guidato), per gli intermedi "sez-ponte" (dal portafoglio al trade a rischio definito), per gli esperti "sez-tavolo" (cornice poker: le percentuali cambiano e vanno gestite), "sez-motore" (screenshot del vero ΣXIII Portfolio Monitor in produzione: 20.000 sim per struttura, P(free-trade), probabilità condizionate, expectancy per contratto — la demo è una versione semplificata di quello) e "sez-sistemi" (sistemi in arrivo). L'utente può cambiare percorso in qualsiasi momento con il selettore in alto (Principiante / Investitore / Trader).

ANALOGIA per spiegare la rivalutazione continua delle probabilità (concetto centrale di Sigma):
- neofita → la partita di calcio: le probabilità di vittoria cambiano a ogni gol, espulsione, minuto che passa.
- intermedio → il navigatore GPS che ricalcola il percorso quando trova traffico.
- esperto → l'equity nel poker: A♠3♦ preflop vale poco, con due assi al flop diventa un mostro; puoi usare liberamente termini come equity, pot odds, street.
VIETATO usare analogie con poker, carte, scommesse o gioco d'azzardo con neofita e intermedio: per loro il trading NON va mai accostato all'azzardo. Con tutti i profili, se emerge il tema azzardo, il messaggio è: Sigma serve a togliere l'azzardo dalle decisioni, separando la qualità della decisione dall'esito.

REGOLE FERREE:
1. Guidi SOLO sull'uso dello strumento e sui concetti didattici. MAI consigli d'investimento personalizzati, MAI dire quale titolo comprare o se aprire un trade reale. Se te lo chiedono, spiega che Sigma mostra statistiche ma la decisione resta all'utente, e che questa è una demo didattica.
2. Risposte brevi: 2-4 frasi. In italiano.
3. Se l'utente sembra nel profilo sbagliato (es. un neofita che chiede di VRP e skew, o un esperto confuso dalle basi), puoi proporre di cambiare profilo con l'azione cambia_profilo — ma solo dopo averlo suggerito.
4. Rispondi SOLO con JSON valido, senza backtick né altro testo, in questo formato:
oppure azione = {"tipo":"evidenzia","target":"sez-builder|sez-come|sez-storico|sez-guida"} per far lampeggiare una sezione, oppure {"tipo":"cambia_profilo","profilo":"neofita|intermedio|esperto"}.
Usa "evidenzia" quando spieghi dove si trova qualcosa nella pagina.`;
}

function validaEPreparaMessaggi(messagesGrezzi) {
  if (!Array.isArray(messagesGrezzi) || messagesGrezzi.length === 0) return null;
  const troncati = messagesGrezzi.slice(-MAX_COPPIE_STORIA * 2);
  return troncati.map(m => {
    const contenuto = typeof m.content === 'string' ? m.content : '';
    const tagliato = (m.role === 'user') ? contenuto.slice(0, MAX_CARATTERI_MESSAGGIO_UTENTE) : contenuto;
    return { role: m.role === 'assistant' ? 'assistant' : 'user', content: tagliato };
  });
}

// estraiRisposta - stessa logica di parsing del vecchio inviaAgente() nel
// client: il modello risponde con un JSON {messaggio, azione}, qui serve
// solo per loggare una "risposta" leggibile nello Sheet (non per l'utente:
// il client fa il suo stesso parsing sul testo grezzo che gli restituiamo).
function estraiRisposta(testoGrezzo) {
  try {
    const pulito = testoGrezzo.replace(/```json|```/g, '').trim();
    const j = JSON.parse(pulito);
    return j.messaggio || testoGrezzo;
  } catch (e) {
    return testoGrezzo;
  }
}

// registraDomanda - POST asincrono e MAI bloccante verso il webhook del
// registro (Google Apps Script, vedi log-sheet.gs). Se LOG_WEBHOOK manca o
// la richiesta fallisce: silenzio totale, nessun retry, nessun errore
// propagato all'utente - il coach deve continuare a rispondere comunque.
async function registraDomanda(env, dati) {
  if (!env.LOG_WEBHOOK) return;
  try {
    await fetch(env.LOG_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dati)
    });
  } catch (e) {
    // silenzio deliberato
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const allowedOrigin = env.ALLOWED_ORIGIN || ORIGINE_DEFAULT;
    const origin = request.headers.get('Origin') || '';
    const cors = intestazioniCors(origin, allowedOrigin);

    if (request.method === 'OPTIONS') {
      if (!cors) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname !== '/coach' || request.method !== 'POST') {
      return rispostaJson({ errore: 'not found' }, 404, cors || {});
    }

    if (!cors) {
      return rispostaJson({ errore: 'origine non consentita' }, 403);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'sconosciuto';
    if (!verificaRateLimit(ip)) {
      return rispostaJson({ errore: MESSAGGIO_PAUSA }, 429, cors);
    }

    let corpo;
    try {
      corpo = await request.json();
    } catch (e) {
      return rispostaJson({ errore: 'payload non valido' }, 400, cors);
    }

    const messaggi = validaEPreparaMessaggi(corpo.messages);
    if (!messaggi) {
      return rispostaJson({ errore: 'messages mancante o vuoto' }, 400, cors);
    }
    const profilo = ['neofita', 'intermedio', 'esperto'].includes(corpo.profilo) ? corpo.profilo : 'neofita';

    if (!env.ANTHROPIC_API_KEY) {
      return rispostaJson({ errore: 'coach non configurato' }, 500, cors);
    }

    let rispostaAnthropic;
    try {
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': ANTHROPIC_VERSION
        },
        body: JSON.stringify({
          model: MODELLO,
          max_tokens: MAX_TOKEN_RISPOSTA,
          system: sistemPrompt(profilo, corpo.contesto),
          messages: messaggi
        })
      });
      rispostaAnthropic = await upstream.json();
      if (!upstream.ok) {
        return rispostaJson({ errore: 'Non riesco a raggiungere il motore in questo momento. Riprova tra qualche secondo.' }, 502, cors);
      }
    } catch (e) {
      return rispostaJson({ errore: 'Non riesco a raggiungere il motore in questo momento. Riprova tra qualche secondo.' }, 502, cors);
    }

    // Registro domande: asincrono, non blocca la risposta all'utente.
    const testoGrezzo = (rispostaAnthropic.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const ultimoMessaggioUtente = [...messaggi].reverse().find(m => m.role === 'user');
    ctx.waitUntil((async () => {
      const oggi = new Date().toISOString().slice(0, 10);
      registraDomanda(env, {
        data: new Date().toISOString(),
        profilo: profilo,
        livello: profilo === 'neofita' ? (corpo.contesto && corpo.contesto.livelloSbloccato ? 2 : 1) : null,
        domanda: ultimoMessaggioUtente ? ultimoMessaggioUtente.content : '',
        risposta: estraiRisposta(testoGrezzo),
        sessioneHash: await hashSessione(ip, oggi)
      });
    })());

    return rispostaJson(rispostaAnthropic, 200, cors);
  }
};
