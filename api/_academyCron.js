/* PIMP STUDIO — Academy: tanda del cron horario (SPEC §10)
   ------------------------------------------------------------------
   runAcademyJob(sql, { budgetMs, hourSantiago, force }) corre DENTRO de
   GET /api/push?job=reminders (y del alias ?job=academy), no en un cron
   propio: un segundo disparo en la misma hora despertaría Neon dos veces para
   el mismo trabajo, y Neon cobra por tiempo encendido.

   Pasos, en orden (cada uno con su try/catch; ninguno tumba a los demás):
     1. ensureAcademyTables (sin tablas no hay nada más que hacer).
     2. Órdenes pendientes que el webhook no cerró (reconcileAcademyOrders).
     3. Credenciales pendientes (el correo de acceso que falló o quedó en cola
        por cuota): retryPendingCredentials de _academyProvision.js, a lo más
        5. Se delega entero: ahí vive la regla de `autoprovision` (con el alta
        automática apagada, una compra no recibe la clave hasta que el dueño
        la mande), que una consulta propia acá se saltaría.
     4. Recordatorios de eventos: 24 h antes (ventana 18–30 h: en la app +
        correo si el evento lo pide) y 1 h antes (45–105 min; el tick de las
        21 mira hasta 179 min y el de las 8 desde 0: en la app + push).
     5. Resumen de actividad por correo (solo a las 19 h).
     6. Limpieza (solo a las 8 h).

   Presupuesto de tiempo DURO: la función la comparte con los recordatorios
   de la barbería y las estrellas de BrunettiCutz, y si se pasa del máximo de
   Vercel se cae todo el job. Se revisa el reloj antes de cada paso y de cada
   ítem, y cada espera se corta con withTimeout (lo que quedó en vuelo es
   idempotente: reclamos con clave única). Además cada paso tiene un techo
   propio para que uno lento no se coma a los que siguen — en especial los
   recordatorios de 1 h, que con una ventana tan ancha como el intervalo del
   cron tienen UNA sola pasada para salir.

   Dos sitios, una Academy (api/_academyDb.js): cada sitio corre esta tanda
   con su cron, sobre la MISMA base, y atiende solo lo suyo — las órdenes que
   cobró su Mercado Pago, y los correos, avisos y push de los miembros cuyo
   home_site es él (salen con su marca y sus enlaces). Los recordatorios se
   reclaman por (evento, ocurrencia, tipo, sitio): cada miembro recibe uno
   solo, del sitio de su cuenta. La limpieza es idempotente y la pueden
   correr los dos.

   Nunca lanza: devuelve un resumen. Los imports son dinámicos para que un
   módulo roto de otro dominio no impida que este archivo cargue (y porque
   varios importan push.js, que es quien nos importa a nosotros). Los dos
   estáticos (el host y _academyText.js) no importan nada.
   Prefijo `_`: no consume slot de función serverless. */

import { HOST, siteUrl } from "./_academyHost.js"
import { isSyntheticOwnerEmail } from "./_academyText.js"
import { SITE, ownsDb, academySql } from "./_academyDb.js"

const BUSINESS_TZ = "America/Santiago"
// Páginas de la Academy en este sitio (https://pimpstudio.cl/academy).
const academyUrl = () => `${siteUrl()}${HOST.basePath}`
const MIN_MS = 60000
const HOUR_MS = 3600000
const TIMEOUT = Symbol("timeout")
// Margen del corte a nivel de paso sobre el techo de su fase: adentro, cada
// ítem ya se corta en el techo y deja el resumen en orden (cuántos correos
// quedaron sin mandar, etc.). Este corte es la red por si algo no respeta el
// reloj, y es lo único que puede pasar del presupuesto (a lo más en esto).
const STEP_GRACE_MS = 100
// Tiempo mínimo que tiene que quedar para EMPEZAR un ítem que se reclama
// antes de hacerse (recordatorio, credenciales, resumen): reclamarlo y
// quedarse sin reloj a la mitad lo deja marcado como hecho sin haber salido.
// Mejor no tocarlo y que lo tome el próximo tick.
const MIN_LEFT = { reminder: 400, digest: 500 }

// Techos de cada fase, como fracción del presupuesto desde el arranque. Son
// techos, no reservas: si una fase termina antes, la siguiente usa ese tiempo
// (lo normal: sin órdenes pendientes ni eventos cerca, cada fase es una
// consulta). La conciliación recibe la mitad porque reconcileAcademyOrders no
// empieza una orden con menos de 2,5 s por delante (la búsqueda en Mercado
// Pago puede tardar); los recordatorios conservan al menos un cuarto del
// presupuesto aunque las fases de pago se lo coman todo.
const PHASE_END = { reconcile: 0.5, credentials: 0.65, reminders: 0.92 }

function santiagoHourNow() {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TZ, hour: "numeric", hourCycle: "h23" }).format(new Date())) % 24
}

/* Deja de ESPERAR una promesa a los `ms`. No la cancela: sigue en vuelo, y
   por eso todo lo que se envuelve acá es idempotente. El catch vacío evita
   que un rechazo tardío quede como unhandledRejection. */
function withTimeout(promise, ms) {
  const p = Promise.resolve(promise)
  p.catch(() => {})
  let timer
  const clock = new Promise((resolve) => { timer = setTimeout(() => resolve(TIMEOUT), Math.max(0, ms)) })
  return Promise.race([p, clock]).finally(() => clearTimeout(timer))
}

// reconcileAcademyOrders es de BE-PAY y el SPEC no fija su retorno: se acepta
// un número, una lista o un objeto con algún contador conocido.
function countOf(r) {
  if (typeof r === "number" && Number.isFinite(r)) return r
  if (Array.isArray(r)) return r.length
  if (r && typeof r === "object") {
    for (const k of ["reconciled", "applied", "processed", "granted", "updated", "count", "checked"]) {
      if (typeof r[k] === "number") return r[k]
    }
  }
  return 0
}

/* Ventana del recordatorio de 1 hora según el tick. El cron corre cada hora
   de 8 a 21: el de las 21 es el último del día y alcanza hasta la
   medianoche (179 min), y el de las 8 es el primero y toma también lo que
   empieza ya (0 min). La ventana normal mide 60 min, igual que el intervalo
   del cron: más angosta dejaría eventos sin ningún tick dentro (la lección de
   los recordatorios de reservas, api/push.js). */
function oneHourWindow(hour) {
  if (hour === 21) return { fromMin: 45, toMin: 179 }
  if (hour === 8) return { fromMin: 0, toMin: 105 }
  return { fromMin: 45, toMin: 105 }
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const pad2 = (n) => String(n).padStart(2, "0")

/* "Hoy 19:00" / "Mañana 19:00" / "El jueves 19:00", siempre en hora de
   Santiago y con la hora ABSOLUTA: el aviso puede salir en cualquier punto
   de la ventana, así que "en 1 hora" mentiría por hasta una hora. `long` es
   la versión del correo (sendAcademyEventReminderEmail la usa como whenText). */
function whenLabel(ev, occTs, nowTs) {
  const a = ev.zonedParts(occTs, BUSINESS_TZ)
  const diff = ev.dayNumber(a) - ev.dayNumber(ev.zonedParts(nowTs, BUSINESS_TZ))
  const time = `${pad2(a.h)}:${pad2(a.mi)}`
  const date = new Intl.DateTimeFormat("es-CL", { timeZone: BUSINESS_TZ, weekday: "long", day: "numeric", month: "long" })
    .format(new Date(occTs)).replace(",", "")
  let rel
  if (diff === 0) rel = "hoy"
  else if (diff === 1) rel = "mañana"
  else if (diff > 1 && diff < 7) rel = `el ${new Intl.DateTimeFormat("es-CL", { timeZone: BUSINESS_TZ, weekday: "long" }).format(new Date(occTs))}`
  else rel = `el ${date}`
  // En minúscula: la plantilla lo encaja a mitad de frase ("Te recordamos:
  // es mañana, jueves 1 de octubre a las 19:00 (hora de Santiago).").
  const long = diff === 0 || diff === 1
    ? `${rel}, ${date} a las ${time} (hora de Santiago)`
    : `el ${date} a las ${time} (hora de Santiago)`
  return { short: `${cap(rel)} ${time}`, long }
}

// Direcciones que no llevan a nadie: cuentas borradas (me-delete) y el
// correo sintético del propietario creado sin email de barbero (owner-session).
// Mandarles correo solo gasta el cupo diario de Resend.
function isDeliverable(m) {
  const e = String(m?.email_norm || m?.email || "").toLowerCase()
  if (!e || e.startsWith("deleted-") || e.endsWith("@invalid") || e.endsWith(".invalid")) return false
  if (isSyntheticOwnerEmail(e)) return false
  return true
}

function wantsEventEmail(m) {
  const notif = m?.prefs?.notif || {}
  return notif.email !== false && notif.events !== false && isDeliverable(m)
}

/* ── Recordatorios de eventos ──────────────────────────────────────────── */

/* Quién recibe el aviso: los miembros activos que pueden VER el evento
   (canSeeEvent). La lista de miembros, sus puntos y los grupos se cargan una
   vez por tanda y solo si hacen falta. */
async function audienceFor(sql, ev, row, cache) {
  if (!cache.members) {
    // Solo los miembros de ESTE sitio: los del otro reciben el aviso de su
    // propio cron, con su marca y sus enlaces.
    cache.members = await sql`
      SELECT id, role, name, email, email_norm, prefs,
             (last_seen_at IS NULL OR last_seen_at < NOW() - interval '24 hours') AS away
        FROM academy_members
       WHERE status = 'activo' AND deleted_at IS NULL
         AND (home_site = ${SITE} OR (home_site IS NULL AND ${ownsDb()}::boolean))
       ORDER BY id`
  }
  const access = ev.normalizeAccess(row.access)
  let cohortSet = null
  if (access.type === "nivel" && !cache.levels) {
    const http = await import("./_academyHttp.js")
    const points = await http.pointsFor(sql, cache.members.map((m) => m.id))
    cache.levels = new Map(cache.members.map((m) => [m.id, http.levelFor(Number(points?.get?.(m.id) ?? 0)).level]))
  }
  if (access.type === "grupo") {
    if (!cache.cohorts.has(access.cohortId)) {
      const rows = access.cohortId
        // Mismo criterio que memberCohortIds (la vista `events`): un grupo
        // archivado ya no da acceso.
        ? await sql`
            SELECT cm.member_id FROM academy_cohort_members cm
              JOIN academy_cohorts c ON c.id = cm.cohort_id AND c.archived_at IS NULL
             WHERE cm.cohort_id = ${access.cohortId}`
        : []
      cache.cohorts.set(access.cohortId, new Set(rows.map((r) => Number(r.member_id))))
    }
    cohortSet = cache.cohorts.get(access.cohortId)
  }
  return cache.members.filter((m) => ev.canSeeEvent(m, row, {
    level: cache.levels?.get(m.id) ?? 1,
    cohortIds: cohortSet?.has(Number(m.id)) ? [access.cohortId] : [],
  }).ok)
}

async function sendEventReminders(sql, { hour, phase, out }) {
  const ev = await import("./_academyEvents.js")
  const now = Date.now()
  const w1 = oneHourWindow(hour)
  const windows = [
    // El de 1 h primero: es el que no tiene segunda oportunidad.
    { kind: "1h", from: now + w1.fromMin * MIN_MS, to: now + w1.toMin * MIN_MS },
    { kind: "24h", from: now + 18 * HOUR_MS, to: now + 30 * HOUR_MS },
  ]
  const lo = Math.min(...windows.map((w) => w.from))
  const hi = Math.max(...windows.map((w) => w.to))
  const rows = await ev.eventsInRange(sql, lo, hi, { limit: 200 })
  if (!rows.length) return

  const due = []
  for (const w of windows) {
    for (const row of rows) {
      for (const o of ev.expandOccurrences(row, new Date(w.from), new Date(w.to))) {
        due.push({ row, kind: w.kind, ts: o.occurrenceStart.getTime(), iso: ev.isoNoMs(o.occurrenceStart) })
      }
    }
  }
  if (!due.length) return

  // Una lectura para descartar lo ya avisado antes de escribir nada: la
  // ventana de 24 h abarca 12 ticks y casi siempre ya salió en el primero.
  const sentRows = await sql`
    SELECT event_id, kind, to_char(occurrence_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS occ
      FROM academy_event_reminders
     WHERE event_id = ANY(${[...new Set(due.map((d) => d.row.id))]}::int[])
       AND (site = ${SITE} OR (site = '' AND ${ownsDb()}::boolean))
       AND occurrence_start >= ${ev.isoNoMs(lo - MIN_MS)}::timestamptz
       AND occurrence_start <= ${ev.isoNoMs(hi + MIN_MS)}::timestamptz`
  const already = new Set(sentRows.map((r) => `${r.event_id}|${r.kind}|${r.occ}`))
  const pending = due.filter((d) => !already.has(`${d.row.id}|${d.kind}|${d.iso}`))
  if (!pending.length) return

  const notify = await import("./_academyNotify.js")
  const cache = { members: null, levels: null, cohorts: new Map() }
  const detail = out.reminderDetail

  for (const item of pending) {
    if (phase.left() < MIN_LEFT.reminder) { out.stoppedEarly = true; break }
    const { row, kind, ts, iso } = item

    // Reclamo por la PK (event_id, occurrence_start, kind, site): si dos
    // pasadas de este sitio se cruzan (el cron y un ?job=academy&force=1 a
    // mano), solo una avisa. El otro sitio reclama lo suyo con su clave.
    const [claimed] = await sql`
      INSERT INTO academy_event_reminders (event_id, occurrence_start, kind, site)
      VALUES (${row.id}, ${iso}::timestamptz, ${kind}, ${SITE})
      ON CONFLICT (event_id, occurrence_start, kind, site) DO NOTHING
      RETURNING event_id`
    if (!claimed) continue

    const label = whenLabel(ev, ts, now)
    const title = String(row.title || "Evento")
    let audience
    try {
      audience = await audienceFor(sql, ev, row, cache)
      if (audience.length) {
        const res = await withTimeout(notify.notifyMany(sql, audience.map((m) => m.id), {
          kind: "evento",
          actorId: null,
          targetType: "event",
          targetId: row.id,
          parentId: null,
          // Sin `preview`: para 'evento' el texto viaja en esa columna y es lo
          // que la campana muestra (_academyNotify.js). El groupKey único por
          // ocurrencia además hace que notifyMany no repita la fila.
          groupKey: `evento:${row.id}:${iso}:${kind}`,
          // 24 h: en la app + correo. 1 h: en la app + push (SPEC §10).
          push: kind === "1h",
          text: `${label.short}: ${title}`,
        }), phase.left())
        if (res === TIMEOUT) { out.stoppedEarly = true; break }
      }
    } catch (err) {
      // No se pudo ni armar la audiencia (notifyMany en sí nunca lanza): se
      // suelta el reclamo para que el próximo tick lo reintente, si la
      // ocurrencia sigue en la ventana.
      console.error("[academy:cron] recordatorio", row.id, kind, err?.message || err)
      out.errors.push(`recordatorio ${row.id}/${kind}`)
      await Promise.resolve(sql`DELETE FROM academy_event_reminders WHERE event_id = ${row.id} AND occurrence_start = ${iso}::timestamptz AND kind = ${kind} AND site = ${SITE}`)
        .catch(() => {})
      continue
    }
    if (kind === "24h") out.reminders24++
    else out.reminders1++
    detail.notified += audience.length

    // Correo solo en el de 24 h, si el evento lo tiene activado. Primero los
    // que no han entrado en el último día: son los que no verán el aviso en
    // la app. En serie: el cupo diario es chico (sendAcademyEmail corta en 60)
    // y Resend limita las requests por segundo.
    if (kind !== "24h" || row.email_reminder === false || cache.emailStop) continue
    const recipients = audience.filter(wantsEventEmail).sort((a, b) => Number(b.away) - Number(a.away))
    if (!recipients.length) continue
    if (!cache.mail) {
      const mailMod = await import("./_academyEmail.js")
      cache.mail = { sendAcademyEmail: mailMod.sendAcademyEmail, send: mailMod.sendAcademyEventReminderEmail }
    }
    for (let i = 0; i < recipients.length; i++) {
      const m = recipients[i]
      if (phase.over()) { out.stoppedEarly = true; detail.emailsDropped += recipients.length - i; break }
      let r
      try {
        r = await withTimeout(cache.mail.sendAcademyEmail(sql, "evento", cache.mail.send, {
          to: m.email,
          name: m.name,
          event: { title, whenText: label.long, url: `${academyUrl()}/calendario` },
        }), phase.left())
      } catch (err) {
        console.error("[academy:cron] correo de recordatorio:", err?.message || err)
        detail.emailsFailed++
        continue
      }
      if (r === TIMEOUT) { out.stoppedEarly = true; detail.emailsDropped += recipients.length - i; break }
      if (r?.ok) { detail.emails++; continue }
      // Cupo del día agotado (o Resend devolvió 429): no tiene sentido seguir
      // probando con el resto en esta pasada.
      if (r?.skipped || r?.status === 429) {
        cache.emailStop = true
        detail.emailsDropped += recipients.length - i
        break
      }
      detail.emailsFailed++
    }
  }
}

/* ── Resumen de actividad por correo (19 h) ────────────────────────────── */

/* Para quien tiene algo sin leer que le importa (menciones, respuestas o
   comentarios, mensajes directos) de hace más de 2 h, no entra hace 2 h, no
   tiene push (con push ya se enteró) y no recibió otro resumen en 24 h. Solo
   cuenta lo que llegó después del resumen anterior, para no repetir lo mismo
   todos los días. Van cifras, nunca el texto de un mensaje directo. */
async function sendActivityDigest(sql, { phase, out }) {
  const rows = await sql`
    WITH cand AS (
      SELECT m.id, m.email, m.email_norm, m.name, m.activity_email_at,
             GREATEST(COALESCE(m.activity_email_at, '-infinity'::timestamptz), NOW() - interval '7 days') AS since
        FROM academy_members m
       WHERE m.status = 'activo' AND m.deleted_at IS NULL
         AND (m.home_site = ${SITE} OR (m.home_site IS NULL AND ${ownsDb()}::boolean))
         AND COALESCE(m.prefs->'notif'->>'email', 'true') <> 'false'
         AND (m.last_seen_at IS NULL OR m.last_seen_at < NOW() - interval '2 hours')
         AND (m.activity_email_at IS NULL OR m.activity_email_at < NOW() - interval '24 hours')
         AND NOT EXISTS (SELECT 1 FROM academy_push_subscriptions ps WHERE ps.member_id = m.id)
    ), counted AS (
      SELECT c.id, c.email, c.email_norm, c.name,
             to_char(c.activity_email_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS prev_at,
             (SELECT count(*)::int FROM academy_notifications n
               WHERE n.member_id = c.id AND n.read_at IS NULL AND n.kind = 'mencion'
                 AND n.created_at < NOW() - interval '2 hours' AND n.created_at > c.since) AS mentions,
             (SELECT count(*)::int FROM academy_notifications n
               WHERE n.member_id = c.id AND n.read_at IS NULL AND n.kind IN ('respuesta', 'comentario')
                 AND n.created_at < NOW() - interval '2 hours' AND n.created_at > c.since) AS replies,
             (SELECT count(*)::int FROM academy_chat_members cm
                JOIN academy_chats ch ON ch.id = cm.chat_id AND ch.kind = 'directo'
                JOIN academy_messages msg ON msg.chat_id = cm.chat_id
               WHERE cm.member_id = c.id AND NOT cm.muted
                 AND msg.id > cm.last_read_message_id AND msg.author_id <> c.id AND msg.deleted_at IS NULL
                 AND msg.created_at < NOW() - interval '2 hours' AND msg.created_at > c.since) AS dms
        FROM cand c
    )
    SELECT * FROM counted
     WHERE mentions + replies + dms > 0
     ORDER BY id
     LIMIT 25`
  const targets = rows.filter(isDeliverable)
  if (!targets.length) return 0

  const mailMod = await import("./_academyEmail.js")
  const url = `${academyUrl()}/comunidad`
  let sent = 0
  for (const m of targets) {
    if (phase.left() < MIN_LEFT.digest) { out.stoppedEarly = true; break }
    // Reclamo antes de mandar: dos pasadas cruzadas no mandan dos resúmenes.
    const [claim] = await sql`
      UPDATE academy_members SET activity_email_at = NOW()
       WHERE id = ${m.id} AND (activity_email_at IS NULL OR activity_email_at < NOW() - interval '24 hours')
       RETURNING id`
    if (!claim) continue
    const items = []
    if (m.mentions) items.push({ text: m.mentions === 1 ? "Te mencionaron en la comunidad" : `Te mencionaron ${m.mentions} veces en la comunidad`, url })
    if (m.replies) items.push({ text: m.replies === 1 ? "Tienes 1 comentario o respuesta nueva" : `Tienes ${m.replies} comentarios o respuestas nuevas`, url })
    if (m.dms) items.push({ text: m.dms === 1 ? "Tienes 1 mensaje sin leer" : `Tienes ${m.dms} mensajes sin leer`, url })
    let r
    try {
      r = await withTimeout(mailMod.sendAcademyEmail(sql, "actividad", mailMod.sendAcademyActivityEmail, {
        to: m.email, name: m.name, items, loginUrl: `${academyUrl()}/ingreso`,
      }), phase.left())
    } catch (err) {
      console.error("[academy:cron] resumen de actividad:", err?.message || err)
      r = null
    }
    if (r === TIMEOUT) { out.stoppedEarly = true; break }
    if (r?.ok) { sent++; continue }
    // No salió: se devuelve la marca anterior para que mañana (o un force)
    // lo intente de nuevo en vez de perder el día.
    await Promise.resolve(sql`UPDATE academy_members SET activity_email_at = ${m.prev_at}::timestamptz WHERE id = ${m.id}`).catch(() => {})
    if (r?.skipped || r?.status === 429) break
  }
  return sent
}

/* ── Limpieza (8 h) ────────────────────────────────────────────────────── */

// Cada tabla por separado: una que falte no impide limpiar las demás.
const CLEANUP = [
  ["tokens", (sql) => sql`WITH d AS (
      DELETE FROM academy_auth_tokens
       WHERE (used_at IS NOT NULL AND used_at < NOW() - interval '30 days') OR expires_at < NOW() - interval '30 days'
      RETURNING 1) SELECT count(*)::int AS n FROM d`],
  ["notifications", (sql) => sql`WITH d AS (
      DELETE FROM academy_notifications WHERE created_at < NOW() - interval '180 days'
      RETURNING 1) SELECT count(*)::int AS n FROM d`],
  // Límites y bloqueos de login (api/_academyLimits.js): nada de eso sirve
  // pasados 2 días, salvo un bloqueo que siga vigente.
  ["rateLimits", (sql) => sql`WITH d AS (
      DELETE FROM academy_rate_limits
       WHERE updated_at < NOW() - interval '2 days'
         AND (locked_until IS NULL OR locked_until < NOW())
      RETURNING 1) SELECT count(*)::int AS n FROM d`],
  ["emailLog", (sql) => sql`WITH d AS (
      DELETE FROM academy_email_log WHERE day < (NOW() AT TIME ZONE 'America/Santiago')::date - 90
      RETURNING 1) SELECT count(*)::int AS n FROM d`],
  ["reminders", (sql) => sql`WITH d AS (
      DELETE FROM academy_event_reminders WHERE occurrence_start < NOW() - interval '90 days'
      RETURNING 1) SELECT count(*)::int AS n FROM d`],
]

async function cleanup(sql, { phase, out }) {
  const res = {}
  for (const [name, run] of CLEANUP) {
    if (phase.over()) { out.stoppedEarly = true; break }
    try {
      const r = await withTimeout(run(sql), phase.left())
      if (r === TIMEOUT) { out.stoppedEarly = true; break }
      res[name] = r?.[0]?.n ?? 0
    } catch (err) {
      console.error(`[academy:cron] limpieza ${name}:`, err?.message || err)
      res[name] = null
    }
  }
  return res
}

/* ── Orquestador ───────────────────────────────────────────────────────── */

export async function runAcademyJob(hostDb, { budgetMs = 7000, hourSantiago, force = false } = {}) {
  const t0 = Date.now()
  // El host pasa SU base; la Academy puede vivir en la del otro sitio.
  let sql = null
  try { sql = academySql(hostDb) } catch { sql = null }
  const budget = Math.max(500, Math.min(60000, Number(budgetMs) || 7000))
  const deadline = t0 + budget
  let hour = Number(hourSantiago)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    try { hour = santiagoHourNow() } catch { hour = -1 }
  }
  const out = {
    ensured: false,
    credentials: 0,
    reconciled: 0,
    reminders24: 0,
    reminders1: 0,
    activityEmails: 0,
    cleaned: null,
    stoppedEarly: false,
    hourSantiago: hour,
    reminderDetail: { notified: 0, emails: 0, emailsFailed: 0, emailsDropped: 0 },
    skipped: [],
    errors: [],
  }

  const phaseFor = (end) => {
    const limit = Math.min(end, deadline)
    return { left: () => Math.max(0, limit - Date.now()), over: () => Date.now() >= limit }
  }
  // Corre un paso con su techo: si ya no queda tiempo ni se empieza, y si se
  // pasa se deja de esperar. Un error se registra y se sigue con el próximo.
  const step = async (name, end, fn) => {
    const phase = phaseFor(end)
    if (phase.over()) { out.stoppedEarly = true; out.skipped.push(name); return undefined }
    try {
      const r = await withTimeout(fn(phase), phase.left() + STEP_GRACE_MS)
      if (r === TIMEOUT) {
        out.stoppedEarly = true
        out.errors.push(`${name}: sin tiempo`)
        return undefined
      }
      return r
    } catch (err) {
      console.error(`[academy:cron] ${name}:`, err?.message || err)
      out.errors.push(name)
      return undefined
    }
  }

  try {
    if (!sql) throw new Error("sin conexión a la base")

    // 1. Tablas. Es el único lugar del cron con DDL, y memoizado por
    // instancia: en una lambda tibia no cuesta nada.
    out.ensured = (await step("ensure", deadline, async () => {
      const { ensureAcademyTables } = await import("./_academySchema.js")
      await ensureAcademyTables(sql)
      return true
    })) === true
    if (!out.ensured) return finish(out, t0)

    // 2. Órdenes que el webhook no cerró. Si Provision expone el reintento de
    // credenciales por separado, la conciliación no lo hace (va en el paso 3,
    // con su propio techo, para que una tanda de órdenes abandonadas no lo
    // deje sin tiempo hora tras hora); si no, que lo haga ella como en §6.7.
    let retryCredentials = null
    out.reconciled = countOf(await step("reconcile", t0 + budget * PHASE_END.reconcile, async (phase) => {
      const prov = await import("./_academyProvision.js")
      if (typeof prov.retryPendingCredentials === "function") retryCredentials = prov.retryPendingCredentials
      const r = await prov.reconcileAcademyOrders(sql, {
        limit: 5,
        budgetMs: Math.max(250, phase.left() - 150),
        credentials: !retryCredentials,
      })
      if (r && typeof r === "object") {
        out.reconcileDetail = { checked: Number(r.checked) || 0, applied: Number(r.applied) || 0, expired: Number(r.expired) || 0 }
        if (r.stoppedEarly) out.stoppedEarly = true
        if (!retryCredentials) out.credentials = Number(r.credentials) || 0
      }
      return r
    }))

    // 3. Credenciales pendientes. retryPendingCredentials no empieza un envío
    // con menos de 2 s antes de su `deadline`: se lo corre para que el último
    // arranque quede dentro del techo de esta fase.
    if (retryCredentials) {
      const credEnd = t0 + budget * PHASE_END.credentials
      const r = await step("credentials", credEnd, () => retryCredentials(sql, { limit: 5, deadline: Math.min(deadline, credEnd + 2000) }))
      if (r && typeof r === "object") {
        out.credentials = Number(r.sent) || 0
        if (r.stoppedEarly) out.stoppedEarly = true
      }
    }

    // 4. Recordatorios de eventos.
    await step("reminders", t0 + budget * PHASE_END.reminders, (phase) => sendEventReminders(sql, { hour, phase, out }))

    // 5. Resumen de actividad, una vez al día.
    if (force || hour === 19) {
      out.activityEmails = (await step("activity", deadline, (phase) => sendActivityDigest(sql, { phase, out }))) || 0
    }

    // 6. Limpieza, una vez al día (el primer tick, con la base recién
    // despierta y sin tráfico).
    if (force || hour === 8) {
      out.cleaned = (await step("cleanup", deadline, (phase) => cleanup(sql, { phase, out }))) ?? null
    }
  } catch (err) {
    console.error("[academy:cron] error:", err?.message || err)
    out.errors.push("job")
  }
  return finish(out, t0)
}

function finish(out, t0) {
  out.ms = Date.now() - t0
  if (!out.skipped.length) delete out.skipped
  if (!out.errors.length) delete out.errors
  return out
}
