/* ACADEMY — fechas y horas (es-CL)
   ------------------------------------------------------------------
   El negocio está en America/Santiago y el servidor manda las fechas en ISO
   UTC sin milisegundos ("2026-09-28T22:40:00Z", SPEC §0.7). Todo lo que se
   muestra se calcula en la zona del miembro (prefs.tz) o, por defecto, la de
   Santiago — nunca con la hora local del navegador, que en un viaje o un
   emulador da otro día.

   Los nombres de meses y días van escritos a mano en vez de pedírselos a
   Intl: Safari y Chrome no abrevian igual ("sep." vs "sept.") y Skool usa
   siempre la misma forma ("ago. 25"). */

export const DEFAULT_TZ = 'America/Santiago'

export const MONTHS_SHORT = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sept.', 'oct.', 'nov.', 'dic.']
export const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
// Semana ISO: índice 0 = lunes.
export const DAYS_SHORT = ['lun.', 'mar.', 'mié.', 'jue.', 'vie.', 'sáb.', 'dom.']
export const DAYS_LONG = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

export function toDate(v) {
  if (v === null || v === undefined || v === '') return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

const partsCache = new Map()
function formatterFor(tz) {
  let f = partsCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short', hourCycle: 'h23',
    })
    partsCache.set(tz, f)
  }
  return f
}
const WEEKDAY_ISO = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

/* Partes de una fecha en una zona: { y, m (1-12), d, hh, mm, ss, dow (1=lun…7=dom) }. */
export function partsIn(value, tz = DEFAULT_TZ) {
  const date = toDate(value)
  if (!date) return null
  try {
    const out = {}
    for (const p of formatterFor(tz || DEFAULT_TZ).formatToParts(date)) out[p.type] = p.value
    return {
      y: Number(out.year), m: Number(out.month), d: Number(out.day),
      hh: Number(out.hour) % 24, mm: Number(out.minute), ss: Number(out.second),
      dow: WEEKDAY_ISO[out.weekday] || 1,
    }
  } catch {
    // Zona inválida (prefs corruptas): hora local, mejor que romper la página.
    return {
      y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate(),
      hh: date.getHours(), mm: date.getMinutes(), ss: date.getSeconds(),
      dow: ((date.getDay() + 6) % 7) + 1,
    }
  }
}

const pad = (n) => String(n).padStart(2, '0')

// "YYYY-MM-DD" del día de esa fecha en la zona.
export function dateKey(value, tz = DEFAULT_TZ) {
  const p = partsIn(value, tz)
  return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : ''
}

function keyToUtcDays(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''))
  if (!m) return null
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000)
}

// Días de calendario entre dos claves "YYYY-MM-DD" (b - a).
export function daysBetweenKeys(a, b) {
  const x = keyToUtcDays(a)
  const y = keyToUtcDays(b)
  return x === null || y === null ? null : y - x
}

/* timeAgo: el formato corto de Skool.
   'ahora' · '5 min' · '3 h' · '13 d' · (≥ 30 días) 'ago. 25' · (otro año) 'ago. 25, 2025' */
export function timeAgo(value, { now = Date.now(), tz = DEFAULT_TZ } = {}) {
  const date = toDate(value)
  if (!date) return ''
  const diffMin = Math.floor((now - date.getTime()) / 60000)
  if (diffMin < 1) return 'ahora'
  if (diffMin < 60) return `${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH} h`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 30) return `${diffD} d`
  const p = partsIn(date, tz)
  const nowP = partsIn(now, tz)
  const base = `${MONTHS_SHORT[p.m - 1]} ${p.d}`
  return p.y === nowP.y ? base : `${base}, ${p.y}`
}

/* timeAgoLong: para frases ("Activo hace 3 h", "Último comentario hace 2 d").
   'hace un momento' · 'hace 5 min' · 'hace 3 h' · 'hace 1 día' · 'hace 13 días'
   · (≥ 30 días) 'el ago. 25' / 'el ago. 25, 2025' */
export function timeAgoLong(value, { now = Date.now(), tz = DEFAULT_TZ } = {}) {
  const date = toDate(value)
  if (!date) return ''
  const diffMin = Math.floor((now - date.getTime()) / 60000)
  if (diffMin < 1) return 'hace un momento'
  if (diffMin < 60) return `hace ${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `hace ${diffH} h`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 30) return `hace ${diffD} ${diffD === 1 ? 'día' : 'días'}`
  return `el ${timeAgo(date, { now, tz })}`
}

/* fmtDate: 'may. 19, 2026' (formato de Skool: "Se unió el may. 19, 2026").
   { year: 'always'|'auto'|'never', long: true → '19 de mayo de 2026', weekday: true } */
export function fmtDate(value, { tz = DEFAULT_TZ, year = 'always', long = false, weekday = false, now = Date.now() } = {}) {
  const p = partsIn(value, tz)
  if (!p) return ''
  const showYear = year === 'always' || (year === 'auto' && p.y !== partsIn(now, tz).y)
  if (long) {
    const wd = weekday ? `${DAYS_LONG[p.dow - 1]} ` : ''
    return `${wd}${p.d} de ${MONTHS_LONG[p.m - 1]}${showYear ? ` de ${p.y}` : ''}`
  }
  const wd = weekday ? `${DAYS_SHORT[p.dow - 1]} ` : ''
  return `${wd}${MONTHS_SHORT[p.m - 1]} ${p.d}${showYear ? `, ${p.y}` : ''}`
}

/* fmtTime: '19:00' (24 h, lo normal en Chile) o '7:00 pm' con { h12: true }. */
export function fmtTime(value, { tz = DEFAULT_TZ, h12 = false } = {}) {
  const p = partsIn(value, tz)
  if (!p) return ''
  if (!h12) return `${pad(p.hh)}:${pad(p.mm)}`
  const h = p.hh % 12 === 0 ? 12 : p.hh % 12
  return `${h}:${pad(p.mm)} ${p.hh < 12 ? 'am' : 'pm'}`
}

/* fmtDateTime: 'sept. 30 · 19:00' — con { long: true }: 'martes 30 de septiembre · 19:00'. */
export function fmtDateTime(value, { tz = DEFAULT_TZ, long = false, year = 'auto', h12 = false, now = Date.now() } = {}) {
  const date = toDate(value)
  if (!date) return ''
  return `${fmtDate(date, { tz, long, weekday: long, year, now })} · ${fmtTime(date, { tz, h12 })}`
}

/* 'hora de Santiago' / 'hora de Buenos Aires' / 'hora UTC'. */
export function tzLabel(tz = DEFAULT_TZ) {
  const z = String(tz || DEFAULT_TZ)
  if (z === 'UTC' || z === 'Etc/UTC') return 'hora UTC'
  const city = z.split('/').pop().replace(/_/g, ' ')
  return `hora de ${city}`
}

/* 'hoy' · 'mañana' · 'en 3 días' · 'ayer' · 'hace 2 días' (por día de calendario en tz). */
export function relativeDay(value, { tz = DEFAULT_TZ, now = Date.now() } = {}) {
  const k = dateKey(value, tz)
  if (!k) return ''
  const diff = daysBetweenKeys(dateKey(now, tz), k)
  if (diff === 0) return 'hoy'
  if (diff === 1) return 'mañana'
  if (diff === -1) return 'ayer'
  return diff > 0 ? `en ${diff} días` : `hace ${-diff} días`
}

/* Duración de una lección: 754 → '12:34', 3723 → '1:02:03'. */
export function fmtDuration(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`
}

/* Cuenta regresiva de un bloqueo (429 retryAfter): 95 → '1:35'. */
export function fmtCountdown(sec) {
  return fmtDuration(Math.ceil(Math.max(0, Number(sec) || 0)))
}
