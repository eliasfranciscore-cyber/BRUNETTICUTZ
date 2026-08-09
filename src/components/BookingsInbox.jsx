import React, { useState, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './IconsExtra.jsx'
import { CLP, barberById, isoDate, buildWeek } from '../data.js'

/**
 * BookingsInbox — bandeja de reservas del Dashboard.
 *
 * Por fuera, cada tarjeta muestra sólo: resumen + acciones rápidas (hover) +
 * selector de estado + botón "Ver detalles". Al tocar la tarjeta se abre un
 * modal (responsive) con toda la gestión: acciones por estado, WhatsApp
 * (mensaje según estado), cancelar (con deshacer) y revertir la cancelación.
 *
 * Admin (Bruno) ve la agenda de TODOS y puede filtrar por barbero. Un barbero
 * normal ve sólo SU agenda del día.
 *
 * Props:
 *  bookings, barbers, barber, admin
 *  onStatus: (booking, nuevoEstado) => void   // persiste el cambio
 *  onReschedule?: (booking) => void           // abre la agenda para reagendar
 */

const STATUS_LABEL = { pendiente: 'Pendiente', confirmada: 'Confirmada', 'en curso': 'En curso', completada: 'Completada', cancelada: 'Cancelada' }
const STATUS_OPTIONS = ['pendiente', 'confirmada', 'en curso', 'completada', 'cancelada']
const FILTERS = ['Todas', 'Pendientes', 'Confirmadas', 'En curso', 'Completadas', 'Canceladas']
const FILTER_MAP = { Pendientes: 'pendiente', Confirmadas: 'confirmada', 'En curso': 'en curso', Completadas: 'completada', Canceladas: 'cancelada' }
// Etiqueta de filtro ↔ estado, para sincronizar las tarjetas KPI clickables.
const STATUS_TO_FILTER = { pendiente: 'Pendientes', confirmada: 'Confirmadas', 'en curso': 'En curso' }
// Próximo estado natural al avanzar una reserva con un solo tap (acción rápida).
const NEXT_STATUS = { pendiente: 'confirmada', confirmada: 'en curso', 'en curso': 'completada' }
const SCOPES = [['dia', 'Hoy'], ['semana', 'Semana'], ['todas', 'Todas']]

function waLink(bk, barberShort, status) {
  const first = (bk.client || 'Hola').split(' ')[0]
  const msgs = {
    confirmada: `Hola ${first}, te confirmamos tu hora en Brunetti el ${bk.date} a las ${bk.time} con ${barberShort}. ¡Te esperamos! 💈`,
    'en curso': `Hola ${first}, te esperamos en Brunetti, tu hora de las ${bk.time} con ${barberShort} está por comenzar.`,
    completada: `Hola ${first}, ¡gracias por tu visita a Brunetti! Esperamos que te haya gustado el resultado. Te esperamos pronto. 💈`,
    reagendar: `Hola ${first}, necesitamos reagendar tu hora del ${bk.date} (${bk.time}) en Brunetti. ¿Qué día te acomoda?`,
    cancelada: `Hola ${first}, lamentamos avisarte que tu hora del ${bk.date} a las ${bk.time} fue cancelada. Escríbenos para reagendar.`,
    default: `Hola ${first}, te escribimos de Brunetti por tu reserva del ${bk.date} a las ${bk.time}.`,
  }
  const phone = String(bk.phone || '').replace(/\D/g, '')
  return `https://wa.me/56${phone}?text=${encodeURIComponent(msgs[status] || msgs.default)}`
}

const resolveBarber = (bk, barbers) => barbers.find((x) => Number(x.id) === Number(bk.barberId)) || barberById(bk.barberId) || {}
const initialsOf = (name) => (name || 'C').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()

/* Tarjeta (o fila, en vista lista): resumen + acciones rápidas + selector + "Ver detalles". */
function ResCard({ bk, barbers, isAdmin, onOpen, onStatusSelect, onQuickAdvance, onQuickCancel }) {
  const barber = resolveBarber(bk, barbers)
  const short = barber?.short || barber?.name || 'Barbero'
  const cls = String(bk.status).replace(' ', '-')
  const waStatus = bk.status === 'cancelada' ? 'cancelada' : bk.status === 'pendiente' ? 'default' : bk.status
  const next = NEXT_STATUS[bk.status]
  const cancelable = bk.status !== 'cancelada' && bk.status !== 'completada'
  return (
    <div className={`psn-res-card ${cls}`}>
      <div
        className="psn-res-tap" role="button" tabIndex={0}
        onClick={() => onOpen(bk)}
        onKeyDown={(e) => { if (e.key === 'Enter') onOpen(bk) }}
        aria-label={`Ver detalles de ${bk.client}`}
      >
        <div className="psn-res-top">
          <span className="psn-res-time"><Icon name="clock" size={15} /> {bk.time} <small>{bk.date}</small></span>
          <span className={`psn-res-badge ${cls}`}>{STATUS_LABEL[bk.status] || bk.status}</span>
        </div>
        <div className="psn-res-client">
          <span className="psn-res-avatar">{initialsOf(bk.client)}</span>
          <div style={{ minWidth: 0 }}>
            <div className="nm">{bk.client}</div>
            <div className="psn-res-phone"><Icon name="phone" size={12} /> +56 {bk.phone || '—'}</div>
          </div>
        </div>
        <div className="psn-res-meta">
          <div className="psn-res-row"><span>Servicio</span><b>{bk.service}</b></div>
          {isAdmin && <div className="psn-res-row"><span>Barbero</span><b>{short}</b></div>}
          <div className="psn-res-row"><span>Total</span><b className="gold-text">{CLP(bk.price)}</b></div>
        </div>
      </div>
      <div className="psn-res-quick">
        {next && (() => {
          const label = bk.status === 'pendiente' ? 'Confirmar' : bk.status === 'confirmada' ? 'Iniciar atención' : 'Completar'
          return (
            <button type="button" className="qk-confirm" data-tip={label} aria-label={label} onClick={(e) => { e.stopPropagation(); onQuickAdvance(bk) }}>
              <Icon name="check" size={14} />
            </button>
          )
        })()}
        <a className="qk-wa" data-tip="Enviar WhatsApp" aria-label="Enviar WhatsApp" href={waLink(bk, short, waStatus)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
          <Icon name="whatsapp" size={14} />
        </a>
        {cancelable && (
          <button type="button" className="qk-cancel" data-tip="Cancelar reserva" aria-label="Cancelar reserva" onClick={(e) => { e.stopPropagation(); onQuickCancel(bk) }}>
            <Icon name="x" size={14} />
          </button>
        )}
      </div>
      <div className="psn-res-foot">
        <select
          className={`psn-res-status ${cls}`}
          value={bk.status}
          onChange={(e) => onStatusSelect(bk, e.target.value)}
          aria-label="Cambiar estado"
        >
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <button type="button" className="btn btn-dark btn-sm psn-res-detail" onClick={() => onOpen(bk)}>
          Ver detalles <Icon name="arrowRight" size={13} />
        </button>
      </div>
    </div>
  )
}

/* Modal de gestión de la reserva (responsive). */
function ResModal({ bk, barbers, isAdmin, onClose, onStatus, onReschedule, onCancel, onAskDelete, prevStatus }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  if (!bk) return null
  const barber = resolveBarber(bk, barbers)
  const short = barber?.short || barber?.name || 'Barbero'
  const cls = String(bk.status).replace(' ', '-')
  const waStatus = bk.status === 'cancelada' ? 'cancelada' : bk.status === 'pendiente' ? 'default' : bk.status
  return createPortal((
    <div className="psn-modal" role="dialog" aria-modal="true">
      <button className="psn-scrim" aria-label="Cerrar" onClick={onClose} />
      <div className="psn-modal-card psn-res-modal">
        <button className="psn-close" onClick={onClose} aria-label="Cerrar"><Icon name="close" size={17} /></button>
        <span className={`psn-res-badge ${cls}`}>{STATUS_LABEL[bk.status] || bk.status}</span>
        <h3 className="font-display">{bk.client}</h3>
        <p className="psn-role"><Icon name="clock" size={13} /> {bk.time} · {bk.date}</p>

        <div className="psn-res-meta psn-res-modal-meta">
          <div className="psn-res-row"><span>Servicio</span><b>{bk.service}</b></div>
          {isAdmin && <div className="psn-res-row"><span>Barbero</span><b>{short}</b></div>}
          <div className="psn-res-row"><span>Teléfono</span><b>+56 {bk.phone || '—'}</b></div>
          <div className="psn-res-row"><span>Total</span><b className="gold-text">{CLP(bk.price)}</b></div>
        </div>

        <div className="psn-actions">
          {bk.status === 'pendiente' && (
            <button className="btn btn-gold btn-block" onClick={() => onStatus(bk, 'confirmada')}><Icon name="check" size={16} /> Confirmar reserva</button>
          )}
          {bk.status === 'confirmada' && (
            <button className="btn btn-gold btn-block" onClick={() => onStatus(bk, 'en curso')}><Icon name="scissors" size={16} /> Iniciar atención</button>
          )}
          {bk.status === 'en curso' && (
            <button className="btn btn-gold btn-block" onClick={() => onStatus(bk, 'completada')}><Icon name="check" size={16} /> Completar</button>
          )}

          <a className="btn btn-wa btn-block" href={waLink(bk, short, waStatus)} target="_blank" rel="noopener noreferrer">
            <Icon name="whatsapp" size={16} /> Enviar WhatsApp
          </a>

          {(bk.status === 'pendiente' || bk.status === 'confirmada') && (
            <button className="btn btn-dark btn-block" onClick={() => { onReschedule && onReschedule(bk); onClose() }}>
              <Icon name="reschedule" size={16} /> Reagendar
            </button>
          )}

          {bk.status === 'cancelada' ? (
            <button className="btn btn-dark btn-block" onClick={() => onStatus(bk, prevStatus || 'pendiente')}>
              <Icon name="reschedule" size={16} /> Revertir cancelación
            </button>
          ) : bk.status !== 'completada' ? (
            <button className="btn btn-danger btn-block" onClick={() => { onCancel(bk); onClose() }}>
              <Icon name="x" size={16} /> Cancelar reserva
            </button>
          ) : null}

          <button className="btn btn-ghost btn-block psn-res-delete" onClick={() => onAskDelete(bk)}>
            <Icon name="trash" size={15} /> Eliminar reserva definitivamente
          </button>
        </div>
      </div>
    </div>
  ), document.body)
}

/* Popup de confirmación de eliminación definitiva (única acción irreversible: se mantiene el confirm). */
function ConfirmDelete({ bk, onClose, onConfirm }) {
  if (!bk) return null
  return createPortal((
    <div className="psn-modal psn-modal-top" role="alertdialog" aria-modal="true">
      <button className="psn-scrim" aria-label="Cerrar" onClick={onClose} />
      <div className="psn-modal-card psn-confirm">
        <span className="psn-confirm-ic"><Icon name="trash" size={22} /></span>
        <h3 className="font-display">¿Eliminar esta reserva?</h3>
        <p>Vas a borrar por completo la hora de <b>{bk.client}</b> ({bk.time} · {bk.date}). Esta acción no se puede deshacer.</p>
        <div className="psn-confirm-actions">
          <button className="btn btn-ghost btn-block" onClick={onClose}>Volver</button>
          <button className="btn btn-danger btn-block" onClick={() => onConfirm(bk)}><Icon name="trash" size={15} /> Sí, eliminar</button>
        </div>
      </div>
    </div>
  ), document.body)
}

/* Toast de deshacer (cancelación es reversible: feedback en vez de confirmación previa). */
function UndoToast({ toast, onUndo }) {
  if (!toast) return null
  return createPortal((
    <div className="psn-toast" role="status">
      <span>{toast.message}</span>
      <button type="button" onClick={onUndo}>Deshacer</button>
    </div>
  ), document.body)
}

/* Anillo de ocupación (donut SVG). */
function OccRing({ pct }) {
  const p = Math.max(0, Math.min(100, Math.round(pct)))
  const r = 18
  const c = 2 * Math.PI * r
  return (
    <svg className="psn-ring" viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">
      <circle cx="22" cy="22" r={r} className="psn-ring-bg" />
      <circle cx="22" cy="22" r={r} className="psn-ring-fg"
        strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)} transform="rotate(-90 22 22)" />
      <text x="22" y="22" className="psn-ring-txt" dominantBaseline="central" textAnchor="middle">{p}%</text>
    </svg>
  )
}

/* Modal calendario: 4 semanas con conteo de reservas por día. */
function CalendarModal({ onClose, countsByDay, selectedDay, todayKey, onPick }) {
  const weeks = [0, 1, 2, 3].map((o) => buildWeek(o))
  const dows = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
  return createPortal((
    <div className="psn-modal" role="dialog" aria-modal="true">
      <button className="psn-scrim" aria-label="Cerrar" onClick={onClose} />
      <div className="psn-modal-card psn-cal">
        <button className="psn-close" onClick={onClose} aria-label="Cerrar"><Icon name="close" size={17} /></button>
        <h3 className="font-display">Calendario de reservas</h3>
        <p className="psn-role">Toca un día para ver su agenda</p>
        <div className="psn-cal-head">{dows.map((d) => <span key={d}>{d}</span>)}</div>
        <div className="psn-cal-grid">
          {weeks.flat().map((d) => {
            const n = countsByDay[d.key] || 0
            const cls = [
              'psn-cal-day',
              d.key === selectedDay && 'is-sel',
              d.key === todayKey && 'is-today',
              n > 0 && 'has-res',
            ].filter(Boolean).join(' ')
            return (
              <button key={d.key} className={cls} onClick={() => onPick(d.key)}>
                <span className="psn-cal-num">{d.num}</span>
                {n > 0 && <span className="psn-cal-badge">{n}</span>}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  ), document.body)
}

export default function BookingsInbox({ bookings = [], barbers = [], barber, admin = false, slotsPerDay = 14, onStatus = () => {}, onDelete = () => {}, onReschedule, onNewBooking, focus }) {
  const [filter, setFilter] = useState('Todas')
  const [dateScope, setDateScope] = useState('dia')
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem('ps_res_view') === 'lista' ? 'lista' : 'cards' } catch { return 'cards' }
  })
  const [barberFilter, setBarberFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [detailId, setDetailId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [toast, setToast] = useState(null)
  const prevStatus = useRef({})
  const toastTimer = useRef(null)

  const [weekOffset, setWeekOffset] = useState(0)
  const [selectedDay, setSelectedDay] = useState(() => isoDate())
  const [calOpen, setCalOpen] = useState(false)
  const [slideKey, setSlideKey] = useState(0) // re-dispara animate-in al cambiar de día
  const touchX = useRef(null)

  useEffect(() => { try { localStorage.setItem('ps_res_view', viewMode) } catch {} }, [viewMode])
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const todayKey = isoDate()
  const idOf = (b) => b.id ?? `${b.barberId}-${b.time}`
  const multiBarber = barbers.length > 1
  const searching = query.trim().length > 0

  // Alcance base: admin ve a todos; barbero ve solo lo suyo (cualquier fecha,
  // para poder navegar por días). El recorte por día se hace más abajo.
  const mine = useMemo(() => (
    admin ? bookings : bookings.filter((b) => Number(b.barberId) === Number(barber?.id))
  ), [bookings, admin, barber])

  // Conteo de reservas activas por día (badges de la tira y el calendario).
  const countsByDay = useMemo(() => {
    const m = {}
    for (const b of mine) {
      if (b.status === 'cancelada' || !b.date) continue
      m[b.date] = (m[b.date] || 0) + 1
    }
    return m
  }, [mine])

  const weekDays = useMemo(() => buildWeek(weekOffset), [weekOffset])
  const weekKeys = useMemo(() => weekDays.map((d) => d.key), [weekDays])

  // Reservas del día seleccionado (con filtro de barbero en multi-barbero). Es
  // la base de los KPIs del hero, que siempre hablan del día, sin importar el
  // rango de fechas elegido para la lista de abajo.
  const dayBookings = useMemo(() => {
    let list = mine.filter((b) => b.date === selectedDay)
    if (admin && multiBarber && barberFilter !== 'all') list = list.filter((b) => Number(b.barberId) === Number(barberFilter))
    return list
  }, [mine, selectedDay, admin, multiBarber, barberFilter])

  // Rango de fechas rápido (Hoy / Semana / Todas) para la LISTA de reservas
  // (independiente del día del hero). Con filtro de barbero aplicado.
  const scopeList = useMemo(() => {
    let list = mine
    if (dateScope === 'dia') list = list.filter((b) => b.date === selectedDay)
    else if (dateScope === 'semana') list = list.filter((b) => weekKeys.includes(b.date))
    if (admin && multiBarber && barberFilter !== 'all') list = list.filter((b) => Number(b.barberId) === Number(barberFilter))
    return list
  }, [mine, dateScope, selectedDay, weekKeys, admin, multiBarber, barberFilter])

  const scopeCount = (st) => scopeList.filter((b) => b.status === st).length

  // Lista visible: búsqueda global (todas las fechas) o el rango elegido.
  const visible = useMemo(() => {
    if (searching) {
      const q = query.toLowerCase()
      let list = mine.filter((b) => `${b.client || ''} ${b.phone || ''} ${b.service || ''}`.toLowerCase().includes(q))
      if (admin && multiBarber && barberFilter !== 'all') list = list.filter((b) => Number(b.barberId) === Number(barberFilter))
      return [...list].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
    }
    let list = scopeList
    if (filter !== 'Todas') list = list.filter((b) => b.status === FILTER_MAP[filter])
    else list = list.filter((b) => b.status !== 'cancelada')
    return [...list].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
  }, [searching, query, mine, scopeList, filter, admin, multiBarber, barberFilter])

  // KPIs del día (hero).
  const count = (st) => dayBookings.filter((b) => b.status === st).length
  const activeCount = dayBookings.filter((b) => b.status !== 'cancelada').length
  const dayTotal = dayBookings.filter((b) => b.status !== 'cancelada').reduce((s, b) => s + Number(b.price || 0), 0)
  const occPct = slotsPerDay ? (activeCount / slotsPerDay) * 100 : 0

  // Próxima cita: primera no cancelada/completada; si es hoy, la primera cuya hora no pasó.
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const isToday = selectedDay === todayKey
  const nextAppt = useMemo(() => {
    const pool = dayBookings
      .filter((b) => b.status !== 'cancelada' && b.status !== 'completada')
      .sort((a, b) => String(a.time).localeCompare(String(b.time)))
    if (!isToday) return pool[0] || null
    return pool.find((b) => {
      const [h, m] = String(b.time).split(':').map(Number)
      return (h * 60 + m) >= nowMin
    }) || null
  }, [dayBookings, isToday, nowMin])
  const nextEta = (() => {
    if (!nextAppt || !isToday) return ''
    const [h, m] = String(nextAppt.time).split(':').map(Number)
    const diff = (h * 60 + m) - nowMin
    if (diff <= 0) return 'ahora'
    return diff >= 60 ? `en ${Math.floor(diff / 60)}h ${diff % 60}m` : `en ${diff}m`
  })()

  // KPIs de la semana visible.
  const weekCount = weekKeys.reduce((s, k) => s + (countsByDay[k] || 0), 0)
  const weekRevenue = mine
    .filter((b) => b.status !== 'cancelada' && weekKeys.includes(b.date))
    .reduce((s, b) => s + Number(b.price || 0), 0)

  // La reserva del modal se resuelve en vivo desde props para reflejar cambios.
  const detailBk = detailId != null ? bookings.find((b) => idOf(b) === detailId) || null : null

  // --- Navegación de días -------------------------------------------------
  const selectDay = (key) => { setSelectedDay(key); setSlideKey((k) => k + 1); setDateScope('dia') }
  const goToWeek = (offset) => {
    setWeekOffset(offset)
    const wd = buildWeek(offset)
    if (!wd.some((d) => d.key === selectedDay)) selectDay(wd[0].key)
  }
  const shiftDay = (delta) => {
    const d = new Date(`${selectedDay}T00:00:00`)
    d.setDate(d.getDate() + delta)
    const key = isoDate(d)
    selectDay(key)
    if (!weekDays.some((x) => x.key === key)) setWeekOffset((o) => o + (delta > 0 ? 1 : -1))
  }
  const pickFromCalendar = (key) => {
    selectDay(key)
    setCalOpen(false)
    for (const o of [-1, 0, 1, 2, 3, 4]) {
      if (buildWeek(o).some((d) => d.key === key)) { setWeekOffset(o); break }
    }
  }

  // Foco externo (desde la búsqueda global): salta a una fecha ARBITRARIA.
  // pickFromCalendar sólo escanea −1..+4 semanas, así que aquí calculamos el
  // weekOffset real por diferencia de lunes. `ts` re-dispara focos repetidos.
  useEffect(() => {
    if (!focus?.day) return
    const mondayOf = (iso) => {
      const d = new Date(`${iso}T00:00:00`)
      const dow = d.getDay() || 7
      d.setDate(d.getDate() - dow + 1)
      d.setHours(0, 0, 0, 0)
      return d
    }
    const diffWeeks = Math.round((mondayOf(focus.day) - mondayOf(isoDate())) / (7 * 86400000))
    setWeekOffset(diffWeeks)
    setSelectedDay(focus.day)
    setDateScope(focus.scope || 'dia')
    if (focus.filter) setFilter(focus.filter)
    setSlideKey((k) => k + 1)
    setQuery('')
    // Deep-link a una reserva puntual (notificación push / popup de campana):
    // abre directo su modal de detalle, además de ubicar el día/filtro.
    if (focus.bookingId != null) setDetailId(Number(focus.bookingId))
  }, [focus?.day, focus?.ts])

  // --- Swipe (móvil): cambia de día ---------------------------------------
  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX }
  const onTouchEnd = (e) => {
    if (searching || touchX.current == null) return
    const dx = e.changedTouches[0].clientX - touchX.current
    touchX.current = null
    if (Math.abs(dx) > 50) shiftDay(dx < 0 ? 1 : -1)
  }

  // Estado ↔ filtro (tarjetas KPI clickables).
  const toggleStatusFilter = (status) => {
    const f = STATUS_TO_FILTER[status]
    setFilter((cur) => (cur === f ? 'Todas' : f))
    setQuery('')
  }

  // Cancelación: reversible → feedback con deshacer, sin diálogo de confirmación previo.
  const cancelWithUndo = (bk) => {
    const prev = bk.status === 'cancelada' ? 'pendiente' : bk.status
    prevStatus.current[idOf(bk)] = prev
    onStatus(bk, 'cancelada')
    clearTimeout(toastTimer.current)
    setToast({ id: idOf(bk), prev, message: `Reserva de ${bk.client} cancelada` })
    toastTimer.current = setTimeout(() => setToast(null), 8000)
  }
  const undoToast = () => {
    if (!toast) return
    const bk = bookings.find((b) => idOf(b) === toast.id)
    if (bk) onStatus(bk, toast.prev)
    clearTimeout(toastTimer.current)
    setToast(null)
  }
  const onStatusSelect = (bk, value) => {
    if (value === bk.status) return
    if (value === 'cancelada') { cancelWithUndo(bk); return }
    onStatus(bk, value)
  }
  const onQuickAdvance = (bk) => { const next = NEXT_STATUS[bk.status]; if (next) onStatus(bk, next) }
  const confirmDelete = (bk) => {
    onDelete(bk)
    setDeleteTarget(null)
    if (detailId != null && idOf(bk) === detailId) setDetailId(null)
  }

  const DOW_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
  const selLabel = weekDays.find((d) => d.key === selectedDay)?.label
    || (() => { const d = new Date(`${selectedDay}T00:00:00`); return `${DOW_SHORT[d.getDay()]} ${d.getDate()}` })()

  const scopeLabel = dateScope === 'semana' ? 'la semana' : dateScope === 'todas' ? 'todas las fechas' : null

  return (
    <div className="animate-in psn-inbox">
      <div className="psn-mod-head">
        <div>
          <h2 className="font-display">Reservas recibidas</h2>
          <p>{admin ? (multiBarber ? 'Vista administrador · agenda de todos' : 'Agenda de Brunetti') : `Tu agenda · ${barber?.name || 'Barbero'}`}</p>
        </div>
        <span className="chip chip-gold"><Icon name="bell" size={13} /> {count('pendiente')} por confirmar</span>
      </div>

      {/* HERO de KPIs (siempre habla del día seleccionado) */}
      <div className="psn-hero">
        <div className="psn-hk psn-hk-next">
          <span className="psn-hk-lbl"><Icon name="clock" size={12} /> Próxima cita {isToday ? '· hoy' : `· ${selLabel}`}</span>
          {nextAppt ? (
            <>
              <b className="psn-hk-time">{nextAppt.time}{nextEta && <em>{nextEta}</em>}</b>
              <span className="psn-hk-sub">{nextAppt.client} · {nextAppt.service}</span>
            </>
          ) : <span className="psn-hk-empty">Sin próximas citas</span>}
        </div>

        <div className="psn-hk psn-hk-occ">
          <OccRing pct={occPct} />
          <div><b>{activeCount}/{slotsPerDay}</b><span>Ocupación del día</span></div>
        </div>

        <button type="button" className={`psn-hk psn-hk-state pendiente ${filter === 'Pendientes' ? 'is-on' : ''}`} onClick={() => toggleStatusFilter('pendiente')}>
          <b>{count('pendiente')}</b><span>Pendientes</span>
        </button>
        <button type="button" className={`psn-hk psn-hk-state confirmada ${filter === 'Confirmadas' ? 'is-on' : ''}`} onClick={() => toggleStatusFilter('confirmada')}>
          <b>{count('confirmada')}</b><span>Confirmadas</span>
        </button>
        <button type="button" className={`psn-hk psn-hk-state en-curso ${filter === 'En curso' ? 'is-on' : ''}`} onClick={() => toggleStatusFilter('en curso')}>
          <b>{count('en curso')}</b><span>En curso</span>
        </button>

        <div className="psn-hk psn-hk-total">
          <b className="gold-text">{CLP(dayTotal)}</b><span>Total del día</span>
        </div>
      </div>

      {/* VISOR DE SEMANA (oculto durante la búsqueda global) */}
      {!searching && <div className="psn-week">
        <div className="psn-week-head">
          <div className="psn-seg" role="group" aria-label="Rango de fechas">
            {SCOPES.map(([key, label]) => (
              <button key={key} type="button" className={dateScope === key ? 'is-on' : ''} onClick={() => setDateScope(key)}>{label}</button>
            ))}
          </div>
          {dateScope !== 'todas' && (
            <div className="psn-week-toggle">
              <button type="button" className={`btn btn-sm ${weekOffset === 0 ? 'btn-gold' : 'btn-dark'}`} onClick={() => goToWeek(0)}>Esta semana</button>
              <button type="button" className={`btn btn-sm ${weekOffset === 1 ? 'btn-gold' : 'btn-dark'}`} onClick={() => goToWeek(1)}>Siguiente</button>
              <button type="button" className="btn btn-dark btn-sm" onClick={() => setCalOpen(true)}><Icon name="calendar" size={13} /> Calendario</button>
            </div>
          )}
          <span className="psn-week-sum">{weekCount} reservas esta semana · <b className="gold-text">{CLP(weekRevenue)}</b></span>
        </div>
        {dateScope !== 'todas' && <div className="daypick" role="group" aria-label="Día de la semana">
          {weekDays.map((d) => {
            const n = countsByDay[d.key] || 0
            const isActive = d.key === selectedDay && dateScope === 'dia'
            const isTdy = d.key === todayKey
            return (
              <button key={d.key} type="button" className={`daypick-btn ${isActive ? 'is-active' : ''} ${isTdy ? 'is-today' : ''}`} aria-pressed={isActive} onClick={() => selectDay(d.key)}>
                <span className="dp-dow">{isTdy ? 'Hoy' : d.dow}</span>
                <span className="dp-num">{d.num}</span>
                <span className="dp-ind">{n > 0 && <span className="dp-count">{n}</span>}</span>
              </button>
            )
          })}
        </div>}
      </div>}

      {/* TOOLBAR */}
      <div className="psn-inbox-toolbar">
        <div className="psn-status-seg" role="group" aria-label="Filtrar por estado">
          {FILTERS.map((f) => {
            const n = f === 'Todas' ? scopeList.filter((b) => b.status !== 'cancelada').length : scopeCount(FILTER_MAP[f])
            return (
              <button key={f} type="button" className={filter === f && !searching ? 'is-on' : ''} onClick={() => { setFilter(f); setQuery('') }}>
                {f}<span className="psn-seg-count">{n}</span>
              </button>
            )
          })}
        </div>
        {admin && multiBarber && (
          <select className="psn-barber-filter" value={barberFilter} onChange={(e) => setBarberFilter(e.target.value)}>
            <option value="all">Todos los barberos</option>
            {barbers.filter((b) => b.active !== false).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <div className="psn-inbox-search">
          <Icon name="user" size={15} />
          <input placeholder="Buscar en todas las fechas" value={query} onChange={(e) => setQuery(e.target.value)} />
          {searching && <button type="button" className="psn-search-clear" onClick={() => setQuery('')} aria-label="Limpiar"><Icon name="close" size={13} /></button>}
        </div>
        <div className="psn-view-toggle" role="group" aria-label="Vista">
          <button type="button" className={viewMode === 'cards' ? 'is-on' : ''} onClick={() => setViewMode('cards')} data-tip="Vista tarjetas" aria-label="Vista tarjetas"><Icon name="grid" size={15} /></button>
          <button type="button" className={viewMode === 'lista' ? 'is-on' : ''} onClick={() => setViewMode('lista')} data-tip="Vista lista" aria-label="Vista lista"><Icon name="list" size={15} /></button>
        </div>
        {onNewBooking && (
          <button type="button" className="btn btn-gold btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem' }} onClick={onNewBooking}>
            <Icon name="calendar" size={14} /> Nueva reserva
          </button>
        )}
      </div>

      {searching && <p className="psn-search-note"><Icon name="user" size={12} /> {visible.length} resultado{visible.length === 1 ? '' : 's'} en todas las fechas</p>}
      {!searching && scopeLabel && <p className="psn-search-note"><Icon name="calendar" size={12} /> Mostrando reservas de {scopeLabel}</p>}

      {visible.length ? (
        <div key={slideKey} className={`psn-inbox-grid animate-in ${viewMode === 'lista' ? 'is-list' : ''}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {visible.map((bk) => (
            <ResCard
              key={idOf(bk)} bk={bk} barbers={barbers} isAdmin={admin && multiBarber}
              onOpen={(b) => setDetailId(idOf(b))} onStatusSelect={onStatusSelect}
              onQuickAdvance={onQuickAdvance} onQuickCancel={cancelWithUndo}
            />
          ))}
        </div>
      ) : (
        <div className="card psn-empty" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--muted)', display: 'grid', gap: '.9rem', justifyItems: 'center' }}>
          <span>{searching ? 'Sin resultados para tu búsqueda.' : `Sin reservas para ${isToday && dateScope === 'dia' ? 'hoy' : scopeLabel || selLabel}.`}</span>
          {!searching && onNewBooking && (
            <button type="button" className="btn btn-gold btn-sm" onClick={onNewBooking}>
              <Icon name="calendar" size={14} /> Nueva reserva
            </button>
          )}
        </div>
      )}

      {calOpen && (
        <CalendarModal onClose={() => setCalOpen(false)} countsByDay={countsByDay} selectedDay={selectedDay} todayKey={todayKey} onPick={pickFromCalendar} />
      )}

      {detailBk && (
        <ResModal
          bk={detailBk}
          barbers={barbers}
          isAdmin={admin && multiBarber}
          onClose={() => setDetailId(null)}
          onStatus={onStatus}
          onReschedule={onReschedule}
          onCancel={cancelWithUndo}
          onAskDelete={(b) => setDeleteTarget(b)}
          prevStatus={prevStatus.current[idOf(detailBk)]}
        />
      )}

      {deleteTarget && (
        <ConfirmDelete bk={deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={confirmDelete} />
      )}

      <UndoToast toast={toast} onUndo={undoToast} />
    </div>
  )
}
