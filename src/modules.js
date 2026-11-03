'use strict';
// Fuente única de los módulos del menú y sus permisos (matriz de docs/02-arquitectura.md).
// La autorización real de cada ruta se apoya en canAccess().

const ALL = ['admin', 'veterinario', 'recepcion'];

const MODULES = [
    { key: 'inicio', path: '/', label: 'Inicio', roles: ALL },
    { key: 'citas', path: '/citas', label: 'Citas', roles: ALL, issue: 'ISS-07', blurb: 'Agenda, estados de cita y grooming.' },
    { key: 'mascotas', path: '/mascotas', label: 'Mascotas', roles: ALL, issue: 'ISS-06', blurb: 'Fichas de pacientes y transferencias.' },
    { key: 'clientes', path: '/clientes', label: 'Clientes', roles: ALL, issue: 'ISS-06', blurb: 'Propietarios, contactos y consentimiento.' },
    { key: 'historial', path: '/historial', label: 'Historial clínico', roles: ['admin', 'veterinario'], issue: 'ISS-08', blurb: 'Consultas, signos vitales, vacunas y tratamientos.' },
    { key: 'farmacia', path: '/farmacia', label: 'Farmacia', roles: ALL, issue: 'ISS-11', blurb: 'Productos, stock y alertas de bajo stock.' },
    { key: 'ventas', path: '/ventas', label: 'Ventas', roles: ALL, issue: 'ISS-14', blurb: 'Ventas y cobros con recibo.' },
    { key: 'recordatorios', path: '/recordatorios', label: 'Recordatorios', roles: ALL, issue: 'ISS-15', blurb: 'Avisos de citas y vacunas por WhatsApp.' },
    { key: 'reportes', path: '/reportes', label: 'Reportes', roles: ['admin', 'veterinario'], issue: 'ISS-16', blurb: 'Reportes y exportación a CSV.' },
    { key: 'ajustes', path: '/ajustes', label: 'Ajustes', roles: ['admin'], issue: 'ISS-04 / ISS-05', blurb: 'Usuarios, ajustes de la clínica y bitácora.', footer: true },
];

// Accesos directos de la página de inicio (diseño: theme1.html)
const HOME_CARDS = [
    { module: 'citas', href: '/citas', icon: '◷', title: 'Gestionar citas', text: 'Organiza la agenda del día', style: 'card-blue' },
    { module: 'mascotas', href: '/mascotas', icon: '✦', title: 'Pacientes', text: 'Consulta fichas y mascotas', style: 'card-white' },
    { module: 'clientes', href: '/clientes', icon: '◎', title: 'Clientes', text: 'Administra tutores y contactos', style: 'card-white' },
    { module: 'citas', href: '/citas?tipo=grooming', icon: '✧', title: 'Grooming', text: 'Reserva cuidados y estética', style: 'card-silver' },
    { module: 'farmacia', href: '/farmacia', icon: '+', title: 'Área de farmacia', text: 'Productos y medicamentos', style: 'card-white' },
];

const find = (key) => MODULES.find((m) => m.key === key);

function canAccess(role, key) {
    const mod = find(key);
    return Boolean(mod && role && mod.roles.includes(role));
}

const pad = (n) => String(n).padStart(2, '0');

/** Menú visible para un rol, con numeración consecutiva sin repetidos. */
function navFor(role) {
    const visible = MODULES.filter((m) => canAccess(role, m.key));
    const numbered = visible.map((m, i) => ({ ...m, number: pad(i + 1) }));
    return { main: numbered.filter((m) => !m.footer), footer: numbered.filter((m) => m.footer) };
}

function homeCardsFor(role) {
    return HOME_CARDS.filter((c) => canAccess(role, c.module)).map((c, i) => ({ ...c, number: pad(i + 1) }));
}

module.exports = { MODULES, HOME_CARDS, canAccess, navFor, homeCardsFor, find };
