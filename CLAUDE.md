# Regole permanenti — progetto Sigma
Leggi questo file all'inizio di OGNI sessione. Vale sempre, anche se il
task del giorno non lo richiama.
## Flusso di lavoro
- Inizio sessione: git pull. Fine sessione: commit con messaggio
  descrittivo + push.
- Lavora per MODIFICHE MINIME E LOCALIZZATE. Mai riscrivere, riformattare
  o "migliorare" codice non richiesto dal task.
- Se un task sembra richiedere di toccare qualcosa nella lista
  "Intoccabili": FERMATI e chiedi prima di farlo.
- A fine task consegna l'elenco esatto delle modifiche (file, funzione,
  cosa è cambiato). Tutto ciò che non è nell'elenco non doveva cambiare.
- Quando una scelta di design/finanza non è specificata: NON inventare.
  Fermati e chiedi.
## Intoccabili (salvo esplicita richiesta nel task del giorno)
- Logica dei motori: simulateHorizon, valutaTrade, statoPosizione,
  valutaTradeAperto, stimaDrift, PRNG deterministico, dataset ticker reali
- Pannelli, testi e comportamento dei profili intermedio ed esperto
- Replay animato (avviaReplay), spiegaDemo, registri di verdetto
- CSS globale, analytics (GA4 + Clarity), banner consenso, anticamera,
  selettore profili
- Il vincolo strutturale: il percorso neofita chiama i motori SEMPRE in
  modalita 'demo'
## Principi non negoziabili
- L'EV emerge dal Monte Carlo, MAI forzata o abbellita. Se un numero
  didatticamente scomodo esce dai dati, si segnala, non si aggiusta in
  silenzio. La curatela (seed/parametri) è ammessa SOLO sui titoli
  sintetici, dichiarata nei commenti.
- Determinismo sempre: stesso input → stesso output. Ogni parametro che
  influenza la simulazione entra nella seedStr.
- Ogni modifica ai motori va testata con Node prima della consegna.
- L'assistente del sito non dà MAI consigli d'investimento personalizzati
  e non usa analogie con l'azzardo con neofiti/intermedi.
