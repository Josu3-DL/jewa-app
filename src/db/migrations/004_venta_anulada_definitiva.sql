-- Una venta anulada no puede volver a "pagada": su stock ya se devolvió con movimientos de reversa y
-- reactivarla dejaría el inventario inconsistente (RN-03). Igual que ya ocurre con las consultas.
CREATE TRIGGER venta_anulada_definitiva BEFORE UPDATE OF estado ON ventas
WHEN OLD.estado = 'anulada' AND NEW.estado <> 'anulada'
BEGIN SELECT RAISE(ABORT, 'Una venta anulada no se puede reactivar'); END;
