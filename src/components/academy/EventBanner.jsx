import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../academy/Icon.jsx'
import { useAcademy } from '../../academy/context.js'
import { useAcademyQuery } from '../../academy/useQuery.js'
import { academyApi } from '../../academy/api.js'
import { r } from '../../academy/routes.js'
import '../../styles/academy/comunidad.css'

/* ============================================================
   Aviso sobre el feed cuando hay un evento en los próximos 7 días, como el
   de Skool: "📅 Q&A con Bruno es en 2 días" / "… está en vivo ahora".
   Una sola lectura de `events` al montar (y al volver a la pestaña, por
   useAcademyQuery); el texto se recalcula cada minuto en el navegador, sin
   pedir nada al servidor. Si no hay evento, o la lectura falla, no se
   muestra nada: es un aviso, no contenido.
   Tocar el aviso lleva al Calendario con ?evento=<id>&o=<inicio>.
   ============================================================ */

const cx = (...p) => p.filter(Boolean).join(' ')
const DAY = 86400000

function dayKey(date, tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  } catch {
    return new Date(date).toISOString().slice(0, 10)
  }
}

function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number)
  const [y2, m2, d2] = b.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY)
}

function hhmm(date, tz) {
  try {
    return new Intl.DateTimeFormat('es-CL', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
  } catch {
    const d = new Date(date)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
}

export function eventWhen(ev, now, tz) {
  const start = new Date(ev.occurrenceStart).getTime()
  const end = start + (Number(ev.durationMin) || 60) * 60000
  if (now >= start && now < end) return { live: true, text: 'está en vivo ahora' }
  const mins = Math.max(0, Math.round((start - now) / 60000))
  if (mins < 60) return { live: false, text: mins <= 1 ? 'empieza en un minuto' : `es en ${mins} minutos` }
  const days = daysBetween(dayKey(new Date(now), tz), dayKey(new Date(start), tz))
  const at = hhmm(new Date(start), tz)
  if (days <= 0) {
    const h = Math.round(mins / 60)
    return { live: false, text: h <= 3 ? `es en ${h} ${h === 1 ? 'hora' : 'horas'}` : `es hoy a las ${at}` }
  }
  if (days === 1) return { live: false, text: `es mañana a las ${at}` }
  return { live: false, text: `es en ${days} días` }
}

export default function EventBanner() {
  const navigate = useNavigate()
  const { me, group, tz: ctxTz } = useAcademy()
  const tz = ctxTz || me?.prefs?.tz || 'America/Santiago'
  const off = group?.tabs && group.tabs.calendario === false
  const [now, setNow] = useState(() => Date.now())
  // La ventana se fija al montar: from = hoy, to = hoy + 7 (en la zona del miembro).
  const [range] = useState(() => {
    const t = Date.now()
    return { from: dayKey(new Date(t), tz), to: dayKey(new Date(t + 7 * DAY), tz) }
  })

  const q = useAcademyQuery(
    `events-banner:${range.from}:${range.to}:${tz}`,
    () => academyApi('events', { query: { from: range.from, to: range.to, tz } }),
    { deps: [range.from, range.to, tz], enabled: !off },
  )

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

  const next = useMemo(() => {
    const list = Array.isArray(q.data?.events) ? q.data.events : []
    const limit = now + 7 * DAY
    return list
      .map((ev) => ({ ev, start: new Date(ev.occurrenceStart).getTime() }))
      .filter(({ ev, start }) => Number.isFinite(start) && start + (Number(ev.durationMin) || 60) * 60000 > now && start <= limit)
      .sort((a, b) => a.start - b.start)[0]?.ev || null
  }, [q.data, now])

  if (off || !next) return null
  const when = eventWhen(next, now, tz)
  const go = () => navigate(`${r.path('/calendario')}?evento=${encodeURIComponent(next.id)}&o=${encodeURIComponent(next.occurrenceStart)}`)

  return (
    <button type="button" className={cx('aca-cm-evbanner', when.live && 'is-live')} onClick={go}>
      <span className="aca-cm-evbanner-icon" aria-hidden="true">
        {when.live ? <span className="aca-cm-live-dot" /> : '📅'}
      </span>
      <span className="aca-cm-evbanner-text">
        <b>{next.title}</b> {when.text}
      </span>
      <Icon name="chevronRight" size={16} />
    </button>
  )
}
