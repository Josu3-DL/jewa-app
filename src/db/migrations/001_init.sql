-- Esquema inicial v1 (ver docs/03-modelo-datos.md)
-- Fechas: ISO 8601 UTC en TEXT. Dinero: enteros en centavos. Booleanos: 0/1.

-- ───────── Sistema
CREATE TABLE config (
    clave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
);

CREATE TABLE usuarios (
    id INTEGER PRIMARY KEY,
    nombre TEXT NOT NULL,
    usuario TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    rol TEXT NOT NULL CHECK (rol IN ('admin','veterinario','recepcion')),
    colegiado TEXT,
    atiende_citas INTEGER NOT NULL DEFAULT 0 CHECK (atiende_citas IN (0,1)),
    activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
    intentos_fallidos INTEGER NOT NULL DEFAULT 0,
    bloqueado_hasta TEXT,
    creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE sesiones (
    sid TEXT PRIMARY KEY,
    datos TEXT NOT NULL,
    expira_en TEXT NOT NULL
);
CREATE INDEX idx_sesiones_expira ON sesiones(expira_en);

CREATE TABLE bitacora (
    id INTEGER PRIMARY KEY,
    usuario_id INTEGER REFERENCES usuarios(id),
    accion TEXT NOT NULL,
    entidad TEXT NOT NULL,
    entidad_id INTEGER,
    detalle TEXT,
    ip TEXT,
    fecha TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_bitacora_fecha ON bitacora(fecha);
CREATE INDEX idx_bitacora_entidad ON bitacora(entidad, entidad_id);

-- ───────── Clientes y mascotas
CREATE TABLE propietarios (
    id INTEGER PRIMARY KEY,
    nombre TEXT NOT NULL,
    cedula TEXT UNIQUE,
    telefono TEXT NOT NULL,
    correo TEXT,
    direccion TEXT,
    acepta_notificaciones INTEGER NOT NULL DEFAULT 1 CHECK (acepta_notificaciones IN (0,1)),
    activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
    creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_propietarios_nombre ON propietarios(nombre COLLATE NOCASE);
CREATE INDEX idx_propietarios_telefono ON propietarios(telefono);

CREATE TABLE mascotas (
    id INTEGER PRIMARY KEY,
    numero_expediente TEXT NOT NULL UNIQUE,
    propietario_id INTEGER NOT NULL REFERENCES propietarios(id),
    nombre TEXT NOT NULL,
    especie TEXT NOT NULL,
    raza TEXT,
    sexo TEXT NOT NULL DEFAULT 'desconocido' CHECK (sexo IN ('macho','hembra','desconocido')),
    fecha_nacimiento TEXT,
    color TEXT,
    esterilizado INTEGER NOT NULL DEFAULT 0 CHECK (esterilizado IN (0,1)),
    foto TEXT,
    estado TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','fallecida','inactiva')),
    creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_mascotas_nombre ON mascotas(nombre COLLATE NOCASE);
CREATE INDEX idx_mascotas_propietario ON mascotas(propietario_id);

CREATE TABLE mascota_propietarios_hist (
    id INTEGER PRIMARY KEY,
    mascota_id INTEGER NOT NULL REFERENCES mascotas(id),
    propietario_id INTEGER NOT NULL REFERENCES propietarios(id),
    desde TEXT NOT NULL,
    hasta TEXT
);
CREATE INDEX idx_hist_mascota ON mascota_propietarios_hist(mascota_id);

-- ───────── Servicios y citas
CREATE TABLE servicios (
    id INTEGER PRIMARY KEY,
    nombre TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('consulta','vacuna','grooming','seguimiento','otro')),
    precio INTEGER NOT NULL DEFAULT 0 CHECK (precio >= 0),
    duracion_min INTEGER NOT NULL DEFAULT 30 CHECK (duracion_min > 0),
    activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1))
);

-- veterinario_id es el responsable de la cita (usuario con atiende_citas = 1), D-21
CREATE TABLE citas (
    id INTEGER PRIMARY KEY,
    mascota_id INTEGER NOT NULL REFERENCES mascotas(id),
    veterinario_id INTEGER NOT NULL REFERENCES usuarios(id),
    servicio_id INTEGER REFERENCES servicios(id),
    inicio TEXT NOT NULL,
    fin TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'programada'
        CHECK (estado IN ('programada','confirmada','en_espera','atendida','no_asistio','cancelada')),
    motivo TEXT,
    notas TEXT,
    creado_por INTEGER REFERENCES usuarios(id),
    creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    CHECK (fin > inicio)
);
CREATE INDEX idx_citas_responsable ON citas(veterinario_id, inicio);
CREATE INDEX idx_citas_mascota ON citas(mascota_id);
CREATE INDEX idx_citas_inicio ON citas(inicio);

-- ───────── Inventario
CREATE TABLE productos (
    id INTEGER PRIMARY KEY,
    codigo TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    categoria TEXT NOT NULL,
    es_medicamento INTEGER NOT NULL DEFAULT 0 CHECK (es_medicamento IN (0,1)),
    principio_activo TEXT,
    presentacion TEXT,
    especie_recomendada TEXT,
    unidad TEXT NOT NULL DEFAULT 'unidad',
    precio INTEGER NOT NULL DEFAULT 0 CHECK (precio >= 0),
    stock_minimo INTEGER NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
    imagen TEXT,
    activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1))
);
CREATE INDEX idx_productos_nombre ON productos(nombre COLLATE NOCASE);

CREATE TABLE lotes (
    id INTEGER PRIMARY KEY,
    producto_id INTEGER NOT NULL REFERENCES productos(id),
    codigo_lote TEXT NOT NULL,
    vence TEXT,
    cantidad_actual INTEGER NOT NULL DEFAULT 0 CHECK (cantidad_actual >= 0),
    UNIQUE (producto_id, codigo_lote)
);
CREATE INDEX idx_lotes_producto ON lotes(producto_id, vence);

CREATE TABLE movimientos (
    id INTEGER PRIMARY KEY,
    producto_id INTEGER NOT NULL REFERENCES productos(id),
    lote_id INTEGER NOT NULL REFERENCES lotes(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('entrada','salida','ajuste','reversa')),
    cantidad INTEGER NOT NULL CHECK (cantidad > 0),
    motivo TEXT NOT NULL,
    ref_tipo TEXT CHECK (ref_tipo IN ('consulta','vacuna','venta','compra','ajuste')),
    ref_id INTEGER,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    fecha TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_mov_producto ON movimientos(producto_id, fecha);
CREATE INDEX idx_mov_ref ON movimientos(ref_tipo, ref_id);

CREATE TABLE proveedores (
    id INTEGER PRIMARY KEY,
    nombre TEXT NOT NULL,
    ruc TEXT,
    contacto TEXT,
    telefono TEXT,
    correo TEXT,
    activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1))
);

CREATE TABLE compras (
    id INTEGER PRIMARY KEY,
    proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
    fecha TEXT NOT NULL,
    nota TEXT,
    total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id)
);

CREATE TABLE compra_detalle (
    id INTEGER PRIMARY KEY,
    compra_id INTEGER NOT NULL REFERENCES compras(id),
    producto_id INTEGER NOT NULL REFERENCES productos(id),
    lote_id INTEGER NOT NULL REFERENCES lotes(id),
    cantidad INTEGER NOT NULL CHECK (cantidad > 0),
    costo_unitario INTEGER NOT NULL CHECK (costo_unitario >= 0)
);

-- ───────── Clínico
CREATE TABLE consultas (
    id INTEGER PRIMARY KEY,
    mascota_id INTEGER NOT NULL REFERENCES mascotas(id),
    cita_id INTEGER REFERENCES citas(id),
    veterinario_id INTEGER NOT NULL REFERENCES usuarios(id),
    fecha TEXT NOT NULL,
    motivo TEXT NOT NULL,
    anamnesis TEXT,
    examen_fisico TEXT,
    diagnostico TEXT NOT NULL,
    observaciones TEXT,
    peso_kg REAL CHECK (peso_kg IS NULL OR peso_kg > 0),
    temperatura_c REAL,
    frecuencia_cardiaca INTEGER,
    frecuencia_respiratoria INTEGER,
    estado TEXT NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente','anulada')),
    anulada_motivo TEXT,
    anulada_por INTEGER REFERENCES usuarios(id),
    anulada_en TEXT,
    CHECK (estado = 'vigente' OR (anulada_motivo IS NOT NULL AND length(trim(anulada_motivo)) > 0))
);
CREATE INDEX idx_consultas_mascota ON consultas(mascota_id, fecha);

CREATE TABLE tratamientos (
    id INTEGER PRIMARY KEY,
    consulta_id INTEGER NOT NULL REFERENCES consultas(id),
    producto_id INTEGER REFERENCES productos(id),
    medicamento_texto TEXT,
    dosis TEXT NOT NULL,
    frecuencia TEXT NOT NULL,
    duracion_dias INTEGER,
    indicaciones TEXT,
    CHECK (producto_id IS NOT NULL OR medicamento_texto IS NOT NULL)
);
CREATE INDEX idx_tratamientos_consulta ON tratamientos(consulta_id);

CREATE TABLE vacunas_aplicadas (
    id INTEGER PRIMARY KEY,
    mascota_id INTEGER NOT NULL REFERENCES mascotas(id),
    consulta_id INTEGER REFERENCES consultas(id),
    producto_id INTEGER NOT NULL REFERENCES productos(id),
    lote_id INTEGER NOT NULL REFERENCES lotes(id),
    fecha TEXT NOT NULL,
    proxima_dosis TEXT NOT NULL,
    veterinario_id INTEGER NOT NULL REFERENCES usuarios(id),
    estado TEXT NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente','anulada')),
    anulada_motivo TEXT
);
CREATE INDEX idx_vacunas_mascota ON vacunas_aplicadas(mascota_id, fecha);
CREATE INDEX idx_vacunas_proxima ON vacunas_aplicadas(proxima_dosis);

CREATE TABLE consumos (
    id INTEGER PRIMARY KEY,
    consulta_id INTEGER NOT NULL REFERENCES consultas(id),
    producto_id INTEGER NOT NULL REFERENCES productos(id),
    lote_id INTEGER NOT NULL REFERENCES lotes(id),
    cantidad INTEGER NOT NULL CHECK (cantidad > 0),
    movimiento_id INTEGER NOT NULL REFERENCES movimientos(id)
);
CREATE INDEX idx_consumos_consulta ON consumos(consulta_id);

CREATE TABLE adjuntos (
    id INTEGER PRIMARY KEY,
    mascota_id INTEGER NOT NULL REFERENCES mascotas(id),
    consulta_id INTEGER REFERENCES consultas(id),
    nombre_original TEXT NOT NULL,
    archivo TEXT NOT NULL,
    tipo_mime TEXT NOT NULL,
    tamano INTEGER NOT NULL,
    subido_por INTEGER NOT NULL REFERENCES usuarios(id),
    subido_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_adjuntos_mascota ON adjuntos(mascota_id);

-- ───────── Ventas
CREATE TABLE ventas (
    id INTEGER PRIMARY KEY,
    numero TEXT NOT NULL UNIQUE,
    propietario_id INTEGER REFERENCES propietarios(id),
    fecha TEXT NOT NULL,
    subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
    descuento INTEGER NOT NULL DEFAULT 0 CHECK (descuento >= 0),
    impuesto INTEGER NOT NULL DEFAULT 0 CHECK (impuesto >= 0),
    total INTEGER NOT NULL CHECK (total >= 0),
    metodo_pago TEXT NOT NULL CHECK (metodo_pago IN ('efectivo','tarjeta','transferencia')),
    estado TEXT NOT NULL DEFAULT 'pagada' CHECK (estado IN ('pagada','anulada')),
    anulada_motivo TEXT,
    anulada_por INTEGER REFERENCES usuarios(id),
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    CHECK (estado = 'pagada' OR (anulada_motivo IS NOT NULL AND length(trim(anulada_motivo)) > 0))
);
CREATE INDEX idx_ventas_fecha ON ventas(fecha);

CREATE TABLE venta_detalle (
    id INTEGER PRIMARY KEY,
    venta_id INTEGER NOT NULL REFERENCES ventas(id),
    item_tipo TEXT NOT NULL CHECK (item_tipo IN ('producto','servicio')),
    item_id INTEGER NOT NULL,
    descripcion TEXT NOT NULL,
    cantidad INTEGER NOT NULL CHECK (cantidad > 0),
    precio_unitario INTEGER NOT NULL CHECK (precio_unitario >= 0),
    lote_id INTEGER REFERENCES lotes(id)
);
CREATE INDEX idx_venta_detalle_venta ON venta_detalle(venta_id);

-- ───────── Notificaciones
CREATE TABLE plantillas (
    id INTEGER PRIMARY KEY,
    tipo TEXT NOT NULL UNIQUE CHECK (tipo IN ('cita','vacuna','tratamiento')),
    texto TEXT NOT NULL
);

CREATE TABLE notificaciones (
    id INTEGER PRIMARY KEY,
    tipo TEXT NOT NULL CHECK (tipo IN ('cita','vacuna','tratamiento')),
    propietario_id INTEGER NOT NULL REFERENCES propietarios(id),
    mascota_id INTEGER REFERENCES mascotas(id),
    ref_tipo TEXT NOT NULL,
    ref_id INTEGER NOT NULL,
    canal TEXT NOT NULL DEFAULT 'whatsapp' CHECK (canal IN ('whatsapp','correo')),
    mensaje TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','enviada_manual','omitida')),
    generada_para TEXT NOT NULL,
    enviada_en TEXT,
    enviada_por INTEGER REFERENCES usuarios(id),
    UNIQUE (tipo, ref_tipo, ref_id, generada_para)
);
CREATE INDEX idx_notif_estado ON notificaciones(estado, generada_para);

-- ───────── Integridad: sin borrado físico en datos auditables (D-14, RF-19, RN-03)
CREATE TRIGGER no_delete_bitacora BEFORE DELETE ON bitacora
BEGIN SELECT RAISE(ABORT, 'La bitácora no admite borrado'); END;
CREATE TRIGGER no_update_bitacora BEFORE UPDATE ON bitacora
BEGIN SELECT RAISE(ABORT, 'La bitácora no admite modificación'); END;

CREATE TRIGGER no_delete_consultas BEFORE DELETE ON consultas
BEGIN SELECT RAISE(ABORT, 'Las consultas no se eliminan; use anulación justificada'); END;
CREATE TRIGGER no_delete_tratamientos BEFORE DELETE ON tratamientos
BEGIN SELECT RAISE(ABORT, 'Los tratamientos no se eliminan'); END;
CREATE TRIGGER no_delete_vacunas BEFORE DELETE ON vacunas_aplicadas
BEGIN SELECT RAISE(ABORT, 'Las vacunas aplicadas no se eliminan; use anulación'); END;

CREATE TRIGGER no_delete_movimientos BEFORE DELETE ON movimientos
BEGIN SELECT RAISE(ABORT, 'Los movimientos de inventario no se eliminan'); END;
CREATE TRIGGER no_update_movimientos BEFORE UPDATE ON movimientos
BEGIN SELECT RAISE(ABORT, 'Los movimientos de inventario no se modifican'); END;

CREATE TRIGGER no_delete_ventas BEFORE DELETE ON ventas
BEGIN SELECT RAISE(ABORT, 'Las ventas no se eliminan; use anulación'); END;
CREATE TRIGGER no_delete_venta_detalle BEFORE DELETE ON venta_detalle
BEGIN SELECT RAISE(ABORT, 'El detalle de ventas no se elimina'); END;

-- Una consulta anulada no puede volver a vigente
CREATE TRIGGER consulta_anulada_definitiva BEFORE UPDATE OF estado ON consultas
WHEN OLD.estado = 'anulada' AND NEW.estado <> 'anulada'
BEGIN SELECT RAISE(ABORT, 'Una consulta anulada no puede reactivarse'); END;
