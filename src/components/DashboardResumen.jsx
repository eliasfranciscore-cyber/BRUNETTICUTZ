import React, { useMemo } from 'react'
import { Icon } from './IconsExtra.jsx'
import { CLP, CLPk, barberById } from '../data.js'
import { CountUp, KpiTile, Sparkline, Donut, AnimatedRing } from './DashKit.jsx'

/**
 * DashboardResumen — reemplaza el bloque `{tab === "resumen"}` del Dashboard.
 *
 * Rediseño DashKit: hero interactivo (ingresos con count-up, próxima cita,
 * anillo de ocupación, sparkline de 7 días y botón de reserva manual) + fila
 * de KPIs animados + bento re-skin. Todas las métricas se calculan en vivo
 * desde los datos reales del negocio (sin fallback a cifras de ejemplo).
 *
 * Props:
 *  bookings:   reservas (para los totales del día, el ranking y el histórico)
 *  barbers:    lista de barberos (para ranking, equipo y "activos")
 *  expenses:   gastos (para el gráfico por categoría del mes en curso)
 *  clients:    clientes (para calcular retención/recurrencia)
 *  todaySlots: horarios de la agenda de hoy (booked/free/blocked) para la ocupación real
 *  onNewBooking: abre el modal de reserva manual
 */

const STATUS_DOT = { confirmada: 'var(--green, #6fbf86)', pendiente: 'var(--gold)', 'en curso': '#7ea8ff', completada: 'var(--muted-2)', cancelada: 'var(--red, #d99a8f)' }
const CAT_COLORS = ['#c9a14e', '#9c7a32', '#e6cd90', '#8d8a84', '#5a5852']

function Bars({ data }) {
  const max = Math.max(1, ...data.map((d) => d.v))
  return (
    <div className="psn-bars">
      {data.map((d, i) => (
        <div key={d.d} className={`col ${i === data.length - 1 ? 'peak' : ''}`}>
          <div className="track"><div className="fill" style={{ height: `${(d.v / max) * 100}%` }} title={CLP(d.v)} /></div>
          <span className="v">{CLPk(d.v)}</span>
          <span className="d">{d.d}</span>
        </div>
      ))}
    </div>
  )
}

function getSvcIconByName(name) {
  const n = (name || '').toLowerCase()
  if (n.includes('asesor') || n.includes('visag') || n.includes('imagen')) return 'user'
  if (n.includes('quim') || n.includes('color') || n.includes('platin')) return 'spark'
  if (n.includes('fade') || n.includes('degra')) return 'trend'
  return 'scissors'
}

// Horas de atención fijas (ver ALL_SLOTS en data.js) — siempre se muestran
// las 11, aunque alguna nunca haya tenido reservas, para que el gráfico
// refleje la jornada completa y no solo las horas con historial.
const BUSINESS_HOURS = ['9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19']
// Lun→Dom en vez del orden nativo de Date#getDay() (0=Dom), para leer la
// semana como la vive el negocio.
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]
const DOW_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

function PeakChart({ data, peakKey }) {
  const max = Math.max(1, ...data.map((d) => d.v))
  return (
    <div className="psn-peak">
      {data.map((d) => (
        <div key={d.k} className="psn-peak-col">
          <div className="psn-peak-track">
            <div className="psn-peak-fill" style={{ height: `${(d.v / max) * 100}%`, background: d.k === peakKey ? 'var(--gold-grad)' : 'rgba(255,255,255,0.13)' }} title={`${d.v} reservas`} />
          </div>
          <span className="psn-peak-lbl">{d.lbl}</span>
        </div>
      ))}
    </div>
  )
}

/* Antes agregaba TODAS las reservas del historial completo (sin ventana de
   tiempo) y solo dibujaba las horas que alguna vez tuvieron una reserva —
   el gráfico crecía para siempre sesgado hacia las horas más "viejas" y
   podía mostrar solo 3-4 columnas salteadas en vez de la jornada completa.
   Ahora recibe `bookings` ya acotado a una ventana reciente (ver
   `recentBookings` en DashboardResumen) y siempre dibuja las 11 horas y los
   7 días de la semana, con 0 donde no hay datos. */
function PeakHours({ bookings = [], windowLabel = '' }) {
  const valid = React.useMemo(() => bookings.filter((b) => b.status !== 'cancelada' && b.time && b.date), [bookings])

  const hourData = React.useMemo(() => {
    const map = {}
    valid.forEach((b) => { const h = String(b.time).slice(0, 2).replace(/^0/, ''); map[h] = (map[h] || 0) + 1 })
    return BUSINESS_HOURS.map((h) => ({ k: h, lbl: h, v: map[h] || 0 }))
  }, [valid])
  const peakHour = hourData.reduce((p, d) => d.v > (p?.v ?? 0) ? d : p, null)

  const dowData = React.useMemo(() => {
    const map = {}
    valid.forEach((b) => { const dow = new Date(`${b.date}T00:00:00`).getDay(); map[dow] = (map[dow] || 0) + 1 })
    return DOW_ORDER.map((dow) => ({ k: dow, lbl: DOW_SHORT[dow], v: map[dow] || 0 }))
  }, [valid])
  const peakDow = dowData.reduce((p, d) => d.v > (p?.v ?? 0) ? d : p, null)

  if (!valid.length) {
    return <div style={{ color: 'var(--muted)', fontSize: '.85rem' }}>Sin reservas {windowLabel} para analizar todavía.</div>
  }

  return (
    <div className="psn-peak-split">
      <div>
        <PeakChart data={hourData} peakKey={peakHour?.k} />
        {peakHour && <div style={{ fontSize: '.73rem', color: 'var(--muted)', marginTop: '.6rem', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
          <Icon name="trend" size={13} />
          Hora pico: <strong style={{ color: 'var(--gold-lt)' }}>{peakHour.k}:00</strong> · {peakHour.v} reservas
        </div>}
      </div>
      <div>
        <PeakChart data={dowData} peakKey={peakDow?.k} />
        {peakDow && <div style={{ fontSize: '.73rem', color: 'var(--muted)', marginTop: '.6rem', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
          <Icon name="calendar" size={13} />
          Día pico: <strong style={{ color: 'var(--gold-lt)' }}>{peakDow.lbl}</strong> · {peakDow.v} reservas
        </div>}
      </div>
    </div>
  )
}

function TopSvc({ data = [], bookings = [] }) {
  const live = React.useMemo(() => {
    const valid = bookings.filter((b) => b.status !== 'cancelada')
    if (!valid.length) return data
    const map = {}
    valid.forEach((b) => { const k = b.service || 'Servicio'; map[k] = map[k] || { name: k, count: 0, rev: 0 }; map[k].count++; map[k].rev += Number(b.price || 0) })
    return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 5)
  }, [bookings, data])
  const maxC = Math.max(1, ...live.map((s) => s.count))
  return (
    <div className="psn-top-svc">
      {live.map((s) => (
        <div key={s.name} className="psn-top-svc-row">
          <div className="psn-top-svc-ic"><Icon name={getSvcIconByName(s.name)} size={14} /></div>
          <div className="psn-top-svc-bar">
            <div className="nm">{s.name}</div>
            <div className="track"><div className="fill" style={{ width: `${(s.count / maxC) * 100}%` }} /></div>
          </div>
          <div className="cnt"><div>{s.count}</div><div style={{ color: 'var(--muted)', fontSize: '.68rem' }}>{CLPk(s.rev)}</div></div>
        </div>
      ))}
      {!live.length && <div style={{ color: 'var(--muted)', fontSize: '.84rem' }}>Sin datos aún.</div>}
    </div>
  )
}

// Componentes locales, no UTC (ver Dashboard.jsx isoDate): en Chile
// toISOString() adelanta la fecha durante la noche.
function localDateKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
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

export default function DashboardResumen({ bookings = [], barbers = [], expenses = [], clients = [], todaySlots = [], walletStats = null, onNewBooking, onGoToPending, onGoToMarketing }) {
  const todayKey = localDateKey(new Date())
  const monthKey = todayKey.slice(0, 7)
  const today = useMemo(() => bookings.filter((b) => !b.date || b.date === todayKey).sort((a, b) => String(a.time).localeCompare(String(b.time))), [bookings, todayKey])

  const dayValid = today.filter((b) => b.status !== 'cancelada')
  const revenueDay = dayValid.reduce((s, b) => s + Number(b.price || 0), 0)
  const avgTicket = dayValid.length ? Math.round(revenueDay / dayValid.length) : 0

  // Ventana móvil de 30 días para métricas de "patrón" (tasa de cancelación,
  // horas/días pico) — evita que se acumulen para siempre sesgadas hacia el
  // historial más viejo y las mantiene relevantes al momento actual.
  const last30Key = useMemo(() => localDateKey(addDays(new Date(), -30)), [todayKey])
  const recentBookings = useMemo(() => bookings.filter((b) => b.date && b.date >= last30Key), [bookings, last30Key])
  const cancelRatePct = recentBookings.length
    ? Math.round((recentBookings.filter((b) => b.status === 'cancelada').length / recentBookings.length) * 100)
    : 0

  // Semana actual (Lun→Dom) vs semana anterior, para el chip de ventas.
  const weekStart = useMemo(() => mondayOf(new Date()), [todayKey])
  const weekKeys = useMemo(() => Array.from({ length: 7 }, (_, i) => localDateKey(addDays(weekStart, i))), [weekStart])
  const lastWeekKeys = useMemo(() => Array.from({ length: 7 }, (_, i) => localDateKey(addDays(weekStart, i - 7))), [weekStart])
  const weekBookings = useMemo(() => bookings.filter((b) => b.status !== 'cancelada' && weekKeys.includes(b.date)), [bookings, weekKeys])
  const weekRevenue = weekBookings.reduce((s, b) => s + Number(b.price || 0), 0)
  const weekCount = weekBookings.length
  const lastWeekRevenue = useMemo(() => bookings
    .filter((b) => b.status !== 'cancelada' && lastWeekKeys.includes(b.date))
    .reduce((s, b) => s + Number(b.price || 0), 0), [bookings, lastWeekKeys])
  const weekTrendPct = lastWeekRevenue ? Math.round(((weekRevenue - lastWeekRevenue) / lastWeekRevenue) * 100) : null
  const weekDailyRevenue = useMemo(() => weekKeys.map((k) =>
    weekBookings.filter((b) => b.date === k).reduce((s, b) => s + Number(b.price || 0), 0)), [weekKeys, weekBookings])

  // Gastos del mes en curso, por categoría.
  const expenseCats = useMemo(() => {
    const monthExpenses = expenses.filter((e) => (e.date || '').startsWith(monthKey))
    const grouped = Object.values(monthExpenses.reduce((acc, e) => {
      const k = e.category || 'Otros'
      acc[k] = acc[k] || { name: k, amount: 0 }
      acc[k].amount += Number(e.amount || 0)
      return acc
    }, {})).sort((a, b) => b.amount - a.amount)
    return grouped.map((c, i) => ({ ...c, color: CAT_COLORS[i % CAT_COLORS.length] }))
  }, [expenses, monthKey])
  const expTotal = expenseCats.reduce((s, c) => s + c.amount, 0)

  // Ingresos y volumen de reservas de los últimos 7 días con datos (en vez de
  // un gráfico fijo) — misma ventana de fechas para ambas series, así las dos
  // sparklines del hero son comparables día a día.
  const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
  const { revByDay, countByDay } = useMemo(() => {
    const valid = bookings.filter((b) => b.status !== 'cancelada' && b.date)
    const byDate = valid.reduce((acc2, b) => {
      const cur = acc2[b.date] || { rev: 0, count: 0 }
      cur.rev += Number(b.price || 0)
      cur.count += 1
      acc2[b.date] = cur
      return acc2
    }, {})
    const dates = Object.keys(byDate).sort().slice(-7)
    return {
      revByDay: dates.map((date) => ({ d: DOW[new Date(`${date}T00:00:00`).getDay()], v: byDate[date].rev })),
      countByDay: dates.map((date) => byDate[date].count),
    }
  }, [bookings])

  // Reservas pendientes de confirmar (cualquier fecha) — acceso rápido a Reservas.
  const pendingCount = useMemo(() => bookings.filter((b) => b.status === 'pendiente').length, [bookings])

  const monthRevenue = useMemo(() => bookings
    .filter((b) => b.status !== 'cancelada' && (b.date || '').startsWith(monthKey))
    .reduce((s, b) => s + Number(b.price || 0), 0), [bookings, monthKey])
  const netMarginPct = monthRevenue ? Math.round(((monthRevenue - expTotal) / monthRevenue) * 100) : 0

  // Ocupación real de hoy = horas reservadas / (reservadas + libres) según la
  // agenda del día (excluye las horas bloqueadas, que no son capacidad).
  const bookedToday = todaySlots.filter((s) => s.state === 'booked').length
  const freeToday = todaySlots.filter((s) => s.state === 'free').length
  const occupancy = (bookedToday + freeToday) ? Math.round((bookedToday / (bookedToday + freeToday)) * 100) : 0

  const recurringClients = clients.filter((c) => Number(c.visits || 0) >= 2)
  const retention = clients.length ? Math.round((recurringClients.length / clients.length) * 100) : 0

  // "Nuevo" = tuvo una reserva hoy pero ninguna reserva anterior en el historial cargado.
  const newClients = useMemo(() => {
    const seenBefore = new Set(bookings.filter((b) => b.date && b.date < todayKey).map((b) => b.phone))
    const todaysPhones = new Set(dayValid.map((b) => b.phone).filter(Boolean))
    return [...todaysPhones].filter((p) => !seenBefore.has(p)).length
  }, [bookings, dayValid, todayKey])

  // Próxima cita de hoy: la primera activa cuya hora aún no pasa.
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const nextAppt = useMemo(() => {
    return today
      .filter((b) => b.status !== 'cancelada' && b.status !== 'completada')
      .find((b) => {
        const [h, m] = String(b.time).split(':').map(Number)
        return (h * 60 + (m || 0)) >= nowMin
      }) || null
  }, [today, nowMin])
  const nextEta = (() => {
    if (!nextAppt) return ''
    const [h, m] = String(nextAppt.time).split(':').map(Number)
    const diff = (h * 60 + (m || 0)) - nowMin
    if (diff <= 0) return 'ahora'
    return diff >= 60 ? `en ${Math.floor(diff / 60)}h ${diff % 60}m` : `en ${diff}m`
  })()

  const dateLabel = new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="animate-in psn-dash">

      {/* HERO */}
      <div className="dk-hero">
        <div className="dk-hero-grid dk-stagger">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
              <h2 className="dk-hero-title" style={{ fontSize: '1.35rem' }}>Resumen del estudio</h2>
              {pendingCount > 0 && (
                <button type="button" className="chip chip-gold" onClick={onGoToPending}>
                  <Icon name="bell" size={12} /> {pendingCount} pendiente{pendingCount === 1 ? '' : 's'} de confirmar
                </button>
              )}
            </div>
            <span className="dk-hero-sub" style={{ textTransform: 'capitalize' }}>{dateLabel}</span>
            <div className="dk-hero-big" style={{ marginTop: '.55rem' }}>
              <CountUp value={revenueDay} format={CLP} />
              <small>hoy · <CountUp value={dayValid.length} /> reservas</small>
            </div>
            {revByDay.length > 1 && (
              <div style={{ marginTop: '.4rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                  <Sparkline data={revByDay.map((d) => d.v)} width={120} height={32} />
                  <span className="dk-hero-sub">ingresos · 7 días</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                  <Sparkline data={countByDay} width={70} height={32} stroke="#7ea8ff" />
                  <span className="dk-hero-sub">reservas · 7 días</span>
                </div>
              </div>
            )}
          </div>

          <div>
            <span className="dk-kpi-lbl"><Icon name="clock" size={12} /> Próxima cita</span>
            {nextAppt ? (
              <div style={{ marginTop: '.3rem' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', color: 'var(--gold-lt)', display: 'flex', alignItems: 'baseline', gap: '.5rem' }}>
                  {nextAppt.time}
                  {nextEta && <em style={{ fontStyle: 'normal', fontSize: '.66rem', color: '#9fd7af', background: 'rgba(111,191,134,.14)', padding: '.14rem .5rem', borderRadius: 99 }}>{nextEta}</em>}
                </div>
                <div className="dk-hero-sub" style={{ marginTop: '.15rem' }}>{nextAppt.client} · {nextAppt.service}</div>
              </div>
            ) : (
              <div className="dk-hero-sub" style={{ marginTop: '.4rem', fontSize: '.9rem' }}>Sin próximas citas hoy</div>
            )}
          </div>

          <div className="dk-hero-lead">
            <AnimatedRing pct={occupancy} size={84} />
            <div>
              <b style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem' }}>{bookedToday}/{bookedToday + freeToday}</b>
              <div className="dk-hero-sub">horas de hoy</div>
            </div>
          </div>

          {onNewBooking && (
            <button className="btn btn-gold" style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem', justifySelf: 'end', alignSelf: 'center' }} onClick={onNewBooking}>
              <Icon name="calendar" size={16} /> Nueva reserva
            </button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="psn-kpis dk-stagger" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <KpiTile icon="chart"  label="Ticket promedio"      value={avgTicket} format={CLP} />
        <KpiTile icon="wallet" label="Gastos del mes"       value={expTotal} format={CLP} color="var(--red, #d99a8f)" />
        <KpiTile icon="trend"  label="Margen neto"          value={netMarginPct} suffix="%" color="var(--green, #6fbf86)" />
        <KpiTile icon="close"  label="Tasa de cancelación"  value={cancelRatePct} suffix="%" color="#e0897a" sub="últimos 30 días" />
        <KpiTile icon="user"   label="Clientes nuevos"      value={newClients} />
        <KpiTile icon="spark"  label="Clientes recurrentes" value={retention} suffix="%" color="var(--gold-lt)" />
        {/* Adopción de la tarjeta de fidelidad. Las cifras vienen del puente
            con PimpStudio (el programa es uno solo, ver CLAUDE.md): mientras
            no lleguen, la tarjeta no se dibuja — un 0 acá se leería como
            "nadie la instaló" y es solo que todavía está cargando. */}
        {walletStats && (
          <KpiTile icon="wallet" label="Tarjetas en Wallet" value={walletStats.installed}
            sub={`${walletStats.installRate}% de ${walletStats.passesIssued} emitidas`}
            onClick={onGoToMarketing} />
        )}
      </div>

      <div className="psn-bento">
        <div className="card psn-panel span-7">
          <div className="psn-panel-head"><h3 className="font-display">Ingresos por día</h3><span className="chip chip-gold">{CLP(revByDay.reduce((s, d) => s + d.v, 0))}</span></div>
          <Bars data={revByDay} />
        </div>

        <div className="card psn-panel span-5">
          <div className="psn-panel-head"><h3 className="font-display">Mis ventas de la semana</h3><span style={{ fontSize: '.74rem', color: 'var(--muted)' }}>Lun–Dom</span></div>
          <div style={{ display: 'grid', gap: '.6rem' }}>
            <div className="dk-hero-big"><CountUp value={weekRevenue} format={CLP} /></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '.82rem', color: 'var(--muted)' }}>{weekCount} corte{weekCount === 1 ? '' : 's'} esta semana</span>
              {weekTrendPct != null && (
                <span className="chip" style={{ color: weekTrendPct >= 0 ? 'var(--green, #6fbf86)' : 'var(--red, #d99a8f)', fontSize: '.72rem' }}>
                  {weekTrendPct >= 0 ? '▲' : '▼'} {Math.abs(weekTrendPct)}% vs. semana pasada
                </span>
              )}
            </div>
            <Sparkline data={weekDailyRevenue} width={230} height={46} />
          </div>
        </div>

        <div className="card psn-panel span-7">
          <div className="psn-panel-head"><h3 className="font-display">Reservas del día</h3><span className="chip">{today.length} citas</span></div>
          <div className="psn-today">
            {today.map((bk) => {
              const b = barbers.find((x) => Number(x.id) === Number(bk.barberId)) || barberById(bk.barberId) || {}
              return (
                <div key={bk.id || bk.time} className="psn-today-row">
                  <span className="t">{bk.time}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="c">{bk.client}</div>
                    <div className="s">{bk.service} · {b.short || b.name}</div>
                  </div>
                  <span className="dot" style={{ background: STATUS_DOT[bk.status] || 'var(--muted-2)' }} title={bk.status} />
                </div>
              )
            })}
            {!today.length && (
              <div style={{ display: 'grid', gap: '.6rem', justifyItems: 'center', padding: '1rem', textAlign: 'center' }}>
                <span style={{ color: 'var(--muted)', fontSize: '.85rem' }}>Sin reservas para hoy.</span>
                {onNewBooking && (
                  <button type="button" className="btn btn-gold btn-sm" onClick={onNewBooking}>
                    <Icon name="calendar" size={14} /> Nueva reserva
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="card psn-panel span-5">
          <div className="psn-panel-head"><h3 className="font-display">Gastos del mes</h3><span className="chip">{CLP(expTotal)}</span></div>
          <div className="psn-donut-wrap">
            <Donut
              items={expenseCats.map((c) => ({ label: c.name, value: c.amount, color: c.color }))}
              size={120} thickness={14}
              centerLabel={CLPk(expTotal)} centerSub="total"
            />
            <div className="psn-donut-legend">
              {expenseCats.map((c) => (
                <div key={c.name} className="row"><span className="dot" style={{ background: c.color }} />{c.name}<span>{CLP(c.amount)}</span></div>
              ))}
              {!expenseCats.length && <div style={{ color: 'var(--muted)', fontSize: '.8rem' }}>Sin gastos este mes.</div>}
            </div>
          </div>
        </div>

        <div className="card psn-panel span-7">
          <div className="psn-panel-head"><h3 className="font-display">Servicios más pedidos</h3><span className="chip chip-gold"><Icon name="scissors" size={12} /> Top 5</span></div>
          <TopSvc data={[]} bookings={bookings} />
        </div>

        <div className="card psn-panel span-5">
          <div className="psn-panel-head"><h3 className="font-display">Ocupación</h3><span className="chip">{occupancy}% hoy</span></div>
          <div className="psn-ring-wrap">
            <AnimatedRing pct={occupancy} size={96} />
            <div className="psn-ring-stats">
              <div className="psn-ring-stat">
                <div className="lbl">Retención</div>
                <div className="val"><CountUp value={retention} />%</div>
              </div>
              <div className="psn-ring-stat">
                <div className="lbl">Margen neto</div>
                <div className="val"><CountUp value={netMarginPct} />%</div>
              </div>
            </div>
          </div>
        </div>

        <div className="card psn-panel span-12">
          <div className="psn-panel-head"><h3 className="font-display">Horas y días pico</h3><span style={{ fontSize: '.73rem', color: 'var(--muted)' }}>Últimos 30 días</span></div>
          <PeakHours bookings={recentBookings} windowLabel="en los últimos 30 días" />
        </div>

      </div>
    </div>
  )
}
