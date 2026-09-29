/* Mock de Academy — Calendario (SPEC §5.5).

   Espejo de api/_academyEvents.js: eventos únicos y semanales, su
   expansión a ocurrencias dentro de un rango, el detalle de una ocurrencia
   y el CRUD del staff.

   La expansión semanal mantiene la HORA DE PARED en la zona del evento: un
   "Q&A con Bruno" los jueves 19:00 sigue a las 19:00 de Santiago antes y
   después del cambio de horario (2026-09-06), aunque en UTC se corra una
   hora. Igual que el backend (que lo calcula con AT TIME ZONE en Postgres),
   acá se hace con Intl, sin librerías, resolviendo el hueco y la hora
   repetida del cambio de horario con la misma regla de Postgres (ver
   wallToUtc en academy-community.mjs).

   Visibilidad: un evento bloqueado (por nivel o de un Grupo ajeno) se lista
   igual, pero con `locked:true` y SIN `locationInfo` (ni en el enlace de
   Google Calendar): el enlace de la reunión es lo que se protege. */

import {
  fail, rows, removeWhere, toInt, toBool, has, msOf, toIso, nowIso, nextIdOf, cleanText, safeUrl, isImageUrl,
  SANTIAGO, validTz, wallParts, wallToUtc, dayNum, dayParts, isoWeekday, dayKey, dayOfKey, dayOfInstant, startOfDay,
  staffRow, ctxIsStaff, needMember, needStaff, actorId, levelOfM, cohortIdsOfM, L,
} from './academy-community.mjs'
import { HOST } from './lib.mjs'

const DAY = 86400000
const MAX_RANGE_DAYS = 62
const LOCATION_TYPES = ['meet', 'zoom', 'youtube', 'direccion', 'enlace']
// Enlace al calendario en la descripción del evento (Google Calendar / .ics).
const eventsUrl = () => `${HOST.brand.siteUrl}${HOST.base}/calendario`

const eventRow = (st, id) => (id == null ? null : rows(st, 'academy_events').find((e) => e.id === id) || null)
const eventTz = (ev) => (validTz(ev.tz) ? ev.tz : SANTIAGO)

function parseAccess(v) {
  let a = v
  if (typeof a === 'string') { try { a = JSON.parse(a) } catch { a = null } }
  return a && typeof a === 'object' && !Array.isArray(a) && a.type ? a : { type: 'todos' }
}

function weekdaysOf(ev) {
  const list = Array.isArray(ev.weekdays) ? ev.weekdays.map(toInt).filter((d) => d != null && d >= 1 && d <= 7) : []
  return [...new Set(list)].sort((a, b) => a - b)
}

const dateStr = (v) => (v == null || v === '' ? null : String(v).slice(0, 10))

/* ── Expansión de ocurrencias (misma firma que la del backend, §16) ──
   Única → una ocurrencia en starts_at. Semanal → cada día de `weekdays`
   (por defecto el día de starts_at) desde la primera ocurrencia, a la misma
   hora local de starts_at en la zona del evento, hasta `until_date`
   inclusive (o sin fin). Devuelve solo las que empiezan dentro de
   [fromDate, toDate). */
export function expandOccurrences(ev, fromDate, toDate) {
  const from = msOf(fromDate)
  const to = msOf(toDate)
  const start = msOf(ev?.starts_at)
  if (start == null || from == null || to == null || to <= from) return []
  if (!ev.repeat_weekly) return start >= from && start < to ? [{ occurrenceStart: new Date(start) }] : []

  const tz = eventTz(ev)
  const w = wallParts(start, tz)
  const startDay = dayNum(w.y, w.m, w.d)
  let wds = weekdaysOf(ev)
  if (!wds.length) wds = [isoWeekday(startDay)]
  const untilDay = ev.until_date ? dayOfKey(dateStr(ev.until_date)) : null
  // Un día de margen a cada lado: el rango viene en la zona de quien mira,
  // que puede no ser la del evento.
  const first = Math.max(startDay, dayOfInstant(from, tz) - 1)
  let last = dayOfInstant(to, tz) + 1
  if (untilDay != null) last = Math.min(last, untilDay)
  const out = []
  for (let day = first; day <= last; day++) {
    if (!wds.includes(isoWeekday(day))) continue
    const p = dayParts(day)
    const t = wallToUtc(p.y, p.m, p.d, w.H, w.M, w.S, tz)
    if (t >= start && t >= from && t < to) out.push({ occurrenceStart: new Date(t) })
  }
  return out
}

// La que está en curso o la próxima; si la serie ya terminó, la última; si
// nunca hubo (datos raros), la primera.
export function nextOccurrence(ev) {
  const start = msOf(ev.starts_at)
  if (!ev.repeat_weekly || start == null) return start
  const now = Date.now()
  const dur = (toInt(ev.duration_min) || 60) * 60000
  const next = expandOccurrences(ev, Math.max(start, now - dur), now + 370 * DAY)[0]
  if (next) return next.occurrenceStart.getTime()
  const untilDay = ev.until_date ? dayOfKey(dateStr(ev.until_date)) : null
  if (untilDay != null) {
    const tz = eventTz(ev)
    const tail = expandOccurrences(ev, startOfDay(untilDay - 7, tz), startOfDay(untilDay + 1, tz))
    if (tail.length) return tail[tail.length - 1].occurrenceStart.getTime()
  }
  return start
}

/* ── Visibilidad (canSeeEvent) ──
   Regla local de §5.5 y, además, la del lib compartido del mock: si
   cualquiera de las dos dice que no, el evento queda bloqueado. */
export function eventVisible(ctx, viewer, ev) {
  if (!viewer) return ctxIsStaff(ctx)
  if (!staffRow(viewer)) {
    const a = parseAccess(ev.access)
    if (a.type === 'nivel' && levelOfM(ctx, viewer.id) < (toInt(a.level) || 1)) return false
    if (a.type === 'grupo' && !cohortIdsOfM(ctx, viewer.id).includes(toInt(a.cohortId))) return false
  }
  if (typeof L(ctx).canSeeEvent === 'function') {
    const r = L(ctx).canSeeEvent(ctx.state, viewer, { ...ev, access: parseAccess(ev.access) })
    return r && typeof r === 'object' ? !!r.ok : !!r
  }
  return true
}

const gcalStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')

function googleLink(ev, startMs, locked) {
  const end = startMs + (toInt(ev.duration_min) || 60) * 60000
  const details = [cleanText(ev.description, 1000), eventsUrl()].filter(Boolean).join('\n\n')
  let url = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    `&text=${encodeURIComponent(ev.title || 'Evento')}` +
    `&dates=${gcalStamp(startMs)}/${gcalStamp(end)}` +
    `&details=${encodeURIComponent(details)}`
  if (!locked && ev.location_info) url += `&location=${encodeURIComponent(ev.location_info)}`
  return url
}

function eventShape(ctx, ev, occMs) {
  const locked = !eventVisible(ctx, ctx.member, ev)
  const access = parseAccess(ev.access)
  return {
    id: ev.id,
    occurrenceStart: toIso(occMs),
    title: ev.title,
    description: ev.description ?? null,
    coverUrl: ev.cover_url && isImageUrl(ev.cover_url) ? ev.cover_url : null,
    durationMin: toInt(ev.duration_min) || 60,
    tz: eventTz(ev),
    locationType: LOCATION_TYPES.includes(ev.location_type) ? ev.location_type : 'enlace',
    locationInfo: locked ? null : ev.location_info ?? null,
    locked,
    lockReason: locked ? (access.type === 'grupo' ? 'grupo' : 'nivel') : null,
    access,
    repeatWeekly: !!ev.repeat_weekly,
    weekdays: Array.isArray(ev.weekdays) ? weekdaysOf(ev) : null,
    untilDate: dateStr(ev.until_date),
    emailReminder: ev.email_reminder !== false,
    calendarLinks: { google: googleLink(ev, occMs, locked) },
  }
}

/* ══ Handlers ═════════════════════════════════════════════════════════════ */

function events(ctx) {
  const me = needMember(ctx)
  const q = ctx.query || {}
  const tz = validTz(q.tz) ? q.tz : validTz(me.prefs?.tz) ? me.prefs.tz : SANTIAGO
  const fromDay = dayOfKey(q.from)
  const toDay = dayOfKey(q.to)
  if (fromDay == null || toDay == null || toDay < fromDay) fail(ctx, 400, 'El rango de fechas no es válido', 'invalid')
  if (toDay - fromDay + 1 > MAX_RANGE_DAYS) fail(ctx, 400, `El rango máximo es de ${MAX_RANGE_DAYS} días`, 'invalid')
  // [from 00:00, to+1 00:00) en la zona de quien mira.
  const fromMs = startOfDay(fromDay, tz)
  const toMs = startOfDay(toDay + 1, tz)
  const out = []
  for (const ev of rows(ctx.state, 'academy_events')) {
    for (const o of expandOccurrences(ev, fromMs, toMs)) out.push(eventShape(ctx, ev, o.occurrenceStart.getTime()))
  }
  out.sort((a, b) => a.occurrenceStart.localeCompare(b.occurrenceStart) || a.id - b.id)
  return { events: out, serverTime: nowIso(ctx) }
}

function event(ctx) {
  needMember(ctx)
  const q = ctx.query || {}
  const ev = eventRow(ctx.state, toInt(q.id))
  if (!ev) fail(ctx, 404, 'Evento no encontrado', 'not_found')
  let occ
  if (q.occurrence != null && q.occurrence !== '') {
    const t = msOf(q.occurrence)
    if (t == null) fail(ctx, 400, 'La fecha no es válida', 'invalid')
    const hit = expandOccurrences(ev, t - 60000, t + 60000)[0]
    if (!hit) fail(ctx, 404, 'Evento no encontrado', 'not_found')
    occ = hit.occurrenceStart.getTime()
  } else occ = nextOccurrence(ev)
  return { event: eventShape(ctx, ev, occ) }
}

function normalizeAccess(ctx, raw) {
  let a = raw
  if (typeof a === 'string') { try { a = JSON.parse(a) } catch { a = null } }
  if (!a || typeof a !== 'object') fail(ctx, 400, 'El acceso del evento no es válido', 'invalid')
  if (a.type === 'todos') return { type: 'todos' }
  if (a.type === 'nivel') {
    const level = toInt(a.level)
    if (level == null || level < 2 || level > 9) fail(ctx, 400, 'El nivel debe estar entre 2 y 9', 'invalid')
    return { type: 'nivel', level }
  }
  if (a.type === 'grupo') {
    const cohortId = toInt(a.cohortId)
    if (cohortId == null || !rows(ctx.state, 'academy_cohorts').some((c) => c.id === cohortId)) fail(ctx, 400, 'Ese grupo no existe', 'invalid')
    return { type: 'grupo', cohortId }
  }
  return fail(ctx, 400, 'El acceso del evento no es válido', 'invalid')
}

function adminEventSave(ctx) {
  needStaff(ctx)
  const st = ctx.state
  const b = ctx.body || {}
  const id = toInt(b.id)
  const existing = id != null ? eventRow(st, id) : null
  if (id != null && !existing) fail(ctx, 404, 'Evento no encontrado', 'not_found')
  // Campo ausente = sin cambios (en una edición).
  const val = (key, col, dflt) => (has(b, key) ? b[key] : existing ? existing[col] : dflt)

  const title = cleanText(val('title', 'title', ''), 120).replace(/\n+/g, ' ')
  if (!title) fail(ctx, 400, 'Ponle un título al evento', 'invalid')
  const description = cleanText(val('description', 'description', ''), 5000) || null
  const coverRaw = val('coverUrl', 'cover_url', null)
  let coverUrl = null
  if (coverRaw != null && coverRaw !== '') {
    if (!isImageUrl(coverRaw)) fail(ctx, 400, 'La portada no es válida', 'bad_image')
    coverUrl = safeUrl(coverRaw) || String(coverRaw).trim()
  }
  const tz = val('tz', 'tz', SANTIAGO) || SANTIAGO
  if (!validTz(tz)) fail(ctx, 400, 'La zona horaria no es válida', 'invalid')
  const startsAt = msOf(val('startsAt', 'starts_at', null))
  if (startsAt == null) fail(ctx, 400, 'Falta la fecha y hora de inicio', 'invalid')
  const durationMin = toInt(val('durationMin', 'duration_min', 60))
  if (durationMin == null || durationMin < 30 || durationMin > 1440) fail(ctx, 400, 'La duración debe estar entre 30 minutos y 24 horas', 'invalid')

  const repeatWeekly = toBool(val('repeatWeekly', 'repeat_weekly', false))
  const startDay = dayOfInstant(startsAt, tz)
  let weekdays = null
  let untilDate = null
  if (repeatWeekly) {
    const raw = val('weekdays', 'weekdays', null)
    const list = Array.isArray(raw) ? raw.map(toInt) : []
    if (list.some((d) => d == null || d < 1 || d > 7)) fail(ctx, 400, 'Los días de la semana no son válidos', 'invalid')
    weekdays = [...new Set(list)].sort((a, c) => a - c)
    if (!weekdays.length) weekdays = [isoWeekday(startDay)]
    const u = val('untilDate', 'until_date', null)
    if (u != null && u !== '') {
      const uDay = dayOfKey(String(u).slice(0, 10))
      if (uDay == null) fail(ctx, 400, 'La fecha de término no es válida', 'invalid')
      if (uDay < startDay) fail(ctx, 400, 'La fecha de término es anterior al inicio', 'invalid')
      untilDate = dayKey(uDay)
    }
  }

  const locationType = val('locationType', 'location_type', 'enlace') || 'enlace'
  if (!LOCATION_TYPES.includes(locationType)) fail(ctx, 400, 'El tipo de lugar no es válido', 'invalid')
  const infoRaw = val('locationInfo', 'location_info', null)
  let locationInfo = null
  if (infoRaw != null && String(infoRaw).trim() !== '') {
    if (locationType === 'direccion') locationInfo = cleanText(infoRaw, 300).replace(/\n+/g, ', ')
    else {
      // Meet/Zoom/YouTube/enlace: solo https (nada de javascript:, data:, etc.).
      locationInfo = safeUrl(String(infoRaw))
      if (!locationInfo) fail(ctx, 400, 'El enlace del evento no es válido', 'bad_url')
    }
  }
  const access = normalizeAccess(ctx, val('access', 'access', { type: 'todos' }))
  const emailReminder = toBool(val('emailReminder', 'email_reminder', true), true)

  const now = nowIso(ctx)
  const fields = {
    title, description, cover_url: coverUrl, starts_at: toIso(startsAt), duration_min: durationMin, tz,
    repeat_weekly: repeatWeekly, weekdays, until_date: untilDate, location_type: locationType, location_info: locationInfo,
    access, email_reminder: emailReminder, updated_at: now,
  }
  let ev = existing
  if (ev) Object.assign(ev, fields)
  else {
    ev = { id: nextIdOf(ctx, 'academy_events'), ...fields, created_by: actorId(ctx), created_at: now }
    rows(st, 'academy_events').push(ev)
  }
  return { event: eventShape(ctx, ev, nextOccurrence(ev)) }
}

function adminEventDelete(ctx) {
  needStaff(ctx)
  const st = ctx.state
  const id = toInt(ctx.body?.id)
  if (!eventRow(st, id)) fail(ctx, 404, 'Evento no encontrado', 'not_found')
  removeWhere(st, 'academy_events', (e) => e.id === id)
  // ON DELETE CASCADE de academy_event_reminders.
  removeWhere(st, 'academy_event_reminders', (r) => r.event_id === id)
  return {}
}

export const handlers = {
  events,
  event,
  'admin-event-save': adminEventSave,
  'admin-event-delete': adminEventDelete,
}
