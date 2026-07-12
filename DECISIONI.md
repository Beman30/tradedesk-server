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
  reali in replay storico, sbloccato dall'assistente dopo 3 calcoli
  (localStorage sigma_lvl_progress). Il mercato live NON esiste nel sito.
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
- Neofita: banner SIMULAZIONE DIDATTICA + replay animato delle 100 vite
  + spiegazione scandita dell'assistente dopo ogni calcolo.
- Assistente: azioni JSON (evidenzia sezione, cambia_profilo); analogie:
  calcio per neofita, navigatore per intermedio, poker SOLO per esperto
  e senza mani specifiche.
- Analytics: GA4 G-1YD246YPC8 + Clarity xkqjrd5vw2, caricati SOLO dopo
  consenso (banner, localStorage sigma_consenso). Eventi:
  seleziona_profilo, calcolo_eseguito.
