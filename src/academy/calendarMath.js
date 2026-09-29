/* ACADEMY — matemática del calendario (pestaña Calendario)
   ------------------------------------------------------------------
   Extraído del patrón de src/components/panel/CalendarSheet.jsx (keyOf, parse,
   MONTHS, semana que parte el lunes) y sin JSX, para poder probarlo solo.

   Convenciones:
   - `month` es 0-based (enero = 0), como Date y como CalendarSheet.
   - Una clave de día es "YYYY-MM-DD" y NO tiene zona: es un día de
     calendario. Para "qué día es hoy" se usa todayKey(tz), que lo calcula en
     la zona pedida (por defecto Santiago) y no en la del navegador. */

import { DEFAULT_TZ, dateKey, MONTHS_LONG } from './time.js'

export const MONTHS = MONTHS_LONG
// Encabezados de columna como en Skool ("lun. mar. mié. …"), lunes primero.
export const DOW = ['lun.', 'mar.', 'mié.', 'jue.', 'vie.', 'sáb.', 'dom.']
export const DOW_LETTER = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

const pad = (n) => String(n).padStart(2, '0')

/* keyOf(2026, 8, 28) → "2026-09-28" (month 0-based). También acepta un Date
   (usa sus partes LOCALES; para una fecha ISO del servidor usar dateKey(iso, tz)). */
export function keyOf(y, m, d) {
  if (y instanceof Date) return `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`
  // Normaliza desbordes (día 0, mes 12…) como Date.
  const dt = new Date(Date.UTC(Number(y), Number(m), Number(d)))
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

/* "2026-09-28" → { y: 2026, m: 8, d: 28 } (month 0-based) o null. */
export function parseKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''))
  return m ? { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) } : null
}

// Hoy en la zona pedida.
export function todayKey(tz = DEFAULT_TZ) {
  return dateKey(new Date(), tz)
}

// Día ISO de la semana de una clave: 1 = lunes … 7 = domingo.
export function isoWeekday(key) {
  const p = parseKey(key)
  if (!p) return null
  const dow = new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay()
  return dow === 0 ? 7 : dow
}

export function addDays(key, n) {
  const p = parseKey(key)
  if (!p) return ''
  return keyOf(p.y, p.m, p.d + Number(n || 0))
}

// { y, m } desplazado `delta` meses (m 0-based).
export function addMonths(y, m, delta) {
  const total = Number(y) * 12 + Number(m) + Number(delta || 0)
  return { y: Math.floor(total / 12), m: ((total % 12) + 12) % 12 }
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(Number(y), Number(m) + 1, 0)).getUTCDate()
}

// "septiembre 2026"
export function monthLabel(y, m) {
  return `${MONTHS[((Number(m) % 12) + 12) % 12]} ${y}`
}

/* monthGrid(2026, 8) → celdas de la grilla del mes, lunes primero, completando
   con días del mes anterior y siguiente hasta semanas enteras (5 o 6).
   Cada celda: { key, y, m, d, inMonth, dow (1=lun…7=dom), isWeekend }.
   Largo siempre múltiplo de 7; monthWeeks() las entrega partidas por semana. */
export function monthGrid(year, month) {
  const y = Number(year)
  const m = Number(month)
  const firstDow = isoWeekday(keyOf(y, m, 1)) // 1..7
  const lead = firstDow - 1
  const days = daysInMonth(y, m)
  const total = Math.ceil((lead + days) / 7) * 7
  const cells = []
  for (let i = 0; i < total; i++) {
    const dt = new Date(Date.UTC(y, m, 1 - lead + i))
    const cy = dt.getUTCFullYear()
    const cm = dt.getUTCMonth()
    const cd = dt.getUTCDate()
    const dow = (i % 7) + 1
    cells.push({ key: keyOf(cy, cm, cd), y: cy, m: cm, d: cd, inMonth: cm === m && cy === y, dow, isWeekend: dow >= 6 })
  }
  return cells
}

export function monthWeeks(year, month) {
  const cells = monthGrid(year, month)
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

/* Primer y último día VISIBLES de la grilla (para pedir `events?from=&to=`). */
export function gridRange(year, month) {
  const cells = monthGrid(year, month)
  return { from: cells[0].key, to: cells[cells.length - 1].key }
}
