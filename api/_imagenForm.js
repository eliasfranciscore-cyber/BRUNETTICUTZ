/* BRUNETTI IMAGE STUDIO — lo público: formulario de ingreso e informe
   ------------------------------------------------------------------
   Formulario (/asesoria/datos?t=<form_token>), sin sesión: la llave es el
   token de 32 hex de la asesoría, que llega por correo después del pago o
   que Bruno manda por WhatsApp.
     GET    ?mode=imagen-form&t=                 estado (sin diagnóstico ni notas internas)
     GET    ?mode=imagen-form&t=&photo=          una foto propia
     PATCH  ?mode=imagen-form&t=                 guarda avance (datos + ingreso)
     POST   ?mode=imagen-form&t=&consent=1       consentimiento para guardar fotos
     POST   ?mode=imagen-form&t=&upload=1        { angle, dataUrl } → Blob privado
     DELETE ?mode=imagen-form&t=&photo=
     POST   ?mode=imagen-form&t=&submit=1        envía: pasa a "Por revisar"
   Solo se puede editar con el pago confirmado (o cobro aparte) y antes de
   enviar. Lo que declara el cliente es información, no diagnóstico: el
   diagnóstico lo registra Bruno en el panel.

   Informe (/asesoria/informe/<share_token>, rewrite en vercel.json):
     GET    ?mode=imagen-informe&t=               el PDF, mientras el link esté vigente (30 días)
   ------------------------------------------------------------------ */

import { notifyAll } from "./push.js"
import { rateLimit, clientIp } from "./_rateLimit.js"
import { normalizePhone, EMAIL_RE } from "./_bridge.js"
import {
  TOKEN_RE, MAX_PHOTOS, text, toConsultation, toPhoto, logEvent, putPrivate, readPrivate, deletePrivate,
  sendFile, parsePhoto, cleanIntake,
} from "./_imagenCore.js"
import { ANGLES, CONSENT_VERSION } from "../src/imagen/vocab.js"

const noTable = (err) => /image_consultations|image_reports|image_photos/.test(String(err?.message || "")) && /does not exist/.test(String(err?.message || ""))

function publicState(c, photos) {
  const canEdit = ["pagada", "en_local"].includes(c.paymentStatus) && !c.intakeSubmittedAt && c.status !== "cancelada"
  return {
    name: c.name, email: c.email, phone: c.phone, age: c.age, modality: c.modality,
    status: c.status, paymentStatus: c.paymentStatus, paid: c.paymentStatus === "pagada", canEdit,
    submitted: Boolean(c.intakeSubmittedAt), intake: c.intake || {}, consentAt: c.consentAt,
    photos: photos.map(toPhoto).map(({ id, angle }) => ({ id, angle })),
  }
}

export async function handleImagenForm(req, res, sql) {
  res.setHeader("Cache-Control", "private, no-store")
  res.setHeader("X-Robots-Tag", "noindex")
  const q = req.query || {}
  const token = String(q.t || "")
  if (!TOKEN_RE.test(token)) return res.status(404).json({ ok: false, error: "Enlace no válido" })
  let body = req.body || {}
  if (typeof body === "string") {
    try { body = JSON.parse(body) } catch { body = {} }
  }

  try {
    // Fotos y guardados cuentan juntos: de sobra para un cliente, corto para un bot.
    if (req.method !== "GET" || q.photo) {
      const allowed = await rateLimit(sql, `imagen-form:${clientIp(req)}`, { max: 120, windowSeconds: 600 })
      if (!allowed) return res.status(429).json({ ok: false, error: "Demasiados intentos. Espera unos minutos." })
    }

    const [row] = await sql`SELECT * FROM image_consultations WHERE form_token = ${token}`
    const c = toConsultation(row)
    if (!c) return res.status(404).json({ ok: false, error: "Enlace no válido" })
    const photos = await sql`SELECT * FROM image_photos WHERE consultation_id = ${c.id} ORDER BY created_at`
    const state = publicState(c, photos)

    if (q.photo) {
      const photo = photos.find((p) => p.id === Number(q.photo))
      if (!photo) return res.status(404).json({ ok: false, error: "Foto no encontrada" })
      if (req.method === "GET") {
        const file = await readPrivate(photo.blob_url)
        return file ? sendFile(res, file) : res.status(404).json({ ok: false, error: "Foto no encontrada" })
      }
      if (req.method === "DELETE") {
        if (!state.canEdit) return res.status(409).json({ ok: false, error: "Ya no se puede modificar" })
        await sql`DELETE FROM image_photos WHERE id = ${photo.id}`
        await deletePrivate([photo.blob_url])
        await logEvent(sql, c.id, { actor: "cliente", action: "foto_borrada", detail: { angle: photo.angle } })
        return res.json({ ok: true })
      }
      return res.status(405).json({ ok: false, error: "Method not allowed" })
    }

    if (req.method === "GET") return res.json({ ok: true, consultation: state })
    if (!state.canEdit) {
      const error = state.submitted ? "Tus datos ya fueron enviados." : state.status === "cancelada" ? "Esta asesoría fue cancelada." : "El pago todavía no está confirmado."
      return res.status(409).json({ ok: false, error, consultation: state })
    }

    if (req.method === "PATCH") {
      const phone = normalizePhone(body.phone)
      const email = String(body.email || "").trim().toLowerCase()
      const age = body.age === "" || body.age == null ? null : Math.round(Number(body.age))
      const [next] = await sql`
        UPDATE image_consultations SET
          name = COALESCE(${text(body.name, 200)}, name),
          email = COALESCE(${EMAIL_RE.test(email) ? email : null}, email),
          phone = COALESCE(${phone.length === 9 ? phone : null}, phone),
          age = ${Number.isFinite(age) && age > 0 && age < 120 ? age : null},
          intake = ${JSON.stringify(cleanIntake(body.intake))}::jsonb,
          updated_at = NOW()
        WHERE id = ${c.id} RETURNING *`
      return res.json({ ok: true, consultation: publicState(toConsultation(next), photos) })
    }

    if (req.method === "POST" && q.consent) {
      if (!c.consentAt) {
        await sql`UPDATE image_consultations SET consent_at = NOW(), consent_by = 'cliente', consent_version = ${CONSENT_VERSION}, updated_at = NOW() WHERE id = ${c.id}`
        await logEvent(sql, c.id, { actor: "cliente", action: "consentimiento", detail: { version: CONSENT_VERSION } })
      }
      return res.json({ ok: true, consultation: { ...state, consentAt: c.consentAt || new Date().toISOString() } })
    }

    if (req.method === "POST" && q.upload) {
      if (!c.consentAt) return res.status(400).json({ ok: false, error: "Primero acepta el uso de tus fotos." })
      if (!ANGLES.some((a) => a.id === body.angle)) return res.status(400).json({ ok: false, error: "Ángulo inválido" })
      const photo = parsePhoto(body.dataUrl)
      if (photo.error) return res.status(400).json({ ok: false, error: photo.error })
      const same = photos.find((p) => p.angle === body.angle)
      if (!same && photos.length >= MAX_PHOTOS) return res.status(400).json({ ok: false, error: `Máximo ${MAX_PHOTOS} fotos` })
      const blob = await putPrivate(`imagen/${c.id}/${body.angle}.${photo.ext}`, photo.buffer, photo.contentType)
      if (same) {
        await sql`DELETE FROM image_photos WHERE id = ${same.id}`
        await deletePrivate([same.blob_url])
      }
      const [row2] = await sql`
        INSERT INTO image_photos (consultation_id, angle, blob_url, content_type, uploaded_by)
        VALUES (${c.id}, ${body.angle}, ${blob.url}, ${photo.contentType}, 'cliente') RETURNING *`
      await logEvent(sql, c.id, { actor: "cliente", action: "foto", detail: { angle: body.angle } })
      return res.status(201).json({ ok: true, photo: { id: row2.id, angle: row2.angle } })
    }

    if (req.method === "POST" && q.submit) {
      if (!c.name || !EMAIL_RE.test(String(c.email || "")) || !/^\d{9}$/.test(String(c.phone || ""))) {
        return res.status(400).json({ ok: false, error: "Completa tu nombre, correo y WhatsApp." })
      }
      if (!c.consentAt) return res.status(400).json({ ok: false, error: "Falta aceptar el uso de tus fotos." })
      if (c.modality === "online") {
        const have = new Set(photos.map((p) => p.angle))
        const missing = ANGLES.filter((a) => a.required && !have.has(a.id)).map((a) => a.label.toLowerCase())
        if (missing.length) return res.status(400).json({ ok: false, error: `Faltan fotos: ${missing.join(", ")}.` })
      }
      const [next] = await sql`
        UPDATE image_consultations SET intake_submitted_at = NOW(),
          status = CASE WHEN status = 'datos_pendientes' THEN 'en_revision' ELSE status END, updated_at = NOW()
        WHERE id = ${c.id} RETURNING *`
      await logEvent(sql, c.id, { actor: "cliente", action: "datos_enviados", detail: { photos: photos.length } })
      try {
        await notifyAll({
          title: `Datos recibidos · Asesoría ${c.modality === "online" ? "online" : "presencial"}`,
          body: `${c.name} completó su ficha${photos.length ? ` y subió ${photos.length} foto${photos.length === 1 ? "" : "s"}` : ""}.`,
          url: "/panel?tab=imagen",
          tag: `asesoria-datos-${c.id}`,
        })
      } catch (err) {
        console.error("imagen: push no enviado:", err?.message || err)
      }
      return res.json({ ok: true, consultation: publicState(toConsultation(next), photos) })
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" })
  } catch (err) {
    if (noTable(err)) return res.status(404).json({ ok: false, error: "Enlace no válido" })
    console.error("imagen-form error:", req.method, err?.message || err)
    return res.status(err?.status || 500).json({ ok: false, error: err?.status ? err.message : "No se pudo guardar. Intenta de nuevo." })
  }
}

export async function handleImagenInforme(req, res, sql) {
  res.setHeader("X-Robots-Tag", "noindex")
  const token = String(req.query?.t || "")
  if (!TOKEN_RE.test(token) || req.method !== "GET") return res.status(404).json({ ok: false, error: "Informe no encontrado" })
  try {
    const [row] = await sql`SELECT r.*, c.name FROM image_reports r JOIN image_consultations c ON c.id = r.consultation_id WHERE r.share_token = ${token}`
    if (!row) return res.status(404).json({ ok: false, error: "Informe no encontrado" })
    if (!row.share_expires_at || new Date(row.share_expires_at) <= new Date()) {
      return res.status(410).json({ ok: false, error: "Este enlace venció. Pídele uno nuevo a Bruno por WhatsApp." })
    }
    let buffer = row.pdf_url ? (await readPrivate(row.pdf_url))?.buffer : null
    if (!buffer?.length) {
      const { buildImagenPdf } = await import("./_imagenPdf.js")
      buffer = Buffer.from(await buildImagenPdf({ ...row.snapshot, version: row.version }))
    }
    const { reportFileName } = await import("./_imagenPdf.js")
    return sendFile(res, { buffer, contentType: "application/pdf" }, { filename: reportFileName(row.name, row.version) })
  } catch (err) {
    if (noTable(err)) return res.status(404).json({ ok: false, error: "Informe no encontrado" })
    console.error("imagen-informe error:", err?.message || err)
    return res.status(500).json({ ok: false, error: "No se pudo abrir el informe" })
  }
}
