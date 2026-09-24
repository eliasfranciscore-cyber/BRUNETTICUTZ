/* Interruptores de la UI nueva del panel. Nacieron en la rama
   sync/pimpstudio para construir cada parte antes que su backend; con el
   backend ya en su lugar quedan todos prendidos. Sirven para apagar una parte
   de la UI con un deploy si algo falla, sin tocar el resto. No son ajustes
   del negocio (esos van en la tabla `settings`; p. ej. el autocompletar se
   prende en Ajustes, no acá). */
export const FEATURES = {
  reschedule: true,       // reagendar desde el detalle (PATCH fecha/hora, correo y Notion)
  priceEdit: true,        // editar el precio de una reserva (admin)
  noShow: true,           // "No vino" = cancelada + no_show
  charge: true,           // hoja de cobro con medio de pago
  unclosed: true,         // "Sin cerrar" (?mode=unclosed); solo completadas cuentan como ingreso
  autoComplete: true,     // textos de "pago por confirmar" del autocompletar
  cash: true,             // pestaña Caja (?mode=cash)
  sales: true,            // venta de productos en mesón (?mode=sale)
  inventory: true,        // inventario de Essentials (SKU, costo, movimientos de stock)
  manualIncome: true,     // ingresos manuales en Gastos (expenses.kind)
  profession: true,       // profesión del cliente
  serverSettings: true,   // ajustes guardados en el servidor (barbers.js ?mode=me|settings|shop-settings)
  testPush: true,         // push de prueba real desde el servidor (push.js action:'test')
  serviceLoyalty: true,   // "Suma estrella" por servicio
  featuredServices: true, // servicios destacados ("Los más pedidos")
  singleDay: true,        // servicios de un solo día
  reviews: true,          // reseñas (/resena y tarjeta en Resumen)
  passwordReset: true,    // restablecer contraseña por correo y bloqueo del servidor
}
