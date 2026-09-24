import { CLP } from '../../data.js'
import { PAYMENT_LABELS } from '../../components/ChargeSheet.jsx'

/* "Sin cerrar": lo que quedó abierto en la caja (ESQUELETO).

   TODO(T12 · Caja + Sin cerrar, ola C): portar las tres piezas de PimpStudio
   (35e44d6 src/pages/panel/SinCerrar.jsx) sobre estas firmas, sin el punto de
   BrunettiCutz, sin `__bridge` y sin etiquetas de barbero (acá hay uno solo):
     · SinCerrarNotice — el aviso del Resumen (solo con FEATURES.unclosed)
     · SinCerrarCard   — la tarjeta de Caja con las primeras filas
     · SinCerrarSheet  — la hoja con la lista completa
   Datos: GET /api/bookings?mode=unclosed[&summary=1] →
   { ok, count, items, toConfirm, toConfirmCount } (ver api-contract.md).
     · Cobrar  → ctx.updateBookingStatus(bk, 'completada'): la hoja de cobro de
                 siempre, que es la que suma la estrella (y ya muestra el toast
                 de la estrella, no hace falta repetirlo).
     · No vino → ctx.updateBookingStatus(bk, 'cancelada', { noShow: true })
                 (cancelada + no_show; no es un estado nuevo porque la app de
                 iOS no lo sabría leer). Con FEATURES.noShow en false se manda
                 como cancelada común.
   Mientras tanto las tres no dibujan nada. */

export function SinCerrarNotice({ ctx }) {
  return null
}

export function SinCerrarCard({ ctx, preview = 3, onChanged }) {
  return null
}

export function SinCerrarSheet({ open, onClose, ctx, onChanged }) {
  return null
}

/* Confirmar el pago de una atención que se completó sola (autocompletar).
   Lo comparten la hoja, la tarjeta de Caja y las filas "Por confirmar" del
   arqueo del día. Firma final:
     confirmAutoPayment(ctx, booking) → { ok, charge } | { cancelled } | { error }
   Es la misma hoja de cobro en modo 'confirmar', con el monto precargado con
   el precio; el medio lo elige la persona. El PATCH es el de siempre y, como
   la reserva ya estaba completada, el servidor lo trata como corrección: no
   suma otra estrella ni reenvía el correo (ver api/_bookingLife.js).
   Con FEATURES.charge en false, ctx.askForCharge resuelve null y esto
   devuelve { cancelled: true } sin tocar nada. */
export async function confirmAutoPayment(ctx, booking) {
  if (!ctx?.askForCharge) return { error: 'No se pudo abrir la hoja de cobro.' }
  const payment = await ctx.askForCharge(
    { ...booking, paidAmount: null, paymentMethod: null, paymentRef: null },
    'confirmar',
    ctx.loyaltyForBooking?.(booking) || null,
  )
  if (!payment) return { cancelled: true }
  const { products, applyLoyaltyDiscount, ...charge } = payment
  const res = await fetch('/api/bookings', {
    method: 'PATCH',
    headers: ctx.authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id: booking.id, status: 'completada', ...charge }),
  }).catch(() => null)
  const data = res ? await res.json().catch(() => ({})) : {}
  if (!res || !res.ok) return { error: data.error || 'No se pudo confirmar el pago. Revisa la conexión e intenta de nuevo.' }
  // Si esa reserva está cargada en el panel (Reservas, Agenda, Finanzas), que
  // se vea cobrada con su medio.
  ctx.setBookings?.((list) => list.map((it) => (it.id === booking.id
    ? { ...it, status: 'completada', paidAmount: charge.paidAmount, paymentMethod: charge.paymentMethod, paymentRef: charge.paymentRef || null, paymentPending: false }
    : it)))
  // Productos: SIEMPRE después de guardar el servicio y en su propio request
  // (dos plata distintas, ver registerSale en Dashboard.jsx). Si la venta
  // falla, el pago del servicio ya quedó bien: se avisa y no se deshace.
  if (Array.isArray(products) && products.length && ctx.registerSale) {
    const sale = await ctx.registerSale({
      bookingId: booking.id, products, paymentMethod: charge.paymentMethod,
      paymentRef: charge.paymentRef, applyLoyaltyDiscount,
    })
    if (!sale?.ok) {
      ctx.pushToast?.('⚠️', `Pago confirmado. ${sale?.error || 'No se pudo registrar la venta de productos.'}`)
      return { ok: true, charge }
    }
  }
  ctx.pushToast?.('✓', `Pago confirmado · ${PAYMENT_LABELS[charge.paymentMethod] || charge.paymentMethod} ${CLP(charge.paidAmount)}`)
  return { ok: true, charge }
}
