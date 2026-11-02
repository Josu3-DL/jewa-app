-- Datos iniciales que toda instalación necesita (se aplica una sola vez).
-- Los ajustes de la clínica NO se siembran: sus valores por defecto viven en src/services/settings.js.

-- Un servicio no puede repetirse (sin distinguir mayúsculas)
CREATE UNIQUE INDEX idx_servicios_nombre ON servicios(nombre COLLATE NOCASE);

-- Servicios base. Los PRECIOS quedan en 0: el administrador los define en Ajustes → Servicios
-- (no se inventan precios; la pantalla avisa mientras sigan en cero).
INSERT INTO servicios (nombre, tipo, precio, duracion_min) VALUES
    ('Consulta general', 'consulta', 0, 30),
    ('Vacunación', 'vacuna', 0, 15),
    ('Seguimiento', 'seguimiento', 0, 20),
    ('Baño', 'grooming', 0, 45),
    ('Corte', 'grooming', 0, 60);

-- Plantillas de recordatorio por defecto (ISS-15 las edita y sustituye las variables).
-- Variables: {propietario} {mascota} {clinica} {fecha} {hora} {vacuna} {medicamento}
INSERT INTO plantillas (tipo, texto) VALUES
    ('cita', 'Hola {propietario}, le recordamos la cita de {mascota} en {clinica} el {fecha} a las {hora}. Si no puede asistir, avísenos por favor.'),
    ('vacuna', 'Hola {propietario}, la vacuna de {mascota} ({vacuna}) está programada para el {fecha}. Escríbanos para agendar su cita en {clinica}.'),
    ('tratamiento', 'Hola {propietario}, el tratamiento de {mascota} ({medicamento}) termina el {fecha}. Consúltenos si necesita continuarlo. {clinica}');
