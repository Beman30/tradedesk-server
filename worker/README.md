# Sigma Coach Worker — deploy

Proxy Cloudflare Worker tra `sigma-adaptive.html` e l'API Anthropic, più
registro anonimo delle domande su Google Sheet. Il browser non contatta mai
direttamente `api.anthropic.com` e non conosce la chiave API né il system
prompt: tutto vive qui.

File in questa cartella:
- `sigma-coach-worker.js` — il Worker (endpoint `POST /coach`)
- `wrangler.toml` — configurazione di deploy (nome, entrypoint, `ALLOWED_ORIGIN`)
- `log-sheet.gs` — Apps Script da incollare nel Google Sheet del registro

## Passi di deploy, in ordine

1. **`wrangler login`**
   Autentica la CLI con il tuo account Cloudflare (apre il browser).

2. **`wrangler deploy`** (da dentro questa cartella `worker/`)
   Pubblica il Worker. Alla fine stampa l'URL pubblico, tipo
   `https://sigma-coach-worker.<tuo-account>.workers.dev` — questo è
   l'endpoint da incollare più avanti al passo 6.

3. **`wrangler secret put ANTHROPIC_API_KEY`**
   Incolla la chiave API Anthropic quando richiesto. Non finisce mai nel
   codice o nel repository, solo nei secret del Worker.

4. **Crea lo Sheet e distribuisci `log-sheet.gs` come web app**
   - Crea un nuovo Google Sheet, prima riga:
     `Data | Profilo | Livello | Domanda | Risposta | SessioneHash`
   - Estensioni → Apps Script, incolla il contenuto di `log-sheet.gs`.
   - Distribuisci → Nuova implementazione → tipo "App web":
     - Esegui come: te stesso
     - Chi ha accesso: chiunque (serve perché la chiamata arriva dal Worker,
       non da un utente Google autenticato)
   - Copia l'URL della web app che Google ti dà dopo l'autorizzazione.

5. **`wrangler secret put LOG_WEBHOOK`**
   Incolla l'URL della web app di Apps Script ottenuto al passo 4.

6. **Imposta `ALLOWED_ORIGIN`**
   Il valore di default in `wrangler.toml` è già `https://beman30.github.io`.
   Se il sito gira su un altro dominio, modifica `[vars] ALLOWED_ORIGIN` in
   `wrangler.toml` e rilancia `wrangler deploy` (non è un secret: è nel
   file di configurazione, versionato).

7. **Incolla l'URL del Worker in `COACH_ENDPOINT`**
   In `sigma-adaptive.html`, vicino alla cima dello script, sostituisci il
   placeholder:
   ```js
   const COACH_ENDPOINT = 'https://DA-CONFIGURARE/coach';
   ```
   con l'URL ottenuto al passo 2 seguito da `/coach`, es.
   `https://sigma-coach-worker.<tuo-account>.workers.dev/coach`.

## Note

- **Rate limit (20 richieste / 10 minuti per IP)** è tenuto in memoria
  nell'isolate del Worker: è una stima ragionevole per un sito didattico a
  basso traffico, ma non è condivisa in modo esatto tra tutti i nodi edge di
  Cloudflare (si azzera anche ad ogni cold start/redeploy). Se in futuro
  serve un limite rigoroso e globale, la strada è aggiungere un namespace
  Workers KV (o un Durable Object) e sostituire la Map in memoria con quello
  — richiede un altro passo di setup (`wrangler kv:namespace create`) non
  incluso qui perché non esplicitamente richiesto.
- **Registro domande**: se `LOG_WEBHOOK` non è impostato o la chiamata verso
  Apps Script fallisce, il Worker non fa retry e non mostra alcun errore
  all'utente — il coach continua a rispondere normalmente, il log è
  semplicemente assente per quella richiesta.
- **Verifica rapida dopo il deploy**: apri il sito, fai una domanda al
  coach col profilo neofita, e controlla che compaia una nuova riga nello
  Sheet entro pochi secondi.
