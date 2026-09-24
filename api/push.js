import { neon } from "@neondatabase/serverless"
import { requireInternal } from "./_auth.js"
import { clientIp } from "./_rateLimit.js"

/* PIMP STUDIO — Suscripciones Web Push (por barbero)
   ------------------------------------------------------------------
   POST   (sesión interna): guarda la suscripción del barbero autenticado.
   POST {action:'test'} (sesión interna): push de prueba REAL al barbero de
     la sesión, por el servidor → { ok:true, sent } (ver más abajo).
   DELETE (sesión interna): elimina una suscripción por endpoint.
   GET ?job=reminders (CRON_SECRET, no sesión de barbero): dispara el
     recordatorio de 1 hora antes de cada reserva y, después, el
     autocompletar de las atenciones "en curso" que ya terminaron. Vive acá
     (en vez de en su propio archivo api/) porque el plan Hobby de Vercel
     topa a 12 funciones serverless por deployment — no se agrega un cron
     ni un endpoint nuevo para eso.
   notifyBarber(barberId, payload, { log }): envía un push SOLO al barbero
     indicado; con log:false no lo deja en la campana del panel.

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
// La ventana tiene que ser AL MENOS tan ancha como el intervalo del cron, o
// deja huecos. Se busca `NOW()+fromMin .. NOW()+toMin`, así que una reserva a
// la hora T se avisa solo si algún disparo cae en [T-toMin, T-fromMin]: con
// cadencia horaria, un intervalo de menos de 60 min puede no contener ningún
// disparo y la reserva se pierde entera, sin dejar rastro.
//
// Estuvo en +45/+90 (45 min de ancho) con el argumento de que un cron horario
// no deja huecos porque toda reserva cae en hora en punto (SLOT_GROUPS,
// src/data.js). Es falso: que las reservas estén alineadas entre sí no las
// alinea con el MINUTO en que dispara el cron, y bastan 15 min de atraso del
// disparador para que la reserva de las HH:00 no la vea ninguna corrida.
// pimpstudio tenía la misma ventana angosta y lo midió sobre datos reales —
// de 37 reservas elegibles el aviso de 1 hora llegó a 31 (84%) — y la
// ensanchó a 60 min el 2026-09-09; acá va el mismo arreglo.
//
// Con la ventana de 60 min de ancho el aviso puede salir entre 45 y 105 min
// antes, así que el texto dice la hora ABSOLUTA de la cita ("hoy a las
// 16:00") en vez de una duración ("en 1 hora"), que mentiría por hasta 45
// min. Mismo criterio y mismo texto que pimpstudio.
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
      title: "Próximo turno",
      body: `${b.client || "Cliente"} · ${b.service || "Servicio"} · hoy a las ${String(b.time).slice(0, 5)}`,
      url: `/panel?tab=reservas&date=${b.date}&bookingId=${b.id}`,
      tag: `recordatorio-${column}-${b.id}`,
    }).catch((err) => console.error(`notifyBarber (${label}) error:`, err))
  ))

  const ids = rows.map((b) => b.id)
  await sql(`UPDATE bookings SET ${column} = true WHERE id = ANY($1)`, [ids])
  return rows.length
}

// Reporte de violaciones de la CSP en Report-Only (Q19). vercel.json reescribe
// /api/csp-report a esta ruta (?job=csp-report) antes del catch-all
// /api/(.*): sin sesión, sin CRON_SECRET y sin tocar la base — solo
// console.warn para verlo en los logs de Vercel. No hay endpoint propio por
// el tope de 12 funciones del plan Hobby (ver notas del puente arriba).
//
// El navegador manda 'application/csp-report' (report-uri, formato viejo: un
// objeto {"csp-report": {...}}) o 'application/reports+json' (Reporting API
// nueva: un arreglo de reportes). Ninguno de los dos es 'application/json',
// así que el parseo automático de Vercel deja req.body como Buffer/string
// crudo; se decodifica y se parsea acá, con un tope de tamaño para no
// procesar (ni loguear) un payload gigante o malformado.
const CSP_REPORT_MAX_BYTES = 50_000

// Límite en memoria por IP (sin DB ni Neon): el endpoint es público y sin
// sesión a propósito (lo llama el navegador solo, sin auth alguna), así que
// nada más lo protegía de una ráfaga — un atacante (o una extensión de
// navegador con un bug) podía mandar reportes sin tope y llenar los logs de
// Vercel / gastar invocaciones. Es un token bucket simple por instancia tibia
// de la lambda: se reinicia si la instancia se recicla, que alcanza para
// cortar una ráfaga (no hace falta precisión entre instancias para esto).
const CSP_REPORT_LIMIT = 20
const CSP_REPORT_WINDOW_MS = 60_000
const cspReportBuckets = new Map()

function cspReportAllowed(ip) {
  const now = Date.now()
  // Poda oportunista: sin esto, muchas IPs distintas harían crecer el Map sin
  // límite durante la vida de la instancia.
  if (cspReportBuckets.size > 2000) {
    for (const [key, entry] of cspReportBuckets) {
      if (now - entry.windowStart >= CSP_REPORT_WINDOW_MS) cspReportBuckets.delete(key)
    }
  }
  const entry = cspReportBuckets.get(ip)
  if (!entry || now - entry.windowStart >= CSP_REPORT_WINDOW_MS) {
    cspReportBuckets.set(ip, { windowStart: now, count: 1 })
    return true
  }
  entry.count += 1
  return entry.count <= CSP_REPORT_LIMIT
}

function normalizeCspReports(raw) {
  if (!raw) return []
  if (Buffer.isBuffer(raw)) {
    if (raw.length > CSP_REPORT_MAX_BYTES) return []
    raw = raw.toString("utf8")
  }
  if (typeof raw === "object") {
    if (Array.isArray(raw)) return raw
    return raw["csp-report"] ? [raw["csp-report"]] : [raw]
  }
  if (typeof raw !== "string" || !raw.trim()) return []
  if (raw.length > CSP_REPORT_MAX_BYTES) return []
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (Array.isArray(parsed)) return parsed
  if (parsed && parsed["csp-report"]) return [parsed["csp-report"]]
  return parsed ? [parsed] : []
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

// `log: false` es solo para la notificación de prueba del panel: la campana
// muestra las últimas 5, así que probar tres veces seguidas desalojaría los
// avisos de reservas reales. Todo lo demás se registra, como siempre.
export async function notifyBarber(barberId, payload, { log = true } = {}) {
  if (!barberId) return { ok: false, sent: 0 }
  if (log) await logNotification(Number(barberId), payload)
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

/* Atenciones "en curso" que ya terminaron → completadas, con el pago por
   confirmar (autoCompleteStarted en api/_bookingLife.js). También corre al
   abrir el panel; acá cubre las horas en que nadie lo abre, montado sobre el
   despertar de la base que el recordatorio ya pagó — por eso no hay un cron
   aparte. Decide solo si corre: nada fuera de producción y nada con el
   interruptor "Completar solas" apagado (arranca apagado, ver settings
   `panel:auto_complete`); la estrella la acredita el escritor único de allá.

   Best-effort y nunca lanza: el cron existe para los recordatorios, y un 500
   por esta tanda accesoria haría que cron-job.org marque el job como caído
   (y termine desactivándolo) aunque los avisos hayan salido bien.

   Import dinámico, y notifyBarber se le pasa como argumento: _bookingLife.js
   no importa push.js (bookings.js, que lo usa, ya importa push.js, y así no
   se cierra ningún ciclo), y los que no son el cron no cargan sus
   dependencias (Notion, correo, puente) en frío.

   El typeof cubre una base de código donde autoCompleteStarted todavía no
   existe: el job sigue respondiendo igual, con `autoCompleteSkipped`. */
async function runAutoComplete(sql) {
  try {
    const { autoCompleteStarted } = await import("./_bookingLife.js")
    if (typeof autoCompleteStarted !== "function") return { autoCompleted: 0, autoCompleteSkipped: "unavailable" }
    const result = await autoCompleteStarted(sql, { force: true, limit: 25, notifyBarber })
    const out = { autoCompleted: Number(result?.completed) || 0 }
    if (result?.skipped) out.autoCompleteSkipped = result.skipped
    return out
  } catch (err) {
    console.error("push reminders job (autocompletar) error:", err)
    return { autoCompleted: 0, autoCompleteError: true }
  }
}

export default async function handler(req, res) {
  // Reporte de CSP (Q19): sin sesión, sin CRON_SECRET, sin neon(). Va primero
  // porque el navegador la llama sola (report-uri) y no manda ningún header
  // de auth. 204 siempre, para no invitar reintentos del navegador.
  if (req.method === "POST" && req.query?.job === "csp-report") {
    // Sin sesión y sin CRON_SECRET: el único freno posible acá es este cupo
    // en memoria. El exceso responde 204 igual (no hay que invitar reintentos
    // del navegador) pero sin loguear, para no llenar los logs con lo mismo
    // que se está limitando.
    if (cspReportAllowed(clientIp(req))) {
      try {
        for (const report of normalizeCspReports(req.body)) {
          console.warn("[csp-report]", JSON.stringify(report).slice(0, 500))
        }
      } catch (err) {
        console.error("csp-report error:", err?.message)
      }
    }
    return res.status(204).end()
  }

  // Ruta del cron de recordatorios: no usa sesión de barbero, sino
  // CRON_SECRET. Se resuelve antes que requireInternal porque el llamador
  // (cron-job.org u otro pinger) no tiene un token de sesión.
  if (req.method === "GET" && req.query?.job === "reminders") {
    const secret = process.env.CRON_SECRET
    if (secret) {
      const auth = req.headers.authorization || ""
      if (auth !== `Bearer ${secret}`) return res.status(401).json({ ok: false, error: "unauthorized" })
    }
    // Primero el recordatorio (lo que el cron existe para hacer, y lo que
    // vence a la hora), después el autocompletar. Las dos tandas se aíslan:
    // si falla el recordatorio, la respuesta sigue siendo el 500 de siempre
    // (con los campos del autocompletar de más), y si falla el
    // autocompletar, el recordatorio responde 200 igual.
    let sql = null
    let sent60 = null
    let reminderError = null
    try {
      sql = neon(process.env.DATABASE_URL)
      sent60 = await sendDueReminders(sql, { column: "reminder_60_sent", label: "1 hora", fromMin: 45, toMin: 105 })
    } catch (err) {
      console.error("push reminders job error:", err)
      reminderError = err
    }
    const autoComplete = sql ? await runAutoComplete(sql) : {}
    if (reminderError) return res.status(500).json({ ok: false, error: "reminder job failed", ...autoComplete })
    return res.json({ ok: true, sent60, ...autoComplete })
  }

  const session = requireInternal(req, res)
  if (!session) return

  // Prueba de punta a punta desde el panel (Ajustes → Notificaciones): manda
  // el push por el canal REAL y responde a cuántos dispositivos llegó.
  //
  // Antes el botón "probar" mostraba una notificación LOCAL en el propio
  // dispositivo, que sale igual aunque la fila de push_subscriptions ya no
  // exista: no probaba justo la cadena que se rompe (suscripción caída en el
  // servidor mientras el interruptor sigue diciendo "activado").
  //
  // `sent: 0` es la respuesta útil: este barbero no tiene ningún dispositivo
  // vivo, y el panel lo traduce a "vuelve a activar el interruptor" (antes
  // reintenta una vez re-registrando la suscripción, ver syncPush en
  // src/push.js). Sin claves VAPID también es sent:0, con `reason`. Si la
  // base no responde es un 500: decir "0 dispositivos" mandaría al barbero a
  // reactivar algo que no está roto.
  //
  // Va antes de la rama de suscripción del POST, que sin `subscription`
  // respondería 400. No usa `sql`: notifyBarber abre su propia conexión.
  if (req.method === "POST" && req.body?.action === "test") {
    let result = { ok: false, sent: 0 }
    try {
      result = await notifyBarber(Number(session.id), {
        title: "Prueba de notificación",
        body: "Si ves esto, tus avisos de reservas están llegando bien.",
        url: "/panel",
        tag: "ps-prueba",
      }, { log: false })
    } catch (err) {
      console.error("push test error:", err)
    }
    if (result?.reason === "push-not-configured") return res.json({ ok: true, sent: 0, reason: result.reason })
    if (!result?.ok) return res.status(500).json({ ok: false, error: "No se pudo enviar la notificación de prueba" })
    return res.json({ ok: true, sent: Number(result.sent) || 0 })
  }

  try {
    const sql = neon(process.env.DATABASE_URL)

    // Últimas notificaciones para el popup de la campana del panel (distinto
    // del GET ?job=reminders de arriba, que no lleva sesión de barbero).
    if (req.method === "GET") {
      // La fecha se arma acá en ISO-8601 UTC y SIN milisegundos, en vez de
      // castearla a texto o de dejar que el driver la entregue como Date:
      //   - `created_at::text` devuelve el formato de Postgres
      //     ("2026-09-12 20:57:28.497397+00"), con espacio en vez de "T" y
      //     microsegundos. La especificación de JS solo obliga a parsear el
      //     ISO simplificado; V8 lo acepta igual, Safari/iOS lo deja en
      //     Invalid Date y la campana pierde el "hace 5m" y el contador.
      //   - dejar el Date del driver tampoco sirve: res.json() lo serializa
      //     CON milisegundos, y el ISO8601DateFormatter de Swift los rechaza
      //     por defecto, así que la app nativa se queda sin fecha.
      // Sin milisegundos lo parsean los dos.
      const rows = await sql`
        SELECT id, title, body, url, tag, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "createdAt"
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
