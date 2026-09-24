/* Pestaña «Caja» — arqueo del día (ESQUELETO).

   TODO(T12 · Caja + Sin cerrar, ola C): portar la pestaña de PimpStudio
   (35e44d6 src/pages/panel/CajaTab.jsx) sin la columna Barbero ni la de
   "Cobró" (acá hay un solo barbero), con la línea "Online (web)" aparte de
   `mercadopago` (que es Mercado Pago en el mesón) y la tarjeta de solo
   lectura "Ventas online" con "Ver pedidos" (ctx.setTab('pedidos')).

   Lo que ya deja listo Dashboard.jsx en `ctx`:
     cashDay, setCashDay       el día que se mira (YYYY-MM-DD, Santiago)
     cashData                  undefined = cargando, null = error, o la
                               respuesta de GET /api/bookings?mode=cash&date=
                               (ver api-contract.md); se recarga sola al entrar
                               a la pestaña y al cambiar de día
     loadCash(day)             recargar a mano (después de anular, etc.)
     openCashRow(row)          cobrar / corregir una fila con la hoja de cobro
     voidSale(sale, { confirmed })  anular una venta de productos (FEATURES.sales)
     onlineOrders              pedidos web (Cursos, Workshop, Essentials) para
                               la línea online del día: santiagoDateKey(o.created_at)
     has('caja')               la pestaña solo existe con FEATURES.cash
   Mientras tanto no dibuja nada (y el menú no la muestra: FEATURES.cash está
   en false). */
export default function CajaTab({ ctx }) {
  const { has } = ctx || {}
  if (has && !has('caja')) return null
  return null
}
