// Seleziona tutti i link della navigazione e le sezioni della pagina
const navLinks = document.querySelectorAll('.nav-links a');
const sections = document.querySelectorAll('section');

// Funzione per cambiare il link attivo
function changeActiveLink() {
    let index = sections.length;

    // Scorre le sezioni dal basso verso l'alto
    while(--index && window.scrollY + 50 < sections[index].offsetTop) {}
    
    // Rimuove la classe 'active' da tutti i link
    navLinks.forEach((link) => link.classList.remove('active'));
    
    // Aggiunge la classe 'active' al link corrispondente alla sezione visualizzata
    // Controlla che il link esista prima di aggiungere la classe
    if (navLinks[index]) {
        navLinks[index].classList.add('active');
    }
}

// Esegue la funzione al caricamento della pagina e durante lo scorrimento
window.addEventListener('load', changeActiveLink);
window.addEventListener('scroll', changeActiveLink);