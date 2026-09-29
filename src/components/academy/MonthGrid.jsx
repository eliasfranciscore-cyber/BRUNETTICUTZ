import React, { useMemo } from 'react'
import { Icon } from '../../academy/Icon.jsx'
import { DEFAULT_TZ, DAYS_LONG, partsIn, dateKey, fmtTime, fmtDate, tzLabel, toDate } from '../../academy/time.js'
import { MONTHS, DOW, keyOf, parseKey as parseKeyLib, addDays, isoWeekday, monthGrid, gridRange } from '../../academy/calendarMath.js'

/* ============================================================
   Calendario de Academy — grilla mensual (lunes a domingo, como Skool) y los
   ayudantes de zona horaria que comparten EventSheet, EventEditor, el tab
   Calendario y el chat (separadores de día).

   Los cálculos base (partes de una fecha en una zona, claves de día, grilla
   lunes-primero) son de src/academy/time.js y calendarMath.js; acá solo se
   agregan los que necesita el calendario: el camino inverso (19:00 del jueves
   en Santiago → instante UTC) para guardar un evento, la zona de quien mira
   y cómo ubicar cada ocurrencia en su día.
   ============================================================ */

const cx = (...p) => p.filter(Boolean).join(' ')

export const MONTHS_ES = MONTHS
export const WEEKDAYS_ES = DAYS_LONG // índice 0 = lunes (ISO 1)
export const WEEKDAYS_SHORT_ES = DOW // "lun. mar. mié. …" como el encabezado de Skool

/* Una zona inválida (prefs viejas, navegador raro) no puede romper la
   página: cae a Santiago, la zona del negocio. */
export function safeTz(tz) {
  if (!tz || typeof tz !== 'string') return DEFAULT_TZ
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }) // eslint-disable-line no-new
    return tz
  } catch {
    return DEFAULT_TZ
  }
}

export function browserTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TZ
  } catch {
    return DEFAULT_TZ
  }
}

/* Zona de quien mira: la de sus preferencias, si no la del navegador. */
export function viewerTz(me) {
  return safeTz(me?.prefs?.tz || browserTz())
}

/* Reloj de pared de un instante en una zona: { y, m (0-11), d, hh, mm, dow (1=lunes) }.
   (partsIn de time.js devuelve el mes 1-12; acá se usa 0-11 como calendarMath.) */
export function wallClock(date, tz) {
  const p = partsIn(date, safeTz(tz))
  return p ? { ...p, m: p.m - 1 } : null
}

export const keyOfParts = keyOf
export const parseKey = parseKeyLib
export const addDaysKey = addDays
export const dowOfKey = (key) => isoWeekday(key) || 1

/* "YYYY-MM-DD" del día que es en `tz` para ese instante. */
export function dayKeyIn(date, tz) {
  return dateKey(date, safeTz(tz))
}

/* 19:00 del 2026-10-01 en America/Santiago → instante UTC. Se ajusta dos o
   tres veces por el desfase de la zona (que depende del propio instante por
   el horario de verano; Chile cambia el 2026-09-06). Una hora que no existe
   (salto de DST) cae en la hora siguiente, como hacen los calendarios. */
export function zonedToUtc(key, hhmm, tz) {
  const p = parseKeyLib(key)
  const t = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''))
  if (!p || !t) return null
  const target = Date.UTC(p.y, p.m, p.d, Number(t[1]), Number(t[2]))
  let ts = target
  for (let i = 0; i < 4; i += 1) {
    const w = wallClock(new Date(ts), tz)
    if (!w) return null
    const diff = Date.UTC(w.y, w.m, w.d, w.hh, w.mm) - target
    if (diff === 0) break
    ts -= diff
  }
  return new Date(ts)
}

/* ISO sin milisegundos (mismo formato que devuelve el backend, §0.7). */
export function isoNoMs(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export const fmtTime24 = (date, tz) => fmtTime(date, { tz: safeTz(tz) })
// "9:40 pm" — solo para el reloj del encabezado, igual al de Skool.
export const fmtTime12 = (date, tz) => fmtTime(date, { tz: safeTz(tz), h12: true })

/* "jueves 2 de octubre" (+ " de 2027" si no es el año en curso). */
export function longDate(date, tz) {
  return fmtDate(date, { tz: safeTz(tz), long: true, weekday: true, year: 'auto' })
}

/* Lo mismo para una clave de día (no tiene zona: se formatea a mediodía UTC). */
export function longDateOfKey(key) {
  const p = parseKeyLib(key)
  if (!p) return ''
  return fmtDate(new Date(Date.UTC(p.y, p.m, p.d, 12)), { tz: 'UTC', long: true, weekday: true, year: 'auto' })
}

export const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

// Nombres en español para las zonas que se ofrecen (tzLabel usa el id tal cual).
const TZ_CITY = {
  'America/Santiago': 'Santiago',
  'America/Punta_Arenas': 'Punta Arenas',
  'Pacific/Easter': 'Isla de Pascua',
  'America/Argentina/Buenos_Aires': 'Buenos Aires',
  'America/Buenos_Aires': 'Buenos Aires',
  'America/Lima': 'Lima',
  'America/Bogota': 'Bogotá',
  'America/Mexico_City': 'Ciudad de México',
  'America/Caracas': 'Caracas',
  'America/New_York': 'Nueva York',
  'America/Los_Angeles': 'Los Ángeles',
  'Europe/Madrid': 'Madrid',
  UTC: 'UTC',
}

export function tzCity(tz) {
  const z = safeTz(tz)
  return TZ_CITY[z] || (z.split('/').pop() || z).replace(/_/g, ' ')
}

/* "hora de Santiago" (como el "9:40pm hora de Santiago" de Skool). */
export function tzPhrase(tz) {
  const z = safeTz(tz)
  if (!TZ_CITY[z]) return tzLabel(z)
  return z === 'UTC' ? 'hora UTC' : `hora de ${TZ_CITY[z]}`
}

/* Zonas que se ofrecen al crear un evento. Chile primero (el negocio está
   acá); el resto cubre a alumnos online de la región. */
export const TZ_OPTIONS = [
  ['America/Santiago', 'Santiago (Chile continental)'],
  ['America/Punta_Arenas', 'Punta Arenas (Magallanes)'],
  ['Pacific/Easter', 'Isla de Pascua'],
  ['America/Argentina/Buenos_Aires', 'Buenos Aires'],
  ['America/Lima', 'Lima'],
  ['America/Bogota', 'Bogotá'],
  ['America/Mexico_City', 'Ciudad de México'],
  ['America/Caracas', 'Caracas'],
  ['America/New_York', 'Nueva York'],
  ['America/Los_Angeles', 'Los Ángeles'],
  ['Europe/Madrid', 'Madrid'],
  ['UTC', 'UTC'],
]

/* Celdas del mes (lunes primero, 4 a 6 filas): { key, d, inMonth, … } — de calendarMath. */
export const buildMonthCells = monthGrid
/* Primer y último día visibles de la grilla: el rango que se pide a `events`
   (≤ 42 días, bajo el tope de 62 del backend). */
export const monthRange = gridRange

export function eventStart(ev) {
  return toDate(ev?.occurrenceStart || ev?.startsAt)
}

export function eventEnd(ev) {
  const s = eventStart(ev)
  if (!s) return null
  const mins = Number(ev?.durationMin) > 0 ? Number(ev.durationMin) : 60
  return new Date(s.getTime() + mins * 60000)
}

/* Clave estable de una ocurrencia (un evento semanal repite el id). */
export function occurrenceKey(ev) {
  return `${ev?.id}@${ev?.occurrenceStart || ev?.startsAt || ''}`
}

/* { "YYYY-MM-DD": [eventos ordenados por hora] } en la zona de quien mira. */
export function groupByDay(events, tz) {
  const out = {}
  for (const ev of events || []) {
    const s = eventStart(ev)
    if (!s) continue
    const k = dayKeyIn(s, tz)
    if (!out[k]) out[k] = []
    out[k].push(ev)
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => eventStart(a) - eventStart(b))
  return out
}

/* ------------------------------------------------------------------ */

function EventChip({ ev, tz, now, onOpen }) {
  const start = eventStart(ev)
  const end = eventEnd(ev)
  const past = end && end.getTime() < now
  const time = start ? fmtTime24(start, tz) : ''
  return (
    <button
      type="button"
      className={cx('aca-mchip', past && 'is-past', ev.locked && 'is-locked')}
      onClick={(e) => { e.stopPropagation(); onOpen?.(ev) }}
      title={`${time} · ${ev.title}`}
    >
      <span className="aca-mchip-time">{time}</span>
      <span className="aca-mchip-title">{ev.title}</span>
      {ev.locked && <Icon name="lock" size={11} />}
    </button>
  )
}

/**
 * Grilla mensual.
 * props: year, month (0-11), events (ocurrencias de `events`), tz (de quien
 * mira), todayKey, selectedKey, onSelectDay(key), onOpenEvent(ev),
 * onMore(key, eventsDelDia), compact (celular: puntos en vez de chips),
 * maxChips (escritorio).
 */
export default function MonthGrid({
  year,
  month,
  events = [],
  tz,
  todayKey,
  selectedKey,
  onSelectDay,
  onOpenEvent,
  onMore,
  compact = false,
  maxChips = 3,
  now = Date.now(),
  className,
}) {
  const cells = useMemo(() => buildMonthCells(year, month), [year, month])
  const byDay = useMemo(() => groupByDay(events, tz), [events, tz])
  const rows = Math.ceil(cells.length / 7)

  return (
    <div className={cx('aca-mgrid', compact && 'is-compact', className)} role="grid" aria-label={`${MONTHS_ES[month]} de ${year}`}>
      <div className="aca-mgrid-dow" role="row">
        {WEEKDAYS_SHORT_ES.map((d, i) => (
          <span key={d} role="columnheader" aria-label={WEEKDAYS_ES[i]}>{compact ? d.charAt(0).toUpperCase() : d}</span>
        ))}
      </div>
      <div className="aca-mgrid-body" style={{ '--rows': rows }}>
        {cells.map((cell) => {
          const list = byDay[cell.key] || []
          const isToday = cell.key === todayKey
          const isSel = cell.key === selectedKey
          const label = `${longDateOfKey(cell.key)}${list.length ? ` · ${list.length} ${list.length === 1 ? 'evento' : 'eventos'}` : ''}`
          if (compact) {
            return (
              <button
                key={cell.key}
                type="button"
                role="gridcell"
                aria-selected={isSel}
                aria-label={label}
                className={cx('aca-mcell', !cell.inMonth && 'is-out', isToday && 'is-today', isSel && 'is-sel', list.length > 0 && 'has-events')}
                onClick={() => onSelectDay?.(cell.key)}
              >
                <span className="aca-mcell-num">{cell.d}</span>
                <span className="aca-mcell-dots" aria-hidden="true">
                  {list.slice(0, 3).map((ev) => <i key={occurrenceKey(ev)} className={ev.locked ? 'is-locked' : undefined} />)}
                </span>
              </button>
            )
          }
          const shown = list.length > maxChips ? list.slice(0, maxChips - 1) : list
          const hidden = list.length - shown.length
          return (
            <div
              key={cell.key}
              role="gridcell"
              aria-label={label}
              className={cx('aca-mcell', !cell.inMonth && 'is-out', isToday && 'is-today', isSel && 'is-sel')}
              onClick={onSelectDay ? () => onSelectDay(cell.key) : undefined}
            >
              <span className="aca-mcell-num">{cell.d}</span>
              <div className="aca-mcell-events">
                {shown.map((ev) => <EventChip key={occurrenceKey(ev)} ev={ev} tz={tz} now={now} onOpen={onOpenEvent} />)}
                {hidden > 0 && (
                  <button type="button" className="aca-mchip-more" onClick={(e) => { e.stopPropagation(); onMore?.(cell.key, list) }}>
                    +{hidden} más
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
