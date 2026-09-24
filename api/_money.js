/* BRUNETTI — Plata: medio de pago y ventas online
   ------------------------------------------------------------------
   Toda la aritmética de dinero del panel vive acá para que no se disperse por
   api/bookings.js (que ya es el archivo más grande del proyecto, y el tope de
   12 funciones del plan Hobby obliga a meter cada endpoint nuevo como un
   `?mode=` dentro de uno existente).

   LOS TRES MONTOS DE UNA RESERVA (sin comisión: acá hay un solo barbero)

     listPrice  = COALESCE(price_snapshot, services.price, custom_price)
                  Precio de catálogo, CONGELADO al completar en price_snapshot:
                  subirle el precio a un servicio mañana no reescribe lo que ya
                  se facturó.
     price      = COALESCE(custom_price, price_snapshot, services.price)
                  Lo que CORRESPONDE cobrar: el de lista salvo custom_price, que
                  es donde aterrizan el precio editado a mano y el canje del
                  corte gratis (0). Es el `price` que el panel y la app de iOS
                  ya consumen; no cambia de significado.
     collected  = paid_amount
                  Lo que REALMENTE entró en caja, con su medio de pago. NULL =
                  todavía no se cobró.

   Con una reserva sin descuentos los tres son el mismo número.

   El cobro es OPCIONAL en el servidor para todos: el servidor no distingue el
   panel web de la app de iOS (la misma sesión), y ni iOS ni el puente de
   PimpStudio mandan medio de pago. Solo la hoja de cobro del panel web lo
   exige. Una completada sin cobro queda "pago por confirmar".

   Prefijo `_`: no consume slot de función serverless.
   ================================================================ */

/* "tarjeta" cubre débito y crédito juntos (es la misma máquina en el mesón).
   "cortesia" es el canje del corte gratis o el corte de la casa: monto 0
   registrado a propósito, distinto de "todavía no se cobró" (NULL).
   Mismo orden y valores que el CHECK bookings_payment_method_check. */
export const PAYMENT_METHODS = ["efectivo", "tarjeta", "transferencia", "mercadopago", "cortesia"]

export const PAYMENT_LABELS = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  mercadopago: "Mercado Pago",
  cortesia: "Cortesía",
}

/* Qué comprobante pedir según el medio (bookings.payment_ref). null = no se
   pide nada: el efectivo no deja rastro que anotar y una cortesía no genera
   documento. */
export const PAYMENT_REF_LABELS = {
  efectivo: null,
  tarjeta: "N.º de boleta",
  transferencia: "N.º de operación",
  mercadopago: "N.º de operación",
  cortesia: null,
}

export const refLabelFor = (method) => PAYMENT_REF_LABELS[method] ?? null

export const MAX_AMOUNT = 10_000_000

const blank = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "")

/* Lee el cobro de un body { paidAmount, paymentMethod, paymentRef }.
     null              no vino ningún cobro (el caso de iOS, del puente y del
                       panel viejo): quien llama sigue sin pago.
     { error }         vino algo inválido → 400 con ese mensaje.
     { collected, method, ref }
                       cobro válido. collected entero 0–10.000.000; cortesía
                       fuerza 0 y no lleva comprobante; ref recortado a 60.
   Un medio sin monto (salvo cortesía) o un monto sin medio es un error: el
   sistema nunca inventa ninguno de los dos. */
export function readPayment(body) {
  const { paidAmount, paymentMethod, paymentRef } = body || {}
  const hasAmount = !blank(paidAmount)
  const hasMethod = !blank(paymentMethod)
  if (!hasAmount && !hasMethod) return null

  const method = hasMethod ? String(paymentMethod).trim() : null
  if (!method) return { error: "Indica el medio de pago" }
  if (!PAYMENT_METHODS.includes(method)) return { error: "Medio de pago inválido" }
  if (method === "cortesia") return { collected: 0, method, ref: null }

  if (!hasAmount) return { error: "Indica el monto cobrado" }
  const n = typeof paidAmount === "string" ? Number(paidAmount.trim()) : Number(paidAmount)
  if (!Number.isInteger(n) || n < 0 || n > MAX_AMOUNT) return { error: "El monto cobrado no es válido" }

  const cleanRef = blank(paymentRef) ? null : String(paymentRef).trim().slice(0, 60)
  return { collected: n, method, ref: cleanRef }
}

/* 30% en productos desde las 5 estrellas: es un beneficio permanente del
   programa de PimpStudio (su loyaltySummary lo expone como
   productDiscountReady), no un canje — no consume estrellas. La venta en mesón
   (POST /api/bookings?mode=sale) solo lo aplica si el puente confirma el
   saldo en el momento; el navegador nunca decide el descuento. */
export const PRODUCT_DISCOUNT_STARS = 5
export const PRODUCT_DISCOUNT_PCT = 30

/* ---------------------------------------------------------------------------
   Caja del día (GET /api/bookings?mode=cash)
   El arqueo: cuánto entró, por qué medio. Función pura para poder probarla
   sin base.

     bookings  filas de la lista del panel de ESE día (canceladas se ignoran)
     sales     ventas de producto pagadas del día ({ total, paymentMethod, items })
     online    resultado de onlineSales() para el día (o null)

   Reglas, por reserva:
     · pago por confirmar (completada sin cobro)  → byMethod.pendiente, al
       precio que corresponde. Es plata que ya cuenta pero todavía no se sabe
       por dónde entró: NO suma a `collected`.
     · con cobro registrado                       → su medio, por lo cobrado.
     · pendiente / confirmada / en curso sin cobro → `pending` (por cobrar).
     · completada vieja sin completed_at ni cobro (de antes de registrar el
       cobro) → no entra al arqueo: el sistema no sabe si ni cómo se pagó.
   Las ventas de producto entran al MISMO byMethod (a la caja no le consta si
   la plata vino de un corte o de una cera), y lo online de Mercado Pago va en
   su propia línea `online`, aparte del "mercadopago" cobrado en el mesón: son
   dos plata distintas.
   collected = suma de byMethod sin `pendiente`. */
export const CASH_METHODS = [...PAYMENT_METHODS, "pendiente", "online"]

export function summarizeCash({ bookings = [], sales = [], online = null } = {}) {
  const byMethod = Object.fromEntries(CASH_METHODS.map((m) => [m, 0]))
  const methodOf = (m) => (PAYMENT_METHODS.includes(m) ? m : "efectivo")
  let servicesCollected = 0
  let pending = 0
  let toConfirm = 0
  let toConfirmCount = 0
  for (const row of bookings) {
    if (row.status === "cancelada") continue
    const price = Number(row.price || 0)
    if (row.paymentPending) {
      byMethod.pendiente += price
      toConfirm += price
      toConfirmCount += 1
      continue
    }
    if (row.paidAmount != null) {
      const paid = Number(row.paidAmount) || 0
      byMethod[methodOf(row.paymentMethod)] += paid
      servicesCollected += paid
      continue
    }
    if (row.status !== "completada") pending += price
  }

  let productsCollected = 0
  let productsCount = 0
  for (const sale of sales) {
    if (sale.status && sale.status !== "pagada") continue
    const total = Number(sale.total) || 0
    byMethod[methodOf(sale.paymentMethod)] += total
    productsCollected += total
    for (const item of Array.isArray(sale.items) ? sale.items : []) productsCount += Number(item.qty) || 0
  }

  const onlineCollected = Number(online?.total) || 0
  byMethod.online = onlineCollected
  const collected = CASH_METHODS.filter((m) => m !== "pendiente").reduce((n, m) => n + byMethod[m], 0)
  return { collected, servicesCollected, productsCollected, productsCount, onlineCollected, pending, toConfirm, toConfirmCount, byMethod }
}

/* ---------------------------------------------------------------------------
   Ventas online (Mercado Pago Checkout Pro)
   Lo que entró por la web: pedidos de Essentials pagados (shop_orders) e
   inscripciones pagadas de Cursos y Workshop (enrollments con el marcador
   "Pago MercadoPago …" que escribe el webhook). Es la MISMA fuente que la
   lista de Pedidos del panel (handlePanelOrders en api/mp-payments.js), acá
   agregada por rango. Va aparte del cobro en mesón con medio "mercadopago":
   son dos plata distintas.

   Fechas en hora de Santiago (el día que ve el negocio, no el de UTC).
   `from` / `to` son 'YYYY-MM-DD' inclusivos; cualquiera puede faltar.
   Si una tabla todavía no existe (nadie compró nunca), esa fuente aporta 0.

   Devuelve:
     { total, count,
       byType: { cursos:{total,count}, workshop:{total,count}, essentials:{total,count} },
       byDay:  [{ date, total, count }]   (ascendente),
       orders?: [{ id, type, name, phone, email, amount, detail, date, created_at }]
                (solo con withOrders, descendente) }
   ------------------------------------------------------------------------- */
const BUSINESS_TZ = "America/Santiago"
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/* Respaldo para inscripciones antiguas sin columna `amount`: el monto quedó
   solo en el texto del marcador, ej. "Pago MercadoPago 123 · $9990". Mismo
   criterio que parseAmountFromMessage() en api/mp-payments.js. */
export function parseAmountFromMessage(message) {
  const m = String(message || "").match(/\$([\d.]+)\s*$/)
  if (!m) return null
  const n = Number(m[1].replace(/\./g, ""))
  return Number.isFinite(n) ? n : null
}

const isMissingTable = (err) => err?.code === "42P01"

export async function onlineSales(sql, { from = null, to = null, withOrders = false } = {}) {
  const fromDate = DATE_RE.test(String(from || "")) ? from : null
  const toDate = DATE_RE.test(String(to || "")) ? to : null

  let enrollmentRows = []
  try {
    // amount por to_jsonb: las tablas más viejas no tenían la columna (la
    // agrega ensureEnrollmentsTable de mp-payments.js).
    enrollmentRows = await sql`
      SELECT id, name, phone, email, source, edition, message, amount, created_at, day FROM (
        SELECT e.id, e.name, e.phone, e.email, e.source, e.edition, e.message, e.created_at,
               (to_jsonb(e)->>'amount')::int AS amount,
               ((e.created_at AT TIME ZONE ${BUSINESS_TZ})::date)::text AS day
        FROM enrollments e
        WHERE e.message LIKE 'Pago MercadoPago%'
      ) x
      WHERE (${fromDate}::date IS NULL OR day::date >= ${fromDate}::date)
        AND (${toDate}::date IS NULL OR day::date <= ${toDate}::date)
      ORDER BY created_at DESC
    `
  } catch (err) {
    if (!isMissingTable(err)) throw err
  }

  let orderRows = []
  try {
    // paid_at puede no existir todavía (ensureShopOrderColumns): to_jsonb lo
    // lee sin depender de la migración y, si falta, cuenta desde created_at.
    orderRows = await sql`
      SELECT id, name, phone, email, items, amount, created_at, day FROM (
        SELECT o.id, o.name, o.phone, o.email, o.items, o.amount, o.created_at,
               ((COALESCE((to_jsonb(o)->>'paid_at')::timestamptz, o.created_at) AT TIME ZONE ${BUSINESS_TZ})::date)::text AS day
        FROM shop_orders o
        WHERE o.status = 'paid'
      ) x
      WHERE (${fromDate}::date IS NULL OR day::date >= ${fromDate}::date)
        AND (${toDate}::date IS NULL OR day::date <= ${toDate}::date)
      ORDER BY created_at DESC
    `
  } catch (err) {
    if (!isMissingTable(err)) throw err
  }

  const orders = [
    ...enrollmentRows.map((r) => ({
      id: r.id,
      type: r.source, // 'cursos' | 'workshop'
      name: r.name,
      phone: r.phone,
      email: r.email,
      amount: Number(r.amount ?? parseAmountFromMessage(r.message) ?? 0),
      detail: r.edition || null,
      date: r.day,
      created_at: r.created_at,
    })),
    ...orderRows.map((r) => {
      let items = r.items
      if (typeof items === "string") {
        try { items = JSON.parse(items) } catch { items = [] }
      }
      if (!Array.isArray(items)) items = []
      return {
        id: r.id,
        type: "essentials",
        name: r.name,
        phone: r.phone,
        email: r.email,
        amount: Number(r.amount || 0),
        detail: items.map((it) => `${it.qty}× ${it.name}`).join(", ") || null,
        date: r.day,
        created_at: r.created_at,
      }
    }),
  ]

  const byType = {
    cursos: { total: 0, count: 0 },
    workshop: { total: 0, count: 0 },
    essentials: { total: 0, count: 0 },
  }
  const days = new Map()
  let total = 0
  for (const o of orders) {
    total += o.amount
    const bucket = byType[o.type] || (byType[o.type] = { total: 0, count: 0 })
    bucket.total += o.amount
    bucket.count += 1
    const day = days.get(o.date) || { date: o.date, total: 0, count: 0 }
    day.total += o.amount
    day.count += 1
    days.set(o.date, day)
  }

  const out = {
    total,
    count: orders.length,
    byType,
    byDay: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
  }
  if (withOrders) out.orders = orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  return out
}
