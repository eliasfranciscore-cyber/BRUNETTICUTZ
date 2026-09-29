/* ACADEMY — archivo .ics ("Agregar al calendario": Apple / Outlook)
   ------------------------------------------------------------------
   Se arma en el navegador (SPEC §5.5): no hace falta un endpoint ni gastar
   una consulta a Neon, el evento ya está en pantalla. Una ocurrencia por
   archivo — la que el miembro está mirando —, con la hora en UTC (sufijo Z)
   para que cada calendario la convierta a su zona sin ambigüedad de DST.

   RFC 5545: líneas CRLF, texto escapado (\ ; , y saltos de línea) y líneas
   plegadas a 75 octetos (UTF-8, no caracteres: "ñ" pesa 2). */

import { toDate } from './time.js'
import { ACADEMY_BRAND } from './hostConfig.js'

// Dominio del sitio para el UID ("pimpstudio.cl"), del siteUrl del host.
const UID_HOST = String(ACADEMY_BRAND.siteUrl || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '') || 'academy.local'

const pad = (n) => String(n).padStart(2, '0')

function stamp(date) {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
}

export function escapeIcsText(s) {
  return String(s ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null
const byteLen = (s) => (encoder ? encoder.encode(s).length : unescape(encodeURIComponent(s)).length)

function fold(line) {
  if (byteLen(line) <= 75) return line
  const out = []
  let cur = ''
  let limit = 75
  for (const ch of Array.from(line)) {
    if (byteLen(cur + ch) > limit) {
      out.push(cur)
      cur = ch
      limit = 74 // las líneas de continuación llevan un espacio al inicio
    } else {
      cur += ch
    }
  }
  if (cur) out.push(cur)
  return out.join('\r\n ')
}

const LOCATION_LABEL = { meet: 'Google Meet', zoom: 'Zoom', youtube: 'YouTube', direccion: '', enlace: '' }

/* buildIcs(event, { url }) → texto del .ics.
   event: { id, occurrenceStart (ISO), title, description, durationMin, locationType,
            locationInfo (null si está bloqueado), locked } */
export function buildIcs(event, { url } = {}) {
  const start = toDate(event?.occurrenceStart || event?.startsAt)
  if (!start) throw new Error('Evento sin fecha')
  const minutes = Math.max(1, Math.floor(Number(event?.durationMin) || 60))
  const end = new Date(start.getTime() + minutes * 60000)
  const uid = `aca-${event?.id ?? 'evento'}-${stamp(start)}@${UID_HOST}`

  const descParts = []
  if (event?.description) descParts.push(String(event.description))
  const loc = !event?.locked && event?.locationInfo ? String(event.locationInfo) : ''
  if (loc && event?.locationType && event.locationType !== 'direccion') {
    descParts.push(`${LOCATION_LABEL[event.locationType] || 'Enlace'}: ${loc}`.replace(/^: /, ''))
  }
  if (url) descParts.push(String(url))

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${ACADEMY_BRAND.siteName}//Academy//ES`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escapeIcsText(event?.title || `Evento de ${ACADEMY_BRAND.name}`)}`,
  ]
  if (descParts.length) lines.push(`DESCRIPTION:${escapeIcsText(descParts.join('\n\n'))}`)
  if (loc) lines.push(`LOCATION:${escapeIcsText(loc)}`)
  if (url) lines.push(`URL:${escapeIcsText(url)}`)
  lines.push(
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcsText(event?.title || 'Evento')}`,
    'TRIGGER:-PT1H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  )
  return lines.map(fold).join('\r\n') + '\r\n'
}

function fileName(event) {
  const base = String(event?.title || 'evento')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'evento'
  return `${base}.ics`
}

/* Descarga el .ics (Blob + <a download>). En iOS Safari abre la hoja
   "Agregar al calendario" directamente. */
export function downloadIcs(event, opts = {}) {
  const text = buildIcs(event, opts)
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' })
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = fileName(event)
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 10000)
}
