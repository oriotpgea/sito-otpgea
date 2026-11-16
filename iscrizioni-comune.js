// =============================================================================
// Regole comuni del sistema iscrizioni OTP-GEA
// Usato dal form (ps-form-iscrizioni.html) e, in copia identica, dalle Cloud
// Functions (firebase/functions): calcolo della quota, età, controlli dei dati.
// Se si modifica questo file vanno ripubblicate anche le Cloud Functions,
// altrimenti il totale mostrato nel form e quello calcolato dal server
// potrebbero non coincidere.
// Nessuna dipendenza: funziona nel browser e in Node.js.
// =============================================================================

export const RE_DATA  = /^\d{4}-\d{2}-\d{2}$/;
export const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RE_TELEFONO     = /^\+?[0-9 ().\-/]{6,20}$/;

export const MAX_NOME_SQUADRA = 60;
export const MAX_NOME_PERSONA = 60;
export const MAX_EMAIL        = 120;
export const MAX_CAMPO        = 200;

// ---------------------------------------------------------------- testo e date

// Nome normalizzato (unicità del nome squadra): minuscolo, senza accenti,
// sequenze di caratteri non alfanumerici → "-"
export function slugify(t) {
    return String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function normalizzaEmail(e) {
    return String(e ?? '').trim().toLowerCase();
}

// Id del documento in eventi/{id}/emailUsate
export function idEmail(emailNorm) {
    return String(emailNorm ?? '').replace(/\//g, '%2F');
}

// Data di oggi (AAAA-MM-GG) secondo l'ora italiana
export function oggiRoma(d = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(d);
}

// Data reale (es. rifiuta 2027-02-30)
export function dataValida(s) {
    if (!RE_DATA.test(s || '')) return false;
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Anni compiuti alla data di riferimento
export function etaAlla(dataNascita, dataRif) {
    const [y1, m1, d1] = dataNascita.split('-').map(Number);
    const [y2, m2, d2] = dataRif.split('-').map(Number);
    let eta = y2 - y1;
    if (m2 < m1 || (m2 === m1 && d2 < d1)) eta--;
    return eta;
}

function fmtEuro(n) {
    return Number(n).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
}
// "1º aprile", "15 aprile"
export function fmtGiorno(s) {
    const [y, m, d] = s.split('-').map(Number);
    const mese = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('it-IT', { month: 'long', timeZone: 'UTC' });
    return `${d === 1 ? '1º' : d} ${mese}`;
}
function centesimi(euro) {
    return Math.round(euro * 100) / 100;
}

// ---------------------------------------------------------------- categorie

export function categoriaDi(evento, categoriaId) {
    return (evento?.categorie || []).find(c => c.id === categoriaId) || null;
}

export function categorieVisibili(evento) {
    return (evento?.categorie || []).filter(c => c.attiva !== false);
}

export function richiedeDataNascita(cat) {
    return (cat?.quota?.tipo === 'persona' && Number.isInteger(cat.gratuitoSottoEta))
        || Number.isInteger(cat?.etaMinima)
        || Number.isInteger(cat?.etaMassima);
}

export function haDocumentiSanitari(cat) {
    return (cat?.documenti || []).some(d => d.sanitario);
}

// Scaglione di prezzo valido oggi (null per le categorie gratuite)
export function scaglioneAttuale(cat, oggi) {
    if (!cat || cat.quota?.tipo === 'gratuita') return null;
    return (cat.quota?.scaglioni || []).find(s => !s.finoAl || oggi <= s.finoAl) || null;
}

// Descrizione breve della quota, es. "5,00 € a persona fino al 30 aprile, poi 10,00 €"
export function descriviQuota(cat, oggi) {
    const q = cat?.quota || {};
    if (q.tipo === 'gratuita') return 'Gratuita';
    const unita = q.tipo === 'squadra' ? 'a squadra' : 'a persona';
    const validi = (q.scaglioni || []).filter(s => !s.finoAl || oggi <= s.finoAl);
    if (!validi.length) return '';
    let testo = `${fmtEuro(validi[0].euro)} ${unita}`;
    if (validi[0].finoAl) {
        testo += ` fino al ${fmtGiorno(validi[0].finoAl)}`;
        const poi = validi.slice(1).map((s, i) => `${fmtEuro(s.euro)}${s.finoAl ? ` fino al ${fmtGiorno(s.finoAl)}` : ''}`);
        if (poi.length) testo += `, poi ${poi.join(', poi ')}`;
    }
    if (q.tipo === 'persona' && Number.isInteger(cat.gratuitoSottoEta))
        testo += `; gratis sotto i ${cat.gratuitoSottoEta} anni`;
    return testo;
}

// ---------------------------------------------------------------- importo

/**
 * Calcola l'importo dell'iscrizione.
 * componenti: [{ dataNascita? }]
 * Restituisce { tipo, euroUnitario, paganti, gratuiti, importo, gratuitoPerComponente: [bool] }
 * o null se la categoria non ha un prezzo valido per la data di oggi.
 */
export function calcolaImporto(evento, cat, componenti, oggi) {
    const n = componenti.length;
    const tipo = cat?.quota?.tipo;
    if (tipo === 'gratuita') {
        return { tipo, euroUnitario: 0, paganti: 0, gratuiti: 0, importo: 0, gratuitoPerComponente: componenti.map(() => false) };
    }
    const sc = scaglioneAttuale(cat, oggi);
    if (!sc || typeof sc.euro !== 'number') return null;
    if (tipo === 'squadra') {
        return { tipo, euroUnitario: sc.euro, paganti: n, gratuiti: 0, importo: centesimi(sc.euro), gratuitoPerComponente: componenti.map(() => false) };
    }
    if (tipo !== 'persona') return null;
    const gratuito = componenti.map(c =>
        Number.isInteger(cat.gratuitoSottoEta) && dataValida(c.dataNascita) && dataValida(evento?.data)
        && etaAlla(c.dataNascita, evento.data) < cat.gratuitoSottoEta);
    const paganti = gratuito.filter(g => !g).length;
    return { tipo, euroUnitario: sc.euro, paganti, gratuiti: n - paganti, importo: centesimi(sc.euro * paganti), gratuitoPerComponente: gratuito };
}

// ---------------------------------------------------------------- controlli

// Valore di un campo aggiuntivo: restituisce un messaggio d'errore o ''
export function erroreCampo(def, valore, chi = '') {
    const nome = `${chi}${def.etichetta}`;
    if (def.tipo === 'casella') {
        if (valore !== undefined && typeof valore !== 'boolean') return `${nome}: valore non valido.`;
        return def.obbligatorio && valore !== true ? `${nome}: è obbligatorio.` : '';
    }
    const v = typeof valore === 'string' ? valore.trim() : (valore === undefined || valore === null ? '' : null);
    if (v === null) return `${nome}: valore non valido.`;
    if (!v) return def.obbligatorio ? `${nome}: è obbligatorio.` : '';
    if (v.length > MAX_CAMPO) return `${nome}: massimo ${MAX_CAMPO} caratteri.`;
    switch (def.tipo) {
        case 'email':    return RE_EMAIL.test(v) ? '' : `${nome}: indirizzo email non valido.`;
        case 'telefono': return RE_TELEFONO.test(v) ? '' : `${nome}: numero di telefono non valido.`;
        case 'numero':   return isFinite(Number(v.replace(',', '.'))) ? '' : `${nome}: deve essere un numero.`;
        case 'scelta':   return (def.opzioni || []).includes(v) ? '' : `${nome}: scegli una delle opzioni.`;
        default:         return '';
    }
}

export function erroriSquadra(cat, dati) {
    const err = [];
    const nome = String(dati.nomeSquadra ?? '').trim();
    if (!nome) err.push('Il nome della squadra è obbligatorio.');
    else if (nome.length > MAX_NOME_SQUADRA) err.push(`Il nome della squadra può avere al massimo ${MAX_NOME_SQUADRA} caratteri.`);
    else if (!slugify(nome)) err.push('Il nome della squadra deve contenere almeno una lettera o un numero.');
    const email = String(dati.email ?? '').trim();
    if (!RE_EMAIL.test(email) || email.length > MAX_EMAIL) err.push('Inserisci un indirizzo email valido.');
    for (const def of cat?.campiSquadra || []) {
        const e = erroreCampo(def, dati.campiSquadra?.[def.id]);
        if (e) err.push(e);
    }
    return err;
}

export function erroriComponenti(evento, cat, componenti) {
    const err = [];
    const min = cat?.componentiMin ?? 1, max = cat?.componentiMax ?? 1;
    if (componenti.length < min || componenti.length > max)
        err.push(min === max ? `La squadra deve avere ${min} componenti.` : `La squadra deve avere da ${min} a ${max} componenti.`);
    const chiediData = richiedeDataNascita(cat);
    const oggi = oggiRoma();
    componenti.forEach((c, i) => {
        const chi = `Componente ${i + 1}: `;
        const n = String(c.nome ?? '').trim(), cg = String(c.cognome ?? '').trim();
        if (!n || !cg) err.push(`${chi}nome e cognome sono obbligatori.`);
        else if (n.length > MAX_NOME_PERSONA || cg.length > MAX_NOME_PERSONA) err.push(`${chi}nome o cognome troppo lungo.`);
        if (chiediData) {
            if (!dataValida(c.dataNascita) || c.dataNascita > oggi) err.push(`${chi}data di nascita non valida.`);
            else if (dataValida(evento?.data)) {
                const eta = etaAlla(c.dataNascita, evento.data);
                if (eta > 120) err.push(`${chi}data di nascita non valida.`);
                else if (Number.isInteger(cat.etaMinima) && eta < cat.etaMinima)
                    err.push(`${chi}per questa categoria serve un'età di almeno ${cat.etaMinima} anni il giorno dell'evento.`);
                else if (Number.isInteger(cat.etaMassima) && eta > cat.etaMassima)
                    err.push(`${chi}per questa categoria l'età massima è ${cat.etaMassima} anni il giorno dell'evento.`);
            }
        }
        for (const def of cat?.campiComponente || []) {
            const e = erroreCampo(def, c.campi?.[def.id], chi);
            if (e) err.push(e);
        }
    });
    return err;
}

// documentiSquadra / componenti[i].documenti: { idDocumento: percorsoStorage }
export function erroriDocumenti(cat, dati) {
    const err = [];
    for (const def of cat?.documenti || []) {
        if (!def.obbligatorio) continue;
        if (def.per === 'squadra') {
            if (!dati.documentiSquadra?.[def.id]) err.push(`Carica il documento "${def.nome}".`);
        } else {
            (dati.componenti || []).forEach((c, i) => {
                if (!c.documenti?.[def.id])
                    err.push(`Carica il documento "${def.nome}" di ${String(c.nome ?? '').trim() || `componente ${i + 1}`}.`);
            });
        }
    }
    return err;
}

export function erroriConsensi(cat, consensi) {
    const err = [];
    if (consensi?.regolamento !== true) err.push("Devi accettare il regolamento dell'evento.");
    if (consensi?.privacy !== true) err.push("Devi dichiarare di aver letto l'informativa privacy.");
    if (haDocumentiSanitari(cat) && consensi?.datiSanitari !== true)
        err.push('Devi acconsentire al trattamento dei dati sanitari (certificati medici).');
    return err;
}

/**
 * Controllo completo prima della creazione dell'iscrizione.
 * dati: { categoriaId, nomeSquadra, email, campiSquadra, componenti, documentiSquadra, consensi }
 * Restituisce l'elenco dei messaggi d'errore (vuoto se tutto va bene).
 */
export function erroriIscrizione(evento, dati, oggi = oggiRoma()) {
    if (!evento?.iscrizioniAperte) return ['Le iscrizioni a questo evento sono chiuse.'];
    const cat = categoriaDi(evento, dati.categoriaId);
    if (!cat || cat.attiva === false) return ['Scegli una categoria valida.'];
    const componenti = Array.isArray(dati.componenti) ? dati.componenti : [];
    const err = [
        ...erroriSquadra(cat, dati),
        ...erroriComponenti(evento, cat, componenti),
        ...erroriDocumenti(cat, { ...dati, componenti }),
        ...erroriConsensi(cat, dati.consensi)
    ];
    if (!calcolaImporto(evento, cat, componenti, oggi)) err.push('Per questa categoria non è disponibile una quota valida: contatta gli organizzatori.');
    return err;
}
