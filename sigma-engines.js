/*
 * sigma-engines.js — Motore 1 (valutazione pre-apertura)
 * ============================================================================
 * Estratto da sigma_trade_coach_demo.html (vecchia UI Sigma), funzioni
 * computeTradeAnalysis() + simulateHorizon() + utility di supporto.
 * Nessun riferimento al DOM: solo funzioni pure (input -> output).
 *
 * COSA E' STATO ESTRATTO COSI' COM'ERA (nessuna modifica alla matematica):
 *  - mulberry32 / hashSeed / randNormal: PRNG deterministico e generatore
 *    di rumore gaussiano, identici all'originale.
 *  - computeJumpStats: stima di frequenza/ampiezza degli shock storici.
 *  - Il cuore di simulateHorizon: drift, varianza diffusiva vs varianza da
 *    salti, trailing stop, condizioni di uscita (hitTP/hitSL) - stessa
 *    logica, stesso ordine delle chiamate a rng(), stesso seed per scenario.
 *  - computeTradeAnalysis: sizing (azioni = round(perditaMax / rischioPerAzione)),
 *    long-only, trailing stop silenzioso al 10%, nessun take-profit (hasTP
 *    sempre false) - il vecchio motore pre-apertura non ha mai un target di
 *    prezzo esplicito, solo uno stop che segue il prezzo verso l'alto.
 *
 * COSA E' STATO OMESSO IN FASE DI PULIZIA:
 *  - barrierHit(): definita ma mai chiamata nel vecchio file (codice morto).
 *  - resolveUnderlying/getSpotAndHV/getJumpStats/fetchDailyCloses: erano
 *    wrapper async che simulavano future chiamate di rete leggendo
 *    DEMO_DATA. In modalita 'demo' l'accesso ai dati e' diretto e sincrono;
 *    la predisposizione per la modalita 'reale' e' nel punto d'ingresso
 *    valutaTrade(), non in questi wrapper.
 *  - Tutto cio' che riguarda Motore 2 (monitoraggio: closeOperation,
 *    verificaEsito, walkRealPath, refreshRealMonitor, archivio) e la UI
 *    (localStorage, rendering, event listener): fuori scopo per questa
 *    sessione, non toccato.
 *
 * COSA E' STATO AGGIUNTO EX-NOVO (il vecchio motore non lo calcolava affatto)
 * - scelte confermate dall'utente in sessione:
 *  - vrp: volatilita' implicita meno volatilita' storica del titolo
 *    (vrp = ivUnderlying - hv), entrambe gia' presenti nel dataset congelato.
 *  - sharpe: EV atteso diviso la deviazione standard dei payoff Monte Carlo
 *    sull'orizzonte scelto (sharpe = ev / devStd). Per calcolarlo si accumula
 *    anche la somma dei quadrati dei payoff durante il loop Monte Carlo
 *    gia' esistente: non cambia un solo numero casuale generato ne' le
 *    decisioni di barriera, aggiunge solo un'osservazione in piu' sullo
 *    stesso ciclo.
 *  - probabilita: probabilita' diretta che il P&L finale della simulazione
 *    sia > 0 ("vite finite in profitto" nel replay del principiante),
 *    contata con un contatore osservativo (countProfit) nello stesso loop
 *    Monte Carlo - stesso approccio non invasivo usato per la deviazione
 *    standard, nessun numero casuale toccato.
 *  - p5 / p95: 5 e 95 percentile della distribuzione dei payoff, espressi
 *    come percentuale del capitale a rischio impostato dall'utente
 *    (P&L / perditaMax, con segno - es. -0.42 = -42% della perdita massima
 *    che l'utente ha detto di poter sopportare). Richiede di conservare
 *    l'intero vettore di payoff simulati (10.000 numeri) invece delle sole
 *    aggregazioni originarie; la conversione in percentuale avviene in
 *    valutaTrade(), simulateHorizon() continua a restituire i percentili
 *    in valuta assoluta (riutilizzabile anche per altri usi futuri).
 *  - percorsiCampione: per ~100 delle 10.000 simulazioni si registra anche
 *    la traiettoria di prezzo giorno per giorno (stesso ciclo, nessuna
 *    chiamata rng() aggiuntiva). L'esito di ogni percorso campionato e'
 *    binario: 'target' se il payoff finale e' >= 0 (in guadagno), 'stop' se
 *    e' negativo (in perdita) - il vecchio motore non ha un vero target di
 *    prezzo, quindi non si inventa una soglia posticcia.
 *  - evAtteso: valore atteso assoluto diviso il rischio massimo impostato
 *    dall'utente, per esprimerlo come rapporto (es. 0.42) anziche' in valuta.
 *
 * CORREZIONE CONCETTUALE RICHIESTA DALL'UTENTE (unica modifica alla
 * matematica esistente, tutto il resto sopra resta invariato):
 *  - Il drift originale (-(dividendYield) - 0.5*sigma^2) assume rendimento
 *    atteso zero: sotto quell'ipotesi, un trailing stop piu' il dividend
 *    drag rendono l'EV strutturalmente negativa per QUALSIASI titolo long,
 *    a prescindere dal suo andamento storico - il motore diceva sempre
 *    "non aprire", il che lo rendeva inutilizzabile come demo didattica.
 *  - stimaDrift(closes): rendimento logaritmico medio giornaliero della
 *    serie storica, annualizzato (x365, coerente col dt=1/365 usato
 *    altrove), poi ridotto del 50% verso zero (shrinkage conservativo) e
 *    limitato a +/-40% annuo (cap), per non estrapolare trend estremi.
 *  - drift = mu - (dividendYield||0) - 0.5*sigma^2, con mu = stimaDrift(...)
 *    passato come parametro a simulateHorizon(). mu entra anche nella
 *    seedStr (determinismo): stesso approccio gia' usato per tutti gli
 *    altri parametri di scenario.
 *  - Nota di metodo: il drift storico con shrinkage e' un'assunzione di
 *    scenario dichiarata (quanto ha reso il titolo nell'ultimo anno,
 *    smorzato), non una previsione. La demo insegna che l'EV dipende dal
 *    contesto del titolo, non che il futuro e' noto - per questo lo
 *    shrinkage e il cap, e per questo driftAnnuo viene esposto in chiaro
 *    nel risultato invece di restare nascosto dentro il calcolo.
 *
 * MOTORE 2 — valutaTradeAperto() (monitoraggio trade aperto, "tengo o chiudo?")
 *  - Riusa integralmente simulateHorizon(): nessun secondo loop Monte Carlo.
 *    L'unica estensione e' un campo opzionale trailing.peakIniziale, che se
 *    presente inizializza runningExtreme al posto di S0 - serve a ereditare
 *    lo stato del trailing stop di una posizione gia' aperta (il prezzo puo'
 *    essere sceso da un massimo raggiunto prima di oggi). Quando
 *    peakIniziale non e' impostato (Motore 1) il comportamento e' identico
 *    a prima, byte per byte, seed compreso: trailing.peakIniziale entra
 *    nella seedStr solo se presente, quindi le chiamate del Motore 1 non
 *    cambiano affatto.
 *  - S0 della simulazione e' il prezzo CORRENTE (non l'ingresso): l'EV
 *    residua e' sempre "da oggi in poi", mai retroattiva sull'ingresso.
 *  - chiudiOra e' puro calcolo (nessuna simulazione): (corrente-ingresso)*azioni.
 *  - evResidua/probMeglioDiOra riusano esattamente gli stessi accumulatori
 *    del Motore 1 (ev, probProfit) - stesso significato, diversa domanda:
 *    "cosa succede da qui in avanti", non "conviene aprire".
 *  - p5Eur/p95Eur = percentili del payoff futuro (valuta assoluta, come
 *    simulateHorizon li produce gia') traslati di chiudiOra: spostare una
 *    distribuzione di una costante sposta i suoi percentili della stessa
 *    costante, quindi e' la stessa matematica del Motore 1, solo espressa
 *    come "P&L totale tenendo" invece che come frazione del rischio.
 *
 * RICONCILIAZIONE con il vecchio Motore 2 (walkRealPath in
 * sigma_trade_coach_demo.html) - statoPosizione():
 *  - statoPosizione() e' l'equivalente puro di walkRealPath(): cammina sui
 *    close REALI (non simulati) tra il giorno di apertura e il giorno di
 *    oggi, usando indici sulla serie storica congelata invece che date di
 *    calendario (il vecchio file confrontava bar.t con Date.now(), il che
 *    in demo con dataset congelato non funziona mai per posizioni aperte
 *    "oggi" - da qui la scelta di indici, esplicitamente richiesta).
 *  - Stessa formula di trailing, stesso ordine di aggiornamento (prima si
 *    aggiornano massimo/stop col nuovo prezzo, poi si verifica la rottura
 *    con quello stesso prezzo): confermato identico a walkRealPath.
 *  - Unica differenza reale trovata: quando hitTP e hitSL sono veri nello
 *    stesso istante, walkRealPath sceglie sempre TP; simulateHorizon fa un
 *    lancio di moneta (rng()<0.5). Non e' stata scelta in silenzio: e'
 *    segnalata qui perche' richiesto, ma resta dormiente in entrambi i
 *    motori dato che hasTP e' sempre false ovunque nel motore nuovo.
 *  - valutaTradeAperto() non chiede piu' prezzoCorrente/massimoRaggiunto:
 *    li ottiene chiamando statoPosizione(). Se chiusaAnticipata e' true,
 *    non simula nulla: il trade e' gia' finito, si restituisce solo il
 *    P&L realizzato.
 *
 * TITOLI DI ALLENAMENTO SINTETICI (Livello 1, percorso neofita) - AGGIUNTA:
 *  - generaSerieSintetica(): genera una serie di close FITTIZIA via GBM,
 *    stesso PRNG deterministico (mulberry32/hashSeed/randNormal) gia'
 *    usato ovunque nel file - stesso seed = stessa serie, sempre.
 *  - CALMO/MEDIO/VIOLENTO: tre titoli aggiunti a DEMO_DATA, generati con
 *    quella funzione, con flag sintetico:true e personalita descrittiva.
 *    I tre ticker reali (AAPL/MSFT/TSLA) restano byte per byte invariati.
 *  - valutaTrade/statoPosizione/valutaTradeAperto/simulateHorizon non sono
 *    stati toccati: leggono CALMO/MEDIO/VIOLENTO come un ticker qualsiasi,
 *    senza sapere che sono generati e non reali.
 *  - RINOMINA (addendum utente): i tre titoli si chiamavano inizialmente
 *    ALBA/FARO/VULCANO. Rinominati in CALMO/MEDIO/VIOLENTO; le stringhe
 *    "seed" interne (es. 'ALBA-v14-d0.14') sono rimaste LETTERALMENTE
 *    invariate apposta - sono solo etichette interne di generazione, non
 *    testo visibile, e cambiarle avrebbe alterato l'hash e quindi la serie
 *    e tutti i numeri gia' verificati e approvati in precedenza.
 *
 * CURATELA DICHIARATA DI SEED/PARAMETRI PER I SOLI TITOLI SINTETICI
 * (decisione esplicita dell'utente, non presa in autonomia):
 *  - Per ticker REALI e per la logica dei motori il vincolo "mai forzare i
 *    numeri" resta assoluto. Per i titoli di allenamento FITTIZI (dichiarati
 *    come tali all'utente nel banner demo) la curatela di seed e parametri
 *    e' esplicitamente autorizzata, perche' sono materiale didattico e non
 *    un'affermazione su un titolo reale: qui si sceglie quale ANNO SIMULATO
 *    mostrare, non si truccano i calcoli che lo valutano.
 *  - CALMO (il "si'", ex ALBA): con driftAnnuo di generazione 0.05 il primo
 *    seed provato produceva - per puro rumore campionario su 250gg, lo
 *    stesso fenomeno spiegato sotto per VIOLENTO - un driftAnnuo STIMATO
 *    negativo e un EV atteso leggermente negativo: sbagliato per il titolo
 *    pensato come il piu' accogliente per il neofita. Rialzato driftAnnuo di
 *    generazione a 0.14 e scelto il seed 'ALBA-v14-d0.14' tra piu' prove:
 *    risultato driftAnnuo stimato +8.6%, evAtteso +0.167, probabilita 52%.
 *  - MEDIO (ex FARO): nessuna modifica, il primo seed ('FARO-v1') dava gia'
 *    un EV chiaramente positiva (driftAnnuo stimato +27.7%, evAtteso +0.685).
 *  - VIOLENTO (il "no", ex VULCANO): con l'impostazione iniziale (driftAnnuo
 *    generazione 0.0, seed 'VULCANO-v1') l'EV atteso usciva positiva
 *    (+0.212) nonostante un driftAnnuo stimato negativo (-11%) e probabilita
 *    di profitto sotto il 50% (38%). Verificato con un breakdown per bucket
 *    di uscita (vedi conversazione: 82% dei percorsi esce dal trailing stop
 *    dopo essere prima saliti, con payoff MEDIO positivo; solo 17% tocca lo
 *    stop originale in perdita secca) che NON e' un bug: e' l'effetto
 *    strutturale, identico per qualsiasi ticker reale, di "stop che segue il
 *    prezzo verso l'alto, nessun take-profit, alta volativa' -> molte uscite
 *    in trailing sono in realta' guadagni realizzati". Confermato anche
 *    disattivando i salti sullo stesso scenario (EV scende da +211$ a +135$
 *    ma resta positiva): i salti amplificano l'effetto ma non lo causano.
 *    Trattandosi di coda genuina e non di un errore di calcolo, non e' stato
 *    toccato simulateHorizon ne' alcun motore - si e' curato solo il seed:
 *    con driftAnnuo di generazione -0.10 e seed 'VULCANO-v16-d-0.1' il
 *    risultato e' driftAnnuo stimato -20.5%, evAtteso -0.079, probabilita
 *    42.6%: il titolo nervoso che il motore respinge, come richiesto.
 * ============================================================================
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SigmaEngines = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MC_PATHS = 10000;
  var SILENT_TRAILING_PCT = 0.10;
  var HORIZONS = [7, 14, 30, 60, 90, 120];
  var GAIN_THRESHOLD_FRACTIONS = [0.05, 0.10, 0.20, 0.30];
  var SAMPLE_PATHS_PER_HORIZON = 100;

  var DEMO_DATA = {
    AAPL: { price: 312.0, ivUnderlying: 0.2743998999587616, hv: 0.283266305818606, dividendYield: 0.34 / 100,
      close: [212.41,211.16,208.62,209.11,210.16,210.02,211.18,212.48,214.4,214.15,213.76,213.88,214.05,211.27,209.05,207.57,202.38,203.35,202.92,213.25,220.03,229.35,227.18,229.65,233.33,232.78,231.59,230.89,230.56,226.01,224.9,227.76,227.16,229.31,230.49,232.56,232.14,229.72,238.47,239.78,239.69,237.88,234.35,226.79,230.03,234.07,236.7,238.15,238.99,237.88,245.5,256.08,254.43,252.31,256.87,255.46,254.43,254.63,255.45,257.13,258.02,256.69,256.48,258.06,254.04,245.27,247.66,247.77,249.34,247.45,252.29,262.24,262.77,258.45,259.58,262.82,268.81,269,269.7,271.4,270.37,269.05,270.04,270.14,269.77,268.47,269.43,275.25,273.47,272.95,272.41,267.46,267.44,268.56,266.25,271.49,275.92,276.97,277.55,278.85,283.1,286.19,284.15,280.7,278.78,277.89,277.18,278.78,278.03,278.28,274.11,274.61,271.84,272.19,273.67,270.97,272.36,273.81,273.4,273.76,273.08,271.86,271.01,267.26,262.36,260.33,259.04,259.37,260.25,261.05,259.96,258.21,255.53,246.7,247.65,248.35,248.04,255.41,258.27,256.44,258.28,259.48,270.01,269.48,276.49,275.91,278.12,274.62,273.68,275.5,261.73,255.78,263.88,264.35,260.58,264.58,266.18,272.14,274.23,272.95,264.18,264.72,263.75,262.52,260.29,257.46,259.88,260.83,260.81,255.76,250.12,252.82,254.23,249.94,248.96,247.99,251.49,251.64,252.62,252.89,248.8,246.63,253.79,255.63,255.92,258.86,253.5,258.9,260.49,260.48,259.2,258.83,266.43,263.4,270.23,273.05,266.17,273.17,273.43,271.06,267.61,270.71,270.17,271.35,280.14,276.83,284.18,287.51,287.44,293.32,292.68,294.8,298.87,298.21,300.23,297.84,298.97,302.25,304.99,308.82,308.33,310.85,312.51,312.06,306.31,315.2,310.26,311.23,307.34,301.54,290.55,291.58,295.63,291.13,296.42,299.24,295.95,298.01,297.01,294.3,293.08,275.15,283.78,281.74,289.36,294.38,308.63,312.66,310.66,313.39,312] },
    MSFT: { price: 376.77, ivUnderlying: 0.43023516338243667, hv: 0.35717166464135985, dividendYield: 0.93 / 100,
      close: [501.48,503.32,503.02,505.82,505.62,511.7,510.05,510.06,505.27,505.87,510.88,513.71,512.5,512.57,513.24,533.5,524.11,535.64,527.75,524.94,520.84,522.04,521.77,529.24,520.58,522.48,520.17,517.1,509.77,505.72,504.24,507.23,504.26,502.04,506.74,509.64,506.69,505.12,505.35,507.97,495,498.2,498.41,500.37,501.01,509.9,515.36,509.04,510.02,508.45,517.93,514.45,509.23,510.15,507.03,511.46,514.6,517.95,519.71,515.74,517.35,528.57,523.98,524.85,522.4,510.96,514.05,513.57,513.43,511.61,513.58,516.79,517.66,520.54,520.56,523.61,531.52,542.07,541.55,525.76,517.81,517.03,514.33,507.16,497.1,496.82,506,508.68,511.14,503.29,510.18,507.49,493.79,487.12,478.43,472.12,474,476.99,485.5,492.01,486.74,490,477.73,480.84,483.16,491.02,492.02,478.56,483.47,478.53,474.82,476.39,476.12,483.98,485.92,484.92,486.85,488.02,487.71,487.1,487.48,483.62,472.94,472.85,478.51,483.47,478.11,479.28,477.18,470.67,459.38,456.66,459.86,454.52,444.11,451.14,465.95,470.28,480.58,481.63,433.5,430.29,423.37,411.21,414.19,393.67,401.14,413.6,413.27,404.37,401.84,401.32,396.86,399.6,398.46,397.23,384.47,389,400.6,401.72,392.74,398.55,403.93,405.2,410.68,408.96,409.41,405.76,404.88,401.86,395.55,399.95,399.41,391.79,389.02,381.87,383,372.74,371.04,365.97,356.77,358.96,370.17,369.37,373.46,372.88,372.29,374.33,373.07,370.87,384.37,393.11,411.22,420.26,422.79,418.07,424.16,432.92,415.75,424.62,424.82,429.25,424.46,407.78,414.44,413.62,411.38,413.96,420.77,415.12,412.66,407.77,405.21,409.43,421.92,423.54,417.42,421.06,419.09,418.57,416.03,412.67,426.99,450.24,460.52,441.31,427.34,428.05,416.67,411.74,403.41,397.36,390.34,390.74,399.76,393.83,378.91,379.4,367.34,373.94,365.46,352.83,372.97,368.57,373.02,384.28,390.49,386.74,388.84,383.34,377.14] },
    TSLA: { price: 393.49, ivUnderlying: 0.4817337252305899, hv: 0.4843296475526973, dividendYield: 0.0 / 100,
      close: [309.87,313.51,316.9,310.78,321.67,319.41,329.65,328.49,332.11,332.56,305.3,316.06,325.59,321.2,319.04,308.27,302.63,309.26,308.72,319.91,322.27,329.65,339.03,340.84,339.38,335.58,330.56,335.16,329.31,323.9,320.11,340.01,346.6,351.67,349.6,345.98,333.87,329.36,334.09,338.53,350.84,346.4,346.97,347.79,368.81,395.94,410.04,421.62,425.86,416.85,426.07,434.21,425.85,442.79,423.39,440.4,443.21,444.72,459.46,436,429.83,453.25,433.09,438.69,435.54,413.49,435.9,429.24,435.15,428.75,439.31,447.43,442.6,438.97,448.98,433.72,452.42,460.55,461.51,440.1,456.56,468.37,444.26,462.07,445.91,429.52,445.23,439.62,430.6,401.99,404.35,408.92,401.25,403.99,395.23,391.09,417.78,419.4,426.58,430.17,430.14,429.24,446.74,454.53,455,439.58,445.17,451.45,446.89,458.96,475.31,489.88,467.26,483.37,481.2,488.73,485.56,485.4,475.19,459.64,454.43,449.72,438.07,451.67,432.96,431.41,435.8,445.01,448.96,447.2,439.2,438.57,437.5,419.25,431.44,449.36,449.06,435.2,430.9,431.46,416.56,430.41,421.81,421.96,406.01,397.21,411.11,417.32,425.21,428.27,417.07,417.44,410.63,411.32,411.71,411.82,399.83,409.38,417.4,408.58,402.51,403.32,392.43,405.94,405.55,396.73,398.68,399.24,407.82,395.01,391.2,395.56,399.27,392.78,380.3,367.96,380.85,383.03,385.95,372.11,361.83,355.28,371.75,381.26,360.59,352.82,346.65,343.25,345.62,348.95,352.42,364.2,391.95,388.9,400.62,392.5,386.42,387.51,373.72,376.3,378.67,376.02,372.8,381.63,390.82,392.51,389.37,398.73,411.79,428.35,445,433.45,445.27,443.3,422.24,409.99,404.11,417.26,417.85,426.01,433.59,440.36,442.1,435.79,415.88,423.74,423.7,418.45,391,408.95,396.68,381.59,399.15,406.43,411.15,404.66,396.38,400.49,405.05,381.61,375.53,375.12,379.71,411.84,420.6,425.3,393.45,419.77,402.9,394.06,393.7] }
  };

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashSeed(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function randNormal(rng) {
    var u1 = 0;
    while (u1 === 0) u1 = rng();
    var u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  function computeJumpStats(closes) {
    var rets = [];
    for (var i = 1; i < closes.length; i++) {
      if (closes[i] > 0 && closes[i - 1] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
    }
    if (rets.length < 30) return { jumpProb: 0, jumpPool: [] };
    var mean = rets.reduce(function (a, b) { return a + b; }, 0) / rets.length;
    var variance = rets.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / rets.length;
    var std = Math.sqrt(variance);
    var jumpPool = rets.filter(function (r) { return Math.abs(r - mean) > 3 * std; });
    return { jumpProb: jumpPool.length / rets.length, jumpPool: jumpPool };
  }

  // Stima il rendimento atteso annuo dalla serie storica: rendimento
  // logaritmico medio giornaliero, annualizzato (x365, coerente col dt
  // usato in simulateHorizon), poi smorzato del 50% verso zero e limitato
  // a +/-40% annuo. E' un'assunzione di scenario dichiarata (cosa ha reso
  // il titolo di recente, attenuato), non una previsione di cosa fara'.
  function stimaDrift(closes) {
    var rets = [];
    for (var i = 1; i < closes.length; i++) {
      if (closes[i] > 0 && closes[i - 1] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
    }
    if (rets.length === 0) return 0;
    var meanDaily = rets.reduce(function (a, b) { return a + b; }, 0) / rets.length;
    var muStorico = meanDaily * 365;
    var muUsato = 0.5 * muStorico;
    muUsato = Math.max(-0.40, Math.min(0.40, muUsato));
    return muUsato;
  }

  // Volatilita' storica annualizzata di una serie di close (stessa
  // convenzione di stimaDrift/computeJumpStats: rendimento log-differenziale
  // giornaliero, deviazione standard campionaria, annualizzata su 365gg).
  // Usata SOLO per popolare i campi hv/ivUnderlying dei titoli sintetici in
  // DEMO_DATA: non e' chiamata da nessun motore esistente (valutaTrade,
  // statoPosizione, valutaTradeAperto, simulateHorizon non la usano).
  function computeHV(closes) {
    var rets = [];
    for (var i = 1; i < closes.length; i++) {
      if (closes[i] > 0 && closes[i - 1] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
    }
    if (rets.length === 0) return 0;
    var mean = rets.reduce(function (a, b) { return a + b; }, 0) / rets.length;
    var variance = rets.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / rets.length;
    return Math.sqrt(variance * 365);
  }

  // generaSerieSintetica - genera una serie di prezzi di chiusura FITTIZIA
  // (nessun titolo reale) via GBM con lo stesso PRNG deterministico gia'
  // usato altrove (mulberry32/hashSeed/randNormal): a parita' di "seed"
  // produce sempre la stessa identica serie. Non tocca ne' riusa lo stato di
  // nessun motore esistente - e' una funzione a se stante, pensata solo per
  // costruire dataset di allenamento fittizi in DEMO_DATA.
  //
  // @param {Object} input
  // @param {string|number} input.seed - stesso seed = stessa serie.
  // @param {number} input.giorni - lunghezza della serie (>=1).
  // @param {number} input.prezzoIniziale - primo valore della serie.
  // @param {number} input.volAnnua - volatilita' annualizzata (es. 0.15 = 15%).
  // @param {number} [input.driftAnnuo=0] - rendimento atteso annualizzato
  //   (stessa convenzione di mu/stimaDrift: drift giornaliero = driftAnnuo -
  //   0.5*volAnnua^2, cosi' che E[prezzo] non sia distorto da Jensen).
  // @param {{probabilitaGiornaliera:number, deviazioneLog:number}} [input.salti]
  //   - opzionale: probabilita' per giorno di uno shock aggiuntivo e sua
  //   deviazione standard in log-rendimento. Omesso o null = nessun salto.
  //
  // @returns {number[]} array di "giorni" prezzi di chiusura, il primo dei
  //   quali e' esattamente prezzoIniziale.
  function generaSerieSintetica(input) {
    input = input || {};
    var seed = input.seed;
    var giorni = input.giorni;
    var prezzoIniziale = input.prezzoIniziale;
    var volAnnua = input.volAnnua;
    var driftAnnuo = input.driftAnnuo || 0;
    var salti = input.salti;

    if (seed === undefined || seed === null || seed === '') {
      throw new Error('generaSerieSintetica: "seed" obbligatorio (stesso seed = stessa serie).');
    }
    if (!(Number.isInteger(giorni) && giorni > 0)) {
      throw new Error('generaSerieSintetica: "giorni" deve essere un intero positivo.');
    }
    if (!(prezzoIniziale > 0)) {
      throw new Error('generaSerieSintetica: "prezzoIniziale" deve essere un numero positivo.');
    }
    if (!(volAnnua > 0)) {
      throw new Error('generaSerieSintetica: "volAnnua" deve essere un numero positivo.');
    }

    var dt = 1 / 365;
    var drift = driftAnnuo - 0.5 * volAnnua * volAnnua;
    var jumpProb = (salti && salti.probabilitaGiornaliera) || 0;
    var jumpSigma = (salti && salti.deviazioneLog) || 0;

    var seedStr = ['sintetico', seed, giorni, prezzoIniziale, volAnnua, driftAnnuo, jumpProb, jumpSigma].join('|');
    var rng = mulberry32(hashSeed(seedStr));

    var closes = [prezzoIniziale];
    var price = prezzoIniziale;
    for (var i = 1; i < giorni; i++) {
      price *= Math.exp(drift * dt + volAnnua * Math.sqrt(dt) * randNormal(rng));
      if (jumpProb > 0 && rng() < jumpProb) {
        price *= Math.exp(jumpSigma * randNormal(rng));
      }
      closes.push(price);
    }
    return closes;
  }

  function percentile(sortedAsc, p) {
    if (sortedAsc.length === 0) return 0;
    var idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(p * (sortedAsc.length - 1))));
    return sortedAsc[idx];
  }

  function simulateHorizon(S0, sl, tp, hasTP, long, sigma, mu, days, gainAmount, dividendYield, jumpStats, shares, trailing, gainThresholds, sampleSize) {
    var dt = 1 / 365;
    var drift = (mu || 0) - (dividendYield || 0) - 0.5 * sigma * sigma;

    var totalVarDaily = (sigma * sigma) * dt;
    var jumpProb = jumpStats && jumpStats.jumpProb ? jumpStats.jumpProb : 0;
    var jumpPool = jumpStats && jumpStats.jumpPool ? jumpStats.jumpPool : [];
    var jumpVarDaily = (jumpProb > 0 && jumpPool.length > 0)
      ? jumpProb * (jumpPool.reduce(function (a, b) { return a + b * b; }, 0) / jumpPool.length)
      : 0;
    var diffusiveVarDaily = Math.max(totalVarDaily - jumpVarDaily, totalVarDaily * 0.15);
    var diffusiveStd = Math.sqrt(diffusiveVarDaily);
    var hasJumps = jumpProb > 0 && jumpPool.length > 0;

    var trailingOn = !!(trailing && trailing.enabled && trailing.pct > 0);

    var seedParts = [
      S0.toFixed(4), sl.toFixed(4), hasTP ? tp.toFixed(4) : '-', long, sigma.toFixed(6), (mu || 0).toFixed(6), days,
      hasTP ? gainAmount.toFixed(2) : '-', (dividendYield || 0).toFixed(6), jumpProb.toFixed(6),
      jumpPool.length, shares, trailingOn, trailingOn ? trailing.pct.toFixed(6) : '-'
    ];
    if (trailing && trailing.peakIniziale != null) seedParts.push(trailing.peakIniziale.toFixed(4));
    var seedStr = seedParts.join('|');
    var rng = mulberry32(hashSeed(seedStr));

    var countTP = 0, countSLOriginal = 0, countTrailExit = 0, sumPayoff = 0, sumSqPayoff = 0, countProfit = 0;
    var gainCounts = gainThresholds ? gainThresholds.map(function () { return 0; }) : null;
    var payoffs = [];
    var sample = [];
    var nSample = sampleSize || 0;

    for (var i = 0; i < MC_PATHS; i++) {
      var recordPath = i < nSample;
      var price = S0;
      var outcome = 'NONE';
      var exitPrice = null;
      var runningExtreme = (trailing && trailing.peakIniziale != null) ? trailing.peakIniziale : S0;
      var effectiveSL = sl;
      var trailed = false;
      var pathPrices = recordPath ? [S0] : null;

      for (var d = 0; d < days; d++) {
        price *= Math.exp(drift * dt + diffusiveStd * randNormal(rng));
        if (hasJumps && rng() < jumpProb) {
          price *= Math.exp(jumpPool[Math.floor(rng() * jumpPool.length)]);
        }

        if (trailingOn) {
          if (long) {
            runningExtreme = Math.max(runningExtreme, price);
            effectiveSL = Math.max(effectiveSL, runningExtreme * (1 - trailing.pct));
          } else {
            runningExtreme = Math.min(runningExtreme, price);
            effectiveSL = Math.min(effectiveSL, runningExtreme * (1 + trailing.pct));
          }
          if ((long && effectiveSL > sl) || (!long && effectiveSL < sl)) trailed = true;
        }

        if (recordPath) pathPrices.push(price);

        var hitTP = hasTP && (long ? price >= tp : price <= tp);
        var hitSL = long ? price <= effectiveSL : price >= effectiveSL;

        if (hitTP && hitSL) {
          outcome = rng() < 0.5 ? 'TP' : 'SL';
          exitPrice = outcome === 'TP' ? tp : effectiveSL;
          break;
        } else if (hitTP) {
          outcome = 'TP'; exitPrice = tp; break;
        } else if (hitSL) {
          outcome = 'SL'; exitPrice = effectiveSL; break;
        }
      }

      var payoff;
      if (outcome === 'TP') {
        countTP++; payoff = gainAmount; sumPayoff += payoff;
      } else if (outcome === 'SL') {
        if (trailed) countTrailExit++; else countSLOriginal++;
        payoff = long ? (exitPrice - S0) * shares : (S0 - exitPrice) * shares;
        sumPayoff += payoff;
      } else {
        payoff = long ? (price - S0) * shares : (S0 - price) * shares;
        sumPayoff += payoff;
      }
      sumSqPayoff += payoff * payoff;
      payoffs.push(payoff);
      if (payoff > 0) countProfit++;

      if (recordPath) {
        if (exitPrice != null && pathPrices.length > 0) pathPrices[pathPrices.length - 1] = exitPrice;
        sample.push({ prezzi: pathPrices, payoff: payoff });
      }

      if (gainCounts) {
        for (var k = 0; k < gainThresholds.length; k++) {
          if (payoff >= gainThresholds[k]) gainCounts[k]++;
        }
      }
    }

    var countSL = countSLOriginal + countTrailExit;
    var mean = sumPayoff / MC_PATHS;
    var variance = Math.max(0, sumSqPayoff / MC_PATHS - mean * mean);
    var std = Math.sqrt(variance);
    var sortedPayoffs = payoffs.slice().sort(function (a, b) { return a - b; });

    return {
      pTP: countTP / MC_PATHS,
      pSL: countSL / MC_PATHS,
      pSLOriginal: countSLOriginal / MC_PATHS,
      pTrailExit: countTrailExit / MC_PATHS,
      pNone: (MC_PATHS - countTP - countSL) / MC_PATHS,
      ev: sumPayoff / MC_PATHS,
      std: std,
      probProfit: countProfit / MC_PATHS,
      p5: percentile(sortedPayoffs, 0.05),
      p95: percentile(sortedPayoffs, 0.95),
      gainProbs: gainCounts ? gainCounts.map(function (c) { return c / MC_PATHS; }) : null,
      sample: sample
    };
  }

  function bestRowIndex(rows) {
    var bestIdx = 0;
    for (var i = 1; i < rows.length; i++) {
      if (rows[i].ev > rows[bestIdx].ev) bestIdx = i;
    }
    return bestIdx;
  }

  function valutaTrade(input) {
    input = input || {};
    var ticker = input.ticker;
    var perditaMax = input.perditaMax;
    var modalita = input.modalita;

    if (modalita === 'reale') {
      throw new Error('Modalita "reale" non ancora collegata.');
    }
    if (modalita !== 'demo') {
      throw new Error('Parametro "modalita" non valido: usare "demo" o "reale".');
    }

    var key = (ticker || '').trim().toUpperCase();
    var d = DEMO_DATA[key];
    if (!d) {
      throw new Error('Ticker "' + ticker + '" non incluso nel dataset demo. Disponibili: AAPL, MSFT, TSLA.');
    }
    if (!(perditaMax > 0)) {
      throw new Error('perditaMax deve essere un numero positivo.');
    }

    var S0 = d.price;
    var sigma = d.ivUnderlying || d.hv || 0.3;
    var long = true;
    var hasTP = false;
    var tp = null;
    var riskPerShare = S0 * SILENT_TRAILING_PCT;
    var sl = S0 * (1 - SILENT_TRAILING_PCT);
    var azioni = Math.max(1, Math.round(perditaMax / riskPerShare));
    var actualRisk = azioni * riskPerShare;
    var trailing = { enabled: true, pct: SILENT_TRAILING_PCT };
    var jumpStats = computeJumpStats(d.close);
    var mu = stimaDrift(d.close);
    var gainThresholds = GAIN_THRESHOLD_FRACTIONS.map(function (f) { return actualRisk * f; });

    var rows = HORIZONS.map(function (days) {
      var r = simulateHorizon(
        S0, sl, tp, hasTP, long, sigma, mu, days,
        null, d.dividendYield, jumpStats, azioni, trailing,
        gainThresholds, SAMPLE_PATHS_PER_HORIZON
      );
      r.days = days;
      return r;
    });

    var bestIdx = bestRowIndex(rows);
    var best = rows[bestIdx];

    var probabilita = best.probProfit;
    var evAtteso = actualRisk > 0 ? best.ev / actualRisk : 0;
    var vrp = (d.ivUnderlying || 0) - (d.hv || 0);
    var sharpe = best.std > 0 ? best.ev / best.std : 0;
    var p5 = perditaMax > 0 ? best.p5 / perditaMax : 0;
    var p95 = perditaMax > 0 ? best.p95 / perditaMax : 0;
    var percorsiCampione = best.sample.map(function (s) {
      return { prezzi: s.prezzi, esito: s.payoff >= 0 ? 'target' : 'stop' };
    });

    return { probabilita: probabilita, azioni: azioni, evAtteso: evAtteso, vrp: vrp, sharpe: sharpe, p5: p5, p95: p95, percorsiCampione: percorsiCampione, driftAnnuo: mu };
  }

  /**
   * statoPosizione - ricostruisce lo stato REALE (nessuna simulazione) di
   * una posizione aperta camminando sui close storici congelati tra il
   * giorno di apertura e il giorno "oggi", esattamente come faceva
   * walkRealPath() nel vecchio Motore 2 - solo con indici di giorno invece
   * di date di calendario (in demo il tempo "passa" muovendo l'indice).
   *
   * @param {Object} input
   * @param {string} input.ticker
   * @param {number} input.prezzoIngresso
   * @param {number} input.azioni - non influenza il calcolo (nessun P&L qui),
   *   validato solo per coerenza con il resto della firma del trade.
   * @param {number} input.indiceGiornoApertura - indice (0-based) nella serie
   *   storica del ticker in cui la posizione e' stata aperta.
   * @param {number} input.indiceGiornoOggi - indice di "oggi", >= apertura.
   * @param {'demo'|'reale'} input.modalita
   *
   * @returns {{
   *   prezzoCorrente: number,   // close al giorno "oggi", o prezzo di uscita se chiusaAnticipata
   *   massimoRaggiunto: number, // picco reale toccato tra apertura e oggi (o uscita)
   *   stopEffettivo: number,    // trailing stop cosi' come si trova oggi (o al momento dell'uscita)
   *   giorniTrascorsi: number,  // giorni realmente trascorsi (fino a oggi o fino all'uscita)
   *   chiusaAnticipata: boolean,// true se il prezzo ha gia' toccato lo stop prima di oggi
   *   prezzoUscita: number|null // prezzo di uscita se chiusaAnticipata, altrimenti null
   * }}
   */
  function statoPosizione(input) {
    input = input || {};
    var ticker = input.ticker;
    var prezzoIngresso = input.prezzoIngresso;
    var azioni = input.azioni;
    var indiceGiornoApertura = input.indiceGiornoApertura;
    var indiceGiornoOggi = input.indiceGiornoOggi;
    var modalita = input.modalita;

    if (modalita === 'reale') {
      throw new Error('Modalita "reale" non ancora collegata.');
    }
    if (modalita !== 'demo') {
      throw new Error('Parametro "modalita" non valido: usare "demo" o "reale".');
    }

    var key = (ticker || '').trim().toUpperCase();
    var d = DEMO_DATA[key];
    if (!d) {
      throw new Error('Ticker "' + ticker + '" non incluso nel dataset demo. Disponibili: AAPL, MSFT, TSLA.');
    }
    if (!(prezzoIngresso > 0)) {
      throw new Error('prezzoIngresso deve essere un numero positivo.');
    }
    if (!(azioni > 0)) {
      throw new Error('azioni deve essere un numero positivo.');
    }
    var maxIdx = d.close.length - 1;
    if (!(Number.isInteger(indiceGiornoApertura) && indiceGiornoApertura >= 0 && indiceGiornoApertura <= maxIdx)) {
      throw new Error('indiceGiornoApertura deve essere un indice intero tra 0 e ' + maxIdx + '.');
    }
    if (!(Number.isInteger(indiceGiornoOggi) && indiceGiornoOggi >= indiceGiornoApertura && indiceGiornoOggi <= maxIdx)) {
      throw new Error('indiceGiornoOggi deve essere un indice intero tra indiceGiornoApertura (' + indiceGiornoApertura + ') e ' + maxIdx + '.');
    }

    var long = true;
    var runningExtreme = prezzoIngresso;
    var effectiveSL = prezzoIngresso * (1 - SILENT_TRAILING_PCT);
    var chiusaAnticipata = false;
    var prezzoUscita = null;
    var indiceUscita = null;

    // Stesso ordine di walkRealPath: per ogni nuovo prezzo reale si
    // aggiornano prima massimo/stop, poi si verifica la rottura con quello
    // stesso prezzo.
    for (var idx = indiceGiornoApertura + 1; idx <= indiceGiornoOggi; idx++) {
      var price = d.close[idx];
      if (long) {
        runningExtreme = Math.max(runningExtreme, price);
        effectiveSL = Math.max(effectiveSL, runningExtreme * (1 - SILENT_TRAILING_PCT));
      }
      var hitSL = long ? price <= effectiveSL : price >= effectiveSL;
      if (hitSL) {
        chiusaAnticipata = true;
        prezzoUscita = effectiveSL;
        indiceUscita = idx;
        break;
      }
    }

    var indiceFinale = chiusaAnticipata ? indiceUscita : indiceGiornoOggi;
    var prezzoCorrente = chiusaAnticipata ? prezzoUscita : d.close[indiceGiornoOggi];

    return {
      prezzoCorrente: prezzoCorrente,
      massimoRaggiunto: runningExtreme,
      stopEffettivo: effectiveSL,
      giorniTrascorsi: indiceFinale - indiceGiornoApertura,
      chiusaAnticipata: chiusaAnticipata,
      prezzoUscita: prezzoUscita
    };
  }

  /**
   * valutaTradeAperto - Motore 2, monitoraggio di una posizione gia' aperta.
   * Risponde a "tengo o chiudo?" in valuta. Ricostruisce prima lo stato
   * reale della posizione con statoPosizione() (nessuna simulazione); se lo
   * stop e' gia' stato toccato nella realta' non simula nulla e restituisce
   * il P&L gia' realizzato. Altrimenti riusa simulateHorizon() con
   * S0 = prezzo di oggi e il trailing ereditato dal massimo reale raggiunto.
   *
   * @param {Object} input
   * @param {string} input.ticker - AAPL | MSFT | TSLA (solo in modalita 'demo').
   * @param {number} input.prezzoIngresso - prezzo a cui e' stata aperta la posizione.
   * @param {number} input.azioni - numero di azioni gia' detenute.
   * @param {number} input.indiceGiornoApertura - indice nella serie storica del ticker.
   * @param {number} input.indiceGiornoOggi - indice di "oggi", >= apertura.
   * @param {'demo'|'reale'} input.modalita
   *
   * @returns {{
   *   chiusaAnticipata: boolean,
   *   prezzoUscita: number|null,     // solo se chiusaAnticipata
   *   pnlRealizzato: number|null,    // solo se chiusaAnticipata
   *   chiudiOra: number,             // (prezzoCorrente-prezzoIngresso)*azioni, nessuna simulazione
   *   evResidua: number,             // 0 se chiusaAnticipata, altrimenti media MC del P&L futuro
   *   evTotaleTenendo: number,       // chiudiOra + evResidua
   *   probMeglioDiOra: number|null,  // null se chiusaAnticipata
   *   p5Eur: number|null,
   *   p95Eur: number|null,
   *   orizzonteGiorni: number|null,
   *   driftAnnuo: number|null,
   *   percorsiCampione: Array<{ prezzi: number[], esito: 'target'|'stop' }>
   * }}
   */
  function valutaTradeAperto(input) {
    input = input || {};
    var ticker = input.ticker;
    var prezzoIngresso = input.prezzoIngresso;
    var azioni = input.azioni;
    var modalita = input.modalita;

    var statoPos = statoPosizione(input);

    if (statoPos.chiusaAnticipata) {
      var pnlRealizzato = (statoPos.prezzoUscita - prezzoIngresso) * azioni;
      return {
        chiusaAnticipata: true,
        prezzoUscita: statoPos.prezzoUscita,
        pnlRealizzato: pnlRealizzato,
        chiudiOra: pnlRealizzato,
        evResidua: 0,
        evTotaleTenendo: pnlRealizzato,
        probMeglioDiOra: null,
        p5Eur: null,
        p95Eur: null,
        orizzonteGiorni: null,
        driftAnnuo: null,
        percorsiCampione: []
      };
    }

    var key = (ticker || '').trim().toUpperCase();
    var d = DEMO_DATA[key];

    var prezzoCorrente = statoPos.prezzoCorrente;
    var picco = statoPos.massimoRaggiunto;

    var S0 = prezzoCorrente;
    var sigma = d.ivUnderlying || d.hv || 0.3;
    var long = true;
    var hasTP = false;
    var tp = null;
    var sl = picco * (1 - SILENT_TRAILING_PCT);
    var trailing = { enabled: true, pct: SILENT_TRAILING_PCT, peakIniziale: picco };
    var jumpStats = computeJumpStats(d.close);
    var mu = stimaDrift(d.close);

    var chiudiOra = (prezzoCorrente - prezzoIngresso) * azioni;

    var rows = HORIZONS.map(function (days) {
      var r = simulateHorizon(
        S0, sl, tp, hasTP, long, sigma, mu, days,
        null, d.dividendYield, jumpStats, azioni, trailing,
        null, SAMPLE_PATHS_PER_HORIZON
      );
      r.days = days;
      return r;
    });

    var bestIdx = bestRowIndex(rows);
    var best = rows[bestIdx];

    var evResidua = best.ev;
    var evTotaleTenendo = chiudiOra + evResidua;
    var probMeglioDiOra = best.probProfit;
    var p5Eur = chiudiOra + best.p5;
    var p95Eur = chiudiOra + best.p95;
    var orizzonteGiorni = best.days;
    var percorsiCampione = best.sample.map(function (s) {
      return { prezzi: s.prezzi, esito: s.payoff >= 0 ? 'target' : 'stop' };
    });

    return {
      chiusaAnticipata: false,
      prezzoUscita: null,
      pnlRealizzato: null,
      chiudiOra: chiudiOra,
      evResidua: evResidua,
      evTotaleTenendo: evTotaleTenendo,
      probMeglioDiOra: probMeglioDiOra,
      p5Eur: p5Eur,
      p95Eur: p95Eur,
      orizzonteGiorni: orizzonteGiorni,
      driftAnnuo: mu,
      percorsiCampione: percorsiCampione
    };
  }

  // Seed/parametri curati apertamente per lo spettro didattico del trio
  // (si', ni, no) - vedi nota "CURATELA DICHIARATA" in testa al file.
  // Rinominati da ALBA/FARO/VULCANO a CALMO/MEDIO/VIOLENTO (addendum utente):
  // le stringhe "seed" sono rimaste invariate di proposito, per non alterare
  // l'hash e quindi le serie/numeri gia' verificati e approvati.
  DEMO_DATA.CALMO = (function () {
    var close = generaSerieSintetica({ seed: 'ALBA-v14-d0.14', giorni: 250, prezzoIniziale: 100, volAnnua: 0.15, driftAnnuo: 0.14 });
    var hv = computeHV(close);
    return { price: close[close.length - 1], ivUnderlying: hv + 0.02, hv: hv, dividendYield: 0, close: close, sintetico: true, personalita: 'si muove come i titoli più tranquilli del mercato (grandi gruppi stabili): oscillazioni piccole, poche sorprese' };
  })();
  DEMO_DATA.MEDIO = (function () {
    var close = generaSerieSintetica({ seed: 'FARO-v1', giorni: 250, prezzoIniziale: 100, volAnnua: 0.25, driftAnnuo: 0.18 });
    var hv = computeHV(close);
    return { price: close[close.length - 1], ivUnderlying: hv + 0.02, hv: hv, dividendYield: 0, close: close, sintetico: true, personalita: 'si muove come una grande azienda solida in crescita: tendenze riconoscibili, scossoni occasionali' };
  })();
  DEMO_DATA.VIOLENTO = (function () {
    var close = generaSerieSintetica({ seed: 'VULCANO-v16-d-0.1', giorni: 250, prezzoIniziale: 100, volAnnua: 0.50, driftAnnuo: -0.10, salti: { probabilitaGiornaliera: 0.03, deviazioneLog: 0.08 } });
    var hv = computeHV(close);
    return { price: close[close.length - 1], ivUnderlying: hv + 0.02, hv: hv, dividendYield: 0, close: close, sintetico: true, personalita: 'si muove come i titoli più nervosi del mercato: strappi improvvisi, salti, stop facili da colpire' };
  })();

  return {
    valutaTrade: valutaTrade,
    valutaTradeAperto: valutaTradeAperto,
    statoPosizione: statoPosizione,
    generaSerieSintetica: generaSerieSintetica,
    _internals: { DEMO_DATA: DEMO_DATA, HORIZONS: HORIZONS, GAIN_THRESHOLD_FRACTIONS: GAIN_THRESHOLD_FRACTIONS, simulateHorizon: simulateHorizon, computeJumpStats: computeJumpStats, stimaDrift: stimaDrift, bestRowIndex: bestRowIndex, computeHV: computeHV }
  };

});
