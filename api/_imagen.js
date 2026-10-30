/* BRUNETTI IMAGE STUDIO — API del panel (pestaña Image Studio)
   ------------------------------------------------------------------
   /api/clients?mode=imagen, con sesión de barbero admin (Bruno). No es una
   función nueva (tope de 12 del plan Hobby): clients.js lo carga con
   import() dinámico, así un error acá no tumba /api/clients.

   Asesorías
     GET    ?mode=imagen                        lista + indicadores (&phone= las de un cliente)
     GET    ?mode=imagen&id=                    una, con fotos, recomendaciones, informes e historial
     GET    ?mode=imagen&candidates=1&date=     atendidos ese día (ayer por defecto)
     POST   ?mode=imagen                        crea (desde una reserva o un cliente)
     PATCH  ?mode=imagen&id=                    guarda datos, ingreso, diagnóstico, cierre o estado
     POST   ?mode=imagen&id=&paid=1             marca el pago hecho fuera de la web
     DELETE ?mode=imagen&id=                    la borra con sus fotos e informes (eliminación de datos)
   Fotos (Blob privado)
     POST   ?mode=imagen&upload=1               { id, angle, dataUrl[, consent] }
     GET    ?mode=imagen&photo=                 la foto, por proxy
     DELETE ?mode=imagen&photo=
   Recomendaciones
     POST   ?mode=imagen&id=&suggest=1          corre las reglas (api/_imagenRules.js)
     POST   ?mode=imagen&id=&rec=1              agrega una a mano
     PATCH  ?mode=imagen&rec=                   aprobar / descartar / editar
     DELETE ?mode=imagen&rec=                   borra una manual
   Informes
     GET    ?mode=imagen&id=&preview=1          PDF del estado actual, sin guardar
     POST   ?mode=imagen&id=&generate=1         GENERAR ASESORÍA PERSONALIZADA → versión N
     GET    ?mode=imagen&report=&pdf=1          el PDF guardado
     POST   ?mode=imagen&report=&send=1         por correo, con el PDF adjunto
     POST   ?mode=imagen&report=&share=1        link temporal (30 días) + texto para WhatsApp
   Catálogo
     GET    ?mode=imagen&catalog=1[&essentials=1]
     POST   ?mode=imagen&catalog=1[&import=1 | &upload=1]
     PATCH  ?mode=imagen&catalog=1&pid=
     DELETE ?mode=imagen&catalog=1&pid=

   Un error de base es un 500 de verdad: nunca datos de demo.
   ------------------------------------------------------------------ */

import { put } from "@vercel/blob"
import { requireInternal } from "./_auth.js"
import { normalizePhone, EMAIL_RE } from "./_bridge.js"
import { ensureImageTables } from "./_schema.js"
import { sendImagenReportEmail } from "./_email.js"
import { buildImagenPdf, reportFileName } from "./_imagenPdf.js"
import { suggest } from "./_imagenRules.js"
import {
  DATE_RE, MAX_PHOTOS, SHARE_DAYS, text, newToken, formUrl, shareUrl,
  toConsultation, toPhoto, toProduct, toRec, toReport, toEvent, logEvent,
  putPrivate, readPrivate, deletePrivate, sendFile, parsePhoto, cleanIntake,
} from "./_imagenCore.js"
import {
  MODALITIES, ANGLES, SKULL, HAIR, CATEGORIES, HOLDS, SHINES, HAIR_TYPES, THICKNESSES, CONDITIONS,
  PRODUCT_NEEDS, REC_KINDS, KIND_GROUP, CONSENT_VERSION,
} from "../src/imagen/vocab.js"

const TZ = "America/Santiago"
// La silueta es un path SVG propio (src/data/estilo.js): solo comandos y números.
const PATH_RE = /^[MmCcLlQqZzHhVvSs0-9 .,-]{1,800}$/
// Fotos de referencia de los cortes: solo las del catálogo de /style.
const REF_IMG_RE = /^\/assets\/estilo\/[\w.-]+\.(jpe?g|png)$/
const refImg = (v) => (REF_IMG_RE.test(String(v || "")) ? String(v) : null)
const posInt = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null)
const pick = (v, options) => (options.includes(v) ? v : null)
const subset = (list, options, max = 20) => (Array.isArray(list) ? list : []).filter((x) => options.includes(x)).slice(0, max)
const KIND_IDS = REC_KINDS.map((k) => k.id)
const PRODUCT_KINDS = REC_KINDS.filter((k) => k.product).map((k) => k.id)
const CATEGORY_IDS = CATEGORIES.map((c) => c.id)

function yesterdayKey() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
  const d = new Date(`${today}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/* ---------- limpieza de lo que manda el panel ---------- */
// La forma de rostro se guarda como foto de lo que se diagnosticó.
function cleanFace(raw) {
  if (!raw || typeof raw !== "object") return null
  const face = {
    id: text(raw.id, 40),
    name: text(raw.name, 60),
    tagline: text(raw.tagline, 120),
    diagnosis: text(raw.diagnosis, 900),
    goal: text(raw.goal, 300),
    avoid: text(raw.avoid, 300),
    traits: (Array.isArray(raw.traits) ? raw.traits : []).map((t) => text(t, 80)).filter(Boolean).slice(0, 6),
    tips: (Array.isArray(raw.tips) ? raw.tips : []).map((t) => text(t, 300)).filter(Boolean).slice(0, 6),
    path: PATH_RE.test(String(raw.path || "")) ? String(raw.path) : null,
    best: (Array.isArray(raw.best) ? raw.best : []).slice(0, 4)
      .map((b) => ({ name: text(b?.name, 80), note: text(b?.note, 200), img: refImg(b?.img) }))
      .filter((b) => b.name),
  }
  return face.id && face.name ? face : null
}

function cleanDiagnosis(raw) {
  const r = raw && typeof raw === "object" ? raw : {}
  const skull = {}
  for (const [k, def] of Object.entries(SKULL)) skull[k] = pick(r.skull?.[k], def.options)
  skull.notes = text(r.skull?.notes, 800)
  const hair = {}
  for (const [k, def] of Object.entries(HAIR)) hair[k] = pick(r.hair?.[k], def.options)
  hair.notes = text(r.hair?.notes, 800)
  return { face: cleanFace(r.face), skull, hair, observations: text(r.observations, 1500) }
}

function readDetail(raw, kind) {
  const r = raw && typeof raw === "object" ? raw : {}
  if (kind === "rutina") return { steps: (Array.isArray(r.steps) ? r.steps : []).map((s) => text(s, 300)).filter(Boolean).slice(0, 10) }
  const out = {}
  for (const key of ["largo", "volumen", "textura", "degradado", "lados", "mantenimiento", "cantidad", "aplicacion", "modoDeUso", "frecuencia", "fijacion", "brillo"]) {
    const v = text(r[key], 300)
    if (v) out[key] = v
  }
  if (kind === "corte") out.refImg = refImg(r.refImg)
  if (kind === "mantenimiento" && Number(r.weeks) > 0) out.weeks = Math.min(26, Math.round(Number(r.weeks)))
  return out
}

function readProduct(body = {}) {
  const price = body.price === "" || body.price == null ? null : Math.round(Number(body.price))
  const url = String(body.buyUrl || "").trim()
  return {
    name: text(body.name, 200),
    brand: text(body.brand, 120),
    category: pick(body.category, CATEGORY_IDS),
    description: text(body.description, 1000),
    hold: pick(body.hold, HOLDS),
    shine: pick(body.shine, SHINES),
    amount: text(body.amount, 200),
    application: text(body.application, 600),
    usage: text(body.usage, 600),
    frequency: text(body.frequency, 200),
    hairTypes: subset(body.hairTypes, HAIR_TYPES),
    thickness: subset(body.thickness, THICKNESSES),
    conditions: subset(body.conditions, CONDITIONS),
    needs: subset(body.needs, PRODUCT_NEEDS),
    soldHere: Boolean(body.soldHere),
    productId: posInt(body.productId),
    price: Number.isFinite(price) && price >= 0 && price <= 10_000_000 ? price : null,
    buyUrl: /^https:\/\/[^\s]{3,500}$/.test(url) ? url : null,
    active: body.active !== false,
  }
}

/* ---------- lecturas ---------- */
async function getConsultation(sql, id) {
  const [row] = await sql`SELECT * FROM image_consultations WHERE id = ${id}`
  return toConsultation(row)
}

async function loadCatalog(sql, { activeOnly = false } = {}) {
  const rows = activeOnly
    ? await sql`
        SELECT ip.*, p.price AS shop_price, p.stock AS shop_stock, p.active AS shop_active
        FROM image_products ip LEFT JOIN products p ON p.id = ip.product_id
        WHERE ip.active = true ORDER BY ip.category, ip.name`
    : await sql`
        SELECT ip.*, p.price AS shop_price, p.stock AS shop_stock, p.active AS shop_active
        FROM image_products ip LEFT JOIN products p ON p.id = ip.product_id
        ORDER BY ip.active DESC, ip.category, ip.name`
  return rows.map(toProduct)
}

async function loadRecs(sql, id) {
  const rows = await sql`
    SELECT r.*, b.name AS decided_by_name FROM image_recommendations r
    LEFT JOIN barbers b ON b.id = r.decided_by
    WHERE r.consultation_id = ${id} ORDER BY r.position, r.id`
  return rows.map(toRec)
}

async function fullConsultation(sql, id) {
  const consultation = await getConsultation(sql, id)
  if (!consultation) return null
  const [photos, recs, reports, events] = await Promise.all([
    sql`SELECT * FROM image_photos WHERE consultation_id = ${id} ORDER BY created_at`,
    loadRecs(sql, id),
    sql`SELECT r.*, b.name AS created_by_name FROM image_reports r LEFT JOIN barbers b ON b.id = r.created_by WHERE r.consultation_id = ${id} ORDER BY r.version DESC`,
    sql`SELECT e.*, b.name AS actor_name FROM image_events e LEFT JOIN barbers b ON b.id = e.actor_id WHERE e.consultation_id = ${id} ORDER BY e.created_at DESC, e.id DESC LIMIT 100`,
  ])
  return { consultation: { ...consultation, formUrl: consultation.formToken ? formUrl(consultation.formToken) : null }, photos: photos.map(toPhoto), recs, reports: reports.map(toReport), events: events.map(toEvent) }
}

async function listConsultations(sql, phone) {
  const rows = phone
    ? await sql`
        SELECT c.*, (SELECT count(*)::int FROM image_photos p WHERE p.consultation_id = c.id) AS photo_count,
               (SELECT max(version) FROM image_reports r WHERE r.consultation_id = c.id) AS last_version
        FROM image_consultations c WHERE c.phone = ${phone} ORDER BY c.updated_at DESC LIMIT 50`
    : await sql`
        SELECT c.*, (SELECT count(*)::int FROM image_photos p WHERE p.consultation_id = c.id) AS photo_count,
               (SELECT max(version) FROM image_reports r WHERE r.consultation_id = c.id) AS last_version
        FROM image_consultations c ORDER BY c.updated_at DESC LIMIT 400`
  return rows.map((r) => {
    const c = toConsultation(r)
    return {
      id: c.id, name: c.name, phone: c.phone, email: c.email, modality: c.modality, status: c.status,
      paymentStatus: c.paymentStatus, price: c.price, paidAmount: c.paidAmount, visitDate: c.visitDate, source: c.source,
      faceName: c.diagnosis?.face?.name || null, photoCount: r.photo_count || 0, lastVersion: r.last_version || null,
      intakeSubmittedAt: c.intakeSubmittedAt, createdAt: c.createdAt, updatedAt: c.updatedAt,
    }
  })
}

/* Indicadores del piloto (sección 18 del documento): cuántas pagadas llegan a
   informe entregado, qué pasa con las sugerencias y cuánto se demora el
   informe desde que llegan los datos. */
async function stats(sql) {
  const [[c], [r], [t]] = await Promise.all([
    sql`
      SELECT count(*) FILTER (WHERE payment_status IN ('pagada', 'en_local') AND status <> 'cancelada')::int AS active,
             count(*) FILTER (WHERE status = 'entregada')::int AS delivered,
             count(*) FILTER (WHERE status = 'en_revision')::int AS to_review
      FROM image_consultations`,
    sql`
      SELECT count(*) FILTER (WHERE status = 'aprobada' AND NOT edited)::int AS approved,
             count(*) FILTER (WHERE status = 'aprobada' AND edited)::int AS edited,
             count(*) FILTER (WHERE status = 'descartada')::int AS discarded
      FROM image_recommendations WHERE source IN ('regla', 'ia')`,
    sql`
      SELECT avg(EXTRACT(EPOCH FROM (r.first_at - c.intake_submitted_at)) / 3600)::float AS hours
      FROM image_consultations c
      JOIN (SELECT consultation_id, min(created_at) AS first_at FROM image_reports GROUP BY consultation_id) r ON r.consultation_id = c.id
      WHERE c.intake_submitted_at IS NOT NULL AND r.first_at > c.intake_submitted_at`,
  ])
  return {
    active: c.active, delivered: c.delivered, toReview: c.to_review,
    suggestions: { approved: r.approved, edited: r.edited, discarded: r.discarded },
    hoursToReport: t?.hours != null ? Math.round(t.hours * 10) / 10 : null,
  }
}

async function candidates(sql, date) {
  return sql`
    SELECT b.id AS "bookingId", b.booking_date::text AS date, to_char(b.booking_time, 'HH24:MI') AS time,
           b.status, b.service_id AS "serviceId", COALESCE(s.name, b.custom_service, 'Servicio') AS service,
           u.id AS "clientId", COALESCE(u.name, '') AS name, u.phone,
           NULLIF(btrim(COALESCE(u.email, '')), '') AS email,
           ic.id AS "consultationId", ic.status AS "consultationStatus"
    FROM bookings b
    LEFT JOIN users u ON u.id = b.client_id
    LEFT JOIN services s ON s.id = b.service_id
    LEFT JOIN LATERAL (
      SELECT id, status FROM image_consultations WHERE booking_id = b.id ORDER BY id DESC LIMIT 1
    ) ic ON true
    WHERE b.booking_date = ${date}::date AND b.status IN ('completada', 'en curso')
    ORDER BY (b.service_id = 10) DESC NULLS LAST, b.booking_time
    LIMIT 100
  `
}

/* ---------- informe ---------- */
const KIND_ORDER = Object.fromEntries(REC_KINDS.map((k, i) => [k.id, i]))

// Lo que entra al PDF: el diagnóstico y SOLO las recomendaciones aprobadas,
// con los datos del producto tal como están ahora (precio, si se vende acá).
async function reportSnapshot(sql, c, version) {
  const [recs, catalog] = await Promise.all([loadRecs(sql, c.id), loadCatalog(sql)])
  const byId = new Map(catalog.map((p) => [p.id, p]))
  const approved = recs
    .filter((r) => r.status === "aprobada")
    .sort((a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || (a.position - b.position) || (a.id - b.id))
    .map((r) => {
      const p = r.productId ? byId.get(r.productId) : null
      return {
        kind: r.kind, title: r.title, detail: r.detail, reason: r.reason,
        product: p ? { name: p.name, brand: p.brand, category: p.category, soldHere: p.soldHere, price: p.price, buyUrl: p.buyUrl, imgUrl: p.imgUrl } : null,
      }
    })
  return {
    version,
    generatedAt: new Date().toISOString(),
    client: { name: c.name, email: c.email, phone: c.phone },
    consultation: { id: c.id, modality: c.modality, visitDate: c.visitDate, nextFollowup: c.nextFollowup, notes: c.notes },
    diagnosis: c.diagnosis || {},
    recs: approved,
  }
}

async function reportPdfBytes(row) {
  if (row.pdf_url) {
    const file = await readPrivate(row.pdf_url)
    if (file?.buffer?.length) return file.buffer
  }
  // Sin archivo guardado (o el Blob no responde): se vuelve a dibujar desde
  // su snapshot, que es lo que lo define.
  return Buffer.from(await buildImagenPdf({ ...row.snapshot, version: row.version }))
}

async function generateReport(sql, c, session, res) {
  if (!c.diagnosis?.face?.id) return res.status(400).json({ ok: false, error: "Falta el tipo de rostro en el diagnóstico." })
  const recs = await loadRecs(sql, c.id)
  if (!recs.some((r) => r.kind === "corte" && r.status === "aprobada")) {
    return res.status(400).json({ ok: false, error: "Aprueba al menos un corte antes de generar el informe." })
  }
  const actor = actorOf(session)
  let row = null
  // Dos clics a la vez chocan con UNIQUE (consulta, versión): se reintenta una vez.
  for (let attempt = 0; attempt < 2 && !row; attempt++) {
    const [{ v }] = await sql`SELECT COALESCE(max(version), 0) + 1 AS v FROM image_reports WHERE consultation_id = ${c.id}`
    const snapshot = await reportSnapshot(sql, c, v)
    try {
      ;[row] = await sql`
        INSERT INTO image_reports (consultation_id, version, snapshot, created_by)
        VALUES (${c.id}, ${v}, ${JSON.stringify(snapshot)}::jsonb, (SELECT id FROM barbers WHERE id = ${actor}::int))
        RETURNING *`
    } catch (err) {
      if (err?.code !== "23505" || attempt) throw err
    }
  }
  const bytes = Buffer.from(await buildImagenPdf(row.snapshot))
  try {
    const blob = await putPrivate(`imagen/${c.id}/informe-v${row.version}.pdf`, bytes, "application/pdf")
    ;[row] = await sql`UPDATE image_reports SET pdf_url = ${blob.url} WHERE id = ${row.id} RETURNING *`
  } catch (err) {
    // El informe queda igual (se redibuja desde su snapshot al abrirlo).
    console.error("imagen: PDF no guardado en el Blob:", err?.message || err)
  }
  await sql`UPDATE image_consultations SET status = CASE WHEN status = 'cancelada' THEN status ELSE 'informe_listo' END, updated_at = NOW() WHERE id = ${c.id}`
  await logEvent(sql, c.id, { actor: "barbero", actorId: actor, action: "informe", detail: { version: row.version, recs: row.snapshot.recs.length } })
  return res.status(201).json({ ok: true, report: toReport(row) })
}

async function ensureShare(sql, row) {
  const live = row.share_token && row.share_expires_at && new Date(row.share_expires_at) > new Date()
  if (live) return row
  const [next] = await sql`
    UPDATE image_reports SET share_token = ${newToken()}, share_expires_at = NOW() + make_interval(days => ${SHARE_DAYS})
    WHERE id = ${row.id} RETURNING *`
  return next
}

async function sendReport(sql, row, body, session, res) {
  const c = await getConsultation(sql, row.consultation_id)
  const to = String(body.email || c?.email || "").trim().toLowerCase()
  if (!EMAIL_RE.test(to)) return res.status(400).json({ ok: false, error: "Falta un correo válido del cliente" })
  const bytes = await reportPdfBytes(row)
  const shared = await ensureShare(sql, row)
  const cuts = (row.snapshot?.recs || []).filter((r) => r.kind === "corte").map((r) => r.title)
  const result = await sendImagenReportEmail({
    to, name: c?.name, faceShape: row.snapshot?.diagnosis?.face?.name, cuts,
    pdfBase64: bytes.toString("base64"), filename: reportFileName(c?.name, row.version), shareUrl: shareUrl(shared.share_token),
  })
  if (!result.ok) {
    const error = result.reason === "email-not-configured"
      ? "El correo no está configurado en el servidor (RESEND_API_KEY)."
      : "No se pudo enviar el correo. Intenta de nuevo en un rato."
    return res.status(502).json({ ok: false, error, reason: result.reason })
  }
  const [next] = await sql`
    UPDATE image_reports SET sent_at = NOW(), sent_to = ${to}, send_count = send_count + 1 WHERE id = ${row.id} RETURNING *`
  await sql`UPDATE image_consultations SET status = 'entregada', email = COALESCE(email, ${to}), updated_at = NOW() WHERE id = ${row.consultation_id}`
  // El correo le sirve también a la ficha del CRM: solo si no tenía uno.
  if (c?.clientId) {
    try {
      await sql`UPDATE users SET email = ${to}, updated_at = NOW() WHERE id = ${c.clientId} AND NULLIF(btrim(COALESCE(email, '')), '') IS NULL`
    } catch (err) {
      console.error("imagen: no se guardó el correo en la ficha:", err?.message || err)
    }
  }
  await logEvent(sql, row.consultation_id, { actor: "barbero", actorId: actorOf(session), action: "envio_correo", detail: { version: row.version, to } })
  return res.json({ ok: true, report: toReport(next) })
}

async function shareReport(sql, row, session, res) {
  const c = await getConsultation(sql, row.consultation_id)
  const next = await ensureShare(sql, row)
  const url = shareUrl(next.share_token)
  const first = String(c?.name || "").trim().split(/\s+/)[0]
  const message = `Hola${first ? ` ${first}` : ""}, te dejo tu asesoría de imagen de Brunetti Image Studio: ${url} (el enlace dura ${SHARE_DAYS} días).`
  const phone = String(c?.phone || "")
  await sql`UPDATE image_consultations SET status = 'entregada', updated_at = NOW() WHERE id = ${row.consultation_id} AND status <> 'cancelada'`
  await logEvent(sql, row.consultation_id, { actor: "barbero", actorId: actorOf(session), action: "envio_whatsapp", detail: { version: row.version } })
  return res.json({
    ok: true, report: toReport(next), url, message,
    waUrl: /^\d{9}$/.test(phone) ? `https://wa.me/56${phone}?text=${encodeURIComponent(message)}` : `https://wa.me/?text=${encodeURIComponent(message)}`,
  })
}

/* ---------- sesión ---------- */
const actorOf = (session) => (Number.isInteger(Number(session?.id)) && Number(session.id) > 0 ? Number(session.id) : null)

/* ---------- handler ---------- */
export async function handleImagen(req, res, sql) {
  const session = requireInternal(req, res, { admin: true })
  if (!session) return
  res.setHeader("Cache-Control", "private, no-store")
  const q = req.query || {}
  const id = posInt(q.id)
  const actor = actorOf(session)
  let body = req.body || {}
  if (typeof body === "string") {
    try { body = JSON.parse(body) } catch { body = {} }
  }

  try {
    await ensureImageTables(sql)

    if (q.catalog) return await handleCatalog(sql, req, res, q, body)

    /* ----- fotos ----- */
    if (q.photo) {
      const photoId = posInt(q.photo)
      const [row] = photoId ? await sql`SELECT * FROM image_photos WHERE id = ${photoId}` : []
      if (!row) return res.status(404).json({ ok: false, error: "Foto no encontrada" })
      if (req.method === "GET") {
        const file = await readPrivate(row.blob_url)
        return file ? sendFile(res, file) : res.status(404).json({ ok: false, error: "Foto no encontrada" })
      }
      if (req.method === "DELETE") {
        await sql`DELETE FROM image_photos WHERE id = ${photoId}`
        await deletePrivate([row.blob_url])
        await logEvent(sql, row.consultation_id, { actor: "barbero", actorId: actor, action: "foto_borrada", detail: { angle: row.angle } })
        return res.json({ ok: true })
      }
      return res.status(405).json({ ok: false, error: "Method not allowed" })
    }
    if (req.method === "POST" && q.upload) {
      const cid = posInt(body.id)
      const c = cid ? await getConsultation(sql, cid) : null
      if (!c) return res.status(404).json({ ok: false, error: "Asesoría no encontrada" })
      if (!ANGLES.some((a) => a.id === body.angle)) return res.status(400).json({ ok: false, error: "Ángulo inválido" })
      if (!c.consentAt && !body.consent) return res.status(400).json({ ok: false, error: "Falta el consentimiento del cliente para guardar sus fotos." })
      const photo = parsePhoto(body.dataUrl)
      if (photo.error) return res.status(400).json({ ok: false, error: photo.error })
      const existing = await sql`SELECT id, angle, blob_url FROM image_photos WHERE consultation_id = ${cid}`
      const same = existing.find((p) => p.angle === body.angle)
      if (!same && existing.length >= MAX_PHOTOS) return res.status(400).json({ ok: false, error: `Máximo ${MAX_PHOTOS} fotos por asesoría` })
      const blob = await putPrivate(`imagen/${cid}/${body.angle}.${photo.ext}`, photo.buffer, photo.contentType)
      if (!c.consentAt) {
        await sql`UPDATE image_consultations SET consent_at = NOW(), consent_by = ${`barbero:${actor ?? "?"}`}, consent_version = ${CONSENT_VERSION} WHERE id = ${cid}`
        await logEvent(sql, cid, { actor: "barbero", actorId: actor, action: "consentimiento", detail: { version: CONSENT_VERSION } })
      }
      if (same) {
        await sql`DELETE FROM image_photos WHERE id = ${same.id}`
        await deletePrivate([same.blob_url])
      }
      const [row] = await sql`
        INSERT INTO image_photos (consultation_id, angle, blob_url, content_type, uploaded_by)
        VALUES (${cid}, ${body.angle}, ${blob.url}, ${photo.contentType}, ${`barbero:${actor ?? "?"}`}) RETURNING *`
      await sql`UPDATE image_consultations SET updated_at = NOW() WHERE id = ${cid}`
      await logEvent(sql, cid, { actor: "barbero", actorId: actor, action: "foto", detail: { angle: body.angle } })
      return res.status(201).json({ ok: true, photo: toPhoto(row) })
    }

    /* ----- recomendaciones ----- */
    if (q.rec && req.method !== "POST") {
      const recId = posInt(q.rec)
      const [row] = recId ? await sql`SELECT * FROM image_recommendations WHERE id = ${recId}` : []
      if (!row) return res.status(404).json({ ok: false, error: "Recomendación no encontrada" })
      if (req.method === "DELETE") {
        if (row.source !== "manual") return res.status(400).json({ ok: false, error: "Las sugerencias no se borran: descártalas." })
        await sql`DELETE FROM image_recommendations WHERE id = ${recId}`
        await logEvent(sql, row.consultation_id, { actor: "barbero", actorId: actor, action: "rec_borrada", detail: { kind: row.kind, title: row.title } })
        return res.json({ ok: true })
      }
      if (req.method === "PATCH") {
        const editing = body.title !== undefined || body.detail !== undefined || body.reason !== undefined || body.productId !== undefined
        let status = ["sugerida", "aprobada", "descartada"].includes(body.status) ? body.status : row.status
        let title = row.title
        let detail = row.detail || {}
        let reason = row.reason
        let productId = row.product_id
        if (editing) {
          title = text(body.title, 200) || row.title
          detail = body.detail !== undefined ? readDetail(body.detail, row.kind) : detail
          reason = body.reason !== undefined ? text(body.reason, 800) : reason
          if (body.productId !== undefined && PRODUCT_KINDS.includes(row.kind)) {
            const pid = posInt(body.productId)
            const [p] = pid ? await sql`SELECT id FROM image_products WHERE id = ${pid}` : []
            if (!p) return res.status(400).json({ ok: false, error: "Elige un producto del catálogo" })
            productId = p.id
          }
          // Editar es aprobar con cambios (queda marcado para los indicadores).
          if (!body.status) status = "aprobada"
        }
        const [next] = await sql`
          UPDATE image_recommendations SET
            title = ${title}, detail = ${JSON.stringify(detail)}::jsonb, reason = ${reason}, product_id = ${productId},
            status = ${status}, edited = edited OR ${editing && row.source !== "manual"}::boolean,
            decided_by = (SELECT id FROM barbers WHERE id = ${actor}::int), decided_at = NOW(), updated_at = NOW()
          WHERE id = ${recId} RETURNING *`
        await logEvent(sql, row.consultation_id, {
          actor: "barbero", actorId: actor,
          action: editing ? "rec_editada" : `rec_${status}`,
          detail: { kind: row.kind, title },
        })
        return res.json({ ok: true, rec: toRec(next) })
      }
      return res.status(405).json({ ok: false, error: "Method not allowed" })
    }

    /* ----- informes ----- */
    if (q.report) {
      const reportId = posInt(q.report)
      const [row] = reportId ? await sql`SELECT * FROM image_reports WHERE id = ${reportId}` : []
      if (!row) return res.status(404).json({ ok: false, error: "Informe no encontrado" })
      if (req.method === "GET" && q.pdf) {
        const [c] = await sql`SELECT name FROM image_consultations WHERE id = ${row.consultation_id}`
        return sendFile(res, { buffer: await reportPdfBytes(row), contentType: "application/pdf" }, { filename: reportFileName(c?.name, row.version) })
      }
      if (req.method === "POST" && q.send) return await sendReport(sql, row, body, session, res)
      if (req.method === "POST" && q.share) return await shareReport(sql, row, session, res)
      return res.status(405).json({ ok: false, error: "Method not allowed" })
    }

    /* ----- asesorías ----- */
    if (req.method === "GET") {
      if (q.candidates) {
        const date = DATE_RE.test(String(q.date || "")) ? q.date : yesterdayKey()
        return res.json({ ok: true, date, bookings: await candidates(sql, date) })
      }
      if (id && q.preview) {
        const c = await getConsultation(sql, id)
        if (!c) return res.status(404).json({ ok: false, error: "Asesoría no encontrada" })
        const [{ v }] = await sql`SELECT COALESCE(max(version), 0) + 1 AS v FROM image_reports WHERE consultation_id = ${id}`
        const bytes = await buildImagenPdf(await reportSnapshot(sql, c, v), { draft: true })
        return sendFile(res, { buffer: Buffer.from(bytes), contentType: "application/pdf" }, { filename: reportFileName(c.name) })
      }
      if (id) {
        const full = await fullConsultation(sql, id)
        return full ? res.json({ ok: true, ...full }) : res.status(404).json({ ok: false, error: "Asesoría no encontrada" })
      }
      const phone = normalizePhone(q.phone)
      if (phone.length === 9) return res.json({ ok: true, consultations: await listConsultations(sql, phone) })
      const [consultations, indicators] = await Promise.all([listConsultations(sql, null), stats(sql)])
      return res.json({ ok: true, consultations, stats: indicators })
    }

    if (req.method === "POST" && id && q.suggest) {
      const c = await getConsultation(sql, id)
      if (!c) return res.status(404).json({ ok: false, error: "Asesoría no encontrada" })
      const catalog = await loadCatalog(sql, { activeOnly: true })
      const out = suggest({ diagnosis: c.diagnosis, intake: c.intake, catalog })
      const existing = await loadRecs(sql, id)
      // Se reemplazan solo las sugerencias de regla que Bruno no tocó; lo
      // aprobado, editado, descartado y manual se queda.
      await sql`DELETE FROM image_recommendations WHERE consultation_id = ${id} AND source = 'regla' AND status = 'sugerida' AND NOT edited`
      const kept = new Set(existing.filter((r) => !(r.source === "regla" && r.status === "sugerida" && !r.edited)).map((r) => r.ruleId).filter(Boolean))
      let position = existing.reduce((m, r) => Math.max(m, r.position || 0), 0)
      for (const item of out.items) {
        if (item.ruleId && kept.has(item.ruleId)) continue
        position += 1
        await sql`
          INSERT INTO image_recommendations (consultation_id, kind, product_id, title, detail, reason, source, rule_id, status, position)
          VALUES (${id}, ${item.kind}, ${item.productId ?? null}, ${String(item.title).slice(0, 200)}, ${JSON.stringify(item.detail || {})}::jsonb,
                  ${item.reason || null}, 'regla', ${item.ruleId || null}, 'sugerida', ${position})`
      }
      await logEvent(sql, id, { actor: "barbero", actorId: actor, action: "sugerencias", detail: { items: out.items.length, warnings: out.warnings.length, rules: out.version } })
      return res.json({ ok: true, recs: await loadRecs(sql, id), warnings: out.warnings })
    }

    if (req.method === "POST" && id && q.rec) {
      const kind = pick(body.kind, KIND_IDS)
      if (!kind) return res.status(400).json({ ok: false, error: "Tipo de recomendación inválido" })
      let productId = null
      let title = text(body.title, 200)
      if (PRODUCT_KINDS.includes(kind)) {
        // Regla del documento: un producto se elige del catálogo, nunca se inventa.
        const pid = posInt(body.productId)
        const [p] = pid ? await sql`SELECT * FROM image_products WHERE id = ${pid} AND category = ANY(${CATEGORIES.filter((cat) => cat.group === KIND_GROUP[kind]).map((cat) => cat.id)}::text[])` : []
        if (!p) return res.status(400).json({ ok: false, error: "Elige un producto del catálogo" })
        productId = p.id
        title = title || [p.brand, p.name].filter(Boolean).join(" ")
      }
      if (!title) return res.status(400).json({ ok: false, error: "Escribe la recomendación" })
      const [{ pos }] = await sql`SELECT COALESCE(max(position), 0) + 1 AS pos FROM image_recommendations WHERE consultation_id = ${id}`
      const [row] = await sql`
        INSERT INTO image_recommendations (consultation_id, kind, product_id, title, detail, reason, source, status, decided_by, decided_at, position)
        VALUES (${id}, ${kind}, ${productId}, ${title}, ${JSON.stringify(readDetail(body.detail, kind))}::jsonb, ${text(body.reason, 800)},
                'manual', 'aprobada', (SELECT id FROM barbers WHERE id = ${actor}::int), NOW(), ${pos})
        RETURNING *`
      await logEvent(sql, id, { actor: "barbero", actorId: actor, action: "rec_manual", detail: { kind, title } })
      return res.status(201).json({ ok: true, rec: toRec(row) })
    }

    if (req.method === "POST" && id && q.generate) {
      const c = await getConsultation(sql, id)
      if (!c) return res.status(404).json({ ok: false, error: "Asesoría no encontrada" })
      return await generateReport(sql, c, session, res)
    }

    if (req.method === "POST" && id && q.paid) {
      const amount = Math.round(Number(body.amount))
      const method = pick(body.method, ["efectivo", "transferencia", "tarjeta", "reserva"])
      if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000 || !method) return res.status(400).json({ ok: false, error: "Monto o medio de pago inválido" })
      const [row] = await sql`
        UPDATE image_consultations SET payment_status = 'pagada', paid_amount = ${amount}, payment_method = ${method},
          paid_at = NOW(), status = CASE WHEN status = 'pago_pendiente' THEN 'datos_pendientes' ELSE status END, updated_at = NOW()
        WHERE id = ${id} RETURNING *`
      if (!row) return res.status(404).json({ ok: false, error: "Asesoría no encontrada" })
      await logEvent(sql, id, { actor: "barbero", actorId: actor, action: "pago", detail: { amount, method } })
      return res.json({ ok: true, consultation: toConsultation(row) })
    }

    if (req.method === "POST") {
      const bookingId = posInt(body.bookingId)
      const modality = pick(body.modality, MODALITIES.map((m) => m.id)) || "presencial"
      const phone = normalizePhone(body.phone)
      const rawEmail = String(body.email || "").trim().toLowerCase()
      const name = text(body.name, 200)
      if (!name && phone.length !== 9) return res.status(400).json({ ok: false, error: "Falta el cliente" })
      const [client] = phone.length === 9 ? await sql`SELECT id FROM users WHERE phone = ${phone} LIMIT 1` : []
      const [row] = await sql`
        INSERT INTO image_consultations (client_id, booking_id, source, modality, status, payment_status, name, phone, email,
                                         visit_date, form_token, created_by)
        VALUES (${client?.id ?? null}, ${bookingId}, 'panel', ${modality}, 'datos_pendientes', 'en_local', ${name},
                ${phone.length === 9 ? phone : null}, ${EMAIL_RE.test(rawEmail) ? rawEmail : null},
                ${DATE_RE.test(String(body.visitDate || "")) ? body.visitDate : null}::date, ${newToken()},
                (SELECT id FROM barbers WHERE id = ${actor}::int))
        RETURNING *`
      await logEvent(sql, row.id, { actor: "barbero", actorId: actor, action: "creada", detail: { modality, bookingId } })
      return res.status(201).json({ ok: true, ...(await fullConsultation(sql, row.id)) })
    }

    if (req.method === "PATCH") {
      if (!id) return res.status(400).json({ ok: false, error: "Falta la asesoría" })
      const c = await getConsultation(sql, id)
      if (!c) return res.status(404).json({ ok: false, error: "Asesoría no encontrada" })
      const phone = body.phone !== undefined ? normalizePhone(body.phone) : c.phone
      const rawEmail = body.email !== undefined ? String(body.email || "").trim().toLowerCase() : c.email
      const age = body.age === "" || body.age == null ? null : Math.round(Number(body.age))
      const diagnosis = body.diagnosis !== undefined ? cleanDiagnosis(body.diagnosis) : c.diagnosis
      const diagnosisChanged = body.diagnosis !== undefined && JSON.stringify(diagnosis) !== JSON.stringify(c.diagnosis)
      // Estado: solo cancelar o reabrir a mano; el resto lo mueve el flujo.
      let status = c.status
      if (body.status === "cancelada") status = "cancelada"
      else if (body.status === "reabrir" && c.status === "cancelada") status = c.intakeSubmittedAt || c.diagnosedAt ? "en_revision" : "datos_pendientes"
      else if (diagnosisChanged && c.status === "datos_pendientes") status = "en_revision"
      const [client] = phone && phone.length === 9 ? await sql`SELECT id FROM users WHERE phone = ${phone} LIMIT 1` : []
      const [row] = await sql`
        UPDATE image_consultations SET
          name = ${body.name !== undefined ? text(body.name, 200) : c.name},
          phone = ${phone && phone.length === 9 ? phone : null},
          email = ${rawEmail && EMAIL_RE.test(rawEmail) ? rawEmail : null},
          age = ${body.age !== undefined ? (Number.isFinite(age) && age > 0 && age < 120 ? age : null) : c.age},
          modality = ${pick(body.modality, MODALITIES.map((m) => m.id)) || c.modality},
          visit_date = ${body.visitDate !== undefined ? (DATE_RE.test(String(body.visitDate || "")) ? body.visitDate : null) : c.visitDate}::date,
          intake = ${JSON.stringify(body.intake !== undefined ? cleanIntake(body.intake) : c.intake)}::jsonb,
          diagnosis = ${JSON.stringify(diagnosis)}::jsonb,
          diagnosed_by = CASE WHEN ${diagnosisChanged}::boolean THEN (SELECT id FROM barbers WHERE id = ${actor}::int) ELSE diagnosed_by END,
          diagnosed_at = CASE WHEN ${diagnosisChanged}::boolean THEN NOW() ELSE diagnosed_at END,
          next_followup = ${body.nextFollowup !== undefined ? (DATE_RE.test(String(body.nextFollowup || "")) ? body.nextFollowup : null) : c.nextFollowup}::date,
          notes = ${body.notes !== undefined ? text(body.notes, 2000) : c.notes},
          client_id = COALESCE(${client?.id ?? null}, client_id),
          status = ${status},
          updated_at = NOW()
        WHERE id = ${id} RETURNING *`
      if (body.consent && !c.consentAt) {
        await sql`UPDATE image_consultations SET consent_at = NOW(), consent_by = ${`barbero:${actor ?? "?"}`}, consent_version = ${CONSENT_VERSION} WHERE id = ${id}`
        await logEvent(sql, id, { actor: "barbero", actorId: actor, action: "consentimiento", detail: { version: CONSENT_VERSION } })
      }
      if (diagnosisChanged) await logEvent(sql, id, { actor: "barbero", actorId: actor, action: "diagnostico", detail: { face: diagnosis.face?.name || null } })
      if (status !== c.status) await logEvent(sql, id, { actor: "barbero", actorId: actor, action: "estado", detail: { from: c.status, to: status } })
      return row ? res.json({ ok: true, ...(await fullConsultation(sql, id)) }) : res.status(404).json({ ok: false, error: "Asesoría no encontrada" })
    }

    if (req.method === "DELETE") {
      if (!id) return res.status(400).json({ ok: false, error: "Falta la asesoría" })
      const [photos, reports] = await Promise.all([
        sql`SELECT blob_url FROM image_photos WHERE consultation_id = ${id}`,
        sql`SELECT pdf_url FROM image_reports WHERE consultation_id = ${id}`,
      ])
      const rows = await sql`DELETE FROM image_consultations WHERE id = ${id} RETURNING id`
      if (!rows.length) return res.status(404).json({ ok: false, error: "Asesoría no encontrada" })
      await deletePrivate([...photos.map((p) => p.blob_url), ...reports.map((r) => r.pdf_url)])
      return res.json({ ok: true })
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" })
  } catch (err) {
    console.error("imagen error:", req.method, err?.message || err)
    if (res.headersSent) return
    return res.status(err?.status || 500).json({ ok: false, error: err?.status ? err.message : "No se pudo procesar la asesoría" })
  }
}

/* ---------- catálogo ---------- */
async function handleCatalog(sql, req, res, q, body) {
  const pid = posInt(q.pid)
  if (req.method === "GET") {
    if (q.essentials) {
      // Productos reales de la tienda, para importarlos (nunca se inventan).
      const rows = await sql`
        SELECT p.id, p.name, p.brand, p.price, p.stock, p.img_front AS "imgFront",
               EXISTS (SELECT 1 FROM image_products ip WHERE ip.product_id = p.id) AS imported
        FROM products p WHERE (to_jsonb(p)->>'archived_at') IS NULL ORDER BY p.name`
      return res.json({ ok: true, products: rows })
    }
    return res.json({ ok: true, products: await loadCatalog(sql) })
  }

  if (req.method === "POST" && q.import) {
    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 100)
    let created = 0
    for (const it of items) {
      const productId = posInt(it.productId)
      const category = pick(it.category, CATEGORY_IDS)
      if (!productId || !category) continue
      const [p] = await sql`SELECT id, name, brand, description, img_front FROM products WHERE id = ${productId}`
      if (!p) continue
      const exists = await sql`SELECT 1 FROM image_products WHERE product_id = ${productId} LIMIT 1`
      if (exists.length) continue
      await sql`
        INSERT INTO image_products (name, brand, category, img_url, description, sold_here, product_id)
        VALUES (${p.name}, ${p.brand || null}, ${category}, ${p.img_front || null}, ${p.description || null}, true, ${p.id})`
      created += 1
    }
    return res.json({ ok: true, created, products: await loadCatalog(sql) })
  }

  if (req.method === "POST" && q.upload) {
    const id = posInt(body.pid)
    const photo = parsePhoto(body.dataUrl)
    if (!id || photo.error) return res.status(400).json({ ok: false, error: photo.error || "Falta el producto" })
    // Foto de producto: es material de catálogo, va pública como las de Essentials.
    const blob = await put(`imagen/catalogo/${id}.${photo.ext}`, photo.buffer, {
      access: "public", addRandomSuffix: true, contentType: photo.contentType, token: process.env.BLOB_READ_WRITE_TOKEN,
    })
    const [row] = await sql`UPDATE image_products SET img_url = ${blob.url}, updated_at = NOW() WHERE id = ${id} RETURNING *`
    return row ? res.json({ ok: true, product: toProduct(row) }) : res.status(404).json({ ok: false, error: "Producto no encontrado" })
  }

  if (req.method === "POST" || req.method === "PATCH") {
    if (req.method === "PATCH" && !pid) return res.status(400).json({ ok: false, error: "Falta el producto" })
    if (req.method === "PATCH" && body.reviewed && Object.keys(body).length === 1) {
      const [row] = await sql`UPDATE image_products SET reviewed_at = NOW(), updated_at = NOW() WHERE id = ${pid} RETURNING *`
      return row ? res.json({ ok: true, product: toProduct(row) }) : res.status(404).json({ ok: false, error: "Producto no encontrado" })
    }
    const p = readProduct(body)
    if (!p.name || !p.category) return res.status(400).json({ ok: false, error: "Falta el nombre o la categoría" })
    if (p.productId) {
      const [shop] = await sql`SELECT id FROM products WHERE id = ${p.productId}`
      if (!shop) p.productId = null
    }
    const arr = (v) => JSON.stringify(v)
    if (req.method === "POST") {
      const [row] = await sql`
        INSERT INTO image_products (name, brand, category, img_url, description, hold, shine, amount, application, usage, frequency,
                                    hair_types, thickness, conditions, needs, sold_here, product_id, price, buy_url, active, reviewed_at)
        VALUES (${p.name}, ${p.brand}, ${p.category}, ${text(body.imgUrl, 500)}, ${p.description}, ${p.hold}, ${p.shine}, ${p.amount},
                ${p.application}, ${p.usage}, ${p.frequency}, ${arr(p.hairTypes)}::jsonb, ${arr(p.thickness)}::jsonb,
                ${arr(p.conditions)}::jsonb, ${arr(p.needs)}::jsonb, ${p.soldHere}, ${p.productId}, ${p.price}, ${p.buyUrl},
                ${p.active}, ${body.reviewed ? new Date().toISOString() : null}::timestamptz)
        RETURNING *`
      return res.status(201).json({ ok: true, product: toProduct(row) })
    }
    const [row] = await sql`
      UPDATE image_products SET
        name = ${p.name}, brand = ${p.brand}, category = ${p.category}, description = ${p.description}, hold = ${p.hold},
        shine = ${p.shine}, amount = ${p.amount}, application = ${p.application}, usage = ${p.usage}, frequency = ${p.frequency},
        hair_types = ${arr(p.hairTypes)}::jsonb, thickness = ${arr(p.thickness)}::jsonb, conditions = ${arr(p.conditions)}::jsonb,
        needs = ${arr(p.needs)}::jsonb, sold_here = ${p.soldHere}, product_id = ${p.productId}, price = ${p.price},
        buy_url = ${p.buyUrl}, active = ${p.active},
        reviewed_at = CASE WHEN ${Boolean(body.reviewed)}::boolean THEN NOW() ELSE reviewed_at END,
        updated_at = NOW()
      WHERE id = ${pid} RETURNING *`
    return row ? res.json({ ok: true, product: toProduct(row) }) : res.status(404).json({ ok: false, error: "Producto no encontrado" })
  }

  if (req.method === "DELETE") {
    if (!pid) return res.status(400).json({ ok: false, error: "Falta el producto" })
    // Si ya se recomendó en alguna asesoría, se desactiva (los informes guardan
    // su snapshot, pero la ficha de la recomendación lo sigue apuntando).
    const used = await sql`SELECT 1 FROM image_recommendations WHERE product_id = ${pid} LIMIT 1`
    if (used.length) {
      const [row] = await sql`UPDATE image_products SET active = false, updated_at = NOW() WHERE id = ${pid} RETURNING *`
      return res.json({ ok: true, archived: true, deleted: false, product: toProduct(row) })
    }
    const rows = await sql`DELETE FROM image_products WHERE id = ${pid} RETURNING id`
    return rows.length ? res.json({ ok: true, archived: false, deleted: true }) : res.status(404).json({ ok: false, error: "Producto no encontrado" })
  }

  return res.status(405).json({ ok: false, error: "Method not allowed" })
}
