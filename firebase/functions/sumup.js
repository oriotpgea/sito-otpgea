// =============================================================================
// Client minimo per le API SumUp (checkout online con Hosted Checkout)
// Documentazione: https://developer.sumup.com/online-payments/checkouts/hosted-checkout/
// =============================================================================

const BASE = 'https://api.sumup.com';

export function creaClientSumUp({ apiKey, merchantCode, fetchImpl = globalThis.fetch }) {
    async function chiama(metodo, percorso, corpo) {
        const res = await fetchImpl(BASE + percorso, {
            method: metodo,
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: corpo ? JSON.stringify(corpo) : undefined,
            signal: AbortSignal.timeout(15000)
        });
        const testo = await res.text();
        let dati = null;
        try { dati = testo ? JSON.parse(testo) : null; } catch { /* risposta non JSON */ }
        if (!res.ok) {
            const e = new Error(`SumUp ${metodo} ${percorso}: HTTP ${res.status} ${testo.slice(0, 300)}`);
            e.status = res.status;
            e.dati = dati;
            throw e;
        }
        return dati;
    }

    return {
        // Crea un checkout con pagina di pagamento ospitata da SumUp.
        // Risposta: { id, status: "PENDING", hosted_checkout_url, ... }
        creaCheckout({ riferimento, importo, descrizione, redirectUrl, returnUrl }) {
            return chiama('POST', '/v0.1/checkouts', {
                checkout_reference: riferimento,
                amount: importo,
                currency: 'EUR',
                merchant_code: merchantCode,
                description: descrizione,
                redirect_url: redirectUrl,
                return_url: returnUrl,
                hosted_checkout: { enabled: true }
            });
        },

        // Stato attuale: PENDING | PAID | FAILED | EXPIRED, con l'elenco "transactions"
        leggiCheckout(id) {
            return chiama('GET', `/v0.1/checkouts/${encodeURIComponent(id)}`);
        },

        // Disattiva un checkout non ancora pagato (evita pagamenti doppi).
        // Restituisce false se SumUp lo rifiuta (es. già pagato o già scaduto).
        async disattivaCheckout(id) {
            try {
                await chiama('DELETE', `/v0.1/checkouts/${encodeURIComponent(id)}`);
                return true;
            } catch {
                return false;
            }
        }
    };
}
