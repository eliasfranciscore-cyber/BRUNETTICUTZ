/* Essentials → «Vender»: venta de productos en el mesón (ESQUELETO).

   TODO(T7 · Essentials + Vender + Inventario, ola C): portar EssentialsSell de
   PimpStudio (35e44d6 src/pages/panel/EssentialsSell.jsx) SIN comisión (nada
   de unitCommission / "Ganas $X": acá hay un solo barbero). Se ve solo con
   FEATURES.sales.

   Lo que ya deja listo Dashboard.jsx en `ctx`:
     sellable        [{ id, name, price, stock, photo }] — GET
                     /api/services?scope=shop&for=venta (activos, con stock)
     loadSellable()  recargarlo
     registerSale({ bookingId?, clientId?, products:[{productId, qty}],
                    paymentMethod, paymentRef?, applyLoyaltyDiscount? })
                     → { ok, sale } | { ok:false, error } | { ok, skipped }
                     (POST /api/bookings?mode=sale; el precio y el 30% los
                     decide el servidor)
     pushToast, clients, loyaltyForBooking
   Props: ctx, embedded (true cuando va dentro del Segmented de Essentials).
   Mientras tanto no dibuja nada. */
export default function EssentialsSell({ ctx, embedded = false }) {
  return null
}
