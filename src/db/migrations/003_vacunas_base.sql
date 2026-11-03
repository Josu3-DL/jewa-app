-- Vacunas de uso común como productos, cada una con un lote único interno (alcance académico, D-41:
-- sin vencimientos por lote ni FEFO). El registro de una vacuna aplicada guarda producto y lote,
-- pero NO mueve stock: el descuento ocurre solo en la venta (ISS-14).
-- Los precios quedan en 0 (no se inventan): el administrador los define cuando exista el módulo de farmacia.

INSERT INTO productos (codigo, nombre, categoria, es_medicamento, presentacion, unidad, precio, stock_minimo) VALUES
    ('VAC-001', 'Vacuna antirrábica', 'Vacuna', 0, 'Dosis única', 'dosis', 0, 0),
    ('VAC-002', 'Vacuna múltiple canina (DHPP)', 'Vacuna', 0, 'Dosis única', 'dosis', 0, 0),
    ('VAC-003', 'Vacuna triple felina', 'Vacuna', 0, 'Dosis única', 'dosis', 0, 0),
    ('VAC-004', 'Vacuna Bordetella (tos de las perreras)', 'Vacuna', 0, 'Dosis única', 'dosis', 0, 0);

INSERT INTO lotes (producto_id, codigo_lote, vence, cantidad_actual)
    SELECT id, 'UNICO', NULL, 0 FROM productos WHERE codigo LIKE 'VAC-%';
