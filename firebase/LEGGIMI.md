# Firebase – Sistema iscrizioni OTP-GEA

Cartella con tutto ciò che riguarda il progetto Firebase `otpgea-iscrizioni`.
**Non fa parte del sito**: Netlify la blocca (redirect 404 in `netlify.toml`).

| File | A cosa serve |
|---|---|
| `firestore.rules` | Regole di sicurezza Firestore |
| `storage.rules` | Regole di sicurezza Storage |
| `firestore.indexes.json` | Indici Firestore (nessun indice speciale necessario) |
| `firebase.json`, `.firebaserc` | Configurazione per la Firebase CLI |
| `copia-comune.cjs` | Copia `../iscrizioni-comune.js` in `functions/comune.js` (automatico) |
| `functions/` | Codice delle Cloud Functions (vedi sotto) |

Le regole si copiano a mano nella console (Firestore → Regole, Storage → Regole). Il testo
in questa cartella è sempre quello di riferimento: se si modifica in console, aggiornare
anche qui. Le funzioni si pubblicano con `npm run deploy` (vedi "Pubblicare le Cloud Functions").

---

## Struttura dati

Convenzioni: date dell'evento e scadenze delle quote come testo `AAAA-MM-GG`;
istanti (creazione, pagamento…) come Timestamp Firestore; importi in euro come numero
(es. `5`, `7.5`).

### `admin/{email}`
Un documento per organizzatore, id = email **in minuscolo**. Campo facoltativo `nome`
(testo). Si gestisce solo dalla console. Organizzatori attuali:
`riccardo.fava1@gmail.com`, `ori.otpgea@gmail.com`.

### `eventi/{eventoId}`
Id leggibile scelto alla creazione (minuscole, numeri, trattini; es.
`piacenza-svelata-2027`). **Leggibile da tutti**: non contiene dati riservati.

| Campo | Tipo | Note |
|---|---|---|
| `titolo` | testo | obbligatorio |
| `data` | `AAAA-MM-GG` | data dell'evento; serve anche per calcolare l'età |
| `luogo` | testo | |
| `testoIntro` | testo | mostrato in cima al form |
| `linkRegolamento` | URL | |
| `iscrizioniAperte` | bool | interruttore manuale in ps-admin |
| `email` | mappa | `oggettoConferma`, `testoConferma` con segnaposto `{squadra}` `{categoria}` `{data}` `{luogo}` `{importo}` |
| `categorie` | lista di mappe | vedi sotto |
| `creatoIl`, `aggiornatoIl` | Timestamp | |

**Categoria** (elemento di `categorie`):

| Campo | Tipo | Note |
|---|---|---|
| `id` | testo | stabile, unico nell'evento (es. `competitiva`); non si cambia dopo le prime iscrizioni |
| `nome`, `descrizione` | testo | |
| `attiva` | bool | `false` = nascosta nel form (categorie con iscritti si nascondono, non si eliminano) |
| `classifica` | bool | |
| `componentiMin`, `componentiMax` | intero | |
| `quota` | mappa | `tipo`: `gratuita` \| `persona` \| `squadra`; `scaglioni`: lista `{finoAl: "AAAA-MM-GG" o null, euro}` in ordine di data, l'ultimo con `finoAl: null` vale fino alla chiusura. La data `finoAl` è inclusa (fino alle 23:59 ora italiana) |
| `gratuitoSottoEta` | intero o null | solo con quota a persona: gratis chi alla data dell'evento ha meno di N anni compiuti |
| `etaMinima`, `etaMassima` | intero o null | limiti d'età per componente, alla data dell'evento |
| `unaSquadraPerEmail` | bool | predefinito `true` |
| `documenti` | lista | `{id, nome, descrizione, per: "componente" \| "squadra", obbligatorio, sanitario}`; `sanitario: true` (es. certificato medico) fa comparire nel form la casella di consenso ai dati sanitari |
| `campiSquadra`, `campiComponente` | lista | campi aggiuntivi `{id, etichetta, tipo: "testo" \| "numero" \| "email" \| "telefono" \| "scelta" \| "casella", obbligatorio, opzioni}` |

Nome e cognome di ogni componente sono sempre chiesti; la data di nascita è chiesta
quando la categoria ha `gratuitoSottoEta`, `etaMinima` o `etaMassima`.

### `eventi/{eventoId}/iscrizioni/{iscrizioneId}`
Creata **solo** dalla Cloud Function `creaIscrizione` (id automatico).

| Campo | Note |
|---|---|
| `nomeSquadra`, `nomeSlug` | nome come scritto e nome normalizzato (id in `nomiSquadre`) |
| `email`, `emailNorm` | email come scritta e normalizzata (trim + minuscolo) |
| `categoriaId`, `categoria` | id e copia di nome e quota al momento dell'iscrizione |
| `componenti` | lista `{nome, cognome, dataNascita?, gratuito, campi: {…}, documenti: {idDoc: percorsoStorage}}` |
| `campiSquadra`, `documentiSquadra` | mappe `{idCampo: valore}`, `{idDoc: percorsoStorage}` |
| `importo`, `dettaglioImporto` | calcolati dal server: `{tipo, euroUnitario, paganti, gratuiti}` |
| `stato` | `in_attesa_pagamento` \| `pagata` \| `confermata_gratuita` \| `annullata` |
| `uid` | uid dell'accesso anonimo di chi ha compilato (gli permette di leggere solo questa iscrizione) |
| `consensi` | `{regolamento, privacy, datiSanitari?}` con data/ora |
| `sumup` | `{checkoutId, checkoutReference, transactionCode, ultimoStato}` |
| `creataIl`, `scadeIl`, `pagataIl`, `annullataIl`, `aggiornataIl` | Timestamp; `scadeIl` = creazione + 2 ore (solo non pagate) |
| `notaAdmin`, `verifiche` (`{documentiOk}`), `emailConfermaInviata` | gestiti da ps-admin |

Gli admin possono modificare solo `notaAdmin`, `verifiche`, `emailConfermaInviata`,
`stato`, `annullataIl`, `aggiornataIl`.

### `eventi/{eventoId}/nomiSquadre/{nomeSlug}` e `eventi/{eventoId}/emailUsate/{emailNorm}`
Prenotazioni create dalla funzione nella stessa transazione dell'iscrizione; contengono
solo `creataIl` (più `iscrizioneId` per le email). `nomiSquadre` è leggibile per singolo
documento da tutti (avviso immediato "nome già preso"); `emailUsate` solo dagli admin.
`emailUsate` esiste solo per le categorie con "una squadra per email".
Id del documento in `emailUsate`: l'email normalizzata con l'eventuale `/` scritta `%2F`
(Firestore non accetta `/` negli id).

Normalizzazione nome: minuscolo, accenti rimossi, ogni sequenza di caratteri non
alfanumerici → `-`, trattini iniziali/finali tolti. Nome senza lettere né numeri = rifiutato.

### `mail/{id}`
Collezione letta dall'estensione Trigger Email. Scrivono le Cloud Functions e gli admin
(da ps-admin).

### Storage
- `caricamenti/{uid}/{file}`: file caricati dal form prima dell'invio (immagini JPEG/PNG
  o PDF, max 5 MB). Ognuno scrive solo nella propria cartella.
- `eventi/{eventoId}/{iscrizioneId}/{file}`: documenti definitivi, copiati dalla
  funzione; leggibili solo dagli admin.
- La pulizia automatica elimina i caricamenti più vecchi di 3 ore e i file delle
  iscrizioni non pagate scadute.

---

## Cloud Functions chiamate dal form

Regione `europe-west1`, funzioni "callable" (`httpsCallable`). Chi chiama è sempre
autenticato (accesso anonimo del form). Le regole di calcolo e di controllo sono in
`iscrizioni-comune.js` nella radice del sito: le funzioni ne usano una **copia identica**
(il form mostra il totale con lo stesso codice). Se si modifica quel file, ripubblicare
anche le funzioni.

### `creaIscrizione`
Richiesta: `{ eventoId, dati, totaleAtteso, sostituisci }`
- `dati`: `{ categoriaId, nomeSquadra, email, campiSquadra: {id: valore}, componenti: [{ nome, cognome, dataNascita?, campi: {id: valore}, documenti: {idDoc: "caricamenti/<uid>/<file>"} }], documentiSquadra: {idDoc: percorso}, consensi: { regolamento, privacy, datiSanitari? } }`
- `totaleAtteso`: importo mostrato all'utente.
- `sostituisci`: id di una propria iscrizione ancora in attesa di pagamento da annullare
  (l'utente è tornato indietro a modificare i dati dopo un pagamento non riuscito), oppure `null`.

Risposta: `{ iscrizioneId, stato: "confermata_gratuita" | "in_attesa_pagamento", importo, checkoutUrl? }`.
Il `redirect_url` del checkout SumUp è
`https://www.orienteeringpiacenza.it/ps-form-iscrizioni.html?evento=<eventoId>&ritorno=1&iscrizione=<iscrizioneId>`
(oppure `http://127.0.0.1:5500/...` o `http://localhost:5500/...` se il form è stato aperto con Live Server).

Errori (`HttpsError` con `details.motivo`):
`chiuse`, `non-valido` (con `details.errori`: elenco messaggi), `nome-preso`, `email-usata`,
`importo-cambiato` (con `details.importo`), `evento-cambiato`, `documento-mancante`,
`gia-pagata` (se `sostituisci` indica un'iscrizione già pagata; con `details.importo`),
`pagamento-non-disponibile` (SumUp non risponde: l'iscrizione non viene creata).

### `verificaPagamento`
Richiesta `{ eventoId, iscrizioneId }` (il proprietario `uid` o un admin, dal pulsante
"Ricontrolla il pagamento" di ps-admin). Chiede lo stato del
checkout a SumUp, aggiorna l'iscrizione se pagata (e invia l'email di conferma) e risponde
`{ stato, importo }` con `stato` tra quelli dell'iscrizione oppure `fallito` (pagamento
rifiutato) o `inesistente` (iscrizione cancellata dalla pulizia).

### `riprendiPagamento`
Richiesta `{ eventoId, iscrizioneId }` (solo il proprietario, solo se in attesa). Risponde
`{ stato, checkoutUrl }` con un checkout valido (riusato o nuovo), oppure `{ stato: "pagata", importo }`.
Errore `details.motivo = "scaduta"` se l'iscrizione non esiste più.

### Funzioni interne
- `sumupWebhook` (HTTP, indirizzo `https://europe-west1-otpgea-iscrizioni.cloudfunctions.net/sumupWebhook`):
  SumUp la chiama quando cambia lo stato di un checkout. La notifica non è firmata, quindi
  la funzione rilegge sempre il checkout dall'API SumUp prima di confermare.
- `pulizia` (ogni ora): cancella le iscrizioni non pagate scadute (2 ore, prolungate se
  l'utente riprova il pagamento) dopo aver controllato su SumUp che non siano state pagate
  e aver disattivato le pagine di pagamento; libera nome ed email; cancella i file
  temporanei di `caricamenti/` più vecchi di 3 ore.
- Anomalie (pagamento con importo diverso, pagamento su iscrizione annullata o già
  cancellata): l'iscrizione non viene confermata e arriva un'email a tutti gli admin.

### Come sono fatte
- `index.js`: collegamento con Firebase (regione, segreti, tipi di funzione).
- `logica.js`: tutta la logica; `sumup.js`: chiamate alle API SumUp; `email.js`: testi email.
- `comune.js`: copia automatica di `iscrizioni-comune.js` (non modificarla, non è nel repository).
- `test/`: 29 test automatici con Firestore, Storage e SumUp simulati (`npm test`).

---

## Pubblicare le Cloud Functions

### Una volta sola: preparazione del PC
In PowerShell:

1. Installare la Firebase CLI: `npm install -g firebase-tools`, poi controllare con
   `firebase --version`. Se PowerShell risponde che "l'esecuzione di script è disabilitata",
   eseguire una volta `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` e riprovare.
2. Accedere: `firebase login` (si apre il browser: usare l'account Google proprietario del
   progetto Firebase).
3. Entrare nella cartella delle funzioni e installare le librerie:
   ```
   cd "C:\Users\ricca\Documents\OTPGEA Orienteering ASD APS\Siti\principale\firebase\functions"
   npm install
   npm test
   ```
   `npm test` deve chiudersi con `# pass 29` e `# fail 0`.

### Una volta sola: credenziali SumUp di prova (sandbox)
1. Entrare in SumUp (me.sumup.com) e aprire Impostazioni → Sviluppatore
   (https://me.sumup.com/settings/developer?tab=sandboxes): nella scheda **Sandboxes** creare
   un account commerciante di prova e passare a quell'account.
2. Nella pagina delle chiavi API (https://me.sumup.com/settings/api-keys) creare una
   **chiave segreta** (non quella pubblica `sup_pk_...`). Va trattata come una password:
   non deve mai finire nel sito né nel repository.
3. Annotare il **codice commerciante** (merchant code) dell'account di prova.
4. Salvare i due valori come segreti di Firebase (sempre dalla cartella `functions`):
   ```
   firebase functions:secrets:set SUMUP_API_KEY --project otpgea-iscrizioni
   firebase functions:secrets:set SUMUP_MERCHANT_CODE --project otpgea-iscrizioni
   ```
   Dopo il comando va scritto il **nome** del segreto (come sopra), non il valore: il valore si
   incolla quando la CLI chiede "Enter a value" (non viene mostrato mentre si incolla; poi Invio).
   La prima volta la CLI chiede di attivare Secret Manager: rispondere sì.

> **Attenzione al progetto.** Tutti i comandi Firebase di questo sistema vanno lanciati dalla
> cartella `firebase\functions` e, per sicurezza, con `--project otpgea-iscrizioni` (gli script
> `npm run deploy` e `npm run logs` lo fanno già). Il 14/11/2026 una prima pubblicazione era
> finita sul progetto di un'altra app perché la CLI ricordava una scelta precedente di
> `firebase use`: per correggere, dalla cartella `firebase\functions`, `firebase use otpgea-iscrizioni`.
> Controllo rapido dopo la pubblicazione: aprendo nel browser
> `https://europe-west1-otpgea-iscrizioni.cloudfunctions.net/creaIscrizione` deve comparire
> `{"error":{"message":"Bad Request",...}}` (errore 400, normale); un 404 significa che le
> funzioni non sono su questo progetto.

### Pubblicazione (prima volta e ogni aggiornamento)
Dalla cartella `functions`:
```
npm run deploy
```
Il comando aggiorna `comune.js`, esegue i test e pubblica le funzioni. La prima volta Firebase
attiva i servizi necessari (Cloud Functions, Cloud Build, Artifact Registry, Cloud Run,
Eventarc, Cloud Scheduler) e può impiegare diversi minuti; se la prima pubblicazione fallisce
per permessi "non ancora propagati", aspettare qualche minuto e ripetere. Se chiede per quanti
giorni conservare le immagini dei container, accettare la proposta.

**Ogni volta che si modifica `iscrizioni-comune.js`** (regole di calcolo o controllo) bisogna
rieseguire `npm run deploy`, altrimenti form e server non coincidono.

Registri delle funzioni: `npm run logs` oppure console Firebase → Functions → Registri.

### Passaggio all'account SumUp reale (Fase F)
Ripetere i due comandi `firebase functions:secrets:set ... --project otpgea-iscrizioni` con chiave
e codice commerciante dell'account dell'associazione, poi `npm run deploy`. Le vecchie versioni dei
segreti si possono poi eliminare con `firebase functions:secrets:destroy NOME@versione --project otpgea-iscrizioni`.

### Prove con la sandbox
- Carta che va a buon fine: VISA `4200 0000 0000 0091`, scadenza futura (es. `12/30`), CVV `123`.
- Pagamento rifiutato: in sandbox un importo di **11 €** fallisce sempre.
- Pagina SumUp chiusa senza pagare: l'iscrizione resta "in attesa" e viene cancellata dalla
  pulizia dopo circa 2 ore (fino a un'ora di ritardo).
