/* ==========================================================================
   MENU HAMBURGER
   ========================================================================== */

// Aggiorna aria-expanded e l'etichetta del pulsante hamburger
function aggiornaStatoMenu(pulsante, aperto) {
    pulsante.setAttribute('aria-expanded', aperto ? 'true' : 'false');
    pulsante.setAttribute('aria-label', aperto ? 'Chiudi menu' : 'Apri menu');
}

document.addEventListener('DOMContentLoaded', function () {
    // Menu hamburger — sito principale
    const menuToggle = document.getElementById('menu-toggle');
    const navLinks = document.querySelector('.nav-links');

    if (menuToggle) {
        menuToggle.addEventListener('click', function () {
            navLinks.classList.toggle('active');
            aggiornaStatoMenu(menuToggle, navLinks.classList.contains('active'));
            const icon = menuToggle.querySelector('i');
            if (icon.classList.contains('fa-bars')) {
                icon.classList.remove('fa-bars');
                icon.classList.add('fa-times');
            } else {
                icon.classList.remove('fa-times');
                icon.classList.add('fa-bars');
            }
        });
    }

    // Menu hamburger — pagine Piacenza Svelata
    const menuTogglePS = document.getElementById('menuToggle');
    const mainNav = document.getElementById('mainNav');

    if (menuTogglePS && mainNav) {
        menuTogglePS.addEventListener('click', () => {
            mainNav.classList.toggle('active');
            aggiornaStatoMenu(menuTogglePS, mainNav.classList.contains('active'));
            const icon = menuTogglePS.querySelector('i');
            if (mainNav.classList.contains('active')) {
                icon.classList.remove('fa-bars');
                icon.classList.add('fa-times');
            } else {
                icon.classList.remove('fa-times');
                icon.classList.add('fa-bars');
            }
        });
    }
});

/* ==========================================================================
   MENU A TENDINA — utilizzabile con mouse, tastiera e touch
   Si apre al passaggio del mouse (CSS), quando riceve il focus (CSS :focus-within)
   e con il clic/tocco sulla voce principale. Esc la chiude.
   ========================================================================== */
document.addEventListener('DOMContentLoaded', function () {
    const tendine = document.querySelectorAll('.nav-links .dropdown');
    if (!tendine.length) return;

    function imposta(tendina, aperta) {
        const voce = tendina.querySelector('.dropdown-toggle');
        tendina.classList.toggle('aperto', aperta);
        if (voce) voce.setAttribute('aria-expanded', aperta ? 'true' : 'false');
    }

    function chiudiAltre(tranne) {
        tendine.forEach(t => {
            if (t !== tranne) {
                imposta(t, false);
                t.classList.remove('chiuso');
            }
        });
    }

    tendine.forEach(tendina => {
        const voce = tendina.querySelector('.dropdown-toggle');
        if (!voce) return;

        voce.addEventListener('click', function (event) {
            event.preventDefault(); // la voce non porta a nessuna pagina
            const apri = !tendina.classList.contains('aperto');
            chiudiAltre(tendina);
            imposta(tendina, apri);
            tendina.classList.toggle('chiuso', !apri);
        });

        // Focus da tastiera: la tendina è visibile (CSS :focus-within)
        tendina.addEventListener('focusin', function () {
            if (!tendina.classList.contains('chiuso')) {
                voce.setAttribute('aria-expanded', 'true');
            }
        });

        // Il focus esce dalla tendina: si chiude
        tendina.addEventListener('focusout', function (event) {
            if (!tendina.contains(event.relatedTarget)) {
                imposta(tendina, false);
                tendina.classList.remove('chiuso');
            }
        });

        tendina.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                imposta(tendina, false);
                tendina.classList.add('chiuso');
                voce.focus();
            }
        });
    });

    // Clic o tocco fuori dal menu: chiude le tendine aperte
    document.addEventListener('click', function (event) {
        if (!event.target.closest('.nav-links .dropdown')) {
            chiudiAltre(null);
        }
    });
});

/* ==========================================================================
   VIDEO HERO (ps-home.html) — rispetta "riduci movimento" del sistema:
   il video non parte e resta visibile l'immagine poster.
   ========================================================================== */
const preferisceMenoMovimento = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

document.addEventListener('DOMContentLoaded', function () {
    const video = document.querySelector('.hero__video');
    if (!video || !preferisceMenoMovimento) return;
    video.removeAttribute('autoplay');
    video.pause();
    video.querySelectorAll('source').forEach(s => s.remove());
    video.removeAttribute('src');
    video.load(); // senza sorgente il browser mostra il poster
});

/* ==========================================================================
   GESTIONE VIDEO YOUTUBE A DUE CLICK (Versione Cookiebot)
   ========================================================================== */
document.querySelectorAll('.video-due-click-container').forEach(container => {
    container.addEventListener('click', function() {
        const videoId = this.dataset.videoId;
        const iframe = document.createElement('iframe');

        iframe.setAttribute('data-cookieblock-src', `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`);
        iframe.setAttribute('data-cookieconsent', 'marketing');

        iframe.setAttribute('frameborder', '0');
        iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
        iframe.setAttribute('allowfullscreen', '');

        // Consenso ai cookie di marketing già dato: il video parte subito, senza avviso
        if (typeof Cookiebot !== 'undefined' && Cookiebot.consent && Cookiebot.consent.marketing) {
            iframe.removeAttribute('data-cookieblock-src');
            iframe.removeAttribute('data-cookieconsent');
            iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
            this.innerHTML = '';
            this.appendChild(iframe);
            return;
        }

        // Creazione dinamica del messaggio di avviso
        const warningDiv = document.createElement('div');
        warningDiv.className = 'cookieconsent-optout-marketing';
        warningDiv.innerHTML = '<p>Per visualizzare questo video, è necessario accettare i cookie di marketing.<br><br><a href="javascript:Cookiebot.renew()">Modifica il tuo consenso qui</a>.</p>';

        this.innerHTML = '';
        this.appendChild(warningDiv);
        this.appendChild(iframe);

        if (typeof Cookiebot !== 'undefined') {
            Cookiebot.runScripts();
        }
    });
});

/* ==========================================================================
   SLIDESHOW NELLE CARD & MODALE UNIVERSALE (eventi.html)
   ========================================================================== */

// --- 1. Slideshow piccolo (nella card) ---
function moveLocalSlide(btn, n) {
    const container = btn.closest('.slideshow-container');
    const slides = container.getElementsByClassName('mySlides');

    // Trova la slide attualmente visibile
    let currentIndex = 0;
    for (let i = 0; i < slides.length; i++) {
        if (slides[i].style.display === 'block') {
            currentIndex = i;
            break;
        }
    }

    slides[currentIndex].style.display = 'none';

    // Nuovo indice (ciclico)
    let newIndex = currentIndex + n;
    if (newIndex >= slides.length) newIndex = 0;
    if (newIndex < 0) newIndex = slides.length - 1;

    slides[newIndex].style.display = 'block';
}

// --- 2. Modale universale (ingrandimento) ---
let currentModalImages = []; // Foto dello slideshow cliccato
let currentModalIndex = 0;   // Foto attualmente visualizzata

function openUniversalModal(imgElement) {
    const modal = document.getElementById('universalModal');
    const modalImg = document.getElementById('modalImage');

    // Raccoglie tutte le immagini dello stesso slideshow
    const container = imgElement.closest('.slideshow-container');
    const allImages = container.querySelectorAll('img');

    currentModalImages = [];
    allImages.forEach((img, index) => {
        currentModalImages.push(img.src);
        if (img === imgElement) {
            currentModalIndex = index;
        }
    });

    modal.style.display = 'block';
    modalImg.src = currentModalImages[currentModalIndex];
}

function closeUniversalModal() {
    const modal = document.getElementById('universalModal');
    if (modal) modal.style.display = 'none';
}

function moveModalImage(n) {
    currentModalIndex += n;

    // Ciclo infinito
    if (currentModalIndex >= currentModalImages.length) currentModalIndex = 0;
    if (currentModalIndex < 0) currentModalIndex = currentModalImages.length - 1;

    document.getElementById('modalImage').src = currentModalImages[currentModalIndex];
}

// Chiude la modale con il tasto ESC (solo nelle pagine che la contengono)
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        closeUniversalModal();
    }
});

/* ==========================================================================
   MODALE NEWSLETTER AUTOMATICO (index.html)
   ========================================================================== */
document.addEventListener('DOMContentLoaded', function () {
    const newsModal = document.getElementById('newsletterAutoModal');
    if (!newsModal) return;
    const closeBtn = document.querySelector('.close-newsletter');
    const goToBtn = document.getElementById('goToNewsletterBtn');
    const footerForm = document.getElementById('contatti-newsletter-box');

    // Mostra il modale dopo 1.5 secondi dal caricamento della pagina
    setTimeout(() => {
        newsModal.style.display = 'block';
    }, 1500);

    // Chiude il modale sulla X
    closeBtn.addEventListener('click', function() {
        newsModal.style.display = 'none';
    });

    // Chiude il modale cliccando fuori dal box
    window.addEventListener('click', function(event) {
        if (event.target == newsModal) {
            newsModal.style.display = 'none';
        }
    });

    // Bottone "Iscriviti Ora": chiude il popup, porta al form ed evidenzia
    goToBtn.addEventListener('click', function() {
        newsModal.style.display = 'none';

        footerForm.scrollIntoView({ behavior: preferisceMenoMovimento ? 'auto' : 'smooth', block: 'center' });

        footerForm.classList.add('highlight-form');
        setTimeout(() => {
            footerForm.classList.remove('highlight-form');
        }, 3000);
    });
});

/* ==========================================================================
   PIACENZA SVELATA — FAQ (ps-come-funziona.html)
   ========================================================================== */
class Accordion {
    constructor(containerSelector, itemSelector = 'details') {
        this.container = document.querySelector(containerSelector);
        this.itemSelector = itemSelector;
    }

    init() {
        if (!this.container) return;
        this.container.addEventListener('click', (e) => {
            const summary = e.target.closest('summary');
            if (!summary) return;

            const item = summary.closest(this.itemSelector);
            if (item) {
                e.preventDefault();
                item.open = !item.open;
            }
        });
    }
}

/* ==========================================================================
   PIACENZA SVELATA — SELETTORE EDIZIONI (ps-edizioni.html)
   ========================================================================== */
function initEditionTabs() {
    const tabs = document.querySelectorAll('.edition-tab');
    const contents = document.querySelectorAll('.edition-content');

    if (tabs.length === 0) return;

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.target;

            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            const targetContent = document.getElementById(target);
            if (targetContent) {
                targetContent.classList.add('active');
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', function () {
    if (document.querySelector('.faq__container')) {
        new Accordion('.faq__container', '.faq__item').init();
    }
    initEditionTabs();
});
