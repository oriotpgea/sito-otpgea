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