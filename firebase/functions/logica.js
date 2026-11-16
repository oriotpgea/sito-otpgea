// =============================================================================
// Logica del sistema iscrizioni (Cloud Functions)
// Non dipende direttamente da Firebase: riceve "dep" con
//   db      – Firestore (firebase-admin)
//   bucket  – bucket Storage (firebase-admin)
//   sumup   – client creato da sumup.js
//   ora     – funzione che restituisce la data/ora attuale
//   urlWebhook – indirizzo pubblico della funzione sumupWebhook
//   log     – logger ({ info, warn, error })
// così si può collaudare con versioni simulate (cartella test/).
// =============================================================================

import * as R from './comune.js';
import { emailConferma, emailAvvisoAdmin, fmtEuro, fmtDataStr } from './email.js';

export const SITO = 'https://www.orienteeringpiacenza.it';
// Indirizzi da cui può arrivare il form (il ritorno da SumUp torna allo stesso indirizzo)
export const ORIGINI_AMMESSE = [
    SITO,
    'https://orienteeringpiacenza.it',
    'http://127.0.0.1:5500',
    'http://localhost:5500'
];

export const ORE_VALIDITA_ISCRIZIONE = 2;   // poi la pulizia cancella le iscrizioni non pagate
export const ORE_VALIDITA_CARICAMENTI = 3;  // file temporanei in caricamenti/
export const MINUTI_RIUSO_CHECKOUT = 25;    // la pagina SumUp dura 30 minuti
export const MINUTI_MARGINE_PAGAMENTO = 40; // tempo garantito dopo "Riprova il pagamento"
export const MAX_TENTATIVI_PAGAMENTO = 10;
export const MAX_COMPONENTI = 50;
export const MAX_BYTES_FILE = 5 * 1024 * 1024;

const RE_ID_EVENTO     = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RE_ID_ISCRIZIONE = /^[A-Za-z0-9]{1,40}$/;
const RE_TIPO_FILE     = /^(image\/(jpeg|png)|application\/pdf)$/;

/* ----------------------------------------------------------------- errori */

// Errore da mostrare all'utente: index.js lo converte in HttpsError
export class ErroreUtente extends Error {
    constructor(codice, motivo, messaggio, extra = {}) {
        super(messaggio);
        this.codice = codice;
        this.dettagli = { motivo, ...extra };
    }
}
const errore = (codice, motivo, messaggio, extra) => new ErroreUtente(codice, motivo, messaggio, extra);

/* ----------------------------------------------------------------- utilità */

export function ms(t) {
    if (!t) return 0;
    if (typeof t.toMillis === 'function') return t.toMillis();
    if (t instanceof Date) return t.getTime();
    return 0;
}

function testo(v, max) {
    // Taglia a max+1 caratteri: i controlli comuni segnalano poi i testi troppo lunghi
    return typeof v === 'string' ? v.trim().slice(0, max + 1) : '';
}

function pulisciCampi(defs, valori) {
    const out = {};
    for (const def of defs || []) {
        const v = valori && typeof valori === 'object' ? valori[def.id] : undefined;
        out[def.id] = def.tipo === 'casella' ? v === true : testo(v, R.MAX_CAMPO);
    }
    return out;
}

function pulisciDocumenti(defs, valori, per) {
    const out = {};
    for (const def of defs || []) {
        if (def.per !== per) continue;
        const v = valori && typeof valori === 'object' ? valori[def.id] : undefined;
        if (typeof v === 'string' && v) out[def.id] = v.slice(0, 300);
    }
    return out;
}

// Copia "pulita" dei dati ricevuti dal form: solo i campi previsti dalla categoria
export function pulisciDati(raw, cat) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const chiediData = R.richiedeDataNascita(cat);
    const componenti = (Array.isArray(r.componenti) ? r.componenti : []).map(c => {
        const x = c && typeof c === 'object' ? c : {};
        return {
            nome: testo(x.nome, R.MAX_NOME_PERSONA),
            cognome: testo(x.cognome, R.MAX_NOME_PERSONA),
            ...(chiediData ? { dataNascita: typeof x.dataNascita === 'string' ? x.dataNascita.slice(0, 10) : '' } : {}),
            campi: pulisciCampi(cat.campiComponente, x.campi),
            documenti: pulisciDocumenti(cat.documenti, x.documenti, 'componente')
        };
    });
    const consensi = r.consensi && typeof r.consensi === 'object' ? r.consensi : {};
    return {
        categoriaId: cat.id,
        nomeSquadra: testo(r.nomeSquadra, R.MAX_NOME_SQUADRA),
        email: testo(r.email, R.MAX_EMAIL),
        campiSquadra: pulisciCampi(cat.campiSquadra, r.campiSquadra),
        componenti,
        documentiSquadra: pulisciDocumenti(cat.documenti, r.documentiSquadra, 'squadra'),
        consensi: {
            regolamento: consensi.regolamento === true,
            privacy: consensi.privacy === true,
            ...(R.haDocumentiSanitari(cat) ? { datiSanitari: consensi.datiSanitari === true } : {})
        }
    };
}

function baseSito(origine) {
    return ORIGINI_AMMESSE.includes(origine) ? origine : SITO;
}

function urlRitorno(origine, eventoId, iscrizioneId) {
    return `${baseSito(origine)}/ps-form-iscrizioni.html?evento=${encodeURIComponent(eventoId)}&ritorno=1&iscrizione=${encodeURIComponent(iscrizioneId)}`;
}

async function eliminaFile(dep, percorsi) {
    for (const p of percorsi) {
        try { await dep.bucket.file(p).delete({ ignoreNotFound: true }); }
        catch (e) { dep.log.warn(`File non eliminato: ${p}`, e); }
    }
}

async function eliminaCartella(dep, prefisso) {
    try {
        const [files] = await dep.bucket.getFiles({ prefix: prefisso });
        await eliminaFile(dep, files.map(f => f.name));
    } catch (e) {
        dep.log.warn(`Cartella non eliminata: ${prefisso}`, e);
    }
}

async function emailAdmin(dep) {
    const snap = await dep.db.collection('admin').get();
    return snap.docs.map(d => d.id);
}

async function avvisaAdmin(dep, oggetto, testoAvviso) {
    try {
        const destinatari = await emailAdmin(dep);
        if (destinatari.length) await dep.db.collection('mail').doc().set(emailAvvisoAdmin(destinatari, oggetto, testoAvviso));
    } catch (e) {
        dep.log.error('Avviso agli admin non inviato', e);
    }
    dep.log.warn(`AVVISO ADMIN: ${oggetto} – ${testoAvviso}`);
}

function idCheckouts(iscr) {
    const s = iscr?.sumup || {};
    return [s.checkoutId, ...(Array.isArray(s.checkoutPrecedenti) ? s.checkoutPrecedenti : [])].filter(Boolean);
}

/* ----------------------------------------------------------------- pagamenti */

/**
 * Registra un pagamento riuscito (checkout SumUp in stato PAID), una sola volta,
 * e mette in coda l'email di conferma. Restituisce lo stato finale dell'iscrizione.
 */
export async function segnaPagata(dep, eventoId, iscrizioneId, checkout) {
    const { db } = dep;
    if (checkout?.status !== 'PAID') return null;
    if (!String(checkout.checkout_reference || '').startsWith(`${iscrizioneId}-`)) {
        dep.log.error(`Checkout ${checkout.id} non appartiene all'iscrizione ${iscrizioneId}`);
        return null;
    }
    const iscrRef = db.doc(`eventi/${eventoId}/iscrizioni/${iscrizioneId}`);
    const evRef = db.doc(`eventi/${eventoId}`);
    const transazione = (checkout.transactions || []).find(t => t.status === 'SUCCESSFUL') || (checkout.transactions || [])[0] || {};
    const adesso = dep.ora();
    let avviso = null;

    const esito = await db.runTransaction(async tx => {
        const [s, ev] = await Promise.all([tx.get(iscrRef), tx.get(evRef)]);
        if (!s.exists) {
            avviso = ['Pagamento per un\'iscrizione inesistente',
                `È arrivato un pagamento SumUp (checkout ${checkout.id}, ${fmtEuro(checkout.amount)}) per l'iscrizione ${iscrizioneId} dell'evento ${eventoId}, che non esiste più. Va verificato e rimborsato da SumUp.`];
            return 'inesistente';
        }
        const iscr = s.data();
        if (iscr.stato === 'pagata') return 'pagata';
        if (checkout.currency !== 'EUR' || Math.abs(Number(checkout.amount) - Number(iscr.importo)) > 0.005) {
            avviso = ['Importo pagato diverso',
                `La squadra "${iscr.nomeSquadra}" (evento ${eventoId}) ha pagato ${checkout.amount} ${checkout.currency} invece di ${fmtEuro(iscr.importo)}. L'iscrizione NON è stata confermata: verificare su SumUp.`];
            return iscr.stato;
        }
        const infoSumUp = {
            'sumup.checkoutPagato': checkout.id,
            'sumup.transactionCode': transazione.transaction_code || '',
            'sumup.ultimoStato': 'PAID',
            aggiornataIl: adesso
        };
        if (iscr.stato === 'annullata' || iscr.stato === 'confermata_gratuita') {
            tx.update(iscrRef, { ...infoSumUp, pagamentoInattesoIl: adesso });
            avviso = ['Pagamento su iscrizione annullata',
                `La squadra "${iscr.nomeSquadra}" (evento ${eventoId}) ha pagato ${fmtEuro(checkout.amount)} ma l'iscrizione risulta "${iscr.stato}". Valutare il rimborso da SumUp (transazione ${transazione.transaction_code || '?'}).`];
            return iscr.stato;
        }
        tx.update(iscrRef, {
            ...infoSumUp,
            stato: 'pagata',
            pagataIl: adesso,
            scadeIl: null,
            emailConfermaInviata: true
        });
        tx.set(db.collection('mail').doc(), emailConferma(ev.exists ? ev.data() : {}, { ...iscr, stato: 'pagata' }));
        return 'pagata';
    });
    if (avviso) await avvisaAdmin(dep, avviso[0], avviso[1]);
    if (esito === 'pagata') dep.log.info(`Iscrizione ${eventoId}/${iscrizioneId} pagata (${checkout.id})`);
    return esito;
}

/**
 * Controlla su SumUp tutti i checkout di un'iscrizione in attesa.
 * Se uno risulta pagato registra il pagamento e restituisce "pagata",
 * altrimenti lo stato del checkout attuale (PENDING | FAILED | EXPIRED | null).
 */
export async function controllaPagamenti(dep, eventoId, iscrizioneId, iscr) {
    const ids = idCheckouts(iscr);
    let statoAttuale = null;
    for (const id of ids) {
        const c = await dep.sumup.leggiCheckout(id);
        if (c?.status === 'PAID') {
            const esito = await segnaPagata(dep, eventoId, iscrizioneId, c);
            if (esito === 'pagata') return 'pagata';
        }
        if (id === iscr.sumup?.checkoutId) statoAttuale = c?.status || null;
    }
    return statoAttuale;
}

async function nuovoCheckout(dep, { eventoId, iscrizioneId, tentativo, importo, evento, nomeSquadra, origine }) {
    const riferimento = `${iscrizioneId}-${tentativo}`;
    const c = await dep.sumup.creaCheckout({
        riferimento,
        importo,
        descrizione: `${evento.titolo || eventoId} – ${nomeSquadra}`.slice(0, 120),
        redirectUrl: urlRitorno(origine, eventoId, iscrizioneId),
        returnUrl: `${dep.urlWebhook}?e=${encodeURIComponent(eventoId)}&i=${encodeURIComponent(iscrizioneId)}`
    });
    if (!c?.id || !c.hosted_checkout_url) throw new Error('Risposta SumUp senza id o hosted_checkout_url');
    return { checkout: c, riferimento };
}

/* ----------------------------------------------------------------- creaIscrizione */

export async function creaIscrizione(dep, { uid, input, origine }) {
    const { db, bucket } = dep;
    if (!uid) throw errore('unauthenticated', 'non-autenticato', 'Accesso richiesto: ricarica la pagina.');
    if (!input || typeof input !== 'object') throw errore('invalid-argument', 'non-valido', 'Richiesta non valida.');

    const eventoId = typeof input.eventoId === 'string' ? input.eventoId : '';
    if (!RE_ID_EVENTO.test(eventoId)) throw errore('invalid-argument', 'non-valido', 'Evento non valido.');
    const evRef = db.doc(`eventi/${eventoId}`);
    const evSnap = await evRef.get();
    if (!evSnap.exists) throw errore('not-found', 'chiuse', 'Evento non trovato.');
    const evento = evSnap.data();
    if (!evento.iscrizioniAperte) throw errore('failed-precondition', 'chiuse', 'Le iscrizioni sono chiuse.');

    const raw = input.dati && typeof input.dati === 'object' ? input.dati : {};
    const cat = R.categoriaDi(evento, typeof raw.categoriaId === 'string' ? raw.categoriaId : '');
    if (!cat || cat.attiva === false) throw errore('failed-precondition', 'evento-cambiato', 'La categoria scelta non è più disponibile.');
    if (Array.isArray(raw.componenti) && raw.componenti.length > MAX_COMPONENTI) throw errore('invalid-argument', 'non-valido', 'Troppi componenti.');

    const dati = pulisciDati(raw, cat);
    const adesso = dep.ora();
    const oggi = R.oggiRoma(adesso);
    const errori = R.erroriIscrizione(evento, dati, oggi);
    if (errori.length) throw errore('invalid-argument', 'non-valido', 'Dati non validi.', { errori });

    const calc = R.calcolaImporto(evento, cat, dati.componenti, oggi);
    if (typeof input.totaleAtteso !== 'number' || Math.abs(calc.importo - input.totaleAtteso) > 0.005)
        throw errore('aborted', 'importo-cambiato', 'La quota è cambiata.', { importo: calc.importo });

    // --- File caricati: devono stare nella cartella di chi chiama ed esistere
    const reFile = new RegExp(`^caricamenti/${uid.replace(/[^A-Za-z0-9_-]/g, '')}/[A-Za-z0-9_-]{1,80}[.](jpg|jpeg|png|pdf)$`);
    const nomiDoc = Object.fromEntries((cat.documenti || []).map(d => [d.id, d.nome]));
    const daCopiare = new Set([
        ...Object.values(dati.documentiSquadra),
        ...dati.componenti.flatMap(c => Object.values(c.documenti))
    ]);
    const idDocDi = p => {
        for (const [k, v] of Object.entries(dati.documentiSquadra)) if (v === p) return k;
        for (const c of dati.componenti) for (const [k, v] of Object.entries(c.documenti)) if (v === p) return k;
        return '';
    };
    for (const p of daCopiare) {
        const nome = nomiDoc[idDocDi(p)] || 'documento';
        const mancante = () => errore('failed-precondition', 'documento-mancante', `Il file del documento "${nome}" non è più disponibile: caricalo di nuovo.`);
        if (!reFile.test(p)) throw mancante();
        let meta;
        try { [meta] = await bucket.file(p).getMetadata(); }
        catch { throw mancante(); }
        if (Number(meta.size) > MAX_BYTES_FILE || !RE_TIPO_FILE.test(meta.contentType || '')) throw mancante();
    }

    // --- Iscrizione da sostituire (stesso utente, non ancora pagata)
    let vecchiaId = null;
    if (typeof input.sostituisci === 'string' && RE_ID_ISCRIZIONE.test(input.sostituisci)) {
        const s = await db.doc(`eventi/${eventoId}/iscrizioni/${input.sostituisci}`).get();
        if (s.exists && s.data().uid === uid) {
            const v = s.data();
            if (v.stato === 'pagata' || v.stato === 'confermata_gratuita')
                throw errore('already-exists', 'gia-pagata', 'Questa iscrizione è già confermata.', { importo: v.importo });
            if (v.stato === 'in_attesa_pagamento') {
                if (await controllaPagamenti(dep, eventoId, s.id, v) === 'pagata')
                    throw errore('already-exists', 'gia-pagata', 'Il pagamento risulta già effettuato.', { importo: v.importo });
                vecchiaId = s.id;
            }
        }
    }

    // --- Nuova iscrizione
    const iscrRef = db.collection(`eventi/${eventoId}/iscrizioni`).doc();
    const iid = iscrRef.id;
    const slug = R.slugify(dati.nomeSquadra);
    const emailNorm = R.normalizzaEmail(dati.email);
    const prenotaEmail = cat.unaSquadraPerEmail !== false;
    const gratuita = calc.importo === 0;

    // Copia dei file nella cartella definitiva (gli originali restano fino alla
    // pulizia, così l'utente può ripresentare il modulo dopo un pagamento fallito)
    const copiati = [];
    const nuovoPercorso = {};
    try {
        for (const p of daCopiare) {
            const dest = `eventi/${eventoId}/${iid}/${p.split('/').pop()}`;
            await bucket.file(p).copy(bucket.file(dest));
            copiati.push(dest);
            nuovoPercorso[p] = dest;
        }
    } catch (e) {
        await eliminaFile(dep, copiati);
        throw e;
    }
    const mappaDoc = m => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, nuovoPercorso[v]]));

    const consensi = {};
    for (const [k, v] of Object.entries(dati.consensi)) if (v === true) consensi[k] = adesso;

    const docIscrizione = {
        nomeSquadra: dati.nomeSquadra,
        nomeSlug: slug,
        email: dati.email,
        emailNorm,
        emailPrenotata: prenotaEmail,
        categoriaId: cat.id,
        categoria: {
            nome: cat.nome || cat.id,
            quota: cat.quota || null,
            gratuitoSottoEta: Number.isInteger(cat.gratuitoSottoEta) ? cat.gratuitoSottoEta : null
        },
        componenti: dati.componenti.map((c, i) => ({
            nome: c.nome,
            cognome: c.cognome,
            ...(c.dataNascita ? { dataNascita: c.dataNascita } : {}),
            gratuito: calc.gratuitoPerComponente[i] === true,
            campi: c.campi,
            documenti: mappaDoc(c.documenti)
        })),
        campiSquadra: dati.campiSquadra,
        documentiSquadra: mappaDoc(dati.documentiSquadra),
        importo: calc.importo,
        dettaglioImporto: {
            tipo: calc.tipo,
            euroUnitario: calc.euroUnitario,
            paganti: calc.paganti,
            gratuiti: calc.gratuiti
        },
        stato: gratuita ? 'confermata_gratuita' : 'in_attesa_pagamento',
        uid,
        consensi,
        sumup: {},
        creataIl: adesso,
        aggiornataIl: adesso,
        scadeIl: gratuita ? null : new Date(adesso.getTime() + ORE_VALIDITA_ISCRIZIONE * 3600e3),
        notaAdmin: '',
        verifiche: { documentiOk: false },
        emailConfermaInviata: gratuita
    };

    let vecchia = null;
    try {
        await db.runTransaction(async tx => {
            const nomeRef  = db.doc(`eventi/${eventoId}/nomiSquadre/${slug}`);
            const emailRef = prenotaEmail ? db.doc(`eventi/${eventoId}/emailUsate/${R.idEmail(emailNorm)}`) : null;
            const vRef     = vecchiaId ? db.doc(`eventi/${eventoId}/iscrizioni/${vecchiaId}`) : null;
            const [evT, nomeS, emailS, vS] = await Promise.all([
                tx.get(evRef), tx.get(nomeRef),
                emailRef ? tx.get(emailRef) : null,
                vRef ? tx.get(vRef) : null
            ]);

            // L'evento potrebbe essere cambiato dopo il primo controllo
            if (!evT.exists || !evT.data().iscrizioniAperte)
                throw errore('failed-precondition', 'chiuse', 'Le iscrizioni sono chiuse.');
            const evNuovo = evT.data();
            if (evNuovo.data !== evento.data || JSON.stringify(R.categoriaDi(evNuovo, cat.id)) !== JSON.stringify(cat))
                throw errore('aborted', 'evento-cambiato', "I dati dell'evento sono stati aggiornati.");

            const v = vS?.exists && vS.data().uid === uid && vS.data().stato === 'in_attesa_pagamento' ? vS.data() : null;
            if (nomeS.exists && !(v && v.nomeSlug === slug))
                throw errore('already-exists', 'nome-preso', 'Esiste già una squadra con questo nome.');
            if (emailS?.exists && !(v && emailS.data().iscrizioneId === vecchiaId))
                throw errore('already-exists', 'email-usata', 'Con questa email è già iscritta una squadra.');

            if (v) {
                vecchia = { id: vecchiaId, ...v };
                tx.delete(vRef);
                if (v.nomeSlug && v.nomeSlug !== slug) tx.delete(db.doc(`eventi/${eventoId}/nomiSquadre/${v.nomeSlug}`));
                const vEmail = v.emailPrenotata ? `eventi/${eventoId}/emailUsate/${R.idEmail(v.emailNorm)}` : null;
                if (vEmail && vEmail !== emailRef?.path) tx.delete(db.doc(vEmail));
            }
            tx.set(nomeRef, { creataIl: adesso });
            if (emailRef) tx.set(emailRef, { creataIl: adesso, iscrizioneId: iid });
            tx.set(iscrRef, docIscrizione);
            if (gratuita) tx.set(db.collection('mail').doc(), emailConferma(evento, docIscrizione));
        });
    } catch (e) {
        await eliminaFile(dep, copiati);
        throw e;
    }

    // Pulizia dell'iscrizione sostituita (file e pagine di pagamento)
    if (vecchia) {
        for (const id of idCheckouts(vecchia)) await dep.sumup.disattivaCheckout(id);
        await eliminaCartella(dep, `eventi/${eventoId}/${vecchia.id}/`);
    }

    if (gratuita) {
        dep.log.info(`Iscrizione gratuita ${eventoId}/${iid} (${dati.nomeSquadra})`);
        return { iscrizioneId: iid, stato: 'confermata_gratuita', importo: 0 };
    }

    // --- Pagamento: checkout SumUp
    try {
        const { checkout, riferimento } = await nuovoCheckout(dep, {
            eventoId, iscrizioneId: iid, tentativo: 1, importo: calc.importo, evento, nomeSquadra: dati.nomeSquadra, origine
        });
        await iscrRef.update({
            sumup: {
                checkoutId: checkout.id,
                checkoutReference: riferimento,
                hostedUrl: checkout.hosted_checkout_url,
                checkoutCreatoIl: adesso,
                tentativi: 1,
                checkoutPrecedenti: [],
                ultimoStato: checkout.status || 'PENDING'
            }
        });
        dep.log.info(`Iscrizione ${eventoId}/${iid} in attesa di pagamento (${dati.nomeSquadra}, ${calc.importo} €)`);
        return { iscrizioneId: iid, stato: 'in_attesa_pagamento', importo: calc.importo, checkoutUrl: checkout.hosted_checkout_url };
    } catch (e) {
        dep.log.error(`Checkout SumUp non creato per ${eventoId}/${iid}`, e);
        await eliminaIscrizione(dep, eventoId, iid, docIscrizione);
        throw errore('unavailable', 'pagamento-non-disponibile', 'Il servizio di pagamento non risponde: riprova tra qualche minuto.');
    }
}

/* ----------------------------------------------------------------- eliminazione */

// Cancella un'iscrizione non pagata con le sue prenotazioni e i suoi file
export async function eliminaIscrizione(dep, eventoId, iscrizioneId, iscr) {
    const { db } = dep;
    const base = `eventi/${eventoId}`;
    // Il nome si libera solo se nessun'altra iscrizione lo usa
    let altreConNome = [];
    if (iscr.nomeSlug) {
        const q = await db.collection(`${base}/iscrizioni`).where('nomeSlug', '==', iscr.nomeSlug).get();
        altreConNome = q.docs.filter(d => d.id !== iscrizioneId && d.data().stato !== 'annullata');
    }
    await db.runTransaction(async tx => {
        const iRef = db.doc(`${base}/iscrizioni/${iscrizioneId}`);
        const eRef = iscr.emailPrenotata && iscr.emailNorm ? db.doc(`${base}/emailUsate/${R.idEmail(iscr.emailNorm)}`) : null;
        const [iS, eS] = await Promise.all([tx.get(iRef), eRef ? tx.get(eRef) : null]);
        if (iS.exists && iS.data().stato === 'pagata') return; // pagata nel frattempo: non toccare
        if (iS.exists) tx.delete(iRef);
        if (iscr.nomeSlug && !altreConNome.length) tx.delete(db.doc(`${base}/nomiSquadre/${iscr.nomeSlug}`));
        if (eS?.exists && eS.data().iscrizioneId === iscrizioneId) tx.delete(eRef);
    });
    await eliminaCartella(dep, `${base}/${iscrizioneId}/`);
}

/* ----------------------------------------------------------------- verifica / ripresa */

async function leggiIscrizione(dep, input) {
    const eventoId = typeof input?.eventoId === 'string' ? input.eventoId : '';
    const iscrizioneId = typeof input?.iscrizioneId === 'string' ? input.iscrizioneId : '';
    if (!RE_ID_EVENTO.test(eventoId) || !RE_ID_ISCRIZIONE.test(iscrizioneId))
        throw errore('invalid-argument', 'non-valido', 'Richiesta non valida.');
    const s = await dep.db.doc(`eventi/${eventoId}/iscrizioni/${iscrizioneId}`).get();
    return { eventoId, iscrizioneId, snap: s, iscr: s.exists ? s.data() : null };
}

// Al ritorno dalla pagina di pagamento (o dal pulsante "ricontrolla" di ps-admin)
export async function verificaPagamento(dep, { uid, admin = false, input }) {
    if (!uid) throw errore('unauthenticated', 'non-autenticato', 'Accesso richiesto.');
    const { eventoId, iscrizioneId, iscr } = await leggiIscrizione(dep, input);
    if (!iscr) return { stato: 'inesistente' };
    if (!admin && iscr.uid !== uid) throw errore('permission-denied', 'non-autorizzato', 'Iscrizione di un altro utente.');
    if (iscr.stato !== 'in_attesa_pagamento') return { stato: iscr.stato, importo: iscr.importo };
    if (!idCheckouts(iscr).length) return { stato: 'in_attesa_pagamento', importo: iscr.importo };

    const r = await controllaPagamenti(dep, eventoId, iscrizioneId, iscr);
    if (r === 'pagata') return { stato: 'pagata', importo: iscr.importo };
    if (r && r !== iscr.sumup?.ultimoStato) {
        await dep.db.doc(`eventi/${eventoId}/iscrizioni/${iscrizioneId}`).update({ 'sumup.ultimoStato': r });
    }
    return { stato: r === 'FAILED' ? 'fallito' : 'in_attesa_pagamento', importo: iscr.importo };
}

// "Riprova il pagamento": riusa la pagina SumUp se ancora valida, altrimenti ne crea una nuova
export async function riprendiPagamento(dep, { uid, input, origine }) {
    if (!uid) throw errore('unauthenticated', 'non-autenticato', 'Accesso richiesto.');
    const { eventoId, iscrizioneId, iscr } = await leggiIscrizione(dep, input);
    if (!iscr) throw errore('not-found', 'scaduta', 'Iscrizione scaduta.');
    if (iscr.uid !== uid) throw errore('permission-denied', 'non-autorizzato', 'Iscrizione di un altro utente.');
    if (iscr.stato === 'pagata' || iscr.stato === 'confermata_gratuita') return { stato: iscr.stato, importo: iscr.importo };
    if (iscr.stato !== 'in_attesa_pagamento') throw errore('failed-precondition', 'annullata', "L'iscrizione è stata annullata dagli organizzatori.");

    const r = await controllaPagamenti(dep, eventoId, iscrizioneId, iscr);
    if (r === 'pagata') return { stato: 'pagata', importo: iscr.importo };

    const adesso = dep.ora();
    const s = iscr.sumup || {};
    if (r === 'PENDING' && s.hostedUrl && adesso.getTime() - ms(s.checkoutCreatoIl) < MINUTI_RIUSO_CHECKOUT * 60e3) {
        return { stato: 'in_attesa_pagamento', checkoutUrl: s.hostedUrl };
    }
    const tentativo = (s.tentativi || 1) + 1;
    if (tentativo > MAX_TENTATIVI_PAGAMENTO)
        throw errore('resource-exhausted', 'troppi-tentativi', 'Troppi tentativi di pagamento: scrivi agli organizzatori.');

    if (s.checkoutId) await dep.sumup.disattivaCheckout(s.checkoutId);
    const evSnap = await dep.db.doc(`eventi/${eventoId}`).get();
    let checkout, riferimento;
    try {
        ({ checkout, riferimento } = await nuovoCheckout(dep, {
            eventoId, iscrizioneId, tentativo, importo: iscr.importo,
            evento: evSnap.exists ? evSnap.data() : {}, nomeSquadra: iscr.nomeSquadra, origine
        }));
    } catch (e) {
        dep.log.error(`Nuovo checkout non creato per ${eventoId}/${iscrizioneId}`, e);
        throw errore('unavailable', 'pagamento-non-disponibile', 'Il servizio di pagamento non risponde: riprova tra qualche minuto.');
    }
    const minimaScadenza = adesso.getTime() + MINUTI_MARGINE_PAGAMENTO * 60e3;
    await dep.db.doc(`eventi/${eventoId}/iscrizioni/${iscrizioneId}`).update({
        'sumup.checkoutId': checkout.id,
        'sumup.checkoutReference': riferimento,
        'sumup.hostedUrl': checkout.hosted_checkout_url,
        'sumup.checkoutCreatoIl': adesso,
        'sumup.tentativi': tentativo,
        'sumup.checkoutPrecedenti': [...(s.checkoutPrecedenti || []), ...(s.checkoutId ? [s.checkoutId] : [])],
        'sumup.ultimoStato': checkout.status || 'PENDING',
        scadeIl: new Date(Math.max(ms(iscr.scadeIl), minimaScadenza)),
        aggiornataIl: adesso
    });
    return { stato: 'in_attesa_pagamento', checkoutUrl: checkout.hosted_checkout_url };
}

/* ----------------------------------------------------------------- webhook SumUp */

// Notifica di SumUp: { event_type: "CHECKOUT_STATUS_CHANGED", id: <checkout> }.
// Le notifiche non sono firmate: lo stato si legge sempre dall'API SumUp.
export async function webhook(dep, { query, body }) {
    const checkoutId = typeof body?.id === 'string' ? body.id : '';
    const eventoId = typeof query?.e === 'string' ? query.e : '';
    const iscrizioneId = typeof query?.i === 'string' ? query.i : '';
    if (!checkoutId || !RE_ID_EVENTO.test(eventoId) || !RE_ID_ISCRIZIONE.test(iscrizioneId)) {
        dep.log.warn('Webhook SumUp ignorato: dati mancanti', { query, body });
        return 'ignorato';
    }
    const c = await dep.sumup.leggiCheckout(checkoutId); // se SumUp non risponde: errore → SumUp ritenta
    if (!String(c?.checkout_reference || '').startsWith(`${iscrizioneId}-`)) {
        dep.log.warn(`Webhook SumUp: checkout ${checkoutId} non corrisponde a ${iscrizioneId}`);
        return 'ignorato';
    }
    if (c.status !== 'PAID') return c.status;
    return await segnaPagata(dep, eventoId, iscrizioneId, c);
}

/* ----------------------------------------------------------------- pulizia */

export async function pulizia(dep) {
    const { db, bucket } = dep;
    const adesso = dep.ora().getTime();
    const resoconto = { eliminate: 0, pagate: 0, errori: 0, file: 0 };

    const eventi = await db.collection('eventi').get();
    for (const ev of eventi.docs) {
        const q = await db.collection(`eventi/${ev.id}/iscrizioni`).where('stato', '==', 'in_attesa_pagamento').get();
        for (const d of q.docs) {
            const iscr = d.data();
            if (ms(iscr.scadeIl) > adesso) continue;
            try {
                if (await controllaPagamenti(dep, ev.id, d.id, iscr) === 'pagata') { resoconto.pagate++; continue; }
                // Le pagine di pagamento ancora aperte vengono disattivate prima di cancellare
                for (const id of idCheckouts(iscr)) await dep.sumup.disattivaCheckout(id);
                // Ultimo controllo: un pagamento potrebbe essere arrivato nel frattempo
                if (await controllaPagamenti(dep, ev.id, d.id, iscr) === 'pagata') { resoconto.pagate++; continue; }
                await eliminaIscrizione(dep, ev.id, d.id, iscr);
                resoconto.eliminate++;
            } catch (e) {
                resoconto.errori++;
                dep.log.error(`Pulizia: iscrizione ${ev.id}/${d.id} non elaborata (si riprova al prossimo giro)`, e);
            }
        }
    }

    // File temporanei del form
    const [files] = await bucket.getFiles({ prefix: 'caricamenti/' });
    const limite = adesso - ORE_VALIDITA_CARICAMENTI * 3600e3;
    for (const f of files) {
        const creato = Date.parse(f.metadata?.timeCreated || '');
        if (creato && creato < limite) {
            try { await f.delete({ ignoreNotFound: true }); resoconto.file++; }
            catch (e) { dep.log.warn(`File temporaneo non eliminato: ${f.name}`, e); }
        }
    }
    dep.log.info('Pulizia completata', resoconto);
    return resoconto;
}

/* ----------------------------------------------------------------- documenti sanitari */

// Informativa privacy: i documenti con dati sanitari (es. certificati medici) si
// cancellano entro 60 giorni dalla data dell'evento. Gli organizzatori ricevono un
// preavviso 7 giorni prima (la cancellazione è definitiva) e un riepilogo dopo.
export const GIORNI_CONSERVAZIONE_SANITARI = 60;
export const GIORNI_PREAVVISO_SANITARI = 7;

// Data 'AAAA-MM-GG' spostata di n giorni
export function aggiungiGiorni(s, n) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const plurale = (n, uno, molti) => `${n} ${n === 1 ? uno : molti}`;

// Id e nomi dei documenti sanitari dell'evento, per categoria
function documentiSanitari(evento) {
    const perCategoria = new Map();
    const tutti = new Set();
    const nomi = new Set();
    for (const c of evento.categorie || []) {
        const ids = new Set();
        for (const d of c.documenti || []) {
            if (d.sanitario !== true) continue;
            ids.add(d.id);
            tutti.add(d.id);
            nomi.add(d.nome || d.id);
        }
        perCategoria.set(c.id, ids);
    }
    return { perCategoria, tutti, nomi: [...nomi] };
}

// File sanitari ancora presenti, iscrizione per iscrizione (anche annullate)
async function raccogliSanitari(dep, eventoId, evento) {
    const { perCategoria, tutti, nomi } = documentiSanitari(evento);
    const elenco = [];
    if (!tutti.size) return { elenco, nomi };
    const snap = await dep.db.collection(`eventi/${eventoId}/iscrizioni`).get();
    for (const d of snap.docs) {
        const iscr = d.data();
        const ids = perCategoria.get(iscr.categoriaId) || tutti;
        const percorsi = [
            ...Object.entries(iscr.documentiSquadra || {}),
            ...(iscr.componenti || []).flatMap(c => Object.entries(c.documenti || {}))
        ].filter(([k, p]) => ids.has(k) && typeof p === 'string' && p).map(([, p]) => p);
        if (percorsi.length) elenco.push({ id: d.id, ids, percorsi });
    }
    return { elenco, nomi };
}

// Toglie da una mappa {idDoc: percorso} i documenti cancellati e li annota in {idDoc: data}
function togliCancellati(mappa, giaCancellati, ids, eliminati, adesso) {
    const restano = {};
    const cancellati = { ...(giaCancellati || {}) };
    for (const [k, p] of Object.entries(mappa || {})) {
        if (ids.has(k) && eliminati.has(p)) cancellati[k] = adesso;
        else restano[k] = p;
    }
    return { restano, cancellati };
}

// Conta i documenti sanitari risultanti cancellati (per il riepilogo)
async function contaCancellati(dep, eventoId) {
    const snap = await dep.db.collection(`eventi/${eventoId}/iscrizioni`).get();
    let file = 0, squadre = 0;
    for (const d of snap.docs) {
        const iscr = d.data();
        const n = Object.keys(iscr.documentiSquadraCancellati || {}).length
            + (iscr.componenti || []).reduce((a, c) => a + Object.keys(c.documentiCancellati || {}).length, 0);
        file += n;
        if (n) squadre++;
    }
    return { file, squadre };
}

/**
 * Ogni notte. Per ogni evento non ancora trattato:
 * - da 7 giorni prima della scadenza (data evento + 60 giorni): preavviso agli admin
 *   e data di cancellazione annotata sull'evento (certificatiPreavvisoIl, certificatiCancellazioneDal);
 * - dalla data di cancellazione: elimina da Storage i documenti sanitari di tutte le
 *   iscrizioni, li toglie dalle iscrizioni annotandoli in documentiCancellati /
 *   documentiSquadraCancellati, segna l'evento (certificatiCancellatiIl) e invia il riepilogo.
 * Se la scadenza è già passata quando parte il preavviso (es. funzione pubblicata dopo),
 * la cancellazione avviene comunque 7 giorni dopo il preavviso.
 */
export async function cancellaCertificati(dep) {
    const { db } = dep;
    const adesso = dep.ora();
    const oggi = R.oggiRoma(adesso);
    const resoconto = { preavvisi: 0, eventiCompletati: 0, file: 0, errori: 0 };

    const eventi = await db.collection('eventi').get();
    for (const ev of eventi.docs) {
        const e = ev.data();
        if (!R.dataValida(e.data) || e.certificatiCancellatiIl) continue;
        const scadenza = aggiungiGiorni(e.data, GIORNI_CONSERVAZIONE_SANITARI);
        if (oggi < aggiungiGiorni(scadenza, -GIORNI_PREAVVISO_SANITARI)) continue;
        const evRef = db.doc(`eventi/${ev.id}`);
        const titolo = e.titolo || ev.id;

        try {
            const { elenco, nomi } = await raccogliSanitari(dep, ev.id, e);
            const nFile = elenco.reduce((a, x) => a + x.percorsi.length, 0);
            const descrizione = `${plurale(nFile, 'documento', 'documenti')} con dati sanitari (${nomi.join(', ')}) di ${plurale(elenco.length, 'squadra', 'squadre')} dell'evento "${titolo}" del ${fmtDataStr(e.data)}`;

            // --- Preavviso
            if (!e.certificatiPreavvisoIl) {
                const dal = oggi < scadenza ? scadenza : aggiungiGiorni(oggi, GIORNI_PREAVVISO_SANITARI);
                if (nFile) {
                    await avvisaAdmin(dep, `Documenti sanitari da cancellare il ${fmtDataStr(dal)} – ${titolo}`,
                        `Il ${fmtDataStr(dal)} verranno cancellati definitivamente ${descrizione}.\n\n`
                        + `La cancellazione è automatica e prevista dall'informativa privacy (entro ${GIORNI_CONSERVAZIONE_SANITARI} giorni dall'evento). `
                        + "Dopo non sarà più possibile recuperarli: se servono ancora, scaricali prima dall'area riservata "
                        + '(ps-admin → Iscrizioni → dettaglio della squadra → Documenti).');
                }
                await evRef.update({ certificatiPreavvisoIl: adesso, certificatiCancellazioneDal: dal });
                resoconto.preavvisi++;
                continue;
            }

            // --- Cancellazione
            if (oggi < (R.dataValida(e.certificatiCancellazioneDal) ? e.certificatiCancellazioneDal : scadenza)) continue;
            let errori = 0;
            for (const x of elenco) {
                try {
                    const eliminati = new Set();
                    for (const p of x.percorsi) {
                        await dep.bucket.file(p).delete({ ignoreNotFound: true });
                        eliminati.add(p);
                    }
                    const iRef = db.doc(`eventi/${ev.id}/iscrizioni/${x.id}`);
                    await db.runTransaction(async tx => {
                        const s = await tx.get(iRef);
                        if (!s.exists) return;
                        const iscr = s.data();
                        const sq = togliCancellati(iscr.documentiSquadra, iscr.documentiSquadraCancellati, x.ids, eliminati, adesso);
                        const componenti = (iscr.componenti || []).map(c => {
                            const r = togliCancellati(c.documenti, c.documentiCancellati, x.ids, eliminati, adesso);
                            return { ...c, documenti: r.restano, ...(Object.keys(r.cancellati).length ? { documentiCancellati: r.cancellati } : {}) };
                        });
                        tx.update(iRef, {
                            componenti,
                            documentiSquadra: sq.restano,
                            ...(Object.keys(sq.cancellati).length ? { documentiSquadraCancellati: sq.cancellati } : {})
                        });
                    });
                    resoconto.file += eliminati.size;
                } catch (err) {
                    errori++;
                    dep.log.error(`Documenti sanitari: iscrizione ${ev.id}/${x.id} non elaborata (si riprova la notte successiva)`, err);
                }
            }
            if (errori) { resoconto.errori += errori; continue; }

            const tot = await contaCancellati(dep, ev.id);
            await evRef.update({ certificatiCancellatiIl: adesso });
            resoconto.eventiCompletati++;
            if (tot.file) {
                await avvisaAdmin(dep, `Documenti sanitari cancellati – ${titolo}`,
                    `Come previsto dall'informativa privacy, sono stati cancellati ${plurale(tot.file, 'documento', 'documenti')} con dati sanitari `
                    + `(${nomi.join(', ')}) di ${plurale(tot.squadre, 'squadra', 'squadre')} dell'evento "${titolo}" del ${fmtDataStr(e.data)}.\n\n`
                    + "Gli altri dati delle iscrizioni restano invariati; nell'area riservata i documenti risultano \"Cancellato per scadenza\".");
            }
        } catch (err) {
            resoconto.errori++;
            dep.log.error(`Documenti sanitari: evento ${ev.id} non elaborato (si riprova la notte successiva)`, err);
        }
    }
    dep.log.info('Controllo documenti sanitari completato', resoconto);
    return resoconto;
}
