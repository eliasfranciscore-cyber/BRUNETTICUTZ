/* BRUNETTI IMAGE STUDIO — piezas compartidas (livianas)
   ------------------------------------------------------------------
   Lo usan el panel (api/_imagen.js), el formulario público
   (api/_imagenForm.js) y el checkout / webhook de Mercado Pago
   (api/mp-payments.js). Sin pdf-lib ni nada pesado: el webhook lo importa
   en cada pago.

   Reglas que viven acá:
   - Fotos e informes van al Blob en PRIVADO (access: "private") y solo se
     sirven por proxy: con sesión del panel, con el token del formulario, o
     con el link temporal de un informe. Si el store rechaza el modo privado,
     la subida falla con un mensaje claro: nunca se cae a público.
   - Todo lo que pasa en una asesoría queda en image_events (quién y qué).
   - El checkout y el webhook nunca corren ensure*: leen la tabla con
     to_regclass y, si no existe, no hay asesoría que cobrar.
   ------------------------------------------------------------------ */

import crypto from "node:crypto"
import { INTAKE } from "../src/imagen/vocab.js"

export const SITE_URL = (process.env.SITE_URL || "https://brunetticutz.cl").replace(/\/$/, "")
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const TOKEN_RE = /^[a-f0-9]{32}$/
export const SHARE_DAYS = 30
export const MAX_PHOTOS = 8
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024

export const newToken = () => crypto.randomBytes(16).toString("hex")
export const formUrl = (token) => `${SITE_URL}/asesoria/datos?t=${token}`
export const shareUrl = (token) => `${SITE_URL}/asesoria/informe/${token}`

export const text = (v, max) => {
  const s = String(v ?? "").trim()
  return s ? s.slice(0, max) : null
}
const dateKey = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v ? String(v).slice(0, 10) : null))

/* ---------- filas → forma del front ---------- */
export function toConsultation(r) {
  if (!r) return null
  return {
    id: r.id, clientId: r.client_id, bookingId: r.booking_id, source: r.source, modality: r.modality,
    status: r.status, paymentStatus: r.payment_status, price: r.price, paidAmount: r.paid_amount,
    paymentMethod: r.payment_method, paymentRef: r.payment_ref, paidAt: r.paid_at,
    name: r.name, phone: r.phone, email: r.email, age: r.age, visitDate: dateKey(r.visit_date),
    intake: r.intake || {}, intakeSubmittedAt: r.intake_submitted_at,
    consentAt: r.consent_at, consentBy: r.consent_by, consentVersion: r.consent_version,
    formToken: r.form_token, diagnosis: r.diagnosis || {}, diagnosedBy: r.diagnosed_by, diagnosedAt: r.diagnosed_at,
    nextFollowup: dateKey(r.next_followup), notes: r.notes, utm: r.utm,
    createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

export const toPhoto = (r) => (r ? { id: r.id, angle: r.angle, uploadedBy: r.uploaded_by, createdAt: r.created_at } : null)

export function toProduct(r) {
  if (!r) return null
  const arr = (v) => (Array.isArray(v) ? v : [])
  return {
    id: r.id, name: r.name, brand: r.brand, category: r.category, imgUrl: r.img_url, description: r.description,
    hold: r.hold, shine: r.shine, amount: r.amount, application: r.application, usage: r.usage, frequency: r.frequency,
    hairTypes: arr(r.hair_types), thickness: arr(r.thickness), conditions: arr(r.conditions), needs: arr(r.needs),
    soldHere: Boolean(r.sold_here), productId: r.product_id,
    // Si está atado a Essentials, el precio y el stock son los de la tienda.
    price: r.shop_price ?? r.price ?? null, stock: r.shop_stock ?? null, shopActive: r.shop_active ?? null,
    buyUrl: r.buy_url, active: r.active !== false, reviewedAt: r.reviewed_at, updatedAt: r.updated_at,
  }
}

export function toRec(r) {
  if (!r) return null
  return {
    id: r.id, kind: r.kind, productId: r.product_id, title: r.title, detail: r.detail || {}, reason: r.reason,
    source: r.source, ruleId: r.rule_id, status: r.status, edited: Boolean(r.edited),
    decidedBy: r.decided_by, decidedByName: r.decided_by_name || null, decidedAt: r.decided_at, position: r.position,
  }
}

export function toReport(r) {
  if (!r) return null
  const live = r.share_token && r.share_expires_at && new Date(r.share_expires_at) > new Date()
  return {
    id: r.id, consultationId: r.consultation_id, version: r.version, createdAt: r.created_at,
    createdByName: r.created_by_name || null, hasPdf: Boolean(r.pdf_url),
    sentAt: r.sent_at, sentTo: r.sent_to, sendCount: r.send_count || 0,
    shareUrl: live ? shareUrl(r.share_token) : null, shareExpiresAt: live ? r.share_expires_at : null,
  }
}

export const toEvent = (r) => ({ id: r.id, actor: r.actor, actorName: r.actor_name || null, action: r.action, detail: r.detail || null, at: r.created_at })

/* ---------- historial ---------- */
// Nunca rompe la operación que lo llama: un historial que no se escribe no
// puede tumbar un pago ni un envío.
export async function logEvent(sql, consultationId, { actor = "sistema", actorId = null, action, detail = null }) {
  try {
    await sql`
      INSERT INTO image_events (consultation_id, actor, actor_id, action, detail)
      VALUES (${consultationId}, ${actor}, ${Number.isInteger(actorId) ? actorId : null}, ${action}, ${detail ? JSON.stringify(detail) : null}::jsonb)
    `
  } catch (err) {
    console.error("imagen: no se registró el evento", action, err?.message || err)
  }
}

/* ---------- Blob privado ---------- */
const blobToken = () => process.env.BLOB_READ_WRITE_TOKEN || undefined

export async function putPrivate(pathname, buffer, contentType) {
  const { put } = await import("@vercel/blob")
  try {
    return await put(pathname, buffer, { access: "private", addRandomSuffix: true, contentType, token: blobToken() })
  } catch (err) {
    console.error("imagen: el Blob rechazó la subida privada:", err?.message || err)
    throw Object.assign(new Error("El almacenamiento privado de archivos no está disponible. Avísale a quien administra el sitio."), { status: 503 })
  }
}

export async function readPrivate(url) {
  let host = ""
  try { host = new URL(url).hostname } catch { return null }
  if (!host.endsWith(".blob.vercel-storage.com")) return null
  const { get } = await import("@vercel/blob")
  const result = await get(url, { access: "private", token: blobToken(), abortSignal: AbortSignal.timeout(10000) })
  if (!result || result.statusCode !== 200 || !result.stream) return null
  return { buffer: Buffer.from(await new Response(result.stream).arrayBuffer()), contentType: String(result.blob?.contentType || "").split(";")[0] }
}

export async function deletePrivate(urls) {
  const list = (urls || []).filter((u) => /\.blob\.vercel-storage\.com\//.test(String(u || "")))
  if (!list.length) return
  try {
    const { del } = await import("@vercel/blob")
    await del(list, { token: blobToken() })
  } catch (err) {
    console.error("imagen: no se borraron archivos del Blob:", err?.message || err)
  }
}

// Una foto o un PDF servidos por proxy: sin caché compartida y sin que el
// navegador pueda reinterpretar el tipo.
export function sendFile(res, { buffer, contentType }, { filename, inline = true } = {}) {
  const type = /^(image\/(jpeg|png)|application\/pdf)$/.test(contentType) ? contentType : "application/octet-stream"
  res.setHeader("Content-Type", type)
  res.setHeader("Content-Length", String(buffer.length))
  res.setHeader("Cache-Control", "private, no-store")
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin")
  if (filename) res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${filename}"`)
  return res.status(200).send(buffer)
}

export function parsePhoto(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|jpg));base64,(.+)$/.exec(String(dataUrl || ""))
  if (!match) return { error: "La foto tiene que ser JPEG o PNG" }
  const buffer = Buffer.from(match[2], "base64")
  if (buffer.length > MAX_PHOTO_BYTES) return { error: "Foto muy pesada (máx. 8 MB)" }
  const contentType = match[1] === "image/png" ? "image/png" : "image/jpeg"
  return { buffer, contentType, ext: contentType === "image/png" ? "png" : "jpg" }
}

/* ---------- ajustes de venta (tabla settings, los edita el panel) ----------
   Mismo patrón que el interruptor del Workshop: el cobro de una modalidad
   está encendido solo si su clave dice '1' Y tiene precio. Si la clave no
   existe o la base no responde, está apagado. */
export const ASESORIA_KEYS = [
  "asesoria_presencial_price", "asesoria_presencial_payments", "asesoria_presencial_info",
  "asesoria_online_price", "asesoria_online_payments", "asesoria_online_info",
]
export function asesoriaSettings(byKey = {}) {
  const one = (m) => {
    const price = Number(byKey[`asesoria_${m}_price`]) > 0 ? Math.round(Number(byKey[`asesoria_${m}_price`])) : null
    return { price, enabled: byKey[`asesoria_${m}_payments`] === "1" && Boolean(price), info: byKey[`asesoria_${m}_info`] || "" }
  }
  return { presencial: one("presencial"), online: one("online") }
}

/* ---------- checkout y webhook (api/mp-payments.js) ---------- */
export async function imageTablesReady(sql) {
  const [row] = await sql`SELECT to_regclass('image_consultations') IS NOT NULL AS ok`
  return Boolean(row?.ok)
}

// Fila 'pago_pendiente' antes de pedirle la preferencia a Mercado Pago.
export async function createWebConsultation(sql, { modality, name, phone, email, price, utm }) {
  const token = newToken()
  const [row] = await sql`
    INSERT INTO image_consultations (source, modality, status, payment_status, price, name, phone, email, form_token, utm)
    VALUES ('web', ${modality}, 'pago_pendiente', 'pendiente', ${price}, ${name}, ${phone}, ${email}, ${token}, ${text(utm, 300)})
    RETURNING id
  `
  await logEvent(sql, row.id, { actor: "cliente", action: "checkout", detail: { modality, price } })
  return { id: row.id, token }
}

/* Pago aprobado de una asesoría (external_reference "asesoria-<id>").
   Idempotente: solo la fila todavía 'pendiente' pasa a 'pagada'; un aviso
   repetido de Mercado Pago responde 200 sin volver a mandar el correo. */
export async function handleAsesoriaPaid(sql, ref, payment, res, { notifyAll, sendImagenFormEmail }) {
  const id = Number(String(ref).slice("asesoria-".length))
  if (!Number.isInteger(id) || id <= 0) return res.status(200).json({ received: true, ignored: "ref inválida" })
  if (!(await imageTablesReady(sql))) {
    // Sin la tabla no hay fila que marcar: 500 para que Mercado Pago reintente.
    return res.status(500).json({ received: false, error: "image_consultations no existe" })
  }
  const amount = Math.round(Number(payment.transaction_amount) || 0)
  const [row] = await sql`
    UPDATE image_consultations SET
      payment_status = 'pagada', paid_amount = ${amount}, payment_method = 'mercadopago',
      payment_ref = ${String(payment.id)}, paid_at = NOW(),
      status = CASE WHEN status = 'pago_pendiente' THEN 'datos_pendientes' ELSE status END,
      updated_at = NOW()
    WHERE id = ${id} AND payment_status = 'pendiente'
    RETURNING *
  `
  if (!row) return res.status(200).json({ received: true, alreadyProcessed: true })

  await logEvent(sql, id, { actor: "sistema", action: "pago", detail: { amount, paymentId: String(payment.id), method: "mercadopago" } })

  // El cliente queda en la ficha del CRM (por teléfono), sin pisar datos.
  if (/^\d{9}$/.test(String(row.phone || ""))) {
    try {
      const [u] = await sql`
        INSERT INTO users (name, phone, email) VALUES (${row.name}, ${row.phone}, ${row.email})
        ON CONFLICT (phone) DO UPDATE SET
          email = COALESCE(NULLIF(btrim(COALESCE(users.email, '')), ''), EXCLUDED.email)
        RETURNING id
      `
      if (u?.id) await sql`UPDATE image_consultations SET client_id = ${u.id} WHERE id = ${id}`
    } catch (err) {
      console.error("imagen: no se vinculó el cliente:", err?.message || err)
    }
  }
  try {
    if (row.email) {
      const sent = await sendImagenFormEmail({ to: row.email, name: row.name, modality: row.modality, formUrl: formUrl(row.form_token) })
      if (sent?.ok) await logEvent(sql, id, { actor: "sistema", action: "correo_formulario", detail: { to: row.email } })
    }
  } catch (err) {
    console.error("imagen: no salió el correo del formulario:", err?.message || err)
  }
  try {
    await notifyAll({
      title: `Nueva asesoría pagada · ${row.modality === "online" ? "Online" : "Presencial"}`,
      body: `${row.name || "Cliente"} · $${amount.toLocaleString("es-CL")}`,
      url: "/panel?tab=imagen",
      tag: `asesoria-${id}`,
    })
  } catch (err) {
    console.error("imagen: push no enviado:", err?.message || err)
  }
  return res.status(200).json({ received: true, consultationId: id })
}

/* ---------- ficha de ingreso (lo que declara el cliente) ----------
   La usan el formulario público y el panel: solo las claves conocidas y, en
   las de opción, solo valores de la lista (src/imagen/vocab.js). */
const pick = (v, options) => (options.includes(v) ? v : null)
export function cleanIntake(raw) {
  const r = raw && typeof raw === "object" ? raw : {}
  const out = {
    goal: text(r.goal, 800),
    preferences: text(r.preferences, 600),
    habits: text(r.habits, 600),
    currentProducts: text(r.currentProducts, 600),
    needsNote: text(r.needsNote, 600),
    needs: (Array.isArray(r.needs) ? r.needs : []).filter((n) => INTAKE.needs.options.includes(n)).slice(0, 12),
  }
  for (const key of ["style", "styleTime", "finish", "length", "washFreq", "water", "drying"]) out[key] = pick(r[key], INTAKE[key].options)
  return out
}
