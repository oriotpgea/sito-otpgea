// Test del client SumUp con una fetch simulata (nessuna chiamata reale)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creaClientSumUp } from '../sumup.js';

function fetchFinta(risposte) {
    const chiamate = [];
    const f = async (url, opz) => {
        chiamate.push({ url, ...opz, corpo: opz.body ? JSON.parse(opz.body) : null });
        const r = risposte.shift();
        return { ok: r.status < 300, status: r.status, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)) };
    };
    f.chiamate = chiamate;
    return f;
}

test('creaCheckout invia i campi previsti da SumUp', async () => {
    const f = fetchFinta([{ status: 201, body: { id: 'c1', status: 'PENDING', hosted_checkout_url: 'https://checkout.sumup.com/pay/x' } }]);
    const s = creaClientSumUp({ apiKey: 'sup_sk_test', merchantCode: 'MC123', fetchImpl: f });
    const r = await s.creaCheckout({ riferimento: 'abc-1', importo: 7.5, descrizione: 'Evento – Squadra', redirectUrl: 'https://sito/ritorno', returnUrl: 'https://webhook' });
    assert.equal(r.id, 'c1');
    const c = f.chiamate[0];
    assert.equal(c.url, 'https://api.sumup.com/v0.1/checkouts');
    assert.equal(c.method, 'POST');
    assert.equal(c.headers.Authorization, 'Bearer sup_sk_test');
    assert.deepEqual(c.corpo, {
        checkout_reference: 'abc-1', amount: 7.5, currency: 'EUR', merchant_code: 'MC123',
        description: 'Evento – Squadra', redirect_url: 'https://sito/ritorno', return_url: 'https://webhook',
        hosted_checkout: { enabled: true }
    });
});

test('leggiCheckout e disattivaCheckout', async () => {
    const f = fetchFinta([{ status: 200, body: { id: 'c/1', status: 'PAID' } }, { status: 200 }, { status: 409, body: { message: 'already processed' } }]);
    const s = creaClientSumUp({ apiKey: 'k', merchantCode: 'm', fetchImpl: f });
    assert.equal((await s.leggiCheckout('c/1')).status, 'PAID');
    assert.equal(f.chiamate[0].url, 'https://api.sumup.com/v0.1/checkouts/c%2F1');
    assert.equal(f.chiamate[0].method, 'GET');
    assert.equal(await s.disattivaCheckout('c1'), true);
    assert.equal(f.chiamate[1].method, 'DELETE');
    assert.equal(await s.disattivaCheckout('c2'), false);
});

test('errore HTTP: eccezione con lo stato', async () => {
    const f = fetchFinta([{ status: 401, body: { error_code: 'INVALID_ACCESS_TOKEN' } }]);
    const s = creaClientSumUp({ apiKey: 'sbagliata', merchantCode: 'm', fetchImpl: f });
    await assert.rejects(s.leggiCheckout('x'), e => e.status === 401 && /INVALID_ACCESS_TOKEN/.test(e.message));
});
