/* Mock de la API para desarrollo — SOLO `vite` en modo serve y SOLO con
   VITE_DEV_MOCKS=1 (config "dev-mock" de .claude/launch.json):

     VITE_DEV_MOCKS=1 npm run dev

   Contesta /api/* desde memoria (fixtures.mjs) con las MISMAS formas que el
   backend real (ver scratchpad/sync/api-contract.md): así el panel y las
   páginas públicas se pueden recorrer enteros sin `vercel dev`, sin
   .env.local y sin tocar Neon, Mercado Pago, Notion, Resend ni PimpStudio.
   Nada de esto llega al bundle de producción: el plugin es `apply: 'serve'`,
   vite.config.js lo importa en Node (nunca desde src/) y, sin la variable,
   no registra ni un middleware — `npm run dev` queda exactamente igual.

   Sesión: cualquier `Authorization: Bearer <algo>` es Bruno (id 6, admin),
   incluido el "dev-token" del respaldo local de BarberLogin. Sin token, las
   rutas del panel responden 401 como las de verdad.
   Login del mock: usuario `bruno-herrera` (o "brunetti") y cualquier clave
   de 8+ caracteres; al tercer error seguido, 429 por 2 minutos.

   Ayudas de desarrollo (no existen en producción):
     POST /api/__mock/reset       vuelve los datos a cero (y desbloquea el login)
     GET  /api/__mock/state       vuelca el estado en memoria
     DEV_MOCK_DELAY=400           latencia artificial en ms (default 0)
     DEV_MOCK_FAIL=bookings,...   esas rutas responden 500 con sesión (para
                                  probar los avisos de error del panel)

   Lo que NO se imita: el puente con PimpStudio (los modos bridge-* responden
   404, como sin secreto), los pases .pkpass reales, los correos y Notion.
   El checkout de Mercado Pago se resuelve acá mismo (pago aprobado al
   instante, como si el webhook ya hubiera llegado), así el pedido aparece en
   Pedidos y el stock baja; el mock viejo de vite.config.js sigue sirviendo
   el `npm run dev` normal. */

import {
  createState, dateKey, nowMinutes, addDays, iso, ALL_SLOTS, slotMinutes, blocksFor,
  BRUNO_ID, LOYALTY_GOAL, DISCOUNT_STARS, DISCOUNT_PCT, PAYMENT_METHODS, STATUSES,
} from './fixtures.mjs'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_LEAD_MINUTES = 55
const MAX_LEAD_DAYS = 10
const MAX_PRICE = 10_000_000

const cleanPhone = (v) => {
  let d = String(v || '').replace(/\D/g, '')
  if (d.length > 9 && d.startsWith('56')) d = d.slice(2)
  return d.slice(0, 9)
}
const isRealDate = (s) => DATE_RE.test(String(s || '')) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s
const ddmmyyyy = (key) => key.split('-').reverse().join('-')
const int = (v) => (v === '' || v == null ? NaN : Number(v))
const isMoney = (n) => Number.isInteger(n) && n >= 0 && n <= MAX_PRICE

/* ── Estado derivado ─────────────────────────────────────────────────────── */
function helpers(st) {
  const today = dateKey()
  const svcOf = (id) => (id == null ? null : st.services.find((s) => s.id === Number(id)) || null)
  const clientOf = (id) => st.clients.find((c) => c.id === Number(id)) || null
  const clientByPhone = (phone) => st.clients.find((c) => c.phone === cleanPhone(phone)) || null
  const durationOf = (b) => svcOf(b.serviceId)?.min || 60
  const effectivePrice = (b) => {
    if (b.customPrice != null) return b.customPrice
    if (b.priceSnapshot != null) return b.priceSnapshot
    return svcOf(b.serviceId)?.price ?? 0
  }
  const paymentPending = (b) => b.status === 'completada' && !b.paidAt && Boolean(b.completedAt)
  const loyaltyOf = (c, earned) => {
    if (!c) return null
    const stars = Number(c.stars || 0)
    return {
      stars, goal: LOYALTY_GOAL, cutsToFreeCut: Math.max(0, LOYALTY_GOAL - stars),
      freeCutReady: stars >= LOYALTY_GOAL, productDiscountReady: stars >= DISCOUNT_STARS, productDiscountPct: DISCOUNT_PCT,
      ...(earned === undefined ? {} : { earned }),
    }
  }
  const bookingRow = (b) => {
    const c = clientOf(b.clientId)
    const s = svcOf(b.serviceId)
    const price = effectivePrice(b)
    return {
      id: b.id, date: b.date, time: b.time, barberId: b.barberId, barber: 'Brunetti',
      client: c?.name || '', phone: c?.phone || '', service: b.customService || s?.name || 'Servicio',
      price, status: b.status,
      clientId: b.clientId, profession: c?.profession ?? null, serviceId: b.serviceId ?? null,
      listPrice: s?.price ?? price,
      paidAmount: b.paidAmount, paymentMethod: b.paymentMethod, paymentRef: b.paymentRef,
      noShow: Boolean(b.noShow), freeCut: Boolean(b.freeCut), createdAt: b.createdAt,
      startedAt: b.startedAt, autoCompleted: Boolean(b.autoCompleted), paymentPending: paymentPending(b),
    }
  }
  const spanFor = (time, min) => {
    const idx = ALL_SLOTS.indexOf(time)
    const blocks = blocksFor(min)
    if (idx === -1 || idx + blocks > ALL_SLOTS.length) return null
    return ALL_SLOTS.slice(idx, idx + blocks)
  }
  const bookedSlots = (date, excludeId = null) => {
    const set = new Set()
    for (const b of st.bookings) {
      if (b.date !== date || b.status === 'cancelada' || b.id === excludeId) continue
      ;(spanFor(b.time, durationOf(b)) || [b.time]).forEach((s) => set.add(s))
    }
    return set
  }
  const blockedSlots = (date) => new Set([...st.blocks].filter((k) => k.startsWith(`${date}|`)).map((k) => k.slice(11)))
  const clientRow = (c) => {
    const own = st.bookings.filter((b) => b.clientId === c.id && b.status !== 'cancelada')
    const past = own.filter((b) => b.date <= today)
    const upcoming = own.filter((b) => b.date >= today && ['pendiente', 'confirmada', 'en curso'].includes(b.status)).map((b) => b.date).sort()
    const lastVisit = past.map((b) => b.date).sort().pop() || null
    return {
      id: c.id, name: c.name || '', phone: c.phone, email: c.email || '', profession: c.profession ?? null,
      createdAt: c.createdAt || null, visits: past.length,
      totalSpent: own.filter((b) => b.status === 'completada').reduce((sum, b) => sum + Number(b.paidAmount ?? effectivePrice(b)), 0),
      lastVisit, nextVisit: upcoming[0] || null, status: past.length ? 'activo' : 'nuevo',
      loyalty: loyaltyOf(c), walletHasPass: Boolean(c.walletHasPass),
    }
  }
  return { today, svcOf, clientOf, clientByPhone, durationOf, effectivePrice, paymentPending, loyaltyOf, bookingRow, spanFor, bookedSlots, blockedSlots, clientRow }
}

function upsertClient(st, { name, phone, email, profession }) {
  const p = cleanPhone(phone)
  let c = st.clients.find((x) => x.phone === p)
  let notice = null
  const mail = email === undefined ? undefined : String(email || '').trim().toLowerCase()
  if (mail && !EMAIL_RE.test(mail)) notice = 'El correo no parece válido: no se guardó.'
  if (!c) {
    c = { id: ++st.seq.client, name: String(name || '').trim(), phone: p, email: mail && !notice ? mail : '', profession: null, stars: 0, walletHasPass: false, createdAt: dateKey() }
    st.clients.unshift(c)
  } else {
    if (String(name || '').trim()) c.name = String(name).trim()
    if (mail !== undefined && !notice) c.email = mail
  }
  if (profession !== undefined) c.profession = profession === null || profession === '' ? null : String(profession).trim().slice(0, 80)
  return { client: c, notice }
}

/* Autocompletar (settings panel:auto_complete): mismas reglas que
   autoCompleteStarted de api/_bookingLife.js, sin el throttle. */
function autoComplete(st, h) {
  if (!st.settings.autoComplete) return 0
  const now = Date.now()
  const nowMin = nowMinutes()
  let n = 0
  for (const b of st.bookings) {
    if (b.status !== 'en curso' || !b.startedAt || b.date < addDays(h.today, -30)) continue
    const min = h.durationOf(b)
    const endPassed = b.date < h.today || (b.date === h.today && slotMinutes(b.time) + min <= nowMin)
    if (now - new Date(b.startedAt).getTime() < min * 60_000 || !endPassed) continue
    b.status = 'completada'
    b.completedAt = iso()
    b.autoCompleted = true
    b.priceSnapshot = b.customPrice ?? h.svcOf(b.serviceId)?.price ?? 0
    b.updatedAt = iso()
    if (h.effectivePrice(b) === 0) Object.assign(b, { paidAmount: 0, paymentMethod: 'cortesia', paidAt: iso() })
    const c = h.clientOf(b.clientId)
    if (c && h.svcOf(b.serviceId)?.loyaltyEligible !== false) c.stars += 1
    if (!b.paidAt) st.notifications.unshift({ id: Date.now() + n, title: 'Atención completada', body: 'Confirma cómo pagó', url: '/panel?tab=resumen', tag: 'auto-complete', createdAt: iso() })
    n += 1
  }
  return n
}

/* ── Rutas ───────────────────────────────────────────────────────────────── */
const E = (status, error, extra = {}) => [status, { ok: false, error, ...extra }]
const OK = (data = {}) => [200, { ok: true, ...data }]

function needSession(c) { return c.session ? null : E(401, 'No autorizado') }
function needAdmin(c) { return needSession(c) || (c.session.admin ? null : E(403, 'Solo el administrador puede hacer esto.')) }
function failing(c, name) { return c.session && c.fail.has(name) ? E(500, `Falla simulada en /api/${name} (DEV_MOCK_FAIL).`) : null }

function authBarber(c) {
  const { st, method, q, body } = c
  const barber = st.barbers[0]
  const publicBarber = { id: barber.id, name: barber.name, code: barber.code, role: barber.role, tier: barber.tier, admin: true }
  const token = () => `mock.${barber.id}.${Date.now().toString(36)}`
  if (method === 'GET' && q.me === '1') {
    return c.session ? OK({ barber: publicBarber, token: token() }) : E(401, 'Sesión inválida')
  }
  if (method === 'POST' && q.reset === 'request') {
    if (body.email && !EMAIL_RE.test(String(body.email))) return E(400, 'Ese correo no parece válido.')
    return OK({ message: 'Si ese correo está registrado, te enviamos un enlace para crear una contraseña nueva.' })
  }
  if (method === 'POST' && q.reset === 'confirm') {
    if (!body.token || String(body.token).length < 8) return E(400, 'El enlace no es válido o ya venció. Pide uno nuevo.')
    if (String(body.password || '').length < 8) return E(400, 'La contraseña debe tener al menos 8 caracteres.')
    if (st.resetTokens.has(body.token)) return E(400, 'Este enlace ya se usó. Pide uno nuevo.')
    st.resetTokens.add(body.token)
    st.loginFailures = {}
    return OK({ message: 'Listo: ya puedes ingresar con tu contraseña nueva.' })
  }
  if (q.reset) return E(404, 'No encontrado')
  if (method === 'POST') {
    const user = String(body.username || body.pin || '').trim().toLowerCase()
    const password = String(body.password || '')
    if (!user || !password) return E(400, 'Ingresa tu usuario y contraseña.')
    const lock = st.loginFailures[user]
    if (lock?.until && lock.until > Date.now()) {
      const retryAfterSeconds = Math.ceil((lock.until - Date.now()) / 1000)
      return [429, { ok: false, locked: true, retryAfterSeconds, error: `Demasiados intentos. Vuelve a intentar en ${Math.ceil(retryAfterSeconds / 60)} minuto(s).` }]
    }
    const known = [barber.code, 'brunetti', 'bruno'].includes(user)
    if (known && password.length >= 8) {
      delete st.loginFailures[user]
      return OK({ barber: publicBarber, token: token() })
    }
    const fails = (lock?.count || 0) + 1
    if (fails >= 3) {
      st.loginFailures[user] = { count: 0, until: Date.now() + 120_000 }
      return [429, { ok: false, locked: true, retryAfterSeconds: 120, error: 'Demasiados intentos. Vuelve a intentar en 2 minutos.' }]
    }
    st.loginFailures[user] = { count: fails }
    const remaining = 3 - fails
    return [401, { ok: false, error: `Usuario o contraseña incorrectos (${remaining} intento${remaining === 1 ? '' : 's'} restante${remaining === 1 ? '' : 's'})`, remaining, remainingAttempts: remaining }]
  }
  if (method === 'PATCH' || method === 'PUT') {
    const s = needSession(c); if (s) return s
    if (!body.currentPassword) return E(400, 'Escribe tu contraseña actual.')
    if (body.currentPassword === 'incorrecta') return E(403, 'La contraseña actual no es correcta.')
    if (body.newPassword === undefined && body.email === undefined) return E(400, 'Nada que cambiar.')
    if (body.newPassword !== undefined && String(body.newPassword).length < 8) return E(400, 'La contraseña nueva debe tener al menos 8 caracteres.')
    if (body.email && !EMAIL_RE.test(String(body.email))) return E(400, 'Ese correo no parece válido.')
    if (body.email !== undefined) barber.email = String(body.email || '').trim().toLowerCase()
    return OK({ message: 'Cambios guardados.', ...(body.email !== undefined ? { email: barber.email } : {}) })
  }
  return E(405, 'Method not allowed')
}

function authLogin(c) {
  const { st, body } = c
  if (c.method !== 'POST') return [405, { error: 'Method not allowed' }]
  const phone = cleanPhone(body.phone)
  if (!phone) return [400, { error: 'Teléfono requerido' }]
  if (phone.length !== 9) return [400, { error: 'Teléfono inválido' }]
  if (body.mode === 'register') {
    if (!String(body.name || '').trim()) return [400, { error: 'Nombre requerido' }]
    const { client } = upsertClient(st, { name: body.name, phone, email: body.email || undefined })
    return OK({ user: { id: client.id, phone: client.phone, name: client.name, email: client.email } })
  }
  const client = st.clients.find((x) => x.phone === phone)
  if (!client) return [404, { error: 'Número no registrado. Crea una cuenta primero.' }]
  return OK({ user: { id: client.id, phone: client.phone, name: client.name } })
}

function bookingsApi(c) {
  const { st, method, q, body, h } = c
  if (method === 'GET') {
    if (q.issues) return needSession(c) || OK({ issues: [] })
    if (q.mode && q.mode.startsWith('bridge-')) return E(404, 'No encontrado')
    if (q.mode === 'unclosed') {
      const a = needAdmin(c); if (a) return a
      autoComplete(st, h)
      const items = st.bookings.filter((b) => b.date < h.today && ['pendiente', 'confirmada', 'en curso'].includes(b.status))
        .sort((x, y) => `${x.date} ${x.time}`.localeCompare(`${y.date} ${y.time}`)).map(h.bookingRow)
      const toConfirm = st.bookings.filter(h.paymentPending).sort((x, y) => `${y.date} ${y.time}`.localeCompare(`${x.date} ${x.time}`)).map(h.bookingRow)
      return OK({ count: items.length, toConfirmCount: toConfirm.length, ...(q.summary === '1' ? {} : { items, toConfirm }) })
    }
    if (q.mode === 'cash') {
      const a = needAdmin(c); if (a) return a
      autoComplete(st, h)
      const day = DATE_RE.test(String(q.date || '')) ? q.date : h.today
      const byMethod = { efectivo: 0, tarjeta: 0, transferencia: 0, mercadopago: 0, cortesia: 0, pendiente: 0, online: 0 }
      const rows = st.bookings.filter((b) => b.date === day && b.status !== 'cancelada').sort((x, y) => x.time.localeCompare(y.time)).map(h.bookingRow)
      let servicesCollected = 0, pending = 0, toConfirm = 0, toConfirmCount = 0
      for (const r of rows) {
        if (r.paymentPending && r.paidAmount == null) { byMethod.pendiente += r.price; toConfirm += r.price; toConfirmCount += 1; continue }
        if (r.paidAmount == null) { if (r.status !== 'completada') pending += r.price; continue }
        byMethod[r.paymentMethod || 'efectivo'] += r.paidAmount
        servicesCollected += r.paidAmount
      }
      const sales = st.sales.filter((s) => s.date === day && s.status === 'pagada')
      let productsCollected = 0
      for (const s of sales) { byMethod[s.paymentMethod || 'efectivo'] += s.total; productsCollected += s.total }
      const online = onlineOrders(st).filter((o) => o.date === day)
      const onlineCollected = online.reduce((sum, o) => sum + o.amount, 0)
      byMethod.online = onlineCollected
      return OK({
        date: day,
        collected: servicesCollected + productsCollected + onlineCollected,
        servicesCollected, productsCollected,
        productsCount: sales.reduce((n, s) => n + s.items.reduce((m, i) => m + i.qty, 0), 0),
        onlineCollected, pending, toConfirm, toConfirmCount, byMethod, bookings: rows,
        sales: sales.map((s) => ({ id: s.id, bookingId: s.bookingId, total: s.total, paymentMethod: s.paymentMethod, paymentRef: s.paymentRef, status: s.status, items: s.items.map((i) => ({ name: i.name, qty: i.qty, lineTotal: i.lineTotal })) })),
        online: online.map((o) => ({ id: o.id, type: o.type, name: o.name, amount: o.amount, detail: o.detail, created_at: o.created_at })),
      })
    }
    if (q.mode === 'sales') {
      const a = needAdmin(c); if (a) return a
      const from = DATE_RE.test(String(q.from || '')) ? q.from : addDays(h.today, -30)
      const to = DATE_RE.test(String(q.to || '')) ? q.to : h.today
      const items = []
      for (const s of st.sales) {
        if (s.date < from || s.date > to) continue
        for (const i of s.items) items.push({ saleId: s.id, bookingId: s.bookingId, date: s.date, productId: i.productId, name: i.name, qty: i.qty, unitPrice: i.unitPrice, unitCollected: i.unitCollected, lineTotal: i.lineTotal, paymentMethod: s.paymentMethod, status: s.status })
      }
      const paid = items.filter((i) => i.status === 'pagada')
      return OK({ range: { from, to }, items, totals: { units: paid.reduce((n, i) => n + i.qty, 0), collected: paid.reduce((n, i) => n + i.lineTotal, 0) } })
    }
    if (q.mode) return E(404, 'Modo no reconocido')
    if (q.phone) {
      const client = h.clientByPhone(q.phone)
      const rows = client ? st.bookings.filter((b) => b.clientId === client.id) : []
      return OK({
        bookings: rows.sort((x, y) => `${y.date} ${y.time}`.localeCompare(`${x.date} ${x.time}`)).slice(0, 20).map((b) => ({
          id: b.id, date: b.date, time: b.time, barberId: b.barberId, service: h.bookingRow(b).service, status: b.status,
          price: h.effectivePrice(b), when: b.date >= h.today ? 'next' : 'past',
        })),
      })
    }
    const s = needSession(c); if (s) return s
    const f = failing(c, 'bookings'); if (f) return f
    const from = DATE_RE.test(String(q.from || '')) ? q.from : null
    const to = DATE_RE.test(String(q.to || '')) ? q.to : null
    const rows = st.bookings
      .filter((b) => (!q.barberId || b.barberId === Number(q.barberId)) && (!q.date || b.date === q.date) && (!from || b.date >= from) && (!to || b.date <= to))
      .sort((x, y) => `${y.date} ${y.time}`.localeCompare(`${x.date} ${x.time}`))
      .slice(0, from || to ? 1000 : 160)
    return OK({ bookings: rows.map(h.bookingRow) })
  }

  if (method === 'POST') {
    if (q.mode && q.mode.startsWith('bridge-')) return E(404, 'No encontrado')
    if (q.mode === 'sale') return createSale(c)
    if (q.mode) return E(404, 'Modo no reconocido')
    return c.session ? createManualBooking(c) : createPublicBooking(c)
  }

  if (method === 'PATCH') return patchBooking(c)

  if (method === 'DELETE') {
    if (q.mode === 'sale') return voidSale(c)
    const b = st.bookings.find((x) => x.id === Number(q.id))
    if (!q.id) return [400, { error: 'Falta id' }]
    if (q.purge) {
      const s = needSession(c); if (s) return s
      if (b) {
        if (b.status === 'completada') { const cl = h.clientOf(b.clientId); if (cl) cl.stars = Math.max(0, cl.stars - 1) }
        st.bookings = st.bookings.filter((x) => x !== b)
      }
      return OK()
    }
    if (!b) return E(404, 'Reserva no encontrada')
    const cl = h.clientOf(b.clientId)
    if (!c.session && cleanPhone(body.phone || q.phone) !== cl?.phone) return E(403, 'No autorizado')
    b.status = 'cancelada'
    b.updatedAt = iso()
    st.notifications.unshift({ id: Date.now(), title: 'Reserva cancelada', body: `${cl?.name || 'Un cliente'} canceló su hora`, url: '/panel?tab=reservas', tag: 'cancel', createdAt: iso() })
    return OK()
  }
  return E(405, 'Method not allowed')
}

function checkSlot(c, { date, time, serviceMin, excludeId = null }) {
  const span = c.h.spanFor(time, serviceMin)
  if (!span) return E(422, 'El servicio no cabe en el horario de ese día.')
  const busy = new Set([...c.h.bookedSlots(date, excludeId), ...c.h.blockedSlots(date)])
  if (span.some((s) => busy.has(s))) return E(409, 'Ese horario ya está tomado.')
  return null
}

function createManualBooking(c) {
  const { st, body, h } = c
  const name = String(body.client || body.name || '').trim()
  const phone = cleanPhone(body.phone)
  const status = body.status || 'confirmada'
  const time = String(body.time || '').slice(0, 5)
  if (!name) return E(400, 'Falta el nombre del cliente.')
  if (phone.length !== 9) return E(400, 'El teléfono debe tener 9 dígitos.')
  if (!isRealDate(body.date)) return E(400, 'Fecha inválida.')
  if (!ALL_SLOTS.includes(time)) return E(400, 'Hora inválida.')
  if (!STATUSES.includes(status)) return E(400, 'Estado inválido.')
  if (Number(body.barberId || BRUNO_ID) !== BRUNO_ID) return E(422, 'Ese barbero no existe.')
  const svc = body.serviceId ? h.svcOf(body.serviceId) : null
  if (body.serviceId && !svc) return E(400, 'Ese servicio no existe.')
  const customService = svc ? null : String(body.service || '').trim().slice(0, 120)
  if (!svc && !customService) return E(400, 'Elige un servicio.')
  const price = body.price === undefined || body.price === null || body.price === '' ? null : int(body.price)
  if (price !== null && !isMoney(price)) return E(400, 'Precio inválido.')
  if (!svc && price === null) return E(400, 'Un servicio personalizado necesita precio.')
  if (status !== 'cancelada') {
    const bad = checkSlot(c, { date: body.date, time, serviceMin: svc?.min || 60 })
    if (bad) return bad
  }
  const { client, notice: mailNotice } = upsertClient(st, { name, phone, email: body.email || undefined })
  const charging = Boolean(body.chargeOnCreate) && status === 'completada'
  const now = iso()
  const b = {
    id: ++st.seq.booking, date: body.date, time, barberId: BRUNO_ID, clientId: client.id, serviceId: svc?.id ?? null,
    customService, customPrice: price, priceSnapshot: null, status: charging ? 'en curso' : status,
    paidAmount: null, paymentMethod: null, paymentRef: null, paidAt: null, completedAt: null,
    startedAt: charging || status === 'en curso' ? now : null, autoCompleted: false, noShow: false, freeCut: false,
    redeemState: null, reminder60Sent: false, createdAt: now, updatedAt: now,
  }
  if (b.status === 'completada') {
    b.completedAt = now
    b.priceSnapshot = h.effectivePrice(b)
    if (h.effectivePrice(b) === 0) Object.assign(b, { paidAmount: 0, paymentMethod: 'cortesia', paidAt: now })
    if (svc?.loyaltyEligible !== false) client.stars += 1
  }
  st.bookings.push(b)
  const notice = charging ? 'Quedó en curso: cóbrala para completarla.' : mailNotice
  return OK({ booking: h.bookingRow(b), ...(notice ? { notice } : {}), ...(charging ? { charging: true } : {}) })
}

function createPublicBooking(c) {
  const { st, body, h } = c
  const { phone, barberId, serviceId, date, idempotencyKey } = body
  const time = String(body.time || '').slice(0, 5)
  if (!phone || !barberId || !serviceId || !date || !time) return [400, { error: 'Datos incompletos' }]
  if (idempotencyKey && st.idempotency?.[idempotencyKey]) {
    const prev = st.bookings.find((b) => b.id === st.idempotency[idempotencyKey])
    if (prev) return OK({ booking: h.bookingRow(prev) })
  }
  const svc = h.svcOf(serviceId)
  if (!svc || !svc.active) return [400, { error: 'Servicio no disponible' }]
  if (!isRealDate(date) || !ALL_SLOTS.includes(time)) return [400, { error: 'Fecha u hora inválida' }]
  if (svc.onlyOnDate && date !== svc.onlyOnDate) return [422, { error: `Este servicio solo se agenda el ${ddmmyyyy(svc.onlyOnDate)}.` }]
  if (date < h.today || (!svc.onlyOnDate && date > addDays(h.today, MAX_LEAD_DAYS))) return [400, { error: 'Esa fecha está fuera de la ventana de reservas.' }]
  if (date === h.today && slotMinutes(time) < nowMinutes() + MIN_LEAD_MINUTES) return [400, { error: 'Ese horario ya no se puede reservar.' }]
  const bad = checkSlot(c, { date, time, serviceMin: svc.min })
  if (bad) return [409, { error: 'Ese horario ya no está disponible. Elige otro.' }]
  const { client } = upsertClient(st, { name: body.name || h.clientByPhone(phone)?.name || 'Cliente web', phone })
  const now = iso()
  const b = {
    id: ++st.seq.booking, date, time, barberId: Number(barberId), clientId: client.id, serviceId: svc.id,
    customService: null, customPrice: null, priceSnapshot: null, status: 'confirmada',
    paidAmount: null, paymentMethod: null, paymentRef: null, paidAt: null, completedAt: null, startedAt: null,
    autoCompleted: false, noShow: false, freeCut: false, redeemState: null, reminder60Sent: false, createdAt: now, updatedAt: now,
  }
  st.bookings.push(b)
  if (idempotencyKey) (st.idempotency ||= {})[idempotencyKey] = b.id
  st.notifications.unshift({ id: Date.now(), title: 'Nueva reserva', body: `${client.name} · ${svc.name} · ${date} ${time}`, url: `/panel?tab=reservas&date=${date}&bookingId=${b.id}`, tag: 'booking', createdAt: now })
  return OK({ booking: { id: b.id, date, time, barberId: b.barberId, service: svc.name, price: svc.price, status: b.status } })
}

function patchBooking(c) {
  const { st, body, h } = c
  const s = needSession(c); if (s) return s
  const b = st.bookings.find((x) => x.id === Number(body.id))
  if (!b) return E(404, 'Reserva no encontrada')
  const client = h.clientOf(b.clientId)
  const now = iso()

  if (body.redeem !== undefined) {
    if (body.redeem !== 'free_cut') return E(400, 'Canje inválido.')
    if (b.freeCut) return E(409, 'Esta reserva ya usó el corte gratis.')
    if (!client || client.stars < LOYALTY_GOAL) return E(409, 'El cliente todavía no tiene el corte gratis.')
    client.stars -= LOYALTY_GOAL
    Object.assign(b, { customPrice: 0, freeCut: true, redeemState: 'redeemed', updatedAt: now })
    return OK({ price: 0, loyalty: h.loyaltyOf(client) })
  }

  // Reagendar (fecha, hora o servicio).
  if (body.date !== undefined || body.time !== undefined || body.serviceId !== undefined) {
    const date = body.date ?? b.date
    const time = String(body.time ?? b.time).slice(0, 5)
    const svc = body.serviceId !== undefined ? h.svcOf(body.serviceId) : h.svcOf(b.serviceId)
    if (body.serviceId !== undefined && !svc) return E(400, 'Ese servicio no existe.')
    if (!isRealDate(date)) return E(400, 'Fecha inválida.')
    if (!ALL_SLOTS.includes(time)) return E(400, 'Hora inválida.')
    const bad = checkSlot(c, { date, time, serviceMin: svc?.min || 60, excludeId: b.id })
    if (bad) return bad
    if (date !== b.date || time !== b.time) b.reminder60Sent = false
    Object.assign(b, { date, time, serviceId: svc ? svc.id : b.serviceId, updatedAt: now })
    if (body.serviceId !== undefined && svc) b.customService = null
  }

  if (body.price !== undefined) {
    if (!c.session.admin) return E(403, 'Solo el administrador puede editar el precio.')
    const n = int(body.price)
    if (!isMoney(n)) return E(400, 'Precio inválido.')
    if (b.redeemState === 'redeemed' && n > 0) return E(409, 'Este corte se canjeó gratis: no se le puede poner precio.')
    b.customPrice = n
    if (b.status === 'completada') b.priceSnapshot = n
    b.updatedAt = now
  }

  let loyalty = null
  if (body.status !== undefined) {
    const to = body.status
    const from = b.status
    if (!STATUSES.includes(to)) return E(400, 'Estado inválido.')
    let payment = null
    if (body.paymentMethod != null || body.paidAmount != null) {
      if (!PAYMENT_METHODS.includes(body.paymentMethod)) return E(400, 'Medio de pago inválido.')
      const amount = int(body.paidAmount)
      if (!isMoney(amount)) return E(400, 'Monto inválido.')
      payment = { paidAmount: amount, paymentMethod: body.paymentMethod, paymentRef: body.paymentRef ? String(body.paymentRef).trim().slice(0, 60) : null }
    }
    if (to === 'completada') {
      if (from !== 'completada') {
        b.completedAt = now
        b.priceSnapshot = b.customPrice ?? h.svcOf(b.serviceId)?.price ?? 0
      }
      if (payment) Object.assign(b, payment, { paidAt: now })
      else if (from !== 'completada' && h.effectivePrice(b) === 0) Object.assign(b, { paidAmount: 0, paymentMethod: 'cortesia', paymentRef: null, paidAt: now })
    } else if (from === 'completada') {
      Object.assign(b, { completedAt: null, paidAt: null, paidAmount: null, paymentMethod: null, paymentRef: null, autoCompleted: false })
    }
    if (to === 'en curso' && !b.startedAt) b.startedAt = now
    b.noShow = to === 'cancelada' && body.noShow === true ? true : (to === 'cancelada' ? b.noShow : false)
    b.status = to
    b.updatedAt = now
    const eligible = h.svcOf(b.serviceId)?.loyaltyEligible !== false
    if (client && eligible) {
      if (from !== 'completada' && to === 'completada') { client.stars += 1; loyalty = h.loyaltyOf(client, true) }
      else if (from === 'completada' && to !== 'completada') { client.stars = Math.max(0, client.stars - 1); loyalty = h.loyaltyOf(client, false) }
      else if (to === 'completada') loyalty = h.loyaltyOf(client, false)
    }
  }

  const row = h.bookingRow(b)
  return OK({
    booking: {
      id: row.id, date: row.date, time: row.time, barberId: row.barberId, status: row.status, notionPageId: null,
      client: row.client, phone: row.phone, service: row.service, price: row.price, paidAmount: row.paidAmount,
      paymentMethod: row.paymentMethod, paymentRef: row.paymentRef, noShow: row.noShow, paymentPending: row.paymentPending,
    },
    loyalty,
  })
}

function createSale(c) {
  const { st, body, h } = c
  const a = needAdmin(c); if (a) return a
  const items = Array.isArray(body.items) ? body.items : []
  if (!items.length) return E(400, 'La venta no tiene productos.')
  if (!PAYMENT_METHODS.includes(body.paymentMethod)) return E(400, 'Medio de pago inválido.')
  const booking = body.bookingId ? st.bookings.find((b) => b.id === Number(body.bookingId)) : null
  if (body.bookingId && !booking) return E(404, 'Reserva no encontrada')
  const clientId = booking?.clientId ?? (body.clientId ? Number(body.clientId) : null)
  const client = clientId ? h.clientOf(clientId) : null
  const pct = body.applyLoyaltyDiscount ? DISCOUNT_PCT : 0
  if (pct && (!client || client.stars < DISCOUNT_STARS)) return E(409, 'El cliente todavía no tiene el 30% (necesita 5 estrellas).')
  const lines = []
  for (const it of items) {
    const p = st.products.find((x) => x.id === Number(it.productId) && !x.archivedAt)
    const qty = int(it.qty)
    if (!p) return E(400, 'Uno de los productos ya no existe.')
    if (!Number.isInteger(qty) || qty < 1) return E(400, 'Cantidad inválida.')
    if (p.stock < qty) return E(409, `Sin stock suficiente: ${p.name} (quedan ${p.stock}).`)
    const unitCollected = Math.round(p.price * (100 - pct) / 100)
    lines.push({ productId: p.id, name: p.name, qty, unitPrice: p.price, unitCollected, lineTotal: unitCollected * qty })
  }
  const sale = {
    id: ++st.seq.sale, date: h.today, bookingId: booking?.id ?? null, clientId, paymentMethod: body.paymentMethod,
    paymentRef: body.paymentRef ? String(body.paymentRef).trim().slice(0, 60) : null, status: 'pagada', discountPct: pct,
    items: lines, total: lines.reduce((s, l) => s + l.lineTotal, 0), createdAt: iso(),
  }
  for (const l of lines) {
    const p = st.products.find((x) => x.id === l.productId)
    p.stock -= l.qty
    st.moves.push({ id: ++st.seq.move, productId: p.id, date: h.today, kind: 'venta', delta: -l.qty, reason: 'Venta en mesón', unitCost: null, saleId: sale.id, shopOrderId: null, createdAt: iso() })
  }
  st.sales.push(sale)
  return OK({ sale: { id: sale.id, bookingId: sale.bookingId, date: sale.date, total: sale.total, paymentMethod: sale.paymentMethod, paymentRef: sale.paymentRef, discountPct: pct, items: lines } })
}

function voidSale(c) {
  const { st, q, h } = c
  const a = needAdmin(c); if (a) return a
  const sale = st.sales.find((s) => s.id === Number(q.saleId))
  if (!sale) return E(404, 'Venta no encontrada')
  if (sale.status === 'anulada') return E(409, 'Esa venta ya estaba anulada.')
  sale.status = 'anulada'
  for (const l of sale.items) {
    const p = st.products.find((x) => x.id === l.productId)
    if (p) p.stock += l.qty
    st.moves.push({ id: ++st.seq.move, productId: l.productId, date: h.today, kind: 'devolucion', delta: l.qty, reason: `Anulación de la venta #${sale.id}`, unitCost: null, saleId: sale.id, shopOrderId: null, createdAt: iso() })
  }
  return OK({ sale: { id: sale.id, status: 'anulada' } })
}

function availabilityApi(c) {
  const { st, method, q, body, h } = c
  if (method === 'GET') {
    const date = q.date
    if (!q.barberId || !DATE_RE.test(String(date || ''))) return [400, { error: 'barberId y date requeridos' }]
    const exclude = q.excludeBookingId ? Number(q.excludeBookingId) : null
    const booked = h.bookedSlots(date, exclude)
    const blocked = h.blockedSlots(date)
    const minMinutes = date === h.today ? nowMinutes() + MIN_LEAD_MINUTES : (date < h.today ? Infinity : -1)
    const svc = q.serviceId ? h.svcOf(q.serviceId) : null
    const slots = ALL_SLOTS.map((slot) => {
      const state = booked.has(slot) ? 'booked' : blocked.has(slot) ? 'blocked' : slotMinutes(slot) < minMinutes ? 'past' : 'free'
      let available = state === 'free'
      if (available && svc) {
        const span = h.spanFor(slot, svc.min)
        available = Boolean(span) && span.every((s) => !booked.has(s) && !blocked.has(s))
      }
      return { slot, available, state }
    })
    return OK({ slots })
  }
  const s = needSession(c); if (s) return s
  const slot = String(body.slot || '').slice(0, 5)
  if (!body.date || !slot) return E(400, 'Datos incompletos')
  if (Number(body.barberId) !== BRUNO_ID) return E(403, 'No autorizado')
  const key = `${body.date}|${slot}`
  if (method === 'POST') { st.blocks.add(key); return OK({ block: { barberId: BRUNO_ID, date: body.date, slot, reason: body.reason || null } }) }
  if (method === 'DELETE') { st.blocks.delete(key); return OK() }
  return [405, { error: 'Method not allowed' }]
}

function productOut(p, { admin = false } = {}) {
  const base = { id: p.id, name: p.name, brand: p.brand || '', description: p.description || '', price: p.price, oldPrice: p.oldPrice ?? null, stock: p.stock, active: p.active, sortOrder: p.sortOrder, imgFront: p.imgFront, imgBack: p.imgBack, imgDetail: p.imgDetail }
  return admin ? { ...base, sku: p.sku || null, cost: p.cost ?? null, archived: Boolean(p.archivedAt) } : base
}

function servicesApi(c) {
  const { st, method, q, body, h } = c
  if (q.scope === 'shop') return shopApi(c)
  if (q.scope === 'inventory') return inventoryApi(c)
  if (method === 'GET') {
    if (q.includeInactive === 'true') {
      const s = needSession(c); if (s) return s
      return OK({ services: st.services })
    }
    const list = st.services.filter((s) => s.active && (!s.onlyOnDate || (q.includeSingleDay === '1' && s.onlyOnDate >= h.today)))
    return OK({ services: list.map(({ loyaltyEligible, ...rest }) => rest) })
  }
  const a = needSession(c); if (a) return a
  const pick = (src) => {
    const out = {}
    for (const k of ['name', 'price', 'min', 'cat', 'desc', 'tne', 'active', 'featured', 'onlyOnDate', 'loyaltyEligible']) {
      if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = k === 'price' || k === 'min' ? Number(src[k]) : src[k]
    }
    if (out.onlyOnDate !== undefined && out.onlyOnDate !== null && !isRealDate(out.onlyOnDate)) return null
    return out
  }
  if (method === 'POST') {
    const data = pick(body)
    if (!data || !data.name || !data.price || !data.min) return E(400, 'Datos incompletos')
    const service = { id: ++st.seq.service, cat: 'general', desc: '', tne: false, active: true, featured: false, onlyOnDate: null, loyaltyEligible: true, ...data }
    st.services.push(service)
    return OK({ service })
  }
  if (method === 'PATCH') {
    const service = st.services.find((s) => s.id === Number(body.id))
    if (!service) return E(400, 'id requerido')
    const data = pick(body)
    if (!data) return E(400, 'Fecha inválida para el día único.')
    Object.assign(service, data)
    return OK({ service })
  }
  if (method === 'DELETE') {
    if (!q.id) return E(400, 'id requerido')
    st.services = st.services.filter((s) => s.id !== Number(q.id))
    return OK()
  }
  return [405, { error: 'Method not allowed' }]
}

function shopApi(c) {
  const { st, method, q, body, h } = c
  const hasHistory = (id) => st.moves.some((m) => m.productId === id && m.kind !== 'inicial') || st.sales.some((s) => s.items.some((i) => i.productId === id))
  if (method === 'GET') {
    if (q.for === 'venta') {
      const s = needSession(c); if (s) return s
      return OK({ products: st.products.filter((p) => p.active && !p.archivedAt && p.stock > 0).map((p) => ({ id: p.id, name: p.name, price: p.price, stock: p.stock, photo: p.imgFront || null })) })
    }
    if (q.includeInactive === 'true') {
      const s = needSession(c); if (s) return s
      return OK({ products: st.products.filter((p) => q.includeArchived === '1' || !p.archivedAt).map((p) => productOut(p, { admin: true })) })
    }
    return OK({ products: st.products.filter((p) => p.active && !p.archivedAt && p.stock > 0).map((p) => productOut(p)), checkoutEnabled: true })
  }
  const a = needAdmin(c); if (a) return a
  if (method === 'POST' && q.upload === '1') {
    const p = st.products.find((x) => x.id === Number(body.id))
    const field = { front: 'imgFront', back: 'imgBack', detail: 'imgDetail' }[body.slot]
    if (!p || !field || !body.dataUrl) return E(400, 'Datos incompletos')
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(String(body.dataUrl))) return E(400, 'Formato de imagen no soportado')
    p[field] = body.dataUrl // la imagen queda solo en memoria (dura hasta reiniciar)
    return OK({ url: body.dataUrl, product: productOut(p, { admin: true }) })
  }
  const fields = (src) => {
    const out = {}
    for (const k of ['name', 'brand', 'description', 'price', 'oldPrice', 'stock', 'active', 'sortOrder', 'sku', 'cost']) {
      if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = ['price', 'oldPrice', 'stock', 'sortOrder', 'cost'].includes(k) ? (src[k] === null || src[k] === '' ? null : Number(src[k])) : src[k]
    }
    return out
  }
  if (method === 'POST') {
    const data = fields(body)
    if (!String(data.name || '').trim() || !data.price) return E(400, 'Datos incompletos')
    const p = { id: ++st.seq.product, brand: '', description: '', oldPrice: null, stock: 0, active: true, sortOrder: st.products.length, imgFront: null, imgBack: null, imgDetail: null, sku: null, cost: null, archivedAt: null, ...data }
    p.stock = Math.max(0, Number(p.stock) || 0)
    st.products.push(p)
    if (p.stock > 0) st.moves.push({ id: ++st.seq.move, productId: p.id, date: h.today, kind: 'inicial', delta: p.stock, reason: 'Stock inicial', unitCost: p.cost ?? null, saleId: null, shopOrderId: null, createdAt: iso() })
    return OK({ product: productOut(p, { admin: true }) })
  }
  if (method === 'PATCH') {
    const p = st.products.find((x) => x.id === Number(body.id))
    if (!p) return E(400, 'id requerido')
    const data = fields(body)
    if (data.stock != null && data.stock !== p.stock) {
      if (data.stock < 0) return E(400, 'El stock no puede ser negativo.')
      st.moves.push({ id: ++st.seq.move, productId: p.id, date: h.today, kind: 'ajuste', delta: data.stock - p.stock, reason: 'Ajuste desde la ficha', unitCost: null, saleId: null, shopOrderId: null, createdAt: iso() })
    }
    Object.assign(p, data)
    return OK({ product: productOut(p, { admin: true }) })
  }
  if (method === 'DELETE') {
    const p = st.products.find((x) => x.id === Number(q.id))
    if (!p) return E(400, 'id requerido')
    if (hasHistory(p.id)) { p.archivedAt = iso(); p.active = false; return OK({ archived: true }) }
    st.products = st.products.filter((x) => x !== p)
    st.moves = st.moves.filter((m) => m.productId !== p.id)
    return OK({ archived: false })
  }
  return [405, { error: 'Method not allowed' }]
}

function inventoryApi(c) {
  const { st, method, q, body, h } = c
  const a = needAdmin(c); if (a) return a
  const ledger = (id) => st.moves.filter((m) => m.productId === id).reduce((n, m) => n + m.delta, 0)
  const itemOf = (p) => {
    const own = st.moves.filter((m) => m.productId === p.id)
    const ledgerStock = ledger(p.id)
    return {
      id: p.id, name: p.name, sku: p.sku || null, stock: p.stock, ledgerStock, drift: p.stock - ledgerStock,
      cost: p.cost ?? null, value: p.cost ? p.cost * Math.max(0, p.stock) : 0, active: p.active, archived: Boolean(p.archivedAt),
      lastMoveAt: own.map((m) => m.createdAt).sort().pop() || null, oversold: p.stock < 0,
    }
  }
  if (method === 'GET') {
    if (q.productId) {
      const p = st.products.find((x) => x.id === Number(q.productId))
      if (!p) return E(404, 'Producto no encontrado')
      let balance = 0
      const moves = st.moves.filter((m) => m.productId === p.id).sort((x, y) => x.createdAt.localeCompare(y.createdAt) || x.id - y.id)
        .map((m) => { balance += m.delta; return { id: m.id, date: m.date, kind: m.kind, delta: m.delta, reason: m.reason, unitCost: m.unitCost, balance } })
        .reverse()
      return OK({ product: { ...productOut(p, { admin: true }), ...itemOf(p) }, moves })
    }
    const items = st.products.filter((p) => q.includeArchived === '1' || !p.archivedAt).map(itemOf)
    return OK({
      items,
      totals: {
        units: items.reduce((n, i) => n + Math.max(0, i.stock), 0), value: items.reduce((n, i) => n + i.value, 0),
        outOfStock: items.filter((i) => i.stock <= 0).length, oversold: items.filter((i) => i.oversold).length,
        withoutCost: items.filter((i) => i.cost == null).length,
      },
    })
  }
  if (method === 'POST') {
    const p = st.products.find((x) => x.id === Number(body.productId))
    if (!p) return E(404, 'Producto no encontrado')
    if (body.action === 'reconcile') {
      const drift = p.stock - ledger(p.id)
      if (!drift) return E(409, 'El stock ya cuadra con los movimientos.')
      const move = { id: ++st.seq.move, productId: p.id, date: h.today, kind: 'ajuste', delta: drift, reason: 'Cuadre con el stock actual', unitCost: null, saleId: null, shopOrderId: null, createdAt: iso() }
      st.moves.push(move)
      return OK({ move })
    }
    const kinds = { compra: 1, devolucion: 1, merma: -1, ajuste: 1 }
    if (!(body.kind in kinds)) return E(400, 'Tipo de movimiento inválido.')
    const qty = int(body.qty)
    if (!Number.isInteger(qty) || qty === 0 || (body.kind !== 'ajuste' && qty < 0)) return E(400, 'Cantidad inválida.')
    if (!String(body.reason || '').trim() && body.kind !== 'compra') return E(400, 'Escribe el motivo.')
    const delta = kinds[body.kind] * qty
    if (p.stock + delta < 0) return E(409, `El stock quedaría negativo (hay ${p.stock}).`)
    const unitCost = body.unitCost === undefined || body.unitCost === null || body.unitCost === '' ? null : int(body.unitCost)
    if (unitCost !== null && !isMoney(unitCost)) return E(400, 'Costo inválido.')
    p.stock += delta
    if (body.kind === 'compra' && unitCost != null) p.cost = unitCost
    const move = { id: ++st.seq.move, productId: p.id, date: h.today, kind: body.kind, delta, reason: String(body.reason || 'Compra').trim().slice(0, 200), unitCost, saleId: null, shopOrderId: null, createdAt: iso() }
    st.moves.push(move)
    return OK({ move, stock: p.stock })
  }
  return [405, { error: 'Method not allowed' }]
}

function walletStatsOf(st, h) {
  const cs = st.clients
  const installed = cs.filter((c) => c.walletHasPass)
  const passesIssued = installed.length + 4
  const byStars = Array.from({ length: LOYALTY_GOAL + 1 }, (_, i) => cs.filter((c) => Math.min(c.stars, LOYALTY_GOAL) === i).length)
  const withStars = cs.filter((c) => c.stars > 0)
  const recent = new Set(st.bookings.filter((b) => b.status !== 'cancelada' && b.date >= addDays(h.today, -30) && b.date <= h.today).map((b) => b.clientId))
  const audienceCounts = {
    all: installed.length,
    brunetti: installed.length,
    pimp: 3,
    free_cut_ready: installed.filter((c) => c.stars >= LOYALTY_GOAL).length,
    almost_free: installed.filter((c) => c.stars >= 7 && c.stars <= 9).length,
    five_plus: installed.filter((c) => c.stars >= DISCOUNT_STARS).length,
    starters: installed.filter((c) => c.stars <= 1).length,
    active: installed.filter((c) => recent.has(c.id)).length,
  }
  const month = h.today.slice(0, 7)
  return {
    passesIssued, installed: installed.length, installRate: Math.round((installed.length / passesIssued) * 100),
    appleInstalled: Math.ceil(installed.length * 0.6), googleInstalled: Math.floor(installed.length * 0.4),
    withFiveOrMore: cs.filter((c) => c.stars >= DISCOUNT_STARS).length, freeCutReady: cs.filter((c) => c.stars >= LOYALTY_GOAL).length,
    freeCutsRedeemed: st.bookings.filter((b) => b.freeCut).length + 2,
    starsThisMonth: st.bookings.filter((b) => b.status === 'completada' && b.date.startsWith(month)).length,
    starsAllTime: cs.reduce((n, c) => n + c.stars, 0) + 180,
    campaignsThisMonth: st.campaigns.filter((x) => String(x.createdAt).startsWith(month)).length, campaignsSent: st.campaigns.length,
    avgStars: withStars.length ? Math.round((withStars.reduce((n, c) => n + c.stars, 0) / withStars.length) * 10) / 10 : 0,
    clientsWithStars: withStars.length, byStars, audienceCounts, sendAudienceCounts: audienceCounts,
  }
}

function clientsApi(c) {
  const { st, method, q, body, h } = c
  const mode = q.mode
  if (mode && mode.startsWith('bridge-')) return E(404, 'No encontrado')
  if (method === 'GET' && (mode === 'wallet-pass' || mode === 'wallet-pass-google')) return E(502, 'El pase de Wallet no está disponible en el mock de desarrollo.')
  if (method === 'GET' && mode === 'wallet-tarjeta-info') {
    const id = st.shareTokens?.[String(q.t || '')]
    const client = id ? h.clientOf(id) : null
    return client ? OK({ name: client.name }) : E(404, 'Link inválido o vencido')
  }
  if (method === 'GET' && mode === 'wallet-status') {
    const client = h.clientByPhone(q.phone)
    if (cleanPhone(q.phone).length !== 9) return E(400, 'Telefono invalido')
    return OK({ hasPass: Boolean(client?.walletHasPass), loyalty: client ? h.loyaltyOf(client) : null })
  }
  if (method === 'POST' && mode === 'register') {
    const phone = cleanPhone(body.phone)
    if (!String(body.name || '').trim() || phone.length !== 9 || !EMAIL_RE.test(String(body.email || ''))) return E(400, 'Datos incompletos o inválidos')
    return OK({ saved: true, pathname: `clientes/${phone}-mock.json` })
  }
  if (mode) {
    const s = needSession(c); if (s) return s
    if (mode === 'wallet-share-link') {
      const client = h.clientByPhone(q.phone)
      if (cleanPhone(q.phone).length !== 9) return E(400, 'Telefono invalido')
      if (!client) return E(404, 'Cliente no registrado')
      const token = `mk${client.id.toString(36)}${Math.random().toString(36).slice(2, 10)}`
      ;(st.shareTokens ||= {})[token] = client.id
      return OK({ url: `http://${c.host}/tarjeta?t=${token}`, name: client.name })
    }
    if (mode === 'wallet-stats') return OK({ stats: walletStatsOf(st, h) })
    if (mode === 'wallet-campaigns') return OK({ campaigns: st.campaigns })
    if (method === 'POST' && mode === 'wallet-campaign') {
      const message = String(body.message || '').trim()
      if (!message) return E(400, 'Escribe el mensaje.')
      if (message.length > 180) return E(400, 'El mensaje es muy largo (máx. 180).')
      const recipients = walletStatsOf(st, h).audienceCounts[body.audience] ?? walletStatsOf(st, h).audienceCounts.all
      const campaign = { id: ++st.seq.campaign, message, audience: body.audience || 'all', recipientCount: recipients, source: 'brunetti', createdAt: iso() }
      st.campaigns.unshift(campaign)
      return OK({ recipients, applePushed: Math.ceil(recipients * 0.6), googleSent: Math.floor(recipients * 0.4), campaign })
    }
    if (method === 'POST' && mode === 'wallet-send-cards') {
      const limit = Math.min(Math.max(Number(body.limit) || 5, 1), 8)
      st.cardsSent ||= new Set()
      if (body.testEmail) {
        if (!body.onlyPhone || !EMAIL_RE.test(String(body.testEmail))) return E(400, 'Para la prueba hace falta un teléfono y un correo válido')
        return OK({ sent: 1, failed: 0, remaining: 0, done: true, errors: [] })
      }
      const pending = st.clients.filter((x) => x.email && (body.includeInstalled || !x.walletHasPass) && (body.again || !st.cardsSent.has(x.id)) && (!body.onlyPhone || x.phone === cleanPhone(body.onlyPhone)))
      const batch = pending.slice(0, limit)
      batch.forEach((x) => st.cardsSent.add(x.id))
      const remaining = pending.length - batch.length
      return OK({ sent: batch.length, failed: 0, remaining, done: remaining === 0, errors: [] })
    }
    return E(404, 'Modo no reconocido')
  }
  if (method === 'GET') {
    if (q.phone) {
      const client = h.clientByPhone(q.phone)
      if (!client) return E(404, 'Cliente no registrado')
      const row = h.clientRow(client)
      return OK({ client: { id: row.id, name: row.name, phone: row.phone, visits: row.visits, totalSpent: row.totalSpent, lastVisit: row.lastVisit, status: row.status, loyalty: row.loyalty, walletHasPass: row.walletHasPass } })
    }
    const s = needSession(c); if (s) return s
    const f = failing(c, 'clients'); if (f) return f
    const rows = st.clients.map(h.clientRow).sort((x, y) => String(y.lastVisit || y.createdAt || '').localeCompare(String(x.lastVisit || x.createdAt || '')) || y.id - x.id)
    return OK({ clients: rows })
  }
  const s = needSession(c); if (s) return s
  if (method === 'POST') {
    const phone = cleanPhone(body.phone)
    if (phone.length !== 9) return E(400, 'El teléfono debe tener 9 dígitos.')
    const exists = h.clientByPhone(phone)
    if (!exists && !String(body.name || '').trim()) return E(400, 'Falta el nombre del cliente.')
    const { client, notice } = upsertClient(st, { name: body.name, phone, email: body.email === undefined ? undefined : body.email, profession: body.profession })
    return OK({ client: h.clientRow(client), ...(notice ? { notice } : {}) })
  }
  if (method === 'DELETE') {
    const phone = cleanPhone(q.phone)
    const client = h.clientByPhone(phone)
    if (client) {
      st.bookings = st.bookings.filter((b) => b.clientId !== client.id)
      st.clients = st.clients.filter((x) => x !== client)
    }
    return OK()
  }
  return E(405, 'Method not allowed')
}

const SETTINGS_WHITELIST = {
  notif: ['reserva', 'cancelacion', 'recordatorio', 'marketing'],
  whatsapp: ['activo', 'recordatorio24h', 'recordatorio2h', 'confirmacion'],
  horario: ['apertura', 'cierre', 'anticipacion', 'ventana', 'domingo', 'cancelacion'],
}
const BUDGET_CATEGORIES = ['Insumos', 'Equipamiento', 'Arriendo', 'Marketing', 'Personal', 'Servicios', 'Otros']

function barbersApi(c) {
  const { st, method, q, body, h } = c
  const barber = st.barbers[0]
  const mode = q.mode
  if (mode === 'review') {
    const t = String(q.t || body.t || '')
    const r = /^[0-9a-f]{32}$/.test(t) ? st.reviews.find((x) => x.token === t) : null
    if (!r) return E(404, 'Link inválido o vencido')
    const b = st.bookings.find((x) => x.id === r.bookingId)
    const row = b ? h.bookingRow(b) : null
    if (method === 'GET') {
      const shortBarber = { name: barber.name, short: barber.short, photo: null }
      return OK({
        review: { barber: shortBarber, service: row?.service || 'Servicio', date: row?.date || h.today, clientFirstName: (row?.client || 'Cliente').split(' ')[0], rating: r.rating, comment: r.comment, rated: r.rating != null, expired: false },
        barber: shortBarber, booking: { service: row?.service || 'Servicio', date: row?.date || h.today },
      })
    }
    if (method === 'POST') {
      const rating = Number(body.rating)
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) return E(400, 'Elige de 1 a 5 estrellas.')
      Object.assign(r, { rating, comment: String(body.comment || '').trim().slice(0, 600) || null, ratedAt: iso() })
      return OK()
    }
    return E(405, 'Method not allowed')
  }
  const s = needSession(c); if (s) return s
  if (mode === 'me') {
    if (method !== 'PATCH') return E(405, 'Method not allowed')
    const name = String(body.name || '').trim()
    if (!name || name.length > 80) return E(400, 'Escribe un nombre de hasta 80 caracteres.')
    barber.name = name
    barber.short = name.split(' ')[0]
    return OK({ barber: { id: barber.id, name: barber.name, short: barber.short, code: barber.code, role: barber.role, tier: barber.tier, admin: true } })
  }
  if (mode === 'settings') {
    const current = st.settings.barber[barber.id] ||= { notif: {}, whatsapp: {}, horario: {} }
    if (method === 'PATCH') {
      for (const [group, keys] of Object.entries(SETTINGS_WHITELIST)) {
        const incoming = body[group]
        if (!incoming || typeof incoming !== 'object') continue
        for (const k of keys) {
          if (!(k in incoming)) continue
          const v = incoming[k]
          if (group === 'horario') { if (typeof v === 'string' && v.length <= 20) current[group][k] = v }
          else if (typeof v === 'boolean') current[group][k] = v
        }
      }
    } else if (method !== 'GET') return E(405, 'Method not allowed')
    return OK({ settings: current })
  }
  if (mode === 'shop-settings') {
    const a = needAdmin(c); if (a) return a
    const set = st.settings
    if (method === 'PATCH') {
      let touched = false
      if (body.business && typeof body.business === 'object') {
        for (const k of ['name', 'address', 'phone']) if (typeof body.business[k] === 'string') { set.business[k] = body.business[k].slice(0, 120); touched = true }
      }
      if (body.budgets && typeof body.budgets === 'object') {
        for (const k of BUDGET_CATEGORIES) {
          if (!(k in body.budgets)) continue
          const v = body.budgets[k]
          if (v === null) delete set.budgets[k]
          else if (Number.isInteger(Number(v)) && Number(v) > 0) set.budgets[k] = Number(v)
          touched = true
        }
      }
      if (body.autoComplete !== undefined) {
        if (typeof body.autoComplete !== 'boolean') return E(400, 'autoComplete tiene que ser verdadero o falso.')
        set.autoComplete = body.autoComplete
        touched = true
      }
      if (!touched) return E(400, 'Nada que actualizar')
    } else if (method !== 'GET') return E(405, 'Method not allowed')
    const out = { business: set.business, budgets: set.budgets, autoComplete: set.autoComplete }
    return OK({ ...out, settings: out })
  }
  if (mode === 'reviews') {
    const rated = st.reviews.filter((r) => r.rating != null).sort((x, y) => String(y.ratedAt).localeCompare(String(x.ratedAt)))
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    rated.forEach((r) => { distribution[r.rating] += 1 })
    const avg = rated.length ? Math.round((rated.reduce((n, r) => n + r.rating, 0) / rated.length) * 10) / 10 : null
    return OK({
      summary: { avg, count: rated.length, distribution },
      reviews: rated.slice(0, 30).map((r) => {
        const b = st.bookings.find((x) => x.id === r.bookingId)
        const row = b ? h.bookingRow(b) : null
        return { id: r.id, rating: r.rating, comment: r.comment || null, client: row?.client || 'Cliente', service: row?.service || null, date: row?.date || null, ratedAt: r.ratedAt, barberId: barber.id, barber: barber.name }
      }),
    })
  }
  if (mode) return E(404, 'Modo no reconocido')
  if (method === 'GET') return OK({ barbers: st.barbers })
  const a = needAdmin(c); if (a) return a
  if (method === 'POST' || method === 'PATCH') return OK({ barber: { ...barber, ...body, id: barber.id } })
  if (method === 'DELETE') return E(409, 'En el mock no se puede borrar al único barbero.')
  return E(405, 'Method not allowed')
}

function expensesApi(c) {
  const { st, method, q, body } = c
  const a = needAdmin(c); if (a) return a
  const f = failing(c, 'expenses'); if (f) return f
  const KINDS = ['gasto', 'ingreso']
  if (method === 'GET') {
    const kind = q.kind ? String(q.kind) : 'gasto'
    if (kind !== 'all' && !KINDS.includes(kind)) return E(400, 'kind inválido')
    const rows = st.expenses.filter((e) => kind === 'all' || e.kind === kind).sort((x, y) => y.date.localeCompare(x.date) || y.id - x.id)
    return OK({ expenses: rows })
  }
  const kindOf = (v, fallback) => {
    if (v === undefined || v === null || v === '') return fallback
    const k = String(v).trim().toLowerCase()
    return KINDS.includes(k) ? k : null
  }
  if (method === 'POST') {
    const kind = kindOf(body.kind, 'gasto')
    if (!kind) return E(400, 'kind inválido')
    const amount = int(body.amount)
    if (!body.date || !body.category || !isMoney(amount)) return E(400, 'Datos incompletos')
    const expense = { id: ++st.seq.expense, date: body.date, category: body.category, detail: body.detail || '', amount, owner: body.owner || 'Brunetti', kind }
    st.expenses.unshift(expense)
    return OK({ expense })
  }
  if (method === 'PATCH') {
    const e = st.expenses.find((x) => x.id === Number(body.id))
    if (!e) return E(404, 'Movimiento no encontrado')
    const kind = kindOf(body.kind, e.kind)
    if (!kind) return E(400, 'kind inválido')
    for (const k of ['date', 'category', 'detail', 'owner']) if (body[k] !== undefined) e[k] = body[k]
    if (body.amount !== undefined) e.amount = Number(body.amount) || 0
    e.kind = kind
    return OK({ expense: e })
  }
  if (method === 'DELETE') {
    st.expenses = st.expenses.filter((x) => x.id !== Number(q.id))
    return OK()
  }
  return E(405, 'Method not allowed')
}

function pushApi(c) {
  const { st, method, q, body, h } = c
  if (method === 'GET' && q.job === 'reminders') return OK({ sent60: 0, autoCompleted: autoComplete(st, h) })
  const s = needSession(c); if (s) return s
  if (method === 'GET') return OK({ notifications: st.notifications.slice(0, 5) })
  if (method === 'POST' && body.action === 'test') {
    st.notifications.unshift({ id: Date.now(), title: 'Notificación de prueba', body: 'Si ves esto, las notificaciones del panel funcionan.', url: '/panel?tab=config', tag: 'test', createdAt: iso() })
    return OK({ sent: 1 })
  }
  if (method === 'POST' || method === 'DELETE') return OK()
  return E(405, 'Method not allowed')
}

function onlineOrders(st) {
  const fromEnrollments = st.enrollments
    .filter((e) => String(e.message || '').startsWith('Pago MercadoPago'))
    .map((e) => ({ id: e.id, type: e.source, name: e.name, phone: e.phone, email: e.email, amount: Number(e.amount || 0), detail: e.edition || null, date: dateKey(new Date(e.created_at)), created_at: e.created_at }))
  const fromShop = st.shopOrders.filter((o) => o.status === 'paid')
    .map((o) => ({ id: o.id, type: 'essentials', name: o.name, phone: o.phone, email: o.email, amount: o.amount, detail: o.items.map((i) => `${i.qty}× ${i.name}`).join(', ') || null, date: dateKey(new Date(o.paid_at || o.created_at)), created_at: o.created_at }))
  return [...fromEnrollments, ...fromShop].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
}

function mpPaymentsApi(c, { returnPaths }) {
  const { st, method, q, body, h } = c
  const set = st.settings
  const publicSettings = () => ({ cursosPrice: set.cursosPrice, workshopPrice: set.workshopPrice, workshopDate: set.workshopDate, workshopPaymentsEnabled: set.workshopPaymentsEnabled })
  if (method === 'GET' && q.status === '1') {
    const p = st.payments?.[String(q.payment_id || '')]
    return [200, { status: 'approved', paid: true, amount: p?.amount ?? 9990 }]
  }
  if (q.settings === '1') {
    if (method === 'GET') return [200, publicSettings()]
    if (method === 'PATCH') {
      const s = needSession(c); if (s) return s
      for (const k of ['cursosPrice', 'workshopPrice']) {
        if (body[k] === undefined) continue
        const n = Number(body[k])
        if (!Number.isFinite(n) || n < 0) return [400, { error: `${k} inválido` }]
        set[k] = Math.round(n)
      }
      if (body.workshopDate !== undefined) set.workshopDate = body.workshopDate || null
      if (body.workshopPaymentsEnabled !== undefined) set.workshopPaymentsEnabled = Boolean(body.workshopPaymentsEnabled)
      return [200, publicSettings()]
    }
  }
  if (q.panel === '1') {
    const s = needSession(c); if (s) return s
    const f = failing(c, 'mp-payments'); if (f) return f
    const all = onlineOrders(st)
    if (q.summary === '1') {
      const from = DATE_RE.test(String(q.from || '')) ? q.from : null
      const to = DATE_RE.test(String(q.to || '')) ? q.to : null
      const orders = all.filter((o) => (!from || o.date >= from) && (!to || o.date <= to))
      const byType = { cursos: { total: 0, count: 0 }, workshop: { total: 0, count: 0 }, essentials: { total: 0, count: 0 } }
      const days = new Map()
      for (const o of orders) {
        byType[o.type].total += o.amount
        byType[o.type].count += 1
        const d = days.get(o.date) || { date: o.date, total: 0, count: 0 }
        d.total += o.amount
        d.count += 1
        days.set(o.date, d)
      }
      return OK({
        range: { from, to }, total: orders.reduce((n, o) => n + o.amount, 0), count: orders.length, byType,
        byDay: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)), ...(q.orders === '1' ? { orders } : {}),
      })
    }
    return OK({ orders: all.slice(0, 300).map(({ date, ...o }) => o) })
  }
  if (method === 'POST' && q.webhook === '1') return OK()
  if (method === 'POST') {
    const source = body.source
    if (!['cursos', 'workshop', 'essentials'].includes(source)) return [400, { error: 'source inválido' }]
    const name = String(body.name || '').trim()
    const email = String(body.email || '').trim().toLowerCase()
    const phone = cleanPhone(body.phone)
    if (!name || !EMAIL_RE.test(email) || phone.length !== 9) return [400, { error: 'Revisa tu nombre, correo y teléfono.' }]
    const paymentId = `mock_${Date.now()}`
    const now = iso()
    let amount = 0
    if (source === 'essentials') {
      const items = Array.isArray(body.items) ? body.items : []
      if (!items.length) return [400, { error: 'El carrito está vacío.' }]
      const lines = []
      for (const it of items) {
        const p = st.products.find((x) => x.id === Number(it.productId) && x.active && !x.archivedAt)
        const qty = int(it.qty)
        if (!p) return [400, { error: 'Uno de los productos ya no está disponible.' }]
        if (!Number.isInteger(qty) || qty < 1) return [400, { error: 'Cantidad inválida.' }]
        if (p.stock < qty) return [400, { error: `Sin stock suficiente: ${p.name}` }]
        lines.push({ productId: p.id, name: p.name, qty, price: p.price })
      }
      amount = lines.reduce((n, l) => n + l.qty * l.price, 0)
      const order = { id: ++st.seq.order, name, phone, email, items: lines, amount, status: 'paid', created_at: now, paid_at: now }
      st.shopOrders.unshift(order)
      for (const l of lines) {
        const p = st.products.find((x) => x.id === l.productId)
        p.stock = Math.max(0, p.stock - l.qty)
        st.moves.push({ id: ++st.seq.move, productId: p.id, date: h.today, kind: 'venta', delta: -l.qty, reason: 'Venta web', unitCost: null, saleId: null, shopOrderId: order.id, createdAt: now })
      }
    } else {
      if (source === 'workshop' && !set.workshopPaymentsEnabled) {
        return [409, { error: 'Las inscripciones al Workshop están en pausa mientras confirmamos la próxima fecha.', paused: true }]
      }
      amount = source === 'cursos' ? set.cursosPrice : set.workshopPrice
      st.enrollments.unshift({
        id: ++st.seq.enrollment, name, phone, email, source, level: body.level || null,
        message: `Pago MercadoPago ${paymentId} · $${amount}`, edition: source === 'workshop' ? String(body.edition || '').trim() || null : null,
        amount, details_sent_at: null, created_at: now,
      })
    }
    ;(st.payments ||= {})[paymentId] = { amount, source }
    st.notifications.unshift({ id: Date.now(), title: 'Pago recibido', body: `${name} · ${source} · $${amount}`, url: source === 'essentials' ? '/panel?tab=pedidos' : '/panel?tab=inscripciones', tag: 'mp', createdAt: now })
    const path = returnPaths[source] || '/'
    console.log(`✓ Mock de API · Mercado Pago aprobado al instante: ${source} $${amount} → ${path}`)
    return [200, { checkoutUrl: `http://${c.host}${path}?status=approved&payment_id=${paymentId}`, preferenceId: paymentId }]
  }
  return E(405, 'Method not allowed')
}

function enrollmentsApi(c) {
  const { st, method, q, body } = c
  if (method === 'GET') {
    const s = needSession(c); if (s) return s
    return OK({ enrollments: st.enrollments.map(({ amount, details_sent_at, ...e }) => e) })
  }
  if (method === 'POST' && q.job === 'workshop-details') {
    const s = needSession(c); if (s) return s
    const paidWorkshop = st.enrollments.filter((e) => e.source === 'workshop' && String(e.message || '').startsWith('Pago MercadoPago'))
    const pending = paidWorkshop.filter((e) => body.force || !e.details_sent_at)
    if (body.dryRun) return OK({ recipients: pending.map((e) => ({ id: e.id, name: e.name, email: e.email })), skipped: paidWorkshop.length - pending.length })
    pending.forEach((e) => { e.details_sent_at = iso() })
    return OK({ sent: pending.map((e) => ({ id: e.id, email: e.email })), failed: [], skipped: paidWorkshop.length - pending.length })
  }
  if (method === 'POST') {
    const name = String(body.name || '').trim()
    const phone = cleanPhone(body.phone)
    const email = String(body.email || '').trim()
    if (!name || phone.length !== 9 || !EMAIL_RE.test(email)) return E(400, 'Revisa tu nombre, teléfono y correo.')
    const row = { id: ++st.seq.enrollment, name, phone, email, source: body.source === 'workshop' ? 'workshop' : 'cursos', level: body.level || null, message: body.message || null, edition: body.edition || null, amount: null, details_sent_at: null, created_at: iso() }
    st.enrollments.unshift(row)
    return OK({ id: row.id })
  }
  const s = needSession(c); if (s) return s
  const e = st.enrollments.find((x) => x.id === Number(q.id))
  if (method === 'PATCH') {
    if (!e) return E(404, 'Inscripción no encontrada')
    for (const k of ['name', 'phone', 'email', 'source', 'level', 'message', 'edition']) if (body[k] !== undefined) e[k] = body[k]
    const { amount, details_sent_at, ...out } = e
    return OK({ enrollment: out })
  }
  if (method === 'DELETE') {
    st.enrollments = st.enrollments.filter((x) => x !== e)
    return OK()
  }
  return E(405, 'Method not allowed')
}

/* ── Plugin ──────────────────────────────────────────────────────────────── */
function readBody(req) {
  return new Promise((resolve) => {
    if (req.method === 'GET' || req.method === 'HEAD') return resolve({})
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}) } catch { resolve({ __invalid: true }) } })
    req.on('error', () => resolve({}))
  })
}

export function createMockApi({ returnPaths = {} } = {}) {
  let st = createState()
  const fail = new Set(String(process.env.DEV_MOCK_FAIL || '').split(',').map((s) => s.trim()).filter(Boolean))
  const delay = Math.max(0, Number(process.env.DEV_MOCK_DELAY) || 0)
  const routes = {
    'auth-barber': authBarber, 'auth-login': authLogin, bookings: bookingsApi, availability: availabilityApi,
    services: servicesApi, clients: clientsApi, barbers: barbersApi, expenses: expensesApi, push: pushApi,
    'mp-payments': (c) => mpPaymentsApi(c, { returnPaths }), enrollments: enrollmentsApi,
  }
  return {
    get state() { return st },
    async handle(req) {
      const url = new URL(req.url, 'http://mock')
      const name = url.pathname.replace(/^\/api\//, '').replace(/\.js$/, '').replace(/\/$/, '')
      const q = Object.fromEntries(url.searchParams)
      const method = String(req.method || 'GET').toUpperCase()
      if (name === '__mock/reset' && method === 'POST') { st = createState(); return [200, { ok: true, reset: true }] }
      if (name === '__mock/state') return [200, { ok: true, state: { ...st, blocks: [...st.blocks], resetTokens: [...st.resetTokens], cardsSent: [...(st.cardsSent || [])] } }]
      const route = routes[name]
      if (!route) return [404, { ok: false, error: `El mock no conoce /api/${name}` }]
      const body = await readBody(req)
      if (body.__invalid) return [400, { ok: false, error: 'JSON inválido' }]
      const auth = String(req.headers?.authorization || '')
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
      const session = token ? { id: BRUNO_ID, admin: true, token } : null
      if (delay) await new Promise((r) => setTimeout(r, delay))
      const ctx = { st, method, q, body, session, fail, host: req.headers?.host || 'localhost:5173', h: helpers(st) }
      return route(ctx)
    },
  }
}

export default function devMockPlugin({ returnPaths = {} } = {}) {
  return {
    name: 'brunetti-dev-mock',
    apply: 'serve',
    // Pre-hook (sin `return`): tiene que registrarse ANTES del servido
    // estático de Vite, que si no devolvería el código fuente de api/*.js.
    configureServer(server) {
      if (process.env.VITE_DEV_MOCKS !== '1') return
      const api = createMockApi({ returnPaths })
      server.config.logger.info('\n  ✓ Mock de API activo (VITE_DEV_MOCKS=1): /api/* sale de scripts/dev-mock, en memoria. Login: bruno-herrera + 8 caracteres.\n')
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next()
        try {
          const [status, data] = await api.handle(req)
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.setHeader('X-Dev-Mock', '1')
          res.end(JSON.stringify(data))
        } catch (err) {
          console.error('dev-mock error:', err)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, error: `Error del mock: ${err?.message || err}` }))
        }
      })
    },
  }
}
