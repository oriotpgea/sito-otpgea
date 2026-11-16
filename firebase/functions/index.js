// =============================================================================
// Cloud Functions – Sistema iscrizioni OTP-GEA (progetto otpgea-iscrizioni)
// Regione europe-west1 (Firestore è in eur3).
// La logica è in logica.js; qui solo il collegamento con Firebase e SumUp.
// Pubblicazione: vedi firebase/LEGGIMI.md ("npm run deploy" nella cartella functions).
// =============================================================================

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { setGlobalOptions } from 'firebase-functions/v2/options';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';

import * as L from './logica.js';
import { creaClientSumUp } from './sumup.js';

initializeApp();
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

setGlobalOptions({ region: 'europe-west1', maxInstances: 5 });

// Credenziali SumUp (impostate con "firebase functions:secrets:set ...")
const SUMUP_API_KEY       = defineSecret('SUMUP_API_KEY');
const SUMUP_MERCHANT_CODE = defineSecret('SUMUP_MERCHANT_CODE');
const segreti = [SUMUP_API_KEY, SUMUP_MERCHANT_CODE];

function progetto() {
    if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
    try { return JSON.parse(process.env.FIREBASE_CONFIG || '{}').projectId; } catch { return ''; }
}

function dipendenze() {
    return {
        db,
        bucket: getStorage().bucket(),
        sumup: creaClientSumUp({
            apiKey: SUMUP_API_KEY.value().trim(),
            merchantCode: SUMUP_MERCHANT_CODE.value().trim()
        }),
        ora: () => new Date(),
        urlWebhook: `https://europe-west1-${progetto()}.cloudfunctions.net/sumupWebhook`,
        log: logger
    };
}

function comeHttpsError(e) {
    if (e instanceof L.ErroreUtente) return new HttpsError(e.codice, e.message, e.dettagli);
    logger.error(e);
    return new HttpsError('internal', 'Errore interno: riprova tra qualche minuto.');
}

async function eAdmin(auth) {
    const email = auth?.token?.email;
    if (!email || auth.token.firebase?.sign_in_provider !== 'password') return false;
    return (await db.doc(`admin/${email.toLowerCase()}`).get()).exists;
}

const opzioniCallable = { secrets: segreti, timeoutSeconds: 60 };

// Crea l'iscrizione e, se a pagamento, la pagina di pagamento SumUp
export const creaIscrizione = onCall(opzioniCallable, async req => {
    try {
        return await L.creaIscrizione(dipendenze(), {
            uid: req.auth?.uid,
            input: req.data,
            origine: req.rawRequest?.headers?.origin
        });
    } catch (e) { throw comeHttpsError(e); }
});

// Controllo del pagamento al ritorno da SumUp (o da ps-admin)
export const verificaPagamento = onCall(opzioniCallable, async req => {
    try {
        return await L.verificaPagamento(dipendenze(), {
            uid: req.auth?.uid,
            admin: await eAdmin(req.auth),
            input: req.data
        });
    } catch (e) { throw comeHttpsError(e); }
});

// "Riprova il pagamento"
export const riprendiPagamento = onCall(opzioniCallable, async req => {
    try {
        return await L.riprendiPagamento(dipendenze(), {
            uid: req.auth?.uid,
            input: req.data,
            origine: req.rawRequest?.headers?.origin
        });
    } catch (e) { throw comeHttpsError(e); }
});

// Notifiche di SumUp (return_url dei checkout)
export const sumupWebhook = onRequest({ secrets: segreti, timeoutSeconds: 60 }, async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send(''); return; }
    try {
        await L.webhook(dipendenze(), { query: req.query, body: req.body });
        res.status(200).send('');
    } catch (e) {
        // Risposta di errore: SumUp riproverà più tardi
        logger.error('Webhook SumUp non elaborato', e);
        res.status(500).send('');
    }
});

// Ogni ora: iscrizioni non pagate scadute e file temporanei
export const pulizia = onSchedule({
    schedule: 'every 60 minutes',
    timeZone: 'Europe/Rome',
    secrets: segreti,
    timeoutSeconds: 300
}, async () => {
    await L.pulizia(dipendenze());
});
