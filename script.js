document.addEventListener('DOMContentLoaded', function () {
    // Menu hamburger — sito principale
    const menuToggle = document.getElementById('menu-toggle');
    const navLinks = document.querySelector('.nav-links');

    if (menuToggle) {
        menuToggle.addEventListener('click', function () {
            navLinks.classList.toggle('active');
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
   GESTIONE SLIDESHOW INTELLIGENTE & MODALE UNIVERSALE
   ========================================================================== */

// --- 1. Gestione Slideshow Piccolo (nella card) ---
function moveLocalSlide(btn, n) {
    // Trova il contenitore dello slideshow relativo al bottone cliccato
    let container = btn.closest('.slideshow-container');
    let slides = container.getElementsByClassName("mySlides");
    
    // Trova la slide attualmente visibile
    let currentIndex = 0;
    for (let i = 0; i < slides.length; i++) {
        if (slides[i].style.display === "block") {
            currentIndex = i;
            break;
        }
    }

    // Nasconde quella corrente
    slides[currentIndex].style.display = "none";

    // Calcola il nuovo indice (ciclico)
    let newIndex = currentIndex + n;
    if (newIndex >= slides.length) newIndex = 0;
    if (newIndex < 0) newIndex = slides.length - 1;

    // Mostra la nuova slide
    slides[newIndex].style.display = "block";
}


// --- 2. Gestione Modale Universale (Ingrandimento) ---
let currentModalImages = []; // Lista temporanea delle foto della card cliccata
let currentModalIndex = 0;   // Indice della foto che sto guardando

function openUniversalModal(imgElement) {
    let modal = document.getElementById("universalModal");
    let modalImg = document.getElementById("modalImage");
    
    // 1. Trova tutte le immagini dello stesso slideshow
    let container = imgElement.closest('.slideshow-container');
    let allImages = container.querySelectorAll('img');
    
    // 2. Salva le sorgenti (src) in una lista temporanea
    currentModalImages = [];
    allImages.forEach((img, index) => {
        currentModalImages.push(img.src);
        // Se questa è l'immagine cliccata, salviamo l'indice
        if (img === imgElement) {
            currentModalIndex = index;
        }
    });

    // 3. Mostra il modale con la foto giusta
    modal.style.display = "block";
    modalImg.src = currentModalImages[currentModalIndex];
}

function closeUniversalModal() {
    document.getElementById("universalModal").style.display = "none";
}

function moveModalImage(n) {
    // Aggiorna l'indice
    currentModalIndex += n;
    
    // Gestione ciclo infinito (se arrivi alla fine riparti dall'inizio)
    if (currentModalIndex >= currentModalImages.length) currentModalIndex = 0;
    if (currentModalIndex < 0) currentModalIndex = currentModalImages.length - 1;

    // Cambia la foto
    document.getElementById("modalImage").src = currentModalImages[currentModalIndex];
}

// Chiudi modale con tasto ESC
document.addEventListener('keydown', function(event) {
    if (event.key === "Escape") {
        closeUniversalModal();
    }
});

/* ==========================================================================
   GESTIONE MODALE NEWSLETTER AUTOMATICO
   ========================================================================== */
document.addEventListener('DOMContentLoaded', function () {
    const newsModal = document.getElementById('newsletterAutoModal');
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

    // Azione bottone "Iscriviti Ora": porta al footer ed evidenzia il form
    goToBtn.addEventListener('click', function() {
        newsModal.style.display = 'none'; // Chiude il popup
        
        // Scorrimento fluido verso il form
        footerForm.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Aggiunge effetto visivo al form per 3 secondi
        footerForm.classList.add('highlight-form');
        setTimeout(() => {
            footerForm.classList.remove('highlight-form');
        }, 3000);
    });
});

/* ----------------------------------------------------------
   Countdown — pagine Piacenza Svelata
---------------------------------------------------------- */
function initCountdown() {
    const countdownEl = document.getElementById('countdown');
    if (!countdownEl) return;
    const targetDate = new Date('2026-09-20T10:00:00').getTime();
    const valueElements = countdownEl.querySelectorAll('.countdown__value');
    function update() {
        const now = new Date().getTime();
        const distance = targetDate - now;
        if (distance < 0) return;
        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        if (valueElements.length >= 3) {
            valueElements[0].textContent = String(days).padStart(2, '0');
            valueElements[1].textContent = String(hours).padStart(2, '0');
            valueElements[2].textContent = String(minutes).padStart(2, '0');
        }
    }
    update();
    setInterval(update, 60000);
}
document.addEventListener('DOMContentLoaded', initCountdown);

/* ----------------------------------------------------------
   Accordion FAQ — pagine Piacenza Svelata
---------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', function () {
    const faqContainer = document.querySelector('.faq__container');
    if (!faqContainer) return;
    faqContainer.addEventListener('click', function (e) {
        const summary = e.target.closest('summary');
        if (!summary) return;
        const item = summary.closest('.faq__item');
        if (item) {
            e.preventDefault();
            item.open = !item.open;
        }
    });
});

/* ----------------------------------------------------------
   Edition tabs — ps-edizioni.html
---------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', function () {
    const tabs = document.querySelectorAll('.edition-tab');
    if (!tabs.length) return;
    const contents = document.querySelectorAll('.edition-content');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.target;
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            const targetContent = document.getElementById(target);
            if (targetContent) targetContent.classList.add('active');
        });
    });
});

/**
 * main.js
 * Piacenza Svelata - Sottodominio
 * Vanilla JS
 */

/* --------------------------------------------------------------------------
   3. MODULO ACCORDION FAQ
   -------------------------------------------------------------------------- */
class Accordion {
    constructor(containerSelector, itemSelector = 'details') {
        this.container = document.querySelector(containerSelector);
        this.itemSelector = itemSelector;
    }

    init() {
        try {
            if (!this.container) return;
            this.addEventListeners();
            console.log('[Accordion] Inizializzato');
        } catch (error) {
            console.error('[Accordion] Errore di inizializzazione:', error);
        }
    }

    toggleItem(item) {
        item.open = !item.open;
    }

    addEventListeners() {
        this.container.addEventListener('click', (e) => {
            const summary = e.target.closest('summary');
            if (!summary) return;
            
            const item = summary.closest(this.itemSelector);
            if (item) {
                e.preventDefault(); 
                this.toggleItem(item);
            }
        });
    }
}

/* --------------------------------------------------------------------------
   4. MODULO LAZY LOADING IMMAGINI
   -------------------------------------------------------------------------- */
function initLazyLoading() {
    try {
        const images = document.querySelectorAll('img[data-src]');
        if (images.length === 0) return;

        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver((entries, obs) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        img.src = img.dataset.src;
                        img.removeAttribute('data-src');
                        img.classList.add('loaded');
                        obs.unobserve(img);
                    }
                });
            }, {
                rootMargin: '50px'
            });

            images.forEach(img => observer.observe(img));
        } else {
            images.forEach(img => {
                img.src = img.dataset.src;
                img.removeAttribute('data-src');
            });
        }
        console.log('[LazyLoading] Inizializzato');
    } catch (error) {
        console.error('[LazyLoading] Errore di inizializzazione:', error);
    }
}

/* --------------------------------------------------------------------------
   5b. MODULO SWITCHER EDIZIONI
   -------------------------------------------------------------------------- */
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
    console.log('[EditionTabs] Inizializzato');
}

/* --------------------------------------------------------------------------
   6. UTILITY: INIT GLOBALE
   -------------------------------------------------------------------------- */
function initPiacenzaSvelataApp() {
    console.log('Piacenza Svelata App Initialized');
    
    try {
        initCountdown();

        if (document.querySelector('.slideshow__container')) {
            const slideshow = new Slideshow(
                '.slideshow__container',
                '.slideshow__slide',
                '.slideshow__nav--prev',
                '.slideshow__nav--next'
            );
            slideshow.init();
        }

        if (document.querySelector('.modal')) {
            const modal = new Modal(
                '#galleryModal',
                '.slideshow__image',
                '.modal__close',
                '.modal__nav--prev',
                '.modal__nav--next'
            );
            modal.init();
        }

        if (document.querySelector('.faq__container')) {
            const accordion = new Accordion('.faq__container', '.faq__item');
            accordion.init();
        }

        initVideoWithCookiebot();
        initEditionTabs();

    } catch (error) {
        console.error('Critical App Initialization Error:', error);
    }
}

document.addEventListener('DOMContentLoaded', initPiacenzaSvelataApp);