/* PIMP STUDIO — Academy: eventos del Calendario (SPEC §5.5)
   ------------------------------------------------------------------
   Modos (los despacha api/_academy.js, que ya resolvió la sesión):
     events            GET  miembro    ?from=YYYY-MM-DD&to=YYYY-MM-DD[&tz=]
     event             GET  miembro    ?id=[&occurrence=ISO]
     admin-event-save  POST moderador  { id?, title, startsAt, ... }
     admin-event-delete POST moderador { id }

   Un evento semanal NO se guarda por ocurrencia: es una sola fila con la
   primera (`starts_at`) y la regla (`weekdays`, `until_date`). Las ocurrencias
   se expanden al leer (expandOccurrences), que también usa el cron para los
   recordatorios (api/_academyCron.js).

   La hora de pared es la que manda, no el instante: "Q&A los jueves 19:00"
   tiene que seguir siendo a las 19:00 de Santiago después del cambio de
   horario (Chile adelanta el 2026-09-06 y atrasa el 2027-04-04). Sumar 7 días
   en UTC al `starts_at` correría el evento una hora ese domingo. Por eso cada
   ocurrencia se arma como "fecha local + hora local de la primera" y recién
   ahí se convierte a UTC con el desfase de ESE día en la zona del evento
   (Intl, sin dependencias). Hacerlo en JS y no con `AT TIME ZONE` deja la
   expansión pura: la reusan el cron y los tests sin tocar la base.

   Evento bloqueado (nivel o grupo que el miembro no tiene): se lista igual,
   para que sepa que existe, pero sin `locationInfo` y con el link de Google
   Calendar armado sin ubicación. El .ics se arma en el navegador
   (src/academy/ics.js) con estos mismos datos, así que un bloqueado tampoco
   puede sacar el link por ahí.
   Prefijo `_`: no consume slot de función serverless. */

import { HttpError, levelFor, pointsFor, memberCohortIds, isStaffRole } from "./_academyHttp.js"
import { safeUrl, isImageUrl, cleanText } from "./_academyText.js"
import { HOST, siteUrl } from "./_academyHost.js"

export const BUSINESS_TZ = "America/Santiago"
const DAY_MS = 86400000
// El calendario pide a lo más una grilla de 6 semanas; 62 días deja margen
// para la vista de lista sin abrir la puerta a pedir un año de ocurrencias.
const MAX_RANGE_DAYS = 62
// Tope duro de la expansión pura (la usan también el cron y los tests con
// rangos arbitrarios): un evento abierto no puede hacer iterar para siempre.
const MAX_EXPAND_DAYS = 400
const MAX_OCCURRENCES = 500
const LOCATION_TYPES = new Set(["meet", "zoom", "youtube", "direccion", "enlace"])

/* ── Tiempo en una zona IANA, sin dependencias ─────────────────────────── */

const formatters = new Map()
function partsFormatter(tz) {
  let f = formatters.get(tz)
  if (!f) {
    // Lanza RangeError si la zona no existe: isValidTz se apoya en eso.
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    })
    formatters.set(tz, f)
  }
  return f
}

export function isValidTz(tz) {
  if (typeof tz !== "string" || !tz || tz.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(tz)) return false
  try { partsFormatter(tz); return true } catch { return false }
}

// Fecha y hora de pared de un instante en `tz` → { y, mo, d, h, mi, s }.
export function zonedParts(ts, tz) {
  const p = {}
  for (const part of partsFormatter(tz).formatToParts(new Date(ts))) {
    if (part.type !== "literal") p[part.type] = Number(part.value)
  }
  // Algunos ICU viejos escriben "24" para la medianoche aunque se pida h23.
  if (p.hour === 24) p.hour = 0
  return { y: p.year, mo: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second }
}

function offsetAt(ts, tz) {
  const p = zonedParts(ts, tz)
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ts / 1000) * 1000
}

/* Hora de pared en `tz` → instante UTC (ms). Se prueban los desfases de la
   víspera, el día y el día siguiente: alrededor de un cambio de horario la
   hora pedida puede no existir (el adelanto de Chile salta de 00:00 a 01:00)
   o existir dos veces (el atraso repite 23:00–23:59). Si no existe se corre
   hacia adelante (00:30 → 01:30, igual que Postgres); si existe dos veces se
   toma la primera. */
export function zonedToUtc({ y, mo, d, h = 0, mi = 0, s = 0 }, tz) {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s)
  const offsets = new Set([offsetAt(wall - DAY_MS, tz), offsetAt(wall, tz), offsetAt(wall + DAY_MS, tz)])
  const candidates = [...offsets].map((o) => wall - o)
  const exact = candidates.filter((c) => c + offsetAt(c, tz) === wall)
  return exact.length ? Math.min(...exact) : Math.max(...candidates)
}

// Días civiles como enteros (días desde 1970-01-01) para iterar sin zonas.
export const dayNumber = ({ y, mo, d }) => Math.floor(Date.UTC(y, mo - 1, d) / DAY_MS)
export function fromDayNumber(n) {
  const dt = new Date(n * DAY_MS)
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() }
}
// ISO: 1 = lunes … 7 = domingo.
export const isoWeekday = (n) => ((new Date(n * DAY_MS).getUTCDay() + 6) % 7) + 1

const pad2 = (n) => String(n).padStart(2, "0")
const ymdStr = ({ y, mo, d }) => `${y}-${pad2(mo)}-${pad2(d)}`

// Sin milisegundos: Safari/iOS y el ISO8601 de Swift los rechazan.
export const isoNoMs = (ts) => new Date(ts).toISOString().replace(/\.\d{3}Z$/, "Z")

function parseYmd(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? "").trim())
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return { y, mo, d }
}

// until_date puede llegar como texto (lo que seleccionamos) o como Date si
// alguien lee la fila cruda (node-pg arma los DATE a medianoche local).
function ymdOf(v) {
  if (v == null || v === "") return null
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? { y: v.getFullYear(), mo: v.getMonth() + 1, d: v.getDate() } : null
  return parseYmd(String(v).slice(0, 10))
}

function posInt(v) {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null
}

function weekdayList(v) {
  let arr = v
  if (typeof v === "string") arr = v.replace(/[{}\s]/g, "").split(",").filter(Boolean)
  if (!Array.isArray(arr)) return []
  return [...new Set(arr.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))].sort((a, b) => a - b)
}

/* ── Fila → evento normalizado ─────────────────────────────────────────── */

// Acepta la fila de la base (snake_case) y, por las dudas, camelCase (mock).
function normalizeEvent(row) {
  if (!row) return null
  const raw = row.starts_at ?? row.startsAt
  if (raw == null || raw === "") return null
  const startsAt = new Date(raw).getTime()
  if (!Number.isFinite(startsAt)) return null
  const tz = isValidTz(row.tz) ? row.tz : BUSINESS_TZ
  const dur = Number(row.duration_min ?? row.durationMin)
  return {
    startsAt,
    tz,
    durationMin: Number.isInteger(dur) && dur >= 30 && dur <= 1440 ? dur : 60,
    repeatWeekly: (row.repeat_weekly ?? row.repeatWeekly) === true,
    weekdays: weekdayList(row.weekdays),
    until: ymdOf(row.until_date ?? row.untilDate),
  }
}

/* Acceso guardado → forma canónica. Las filas vienen validadas por
   admin-event-save; si algo raro llega igual (edición a mano en la base), se
   cierra: solo staff lo ve, en vez de regalar el link a todos. */
export function normalizeAccess(value) {
  let a = value
  if (typeof a === "string") { try { a = JSON.parse(a) } catch { a = null } }
  if (!a || typeof a !== "object" || a.type === "todos") return { type: "todos" }
  if (a.type === "nivel") {
    const level = Number(a.level)
    return { type: "nivel", level: Number.isInteger(level) && level >= 1 && level <= 9 ? level : 9 }
  }
  if (a.type === "grupo") {
    const cohortId = posInt(a.cohortId ?? a.cohort_id)
    return { type: "grupo", cohortId: cohortId || 0 }
  }
  return { type: "grupo", cohortId: 0 }
}

/* ¿Puede `member` ver el link de `eventRow`? → { ok, reason: null|'nivel'|'grupo' }.
   Misma forma que canAccessCourse. `level` y `cohortIds` los calcula quien
   llama (una consulta por request en `events`, una por tanda en el cron). */
export function canSeeEvent(member, eventRow, { level = 1, cohortIds = [] } = {}) {
  const access = normalizeAccess(eventRow?.access)
  if (access.type === "todos") return { ok: true, reason: null }
  if (member && isStaffRole(member.role)) return { ok: true, reason: null }
  if (access.type === "nivel") {
    return Number(level) >= access.level ? { ok: true, reason: null } : { ok: false, reason: "nivel" }
  }
  const mine = (Array.isArray(cohortIds) ? cohortIds : []).map(Number)
  return access.cohortId && mine.includes(access.cohortId) ? { ok: true, reason: null } : { ok: false, reason: "grupo" }
}

/* ── Expansión de ocurrencias ──────────────────────────────────────────── */

// Borde de rango: un Date/número es un instante; "YYYY-MM-DD" es un día
// civil en la zona del evento (desde su medianoche, o hasta la medianoche
// siguiente si es el borde final: el día `to` se incluye completo).
function boundary(x, tz, isEnd) {
  if (x instanceof Date) return x.getTime()
  if (typeof x === "number") return x
  const ymd = parseYmd(x)
  if (ymd) return zonedToUtc(fromDayNumber(dayNumber(ymd) + (isEnd ? 1 : 0)), tz)
  const t = Date.parse(String(x ?? ""))
  return Number.isFinite(t) ? t : NaN
}

/* Ocurrencias que EMPIEZAN en [fromDate, toDate) → [{ occurrenceStart: Date }].
   - Sin repetición: una sola, en starts_at.
   - Semanal: cada día ISO de `weekdays` (o el de starts_at si no hay) desde la
     semana de starts_at, a la misma hora de pared en `tz`, hasta until_date
     inclusive (día civil en `tz`) o sin fin. Nunca antes de starts_at. */
export function expandOccurrences(eventRow, fromDate, toDate) {
  const ev = normalizeEvent(eventRow)
  if (!ev) return []
  const from = boundary(fromDate, ev.tz, false)
  const to = boundary(toDate, ev.tz, true)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return []

  if (!ev.repeatWeekly) {
    return ev.startsAt >= from && ev.startsAt < to ? [{ occurrenceStart: new Date(ev.startsAt) }] : []
  }

  const first = zonedParts(ev.startsAt, ev.tz)
  const firstDay = dayNumber(first)
  const days = new Set(ev.weekdays.length ? ev.weekdays : [isoWeekday(firstDay)])
  // Un día de holgura a cada lado: el día civil del borde en la zona del
  // evento puede no ser el mismo que el del instante en otra zona.
  const lo = Math.max(firstDay, dayNumber(zonedParts(from, ev.tz)) - 1)
  let hi = dayNumber(zonedParts(to, ev.tz)) + 1
  if (ev.until) hi = Math.min(hi, dayNumber(ev.until))
  hi = Math.min(hi, lo + MAX_EXPAND_DAYS)

  const out = []
  for (let n = lo; n <= hi; n++) {
    if (!days.has(isoWeekday(n))) continue
    const ts = zonedToUtc({ ...fromDayNumber(n), h: first.h, mi: first.mi, s: first.s }, ev.tz)
    if (ts >= ev.startsAt && ts >= from && ts < to) out.push({ occurrenceStart: new Date(ts) })
  }
  return out
}

/* ── Lectura ────────────────────────────────────────────────────────────── */

// Columnas fijas (nunca input): el driver de Neon no anida fragmentos, así
// que las consultas que las usan van por sql(text, params). Fechas como texto
// sin milisegundos, y until_date como texto para no depender del parser de
// DATE del driver.
const EVENT_COLS = `id, title, description, cover_url,
  to_char(starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS starts_at,
  duration_min, tz, repeat_weekly, weekdays, until_date::text AS until_date,
  location_type, location_info, access, email_reminder, created_by`

/* Eventos que PUEDEN tener una ocurrencia que empiece en [fromTs, toTs): los
   de una vez dentro del rango, y los semanales que ya empezaron y no
   terminaron antes. until_date es un día civil en la zona del evento; se
   compara contra el día UTC del borde menos uno, que nunca queda después del
   día local en ninguna zona. La expansión exacta la hace expandOccurrences. */
export async function eventsInRange(sql, fromTs, toTs, { limit = 300 } = {}) {
  const fromIso = isoNoMs(fromTs)
  return sql(
    `SELECT ${EVENT_COLS}
       FROM academy_events
      WHERE starts_at < $1::timestamptz
        AND (repeat_weekly OR starts_at >= $2::timestamptz)
        AND (NOT repeat_weekly OR until_date IS NULL OR until_date >= $3::date - 1)
      ORDER BY starts_at, id
      LIMIT $4`,
    [isoNoMs(toTs), fromIso, fromIso.slice(0, 10), Math.max(1, Math.min(1000, Number(limit) || 300))]
  )
}

async function eventById(sql, id) {
  const rows = await sql(`SELECT ${EVENT_COLS} FROM academy_events WHERE id = $1`, [id])
  return rows[0] || null
}

const gcalStamp = (ts) => isoNoMs(ts).replace(/[-:]/g, "")

/* Plantilla de Google Calendar. Va la ubicación solo si el miembro la puede
   ver: el link se arma en el servidor justamente para que un bloqueado no
   tenga de dónde sacarla. */
export function googleCalendarUrl({ title, description, startTs, durationMin, tz, location }) {
  const details = [description ? String(description).slice(0, 1500) : "", `${HOST.brand.name} · ${siteUrl()}${HOST.basePath}/calendario`]
    .filter(Boolean).join("\n\n")
  const params = [
    "action=TEMPLATE",
    `text=${encodeURIComponent(title || "Evento")}`,
    `dates=${gcalStamp(startTs)}/${gcalStamp(startTs + durationMin * 60000)}`,
    `details=${encodeURIComponent(details)}`,
    `ctz=${encodeURIComponent(tz)}`,
  ]
  if (location) params.push(`location=${encodeURIComponent(location)}`)
  return `https://calendar.google.com/calendar/render?${params.join("&")}`
}

function eventOut(row, occTs, { locked = false, lockReason = null } = {}) {
  const ev = normalizeEvent(row)
  const locationType = LOCATION_TYPES.has(row.location_type) ? row.location_type : "enlace"
  let locationInfo = null
  if (!locked && row.location_info) {
    // Se guardó validado; se vuelve a pasar por safeUrl al salir por si la
    // fila se tocó a mano. Una dirección es texto, nunca un href.
    locationInfo = locationType === "direccion" ? String(row.location_info) : safeUrl(row.location_info)
  }
  const title = String(row.title || "")
  const description = row.description ? String(row.description) : null
  return {
    id: row.id,
    occurrenceStart: isoNoMs(occTs),
    startsAt: isoNoMs(ev.startsAt),
    title,
    description,
    coverUrl: row.cover_url && isImageUrl(row.cover_url) ? safeUrl(row.cover_url) : null,
    durationMin: ev.durationMin,
    tz: ev.tz,
    locationType,
    locationInfo,
    locked: !!locked,
    lockReason: locked ? lockReason : null,
    access: normalizeAccess(row.access),
    repeatWeekly: ev.repeatWeekly,
    weekdays: ev.repeatWeekly ? (ev.weekdays.length ? ev.weekdays : [isoWeekday(dayNumber(zonedParts(ev.startsAt, ev.tz)))]) : null,
    untilDate: ev.repeatWeekly && ev.until ? ymdStr(ev.until) : null,
    emailReminder: row.email_reminder !== false,
    calendarLinks: {
      google: googleCalendarUrl({ title, description, startTs: occTs, durationMin: ev.durationMin, tz: ev.tz, location: locationInfo }),
    },
  }
}

/* Nivel y grupos del que mira, solo si alguna fila los necesita (la mayoría
   de los eventos son para todos): cero consultas extra en el caso común. */
async function viewerFor(sql, member, rows) {
  const out = { level: 1, cohortIds: [] }
  if (!member || isStaffRole(member.role)) return out
  const types = new Set(rows.map((r) => normalizeAccess(r.access).type))
  if (types.has("nivel")) {
    const points = await pointsFor(sql, [member.id])
    out.level = levelFor(Number(points?.get?.(member.id) ?? points?.get?.(String(member.id)) ?? 0)).level
  }
  if (types.has("grupo")) out.cohortIds = (await memberCohortIds(sql, member.id)) || []
  return out
}

function lockFor(member, row, viewer) {
  const r = canSeeEvent(member, row, viewer)
  return { locked: !r.ok, lockReason: r.ok ? null : r.reason }
}

/* Qué ocurrencia mostrar en `event`: la pedida si existe de verdad, si no la
   que está en curso o la próxima, si no la última (serie terminada), y si
   nada de eso, la primera. */
function pickOccurrence(row, wanted, now = Date.now()) {
  const ev = normalizeEvent(row)
  if (!ev.repeatWeekly) return ev.startsAt
  const want = wanted ? Date.parse(String(wanted)) : NaN
  if (Number.isFinite(want)) {
    const hit = expandOccurrences(row, new Date(want - 60000), new Date(want + 60000))[0]
    if (hit) return hit.occurrenceStart.getTime()
  }
  const next = expandOccurrences(row, new Date(now - ev.durationMin * 60000), new Date(now + MAX_RANGE_DAYS * DAY_MS))[0]
  if (next) return next.occurrenceStart.getTime()
  const past = expandOccurrences(row, new Date(now - MAX_RANGE_DAYS * DAY_MS), new Date(now))
  return past.length ? past[past.length - 1].occurrenceStart.getTime() : ev.startsAt
}

/* ── Escritura (moderadores) ───────────────────────────────────────────── */

async function parseAccessInput(sql, v) {
  if (v == null || v === "" || v === "todos") return { type: "todos" }
  if (typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, "El acceso del evento no es válido")
  if (v.type === "todos") return { type: "todos" }
  if (v.type === "nivel") {
    const level = Number(v.level)
    if (!Number.isInteger(level) || level < 1 || level > 9) throw new HttpError(400, "El nivel debe estar entre 1 y 9")
    // Nivel 1 lo tiene todo miembro: es lo mismo que "todos".
    return level === 1 ? { type: "todos" } : { type: "nivel", level }
  }
  if (v.type === "grupo") {
    const cohortId = posInt(v.cohortId)
    if (!cohortId) throw new HttpError(400, "Elige el grupo que puede ver el evento")
    const [cohort] = await sql`SELECT id FROM academy_cohorts WHERE id = ${cohortId}`
    if (!cohort) throw new HttpError(400, "Ese grupo no existe")
    return { type: "grupo", cohortId }
  }
  throw new HttpError(400, "El acceso del evento no es válido")
}

const MIN_TS = Date.UTC(2020, 0, 1)
const MAX_TS = Date.UTC(2100, 0, 1)

function parseStart(body, tz) {
  // `startsLocal` ("YYYY-MM-DDTHH:MM", hora de pared en `tz`) es opcional y
  // le ahorra al editor la cuenta de zona horaria cuando el navegador está en
  // otra; si no viene, manda `startsAt` (ISO con zona, como dice el SPEC).
  const local = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(String(body.startsLocal ?? "").trim())
  let ts = NaN
  if (local) {
    const ymd = parseYmd(local[1])
    const h = Number(local[2]), mi = Number(local[3])
    if (ymd && h <= 23 && mi <= 59) ts = zonedToUtc({ ...ymd, h, mi }, tz)
  } else if (body.startsAt) {
    ts = Date.parse(String(body.startsAt))
  }
  if (!Number.isFinite(ts) || ts < MIN_TS || ts > MAX_TS) throw new HttpError(400, "La fecha de inicio no es válida")
  // Al minuto: las ocurrencias se derivan de esta hora y las claves de los
  // recordatorios (event_id, occurrence_start) no deben arrastrar segundos.
  return Math.floor(ts / 60000) * 60000
}

async function saveEvent(ctx) {
  const { sql } = ctx
  const b = ctx.body || {}
  const id = b.id == null || b.id === "" ? null : posInt(b.id)
  if (b.id != null && b.id !== "" && !id) throw new HttpError(400, "Evento no válido")

  const title = cleanText(String(b.title ?? ""), 120)
  if (!title) throw new HttpError(400, "El evento necesita un título")
  const description = cleanText(String(b.description ?? ""), 5000) || null

  let coverUrl = null
  if (b.coverUrl) {
    coverUrl = isImageUrl(b.coverUrl) ? safeUrl(b.coverUrl) : null
    if (!coverUrl) throw new HttpError(400, "La portada tiene que ser una imagen subida a la Academy")
  }

  const tz = b.tz == null || b.tz === "" ? BUSINESS_TZ : String(b.tz)
  if (!isValidTz(tz)) throw new HttpError(400, "La zona horaria no es válida")

  const startsAt = parseStart(b, tz)

  const durationMin = b.durationMin == null || b.durationMin === "" ? 60 : Number(b.durationMin)
  if (!Number.isInteger(durationMin) || durationMin < 30 || durationMin > 1440) {
    throw new HttpError(400, "La duración tiene que estar entre 30 minutos y 24 horas")
  }

  const repeatWeekly = b.repeatWeekly === true || b.repeatWeekly === "true"
  let weekdays = null
  let untilDate = null
  if (repeatWeekly) {
    const raw = b.weekdays == null ? [] : b.weekdays
    if (!Array.isArray(raw) || raw.length > 7 || raw.some((n) => !Number.isInteger(Number(n)) || Number(n) < 1 || Number(n) > 7)) {
      throw new HttpError(400, "Los días de la semana no son válidos")
    }
    const startDay = dayNumber(zonedParts(startsAt, tz))
    // El día de la primera fecha siempre es parte de la serie: starts_at es
    // "la primera ocurrencia" (§2) y no puede quedar fuera de su propia regla.
    weekdays = weekdayList([...raw, isoWeekday(startDay)])
    if (b.untilDate) {
      const until = parseYmd(b.untilDate)
      if (!until) throw new HttpError(400, "La fecha de término no es válida")
      if (dayNumber(until) < startDay) throw new HttpError(400, "La fecha de término no puede ser antes del inicio")
      untilDate = ymdStr(until)
    }
  }

  const locationType = b.locationType == null || b.locationType === "" ? "enlace" : String(b.locationType)
  if (!LOCATION_TYPES.has(locationType)) throw new HttpError(400, "El tipo de ubicación no es válido")
  let locationInfo = null
  const rawLocation = String(b.locationInfo ?? "").trim()
  if (rawLocation) {
    if (locationType === "direccion") {
      locationInfo = cleanText(rawLocation, 300) || null
    } else {
      // Meet, Zoom, YouTube o enlace: tiene que ser una URL segura. Un
      // `javascript:` guardado acá terminaría como href en el Calendario.
      locationInfo = rawLocation.length <= 2000 ? safeUrl(rawLocation) : null
      if (!locationInfo) throw new HttpError(400, "El enlace del evento no es válido (usa https://…)")
    }
  }

  const access = await parseAccessInput(sql, b.access)
  const emailReminder = b.emailReminder !== false && b.emailReminder !== "false"
  const createdBy = ctx.admin?.memberId ?? ctx.member?.id ?? null

  const params = [
    title, description, coverUrl, isoNoMs(startsAt), durationMin, tz, repeatWeekly, weekdays, untilDate,
    locationType, locationInfo, JSON.stringify(access), emailReminder,
  ]
  let row
  if (id) {
    const rows = await sql(
      `UPDATE academy_events
          SET title = $1, description = $2, cover_url = $3, starts_at = $4::timestamptz, duration_min = $5,
              tz = $6, repeat_weekly = $7, weekdays = $8::int[], until_date = $9::date,
              location_type = $10, location_info = $11, access = $12::jsonb, email_reminder = $13,
              updated_at = NOW()
        WHERE id = $14
        RETURNING ${EVENT_COLS}`,
      [...params, id]
    )
    row = rows[0]
    if (!row) throw new HttpError(404, "Evento no encontrado")
  } else {
    const rows = await sql(
      `INSERT INTO academy_events
         (title, description, cover_url, starts_at, duration_min, tz, repeat_weekly, weekdays, until_date,
          location_type, location_info, access, email_reminder, created_by)
       VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7, $8::int[], $9::date, $10, $11, $12::jsonb, $13, $14)
       RETURNING ${EVENT_COLS}`,
      [...params, createdBy]
    )
    row = rows[0]
  }
  return { event: eventOut(row, startsAt) }
}

/* ── Modos ─────────────────────────────────────────────────────────────── */

export const handlers = {
  events: async (ctx) => {
    const { sql, member } = ctx
    const query = ctx.query || {}
    const tz = isValidTz(query.tz) ? String(query.tz)
      : isValidTz(member?.prefs?.tz) ? member.prefs.tz
        : BUSINESS_TZ

    const fromYmd = query.from ? parseYmd(query.from) : zonedParts(Date.now(), tz)
    if (!fromYmd) throw new HttpError(400, "La fecha de inicio del rango no es válida")
    const fromDay = dayNumber(fromYmd)
    const toYmd = query.to ? parseYmd(query.to) : fromDayNumber(fromDay + 30)
    if (!toYmd) throw new HttpError(400, "La fecha de término del rango no es válida")
    const toDay = dayNumber(toYmd)
    if (toDay < fromDay) throw new HttpError(400, "El rango de fechas no es válido")
    if (toDay - fromDay > MAX_RANGE_DAYS) throw new HttpError(400, `El rango máximo es de ${MAX_RANGE_DAYS} días`)

    // Días civiles en la zona de quien mira; `to` incluido completo.
    const from = zonedToUtc(fromDayNumber(fromDay), tz)
    const to = zonedToUtc(fromDayNumber(toDay + 1), tz)

    const rows = await eventsInRange(sql, from, to)
    const viewer = await viewerFor(sql, member, rows)
    const occurrences = []
    for (const row of rows) {
      const lock = lockFor(member, row, viewer)
      for (const o of expandOccurrences(row, new Date(from), new Date(to))) {
        occurrences.push({ row, ts: o.occurrenceStart.getTime(), lock })
      }
    }
    occurrences.sort((a, b) => a.ts - b.ts || a.row.id - b.row.id)
    const truncated = occurrences.length > MAX_OCCURRENCES
    const events = occurrences.slice(0, MAX_OCCURRENCES).map((o) => eventOut(o.row, o.ts, o.lock))
    return {
      events,
      serverTime: isoNoMs(Date.now()),
      range: { from: ymdStr(fromYmd), to: ymdStr(toYmd), tz },
      ...(truncated ? { truncated: true } : {}),
    }
  },

  event: async (ctx) => {
    const { sql, member } = ctx
    const id = posInt(ctx.query?.id)
    if (!id) throw new HttpError(400, "Evento no válido")
    const row = await eventById(sql, id)
    if (!row) throw new HttpError(404, "Evento no encontrado")
    const viewer = await viewerFor(sql, member, [row])
    return { event: eventOut(row, pickOccurrence(row, ctx.query?.occurrence), lockFor(member, row, viewer)) }
  },

  "admin-event-save": saveEvent,

  "admin-event-delete": async (ctx) => {
    const id = posInt(ctx.body?.id)
    if (!id) throw new HttpError(400, "Evento no válido")
    // Los recordatorios ya enviados se van por ON DELETE CASCADE.
    const [row] = await ctx.sql`DELETE FROM academy_events WHERE id = ${id} RETURNING id`
    if (!row) throw new HttpError(404, "Evento no encontrado")
    return {}
  },
}
