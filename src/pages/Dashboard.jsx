import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Brandmark, Icon } from '../components/ui.jsx'
import { ThemeToggle } from '../components/theme.jsx'
import MobileDock from '../components/MobileDock.jsx'
import { BARBERS, CLIENTS, EXPENSES, SERVICES, TODAY_BOOKINGS, barberById, isAdminUser, cleanPhone } from '../data.js'
import { addLocalBooking, mergeBookings, readLocalBookings } from '../bookingsStore.js'
import BookingsInbox from '../components/BookingsInbox.jsx'
import BookingSyncIssues from '../components/BookingSyncIssues.jsx'
import DashboardResumen from '../components/DashboardResumen.jsx'
import NewBookingModal from '../components/NewBookingModal.jsx'
import GlobalSearch from '../components/GlobalSearch.jsx'
import NewClientModal from '../components/NewClientModal.jsx'
import ExpensesModule from '../components/ExpensesModule.jsx'
import { registerServiceWorker, notifyBarberOfBooking, pushEnabledFor } from '../push.js'
import {
  AGENDA_SLOTS, SESSION_TIMEOUT_MS, MAX_LEAD_DAYS, AGENDA_MAX_KEY, ALWAYS_NAV,
  minToBlocks, isoDate, buildWeek, localBlockKey, readLocalBlocks, writeLocalBlocks,
} from './panel/shared.jsx'
import { BookingDetailModal } from './panel/BookingDetailSheet.jsx'
import AgendaTab from './panel/AgendaTab.jsx'
import FinanzasTab from './panel/FinanzasTab.jsx'
import ClientesTab from './panel/ClientesTab.jsx'
import InscripcionesTab from './panel/InscripcionesTab.jsx'
import PedidosTab from './panel/PedidosTab.jsx'
import ServiciosTab, { ServiciosDialogs } from './panel/ServiciosTab.jsx'
import EssentialsTab, { EssentialsDialogs } from './panel/EssentialsTab.jsx'
import ConfigTab from './panel/ConfigTab.jsx'
import MarketingTab from './panel/MarketingTab.jsx'

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
  // Confirmación en dos toques: el push sale al celular de decenas de
  // clientes y no existe el "deshacer". Se resetea con cualquier cambio de
  // mensaje o audiencia para que nunca se confirme algo distinto a lo leído.
  const [campaignConfirming, setCampaignConfirming] = useState(false)
  const [cardTestPhone, setCardTestPhone] = useState("")
  const [cardTestEmail, setCardTestEmail] = useState("")
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

  // Carga bajo demanda las reservas de una semana PASADA (fuera de las últimas
  // 160 que trae el fetch inicial) vía ?from&to, y las mezcla por id al estado.
  // Cachea los rangos ya pedidos para no repetir el viaje al navegar.
  const loadedRangesRef = useRef(new Set())
  // Devuelve la promesa del fetch SOLO cuando realmente va a la red; si el
  // rango ya estaba cargado devuelve undefined, y quien llama lo usa para
  // saber si tiene que mostrar "cargando" (ver CalendarModal).
  const ensurePastBookings = (fromKey, toKey) => {
    if (!fromKey || !toKey) return
    if (toKey >= isoDate(new Date())) return // presente/futuro: ya viene en el fetch inicial
    const rangeKey = `${fromKey}|${toKey}`
    if (loadedRangesRef.current.has(rangeKey)) return
    loadedRangesRef.current.add(rangeKey)
    return fetch(`/api/bookings?from=${fromKey}&to=${toKey}`, { headers: authHeaders() })
      .then((r) => r.headers.get("content-type")?.includes("application/json") ? r.json() : Promise.reject(new Error("api unavailable")))
      .then((data) => {
        if (!data.bookings?.length) return
        setBookings((current) => {
          const byId = new Map(current.map((b) => [String(b.id), b]))
          data.bookings.forEach((b) => byId.set(String(b.id), b))
          return [...byId.values()]
        })
      })
      .catch(() => { loadedRangesRef.current.delete(rangeKey) }) // reintentable
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
    // Semanas pasadas: sus reservas pueden quedar fuera de las últimas 160
    // del fetch inicial; se piden por rango bajo demanda.
    ensurePastBookings(weekDays[0]?.key, weekDays[6]?.key)
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
  // Cambia en cada recarga manual para que las vistas con su propia semana
  // (BookingsInbox) vuelvan a pedir el rango que están mostrando: los fetches
  // de abajo REEMPLAZAN la lista por las últimas 160 reservas, así que se
  // llevan puestas las semanas pasadas que se hubieran cargado por rango.
  const [pastRangeEpoch, setPastRangeEpoch] = useState(0)
  const refreshAll = async () => {
    if (refreshing) return
    setRefreshing(true)
    const headers = authHeaders()
    // Sin esto, los rangos ya pedidos quedarían marcados como cargados
    // mientras sus reservas ya no están en memoria: la semana pasada se
    // vaciaba al refrescar y no volvía hasta recargar la página entera.
    loadedRangesRef.current.clear()
    await Promise.all([
      fetch("/api/clients", { headers }).then((r) => r.json()).then((data) => { if (data.clients?.length) setClients(data.clients) }).catch(() => {}),
      fetch("/api/bookings", { headers }).then((r) => r.json()).then((data) => { if (data.bookings) setBookings(mergeBookings(data.bookings)) }).catch(() => {}),
      fetch("/api/services?includeInactive=true", { headers }).then((r) => r.json()).then((data) => { if (data.services?.length) setServices(data.services) }).catch(() => {}),
      fetch("/api/expenses", { headers }).then((r) => r.json()).then((data) => { if (data.expenses?.length) setExpenses(data.expenses) }).catch(() => {}),
      fetch("/api/services?scope=shop&includeInactive=true", { headers }).then((r) => r.json()).then((data) => { if (data.products) setProducts(data.products) }).catch(() => {}),
      loadAgenda(),
    ])
    // Ya con la lista fresca en memoria, se vuelve a pedir la semana visible
    // si es pasada (acá para Agenda; pastRangeEpoch lo hace en Reservas).
    ensurePastBookings(weekDays[0]?.key, weekDays[6]?.key)
    setPastRangeEpoch((n) => n + 1)
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
    ...(admin ? [["pedidos", "wallet", "Pedidos"]] : []),
    ...(canEditServices ? [["servicios", "cut", "Servicios"]] : []),
    ...(admin ? [["essentials", "gift", "Essentials"]] : []),
    ...(admin ? [["gastos", "wallet", "Gastos"]] : []),
    ["marketing",      "spark",    "Marketing"],
    ["config",         "key",      "Config."],
  ]

  // Acceso por barbero: Bruno (admin) ve todo. El admin concede módulos por barbero
  // (barber.modules) para los módulos "abiertos"; Finanzas/Servicios/Gastos siguen
  // por permiso. Resumen y Config siempre disponibles.
  const MODULE_IDS = ["agenda", "reservas", "clientes", "marketing"]
  const barberModules = Array.isArray(barber?.modules) ? barber.modules : null
  const accessibleNav = nav.filter(([id]) => {
    if (admin || !barberModules) return true
    if (MODULE_IDS.includes(id)) return barberModules.includes(id)
    return true
  })
  // Preferencia personal de visibilidad (config → módulos visibles).
  const personalNav = accessibleNav.filter(([id]) => ALWAYS_NAV.includes(id) || navSettings[id] !== false)
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
      // Lo que no salió aunque la reserva sí (p. ej. la estrella de una
      // atención que nace completada): el repaso de PimpStudio la repone, pero
      // quien la cargó tiene que saberlo.
      if (json.notice) pushToast("⚠️", json.notice)
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
    if (!barber) return
    // Las cifras también las usa el Resumen (la tarjeta "Tarjetas en
    // Wallet"), así que se piden en las dos pestañas — pero una sola vez:
    // sin el guard, cada ida y vuelta entre Resumen y Marketing pagaba otro
    // round-trip al otro proyecto.
    if (tab !== "marketing" && tab !== "resumen") return
    if (!walletStats) {
      fetch("/api/clients?mode=wallet-stats", { headers: authHeaders() })
        .then((r) => r.json())
        .then((data) => { if (data?.stats) setWalletStats(data.stats) })
        .catch(() => {})
    }
    // El historial de campañas solo interesa en Marketing.
    if (tab === "marketing" && !campaigns.length) {
      fetch("/api/clients?mode=wallet-campaigns", { headers: authHeaders() })
        .then((r) => r.json())
        .then((data) => { if (data?.campaigns) setCampaigns(data.campaigns) })
        .catch(() => {})
    }
  }, [tab, barber])

  /* Cuántos clientes caen en una audiencia. Lo calcula el backend junto con
     el resto de las métricas (api/_loyalty.js de PimpStudio) — acá no se
     replica el criterio, justamente para que el número del chip y el del
     envío no puedan discrepar. */
  const audienceCount = (id) => walletStats?.audienceCounts?.[id] ?? 0

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
      setCampaignConfirming(false)
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
  const sendLoyaltyCards = async ({ onlyPhone = null, again = false, includeInstalled = false, testEmail = null }) => {
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
          body: JSON.stringify({ limit: onlyPhone ? 1 : 5, onlyPhone, again, includeInstalled, testEmail }),
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

  // La agenda del barbero se administra semana por semana, y hacia adelante
  // llega hasta AGENDA_MAX_KEY (siempre alcanza la ventana reservable del
  // cliente, MAX_LEAD_DAYS). Cambiar de semana reubica el día seleccionado si
  // el actual no pertenece a la semana nueva.
  const goToWeek = (offset) => {
    const wd = buildWeek(offset)
    setWeekOffset(offset)
    if (!wd.some((d) => d.key === agendaDayKey)) setAgendaDayKey(wd[0].key)
  }

  // Date-picker propio de Agenda: cualquier fecha pasada es elegible (para
  // revisar semanas ya transcurridas); hacia adelante el tope es AGENDA_MAX_KEY.
  // Cubre siempre la ventana reservable del cliente (MAX_LEAD_DAYS): el tope
  // anterior era el domingo de la semana siguiente, que un viernes/sábado/domingo
  // cae a +9/+8/+7 y dejaba días reservables que el barbero no podía abrir acá.
  const calPrevMonth = () => setCalMonth((m) => { if (m === 0) { setCalYear((y) => y - 1); return 11 } return m - 1 })
  const calNextMonth = () => setCalMonth((m) => { if (m === 11) { setCalYear((y) => y + 1); return 0 } return m + 1 })
  const pickCalendarDay = (key) => {
    setCalOpen(false)
    const maxKey = AGENDA_MAX_KEY()
    if (key > maxKey) { pushToast("📅", `Fecha fuera del rango reservable (${MAX_LEAD_DAYS} días)`); return }
    const mondayOf = (iso) => {
      const d = new Date(`${iso}T00:00:00`)
      const dow = d.getDay() || 7
      d.setDate(d.getDate() - dow + 1)
      d.setHours(0, 0, 0, 0)
      return d
    }
    setWeekOffset(Math.round((mondayOf(key) - mondayOf(isoDate(new Date()))) / (7 * 86400000)))
    setAgendaDayKey(key)
  }

  if (!barber) return null

  /* Contexto del panel para las pestañas (src/pages/panel/*Tab.jsx): cada una
     toma de acá lo que necesita. Va completo (estado, derivados y acciones)
     para que rediseñar una pestaña no obligue a tocar este archivo solo para
     pasarle un dato más. authHeaders viaja como función: en PimpStudio,
     ConfigPanel la llamaba sin recibirla y el ReferenceError dejaba el panel
     en negro al abrir Config (d4466e2). */
  const dash = {
    BRUNETTI_ONLY,
    activeClients,
    admin,
    agendaBarber,
    agendaBusy,
    agendaDayKey,
    agendaError,
    agendaQuery,
    agendaView,
    applyClientLoyalty,
    audienceCount,
    authHeaders,
    availability,
    avgTicket,
    barber,
    barberDraft,
    barbers,
    bookingForSlot,
    bookings,
    bulkAgenda,
    calMonth,
    calNextMonth,
    calOpen,
    calPrevMonth,
    calRef,
    calYear,
    campaignAudience,
    campaignConfirming,
    campaignMessage,
    campaignSending,
    campaigns,
    canEditServices,
    canManageTeam,
    canViewFinance,
    cardProgress,
    cardSending,
    cardStopRef,
    cardTestEmail,
    cardTestPhone,
    clientActivityOf,
    clientEditing,
    clientFilter,
    clientHistory,
    clientKey,
    clientQuery,
    clientSort,
    clients,
    completedBookings,
    createBooking,
    createClient,
    createExpense,
    deleteBarber,
    deleteBooking,
    deleteClient,
    deleteExpense,
    deleteProduct,
    deleteService,
    deleteSvc,
    detail,
    dockItems,
    dockShortcuts,
    dragRef,
    editProductId,
    editSvcId,
    ensurePastBookings,
    expenseBudgets,
    expenses,
    exportCSV,
    filteredClients,
    financePeriod,
    financeSort,
    goToDayInReservas,
    goToPendingInReservas,
    goToWeek,
    inactiveClients,
    inboxFocus,
    loadAgenda,
    logout,
    monthExpensesTotal,
    monthKeyNow,
    nav,
    navSettings,
    navigate,
    newBookingOpen,
    newClientOpen,
    newClientsCount,
    openClient,
    pastRangeEpoch,
    periodStartKey,
    personalNav,
    pickCalendarDay,
    prevWeekStats,
    productDraft,
    productOpen,
    productUploading,
    products,
    pushToast,
    ranking,
    recurringPct,
    redeemFreeCut,
    refreshAll,
    refreshing,
    removeProduct,
    revenueByDate,
    revenueByService,
    revenueTotal,
    saveBarber,
    saveClient,
    saveProduct,
    saveService,
    searchParams,
    selectedClient,
    sendCampaign,
    sendLoyaltyCard,
    sendLoyaltyCards,
    serviceDraft,
    serviceOpen,
    services,
    setAgendaBarber,
    setAgendaBusy,
    setAgendaDayKey,
    setAgendaError,
    setAgendaQuery,
    setAgendaView,
    setAvailability,
    setBarber,
    setBarberDraft,
    setBarbers,
    setBookings,
    setCalMonth,
    setCalOpen,
    setCalYear,
    setCampaignAudience,
    setCampaignConfirming,
    setCampaignMessage,
    setCampaignSending,
    setCampaigns,
    setCardProgress,
    setCardSending,
    setCardTestEmail,
    setCardTestPhone,
    setClientEditing,
    setClientFilter,
    setClientHistory,
    setClientQuery,
    setClientSort,
    setClients,
    setDeleteProduct,
    setDeleteSvc,
    setDetail,
    setDockShortcuts,
    setEditProductId,
    setEditSvcId,
    setExpenseBudgets,
    setExpenses,
    setFinancePeriod,
    setFinanceSort,
    setInboxFocus,
    setNavSettings,
    setNewBookingOpen,
    setNewClientOpen,
    setPastRangeEpoch,
    setPrevWeekStats,
    setProductDraft,
    setProductOpen,
    setProductUploading,
    setProducts,
    setRefreshing,
    setSelectedClient,
    setServiceDraft,
    setServiceOpen,
    setServices,
    setTab,
    setToasts,
    setTopbarScrolled,
    setWalletStats,
    setWeekOffset,
    sortedClients,
    sortedFinanceRows,
    svcMinByName,
    tab,
    toasts,
    todayKeyNow,
    toggleClientSort,
    toggleFinanceSort,
    toggleSlot,
    topClients,
    topbarScrolled,
    updateBarberLocal,
    updateBookingStatus,
    updateExpense,
    uploadProductPhoto,
    upsertClientLocal,
    visibleBookings,
    visibleNav,
    walletStats,
    weekDays,
    weekOffset,
    weekStats,
  }

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
            <DashboardResumen bookings={bookings} barbers={barbers} expenses={expenses} clients={clients} todaySlots={availability[isoDate(new Date())] || []} walletStats={walletStats} onNewBooking={() => setNewBookingOpen(true)} onGoToPending={goToPendingInReservas} onGoToMarketing={() => setTab("marketing")} />
          </div>
        )}

        {/* AGENDA */}
        {tab === "agenda" && agendaDayKey && <AgendaTab ctx={dash} />}

        {/* RESERVAS */}
        {tab === "reservas" && (
          <BookingsInbox
            bookings={visibleBookings}
            onEnsureRange={ensurePastBookings}
            rangeEpoch={pastRangeEpoch}
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
        {tab === "finanzas" && <FinanzasTab ctx={dash} />}

        {/* CLIENTES */}
        {tab === "clientes" && <ClientesTab ctx={dash} />}

        {/* INSCRIPCIONES */}
        {tab === "inscripciones" && <InscripcionesTab ctx={dash} />}

        {/* PEDIDOS */}
        {tab === "pedidos" && <PedidosTab ctx={dash} />}

        {/* SERVICIOS */}
        {tab === "servicios" && <ServiciosTab ctx={dash} />}

        {/* ESSENTIALS (tienda de clientes) */}
        {tab === "essentials" && <EssentialsTab ctx={dash} />}

        {/* CONFIRMAR ELIMINAR PRODUCTO y MODAL NUEVO PRODUCTO (EssentialsTab.jsx):
            fuera del filtro de pestaña, como siempre */}
        <EssentialsDialogs ctx={dash} />

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

        {/* CONFIRMAR ELIMINAR SERVICIO y MODAL NUEVO SERVICIO (ServiciosTab.jsx):
            fuera del filtro de pestaña, como siempre */}
        <ServiciosDialogs ctx={dash} />

        {/* CONFIG */}
        {tab === "config" && <ConfigTab ctx={dash} />}

        {/* MARKETING */}
        {tab === "marketing" && <MarketingTab ctx={dash} />}
      </main>
    </DashboardShell>
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
