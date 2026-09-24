import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from './ui.jsx'
import { CLP, CLPk, barberById, bookingUid, fmtDate, santiagoDateKey } from '../data.js'
import { CountUp, Sparkline, Donut, AnimatedRing } from './DashKit.jsx'
import { waLinkForBooking } from '../whatsapp.js'
import { FEATURES } from '../features.js'
import {
  Card, List, ListRow, Time, Kpi, Segmented, Button, IconButton, Chip,
  StatusBadge, Avatar, EmptyState, ProgressBar, useIsPhone,
} from './panel/index.js'
import { SinCerrarNotice } from '../pages/panel/SinCerrar.jsx'
import '../styles/panel/resumen.css'

/**
 * DashboardResumen — pantalla de inicio del panel de Brunetti.
 *
 * Un segmentado "Hoy | Tendencias" separa lo accionable de hoy (la próxima
 * cita con su botón de Iniciar/Cobrar, los KPI del día y la lista de
 * reservas) de las métricas de tendencia (ingresos, ventas de la semana,
 * gastos, servicios, ocupación, horas pico y reseñas). En escritorio las dos
 * vistas van lado a lado (`.pn-cols--2` de panel.css) y el segmentado se
 * oculta; en el celular y la tablet alterna entre una y otra.
 *
 * Acá hay un solo barbero (Bruno), así que no hay línea de alcance ni
 * rótulos de barbero en las filas: el margen es siempre el del local, y suma
 * las ventas online (Cursos, Workshop y Essentials por Mercado Pago) y los
 * ingresos manuales del mes.
 *
 * Todas las métricas se calculan en vivo desde los datos reales del negocio,
 * sin cifras de ejemplo.
 *
 * Props: bookings, barbers, expenses, clients, todaySlots, walletStats,
 * onNewBooking, onGoToPending, onGoToMarketing, y `ctx` (el objeto `dash` de
 * Dashboard.jsx: la sesión y las acciones que abren las hojas compartidas —
 * la hoja de cobro vía updateBookingStatus, el detalle vía setDetail).
 */

const cx = (...parts) => parts.filter(Boolean).join(' ')

// Horas de atención fijas (ver ALL_SLOTS en data.js) — siempre se muestran
// las 11, aunque alguna nunca haya tenido reservas, para que el gráfico
// refleje la jornada completa y no solo las horas con historial.
const BUSINESS_HOURS = ['9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19']
// Lun→Dom en vez del orden nativo de Date#getDay() (0=Dom), para leer la
// semana como la vive el negocio.
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]
const DOW_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
// Paleta de categorías de gasto: rampa dorada que sigue al tema (los tokens
// --pn-* cambian solos entre claro y oscuro). La de antes era hex fijo
// (#c9a14e, #e6cd90…), pensada para fondo negro: sobre el crema del modo
// claro los dos dorados pálidos casi no se veían.
const CAT_COLORS = [
  'var(--pn-accent)',
  'color-mix(in srgb, var(--pn-accent) 55%, var(--pn-card))',
  'var(--pn-text)',
  'var(--pn-text-3)',
  'color-mix(in srgb, var(--pn-text) 30%, var(--pn-card))',
]

function getSvcIconByName(name) {
  const n = (name || '').toLowerCase()
  if (n.includes('asesor') || n.includes('visag') || n.includes('imagen')) return 'user'
  if (n.includes('quim') || n.includes('color') || n.includes('platin')) return 'spark'
  if (n.includes('fade') || n.includes('degra')) return 'trend'
  return 'scissors'
}

// Componentes locales, no UTC (ver Dashboard.jsx isoDate): en Chile
// toISOString() adelanta la fecha durante la noche.
function localDateKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

// Lunes de la semana de `date` (semana Lun→Dom, como la vive el negocio).
function mondayOf(date) {
  const d = new Date(date)
  const dow = d.getDay() // 0=Dom..6=Sáb
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow))
  d.setHours(0, 0, 0, 0)
  return d
}

const minutesOf = (time) => {
  const [h, m] = String(time || '').split(':').map(Number)
  return Number.isFinite(h) ? h * 60 + (m || 0) : null
}

/* Barra vertical simple (ingresos por día, horas/días pico): un solo
   componente reutilizado con `compact` para la versión chica de a par. La
   barra más alta (`peak`) va con el degradado dorado; el resto, en un dorado
   apagado que sigue al tema (ver resumen.css). */
function BarChart({ data, compact, valueFmt = CLPk, unit }) {
  const max = Math.max(1, ...data.map((d) => d.v))
  return (
    <div className={cx('pn-resumen-bars', compact && 'is-compact')}>
      {data.map((d, i) => (
        <div key={`${d.k ?? d.d}-${i}`} className={cx('pn-resumen-bars-col', d.peak && 'is-peak')}>
          <div className="pn-resumen-bars-track">
            <div
              className="pn-resumen-bars-fill"
              style={{ height: `${(d.v / max) * 100}%` }}
              title={unit ? `${d.full ?? d.lbl ?? d.d}: ${d.v} ${d.v === 1 ? unit[0] : unit[1]}` : CLP(d.v)}
            />
          </div>
          {/* Un día con atenciones a $0 (cortesía o canje) dice "$0", no
              "$0k"; y el rótulo nunca queda vacío, que corría el riel. */}
          {!compact && <span className="pn-resumen-bars-val">{d.v ? valueFmt(d.v) : '$0'}</span>}
          <span className="pn-resumen-bars-lbl">{d.lbl ?? d.d}</span>
        </div>
      ))}
    </div>
  )
}

function TopServiceBars({ bookings = [] }) {
  const live = useMemo(() => {
    const valid = bookings.filter((b) => b.status === 'completada')
    if (!valid.length) return []
    const map = {}
    valid.forEach((b) => { const k = b.service || 'Servicio'; map[k] = map[k] || { name: k, count: 0, rev: 0 }; map[k].count++; map[k].rev += Number(b.paidAmount ?? b.price ?? 0) })
    return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 5)
  }, [bookings])
  if (!live.length) return <EmptyState compact icon="scissors" title="Sin servicios completados todavía" />
  const maxC = Math.max(1, ...live.map((s) => s.count))
  return (
    <div className="pn-resumen-topsvc">
      {live.map((s) => (
        <div key={s.name} className="pn-resumen-topsvc-row">
          <span className="pn-resumen-topsvc-icon"><Icon name={getSvcIconByName(s.name)} size={14} /></span>
          <span className="pn-resumen-topsvc-bar">
            <span className="pn-resumen-topsvc-name">{s.name}</span>
            <span className="pn-resumen-topsvc-track"><span className="pn-resumen-topsvc-fill" style={{ width: `${(s.count / maxC) * 100}%` }} /></span>
          </span>
          <span className="pn-resumen-topsvc-count"><b>{s.count}</b><small>{CLPk(s.rev)}</small></span>
        </div>
      ))}
    </div>
  )
}

/* Recibe `bookings` ya acotado a una ventana reciente (ver `recentBookings`)
   y siempre dibuja las 11 horas y los 7 días de la semana, con 0 donde no hay
   datos. */
function PeakHours({ bookings = [] }) {
  const valid = useMemo(() => bookings.filter((b) => b.status !== 'cancelada' && b.time && b.date), [bookings])
  const hourData = useMemo(() => {
    const map = {}
    valid.forEach((b) => { const h = String(b.time).slice(0, 2).replace(/^0/, ''); map[h] = (map[h] || 0) + 1 })
    // Las 11 barras siempre se dibujan (ver BUSINESS_HOURS), cada una con su
    // hora. Para que "9h10h11h…" no se pise, los dos gráficos se apilan (uno
    // debajo del otro, a lo ancho de la tarjeta) cuando la tarjeta es angosta:
    // en el celular y en la media pantalla del escritorio (container query en
    // resumen.css). Antes se rotulaba 1 hora de cada 2 y, lado a lado a
    // 1280px, igual se cortaban "13h", "15h"…
    return BUSINESS_HOURS.map((h) => ({ k: h, lbl: `${h}h`, full: `${h}:00`, v: map[h] || 0 }))
  }, [valid])
  const peakHour = hourData.reduce((p, d) => (d.v > (p?.v ?? 0) ? d : p), null)
  const dowData = useMemo(() => {
    const map = {}
    valid.forEach((b) => { const dow = new Date(`${b.date}T00:00:00`).getDay(); map[dow] = (map[dow] || 0) + 1 })
    return DOW_ORDER.map((dow) => ({ k: dow, lbl: DOW_SHORT[dow], v: map[dow] || 0 }))
  }, [valid])
  const peakDow = dowData.reduce((p, d) => (d.v > (p?.v ?? 0) ? d : p), null)

  if (!valid.length) return <EmptyState compact icon="clock" title="Sin reservas para analizar todavía" text="Se necesitan reservas de los últimos 30 días." />

  const unit = ['reserva', 'reservas']
  return (
    <div className="pn-resumen-peakwrap">
      <div className="pn-resumen-peak-split">
        <div>
          <BarChart compact unit={unit} data={hourData.map((d) => ({ ...d, peak: d.k === peakHour?.k }))} />
          {peakHour && (
            <p className="pn-resumen-peak-note">
              <Icon name="trend" size={12} />
              <span>Hora pico: <b>{peakHour.k}:00</b> · {peakHour.v} reserva{peakHour.v === 1 ? '' : 's'}</span>
            </p>
          )}
        </div>
        <div>
          <BarChart compact unit={unit} data={dowData.map((d) => ({ ...d, peak: d.k === peakDow?.k }))} />
          {peakDow && (
            <p className="pn-resumen-peak-note">
              <Icon name="calendar" size={12} />
              <span>Día pico: <b>{peakDow.lbl}</b> · {peakDow.v} reserva{peakDow.v === 1 ? '' : 's'}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/* Reseñas de clientes. Salen de GET /api/barbers?mode=reviews (ver
   api/barbers.js), que llegan solas por correo después de cada visita (el
   link lleva a /resena). Todo viene defendido: si la respuesta no trae
   `summary` (una base sin la tabla, un modo que el servidor todavía no
   conoce), la tarjeta no se dibuja en vez de reventar el Resumen. */
function ReviewsCard({ data }) {
  const summary = data?.summary || {}
  const reviews = Array.isArray(data?.reviews) ? data.reviews : []
  const count = Number(summary.count) || 0
  const dist = [1, 2, 3, 4, 5].reduce((acc, n) => ({ ...acc, [n]: Number(summary.distribution?.[n]) || 0 }), {})
  if (!count) {
    return (
      <Card title="Reseñas de clientes">
        <EmptyState compact icon="star" title="Todavía no hay reseñas" text="Llegan solas por correo después de cada visita." />
      </Card>
    )
  }
  const distTotal = Object.values(dist).reduce((s, v) => s + v, 0)
  const rated = reviews.map((r) => Number(r.rating)).filter((n) => n >= 1 && n <= 5)
  const avg = Number.isFinite(Number(summary.avg)) && summary.avg != null
    ? Number(summary.avg)
    : distTotal
      ? [1, 2, 3, 4, 5].reduce((s, n) => s + n * dist[n], 0) / distTotal
      : (rated.length ? rated.reduce((s, n) => s + n, 0) / rated.length : 0)
  const maxDist = Math.max(1, ...Object.values(dist))
  const rounded = Math.round(avg)
  return (
    <Card title="Reseñas de clientes" subtitle={`${avg.toFixed(1)} de 5 · ${count} reseña${count === 1 ? '' : 's'}`}>
      <div className="pn-resumen-reviews">
        <div className="pn-resumen-reviews-summary">
          <div className="pn-resumen-reviews-stars" role="img" aria-label={`${avg.toFixed(1)} de 5 estrellas`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Icon key={n} name="star" size={16} color={n <= rounded ? 'var(--pn-accent)' : 'var(--pn-text-3)'} style={n <= rounded ? { fill: 'var(--pn-accent)' } : undefined} />
            ))}
          </div>
          <div className="pn-resumen-reviews-dist">
            {[5, 4, 3, 2, 1].map((n) => (
              <div key={n} className="pn-resumen-reviews-distrow">
                <span>{n}<Icon name="star" size={10} /></span>
                <ProgressBar value={dist[n]} max={maxDist} color="var(--pn-accent)" label={`${dist[n]} de ${n} estrella${n === 1 ? '' : 's'}`} />
                <span className="pn-muted">{dist[n]}</span>
              </div>
            ))}
          </div>
        </div>
        {reviews.length > 0 && (
          <List className="pn-resumen-reviews-list">
            {reviews.slice(0, 3).map((r, i) => (
              <ListRow
                key={r.id ?? i}
                title={r.client || 'Cliente'}
                subtitle={r.comment || (r.service ? `${r.service} · sin comentario` : 'Sin comentario')}
                subtitleWrap
                meta={(r.date || r.ratedAt) ? fmtDate(String(r.date || r.ratedAt).slice(0, 10), 'dm') : undefined}
                trailing={<Chip tone="accent" icon="star">{r.rating}</Chip>}
              />
            ))}
          </List>
        )}
      </div>
    </Card>
  )
}

export default function DashboardResumen({
  bookings = [], barbers = [], expenses = [], clients = [], todaySlots = [], walletStats = null,
  onNewBooking, onGoToPending, onGoToMarketing, ctx = {},
}) {
  const {
    authHeaders, updateBookingStatus, setDetail, setTab, barber, myPhoto, canCharge,
    admin, has, pushToast, goToDayInReservas, onlineMonthTotal, onlineOrders,
  } = ctx
  const isPhone = useIsPhone()
  const [view, setView] = useState('hoy')
  const [advancing, setAdvancing] = useState(false)
  const [reviews, setReviews] = useState(null)
  // "Ahora" y el "en 12m" dependen de la hora: sin este tic, con el panel
  // abierto la próxima cita se quedaba pegada en la de hace media hora.
  const [, setMinuteTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setMinuteTick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!FEATURES.reviews) return undefined
    let alive = true
    fetch('/api/barbers?mode=reviews', { headers: authHeaders ? authHeaders() : {} })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      // Sin `summary` no hay nada que dibujar: la tarjeta queda fuera en vez
      // de reventar al leer `summary.count` de undefined.
      .then((data) => { if (alive) setReviews(data?.ok && data.summary ? data : null) })
      .catch(() => { if (alive) setReviews(null) })
    return () => { alive = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const todayKey = localDateKey(new Date())
  const monthKey = todayKey.slice(0, 7)
  const today = useMemo(() => bookings.filter((b) => !b.date || b.date === todayKey).sort((a, b) => String(a.time).localeCompare(String(b.time))), [bookings, todayKey])

  /* Ingreso = reserva COMPLETADA, por lo que realmente se cobró (`paidAmount`;
     el precio cubre las completadas de antes del cobro con medio de pago).
     Misma definición que Finanzas y Caja. */
  const collectedOf = (b) => Number(b.paidAmount ?? b.price ?? 0)
  const dayValid = today.filter((b) => b.status === 'completada')
  const revenueDay = dayValid.reduce((s, b) => s + collectedOf(b), 0)
  const avgTicket = dayValid.length ? Math.round(revenueDay / dayValid.length) : 0
  const activeTodayCount = today.filter((b) => b.status !== 'cancelada').length

  // Ventana móvil de 30 días para métricas de "patrón" (cancelación, horas/
  // días pico) — no se acumulan para siempre sesgadas al historial viejo.
  const last30Key = useMemo(() => localDateKey(addDays(new Date(), -30)), [todayKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const recentBookings = useMemo(() => bookings.filter((b) => b.date && b.date >= last30Key), [bookings, last30Key])
  const cancelRatePct = recentBookings.length
    ? Math.round((recentBookings.filter((b) => b.status === 'cancelada').length / recentBookings.length) * 100)
    : 0

  // Semana actual (Lun→Dom) vs semana anterior, para el chip de tendencia.
  const weekStart = useMemo(() => mondayOf(new Date()), [todayKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const weekKeys = useMemo(() => Array.from({ length: 7 }, (_, i) => localDateKey(addDays(weekStart, i))), [weekStart])
  const lastWeekKeys = useMemo(() => Array.from({ length: 7 }, (_, i) => localDateKey(addDays(weekStart, i - 7))), [weekStart])
  const weekBookings = useMemo(() => bookings.filter((b) => b.status === 'completada' && weekKeys.includes(b.date)), [bookings, weekKeys])
  const weekRevenue = weekBookings.reduce((s, b) => s + collectedOf(b), 0)
  const weekCount = weekBookings.length
  const lastWeekRevenue = useMemo(() => bookings
    .filter((b) => b.status === 'completada' && lastWeekKeys.includes(b.date))
    .reduce((s, b) => s + collectedOf(b), 0), [bookings, lastWeekKeys])
  const weekTrendPct = lastWeekRevenue ? Math.round(((weekRevenue - lastWeekRevenue) / lastWeekRevenue) * 100) : null
  const weekDailyRevenue = useMemo(() => weekKeys.map((k) => weekBookings.filter((b) => b.date === k).reduce((s, b) => s + collectedOf(b), 0)), [weekKeys, weekBookings])

  // Gastos del mes en curso, por categoría. `expenses` puede traer también los
  // ingresos manuales (kind 'ingreso'); una fila sin kind es un gasto.
  const monthMovements = useMemo(() => expenses.filter((e) => (e.date || '').startsWith(monthKey)), [expenses, monthKey])
  const expenseCats = useMemo(() => {
    const grouped = Object.values(monthMovements.filter((e) => (e.kind || 'gasto') === 'gasto').reduce((acc, e) => {
      const k = e.category || 'Otros'
      acc[k] = acc[k] || { name: k, amount: 0 }
      acc[k].amount += Number(e.amount || 0)
      return acc
    }, {})).sort((a, b) => b.amount - a.amount)
    return grouped.map((c, i) => ({ ...c, color: CAT_COLORS[i % CAT_COLORS.length] }))
  }, [monthMovements])
  const expTotal = expenseCats.reduce((s, c) => s + c.amount, 0)
  const manualIncomeMonth = useMemo(() => monthMovements
    .filter((e) => e.kind === 'ingreso')
    .reduce((s, e) => s + Number(e.amount || 0), 0), [monthMovements])

  // Ingresos de los últimos 7 días con datos; el mejor día va en dorado.
  const revByDay = useMemo(() => {
    const valid = bookings.filter((b) => b.status === 'completada' && b.date)
    const byDate = valid.reduce((acc2, b) => {
      acc2[b.date] = (acc2[b.date] || 0) + collectedOf(b)
      return acc2
    }, {})
    const dates = Object.keys(byDate).sort().slice(-7)
    const rows = dates.map((date) => ({ k: date, d: fmtDate(date, 'dm'), v: byDate[date] }))
    const best = rows.reduce((p, r) => (r.v > (p?.v ?? 0) ? r : p), null)
    return rows.map((r) => ({ ...r, peak: r === best }))
  }, [bookings])

  const pendingCount = useMemo(() => bookings.filter((b) => b.status === 'pendiente').length, [bookings])
  const monthRevenue = useMemo(() => bookings
    .filter((b) => b.status === 'completada' && (b.date || '').startsWith(monthKey))
    .reduce((s, b) => s + collectedOf(b), 0), [bookings, monthKey])

  /* Ventas online del mes (Cursos, Workshop y Essentials pagados por Mercado
     Pago): las calcula Dashboard (`onlineMonthTotal`, del resumen del
     servidor o de la lista de pedidos por fecha de Santiago). Entran al
     margen igual que los ingresos manuales: es plata del local aunque no
     pase por la silla. Solo el admin carga los pedidos, así que solo a él se
     le muestra el KPI. */
  const onlineMonth = Number(onlineMonthTotal) || 0
  const showOnline = Boolean(admin) && Number.isFinite(Number(onlineMonthTotal))
  const onlineMonthCount = useMemo(() => (Array.isArray(onlineOrders) ? onlineOrders : [])
    .filter((o) => santiagoDateKey(o.created_at).startsWith(monthKey)).length, [onlineOrders, monthKey])
  const incomeMonth = monthRevenue + onlineMonth + manualIncomeMonth
  const netMarginPct = incomeMonth ? Math.round(((incomeMonth - expTotal) / incomeMonth) * 100) : 0

  // Ocupación real de hoy = horas reservadas / (reservadas + libres), según
  // la agenda del día (las bloqueadas no son capacidad).
  const bookedToday = todaySlots.filter((s) => s.state === 'booked').length
  const freeToday = todaySlots.filter((s) => s.state === 'free').length
  const occupancy = (bookedToday + freeToday) ? Math.round((bookedToday / (bookedToday + freeToday)) * 100) : 0

  const recurringClients = clients.filter((c) => Number(c.visits || 0) >= 2)
  const retention = clients.length ? Math.round((recurringClients.length / clients.length) * 100) : 0
  const newClients = useMemo(() => {
    const seenBefore = new Set(bookings.filter((b) => b.date && b.date < todayKey).map((b) => b.phone))
    const todaysPhones = new Set(dayValid.map((b) => b.phone).filter(Boolean))
    return [...todaysPhones].filter((p) => !seenBefore.has(p)).length
  }, [bookings, dayValid, todayKey])

  /* "Ahora": la atención que está EN CURSO (para cobrarla aunque su hora de
     inicio ya haya pasado) y, si no hay ninguna, la primera activa de hoy
     cuya hora todavía no llega. */
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const nextAppt = today.find((b) => b.status === 'en curso')
    || today
      .filter((b) => b.status !== 'cancelada' && b.status !== 'completada')
      .find((b) => (minutesOf(b.time) ?? -1) >= nowMin)
    || null
  const nextEta = (() => {
    if (!nextAppt) return ''
    if (nextAppt.status === 'en curso') return 'en curso'
    const diff = (minutesOf(nextAppt.time) ?? nowMin) - nowMin
    if (diff <= 0) return 'ahora'
    return diff >= 60 ? `en ${Math.floor(diff / 60)}h ${diff % 60}m` : `en ${diff}m`
  })()

  // Solo para el saludo del WhatsApp ("con Bruno"): acá no se rotula barbero.
  const barberShortOf = (bk) => {
    const b = barbers.find((x) => Number(x.id) === Number(bk.barberId)) || barberById(Number(bk.barberId)) || {}
    return b.short || String(b.name || '').split(/\s+/)[0] || ''
  }
  const firstName = (barber?.short || barber?.name || '').trim().split(/\s+/)[0] || ''

  const canAdvanceNext = Boolean(nextAppt && updateBookingStatus && (nextAppt.status !== 'en curso' || canCharge !== false))
  // Con la hoja de cobro, completar ES cobrar (pide el medio de pago); sin
  // ella, es solo marcarla completada.
  const finishLabel = FEATURES.charge ? 'Cobrar' : 'Completar'
  const waUrlForNext = nextAppt ? waLinkForBooking(nextAppt, barberShortOf(nextAppt), nextAppt.status === 'pendiente' ? 'default' : nextAppt.status) : null

  const handleAdvance = async () => {
    if (!nextAppt || !updateBookingStatus || advancing) return
    setAdvancing(true)
    try {
      const res = await updateBookingStatus(nextAppt, nextAppt.status === 'en curso' ? 'completada' : 'en curso')
      if (res?.error) pushToast?.('⚠️', res.error, 6000)
    } finally {
      setAdvancing(false)
    }
  }

  const goToPedidos = setTab && (!has || has('pedidos')) ? () => setTab('pedidos') : undefined
  const tendenciasKpis = [
    { id: 'ticket', icon: 'chart', label: 'Ticket promedio', value: avgTicket, format: CLP, hint: 'Hoy' },
    showOnline && {
      id: 'online', icon: 'box', label: 'Ventas online', value: onlineMonth, format: CLP,
      hint: `Este mes · ${onlineMonthCount} pedido${onlineMonthCount === 1 ? '' : 's'}`,
      title: 'Cursos, Workshop y Essentials pagados por Mercado Pago este mes',
      onClick: goToPedidos,
    },
    { id: 'gastos', icon: 'wallet', label: 'Gastos del mes', value: expTotal, format: CLP },
    {
      id: 'margen', icon: 'trend', label: 'Margen neto', value: netMarginPct, suffix: '%',
      hint: 'Del mes',
      title: 'Servicios, ventas online e ingresos manuales del mes, menos los gastos',
    },
    // Rótulos cortos a propósito: a 375px cada KPI deja ~114px para el
    // rótulo y "Tasa de cancelación" o "Clientes recurrentes" salían
    // recortados; el detalle va en el `hint`.
    { id: 'cancel', icon: 'close', label: 'Cancelaciones', value: cancelRatePct, suffix: '%', hint: 'Últimos 30 días', title: 'Tasa de cancelación de los últimos 30 días' },
    { id: 'nuevos', icon: 'user', label: 'Clientes nuevos', value: newClients, hint: 'Hoy' },
    { id: 'recurr', icon: 'spark', label: 'Recurrentes', value: retention, suffix: '%', hint: 'Con 2+ visitas', title: 'Clientes con 2 visitas o más' },
    // Adopción de la tarjeta de fidelidad. Las cifras vienen del puente con
    // PimpStudio (el programa es uno solo): mientras no lleguen, la tarjeta
    // no se dibuja — un 0 acá se leería como "nadie la instaló" y es solo
    // que todavía está cargando.
    walletStats && { id: 'wallet', icon: 'wallet', label: 'Tarjetas en Wallet', value: Number(walletStats.installed) || 0, hint: `${walletStats.installRate ?? 0}% de ${walletStats.passesIssued ?? 0} emitidas`, onClick: onGoToMarketing },
  ].filter(Boolean)

  const newBookingAction = onNewBooking ? { label: 'Nueva reserva', icon: 'calendar', onClick: onNewBooking } : undefined

  return (
    <div className="pn-page pn-resumen">
      <div className="pn-resumen-greet">
        <Avatar src={myPhoto} name={barber?.name} size={44} accent />
        <div className="pn-resumen-greet-text">
          <h1>{firstName ? `Hola, ${firstName}` : 'Hola'}</h1>
          <p>{fmtDate(todayKey, 'long')}</p>
        </div>
        {onNewBooking && (
          isPhone
            ? <Button variant="primary" icon="plus" className="pn-resumen-greet-new" aria-label="Nueva reserva" title="Nueva reserva" onClick={onNewBooking} />
            : <Button variant="primary" size="sm" icon="plus" className="pn-resumen-greet-new" onClick={onNewBooking}>Nueva reserva</Button>
        )}
      </div>

      <Segmented
        className="pn-resumen-seg"
        ariaLabel="Vista del resumen"
        full
        value={view}
        onChange={setView}
        options={[{ value: 'hoy', label: 'Hoy' }, { value: 'tendencias', label: 'Tendencias' }]}
      />

      {/* pn-cols--2 (50/50) y no --side (280px/.8fr): con la columna angosta,
          los 4 KPI de "Hoy" no entraban 4 en fila sin recortar el rótulo. */}
      <div className="pn-cols pn-cols--2">
        {/* ---- HOY ---- */}
        <div className={cx('pn-resumen-col', view !== 'hoy' && 'is-hidden')}>
          {FEATURES.unclosed && <SinCerrarNotice ctx={ctx} />}

          <Card
            title="Ahora"
            flush
            action={pendingCount > 0 ? (
              <button type="button" className="pn-chip pn-chip--warn pn-resumen-pending" onClick={onGoToPending}>
                <Icon name="bell" size={12} /> {pendingCount} {pendingCount === 1 ? 'pendiente' : 'pendientes'}
              </button>
            ) : null}
          >
            {nextAppt ? (
              <List>
                <ListRow
                  className="pn-resumen-now-row"
                  lead={<Time value={nextAppt.time} sub={nextEta} />}
                  title={nextAppt.client}
                  subtitleWrap
                  subtitle={nextAppt.service}
                  onClick={setDetail ? () => setDetail(nextAppt) : undefined}
                  trailing={<StatusBadge status={nextAppt.status} />}
                  actions={(
                    <>
                      {waUrlForNext && (
                        <IconButton icon="whatsapp" label="Enviar WhatsApp" onClick={() => window.open(waUrlForNext, '_blank', 'noopener,noreferrer')} />
                      )}
                      {canAdvanceNext && (
                        <Button size="sm" variant="primary" loading={advancing} onClick={handleAdvance}>
                          {nextAppt.status === 'en curso' ? finishLabel : 'Iniciar'}
                        </Button>
                      )}
                    </>
                  )}
                />
              </List>
            ) : (
              <EmptyState compact icon="calendar" title="Sin próximas citas hoy" action={newBookingAction} />
            )}
          </Card>

          {/* 2×2 o 4 en fila según el ancho de la COLUMNA, no de la
              pantalla (container query en resumen.css): a 1280px la columna
              mide ~475px y "$131.960" no entraba en un cuarto sin recortarse.
              Sin ícono, para no restarle ese ancho al rótulo. */}
          <div className="pn-resumen-kpiwrap">
            <div className="pn-kpis cols-4">
              <Kpi label="Cobrado" value={revenueDay} format={CLP} />
              <Kpi label="Reservas" value={activeTodayCount} />
              <Kpi label="Ocupación" value={occupancy} suffix="%" />
              <Kpi label="Pendientes" value={pendingCount} onClick={pendingCount > 0 ? onGoToPending : undefined} />
            </div>
          </div>

          <Card
            title="Reservas del día"
            flush
            action={today.length > 0 && (goToDayInReservas || setTab) ? (
              <Button variant="plain" size="sm" iconRight="chevronRight" onClick={() => (goToDayInReservas ? goToDayInReservas(todayKey) : setTab('reservas'))}>
                {`Ver todas (${today.length})`}
              </Button>
            ) : null}
          >
            {today.length === 0 ? (
              <EmptyState compact icon="calendar" title="Sin reservas para hoy" action={newBookingAction} />
            ) : (
              <List>
                {today.slice(0, 5).map((bk) => (
                  <ListRow
                    key={bookingUid(bk)}
                    lead={<Time value={bk.time} />}
                    title={bk.client}
                    subtitle={bk.service}
                    trailing={<StatusBadge status={bk.status} />}
                    onClick={setDetail ? () => setDetail(bk) : undefined}
                  />
                ))}
              </List>
            )}
          </Card>
        </div>

        {/* ---- TENDENCIAS ---- */}
        <div className={cx('pn-resumen-col', view !== 'tendencias' && 'is-hidden')}>
          <div className="pn-resumen-kpiwrap">
            <div className="pn-kpis pn-resumen-trend-kpis">
              {tendenciasKpis.map(({ id, ...k }) => <Kpi key={id} {...k} />)}
            </div>
          </div>

          {reviews && <ReviewsCard data={reviews} />}

          <Card title="Ingresos por día" subtitle={revByDay.length ? CLP(revByDay.reduce((s, d) => s + d.v, 0)) : undefined} flush>
            {revByDay.length ? <BarChart data={revByDay} /> : <EmptyState compact icon="chart" title="Sin ingresos registrados aún" />}
          </Card>

          <Card title="Mis ventas de la semana" subtitle="Lun–Dom" flush>
            {weekCount === 0 ? <EmptyState compact icon="chart" title="Sin ventas esta semana" /> : (
              <div className="pn-resumen-week">
                <div className="pn-resumen-week-total"><CountUp value={weekRevenue} format={CLP} /></div>
                <div className="pn-resumen-week-meta">
                  <span className="pn-muted">{weekCount} corte{weekCount === 1 ? '' : 's'} esta semana</span>
                  {weekTrendPct != null && (
                    <Chip tone={weekTrendPct >= 0 ? 'ok' : 'bad'}>{weekTrendPct >= 0 ? '▲' : '▼'} {Math.abs(weekTrendPct)}% vs. semana pasada</Chip>
                  )}
                </div>
                <Sparkline data={weekDailyRevenue} width={260} height={44} stroke="var(--pn-accent)" />
              </div>
            )}
          </Card>

          <Card title="Gastos del mes" subtitle={expTotal ? CLP(expTotal) : undefined} flush>
            {expenseCats.length === 0 ? <EmptyState compact icon="wallet" title="Sin gastos este mes" /> : (
              <div className="pn-resumen-donut">
                <Donut items={expenseCats.map((c) => ({ label: c.name, value: c.amount, color: c.color }))} size={isPhone ? 100 : 112} thickness={14} centerLabel={CLPk(expTotal)} centerSub="total" />
                <div className="pn-legend pn-resumen-donut-legend">
                  {expenseCats.map((c) => (
                    <div key={c.name} className="pn-resumen-legend-row">
                      <span className="pn-legend-dot" style={{ '--c': c.color }} />
                      <span title={c.name}>{c.name}</span>
                      <b>{CLP(c.amount)}</b>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <Card title="Servicios más pedidos" flush>
            <TopServiceBars bookings={bookings} />
          </Card>

          <Card title="Ocupación" subtitle={`${occupancy}% hoy`} flush>
            <div className="pn-resumen-ring">
              <AnimatedRing pct={occupancy} size={92} label="ocupación" />
              <div className="pn-resumen-ring-stats">
                <div><b><CountUp value={retention} />%</b><span>Retención</span></div>
                <div><b><CountUp value={netMarginPct} />%</b><span>Margen neto</span></div>
              </div>
            </div>
          </Card>

          <Card title="Horas y días pico" subtitle="Últimos 30 días" flush>
            <PeakHours bookings={recentBookings} />
          </Card>
        </div>
      </div>
    </div>
  )
}
