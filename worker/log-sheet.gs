/**
 * log-sheet.gs — Registro domande del coach Sigma su Google Sheet.
 * ============================================================================
 * Incolla questo codice in Estensioni > Apps Script del foglio Google che
 * userai come registro, poi Distribuisci come Web App (vedi worker/README.md
 * per i passi in ordine). Riceve un POST dal Worker (sigma-coach-worker.js)
 * e appende una riga: data, profilo, livello, domanda, risposta,
 * sessioneHash. Nessun IP in chiaro arriva mai qui: il Worker manda solo
 * un hash troncato di IP+giorno.
 *
 * Prima di distribuire: nel foglio, riga 1, intestazioni suggerite:
 *   Data | Profilo | Livello | Domanda | Risposta | SessioneHash
 */

function doPost(e) {
  try {
    var dati = JSON.parse(e.postData.contents);
    var foglio = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    foglio.appendRow([
      dati.data || new Date().toISOString(),
      dati.profilo || '',
      dati.livello != null ? dati.livello : '',
      dati.domanda || '',
      dati.risposta || '',
      dati.sessioneHash || ''
    ]);
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (errore) {
    // Il Worker ignora comunque l'esito (fire-and-forget): rispondiamo con
    // un errore leggibile solo per chi guarda i log di Apps Script.
    return ContentService.createTextOutput(JSON.stringify({ ok: false, errore: String(errore) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
