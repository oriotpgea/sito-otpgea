// Versioni simulate in memoria di Firestore, Storage e SumUp, per i test.
// Riproducono solo le funzioni usate da logica.js.

function clona(v) {
    if (v === undefined) throw new Error('Valore undefined non ammesso in Firestore');
    if (v === null || typeof v !== 'object' || v instanceof Date) return v instanceof Date ? new Date(v) : v;
    if (Array.isArray(v)) return v.map(clona);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clona(x)]));
}

let contatore = 0;
const idAuto = () => `auto${(++contatore).toString().padStart(4, '0')}x`;

class Rif {
    constructor(db, path) { this.db = db; this.path = path; this.id = path.split('/').pop(); }
    async get() {
        const d = this.db.dati.get(this.path);
        return { id: this.id, ref: this, exists: d !== undefined, data: () => (d === undefined ? undefined : clona(d)) };
    }
    async set(d) { this._set(d); }
    _set(d) { this.db.dati.set(this.path, clona(d)); }
    async update(d) { this._update(d); }
    _update(d) {
        const att = this.db.dati.get(this.path);
        if (!att) throw new Error(`NOT_FOUND ${this.path}`);
        const n = clona(att);
        for (const [k, v] of Object.entries(d)) {
            const parti = k.split('.');
            let o = n;
            for (const p of parti.slice(0, -1)) {
                if (typeof o[p] !== 'object' || o[p] === null) o[p] = {};
                o = o[p];
            }
            o[parti[parti.length - 1]] = clona(v);
        }
        this.db.dati.set(this.path, n);
    }
    async delete() { this.db.dati.delete(this.path); }
}

class Coll {
    constructor(db, path, filtri = []) { this.db = db; this.path = path; this.filtri = filtri; }
    doc(id) { return new Rif(this.db, `${this.path}/${id ?? idAuto()}`); }
    where(f, op, v) {
        if (op !== '==') throw new Error('Solo == nel finto Firestore');
        return new Coll(this.db, this.path, [...this.filtri, { f, v }]);
    }
    async get() {
        const n = this.path.split('/').length;
        const chiavi = [...this.db.dati.keys()]
            .filter(k => k.startsWith(this.path + '/') && k.split('/').length === n + 1)
            .filter(k => this.filtri.every(fl => this.db.dati.get(k)[fl.f] === fl.v));
        const docs = await Promise.all(chiavi.map(k => new Rif(this.db, k).get()));
        return { docs, size: docs.length, empty: !docs.length };
    }
}

export class FintoDb {
    constructor() { this.dati = new Map(); this.transazioni = 0; }
    doc(path) { return new Rif(this, path); }
    collection(path) { return new Coll(this, path); }
    async runTransaction(fn) {
        this.transazioni++;
        const scritture = [];
        let haScritto = false;
        const tx = {
            get: async r => {
                if (haScritto) throw new Error('Lettura dopo scrittura nella transazione');
                return r.get();
            },
            set: (r, d) => { haScritto = true; clona(d); scritture.push(() => r._set(d)); },
            update: (r, d) => { haScritto = true; scritture.push(() => r._update(d)); },
            delete: r => { haScritto = true; scritture.push(() => this.dati.delete(r.path)); }
        };
        const esito = await fn(tx);
        scritture.forEach(s => s());
        return esito;
    }
    // utilità per i test
    leggi(path) { return this.dati.get(path); }
    chiavi(prefisso) { return [...this.dati.keys()].filter(k => k.startsWith(prefisso)); }
}

export class FintoBucket {
    constructor() { this.oggetti = new Map(); }
    aggiungi(path, { size = 1000, contentType = 'application/pdf', timeCreated = new Date().toISOString() } = {}) {
        this.oggetti.set(path, { size: String(size), contentType, timeCreated });
    }
    file(path) {
        const b = this;
        return {
            name: path,
            get metadata() { return b.oggetti.get(path); },
            async getMetadata() {
                if (!b.oggetti.has(path)) { const e = new Error('No such object'); e.code = 404; throw e; }
                return [b.oggetti.get(path)];
            },
            async copy(dest) {
                if (!b.oggetti.has(path)) throw new Error('No such object');
                b.oggetti.set(typeof dest === 'string' ? dest : dest.name, { ...b.oggetti.get(path), timeCreated: new Date().toISOString() });
            },
            async delete() { b.oggetti.delete(path); }
        };
    }
    async getFiles({ prefix }) {
        return [[...this.oggetti.keys()].filter(k => k.startsWith(prefix)).map(k => this.file(k))];
    }
}

export class FintoSumUp {
    constructor() { this.checkout = new Map(); this.creati = []; this.disattivati = []; this.guasto = false; this.n = 0; }
    async creaCheckout(arg) {
        if (this.guasto) throw new Error('SumUp non raggiungibile');
        const id = `chk-${++this.n}`;
        const c = {
            id, status: 'PENDING', amount: arg.importo, currency: 'EUR', checkout_reference: arg.riferimento,
            hosted_checkout_url: `https://checkout.sumup.com/pay/${id}`, transactions: []
        };
        this.checkout.set(id, c);
        this.creati.push({ id, ...arg });
        return { ...c };
    }
    async leggiCheckout(id) {
        if (this.guasto) throw new Error('SumUp non raggiungibile');
        const c = this.checkout.get(id);
        if (!c) { const e = new Error('404'); e.status = 404; throw e; }
        return JSON.parse(JSON.stringify(c));
    }
    async disattivaCheckout(id) {
        const c = this.checkout.get(id);
        if (!c || c.status === 'PAID') return false;
        c.status = 'EXPIRED';
        this.disattivati.push(id);
        return true;
    }
    // simula il pagamento sulla pagina SumUp
    paga(id, importo) {
        const c = this.checkout.get(id);
        c.status = 'PAID';
        if (importo !== undefined) c.amount = importo;
        c.transactions = [{ id: 't' + id, transaction_code: 'TX' + id.toUpperCase(), status: 'SUCCESSFUL', amount: c.amount }];
    }
    fallisci(id) { this.checkout.get(id).status = 'FAILED'; }
}

export const logMuto = { info() {}, warn() {}, error() {} };
