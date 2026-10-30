/* Datos del mock de API de desarrollo (VITE_DEV_MOCKS=1). Ver index.mjs.

   Todo vive en memoria y se arma RELATIVO A HOY (hora de Santiago): cada vez
   que arranca el servidor, "ayer", "hoy" y "la semana que viene" son de
   verdad, así la agenda, "Sin cerrar" y la Caja del día siempre tienen algo
   que mostrar. Nada de esto toca una base de datos ni sale del proceso.

   Un solo barbero (Bruno, id 6), como el negocio real. Los estados cubren
   todo lo que el panel tiene que saber dibujar: pendiente, confirmada, en
   curso, completada con y sin cobro, "pago por confirmar" (autocompletada),
   No vino, corte gratis canjeado y las que quedaron sin cerrar. */

import { FACE_SHAPES } from '../../src/data/estilo.js'
import { suggest } from '../../api/_imagenRules.js'
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
    showOnHome: s.id !== 9,
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
  // Asesoría visagista de AYER (servicio 10), al final del arreglo para no
  // correr los ids de las demás: es la que precarga la pestaña Visagismo.
  bookings.push(bk(-1, '09:00', 108, 10, 'completada', paid(D(-1), '11:00', 'tarjeta', 49990, '004990')))
  // Brunetti Image Studio: asesorías en todos los estados que el panel tiene
  // que dibujar, y un catálogo de prueba (solo en el mock: en producción el
  // catálogo lo carga Bruno, nada se inventa).
  const imagen = imagenFixtures({ bookings, D, isoAt })

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
    // Asesoría de imagen: online a la venta, presencial en pausa (WhatsApp).
    asesoria: {
      presencial: { price: 49990, enabled: false, info: 'En la barbería con Bruno: diagnóstico en vivo, corte y tu informe personalizado.' },
      online: { price: 29990, enabled: true, info: 'Desde tu casa: respondes unas preguntas, subes 4 fotos y recibes tu informe por correo.' },
    },
  }

  return {
    today, barbers, services, clients, bookings, blocks, products, moves, sales, expenses,
    enrollments, shopOrders, notifications, reviews, campaigns, settings, imagen,
    seq: { booking: seq, move: moveSeq, sale: 7003, expense: expSeq, enrollment: enrSeq, order: 3002, client: 114, service: 16, product: 5, campaign: 31, block: 0 },
    loginFailures: {},
    resetTokens: new Set(),
  }
}

/* ---------- Brunetti Image Studio ---------- */
// Un token fijo para probar el formulario público sin pasar por el pago:
// /asesoria/datos?t=0123456789abcdef0123456789abcdef
export const DEMO_FORM_TOKEN = '0123456789abcdef0123456789abcdef'

function imagenFixtures({ bookings, D, isoAt }) {
  const face = (id) => {
    const f = FACE_SHAPES.find((x) => x.id === id)
    return { id: f.id, name: f.name, tagline: f.tagline, traits: f.traits, diagnosis: f.diagnosis, goal: f.goal, avoid: f.avoid, path: f.path, tips: f.tips, best: f.best.map(({ name, note, img }) => ({ name, note, img })) }
  }
  const prod = (id, p) => ({
    id, name: p.name, brand: p.brand || null, category: p.category, imgUrl: p.imgUrl || null, description: p.description || null,
    hold: p.hold || null, shine: p.shine || null, amount: p.amount || null, application: p.application || null, usage: p.usage || null,
    frequency: p.frequency || null, hairTypes: p.hairTypes || [], thickness: p.thickness || [], conditions: p.conditions || [], needs: p.needs || [],
    soldHere: Boolean(p.soldHere), productId: p.productId || null, price: p.price ?? null, buyUrl: p.buyUrl || null, active: true,
    reviewedAt: p.reviewed ? isoAt(D(-3), '10:00') : null, updatedAt: isoAt(D(-3), '10:00'),
  })
  const products = [
    prod(1, { name: 'Cera mate Brunetti', brand: 'Brunetti', category: 'cera', hold: 'Media', shine: 'Mate', hairTypes: ['Liso', 'Ondulado'], thickness: ['Medio', 'Grueso'], amount: 'Del tamaño de una arveja', application: 'Frótala entre las palmas y aplícala con el pelo seco, de atrás hacia adelante.', frequency: 'A diario', soldHere: true, productId: 2, reviewed: true }),
    prod(2, { name: 'Shampoo anticaspa', brand: 'Barber Club', category: 'champu', needs: ['Anticaspa', 'Uso diario'], usage: 'Masajea el cuero cabelludo un minuto y enjuaga.', frequency: '2 a 3 veces por semana', soldHere: true, productId: 4, reviewed: true }),
    prod(3, { name: 'Polvo texturizador (demo)', brand: 'Marca demo', category: 'polvo', hold: 'Media', shine: 'Mate', thickness: ['Fino', 'Medio'], amount: 'Una pizca', application: 'Espolvorea en la raíz con el pelo seco y peina con los dedos.', frequency: 'A diario', buyUrl: 'https://ejemplo.cl/polvo' }),
    prod(4, { name: 'Champú purificante (demo)', brand: 'Marca demo', category: 'champu', needs: ['Cabello graso', 'Limpieza profunda'], usage: 'Solo en el cuero cabelludo; deja actuar un minuto.', frequency: 'Día por medio', buyUrl: 'https://ejemplo.cl/champu' }),
    prod(5, { name: 'Acondicionador ligero (demo)', brand: 'Marca demo', category: 'acondicionador', needs: ['Cabello fino', 'Hidratante'], amount: 'Media moneda', application: 'De medios a puntas; enjuaga al minuto.' }),
    prod(6, { name: 'Crema para rizos (demo)', brand: 'Marca demo', category: 'crema', hold: 'Baja', shine: 'Natural', hairTypes: ['Ondulado', 'Rizado', 'Crespo'], needs: ['Frizz', 'Rizos'], application: 'Con el pelo húmedo, de medios a puntas, apretando los rizos.' }),
  ]
  const base = {
    clientId: null, bookingId: null, source: 'panel', modality: 'presencial', status: 'datos_pendientes', paymentStatus: 'en_local',
    price: null, paidAmount: null, paymentMethod: null, paymentRef: null, paidAt: null, email: null, age: null, visitDate: null,
    intake: {}, intakeSubmittedAt: null, consentAt: null, consentBy: null, consentVersion: null, diagnosis: {},
    diagnosedBy: null, diagnosedAt: null, nextFollowup: null, notes: null, utm: null, createdBy: 6,
  }
  const yesterday = bookings.find((b) => b.date === D(-1) && b.serviceId === 10)
  const martinBooking = bookings.find((b) => b.date === D(-15) && b.time === '16:00')
  const consultations = [
    { ...base, id: 1, clientId: 112, bookingId: martinBooking?.id ?? null, status: 'entregada', paymentStatus: 'pagada', paidAmount: 49990, paymentMethod: 'reserva', paidAt: isoAt(D(-15), '17:00'),
      name: 'Martín Castillo', phone: '976543210', email: 'martin.castillo@gmail.com', age: 34, visitDate: D(-15), formToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      intake: { goal: 'Un corte que se vea bien sin peinarme mucho para la oficina.', style: 'Moderno', styleTime: 'Hasta 5 minutos', finish: 'Mate', washFreq: 'A diario', water: 'Caliente', drying: 'Toalla', needs: ['Caspa'], currentProducts: 'Gel del supermercado' },
      intakeSubmittedAt: isoAt(D(-16), '20:00'), consentAt: isoAt(D(-16), '20:00'), consentBy: 'cliente', consentVersion: '2026-10',
      diagnosis: { face: face('cuadrado'), skull: { occipital: 'Normal', projection: 'Media', height: 'Media', sides: 'Equilibradas', notes: null }, hair: { type: 'Liso', thickness: 'Grueso', density: 'Alta', condition: 'Normal', frizz: 'No', volume: 'Alto', porosity: 'No evaluada', sensitivity: 'No', loss: 'No', notes: null }, observations: 'Remolino marcado en la coronilla: conviene dejar algo más de largo ahí.' },
      diagnosedBy: 6, diagnosedAt: isoAt(D(-15), '17:30'), nextFollowup: D(13), notes: 'Martín, con la cera mate y el repaso cada 4 semanas vas a mantener la forma sin esfuerzo.',
      createdAt: isoAt(D(-17), '12:00'), updatedAt: isoAt(D(-14), '10:00') },
    { ...base, id: 2, clientId: 108, bookingId: yesterday?.id ?? null, status: 'en_revision', paymentStatus: 'pagada', paidAmount: 49990, paymentMethod: 'reserva', paidAt: isoAt(D(-1), '11:00'),
      name: 'Cristóbal Pérez', phone: '961234578', email: 'cristobal.perez@gmail.com', visitDate: D(-1), formToken: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      intake: { goal: 'Dejar de verme la cara tan redonda.', style: 'Clásico', finish: 'Natural', washFreq: 'Día por medio', needs: ['Grasa', 'Poco volumen'] },
      consentAt: isoAt(D(-1), '09:05'), consentBy: 'barbero:6', consentVersion: '2026-10',
      diagnosis: { face: face('redondo'), skull: { occipital: 'Plana', projection: 'Baja', height: 'Media', sides: 'Anchas', notes: null }, hair: { type: 'Liso', thickness: 'Fino', density: 'Media', condition: 'Graso', frizz: 'No', volume: 'Bajo', porosity: 'No evaluada', sensitivity: 'No', loss: 'Leve', notes: null }, observations: null },
      diagnosedBy: 6, diagnosedAt: isoAt(D(-1), '10:40'), createdAt: isoAt(D(-1), '09:00'), updatedAt: isoAt(D(-1), '10:40') },
    { ...base, id: 3, clientId: 109, source: 'web', modality: 'online', status: 'en_revision', paymentStatus: 'pagada', price: 29990, paidAmount: 29990, paymentMethod: 'mercadopago', paymentRef: 'mock_demo_3', paidAt: isoAt(D(-2), '19:10'),
      name: 'Agustín Soto', phone: '989012345', email: 'agustin.soto@icloud.com', age: 27, formToken: 'cccccccccccccccccccccccccccccccc',
      intake: { goal: 'Quiero dejarme crecer el pelo arriba sin que se vea desordenado.', style: 'Atrevido', styleTime: 'Más de 5 minutos', finish: 'Natural', length: 'Dejar crecer', washFreq: '2 a 3 veces por semana', water: 'Tibia', drying: 'Al aire', needs: ['Frizz', 'Resequedad'], currentProducts: 'Ninguno', habits: 'Voy al gimnasio 4 veces por semana.' },
      intakeSubmittedAt: isoAt(D(-2), '20:02'), consentAt: isoAt(D(-2), '19:40'), consentBy: 'cliente', consentVersion: '2026-10', utm: '/asesoria · utm_source=instagram',
      createdAt: isoAt(D(-2), '19:05'), updatedAt: isoAt(D(-2), '20:02') },
    { ...base, id: 4, source: 'web', modality: 'online', status: 'pago_pendiente', paymentStatus: 'pendiente', price: 29990,
      name: 'Ignacio Vargas', phone: '954321876', email: 'ignacio.vargas@gmail.com', formToken: 'dddddddddddddddddddddddddddddddd',
      createdAt: isoAt(D(-1), '22:15'), updatedAt: isoAt(D(-1), '22:15') },
    { ...base, id: 5, clientId: 113, source: 'web', modality: 'online', status: 'datos_pendientes', paymentStatus: 'pagada', price: 29990, paidAmount: 29990, paymentMethod: 'mercadopago', paymentRef: 'mock_demo_5', paidAt: isoAt(D(0), '08:30'),
      name: 'Lucas Herrera', phone: '918273645', email: 'lucas.herrera@gmail.com', formToken: DEMO_FORM_TOKEN,
      createdAt: isoAt(D(0), '08:25'), updatedAt: isoAt(D(0), '08:30') },
  ]
  const photos = [
    ['frontal', 'estilo-mullet-rizado.jpg'], ['perfil_izq', 'estilo-crop-rizado-corto.jpg'], ['perfil_der', 'estilo-crop-rizado.jpg'], ['posterior', 'estilo-mullet-shag.jpg'],
  ].map(([angle, img], i) => ({ id: i + 1, consultationId: 3, angle, src: `/assets/estilo/${img}`, uploadedBy: 'cliente', createdAt: isoAt(D(-2), '19:50') }))

  // Martín: sugerencias ya revisadas por Bruno y un informe v1 entregado.
  const out = suggest({ diagnosis: consultations[0].diagnosis, intake: consultations[0].intake, catalog: products })
  const recs = out.items.map((it, i) => ({
    id: i + 1, consultationId: 1, kind: it.kind, productId: it.productId ?? null, title: it.title, detail: it.detail || {}, reason: it.reason || null,
    source: 'regla', ruleId: it.ruleId, status: it.kind === 'corte' && i === 1 ? 'descartada' : 'aprobada', edited: i === 0,
    decidedBy: 6, decidedByName: 'Bruno Herrera', decidedAt: isoAt(D(-15), '18:00'), position: i + 1,
  }))
  const reports = [{ id: 1, consultationId: 1, version: 1, snapshot: null, createdAt: isoAt(D(-15), '18:10'), sentAt: isoAt(D(-14), '10:00'), sentTo: 'martin.castillo@gmail.com', sendCount: 1, shareToken: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', shareExpiresAt: isoAt(D(15), '10:00') }]
  const ev = (id, consultationId, actor, action, at, detail = null) => ({ id, consultationId, actor, actorName: actor === 'barbero' ? 'Bruno Herrera' : null, action, detail, at })
  const events = [
    ev(1, 1, 'barbero', 'envio_correo', isoAt(D(-14), '10:00'), { version: 1, to: 'martin.castillo@gmail.com' }),
    ev(2, 1, 'barbero', 'informe', isoAt(D(-15), '18:10'), { version: 1 }),
    ev(3, 1, 'barbero', 'diagnostico', isoAt(D(-15), '17:30'), { face: 'Cuadrado' }),
    ev(4, 3, 'cliente', 'datos_enviados', isoAt(D(-2), '20:02'), { photos: 4 }),
    ev(5, 3, 'sistema', 'pago', isoAt(D(-2), '19:10'), { amount: 29990, method: 'mercadopago' }),
    ev(6, 2, 'barbero', 'diagnostico', isoAt(D(-1), '10:40'), { face: 'Redondo' }),
    ev(7, 5, 'sistema', 'pago', isoAt(D(0), '08:30'), { amount: 29990, method: 'mercadopago' }),
  ]
  return { consultations, photos, recs, reports, events, products, seq: { consultation: 5, photo: photos.length, rec: recs.length, report: 1, event: events.length, product: products.length } }
}
