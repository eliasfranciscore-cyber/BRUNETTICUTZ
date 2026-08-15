import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Brandmark, Icon, Stat } from '../components/ui.jsx'
import { ThemeProvider, ThemeToggle, useTheme } from '../components/theme.jsx'
import MobileDock from '../components/MobileDock.jsx'
import { BARBERS, CLIENTS, EXPENSES, SERVICES, TODAY_BOOKINGS, barberById, CLP, CLPk, isAdminUser, cleanPhone } from '../data.js'
import { addLocalBooking, mergeBookings, readLocalBookings } from '../bookingsStore.js'
import { mergeEnrollments } from '../enrollmentsStore.js'
import BookingsInbox from '../components/BookingsInbox.jsx'
import BookingSyncIssues from '../components/BookingSyncIssues.jsx'
import DashboardResumen from '../components/DashboardResumen.jsx'
import NewBookingModal from '../components/NewBookingModal.jsx'
import GlobalSearch from '../components/GlobalSearch.jsx'
import NewClientModal from '../components/NewClientModal.jsx'
import ExpensesModule, { EXPENSE_CATEGORIES, CATEGORY_META } from '../components/ExpensesModule.jsx'
import { KpiTile, AnimatedRing } from '../components/DashKit.jsx'
import ClientModal from '../components/ClientModal.jsx'
import BarberModal from '../components/BarberModal.jsx'
import {
  registerServiceWorker, notifyBarberOfBooking, pushEnabledFor,
  enablePush, disablePush, notifyLocal, permissionState,
  pushAvailableHere, pushSupported, isIOS, isStandalone,
} from '../push.js'

const AGENDA_SLOTS = ["09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00"]
const SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 min sin actividad → cerrar sesión
const DAY_LABELS = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"]
const DOW_LONG = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"]
const MONTH_LONG = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

// Duración de un servicio expresada en bloques de 1h (lo que realmente
// bloquea en la agenda — ver api/_slots.js), redondeando hacia arriba: un
// servicio de 75 min sigue ocupando 2 horarios seguidos.
function minToBlocks(min) {
  return Math.max(1, Math.ceil(Number(min || 60) / 60))
}
function blocksToMin(blocks) {
  return Math.max(1, Number(blocks) || 1) * 60
}

function getSvcIcon(svc) {
  const n = ((svc.name || '') + ' ' + (svc.cat || '')).toLowerCase()
  if (n.includes('asesor') || n.includes('visag') || n.includes('imagen')) return 'user'
  if (n.includes('barba') || n.includes('beard')) return 'cut'
  if (n.includes('quim') || n.includes('color') || n.includes('platin')) return 'spark'
  if (n.includes('fade') || n.includes('degra')) return 'trend'
  return 'scissors'
}

function isoDate(date) {
  // Componentes locales, no UTC: en Chile (UTC-3/-4) toISOString() hace
  // rollover al día siguiente durante la noche, lo que desalineaba "hoy" y
  // la semana activa de la agenda para quien la usa después del atardecer.
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function buildWeek(offset = 0) {
  const now = new Date()
  const monday = new Date(now)
  const day = monday.getDay() || 7
  monday.setDate(now.getDate() - day + 1 + offset * 7)
  // Atiende los 7 días de la semana, incluido domingo.
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + i)
    return { key: isoDate(date), label: `${DAY_LABELS[date.getDay()]} ${date.getDate()}` }
  })
}

function localBlockKey(barberId, date, slot) {
  return `${barberId}|${date}|${slot}`
}

function readLocalBlocks() {
  try { return JSON.parse(localStorage.getItem("ps_availability_blocks") || "{}") } catch { return {} }
}

function writeLocalBlocks(blocks) {
  localStorage.setItem("ps_availability_blocks", JSON.stringify(blocks))
}

function BarChart({ data, fmt }) {
  const max = Math.max(...data.map((d) => d.v))
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: ".7rem", height: 160, padding: "0 .2rem" }}>
      {data.map((d, i) => (
        <div key={d.d} style={{ flex: 1, display: "grid", justifyItems: "center", gap: ".5rem", height: "100%", gridTemplateRows: "1fr auto auto" }}>
          <div style={{ width: "100%", display: "flex", alignItems: "flex-end", height: "100%" }}>
            <div title={fmt(d.v)} style={{ width: "100%", height: `${(d.v / max) * 100}%`, borderRadius: "6px 6px 0 0", background: i === data.length - 1 ? "var(--gold-grad)" : "linear-gradient(180deg,#3a3935,#222220)" }} />
          </div>
          <span style={{ fontSize: ".66rem", color: "var(--muted-2)" }}>{CLPk(d.v)}</span>
          <span style={{ fontSize: ".72rem", color: "var(--muted)" }}>{d.d}</span>
        </div>
      ))}
    </div>
  )
}

function Panel({ title, action, children, style }) {
  return (
    <div className="card dashboard-panel" style={{ padding: "1.3rem", ...style }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.1rem" }}>
        <h3 className="font-display" style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>{title}</h3>
        {action}
      </div>
      {children}
    </div>
  )
}

// Popover de calendario propio de Agenda: sólo dentro de la ventana
// administrable (semana actual + siguiente) los días son elegibles; el resto
// se muestran deshabilitados para no sugerir una selección que igual va a
// rebotar con el toast de "fuera de rango".
function AgendaDatePicker({ month, year, selectedKey, onPrevMonth, onNextMonth, onPick, reservableKeys }) {
  const todayKey = isoDate(new Date())
  const first = new Date(year, month, 1)
  const startOffset = (first.getDay() + 6) % 7 // semana empieza lunes
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = [...Array(startOffset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  return (
    <div className="agenda-cal" role="dialog" aria-label="Elegir fecha">
      <div className="agenda-cal-head">
        <button type="button" onClick={onPrevMonth} aria-label="Mes anterior"><Icon name="arrowLeft" size={13} /></button>
        <span>{MONTH_LONG[month]} {year}</span>
        <button type="button" onClick={onNextMonth} aria-label="Mes siguiente"><Icon name="arrowRight" size={13} /></button>
      </div>
      <div className="agenda-cal-grid">
        {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => <span key={i} className="agenda-cal-dow">{d}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} />
          const key = isoDate(new Date(year, month, d))
          const isSel = key === selectedKey
          const isToday = key === todayKey
          const isReservable = reservableKeys.has(key)
          return (
            <button
              key={key}
              type="button"
              className={`agenda-cal-day ${isSel ? "is-sel" : ""} ${isToday && !isSel ? "is-today" : ""}`}
              disabled={!isReservable}
              onClick={() => onPick(key)}
            >
              {d}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Modal de detalle de una reserva (click en un slot "booked" o en la lista de
// Reservas del día). Portal a document.body, mismo patrón que NewBookingModal.
function BookingDetailModal({ booking, clients, onClose, onConfirm, onCancel, onRedeemFreeCut }) {
  useEffect(() => {
    if (!booking) return
    const onKey = (e) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [booking, onClose])

  if (!booking) return null
  const client = clients.find((c) => cleanPhone(c.phone) === cleanPhone(booking.phone))
  const isRecurring = client && Number(client.visits || 0) > 1
  const initial = (booking.client || "?").trim().charAt(0).toUpperCase() || "?"

  return createPortal((
    <div className="psn-modal" role="dialog" aria-modal="true" aria-label="Detalle de la reserva">
      <button className="psn-scrim" aria-label="Cerrar" onClick={onClose} />
      <div className="psn-modal-card agenda-detail">
        <button className="psn-close" onClick={onClose} aria-label="Cerrar"><Icon name="close" size={17} /></button>
        <span className={`chip ${booking.status === "confirmada" ? "chip-gold" : ""} agenda-detail-status`}>{booking.status}</span>
        <div className="agenda-detail-client">
          <span className="agenda-detail-avatar">{initial}</span>
          <div>
            <strong>{booking.client}</strong>
            <span className="agenda-detail-tag">{isRecurring ? `Cliente recurrente · ${client.visits} visitas` : "Cliente nuevo"}</span>
          </div>
        </div>
        <div className="agenda-detail-grid">
          <div className="agenda-detail-cell"><span>Hora</span><b>{booking.time}</b></div>
          <div className="agenda-detail-cell"><span>Servicio</span><b>{booking.service}</b></div>
          <div className="agenda-detail-cell"><span>Fecha</span><b>{booking.date}</b></div>
          <div className="agenda-detail-cell"><span>Precio</span><b>{CLP(Number(booking.price || 0))}</b></div>
        </div>
        {/* Fidelidad: el saldo viene de la lista de clientes (una sola llamada
            al puente por carga del panel, no una por reserva). El canje solo
            se ofrece si le alcanza y si esta reserva no está ya en $0. */}
        {client?.loyalty && (
          <div style={{ display: "grid", gap: ".4rem", margin: ".2rem 0 .4rem" }}>
            <span className="chip chip-gold" style={{ justifySelf: "start", fontSize: ".68rem" }}>
              <Icon name="star" size={11} /> {client.loyalty.stars}/{client.loyalty.goal} estrellas
            </span>
            {client.loyalty.freeCutReady && Number(booking.price || 0) > 0 && onRedeemFreeCut && (
              <button type="button" className="btn btn-gold btn-block" onClick={() => onRedeemFreeCut(booking)}>
                <Icon name="gift" size={15} /> Canjear corte gratis
              </button>
            )}
          </div>
        )}
        <div className="agenda-detail-actions">
          <button type="button" className="btn btn-gold btn-block" onClick={() => onConfirm(booking)}>
            <Icon name="check" size={15} /> Confirmar
          </button>
          <button type="button" className="btn btn-ghost btn-block agenda-detail-cancel" onClick={() => onCancel(booking)}>
            Cancelar cita
          </button>
        </div>
      </div>
    </div>
  ), document.body)
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState("agenda")
  const [agendaBarber, setAgendaBarber] = useState(null)
  const [agendaDayKey, setAgendaDayKey] = useState(null)
  const [weekOffset, setWeekOffset] = useState(0)
  const [availability, setAvailability] = useState({})
  const [agendaBusy, setAgendaBusy] = useState("")
  const [agendaError, setAgendaError] = useState("")
  // Rediseño Agenda: vista Bloques/Línea, buscador local, date-picker propio,
  // modal de detalle de reserva, toasts de confirmación y comparativo vs.
  // semana anterior para los deltas de KPI.
  const [agendaView, setAgendaView] = useState("grid") // 'grid' | 'timeline'
  const [agendaQuery, setAgendaQuery] = useState("")
  const [calOpen, setCalOpen] = useState(false)
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth())
  const [calYear, setCalYear] = useState(() => new Date().getFullYear())
  const [detail, setDetail] = useState(null)
  const [toasts, setToasts] = useState([])
  const [prevWeekStats, setPrevWeekStats] = useState(null)
  const dragRef = useRef({ active: false, mode: null })
  const calRef = useRef(null)
  const [barber, setBarber] = useState(null)
  const [barbers, setBarbers] = useState(BARBERS.map((item) => ({ ...item, active: true })))
  const [bookings, setBookings] = useState(mergeBookings(TODAY_BOOKINGS.map((item, index) => ({ ...item, id: index + 1, date: isoDate(new Date()) }))))
  const [clients, setClients] = useState(CLIENTS)
  const [clientQuery, setClientQuery] = useState("")
  const [clientFilter, setClientFilter] = useState("all")
  const [clientSort, setClientSort] = useState({ key: "name", dir: "asc" })
  const [financePeriod, setFinancePeriod] = useState("mes") // "semana" | "mes" | "año"
  const [financeSort, setFinanceSort] = useState({ key: "date", dir: "desc" })
  const [topbarScrolled, setTopbarScrolled] = useState(false)
  const [selectedClient, setSelectedClient] = useState(null)
  const [clientHistory, setClientHistory] = useState([])
  const [clientEditing, setClientEditing] = useState(false)
  const [services, setServices] = useState(SERVICES.map((item) => ({ ...item, active: true })))
  const [expenses, setExpenses] = useState(EXPENSES)
  const [serviceDraft, setServiceDraft] = useState({ name: "", price: "", min: 60, cat: "general", desc: "", tne: false })
  const [products, setProducts] = useState([])
  const [productDraft, setProductDraft] = useState({ name: "", brand: "", price: "", stock: "0", description: "" })
  const [productOpen, setProductOpen] = useState(false)
  const [editProductId, setEditProductId] = useState(null)
  const [deleteProduct, setDeleteProduct] = useState(null)
  const [productUploading, setProductUploading] = useState(null) // `${id}-${slot}` mientras sube
  const [expenseBudgets, setExpenseBudgets] = useState(() => { try { return JSON.parse(localStorage.getItem("ps_expense_budgets") || "{}") } catch { return {} } })
  useEffect(() => { try { localStorage.setItem("ps_expense_budgets", JSON.stringify(expenseBudgets)) } catch {} }, [expenseBudgets])
  const [serviceOpen, setServiceOpen] = useState(false)
  const [newBookingOpen, setNewBookingOpen] = useState(false)
  const [newClientOpen, setNewClientOpen] = useState(false)
  const [inboxFocus, setInboxFocus] = useState(null)
  // Fidelidad (pestaña Marketing): las cifras y las campañas viven en Pimp
  // Studio y llegan por el puente — ver api/_loyaltyBridge.js.
  const [walletStats, setWalletStats] = useState(null)
  const [campaigns, setCampaigns] = useState([])
  const [campaignMessage, setCampaignMessage] = useState("")
  const [campaignAudience, setCampaignAudience] = useState("all")
  const [campaignSending, setCampaignSending] = useState(false)
  const [cardTestPhone, setCardTestPhone] = useState("")
  const [cardSending, setCardSending] = useState(false)
  const [cardProgress, setCardProgress] = useState("")
  const cardStopRef = useRef(false)
  const [editSvcId, setEditSvcId] = useState(null)
  const [deleteSvc, setDeleteSvc] = useState(null)
  const [barberDraft, setBarberDraft] = useState({ name: "", code: "", role: "Barbero", tier: "general", pin: "1234", canViewFinance: false, canManageTeam: false, canEditServices: false, canManageBlocks: true })
  // Preferencias de navegación (persisten por dispositivo): qué módulos se ven y
  // qué 4 atajos van en el dock. Se aplican al nav/dock reales.
  const [navSettings, setNavSettings] = useState(() => { try { return JSON.parse(localStorage.getItem("ps_nav_settings") || "{}") } catch { return {} } })
  const [dockShortcuts, setDockShortcuts] = useState(() => { try { const s = JSON.parse(localStorage.getItem("ps_dock_shortcuts") || "null"); return Array.isArray(s) && s.length ? s : ["resumen", "agenda", "reservas", "clientes"] } catch { return ["resumen", "agenda", "reservas", "clientes"] } })
  useEffect(() => { try { localStorage.setItem("ps_nav_settings", JSON.stringify(navSettings)) } catch {} }, [navSettings])
  useEffect(() => { try { localStorage.setItem("ps_dock_shortcuts", JSON.stringify(dockShortcuts)) } catch {} }, [dockShortcuts])
  const admin = isAdminUser(barber)
  const canViewFinance = admin || barber?.canViewFinance
  const canEditServices = admin || barber?.canEditServices
  const canManageTeam = admin || barber?.canManageTeam
  // Periodo de Finanzas (semana/mes/año): fecha de corte desde la que se
  // cuentan ingresos, ranking y movimientos. Semana empieza el lunes.
  const periodStartKey = (() => {
    const d = new Date()
    if (financePeriod === "semana") { const dow = d.getDay() || 7; d.setDate(d.getDate() - dow + 1) }
    else if (financePeriod === "mes") d.setDate(1)
    else d.setMonth(0, 1)
    d.setHours(0, 0, 0, 0)
    return isoDate(d)
  })()
  const completedBookings = bookings.filter((item) => (item.status === "completada" || item.status === "confirmada" || item.status === "en curso") && (item.date || "") >= periodStartKey)
  const revenueTotal = completedBookings.reduce((sum, item) => sum + Number(item.price || 0), 0)
  const avgTicket = completedBookings.length ? Math.round(revenueTotal / completedBookings.length) : 0
  const visibleBookings = admin ? bookings : bookings.filter((item) => Number(item.barberId) === Number(barber?.id))
  // Un servicio de +60min ocupa varios bloques seguidos (ver api/_slots.js),
  // pero la reserva solo trae la hora de INICIO. Antes, la agenda buscaba la
  // reserva de un bloque comparando la hora exacta (`b.time === t`): el
  // bloque de inicio calzaba, pero el/los bloque(s) siguientes quedaban
  // pintados como "Reservado" sin encontrar la reserva -> clic sin efecto,
  // vista Línea sin nombre/servicio. Acá resolvemos por rango de bloques,
  // igual que hace el servidor para marcar el slot como "booked".
  const svcMinByName = {}
  services.forEach((s) => { svcMinByName[s.name] = Number(s.min) || 60 })
  const bookingForSlot = (dayKey, t) => {
    const idx = AGENDA_SLOTS.indexOf(t)
    if (idx === -1) return null
    return visibleBookings.find((b) => {
      if (b.date !== dayKey || b.status === "cancelada") return false
      const startIdx = AGENDA_SLOTS.indexOf(b.time)
      if (startIdx === -1) return false
      const blocks = minToBlocks(svcMinByName[b.service])
      return idx >= startIdx && idx < startIdx + blocks
    }) || null
  }
  const ranking = barbers.map((b) => {
    const own = bookings.filter((item) => Number(item.barberId) === Number(b.id) && item.status !== "cancelada" && (item.date || "") >= periodStartKey)
    return { id: b.id, cuts: own.filter((item) => item.status === "completada").length || own.length, rev: own.reduce((sum, item) => sum + Number(item.price || 0), 0) }
  }).filter((item) => item.cuts || item.rev).sort((a, b) => b.rev - a.rev)
  const maxRev = Math.max(1, ...ranking.map((r) => r.rev))
  const todayKeyNow = isoDate(new Date())
  const monthKeyNow = todayKeyNow.slice(0, 7)
  const monthExpensesTotal = expenses.filter((e) => (e.date || "").startsWith(monthKeyNow)).reduce((sum, e) => sum + Number(e.amount || 0), 0)
  // "Nuevo" = su primera reserva registrada cae dentro de los bookings cargados
  // (no tiene ninguna anterior a hoy).
  const newClientsCount = (() => {
    const seenBefore = new Set(bookings.filter((b) => b.date && b.date < todayKeyNow).map((b) => b.phone))
    const todaysPhones = new Set(bookings.filter((b) => b.date === todayKeyNow && b.status !== "cancelada").map((b) => b.phone).filter(Boolean))
    return [...todaysPhones].filter((p) => !seenBefore.has(p)).length
  })()
  const recurringPct = clients.length ? Math.round((clients.filter((c) => Number(c.visits || 0) >= 2).length / clients.length) * 100) : 0
  const revenueByService = Object.values(completedBookings.reduce((acc, item) => {
    const key = item.service || "Servicio"
    acc[key] = acc[key] || { name: key, total: 0 }
    acc[key].total += Number(item.price || 0)
    return acc
  }, {})).sort((a, b) => b.total - a.total)
  const revenueByDate = Object.values(completedBookings.reduce((acc, item) => {
    const key = item.date || "Sin fecha"
    acc[key] = acc[key] || { d: key.slice(5).replace("-", "/"), v: 0 }
    acc[key].v += Number(item.price || 0)
    return acc
  }, {})).slice(-7)
  // Inactivo = sin visitas hace 30 dias o mas (o nunca visito). Mas activos = 3+ visitas.
  const clientActivityOf = (client) => {
    if (!client.lastVisit) return "inactive"
    const days = (Date.now() - new Date(client.lastVisit).getTime()) / 86_400_000
    return days >= 30 ? "inactive" : "active"
  }
  const activeClients = clients.filter((c) => clientActivityOf(c) === "active")
  const inactiveClients = clients.filter((c) => clientActivityOf(c) === "inactive")
  const topClients = clients.filter((c) => Number(c.visits || 0) >= 3)
  const filteredClients = clients.filter((client) => {
    const haystack = `${client.name || ""} ${client.phone || ""} ${client.email || ""}`.toLowerCase()
    if (!haystack.includes(clientQuery.trim().toLowerCase())) return false
    if (clientFilter === "active") return clientActivityOf(client) === "active"
    if (clientFilter === "inactive") return clientActivityOf(client) === "inactive"
    if (clientFilter === "top") return Number(client.visits || 0) >= 3
    return true
  })
  // Encabezado de columna clickeable: mismo criterio dos veces = invierte el
  // orden; distinto criterio = orden por defecto (nombre asc, el resto desc
  // porque lo útil ahí es ver primero al que más visita/gasta).
  const toggleClientSort = (key) => {
    setClientSort((s) => s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" })
  }
  const toggleFinanceSort = (key) => {
    setFinanceSort((s) => s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "date" || key === "price" ? "desc" : "asc" })
  }
  const sortedFinanceRows = [...completedBookings].sort((a, b) => {
    const dir = financeSort.dir === "asc" ? 1 : -1
    if (financeSort.key === "price") return ((a.price || 0) - (b.price || 0)) * dir
    if (financeSort.key === "client") return (a.client || "").localeCompare(b.client || "") * dir
    if (financeSort.key === "service") return (a.service || "").localeCompare(b.service || "") * dir
    if (financeSort.key === "barber") {
      const an = barberById(a.barberId)?.short || ""
      const bn = barberById(b.barberId)?.short || ""
      return an.localeCompare(bn) * dir
    }
    return `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`) * dir
  })
  const sortedClients = [...filteredClients].sort((a, b) => {
    const dir = clientSort.dir === "asc" ? 1 : -1
    if (clientSort.key === "visits") return ((a.visits || 0) - (b.visits || 0)) * dir
    if (clientSort.key === "totalSpent") return ((a.totalSpent || 0) - (b.totalSpent || 0)) * dir
    if (clientSort.key === "lastVisit") return ((a.lastVisit || "") > (b.lastVisit || "") ? 1 : -1) * dir
    return (a.name || "").localeCompare(b.name || "") * dir
  })

  // Modo panel: bloquea el scroll del body para que el scroll viva dentro de
  // .dashboard-main. Así el topbar (sticky) y el dock (fixed) no rebotan con el
  // momentum scroll de iOS/PWA. Sólo afecta a /panel (no a la web pública).
  useEffect(() => {
    document.body.classList.add('dash-mode')
    // iOS Safari ignora `user-scalable=no` del viewport y, en PWA standalone,
    // sigue disparando los eventos `gesture*` (no estándar, sólo WebKit) al
    // pellizcar con dos dedos. Bloquearlos SOLO acá (no en la web pública,
    // que conserva el zoom por accesibilidad).
    const stopGesture = (e) => e.preventDefault()
    const opts = { passive: false }
    document.addEventListener('gesturestart', stopGesture, opts)
    document.addEventListener('gesturechange', stopGesture, opts)
    document.addEventListener('gestureend', stopGesture, opts)
    return () => {
      document.body.classList.remove('dash-mode')
      document.removeEventListener('gesturestart', stopGesture, opts)
      document.removeEventListener('gesturechange', stopGesture, opts)
      document.removeEventListener('gestureend', stopGesture, opts)
    }
  }, [])

  // Deep-link desde una notificación push (recordatorio, nueva reserva o
  // cancelación) o desde el popup de notificaciones de la campana: la URL
  // trae ?tab=reservas&date=...&bookingId=... y hay que abrir esa reserva
  // puntual, no solo la pestaña. Reutiliza el mismo mecanismo `inboxFocus`
  // que ya usan GlobalSearch/goToDayInReservas para saltar a un día.
  useEffect(() => {
    const qTab = searchParams.get('tab')
    const qBookingId = searchParams.get('bookingId')
    const qDate = searchParams.get('date')
    if (!qTab && !qBookingId) return
    if (qTab) setTab(qTab)
    if (qBookingId) {
      setInboxFocus({ day: qDate || isoDate(new Date()), ts: Date.now(), filter: 'Todas', scope: 'dia', bookingId: Number(qBookingId) })
    }
  }, [searchParams])

  // Si la PWA ya está abierta cuando se toca una notificación push, el
  // service worker no puede navegarla directamente (no controla el router de
  // React) — le manda un postMessage y acá lo escuchamos para navegar sin
  // perder el estado ya cargado (ver public/sw.js `notificationclick`).
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (event) => {
      if (event.data?.type === 'ps-navigate' && event.data.url) navigate(event.data.url)
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [navigate])

  useEffect(() => {
    const stored = localStorage.getItem("ps_barber")
    if (!stored) { navigate("/ingreso"); return }
    const parsed = JSON.parse(stored)
    setBarber(parsed)
    setAgendaBarber(parsed.id || 6)
    setAgendaDayKey(isoDate(new Date()))
    const headers = authHeaders()
    fetch("/api/clients", { headers }).then((r) => r.json()).then((data) => { if (data.clients?.length) setClients(data.clients) }).catch(() => {})
    // App interna en modo "solo Brunetti": no cargamos otros barberos desde la API.
    // (El fetch a /api/barbers queda guardado para cuando se reactive el multi-barbero.)
    // fetch("/api/barbers?includeInactive=true", { headers }).then((r) => r.json()).then((data) => { if (data.barbers?.length) setBarbers(data.barbers) }).catch(() => {})
    fetch("/api/bookings", { headers }).then((r) => r.json()).then((data) => { setBookings(mergeBookings(data.bookings?.length ? data.bookings : TODAY_BOOKINGS.map((item, index) => ({ ...item, id: index + 1, date: isoDate(new Date()) })))) }).catch(() => {})
    fetch("/api/services?includeInactive=true", { headers }).then((r) => r.json()).then((data) => { if (data.services?.length) setServices(data.services) }).catch(() => {})
    fetch("/api/expenses", { headers }).then((r) => r.json()).then((data) => { if (data.expenses?.length) setExpenses(data.expenses) }).catch(() => {})
    fetch("/api/services?scope=shop&includeInactive=true", { headers }).then((r) => r.json()).then((data) => { if (data.products) setProducts(data.products) }).catch(() => {})
  }, [])

  const logout = (reason) => {
    // onClick={onLogout} en varios botones invoca esta función pasando el evento
    // del click como primer argumento: sin este guard, `reason` sería un
    // PointerEvent, y navigate() intentaría meterlo en el state del history,
    // lo que revienta con "DataCloneError" y aborta la navegación en silencio.
    const msg = typeof reason === "string" ? reason : ""
    localStorage.removeItem("ps_barber")
    localStorage.removeItem("ps_barber_token")
    localStorage.removeItem("ps_last_act")
    navigate("/ingreso", msg ? { state: { msg } } : undefined)
  }

  // Timeout de sesión por inactividad: 30 min sin interacción → logout automático
  useEffect(() => {
    const touch = () => localStorage.setItem("ps_last_act", String(Date.now()))
    touch()
    const events = ["mousemove", "keydown", "click", "touchstart", "scroll"]
    events.forEach((ev) => window.addEventListener(ev, touch, { passive: true }))
    const iv = setInterval(() => {
      const last = Number(localStorage.getItem("ps_last_act") || 0)
      if (last && Date.now() - last > SESSION_TIMEOUT_MS) logout("Tu sesión expiró por inactividad.")
    }, 60_000)
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, touch))
      clearInterval(iv)
    }
  }, [])
  const weekDays = buildWeek(weekOffset)

  function authHeaders(extra = {}) {
    const token = localStorage.getItem("ps_barber_token") || ""
    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra
  }

  const loadAgenda = async () => {
    const entries = await Promise.all(weekDays.map(async (day) => {
      const data = await fetch(`/api/availability?barberId=${agendaBarber}&date=${day.key}&detail=true`)
        .then((r) => r.headers.get("content-type")?.includes("application/json") ? r.json() : Promise.reject(new Error("api unavailable")))
        .catch(() => ({ slots: [] }))
      const apiSlots = data.slots?.length ? data.slots : AGENDA_SLOTS.map((slot) => ({ slot, available: true, state: "free" }))
      const localBlocks = readLocalBlocks()
      const merged = apiSlots.map((item) => {
        const key = localBlockKey(agendaBarber, day.key, item.slot)
        if (item.state !== "booked" && localBlocks[key]) return { ...item, available: false, state: "blocked" }
        return item
      })
      return [day.key, merged]
    }))
    setAvailability(Object.fromEntries(entries))
  }

  useEffect(() => {
    if (!barber) return
    loadAgenda()
  }, [barber, agendaBarber, weekOffset])

  // Comparativo liviano vs. la semana anterior (solo para los deltas de KPI
  // del hero). Si cualquier día falla (API caída → fallback demo), NO se
  // inventan cifras: se oculta el delta entero.
  useEffect(() => {
    if (!barber) return
    let alive = true
    const prevDays = buildWeek(weekOffset - 1)
    Promise.all(prevDays.map((day) =>
      fetch(`/api/availability?barberId=${agendaBarber}&date=${day.key}&detail=true`)
        .then((r) => (r.headers.get("content-type")?.includes("application/json") ? r.json() : Promise.reject(new Error("api unavailable"))))
        .then((data) => (data.slots?.length ? data.slots : null))
        .catch(() => null)
    )).then((results) => {
      if (!alive) return
      if (results.some((r) => !r)) { setPrevWeekStats(null); return }
      const stats = results.flat().reduce((acc, s) => {
        if (s.state === "booked") acc.booked += 1
        else if (s.state === "free") acc.free += 1
        else if (s.state === "blocked") acc.blocked += 1
        return acc
      }, { booked: 0, free: 0, blocked: 0 })
      setPrevWeekStats(stats)
    })
    return () => { alive = false }
  }, [barber, agendaBarber, weekOffset])

  // Toasts de confirmación (agenda): auto-dismiss a los 3s.
  const pushToast = useCallback((icon, msg) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, icon, msg }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000)
  }, [])

  // Arrastre para bloquear/habilitar un rango de horarios en la grilla de la
  // agenda: el mouseup/touchend puede ocurrir fuera de cualquier slot, así
  // que el listener va en window para terminar el arrastre siempre.
  useEffect(() => {
    const up = () => { dragRef.current = { active: false, mode: null } }
    window.addEventListener("mouseup", up)
    window.addEventListener("touchend", up)
    return () => { window.removeEventListener("mouseup", up); window.removeEventListener("touchend", up) }
  }, [])

  // Cierra el date-picker de Agenda al hacer click/tap fuera o con Escape
  // (si no, quedaba abierto tapando el dock móvil hasta volver a tocar el botón).
  useEffect(() => {
    if (!calOpen) return
    const onDown = (e) => { if (calRef.current && !calRef.current.contains(e.target)) setCalOpen(false) }
    const onKey = (e) => { if (e.key === "Escape") setCalOpen(false) }
    window.addEventListener("mousedown", onDown)
    window.addEventListener("touchstart", onDown)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("mousedown", onDown)
      window.removeEventListener("touchstart", onDown)
      window.removeEventListener("keydown", onKey)
    }
  }, [calOpen])

  // Recarga manual desde el topbar: en la PWA instalada no hay pull-to-refresh
  // ni recarga de página, así que sin esto la única forma de ver una reserva
  // nueva era cerrar y volver a abrir la app.
  const [refreshing, setRefreshing] = useState(false)
  const refreshAll = async () => {
    if (refreshing) return
    setRefreshing(true)
    const headers = authHeaders()
    await Promise.all([
      fetch("/api/clients", { headers }).then((r) => r.json()).then((data) => { if (data.clients?.length) setClients(data.clients) }).catch(() => {}),
      fetch("/api/bookings", { headers }).then((r) => r.json()).then((data) => { if (data.bookings) setBookings(mergeBookings(data.bookings)) }).catch(() => {}),
      fetch("/api/services?includeInactive=true", { headers }).then((r) => r.json()).then((data) => { if (data.services?.length) setServices(data.services) }).catch(() => {}),
      fetch("/api/expenses", { headers }).then((r) => r.json()).then((data) => { if (data.expenses?.length) setExpenses(data.expenses) }).catch(() => {}),
      fetch("/api/services?scope=shop&includeInactive=true", { headers }).then((r) => r.json()).then((data) => { if (data.products) setProducts(data.products) }).catch(() => {}),
      loadAgenda(),
    ])
    setRefreshing(false)
  }

  // Service worker + aviso al barbero cuando entra una reserva suya.
  // El localStorage sincroniza entre pestañas del mismo navegador (evento
  // 'storage'); el aviso push entre dispositivos lo emite el backend.
  const seenBookingKeys = useRef(null)
  useEffect(() => {
    if (!barber) return
    registerServiceWorker()
    const keyOf = (b) => `${Number(b.barberId)}|${b.date}|${b.time}`
    if (!seenBookingKeys.current) seenBookingKeys.current = new Set(readLocalBookings().map(keyOf))
    const onStorage = (e) => {
      if (e.key && e.key !== "ps_bookings_local") return
      const local = readLocalBookings()
      setBookings((current) => mergeBookings(current))
      local.forEach((bk) => {
        const k = keyOf(bk)
        if (!seenBookingKeys.current.has(k)) {
          seenBookingKeys.current.add(k)
          if (pushEnabledFor(barber)) notifyBarberOfBooking(barber, bk)
        }
      })
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [barber])

  const nav = [
    ["resumen",        "grid",     "Resumen"],
    ["agenda",         "calendar", "Agenda"],
    ["reservas",       "scissors", "Reservas"],
    ...(canViewFinance ? [["finanzas", "wallet", "Finanzas"]] : []),
    ["clientes",       "user",     "Clientes"],
    ["inscripciones",  "spark",    "Inscripciones"],
    ...(canEditServices ? [["servicios", "cut", "Servicios"]] : []),
    ...(admin ? [["essentials", "gift", "Essentials"]] : []),
    ...(admin ? [["gastos", "wallet", "Gastos"]] : []),
    ["marketing",      "spark",    "Marketing"],
    ["config",         "key",      "Config."],
  ]

  // Acceso por barbero: Bruno (admin) ve todo. El admin concede módulos por barbero
  // (barber.modules) para los módulos "abiertos"; Finanzas/Servicios/Gastos siguen
  // por permiso. Resumen y Config siempre disponibles.
  const ALWAYS = ["resumen", "config"]
  const MODULE_IDS = ["agenda", "reservas", "clientes", "marketing"]
  const barberModules = Array.isArray(barber?.modules) ? barber.modules : null
  const accessibleNav = nav.filter(([id]) => {
    if (admin || !barberModules) return true
    if (MODULE_IDS.includes(id)) return barberModules.includes(id)
    return true
  })
  // Preferencia personal de visibilidad (config → módulos visibles).
  const personalNav = accessibleNav.filter(([id]) => ALWAYS.includes(id) || navSettings[id] !== false)
  // ── Modo "solo Brunetti" ──────────────────────────────────────────────
  // BRUNETTI_ONLY = true oculta la sección "Equipo" en Config (gestión multi-barbero).
  // Todos los demás módulos (Finanzas, Clientes, Servicios, etc.) siguen visibles.
  // Para reactivar Equipo: BRUNETTI_ONLY = false.
  const BRUNETTI_ONLY = true
  const visibleNav = personalNav
  // Atajos del dock: los 4 elegidos, sólo si son accesibles/visibles.
  const dockItems = dockShortcuts.map((id) => visibleNav.find((n) => n[0] === id)).filter(Boolean).slice(0, 4)

  const saveService = async (service) => {
    const payload = service?.id ? service : serviceDraft
    if (!payload.name || !payload.price || !payload.min) return
    const method = payload.id ? "PATCH" : "POST"
    const data = { ...payload, price: Number(payload.price), min: Number(payload.min) }
    const res = await fetch("/api/services", { method, headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(data) }).catch(() => null)
    const json = res ? await res.json().catch(() => ({})) : {}
    const saved = json.service || data
    setServices((items) => payload.id ? items.map((item) => item.id === saved.id ? { ...item, ...saved } : item) : [{ ...saved, id: saved.id || Date.now(), active: true }, ...items])
    if (!payload.id) setServiceDraft({ name: "", price: "", min: 60, cat: "general", desc: "", tne: false })
  }

  // Borra un servicio (optimista con revert). La API materializa nombre/precio
  // en las reservas históricas antes de borrar, así que el historial se conserva.
  const deleteService = async (service) => {
    setEditSvcId(null)
    setServices((items) => items.filter((item) => item.id !== service.id))
    const res = await fetch(`/api/services?id=${service.id}`, { method: "DELETE", headers: authHeaders() }).catch(() => null)
    if (res && !res.ok) setServices((items) => [service, ...items].sort((a, b) => a.id - b.id))
  }

  const saveProduct = async (product) => {
    const payload = product?.id ? product : productDraft
    if (!String(payload.name || "").trim() || !payload.price) return
    const method = payload.id ? "PATCH" : "POST"
    const data = { ...payload, price: Number(payload.price), stock: Number(payload.stock) || 0 }
    const res = await fetch("/api/services?scope=shop", { method, headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(data) }).catch(() => null)
    const json = res ? await res.json().catch(() => ({})) : {}
    const saved = json.product || data
    setProducts((items) => payload.id ? items.map((item) => item.id === saved.id ? { ...item, ...saved } : item) : [{ ...saved, id: saved.id || Date.now(), active: true }, ...items])
    if (!payload.id) setProductDraft({ name: "", brand: "", price: "", stock: "0", description: "" })
  }

  // Borra un producto (optimista con revert). A diferencia de servicios, no hay
  // historial que preservar (bookings no referencia productos), así que borra directo.
  const removeProduct = async (product) => {
    setEditProductId(null)
    setProducts((items) => items.filter((item) => item.id !== product.id))
    const res = await fetch(`/api/services?scope=shop&id=${product.id}`, { method: "DELETE", headers: authHeaders() }).catch(() => null)
    if (res && !res.ok) setProducts((items) => [product, ...items].sort((a, b) => a.id - b.id))
  }

  // Sube una foto (portada / hover / detalle) a Vercel Blob vía el endpoint
  // de productos y actualiza la URL en el producto ya guardado.
  const uploadProductPhoto = async (productId, slot, file) => {
    if (!file || !productId) return
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(file)
    }).catch(() => null)
    if (!dataUrl) return
    setProductUploading(`${productId}-${slot}`)
    const res = await fetch("/api/services?scope=shop&upload=1", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ id: productId, slot, dataUrl }),
    }).catch(() => null)
    const json = res ? await res.json().catch(() => ({})) : {}
    setProductUploading(null)
    if (json.product) setProducts((items) => items.map((item) => item.id === productId ? { ...item, ...json.product } : item))
    else if (!res || !res.ok) alert(json.error || "No se pudo subir la foto")
  }

  const createExpense = async (draft) => {
    const payload = { ...draft, amount: Number(draft.amount), owner: barber?.name || "Brunetti" }
    const res = await fetch("/api/expenses", { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(payload) }).catch(() => null)
    const json = res ? await res.json().catch(() => ({})) : {}
    setExpenses((items) => [json.expense || { ...payload, id: Date.now() }, ...items])
  }
  const updateExpense = async (expense) => {
    const prev = expenses
    setExpenses((items) => items.map((item) => item.id === expense.id ? { ...item, ...expense } : item))
    const res = await fetch("/api/expenses", { method: "PATCH", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(expense) }).catch(() => null)
    if (res && !res.ok) setExpenses(prev)
  }
  const deleteExpense = async (expense) => {
    const prev = expenses
    setExpenses((items) => items.filter((item) => item.id !== expense.id))
    const res = await fetch(`/api/expenses?id=${expense.id}`, { method: "DELETE", headers: authHeaders() }).catch(() => null)
    if (res && !res.ok) setExpenses(prev)
  }

  const saveBarber = async (payload) => {
    if (!payload.name || !payload.code) return
    const method = payload.id ? "PATCH" : "POST"
    const res = await fetch("/api/barbers", { method, headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(payload) }).catch(() => null)
    const json = res ? await res.json().catch(() => ({})) : {}
    const saved = json.barber || { ...payload, id: payload.id || Date.now(), active: payload.active !== false }
    setBarbers((items) => payload.id ? items.map((item) => item.id === saved.id ? { ...item, ...payload, ...saved } : item) : [...items, { ...saved, ...payload, active: true }])
    if (!payload.id) setBarberDraft({ name: "", code: "", role: "Barbero", tier: "general", pin: "1234", canViewFinance: false, canManageTeam: false, canEditServices: false, canManageBlocks: true })
  }

  const updateBarberLocal = (id, patch) => {
    setBarbers((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  const deleteBarber = async (target) => {
    if (!target?.id) return
    setBarbers((items) => items.filter((item) => item.id !== target.id))
    fetch(`/api/barbers?id=${target.id}`, { method: "DELETE", headers: authHeaders() }).catch(() => {})
  }

  const exportCSV = (type) => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`
    const toCSV = (headers, rows) => [headers.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n")
    let name = "datos", csv = ""
    if (type === "Clientes") { name = "clientes"; csv = toCSV(["Nombre", "Telefono", "Email", "Visitas", "Total", "Ultima visita", "Estado"], clients.map((c) => [c.name, c.phone, c.email, c.visits, c.totalSpent, c.lastVisit, c.status])) }
    else if (type === "Reservas") { name = "reservas"; csv = toCSV(["Fecha", "Hora", "Cliente", "Telefono", "Servicio", "Barbero", "Precio", "Estado"], bookings.map((b) => { const bb = barberById(b.barberId); return [b.date, b.time, b.client, b.phone, b.service, bb?.short || bb?.name || "", b.price, b.status] })) }
    else if (type === "Finanzas") { name = `finanzas-${financePeriod}`; csv = toCSV(["Fecha", "Hora", "Cliente", "Servicio", "Barbero", "Precio", "Estado"], sortedFinanceRows.map((b) => { const bb = barberById(b.barberId); return [b.date, b.time, b.client, b.service, bb?.short || bb?.name || "", b.price, b.status] })) }
    else if (type === "Gastos") { name = "gastos"; csv = toCSV(["Fecha", "Categoria", "Detalle", "Monto", "Responsable"], expenses.map((e) => [e.date, e.category, e.detail, e.amount, e.owner])) }
    else if (type === "Servicios") { name = "servicios"; csv = toCSV(["Nombre", "Precio", "Minutos", "Categoria", "Estado"], services.map((s) => [s.name, s.price, s.min, s.cat, s.active === false ? "oculto" : "publicado"])) }
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `brunetti-${name}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // Reserva manual desde el panel (modo interno del POST: sin límite de 7
  // días, servicio/precio personalizado). Espeja el patrón del flujo público:
  // si la API responde error real (409, validación) se muestra en el modal;
  // si está offline, se guarda localmente igual (demo/dev).
  const createBooking = async (draft) => {
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(draft),
    }).catch(() => null)
    if (res) {
      const json = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, error: json.error || "No se pudo crear la reserva" }
      addLocalBooking({ ...draft, id: json.booking?.id })
    } else {
      addLocalBooking(draft)
    }
    setBookings((current) => mergeBookings(current))
    loadAgenda()
    return { ok: true }
  }

  const updateBookingStatus = async (booking, status) => {
    setBookings((items) => items.map((item) => item.id === booking.id ? { ...item, status } : item))
    const res = await fetch("/api/bookings", {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ id: booking.id, status }),
    }).catch(() => null)
    if (res && !res.ok) {
      setBookings((items) => items.map((item) => item.id === booking.id ? booking : item))
      return
    }
    // Al completar, el servidor le suma la estrella al cliente en el programa
    // de Pimp Studio y devuelve el saldo nuevo: se refleja de inmediato en la
    // lista de clientes (badge y botón de canje) sin recargar el panel.
    const data = await res?.json?.().catch(() => null)
    if (data?.loyalty) {
      applyClientLoyalty(booking.phone, data.loyalty)
      if (status === "completada") {
        pushToast("⭐", data.loyalty.freeCutReady
          ? `${booking.client}: ¡corte gratis disponible!`
          : `${booking.client}: ${data.loyalty.stars}/${data.loyalty.goal} estrellas`)
      }
    }
  }

  // El saldo de fidelidad vive en la lista de clientes (llega junto con ella
  // desde el puente); acá se actualiza en memoria tras un cambio puntual.
  const applyClientLoyalty = (phone, loyalty) => {
    const digits = cleanPhone(phone)
    setClients((list) => list.map((c) => cleanPhone(c.phone) === digits ? { ...c, loyalty } : c))
  }

  /* Canje del corte gratis: descuenta 10 estrellas en Pimp Studio y deja esta
     reserva en $0. El servidor hace las dos cosas en orden y devuelve las
     estrellas si la segunda falla, así que acá basta con reflejar el
     resultado. */
  const redeemFreeCut = async (booking) => {
    if (!window.confirm(`¿Canjear el corte gratis de ${booking.client}? Se descuentan 10 estrellas y esta reserva queda en $0.`)) return
    try {
      const res = await fetch("/api/bookings", {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ id: booking.id, redeem: "free_cut" }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok === false) {
        window.alert(data?.error || "No se pudo canjear el corte gratis.")
        return
      }
      setBookings((items) => items.map((item) => item.id === booking.id ? { ...item, price: 0 } : item))
      setDetail((d) => (d && d.id === booking.id ? { ...d, price: 0 } : d))
      if (data.loyalty) applyClientLoyalty(booking.phone, data.loyalty)
      pushToast("🎁", `Corte gratis aplicado a ${booking.client}`)
    } catch {
      window.alert("No se pudo canjear el corte gratis. Revisa tu conexión.")
    }
  }

  const deleteBooking = async (booking) => {
    setBookings((items) => items.filter((item) => item.id !== booking.id))
    const res = await fetch(`/api/bookings?id=${booking.id}&purge=1`, {
      method: "DELETE",
      headers: authHeaders(),
    }).catch(() => null)
    if (res && !res.ok) {
      setBookings((items) => [...items, booking])
    }
  }

  const openClient = async (client, { edit = false } = {}) => {
    setSelectedClient(client)
    setClientEditing(edit)
    const local = bookings.filter((item) => item.phone === client.phone)
    setClientHistory(local)
    const data = await fetch(`/api/bookings?phone=${client.phone}`)
      .then((r) => r.headers.get("content-type")?.includes("application/json") ? r.json() : Promise.reject(new Error("api unavailable")))
      .catch(() => ({ bookings: local }))
    setClientHistory(data.bookings?.length ? data.bookings : local)
  }

  /* Métricas e historial de campañas: solo al abrir la pestaña Marketing (son
     dos round-trips al otro proyecto, no hay para qué pagarlos en cada carga
     del panel). */
  useEffect(() => {
    if (tab !== "marketing" || !barber) return
    fetch("/api/clients?mode=wallet-stats", { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => { if (data?.stats) setWalletStats(data.stats) })
      .catch(() => {})
    fetch("/api/clients?mode=wallet-campaigns", { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => { if (data?.campaigns) setCampaigns(data.campaigns) })
      .catch(() => {})
  }, [tab, barber])

  const sendCampaign = async () => {
    if (!campaignMessage.trim()) return
    setCampaignSending(true)
    try {
      const res = await fetch("/api/clients?mode=wallet-campaign", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ message: campaignMessage.trim(), audience: campaignAudience }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok === false) {
        window.alert(data?.error || "No se pudo enviar la campaña.")
        return
      }
      window.alert(`Enviado a ${data.recipients} cliente${data.recipients === 1 ? "" : "s"}.`)
      setCampaignMessage("")
      setCampaigns((list) => [{ ...data.campaign, message: campaignMessage.trim(), audience: campaignAudience, recipientCount: data.recipients, source: "brunetti" }, ...list])
    } catch {
      window.alert("No se pudo enviar la campaña. Revisa tu conexión.")
    } finally {
      setCampaignSending(false)
    }
  }

  /* Envío masivo del link de la tarjeta. El backend manda de a pocos por
     llamada (una función serverless no aguanta 167 correos seguidos con el
     límite de 2/s de Resend), así que el bucle vive acá: se ve el avance en
     vivo y el botón "Detener" corta entre tandas sin dejar a nadie a medias
     — cada cliente enviado queda marcado en el momento. */
  const sendLoyaltyCards = async ({ onlyPhone = null, again = false, includeInstalled = false }) => {
    const bulk = !onlyPhone
    if (bulk && !window.confirm("Se le va a enviar el correo con su tarjeta de fidelidad a todos los clientes con correo que todavía no la tienen. ¿Seguimos?")) return
    setCardSending(true)
    cardStopRef.current = false
    let sent = 0, failed = 0
    try {
      for (;;) {
        const res = await fetch("/api/clients?mode=wallet-send-cards", {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ limit: onlyPhone ? 1 : 5, onlyPhone, again, includeInstalled }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data?.ok === false) {
          setCardProgress(data?.error || "No se pudo enviar.")
          break
        }
        sent += data.sent || 0
        failed += data.failed || 0
        setCardProgress(`Enviados ${sent}${failed ? ` · ${failed} con problema` : ""}${data.remaining ? ` · faltan ${data.remaining}` : ""}`)
        if (data.errors?.length) console.error("wallet-send-cards:", data.errors)
        if (data.done || onlyPhone || cardStopRef.current) {
          setCardProgress(`Listo: ${sent} enviado${sent === 1 ? "" : "s"}${failed ? `, ${failed} con problema (revisa la consola)` : ""}${cardStopRef.current && !data.done ? " · detenido" : ""}`)
          break
        }
      }
    } catch {
      setCardProgress("Se cortó la conexión. Los que ya salieron quedaron marcados: puedes retomar sin repetirlos.")
    } finally {
      setCardSending(false)
    }
  }

  /* "Enviar tarjeta de fidelización": pide al backend el link personal del
     cliente (/tarjeta?t=…, token opaco: no lleva su teléfono escrito) y abre
     WhatsApp con el mensaje listo. La tarjeta es la del programa de Pimp
     Studio — una sola, sirve en los dos locales. */
  const sendLoyaltyCard = async (client) => {
    try {
      const res = await fetch(`/api/clients?mode=wallet-share-link&phone=${encodeURIComponent(client.phone)}`, { headers: authHeaders() })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.url) {
        window.alert(data?.error || "No se pudo generar la tarjeta. Intenta de nuevo.")
        return
      }
      const first = (client.name || "").split(" ")[0] || "Hola"
      const text = `Hola ${first} 👋 Te dejamos tu tarjeta de fidelidad de Brunetti: cada corte suma una estrella y a las 10 el tuyo va gratis. Agrégala a tu celular acá: ${data.url}`
      window.open(`https://wa.me/56${String(client.phone || "").replace(/\D/g, "")}?text=${encodeURIComponent(text)}`, "_blank", "noopener")
    } catch {
      window.alert("No se pudo generar la tarjeta. Revisa tu conexión.")
    }
  }

  const clientKey = (c) => c.id ?? c.phone
  const saveClient = async (updated) => {
    setClients((list) => list.map((c) => clientKey(c) === clientKey(updated) ? { ...c, ...updated } : c))
    setSelectedClient((c) => (c && clientKey(c) === clientKey(updated) ? { ...c, ...updated } : c))
    fetch("/api/clients", { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(updated) }).catch(() => {})
  }
  const deleteClient = async (client) => {
    setClients((list) => list.filter((c) => clientKey(c) !== clientKey(client)))
    setSelectedClient(null)
    setClientEditing(false)
    fetch(`/api/clients?phone=${client.phone}`, { method: "DELETE", headers: authHeaders() }).catch(() => {})
  }
  // Alta manual (upsert por teléfono). Prepende el cliente devuelto; si ya
  // existía lo actualiza en su lugar. Fallback offline con registro local.
  const upsertClientLocal = (client) => setClients((list) => {
    const idx = list.findIndex((c) => cleanPhone(c.phone) === cleanPhone(client.phone))
    if (idx >= 0) { const copy = [...list]; copy[idx] = { ...copy[idx], ...client }; return copy }
    return [client, ...list]
  })
  const createClient = async (draft) => {
    let saved = null
    try {
      const res = await fetch("/api/clients", { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(draft) })
      if (res.headers.get("content-type")?.includes("application/json")) {
        const json = await res.json()
        if (!res.ok || json.ok === false) throw new Error(json.error || "No se pudo guardar el cliente.")
        saved = json.client
      }
    } catch (err) {
      if (err instanceof TypeError) saved = null // red caída → fallback offline
      else throw err                             // error de validación real → propaga al modal
    }
    upsertClientLocal(saved || { ...draft, visits: 0, totalSpent: 0, status: "nuevo" })
  }

  // Actualiza en el momento (optimista) y solo revierte si la API falla.
  // Antes recargaba TODA la semana (6 fetch en serie) después de cada click,
  // lo que hacía que activar/desactivar una hora se sintiera lento.
  const toggleSlot = async (dayKey, slot, state) => {
    if (state === "booked") return
    const busyKey = `${dayKey}-${slot}`
    setAgendaBusy(busyKey)
    setAgendaError("")
    const method = state === "blocked" ? "DELETE" : "POST"
    const body = JSON.stringify({ barberId: agendaBarber, date: dayKey, slot, reason: "Bloqueado desde agenda interna" })
    const previous = availability
    const key = localBlockKey(agendaBarber, dayKey, slot)
    const localBlocks = readLocalBlocks()
    if (state === "blocked") delete localBlocks[key]
    else localBlocks[key] = { barberId: agendaBarber, date: dayKey, slot }
    writeLocalBlocks(localBlocks)
    setAvailability((current) => ({
      ...current,
      [dayKey]: (current[dayKey] || []).map((item) => item.slot === slot ? { ...item, available: state === "blocked", state: state === "blocked" ? "free" : "blocked" } : item),
    }))
    const res = await fetch("/api/availability", { method, headers: authHeaders({ "Content-Type": "application/json" }), body }).catch(() => null)
    if (!res || !res.ok) {
      // Si el servidor no confirmó el cambio, revertimos tanto el estado
      // visible como el respaldo local: sin esto quedaban desincronizados
      // (la UI mostraba "libre" pero el próximo reload volvía a mostrarlo
      // bloqueado porque el localStorage sí había quedado guardado).
      const revertBlocks = readLocalBlocks()
      if (state === "blocked") revertBlocks[key] = { barberId: agendaBarber, date: dayKey, slot }
      else delete revertBlocks[key]
      writeLocalBlocks(revertBlocks)
      setAvailability(previous)
      setAgendaError(res?.status === 401 || res?.status === 403
        ? "Tu sesión expiró. Vuelve a iniciar sesión para editar la agenda."
        : "No se pudo guardar el cambio en el servidor. Revisa tu conexión e inténtalo de nuevo.")
    }
    setAgendaBusy("")
  }

  // Bloquea/habilita varios horarios de una sola vez (mañana, tarde, día completo
  // o la semana entera). Actualiza la UI al instante y dispara los requests en
  // paralelo (antes iban uno por uno, en serie, lo que multiplicaba la espera
  // por la cantidad de horarios tocados).
  const bulkAgenda = async (scope, mode) => {
    const days = scope === "week" ? weekDays.map((d) => d.key) : [agendaDayKey]
    const wantsBlocked = mode === "block"
    const slotsInScope = AGENDA_SLOTS.filter((t) => {
      if (scope === "morning") return Number(t.slice(0, 2)) < 12
      if (scope === "afternoon") return Number(t.slice(0, 2)) >= 12
      return true
    })
    setAgendaBusy(`bulk-${scope}-${mode}`)
    setAgendaError("")
    const localBlocks = readLocalBlocks()
    const ops = []
    const nextAvailability = { ...availability }
    for (const dayKey of days) {
      const dayAvailability = availability[dayKey] || []
      nextAvailability[dayKey] = dayAvailability.map((item) => {
        if (!slotsInScope.includes(item.slot) || item.state === "booked") return item
        if ((wantsBlocked && item.state === "blocked") || (!wantsBlocked && item.state === "free")) return item
        const key = localBlockKey(agendaBarber, dayKey, item.slot)
        if (wantsBlocked) localBlocks[key] = { barberId: agendaBarber, date: dayKey, slot: item.slot }
        else delete localBlocks[key]
        ops.push({ dayKey, slot: item.slot })
        return { ...item, available: !wantsBlocked, state: wantsBlocked ? "blocked" : "free" }
      })
    }
    writeLocalBlocks(localBlocks)
    setAvailability(nextAvailability)
    const results = await Promise.all(ops.map(({ dayKey, slot }) =>
      fetch("/api/availability", {
        method: wantsBlocked ? "POST" : "DELETE",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ barberId: agendaBarber, date: dayKey, slot, reason: "Bloqueado desde agenda interna" }),
      }).then((res) => ({ dayKey, slot, ok: res.ok, status: res.status })).catch(() => ({ dayKey, slot, ok: false, status: 0 }))
    ))
    const failed = results.filter((r) => !r.ok)
    if (failed.length) {
      // Revierte solo los horarios que el servidor rechazó (state + respaldo
      // local), dejando los que sí se guardaron.
      const revertBlocks = readLocalBlocks()
      // El valor previo al intento es el opuesto de lo que quisimos aplicar:
      // si queríamos bloquear (wantsBlocked) es porque antes estaba libre, y
      // viceversa.
      const prevState = wantsBlocked ? "free" : "blocked"
      const prevAvailable = wantsBlocked
      setAvailability((current) => {
        const next = { ...current }
        for (const { dayKey, slot } of failed) {
          const key = localBlockKey(agendaBarber, dayKey, slot)
          if (prevState === "blocked") revertBlocks[key] = { barberId: agendaBarber, date: dayKey, slot }
          else delete revertBlocks[key]
          next[dayKey] = (next[dayKey] || []).map((item) => item.slot === slot
            ? { ...item, available: prevAvailable, state: prevState }
            : item)
        }
        return next
      })
      writeLocalBlocks(revertBlocks)
      setAgendaError(failed.some((r) => r.status === 401 || r.status === 403)
        ? "Tu sesión expiró. Vuelve a iniciar sesión para editar la agenda."
        : `No se pudieron guardar ${failed.length} de ${ops.length} horarios. Revisa tu conexión e inténtalo de nuevo.`)
    }
    setAgendaBusy("")
  }

  // Salta a Reservas con el día enfocado (mismo patrón que usan GlobalSearch y
  // el resumen para "próxima cita"): clickear una hora reservada en la agenda
  // ahora lleva al detalle real de esa reserva en vez de estar deshabilitada.
  const goToDayInReservas = (dayKey) => { setTab("reservas"); setInboxFocus({ day: dayKey, ts: Date.now() }) }

  // Acceso rápido contextual desde Resumen: salta a Reservas con el filtro
  // "Pendientes" ya aplicado y el rango en "Todas" (las pendientes pueden ser
  // de cualquier fecha, no solo hoy).
  const goToPendingInReservas = () => { setTab("reservas"); setInboxFocus({ day: isoDate(new Date()), ts: Date.now(), filter: "Pendientes", scope: "todas" }) }

  // Totales de la semana visible (no solo del día seleccionado): permite ver
  // de un vistazo cuántas horas quedan libres/bloqueadas antes de publicar la
  // semana siguiente.
  const weekStats = weekDays.reduce((acc, d) => {
    const daySlots = availability[d.key] || []
    acc.booked += daySlots.filter((s) => s.state === "booked").length
    acc.free += daySlots.filter((s) => s.state === "free").length
    acc.blocked += daySlots.filter((s) => s.state === "blocked").length
    return acc
  }, { booked: 0, free: 0, blocked: 0 })

  // El cliente solo puede reservar dentro de los próximos 7 días, así que la
  // agenda del barbero se administra semana por semana: "esta semana" y la
  // "semana siguiente" (la única que tiene sentido dejar preparada con
  // anticipación). Cambiar de semana reubica el día seleccionado si el
  // actual no pertenece a la semana nueva.
  const goToWeek = (offset) => {
    const wd = buildWeek(offset)
    setWeekOffset(offset)
    if (!wd.some((d) => d.key === agendaDayKey)) setAgendaDayKey(wd[0].key)
  }

  // Date-picker propio de Agenda: solo las 2 semanas administrables (offset 0
  // y 1) son elegibles — el cliente no puede reservar más allá de 7 días.
  const calPrevMonth = () => setCalMonth((m) => { if (m === 0) { setCalYear((y) => y - 1); return 11 } return m - 1 })
  const calNextMonth = () => setCalMonth((m) => { if (m === 11) { setCalYear((y) => y + 1); return 0 } return m + 1 })
  const pickCalendarDay = (key) => {
    setCalOpen(false)
    if (buildWeek(0).some((d) => d.key === key)) { setWeekOffset(0); setAgendaDayKey(key); return }
    if (buildWeek(1).some((d) => d.key === key)) { setWeekOffset(1); setAgendaDayKey(key); return }
    pushToast("📅", "Fecha fuera del rango reservable (7 días)")
  }

  if (!barber) return null

  return (
    <DashboardShell
      tab={tab}
      setTab={setTab}
      nav={visibleNav}
      dockItems={dockItems}
      barber={barber}
      onLogout={logout}
      onNewBooking={() => setNewBookingOpen(true)}
    >
      <main className="dashboard-main" onScroll={(e) => setTopbarScrolled(e.currentTarget.scrollTop > 4)}>
        <DashboardTopbar
          title={nav.find((n) => n[0] === tab)?.[2] || 'Panel'}
          barber={barber}
          onLogout={logout}
          tab={tab}
          setTab={setTab}
          nav={visibleNav}
          navigate={navigate}
          onRefresh={refreshAll}
          refreshing={refreshing}
          scrolled={topbarScrolled}
          search={(
            <GlobalSearch
              clients={clients}
              bookings={visibleBookings}
              onPickClient={(c) => { setTab('clientes'); openClient(c) }}
              onPickBooking={(b) => { setTab('reservas'); setInboxFocus({ day: b.date, ts: Date.now() }) }}
            />
          )}
        />

        {/* RESUMEN */}
        {tab === "resumen" && (
          <div style={{ display: "grid", gap: "1.1rem" }}>
            <BookingSyncIssues />
            <DashboardResumen bookings={bookings} barbers={barbers} expenses={expenses} clients={clients} todaySlots={availability[isoDate(new Date())] || []} onNewBooking={() => setNewBookingOpen(true)} onGoToPending={goToPendingInReservas} />
          </div>
        )}

        {/* AGENDA */}
        {tab === "agenda" && agendaDayKey && (
          <div className="animate-in" style={{ display: "grid", gap: "1.1rem" }}>
            {agendaError && (
              <div className="card" style={{ padding: ".8rem 1rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".8rem", border: "1px solid rgba(217,154,143,.4)", background: "rgba(217,154,143,.08)" }}>
                <span style={{ fontSize: ".82rem", color: "#d99a8f" }}>{agendaError}</span>
                <button type="button" className="btn btn-dark btn-sm" onClick={() => setAgendaError("")}>Cerrar</button>
              </div>
            )}

            {/* Cabecera propia del módulo: el topbar global ya trae título/tema/
                campana/avatar/buscador general — acá solo va el kicker y un
                buscador LOCAL de las reservas del día visible. */}
            <div className="agenda-topline">
              <span className="agenda-kicker">PANEL INTERNO</span>
              <div className="agenda-search">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" />
                </svg>
                <input
                  className="agenda-search-input"
                  placeholder="Buscar reserva del día…"
                  value={agendaQuery}
                  onChange={(e) => setAgendaQuery(e.target.value)}
                />
                {agendaQuery && (
                  <button type="button" className="agenda-search-clear" onClick={() => setAgendaQuery("")} aria-label="Limpiar búsqueda">
                    <Icon name="close" size={12} />
                  </button>
                )}
              </div>
            </div>

            {/* HERO: ocupación del día + KPIs de la semana + próxima cita. */}
            {(() => {
              const daySlots = availability[agendaDayKey] || []
              const bookedDay = daySlots.filter((s) => s.state === "booked").length
              const freeDay = daySlots.filter((s) => s.state === "free").length
              const dayOcc = (bookedDay + freeDay) ? Math.round((bookedDay / (bookedDay + freeDay)) * 100) : 0
              const [dy, dm, dd] = agendaDayKey.split("-").map(Number)
              const dateObj = new Date(dy, dm - 1, dd)
              const longDate = `${DOW_LONG[dateObj.getDay()]} ${dd} de ${MONTH_LONG[dm - 1]}`
              const weekSuffix = weekOffset === 0 ? "esta semana" : "próx. semana"
              const dayBookingsToday = visibleBookings
                .filter((b) => b.date === agendaDayKey && b.status !== "cancelada")
                .sort((a, b) => (a.time || "").localeCompare(b.time || ""))
              const nextBooking = dayBookingsToday[0]
              // Nuevos vs recurrentes del día: cruza por teléfono con el
              // registro de clientes (visits > 1 = recurrente).
              let newCount = 0, recurringCount = 0
              dayBookingsToday.forEach((b) => {
                const c = clients.find((item) => cleanPhone(item.phone) === cleanPhone(b.phone))
                if (c && Number(c.visits || 0) > 1) recurringCount += 1
                else newCount += 1
              })
              // Deltas vs. la semana anterior: si no hay datos previos fiables
              // (API caída), no se inventan cifras — se ocultan.
              const weekDelta = prevWeekStats ? {
                booked: weekStats.booked - prevWeekStats.booked,
                free: weekStats.free - prevWeekStats.free,
                blocked: weekStats.blocked - prevWeekStats.blocked,
              } : null
              return (
                <div className="dk-hero">
                  <div className="dk-hero-grid cols-6 dk-stagger">
                    <div className="dk-hero-lead">
                      <AnimatedRing pct={dayOcc} size={84} label="del día" />
                      <div>
                        <span className="agenda-kicker agenda-kicker-hero">AGENDA DE BRUNETTI</span>
                        <h2 className="dk-hero-title">{longDate}</h2>
                        <span className="dk-hero-sub">{bookedDay}/{bookedDay + freeDay} horas reservadas hoy</span>
                        <span className="agenda-next-chip">
                          <Icon name="clock" size={11} /> Próximo: {nextBooking ? `${nextBooking.client} · ${nextBooking.time}` : "sin reservas"}
                        </span>
                      </div>
                    </div>
                    <KpiTile icon="calendar" label={`Reservados · ${weekSuffix}`} value={weekStats.booked} delta={weekDelta?.booked} />
                    <KpiTile icon="clock" label={`Disponibles · ${weekSuffix}`} value={weekStats.free} suffix="h" color="var(--green)" delta={weekDelta?.free} />
                    <KpiTile icon="trend" label={`Bloqueados · ${weekSuffix}`} value={weekStats.blocked} color="var(--red)" delta={weekDelta?.blocked} />
                    <KpiTile icon="user" label="Nuevos vs recurrentes" value={newCount} format={(n) => `${n}/${recurringCount}`} sub={`${recurringCount} recurrentes hoy`} />
                    <button className="btn btn-gold" style={{ display: "inline-flex", alignItems: "center", gap: ".5rem", alignSelf: "center" }} onClick={() => setNewBookingOpen(true)}>
                      <Icon name="plus" size={16} /> Nueva reserva
                    </button>
                  </div>
                </div>
              )
            })()}
            <div className="agenda-controls">
              {/* Selector de barbero retirado: la agenda es exclusiva de Brunetti.
                  (Se conserva agendaBarber fijado a Bruno para la API de disponibilidad.) */}
              {/* La agenda se administra semana por semana: el cliente solo puede
                  reservar dentro de los próximos 7 días, así que no tiene sentido
                  exponer más de "esta semana" y la "semana siguiente". */}
              <div className="agenda-bulk-actions">
                <button type="button" className={`btn btn-sm ${weekOffset === 0 ? "btn-gold" : "btn-dark"}`} onClick={() => goToWeek(0)}>
                  Esta semana
                </button>
                <button type="button" className={`btn btn-sm ${weekOffset === 1 ? "btn-gold" : "btn-dark"}`} onClick={() => goToWeek(1)}>
                  Semana siguiente
                </button>
                {/* El botón de calendario vive acá (no en la franja de días): a 320px
                    de ancho, sacarlo de esa fila es lo que hace viable mostrar los
                    7 días en una grilla sin scroll horizontal. */}
                <div className="agenda-cal-wrap" ref={calRef}>
                  <button type="button" className="btn btn-dark btn-sm agenda-cal-btn" onClick={() => setCalOpen((v) => !v)} aria-label="Elegir fecha">
                    <Icon name="calendar" size={14} />
                  </button>
                  {calOpen && (
                    <AgendaDatePicker
                      month={calMonth}
                      year={calYear}
                      selectedKey={agendaDayKey}
                      onPrevMonth={calPrevMonth}
                      onNextMonth={calNextMonth}
                      onPick={pickCalendarDay}
                      reservableKeys={new Set([...buildWeek(0), ...buildWeek(1)].map((d) => d.key))}
                    />
                  )}
                </div>
              </div>
              <div className="daypick daypick-sticky" role="group" aria-label="Día de la semana">
                {weekDays.map((d) => {
                  const isActive = d.key === agendaDayKey
                  const isToday = d.key === isoDate(new Date())
                  const hasBookings = (availability[d.key] || []).some((s) => s.state === "booked")
                  const [dow, num] = d.label.split(" ")
                  return (
                    <button
                      key={d.key}
                      type="button"
                      className={`daypick-btn ${isActive ? "is-active" : ""} ${isToday ? "is-today" : ""}`}
                      aria-pressed={isActive}
                      onClick={() => setAgendaDayKey(d.key)}
                    >
                      <span className="dp-dow">{isToday ? "Hoy" : dow}</span>
                      <span className="dp-num">{num}</span>
                      <span className="dp-ind">{hasBookings && <span className="dp-dot" />}</span>
                    </button>
                  )
                })}
              </div>
              {/* Antes eran 6 botones sueltos (mañana/tarde/día/semana × bloquear/
                  habilitar) todos visibles a la vez. Mañana/tarde ahora son un
                  toggle contextual junto al título de cada periodo (más abajo);
                  acá solo quedan día completo y semana completa, y cada uno es
                  un único botón cuya etiqueta cambia según el estado actual. */}
              <div className="agenda-bulk-actions agenda-bulk-row">
                {(() => {
                  const dayFree = (availability[agendaDayKey] || []).filter((s) => s.state === "free").length
                  const dayIsBlocked = dayFree === 0
                  const weekIsBlocked = weekStats.free === 0
                  return (
                    <>
                      <button type="button" className={`btn btn-sm ${dayIsBlocked ? "btn-gold" : "btn-dark"}`} disabled={!!agendaBusy} onClick={() => { bulkAgenda("day", dayIsBlocked ? "enable" : "block"); pushToast(dayIsBlocked ? "✓" : "✕", dayIsBlocked ? "Día habilitado" : "Día bloqueado") }}>
                        <Icon name={dayIsBlocked ? "check" : "close"} size={13} /> {dayIsBlocked ? "Habilitar" : "Bloquear"} día completo
                      </button>
                      <button type="button" className={`btn btn-sm ${weekIsBlocked ? "btn-gold" : "btn-dark"}`} disabled={!!agendaBusy} onClick={() => { bulkAgenda("week", weekIsBlocked ? "enable" : "block"); pushToast(weekIsBlocked ? "✓" : "✕", weekIsBlocked ? "Semana habilitada" : "Semana bloqueada") }}>
                        <Icon name={weekIsBlocked ? "check" : "close"} size={13} /> {weekIsBlocked ? "Habilitar" : "Bloquear"} semana completa
                      </button>
                    </>
                  )
                })()}
                <span className="agenda-drag-hint">Arrastra sobre las horas para bloquear un rango ⇄</span>
              </div>
            </div>
            <div className="agenda-layout">
              <Panel
                title={`${(barbers.find((item) => item.id === agendaBarber) || barberById(agendaBarber))?.name || "Barbero"}`}
                action={(
                  <div style={{ display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <span className="chip chip-gold">{(availability[agendaDayKey] || []).filter((s) => s.state === "free").length} libres</span>
                    <div className="agenda-view-toggle" role="group" aria-label="Vista de la agenda">
                      <button type="button" className={`agenda-view-tab ${agendaView === "grid" ? "is-on" : ""}`} onClick={() => setAgendaView("grid")}>▦ Bloques</button>
                      <button type="button" className={`agenda-view-tab ${agendaView === "timeline" ? "is-on" : ""}`} onClick={() => setAgendaView("timeline")}>☰ Línea</button>
                    </div>
                  </div>
                )}
              >
                <div className="agenda-legend">
                  <span><i className="free" /> Atiende</span>
                  <span><i className="blocked" /> Bloqueado</span>
                  <span><i className="booked" /> Reservado</span>
                </div>
                {agendaView === "grid" && ["MAÑANA", "TARDE"].map((label) => {
                  const slots = AGENDA_SLOTS.filter((t) => label === "MAÑANA" ? Number(t.slice(0, 2)) < 12 : Number(t.slice(0, 2)) >= 12)
                  const periodStates = slots.map((t) => (availability[agendaDayKey] || []).find((item) => item.slot === t))
                  const periodIsBlocked = periodStates.every((s) => s?.state !== "free")
                  return (
                    <div key={label} className="agenda-period">
                      <div className="agenda-period-head">
                        <p className="agenda-period-title">{label}</p>
                        <button
                          type="button"
                          className={`agenda-period-toggle ${periodIsBlocked ? "is-blocked" : ""}`}
                          disabled={!!agendaBusy}
                          onClick={() => { bulkAgenda(label === "MAÑANA" ? "morning" : "afternoon", periodIsBlocked ? "enable" : "block"); pushToast(periodIsBlocked ? "✓" : "✕", `${label === "MAÑANA" ? "Mañana" : "Tarde"} ${periodIsBlocked ? "habilitada" : "bloqueada"}`) }}
                        >
                          {periodIsBlocked ? "Habilitar" : "Bloquear"}
                        </button>
                      </div>
                      <div className="agenda-tile-grid">
                        {slots.map((t) => {
                          const slotInfo = (availability[agendaDayKey] || []).find((item) => item.slot === t)
                          const state = slotInfo?.state || (slotInfo?.available === false ? "blocked" : "free")
                          const busy = agendaBusy === `${agendaDayKey}-${t}`
                          const bk = state === "booked" ? bookingForSlot(agendaDayKey, t) : null
                          const tag = state === "booked" ? "Reservado" : state === "blocked" ? "Bloqueado" : "Libre"
                          const applyToggle = () => {
                            toggleSlot(agendaDayKey, t, state)
                            pushToast(state === "free" ? "✕" : "✓", state === "free" ? `${t} bloqueado` : `${t} habilitado`)
                          }
                          return (
                            <button
                              key={t}
                              className={`agenda-tile ${state}`}
                              disabled={busy}
                              onMouseDown={() => {
                                if (state === "booked") return
                                dragRef.current = { active: true, mode: state === "free" ? "block" : "enable" }
                                applyToggle()
                              }}
                              onTouchStart={() => {
                                if (state === "booked") return
                                dragRef.current = { active: true, mode: state === "free" ? "block" : "enable" }
                              }}
                              onMouseEnter={() => {
                                if (!dragRef.current.active || state === "booked") return
                                const { mode } = dragRef.current
                                if ((mode === "block" && state === "free") || (mode === "enable" && state === "blocked")) applyToggle()
                              }}
                              onClick={() => { if (state === "booked" && bk) setDetail(bk) }}
                              title={state === "booked" ? (bk ? `${bk.client} · ${bk.service}` : "Reservado") : state === "blocked" ? "Tocar para atender" : "Tocar para bloquear"}
                            >
                              <span className="agenda-tile-h">{busy ? "…" : t}</span>
                              <span className="agenda-tile-tag">{tag}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
                {agendaView === "timeline" && (
                  <div className="agenda-timeline">
                    {AGENDA_SLOTS.map((t) => {
                      const slotInfo = (availability[agendaDayKey] || []).find((item) => item.slot === t)
                      const state = slotInfo?.state || (slotInfo?.available === false ? "blocked" : "free")
                      const bk = state === "booked" ? bookingForSlot(agendaDayKey, t) : null
                      return (
                        <div
                          key={t}
                          className={`agenda-tl-row ${state}`}
                          onClick={() => { if (state === "booked" && bk) setDetail(bk) }}
                          role={state === "booked" ? "button" : undefined}
                        >
                          <span className="agenda-tl-time">{t}</span>
                          <span className={`agenda-tl-rail ${state}`} />
                          <div className="agenda-tl-card">
                            {state === "booked" ? (
                              <>
                                <div className="agenda-tl-info">
                                  <strong>{bk?.client || "Reservado"}</strong>
                                  <span>{bk?.service}</span>
                                </div>
                                <span className={`agenda-tl-badge ${bk?.status === "confirmada" ? "is-gold" : ""}`}>{bk?.status === "confirmada" ? "confirmada" : "pendiente"}</span>
                              </>
                            ) : state === "blocked" ? (
                              <span className="agenda-tl-empty">Bloqueado</span>
                            ) : (
                              <>
                                <span className="agenda-tl-empty">Disponible</span>
                                <span className="agenda-tl-badge">Libre</span>
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </Panel>
              <Panel title="Reservas del día" action={<span className="chip">{(weekDays.find((d) => d.key === agendaDayKey)?.label) || ""}</span>}>
                <div className="agenda-day-panel">
                  {visibleBookings
                    .filter((b) => b.date === agendaDayKey && b.status !== "cancelada")
                    .filter((b) => {
                      const q = agendaQuery.trim().toLowerCase()
                      if (!q) return true
                      return `${b.client || ""} ${b.service || ""}`.toLowerCase().includes(q)
                    })
                    .sort((a, b) => (a.time || "").localeCompare(b.time || ""))
                    .map((b) => (
                      <button key={b.id || `${b.date}-${b.time}-${b.client}`} type="button" className="agenda-day-booking" onClick={() => setDetail(b)}>
                        <span className="adb-time">{b.time}</span>
                        <span className="adb-info">
                          <strong>{b.client}</strong>
                          <span>{b.service}</span>
                        </span>
                        <span className={`chip ${b.status === "confirmada" ? "chip-gold" : ""}`} style={{ fontSize: ".64rem" }}>{b.status}</span>
                      </button>
                    ))}
                  {!visibleBookings.some((b) => b.date === agendaDayKey && b.status !== "cancelada") && (
                    <div className="empty-state">Sin reservas este día.</div>
                  )}
                </div>
              </Panel>
            </div>
          </div>
        )}

        {/* RESERVAS */}
        {tab === "reservas" && (
          <BookingsInbox
            bookings={visibleBookings}
            barbers={barbers}
            barber={barber}
            admin={admin}
            slotsPerDay={AGENDA_SLOTS.length}
            onStatus={(bk, status) => updateBookingStatus(bk, status)}
            onDelete={deleteBooking}
            onReschedule={() => setTab("agenda")}
            onNewBooking={() => setNewBookingOpen(true)}
            focus={inboxFocus}
          />
        )}

        {/* FINANZAS */}
        {tab === "finanzas" && (
          <div className="animate-in" style={{ display: "grid", gap: "1.1rem" }}>
            <div className="fin-toolbar">
              <div className="psn-seg" role="group" aria-label="Periodo">
                <button type="button" className={financePeriod === "semana" ? "is-on" : ""} onClick={() => setFinancePeriod("semana")}>Semana</button>
                <button type="button" className={financePeriod === "mes" ? "is-on" : ""} onClick={() => setFinancePeriod("mes")}>Mes</button>
                <button type="button" className={financePeriod === "año" ? "is-on" : ""} onClick={() => setFinancePeriod("año")}>Año</button>
              </div>
              <button type="button" className="btn btn-dark btn-sm" onClick={() => exportCSV("Finanzas")}>
                <Icon name="wallet" size={13} /> Exportar CSV
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: "1rem" }}>
              <Stat icon="wallet"   label="Ingresos del periodo" value={CLP(revenueTotal)} accent />
              <Stat icon="chart"    label="Ticket promedio" value={CLP(avgTicket)} />
              <Stat icon="scissors" label="Servicios"       value={completedBookings.length} />
              <Stat icon="wallet"   label="Gastos del mes"  value={CLP(monthExpensesTotal)} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: "1.1rem" }}>
              <Panel title="Ingresos por día">
                {revenueByDate.length
                  ? <BarChart data={revenueByDate} fmt={CLP} />
                  : <p style={{ color: "var(--muted)", fontSize: ".84rem" }}>Sin datos en este periodo.</p>}
              </Panel>
              <Panel title="Ingresos por servicio">
                <div style={{ display: "grid", gap: ".75rem" }}>
                  {!revenueByService.length && <p style={{ color: "var(--muted)", fontSize: ".84rem" }}>Sin datos en este periodo.</p>}
                  {revenueByService.slice(0, 5).map((item) => {
                    const p = Math.round((item.total / Math.max(1, revenueTotal)) * 100)
                    return (
                      <div key={item.name} style={{ display: "grid", gap: ".3rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".82rem" }}><span style={{ color: "var(--ink-soft)" }}>{item.name}</span><span className="gold-text" style={{ fontWeight: 600 }}>{p}%</span></div>
                        <div style={{ height: 6, borderRadius: 99, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}><div style={{ height: "100%", width: `${p}%`, background: "var(--gold-grad)", borderRadius: 99 }} /></div>
                      </div>
                    )
                  })}
                </div>
              </Panel>
            </div>
            <Panel title="Ingresos por barbero">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: ".8rem" }}>
                {!ranking.length && <p style={{ color: "var(--muted)", fontSize: ".84rem" }}>Sin datos en este periodo.</p>}
                {ranking.map((r) => {
                  const b = barbers.find((item) => item.id === r.id) || barberById(r.id)
                  return (
                    <div key={r.id} style={{ padding: "1rem", border: "1px solid var(--hair)", borderRadius: 12, background: "rgba(0,0,0,0.25)" }}>
                      <span style={{ fontSize: ".8rem", color: "var(--muted)", display: "block", marginBottom: ".3rem" }}>{b?.short}</span>
                      <span className="font-display gold-text" style={{ fontSize: "1.1rem", fontWeight: 700 }}>{CLP(r.rev)}</span>
                      <span style={{ fontSize: ".72rem", color: "var(--muted-2)", display: "block", marginTop: ".2rem" }}>{r.cuts} servicios</span>
                    </div>
                  )
                })}
              </div>
            </Panel>

            <Panel title="Movimientos" action={<span className="chip">{sortedFinanceRows.length} en el periodo</span>}>
              <div className="fin-table-head" style={{ "--fin-cols": admin ? "100px 1.3fr 1.1fr 110px 90px 100px" : "100px 1.3fr 1.1fr 90px 100px" }}>
                <button type="button" onClick={() => toggleFinanceSort("date")} className={financeSort.key === "date" ? "is-sorted" : ""}>Fecha {financeSort.key === "date" && (financeSort.dir === "asc" ? "↑" : "↓")}</button>
                <button type="button" onClick={() => toggleFinanceSort("client")} className={financeSort.key === "client" ? "is-sorted" : ""}>Cliente {financeSort.key === "client" && (financeSort.dir === "asc" ? "↑" : "↓")}</button>
                <button type="button" onClick={() => toggleFinanceSort("service")} className={financeSort.key === "service" ? "is-sorted" : ""}>Servicio {financeSort.key === "service" && (financeSort.dir === "asc" ? "↑" : "↓")}</button>
                {admin && <button type="button" onClick={() => toggleFinanceSort("barber")} className={financeSort.key === "barber" ? "is-sorted" : ""}>Barbero {financeSort.key === "barber" && (financeSort.dir === "asc" ? "↑" : "↓")}</button>}
                <button type="button" onClick={() => toggleFinanceSort("price")} className={financeSort.key === "price" ? "is-sorted" : ""}>Precio {financeSort.key === "price" && (financeSort.dir === "asc" ? "↑" : "↓")}</button>
                <span>Estado</span>
              </div>
              <div className="fin-mov-scroll">
                <div className="fin-mov-list">
                  {sortedFinanceRows.map((b) => {
                    const bb = barberById(b.barberId)
                    return (
                      <div key={b.id} className="fin-row" style={{ "--fin-cols": admin ? "100px 1.3fr 1.1fr 110px 90px 100px" : "100px 1.3fr 1.1fr 90px 100px" }}>
                        <div className="fin-c-date"><strong>{b.date?.slice(5)}</strong><span>{b.time}</span></div>
                        <div className="fin-c-client"><strong>{b.client}</strong></div>
                        <div className="fin-c-svc"><span>{b.service}</span></div>
                        {admin && <div className="fin-c-barber"><span>{bb?.short || bb?.name || "—"}</span></div>}
                        <div className="fin-c-price"><strong className="gold-text">{CLP(b.price)}</strong></div>
                        <span className="chip fin-c-status">{b.status}</span>
                      </div>
                    )
                  })}
                  {!sortedFinanceRows.length && (
                    <div className="empty-state" style={{ display: "grid", gap: ".7rem", justifyItems: "center" }}>
                      <span>Sin movimientos en este periodo.</span>
                      <button type="button" className="btn btn-gold btn-sm" onClick={() => setNewBookingOpen(true)}>
                        <Icon name="calendar" size={14} /> Nueva reserva
                      </button>
                    </div>
                  )}
                </div>
                {sortedFinanceRows.length > 0 && (
                  <div className="fin-row-total">
                    <span>Total del periodo</span>
                    <b className="gold-text">{CLP(revenueTotal)}</b>
                  </div>
                )}
              </div>
            </Panel>
          </div>
        )}

        {/* CLIENTES */}
        {tab === "clientes" && (
          <div className="animate-in" style={{ display: "grid", gap: "1.1rem" }}>
            <div className="client-filter-grid">
              <button type="button" className={`client-filter-card ${clientFilter === "active" ? "is-active" : ""}`} onClick={() => setClientFilter((f) => f === "active" ? "all" : "active")}>
                <span className="cf-ic"><Icon name="user" size={16} /></span>
                <span className="cf-body"><strong>{activeClients.length}</strong><span className="cf-label">Activos</span></span>
              </button>
              <button type="button" className={`client-filter-card ${clientFilter === "inactive" ? "is-active" : ""}`} onClick={() => setClientFilter((f) => f === "inactive" ? "all" : "inactive")}>
                <span className="cf-ic"><Icon name="clock" size={16} /></span>
                <span className="cf-body"><strong>{inactiveClients.length}</strong><span className="cf-label">Inactivos 30+ días</span></span>
              </button>
              <button type="button" className={`client-filter-card ${clientFilter === "top" ? "is-active" : ""}`} onClick={() => setClientFilter((f) => f === "top" ? "all" : "top")}>
                <span className="cf-ic"><Icon name="star" size={16} /></span>
                <span className="cf-body"><strong>{topClients.length}</strong><span className="cf-label">Más activos</span></span>
              </button>
            </div>
            <Panel
              title="Panel de clientes"
              action={(
                <div style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
                  <span className="chip chip-gold">Teléfono como ID</span>
                  <button className="btn btn-gold btn-sm" onClick={() => setNewClientOpen(true)}>
                    <Icon name="user" size={14} /> Nuevo
                  </button>
                </div>
              )}
            >
              <div className="client-search">
                <Icon name="user" size={15} />
                <input value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} placeholder="Buscar por nombre, telefono o correo" />
              </div>
              <div className="client-table-head">
                <button type="button" onClick={() => toggleClientSort("name")} className={clientSort.key === "name" ? "is-sorted" : ""}>
                  Cliente {clientSort.key === "name" && (clientSort.dir === "asc" ? "↑" : "↓")}
                </button>
                <button type="button" onClick={() => toggleClientSort("visits")} className={clientSort.key === "visits" ? "is-sorted" : ""}>
                  Visitas {clientSort.key === "visits" && (clientSort.dir === "asc" ? "↑" : "↓")}
                </button>
                <button type="button" onClick={() => toggleClientSort("totalSpent")} className={clientSort.key === "totalSpent" ? "is-sorted" : ""}>
                  Total {clientSort.key === "totalSpent" && (clientSort.dir === "asc" ? "↑" : "↓")}
                </button>
                <span />
              </div>
              <div className="client-list">
                {sortedClients.map((client) => (
                  <div key={client.id || client.phone} className="client-row" onClick={() => openClient(client)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') openClient(client) }}>
                    <div style={{ minWidth: 0 }}>
                      <strong>{client.name}</strong>
                      <span>+56 {client.phone} · {client.email || "sin correo"}</span>
                    </div>
                    <div>
                      <strong>{client.visits || 0}</strong>
                      <span>
                        visitas
                        {client.loyalty && (
                          <span className="chip chip-gold" style={{ marginLeft: ".35rem", fontSize: ".62rem", padding: ".1rem .35rem" }} title={`${client.loyalty.stars} de ${client.loyalty.goal} estrellas`}>
                            <Icon name="star" size={9} /> {client.loyalty.stars}
                          </span>
                        )}
                      </span>
                    </div>
                    <div><strong>{CLP(client.totalSpent || 0)}</strong><span>{client.lastVisit || "sin visitas"}</span></div>
                    <div style={{ display: "flex", gap: ".3rem", justifyContent: "flex-end" }}>
                      {/* Enviar la tarjeta por WhatsApp: solo a quien todavía no
                          la tiene agregada — a los demás no hay nada que
                          ofrecerles. */}
                      {!client.walletHasPass && (
                        <button className="btn btn-dark btn-sm client-row-edit" title="Enviar tarjeta de fidelización por WhatsApp"
                          onClick={(e) => { e.stopPropagation(); sendLoyaltyCard(client) }}>
                          <Icon name="wallet" size={13} /> <span className="btn-label">Tarjeta</span>
                        </button>
                      )}
                      <button className="btn btn-dark btn-sm client-row-edit" onClick={(e) => { e.stopPropagation(); openClient(client, { edit: true }) }}>
                        <Icon name="user" size={13} /> <span className="btn-label">Editar</span>
                      </button>
                    </div>
                  </div>
                ))}
                {!sortedClients.length && (
                  <div className="empty-state" style={{ display: "grid", gap: ".7rem", justifyItems: "center" }}>
                    <span>No hay clientes que coincidan con la busqueda.</span>
                    <button type="button" className="btn btn-gold btn-sm" onClick={() => setNewClientOpen(true)}>
                      <Icon name="user" size={14} /> Nuevo cliente
                    </button>
                  </div>
                )}
              </div>
            </Panel>
          </div>
        )}

        {tab === "clientes" && selectedClient && (
          <ClientModal
            client={selectedClient}
            history={clientHistory}
            barbers={barbers}
            startEditing={clientEditing}
            onClose={() => setSelectedClient(null)}
            onSave={saveClient}
            onDelete={deleteClient}
            onSchedule={() => navigate("/reservar")}
          />
        )}

        {/* INSCRIPCIONES */}
        {tab === "inscripciones" && (
          <EnrollmentsPanel />
        )}

        {/* SERVICIOS */}
        {tab === "servicios" && (
          <div className="animate-in" style={{ display: "grid", gap: "1.1rem" }}>
            <button className="btn btn-gold btn-block" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: ".5rem" }} onClick={() => setServiceOpen(true)}>
              <Icon name="spark" size={16} /> Nuevo servicio
            </button>
            <Panel title="Servicios publicados" action={<span className="chip chip-gold">{services.filter((s) => s.active !== false).length} activos</span>}>
              <div className="svc-grid">
                {services.map((svc) => (
                  <button key={svc.id} type="button" className="svc-card" onClick={() => setEditSvcId(svc.id)}>
                    <div className="svc-card-ic"><Icon name={getSvcIcon(svc)} size={20} /></div>
                    <div className="svc-card-name">{svc.name}</div>
                    <div className="svc-card-price">{CLP(svc.price)}</div>
                    <div className="svc-card-meta"><Icon name="clock" size={11} /> {svc.min} min · bloquea {minToBlocks(svc.min)}h · {svc.cat}</div>
                    <span className={svc.active === false ? "chip" : "chip chip-gold"} style={{ fontSize: ".68rem" }}>{svc.active === false ? "Oculto" : "Publicado"}</span>
                  </button>
                ))}
              </div>
            </Panel>
          </div>
        )}

        {/* DRAWER edición de servicio (antes expandía la card a fila completa) */}
        {tab === "servicios" && editSvcId != null && (() => {
          const svc = services.find((item) => item.id === editSvcId)
          if (!svc) return null
          return (
            <div className="psn-modal is-drawer" role="dialog" aria-modal="true">
              <button className="psn-scrim" aria-label="Cerrar" onClick={() => setEditSvcId(null)} />
              <div className="psn-modal-card psn-newbk psn-drawer-card">
                <button className="psn-close" onClick={() => setEditSvcId(null)} aria-label="Cerrar"><Icon name="close" size={17} /></button>
                <h3><Icon name={getSvcIcon(svc)} size={20} /> Editar servicio</h3>
                <div className="psn-newbk-sec">
                  <label className="dk-field-lbl">Nombre</label>
                  <input className="input" value={svc.name} onChange={(e) => setServices((items) => items.map((item) => item.id === svc.id ? { ...item, name: e.target.value } : item))} />
                </div>
                <div className="psn-newbk-sec" style={{ gridTemplateColumns: "1fr 1fr", display: "grid", gap: ".5rem" }}>
                  <div><label className="dk-field-lbl">Precio</label><input className="input" inputMode="numeric" value={svc.price} onChange={(e) => setServices((items) => items.map((item) => item.id === svc.id ? { ...item, price: e.target.value.replace(/\D/g, "") } : item))} /></div>
                  <div>
                    <label className="dk-field-lbl">Bloquea en agenda</label>
                    <div style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
                      <button type="button" className="chip" style={{ padding: ".3rem .6rem" }}
                        onClick={() => setServices((items) => items.map((item) => item.id === svc.id ? { ...item, min: String(blocksToMin(minToBlocks(item.min) - 1)) } : item))}
                        disabled={minToBlocks(svc.min) <= 1}>−</button>
                      <span style={{ flex: 1, textAlign: "center", fontSize: ".85rem" }}>{minToBlocks(svc.min)} {minToBlocks(svc.min) === 1 ? "bloque" : "bloques"}</span>
                      <button type="button" className="chip" style={{ padding: ".3rem .6rem" }}
                        onClick={() => setServices((items) => items.map((item) => item.id === svc.id ? { ...item, min: String(blocksToMin(minToBlocks(item.min) + 1)) } : item))}>+</button>
                    </div>
                  </div>
                </div>
                <p style={{ margin: 0, fontSize: ".7rem", color: "var(--muted)" }}>1 bloque = 1 hora de agenda. Duración real guardada: {svc.min} min.</p>
                <div className="psn-confirm-actions" style={{ gridTemplateColumns: admin ? "1fr 1fr 1fr" : "1fr 1fr" }}>
                  <button className={svc.active === false ? "chip" : "chip chip-gold"} onClick={() => saveService({ ...svc, active: svc.active === false })}>{svc.active === false ? "Oculto" : "Publicado"}</button>
                  {admin && (
                    <button className="btn btn-sm psn-res-delete" onClick={() => setDeleteSvc(svc)}><Icon name="close" size={14} /> Eliminar</button>
                  )}
                  <button className="btn btn-gold btn-sm" onClick={() => { saveService(svc); setEditSvcId(null) }}><Icon name="check" size={14} /> Guardar</button>
                </div>
              </div>
            </div>
          )
        })()}

        {/* ESSENTIALS (tienda de clientes) */}
        {tab === "essentials" && admin && (
          <div className="animate-in" style={{ display: "grid", gap: "1.1rem" }}>
            <button className="btn btn-gold btn-block" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: ".5rem" }} onClick={() => setProductOpen(true)}>
              <Icon name="spark" size={16} /> Nuevo producto
            </button>
            <Panel title="Productos" action={<span className="chip chip-gold">{products.filter((p) => p.active !== false).length} activos</span>}>
              {products.length === 0 ? (
                <p style={{ margin: 0, color: "var(--muted)", fontSize: ".88rem" }}>Aún no hay productos. Crea el primero con el botón de arriba.</p>
              ) : (
                <div className="svc-grid">
                  {products.map((p) => (
                    <button key={p.id} type="button" className="svc-card" onClick={() => setEditProductId(p.id)}>
                      <div className="svc-card-ic" style={{ width: 36, height: 36, overflow: "hidden", padding: 0 }}>
                        {p.imgFront ? <img src={p.imgFront} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Icon name="gift" size={18} />}
                      </div>
                      <div className="svc-card-name">{p.name}</div>
                      <div className="svc-card-price">{CLP(p.price)}</div>
                      <div className="svc-card-meta"><Icon name="wallet" size={11} /> Stock {p.stock}</div>
                      <span className={p.active === false ? "chip" : "chip chip-gold"} style={{ fontSize: ".68rem" }}>{p.active === false ? "Oculto" : "Publicado"}</span>
                    </button>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        )}

        {/* DRAWER edición de producto */}
        {tab === "essentials" && editProductId != null && (() => {
          const p = products.find((item) => item.id === editProductId)
          if (!p) return null
          const slots = [["imgFront", "front", "Portada"], ["imgBack", "back", "Hover"], ["imgDetail", "detail", "Detalle / modal"]]
          return (
            <div className="psn-modal is-drawer" role="dialog" aria-modal="true">
              <button className="psn-scrim" aria-label="Cerrar" onClick={() => setEditProductId(null)} />
              <div className="psn-modal-card psn-newbk psn-drawer-card">
                <button className="psn-close" onClick={() => setEditProductId(null)} aria-label="Cerrar"><Icon name="close" size={17} /></button>
                <h3><Icon name="gift" size={20} /> Editar producto</h3>

                <div style={{ display: "flex", gap: ".6rem", marginBottom: ".2rem" }}>
                  {slots.map(([field, slot, label]) => (
                    <label key={slot} style={{ flex: 1, aspectRatio: "4/5", borderRadius: 10, overflow: "hidden", position: "relative", border: "1px dashed var(--hair-2)", cursor: "pointer", background: "var(--panel)", display: "block" }}>
                      {p[field]
                        ? <img src={p[field]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "var(--muted-2)" }}><Icon name="image" size={18} /></div>}
                      <span style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "2px", textAlign: "center", fontSize: ".58rem", letterSpacing: ".03em", background: "rgba(0,0,0,.55)", color: "#e6cd90" }}>
                        {productUploading === `${p.id}-${slot}` ? "Subiendo…" : label}
                      </span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
                        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadProductPhoto(p.id, slot, f) }}
                      />
                    </label>
                  ))}
                </div>

                <div className="psn-newbk-sec">
                  <label className="dk-field-lbl">Nombre</label>
                  <input className="input" value={p.name} onChange={(e) => setProducts((items) => items.map((item) => item.id === p.id ? { ...item, name: e.target.value } : item))} />
                </div>
                <div className="psn-newbk-sec">
                  <label className="dk-field-lbl">Marca</label>
                  <input className="input" value={p.brand || ""} onChange={(e) => setProducts((items) => items.map((item) => item.id === p.id ? { ...item, brand: e.target.value } : item))} />
                </div>
                <div className="psn-newbk-sec">
                  <label className="dk-field-lbl">Descripción</label>
                  <input className="input" value={p.description || ""} onChange={(e) => setProducts((items) => items.map((item) => item.id === p.id ? { ...item, description: e.target.value } : item))} />
                </div>
                <div className="psn-newbk-sec" style={{ gridTemplateColumns: "1fr 1fr", display: "grid", gap: ".5rem" }}>
                  <div><label className="dk-field-lbl">Precio</label><input className="input" inputMode="numeric" value={p.price} onChange={(e) => setProducts((items) => items.map((item) => item.id === p.id ? { ...item, price: e.target.value.replace(/\D/g, "") } : item))} /></div>
                  <div><label className="dk-field-lbl">Stock</label><input className="input" inputMode="numeric" value={p.stock} onChange={(e) => setProducts((items) => items.map((item) => item.id === p.id ? { ...item, stock: e.target.value.replace(/\D/g, "") } : item))} /></div>
                </div>
                <div className="psn-confirm-actions" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                  <button className={p.active === false ? "chip" : "chip chip-gold"} onClick={() => saveProduct({ ...p, active: p.active === false })}>{p.active === false ? "Oculto" : "Publicado"}</button>
                  <button className="btn btn-sm psn-res-delete" onClick={() => setDeleteProduct(p)}><Icon name="close" size={14} /> Eliminar</button>
                  <button className="btn btn-gold btn-sm" onClick={() => { saveProduct(p); setEditProductId(null) }}><Icon name="check" size={14} /> Guardar</button>
                </div>
              </div>
            </div>
          )
        })()}

        {/* CONFIRMAR ELIMINAR PRODUCTO */}
        {deleteProduct && (
          <div className="psn-modal psn-modal-top" role="alertdialog" aria-modal="true">
            <button className="psn-scrim" aria-label="Cerrar" onClick={() => setDeleteProduct(null)} />
            <div className="psn-modal-card psn-confirm">
              <span className="psn-confirm-ic"><Icon name="close" size={22} /></span>
              <h3 className="font-display">¿Eliminar “{deleteProduct.name}”?</h3>
              <p>Esta acción no se puede deshacer. El producto desaparece de inmediato del catálogo público.</p>
              <div className="psn-confirm-actions">
                <button className="btn btn-ghost btn-block" onClick={() => setDeleteProduct(null)}>Volver</button>
                <button className="btn btn-danger btn-block" onClick={() => { removeProduct(deleteProduct); setDeleteProduct(null) }}>Sí, eliminar</button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL NUEVO PRODUCTO */}
        {productOpen && (
          <div style={{ position: "fixed", inset: 0, zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }} onClick={() => setProductOpen(false)}>
            <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }} />
            <div className="card" style={{ position: "relative", width: "100%", maxWidth: 420, padding: "1.6rem", display: "grid", gap: "1.1rem", zIndex: 1 }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h3 className="font-display" style={{ margin: 0, fontSize: "1.1rem" }}>Nuevo producto</h3>
                <button style={{ background: "none", border: 0, color: "var(--muted)", cursor: "pointer", padding: ".3rem" }} onClick={() => setProductOpen(false)} aria-label="Cerrar">
                  <Icon name="close" size={18} />
                </button>
              </div>
              <span className="chip" style={{ justifySelf: "start" }}>Impacta la web pública · agrega las fotos después de crearlo</span>
              <div className="admin-form-grid">
                <input className="input" placeholder="Nombre del producto" value={productDraft.name} onChange={(e) => setProductDraft({ ...productDraft, name: e.target.value })} />
                <input className="input" placeholder="Marca" value={productDraft.brand} onChange={(e) => setProductDraft({ ...productDraft, brand: e.target.value })} />
                <input className="input" placeholder="Precio (CLP)" inputMode="numeric" value={productDraft.price} onChange={(e) => setProductDraft({ ...productDraft, price: e.target.value.replace(/\D/g, "") })} />
                <input className="input" placeholder="Stock inicial" inputMode="numeric" value={productDraft.stock} onChange={(e) => setProductDraft({ ...productDraft, stock: e.target.value.replace(/\D/g, "") })} />
                <input className="input" placeholder="Descripción" value={productDraft.description} onChange={(e) => setProductDraft({ ...productDraft, description: e.target.value })} />
                <button className="btn btn-gold btn-block" onClick={async () => { await saveProduct(); setProductOpen(false) }}><Icon name="check" size={15} /> Crear producto</button>
              </div>
            </div>
          </div>
        )}

        {/* GASTOS */}
        {tab === "gastos" && admin && (
          <ExpensesModule
            expenses={expenses}
            budgets={expenseBudgets}
            onCreate={createExpense}
            onUpdate={updateExpense}
            onDelete={deleteExpense}
          />
        )}

        {/* MODAL NUEVA RESERVA (accesible desde cualquier pestaña: hero, dock, inbox) */}
        <NewBookingModal
          open={newBookingOpen}
          onClose={() => setNewBookingOpen(false)}
          clients={clients}
          services={services}
          defaultBarberId={agendaBarber || 6}
          agendaSlots={AGENDA_SLOTS}
          onCreate={async (draft) => {
            const result = await createBooking(draft)
            if (result?.ok) pushToast("✓", `Reserva de ${draft.client} confirmada`)
            return result
          }}
        />

        {/* MODAL DETALLE DE RESERVA (agenda: click en un slot reservado o en la
            lista de "Reservas del día") */}
        <BookingDetailModal
          booking={detail}
          clients={clients}
          onClose={() => setDetail(null)}
          onConfirm={(bk) => { updateBookingStatus(bk, "confirmada"); pushToast("✓", "Cita confirmada"); setDetail(null) }}
          onCancel={(bk) => { updateBookingStatus(bk, "cancelada"); pushToast("✕", `Cita de ${bk.client} cancelada`); setDetail(null); loadAgenda() }}
          onRedeemFreeCut={redeemFreeCut}
        />

        {/* TOASTS de la agenda */}
        {toasts.length > 0 && (
          <div className="agenda-toasts">
            {toasts.map((t) => (
              <div key={t.id} className="agenda-toast">
                <span>{t.icon}</span>
                <span>{t.msg}</span>
              </div>
            ))}
          </div>
        )}

        {/* MODAL NUEVO CLIENTE */}
        <NewClientModal
          open={newClientOpen}
          onClose={() => setNewClientOpen(false)}
          clients={clients}
          onCreate={createClient}
        />

        {/* CONFIRMAR ELIMINAR SERVICIO */}
        {deleteSvc && (
          <div className="psn-modal psn-modal-top" role="alertdialog" aria-modal="true">
            <button className="psn-scrim" aria-label="Cerrar" onClick={() => setDeleteSvc(null)} />
            <div className="psn-modal-card psn-confirm">
              <span className="psn-confirm-ic"><Icon name="close" size={22} /></span>
              <h3 className="font-display">¿Eliminar “{deleteSvc.name}”?</h3>
              <p>Las reservas existentes conservarán su nombre y precio. Esta acción no se puede deshacer.</p>
              <div className="psn-confirm-actions">
                <button className="btn btn-ghost btn-block" onClick={() => setDeleteSvc(null)}>Volver</button>
                <button className="btn btn-danger btn-block" onClick={() => { deleteService(deleteSvc); setDeleteSvc(null) }}>Sí, eliminar</button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL NUEVO SERVICIO */}
        {serviceOpen && (
          <div style={{ position: "fixed", inset: 0, zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }} onClick={() => setServiceOpen(false)}>
            <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }} />
            <div className="card" style={{ position: "relative", width: "100%", maxWidth: 420, padding: "1.6rem", display: "grid", gap: "1.1rem", zIndex: 1 }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h3 className="font-display" style={{ margin: 0, fontSize: "1.1rem" }}>Nuevo servicio</h3>
                <button style={{ background: "none", border: 0, color: "var(--muted)", cursor: "pointer", padding: ".3rem" }} onClick={() => setServiceOpen(false)} aria-label="Cerrar">
                  <Icon name="close" size={18} />
                </button>
              </div>
              <span className="chip" style={{ justifySelf: "start" }}>Impacta la web pública</span>
              <div className="admin-form-grid">
                <input className="input" placeholder="Nombre del servicio" value={serviceDraft.name} onChange={(e) => setServiceDraft({ ...serviceDraft, name: e.target.value })} />
                <input className="input" placeholder="Precio (CLP)" inputMode="numeric" value={serviceDraft.price} onChange={(e) => setServiceDraft({ ...serviceDraft, price: e.target.value.replace(/\D/g, "") })} />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".5rem", padding: ".55rem .7rem", border: "1px solid var(--hair-2)", borderRadius: 10 }}>
                  <span style={{ fontSize: ".8rem", color: "var(--muted)" }}>Bloquea en agenda</span>
                  <div style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
                    <button type="button" className="chip" style={{ padding: ".3rem .6rem" }}
                      onClick={() => setServiceDraft((d) => ({ ...d, min: String(blocksToMin(minToBlocks(d.min) - 1)) }))}
                      disabled={minToBlocks(serviceDraft.min) <= 1}>−</button>
                    <span style={{ fontSize: ".85rem", minWidth: 64, textAlign: "center" }}>{minToBlocks(serviceDraft.min)} {minToBlocks(serviceDraft.min) === 1 ? "bloque" : "bloques"}</span>
                    <button type="button" className="chip" style={{ padding: ".3rem .6rem" }}
                      onClick={() => setServiceDraft((d) => ({ ...d, min: String(blocksToMin(minToBlocks(d.min) + 1)) }))}>+</button>
                  </div>
                </div>
                <select className="input" value={serviceDraft.cat} onChange={(e) => setServiceDraft({ ...serviceDraft, cat: e.target.value })}>
                  <option value="general">General</option>
                  <option value="premium">Premium</option>
                  <option value="quimico">Quimico</option>
                </select>
                <input className="input" placeholder="Descripción" value={serviceDraft.desc} onChange={(e) => setServiceDraft({ ...serviceDraft, desc: e.target.value })} />
                <button className="btn btn-gold btn-block" onClick={() => { saveService(); setServiceOpen(false) }}><Icon name="check" size={15} /> Crear servicio</button>
              </div>
            </div>
          </div>
        )}

        {/* CONFIG */}
        {tab === "config" && (
          <ConfigPanel
            brunettiOnly={BRUNETTI_ONLY}
            barber={barber}
            barbers={barbers}
            admin={admin}
            canManageTeam={canManageTeam}
            barberDraft={barberDraft}
            setBarberDraft={setBarberDraft}
            saveBarber={saveBarber}
            updateBarberLocal={updateBarberLocal}
            deleteBarber={deleteBarber}
            onExport={exportCSV}
            onLogout={logout}
            nav={nav}
            navSettings={navSettings}
            setNavSettings={setNavSettings}
            dockShortcuts={dockShortcuts}
            setDockShortcuts={setDockShortcuts}
            expenseBudgets={expenseBudgets}
            setExpenseBudgets={setExpenseBudgets}
          />
        )}

        {/* MARKETING */}
        {tab === "marketing" && (
          <div className="animate-in" style={{ display: "grid", gap: "1.1rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: "1rem" }}>
              <Stat icon="user"  label="Clientes nuevos hoy" value={newClientsCount} accent />
              <Stat icon="trend" label="Recurrencia"         value={recurringPct} suffix="%" />
              <Stat icon="users" label="Clientes activos"    value={activeClients.length} />
              <Stat icon="star"  label="Clientes frecuentes" value={topClients.length} />
            </div>
            {/* Origen de clientes / promociones se retiraron: no hay ningún dato
                real que las respalde todavía (no se registra canal de captación
                ni códigos de promo). Mejor no mostrar nada que inventar cifras. */}
            {/* Tarjeta de fidelidad — mismas cifras que ve el panel de Pimp
                Studio: el programa de estrellas es uno solo para los dos
                locales (ver api/_loyaltyBridge.js). */}
            <Panel
              title="Tarjeta de fidelidad"
              action={walletStats ? <span className="chip chip-gold">{walletStats.passesIssued} emitidas</span> : null}
            >
              {!walletStats && <p style={{ color: "var(--muted)", fontSize: ".84rem" }}>Cargando métricas…</p>}
              {walletStats && (
                <div style={{ display: "grid", gap: "1rem" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: ".8rem" }}>
                    <Stat icon="wallet" label="Instaladas (Apple)" value={walletStats.appleInstalled} accent />
                    <Stat icon="wallet" label="Instaladas (Google)" value={walletStats.googleInstalled} />
                    <Stat icon="star"   label="Con 5+ estrellas"    value={walletStats.withFiveOrMore} />
                    <Stat icon="gift"   label="Corte gratis listo"  value={walletStats.freeCutReady} />
                  </div>

                  {/* Distribución de saldo: dónde está atascada la gente en el
                      camino al corte gratis. */}
                  <div style={{ display: "grid", gap: ".35rem" }}>
                    <span style={{ fontSize: ".72rem", color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: ".06em" }}>Clientes por estrellas</span>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(11, 1fr)", gap: ".2rem", alignItems: "end", height: 70 }}>
                      {walletStats.byStars.map((n, i) => {
                        const max = Math.max(1, ...walletStats.byStars)
                        return (
                          <div key={i} style={{ display: "grid", gap: ".2rem", justifyItems: "center" }} title={`${n} cliente${n === 1 ? "" : "s"} con ${i} estrella${i === 1 ? "" : "s"}`}>
                            <div style={{ width: "100%", height: `${Math.round((n / max) * 52)}px`, minHeight: n ? 3 : 1, borderRadius: 3, background: i >= 10 ? "var(--gold-grad)" : "rgba(201,161,78,.35)" }} />
                            <span style={{ fontSize: ".58rem", color: "var(--muted-2)" }}>{i}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Envío del link de la tarjeta por correo. Va por tandas
                      desde el navegador (ver ?mode=wallet-send-cards): así se
                      ve el avance y se puede detener a mitad. */}
                  <div style={{ display: "grid", gap: ".5rem", paddingTop: ".4rem", borderTop: "1px solid var(--hair)" }}>
                    <span style={{ fontSize: ".72rem", color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: ".06em" }}>Mandar la tarjeta por correo</span>
                    <p style={{ margin: 0, fontSize: ".72rem", color: "var(--muted)", lineHeight: 1.5 }}>
                      Cada cliente recibe su propio link. Al abrirlo desde el celular le aparece un solo botón: Apple Wallet en iPhone, Google Wallet en Android. Se omite a quien ya la tiene agregada.
                    </p>
                    <div style={{ display: "flex", gap: ".4rem", flexWrap: "wrap", alignItems: "center" }}>
                      <input
                        value={cardTestPhone}
                        onChange={(e) => setCardTestPhone(e.target.value.replace(/\D/g, "").slice(0, 9))}
                        placeholder="9 dígitos (prueba)"
                        inputMode="numeric"
                        style={{ width: 150, padding: ".45rem .6rem", borderRadius: 10, border: "1px solid var(--hair-2)", background: "rgba(0,0,0,.25)", color: "var(--ink)", fontSize: ".78rem" }}
                      />
                      <button className="btn btn-dark btn-sm" disabled={cardTestPhone.length !== 9 || cardSending} onClick={() => sendLoyaltyCards({ onlyPhone: cardTestPhone, again: true, includeInstalled: true })}>
                        <Icon name="wallet" size={14} /> Probar con uno
                      </button>
                      <button className="btn btn-gold btn-sm" disabled={cardSending} onClick={() => sendLoyaltyCards({})}>
                        <Icon name="spark" size={14} /> {cardSending ? "Enviando…" : "Enviar a los que faltan"}
                      </button>
                      {cardSending && (
                        <button className="btn btn-ghost btn-sm" onClick={() => { cardStopRef.current = true }}>Detener</button>
                      )}
                    </div>
                    {cardProgress && <span style={{ fontSize: ".7rem", color: "var(--muted)" }}>{cardProgress}</span>}
                  </div>

                  {/* Campaña: escribe en la tarjeta de cada cliente y dispara
                      una notificación en su celular. Solo llega a quien tiene
                      el pase agregado. */}
                  <div style={{ display: "grid", gap: ".5rem", paddingTop: ".4rem", borderTop: "1px solid var(--hair)" }}>
                    <span style={{ fontSize: ".72rem", color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: ".06em" }}>Enviar novedad</span>
                    <textarea
                      value={campaignMessage}
                      onChange={(e) => setCampaignMessage(e.target.value.slice(0, 180))}
                      placeholder="Ej: Este viernes, 20% en barba. Te esperamos."
                      rows={2}
                      style={{ width: "100%", resize: "vertical", padding: ".6rem .7rem", borderRadius: 10, border: "1px solid var(--hair-2)", background: "rgba(0,0,0,.25)", color: "var(--ink)", fontSize: ".82rem" }}
                    />
                    <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", alignItems: "center" }}>
                      <select value={campaignAudience} onChange={(e) => setCampaignAudience(e.target.value)}
                        style={{ padding: ".45rem .6rem", borderRadius: 10, border: "1px solid var(--hair-2)", background: "rgba(0,0,0,.25)", color: "var(--ink)", fontSize: ".78rem" }}>
                        <option value="all">Todos los que tienen la tarjeta</option>
                        <option value="five_plus">Con 5 o más estrellas</option>
                        <option value="free_cut_ready">Con corte gratis disponible</option>
                        <option value="inactive">Sin venir hace 30+ días</option>
                      </select>
                      <button className="btn btn-gold btn-sm" disabled={!campaignMessage.trim() || campaignSending} onClick={sendCampaign}>
                        <Icon name="spark" size={14} /> {campaignSending ? "Enviando…" : "Enviar"}
                      </button>
                      <span style={{ fontSize: ".68rem", color: "var(--muted-2)" }}>{campaignMessage.length}/180</span>
                    </div>
                    <p style={{ margin: 0, fontSize: ".68rem", color: "var(--muted-2)" }}>
                      El mensaje aparece en la tarjeta del cliente hasta que mandes otro. Llega a todos los que tienen el pase, sean de Brunetti o de Pimp Studio.
                    </p>
                    {campaigns.length > 0 && (
                      <div style={{ display: "grid", gap: ".3rem", marginTop: ".3rem" }}>
                        {campaigns.slice(0, 5).map((c) => (
                          <div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: ".6rem", fontSize: ".72rem", color: "var(--muted)" }}>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.message}</span>
                            <span style={{ flexShrink: 0, color: "var(--muted-2)" }}>
                              {c.recipientCount} · {String(c.createdAt || "").slice(0, 10)}{c.source === "brunetti" ? " · Brunetti" : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Panel>

            <Panel title="Clientes frecuentes" action={<span className="chip chip-gold">3+ visitas</span>}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: ".8rem" }}>
                {!topClients.length && <p style={{ color: "var(--muted)", fontSize: ".84rem" }}>Sin datos aún.</p>}
                {topClients.slice(0, 8).map((c) => (
                  <div key={clientKey(c)} style={{ padding: "1rem", border: "1px solid var(--hair)", borderRadius: 12, background: "rgba(0,0,0,0.25)" }}>
                    <span style={{ fontSize: ".85rem", fontWeight: 500, display: "block", marginBottom: ".3rem" }}>{c.name}</span>
                    <span className="font-display gold-text" style={{ fontSize: "1.05rem", fontWeight: 700 }}>{CLP(c.totalSpent || 0)}</span>
                    <span style={{ fontSize: ".72rem", color: "var(--muted-2)", display: "block", marginTop: ".2rem" }}>{c.visits} visitas</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        )}
      </main>
    </DashboardShell>
  )
}

/* ============================================================
   Config Panel — Santa Julieta style two-column settings
   ============================================================ */
const CFG_SECTIONS = [
  { id: "cuenta",        icon: "user",     label: "Cuenta y seguridad", kw: "contraseña password usuario nombre rol" },
  { id: "apariencia",    icon: "star",     label: "Apariencia", kw: "tema modo claro oscuro" },
  { id: "accesos",       icon: "pin",      label: "Accesos directos", kw: "dock atajos shortcuts" },
  { id: "navegacion",    icon: "grid",     label: "Navegacion", kw: "pestañas tabs orden menu" },
  { id: "notificaciones",icon: "bell",     label: "Notificaciones", kw: "push alertas avisos" },
  { id: "whatsapp",      icon: "whatsapp", label: "WhatsApp", kw: "recordatorio plantillas mensajes" },
  { id: "negocio",       icon: "scissors", label: "Negocio", kw: "horario direccion telefono nombre local" },
  { id: "presupuestos",  icon: "wallet",   label: "Presupuestos", kw: "gastos categoria limite" },
  { id: "equipo",        icon: "key",      label: "Equipo y permisos", kw: "barberos permisos roles" },
  { id: "datos",         icon: "wallet",   label: "Datos y respaldos", kw: "exportar csv respaldo backup" },
  { id: "acerca",        icon: "spark",    label: "Acerca de", kw: "version creditos" },
]

/* ============================================================
   INSCRIPCIONES — lista unificada de Cursos + Workshop
   Carga desde /api/enrollments (requiere sesión interna).
   Categoriza con colores del módulo: azul = cursos, morado = workshop.
   ============================================================ */
function EnrollmentsPanel() {
  const [rows, setRows] = React.useState([])
  const [loading, setLoading] = React.useState(true)
  const [filter, setFilter] = React.useState("todos") // todos | cursos | workshop
  const [query, setQuery] = React.useState("")

  React.useEffect(() => {
    // Combina lo del backend con el respaldo local (inscripciones hechas desde
    // Cursos/Workshop), para que aparezcan aunque /api no esté disponible.
    const token = localStorage.getItem("ps_barber_token") || ""
    fetch("/api/enrollments", { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.headers.get("content-type")?.includes("application/json") ? r.json() : Promise.reject(new Error("api unavailable")))
      .then((d) => { setRows(mergeEnrollments(d.enrollments || [])); setLoading(false) })
      .catch(() => { setRows(mergeEnrollments([])); setLoading(false) })
  }, [])

  const filtered = rows.filter((r) => {
    if (filter !== "todos" && r.source !== filter) return false
    if (query) {
      const q = query.toLowerCase()
      return r.name?.toLowerCase().includes(q) || r.phone?.includes(q) || r.email?.toLowerCase().includes(q)
    }
    return true
  })

  const cursosBadge = { background: "rgba(11,18,158,0.18)", color: "#6b74f0", border: "1px solid rgba(107,116,240,0.35)" }
  const workshopBadge = { background: "rgba(136,56,216,0.18)", color: "#b483f3", border: "1px solid rgba(136,56,216,0.35)" }

  const fmtDate = (iso) => {
    if (!iso) return "—"
    const d = new Date(iso)
    return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" })
  }

  return (
    <div className="animate-in" style={{ display: "grid", gap: "1.1rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: "1rem" }}>
        <Stat icon="user"    label="Total inscripciones" value={rows.length} accent />
        <Stat icon="spark"   label="Cursos"   value={rows.filter(r => r.source === "cursos").length} />
        <Stat icon="scissors" label="Workshop" value={rows.filter(r => r.source === "workshop").length} />
      </div>
      <Panel title="Inscripciones" action={
        <div className="psn-seg" role="group" aria-label="Filtrar por origen">
          {["todos","cursos","workshop"].map(f => (
            <button key={f} type="button" className={filter === f ? "is-on" : ""} style={{ textTransform: "capitalize" }} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
      }>
        <div className="client-search">
          <Icon name="user" size={15} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por nombre, teléfono o email" />
        </div>
        <div className="client-table-head" style={{ gridTemplateColumns: "1.4fr 1fr auto auto" }}>
          <span>Cliente</span>
          <span>Detalle</span>
          <span>Origen</span>
          <span>Fecha</span>
        </div>
        <div className="client-list">
          {loading && <div className="empty-state">Cargando inscripciones…</div>}
          {!loading && !filtered.length && <div className="empty-state">No hay inscripciones que coincidan.</div>}
          {filtered.map((r) => (
            <div key={r.id} className="client-row" style={{ gridTemplateColumns: "1.4fr 1fr auto auto", cursor: "default" }}>
              <div style={{ minWidth: 0 }}>
                <strong>{r.name}</strong>
                <span>{r.phone} · {r.email}</span>
              </div>
              <div style={{ minWidth: 0 }}>
                <span>{r.level || "—"}</span>
                {r.edition && <span>Edición: {r.edition}</span>}
              </div>
              <span style={{ fontSize: "0.7rem", padding: "2px 8px", borderRadius: 999, justifySelf: "start", ...( r.source === "cursos" ? cursosBadge : workshopBadge) }}>
                {r.source === "cursos" ? "Cursos" : "Workshop"}
              </span>
              <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{fmtDate(r.created_at)}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}

function ConfigSwitch({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 44, height: 26, borderRadius: 13, border: "none", cursor: disabled ? "default" : "pointer",
        background: checked ? "var(--gold)" : "var(--hair-2)",
        position: "relative", flexShrink: 0, transition: "background .2s",
        opacity: disabled ? .45 : 1,
      }}
    >
      <span style={{
        position: "absolute", top: 3, left: checked ? 21 : 3, width: 20, height: 20,
        borderRadius: "50%", background: "#fff", transition: "left .2s",
        boxShadow: "0 1px 4px rgba(0,0,0,.35)",
      }} />
    </button>
  )
}

function CfgRow({ label, sub, children }) {
  return (
    <div className="cfg-setting-row">
      <div>
        <div className="cfg-setting-label">{label}</div>
        {sub && <div className="cfg-setting-sub">{sub}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}

/* Notificaciones push para iOS (app instalada en inicio).
   Solo activa avisos para el barbero autenticado (su usuario): recibirá un push
   cuando un cliente agende una hora con él. */
function PushCard({ barber }) {
  const [perm, setPerm] = useState(() => permissionState())
  const [enabled, setEnabled] = useState(() => pushEnabledFor(barber))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState("")
  const supported = pushSupported()
  const iosNeedsInstall = isIOS() && !isStandalone()

  const toggle = async () => {
    setBusy(true); setMsg("")
    if (enabled) {
      await disablePush(barber)
      setEnabled(false)
      setMsg("Notificaciones desactivadas.")
    } else {
      const r = await enablePush(barber)
      setPerm(r.permission)
      if (r.ok) {
        setEnabled(true)
        setMsg("Listo. Te avisaremos cuando agenden una hora contigo.")
      } else if (r.reason === "ios-needs-install") {
        setMsg("En iPhone: abre el menú Compartir y elige “Agregar a inicio”. Luego abre la app instalada y activa aquí.")
      } else if (r.reason === "denied") {
        setMsg("Permiso de notificaciones bloqueado. Actívalo en los ajustes del navegador/app.")
      } else if (r.reason === "unsupported") {
        setMsg("Este navegador no soporta notificaciones push.")
      } else {
        setMsg("No se pudo activar. Intenta nuevamente.")
      }
    }
    setBusy(false)
  }

  const test = async () => {
    const ok = await notifyLocal({
      title: "Brunetti",
      body: `Prueba de notificación para ${barber?.name || "ti"}.`,
    })
    setMsg(ok ? "Notificación de prueba enviada." : "Activa primero las notificaciones para probar.")
  }

  return (
    <div className="cfg-card">
      <p className="cfg-card-head">Notificaciones push · iOS</p>
      <CfgRow
        label="Avisarme de nuevas reservas"
        sub="Recibe un aviso cuando un cliente agende una hora contigo."
      >
        <ConfigSwitch checked={enabled} disabled={busy || iosNeedsInstall} onChange={toggle} />
      </CfgRow>

      {iosNeedsInstall && (
        <div style={{
          marginTop: ".8rem", padding: ".85rem 1rem", borderRadius: 12,
          border: "1px solid var(--gold-line)", background: "rgba(201,161,78,0.07)",
          fontSize: ".82rem", color: "var(--ink-soft)", lineHeight: 1.5,
        }}>
          <strong style={{ color: "var(--gold-lt)" }}>Para activar en iPhone:</strong> abre esta web en Safari,
          toca <b>Compartir</b> → <b>Agregar a inicio</b>. Abre la app instalada y vuelve aquí para activar las push.
        </div>
      )}

      {!supported && !iosNeedsInstall && (
        <p style={{ marginTop: ".7rem", fontSize: ".8rem", color: "var(--muted)" }}>
          Este dispositivo o navegador no soporta notificaciones push.
        </p>
      )}

      {enabled && (
        <button className="btn btn-dark btn-sm" style={{ marginTop: ".9rem" }} onClick={test}>
          <Icon name="bell" size={13} /> Enviar notificación de prueba
        </button>
      )}

      {msg && <p style={{ marginTop: ".8rem", fontSize: ".8rem", color: "var(--gold-lt)" }}>{msg}</p>}

      <p style={{ marginTop: ".9rem", fontSize: ".74rem", color: "var(--muted-2)", lineHeight: 1.5 }}>
        Solo tú recibirás estos avisos en tu cuenta. Estado del permiso: <b>{perm}</b>.
      </p>
    </div>
  )
}

function isStrongPassword(pw) {
  return /^[A-Za-z0-9]{8,64}$/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw)
}

function ConfigPanel({ brunettiOnly, barber, barbers, admin, canManageTeam, barberDraft, setBarberDraft, saveBarber, updateBarberLocal, deleteBarber, onExport, onLogout, nav, navSettings, setNavSettings, dockShortcuts, setDockShortcuts, expenseBudgets = {}, setExpenseBudgets = () => {} }) {
  const [section, setSection] = useState(null)
  // En modo "solo Brunetti" se oculta la gestión de Equipo/barberos (código conservado).
  // Presupuestos es exclusivo de admin (gestiona finanzas del negocio).
  const sections = CFG_SECTIONS
    .filter((s) => brunettiOnly ? s.id !== "equipo" : true)
    .filter((s) => s.id !== "presupuestos" || admin)
  const [teamModal, setTeamModal] = useState(null) // null=cerrado; {barber:null}=crear; {barber:obj}=editar
  const [biz, setBiz] = useState(() => {
    try { return { name: "Brunetti Barber Studio", address: "Maipú, Santiago", phone: "+56 9 1234 5678", waPhone: "+56 9 1234 5678", ...JSON.parse(localStorage.getItem("ps_biz") || "{}") } } catch { return { name: "Brunetti Barber Studio", address: "Maipú, Santiago", phone: "+56 9 1234 5678", waPhone: "+56 9 1234 5678" } }
  })
  const [bizSaved, setBizSaved] = useState("")
  const saveBiz = () => {
    try { localStorage.setItem("ps_biz", JSON.stringify(biz)) } catch {}
    setBizSaved("ok"); setTimeout(() => setBizSaved(""), 1800)
  }
  const [pwOpen, setPwOpen] = useState(false)
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" })
  const [pwStatus, setPwStatus] = useState("") // "", "saving", "done"
  const [pwError, setPwError] = useState("")

  const changePassword = async () => {
    setPwError("")
    if (!isStrongPassword(pwForm.next)) {
      setPwError("La nueva contraseña debe tener 8 caracteres alfanuméricos, con al menos 1 mayúscula y 1 número.")
      return
    }
    if (pwForm.next !== pwForm.confirm) {
      setPwError("Las contraseñas no coinciden.")
      return
    }
    setPwStatus("saving")
    try {
      const token = localStorage.getItem("ps_barber_token") || ""
      const res = await fetch("/api/auth-barber", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.next }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setPwStatus("done")
        setPwForm({ current: "", next: "", confirm: "" })
        setTimeout(() => { setPwStatus(""); setPwOpen(false) }, 2000)
      } else {
        setPwStatus("")
        setPwError(data.error || "No se pudo cambiar la contraseña.")
      }
    } catch {
      setPwStatus("")
      setPwError("No se pudo conectar con el servidor.")
    }
  }
  const [notifSettings, setNotifSettings] = useState({ reserva: true, cancelacion: true, recordatorio: true, marketing: false })
  const [waSettings, setWaSettings] = useState({ activo: true, recordatorio24h: true, recordatorio2h: false, confirmacion: true })
  const [acct, setAcct] = useState({ name: barber?.name || "", code: barber?.code || "" })
  const [acctSaved, setAcctSaved] = useState(false)
  const saveAccount = () => {
    const updated = { ...barber, name: acct.name.trim() || barber?.name, code: acct.code.trim() || barber?.code }
    try { localStorage.setItem("ps_barber", JSON.stringify(updated)) } catch {}
    setAcctSaved(true)
    setTimeout(() => setAcctSaved(false), 2500)
  }
  const { theme, toggle } = useTheme()

  const current = sections.find((s) => s.id === section)
  const [sectionQuery, setSectionQuery] = useState("")
  const visibleSections = sections.filter((s) => {
    const q = sectionQuery.trim().toLowerCase()
    if (!q) return true
    return s.label.toLowerCase().includes(q) || s.kw?.toLowerCase().includes(q)
  })

  // Escritorio (≥1024px): lista + contenido lado a lado, la lista nunca se
  // oculta — "secciones colapsables" en vez de navegar a pantalla completa.
  // Móvil: la lista desaparece mientras hay una sección abierta (regla CSS
  // con :has, ver .cfg-split) — mismo comportamiento de siempre ahí.
  return (
    <div className="animate-in cfg-split">
      <div className="cfg-list-screen">
        <p className="cfg-nav-head">Configuraciones</p>
        <div className="cfg-search">
          <Icon name="user" size={15} />
          <input value={sectionQuery} onChange={(e) => setSectionQuery(e.target.value)} placeholder="Buscar un ajuste…" />
        </div>
        <div className="cfg-list">
          {visibleSections.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`cfg-list-item ${section === s.id ? "is-active" : ""}`}
              onClick={() => setSection(section === s.id ? null : s.id)}
            >
              <span className="cfg-list-icon"><Icon name={s.icon} size={18} /></span>
              <span className="cfg-list-label">{s.label}</span>
              <Icon name={section === s.id ? "close" : "arrowRight"} size={16} style={{ opacity: .4 }} />
            </button>
          ))}
          {!visibleSections.length && <p className="empty-state" style={{ fontSize: ".84rem" }}>Sin ajustes que coincidan.</p>}
        </div>
      </div>

      {section && (
      <div className="cfg-detail-screen">
      <button type="button" className="cfg-back" onClick={() => setSection(null)}>
        <Icon name="arrowLeft" size={16} /> Volver a ajustes
      </button>
      <div className="cfg-content">
        <h2 className="cfg-content-title">{current?.label}</h2>

        {/* CUENTA Y SEGURIDAD */}
        {section === "cuenta" && (
          <div style={{ display: "grid", gap: "1.4rem" }}>
            <div className="cfg-card">
              <p className="cfg-card-head">Datos personales</p>
              <div className="cfg-form-grid">
                <div className="cfg-field">
                  <label>Nombre</label>
                  <input className="input" value={acct.name} onChange={(e) => setAcct((a) => ({ ...a, name: e.target.value }))} placeholder="Nombre completo" />
                </div>
                <div className="cfg-field">
                  <label>Usuario</label>
                  <input className="input" value={acct.code} onChange={(e) => setAcct((a) => ({ ...a, code: e.target.value.toLowerCase().replace(/\s+/g, "-") }))} placeholder="usuario" />
                </div>
                <div className="cfg-field">
                  <label>Rol</label>
                  <input className="input" defaultValue={barber?.role || "Barbero"} disabled />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: ".8rem", marginTop: ".5rem" }}>
                <button className="btn btn-gold" onClick={saveAccount}><Icon name="check" size={14} /> Guardar cambios</button>
                {acctSaved && <span className="chip chip-gold" style={{ fontSize: ".72rem" }}><Icon name="check" size={12} /> Guardado</span>}
              </div>
            </div>

            <div className="cfg-card">
              <p className="cfg-card-head">Cambiar contraseña</p>
              {!pwOpen && (
                <button className="btn btn-dark" onClick={() => { setPwOpen(true); setPwError(""); setPwStatus(""); setPwForm({ current: "", next: "", confirm: "" }) }}>
                  <Icon name="key" size={14} /> Cambiar contraseña
                </button>
              )}
              {pwOpen && (
                <div style={{ display: "grid", gap: ".7rem" }}>
                  <div className="cfg-field">
                    <label>Contraseña actual</label>
                    <input className="input" type="password" autoComplete="current-password" value={pwForm.current} onChange={(e) => setPwForm((f) => ({ ...f, current: e.target.value }))} placeholder="Tu contraseña actual" />
                  </div>
                  <div className="cfg-field">
                    <label>Nueva contraseña</label>
                    <input className="input" type="password" autoComplete="new-password" value={pwForm.next} onChange={(e) => setPwForm((f) => ({ ...f, next: e.target.value.slice(0, 64) }))} placeholder="8+ caracteres, 1 mayúscula y 1 número" />
                  </div>
                  <div className="cfg-field">
                    <label>Confirmar nueva contraseña</label>
                    <input className="input" type="password" autoComplete="new-password" value={pwForm.confirm} onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value.slice(0, 64) }))} placeholder="Repite la nueva contraseña" />
                  </div>
                  <p style={{ fontSize: ".74rem", color: pwForm.next && !isStrongPassword(pwForm.next) ? "#d99a8f" : "var(--muted-2)", margin: 0 }}>
                    Mínimo 8 caracteres alfanuméricos, con al menos 1 mayúscula y 1 número.
                  </p>
                  {pwError && <p style={{ fontSize: ".8rem", color: "#d99a8f", margin: 0 }}>{pwError}</p>}
                  {pwStatus === "done" && <p style={{ fontSize: ".8rem", color: "var(--gold-lt)", margin: 0 }}><Icon name="check" size={12} /> Contraseña actualizada.</p>}
                  <div style={{ display: "flex", gap: ".5rem", marginTop: ".2rem" }}>
                    <button className="btn btn-gold btn-sm" disabled={pwStatus === "saving"} onClick={changePassword}>
                      {pwStatus === "saving" ? "Guardando…" : "Guardar contraseña"}
                    </button>
                    <button className="btn btn-dark btn-sm" onClick={() => { setPwOpen(false); setPwError(""); setPwStatus("") }}>Cancelar</button>
                  </div>
                </div>
              )}
            </div>

            <div className="cfg-card">
              <p className="cfg-card-head">Sesion</p>
              <CfgRow label="Cerrar sesion" sub="Seras redirigido al ingreso">
                <button className="btn btn-dark btn-sm" onClick={onLogout}><Icon name="logout" size={14} /> Salir</button>
              </CfgRow>
            </div>
          </div>
        )}

        {/* APARIENCIA */}
        {section === "apariencia" && (
          <div style={{ display: "grid", gap: "1.4rem" }}>
            <div className="cfg-card">
              <p className="cfg-card-head">Tema de la interfaz</p>
              <CfgRow label="Modo oscuro" sub="El modo claro solo esta disponible en el panel interno">
                <ConfigSwitch checked={theme === "dark"} onChange={() => toggle()} />
              </CfgRow>
              <div className="cfg-theme-preview">
                <div className={`cfg-theme-tile ${theme === "dark" ? "is-active" : ""}`} onClick={() => theme !== "dark" && toggle()}>
                  <div className="cfg-theme-thumb dark" />
                  <span>Oscuro</span>
                </div>
                <div className={`cfg-theme-tile ${theme === "light" ? "is-active" : ""}`} onClick={() => theme !== "light" && toggle()}>
                  <div className="cfg-theme-thumb light" />
                  <span>Claro</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ACCESOS DIRECTOS */}
        {section === "accesos" && (
          <div style={{ display: "grid", gap: "1.4rem" }}>
            <div className="cfg-card">
              <p className="cfg-card-head">Footer bar — 4 accesos rapidos</p>
              <p style={{ fontSize: ".82rem", color: "var(--muted)", margin: "0 0 1rem" }}>Elige los 4 modulos que aparecen en el dock móvil (el centro siempre abre el menú completo).</p>
              <div style={{ display: "grid", gap: ".6rem" }}>
                {nav.filter((n) => !n[0].includes("config")).map(([id, ic, label]) => (
                  <label key={id} style={{ display: "flex", alignItems: "center", gap: ".8rem", padding: ".6rem .8rem", borderRadius: 10, border: "1px solid var(--border)", cursor: "pointer", transition: "background .15s" }}>
                    <input
                      type="checkbox"
                      checked={dockShortcuts.includes(id)}
                      onChange={(e) => {
                        if (e.target.checked && dockShortcuts.length < 4) {
                          setDockShortcuts([...dockShortcuts, id])
                        } else if (!e.target.checked) {
                          setDockShortcuts(dockShortcuts.filter((s) => s !== id))
                        }
                      }}
                      style={{ accentColor: "var(--gold)", width: 18, height: 18 }}
                    />
                    <Icon name={ic} size={16} style={{ color: dockShortcuts.includes(id) ? "var(--gold)" : "var(--muted)" }} />
                    <span style={{ fontSize: ".88rem", flex: 1 }}>{label}</span>
                    {dockShortcuts.includes(id) && <span className="chip chip-gold" style={{ fontSize: ".66rem" }}>✓</span>}
                  </label>
                ))}
              </div>
              {dockShortcuts.length === 4 && <p style={{ fontSize: ".76rem", color: "var(--muted-2)", margin: "1rem 0 0" }}>✓ 4 accesos seleccionados</p>}
            </div>
          </div>
        )}

        {/* NAVEGACION */}
        {section === "navegacion" && (
          <div style={{ display: "grid", gap: "1.4rem" }}>
            <div className="cfg-card">
              <p className="cfg-card-head">Modulos visibles</p>
              <p style={{ fontSize: ".82rem", color: "var(--muted)", margin: "0 0 1rem" }}>Activa o desactiva los modulos que aparecen en la barra lateral y el dock movil.</p>
              {[
                ["agenda",    "calendar", "Agenda",    true],
                ["reservas",  "scissors", "Reservas",  true],
                ["finanzas",  "wallet",   "Finanzas",  admin],
                ["clientes",  "user",     "Clientes",  true],
                ["servicios", "cut",      "Servicios", admin],
                ["gastos",    "wallet",   "Gastos",    admin],
                ["marketing", "spark",    "Marketing", true],
              ].map(([id, ic, label, allowed]) => (
                <CfgRow key={id} label={label}>
                  <ConfigSwitch
                    checked={navSettings[id] !== false}
                    disabled={!allowed}
                    onChange={(v) => setNavSettings((s) => ({ ...s, [id]: v }))}
                  />
                </CfgRow>
              ))}
            </div>
          </div>
        )}

        {/* NOTIFICACIONES */}
        {section === "notificaciones" && (
          <div style={{ display: "grid", gap: "1.4rem" }}>
            <PushCard barber={barber} />
            <div className="cfg-card">
              <p className="cfg-card-head">Alertas internas</p>
              <CfgRow label="Nueva reserva" sub="Notificacion cuando un cliente agenda">
                <ConfigSwitch checked={notifSettings.reserva} onChange={(v) => setNotifSettings((s) => ({ ...s, reserva: v }))} />
              </CfgRow>
              <CfgRow label="Cancelacion" sub="Cuando un cliente cancela su cita">
                <ConfigSwitch checked={notifSettings.cancelacion} onChange={(v) => setNotifSettings((s) => ({ ...s, cancelacion: v }))} />
              </CfgRow>
              <CfgRow label="Recordatorio de cita" sub="30 minutos antes de cada servicio">
                <ConfigSwitch checked={notifSettings.recordatorio} onChange={(v) => setNotifSettings((s) => ({ ...s, recordatorio: v }))} />
              </CfgRow>
              <CfgRow label="Novedades y marketing" sub="Actualizaciones del sistema">
                <ConfigSwitch checked={notifSettings.marketing} onChange={(v) => setNotifSettings((s) => ({ ...s, marketing: v }))} />
              </CfgRow>
            </div>
          </div>
        )}

        {/* WHATSAPP */}
        {section === "whatsapp" && (
          <div style={{ display: "grid", gap: "1.4rem" }}>
            <div className="cfg-card">
              <p className="cfg-card-head">Mensajeria automatica</p>
              <CfgRow label="WhatsApp activo" sub="Envio automatico de mensajes a clientes">
                <ConfigSwitch checked={waSettings.activo} onChange={(v) => setWaSettings((s) => ({ ...s, activo: v }))} />
              </CfgRow>
              <CfgRow label="Recordatorio 24h" sub="Mensaje el dia previo a la cita">
                <ConfigSwitch checked={waSettings.recordatorio24h} disabled={!waSettings.activo} onChange={(v) => setWaSettings((s) => ({ ...s, recordatorio24h: v }))} />
              </CfgRow>
              <CfgRow label="Recordatorio 2h" sub="Mensaje dos horas antes">
                <ConfigSwitch checked={waSettings.recordatorio2h} disabled={!waSettings.activo} onChange={(v) => setWaSettings((s) => ({ ...s, recordatorio2h: v }))} />
              </CfgRow>
              <CfgRow label="Confirmacion de reserva" sub="Mensaje inmediato al agendar">
                <ConfigSwitch checked={waSettings.confirmacion} disabled={!waSettings.activo} onChange={(v) => setWaSettings((s) => ({ ...s, confirmacion: v }))} />
              </CfgRow>
            </div>
            <div className="cfg-card">
              <p className="cfg-card-head">Numero de negocio</p>
              <div className="cfg-form-grid">
                <div className="cfg-field">
                  <label>Telefono WhatsApp Business</label>
                  <input className="input" placeholder="+56 9 xxxx xxxx" value={biz.waPhone} onChange={(e) => setBiz((b) => ({ ...b, waPhone: e.target.value }))} />
                </div>
              </div>
              <button className="btn btn-gold" style={{ marginTop: ".5rem" }} onClick={saveBiz}><Icon name="check" size={14} /> {bizSaved ? "Guardado ✓" : "Guardar"}</button>
            </div>
          </div>
        )}

        {/* NEGOCIO */}
        {section === "negocio" && (
          <div style={{ display: "grid", gap: "1.4rem" }}>
            <div className="cfg-card">
              <p className="cfg-card-head">Datos del negocio</p>
              <div className="cfg-form-grid">
                <div className="cfg-field"><label>Nombre</label><input className="input" value={biz.name} onChange={(e) => setBiz((b) => ({ ...b, name: e.target.value }))} /></div>
                <div className="cfg-field"><label>Direccion</label><input className="input" value={biz.address} onChange={(e) => setBiz((b) => ({ ...b, address: e.target.value }))} /></div>
                <div className="cfg-field"><label>Telefono</label><input className="input" value={biz.phone} onChange={(e) => setBiz((b) => ({ ...b, phone: e.target.value }))} /></div>
              </div>
              <button className="btn btn-gold" style={{ marginTop: ".5rem" }} onClick={saveBiz}><Icon name="check" size={14} /> {bizSaved ? "Guardado ✓" : "Guardar"}</button>
            </div>
            <div className="cfg-card">
              <p className="cfg-card-head">Horario operativo</p>
              <div className="ops-settings-grid">
                <label><span>Apertura</span><select className="input" defaultValue="09:00"><option>09:00</option><option>10:00</option></select></label>
                <label><span>Cierre</span><select className="input" defaultValue="20:00"><option>19:00</option><option>20:00</option><option>21:00</option></select></label>
                <label><span>Anticipacion minima</span><select className="input" defaultValue="120"><option value="60">1 hora</option><option value="120">2 horas</option><option value="240">4 horas</option></select></label>
                <label><span>Ventana de reservas</span><select className="input" defaultValue="30"><option value="14">14 dias</option><option value="30">30 dias</option></select></label>
                <label><span>Domingos</span><select className="input" defaultValue="closed"><option value="closed">Cerrado</option><option value="open">Abierto</option></select></label>
                <label><span>Cancelacion cliente</span><select className="input" defaultValue="24h"><option value="manual">Solo manual</option><option value="24h">Hasta 24h</option><option value="12h">Hasta 12h</option></select></label>
              </div>
            </div>
          </div>
        )}

        {/* PRESUPUESTOS por categoría (se guarda en este dispositivo) */}
        {section === "presupuestos" && (
          <div style={{ display: "grid", gap: "1.4rem" }}>
            <div className="cfg-card">
              <p className="cfg-card-head">Presupuesto mensual por categoría</p>
              <p style={{ fontSize: ".78rem", color: "var(--muted)", margin: "0 0 .8rem" }}>
                Define un tope por categoría para activar el semáforo de gastos. Se guarda en este dispositivo.
              </p>
              <div style={{ display: "grid", gap: ".6rem" }}>
                {EXPENSE_CATEGORIES.map((cat) => {
                  const m = CATEGORY_META[cat]
                  return (
                    <div key={cat} style={{ display: "flex", alignItems: "center", gap: ".7rem" }}>
                      <span className="dk-badge" style={{ "--c": m.color, minWidth: 130 }}><Icon name={m.icon} size={12} /> {cat}</span>
                      <input
                        className="input"
                        inputMode="numeric"
                        placeholder="Sin presupuesto"
                        style={{ flex: 1 }}
                        value={expenseBudgets[cat] ? String(expenseBudgets[cat]) : ""}
                        onChange={(e) => {
                          const v = e.target.value.replace(/\D/g, "")
                          setExpenseBudgets((b) => { const next = { ...b }; if (v) next[cat] = Number(v); else delete next[cat]; return next })
                        }}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* EQUIPO */}
        {section === "equipo" && (
          <div style={{ display: "grid", gap: "1.4rem" }}>
            <div className="cfg-card">
              <div className="cfg-card-head-row">
                <p className="cfg-card-head" style={{ margin: 0 }}>Usuarios y permisos</p>
                {canManageTeam && (
                  <button className="btn btn-gold btn-sm" onClick={() => setTeamModal({ barber: null })}>
                    <Icon name="user" size={14} /> Nuevo barbero
                  </button>
                )}
              </div>
              <div style={{ display: "grid", gap: ".6rem" }}>
                {barbers.map((item) => {
                  const lockedAdmin = item.name?.toLowerCase().includes("brunetti") || item.admin
                  const activePerms = [["canViewFinance","Finanzas"],["canEditServices","Servicios"],["canManageTeam","Equipo"],["canManageBlocks","Bloques"]]
                    .filter(([k]) => lockedAdmin || (k === "canManageBlocks" ? item[k] !== false : Boolean(item[k])))
                    .map(([, l]) => l)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`cfg-barber-row is-tappable ${item.active === false ? "is-disabled" : ""}`}
                      onClick={() => canManageTeam && setTeamModal({ barber: item })}
                      disabled={!canManageTeam}
                    >
                      <div className="cfg-barber-head">
                        <div className="cfg-barber-avatar">{(item.name || "B")[0].toUpperCase()}</div>
                        <div style={{ minWidth: 0 }}>
                          <strong style={{ fontSize: ".9rem" }}>{item.name} {lockedAdmin && <Icon name="key" size={11} color="var(--gold)" />}</strong>
                          <span style={{ fontSize: ".74rem", color: "var(--muted)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {activePerms.length ? activePerms.join(" · ") : "Sin permisos extra"}
                          </span>
                        </div>
                        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: ".5rem", flexShrink: 0 }}>
                          <span className={item.active === false ? "chip" : "chip chip-gold"}>{item.active === false ? "Inactivo" : "Activo"}</span>
                          <Icon name="arrowRight" size={15} color="var(--muted)" />
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* DATOS Y RESPALDOS */}
        {section === "datos" && (
          <div style={{ display: "grid", gap: "1.4rem" }}>
            <div className="cfg-card">
              <p className="cfg-card-head">Exportar datos</p>
              <div style={{ display: "grid", gap: ".7rem" }}>
                {[["Clientes","CSV con historial y contactos","user"],["Reservas","Historial completo de citas","calendar"],["Finanzas","Movimientos de ingresos del periodo activo","chart"],["Gastos","Registro de egresos por categoria","wallet"],["Servicios","Catalogo actual publicado","scissors"]].map(([label, sub, icon]) => (
                  <div key={label} className="cfg-setting-row">
                    <div>
                      <div className="cfg-setting-label">{label}</div>
                      <div className="cfg-setting-sub">{sub}</div>
                    </div>
                    <button className="btn btn-dark btn-sm" onClick={() => onExport(label)}><Icon name={icon} size={13} /> Exportar CSV</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="cfg-card">
              <p className="cfg-card-head">Base de datos</p>
              <div className="settings-grid">
                <div><strong>Neon PostgreSQL</strong><span>Backup automatico diario. Revisar snapshot antes de cambios masivos.</span></div>
                <div><strong>Auditoria</strong><span>Cambios de agenda y servicios quedan trazables en el log del servidor.</span></div>
              </div>
            </div>
          </div>
        )}

        {/* ACERCA DE */}
        {section === "acerca" && (
          <div style={{ display: "grid", gap: "1.4rem" }}>
            <div className="cfg-card" style={{ textAlign: "center", padding: "2rem 1.5rem" }}>
              <span className="pimp-mark" style={{ width: 72, height: 72, margin: "0 auto 1rem", display: "block" }} />
              <h3 className="font-display" style={{ margin: "0 0 .3rem", fontSize: "1.4rem" }}>BRUNETTI</h3>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: ".84rem" }}>Panel interno v2.0</p>
              <p style={{ margin: ".5rem 0 0", color: "var(--muted-2)", fontSize: ".78rem" }}>Barberia Premium · Maipu, Santiago</p>
            </div>
            <div className="cfg-card">
              <div className="settings-grid">
                <div><strong>Version</strong><span>2.0.0 — React + Vite + Vercel</span></div>
                <div><strong>Ambiente</strong><span>Produccion — rama desarrollo</span></div>
                <div><strong>Soporte</strong><span>Panel gestionado internamente.</span></div>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>
      )}

      {teamModal && (
        <BarberModal
          barber={teamModal.barber}
          canManage={canManageTeam}
          onClose={() => setTeamModal(null)}
          onSave={(payload) => { saveBarber(payload); setTeamModal(null) }}
          onDelete={(b) => { deleteBarber(b); setTeamModal(null) }}
        />
      )}
    </div>
  )
}

/* ============================================================
   Shell + Topbar — UI envoltura responsive
   ============================================================ */
function DashboardShell({ tab, setTab, nav, dockItems, barber, onLogout, onNewBooking, children }) {
  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <Brandmark size={40} sub="Panel interno" />
        <nav className="dashboard-nav">
          {nav.map(([id, ic, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`dashboard-nav-item ${tab === id ? 'is-active' : ''}`}
            >
              <Icon name={ic} size={17} /> {label}
            </button>
          ))}
        </nav>
        <div className="dashboard-sidebar-footer">
          <button onClick={onLogout} className="dashboard-logout">
            <Icon name="logout" size={15} /> Cerrar sesión
          </button>
        </div>
      </aside>
      {children}
      <MobileDock tab={tab} setTab={setTab} nav={nav} shortcuts={dockItems} onNewBooking={onNewBooking} />
    </div>
  )
}

// "hace 5m" / "hace 2h" / "hace 3d" — sin librerías, mismo estilo breve que
// el resto de los indicadores de tiempo del panel (ver nextEta más arriba).
function timeAgo(iso) {
  if (!iso) return ''
  const diffMin = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (diffMin < 1) return 'ahora'
  if (diffMin < 60) return `hace ${diffMin}m`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `hace ${diffH}h`
  return `hace ${Math.round(diffH / 24)}d`
}

function DashboardTopbar({ title, barber, onLogout, tab, setTab, nav, onRefresh, refreshing = false, search = null, scrolled = false, navigate }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  const initial = (barber?.name || 'B')[0].toUpperCase()

  // Popup de "últimas 5 notificaciones" — ver GET /api/push (sin ?job=) en
  // api/push.js. El badge cuenta las que llegaron después de la última vez
  // que se abrió el popup (marca local por barbero, mismo patrón que
  // ps_push_enabled_${barberId} en src/push.js).
  const seenKey = `ps_notif_seen_at_${barber?.id ?? 'me'}`
  const [notifOpen, setNotifOpen] = useState(false)
  const notifRef = useRef(null)
  const [notifications, setNotifications] = useState([])
  const [seenAt, setSeenAt] = useState(() => { try { return Number(localStorage.getItem(seenKey) || 0) } catch { return 0 } })

  useEffect(() => {
    if (!notifOpen) return
    const h = (e) => { if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [notifOpen])

  const loadNotifications = async () => {
    try {
      const token = localStorage.getItem('ps_barber_token') || ''
      const res = await fetch('/api/push', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      const data = await res.json()
      setNotifications(data.notifications || [])
    } catch {
      setNotifications([])
    }
  }
  // Carga inicial: para que el badge de no-vistas ya tenga datos apenas se
  // abre el panel, no solo al tocar la campana.
  useEffect(() => { loadNotifications() }, [])

  const unseenCount = notifications.filter((n) => new Date(n.createdAt).getTime() > seenAt).length

  const toggleNotif = () => {
    setNotifOpen((v) => {
      const next = !v
      if (next) {
        loadNotifications()
        const now = Date.now()
        setSeenAt(now)
        try { localStorage.setItem(seenKey, String(now)) } catch {}
      }
      return next
    })
  }

  const openNotification = (n) => {
    setNotifOpen(false)
    if (n.url) navigate?.(n.url)
  }
  return (
    <header className={`dashboard-topbar ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="dashboard-topbar-left">
        <button
          type="button"
          className="burger-btn"
          aria-label="Cambiar módulo"
          onClick={() => {
            const cur = nav.findIndex((n) => n[0] === tab)
            const next = nav[(cur + 1) % nav.length]
            if (next) setTab(next[0])
          }}
        >
          <Icon name="menu" size={18} />
        </button>
        <div className="dashboard-topbar-title">
          <strong>{title}</strong>
          <small>Brunetti</small>
        </div>
      </div>
      <div className="dashboard-topbar-actions">
        {search}
        <ThemeToggle />
        <button
          type="button"
          className="notif-pill"
          data-tip={refreshing ? 'Actualizando…' : 'Actualizar datos'}
          aria-label="Actualizar datos"
          onClick={onRefresh}
          disabled={refreshing}
          style={{ cursor: refreshing ? 'default' : 'pointer' }}
        >
          <Icon name="refresh" size={14} style={refreshing ? { animation: 'spin 0.8s linear infinite' } : undefined} />
        </button>
        <div className="notif-chip" ref={notifRef}>
          <button
            type="button"
            className="notif-pill"
            data-tip={unseenCount ? `${unseenCount} notificación(es) nueva(s)` : 'Notificaciones'}
            aria-label={unseenCount ? `${unseenCount} notificación(es) nueva(s)` : 'Notificaciones'}
            aria-haspopup="true"
            aria-expanded={notifOpen}
            onClick={toggleNotif}
            style={{ cursor: 'pointer' }}
          >
            <Icon name="bell" size={14} /> {unseenCount > 0 && unseenCount}
          </button>
          {notifOpen && (
            <div className="notif-chip-pop" role="menu">
              <div className="notif-pop-head">Notificaciones</div>
              {!notifications.length && <div className="notif-pop-empty">Sin notificaciones recientes.</div>}
              {notifications.map((n) => (
                <button key={n.id} type="button" className="notif-pop-item" onClick={() => openNotification(n)}>
                  <div className="notif-pop-title">{n.title}</div>
                  {n.body && <div className="notif-pop-body">{n.body}</div>}
                  <div className="notif-pop-time">{timeAgo(n.createdAt)}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="user-chip" ref={ref}>
          <button
            type="button"
            className="user-chip-btn"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="true"
            aria-expanded={open}
            title={barber?.name || 'Cuenta'}
          >
            {initial}
          </button>
          {open && (
            <div className="user-chip-pop" role="menu">
              <div className="user-pop-name">
                <strong>{barber?.name || 'Cuenta'}</strong>
                <span>{barber?.role || 'Barbero'}</span>
              </div>
              <button className="user-pop-item" type="button" onClick={onLogout}>
                <Icon name="logout" size={15} /> Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
