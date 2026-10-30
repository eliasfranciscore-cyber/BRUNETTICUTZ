/* BRUNETTI — Visagismo en el panel (pestaña Visagismo)
   ------------------------------------------------------------------
   Bruno arma un brief para un cliente que atendió (tipo de rostro, corte
   ideal, tips, fotos del antes y el después) y se lo manda por correo con el
   PDF adjunto (api/_visagismoPdf.js). Va como /api/clients?mode=visagismo:
   no es una función nueva (tope de 12 del plan Hobby) y se carga con
   import() dinámico, así un error acá no tumba /api/clients.

     GET    ?mode=visagismo                         lista (o &id= uno, &phone= de un cliente)
     GET    ?mode=visagismo&candidates=1&date=      atendidos ese día (ayer por defecto)
     GET    ?mode=visagismo&id=&pdf=1[&compact=1]   el PDF (vista previa / descarga)
     POST   ?mode=visagismo                         crea un borrador
     PATCH  ?mode=visagismo&id=                     guarda el borrador
     DELETE ?mode=visagismo&id=                     lo borra
     POST   ?mode=visagismo&upload=1                { id, slot: before|after, dataUrl } → foto al Blob
     POST   ?mode=visagismo&id=&send=1              { email? } → PDF adjunto por correo

   Todo con sesión de barbero admin (Bruno). Un error de base es un 500 de
   verdad: nunca datos de demo.

   Fase 2 (autoevaluación pagada, todavía no): las filas con
   source = 'autoevaluacion' saldrán en esta misma lista.
   ------------------------------------------------------------------ */

import { put } from "@vercel/blob"
import { requireInternal } from "./_auth.js"
import { normalizePhone, EMAIL_RE } from "./_bridge.js"
import { ensureVisagismoTable } from "./_schema.js"
import { sendVisagismoBriefEmail } from "./_email.js"
import { buildVisagismoPdf, briefFileName, THEME_IDS, DEFAULT_THEME } from "./_visagismoPdf.js"

const TZ = "America/Santiago"
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// La silueta es un path SVG propio (src/data/estilo.js): solo comandos y números.
const PATH_RE = /^[MmCcLlQqZzHhVvSs0-9 .,-]{1,800}$/
const MAX_TIPS = 12
// Fotos de referencia de los cortes: solo las del catálogo de /style.
const REF_IMG_RE = /^\/assets\/estilo\/[\w.-]+\.(jpe?g|png)$/
const refImg = (v) => (REF_IMG_RE.test(String(v || "")) ? String(v) : null)

const text = (v, max) => {
  const s = String(v ?? "").trim()
  return s ? s.slice(0, max) : null
}

function yesterdayKey() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
  const d = new Date(`${today}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/* La forma de rostro se guarda como foto de lo que se mandó (ver
   ensureVisagismoTable): solo los campos conocidos, recortados. */
function cleanShape(raw) {
  if (!raw || typeof raw !== "object") return null
  const shape = {
    id: text(raw.id, 40),
    name: text(raw.name, 60),
    tagline: text(raw.tagline, 120),
    diagnosis: text(raw.diagnosis, 900),
    goal: text(raw.goal, 300),
    avoid: text(raw.avoid, 300),
    traits: (Array.isArray(raw.traits) ? raw.traits : []).map((t) => text(t, 80)).filter(Boolean).slice(0, 6),
    path: PATH_RE.test(String(raw.path || "")) ? String(raw.path) : null,
    // Los cortes que le favorecen (el PDF muestra los que no eligió).
    best: (Array.isArray(raw.best) ? raw.best : []).slice(0, 4)
      .map((b) => ({ name: text(b?.name, 80), note: text(b?.note, 200), img: refImg(b?.img) }))
      .filter((b) => b.name),
  }
  return shape.name ? shape : null
}

function readBrief(body = {}) {
  const rawEmail = String(body.email || "").trim().toLowerCase()
  const visitDate = DATE_RE.test(String(body.visitDate || "")) ? body.visitDate : null
  const phone = normalizePhone(body.phone)
  return {
    bookingId: Number.isInteger(Number(body.bookingId)) && Number(body.bookingId) > 0 ? Number(body.bookingId) : null,
    name: text(body.name, 200),
    phone: phone.length === 9 ? phone : null,
    email: rawEmail && rawEmail.length <= 300 && EMAIL_RE.test(rawEmail) ? rawEmail : null,
    visitDate,
    shape: cleanShape(body.shape),
    cutName: text(body.cutName, 200),
    cutNote: text(body.cutNote, 600),
    cutImg: refImg(body.cutImg),
    theme: THEME_IDS.includes(body.theme) ? body.theme : DEFAULT_THEME,
    tips: (Array.isArray(body.tips) ? body.tips : []).map((t) => text(t, 300)).filter(Boolean).slice(0, MAX_TIPS),
    notes: text(body.notes, 1500),
  }
}

/* neon 0.10 no compone fragmentos de SQL: se lee la fila entera (*) y se
   pasa a la forma del front acá. */
function toClient(r) {
  if (!r) return null
  return {
    id: r.id, clientId: r.client_id, bookingId: r.booking_id, source: r.source, status: r.status,
    name: r.name, phone: r.phone, email: r.email,
    visitDate: r.visit_date instanceof Date ? r.visit_date.toISOString().slice(0, 10) : (r.visit_date ? String(r.visit_date).slice(0, 10) : null),
    faceShape: r.face_shape, shape: r.shape || null, cutName: r.cut_name, cutNote: r.cut_note, cutImg: r.cut_img || null, theme: r.theme || DEFAULT_THEME,
    tips: Array.isArray(r.tips) ? r.tips : [], notes: r.notes,
    beforeUrl: r.before_url, afterUrl: r.after_url,
    sentAt: r.sent_at, sentTo: r.sent_to, sendCount: r.send_count || 0,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

async function getBrief(sql, id) {
  const [row] = await sql`SELECT * FROM visagismo_briefs WHERE id = ${id}`
  return toClient(row)
}

async function candidates(sql, date) {
  return sql`
    SELECT b.id AS "bookingId", b.booking_date::text AS date, to_char(b.booking_time, 'HH24:MI') AS time,
           b.status, b.service_id AS "serviceId", COALESCE(s.name, b.custom_service, 'Servicio') AS service,
           u.id AS "clientId", COALESCE(u.name, '') AS name, u.phone,
           NULLIF(btrim(COALESCE(u.email, '')), '') AS email,
           vb.id AS "briefId", vb.status AS "briefStatus"
    FROM bookings b
    LEFT JOIN users u ON u.id = b.client_id
    LEFT JOIN services s ON s.id = b.service_id
    LEFT JOIN LATERAL (
      SELECT id, status FROM visagismo_briefs WHERE booking_id = b.id ORDER BY id DESC LIMIT 1
    ) vb ON true
    WHERE b.booking_date = ${date}::date AND b.status IN ('completada', 'en curso')
    ORDER BY (b.service_id = 10) DESC NULLS LAST, b.booking_time
    LIMIT 100
  `
}

/* Sube una foto del antes o el después. Solo JPEG/PNG: es lo que pdf-lib
   sabe meter en el PDF (el panel ya la manda como JPEG, sin EXIF). */
async function uploadPhoto(sql, body, res) {
  const id = Number(body.id)
  const slot = body.slot
  if (!Number.isInteger(id) || !["before", "after"].includes(slot) || !body.dataUrl) {
    return res.status(400).json({ ok: false, error: "Datos incompletos" })
  }
  const match = /^data:(image\/(?:png|jpeg|jpg));base64,(.+)$/.exec(String(body.dataUrl))
  if (!match) return res.status(400).json({ ok: false, error: "La foto tiene que ser JPEG o PNG" })
  const buffer = Buffer.from(match[2], "base64")
  if (buffer.length > 8 * 1024 * 1024) return res.status(400).json({ ok: false, error: "Foto muy pesada (máx. 8 MB)" })
  if (!(await getBrief(sql, id))) return res.status(404).json({ ok: false, error: "Brief no encontrado" })

  const ext = match[1] === "image/png" ? "png" : "jpg"
  const blob = await put(`visagismo/${id}-${slot}.${ext}`, buffer, {
    access: "public",
    addRandomSuffix: true,
    contentType: match[1] === "image/jpg" ? "image/jpeg" : match[1],
    token: process.env.BLOB_READ_WRITE_TOKEN,
  })
  const [row] = slot === "before"
    ? await sql`UPDATE visagismo_briefs SET before_url = ${blob.url}, updated_at = NOW() WHERE id = ${id} RETURNING *`
    : await sql`UPDATE visagismo_briefs SET after_url = ${blob.url}, updated_at = NOW() WHERE id = ${id} RETURNING *`
  return res.json({ ok: true, url: blob.url, brief: toClient(row) })
}

async function sendBrief(sql, id, body, res) {
  const brief = await getBrief(sql, id)
  if (!brief) return res.status(404).json({ ok: false, error: "Brief no encontrado" })
  const rawEmail = String(body.email || brief.email || "").trim().toLowerCase()
  if (!EMAIL_RE.test(rawEmail)) return res.status(400).json({ ok: false, error: "Falta un correo válido del cliente" })
  if (!brief.shape?.name) return res.status(400).json({ ok: false, error: "Elige la forma de rostro antes de enviar" })

  const bytes = await buildVisagismoPdf(brief)
  const result = await sendVisagismoBriefEmail({
    to: rawEmail,
    name: brief.name,
    faceShape: brief.shape?.name,
    cutName: brief.cutName,
    tips: brief.tips,
    pdfBase64: Buffer.from(bytes).toString("base64"),
    filename: briefFileName(brief.name),
  })
  if (!result.ok) {
    const error = result.reason === "email-not-configured"
      ? "El correo no está configurado en el servidor (RESEND_API_KEY)."
      : "No se pudo enviar el correo. Intenta de nuevo en un rato."
    return res.status(502).json({ ok: false, error, reason: result.reason })
  }

  const [row] = await sql`
    UPDATE visagismo_briefs
    SET status = 'enviado', email = ${rawEmail}, sent_to = ${rawEmail}, sent_at = NOW(),
        send_count = send_count + 1, updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `
  const brief2 = toClient(row)
  // El correo que Bruno completó en el brief le sirve también a la ficha:
  // solo si el cliente no tenía uno (nunca se pisa uno guardado).
  if (brief2?.clientId) {
    try {
      await sql`UPDATE users SET email = ${rawEmail}, updated_at = NOW() WHERE id = ${brief2.clientId} AND NULLIF(btrim(COALESCE(email, '')), '') IS NULL`
    } catch (err) {
      console.error("visagismo: no se guardó el correo en la ficha:", err?.message || err)
    }
  }
  return res.json({ ok: true, brief: brief2 })
}

export async function handleVisagismo(req, res, sql) {
  const session = requireInternal(req, res, { admin: true })
  if (!session) return
  res.setHeader("Cache-Control", "private, no-store")
  const q = req.query || {}
  const id = Number(q.id)
  const hasId = Number.isInteger(id) && id > 0
  let body = req.body || {}
  if (typeof body === "string") {
    try { body = JSON.parse(body) } catch { body = {} }
  }

  try {
    await ensureVisagismoTable(sql)

    if (req.method === "GET") {
      if (q.candidates) {
        const date = DATE_RE.test(String(q.date || "")) ? q.date : yesterdayKey()
        return res.json({ ok: true, date, bookings: await candidates(sql, date) })
      }
      if (hasId && q.pdf) {
        const brief = await getBrief(sql, id)
        if (!brief) return res.status(404).json({ ok: false, error: "Brief no encontrado" })
        // ?theme= permite comparar diseños sin guardar el brief.
        const theme = THEME_IDS.includes(q.theme) ? q.theme : brief.theme
        const bytes = await buildVisagismoPdf(brief, { compact: Boolean(q.compact), theme })
        res.setHeader("Content-Type", "application/pdf")
        res.setHeader("Content-Disposition", `inline; filename="${briefFileName(brief.name)}"`)
        return res.status(200).send(Buffer.from(bytes))
      }
      if (hasId) {
        const brief = await getBrief(sql, id)
        return brief ? res.json({ ok: true, brief }) : res.status(404).json({ ok: false, error: "Brief no encontrado" })
      }
      const phone = normalizePhone(q.phone)
      const briefs = phone.length === 9
        ? await sql`SELECT * FROM visagismo_briefs WHERE phone = ${phone} ORDER BY updated_at DESC LIMIT 50`
        : await sql`SELECT * FROM visagismo_briefs ORDER BY updated_at DESC LIMIT 300`
      return res.json({ ok: true, briefs: briefs.map(toClient) })
    }

    if (req.method === "POST" && q.upload) return await uploadPhoto(sql, body, res)
    if (req.method === "POST" && q.send) {
      if (!hasId) return res.status(400).json({ ok: false, error: "Falta el brief" })
      return await sendBrief(sql, id, body, res)
    }

    if (req.method === "POST" || req.method === "PATCH") {
      const b = readBrief(body)
      if (req.method === "PATCH" && !hasId) return res.status(400).json({ ok: false, error: "Falta el brief" })
      if (!b.name && !b.phone) return res.status(400).json({ ok: false, error: "Falta el cliente" })
      // El cliente de la ficha, por teléfono (la llave de `users`).
      const [client] = b.phone ? await sql`SELECT id FROM users WHERE phone = ${b.phone} LIMIT 1` : []
      const clientId = client?.id ?? null
      const shapeJson = b.shape ? JSON.stringify(b.shape) : null
      const tipsJson = JSON.stringify(b.tips)

      if (req.method === "POST") {
        const [row] = await sql`
          INSERT INTO visagismo_briefs (client_id, booking_id, source, status, name, phone, email, visit_date,
                                        face_shape, shape, cut_name, cut_note, cut_img, theme, tips, notes)
          VALUES (${clientId}, ${b.bookingId}, 'panel', 'borrador', ${b.name}, ${b.phone}, ${b.email}, ${b.visitDate}::date,
                  ${b.shape?.id ?? null}, ${shapeJson}::jsonb, ${b.cutName}, ${b.cutNote}, ${b.cutImg}, ${b.theme},
                  ${tipsJson}::jsonb, ${b.notes})
          RETURNING *
        `
        return res.status(201).json({ ok: true, brief: toClient(row) })
      }

      const [row] = await sql`
        UPDATE visagismo_briefs SET
          client_id = ${clientId}, booking_id = COALESCE(${b.bookingId}, booking_id),
          name = ${b.name}, phone = ${b.phone}, email = ${b.email}, visit_date = ${b.visitDate}::date,
          face_shape = ${b.shape?.id ?? null}, shape = ${shapeJson}::jsonb,
          cut_name = ${b.cutName}, cut_note = ${b.cutNote}, cut_img = ${b.cutImg}, theme = ${b.theme},
          tips = ${tipsJson}::jsonb, notes = ${b.notes},
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `
      return row ? res.json({ ok: true, brief: toClient(row) }) : res.status(404).json({ ok: false, error: "Brief no encontrado" })
    }

    if (req.method === "DELETE") {
      if (!hasId) return res.status(400).json({ ok: false, error: "Falta el brief" })
      const rows = await sql`DELETE FROM visagismo_briefs WHERE id = ${id} RETURNING id`
      return rows.length ? res.json({ ok: true }) : res.status(404).json({ ok: false, error: "Brief no encontrado" })
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" })
  } catch (err) {
    console.error("visagismo error:", req.method, err?.message || err)
    return res.status(500).json({ ok: false, error: "No se pudo procesar el brief de visagismo" })
  }
}
