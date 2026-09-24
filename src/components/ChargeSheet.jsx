/**
 * ChargeSheet — hoja de cobro al completar una reserva (ESQUELETO).
 *
 * TODO(T3 · Nueva reserva + Cobro, ola C): portar la hoja de PimpStudio
 * (35e44d6 src/components/ChargeSheet.jsx) sobre esta interfaz, que ya quedó
 * congelada en Dashboard.jsx. Mientras tanto no dibuja nada, y Dashboard nunca
 * la abre: askForCharge() resuelve null al instante con FEATURES.charge en
 * false, así que ninguna promesa queda colgada esperando esta hoja.
 *
 * Acá hay un solo barbero y no hay comisión: la plata del SERVICIO y la de
 * los PRODUCTOS se registran por separado (el servicio en la reserva, los
 * productos en su propia venta) para que la Caja del día y el stock cuadren.
 * La sección Productos solo aparece con FEATURES.sales y si hay stock; sin
 * productos, el texto es "Carga stock en Essentials para vender acá".
 *
 * Props (congeladas):
 *  open        boolean — Dashboard la deja montada y la abre/cierra con esto
 *  booking     la reserva (o la fila de Caja) que se cobra
 *  mode        'cobrar'    completar: servicio (+ productos)
 *              'corregir'  arreglar un cobro ya hecho (solo el servicio)
 *              'confirmar' una atención que se completó sola: el monto viene
 *                          precargado y falta decir cómo se pagó
 *              'productos' vender productos sobre una atención ya cerrada
 *  loyalty     { productDiscountReady, productDiscountPct } | null
 *  products    catálogo vendible [{ id, name, price, stock, photo }]
 *  onClose()   cancelar: Dashboard resuelve la promesa con null
 *  onSubmit({ paidAmount, paymentMethod, paymentRef, products, applyLoyaltyDiscount })
 *              paidAmount es null en modo 'productos'; products es
 *              [{ productId, qty }] y viaja en su propia venta (?mode=sale).
 */

/* Espejo de PAYMENT_METHODS / PAYMENT_LABELS / PAYMENT_REF_LABELS de
   api/_money.js (el servidor rechaza cualquier otro medio). El cuarto campo
   es la etiqueta del comprobante, o null si ese medio no deja ninguno.
   Van exportados desde ya porque Caja y "Sin cerrar" los importan de acá. */
export const METHODS = [
  ['efectivo', 'Efectivo', 'wallet', null],
  ['tarjeta', 'Tarjeta', 'wallet', 'N.º de boleta'],
  ['transferencia', 'Transferencia', 'check', 'N.º de operación'],
  ['mercadopago', 'Mercado Pago', 'spark', 'N.º de operación'],
  ['cortesia', 'Cortesía', 'gift', null],
]

export const PAYMENT_LABELS = Object.fromEntries(METHODS.map(([id, label]) => [id, label]))

export default function ChargeSheet({ open, booking, mode = 'cobrar', loyalty = null, products = [], onClose, onSubmit }) {
  return null
}
