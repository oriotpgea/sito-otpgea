// Test della cancellazione automatica dei documenti con dati sanitari
// (funzione cancellaCertificati) con Firestore e Storage simulati.
// Esecuzione: "npm test" nella cartella functions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../logica.js';
import { FintoDb, FintoBucket, logMuto } from './finti.js';

const EV = 'ps-2027';
const DATA_EVENTO = '2027-04-18';          // + 60 giorni = 2027-06-17
const PREAVVISO = '2027-06-10';            // 7 giorni prima
const SCADENZA = '2027-06-17';

function evento(modifiche = {}) {
    return {
        titolo: 'Piacenza Svelata 2027', data: DATA_EVENTO, luogo: 'Piacenza', iscrizioniAperte: false,
        categorie: [
            {
                id: 'competitiva', nome: 'Competitiva',
                documenti: [
                    { id: 'certificato', nome: 'Certificato medico', per: 'componente', sanitario: true },
                    { id: 'liberatoria', nome: 'Liberatoria', per: 'squadra', sanitario: false },
                    { id: 'medico-squadra', nome: 'Dichiarazione medica', per: 'squadra', sanitario: true }
                ]
            },
            {
                // stesso id "certificato" ma senza dati sanitari: non va toccato
                id: 'scuole', nome: 'Scuole',
                documenti: [{ id: 'certificato', nome: 'Certificato di iscrizione scolastica', per: 'componente', sanitario: false }]
            }
        ],
        ...modifiche
    };
}

const p = (iid, f) => `eventi/${EV}/${iid}/${f}`;

function ambiente() {
    const db = new FintoDb();
    const bucket = new FintoBucket();
    let ora = new Date(`${PREAVVISO}T01:15:00Z`);
    const dep = { db, bucket, log: logMuto, ora: () => new Date(ora) };
    db.dati.set(`eventi/${EV}`, evento());
    db.dati.set('admin/riccardo.fava1@gmail.com', {});
    db.dati.set('admin/ori.otpgea@gmail.com', {});

    const iscr = (id, categoriaId, stato, componenti, documentiSquadra = {}) => {
        db.dati.set(`eventi/${EV}/iscrizioni/${id}`, {
            nomeSquadra: `Squadra ${id}`, categoriaId, stato, componenti, documentiSquadra,
            verifiche: { documentiOk: true }, notaAdmin: 'nota', importo: 10
        });
        for (const c of componenti) for (const f of Object.values(c.documenti)) bucket.aggiungi(f);
        for (const f of Object.values(documentiSquadra)) bucket.aggiungi(f);
    };
    iscr('a1', 'competitiva', 'pagata',
        [{ nome: 'Mario', cognome: 'Rossi', documenti: { certificato: p('a1', 'c0.pdf') } },
         { nome: 'Luca', cognome: 'Rossi', documenti: { certificato: p('a1', 'c1.jpg') } }],
        { liberatoria: p('a1', 'lib.pdf'), 'medico-squadra': p('a1', 'med.pdf') });
    iscr('a2', 'competitiva', 'annullata',
        [{ nome: 'Anna', cognome: 'Bianchi', documenti: { certificato: p('a2', 'c0.pdf') } }]);
    iscr('s1', 'scuole', 'pagata',
        [{ nome: 'Ugo', cognome: 'Verdi', documenti: { certificato: p('s1', 'c0.pdf') } }]);
    iscr('n1', 'competitiva', 'pagata', [{ nome: 'Senza', cognome: 'File', documenti: {} }]);

    return { db, bucket, dep, vaiAl: giorno => { ora = new Date(`${giorno}T01:15:00Z`); } };
}

const mail = db => db.chiavi('mail/').map(k => db.leggi(k));
const evDoc = db => db.leggi(`eventi/${EV}`);

test('aggiungiGiorni', () => {
    assert.equal(L.aggiungiGiorni('2027-04-18', 60), '2027-06-17');
    assert.equal(L.aggiungiGiorni('2027-06-17', -7), '2027-06-10');
    assert.equal(L.aggiungiGiorni('2028-12-28', 7), '2029-01-04');
});

test('prima del periodo di preavviso non succede nulla', async () => {
    const env = ambiente();
    env.vaiAl('2027-06-09');
    const r = await L.cancellaCertificati(env.dep);
    assert.deepEqual(r, { preavvisi: 0, eventiCompletati: 0, file: 0, errori: 0 });
    assert.equal(mail(env.db).length, 0);
    assert.equal(evDoc(env.db).certificatiPreavvisoIl, undefined);
});

test('preavviso 7 giorni prima: email agli admin una sola volta, nessun file toccato', async () => {
    const env = ambiente();
    const nFile = env.bucket.oggetti.size;
    const r = await L.cancellaCertificati(env.dep);
    assert.equal(r.preavvisi, 1);
    const m = mail(env.db);
    assert.equal(m.length, 1);
    assert.deepEqual(m[0].to.sort(), ['ori.otpgea@gmail.com', 'riccardo.fava1@gmail.com']);
    assert.match(m[0].message.subject, /Documenti sanitari da cancellare il 17 giugno 2027 – Piacenza Svelata 2027/);
    // a1: 2 certificati + dichiarazione medica; a2 (annullata): 1 certificato; s1: certificato NON sanitario
    assert.match(m[0].message.text, /4 documenti con dati sanitari \(Certificato medico, Dichiarazione medica\) di 2 squadre/);
    assert.equal(evDoc(env.db).certificatiCancellazioneDal, SCADENZA);
    assert.ok(evDoc(env.db).certificatiPreavvisoIl instanceof Date);
    assert.equal(env.bucket.oggetti.size, nFile);

    env.vaiAl('2027-06-16');
    await L.cancellaCertificati(env.dep);
    assert.equal(mail(env.db).length, 1, 'nessun secondo preavviso');
    assert.equal(env.bucket.oggetti.size, nFile, 'ancora nulla cancellato il giorno prima');
});

test('alla scadenza: cancella solo i documenti sanitari, annota la data, riepilogo agli admin', async () => {
    const env = ambiente();
    await L.cancellaCertificati(env.dep);           // preavviso
    env.vaiAl(SCADENZA);
    const r = await L.cancellaCertificati(env.dep);
    assert.deepEqual(r, { preavvisi: 0, eventiCompletati: 1, file: 4, errori: 0 });

    const b = env.bucket.oggetti;
    for (const f of [p('a1', 'c0.pdf'), p('a1', 'c1.jpg'), p('a1', 'med.pdf'), p('a2', 'c0.pdf')]) assert.ok(!b.has(f), `${f} cancellato`);
    assert.ok(b.has(p('a1', 'lib.pdf')), 'liberatoria (non sanitaria) conservata');
    assert.ok(b.has(p('s1', 'c0.pdf')), 'documento non sanitario di un\'altra categoria conservato');

    const a1 = env.db.leggi(`eventi/${EV}/iscrizioni/a1`);
    assert.deepEqual(a1.componenti[0].documenti, {});
    assert.ok(a1.componenti[0].documentiCancellati.certificato instanceof Date);
    assert.deepEqual(a1.documentiSquadra, { liberatoria: p('a1', 'lib.pdf') });
    assert.deepEqual(Object.keys(a1.documentiSquadraCancellati), ['medico-squadra']);
    assert.equal(a1.componenti[1].nome, 'Luca', 'altri dati invariati');
    assert.deepEqual(a1.verifiche, { documentiOk: true });
    assert.equal(a1.stato, 'pagata');
    assert.equal(a1.notaAdmin, 'nota');
    assert.ok(env.db.leggi(`eventi/${EV}/iscrizioni/a2`).componenti[0].documentiCancellati.certificato, 'anche le annullate');
    const s1 = env.db.leggi(`eventi/${EV}/iscrizioni/s1`);
    assert.equal(s1.componenti[0].documenti.certificato, p('s1', 'c0.pdf'));
    assert.equal(s1.componenti[0].documentiCancellati, undefined);
    assert.equal(env.db.leggi(`eventi/${EV}/iscrizioni/n1`).componenti[0].documentiCancellati, undefined);

    assert.ok(evDoc(env.db).certificatiCancellatiIl instanceof Date);
    const m = mail(env.db);
    assert.equal(m.length, 2);
    assert.match(m[1].message.subject, /Documenti sanitari cancellati – Piacenza Svelata 2027/);
    assert.match(m[1].message.text, /cancellati 4 documenti con dati sanitari .* di 2 squadre/);

    // le notti successive non succede più nulla
    env.vaiAl('2027-06-18');
    assert.deepEqual(await L.cancellaCertificati(env.dep), { preavvisi: 0, eventiCompletati: 0, file: 0, errori: 0 });
    assert.equal(mail(env.db).length, 2);
});

test('scadenza già passata senza preavviso: preavviso ora, cancellazione 7 giorni dopo', async () => {
    const env = ambiente();
    env.vaiAl('2027-09-01');
    await L.cancellaCertificati(env.dep);
    assert.equal(evDoc(env.db).certificatiCancellazioneDal, '2027-09-08');
    assert.match(mail(env.db)[0].message.subject, /8 settembre 2027/);
    env.vaiAl('2027-09-07');
    await L.cancellaCertificati(env.dep);
    assert.ok(env.bucket.oggetti.has(p('a1', 'c0.pdf')), 'non prima del giorno annunciato');
    env.vaiAl('2027-09-08');
    await L.cancellaCertificati(env.dep);
    assert.ok(!env.bucket.oggetti.has(p('a1', 'c0.pdf')));
    assert.ok(evDoc(env.db).certificatiCancellatiIl);
});

test('evento senza documenti sanitari: nessuna email, evento segnato come trattato', async () => {
    const env = ambiente();
    env.db.dati.set(`eventi/${EV}`, evento({ categorie: [{ id: 'competitiva', nome: 'C', documenti: [] }] }));
    await L.cancellaCertificati(env.dep);
    env.vaiAl(SCADENZA);
    await L.cancellaCertificati(env.dep);
    assert.equal(mail(env.db).length, 0);
    assert.ok(evDoc(env.db).certificatiCancellatiIl);
    assert.ok(env.bucket.oggetti.has(p('a1', 'c0.pdf')));
});

test('evento senza data valida: ignorato', async () => {
    const env = ambiente();
    env.db.dati.set(`eventi/${EV}`, evento({ data: '' }));
    env.vaiAl('2030-01-01');
    assert.deepEqual(await L.cancellaCertificati(env.dep), { preavvisi: 0, eventiCompletati: 0, file: 0, errori: 0 });
});

test('errore di Storage: si riprova la notte dopo, il riepilogo conta tutto', async () => {
    const env = ambiente();
    await L.cancellaCertificati(env.dep);
    env.vaiAl(SCADENZA);
    const fileOrig = env.bucket.file.bind(env.bucket);
    env.bucket.file = path => {
        const f = fileOrig(path);
        if (path === p('a2', 'c0.pdf')) f.delete = async () => { throw new Error('Storage non disponibile'); };
        return f;
    };
    const r1 = await L.cancellaCertificati(env.dep);
    assert.equal(r1.errori, 1);
    assert.equal(r1.file, 3);
    assert.equal(evDoc(env.db).certificatiCancellatiIl, undefined, 'evento non segnato');
    assert.equal(mail(env.db).length, 1, 'nessun riepilogo parziale');

    env.bucket.file = fileOrig;
    env.vaiAl('2027-06-18');
    const r2 = await L.cancellaCertificati(env.dep);
    assert.deepEqual(r2, { preavvisi: 0, eventiCompletati: 1, file: 1, errori: 0 });
    assert.match(mail(env.db)[1].message.text, /cancellati 4 documenti .* di 2 squadre/);
});
