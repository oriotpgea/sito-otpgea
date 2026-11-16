// =============================================================================
// Email inviate dalle funzioni (tramite la collezione "mail" letta
// dall'estensione Trigger Email). Lo stile è lo stesso delle email di ps-admin.
// =============================================================================

export const EMAIL_DEFAULT = {
    oggetto: 'Iscrizione confermata – {evento} – {squadra}',
    testo: 'Ciao,\n'
         + "l'iscrizione della squadra {squadra} alla categoria {categoria} è confermata.\n"
         + 'Importo: {importo}\n\n'
         + 'Ti aspettiamo il {data} a {luogo}!\n\n'
         + 'A presto,\n'
         + 'Il team di Piacenza Svelata'
};

export function escHtml(t) {
    return String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function fmtEuro(n) {
    return Number(n || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
}

export function fmtDataStr(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return '';
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function valoriSegnaposto(evento, iscrizione) {
    return {
        squadra:   iscrizione.nomeSquadra || '',
        categoria: iscrizione.categoria?.nome || iscrizione.categoriaId || '',
        evento:    evento?.titolo || '',
        data:      fmtDataStr(evento?.data),
        luogo:     evento?.luogo || '',
        importo:   iscrizione.importo > 0 ? fmtEuro(iscrizione.importo) : 'gratuita'
    };
}

export function sostituisci(testo, valori, esc) {
    return String(testo ?? '').replace(/\{(squadra|categoria|evento|data|luogo|importo)\}/g,
        (_, k) => (esc ? escHtml(valori[k]) : valori[k]));
}

export function emailHtml(titolo, testo, valori) {
    const corpo = sostituisci(escHtml(testo), valori, true).replace(/\r?\n/g, '<br>');
    return `<div style="background-color: #050505; padding: 40px 20px; font-family: Arial, sans-serif; color: #e0e0e0; line-height: 1.6;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #121212; border: 1px solid #333333; border-radius: 8px; padding: 30px;">
        <h2 style="color: #FF0099; font-size: 22px; font-weight: 800; margin-top: 0; text-transform: uppercase; letter-spacing: 1px; border-bottom: 2px solid #2E7D32; padding-bottom: 10px;">${escHtml(titolo)}</h2>
        <p style="font-size: 16px; margin: 0;">${corpo}</p>
    </div>
</div>`;
}

// Documento per la collezione "mail" con la conferma d'iscrizione
export function emailConferma(evento, iscrizione) {
    const valori = valoriSegnaposto(evento, iscrizione);
    const oggetto = evento?.email?.oggettoConferma || EMAIL_DEFAULT.oggetto;
    const testo   = evento?.email?.testoConferma   || EMAIL_DEFAULT.testo;
    return {
        to: iscrizione.email,
        message: {
            subject: sostituisci(oggetto, valori, false),
            text:    sostituisci(testo, valori, false),
            html:    emailHtml(valori.evento || 'Piacenza Svelata', testo, valori)
        }
    };
}

// Avviso agli organizzatori (anomalie sui pagamenti)
export function emailAvvisoAdmin(destinatari, oggetto, testo) {
    return {
        to: destinatari,
        message: {
            subject: `[Iscrizioni] ${oggetto}`,
            text: testo,
            html: emailHtml('Avviso iscrizioni', testo, {})
        }
    };
}
