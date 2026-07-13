From b731ae7a18a1f5683ccd849915c67bd70ef8740e Mon Sep 17 00:00:00 2001
From: Dominus <nicolapalmia@gmail.com>
Date: Mon, 13 Jul 2026 08:00:14 +0200
Subject: [PATCH] Motore 2 nel conto demo neofita: blocco 'I numeri di oggi'
 per ogni trade aperto

- valutaTradeAperto (Motore 2, invariato) richiamato ad ogni Aggiorna per
  ogni trade allenamento aperto, sulla serie estesa di sessione.
- Nuovo blocco 'I numeri di oggi' sotto il P&L: frase probabilita',
  i tre valori in euro (chiudi ora / restando in media / vantaggio a
  restare) e mini-tendenza vs ieri (freccia). Niente p5/p95/orizzonte/
  drift/sigle per il neofita.
- Cambio di segno del vantaggio a restare vs ieri: bordo ambra 2-3s +
  una riga dell'assistente, nessun consiglio chiudi/tieni.
- sigma_journal: alla chiusura salva anche probMeglioDiOra e evResidua
  del giorno di chiusura (rimpiazza il placeholder evResiduaAllaChiusura).
- System prompt assistente (blocco neofita): spiega 'I numeri di oggi'.
- Performance: nuovo parametro opzionale percorsiMC/nPaths in
  valutaTradeAperto/simulateHorizon, usato SOLO dal ricalcolo live di
  Aggiorna nel conto demo (2.000 percorsi contro i 10.000 di default,
  misurato ~350ms->~70ms su 3 trade). Apertura e chiusura restano a 10k.
  Determinismo invariato, default identico per tutti gli altri chiamanti.
- DECISIONI.md aggiornato con le due nuove scelte.

Intermedio/esperto e resto dei motori non toccati (verificato con test
Node + jsdom).
---
 DECISIONI.md        |  14 +++++
 sigma-adaptive.html | 149 +++++++++++++++++++++++++++++++++++++++++---
 sigma-engines.js    |  42 ++++++++-----
 3 files changed, 183 insertions(+), 22 deletions(-)

diff --git a/DECISIONI.md b/DECISIONI.md
index 2d2c826..e821bfc 100644
--- a/DECISIONI.md
+++ b/DECISIONI.md
@@ -62,3 +62,17 @@ Scelte già fatte e motivate. Non riproporre alternative già scartate.
 - Analytics: GA4 G-1YD246YPC8 + Clarity xkqjrd5vw2, caricati SOLO dopo
   consenso (banner, localStorage sigma_consenso). Eventi:
   seleziona_profilo, calcolo_eseguito.
+- "I numeri di oggi" (task 13/7): nel conto demo del neofita, ogni trade
+  APERTO su CALMO/MEDIO/VIOLENTO richiama Motore 2 (valutaTradeAperto, non
+  toccato) sulla serie estesa di sessione e mostra, sotto il P&L, SOLO 3
+  frasi in linguaggio naturale: probabilità ("X casi su 10"), i tre valori
+  in euro (chiudendo ora / restando in media / vantaggio a restare, quest'
+  ultimo colorato verde/rosso) e la mini-tendenza vs ieri (freccia ↑/↓/=).
+  Niente p5/p95, orizzonte, drift o sigle (EV/IV/MC) per questo profilo.
+  Cambio di segno del vantaggio a restare vs ieri → bordo ambra 2-3s sul
+  trade + una riga dell'assistente, mai un consiglio di chiudere/tenere.
+- Percorsi Monte Carlo ridotti (percorsiMC/PERCORSI_LIVE_DEMO=2.000, invece
+  di MC_PATHS=10.000) SOLO per il ricalcolo live di valutaTradeAperto ad
+  ogni Aggiorna nel conto demo neofita (misurato: 3 trade aperti passano da
+  ~350ms a ~70ms). L'apertura del trade e la cattura a fine chiusura (per
+  sigma_journal) restano a 10.000 percorsi. Determinismo invariato.
diff --git a/sigma-adaptive.html b/sigma-adaptive.html
index f99e67c..e81fc6d 100644
--- a/sigma-adaptive.html
+++ b/sigma-adaptive.html
@@ -164,6 +164,12 @@ body[data-profilo="esperto"] .esperto-extra{display:block}
 .orizzonte span.chip{font-size:.75rem;background:#fff;border:1px solid var(--line);border-radius:999px;padding:4px 11px;color:var(--ink2)}
 .orizzonte .chip b{font-family:'IBM Plex Mono',monospace;font-weight:500}
 .orizzonte .chip b.su{color:var(--green)} .orizzonte .chip b.giu{color:var(--red)}
+/* "I numeri di oggi" - Motore 2 nel conto demo del neofita (task 13/7) */
+.numeri-oggi{flex-basis:100%;margin-top:8px;padding-top:8px;border-top:1px dashed var(--line);font-size:.82rem;color:var(--ink2);line-height:1.55}
+.numeri-oggi .ntit{font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;font-weight:700;color:var(--ink2);margin-bottom:3px}
+.numeri-oggi b.pnl-pos{color:var(--green)} .numeri-oggi b.pnl-neg{color:var(--red)}
+.numeri-oggi .ntend{color:var(--ink2);font-size:.78rem;margin-top:2px}
+.pos-demo.cambio-segno{outline:3px solid var(--amber);outline-offset:2px;transition:outline-color .3s}
 .metriche{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
 @media (max-width:640px){.metriche{grid-template-columns:1fr 1fr}}
 .metriche .m{font-size:.78rem;color:var(--ink2)}
@@ -1094,14 +1100,19 @@ function apriInDemo(tipo){
   if(!rec) return;
   const c = leggiConto();
   const extra = { id: Date.now(), ts: Date.now(), chiuso: false };
-  if(isTickerAllenamento(rec.ticker)){
+  const nuovoRec = Object.assign(extra, rec);
+  if(isTickerAllenamento(nuovoRec.ticker)){
     // Sessione di allenamento: l'apertura si aggancia al giorno corrente
     // dell'unico orologio del conto (indice nella serie storica+estesa),
     // non alle ore reali - vedi ASSICURA_SESSIONE_ALLENAMENTO più sotto.
     assicuraSessioneAllenamento();
-    extra.indiceApertura = clockCorrente();
+    nuovoRec.indiceApertura = clockCorrente();
+    // "I numeri di oggi" (Motore 2): calcolo iniziale al momento dell'apertura,
+    // percorsi pieni (default MC_PATHS=10k) - non e' il ricalcolo live ripetuto
+    // di Aggiorna, quindi nessun override di percorsiMC qui.
+    aggiornaNumeriTrade(nuovoRec, nuovoRec.indiceApertura, false);
   }
-  c.unshift(Object.assign(extra, rec));
+  c.unshift(nuovoRec);
   salvaConto(c);
   renderConto();
   if(typeof gtag === 'function') gtag('event', 'demo_trade_aperto', { profilo: profilo, ticker: rec.ticker, origine: tipo });
@@ -1182,6 +1193,22 @@ function chiudiDemo(id){
     const clock = clockCorrente();
     const serie = serieSessione[rec.ticker];
     const curPrezzo = serie[clock];
+    // Registro (sigma_journal): cattura probMeglioDiOra ed evResidua del
+    // giorno di chiusura (Motore 2, percorsi pieni - e' un calcolo singolo,
+    // non il ricalcolo live ripetuto di Aggiorna) per la pagella e il
+    // confronto "tu vs numeri".
+    try{
+      const esitoChiusura = SigmaEngines.valutaTradeAperto({
+        ticker: rec.ticker, prezzoIngresso: rec.apertura, azioni: rec.azioni,
+        indiceGiornoApertura: rec.indiceApertura, indiceGiornoOggi: clock,
+        modalita: 'demo', serieClose: serie
+      });
+      rec.probMeglioDiOraChiusura = esitoChiusura.chiusaAnticipata ? null : esitoChiusura.probMeglioDiOra;
+      rec.evResiduaChiusura = esitoChiusura.chiusaAnticipata ? null : esitoChiusura.evResidua;
+    } catch(err){
+      rec.probMeglioDiOraChiusura = null;
+      rec.evResiduaChiusura = null;
+    }
     rec.chiuso = true;
     rec.sottoOsservazione = true;
     rec.indiceChiusura = clock;
@@ -1211,6 +1238,104 @@ const CHIAVE_SESSIONE = 'sigma_sessione';
 const CHIAVE_CLOCK = 'sigma_demo_clock';
 const CHIAVE_JOURNAL = 'sigma_journal';
 const GIORNI_EXTRA_SESSIONE = 120;
+const PERCORSI_LIVE_DEMO = 2000; // Motore 2: percorsi Monte Carlo ridotti SOLO
+// per il ricalcolo live di valutaTradeAperto ad ogni Aggiorna nel conto demo
+// del neofita (misurato: 3 trade aperti a 10k percorsi ~350ms, a 2k ~70ms).
+// Il calcolo al momento dell'apertura del trade resta a 10k (default del
+// motore, vedi apriInDemo). Determinismo invariato (stesso input => stesso
+// output, vedi commento in sigma-engines.js).
+
+// aggiornaNumeriTrade - Motore 2 (valutaTradeAperto) applicato a un trade del
+// conto demo di allenamento: NON tocca la logica del motore, lo richiama solo
+// con la serie estesa di sessione (stessa che usano gia' statoPosizione/
+// ombraTrade). Salva su rec.numeriOggi i tre valori in euro + probMeglioDiOra;
+// se e' un aggiornamento (isAggiorna=true, cioe' arriva da un click su
+// Aggiorna) sposta prima il vecchio "oggi" in rec.numeriIeri, cosi' la UI puo'
+// mostrare la mini-tendenza giorno su giorno, e usa i percorsi ridotti.
+function aggiornaNumeriTrade(rec, clockOggi, isAggiorna){
+  if(!isTickerAllenamento(rec.ticker)) return;
+  const serie = serieSessione[rec.ticker];
+  if(!serie) return;
+  let esito;
+  try{
+    esito = SigmaEngines.valutaTradeAperto({
+      ticker: rec.ticker, prezzoIngresso: rec.apertura, azioni: rec.azioni,
+      indiceGiornoApertura: rec.indiceApertura, indiceGiornoOggi: clockOggi,
+      modalita: 'demo', serieClose: serie,
+      percorsiMC: isAggiorna ? PERCORSI_LIVE_DEMO : undefined
+    });
+  } catch(err){ return; }
+  if(esito.chiusaAnticipata){
+    // Il trailing di Motore 2 ha gia' chiuso la posizione nella ricostruzione:
+    // niente prospettiva da mostrare (probMeglioDiOra non esiste in questo caso).
+    rec.numeriOggi = null;
+    return;
+  }
+  if(isAggiorna && rec.numeriOggi){
+    rec.numeriIeri = { probMeglioDiOra: rec.numeriOggi.probMeglioDiOra, evResidua: rec.numeriOggi.evResidua };
+  }
+  rec.numeriOggi = {
+    chiudiOra: esito.chiudiOra,
+    evTotaleTenendo: esito.evTotaleTenendo,
+    evResidua: esito.evResidua,
+    probMeglioDiOra: esito.probMeglioDiOra
+  };
+}
+// aggiornaNumeriTradeAperti - chiamata da avanzaGiornoDemo() ad ogni Aggiorna:
+// ricalcola aggiornaNumeriTrade() per ogni trade di allenamento ancora aperto
+// (non chiuso/sotto osservazione) e segnala quelli il cui vantaggio a restare
+// (evResidua) ha cambiato segno rispetto a ieri.
+function aggiornaNumeriTradeAperti(clock){
+  const c = leggiConto();
+  const cambiati = [];
+  c.forEach(rec=>{
+    if(!isTickerAllenamento(rec.ticker) || rec.chiuso) return;
+    aggiornaNumeriTrade(rec, clock, true);
+    if(rec.numeriIeri && rec.numeriOggi){
+      const segnoIeri = Math.sign(rec.numeriIeri.evResidua);
+      const segnoOggi = Math.sign(rec.numeriOggi.evResidua);
+      if(segnoIeri !== 0 && segnoOggi !== 0 && segnoIeri !== segnoOggi) cambiati.push(rec);
+    }
+  });
+  salvaConto(c);
+  return cambiati;
+}
+// segnalaCambiSegno - bordo ambra 2-3s sul trade + UNA riga dell'assistente
+// (se gia' aperto), nessun consiglio di chiudere/tenere.
+function segnalaCambiSegno(cambiati){
+  if(!cambiati || !cambiati.length) return;
+  cambiati.forEach(rec=>{
+    const el = document.querySelector('.pos-demo[data-trade-id="'+rec.id+'"]');
+    if(el){
+      el.classList.add('cambio-segno');
+      setTimeout(()=>el.classList.remove('cambio-segno'), 2600);
+    }
+  });
+  if(document.getElementById('agente').classList.contains('aperto')){
+    bolla('ai', "I numeri di "+cambiati[0].ticker+" hanno cambiato direzione: dai un'occhiata.");
+  }
+}
+// numeriOggiHTML - blocco "I numeri di oggi" per il neofita: SOLO le frasi in
+// linguaggio naturale (probabilita' + tre valori in euro + mini-tendenza).
+// Niente p5/p95, orizzonte, drift o sigle (EV/IV/MC) - vedi DECISIONI.md.
+function numeriOggiHTML(rec){
+  const n = rec.numeriOggi;
+  if(!n) return '';
+  const seg = v => (v>=0?'+':'') + Math.round(v) + ' $';
+  const su10 = Math.max(0, Math.min(10, Math.round(n.probMeglioDiOra*10)));
+  let tendenza = '';
+  if(rec.numeriIeri){
+    const su10Ieri = Math.max(0, Math.min(10, Math.round(rec.numeriIeri.probMeglioDiOra*10)));
+    const freccia = su10 > su10Ieri ? '↑' : (su10 < su10Ieri ? '↓' : '=');
+    tendenza = '<p class="ntend">'+freccia+' ieri era '+su10Ieri+' su 10</p>';
+  }
+  return '<div class="numeri-oggi">'
+    + '<p class="ntit">I numeri di oggi</p>'
+    + '<p>Da qui, in '+su10+' casi su 10 restare va meglio che chiudere ora</p>'
+    + '<p>Chiudendo ora: '+seg(n.chiudiOra)+' · Restando, in media: '+seg(n.evTotaleTenendo)+' · Vantaggio a restare: <b class="'+(n.evResidua>=0?'pnl-pos':'pnl-neg')+'">'+seg(n.evResidua)+'</b></p>'
+    + tendenza
+    + '</div>';
+}
 let serieSessione = {}; // { CALMO:[...370], MEDIO:[...], VIOLENTO:[...] } - rigenerata a ogni load dal seed salvato
 
 function isTickerAllenamento(ticker){
@@ -1291,11 +1416,12 @@ function renderRigaAllenamento(rec, etichette){
   const pnl = (cur.prezzo - rec.apertura) * rec.azioni * (rec.dir==='short' ? -1 : 1);
   const [cls, lab] = etichette[cur.stato];
   const finita = cur.stato !== 'corso';
-  return '<div class="pos-demo'+(finita?' finita':'')+'">'
+  return '<div class="pos-demo'+(finita?' finita':'')+'" data-trade-id="'+rec.id+'">'
     + '<div class="info"><b>'+rec.ticker+'</b> <span class="stato-demo '+cls+'">'+lab+'</span>'
     + '<span>'+rec.azioni+' azioni demo · aperto a '+rec.apertura.toFixed(2)+' · stop '+rec.stop.toFixed(2)+' · obiettivo '+rec.target.toFixed(2)+'</span></div>'
     + '<div class="num"><span class="'+(pnl>=0?'pnl-pos':'pnl-neg')+'">'+(pnl>=0?'+':'')+pnl.toFixed(0)+' $</span><small>prezzo demo '+cur.prezzo.toFixed(2)+'</small></div>'
     + (finita ? '' : '<button class="chiudi" onclick="chiudiDemo('+rec.id+')">Chiudi</button>')
+    + (finita ? '' : numeriOggiHTML(rec))
     + '</div>';
 }
 function costruisciGiudizio(rec, pnlOmbra){
@@ -1321,9 +1447,11 @@ function costruisciVoceGiornale(rec, giudizio){
     ticker: rec.ticker,
     esito: giudizio.decisionePromossa ? 'promossa' : 'bocciata',
     differenza: giudizio.differenza,
-    // non disponibile: il percorso neofita apre solo da "Nuovo trade"
-    // (Motore 1), che non calcola evResidua (quello e' Motore 2).
-    evResiduaAllaChiusura: null,
+    // Motore 2: "I numeri di oggi" del giorno in cui l'utente ha chiuso
+    // (catturati in chiudiDemo) - servono alla pagella e al confronto
+    // "tu vs numeri".
+    probMeglioDiOraChiusura: rec.probMeglioDiOraChiusura != null ? rec.probMeglioDiOraChiusura : null,
+    evResiduaChiusura: rec.evResiduaChiusura != null ? rec.evResiduaChiusura : null,
     giorniTenuto: rec.indiceChiusura - rec.indiceApertura,
     ts: Date.now()
   };
@@ -1365,7 +1493,12 @@ function avanzaGiornoDemo(){
   if(clock < max) clock++;
   localStorage.setItem(CHIAVE_CLOCK, String(clock));
   aggiornaOmbreEGiudizi();
+  // Motore 2: ricalcola "I numeri di oggi" per ogni trade di allenamento
+  // ancora aperto e raccoglie quelli il cui vantaggio a restare ha cambiato
+  // segno rispetto a ieri, per evidenziarli dopo il render.
+  const cambiSegno = aggiornaNumeriTradeAperti(clock);
   renderConto();
+  segnalaCambiSegno(cambiSegno);
 }
 function nuovaSessioneAllenamento(){
   assicuraSessioneAllenamento();
@@ -1447,7 +1580,7 @@ function sistemPrompt(){
   return `Sei l'Assistente Sigma, la guida integrata di "Sigma Trade Coach", un simulatore didattico di trading (demo, dati congelati al 9/7/2026, ticker disponibili solo AAPL, MSFT, TSLA, nessun ordine reale).
 
 L'utente ha profilo: "${profilo}" (${NOMI[profilo]}).
-- neofita: mai fatto trading. Parla semplicissimo, zero gergo, molta rassicurazione, un concetto alla volta. Cornice narrativa fissa: il trading non è magia né fortuna, è calcolo delle probabilità; le probabilità NON predicono il futuro ma dicono (1) se un'operazione ha senso prima di aprirla e (2) come adattarsi quando le cose cambiano, come una squadra durante la partita. Ribadisci quando è naturale che questa è una SIMULAZIONE DIDATTICA (nessun soldo vero) e che il percorso è: imparare qui, poi eventualmente passare al reale — mai il contrario. Per il neofita il menu ticker NON mostra AAPL/MSFT/TSLA ma tre titoli di ALLENAMENTO fittizi (Livello 1): CALMO (si muove come i titoli più tranquilli del mercato: oscillazioni piccole, poche sorprese), MEDIO (si muove come una grande azienda solida in crescita: tendenze riconoscibili, scossoni occasionali) e VIOLENTO (si muove come i titoli più nervosi del mercato: strappi improvvisi, salti, stop facili da colpire). Non esistono sul mercato: replicano statisticamente il comportamento di famiglie reali di sottostanti (volatilità, tendenze e salti presi da come si muovono davvero quelle categorie), per allenarsi in modo corretto e in tempi brevi — in pochi esercizi si incontrano comportamenti che sul mercato vero si vedrebbero solo dopo anni di esperienza. Dopo 3 calcoli completati si sblocca da solo il Livello 2 nel menu ticker: i tre titoli REALI (AAPL, MSFT, TSLA) in replay storico, con l'etichetta "(titolo reale)" — se l'utente chiede dei titoli reali prima del terzo calcolo, spiega che si sbloccano dopo un po' di allenamento, con lo stesso tono rassicurante, mai come una restrizione punitiva. Il percorso ha 3 tappe: 1) palestra sui titoli di allenamento (dove si trova ora), 2) titoli veri in demo, 3) mercato reale. Se chiede quando può passare ai titoli veri, rispondi che dopo qualche esercizio completato sarai tu stesso a proporglielo. Il trade ombra: quando l'utente chiude un trade, Sigma continua a simularlo come se fosse rimasto aperto, per confrontare la decisione presa con l'alternativa. Se l'utente chiede perché il trade chiuso si muove ancora, spiega che è l'ombra e che serve a valutare la QUALITÀ della decisione, non a fargli rimpianti: decisione ed esito sono cose diverse.
+- neofita: mai fatto trading. Parla semplicissimo, zero gergo, molta rassicurazione, un concetto alla volta. Cornice narrativa fissa: il trading non è magia né fortuna, è calcolo delle probabilità; le probabilità NON predicono il futuro ma dicono (1) se un'operazione ha senso prima di aprirla e (2) come adattarsi quando le cose cambiano, come una squadra durante la partita. Ribadisci quando è naturale che questa è una SIMULAZIONE DIDATTICA (nessun soldo vero) e che il percorso è: imparare qui, poi eventualmente passare al reale — mai il contrario. Per il neofita il menu ticker NON mostra AAPL/MSFT/TSLA ma tre titoli di ALLENAMENTO fittizi (Livello 1): CALMO (si muove come i titoli più tranquilli del mercato: oscillazioni piccole, poche sorprese), MEDIO (si muove come una grande azienda solida in crescita: tendenze riconoscibili, scossoni occasionali) e VIOLENTO (si muove come i titoli più nervosi del mercato: strappi improvvisi, salti, stop facili da colpire). Non esistono sul mercato: replicano statisticamente il comportamento di famiglie reali di sottostanti (volatilità, tendenze e salti presi da come si muovono davvero quelle categorie), per allenarsi in modo corretto e in tempi brevi — in pochi esercizi si incontrano comportamenti che sul mercato vero si vedrebbero solo dopo anni di esperienza. Dopo 3 calcoli completati si sblocca da solo il Livello 2 nel menu ticker: i tre titoli REALI (AAPL, MSFT, TSLA) in replay storico, con l'etichetta "(titolo reale)" — se l'utente chiede dei titoli reali prima del terzo calcolo, spiega che si sbloccano dopo un po' di allenamento, con lo stesso tono rassicurante, mai come una restrizione punitiva. Il percorso ha 3 tappe: 1) palestra sui titoli di allenamento (dove si trova ora), 2) titoli veri in demo, 3) mercato reale. Se chiede quando può passare ai titoli veri, rispondi che dopo qualche esercizio completato sarai tu stesso a proporglielo. Il trade ombra: quando l'utente chiude un trade, Sigma continua a simularlo come se fosse rimasto aperto, per confrontare la decisione presa con l'alternativa. Se l'utente chiede perché il trade chiuso si muove ancora, spiega che è l'ombra e che serve a valutare la QUALITÀ della decisione, non a fargli rimpianti: decisione ed esito sono cose diverse. Ogni trade aperto mostra "I numeri di oggi": probabilità e valori in dollari ricalcolati a ogni giorno che passa. Se l'utente chiede cosa fare, spiega COME leggere i numeri (vantaggio a restare positivo/negativo, tendenza) ma la decisione resta sua: mai dire "chiudi" o "tieni".
 - intermedio: ha già investimenti (portafoglio, fondi, ETF) ma non fa trading attivo. Tono pratico, terminologia base ok. Cornice narrativa fissa: il ponte tra investire e fare trading è il rischio definito PRIMA (perdita massima decisa all'apertura, non subita dopo) + la rivalutazione continua delle probabilità (navigatore che ricalcola). Mai far sentire inadeguato chi "solo" investe.
 - esperto: trader attivo. Vai dritto ai numeri e alla metodologia (Monte Carlo GBM ~10.000 percorsi, griglia stop/target ottimizzata per EV, sizing = maxLoss/(entry-stop)). Con lui puoi usare il linguaggio del poker (equity, street, pot odds) come cornice concettuale, ma senza esempi di mani specifiche. Sigma per lui è un tool in più su due fronti: analisi del suo portafoglio + nuovi sistemi in arrivo (sezione "sez-sistemi"): trend following, spread trading, trading in opzioni — le opzioni tradotte in probabilità (P(profitto), EV, perdita massima) invece che in greche. Se chiede dettagli sui sistemi: sono in arrivo, non ancora attivi nella demo.
 
diff --git a/sigma-engines.js b/sigma-engines.js
index 2522685..1d200fe 100644
--- a/sigma-engines.js
+++ b/sigma-engines.js
@@ -347,7 +347,7 @@
     return sortedAsc[idx];
   }
 
-  function simulateHorizon(S0, sl, tp, hasTP, long, sigma, mu, days, gainAmount, dividendYield, jumpStats, shares, trailing, gainThresholds, sampleSize) {
+  function simulateHorizon(S0, sl, tp, hasTP, long, sigma, mu, days, gainAmount, dividendYield, jumpStats, shares, trailing, gainThresholds, sampleSize, nPaths) {
     var dt = 1 / 365;
     var drift = (mu || 0) - (dividendYield || 0) - 0.5 * sigma * sigma;
 
@@ -377,8 +377,15 @@
     var payoffs = [];
     var sample = [];
     var nSample = sampleSize || 0;
-
-    for (var i = 0; i < MC_PATHS; i++) {
+    // nPaths: override SOLO per il ricalcolo live "Aggiorna" del conto demo
+    // neofita (Motore 2, valutaTradeAperto) - vedi sigma-adaptive.html,
+    // PERCORSI_LIVE_DEMO. Tutti gli altri chiamanti (valutaTrade, apertura
+    // trade, pannello "Ho gia' una posizione") non lo passano e restano a
+    // MC_PATHS (10.000). Determinismo invariato: stesso seed + stesso nPaths
+    // => stesso output.
+    var paths = nPaths || MC_PATHS;
+
+    for (var i = 0; i < paths; i++) {
       var recordPath = i < nSample;
       var price = S0;
       var outcome = 'NONE';
@@ -449,23 +456,23 @@
     }
 
     var countSL = countSLOriginal + countTrailExit;
-    var mean = sumPayoff / MC_PATHS;
-    var variance = Math.max(0, sumSqPayoff / MC_PATHS - mean * mean);
+    var mean = sumPayoff / paths;
+    var variance = Math.max(0, sumSqPayoff / paths - mean * mean);
     var std = Math.sqrt(variance);
     var sortedPayoffs = payoffs.slice().sort(function (a, b) { return a - b; });
 
     return {
-      pTP: countTP / MC_PATHS,
-      pSL: countSL / MC_PATHS,
-      pSLOriginal: countSLOriginal / MC_PATHS,
-      pTrailExit: countTrailExit / MC_PATHS,
-      pNone: (MC_PATHS - countTP - countSL) / MC_PATHS,
-      ev: sumPayoff / MC_PATHS,
+      pTP: countTP / paths,
+      pSL: countSL / paths,
+      pSLOriginal: countSLOriginal / paths,
+      pTrailExit: countTrailExit / paths,
+      pNone: (paths - countTP - countSL) / paths,
+      ev: sumPayoff / paths,
       std: std,
-      probProfit: countProfit / MC_PATHS,
+      probProfit: countProfit / paths,
       p5: percentile(sortedPayoffs, 0.05),
       p95: percentile(sortedPayoffs, 0.95),
-      gainProbs: gainCounts ? gainCounts.map(function (c) { return c / MC_PATHS; }) : null,
+      gainProbs: gainCounts ? gainCounts.map(function (c) { return c / paths; }) : null,
       sample: sample
     };
   }
@@ -681,6 +688,13 @@
     var prezzoIngresso = input.prezzoIngresso;
     var azioni = input.azioni;
     var modalita = input.modalita;
+    // percorsiMC: opzionale, override del numero di percorsi Monte Carlo.
+    // Usato SOLO dal ricalcolo live "Aggiorna" nel conto demo del neofita
+    // (vedi sigma-adaptive.html, PERCORSI_LIVE_DEMO) per non bloccare
+    // l'interfaccia quando ci sono piu' trade aperti insieme. Se omesso,
+    // simulateHorizon usa il default MC_PATHS (10.000) - identico a prima
+    // per l'apertura del trade e per il pannello "Ho gia' una posizione".
+    var percorsiMC = input.percorsiMC;
 
     var statoPos = statoPosizione(input);
 
@@ -724,7 +738,7 @@
       var r = simulateHorizon(
         S0, sl, tp, hasTP, long, sigma, mu, days,
         null, d.dividendYield, jumpStats, azioni, trailing,
-        null, SAMPLE_PATHS_PER_HORIZON
+        null, SAMPLE_PATHS_PER_HORIZON, percorsiMC
       );
       r.days = days;
       return r;
-- 
2.34.1

