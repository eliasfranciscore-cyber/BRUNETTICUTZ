/* Interruptores de desarrollo del panel (rama sync/pimpstudio). Cada uno
   prende una parte de la UI que espera un cambio de backend, para poder
   construirla antes sin mostrar botones que llaman a rutas que aún no
   existen. Arrancan apagados, se prenden junto con su backend y antes del
   push final quedan todos en true. No son ajustes del negocio (esos van en
   la tabla `settings`). */
export const FEATURES = {
  reschedule: false,       // reagendar desde el detalle (PATCH fecha/hora, correo y Notion)
  priceEdit: false,        // editar el precio de una reserva (admin)
  noShow: false,           // "No vino" = cancelada + no_show
  charge: false,           // hoja de cobro con medio de pago
  unclosed: false,         // "Sin cerrar" (?mode=unclosed); solo completadas cuentan como ingreso
  autoComplete: false,     // textos de "pago por confirmar" del autocompletar
  cash: false,             // pestaña Caja (?mode=cash)
  sales: false,            // venta de productos en mesón (?mode=sale)
  inventory: false,        // inventario de Essentials (SKU, costo, movimientos de stock)
  manualIncome: false,     // ingresos manuales en Gastos (expenses.kind)
  profession: false,       // profesión del cliente
  serverSettings: false,   // ajustes guardados en el servidor (barbers.js ?mode=me|settings|shop-settings)
  testPush: false,         // push de prueba real desde el servidor (push.js action:'test')
  serviceLoyalty: false,   // "Suma estrella" por servicio
  featuredServices: false, // servicios destacados ("Los más pedidos")
  singleDay: false,        // servicios de un solo día
  reviews: false,          // reseñas (/resena y tarjeta en Resumen)
  passwordReset: false,    // restablecer contraseña por correo y bloqueo del servidor
}
