document.addEventListener('DOMContentLoaded', function () {
    const menuToggle = document.getElementById('menu-toggle');
    const navLinks = document.querySelector('.nav-links');

    menuToggle.addEventListener('click', function () {
        navLinks.classList.toggle('active');
        // Cambia l'icona da hamburger a "X" e viceversa
        const icon = menuToggle.querySelector('i');
        if (icon.classList.contains('fa-bars')) {
            icon.classList.remove('fa-bars');
            icon.classList.add('fa-times');
        } else {
            icon.classList.remove('fa-times');
            icon.classList.add('fa-bars');
        }
    });
});

/* ==========================================================================
   GESTIONE VIDEO YOUTUBE A DUE CLICK
   ========================================================================== */
document.querySelectorAll('.video-due-click-container').forEach(container => {
    container.addEventListener('click', function() {
        const videoId = this.dataset.videoId;
        const iframe = document.createElement('iframe');
        
        iframe.setAttribute('src', `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`);
        iframe.setAttribute('frameborder', '0');
        iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
        iframe.setAttribute('allowfullscreen', '');

        // Sostituisce il contenuto del contenitore (immagine e play button) con l'iframe
        this.innerHTML = '';
        this.appendChild(iframe);
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