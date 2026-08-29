import { neon } from "@neondatabase/serverless"
import { requireInternal } from "./_auth.js"

/* PIMP STUDIO — Suscripciones Web Push (por barbero)
   ------------------------------------------------------------------
   POST   (sesión interna): guarda la suscripción del barbero autenticado.
   DELETE (sesión interna): elimina una suscripción por endpoint.
   GET ?job=reminders (CRON_SECRET, no sesión de barbero): dispara el
     recordatorio de 1 hora antes de cada reserva. Vive acá (en vez de
     en su propio archivo api/) porque el plan Hobby de Vercel tope a 12
     funciones serverless por deployment — sumar un archivo más lo pasaba.
   notifyBarber(barberId, payload): envía un push SOLO al barbero indicado.

   Requiere claves VAPID en variables de entorno para enviar:
     VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)
   y el paquete 'web-push'. Si faltan, las funciones degradan sin romper. */

const BUSINESS_TZ = "America/Santiago"

// Pensado para correr cada HORA, 8:00-21:00, vía un disparador externo
// (cron-job.org, GitHub Actions, etc. — Vercel Hobby no soporta cron nativo
// de esa frecuencia). Protegido con CRON_SECRET: el llamador debe enviar
// Authorization: Bearer <CRON_SECRET>.
//
// Antes corría cada 40 minutos y SIN corte nocturno: 36 disparos al día, cada
// uno despertando el compute de Neon (que se cobra por tiempo encendido, no
// por consulta) para revisar una tabla en la que de madrugada no puede haber
// nada. Pasa a 14 disparos, 8:00-21:00. El 8:00 y no 9:00 es a propósito: el
// aviso de la reserva de las 09:00 tiene que salir a las 08:00.
//
// Solo queda el recordatorio de "1 hora antes" (se sacó el de 15 minutos: con
// cualquier cadencia ≥15 min, la ventana necesaria para no perderlo dejaría
// de representar "15 minutos" de forma honesta).
//
// La ventana pasa de +60/+105 a +45/+90, y el ancho de 45 min está elegido
// para ser correcto con LAS DOS cadencias — así el deploy y el cambio de
// horario en cron-job.org pueden ir en cualquier orden sin perder avisos:
//   - cada 40 min: 45 > 40, así que ningún disparo puede saltarse la ventana,
//     venga la reserva a la hora que venga.
//   - cada hora en punto: toda reserva cae en hora en punto (SLOT_GROUPS,
//     src/data.js), así que el disparo de las HH:00 la ve a 60 min de
//     distancia — con 30 min de atraso o 15 de adelanto tolerados antes de
//     salirse de la ventana.
// El costo es que el aviso ahora puede llegar con 45 min de anticipación en
// vez de 60 como mínimo garantizado. Mismo criterio que pimpstudio (que usa
// +45/+75), donde "1 hora" se considera honesto igual.
//
// `column` viene siempre de una lista fija interna (nunca de input externo),
// así que se arma el texto del SQL directamente — el driver de Neon no
// soporta interpolar nombres de columna como parámetro.
async function sendDueReminders(sql, { column, label, fromMin, toMin }) {
  const rows = await sql(
    `SELECT b.id, b.barber_id as "barberId", u.name as client,
            COALESCE(b.custom_service, s.name) as service,
            b.booking_date::text as date, b.booking_time::text as time
     FROM bookings b
     JOIN users u ON b.client_id = u.id
     LEFT JOIN services s ON b.service_id = s.id
     WHERE b.status NOT IN ('cancelada', 'completada')
       AND b.${column} = false
       AND ((b.booking_date + b.booking_time) AT TIME ZONE $1)
           BETWEEN (NOW() + ($2 || ' minutes')::interval)
               AND (NOW() + ($3 || ' minutes')::interval)`,
    [BUSINESS_TZ, String(fromMin), String(toMin)]
  )
  if (!rows.length) return 0

  await Promise.all(rows.map((b) =>
    notifyBarber(b.barberId, {
      title: `Turno en ${label}`,
      body: `${b.client || "Cliente"} · ${b.service || "Servicio"} · ${String(b.time).slice(0, 5)}`,
      url: `/panel?tab=reservas&date=${b.date}&bookingId=${b.id}`,
      tag: `recordatorio-${column}-${b.id}`,
    }).catch((err) => console.error(`notifyBarber (${label}) error:`, err))
  ))

  const ids = rows.map((b) => b.id)
  await sql(`UPDATE bookings SET ${column} = true WHERE id = ANY($1)`, [ids])
  return rows.length
}

let webpushModule = null
async function getWebPush() {
  if (webpushModule) return webpushModule
  try {
    const mod = await import("web-push")
    const webpush = mod.default || mod
    const pub = process.env.VAPID_PUBLIC_KEY
    const priv = process.env.VAPID_PRIVATE_KEY
    if (pub && priv) {
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contacto@brunetticutz.cl", pub, priv)
      webpushModule = webpush
      return webpush
    }
    console.error("getWebPush: VAPID_PUBLIC_KEY o VAPID_PRIVATE_KEY ausentes")
  } catch (err) {
    console.error("getWebPush import error:", err?.message)
  }
  return null
}

// Registra el envío en `notifications` para el popup de la campana del panel
// (ver GET /api/push más abajo). Se llama antes de intentar el push real y
// nunca lanza — un fallo de logging no debe impedir el aviso al barbero.
async function logNotification(barberId, payload) {
  try {
    const sql = neon(process.env.DATABASE_URL)
    await sql`
      CREATE TABLE IF NOT EXISTS notifications (
        id         SERIAL PRIMARY KEY,
        barber_id  INTEGER,
        title      TEXT NOT NULL,
        body       TEXT,
        url        TEXT,
        tag        TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
    await sql`
      INSERT INTO notifications (barber_id, title, body, url, tag)
      VALUES (${barberId ?? null}, ${payload?.title || "Brunetti"}, ${payload?.body || null}, ${payload?.url || null}, ${payload?.tag || null})
    `
  } catch (err) {
    console.error("logNotification error:", err)
  }
}

export async function notifyBarber(barberId, payload) {
  if (!barberId) return { ok: false, sent: 0 }
  await logNotification(Number(barberId), payload)
  const webpush = await getWebPush()
  if (!webpush) return { ok: false, sent: 0, reason: "push-not-configured" }
  try {
    const sql = neon(process.env.DATABASE_URL)
    const subs = await sql`
      SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE barber_id = ${Number(barberId)}
    `
    let sent = 0
    await Promise.all(subs.map(async (s) => {
      const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }
      try {
        await webpush.sendNotification(subscription, JSON.stringify(payload))
        sent++
      } catch (err) {
        // Suscripción caducada/expirada: limpiarla.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await sql`DELETE FROM push_subscriptions WHERE id = ${s.id}`.catch(() => {})
        } else {
          console.error("notifyBarber sendNotification error:", err?.statusCode, err?.body || err?.message)
        }
      }
    }))
    console.log(`notifyBarber: ${sent}/${subs.length} enviados (barberId=${barberId})`)
    return { ok: true, sent }
  } catch (err) {
    console.error("notifyBarber error:", err)
    return { ok: false, sent: 0 }
  }
}

/* Envía un push a TODAS las suscripciones registradas. Útil para avisos que no
   son de un barbero concreto (p. ej. inscripciones a Cursos/Workshop). En el
   modo "solo Brunetti" todas las suscripciones son del equipo de Bruno. */
export async function notifyAll(payload) {
  await logNotification(null, payload)
  const webpush = await getWebPush()
  if (!webpush) return { ok: false, sent: 0, reason: "push-not-configured" }
  try {
    const sql = neon(process.env.DATABASE_URL)
    const subs = await sql`SELECT id, endpoint, p256dh, auth FROM push_subscriptions`
    let sent = 0
    await Promise.all(subs.map(async (s) => {
      const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }
      try {
        await webpush.sendNotification(subscription, JSON.stringify(payload))
        sent++
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await sql`DELETE FROM push_subscriptions WHERE id = ${s.id}`.catch(() => {})
        } else {
          console.error("notifyAll sendNotification error:", err?.statusCode, err?.body || err?.message)
        }
      }
    }))
    console.log(`notifyAll: ${sent}/${subs.length} enviados`)
    return { ok: true, sent }
  } catch (err) {
    console.error("notifyAll error:", err)
    return { ok: false, sent: 0 }
  }
}

export default async function handler(req, res) {
  // Ruta del cron de recordatorios: no usa sesión de barbero, sino
  // CRON_SECRET. Se resuelve antes que requireInternal porque el llamador
  // (cron-job.org u otro pinger) no tiene un token de sesión.
  if (req.method === "GET" && req.query?.job === "reminders") {
    const secret = process.env.CRON_SECRET
    if (secret) {
      const auth = req.headers.authorization || ""
      if (auth !== `Bearer ${secret}`) return res.status(401).json({ ok: false, error: "unauthorized" })
    }
    try {
      const sql = neon(process.env.DATABASE_URL)
      const sent60 = await sendDueReminders(sql, { column: "reminder_60_sent", label: "1 hora", fromMin: 45, toMin: 90 })
      return res.json({ ok: true, sent60 })
    } catch (err) {
      console.error("push reminders job error:", err)
      return res.status(500).json({ ok: false, error: "reminder job failed" })
    }
  }

  const session = requireInternal(req, res)
  if (!session) return

  try {
    const sql = neon(process.env.DATABASE_URL)

    // Últimas notificaciones para el popup de la campana del panel (distinto
    // del GET ?job=reminders de arriba, que no lleva sesión de barbero).
    if (req.method === "GET") {
      const rows = await sql`
        SELECT id, title, body, url, tag, created_at::text as "createdAt"
        FROM notifications
        WHERE barber_id = ${Number(session.id)} OR barber_id IS NULL
        ORDER BY created_at DESC
        LIMIT 5
      `
      return res.json({ ok: true, notifications: rows })
    }

    if (req.method === "POST") {
      const { subscription } = req.body || {}
      const endpoint = subscription?.endpoint
      const p256dh = subscription?.keys?.p256dh
      const auth = subscription?.keys?.auth
      if (!endpoint || !p256dh || !auth) {
        return res.status(400).json({ ok: false, error: "Suscripción inválida" })
      }
      // Auto-crear la tabla si no existe (primera vez en una DB nueva), igual
      // que enrollments. Sin FK a barbers para no fallar si esa tabla aún no está.
      await sql`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id         SERIAL PRIMARY KEY,
          barber_id  INTEGER,
          endpoint   TEXT UNIQUE NOT NULL,
          p256dh     TEXT NOT NULL,
          auth       TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `
      // Cada barbero solo registra suscripciones para SU usuario (id de sesión).
      const barberId = session.id
      await sql`
        INSERT INTO push_subscriptions (barber_id, endpoint, p256dh, auth)
        VALUES (${Number(barberId)}, ${endpoint}, ${p256dh}, ${auth})
        ON CONFLICT (endpoint) DO UPDATE SET barber_id = EXCLUDED.barber_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
      `
      return res.json({ ok: true })
    }

    if (req.method === "DELETE") {
      const { endpoint } = req.body || {}
      if (!endpoint) return res.status(400).json({ ok: false, error: "endpoint requerido" })
      await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint} AND barber_id = ${Number(session.id)}`
      return res.json({ ok: true })
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" })
  } catch (err) {
    console.error("push error:", err)
    // GET (últimas notificaciones para la campana) es de solo lectura: no
    // bloquear la UI por eso, degradar en silencio está bien.
    if (req.method === "GET") return res.json({ ok: true, degraded: true, notifications: [] })
    // POST (registrar suscripción) y DELETE (desactivar) SÍ escriben estado
    // real: si esto falla y el front cree que quedó "activado", el barbero
    // deja de recibir avisos de reservas sin saberlo — el mismo bug que la
    // reserva fantasma, aplicado a las notificaciones push.
    return res.status(500).json({ ok: false, error: "No se pudo guardar la suscripción push" })
  }
}
