/* Datos del mock de API de desarrollo (VITE_DEV_MOCKS=1). Ver index.mjs.

   Todo vive en memoria y se arma RELATIVO A HOY (hora de Santiago): cada vez
   que arranca el servidor, "ayer", "hoy" y "la semana que viene" son de
   verdad, así la agenda, "Sin cerrar" y la Caja del día siempre tienen algo
   que mostrar. Nada de esto toca una base de datos ni sale del proceso.

   Un solo barbero (Bruno, id 6), como el negocio real. Los estados cubren
   todo lo que el panel tiene que saber dibujar: pendiente, confirmada, en
   curso, completada con y sin cobro, "pago por confirmar" (autocompletada),
   No vino, corte gratis canjeado y las que quedaron sin cerrar. */

export const TZ = 'America/Santiago'
export const BRUNO_ID = 6
export const LOYALTY_GOAL = 10
export const DISCOUNT_STARS = 5
export const DISCOUNT_PCT = 30
export const PAYMENT_METHODS = ['efectivo', 'tarjeta', 'transferencia', 'mercadopago', 'cortesia']
export const STATUSES = ['pendiente', 'confirmada', 'en curso', 'completada', 'cancelada']

// ── Fechas (Santiago) ─────────────────────────────────────────────────────
export function dateKey(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
export function nowMinutes(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d)
  const get = (t) => Number(parts.find((p) => p.type === t)?.value || 0)
  return get('hour') * 60 + get('minute')
}
export function addDays(key, n) {
  const [y, m, d] = String(key).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
// ISO sin milisegundos (el formato que exige la app de iOS).
export const iso = (d = new Date()) => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z')
// Aproximación suficiente para el mock: Santiago en -03:00 (horario de verano).
export const isoAt = (key, time = '12:00') => iso(new Date(`${key}T${time}:00-03:00`))
export const minutesAgo = (n) => iso(Date.now() - n * 60_000)

// Mismos bloques de 1 h que vende el negocio (api/_slots.js).
export const ALL_SLOTS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00']
export const slotMinutes = (slot) => { const [h, m] = String(slot).split(':').map(Number); return h * 60 + (m || 0) }
export const blocksFor = (min) => Math.max(1, Math.ceil(Number(min || 60) / 60))

export function createState(now = new Date()) {
  const today = dateKey(now)
  const D = (n) => addDays(today, n)

  const barbers = [{
    id: BRUNO_ID, name: 'Brunetti', short: 'Brunetti', code: 'bruno-herrera',
    role: 'Visagista · Director de imagen', tier: 'premium', admin: true, active: true,
    email: 'bruno@brunetticutz.cl', canViewFinance: true, canManageTeam: true, canEditServices: true, canManageBlocks: true,
  }]

  const services = [
    { id: 5, name: 'Asesoría de corte', price: 24990, min: 90, cat: 'general', tne: true, active: false, desc: 'Corte más una conversación de estilo: forma de rostro, qué te acomoda y cómo mantenerlo.' },
    { id: 6, name: 'Corte de cabello', price: 15990, min: 60, cat: 'general', tne: true, active: false, desc: 'Corte completo de principio a fin: largo, forma y terminación.' },
    { id: 8, name: 'Perfilado de barba', price: 11990, min: 45, cat: 'general', tne: true, active: false, desc: 'Solo barba: perfilado, contornos y arreglo.' },
    { id: 9, name: 'Solo fade', price: 11990, min: 40, cat: 'general', tne: true, active: true, desc: 'Solo mantención de un fade ya hecho. No es un corte completo.' },
    { id: 10, name: 'Asesoría de Imagen · Visagista', price: 49990, min: 120, cat: 'premium', tne: false, active: true, desc: 'Análisis de tu fisonomía para definir el estilo que te favorece.' },
    { id: 11, name: 'Corte de cabello', price: 19990, min: 60, cat: 'premium', tne: false, active: true, desc: 'Corte completo de principio a fin: largo, forma y terminación.' },
    { id: 12, name: 'Corte de cabello y barba', price: 29990, min: 90, cat: 'premium', tne: false, active: true, desc: 'Corte completo y barba perfilada, con terminación de detalle.' },
    { id: 13, name: 'Ondulación permanente', price: 66990, min: 180, cat: 'quimico', tne: false, active: true, desc: 'Ondulación química: da forma y textura al pelo liso.' },
    { id: 14, name: 'Platinado Global', price: 89990, min: 240, cat: 'quimico', tne: false, active: true, desc: 'Decoloración de todo el pelo hasta rubio platino.' },
    { id: 15, name: 'Visos Platinados', price: 74990, min: 210, cat: 'quimico', tne: false, active: true, desc: 'Mechas platinadas sobre tu color, sin decolorar todo el pelo.' },
    // Servicio de un solo día: solo se agenda esa fecha y no sale en la lista
    // pública normal (?includeSingleDay=1 para verlo).
    { id: 16, name: 'Corte solidario · Día único', price: 10000, min: 60, cat: 'general', tne: false, active: true, desc: 'Jornada especial: todo lo recaudado va a la fundación del barrio.', onlyOnDate: D(5) },
  ].map((s) => ({
    loyaltyEligible: s.id !== 16,
    featured: s.id === 11 || s.id === 12,
    onlyOnDate: null,
    ...s,
  }))

  // Clientes (users). `stars` y `walletHasPass` simulan lo que en producción
  // llega por el puente de fidelidad de PimpStudio.
  const clients = [
    { id: 101, name: 'Matías Fuentes', phone: '987654321', email: 'matias.fuentes@gmail.com', profession: 'Abogado', stars: 9, walletHasPass: true, createdAt: D(-210) },
    { id: 102, name: 'Diego Salinas', phone: '934567890', email: 'diego.salinas@outlook.com', profession: 'Diseñador', stars: 4, walletHasPass: true, createdAt: D(-160) },
    { id: 103, name: 'Joaquín Reyes', phone: '912300000', email: '', profession: null, stars: 1, walletHasPass: false, createdAt: D(-40) },
    { id: 104, name: 'Benjamín Rojas', phone: '956781234', email: 'benja.rojas@gmail.com', profession: 'Ingeniero civil', stars: 10, walletHasPass: true, createdAt: D(-300) },
    { id: 105, name: 'Vicente Muñoz', phone: '945612378', email: 'vicente.m@gmail.com', profession: 'Estudiante', stars: 2, walletHasPass: false, createdAt: D(-25) },
    { id: 106, name: 'Tomás Contreras', phone: '978123456', email: 'tcontreras@empresa.cl', profession: 'Gerente comercial', stars: 6, walletHasPass: true, createdAt: D(-120) },
    { id: 107, name: 'Sebastián Díaz', phone: '923456781', email: '', profession: 'Músico', stars: 0, walletHasPass: false, createdAt: D(-6) },
    { id: 108, name: 'Cristóbal Pérez', phone: '961234578', email: 'cristobal.perez@gmail.com', profession: null, stars: 3, walletHasPass: true, createdAt: D(-75) },
    { id: 109, name: 'Agustín Soto', phone: '989012345', email: 'agustin.soto@icloud.com', profession: 'Fotógrafo', stars: 5, walletHasPass: false, createdAt: D(-95) },
    { id: 110, name: 'Felipe Morales', phone: '932165498', email: 'fmorales@gmail.com', profession: 'Médico', stars: 7, walletHasPass: true, createdAt: D(-180) },
    { id: 111, name: 'Ignacio Vargas', phone: '954321876', email: '', profession: null, stars: 0, walletHasPass: false, createdAt: D(-2) },
    { id: 112, name: 'Martín Castillo', phone: '976543210', email: 'martin.castillo@gmail.com', profession: 'Arquitecto', stars: 8, walletHasPass: true, createdAt: D(-260) },
    { id: 113, name: 'Lucas Herrera', phone: '918273645', email: 'lucas.herrera@gmail.com', profession: 'Chef', stars: 1, walletHasPass: false, createdAt: D(-55) },
    { id: 114, name: 'Gabriel Navarro', phone: '963528417', email: '', profession: null, stars: 0, walletHasPass: false, createdAt: D(-400) },
  ]

  /* Reservas. `price` va solo cuando es personalizado (custom_price); el
     resto sale del servicio. Horarios sin choques (un servicio de 90 min
     ocupa dos bloques). */
  let seq = 5000
  const bk = (daysFromToday, time, clientId, serviceId, status, extra = {}) => {
    const date = D(daysFromToday)
    const created = extra.createdAt || isoAt(D(Math.min(daysFromToday, 0) - 3), '10:15')
    return {
      id: ++seq, date, time, barberId: BRUNO_ID, clientId, serviceId,
      customService: null, customPrice: null, priceSnapshot: null,
      status, paidAmount: null, paymentMethod: null, paymentRef: null, paidAt: null,
      completedAt: null, startedAt: null, autoCompleted: false, noShow: false, freeCut: false,
      redeemState: null, reminder60Sent: false, createdAt: created, updatedAt: created,
      ...extra,
    }
  }
  const paid = (date, time, method, amount, ref = null) => ({
    paidAmount: amount, paymentMethod: method, paymentRef: ref,
    paidAt: isoAt(date, time), completedAt: isoAt(date, time), startedAt: isoAt(date, time),
  })

  const bookings = [
    // Semanas pasadas: completadas cobradas con cada medio.
    bk(-20, '10:00', 104, 12, 'completada', paid(D(-20), '11:30', 'efectivo', 29990)),
    bk(-18, '12:00', 110, 11, 'completada', paid(D(-18), '13:00', 'tarjeta', 19990, '004512')),
    bk(-15, '16:00', 112, 10, 'completada', paid(D(-15), '18:00', 'transferencia', 49990, '88123001')),
    bk(-13, '11:00', 106, 9, 'completada', paid(D(-13), '11:45', 'mercadopago', 11990, '1320044512')),
    // Completada de antes del cobro con medio de pago: sin paidAmount ni
    // completedAt (el panel la cuenta por su precio).
    bk(-11, '15:00', 101, 11, 'completada'),
    // Corte gratis canjeado: $0, cortesía.
    bk(-9, '10:00', 104, 11, 'completada', { ...paid(D(-9), '11:00', 'cortesia', 0), customPrice: 0, freeCut: true, redeemState: 'redeemed' }),
    bk(-8, '17:00', 108, 12, 'completada', paid(D(-8), '18:30', 'efectivo', 29990)),
    bk(-7, '13:00', 113, 9, 'cancelada'),
    // No vino: cancelada + no_show.
    bk(-6, '09:00', 105, 11, 'cancelada', { noShow: true }),
    bk(-5, '14:00', 109, 13, 'completada', paid(D(-5), '17:00', 'tarjeta', 66990, '004871')),
    // Autocompletada sin cobro: "pago por confirmar".
    bk(-4, '18:00', 102, 11, 'completada', { startedAt: isoAt(D(-4), '18:02'), completedAt: isoAt(D(-4), '19:10'), autoCompleted: true }),
    // Sin cerrar: quedaron abiertas en días que ya pasaron.
    bk(-3, '11:00', 110, 12, 'confirmada'),
    bk(-2, '16:00', 107, 11, 'pendiente', { createdAt: isoAt(D(-4), '21:40') }),
    bk(-1, '12:00', 106, 11, 'en curso', { startedAt: isoAt(D(-1), '12:05') }),
    bk(-1, '17:00', 101, 9, 'completada', paid(D(-1), '17:45', 'transferencia', 11990, '88124417')),
    // Hoy.
    bk(0, '09:00', 112, 11, 'completada', paid(today, '10:00', 'efectivo', 19990)),
    bk(0, '10:00', 103, 9, 'completada', { startedAt: isoAt(today, '10:01'), completedAt: isoAt(today, '10:50'), autoCompleted: true }),
    bk(0, '11:00', 106, 12, 'en curso', { startedAt: minutesAgo(40) }),
    bk(0, '13:00', 109, 11, 'confirmada'),
    bk(0, '15:00', 111, 9, 'pendiente', { createdAt: minutesAgo(90) }),
    bk(0, '17:00', 110, 12, 'confirmada'),
    // Próximos días.
    bk(1, '10:00', 102, 11, 'confirmada'),
    bk(1, '16:00', 113, null, 'pendiente', { customService: 'Diseño de cejas + fade', customPrice: 14990 }),
    bk(2, '12:00', 108, 14, 'confirmada'),
    bk(3, '09:00', 101, 12, 'confirmada'),
    bk(3, '18:00', 114, 11, 'cancelada'),
    bk(4, '11:00', 105, 10, 'pendiente', { createdAt: minutesAgo(60 * 30) }),
    bk(6, '15:00', 104, 11, 'confirmada'),
    bk(7, '10:00', 107, 9, 'confirmada'),
  ]

  // Bloqueos manuales de la agenda: `${date}|${slot}`.
  const blocks = new Set([`${today}|19:00`, `${D(1)}|13:00`, `${D(1)}|14:00`, `${D(2)}|09:00`])

  const products = [
    { id: 1, name: 'Polera Barber Club', brand: 'Barber Club', description: 'Polera Boxy Fit con estilo streetwear.', price: 19990, oldPrice: null, stock: 10, active: true, sortOrder: 0, imgFront: '/assets/products/polera-barber-club-1.png', imgBack: '/assets/products/polera-barber-club-2.png', imgDetail: '/assets/products/polera-barber-club-3.png', sku: 'POL-BC-01', cost: 8500, archivedAt: null },
    { id: 2, name: 'Cera mate Brunetti', brand: 'Brunetti', description: 'Fijación media, acabado mate, sin brillo.', price: 12990, oldPrice: 14990, stock: 7, active: true, sortOrder: 1, imgFront: null, imgBack: null, imgDetail: null, sku: 'CER-MT-01', cost: 4200, archivedAt: null },
    { id: 3, name: 'Aceite para barba', brand: 'Brunetti', description: 'Hidrata y suaviza, aroma a cedro.', price: 9990, oldPrice: null, stock: 2, active: true, sortOrder: 2, imgFront: null, imgBack: null, imgDetail: null, sku: 'ACE-BA-01', cost: null, archivedAt: null },
    { id: 4, name: 'Shampoo anticaspa', brand: 'Barber Club', description: 'Uso diario, 250 ml.', price: 8990, oldPrice: null, stock: 0, active: true, sortOrder: 3, imgFront: null, imgBack: null, imgDetail: null, sku: 'SHA-AC-01', cost: 3100, archivedAt: null },
    { id: 5, name: 'Gorro Brunetti', brand: 'Brunetti', description: 'Beanie tejido con bordado dorado.', price: 14990, oldPrice: null, stock: 4, active: false, sortOrder: 4, imgFront: null, imgBack: null, imgDetail: null, sku: 'GOR-BR-01', cost: 5000, archivedAt: null },
  ]

  /* Libro de movimientos de stock. La Cera tiene un desfase a propósito (el
     libro suma 6 y el stock dice 7) para que Inventario muestre "cuadrar". */
  let moveSeq = 900
  const mv = (productId, daysAgo, kind, delta, reason, unitCost = null, extra = {}) => ({
    id: ++moveSeq, productId, date: D(-daysAgo), kind, delta, reason, unitCost, saleId: null, shopOrderId: null, createdAt: isoAt(D(-daysAgo), '10:00'), ...extra,
  })
  const moves = [
    mv(1, 60, 'inicial', 12, 'Stock inicial', 8500),
    mv(1, 12, 'venta', -1, 'Venta web', null, { shopOrderId: 3001 }),
    mv(1, 3, 'venta', -1, 'Venta en mesón', null, { saleId: 7001 }),
    mv(2, 60, 'inicial', 8, 'Stock inicial', 4200),
    mv(2, 8, 'venta', -2, 'Venta en mesón', null, { saleId: 7002 }),
    mv(3, 45, 'inicial', 3, 'Stock inicial'),
    mv(3, 1, 'venta', -1, 'Venta en mesón', null, { saleId: 7003 }),
    mv(4, 45, 'inicial', 2, 'Stock inicial', 3100),
    mv(4, 20, 'merma', -2, 'Vencidos'),
    mv(5, 30, 'inicial', 4, 'Stock inicial', 5000),
  ]

  const sale = (id, daysAgo, bookingId, clientId, method, items, extra = {}) => {
    const lines = items.map(([productId, name, qty, unitPrice, pct = 0]) => {
      const unitCollected = Math.round(unitPrice * (100 - pct) / 100)
      return { productId, name, qty, unitPrice, unitCollected, lineTotal: unitCollected * qty }
    })
    return {
      id, date: D(-daysAgo), bookingId, clientId, paymentMethod: method, paymentRef: null, status: 'pagada',
      discountPct: items.some((i) => i[4]) ? DISCOUNT_PCT : 0,
      items: lines, total: lines.reduce((s, l) => s + l.lineTotal, 0), createdAt: isoAt(D(-daysAgo), '17:50'), ...extra,
    }
  }
  const sales = [
    sale(7001, 3, null, null, 'tarjeta', [[1, 'Polera Barber Club', 1, 19990]], { paymentRef: '004901' }),
    sale(7002, 8, bookings.find((b) => b.date === D(-8)).id, 108, 'efectivo', [[2, 'Cera mate Brunetti', 2, 12990]]),
    sale(7003, 1, bookings.find((b) => b.date === D(-1) && b.time === '17:00').id, 101, 'transferencia', [[3, 'Aceite para barba', 1, 9990, DISCOUNT_PCT]]),
  ]

  // Gastos e ingresos manuales (expenses.kind).
  let expSeq = 400
  const ex = (daysAgo, category, detail, amount, kind = 'gasto') => ({ id: ++expSeq, date: D(-daysAgo), category, detail, amount, owner: 'Brunetti', kind })
  const expenses = [
    ex(1, 'Insumos', 'Navajas y cuchillas', 18990),
    ex(4, 'Arriendo', 'Arriendo del local', 420000),
    ex(6, 'Marketing', 'Publicidad Instagram', 35000),
    ex(9, 'Servicios', 'Luz y agua', 48700),
    ex(14, 'Equipamiento', 'Secador profesional', 89990),
    ex(22, 'Insumos', 'Productos químicos (decolorante)', 32500),
    ex(3, 'Otros', 'Clase particular de visagismo', 60000, 'ingreso'),
    ex(12, 'Otros', 'Arriendo de sillón por un día', 25000, 'ingreso'),
  ]

  // Inscripciones (Cursos y Workshop): las pagadas llevan el marcador de
  // Mercado Pago en `message`, que es lo que las vuelve "pedidos".
  let enrSeq = 200
  const en = (daysAgo, name, phone, email, source, extra = {}) => ({
    id: ++enrSeq, name, phone, email, source, level: null, message: null, edition: null, amount: null,
    details_sent_at: null, created_at: isoAt(D(-daysAgo), '19:20'), ...extra,
  })
  const enrollments = [
    en(2, 'Camila Torres', '977001122', 'camila.torres@gmail.com', 'cursos', { level: 'Estoy empezando', message: 'Pago MercadoPago 1320051122 · $149990', amount: 149990 }),
    en(5, 'Rodrigo Pizarro', '966554433', 'rpizarro@gmail.com', 'workshop', { edition: '18 de octubre', message: 'Pago MercadoPago 1320049911 · $59990', amount: 59990 }),
    en(9, 'Nicolás Araya', '955443322', 'nico.araya@gmail.com', 'workshop', { edition: '18 de octubre', message: 'Pago MercadoPago 1320040007 · $59990', amount: 59990, details_sent_at: isoAt(D(-1), '12:00') }),
    en(11, 'Javiera Lagos', '944332211', 'javi.lagos@gmail.com', 'cursos', { level: 'Ya corto hace un tiempo', message: 'Quiero saber horarios de la próxima generación.' }),
    en(16, 'Pablo Espinoza', '933221100', 'pablo.espinoza@gmail.com', 'workshop', { edition: 'Lista de espera', message: 'Lista de espera' }),
  ]

  const shopOrders = [
    { id: 3001, name: 'Andrés Carrasco', phone: '922110099', email: 'andres.carrasco@gmail.com', items: [{ productId: 1, name: 'Polera Barber Club', qty: 1, price: 19990 }], amount: 19990, status: 'paid', created_at: isoAt(D(-12), '21:05'), paid_at: isoAt(D(-12), '21:06') },
    { id: 3002, name: 'Felipe Morales', phone: '932165498', email: 'fmorales@gmail.com', items: [{ productId: 2, name: 'Cera mate Brunetti', qty: 2, price: 12990 }], amount: 25980, status: 'paid', created_at: isoAt(today, '08:40'), paid_at: isoAt(today, '08:41') },
  ]

  const notifications = [
    { id: 61, title: 'Nueva reserva', body: 'Ignacio Vargas · Solo fade · hoy 15:00', url: `/panel?tab=reservas&date=${today}`, tag: 'booking', createdAt: minutesAgo(90) },
    { id: 60, title: 'Atención completada', body: 'Confirma cómo pagó', url: '/panel?tab=resumen', tag: 'auto-complete', createdAt: minutesAgo(200) },
    { id: 59, title: 'Próximo turno · hoy a las 13:00', body: 'Agustín Soto · Corte de cabello', url: `/panel?tab=reservas&date=${today}`, tag: 'reminder', createdAt: minutesAgo(260) },
    { id: 58, title: 'Reserva cancelada', body: 'Gabriel Navarro canceló su hora', url: '/panel?tab=reservas', tag: 'cancel', createdAt: minutesAgo(60 * 26) },
  ]

  // Reseñas (/resena): token de 32 hex por atención completada.
  const reviews = [
    { id: 1, token: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', bookingId: bookings[0].id, rating: 5, comment: 'Impecable como siempre, el mejor fade de Santiago.', ratedAt: isoAt(D(-19), '20:10') },
    { id: 2, token: 'b2c3d4e5f60718293a4b5c6d7e8f90a1', bookingId: bookings[1].id, rating: 5, comment: 'Muy buena asesoría, me explicó todo.', ratedAt: isoAt(D(-17), '09:30') },
    { id: 3, token: 'c3d4e5f60718293a4b5c6d7e8f90a1b2', bookingId: bookings[2].id, rating: 4, comment: '', ratedAt: isoAt(D(-14), '22:00') },
    { id: 4, token: 'd4e5f60718293a4b5c6d7e8f90a1b2c3', bookingId: bookings[4].id, rating: null, comment: null, ratedAt: null },
  ]

  const campaigns = [
    { id: 31, message: 'Esta semana 20% en ceras y aceites presentando tu tarjeta.', audience: 'all', recipientCount: 42, source: 'brunetti', createdAt: isoAt(D(-10), '11:00') },
    { id: 30, message: 'Te falta una estrella para tu corte gratis. ¡Te esperamos!', audience: 'almost_free', recipientCount: 7, source: 'pimpstudio', createdAt: isoAt(D(-24), '18:00') },
  ]

  const settings = {
    barber: {
      [BRUNO_ID]: {
        notif: { reserva: true, cancelacion: true, recordatorio: true, marketing: false },
        whatsapp: { activo: true, recordatorio24h: true, recordatorio2h: false, confirmacion: true },
        horario: { apertura: '09:00', cierre: '20:00', anticipacion: '120', ventana: '30', domingo: 'closed', cancelacion: '24h' },
      },
    },
    business: { name: 'Brunetticutz', address: 'Av. Providencia 1234, Providencia', phone: '+56 9 8765 4321' },
    budgets: { Insumos: 80000, Marketing: 50000 },
    autoComplete: false,
    cursosPrice: 149990,
    workshopPrice: 59990,
    workshopDate: `${D(24)}T10:00:00.000Z`,
    workshopPaymentsEnabled: true,
  }

  return {
    today, barbers, services, clients, bookings, blocks, products, moves, sales, expenses,
    enrollments, shopOrders, notifications, reviews, campaigns, settings,
    seq: { booking: seq, move: moveSeq, sale: 7003, expense: expSeq, enrollment: enrSeq, order: 3002, client: 114, service: 16, product: 5, campaign: 31, block: 0 },
    loginFailures: {},
    resetTokens: new Set(),
  }
}
