// Gráfica de evolución del peso (Chart.js servido localmente, sin CDN).
// Los datos llegan en el atributo data-pesos del canvas (JSON): no hay scripts en línea.
(function () {
    'use strict';
    var canvas = document.getElementById('grafica-peso');
    if (!canvas || !window.Chart) return;
    var datos;
    try { datos = JSON.parse(canvas.getAttribute('data-pesos')); } catch (e) { return; }
    if (!Array.isArray(datos) || datos.length < 2) return;
    new window.Chart(canvas, {
        type: 'line',
        data: {
            labels: datos.map(function (d) { return d.fecha; }),
            datasets: [{
                label: 'Peso (kg)',
                data: datos.map(function (d) { return d.peso; }),
                borderColor: '#3e647e',
                backgroundColor: 'rgba(92, 130, 157, 0.15)',
                fill: true,
                tension: 0.25,
                pointRadius: 4,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { title: { display: true, text: 'kg' } } },
        },
    });
})();
