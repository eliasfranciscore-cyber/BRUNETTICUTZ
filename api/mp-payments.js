/* ================================================================
   Mercado Pago Checkout Pro: checkout + webhook + estado
   POST  /api/mp-payments                     (checkout: crea preferencia de pago)
   POST  /api/mp-payments?webhook=1           (Mercado Pago notifica, server-to-server)
   GET   /api/mp-payments?status=1&payment_id= (frontend consulta estado, solo lectura)
   GET   /api/mp-payments?settings=1          (público: precio Cursos/Workshop + fecha Workshop)
   PATCH /api/mp-payments?settings=1          (panel interno: edita esos ajustes)
   GET   /api/mp-payments?panel=1             (panel interno: lista unificada de pedidos pagados)

   Fuentes soportadas: 'cursos', 'workshop' (precio fijo, sin carrito) y
   'essentials' (carrito de productos, valida precio/stock contra la DB).
   El sandbox vs producción lo decide Mercado Pago automáticamente según el
   prefijo del access token (TEST- vs el de producción) — a diferencia de
   Flow, acá no hace falta una env var de ambiente aparte.
   ================================================================ */

import { neon } from '@neondatabase/serverless'
import { requireInternal } from './_auth.js'
import { notifyAll } from './push.js'
import { sendWorkshopConfirmationEmail } from './_email.js'

const MP_API_BASE = 'https://api.mercadopago.com'
const SOURCES = ['cursos', 'workshop', 'essentials']
const FIXED_PRICES = { cursos: 9990, workshop: 49990 }
const SOURCE_TITLES = {
  cursos: 'Curso Brunetti · Visagismo & Barbería',
  workshop: 'Workshop Brunetti · Contenido que Vende',
}
const SOURCE_PATHS = { cursos: '/cursos', workshop: '/workshop', essentials: '/essentials' }

function cleanPhone(v) {
  let digits = String(v || '').replace(/\D/g, '')
  if (digits.length > 9 && digits.startsWith('56')) digits = digits.slice(2)
  return digits.slice(0, 9)
}
function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '')) }

function siteOrigin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host
  const proto = req.headers['x-forwarded-proto'] || 'https'
  return `${proto}://${host}`
}

function encodeRef(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

function decodeRef(ref) {
  try { return JSON.parse(Buffer.from(ref, 'base64url').toString('utf8')) } catch { return null }
}

async function mpRequest(path, method, body) {
  const accessToken = process.env.MP_ACCESS_TOKEN
  if (!accessToken) throw new Error('MP_ACCESS_TOKEN no configurada')

  const response = await fetch(`${MP_API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json()
  if (!response.ok) throw Object.assign(new Error(data.message || 'Mercado Pago API error'), { status: response.status, data })
  return data
}

export default async function handler(req, res) {
  if (req.query.status === '1') return handleStatus(req, res)

  if (req.query.settings === '1') {
    if (req.method === 'GET') return handleGetSettings(req, res)
    if (req.method === 'PATCH') return handlePatchSettings(req, res)
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (req.query.panel === '1') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
    return handlePanelOrders(req, res)
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (req.query.webhook === '1') return handleWebhook(req, res)
  return handleCheckout(req, res)
}

/* ============================================================
   SETTINGS: precio de Cursos/Workshop y fecha del Workshop,
   editables desde el panel interno (Config → Precios y fechas).
   GET es público (lo consumen Cursos.jsx/Workshop.jsx para mostrar
   el precio real); PATCH requiere sesión interna. Guardado en una
   tabla clave/valor simple — nunca bloquea el cobro: si la lectura
   falla, se usan los defaults de FIXED_PRICES.
   ============================================================ */
const SETTINGS_KEYS = ['cursos_price', 'workshop_price', 'workshop_date']

async function ensureSettingsTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
}

async function readSettings(sql) {
  const defaults = { cursosPrice: FIXED_PRICES.cursos, workshopPrice: FIXED_PRICES.workshop, workshopDate: null }
  try {
    await ensureSettingsTable(sql)
    const rows = await sql`SELECT key, value FROM settings WHERE key = ANY(${SETTINGS_KEYS})`
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    return {
      cursosPrice: byKey.cursos_price ? Number(byKey.cursos_price) : defaults.cursosPrice,
      workshopPrice: byKey.workshop_price ? Number(byKey.workshop_price) : defaults.workshopPrice,
      workshopDate: byKey.workshop_date || defaults.workshopDate,
    }
  } catch (err) {
    console.error('readSettings error (usando defaults):', err?.message)
    return defaults
  }
}

async function handleGetSettings(req, res) {
  const sql = neon(process.env.DATABASE_URL)
  const settings = await readSettings(sql)
  return res.status(200).json(settings)
}

async function handlePatchSettings(req, res) {
  const session = requireInternal(req, res)
  if (!session) return

  const { cursosPrice, workshopPrice, workshopDate } = req.body || {}
  const updates = []
  if (cursosPrice !== undefined) {
    const n = Number(cursosPrice)
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'cursosPrice inválido' })
    updates.push(['cursos_price', String(Math.round(n))])
  }
  if (workshopPrice !== undefined) {
    const n = Number(workshopPrice)
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'workshopPrice inválido' })
    updates.push(['workshop_price', String(Math.round(n))])
  }
  if (workshopDate !== undefined) {
    if (workshopDate && Number.isNaN(new Date(workshopDate).getTime())) {
      return res.status(400).json({ error: 'workshopDate inválida' })
    }
    updates.push(['workshop_date', String(workshopDate || '')])
  }
  if (!updates.length) return res.status(400).json({ error: 'Nada que guardar' })

  try {
    const sql = neon(process.env.DATABASE_URL)
    await ensureSettingsTable(sql)
    for (const [key, value] of updates) {
      await sql`
        INSERT INTO settings (key, value, updated_at) VALUES (${key}, ${value}, NOW())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `
    }
    return res.status(200).json(await readSettings(sql))
  } catch (err) {
    console.error('handlePatchSettings error:', err?.message)
    return res.status(500).json({ error: 'No se pudo guardar la configuración' })
  }
}

/* ============================================================
   PANEL: lista unificada de pedidos pagados (Cursos, Workshop,
   Essentials) para el panel interno. Requiere sesión.
   ============================================================ */
async function handlePanelOrders(req, res) {
  const session = requireInternal(req, res)
  if (!session) return

  try {
    const sql = neon(process.env.DATABASE_URL)
    await ensureEnrollmentsTable(sql)
    await ensureShopOrdersTable(sql)

    const [enrollmentRows, orderRows] = await Promise.all([
      sql`
        SELECT id, name, phone, email, source, edition, message, amount, created_at
        FROM enrollments
        WHERE message LIKE 'Pago MercadoPago%'
        ORDER BY created_at DESC LIMIT 300
      `,
      sql`
        SELECT id, name, phone, email, items, amount, created_at
        FROM shop_orders
        WHERE status = 'paid'
        ORDER BY created_at DESC LIMIT 300
      `,
    ])

    const enrollmentOrders = enrollmentRows.map((r) => ({
      id: r.id,
      type: r.source, // 'cursos' | 'workshop'
      name: r.name,
      phone: r.phone,
      email: r.email,
      amount: r.amount ?? parseAmountFromMessage(r.message),
      detail: r.edition || null,
      created_at: r.created_at,
    }))

    const essentialsOrders = orderRows.map((r) => {
      const items = Array.isArray(r.items) ? r.items : JSON.parse(r.items || '[]')
      return {
        id: r.id,
        type: 'essentials',
        name: r.name,
        phone: r.phone,
        email: r.email,
        amount: r.amount,
        detail: items.map((it) => `${it.qty}× ${it.name}`).join(', ') || null,
        created_at: r.created_at,
      }
    })

    const orders = [...enrollmentOrders, ...essentialsOrders]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

    return res.status(200).json({ ok: true, orders })
  } catch (err) {
    console.error('handlePanelOrders error:', err?.message)
    return res.status(500).json({ ok: false, error: 'No se pudieron cargar los pedidos' })
  }
}

/* Respaldo para filas antiguas de enrollments sin columna `amount`
   (previas a esta migración): el monto quedó solo en el texto del
   marcador de idempotencia, ej. "Pago MercadoPago 123 · $9990". */
function parseAmountFromMessage(message) {
  const m = String(message || '').match(/\$([\d.]+)\s*$/)
  if (!m) return null
  const n = Number(m[1].replace(/\./g, ''))
  return Number.isFinite(n) ? n : null
}

/* ============================================================
   CHECKOUT: crear preferencia de pago en Mercado Pago
   ============================================================ */
async function handleCheckout(req, res) {
  const { source, name, email, phone, edition, items } = req.body || {}

  if (!SOURCES.includes(source)) {
    return res.status(400).json({ error: 'source inválido' })
  }
  if (!String(name || '').trim() || !validEmail(email) || cleanPhone(phone).length < 8) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  if (!process.env.MP_ACCESS_TOKEN) {
    console.error('MP_ACCESS_TOKEN missing.')
    return res.status(500).json({ error: 'Payment service not configured' })
  }

  const cleanedName = String(name).trim()
  const cleanedPhone = cleanPhone(phone)
  const cleanedEmail = String(email).trim().toLowerCase()

  try {
    let mpItems
    let externalReference

    if (source === 'essentials') {
      const built = await buildEssentialsOrder({ name: cleanedName, phone: cleanedPhone, email: cleanedEmail, items })
      if (built.error) return res.status(400).json({ error: built.error })
      mpItems = built.mpItems
      externalReference = `essentials-${built.orderId}`
    } else {
      const settings = await readSettings(neon(process.env.DATABASE_URL))
      const amount = source === 'cursos' ? settings.cursosPrice : settings.workshopPrice
      const payload = { source, name: cleanedName, phone: cleanedPhone, email: cleanedEmail }
      if (source === 'workshop') payload.edition = String(edition || '').trim()
      externalReference = encodeRef(payload)
      mpItems = [{ title: SOURCE_TITLES[source], quantity: 1, unit_price: amount, currency_id: 'CLP' }]
    }

    const origin = siteOrigin(req)
    const backUrl = `${origin}${SOURCE_PATHS[source]}`
    const [firstName, ...rest] = cleanedName.split(/\s+/)

    const preference = await mpRequest('/checkout/preferences', 'POST', {
      items: mpItems,
      payer: {
        name: firstName,
        surname: rest.join(' ') || firstName,
        email: cleanedEmail,
        phone: { area_code: '56', number: cleanedPhone },
      },
      external_reference: externalReference,
      back_urls: { success: backUrl, pending: backUrl, failure: backUrl },
      auto_return: 'approved',
      notification_url: `${origin}/api/mp-payments?webhook=1`,
      statement_descriptor: 'BRUNETTI',
    })

    const isTest = String(process.env.MP_ACCESS_TOKEN).startsWith('TEST-')
    const checkoutUrl = isTest ? (preference.sandbox_init_point || preference.init_point) : preference.init_point

    return res.status(200).json({ checkoutUrl, preferenceId: preference.id })
  } catch (err) {
    console.error('MP checkout error:', err.data || err.message)
    return res.status(err.status || 500).json({ error: err.message || 'Payment service error' })
  }
}

/* Valida el carrito de Essentials contra la DB (precio y stock reales, nunca
   confiar en lo que manda el cliente) y crea la orden en estado 'pending'
   antes de pedirle la preferencia a Mercado Pago. */
async function buildEssentialsOrder({ name, phone, email, items }) {
  if (!Array.isArray(items) || items.length === 0) {
    return { error: 'Carrito vacío' }
  }

  const sql = neon(process.env.DATABASE_URL)
  await ensureShopOrdersTable(sql)

  const ids = [...new Set(items.map((i) => Number(i.productId)).filter(Number.isFinite))]
  if (ids.length === 0) return { error: 'Carrito inválido' }

  const rows = await sql`SELECT id, name, price, stock FROM products WHERE id = ANY(${ids})`
  const byId = new Map(rows.map((r) => [r.id, r]))

  const orderItems = []
  for (const it of items) {
    const p = byId.get(Number(it.productId))
    const qty = Math.max(1, Math.floor(Number(it.qty) || 1))
    if (!p) return { error: 'Uno de los productos ya no está disponible' }
    if (p.stock < qty) return { error: `Sin stock suficiente: ${p.name}` }
    orderItems.push({ productId: p.id, name: p.name, price: p.price, qty })
  }
  const amount = orderItems.reduce((n, it) => n + it.price * it.qty, 0)

  const [order] = await sql`
    INSERT INTO shop_orders (name, phone, email, items, amount, status)
    VALUES (${name}, ${phone}, ${email}, ${JSON.stringify(orderItems)}, ${amount}, 'pending')
    RETURNING id
  `

  return {
    orderId: order.id,
    mpItems: orderItems.map((it) => ({ title: it.name, quantity: it.qty, unit_price: it.price, currency_id: 'CLP' })),
  }
}

/* ============================================================
   STATUS: consulta de solo lectura para la UI (no escribe DB)
   ============================================================ */
async function handleStatus(req, res) {
  const paymentId = req.query.payment_id
  if (!paymentId) return res.status(400).json({ error: 'Missing payment_id' })

  try {
    const data = await mpRequest(`/v1/payments/${paymentId}`, 'GET')
    return res.status(200).json({
      status: data.status, // approved | pending | in_process | rejected | cancelled | refunded
      paid: data.status === 'approved',
      amount: data.transaction_amount,
    })
  } catch (err) {
    console.error('MP status error:', err.data || err.message)
    return res.status(err.status || 500).json({ error: err.message || 'Payment service error' })
  }
}

/* ============================================================
   WEBHOOK: Mercado Pago notifica de pago (server-to-server),
   confirmamos el estado real vía GET /v1/payments antes de guardar nada.
   ============================================================ */
async function handleWebhook(req, res) {
  const paymentId = req.body?.data?.id || req.query['data.id'] || req.query.id
  const topic = req.body?.type || req.query.type || req.query.topic
  if (!paymentId || (topic && topic !== 'payment')) {
    return res.status(200).json({ received: true })
  }

  try {
    const payment = await mpRequest(`/v1/payments/${paymentId}`, 'GET')

    console.log('[WEBHOOK] MP notificación:', {
      paymentId: payment.id,
      status: payment.status,
      externalReference: payment.external_reference,
      amount: payment.transaction_amount,
    })

    if (payment.status !== 'approved') {
      return res.status(200).json({ received: true })
    }

    const ref = String(payment.external_reference || '')
    const sql = neon(process.env.DATABASE_URL)

    if (ref.startsWith('essentials-')) {
      return handleEssentialsPaid(sql, ref, payment, res)
    }
    return handleEnrollmentPaid(sql, ref, payment, res)
  } catch (err) {
    // No pudimos ni verificar el estado real del pago contra Mercado Pago:
    // no sabemos si el cliente pagó. Un 200 aquí detendría los reintentos
    // de MP sobre una notificación que nunca llegamos a procesar.
    console.error('[WEBHOOK] Error:', err.data || err.message)
    return res.status(500).json({ received: false, error: err.message })
  }
}

async function handleEnrollmentPaid(sql, ref, payment, res) {
  const parsed = decodeRef(ref)
  if (!parsed || !['cursos', 'workshop'].includes(parsed.source)) {
    console.error('[WEBHOOK] external_reference inválida:', ref)
    return res.status(200).json({ received: true, paymentId: payment.id })
  }

  const { source, name, phone, email, edition } = parsed
  const cleanedPhone = cleanPhone(phone)

  if (!name || cleanedPhone.length < 8 || !validEmail(email)) {
    console.error('[WEBHOOK] Datos de cliente incompletos, no se registra inscripción:', { name, phone, email })
    return res.status(200).json({ received: true, paymentId: payment.id, message: 'Pago registrado (sin datos de cliente válidos)' })
  }

  try {
    await ensureEnrollmentsTable(sql)

    /* Idempotencia: Mercado Pago puede reintentar el webhook, no dupliquemos. */
    const marker = `Pago MercadoPago ${payment.id}`
    const [existing] = await sql`SELECT id FROM enrollments WHERE message LIKE ${`%${marker}%`} LIMIT 1`
    if (existing) {
      return res.status(200).json({ received: true, paymentId: payment.id, enrollmentId: existing.id, message: 'Pago ya registrado' })
    }

    const [row] = await sql`
      INSERT INTO enrollments (name, phone, email, source, edition, message, amount)
      VALUES (${name}, ${cleanedPhone}, ${email.toLowerCase()}, ${source}, ${edition || null}, ${`${marker} · $${payment.transaction_amount}`}, ${payment.transaction_amount})
      RETURNING id
    `

    try {
      await sql`
        INSERT INTO users (name, phone, email, updated_at)
        VALUES (${name}, ${cleanedPhone}, ${email.toLowerCase()}, NOW())
        ON CONFLICT (phone) DO UPDATE SET
          name  = EXCLUDED.name,
          email = COALESCE(NULLIF(EXCLUDED.email,''), users.email),
          updated_at = NOW()
      `
    } catch (uerr) {
      console.error('[WEBHOOK] users upsert (no bloquea):', uerr?.message)
    }

    try {
      const tipo = source === 'workshop' ? 'Workshop' : 'Curso'
      await notifyAll({
        title: `Nueva inscripción · ${tipo} (pagado)`,
        body: `${name} · ${cleanedPhone} · $${payment.transaction_amount}`,
        url: '/panel',
        tag: `inscripcion-${row.id}`,
      })
    } catch (nerr) {
      console.error('[WEBHOOK] notify (no bloquea):', nerr?.message)
    }

    if (source === 'workshop') {
      try {
        await sendWorkshopConfirmationEmail({ to: email, name, edition })
      } catch (eerr) {
        console.error('[WEBHOOK] email (no bloquea):', eerr?.message)
      }
    }

    return res.status(200).json({
      received: true,
      paymentId: payment.id,
      enrollmentId: row.id,
      message: 'Pago e inscripción registrados',
    })
  } catch (dbErr) {
    // El pago YA está confirmado (payment.status === 'approved', plata real
    // movida) pero no logramos guardar la inscripción. Respondemos error real
    // para que Mercado Pago reintente el webhook, y avisamos por push para
    // poder registrar la inscripción a mano si los reintentos no alcanzan.
    console.error('[WEBHOOK] Error guardando inscripción (pago ya confirmado):', dbErr?.message)
    try {
      await notifyAll({
        title: '⚠️ Pago confirmado sin inscripción',
        body: `${name} · ${cleanedPhone} · $${payment.transaction_amount} · MP ${payment.id} — revisar manualmente`,
        url: '/panel',
        tag: `inscripcion-error-${payment.id}`,
      })
    } catch (nerr) {
      console.error('[WEBHOOK] notify de error (no bloquea):', nerr?.message)
    }
    return res.status(500).json({ received: false, paymentId: payment.id, error: 'No se pudo guardar la inscripción' })
  }
}

async function handleEssentialsPaid(sql, ref, payment, res) {
  const orderId = Number(ref.slice('essentials-'.length))
  if (!Number.isFinite(orderId)) {
    console.error('[WEBHOOK] external_reference essentials inválida:', ref)
    return res.status(200).json({ received: true, paymentId: payment.id })
  }

  try {
    const [order] = await sql`SELECT * FROM shop_orders WHERE id = ${orderId}`
    if (!order) {
      console.error('[WEBHOOK] Orden essentials no encontrada:', orderId)
      return res.status(200).json({ received: true, paymentId: payment.id })
    }

    /* Idempotencia: solo el primer webhook que encuentre la orden en
       'pending' la marca pagada y descuenta stock. */
    const [row] = await sql`
      UPDATE shop_orders SET status = 'paid', mp_payment_id = ${String(payment.id)}
      WHERE id = ${orderId} AND status = 'pending'
      RETURNING id
    `
    if (!row) {
      return res.status(200).json({ received: true, paymentId: payment.id, orderId, message: 'Pago ya registrado' })
    }

    try {
      const items = Array.isArray(order.items) ? order.items : JSON.parse(order.items || '[]')
      for (const it of items) {
        await sql`UPDATE products SET stock = GREATEST(stock - ${it.qty}, 0), updated_at = NOW() WHERE id = ${it.productId}`
      }
    } catch (serr) {
      console.error('[WEBHOOK] stock decrement (no bloquea):', serr?.message)
    }

    try {
      await sql`
        INSERT INTO users (name, phone, email, updated_at)
        VALUES (${order.name}, ${order.phone}, ${order.email}, NOW())
        ON CONFLICT (phone) DO UPDATE SET
          name  = EXCLUDED.name,
          email = COALESCE(NULLIF(EXCLUDED.email,''), users.email),
          updated_at = NOW()
      `
    } catch (uerr) {
      console.error('[WEBHOOK] users upsert (no bloquea):', uerr?.message)
    }

    try {
      await notifyAll({
        title: 'Nuevo pedido · Essentials (pagado)',
        body: `${order.name} · ${order.phone} · $${order.amount}`,
        url: '/panel',
        tag: `pedido-${orderId}`,
      })
    } catch (nerr) {
      console.error('[WEBHOOK] notify (no bloquea):', nerr?.message)
    }

    return res.status(200).json({ received: true, paymentId: payment.id, orderId, message: 'Pago y pedido registrados' })
  } catch (dbErr) {
    console.error('[WEBHOOK] Error guardando pedido essentials (pago ya confirmado):', dbErr?.message)
    try {
      await notifyAll({
        title: '⚠️ Pago confirmado sin pedido',
        body: `Orden #${orderId} · MP ${payment.id} — revisar manualmente`,
        url: '/panel',
        tag: `pedido-error-${payment.id}`,
      })
    } catch (nerr) {
      console.error('[WEBHOOK] notify de error (no bloquea):', nerr?.message)
    }
    return res.status(500).json({ received: false, paymentId: payment.id, error: 'No se pudo guardar el pedido' })
  }
}

async function ensureEnrollmentsTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS enrollments (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      phone      TEXT NOT NULL,
      email      TEXT NOT NULL,
      source     TEXT NOT NULL DEFAULT 'cursos',
      level      TEXT,
      message    TEXT,
      edition    TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  /* Monto pagado (NULL para leads de lista de espera, que no pasan por acá).
     Se agrega con IF NOT EXISTS porque la tabla ya existía sin esta columna. */
  await sql`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS amount INTEGER`
}

async function ensureShopOrdersTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS shop_orders (
      id            SERIAL PRIMARY KEY,
      name          TEXT NOT NULL,
      phone         TEXT NOT NULL,
      email         TEXT NOT NULL,
      items         JSONB NOT NULL,
      amount        INTEGER NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      mp_payment_id TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
}
