// Test della logica delle Cloud Functions con Firestore, Storage e SumUp simulati.
// Esecuzione: "npm test" nella cartella functions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as L from '../logica.js';
import { emailConferma } from '../email.js';
import { FintoDb, FintoBucket, FintoSumUp, logMuto } from './finti.js';

const ADESSO = new Date('2026-11-20T10:00:00Z');
const UID = 'utente1';
const EV = 'ps-2027';

function evento(modifiche = {}) {
    return {
        titolo: 'Piacenza Svelata 2027', data: '2027-04-18', luogo: 'Piacenza', iscrizioniAperte: true,
        email: { oggettoConferma: 'Confermata {squadra}', testoConferma: 'Ciao {squadra} <ok>, {categoria}, {importo}, {data}.' },
        categorie: [
            {
                id: 'competitiva', nome: 'Competitiva', attiva: true, componentiMin: 2, componentiMax: 4,
                quota: { tipo: 'persona', scaglioni: [{ finoAl: '2027-04-01', euro: 5 }, { finoAl: null, euro: 10 }] },
                gratuitoSottoEta: 12, etaMinima: null, etaMassima: null, unaSquadraPerEmail: true,
                documenti: [{ id: 'certificato', nome: 'Certificato medico', per: 'componente', obbligatorio: true, sanitario: true }],
                campiSquadra: [{ id: 'telefono', etichetta: 'Telefono', tipo: 'telefono', obbligatorio: true, opzioni: [] }],
                campiComponente: []
            },
            {
                id: 'ludica', nome: 'Ludica', attiva: true, componentiMin: 1, componentiMax: 6,
                quota: { tipo: 'gratuita', scaglioni: [] }, unaSquadraPerEmail: true,
                documenti: [], campiSquadra: [], campiComponente: []
            },
            {
                id: 'scuole', nome: 'Scuole', attiva: true, componentiMin: 1, componentiMax: 3,
                quota: { tipo: 'squadra', scaglioni: [{ finoAl: null, euro: 12.5 }] }, unaSquadraPerEmail: false,
                documenti: [], campiSquadra: [], campiComponente: []
            }
        ],
        ...modifiche
    };
}

function ambiente() {
    const db = new FintoDb();
    const bucket = new FintoBucket();
    const sumup = new FintoSumUp();
    let ora = new Date(ADESSO);
    const dep = {
        db, bucket, sumup, log: logMuto,
        ora: () => new Date(ora),
        urlWebhook: 'https://europe-west1-otpgea-iscrizioni.cloudfunctions.net/sumupWebhook'
    };
    db.dati.set(`eventi/${EV}`, evento());
    db.dati.set('admin/riccardo.fava1@gmail.com', {});
    db.dati.set('admin/ori.otpgea@gmail.com', {});
    const creato = ADESSO.toISOString();
    bucket.aggiungi(`caricamenti/${UID}/certificato-c0-a.pdf`, { contentType: 'application/pdf', timeCreated: creato });
    bucket.aggiungi(`caricamenti/${UID}/certificato-c1-b.jpg`, { contentType: 'image/jpeg', timeCreated: creato });
    return { db, bucket, sumup, dep, avanza: minuti => { ora = new Date(ora.getTime() + minuti * 60e3); } };
}

function datiCompetitiva(modifiche = {}) {
    return {
        categoriaId: 'competitiva', nomeSquadra: 'Le Volpi', email: 'Volpi@Example.com',
        campiSquadra: { telefono: '333 1234567', estraneo: 'x' },
        componenti: [
            { nome: 'Mario', cognome: 'Rossi', dataNascita: '1985-03-04', campi: {}, documenti: { certificato: `caricamenti/${UID}/certificato-c0-a.pdf` } },
            { nome: 'Luca', cognome: 'Rossi', dataNascita: '2017-05-01', campi: {}, documenti: { certificato: `caricamenti/${UID}/certificato-c1-b.jpg` } }
        ],
        documentiSquadra: {},
        consensi: { regolamento: true, privacy: true, datiSanitari: true },
        ...modifiche
    };
}

async function crea(env, { dati = datiCompetitiva(), totaleAtteso = 5, sostituisci = null, uid = UID, origine = 'http://127.0.0.1:5500' } = {}) {
    return L.creaIscrizione(env.dep, { uid, input: { eventoId: EV, dati, totaleAtteso, sostituisci }, origine });
}

async function rifiuta(promessa, motivo) {
    await assert.rejects(promessa, e => {
        assert.ok(e instanceof L.ErroreUtente, `errore inatteso: ${e.message}`);
        assert.equal(e.dettagli.motivo, motivo);
        return true;
    });
}

const mail = db => db.chiavi('mail/').map(k => db.leggi(k));

/* ------------------------------------------------------------------------ */

test('comune.js è identico a iscrizioni-comune.js del sito', () => {
    const qui = readFileSync(fileURLToPath(new URL('../comune.js', import.meta.url)), 'utf8');
    const sito = readFileSync(fileURLToPath(new URL('../../../iscrizioni-comune.js', import.meta.url)), 'utf8');
    assert.equal(qui.split('\n').slice(1).join('\n'), sito);
});

test('iscrizione a pagamento: prenotazioni, file, checkout SumUp', async () => {
    const env = ambiente();
    const r = await crea(env);
    assert.equal(r.stato, 'in_attesa_pagamento');
    assert.equal(r.importo, 5);
    assert.equal(r.checkoutUrl, 'https://checkout.sumup.com/pay/chk-1');

    const iscr = env.db.leggi(`eventi/${EV}/iscrizioni/${r.iscrizioneId}`);
    assert.equal(iscr.nomeSlug, 'le-volpi');
    assert.equal(iscr.emailNorm, 'volpi@example.com');
    assert.deepEqual(iscr.campiSquadra, { telefono: '333 1234567' }, 'campi non previsti scartati');
    assert.equal(iscr.componenti[1].gratuito, true);
    assert.deepEqual(iscr.dettaglioImporto, { tipo: 'persona', euroUnitario: 5, paganti: 1, gratuiti: 1 });
    assert.equal(iscr.componenti[0].documenti.certificato, `eventi/${EV}/${r.iscrizioneId}/certificato-c0-a.pdf`);
    assert.ok(env.bucket.oggetti.has(`eventi/${EV}/${r.iscrizioneId}/certificato-c1-b.jpg`), 'file copiato');
    assert.ok(env.bucket.oggetti.has(`caricamenti/${UID}/certificato-c0-a.pdf`), 'originale conservato');
    assert.equal(iscr.scadeIl.getTime(), ADESSO.getTime() + 2 * 3600e3);
    assert.ok(iscr.consensi.datiSanitari instanceof Date);
    assert.equal(iscr.sumup.checkoutId, 'chk-1');
    assert.equal(iscr.emailConfermaInviata, false);

    assert.ok(env.db.leggi(`eventi/${EV}/nomiSquadre/le-volpi`));
    assert.equal(env.db.leggi(`eventi/${EV}/emailUsate/volpi@example.com`).iscrizioneId, r.iscrizioneId);

    const c = env.sumup.creati[0];
    assert.equal(c.importo, 5);
    assert.equal(c.riferimento, `${r.iscrizioneId}-1`);
    assert.equal(c.redirectUrl, `http://127.0.0.1:5500/ps-form-iscrizioni.html?evento=${EV}&ritorno=1&iscrizione=${r.iscrizioneId}`);
    assert.equal(c.returnUrl, `https://europe-west1-otpgea-iscrizioni.cloudfunctions.net/sumupWebhook?e=${EV}&i=${r.iscrizioneId}`);
    assert.equal(mail(env.db).length, 0);
});

test('origine sconosciuta: il ritorno va al sito ufficiale', async () => {
    const env = ambiente();
    await crea(env, { origine: 'https://sito-falso.example' });
    assert.ok(env.sumup.creati[0].redirectUrl.startsWith('https://www.orienteeringpiacenza.it/ps-form-iscrizioni.html?'));
});

test('webhook PAID: iscrizione pagata ed email di conferma, una sola volta', async () => {
    const env = ambiente();
    const r = await crea(env);
    env.sumup.paga('chk-1');
    assert.equal(await L.webhook(env.dep, { query: { e: EV, i: r.iscrizioneId }, body: { event_type: 'CHECKOUT_STATUS_CHANGED', id: 'chk-1' } }), 'pagata');
    const iscr = env.db.leggi(`eventi/${EV}/iscrizioni/${r.iscrizioneId}`);
    assert.equal(iscr.stato, 'pagata');
    assert.equal(iscr.sumup.transactionCode, 'TXCHK-1');
    assert.equal(iscr.scadeIl, null);
    assert.equal(iscr.emailConfermaInviata, true);
    const m = mail(env.db);
    assert.equal(m.length, 1);
    assert.equal(m[0].to, 'Volpi@Example.com');
    assert.equal(m[0].message.subject, 'Confermata Le Volpi');
    assert.match(m[0].message.text, /Ciao Le Volpi <ok>, Competitiva, 5,00\s€, 18 aprile 2027\./);
    assert.match(m[0].message.html, /Ciao Le Volpi &lt;ok&gt;/);
    // seconda notifica e verifica dal form: nessun doppione
    await L.webhook(env.dep, { query: { e: EV, i: r.iscrizioneId }, body: { id: 'chk-1' } });
    assert.deepEqual(await L.verificaPagamento(env.dep, { uid: UID, input: { eventoId: EV, iscrizioneId: r.iscrizioneId } }), { stato: 'pagata', importo: 5 });
    assert.equal(mail(env.db).length, 1);
});

test('webhook con checkout di un\'altra iscrizione o dati mancanti: ignorato', async () => {
    const env = ambiente();
    const r = await crea(env);
    env.sumup.paga('chk-1');
    assert.equal(await L.webhook(env.dep, { query: { e: EV, i: 'altraIscrizione' }, body: { id: 'chk-1' } }), 'ignorato');
    assert.equal(await L.webhook(env.dep, { query: {}, body: {} }), 'ignorato');
    assert.equal(env.db.leggi(`eventi/${EV}/iscrizioni/${r.iscrizioneId}`).stato, 'in_attesa_pagamento');
});

test('webhook quando SumUp non risponde: errore (SumUp ritenterà)', async () => {
    const env = ambiente();
    const r = await crea(env);
    env.sumup.guasto = true;
    await assert.rejects(L.webhook(env.dep, { query: { e: EV, i: r.iscrizioneId }, body: { id: 'chk-1' } }));
});

test('importo pagato diverso: non confermata, avviso agli admin', async () => {
    const env = ambiente();
    const r = await crea(env);
    env.sumup.paga('chk-1', 1);
    await L.webhook(env.dep, { query: { e: EV, i: r.iscrizioneId }, body: { id: 'chk-1' } });
    assert.equal(env.db.leggi(`eventi/${EV}/iscrizioni/${r.iscrizioneId}`).stato, 'in_attesa_pagamento');
    const m = mail(env.db);
    assert.equal(m.length, 1);
    assert.deepEqual(m[0].to.sort(), ['ori.otpgea@gmail.com', 'riccardo.fava1@gmail.com']);
    assert.match(m[0].message.subject, /Importo pagato diverso/);
});

test('pagamento su iscrizione annullata dall\'admin: resta annullata, avviso', async () => {
    const env = ambiente();
    const r = await crea(env);
    await env.db.doc(`eventi/${EV}/iscrizioni/${r.iscrizioneId}`).update({ stato: 'annullata' });
    env.sumup.paga('chk-1');
    await L.webhook(env.dep, { query: { e: EV, i: r.iscrizioneId }, body: { id: 'chk-1' } });
    const iscr = env.db.leggi(`eventi/${EV}/iscrizioni/${r.iscrizioneId}`);
    assert.equal(iscr.stato, 'annullata');
    assert.equal(iscr.sumup.transactionCode, 'TXCHK-1');
    assert.match(mail(env.db)[0].message.subject, /annullata/);
});

test('categoria gratuita: confermata subito con email, nessun checkout', async () => {
    const env = ambiente();
    const r = await crea(env, {
        dati: { categoriaId: 'ludica', nomeSquadra: 'Famiglia', email: 'f@example.com', componenti: [{ nome: 'A', cognome: 'B' }], consensi: { regolamento: true, privacy: true } },
        totaleAtteso: 0
    });
    assert.deepEqual(r, { iscrizioneId: r.iscrizioneId, stato: 'confermata_gratuita', importo: 0 });
    const iscr = env.db.leggi(`eventi/${EV}/iscrizioni/${r.iscrizioneId}`);
    assert.equal(iscr.stato, 'confermata_gratuita');
    assert.equal(iscr.scadeIl, null);
    assert.equal(env.sumup.creati.length, 0);
    assert.equal(mail(env.db).length, 1);
    assert.match(mail(env.db)[0].message.text, /gratuita/);
});

test('errori: chiuse, categoria nascosta, dati non validi, importo cambiato', async () => {
    const env = ambiente();
    env.db.dati.set(`eventi/${EV}`, evento({ iscrizioniAperte: false }));
    await rifiuta(crea(env), 'chiuse');

    const ev = evento(); ev.categorie[0].attiva = false;
    env.db.dati.set(`eventi/${EV}`, ev);
    await rifiuta(crea(env), 'evento-cambiato');

    env.db.dati.set(`eventi/${EV}`, evento());
    await rifiuta(crea(env, { dati: datiCompetitiva({ nomeSquadra: '!!!' }) }), 'non-valido');
    await rifiuta(crea(env, { dati: datiCompetitiva({ consensi: { regolamento: true, privacy: true } }) }), 'non-valido');
    await assert.rejects(crea(env, { totaleAtteso: 10 }), e => e.dettagli.motivo === 'importo-cambiato' && e.dettagli.importo === 5);
    await assert.rejects(L.creaIscrizione(env.dep, { uid: null, input: {} }), e => e.codice === 'unauthenticated');
    await assert.rejects(L.creaIscrizione(env.dep, { uid: UID, input: { eventoId: '../x' } }), e => e.codice === 'invalid-argument');
    assert.equal(env.db.chiavi(`eventi/${EV}/`).length, 0, 'nessuna scrittura');
});

test('dopo la scadenza del primo scaglione vale il secondo', async () => {
    const env = ambiente();
    env.dep.ora = () => new Date('2027-04-02T08:00:00Z');
    await rifiuta(crea(env, { totaleAtteso: 5 }), 'importo-cambiato');
    const r = await crea(env, { totaleAtteso: 10 });
    assert.equal(r.importo, 10);
});

test('documenti: file di un altro utente, mancante o di tipo sbagliato rifiutati', async () => {
    const env = ambiente();
    const d1 = datiCompetitiva();
    d1.componenti[0].documenti.certificato = 'caricamenti/altro/certificato-c0-a.pdf';
    await rifiuta(crea(env, { dati: d1 }), 'documento-mancante');
    const d2 = datiCompetitiva();
    d2.componenti[0].documenti.certificato = `caricamenti/${UID}/inesistente.pdf`;
    await rifiuta(crea(env, { dati: d2 }), 'documento-mancante');
    env.bucket.aggiungi(`caricamenti/${UID}/strano.pdf`, { contentType: 'text/html' });
    const d3 = datiCompetitiva();
    d3.componenti[0].documenti.certificato = `caricamenti/${UID}/strano.pdf`;
    await rifiuta(crea(env, { dati: d3 }), 'documento-mancante');
    const d4 = datiCompetitiva();
    delete d4.componenti[1].documenti.certificato;
    await rifiuta(crea(env, { dati: d4 }), 'non-valido');
});

test('nome squadra unico (normalizzato) ed email unica', async () => {
    const env = ambiente();
    await crea(env);
    await rifiuta(crea(env, { dati: datiCompetitiva({ nomeSquadra: 'LE  VOLPÌ', email: 'altro@example.com' }), uid: UID }), 'nome-preso');
    await rifiuta(crea(env, { dati: datiCompetitiva({ nomeSquadra: 'I Gufi', email: ' volpi@example.COM ' }) }), 'email-usata');
});

test('categoria senza "una squadra per email": stessa email ammessa', async () => {
    const env = ambiente();
    const dati = n => ({ categoriaId: 'scuole', nomeSquadra: n, email: 'prof@scuola.it', componenti: [{ nome: 'A', cognome: 'B' }], consensi: { regolamento: true, privacy: true } });
    const a = await crea(env, { dati: dati('Classe 3A'), totaleAtteso: 12.5 });
    const b = await crea(env, { dati: dati('Classe 3B'), totaleAtteso: 12.5 });
    assert.notEqual(a.iscrizioneId, b.iscrizioneId);
    assert.equal(env.db.chiavi(`eventi/${EV}/emailUsate/`).length, 0);
});

test('SumUp non disponibile alla creazione: nulla resta prenotato', async () => {
    const env = ambiente();
    env.sumup.guasto = true;
    await rifiuta(crea(env), 'pagamento-non-disponibile');
    assert.equal(env.db.chiavi(`eventi/${EV}/`).length, 0);
    assert.equal([...env.bucket.oggetti.keys()].filter(k => k.startsWith('eventi/')).length, 0);
});

test('sostituisci: nuova iscrizione con lo stesso nome, la vecchia sparisce', async () => {
    const env = ambiente();
    const vecchia = await crea(env);
    const nuova = await crea(env, { sostituisci: vecchia.iscrizioneId, dati: datiCompetitiva({ email: 'nuova@example.com' }) });
    assert.ok(!env.db.leggi(`eventi/${EV}/iscrizioni/${vecchia.iscrizioneId}`));
    assert.ok(env.db.leggi(`eventi/${EV}/iscrizioni/${nuova.iscrizioneId}`));
    assert.ok(env.db.leggi(`eventi/${EV}/nomiSquadre/le-volpi`));
    assert.ok(!env.db.leggi(`eventi/${EV}/emailUsate/volpi@example.com`), 'vecchia email liberata');
    assert.ok(env.db.leggi(`eventi/${EV}/emailUsate/nuova@example.com`));
    assert.deepEqual(env.sumup.disattivati, ['chk-1']);
    assert.equal([...env.bucket.oggetti.keys()].filter(k => k.startsWith(`eventi/${EV}/${vecchia.iscrizioneId}/`)).length, 0);
});

test('sostituisci un\'iscrizione già pagata su SumUp: gia-pagata, e viene registrata', async () => {
    const env = ambiente();
    const vecchia = await crea(env);
    env.sumup.paga('chk-1');
    await rifiuta(crea(env, { sostituisci: vecchia.iscrizioneId }), 'gia-pagata');
    assert.equal(env.db.leggi(`eventi/${EV}/iscrizioni/${vecchia.iscrizioneId}`).stato, 'pagata');
});

test('sostituisci di un altro utente: ignorato (il nome resta occupato)', async () => {
    const env = ambiente();
    const vecchia = await crea(env);
    env.bucket.aggiungi('caricamenti/utente2/certificato-c0-a.pdf');
    env.bucket.aggiungi('caricamenti/utente2/certificato-c1-b.jpg', { contentType: 'image/jpeg' });
    const d = datiCompetitiva({ email: 'x@example.com' });
    d.componenti[0].documenti.certificato = 'caricamenti/utente2/certificato-c0-a.pdf';
    d.componenti[1].documenti.certificato = 'caricamenti/utente2/certificato-c1-b.jpg';
    await rifiuta(crea(env, { uid: 'utente2', sostituisci: vecchia.iscrizioneId, dati: d }), 'nome-preso');
    assert.ok(env.db.leggi(`eventi/${EV}/iscrizioni/${vecchia.iscrizioneId}`));
});

test('verificaPagamento: fallito, in attesa, altro utente, admin, inesistente', async () => {
    const env = ambiente();
    const r = await crea(env);
    const input = { eventoId: EV, iscrizioneId: r.iscrizioneId };
    assert.deepEqual(await L.verificaPagamento(env.dep, { uid: UID, input }), { stato: 'in_attesa_pagamento', importo: 5 });
    env.sumup.fallisci('chk-1');
    assert.deepEqual(await L.verificaPagamento(env.dep, { uid: UID, input }), { stato: 'fallito', importo: 5 });
    await assert.rejects(L.verificaPagamento(env.dep, { uid: 'intruso', input }), e => e.codice === 'permission-denied');
    assert.equal((await L.verificaPagamento(env.dep, { uid: 'admin', admin: true, input })).stato, 'fallito');
    assert.deepEqual(await L.verificaPagamento(env.dep, { uid: UID, input: { eventoId: EV, iscrizioneId: 'nonCe' } }), { stato: 'inesistente' });
});

test('riprendiPagamento: riusa la pagina se recente, altrimenti ne crea una nuova', async () => {
    const env = ambiente();
    const r = await crea(env);
    const input = { eventoId: EV, iscrizioneId: r.iscrizioneId };
    assert.equal((await L.riprendiPagamento(env.dep, { uid: UID, input })).checkoutUrl, 'https://checkout.sumup.com/pay/chk-1');
    env.avanza(26);
    const r2 = await L.riprendiPagamento(env.dep, { uid: UID, input, origine: 'https://www.orienteeringpiacenza.it' });
    assert.equal(r2.checkoutUrl, 'https://checkout.sumup.com/pay/chk-2');
    assert.deepEqual(env.sumup.disattivati, ['chk-1']);
    const iscr = env.db.leggi(`eventi/${EV}/iscrizioni/${r.iscrizioneId}`);
    assert.equal(iscr.sumup.tentativi, 2);
    assert.deepEqual(iscr.sumup.checkoutPrecedenti, ['chk-1']);
    assert.equal(env.sumup.creati[1].riferimento, `${r.iscrizioneId}-2`);
    // pagamento fallito: nuova pagina anche se recente
    env.sumup.fallisci('chk-2');
    assert.equal((await L.riprendiPagamento(env.dep, { uid: UID, input })).checkoutUrl, 'https://checkout.sumup.com/pay/chk-3');
    // pagata sulla pagina precedente: viene riconosciuta
    env.sumup.checkout.get('chk-1').status = 'PENDING';
    env.sumup.paga('chk-1');
    assert.deepEqual(await L.riprendiPagamento(env.dep, { uid: UID, input }), { stato: 'pagata', importo: 5 });
});

test('riprendiPagamento vicino alla scadenza prolunga la validità', async () => {
    const env = ambiente();
    const r = await crea(env);
    env.avanza(110);
    await L.riprendiPagamento(env.dep, { uid: UID, input: { eventoId: EV, iscrizioneId: r.iscrizioneId } });
    const iscr = env.db.leggi(`eventi/${EV}/iscrizioni/${r.iscrizioneId}`);
    assert.equal(iscr.scadeIl.getTime(), ADESSO.getTime() + (110 + 40) * 60e3);
});

test('riprendiPagamento: scaduta, annullata, altro utente', async () => {
    const env = ambiente();
    await rifiuta(L.riprendiPagamento(env.dep, { uid: UID, input: { eventoId: EV, iscrizioneId: 'nonCe' } }), 'scaduta');
    const r = await crea(env);
    await assert.rejects(L.riprendiPagamento(env.dep, { uid: 'x', input: { eventoId: EV, iscrizioneId: r.iscrizioneId } }), e => e.codice === 'permission-denied');
    await env.db.doc(`eventi/${EV}/iscrizioni/${r.iscrizioneId}`).update({ stato: 'annullata' });
    await rifiuta(L.riprendiPagamento(env.dep, { uid: UID, input: { eventoId: EV, iscrizioneId: r.iscrizioneId } }), 'annullata');
});

test('pulizia: cancella le scadute non pagate, registra quelle pagate, file temporanei', async () => {
    const env = ambiente();
    const nonPagata = await crea(env);
    const pagata = await crea(env, { dati: datiCompetitiva({ nomeSquadra: 'I Gufi', email: 'gufi@example.com' }) });
    env.avanza(30);
    const recente = await crea(env, { dati: datiCompetitiva({ nomeSquadra: 'I Lupi', email: 'lupi@example.com' }) });
    env.sumup.paga('chk-2');
    // file temporanei: uno vecchio, uno recente
    env.bucket.aggiungi('caricamenti/vecchio/x.pdf', { timeCreated: new Date(ADESSO.getTime() - 4 * 3600e3).toISOString() });
    env.bucket.aggiungi('caricamenti/nuovo/y.pdf', { timeCreated: new Date(ADESSO.getTime() + 100 * 60e3).toISOString() });
    env.avanza(100); // la prima e la seconda sono scadute, la terza no

    const res = await L.pulizia(env.dep);
    assert.deepEqual(res, { eliminate: 1, pagate: 1, errori: 0, file: 1 }); // solo caricamenti/vecchio (gli altri hanno meno di 3 ore)
    assert.ok(!env.db.leggi(`eventi/${EV}/iscrizioni/${nonPagata.iscrizioneId}`));
    assert.ok(!env.db.leggi(`eventi/${EV}/nomiSquadre/le-volpi`), 'nome liberato');
    assert.ok(!env.db.leggi(`eventi/${EV}/emailUsate/volpi@example.com`), 'email liberata');
    assert.ok(env.sumup.disattivati.includes('chk-1'));
    assert.equal([...env.bucket.oggetti.keys()].filter(k => k.startsWith(`eventi/${EV}/${nonPagata.iscrizioneId}/`)).length, 0);
    assert.equal(env.db.leggi(`eventi/${EV}/iscrizioni/${pagata.iscrizioneId}`).stato, 'pagata');
    assert.equal(env.db.leggi(`eventi/${EV}/iscrizioni/${recente.iscrizioneId}`).stato, 'in_attesa_pagamento');
    assert.ok(!env.bucket.oggetti.has('caricamenti/vecchio/x.pdf'));
    assert.ok(env.bucket.oggetti.has('caricamenti/nuovo/y.pdf'));
});

test('pulizia con SumUp non raggiungibile: non cancella nulla', async () => {
    const env = ambiente();
    const r = await crea(env);
    env.avanza(200);
    env.sumup.guasto = true;
    const res = await L.pulizia(env.dep);
    assert.equal(res.errori, 1);
    assert.ok(env.db.leggi(`eventi/${EV}/iscrizioni/${r.iscrizioneId}`));
});

test('pulizia: il nome non si libera se un\'altra iscrizione valida lo usa', async () => {
    const env = ambiente();
    const r = await crea(env);
    // un admin ha annullato liberando il nome, poi un'altra squadra lo ha preso
    env.db.dati.set(`eventi/${EV}/iscrizioni/altra`, { nomeSlug: 'le-volpi', stato: 'pagata' });
    env.avanza(200);
    await L.pulizia(env.dep);
    assert.ok(env.db.leggi(`eventi/${EV}/nomiSquadre/le-volpi`));
});

test('email di conferma con testo predefinito', () => {
    const m = emailConferma({ titolo: 'Evento', data: '2027-04-18', luogo: 'Piacenza' }, { email: 'a@b.it', nomeSquadra: 'X', categoria: { nome: 'C' }, importo: 12.5 });
    assert.equal(m.message.subject, 'Iscrizione confermata – Evento – X');
    assert.match(m.message.text, /Importo: 12,50\s€/);
    assert.match(m.message.text, /18 aprile 2027 a Piacenza/);
});
