// Menú lateral plegable en tablet y teléfono. Sin dependencias.
(function () {
    'use strict';
    var sidebar = document.getElementById('main-navigation');
    var toggle = document.querySelector('[data-sidebar-toggle]');
    var backdrop = document.querySelector('[data-sidebar-backdrop]');
    if (!sidebar || !toggle) return;

    var BREAKPOINT = 900;

    function setOpen(open) {
        sidebar.classList.toggle('is-open', open);
        toggle.setAttribute('aria-expanded', String(open));
        if (backdrop) backdrop.hidden = !open;
        if (!open && document.activeElement && sidebar.contains(document.activeElement)) toggle.focus();
    }

    toggle.addEventListener('click', function () {
        setOpen(!sidebar.classList.contains('is-open'));
    });

    if (backdrop) backdrop.addEventListener('click', function () { setOpen(false); });

    sidebar.addEventListener('click', function (event) {
        if (event.target.closest('a')) setOpen(false);
    });

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && sidebar.classList.contains('is-open')) setOpen(false);
    });

    window.addEventListener('resize', function () {
        if (window.innerWidth > BREAKPOINT && sidebar.classList.contains('is-open')) setOpen(false);
    });
})();
