# Registro decisioni — progetto Sigma
Scelte già fatte e motivate. Non riproporre alternative già scartate.
## Prodotto
- Sito educativo adattivo a 3 profili (neofita/intermedio/esperto),
  anticamera a 1 tap, selettore profili sempre visibile in alto.
- Il sito INSEGNA a ragionare (alfabetizzazione probabilistica); i
  sistemi vincenti veri (Sigma XIII: spread, VRP) restano nelle maschere
  "In arrivo" del profilo trader. Il motore didattico non è e non deve
  sembrare un sistema vincente.
- Monetizzazione decisa: si vendono FILTRI/strumenti software a
  abbonamento, mai segnali personalizzati (perimetro art. 166 TUF).
  Mai promettere che "più costa più si guadagna": si vende più
  informazione per decidere, non più probabilità di gain.
- Percorso neofita: Livello 1 = titoli sintetici CALMO/MEDIO/VIOLENTO
  (palestra dichiarata: repliche statistiche di famiglie reali di
  sottostanti, per allenarsi in tempi brevi); Livello 2 = i 3 ticker
  reali in replay storico. Livello 2 sbloccato dopo 3 decisioni giudicate
  (trade aperti, chiusi e valutati dall'ombra), non 3 semplici calcoli
  (localStorage sigma_lvl_progress, conteggio reale in sigma_journal). Il
  mercato live NON esiste nel sito.
- Criterio didattico del trio sintetico: CALMO = "sì" lieve (EV
  leggermente positiva), MEDIO = "sì" netto, VIOLENTO = "no" (EV
  negativa/~zero). Curatela seed dichiarata nei commenti.
- Palestra: tempo unico a sessioni. All'ingresso si genera
  deterministicamente il futuro dei 3 sintetici (estendiSerie, 120gg,
  seed di sessione), ciascuno col proprio carattere. Aggiorna = 1
  giorno sull'unica serie estesa; prezzi, trade aperti e ombre camminano
  tutti lì. Nessun aggancio alle ore reali. A fine serie: nuova
  sessione, nuovi futuri.
## Motori
- Motore 1 (valutaTrade): long-only sul sottostante, trailing stop
  silenzioso 10%, NO take profit. MC 10.000 percorsi GBM deterministici
  + salti storici reiniettati (>3σ). Drift = stimaDrift (media log-ret
  storica, shrinkage 50%, cap ±40% annuo) − dividend yield − 0.5σ².
  Griglia orizzonti [7,14,30,60,90,120], si sceglie l'EV massima.
  Sizing: azioni = f(perditaMax), il rischio è l'input.
- Motore 2: statoPosizione RICOSTRUISCE il passato camminando sui close
  reali (mai simulato), eredita trailing dal massimo reale, rileva
  chiusaAnticipata; valutaTradeAperto riusa simulateHorizon da oggi.
  Output in VALUTA: chiudiOra, evResidua (il numero decisionale),
  evTotaleTenendo, probMeglioDiOra, p5Eur/p95Eur.
- Riempimento pessimistico dello stop: uscita a min(prezzo, stop) per un
  long — nei gap si esce peggio dello stop, la "perdita massima" è
  superabile. Vale per tutti i ticker.
- probabilita = P(P&L>0) diretta; evAtteso = EV/perditaMax; p5/p95 in %
  del capitale a rischio; percorsiCampione ~100 traiettorie per il
  replay del neofita.
- Coerenza obbligatoria: trade appena aperto → evResidua Motore 2 ≈ EV
  Motore 1 stesso orizzonte. Logica trailing identica tra simulazione e
  ricostruzione.
- Motore 3 (ombraTrade): verifica della decisione. Wrapper di
  statoPosizione che continua il trade oltre la chiusura dell'utente,
  ignorandola. Nessuna simulazione: solo ricostruzione storica.
  Giudizio congelato a +10 giorni-demo o allo stop dell'ombra.
  Registro decisioni in localStorage sigma_journal.
## Guscio / UI
- Verdetti in 3 registri linguistici per profilo; per il neofita output
  in euro e frasi semplici ("in X casi su 10"), mai percentuali nude.
- Neofita: banner SIMULAZIONE DIDATTICA + replay animato delle 100 vite.
- Coach neofita (task 15/7): parla poco, solo nei momenti giusti - mai
  ripete quello che la pagina già mostra. Bolle automatiche consentite:
  benvenuto (1 bolla), commento a fine replay dopo Calcola (1 bolla,
  condizionata all'esito: approva o boccia), conferma dopo l'apertura in
  demo (1 bolla "Aperto..."), più cambio di segno del vantaggio a
  restare, sbarramento/sblocco Livello 2 (già esistenti). Silenziati per
  il neofita: annuncio di cambio profilo, messaggi di chiusura trade
  (il verdetto dell'ombra resta comunque visibile sulla riga del trade).
  Intermedio/esperto invariati su tutti questi punti.
- Assistente: azioni JSON (evidenzia sezione, cambia_profilo); analogie:
  calcio per neofita, navigatore per intermedio, poker SOLO per esperto
  e senza mani specifiche.
- Analytics: GA4 G-1YD246YPC8 + Clarity xkqjrd5vw2, caricati SOLO dopo
  consenso (banner, localStorage sigma_consenso). Eventi:
  seleziona_profilo, calcolo_eseguito.
- "I numeri di oggi" (task 13/7): nel conto demo del neofita, ogni trade
  APERTO su CALMO/MEDIO/VIOLENTO richiama Motore 2 (valutaTradeAperto, non
  toccato) sulla serie estesa di sessione e mostra, sotto il P&L, SOLO 3
  frasi in linguaggio naturale: probabilità ("X casi su 10"), i tre valori
  in euro (chiudendo ora / restando in media / vantaggio a restare, quest'
  ultimo colorato verde/rosso) e la mini-tendenza vs ieri (freccia ↑/↓/=).
  Niente p5/p95, orizzonte, drift o sigle (EV/IV/MC) per questo profilo.
  Cambio di segno del vantaggio a restare vs ieri → bordo ambra 2-3s sul
  trade + una riga dell'assistente, mai un consiglio di chiudere/tenere.
- Percorsi Monte Carlo ridotti (percorsiMC/PERCORSI_LIVE_DEMO=2.000, invece
  di MC_PATHS=10.000) SOLO per il ricalcolo live di valutaTradeAperto ad
  ogni Aggiorna nel conto demo neofita (misurato: 3 trade aperti passano da
  ~350ms a ~70ms). L'apertura del trade e la cattura a fine chiusura (per
  sigma_journal) restano a 10.000 percorsi. Determinismo invariato.
- Sbarramento Livello 2 (task 14/7): nel select del neofita i 3 titoli
  reali restano visibili ma con option disabled e etichetta "🔒 AAPL —
  Apple (titolo reale)" finché sigma_journal non contiene almeno 3
  decisioni giudicate. Tentativo di selezione (anche forzato) → torna al
  ticker precedente e l'assistente mostra lo sbarramento con il numero di
  decisioni mancanti, mai un giudizio negativo. Allo sblocco: lucchetti
  rimossi, tappa 2 del mini-percorso evidenziata, messaggio di completamento
  dell'assistente, evento GA4 livello_sbloccato (parte solo se consenso
  analytics già dato, stesso meccanismo di consenso degli altri eventi).
- Bug fix (16/7): il criterio "buono/cattivo" (colore KPI, verdetto,
  bolla del coach) era `evAtteso > .2` invece di `evAtteso > 0` — un
  trade a EV positiva ma con evAtteso frazionario ≤20% del rischio
  veniva bocciato solo perché la probabilità era mediocre, l'esatto
  contrario della filosofia del sito (conta l'EV, non il win rate).
  Criterio unico ora ovunque: approvato ⇔ evAtteso > 0, mai soglie
  sulla probabilità. Per il neofita il verdetto e la bolla, quando
  EV>0 ma probabilità <60%, spiegano esplicitamente l'asimmetria
  (vince meno spesso ma guadagna di più quando vince) invece di
  lamentare il win rate. Essendo `buono` condiviso da tutti i profili,
  la correzione vale anche per intermedio/esperto (stessi identici
  testi di prima, solo la classificazione ora corretta).
