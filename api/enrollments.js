import { neon } from "@neondatabase/serverless"
import { requireInternal } from "./_auth.js"
import { notifyAll } from "./push.js"
import { sendWorkshopConfirmationEmail } from "./_email.js"

/* Tabla esperada en Neon (créala si no existe):
   CREATE TABLE IF NOT EXISTS enrollments (
     id         SERIAL PRIMARY KEY,
     name       TEXT NOT NULL,
     phone      TEXT NOT NULL,
     email      TEXT NOT NULL,
     source     TEXT NOT NULL DEFAULT 'cursos',   -- 'cursos' | 'workshop'
     level      TEXT,
     message    TEXT,
     edition    TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
*/

const DEMO = [
  { id: 1, name: "Demo Barbero", phone: "912345678", email: "demo@mail.com", source: "cursos",   level: "Estoy empezando", message: "", edition: null, created_at: "2026-06-20T10:00:00Z" },
  { id: 2, name: "Demo Workshop", phone: "987654321", email: "demo2@mail.com", source: "workshop", level: null, message: null, edition: "23 de agosto", created_at: "2026-06-21T11:00:00Z" },
]

function cleanPhone(v) {
  let digits = String(v || "").replace(/\D/g, "")
  if (digits.length > 9 && digits.startsWith("56")) digits = digits.slice(2)
  return digits.slice(0, 9)
}
function sendJson(res, status, body) { return res.status(status).json(body) }

export default async function handler(req, res) {
  /* GET — lista para el panel interno (requiere sesión) */
  if (req.method === "GET") {
    const session = requireInternal(req, res)
    if (!session) return
    try {
      const sql = neon(process.env.DATABASE_URL)
      const rows = await sql`
        SELECT id, name, phone, email, source, level, message, edition, created_at
        FROM enrollments ORDER BY created_at DESC LIMIT 300
      `
      return sendJson(res, 200, { ok: true, enrollments: rows })
    } catch (err) {
      console.error("enrollments GET error:", err?.message)
      return sendJson(res, 200, { ok: true, enrollments: DEMO, demo: true })
    }
  }

  /* POST — inscripción pública (Cursos o Workshop) */
  if (req.method === "POST") {
    try {
      const sql = neon(process.env.DATABASE_URL)
      /* Auto-crear tabla si no existe (primera vez) */
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

      const body = req.body || {}
      const name  = String(body.name  || "").trim()
      const phone = cleanPhone(body.phone)
      const email = String(body.email || "").trim().toLowerCase()
      const source  = ["cursos", "workshop"].includes(body.source) ? body.source : "cursos"
      const level   = String(body.level   || "").trim() || null
      const message = String(body.message || "").trim() || null
      const edition = String(body.edition || "").trim() || null

      if (!name || phone.length < 8 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return sendJson(res, 400, { ok: false, error: "Datos incompletos" })
      }

      /* 1) Guardar la INSCRIPCIÓN primero: es el registro que lee el panel
         interno. No debe depender del upsert en `users` (que antes, al fallar
         —p. ej. por la columna updated_at NOT NULL— abortaba todo y la
         inscripción se perdía aunque al cliente se le mostrara "listo"). */
      const [row] = await sql`
        INSERT INTO enrollments (name, phone, email, source, level, message, edition)
        VALUES (${name}, ${phone}, ${email}, ${source}, ${level}, ${message}, ${edition})
        RETURNING id, created_at
      `

      /* 2) Crear/actualizar el cliente en `users` — best-effort: si falla NO
         debe tumbar la inscripción ya guardada. Alineado con api/clients.js
         (incluye updated_at = NOW()). */
      try {
        await sql`
          INSERT INTO users (name, phone, email, updated_at)
          VALUES (${name}, ${phone}, ${email}, NOW())
          ON CONFLICT (phone) DO UPDATE SET
            name  = EXCLUDED.name,
            email = COALESCE(NULLIF(EXCLUDED.email,''), users.email),
            updated_at = NOW()
        `
      } catch (uerr) {
        console.error("enrollments users upsert (no bloquea):", uerr?.message)
      }

      /* 3) Push a la app instalada (iOS) avisando de la nueva inscripción.
         Best-effort: si el push no está configurado o falla, no bloquea. */
      try {
        const tipo = source === "workshop" ? "Workshop" : "Curso"
        await notifyAll({
          title: `Nueva inscripción · ${tipo}`,
          body: `${name}${level ? " · " + level : ""} · ${phone}`,
          url: "/panel",
          tag: `inscripcion-${row.id}`,
        })
      } catch (nerr) {
        console.error("enrollments notify (no bloquea):", nerr?.message)
      }

      /* 4) Correo de confirmación al inscrito (solo workshop por ahora).
         Best-effort: si falla o no hay RESEND_API_KEY, no bloquea. */
      if (source === "workshop") {
        try {
          await sendWorkshopConfirmationEmail({ to: email, name, edition })
        } catch (eerr) {
          console.error("enrollments email (no bloquea):", eerr?.message)
        }
      }

      return sendJson(res, 200, { ok: true, id: row.id })
    } catch (err) {
      /* Sólo llega aquí si falló la inserción de la INSCRIPCIÓN: devolvemos
         error real para no aparentar éxito (el cliente igual tiene respaldo en
         localStorage 'curso_waitlist'). */
      console.error("enrollments POST error:", err?.message)
      return sendJson(res, 500, { ok: false, error: "No se pudo guardar la inscripción" })
    }
  }

  /* PATCH — editar una inscripción desde el panel interno */
  if (req.method === "PATCH") {
    const session = requireInternal(req, res)
    if (!session) return
    const id = Number(req.query.id || req.body?.id)
    if (!id) return sendJson(res, 400, { ok: false, error: "Falta el id" })

    const body = req.body || {}
    const name  = String(body.name  || "").trim()
    const phone = cleanPhone(body.phone)
    const email = String(body.email || "").trim().toLowerCase()
    const level   = String(body.level   || "").trim() || null
    const message = String(body.message || "").trim() || null
    const edition = String(body.edition || "").trim() || null

    if (!name || phone.length < 8 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendJson(res, 400, { ok: false, error: "Datos incompletos" })
    }

    try {
      const sql = neon(process.env.DATABASE_URL)
      const [row] = await sql`
        UPDATE enrollments
        SET name = ${name}, phone = ${phone}, email = ${email}, level = ${level}, message = ${message}, edition = ${edition}
        WHERE id = ${id}
        RETURNING id, name, phone, email, source, level, message, edition, created_at
      `
      if (!row) return sendJson(res, 404, { ok: false, error: "Inscripción no encontrada" })

      /* Mismo criterio que el POST público: la persona editada sigue siendo
         cliente igual, best-effort para no tumbar el guardado ya hecho. */
      try {
        await sql`
          INSERT INTO users (name, phone, email, updated_at)
          VALUES (${name}, ${phone}, ${email}, NOW())
          ON CONFLICT (phone) DO UPDATE SET
            name  = EXCLUDED.name,
            email = COALESCE(NULLIF(EXCLUDED.email,''), users.email),
            updated_at = NOW()
        `
      } catch (uerr) {
        console.error("enrollments PATCH users upsert (no bloquea):", uerr?.message)
      }

      return sendJson(res, 200, { ok: true, enrollment: row })
    } catch (err) {
      console.error("enrollments PATCH error:", err?.message)
      return sendJson(res, 500, { ok: false, error: "No se pudo actualizar la inscripción" })
    }
  }

  /* DELETE — quitar una inscripción del panel interno (no borra al cliente,
     solo el registro de inscripción). */
  if (req.method === "DELETE") {
    const session = requireInternal(req, res)
    if (!session) return
    const id = Number(req.query.id)
    if (!id) return sendJson(res, 400, { ok: false, error: "Falta el id" })
    try {
      const sql = neon(process.env.DATABASE_URL)
      await sql`DELETE FROM enrollments WHERE id = ${id}`
      return sendJson(res, 200, { ok: true })
    } catch (err) {
      console.error("enrollments DELETE error:", err?.message)
      return sendJson(res, 500, { ok: false, error: "No se pudo eliminar la inscripción" })
    }
  }

  res.status(405).json({ ok: false, error: "Method Not Allowed" })
}
