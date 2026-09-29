/* ACADEMY — Venta de cursos y alta de miembros
   ------------------------------------------------------------------
   Todo lo que convierte un pago (o una invitación del dueño) en acceso a la
   Academy vive acá, en un solo archivo, por la misma razón que _bookingLife
   concentra lo que dispara un cambio de estado de una reserva: si el acceso
   se concede en dos lugares, tarde o temprano se concede distinto.

   No es un modo del router: el checkout del host lo carga con import()
   dinámico en tres puntos (docs/academy/PORTABLE.md §3; PimpStudio:
   api/_checkout.js, BrunettiCutz: api/mp-payments.js): el POST con
   kind:'course', la consulta de estado por ref aca-… y el webhook de Mercado
   Pago cuando external_reference empieza con "aca-". El
   import es dinámico a propósito: un error al cargar la Academy nunca puede
   tumbar el checkout de Essentials ni el catálogo de servicios, que viven en
   la misma función serverless.

   REGLAS QUE ESTE ARCHIVO NO ROMPE (SPEC §0, §6):
   - Ni el checkout ni el webhook corren DDL (ensureAcademyTables). Las tablas
     las crean el panel, `me` y el cron; si faltan (42P01), el checkout
     responde 503 "todavía no abren" y el webhook ignora el aviso.
   - El precio sale SIEMPRE de academy_courses y queda congelado en la orden.
     El webhook compara contra ese monto congelado, nunca contra el actual.
   - El nombre y el correo de la cuenta salen de la orden (lo que el cliente
     escribió y confirmó), no del pago: payer.email de Mercado Pago se guarda
     solo para que el panel marque si no coinciden.
   - Una sola sentencia (CTE) marca la orden pagada, crea o reactiva al
     miembro y le da el curso. Dos avisos del mismo pago en paralelo compiten
     por la fila de la orden; el segundo espera el candado, vuelve a evaluar
     `paid_at IS NULL`, no calza, y no hace nada.
   - La contraseña de alguien que ya eligió la suya NO se toca nunca: comprar
     un curso con el correo de otra persona no puede dejarla afuera.
   - Correos y pushes son best-effort: si fallan, el webhook responde 200 y el
   cron reintenta las credenciales. Solo un error de base responde 500.

   Prefijo `_`: no cuenta como función serverless (tope 12 del plan Hobby). */

import crypto from "node:crypto"
import * as mp from "./_academyMp.js"
import * as academyEmail from "./_academyEmail.js"
import { generateTempPassword, hashPasswordAsync } from "./_academyPassword.js"
import { HOST, siteUrl, notifyStaff } from "./_academyHost.js"
import { HttpError, getSettings, memberPublicFromRow, levelFor } from "./_academyHttp.js"
import { cleanText, slugify } from "./_academyText.js"

/* ── Inyección para los tests ─────────────────────────────────────────────
   scripts/test-academy corre este archivo contra PGlite sin red. Con
   __setTestDeps({ mp, email }) reemplaza, función por función:
     mp:    createPreference, fetchPayment, searchPayments, mpConfigured
     email: sendAcademyAccessEmail, sendAcademyAlreadyEmail,
            sendAcademyResetEmail, sendAcademyEmailChangedNotice y, si se
            quiere saltar el presupuesto diario, sendAcademyEmail
   y además acepta notifyStaff (el aviso al panel del host), chat
   ({ ensureCohortChat, addToCohort, postSystemDm }) y notify ({ notify,
   notifyMany }), porque esos módulos se cargan por import() y en un test no
   tienen base propia. En producción nadie lo llama y `deps` queda vacío. */
let deps = {}
export function __setTestDeps(next = {}) {
  deps = next && typeof next === "object" ? next : {}
}

const mpApi = () => ({ ...mp, ...(deps.mp || {}) })
const mpReady = () => {
  if (deps.mp) return typeof deps.mp.mpConfigured === "function" ? Boolean(deps.mp.mpConfigured()) : true
  return mp.mpConfigured()
}
const loadChat = () => deps.chat || import("./_academyChat.js")
const loadNotify = () => deps.notify || import("./_academyNotify.js")

/* ── Constantes y utilidades ─────────────────────────────────────────── */

// 'aca-' + 32 hex: aleatorio (no el id correlativo, que dejaría recorrer
// órdenes ajenas) y sin datos personales adentro, a diferencia del base64
// de BrunettiCutz. No choca con los 32 hex pelados de Essentials.
const REF_RE = /^aca-[a-f0-9]{32}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/
const PANEL_URL = "/panel?tab=academy"
const CLOSED_MSG = `Las inscripciones de ${HOST.brand.short} todavía no abren`

const loginUrl = () => `${siteUrl()}${HOST.basePath}/ingreso`

// 42P01 = tabla inexistente, 42703 = columna inexistente: la Academy todavía
// no se inicializó en esta base (nadie abrió el panel ni corrió el cron).
const isMissingSchema = (err) => err?.code === "42P01" || err?.code === "42703"

const logErr = (where, err) => console.error(`[academy:provision] ${where}:`, err?.message || err)

/* Corre fn y NUNCA rechaza. Los efectos secundarios (avisos, chat, DM) se
   lanzan en paralelo con el correo de credenciales; una promesa que
   rechaza sin handler mientras se espera otra cosa es un unhandledRejection,
   y en Node eso tumba el proceso. */
const safe = (label, fn) => Promise.resolve().then(fn).catch((err) => logErr(label, err))

/* Espera como mucho `ms` y sigue. Resuelve (no rechaza) al vencer: lo que se
   corta así es siempre best-effort, y Mercado Pago da 22 s para responder. */
function withTimeout(promise, ms) {
  let timer
  const limit = new Promise((resolve) => { timer = setTimeout(() => resolve("timeout"), ms) })
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer))
}

export function normEmail(v) {
  return String(v ?? "").trim().toLowerCase()
}

export function isValidEmail(v) {
  const s = normEmail(v)
  return s.length > 0 && s.length <= 120 && EMAIL_RE.test(s)
}

// Nombre de una línea: sin saltos ni espacios repetidos.
export function cleanName(v, max = 80) {
  return cleanText(String(v ?? "").replace(/\s+/g, " "), max + 1)
}

function maskEmail(email) {
  const s = String(email ?? "").trim()
  const at = s.lastIndexOf("@")
  if (at < 1) return ""
  const local = s.slice(0, at)
  return `${local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2)}***@${s.slice(at + 1)}`
}

function formatCLP(n) {
  return "$" + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")
}

const toId = (v) => {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

// Quién hizo algo desde el panel. granted_by no tiene FK a propósito (SPEC
// §2): guarda el id del miembro admin, o el del barbero si entró con su
// sesión de panel sin fila de miembro.
export const actorId = (actor) => toId(actor?.memberId) ?? toId(actor?.barberId) ?? null

async function loadSettings(sql) {
  try {
    return (await getSettings(sql)) || {}
  } catch (err) {
    logErr("ajustes", err)
    return {}
  }
}

/* Correo con presupuesto diario (academy_email_log, SPEC §8.2). `fnName` es
   el nombre de la plantilla en _academyEmail.js. Nunca lanza: devuelve el
   mismo { ok, status, reason, skipped? } que sendViaResend. */
async function sendBudgeted(sql, kind, fnName, args, opts = {}) {
  const fn = deps.email?.[fnName] || academyEmail[fnName]
  if (typeof fn !== "function") return { ok: false, status: 0, reason: `sin plantilla ${fnName}` }
  const wrap = deps.email?.sendAcademyEmail || academyEmail.sendAcademyEmail
  try {
    const r = typeof wrap === "function" ? await wrap(sql, kind, fn, args, opts) : await fn(args)
    return r || { ok: false, status: 0, reason: "sin respuesta" }
  } catch (err) {
    return { ok: false, status: 0, reason: err?.message || "error" }
  }
}

/* ¿El envío falló por cupo (429 de Resend, tope diario propio, contador
   caído o Resend sin configurar)? Esos NO gastan uno de los 5 intentos:
   reintentar más tarde los va a arreglar, y quemar intentos dejaría al
   comprador sin acceso para siempre por un mal día de correo. Un timeout sí
   gasta: el correo pudo haber salido. Motivos: _academyEmail.js. */
const DEFER_REASONS = new Set(["rate-limited", "email-not-configured", "budget", "budget-unavailable", "no-template"])
function isDeferral(r) {
  if (!r) return false
  return Boolean(r.skipped) || r.status === 429 || DEFER_REASONS.has(r.reason)
}

/* ── Checkout: POST /api/checkout {kind:'course', …} ───────────────────── */

function parseCheckout(body) {
  const b = body && typeof body === "object" ? body : {}
  const slug = String(b.courseSlug ?? "").trim().toLowerCase()
  if (!SLUG_RE.test(slug)) return { error: "Curso inválido" }
  const modality = String(b.modality ?? "")
  if (modality !== "online" && modality !== "presencial") return { error: "Elige la modalidad del curso" }
  // Online no tiene generación: un cohortId que llegue igual se descarta,
  // para que nadie ocupe un cupo presencial pagando el precio online.
  const cohortId = modality === "presencial" ? toId(b.cohortId) : null
  if (modality === "presencial" && !cohortId) return { error: "Elige una generación", code: "generacion" }
  const name = cleanName(b.name)
  if (!name) return { error: "Indica tu nombre" }
  if (name.length > 80) return { error: "El nombre es demasiado largo (máximo 80 caracteres)" }
  const email = String(b.email ?? "").trim()
  if (!isValidEmail(email)) return { error: "Revisa tu correo", code: "correo" }
  if (normEmail(b.emailConfirm) !== normEmail(email)) return { error: "Los correos no coinciden", code: "correo_distinto" }
  if (b.acceptTerms !== true) return { error: "Debes aceptar los términos y el aviso de privacidad", code: "terminos" }
  // Teléfono opcional: si trae 9 dígitos (los últimos, como en todo el
  // sitio) liga la compra con la ficha de cliente; si no, se ignora.
  const digits = String(b.phone ?? "").replace(/\D/g, "").slice(-9)
  return { slug, modality, cohortId, name, email, emailNorm: normEmail(email), phone: digits.length === 9 ? digits : null }
}

export async function handleCourseCheckout(sql, req, res) {
  res.setHeader("Cache-Control", "no-store")
  const input = parseCheckout(req.body)
  if (input.error) return res.status(400).json({ ok: false, error: input.error, ...(input.code ? { code: input.code } : {}) })
  const { slug, modality, cohortId, name, email, emailNorm, phone } = input

  try {
    /* Pre-chequeos de solo lectura, antes de crear nada. El de "ya lo
       tienes" evita el cobro doble más común: alguien que no encuentra el
       correo de acceso y vuelve a comprar. */
    const [pre] = await sql`
      SELECT m.status,
             EXISTS (
               SELECT 1 FROM academy_grants g JOIN academy_courses c ON c.id = g.course_id
               WHERE g.member_id = m.id AND g.state = 'activa' AND c.slug = ${slug}
             ) AS owned
      FROM academy_members m
      WHERE m.email_norm = ${emailNorm}
    `
    if (pre?.status === "expulsado") {
      return res.status(409).json({ ok: false, error: "No podemos procesar esta compra, escríbenos", code: "bloqueado" })
    }
    if (pre?.owned) {
      return res.status(409).json({ ok: false, error: "Ya tienes este curso", code: "ya_tienes" })
    }

    /* La orden nace en UNA sentencia y solo si el curso se puede vender:
       publicado, con la venta abierta y con precio para esa modalidad. El
       precio se copia de la base a la orden (amount) y ahí queda congelado.
       Presencial exige además una generación de ese curso, abierta y con
       cupo: cuentan los alumnos activos del grupo (pagados o agregados a
       mano) más las órdenes pendientes de los últimos 30 minutos, para que
       dos personas no paguen el último cupo a la vez. Aun así puede
       sobrevenderse por uno en una carrera exacta; se acepta, igual que el
       stock negativo de Essentials: la plata entró y el panel lo muestra. */
    const ref = `aca-${crypto.randomBytes(16).toString("hex")}`
    const [order] = await sql`
      INSERT INTO academy_orders
        (public_ref, course_id, cohort_id, modality, title_snapshot, amount, name, email, email_norm, phone, user_id, status)
      SELECT ${ref}, c.id, k.id, ${modality}::text, c.title,
             CASE WHEN ${modality}::text = 'online' THEN c.price_online ELSE c.price_presencial END,
             ${name}, ${email}, ${emailNorm}, ${phone}::text,
             (SELECT u.id FROM users u WHERE ${phone}::text IS NOT NULL AND u.phone = ${phone}::text ORDER BY u.id LIMIT 1),
             'pendiente'
      FROM academy_courses c
      LEFT JOIN academy_cohorts k
        ON k.id = ${cohortId}::int AND k.course_id = c.id AND k.archived_at IS NULL
      WHERE c.slug = ${slug} AND c.sales_open AND c.published
        AND (CASE WHEN ${modality}::text = 'online' THEN c.price_online ELSE c.price_presencial END) IS NOT NULL
        AND (${modality}::text = 'online' OR (
              k.id IS NOT NULL AND k.sales_open
              AND (k.seats IS NULL OR (
                (SELECT count(*) FROM academy_cohort_members cm
                   JOIN academy_members mm ON mm.id = cm.member_id
                  WHERE cm.cohort_id = k.id AND mm.role = 'miembro' AND mm.status = 'activo')
                + (SELECT count(*) FROM academy_orders po
                    WHERE po.cohort_id = k.id AND po.status = 'pendiente'
                      AND po.created_at > NOW() - interval '30 minutes')
              ) < k.seats)))
      RETURNING id, amount, title_snapshot
    `
    if (!order) {
      if (modality === "presencial") {
        // Solo para dar el mensaje correcto: ¿el curso se vende y la
        // generación está abierta, pero llena?
        const [why] = await sql`
          SELECT (c.sales_open AND c.published AND c.price_presencial IS NOT NULL) AS course_ok,
                 COALESCE(k.sales_open, false) AS cohort_open, k.seats
          FROM academy_courses c
          LEFT JOIN academy_cohorts k ON k.id = ${cohortId}::int AND k.course_id = c.id AND k.archived_at IS NULL
          WHERE c.slug = ${slug}
        `
        if (why?.course_ok && why.cohort_open && why.seats != null) {
          return res.status(409).json({ ok: false, error: "No quedan cupos en esa generación", code: "sin_cupos" })
        }
      }
      return res.status(409).json({ ok: false, error: "Ese curso no está disponible", code: "no_disponible" })
    }

    let preference
    try {
      preference = await mpApi().createPreference({
        ref,
        items: [{ productId: `course:${slug}:${modality}`, name: order.title_snapshot, qty: 1, unitPrice: Number(order.amount) }],
        payer: { name, email },
        backUrl: mp.backUrlFor(ref),
        notificationUrl: mp.notificationUrl(),
        metadata: { kind: "course", ref },
        statementDescriptor: HOST.statementDescriptor,
      })
    } catch (err) {
      logErr(`preferencia orden ${order.id}`, err)
      // Anulada y no huérfana: sin preferencia nadie la va a poder pagar.
      await sql`UPDATE academy_orders SET status = 'anulada', updated_at = NOW() WHERE id = ${order.id} AND status = 'pendiente'`
        .catch((e) => logErr("anular orden", e))
      return res.status(502).json({ ok: false, error: "Mercado Pago no respondió. Intenta de nuevo." })
    }

    await sql`
      UPDATE academy_orders SET mp_preference_id = ${String(preference?.preferenceId || "").slice(0, 80) || null}, updated_at = NOW()
      WHERE id = ${order.id}
    `
    return res.json({ ok: true, ref, total: Number(order.amount), initPoint: preference?.initPoint })
  } catch (err) {
    if (isMissingSchema(err)) return res.status(503).json({ ok: false, error: CLOSED_MSG, code: "cerrado" })
    logErr("checkout", err)
    return res.status(500).json({ ok: false, error: "No se pudo iniciar el pago" })
  }
}

/* ── Estado de la orden: GET /api/checkout?ref=aca-… ─────────────────────
   Público (el cliente vuelve de Mercado Pago sin sesión), y por eso solo
   devuelve lo que esa persona ya sabe: qué compró, si se pagó y a qué
   correo va el acceso, enmascarado. Nunca el miembro, el grant ni nada de
   la cuenta.

   Autocuración: si la orden sigue pendiente 20 s después de creada, se le
   pregunta a Mercado Pago por la referencia (como mucho una vez cada 15 s
   por ref en esta instancia). Es seguro porque la verdad sigue saliendo de
   la API de Mercado Pago, no de lo que traiga la URL de vuelta, y rescata
   el caso en que el webhook no llegó o llegó con la firma vencida. */
const healAt = new Map()
function claimHeal(ref) {
  const now = Date.now()
  if (now - (healAt.get(ref) || 0) < 15000) return false
  healAt.set(ref, now)
  if (healAt.size > 500) {
    for (const [k, t] of healAt) if (now - t > 60000) healAt.delete(k)
  }
  return true
}

async function readOrderStatus(sql, ref) {
  const [row] = await sql`
    SELECT o.status, o.amount, o.modality, o.email, o.title_snapshot, c.slug,
           EXTRACT(EPOCH FROM (NOW() - o.created_at))::int AS age_sec
    FROM academy_orders o JOIN academy_courses c ON c.id = o.course_id
    WHERE o.public_ref = ${ref}
  `
  return row || null
}

export async function handleCourseStatus(sql, req, res) {
  res.setHeader("Cache-Control", "no-store")
  const ref = String(req.query?.ref || "")
  if (!REF_RE.test(ref)) return res.status(400).json({ ok: false, error: "Referencia inválida" })
  try {
    let order = await readOrderStatus(sql, ref)
    if (!order) return res.status(404).json({ ok: false, error: "Orden no encontrada" })
    if (order.status === "pendiente" && Number(order.age_sec) > 20 && mpReady() && claimHeal(ref)) {
      try {
        await reconcileOrder(sql, ref)
        order = (await readOrderStatus(sql, ref)) || order
      } catch (err) {
        logErr("autocuración", err)
      }
    }
    return res.json({
      ok: true,
      kind: "course",
      ref,
      status: order.status,
      course: { slug: order.slug, title: order.title_snapshot },
      modality: order.modality,
      total: Number(order.amount),
      emailMasked: maskEmail(order.email),
    })
  } catch (err) {
    // Sin tablas no puede existir ninguna orden "aca-": 404 dice la verdad.
    if (isMissingSchema(err)) return res.status(404).json({ ok: false, error: "Orden no encontrada" })
    logErr("estado", err)
    return res.status(503).json({ ok: false, error: "No se pudo consultar la orden" })
  }
}

/* ── Webhook ──────────────────────────────────────────────────────────────
   El webhook del host ya le pidió el pago a Mercado Pago (y, donde existe,
   validó la firma x-signature): `payment` es la verdad, no el body del aviso.
   Error de base → 500 (Mercado Pago reintenta y la conciliación del cron
   también lo cubre). Correo o push que fallan → 200. */
export async function handleAcademyPayment(sql, payment, paymentId, res) {
  try {
    const result = await applyPayment(sql, payment, { paymentId })
    return res.json({ ok: true, ...result })
  } catch (err) {
    logErr("webhook", err)
    return res.status(500).json({ ok: false })
  }
}

/* verifyCoursePayment(order, payment) → { ok, reason }
   Una sola función para el webhook, la conciliación y el botón "Verificar
   pago" del panel: si cada camino validara cosas distintas, el que menos
   valida sería la puerta. El monto se compara contra el CONGELADO en la
   orden. En producción un pago de prueba (live_mode false) no da acceso:
   queda en revisión, para que un token TEST- olvidado en Vercel no regale
   cursos. */
export function verifyCoursePayment(order, payment) {
  if (String(payment?.external_reference || "") !== String(order?.public_ref || "")) return { ok: false, reason: "referencia" }
  if (payment?.currency_id !== "CLP") return { ok: false, reason: "moneda" }
  const paid = Number(payment?.transaction_amount)
  if (!Number.isFinite(paid) || paid < Number(order?.amount)) return { ok: false, reason: "monto" }
  if (process.env.VERCEL_ENV === "production" && payment?.live_mode !== true) return { ok: false, reason: "modo_prueba" }
  return { ok: true, reason: null }
}

const REVIEW_TEXT = {
  referencia: "la referencia no coincide",
  moneda: "el pago no está en pesos chilenos",
  monto: "el monto pagado es menor al precio",
  modo_prueba: "es un pago de prueba",
}

async function loadOrder(sql, ref) {
  const [row] = await sql`
    SELECT id, public_ref, course_id, cohort_id, modality, title_snapshot, amount, name, email, email_norm,
           status, mp_payment_id, paid_at, refunded_at
    FROM academy_orders WHERE public_ref = ${ref}
  `
  return row || null
}

/* Aplica el estado de UN pago de Mercado Pago a su orden (tabla §6.2).
   Lo comparten el webhook, la conciliación y el estado de la página de
   gracias. Lanza solo si falla la base. */
async function applyPayment(sql, payment, { paymentId = null } = {}) {
  const ref = String(payment?.external_reference || "")
  if (!REF_RE.test(ref)) return { ignored: "referencia" }
  const pid = String(payment?.id ?? paymentId ?? "").trim().slice(0, 40)
  if (!pid) return { ignored: "sin id" }

  let order
  try {
    order = await loadOrder(sql, ref)
  } catch (err) {
    // Sin tablas no hay órdenes nuestras: reintentar no lo va a arreglar.
    if (isMissingSchema(err)) return { ignored: "academy sin inicializar" }
    throw err
  }
  if (!order) return { ignored: "orden desconocida" }

  const status = String(payment?.status || "")
  const detail = String(payment?.status_detail || "")
  const mpStatus = status.slice(0, 24) || null

  if (status === "approved") return approvedPayment(sql, order, payment, pid)

  /* Pendiente, en proceso, autorizado o rechazado: la orden SIGUE pendiente.
     En Checkout Pro el cliente puede fallar con una tarjeta y pagar con otra
     sobre la misma preferencia; anular acá (como hace hoy Essentials, bug B1)
     dejaría sin acceso a quien pagó en el segundo intento. */
  if (["pending", "in_process", "authorized", "rejected"].includes(status)) {
    await sql`
      UPDATE academy_orders SET mp_last_status = ${mpStatus}, updated_at = NOW()
      WHERE id = ${order.id} AND status = 'pendiente'
    `
    return { action: "pendiente", status }
  }

  // Cancelado: se anula, pero el CTE de acceso acepta 'anulada', así que un
  // pago aprobado que llegue después igual da el curso.
  if (status === "cancelled") {
    await sql`
      UPDATE academy_orders SET status = 'anulada', mp_last_status = 'cancelled', updated_at = NOW()
      WHERE id = ${order.id} AND status = 'pendiente'
    `
    return { action: "anulada", status }
  }

  if (status === "refunded" || (status === "charged_back" && (detail === "settled" || detail === "in_process"))) {
    // Solo revoca el pago que DIO el acceso. El reembolso de un pago
    // duplicado (lo que el panel pide hacer) no le quita nada a nadie.
    if (order.mp_payment_id !== pid) {
      await sql`
        UPDATE academy_orders SET mp_last_status = ${mpStatus}, updated_at = NOW()
        WHERE id = ${order.id} AND status = 'pendiente'
      `
      return { action: "sin_cambios", status }
    }
    const out = await revokeOrder(sql, order, pid, status === "refunded" ? "reembolso" : "contracargo", mpStatus)
    return { action: out.revoked ? "revocado" : "sin_cambios", status }
  }

  if (status === "charged_back" || status === "in_mediation") {
    await safe("aviso disputa", () => alertAdmins(sql, {
      title: status === "in_mediation" ? "Academy: pago en disputa" : "Academy: contracargo",
      body: `${order.title_snapshot} · ${formatCLP(order.amount)} · revísalo en Mercado Pago`,
      tag: `academy-order-${order.id}`,
    }))
    return { action: "alerta", status }
  }

  await sql`
    UPDATE academy_orders SET mp_last_status = ${mpStatus}, updated_at = NOW()
    WHERE id = ${order.id} AND status = 'pendiente'
  `
  return { action: "ignorado", status }
}

async function approvedPayment(sql, order, payment, pid) {
  const refundedPart = Number(payment?.transaction_amount_refunded || 0)

  // Pago aprobado sobre una orden que ya tiene OTRO pago: el cliente pagó
  // dos veces (dos pestañas, o volvió a pagar una orden reembolsada). No se
  // concede nada de nuevo; el dueño decide y reembolsa.
  if (order.mp_payment_id && order.mp_payment_id !== pid) {
    await safe("aviso duplicado", () => alertAdmins(sql, {
      title: "Academy: pago duplicado",
      body: `${order.title_snapshot} · ${formatCLP(payment?.transaction_amount)} · la orden ya tenía un pago: reembolsa el ${pid}`,
      tag: `academy-dup-${pid}`,
    }))
    return { action: "duplicado" }
  }

  const payerEmail = String(payment?.payer?.email || "").trim().slice(0, 200) || null
  const live = typeof payment?.live_mode === "boolean" ? payment.live_mode : null

  const verify = verifyCoursePayment(order, payment)
  if (!verify.ok) {
    const flagged = await sql`
      UPDATE academy_orders
         SET status = 'revision', mp_payment_id = ${pid}, mp_last_status = 'approved',
             mp_payer_email = ${payerEmail}, live_mode = ${live}::boolean, updated_at = NOW()
       WHERE id = ${order.id} AND status IN ('pendiente', 'anulada') AND paid_at IS NULL
      RETURNING id
    `
    if (flagged.length) {
      await safe("aviso revisión", () => alertAdmins(sql, {
        title: "Academy: pago por revisar",
        body: `${order.title_snapshot} · ${REVIEW_TEXT[verify.reason] || verify.reason} · revisa el pedido en el panel`,
        tag: `academy-order-${order.id}`,
      }))
    }
    return { action: "revision", reason: verify.reason }
  }

  const paidAmount = Math.round(Number(payment.transaction_amount))

  /* El acceso en UNA sentencia (SPEC §6.3). Una CTE solo ve lo que otra
     devolvió por RETURNING, no sus cambios en las tablas: por eso cada paso
     se encadena por RETURNING y no por una lectura. Cero filas = otro aviso
     ya la procesó (o la orden no está pendiente/anulada). */
  const rows = await sql`
    WITH o AS (
      UPDATE academy_orders
         SET status = 'pagada', mp_payment_id = ${pid}, mp_last_status = 'approved', paid_at = NOW(),
             paid_amount = ${paidAmount}::int, mp_payer_email = ${payerEmail}, live_mode = ${live}::boolean,
             updated_at = NOW()
       WHERE public_ref = ${order.public_ref} AND status IN ('pendiente', 'anulada') AND paid_at IS NULL
      RETURNING id, course_id, cohort_id, name, email, email_norm, phone
    ), m AS (
      INSERT INTO academy_members (email_norm, email, name, phone, status, role, source, must_change_password)
      SELECT email_norm, email, name, phone, 'activo', 'miembro', 'pago', true FROM o
      ON CONFLICT (email_norm) DO UPDATE
        SET status = CASE WHEN academy_members.status = 'cancelado' THEN 'activo' ELSE academy_members.status END,
            updated_at = NOW()
      RETURNING id, status, password_set_at, (xmax = 0) AS nuevo
    ), g AS (
      INSERT INTO academy_grants (member_id, course_id, order_id, source, state)
      SELECT m.id, o.course_id, o.id, 'pago', CASE WHEN m.status = 'expulsado' THEN 'revision' ELSE 'activa' END
      FROM o, m
      ON CONFLICT (order_id) DO NOTHING
      RETURNING id, state
    ), cm AS (
      INSERT INTO academy_cohort_members (cohort_id, member_id)
      SELECT o.cohort_id, m.id FROM o, m WHERE o.cohort_id IS NOT NULL
      ON CONFLICT DO NOTHING RETURNING cohort_id
    )
    SELECT o.id AS order_id, m.id AS member_id, m.nuevo, m.status, m.password_set_at, g.id AS grant_id, g.state
    FROM o, m LEFT JOIN g ON true
  `

  let row = rows[0] || null
  const fresh = Boolean(row)
  if (!row) {
    /* Ya procesada. Igual se sigue con los pasos idempotentes (credenciales,
       chat del grupo): si una ejecución anterior se cayó entre la sentencia
       y el correo, este reintento de Mercado Pago lo termina. */
    const [again] = await sql`
      SELECT o.id AS order_id, g.id AS grant_id, g.state, m.id AS member_id, m.status, m.password_set_at, false AS nuevo
      FROM academy_orders o
      JOIN academy_grants g ON g.order_id = o.id
      JOIN academy_members m ON m.id = g.member_id
      WHERE o.id = ${order.id} AND o.status = 'pagada' AND o.mp_payment_id = ${pid}
    `
    if (!again) return { action: "sin_cambios" }
    row = again
  }

  const post = await afterPurchase(sql, { order, row, fresh, paidAmount })
  if (refundedPart > 0) {
    // Reembolso parcial: el pago sigue aprobado, así que el acceso se queda.
    await safe("aviso reembolso parcial", () => alertAdmins(sql, {
      title: "Academy: reembolso parcial",
      body: `${order.title_snapshot} · se devolvieron ${formatCLP(refundedPart)} · el acceso sigue activo`,
      tag: `academy-order-${order.id}`,
    }))
  }
  return { action: "acceso", applied: fresh, credentials: post.credentials }
}

/* Pasos posteriores al CTE de compra, separados e idempotentes.
   Los efectos secundarios de una compra NUEVA (aviso al panel, DM de
   bienvenida, notificaciones internas) se lanzan en paralelo con el correo
   de acceso y con tope de tiempo: el webhook tiene 22 s en total. */
async function afterPurchase(sql, { order, row, fresh, paidAmount }) {
  const memberId = Number(row.member_id)
  const memberActive = row.status === "activo"
  const grantActive = memberActive && row.state === "activa"
  const out = { credentials: "no_aplica" }

  await safe("handle", () => ensureHandle(sql, memberId))
  await safe("ficha", () => linkOrderProfile(sql, memberId, order.id))
  if (order.cohort_id && memberActive) await safe("chat del grupo", () => joinCohortChat(sql, order.cohort_id, memberId))

  const settings = await loadSettings(sql)
  const side = []
  if (fresh) {
    const modality = order.modality === "presencial" ? " · Presencial" : ""
    side.push(safe("aviso compra", () => alertAdmins(sql, {
      title: "Nueva inscripción Academy",
      body: `${order.title_snapshot}${modality} · ${formatCLP(paidAmount ?? order.amount)}`,
      tag: `academy-order-${order.id}`,
    })))
    if (row.state === "revision") {
      side.push(safe("aviso expulsado", () => alertAdmins(sql, {
        title: "Academy: compra de un miembro expulsado",
        body: `${order.title_snapshot} · el acceso quedó en revisión: decide si reembolsar`,
        tag: `academy-order-${order.id}-revision`,
      })))
    }
    if (grantActive) {
      side.push(safe("duplicado", () => alertIfDuplicateCourse(sql, { memberId, courseId: order.course_id, grantId: row.grant_id, title: order.title_snapshot })))
      side.push(safe("notificaciones", () => notifyGranted(sql, { memberId, courses: [{ id: order.course_id, title: order.title_snapshot }], nuevo: Boolean(row.nuevo) })))
      if (row.nuevo) side.push(safe("autodm", () => sendAutoDm(sql, memberId, settings)))
    }
    if (order.cohort_id && memberActive) side.push(safe("aviso grupo", () => notifyCohortJoin(sql, [memberId], order.cohort_id)))
  }

  if (grantActive) {
    try {
      if (row.password_set_at) {
        // Ya tiene su contraseña: jamás se le resetea. Se le avisa del curso
        // nuevo, una sola vez por grant (notified_at).
        out.credentials = "cuenta_existente"
        await sendAlreadyAccess(sql, { grantIds: [row.grant_id], memberId, course: order.title_snapshot, critical: true })
      } else if (settings.autoprovision === false) {
        // El dueño apagó el alta automática: el acceso queda dado, pero las
        // credenciales las manda él desde el panel ("Reenviar acceso").
        out.credentials = "pendientes"
      } else {
        // El correo de acceso cuenta como aviso de este grant.
        await sql`UPDATE academy_grants SET notified_at = NOW() WHERE id = ${row.grant_id} AND notified_at IS NULL`
        if (fresh) await rearmIfStale(sql, memberId)
        out.credentials = await claimAndSendCredentials(sql, memberId, { course: order.title_snapshot })
      }
    } catch (err) {
      // El cron reintenta las credenciales pendientes; el pago ya quedó.
      logErr(`credenciales orden ${order.id}`, err)
      out.credentials = "pendientes"
    }
  }

  if (side.length) await Promise.allSettled(side.map((p) => withTimeout(p, 6000)))
  return out
}

/* ── Credenciales (SPEC §6.4) ─────────────────────────────────────────────
   "Reclamar primero": la fila del miembro se marca con credentials_claimed_at
   ANTES de generar la contraseña, y solo quien gana ese UPDATE sigue. Dos
   avisos simultáneos del mismo pago, o el webhook y el cron a la vez, no
   pueden mandar dos correos con dos contraseñas distintas. El reclamo dura
   10 minutos: si el proceso muere a mitad de camino, pasado ese rato el
   cron lo vuelve a intentar.

   Devuelve 'enviadas' | 'pendientes' | 'cuenta_existente' | 'no_aplica'. */
export async function claimAndSendCredentials(sql, memberId, { course } = {}) {
  const id = toId(memberId)
  if (!id) return "no_aplica"

  /* La subconsulta `prev` lee la fila ANTES del UPDATE: se usa solo para
     saber cuánto duró la espera anterior por cupo de correo y alargar la
     siguiente (1 h → 3 h → las 08:00 de Santiago). */
  const [claim] = await sql`
    UPDATE academy_members m
       SET credentials_claimed_at = NOW(), credentials_attempts = m.credentials_attempts + 1, updated_at = NOW()
      FROM (SELECT credentials_claimed_at AS prev_claimed_at FROM academy_members WHERE id = ${id}) prev
     WHERE m.id = ${id} AND m.status = 'activo' AND m.role <> 'propietario' AND m.password_set_at IS NULL
       AND m.credentials_sent_at IS NULL AND m.credentials_attempts < 5
       AND (m.credentials_retry_at IS NULL OR m.credentials_retry_at <= NOW())
       AND (m.credentials_claimed_at IS NULL OR m.credentials_claimed_at < NOW() - interval '10 minutes')
       AND EXISTS (SELECT 1 FROM academy_grants g WHERE g.member_id = ${id} AND g.state = 'activa')
    RETURNING to_char(m.credentials_claimed_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS') AS claim_key,
              m.email, m.name,
              (m.credentials_retry_at IS NOT NULL) AS deferred_before,
              EXTRACT(EPOCH FROM (m.credentials_retry_at - prev.prev_claimed_at))::int AS prev_delay,
              EXISTS (SELECT 1 FROM academy_grants g WHERE g.member_id = m.id AND g.state = 'activa' AND g.source = 'pago') AS paid
  `
  if (!claim) return credentialsState(sql, id)

  let temp
  try {
    temp = generateTempPassword()
    // Se guarda hasheada en su forma canónica (sin guiones, mayúsculas): el
    // login acepta que la escriban con guiones, espacios o en minúsculas.
    const hash = await hashPasswordAsync(temp.canonical)
    const armed = await sql`
      UPDATE academy_members
         SET password_hash = ${hash}, must_change_password = true,
             temp_password_expires_at = NOW() + interval '72 hours', updated_at = NOW()
       WHERE id = ${id} AND password_set_at IS NULL
         AND to_char(credentials_claimed_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS') = ${claim.claim_key}
      RETURNING id
    `
    if (!armed.length) return "pendientes"
  } catch (err) {
    logErr(`contraseña temporal miembro ${id}`, err)
    return "pendientes"
  }

  // Crítico solo si es una compra: el acceso que alguien pagó nunca espera
  // al presupuesto diario de correos. Invitaciones e importaciones sí.
  const sent = await sendBudgeted(sql, "credentials", "sendAcademyAccessEmail", {
    to: claim.email,
    name: claim.name,
    tempPassword: temp.display,
    loginUrl: loginUrl(),
    course: course || null,
    idempotencyKey: `aca-cred-${id}-${claim.claim_key}`,
  }, { critical: Boolean(claim.paid) })
  temp = null

  if (sent?.ok) {
    await sql`
      UPDATE academy_members SET credentials_sent_at = NOW(), credentials_retry_at = NULL, updated_at = NOW()
      WHERE id = ${id} AND to_char(credentials_claimed_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS') = ${claim.claim_key}
    `
    return "enviadas"
  }

  logErr(`correo de acceso miembro ${id}`, `${sent?.status || 0} ${sent?.reason || ""}`)
  if (isDeferral(sent)) {
    // Cupo: se devuelve el intento y se espera. 0 = primera espera (1 h),
    // 1 = la anterior fue corta (3 h), 2 = ya se esperó 3 h (08:00 Santiago,
    // la primera pasada del cron del día siguiente).
    const prevDelay = Number(claim.prev_delay)
    const level = !claim.deferred_before ? 0 : (Number.isFinite(prevDelay) && prevDelay > 5400 ? 2 : 1)
    await sql`
      UPDATE academy_members
         SET credentials_attempts = GREATEST(credentials_attempts - 1, 0),
             credentials_retry_at = CASE
               WHEN ${level}::int = 0 THEN NOW() + interval '1 hour'
               WHEN ${level}::int = 1 THEN NOW() + interval '3 hours'
               ELSE (date_trunc('day', NOW() AT TIME ZONE 'America/Santiago')
                     + CASE WHEN (NOW() AT TIME ZONE 'America/Santiago')::time < time '08:00'
                            THEN interval '8 hours' ELSE interval '32 hours' END) AT TIME ZONE 'America/Santiago'
             END,
             updated_at = NOW()
       WHERE id = ${id} AND to_char(credentials_claimed_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS') = ${claim.claim_key}
    `
  }
  return "pendientes"
}

// Por qué no se ganó el reclamo, en el mismo vocabulario del resultado.
async function credentialsState(sql, id) {
  const [m] = await sql`
    SELECT m.status, m.role, (m.password_set_at IS NOT NULL) AS has_password, (m.credentials_sent_at IS NOT NULL) AS sent,
           EXISTS (SELECT 1 FROM academy_grants g WHERE g.member_id = m.id AND g.state = 'activa') AS has_grant
    FROM academy_members m WHERE m.id = ${id}
  `
  if (!m) return "no_aplica"
  if (m.has_password) return "cuenta_existente"
  if (m.status !== "activo" || m.role === "propietario" || !m.has_grant) return "no_aplica"
  return m.sent ? "enviadas" : "pendientes"
}

/* Re-armar (SPEC §6.4): deja al miembro como si nunca se le hubieran
   mandado credenciales, para que el próximo claim genere una contraseña
   temporal nueva. No re-arma a quien reclamó hace menos de un minuto: dos
   clics seguidos en "Reenviar acceso" mandarían dos contraseñas distintas. */
export async function rearmCredentials(sql, memberId) {
  const rows = await sql`
    UPDATE academy_members
       SET credentials_sent_at = NULL, credentials_claimed_at = NULL, credentials_attempts = 0,
           credentials_retry_at = NULL, updated_at = NOW()
     WHERE id = ${toId(memberId)} AND password_set_at IS NULL
       AND (credentials_claimed_at IS NULL OR credentials_claimed_at < NOW() - interval '1 minute')
    RETURNING id
  `
  return rows.length > 0
}

/* Re-arme automático al comprar/recibir un curso nuevo, solo si lo que tiene
   ya no le sirve: la contraseña temporal vence en menos de 48 h (o venció),
   o se agotaron los 5 intentos. Sin esto, alguien reembolsado que vuelve a
   comprar semanas después, sin haber elegido nunca su contraseña, quedaría
   con credentials_sent_at puesto y no recibiría nada. */
async function rearmIfStale(sql, memberId) {
  await sql`
    UPDATE academy_members
       SET credentials_sent_at = NULL, credentials_claimed_at = NULL, credentials_attempts = 0,
           credentials_retry_at = NULL, updated_at = NOW()
     WHERE id = ${memberId} AND password_set_at IS NULL AND (
           (credentials_sent_at IS NOT NULL
             AND (temp_password_expires_at IS NULL OR temp_password_expires_at < NOW() + interval '48 hours'))
        OR (credentials_sent_at IS NULL AND credentials_attempts >= 5))
  `
}

/* "Ya tienes acceso a <curso>": para quien ya tiene contraseña. Se reclama
   por grant (notified_at IS NULL) para mandarlo una sola vez aunque el aviso
   de Mercado Pago llegue tres veces; si el envío falla se suelta el reclamo,
   y el próximo aviso lo reintenta. */
async function sendAlreadyAccess(sql, { grantIds, memberId, course, critical = false }) {
  const ids = (grantIds || []).map(toId).filter(Boolean)
  if (!ids.length) return false
  const claimed = await sql`
    UPDATE academy_grants SET notified_at = NOW(), updated_at = NOW()
    WHERE id = ANY(${ids}::int[]) AND notified_at IS NULL
    RETURNING id
  `
  if (!claimed.length) return false
  const [m] = await sql`SELECT email, name FROM academy_members WHERE id = ${memberId} AND status = 'activo'`
  if (!m) return false
  const r = await sendBudgeted(sql, "already", "sendAcademyAlreadyEmail", {
    to: m.email, name: m.name, course, loginUrl: loginUrl(),
    idempotencyKey: `aca-ya-${claimed.map((c) => c.id).join("-")}`.slice(0, 200),
  }, { critical })
  if (!r?.ok) {
    await sql`UPDATE academy_grants SET notified_at = NULL WHERE id = ANY(${claimed.map((c) => c.id)}::int[])`
      .catch((err) => logErr("soltar aviso", err))
  }
  return Boolean(r?.ok)
}

/* ── Reembolsos y contracargos (SPEC §6.5) ─────────────────────────────────
   Una sentencia: orden → reembolsada, sus grants → revocados, y el miembro →
   cancelado (con session_version+1, que cierra sus sesiones) salvo que sea
   propietario/admin o le quede OTRO grant activo.
   ⚠️ Trampa del snapshot: dentro de un WITH, las subconsultas ven la base
   como estaba ANTES de la sentencia, así que el EXISTS todavía ve como
   'activa' el grant que se está revocando. Por eso excluye esa orden (o
   ese grant) de forma explícita. */
async function revokeOrder(sql, order, pid, reason, mpStatus) {
  const rows = await sql`
    WITH o AS (
      UPDATE academy_orders
         SET status = 'reembolsada', refunded_at = NOW(), refund_reason = ${reason},
             mp_last_status = ${mpStatus}, updated_at = NOW()
       WHERE public_ref = ${order.public_ref} AND mp_payment_id = ${pid} AND refunded_at IS NULL
      RETURNING id, title_snapshot, amount
    ), g AS (
      UPDATE academy_grants
         SET state = 'revocada', revoked_at = NOW(), revoke_reason = ${reason}, updated_at = NOW()
        FROM o
       WHERE academy_grants.order_id = o.id AND academy_grants.state <> 'revocada'
      RETURNING academy_grants.member_id, o.id AS order_id
    ), mm AS (
      UPDATE academy_members m
         SET status = CASE
               WHEN m.role IN ('propietario', 'admin') THEN m.status
               WHEN EXISTS (SELECT 1 FROM academy_grants x WHERE x.member_id = m.id AND x.state = 'activa'
                             AND x.order_id IS DISTINCT FROM g.order_id) THEN m.status
               ELSE 'cancelado' END,
             session_version = CASE
               WHEN m.role IN ('propietario', 'admin') THEN m.session_version
               WHEN EXISTS (SELECT 1 FROM academy_grants x WHERE x.member_id = m.id AND x.state = 'activa'
                             AND x.order_id IS DISTINCT FROM g.order_id) THEN m.session_version
               ELSE m.session_version + 1 END,
             updated_at = NOW()
        FROM g
       WHERE m.id = g.member_id AND m.status = 'activo'
      RETURNING m.id, m.status
    )
    SELECT o.id AS order_id, o.title_snapshot, o.amount,
           (SELECT count(*)::int FROM g) AS grants,
           COALESCE((SELECT array_agg(mm.id) FROM mm WHERE mm.status = 'cancelado'), '{}'::int[]) AS cancelled
    FROM o
  `
  const row = rows[0]
  if (!row) return { revoked: false }
  const cancelled = (row.cancelled || []).map(Number).filter(Boolean)
  await dropPushSubs(sql, cancelled)
  await safe("aviso revocado", () => alertAdmins(sql, {
    title: "Academy: acceso revocado",
    body: `${row.title_snapshot} · ${formatCLP(row.amount)} · ${reason}`,
    tag: `academy-order-${row.order_id}`,
  }))
  return { revoked: true, grants: row.grants, cancelled }
}

/* Revocación manual desde el panel (motivo "manual: …"). Misma regla de
   miembro que el reembolso, keyed por grant en vez de por orden. La orden
   (si la hay) no se toca: devolver la plata es otra decisión. */
export async function revokeGrant(sql, grantId, reason, actor = null) {
  const id = toId(grantId)
  if (!id) return { revoked: false, found: false }
  const why = cleanText(reason || "manual", 300) || "manual"
  const rows = await sql`
    WITH g AS (
      UPDATE academy_grants
         SET state = 'revocada', revoked_at = NOW(), revoke_reason = ${why}, updated_at = NOW()
       WHERE id = ${id} AND state <> 'revocada'
      RETURNING id, member_id
    ), mm AS (
      UPDATE academy_members m
         SET status = CASE
               WHEN m.role IN ('propietario', 'admin') THEN m.status
               WHEN EXISTS (SELECT 1 FROM academy_grants x WHERE x.member_id = m.id AND x.state = 'activa' AND x.id <> g.id) THEN m.status
               ELSE 'cancelado' END,
             session_version = CASE
               WHEN m.role IN ('propietario', 'admin') THEN m.session_version
               WHEN EXISTS (SELECT 1 FROM academy_grants x WHERE x.member_id = m.id AND x.state = 'activa' AND x.id <> g.id) THEN m.session_version
               ELSE m.session_version + 1 END,
             updated_at = NOW()
        FROM g
       WHERE m.id = g.member_id AND m.status = 'activo'
      RETURNING m.id, m.status
    )
    SELECT g.id AS grant_id, g.member_id,
           COALESCE((SELECT array_agg(mm.id) FROM mm WHERE mm.status = 'cancelado'), '{}'::int[]) AS cancelled
    FROM g
  `
  const row = rows[0]
  if (!row) {
    const [exists] = await sql`SELECT id FROM academy_grants WHERE id = ${id}`
    return { revoked: false, found: Boolean(exists) }
  }
  const cancelled = (row.cancelled || []).map(Number).filter(Boolean)
  await dropPushSubs(sql, cancelled)
  console.log(`[academy:provision] grant ${id} revocado por ${actorId(actor) ?? "sistema"}`)
  return { revoked: true, found: true, memberId: Number(row.member_id), cancelled: cancelled.length > 0 }
}

// Un miembro cancelado no debe seguir recibiendo pushes en su celular.
async function dropPushSubs(sql, memberIds) {
  if (!memberIds.length) return
  await sql`DELETE FROM academy_push_subscriptions WHERE member_id = ANY(${memberIds}::int[])`
    .catch((err) => logErr("borrar suscripciones", err))
}

/* ── Conciliación (SPEC §6.7) ──────────────────────────────────────────────
   Obligatoria, no opcional: Mercado Pago reintenta el webhook cada 15 min
   pero la firma vale 10, así que un aviso que recibió un 500 puede no volver
   a entrar nunca. El cron (y la página de gracias, y el botón del panel) le
   preguntan a Mercado Pago directamente.

   reconcileOrder(sql, ref) → { found, action, … }  — nunca inventa: si no
   hay pago en Mercado Pago, la orden queda como está. */
export async function reconcileOrder(sql, ref, { timeoutMs } = {}) {
  if (!REF_RE.test(String(ref || ""))) return { found: false }
  const order = await loadOrder(sql, ref)
  if (!order) return { found: false }
  if (!mpReady()) return { found: true, action: "sin_mercadopago", status: order.status }

  const payments = await mpApi().searchPayments(ref, timeoutMs ? { timeoutMs } : undefined)
  const pick = pickPayment(Array.isArray(payments) ? payments : [], order)
  if (!pick) {
    // Marca de "revisada": la conciliación recorre las pendientes de la
    // menos a la más recientemente revisada, así ninguna queda sin mirar.
    await sql`UPDATE academy_orders SET updated_at = NOW() WHERE id = ${order.id} AND status = 'pendiente'`
    return { found: true, action: "sin_pagos", status: order.status }
  }
  const result = await applyPayment(sql, pick)
  return { found: true, payments: payments.length, ...result }
}

/* El pago "más relevante" de una orden: el que ya le dio acceso (para ver
   si se reembolsó), si no el último aprobado, si no el más nuevo. */
function pickPayment(list, order) {
  const mine = list.filter((p) => String(p?.external_reference || "") === order.public_ref)
  if (!mine.length) return null
  if (order.mp_payment_id) {
    const own = mine.find((p) => String(p?.id) === String(order.mp_payment_id))
    if (own) return own
  }
  return mine.find((p) => p?.status === "approved") || mine[0]
}

/* reconcileAcademyOrders(sql, {limit, budgetMs}) — para el cron. Nunca lanza.
   1) pendientes de más de 5 min y menos de 3 días → Mercado Pago;
   2) pendientes de más de 3 días → anulada (un aprobado tardío igual entra);
   3) credenciales pendientes (≤5) de quien ya tiene acceso. */
export async function reconcileAcademyOrders(sql, { limit = 10, budgetMs = 8000, credentials = true } = {}) {
  const t0 = Date.now()
  const left = () => budgetMs - (Date.now() - t0)
  const out = { checked: 0, applied: 0, expired: 0, credentials: 0, stoppedEarly: false }
  try {
    const cap = Math.min(Math.max(Math.round(Number(limit) || 10), 1), 50)
    if (mpReady()) {
      const pending = await sql`
        SELECT public_ref FROM academy_orders
        WHERE status = 'pendiente' AND created_at < NOW() - interval '5 minutes' AND created_at > NOW() - interval '3 days'
        ORDER BY updated_at ASC, id ASC
        LIMIT ${cap}
      `
      for (const { public_ref: ref } of pending) {
        if (left() < 2500) { out.stoppedEarly = true; break }
        try {
          const r = await reconcileOrder(sql, ref, { timeoutMs: Math.max(1500, Math.min(8000, left() - 1000)) })
          out.checked++
          if (r.action === "acceso" && r.applied) out.applied++
        } catch (err) {
          logErr(`conciliar ${ref.slice(0, 12)}…`, err)
        }
      }
    }
    const expired = await sql`
      UPDATE academy_orders SET status = 'anulada', updated_at = NOW()
      WHERE status = 'pendiente' AND created_at <= NOW() - interval '3 days'
      RETURNING id
    `
    out.expired = expired.length
    if (credentials) {
      if (left() < 3000) out.stoppedEarly = true
      else {
        const r = await retryPendingCredentials(sql, { limit: 5, deadline: t0 + budgetMs })
        out.credentials = r.sent
        if (r.stoppedEarly) out.stoppedEarly = true
      }
    }
  } catch (err) {
    if (!isMissingSchema(err)) logErr("conciliación", err)
    out.error = isMissingSchema(err) ? "sin tablas" : "error"
  }
  return out
}

/* Credenciales que no salieron (Resend caído, cupo, proceso muerto a mitad).
   Con el alta automática apagada solo reintenta a quien el dueño ya le
   mandó el acceso una vez, o a invitados/importados (eso lo decidió él). */
export async function retryPendingCredentials(sql, { limit = 5, deadline = Date.now() + 6000 } = {}) {
  const out = { tried: 0, sent: 0, stoppedEarly: false }
  const settings = await loadSettings(sql)
  const auto = settings.autoprovision !== false
  const cap = Math.min(Math.max(Math.round(Number(limit) || 5), 1), 20)
  const rows = await sql`
    SELECT m.id,
           (SELECT string_agg(c.title, ', ' ORDER BY g.id) FROM academy_grants g JOIN academy_courses c ON c.id = g.course_id
             WHERE g.member_id = m.id AND g.state = 'activa') AS courses
    FROM academy_members m
    WHERE m.status = 'activo' AND m.role <> 'propietario' AND m.password_set_at IS NULL
      AND m.credentials_sent_at IS NULL AND m.credentials_attempts < 5
      AND (m.credentials_retry_at IS NULL OR m.credentials_retry_at <= NOW())
      AND (m.credentials_claimed_at IS NULL OR m.credentials_claimed_at < NOW() - interval '10 minutes')
      AND EXISTS (SELECT 1 FROM academy_grants g WHERE g.member_id = m.id AND g.state = 'activa'
                   AND (${auto}::boolean OR g.source <> 'pago' OR m.credentials_claimed_at IS NOT NULL))
    ORDER BY m.id
    LIMIT ${cap}
  `
  for (const r of rows) {
    if (Date.now() > deadline - 2000) { out.stoppedEarly = true; break }
    out.tried++
    try {
      const result = await claimAndSendCredentials(sql, r.id, { course: r.courses || null })
      if (result === "enviadas") out.sent++
    } catch (err) {
      logErr(`reintento credenciales ${r.id}`, err)
    }
  }
  return out
}

/* ── Alta manual: invitación, importación de BrunettiCutz, curso a mano ────
   provisionManualGrant(sql, {name, email, courseIds, cohortId, source,
   externalRef, actor}) → { member: MemberAdmin, created, credentials,
   granted:[courseId] }.
   source: 'invitacion' | 'puente' | 'manual' (del grant). external_ref es
   la llave de idempotencia de una importación ('brunetti:mp:<id>'): la misma
   referencia dos veces no crea dos grants (ON CONFLICT sobre su UNIQUE).
   Un miembro expulsado no recibe nada (quien llama lo rechaza antes). */
export async function provisionManualGrant(sql, { name, email, courseIds = [], cohortId = null, source = "invitacion", externalRef = null, actor = null } = {}) {
  const emailNorm = normEmail(email)
  if (!isValidEmail(emailNorm)) throw new HttpError(400, "Correo inválido")
  const displayName = cleanName(name)
  if (!displayName || displayName.length > 80) throw new HttpError(400, "Indica un nombre de hasta 80 caracteres")
  const ids = [...new Set((Array.isArray(courseIds) ? courseIds : []).map(toId).filter(Boolean))]
  const grantSource = ["invitacion", "puente", "manual"].includes(source) ? source : "invitacion"
  // academy_members.source no tiene 'manual': un alta a mano es una invitación.
  const memberSource = grantSource === "puente" ? "puente" : "invitacion"
  const grantedBy = actorId(actor)
  const extRef = externalRef ? String(externalRef).slice(0, 120) : null
  const cohort = toId(cohortId)

  const [row] = await sql`
    WITH m AS (
      INSERT INTO academy_members (email_norm, email, name, status, role, source, must_change_password, granted_by)
      VALUES (${emailNorm}, ${String(email).trim()}, ${displayName}, 'activo', 'miembro', ${memberSource}, true, ${grantedBy}::int)
      ON CONFLICT (email_norm) DO UPDATE
        SET status = CASE WHEN academy_members.status = 'cancelado' AND academy_members.deleted_at IS NULL
                          THEN 'activo' ELSE academy_members.status END,
            updated_at = NOW()
      RETURNING id, status, password_set_at, (xmax = 0) AS nuevo
    ), g AS (
      INSERT INTO academy_grants (member_id, course_id, external_ref, source, state, granted_by)
      SELECT m.id, c.id, ${extRef}::text, ${grantSource}::text, 'activa', ${grantedBy}::int
      FROM m JOIN academy_courses c ON c.id = ANY(${ids}::int[])
      WHERE m.status = 'activo'
        AND NOT EXISTS (SELECT 1 FROM academy_grants x WHERE x.member_id = m.id AND x.course_id = c.id AND x.state = 'activa')
      ON CONFLICT (external_ref) DO NOTHING
      RETURNING id, course_id
    ), cm AS (
      INSERT INTO academy_cohort_members (cohort_id, member_id)
      SELECT k.id, m.id FROM m JOIN academy_cohorts k ON k.id = ${cohort}::int AND k.archived_at IS NULL
      WHERE m.status = 'activo'
      ON CONFLICT DO NOTHING
      RETURNING cohort_id
    )
    SELECT m.id AS member_id, m.nuevo, m.status, (m.password_set_at IS NOT NULL) AS has_password,
           COALESCE((SELECT array_agg(g.id) FROM g), '{}'::int[]) AS grant_ids,
           COALESCE((SELECT array_agg(g.course_id) FROM g), '{}'::int[]) AS granted,
           (SELECT count(*)::int FROM cm) AS cohort_added
    FROM m
  `
  const memberId = Number(row.member_id)
  const granted = (row.granted || []).map(Number)
  const grantIds = (row.grant_ids || []).map(Number)

  if (row.status !== "activo") {
    return { member: await loadMemberAdmin(sql, memberId), created: false, credentials: "no_aplica", granted: [] }
  }

  await safe("handle", () => ensureHandle(sql, memberId))
  if (cohort) await safe("chat del grupo", () => joinCohortChat(sql, cohort, memberId))

  const courses = granted.length
    ? await sql`SELECT id, title FROM academy_courses WHERE id = ANY(${granted}::int[]) ORDER BY position, id`
    : []
  const titles = courses.map((c) => c.title).join(", ")
  const settings = await loadSettings(sql)

  const side = []
  if (courses.length) side.push(safe("notificaciones", () => notifyGranted(sql, { memberId, courses, nuevo: Boolean(row.nuevo) })))
  else if (row.nuevo) side.push(safe("notificaciones", () => notifyGranted(sql, { memberId, courses: [], nuevo: true })))
  if (row.nuevo) side.push(safe("autodm", () => sendAutoDm(sql, memberId, settings)))
  if (cohort && row.cohort_added > 0) side.push(safe("aviso grupo", () => notifyCohortJoin(sql, [memberId], cohort, grantedBy)))

  let credentials
  try {
    if (row.has_password) {
      credentials = "cuenta_existente"
      if (grantIds.length) await sendAlreadyAccess(sql, { grantIds, memberId, course: titles, critical: false })
    } else {
      if (grantIds.length) await rearmIfStale(sql, memberId)
      credentials = await claimAndSendCredentials(sql, memberId, { course: titles || null })
    }
  } catch (err) {
    logErr(`credenciales alta manual ${memberId}`, err)
    credentials = "pendientes"
  }

  if (side.length) await Promise.allSettled(side.map((p) => withTimeout(p, 6000)))
  return { member: await loadMemberAdmin(sql, memberId), created: Boolean(row.nuevo), credentials, granted }
}

/* ── Pasos auxiliares ───────────────────────────────────────────────────── */

// Handle '<slug-del-nombre>-<id>' (SPEC §3.6). El id lo hace único; si justo
// alguien eligió ese handle a mano, cae a uno aleatorio en vez de fallar.
async function ensureHandle(sql, memberId) {
  const [m] = await sql`SELECT name, handle FROM academy_members WHERE id = ${memberId}`
  if (!m || m.handle) return
  const suffix = `-${memberId}`
  const base = (slugify(m.name) || "miembro").slice(0, 40 - suffix.length).replace(/-+$/g, "") || "miembro"
  try {
    await sql`UPDATE academy_members SET handle = ${base + suffix} WHERE id = ${memberId} AND handle IS NULL`
  } catch (err) {
    if (err?.code !== "23505") throw err
    const alt = `miembro-${memberId}-${crypto.randomBytes(2).toString("hex")}`
    await sql`UPDATE academy_members SET handle = ${alt} WHERE id = ${memberId} AND handle IS NULL`
  }
}

// Liga al miembro con su ficha de cliente (users) y su teléfono si todavía
// no los tenía. Nunca pisa lo que ya hay.
async function linkOrderProfile(sql, memberId, orderId) {
  await sql`
    UPDATE academy_members m
       SET user_id = COALESCE(m.user_id, o.user_id), phone = COALESCE(m.phone, o.phone)
      FROM academy_orders o
     WHERE m.id = ${memberId} AND o.id = ${orderId}
       AND ((m.user_id IS NULL AND o.user_id IS NOT NULL) OR (m.phone IS NULL AND o.phone IS NOT NULL))
  `
}

/* Al chat del grupo (la generación presencial). Lo hace addToCohort del
   módulo del chat, que crea el chat si falta (ensureCohortChat) y mantiene
   academy_chat_members en sintonía con academy_cohort_members. notify:false
   porque el aviso "Te agregaron al grupo" lo manda quien llama: la fila de
   academy_cohort_members ya la insertó el CTE, y addToCohort solo avisa a
   los que él mismo agrega. Si el módulo no carga, al menos la fila del chat
   (si el chat ya existe), directo e idempotente. */
async function joinCohortChat(sql, cohortId, memberId) {
  try {
    const chat = await loadChat()
    await chat.addToCohort(sql, cohortId, [memberId], { notify: false })
    return
  } catch (err) {
    logErr("módulo del chat", err)
  }
  await sql`
    INSERT INTO academy_chat_members (chat_id, member_id)
    SELECT k.chat_id, ${memberId} FROM academy_cohorts k WHERE k.id = ${cohortId} AND k.chat_id IS NOT NULL
    ON CONFLICT DO NOTHING
  `
}

/* Notificaciones internas de la Academy: 'curso' por cada curso nuevo y, si
   el miembro es nuevo, 'bienvenida' y 'miembro_nuevo' al staff (sin push:
   el aviso de venta al panel ya cubre al dueño). */
async function notifyGranted(sql, { memberId, courses, nuevo }) {
  const mod = await loadNotify()
  for (const c of courses) {
    await safe("notificación curso", () => mod.notify(sql, { memberId, kind: "curso", targetType: "curso", targetId: Number(c.id), preview: c.title }))
  }
  if (!nuevo) return
  await safe("notificación bienvenida", () => mod.notify(sql, { memberId, kind: "bienvenida", push: false }))
  const staff = await sql`
    SELECT id FROM academy_members WHERE role IN ('propietario', 'admin') AND status = 'activo' AND id <> ${memberId}
  `
  if (staff.length) {
    await safe("notificación staff", () => mod.notifyMany(sql, staff.map((s) => s.id), {
      kind: "miembro_nuevo", actorId: memberId, targetType: "miembro", targetId: memberId, push: false,
    }))
  }
}

// "Te agregaron al grupo <nombre>", mismo aviso que manda addToCohort.
async function notifyCohortJoin(sql, memberIds, cohortId, actor = null) {
  const [co] = await sql`SELECT name FROM academy_cohorts WHERE id = ${cohortId}`
  const name = co?.name || ""
  const mod = await loadNotify()
  await mod.notifyMany(sql, memberIds, {
    kind: "grupo",
    actorId: actor,
    targetType: "grupo",
    targetId: cohortId,
    preview: name || null,
    text: name ? `Te agregaron al grupo ${name}` : "Te agregaron a un grupo",
  })
}

/* AutoDM (Skool "Auto DM"): un mensaje directo del dueño a cada miembro
   nuevo. postSystemDm reemplaza #NOMBRE# y #GRUPO#, y con onlyIfEmpty no lo
   repite si ese DM ya tiene mensajes (alguien que vuelve tras un
   reembolso). Solo si está encendido en Ajustes y existe el propietario. */
async function sendAutoDm(sql, memberId, settings) {
  const auto = settings?.plugins?.autoDm
  const template = String(auto?.text || "").trim()
  if (!auto || auto.enabled === false || !template) return false
  const [owner] = await sql`SELECT id FROM academy_members WHERE role = 'propietario' AND status = 'activo' ORDER BY id LIMIT 1`
  if (!owner || Number(owner.id) === Number(memberId)) return false
  const chat = await loadChat()
  const sent = await chat.postSystemDm(sql, Number(owner.id), memberId, template, { onlyIfEmpty: true })
  return Boolean(sent?.messageId)
}

// Mismo curso dos veces por dos órdenes paralelas: no se deshace nada, se
// le avisa al dueño para que reembolse una.
async function alertIfDuplicateCourse(sql, { memberId, courseId, grantId, title }) {
  const [dup] = await sql`
    SELECT count(*)::int AS n FROM academy_grants
    WHERE member_id = ${memberId} AND course_id = ${courseId} AND state = 'activa' AND id <> ${grantId}
  `
  if (!dup?.n) return
  await alertAdmins(sql, {
    title: "Academy: curso pagado dos veces",
    body: `${title} · el miembro ya tenía este curso: revisa si hay que reembolsar`,
    tag: `academy-dup-grant-${grantId}`,
  })
}

/* Aviso al panel (SPEC §6.3). Cómo llega (campana + push a los admins del
   panel) es cosa del host: notifyStaff de api/_academyHost.js, que nunca
   lanza y no corre DDL (este camino es el del webhook). Sin teléfono ni
   correo del cliente en el texto. */
export async function alertAdmins(sql, { title, body, tag }) {
  const send = typeof deps.notifyStaff === "function" ? deps.notifyStaff : notifyStaff
  try {
    return Number(await send(sql, { title, body, url: PANEL_URL, tag })) || 0
  } catch (err) {
    logErr("aviso al panel", err)
    return 0
  }
}

/* ── Proyección MemberAdmin (SPEC §4.3) ───────────────────────────────────
   MemberPublic + { email, phone, status, source, lastLoginAt,
   credentialsSentAt, mustChangePassword, grants, cohorts } y dos extras
   para el panel: passwordSet (si ya eligió su contraseña, para ofrecer
   "Reenviar acceso" o "Enlace de contraseña") y bannedAt.
   Vive acá (y _academyAdmin.js la importa) porque provisionManualGrant la
   devuelve, y este archivo no puede importar _academyAdmin.js sin cerrar un
   ciclo. La privacidad del miembro se respeta igual que en MemberPublic:
   hideActivity oculta lastSeenAt y hideOnline apaga "En línea". */
export async function memberAdminRows(sql, ids) {
  const list = [...new Set((ids || []).map(toId).filter(Boolean))]
  const map = new Map()
  if (!list.length) return map
  const rows = await sql`
    SELECT m.id, m.handle, m.name, m.avatar_url, m.role, m.bio, m.location, m.links,
           m.email, m.phone, m.status, m.source, m.must_change_password,
           (m.password_set_at IS NOT NULL) AS password_set,
           to_char(m.joined_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS joined_at,
           CASE WHEN m.prefs -> 'privacy' -> 'hideActivity' = 'true'::jsonb THEN NULL
                ELSE to_char(m.last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END AS last_seen_at,
           (COALESCE(m.last_sync_at > NOW() - interval '90 seconds', false)
             AND COALESCE(m.prefs -> 'privacy' -> 'hideOnline', 'false'::jsonb) <> 'true'::jsonb) AS online,
           to_char(m.last_login_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_login_at,
           to_char(m.credentials_sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS credentials_sent_at,
           to_char(m.banned_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS banned_at,
           (SELECT count(*)::int FROM academy_likes l WHERE l.author_id = m.id AND l.member_id <> m.id) AS points,
           COALESCE((
             SELECT json_agg(json_build_object('id', g.id, 'courseId', g.course_id, 'courseTitle', c.title,
                                               'state', g.state, 'source', g.source) ORDER BY g.id)
             FROM academy_grants g JOIN academy_courses c ON c.id = g.course_id
             WHERE g.member_id = m.id
           ), '[]'::json) AS grants,
           COALESCE((
             SELECT json_agg(json_build_object('id', k.id, 'name', k.name) ORDER BY k.id)
             FROM academy_cohort_members cm JOIN academy_cohorts k ON k.id = cm.cohort_id
             WHERE cm.member_id = m.id AND k.archived_at IS NULL
           ), '[]'::json) AS cohorts
    FROM academy_members m
    WHERE m.id = ANY(${list}::int[])
  `
  for (const r of rows) {
    const points = Number(r.points) || 0
    map.set(Number(r.id), {
      id: Number(r.id),
      handle: r.handle,
      name: r.name,
      avatarUrl: r.avatar_url || null,
      level: levelFor(points).level,
      role: r.role,
      bio: r.bio || null,
      location: r.location || null,
      links: r.links && typeof r.links === "object" ? r.links : {},
      joinedAt: r.joined_at || null,
      lastSeenAt: r.last_seen_at || null,
      online: Boolean(r.online),
      points,
      email: r.email,
      phone: r.phone || null,
      status: r.status,
      source: r.source,
      lastLoginAt: r.last_login_at || null,
      credentialsSentAt: r.credentials_sent_at || null,
      mustChangePassword: Boolean(r.must_change_password),
      passwordSet: Boolean(r.password_set),
      bannedAt: r.banned_at || null,
      grants: Array.isArray(r.grants) ? r.grants : [],
      cohorts: Array.isArray(r.cohorts) ? r.cohorts : [],
    })
  }
  return map
}

export async function loadMemberAdmin(sql, memberId) {
  const id = toId(memberId)
  if (!id) return null
  return (await memberAdminRows(sql, [id])).get(id) || null
}
