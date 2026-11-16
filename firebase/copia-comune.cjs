// Copia iscrizioni-comune.js (radice del sito) in functions/comune.js.
// Le Cloud Functions devono usare esattamente le stesse regole del form.
// Viene eseguito automaticamente da "npm test" e "npm run deploy" (cartella functions).
const fs = require('fs');
const path = require('path');

const origine = path.join(__dirname, '..', 'iscrizioni-comune.js');
const destinazione = path.join(__dirname, 'functions', 'comune.js');

if (!fs.existsSync(origine)) {
    console.error(`File non trovato: ${origine}`);
    process.exit(1);
}
const intestazione = '// COPIA AUTOMATICA di ../../iscrizioni-comune.js (creata da copia-comune.cjs): non modificare qui.\n';
fs.writeFileSync(destinazione, intestazione + fs.readFileSync(origine, 'utf8'));
console.log('comune.js aggiornato da iscrizioni-comune.js');
