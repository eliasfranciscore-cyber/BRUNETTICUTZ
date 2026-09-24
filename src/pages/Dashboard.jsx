import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PanelShell, PanelTopbar } from '../components/panel/Shell.jsx'
import { InlineAlert } from '../components/panel/index.js'
import { BARBERS, CLIENTS, EXPENSES, SERVICES, TODAY_BOOKINGS, barberById, isAdminUser, cleanPhone, CLP, santiagoDateKey } from '../data.js'
import { FEATURES } from '../features.js'
import { addLocalBooking, mergeBookings, readLocalBookings } from '../bookingsStore.js'
import BookingsInbox from '../components/BookingsInbox.jsx'
import BookingSyncIssues from '../components/BookingSyncIssues.jsx'
import DashboardResumen from '../components/DashboardResumen.jsx'
import NewBookingModal from '../components/NewBookingModal.jsx'
import GlobalSearch from '../components/GlobalSearch.jsx'
import NewClientModal from '../components/NewClientModal.jsx'
import ExpensesModule from '../components/ExpensesModule.jsx'
import ChargeSheet from '../components/ChargeSheet.jsx'
import InstallPrompt, { useAutoInstallPrompt } from '../components/InstallPrompt.jsx'
import { registerServiceWorker, notifyBarberOfBooking, pushEnabledFor, syncPush } from '../push.js'
import { waHref, waWalletShareMessage } from '../whatsapp.js'
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
import ServiciosTab from './panel/ServiciosTab.jsx'
import EssentialsTab from './panel/EssentialsTab.jsx'
import ConfigTab from './panel/ConfigTab.jsx'
import MarketingTab from './panel/MarketingTab.jsx'
import CajaTab from './panel/CajaTab.jsx'
import FinanceMovementSheet from './panel/FinanceMovementSheet.jsx'

/* Catálogo de pestañas del panel: [id, ícono, rótulo, grupo]. El grupo
   ('dia' | 'negocio', ver NAV_GROUPS en components/panel/Shell.jsx) ordena el
   menú lateral, el dock y su hoja igual en los tres lugares; Ajustes va suelto.
   Es una función (y no un arreglo dentro del componente) porque también la
   usa el deep link de una notificación, antes de que la sesión esté en el
   estado. Acá no hay permisos por módulo: los mismos filtros de siempre
   (admin / finanzas / servicios) deciden qué se ve, y `has()` sale de acá. */
function buildNav({ admin, canViewFinance, canEditServices }) {
  return [
    ["resumen",       "grid",      "Resumen",       "dia"],
    ["agenda",        "calendar",  "Agenda",        "dia"],
    ["reservas",      "scissors",  "Reservas",      "dia"],
    ...(FEATURES.cash && canViewFinance ? [["caja", "cash", "Caja", "dia"]] : []),
    ["clientes",      "users",     "Clientes",      "dia"],
    ...(canViewFinance ? [["finanzas", "chart", "Finanzas", "negocio"]] : []),
    ...(admin ? [["gastos", "wallet", "Gastos", "negocio"]] : []),
    ...(admin ? [["pedidos", "box", "Pedidos", "negocio"]] : []),
    ["inscripciones", "sparkles",  "Inscripciones", "negocio"],
    ...(canEditServices ? [["servicios", "cut", "Servicios", "negocio"]] : []),
    ...(admin ? [["essentials", "gift", "Essentials", "negocio"]] : []),
    ["marketing",     "megaphone", "Marketing",     "negocio"],
    ["config",        "settings",  "Ajustes",       null],
  ]
}

const DEMO_TODAY = () => TODAY_BOOKINGS.map((item, index) => ({ ...item, id: index + 1, date: isoDate(new Date()) }))
const EMPTY_SALES = { items: [], totals: { units: 0, collected: 0 } }
const isJson = (res) => Boolean(res?.headers?.get("content-type")?.includes("application/json"))

export default function Dashboard() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState("agenda")
  const [agendaBarber, setAgendaBarber] = useState(null)
  const [agendaDayKey, setAgendaDayKey] = useState(null)
  const [weekOffset, setWeekOffset] = useState(0)
  const [availability, setAvailability] = useState({})
  // A qué barbero corresponde la grilla que hay en `availability` (el objeto
  // se indexa solo por fecha). Con un solo barbero casi no cambia, pero es lo
  // que permite saber si la grilla ya cargó: slotsFor() devuelve vacío hasta
  // entonces y nadie opera sobre horas que todavía no llegaron.
  const [availabilityOf, setAvailabilityOf] = useState(null)
  const [agendaBusy, setAgendaBusy] = useState("")
  const [agendaError, setAgendaError] = useState("")
  // Rediseño Agenda: vista Bloques/Línea, buscador local, date-picker propio,
  // modal de detalle de reserva, toasts de confirmación y comparativo vs.
  // semana anterior para los deltas de KPI.
  const [agendaView, setAgendaView] = useState("grid") // 'grid' | 'timeline'
  const [agendaQuery, setAgendaQuery] = useState("")
  const [calOpen, setCalOpen] = useState(false)
  const [detail, setDetail] = useState(null)
  const [toasts, setToasts] = useState([])
  const [prevWeekStats, setPrevWeekStats] = useState(null)
  const dragRef = useRef({ active: false, mode: null })
  const [barber, setBarber] = useState(null)
  const [barbers, setBarbers] = useState(BARBERS.map((item) => ({ ...item, active: true })))
  const [bookings, setBookings] = useState(mergeBookings(DEMO_TODAY()))
  // Error al leer las reservas con sesión (500/401): el panel lo avisa arriba
  // en vez de mostrar filas inventadas. Sin API (npm run dev sin mock) sigue
  // la demo local de siempre.
  const [apiError, setApiError] = useState("")
  const [clients, setClients] = useState(CLIENTS)
  const [clientQuery, setClientQuery] = useState("")
  const [clientFilter, setClientFilter] = useState("all")
  const [clientSort, setClientSort] = useState({ key: "name", dir: "asc" })
  const [financePeriod, setFinancePeriod] = useState("mes") // "semana" | "mes" | "año"
  const [financeSort, setFinanceSort] = useState({ key: "date", dir: "desc" })
  // Cambiar de módulo arranca arriba: .dashboard-main es el único scroller y
  // conservaba la posición de la pestaña anterior.
  const mainRef = useRef(null)
  useEffect(() => { mainRef.current?.scrollTo?.({ top: 0 }) }, [tab])
  const [selectedClient, setSelectedClient] = useState(null)
  const [clientHistory, setClientHistory] = useState([])
  const [clientEditing, setClientEditing] = useState(false)
  const [services, setServices] = useState(SERVICES.map((item) => ({ ...item, active: true })))
  const [expenses, setExpenses] = useState(EXPENSES)
  // onlyOnDate: null (no "") = todos los días; el mock rechaza "" con un 400.
  const [serviceDraft, setServiceDraft] = useState({ name: "", price: "", min: 60, cat: "general", desc: "", tne: false, onlyOnDate: null })
  const [products, setProducts] = useState([])
  const [productDraft, setProductDraft] = useState({ name: "", brand: "", price: "", stock: "0", description: "" })
  // El stock que tenía el producto al abrir la ficha: sin el valor original no
  // se puede mostrar "8 → 12: queda un ajuste" (FEATURES.inventory).
  const [stockBefore, setStockBefore] = useState(null)
  const [essentialsView, setEssentialsView] = useState("catalogo") // 'catalogo' | 'vender' | 'inventario'
  const [productOpen, setProductOpen] = useState(false)
  const [editProductId, setEditProductId] = useState(null)
  const [deleteProduct, setDeleteProduct] = useState(null)
  const [productUploading, setProductUploading] = useState(null) // `${id}-${slot}` mientras sube
  const [expenseBudgets, setExpenseBudgets] = useState(() => { try { return JSON.parse(localStorage.getItem("ps_expense_budgets") || "{}") } catch { return {} } })
  useEffect(() => { try { localStorage.setItem("ps_expense_budgets", JSON.stringify(expenseBudgets)) } catch {} }, [expenseBudgets])
  const [serviceOpen, setServiceOpen] = useState(false)
  const [newBookingOpen, setNewBookingOpen] = useState(false)
  // Cliente con que se abre "Nueva reserva" desde su ficha (botón Agendar).
  // null = hoja en blanco, como desde cualquier otro lado.
  const [newBookingPrefill, setNewBookingPrefill] = useState(null)
  const [newClientOpen, setNewClientOpen] = useState(false)
  const [inboxFocus, setInboxFocus] = useState(null)
  // null | { kind: 'gasto' | 'ingreso', initial? } — qué movimiento de
  // Finanzas/Gastos se está creando o editando (FinanceMovementSheet).
  const [financeMovementModal, setFinanceMovementModal] = useState(null)
  // Sección de Ajustes que se abre al llegar desde otra pestaña (p. ej. Gastos → "Presupuestos"). null = la lista.
  const [configSection, setConfigSection] = useState(null)
  // Fidelidad (pestaña Marketing): las cifras y las campañas viven en Pimp
  // Studio y llegan por el puente — ver api/_loyaltyBridge.js.
  const [walletStats, setWalletStats] = useState(null)
  const [walletCampaigns, setWalletCampaigns] = useState([])
  const [campaignMessage, setCampaignMessage] = useState("")
  const [campaignAudience, setCampaignAudience] = useState("all")
  const [campaignSending, setCampaignSending] = useState(false)
  const [campaignError, setCampaignError] = useState("")
  const [campaignSentNote, setCampaignSentNote] = useState("")
  // Confirmación en dos toques: el push sale al celular de decenas de
  // clientes y no existe el "deshacer". Se resetea con cualquier cambio de
  // mensaje o audiencia para que nunca se confirme algo distinto a lo leído.
  const [campaignConfirming, setCampaignConfirming] = useState(false)
  const [cardTestPhone, setCardTestPhone] = useState("")
  const [cardTestEmail, setCardTestEmail] = useState("")
  const [cardSending, setCardSending] = useState(false)
  const [cardProgress, setCardProgress] = useState("")
  const cardStopRef = useRef(false)
  // Cliente al que se le está armando el link de la tarjeta (botón "Tarjeta").
  const [walletSendingId, setWalletSendingId] = useState(null)
  const [editSvcId, setEditSvcId] = useState(null)
  const [deleteSvc, setDeleteSvc] = useState(null)
  // Preferencias de navegación (persisten por dispositivo): qué módulos se ven y
  // qué 4 atajos van en el dock. Se aplican al nav/dock reales.
  const [navSettings, setNavSettings] = useState(() => { try { return JSON.parse(localStorage.getItem("ps_nav_settings") || "{}") } catch { return {} } })
  const [dockShortcuts, setDockShortcuts] = useState(() => { try { const s = JSON.parse(localStorage.getItem("ps_dock_shortcuts") || "null"); return Array.isArray(s) && s.length ? s : ["resumen", "agenda", "reservas", "clientes"] } catch { return ["resumen", "agenda", "reservas", "clientes"] } })
  useEffect(() => { try { localStorage.setItem("ps_nav_settings", JSON.stringify(navSettings)) } catch {} }, [navSettings])
  useEffect(() => { try { localStorage.setItem("ps_dock_shortcuts", JSON.stringify(dockShortcuts)) } catch {} }, [dockShortcuts])

  /* Hoja de cobro. Se resuelve con una promesa para que updateBookingStatus
     siga siendo `await`-able desde todos sus llamadores (detalle, Reservas,
     Agenda, "Sin cerrar", Caja) sin que ninguno sepa que hay un paso
     intermedio. Con FEATURES.charge en false no se abre nunca: resuelve null
     al instante, así ninguna promesa queda colgada de una hoja que no existe. */
  const [chargeSheet, setChargeSheet] = useState(null)
  const chargeResolver = useRef(null)
  const askForCharge = (booking, mode = "cobrar", loyalty = null) => {
    if (!FEATURES.charge) return Promise.resolve(null)
    // Un segundo toque mientras la hoja está abierta: la anterior se da por
    // cancelada en vez de quedar esperando para siempre.
    if (chargeResolver.current) chargeResolver.current(null)
    return new Promise((resolve) => {
      chargeResolver.current = resolve
      setChargeSheet({ booking, mode, loyalty })
    })
  }
  const settleCharge = (payment) => {
    setChargeSheet(null)
    const resolve = chargeResolver.current
    chargeResolver.current = null
    if (resolve) resolve(payment || null)
  }

  /* Caja del día (FEATURES.cash): el servidor manda el arqueo ya calculado,
     acá no se rehace ninguna cuenta. undefined = cargando, null = error. */
  // El "hoy" de Santiago, el mismo del servidor y del botón "Hoy" de Caja.
  const [cashDay, setCashDay] = useState(() => santiagoDateKey())
  const [cashData, setCashData] = useState(undefined)
  /* Catálogo VENDIBLE (FEATURES.sales), distinto del catálogo administrable
     de Essentials: solo lo activo y con stock, para la hoja de cobro y la
     venta en el mesón. */
  const [sellable, setSellable] = useState([])
  // Ventas de producto del período de Finanzas (?mode=sales).
  const [productSales, setProductSales] = useState(EMPTY_SALES)
  /* Pedidos pagados por la web (Cursos, Workshop, Essentials) vía Mercado
     Pago: los usan Pedidos, el KPI "Ventas online" de Finanzas y Resumen, y
     la línea online de Caja. Se piden una vez (admin) y en cada Actualizar. */
  const [onlineOrders, setOnlineOrders] = useState([])
  const [onlineOrdersLoading, setOnlineOrdersLoading] = useState(false)
  const [onlineOrdersError, setOnlineOrdersError] = useState("")
  // Resumen del servidor para el período de Finanzas (?panel=1&summary=1):
  // no se corta en el LIMIT 300 de la lista. null hasta que exista.
  const [onlineSummary, setOnlineSummary] = useState(null)
  const onlineSummaryUnsupportedRef = useRef(false)

  const admin = isAdminUser(barber)
  const barberId = barber?.id ?? null
  const canViewFinance = admin || Boolean(barber?.canViewFinance)
  const canEditServices = admin || Boolean(barber?.canEditServices)
  // Cobrar (monto + medio) al completar: acá lo hace el mismo barbero.
  const canCharge = true
  const canBlockAgenda = admin || barber?.canManageBlocks !== false

  const nav = buildNav({ admin, canViewFinance, canEditServices })
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
  /* ¿Existe este módulo para quien inició sesión? Sale del mismo filtro del
     menú (no hay un segundo modelo de permisos) y se calcula ANTES de la
     preferencia personal: esconder una pestaña en Ajustes no le apaga sus
     funciones. Ajustes existe siempre. */
  const has = (id) => id === "config" || accessibleNav.some(([n]) => n === id)
  // Preferencia personal de visibilidad (config → módulos visibles).
  const personalNav = accessibleNav.filter(([id]) => ALWAYS_NAV.includes(id) || navSettings[id] !== false)
  const visibleNav = personalNav
  // Atajos del dock: los 4 elegidos, sólo si son accesibles/visibles.
  const dockItems = dockShortcuts.map((id) => visibleNav.find((n) => n[0] === id)).filter(Boolean).slice(0, 4)

  // Foto chica para el avatar de la barra, el menú lateral y el Resumen: la
  // sesión guardada no la trae, así que sale del recorte de src/data.js.
  const myPhoto = barber?.avatar || BARBERS.find((b) => Number(b.id) === Number(barber?.id))?.avatar || null
  // Resolutor de barbero para filas y CSV: la lista del estado primero, el
  // catálogo estático de respaldo.
  const barberOf = (id) => barbers.find((b) => Number(b.id) === Number(id)) || barberById(Number(id))

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
  const todayKeyNow = isoDate(new Date())
  const monthKeyNow = todayKeyNow.slice(0, 7)
  const visibleBookings = admin ? bookings : bookings.filter((item) => Number(item.barberId) === Number(barber?.id))

  /* Cada reserva con lo que se sabe de su cliente (tarjeta de Wallet y
     profesión), cruzado por teléfono con la lista de clientes: el detalle y
     Reservas lo muestran sin buscar al cliente cada vez. Es lo que las
     pestañas reciben como `bookings`. */
  const clientByPhone = useMemo(() => new Map(clients.map((c) => [cleanPhone(c.phone), c])), [clients])
  const bookingsView = useMemo(() => visibleBookings.map((b) => {
    const c = clientByPhone.get(cleanPhone(b.phone))
    if (!c) return b
    return { ...b, walletHasPass: b.walletHasPass ?? c.walletHasPass, profession: b.profession ?? c.profession }
  }), [visibleBookings, clientByPhone])

  // La agenda siempre habla de UN barbero (la grilla se pide por barberId).
  const agendaBookings = visibleBookings.filter((item) => Number(item.barberId) === Number(agendaBarber))
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
    return agendaBookings.find((b) => {
      if (b.date !== dayKey || b.status === "cancelada") return false
      const startIdx = AGENDA_SLOTS.indexOf(b.time)
      if (startIdx === -1) return false
      const blocks = minToBlocks(svcMinByName[b.service])
      return idx >= startIdx && idx < startIdx + blocks
    }) || null
  }

  /* ---- Plata --------------------------------------------------------------
     Qué cuenta como ingreso. Hoy (FEATURES.unclosed apagado) sigue la regla
     de siempre: completada, confirmada o en curso — así los números no bajan
     antes de que exista la pantalla "Sin cerrar" para arreglarlos. Con "Sin
     cerrar" pasa a ser solo lo COMPLETADO, por el monto que de verdad se
     cobró (`paidAmount`; el `price` cubre las completadas de antes del cobro
     con medio de pago). */
  const isEarned = FEATURES.unclosed
    ? (item) => item.status === "completada"
    : (item) => item.status === "completada" || item.status === "confirmada" || item.status === "en curso"
  const collectedOf = (item) => Number(item.paidAmount ?? item.price ?? 0)
  const completedBookings = visibleBookings.filter((item) => isEarned(item) && (item.date || "") >= periodStartKey)
  const serviceRevenueTotal = completedBookings.reduce((sum, item) => sum + collectedOf(item), 0)
  // Ventas de producto en el mesón (FEATURES.sales): plata que entra a caja
  // aparte de los servicios.
  const productRevenueTotal = FEATURES.sales ? Number(productSales?.totals?.collected || 0) : 0
  const revenueTotal = serviceRevenueTotal + productRevenueTotal
  // El ticket promedio es POR ATENCIÓN y solo de servicios.
  const avgTicket = completedBookings.length ? Math.round(serviceRevenueTotal / completedBookings.length) : 0
  // Lo agendado a futuro se muestra aparte, rotulado como tal, en vez de
  // colarse dentro del ingreso.
  const bookedAhead = visibleBookings
    .filter((item) => (item.status === "confirmada" || item.status === "en curso" || item.status === "pendiente") && (item.date || "") >= todayKeyNow)
    .reduce((sum, item) => sum + Number(item.price || 0), 0)
  // Ventas online (web): del resumen del servidor si ya existe; si no, de la
  // lista de pedidos filtrada por fecha de Santiago.
  const onlineInRange = (fromKey, toKey = todayKeyNow) => onlineOrders
    .filter((o) => { const k = santiagoDateKey(o.created_at); return k && k >= fromKey && k <= toKey })
    .reduce((sum, o) => sum + Number(o.amount || 0), 0)
  const onlineRevenueTotal = onlineSummary && onlineSummary.from === periodStartKey
    ? Number(onlineSummary.total || 0)
    : onlineInRange(periodStartKey)
  const onlineMonthTotal = financePeriod === "mes" && onlineSummary && onlineSummary.from === periodStartKey
    ? Number(onlineSummary.total || 0)
    : onlineInRange(`${monthKeyNow}-01`)
  // `expenses` puede traer gastos e ingresos manuales (?kind=all con
  // FEATURES.manualIncome); una fila sin kind es un gasto, como siempre.
  const monthExpensesTotal = expenses.filter((e) => (e.date || "").startsWith(monthKeyNow) && (e.kind || "gasto") === "gasto").reduce((sum, e) => sum + Number(e.amount || 0), 0)
  const scopedManualMovements = expenses.filter((e) => (e.date || "") >= periodStartKey)
  const manualIncomeTotal = scopedManualMovements.filter((e) => e.kind === "ingreso").reduce((sum, e) => sum + Number(e.amount || 0), 0)
  const manualExpenseTotal = scopedManualMovements.filter((e) => (e.kind || "gasto") === "gasto").reduce((sum, e) => sum + Number(e.amount || 0), 0)
  // Margen del período: servicios + mesón + ingresos manuales + web − gastos.
  const marginTotal = revenueTotal + manualIncomeTotal + onlineRevenueTotal - manualExpenseTotal
  // Ingreso por hora disponible (un solo barbero: días con movimiento × horas).
  const periodBookings = visibleBookings.filter((b) => (b.date || "") >= periodStartKey && b.status !== "cancelada")
  const periodDays = new Set(periodBookings.map((b) => b.date)).size
  const revenuePerHour = periodDays ? Math.round(revenueTotal / (periodDays * AGENDA_SLOTS.length)) : null
  // Tasa de cancelación del período.
  const periodAll = visibleBookings.filter((b) => (b.date || "") >= periodStartKey)
  const cancelRate = periodAll.length
    ? Math.round((periodAll.filter((b) => b.status === "cancelada").length / periodAll.length) * 100)
    : null
  // Pendientes de confirmar con más de 24h encima (necesita `createdAt`).
  const stalePending = visibleBookings.filter((b) => {
    if (b.status !== "pendiente" || !b.createdAt) return false
    return Date.now() - new Date(b.createdAt).getTime() > 86_400_000
  })
  // Clientes a un corte de un beneficio (5ª o 10ª estrella).
  const nearRewardClients = clients.filter((c) => {
    const s = c.loyalty?.stars
    return s === 4 || s === 9
  })
  const ranking = barbers.map((b) => {
    const own = bookings.filter((item) => Number(item.barberId) === Number(b.id) && item.status !== "cancelada" && (item.date || "") >= periodStartKey)
    return { id: b.id, cuts: own.filter((item) => item.status === "completada").length || own.length, rev: own.reduce((sum, item) => sum + Number(item.price || 0), 0) }
  }).filter((item) => item.cuts || item.rev).sort((a, b) => b.rev - a.rev)
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
    acc[key].total += collectedOf(item)
    return acc
  }, {})).sort((a, b) => b.total - a.total)
  // Los últimos 7 días con ingresos, en orden. completedBookings viene de
  // más nuevo a más viejo: sin ordenar, el slice tomaba los 7 más viejos al
  // revés. (FinanzasTab arma su propio gráfico; esto queda en el ctx.)
  const revenueByDate = Object.entries(completedBookings.reduce((acc, item) => {
    const key = item.date || "Sin fecha"
    acc[key] = (acc[key] || 0) + collectedOf(item)
    return acc
  }, {})).sort((a, b) => a[0].localeCompare(b[0])).slice(-7).map(([key, v]) => ({ d: key.slice(5).replace("-", "/"), v }))
  // Inactivo = sin visitas hace 30 dias o mas (o nunca visito). Mas activos = 3+ visitas.
  const clientActivityOf = (client) => {
    if (!client.lastVisit) return "inactive"
    const days = (Date.now() - new Date(client.lastVisit).getTime()) / 86_400_000
    return days >= 30 ? "inactive" : "active"
  }
  // Las cifras que la lista de Clientes muestra de cada fila. Acá hay una sola
  // base, así que son siempre las propias (`there: false`).
  const clientStatsOf = (c) => ({ visits: Number(c?.visits || 0), totalSpent: Number(c?.totalSpent || 0), lastVisit: c?.lastVisit || null, there: false })
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
    // La columna es "Cobrado" (lo que entró de verdad), no el precio de lista.
    if (financeSort.key === "price") return (collectedOf(a) - collectedOf(b)) * dir
    if (financeSort.key === "client") return (a.client || "").localeCompare(b.client || "") * dir
    if (financeSort.key === "service") return (a.service || "").localeCompare(b.service || "") * dir
    if (financeSort.key === "barber") {
      const an = barberOf(a.barberId)?.short || ""
      const bn = barberOf(b.barberId)?.short || ""
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
    // El ?tab= no se salta el menú: solo abre una pestaña que ese barbero
    // tiene. `barber` puede no estar en el estado todavía (primer render),
    // así que se lee la sesión guardada, igual que el efecto que la carga.
    let current = barber
    if (!current) { try { current = JSON.parse(localStorage.getItem("ps_barber") || "null") } catch {} }
    const isAdm = isAdminUser(current)
    const allowed = buildNav({ admin: isAdm, canViewFinance: isAdm || Boolean(current?.canViewFinance), canEditServices: isAdm || Boolean(current?.canEditServices) }).map(([id]) => id)
    if (qTab && allowed.includes(qTab)) setTab(qTab)
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

  function authHeaders(extra = {}) {
    const token = localStorage.getItem("ps_barber_token") || ""
    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra
  }

  // Mezcla reservas nuevas sobre las que ya están en memoria, por id: el
  // servidor manda (mismo criterio que mergeBookings en bookingsStore.js).
  const mergeById = (current, incoming) => {
    const byId = new Map(current.map((b) => [String(b.id), b]))
    incoming.forEach((b) => byId.set(String(b.id), b))
    return [...byId.values()]
  }

  /* Lista de reservas del panel. Tres casos:
       · la API contestó bien → se reemplaza la lista (vacía también: una
         lista vacía real no se rellena con la demo);
       · la API contestó con error (500 por la base, 401 por la sesión) → se
         avisa arriba y NUNCA se muestran filas de demo: tocar "Completar"
         sobre una fila inventada cambiaría la reserva real con ese id. Si ya
         había una lista real cargada, se conserva;
       · no hay API (npm run dev sin mock: no es JSON) → la demo local de
         siempre, solo en la carga inicial. */
  const bookingsLoadedRef = useRef(false)
  const loadBookings = async ({ initial = false } = {}) => {
    const res = await fetch("/api/bookings", { headers: authHeaders() }).catch(() => null)
    if (!res || !isJson(res)) {
      if (initial) setBookings(mergeBookings(DEMO_TODAY()))
      return
    }
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.ok || !Array.isArray(data.bookings)) {
      setApiError(res.status === 401 || res.status === 403
        ? "Tu sesión expiró. Vuelve a iniciar sesión para ver las reservas."
        : (data?.error || "No se pudieron cargar las reservas. Toca Actualizar para reintentar."))
      if (!bookingsLoadedRef.current) setBookings(mergeBookings([]))
      return
    }
    bookingsLoadedRef.current = true
    setApiError("")
    setBookings(mergeBookings(data.bookings))
  }

  const loadClients = () => fetch("/api/clients", { headers: authHeaders() })
    .then((r) => r.json())
    .then((data) => { if (data.clients?.length) setClients(data.clients) })
    .catch(() => {})
  const loadServices = () => fetch("/api/services?includeInactive=true", { headers: authHeaders() })
    .then((r) => r.json())
    .then((data) => { if (data.services?.length) setServices(data.services) })
    .catch(() => {})
  // Con ingresos manuales (FEATURES.manualIncome) se piden gastos E ingresos;
  // sin el flag, el GET de siempre (el servidor devuelve solo gastos).
  const loadExpenses = () => fetch(FEATURES.manualIncome ? "/api/expenses?kind=all" : "/api/expenses", { headers: authHeaders() })
    .then((r) => r.json())
    .then((data) => { if (data.expenses?.length) setExpenses(data.expenses) })
    .catch(() => {})
  const loadProducts = () => fetch("/api/services?scope=shop&includeInactive=true", { headers: authHeaders() })
    .then((r) => r.json())
    .then((data) => { if (data.products) setProducts(data.products) })
    .catch(() => {})

  // Pedidos web pagados (Mercado Pago): Cursos, Workshop y Essentials.
  const loadOnlineOrders = async () => {
    setOnlineOrdersLoading(true)
    const res = await fetch("/api/mp-payments?panel=1", { headers: authHeaders() }).catch(() => null)
    const data = res && isJson(res) ? await res.json().catch(() => null) : null
    setOnlineOrdersLoading(false)
    if (!res || !isJson(res)) return // sin API (dev sin mock): nada que mostrar, sin aviso
    if (!res.ok || !data?.ok || !Array.isArray(data.orders)) {
      setOnlineOrdersError(data?.error || "No se pudieron cargar los pedidos.")
      return
    }
    setOnlineOrdersError("")
    setOnlineOrders(data.orders)
  }
  /* Total online del período desde el servidor. Mientras el backend no lo
     tenga, ?summary=1 devuelve la lista de siempre (sin `total`): se anota y no
     se vuelve a pedir en esta sesión, y los KPI salen de la lista. */
  const loadOnlineSummary = async (fromKey, toKey) => {
    if (onlineSummaryUnsupportedRef.current) return
    const res = await fetch(`/api/mp-payments?panel=1&summary=1&from=${fromKey}&to=${toKey}`, { headers: authHeaders() }).catch(() => null)
    const data = res && res.ok && isJson(res) ? await res.json().catch(() => null) : null
    if (!data?.ok) return
    if (!Number.isFinite(Number(data.total)) || data.total == null) { onlineSummaryUnsupportedRef.current = true; return }
    setOnlineSummary({ ...data, from: fromKey, to: toKey })
  }

  useEffect(() => {
    const stored = localStorage.getItem("ps_barber")
    if (!stored) { navigate("/ingreso"); return }
    let parsed = null
    try { parsed = JSON.parse(stored) } catch {}
    if (!parsed) { navigate("/ingreso"); return }
    setBarber(parsed)
    setAgendaBarber(parsed.id || 6)
    setAgendaDayKey(isoDate(new Date()))
    const headers = authHeaders()
    /* Perfil fresco: el token dura 30 días, así que sin esto un cambio de
       nombre o rol tardaría hasta un mes en verse. Tolerante: si no contesta,
       contesta sin ok o todavía no existe (405), queda la sesión guardada; los
       campos se MEZCLAN sobre la guardada (nunca se pierde uno que ya estaba)
       y, si viene un token nuevo, reemplaza al anterior. Solo un 401 real
       (cuenta desactivada o sesión inválida) cierra la sesión. */
    fetch("/api/auth-barber?me=1", { headers })
      .then((r) => (r.status === 401 ? Promise.reject(new Error("inactive")) : r.json()))
      .then((data) => {
        if (!data?.ok || !data.barber) return
        const fresh = { ...parsed, ...data.barber }
        setBarber(fresh)
        try {
          localStorage.setItem("ps_barber", JSON.stringify(fresh))
          if (data.token) localStorage.setItem("ps_barber_token", data.token)
        } catch {}
      })
      .catch((err) => { if (err?.message === "inactive") logout("Tu sesión ya no es válida. Vuelve a ingresar.") })
    loadClients()
    // App interna en modo "solo Brunetti": no cargamos otros barberos desde la API.
    // (El fetch a /api/barbers queda guardado para cuando se reactive el multi-barbero.)
    // fetch("/api/barbers?includeInactive=true", { headers }).then((r) => r.json()).then((data) => { if (data.barbers?.length) setBarbers(data.barbers) }).catch(() => {})
    loadBookings({ initial: true })
    loadServices()
    loadExpenses()
    loadProducts()
    /* Presupuestos del servidor desde el arranque, para que el semáforo de
       Gastos los use en cualquier dispositivo sin pasar antes por Ajustes
       (que los vuelve a leer al abrirse). Si falla, queda lo de este equipo. */
    if (FEATURES.serverSettings && isAdminUser(parsed)) {
      fetch("/api/barbers?mode=shop-settings", { headers })
        .then((r) => r.json())
        .then((d) => { const b = (d?.settings || d)?.budgets; if (d?.ok && b && Object.keys(b).length) setExpenseBudgets(b) })
        .catch(() => {})
    }
    if (isAdminUser(parsed)) loadOnlineOrders()
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
  // ÚNICO punto de lectura de la grilla de horarios. Devuelve vacío mientras lo
  // cargado no corresponda al barbero de la agenda (o no haya llegado), para
  // que nunca se muestre ni se opere sobre una grilla que no es.
  const agendaReady = availabilityOf != null && Number(availabilityOf) === Number(agendaBarber)
  const slotsFor = (dayKey) => (agendaReady && availability[dayKey]) || []

  // Aviso para instalar el panel: espera a tener la sesión resuelta para no
  // aparecer sobre la pantalla de carga ni sobre un rebote al login.
  const [installOpen, closeInstall] = useAutoInstallPrompt(Boolean(barber), 1800)

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
      .then((r) => isJson(r) ? r.json() : Promise.reject(new Error("api unavailable")))
      .then((data) => {
        if (!data.bookings?.length) return
        setBookings((current) => mergeById(current, data.bookings))
      })
      .catch(() => { loadedRangesRef.current.delete(rangeKey) }) // reintentable
  }

  /* api/availability.js marca como "past" los horarios de HOY que ya no se
     pueden reservar por la regla de anticipación mínima del flujo PÚBLICO. En
     el panel una hora que ya pasó sigue siendo una hora libre que no se
     vendió, no un cuarto estado: sin traducir, la celda salía con la clase
     `agenda-tile past` (que no existe), no entraba en "N libres", invertía
     los botones Bloquear/Habilitar y, al tocarla, la bloqueaba de verdad.
     "past" solo reemplaza a "free" en el servidor (booked y blocked ganan
     antes), así que se normaliza a free + bandera: los totales la cuentan
     como la hora libre que es y la bandera solo sirve para atenuarla y no
     dejar gestionar lo que ya pasó.
     api/availability.js marca "past" solo en las horas de HOY: en un día
     anterior las devuelve "free". Con `dayKey` el día entero ya pasado queda
     con la misma bandera, así bulkAgenda y los "libres" de la semana cuentan
     lo mismo que muestra la grilla (el mock ya lo hacía así). */
  const normalizeSlots = (slots, dayKey) => {
    const dayPast = Boolean(dayKey) && dayKey < santiagoDateKey()
    return slots.map((item) => {
      if (item.state === "past") return { ...item, state: "free", past: true }
      if (dayPast && item.state && item.state !== "booked") return { ...item, past: true }
      return item
    })
  }

  // Descarta respuestas que llegan tarde: sin esto, la carga de una semana
  // anterior podía pisar la de la semana nueva si llegaba después.
  const agendaReqRef = useRef(0)

  const loadAgenda = async () => {
    const forBarber = agendaBarber
    const reqId = ++agendaReqRef.current
    let degraded = false
    const entries = await Promise.all(weekDays.map(async (day) => {
      const data = await fetch(`/api/availability?barberId=${agendaBarber}&date=${day.key}&detail=true`)
        .then((r) => isJson(r) ? r.json() : Promise.reject(new Error("api unavailable")))
        .catch(() => ({ slots: [] }))
      /* Un horario SIN `state` no es un horario libre: es una respuesta
         degradada (el catch de api/availability.js devuelve {slot, available}
         sin estado cuando la base falla) o no hubo respuesta. Antes eso se
         pintaba como la semana completa disponible, tapando reservas reales.
         Se marca el día como desconocido (en gris) en vez de inventarle un
         estado. */
      const usable = data.slots?.length && data.slots.every((item) => item.state)
      if (!usable) {
        degraded = true
        return [day.key, AGENDA_SLOTS.map((slot) => ({ slot }))]
      }
      const apiSlots = normalizeSlots(data.slots, day.key)
      const localBlocks = readLocalBlocks()
      const merged = apiSlots.map((item) => {
        const key = localBlockKey(agendaBarber, day.key, item.slot)
        if (item.state !== "booked" && localBlocks[key]) return { ...item, available: false, state: "blocked" }
        return item
      })
      return [day.key, merged]
    }))
    if (reqId !== agendaReqRef.current) return
    setAvailability(Object.fromEntries(entries))
    setAvailabilityOf(forBarber)
    if (degraded) setAgendaError("No se pudo leer la disponibilidad de algunos días. Esas horas quedan en gris — no son horas libres.")
  }

  useEffect(() => {
    if (!barberId) return
    loadAgenda()
    // Semanas pasadas: sus reservas pueden quedar fuera de las últimas 160
    // del fetch inicial; se piden por rango bajo demanda.
    ensurePastBookings(weekDays[0]?.key, weekDays[6]?.key)
  }, [barberId, agendaBarber, weekOffset])

  // Comparativo liviano vs. la semana anterior (solo para los deltas de KPI
  // del hero). Si cualquier día falla (API caída → fallback demo), NO se
  // inventan cifras: se oculta el delta entero.
  useEffect(() => {
    if (!barberId) return
    let alive = true
    const prevDays = buildWeek(weekOffset - 1)
    Promise.all(prevDays.map((day) =>
      fetch(`/api/availability?barberId=${agendaBarber}&date=${day.key}&detail=true`)
        .then((r) => (isJson(r) ? r.json() : Promise.reject(new Error("api unavailable"))))
        .then((data) => (data.slots?.length && data.slots.every((s) => s.state) ? normalizeSlots(data.slots) : null))
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
  }, [barberId, agendaBarber, weekOffset])

  // Toasts de confirmación: auto-dismiss a los 3s. `ms`: un aviso sobre el
  // que hay que actuar (⚠) se queda más que un ✓.
  const pushToast = useCallback((icon, msg, ms = 3000) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, icon, msg }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms)
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

  /* Catálogo vendible para la hoja de cobro y "Vender" (FEATURES.sales).
     authHeaders() es una declaración de función y lee el token en cada
     llamada, así que la lista de dependencias vacía no deja un cierre viejo. */
  const loadSellable = useCallback(async () => {
    if (!FEATURES.sales || !localStorage.getItem("ps_barber_token")) return
    const res = await fetch("/api/services?scope=shop&for=venta", { headers: authHeaders() }).catch(() => null)
    const data = res && res.ok && isJson(res) ? await res.json().catch(() => null) : null
    setSellable(Array.isArray(data?.products) ? data.products : [])
  }, [])
  const loadProductSales = useCallback(async (from, to) => {
    if (!FEATURES.sales || !localStorage.getItem("ps_barber_token")) return
    const res = await fetch(`/api/bookings?mode=sales&from=${from}&to=${to}`, { headers: authHeaders() }).catch(() => null)
    const data = res && res.ok && isJson(res) ? await res.json().catch(() => null) : null
    setProductSales(data?.ok ? data : EMPTY_SALES)
  }, [])
  useEffect(() => { if (barberId) loadSellable() }, [barberId, loadSellable])
  useEffect(() => {
    if (!barberId || !canViewFinance) return
    loadProductSales(periodStartKey, todayKeyNow)
  }, [barberId, canViewFinance, periodStartKey, loadProductSales])
  useEffect(() => {
    if (!barberId || !admin) return
    loadOnlineSummary(periodStartKey, todayKeyNow)
  }, [barberId, admin, periodStartKey])

  // Arqueo del día (?mode=cash). Solo existe con la pestaña Caja.
  const loadCash = useCallback(async (day) => {
    if (!FEATURES.cash || !has("caja")) return
    setCashData(undefined)
    const res = await fetch(`/api/bookings?mode=cash&date=${day}`, { headers: authHeaders() }).catch(() => null)
    const data = res && res.ok && isJson(res) ? await res.json().catch(() => null) : null
    setCashData(data?.ok && data.byMethod && Array.isArray(data.bookings) ? data : null)
  }, [barberId, canViewFinance])
  useEffect(() => { if (tab === "caja") loadCash(cashDay) }, [tab, cashDay, loadCash])

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
    // Sin esto, los rangos ya pedidos quedarían marcados como cargados
    // mientras sus reservas ya no están en memoria: la semana pasada se
    // vaciaba al refrescar y no volvía hasta recargar la página entera.
    loadedRangesRef.current.clear()
    await Promise.all([
      loadClients(),
      loadBookings(),
      loadServices(),
      loadExpenses(),
      loadProducts(),
      loadAgenda(),
      admin && loadOnlineOrders(),
      admin && loadOnlineSummary(periodStartKey, todayKeyNow),
      FEATURES.sales && loadSellable(),
      FEATURES.sales && canViewFinance && loadProductSales(periodStartKey, todayKeyNow),
      tab === "caja" && loadCash(cashDay),
    ].filter(Boolean))
    // Ya con la lista fresca en memoria, se vuelve a pedir la semana visible
    // si es pasada (acá para Agenda; pastRangeEpoch lo hace en Reservas).
    ensurePastBookings(weekDays[0]?.key, weekDays[6]?.key)
    setPastRangeEpoch((n) => n + 1)
    setRefreshing(false)
  }

  // Service worker + aviso al barbero cuando entra una reserva suya.
  // El localStorage sincroniza entre pestañas del mismo navegador (evento
  // 'storage'); el aviso push entre dispositivos lo emite el backend.
  // Depende del id y no del objeto: el perfil fresco de ?me=1 no vuelve a
  // registrar la suscripción.
  const seenBookingKeys = useRef(null)
  useEffect(() => {
    if (!barber) return
    registerServiceWorker()
    // Re-registra la suscripción en el servidor en cada apertura del panel:
    // la activación es de una sola vez, pero la suscripción se cae sola (ver
    // syncPush en src/push.js) y un barbero con el interruptor "activado"
    // podía llevar semanas sin recibir nada.
    syncPush(barber)
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
  }, [barberId])

  // "2026-11-15" -> "15 nov". Se arma en UTC (no new Date(str)) para que no se
  // corra un día según la zona del navegador: es un día de calendario.
  const dayLabel = (key) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""))
    if (!m) return key
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
    return new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", day: "numeric", month: "short" }).format(d).replace(".", "")
  }

  const saveService = async (service) => {
    const payload = service?.id ? service : serviceDraft
    if (!payload.name || !payload.price || !payload.min) return
    const method = payload.id ? "PATCH" : "POST"
    const data = { ...payload, price: Number(payload.price), min: Number(payload.min) }
    const res = await fetch("/api/services", { method, headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(data) }).catch(() => null)
    const json = res ? await res.json().catch(() => ({})) : {}
    const saved = json.service || data
    setServices((items) => payload.id ? items.map((item) => item.id === saved.id ? { ...item, ...saved } : item) : [{ ...saved, id: saved.id || Date.now(), active: true }, ...items])
    if (!payload.id) setServiceDraft({ name: "", price: "", min: 60, cat: "general", desc: "", tne: false, onlyOnDate: null })
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
    if (res && !res.ok && isJson(res)) { pushToast("⚠️", json.error || "No se pudo guardar el producto", 6000); return }
    const saved = json.product || data
    setProducts((items) => payload.id ? items.map((item) => item.id === saved.id ? { ...item, ...saved } : item) : [{ ...saved, id: saved.id || Date.now(), active: saved.active !== false }, ...items])
    if (!payload.id) setProductDraft({ name: "", brand: "", price: "", stock: "0", description: "" })
    loadSellable() // cambió el precio, el stock o la visibilidad
  }

  // "Eliminar" un producto (optimista con revert, también sin red). El
  // servidor lo archiva si ya tiene historia (movimientos o ventas) y lo borra
  // si no; se devuelve cuál de las dos, para que la pestaña lo avise.
  const removeProduct = async (product) => {
    setEditProductId(null)
    setProducts((items) => items.filter((item) => item.id !== product.id))
    const res = await fetch(`/api/services?scope=shop&id=${product.id}`, { method: "DELETE", headers: authHeaders() }).catch(() => null)
    const json = res ? await res.json().catch(() => ({})) : {}
    if (!res || !res.ok) {
      setProducts((items) => [product, ...items].sort((a, b) => a.id - b.id))
      pushToast("⚠️", json.error || "No se pudo eliminar el producto", 6000)
      return { ok: false, error: json.error }
    }
    loadSellable()
    return { ok: true, archived: Boolean(json.archived), deleted: Boolean(json.deleted) }
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
    else if (!res || !res.ok) pushToast("⚠️", json.error || "No se pudo subir la foto", 6000)
  }

  const createExpense = async (draft) => {
    const payload = { ...draft, amount: Number(draft.amount), owner: draft.owner || barber?.name || "Brunetti" }
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
  // Guardar desde FinanceMovementSheet: con id se edita, sin id se crea.
  const saveFinanceMovement = async (draft) => {
    if (draft?.id) await updateExpense(draft)
    else await createExpense(draft)
    setFinanceMovementModal(null)
  }

  const exportCSV = (type) => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`
    const toCSV = (headers, rows) => [headers.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n")
    let name = "datos", csv = ""
    if (type === "Clientes") { name = "clientes"; csv = toCSV(["Nombre", "Telefono", "Email", "Visitas", "Total", "Ultima visita", "Estado"], clients.map((c) => [c.name, c.phone, c.email, c.visits, c.totalSpent, c.lastVisit, c.status])) }
    else if (type === "Reservas") { name = "reservas"; csv = toCSV(["Fecha", "Hora", "Cliente", "Telefono", "Servicio", "Barbero", "Precio", "Estado"], bookings.map((b) => { const bb = barberOf(b.barberId); return [b.date, b.time, b.client, b.phone, b.service, bb?.short || bb?.name || "", b.price, b.status] })) }
    else if (type === "Finanzas") {
      name = `finanzas-${financePeriod}`
      // Con cobro con medio de pago, el CSV lleva lo cobrado y el medio. Sin
      // columna Barbero: la tabla de Finanzas es de un solo barbero.
      const head = ["Fecha", "Hora", "Cliente", "Servicio", "Precio", "Estado", ...(FEATURES.charge ? ["Cobrado", "Medio de pago"] : [])]
      csv = toCSV(head, sortedFinanceRows.map((b) => [b.date, b.time, b.client, b.service, b.price, b.status, ...(FEATURES.charge ? [collectedOf(b), b.paymentMethod || ""] : [])]))
    }
    else if (type === "Gastos") { name = "gastos"; csv = toCSV(["Fecha", "Categoria", "Detalle", "Monto", "Responsable"], expenses.filter((e) => (e.kind || "gasto") === "gasto").map((e) => [e.date, e.category, e.detail, e.amount, e.owner])) }
    else if (type === "Servicios") { name = "servicios"; csv = toCSV(["Nombre", "Precio", "Minutos", "Categoria", "Estado"], services.map((s) => [s.name, s.price, s.min, s.cat, s.active === false ? "oculto" : "publicado"])) }
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `brunetti-${name}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  /* La fidelidad del cliente de una reserva, para que la hoja de cobro pueda
     ofrecer el 30% en productos. Misma fuente que la lista de clientes
     (clients[].loyalty, cruzado por teléfono): no hay un segundo lugar donde
     el número pueda quedar distinto. */
  const loyaltyForBooking = (booking) => {
    if (!booking?.phone) return null
    return clientByPhone.get(cleanPhone(booking.phone))?.loyalty || null
  }

  /* Registra la venta de productos de una atención (o de mesón, sin reserva).
     Va SIEMPRE después de que el cobro del servicio quedó guardado y nunca en
     el mismo request: son dos plata distintas en dos tablas distintas, y así
     la Caja y el stock cuadran. Si la venta falla, el cobro del servicio ya
     quedó bien: se avisa y no se deshace. */
  const registerSale = async ({ bookingId, clientId, products: items, paymentMethod, paymentRef, applyLoyaltyDiscount }) => {
    if (!FEATURES.sales || !Array.isArray(items) || !items.length) return { ok: true, skipped: true }
    const res = await fetch("/api/bookings?mode=sale", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ bookingId, clientId, items, paymentMethod, paymentRef, applyLoyaltyDiscount }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (!res || !res.ok) return { ok: false, error: data.error || "No se pudo registrar la venta de productos." }
    loadSellable() // el stock bajó: no ofrecer lo que ya no hay
    loadProducts() // que el Catálogo (Inventario) muestre el stock nuevo
    if (canViewFinance) loadProductSales(periodStartKey, todayKeyNow)
    return { ok: true, sale: data.sale }
  }

  /* Anular una venta de productos: no se borra, queda anulada y el stock
     vuelve con un movimiento de devolución. `confirmed` lo pasa quien ya
     preguntó con su propio ConfirmDialog. */
  const voidSale = async (sale, { confirmed = false } = {}) => {
    if (!FEATURES.sales || !sale?.id) return { error: "No disponible." }
    if (!confirmed && !window.confirm(`¿Anular esta venta de ${CLP(sale.total)}? El stock vuelve a la bodega.`)) return { cancelled: true }
    const res = await fetch(`/api/bookings?mode=sale&saleId=${sale.id}`, { method: "DELETE", headers: authHeaders() }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (!res || !res.ok) { pushToast("⚠️", data.error || "No se pudo anular la venta", 6000); return { error: data.error || true } }
    pushToast("✓", "Venta anulada, stock devuelto")
    if (tab === "caja") loadCash(cashDay)
    loadSellable()
    loadProducts() // que el Catálogo (Inventario) muestre el stock devuelto
    if (canViewFinance) loadProductSales(periodStartKey, todayKeyNow)
    return { ok: true }
  }

  // Refleja en memoria lo que devolvió el servidor de una reserva (PATCH):
  // precio, cobro, No vino y "pago por confirmar".
  const mergeServerBooking = (row) => {
    if (!row || row.id == null) return
    const keys = ["status", "price", "paidAmount", "paymentMethod", "paymentRef", "noShow", "paymentPending", "freeCut", "service", "client"]
    const patch = {}
    keys.forEach((k) => { if (row[k] !== undefined) patch[k] = row[k] })
    if (row.date) patch.date = row.date
    if (row.time) patch.time = String(row.time).slice(0, 5)
    setBookings((items) => items.map((item) => String(item.id) === String(row.id) ? { ...item, ...patch } : item))
  }

  // Reserva manual desde el panel (modo interno del POST: sin límite de 7
  // días, servicio/precio personalizado). Espeja el patrón del flujo público:
  // si la API responde error real (409, validación) se muestra en el modal;
  // si está offline, se guarda localmente igual (demo/dev).
  // Con FEATURES.charge, una atención cargada como "completada" la guarda el
  // servidor "en curso" (chargeOnCreate) y acá se abre la hoja de cobro sola.
  const createBooking = async (draft) => {
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ ...draft, chargeOnCreate: FEATURES.charge }),
    }).catch(() => null)
    let charge = null
    let notice = null
    if (res) {
      const json = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, error: json.error || "No se pudo crear la reserva" }
      // El estado real es el que guardó el servidor.
      const status = json.booking?.status || draft.status
      addLocalBooking({ ...draft, id: json.booking?.id, status })
      // Lo que no salió aunque la reserva sí (p. ej. la estrella de una
      // atención que nace completada): el repaso de PimpStudio la repone,
      // pero quien la cargó tiene que saberlo.
      notice = json.notice || null
      const charging = json.charging === true || (draft.status === "completada" && status !== "completada")
      if (FEATURES.charge && charging && json.booking?.id) charge = { ...draft, id: json.booking.id, status }
    } else {
      addLocalBooking(draft)
    }
    setBookings((current) => mergeBookings(current))
    loadAgenda()
    // La hoja de cobro, con la de Nueva reserva ya cerrada.
    if (charge) setTimeout(() => updateBookingStatus(charge, "completada"), 320)
    return { ok: true, charging: Boolean(charge), notice }
  }

  /* Cambiar el estado de una reserva. Devuelve { ok, loyalty, saleError } |
     { cancelled } (se cerró la hoja de cobro) | { error }.
     `extra` es el cobro ({ paidAmount, paymentMethod, paymentRef, products,
     applyLoyaltyDiscount }) cuando ya se tiene, o { noShow: true } para
     "No vino" (cancelada + no_show, FEATURES.noShow).
     Con FEATURES.charge, completar sin cobro pide primero la hoja de cobro —
     antes de tocar nada, así cancelarla no deja la reserva pintada como
     completada. El servidor no exige el cobro (iOS y el puente completan
     sin él); lo exige esta hoja. */
  const updateBookingStatus = async (booking, status, extra = null) => {
    let payment = extra && (extra.paymentMethod != null || extra.paidAmount != null) ? extra : null
    const noShow = FEATURES.noShow && status === "cancelada" && extra?.noShow === true
    if (status === "completada" && !payment && FEATURES.charge) {
      if (!canCharge) return { error: "No tienes permiso para registrar cobros." }
      payment = await askForCharge(booking, "cobrar", loyaltyForBooking(booking))
      if (!payment) return { cancelled: true }
    }
    const { products: saleItems, applyLoyaltyDiscount, ...charge } = payment || {}
    setBookings((items) => items.map((item) => item.id === booking.id
      ? {
          ...item,
          status,
          ...(payment ? { paidAmount: charge.paidAmount, paymentMethod: charge.paymentMethod, paymentRef: charge.paymentRef || null, paymentPending: false } : {}),
          ...(noShow ? { noShow: true } : {}),
        }
      : item))
    const res = await fetch("/api/bookings", {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ id: booking.id, status, ...charge, ...(noShow ? { noShow: true } : {}) }),
    }).catch(() => null)
    if (res && !res.ok) {
      setBookings((items) => items.map((item) => item.id === booking.id ? booking : item))
      const failed = await res.json().catch(() => ({}))
      return { error: failed.error || "No se pudo actualizar la reserva." }
    }
    const data = res ? await res.json().catch(() => null) : null
    if (data?.booking) mergeServerBooking(data.booking)
    // Al completar, el servidor le suma la estrella al cliente en el programa
    // de Pimp Studio y devuelve el saldo nuevo: se refleja de inmediato en la
    // lista de clientes (badge y botón de canje) sin recargar el panel. Si el
    // servidor dice que la estrella no es nueva (earned:false, una corrección
    // de cobro), no se anuncia de nuevo.
    if (data?.loyalty) {
      applyClientLoyalty(booking.phone, data.loyalty)
      if (status === "completada" && data.loyalty.earned !== false) {
        pushToast("⭐", data.loyalty.freeCutReady
          ? `${booking.client}: ¡corte gratis disponible!`
          : `${booking.client}: ${data.loyalty.stars}/${data.loyalty.goal} estrellas`)
      }
    }
    if (data?.notice) pushToast("⚠️", data.notice, 8000)
    // Los productos van en su propia venta, recién ahora que el cobro del
    // servicio quedó guardado.
    let saleError = null
    if (saleItems?.length) {
      const sale = await registerSale({
        bookingId: booking.id, products: saleItems,
        paymentMethod: charge.paymentMethod, paymentRef: charge.paymentRef, applyLoyaltyDiscount,
      })
      if (!sale.ok) { saleError = sale.error; pushToast("⚠️", sale.error, 8000) }
    }
    return { ok: true, loyalty: data?.loyalty || null, saleError }
  }

  // Reagendar desde el panel (FEATURES.reschedule). Devuelve { error } para
  // que la hoja muestre el motivo real (409 horario tomado, 422 no cabe).
  const rescheduleBooking = async (booking, patch = {}) => {
    if (!FEATURES.reschedule) return { error: "Reagendar desde el panel todavía no está disponible." }
    const body = { id: booking.id }
    if (patch.date) body.date = patch.date
    if (patch.time) body.time = patch.time
    if (patch.serviceId) body.serviceId = patch.serviceId
    const res = await fetch("/api/bookings", {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (!res || !res.ok) return { error: data.error || "No se pudo reagendar la hora. Intenta de nuevo." }
    setBookings((items) => items.map((item) => item.id === booking.id
      ? { ...item, date: body.date || item.date, time: body.time || item.time, ...(body.serviceId ? { serviceId: body.serviceId } : {}) }
      : item))
    if (data.booking) mergeServerBooking(data.booking)
    if (data.notice) pushToast("⚠️", data.notice, 8000)
    loadAgenda()
    return { ok: true, booking: data.booking || null }
  }

  // Editar el precio de una reserva (solo admin, FEATURES.priceEdit).
  const editBookingPrice = async (booking, price) => {
    if (!FEATURES.priceEdit || !admin) return { error: "Solo el administrador puede editar el precio." }
    const res = await fetch("/api/bookings", {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ id: booking.id, price: Number(price) }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (!res || !res.ok) return { error: data.error || "No se pudo actualizar el precio." }
    setBookings((items) => items.map((item) => item.id === booking.id ? { ...item, price: data.booking?.price ?? Number(price) } : item))
    return { ok: true }
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
     resultado. La confirmación la muestra el ConfirmDialog 'redeem' de
     BookingDetailSheet antes de llamar acá. */
  const redeemFreeCut = async (booking) => {
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
      setBookings((items) => items.map((item) => item.id === booking.id ? { ...item, price: 0, freeCut: true } : item))
      setDetail((d) => (d && d.id === booking.id ? { ...d, price: 0, freeCut: true } : d))
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
      return
    }
    const data = res ? await res.json().catch(() => null) : null
    if (data?.notice) pushToast("⚠️", data.notice, 8000)
  }

  /* Tocar una fila de Caja abre la misma hoja de cobro: si la reserva todavía
     no se cobró, la cobra (y la completa); si ya se cobró, permite corregir el
     monto, el medio o el n.º de boleta. */
  const openCashRow = async (row) => {
    if (!FEATURES.charge) return
    const yaCobrada = row.paidAmount != null
    const payment = await askForCharge(row, yaCobrada ? "corregir" : "cobrar", loyaltyForBooking(row))
    if (!payment) return
    const { products: saleItems, applyLoyaltyDiscount, ...charge } = payment
    const res = await fetch("/api/bookings", {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ id: row.id, status: "completada", ...charge }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (!res || !res.ok) { pushToast("⚠️", data.error || "No se pudo registrar el cobro", 6000); return }
    if (data.booking) mergeServerBooking(data.booking)
    if (data.loyalty) applyClientLoyalty(row.phone, data.loyalty)
    const sale = await registerSale({
      bookingId: row.id, products: saleItems, paymentMethod: charge.paymentMethod,
      paymentRef: charge.paymentRef, applyLoyaltyDiscount,
    })
    if (!sale.ok) pushToast("⚠️", sale.error, 8000)
    else pushToast("✓", yaCobrada ? "Cobro corregido" : `Cobrado ${CLP(payment.paidAmount)}`)
    loadCash(cashDay)
  }

  /* Vender productos sobre una atención ya cerrada: el cliente ya pagó el
     corte y vuelve al mesón por una cera. No toca la reserva — crea una venta
     nueva, con su propio medio de pago, para que el arqueo siga cuadrando. */
  const sellProductsFor = async (booking) => {
    if (!FEATURES.sales || !FEATURES.charge) return
    if (!sellable.length) { pushToast("⚠️", "Carga stock en Essentials para vender acá.", 6000); return }
    const payment = await askForCharge(booking, "productos", loyaltyForBooking(booking))
    if (!payment) return
    const sale = await registerSale({
      bookingId: booking.id, products: payment.products,
      paymentMethod: payment.paymentMethod, paymentRef: payment.paymentRef,
      applyLoyaltyDiscount: payment.applyLoyaltyDiscount,
    })
    if (!sale.ok) { pushToast("⚠️", sale.error, 8000); return }
    pushToast("✓", `Venta registrada · ${CLP(sale.sale?.total || 0)}`)
    if (tab === "caja") loadCash(cashDay)
  }

  const openClient = async (client, { edit = false } = {}) => {
    setSelectedClient(client)
    setClientEditing(edit)
    const local = bookings.filter((item) => item.phone === client.phone)
    setClientHistory(local)
    const data = await fetch(`/api/bookings?phone=${client.phone}`)
      .then((r) => isJson(r) ? r.json() : Promise.reject(new Error("api unavailable")))
      .catch(() => ({ bookings: local }))
    // El endpoint público (?phone=, lo usa Account.jsx del lado del cliente)
    // no trae `noShow`: se completa por id con lo que ya está en memoria
    // (panelRows sí lo trae), para que "No vino" no vuelva a verse como
    // "Cancelada" en la ficha.
    const localById = new Map(local.map((item) => [item.id, item]))
    const merged = data.bookings?.length
      ? data.bookings.map((item) => ({ ...item, noShow: item.noShow ?? localById.get(item.id)?.noShow ?? false }))
      : local
    setClientHistory(merged)
  }

  /* "Agendar" desde la ficha: abre la reserva manual del panel con el cliente
     ya puesto (antes navegaba a /reservar, que es el flujo del CLIENTE). */
  const scheduleForClient = (client) => {
    if (!client) return
    setNewBookingPrefill({
      name: client.name || "",
      phone: cleanPhone(client.phone),
      email: client.email || "",
      barberId: null,
    })
    setSelectedClient(null)
    setClientEditing(false)
    // La ficha se cierra con su animación antes de abrir la otra hoja.
    setTimeout(() => setNewBookingOpen(true), 220)
  }

  /* Métricas e historial de campañas: solo al abrir la pestaña Marketing (son
     dos round-trips al otro proyecto, no hay para qué pagarlos en cada carga
     del panel). */
  const loadWalletCampaigns = () => fetch("/api/clients?mode=wallet-campaigns", { headers: authHeaders() })
    .then((r) => r.json())
    .then((data) => { if (data?.campaigns) setWalletCampaigns(data.campaigns) })
    .catch(() => {})
  useEffect(() => {
    if (!barberId) return
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
    if (tab === "marketing" && !walletCampaigns.length) loadWalletCampaigns()
  }, [tab, barberId])

  /* Cuántos clientes caen en una audiencia. Lo calcula el backend junto con
     el resto de las métricas (api/_loyalty.js de PimpStudio) — acá no se
     replica el criterio, justamente para que el número del chip y el del
     envío no puedan discrepar. */
  const audienceCount = (id) => (walletStats?.sendAudienceCounts ?? walletStats?.audienceCounts)?.[id] ?? 0

  /* Envío de una campaña a los pases de Wallet, por el transporte de acá
     (?mode=wallet-campaign → puente). Deja el resultado en campaignSentNote /
     campaignError para que la pestaña lo muestre en la misma pantalla. */
  const sendWalletCampaign = async () => {
    const message = campaignMessage.trim()
    if (!message) return
    setCampaignSending(true); setCampaignError(""); setCampaignSentNote("")
    try {
      const res = await fetch("/api/clients?mode=wallet-campaign", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ message, audience: campaignAudience }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok === false) throw new Error(data?.error || "No se pudo enviar la campaña.")
      const n = Number(data.recipients || 0)
      const detail = data.applePushed != null || data.googleSent != null
        ? ` (${Number(data.applePushed || 0)} push Apple, ${Number(data.googleSent || 0)} Google)`
        : ""
      setCampaignSentNote(`Enviado a ${n} cliente${n === 1 ? "" : "s"}${detail}.`)
      setCampaignMessage("")
      setCampaignConfirming(false)
      setWalletCampaigns((list) => [{ ...data.campaign, message, audience: campaignAudience, recipientCount: n, source: "brunetti" }, ...list])
      return { ok: true }
    } catch (err) {
      setCampaignError(err?.message || "No se pudo enviar la campaña. Revisa tu conexión.")
      return { error: true }
    } finally {
      setCampaignSending(false)
    }
  }

  /* Envío masivo del link de la tarjeta. El backend manda de a pocos por
     llamada (una función serverless no aguanta 167 correos seguidos con el
     límite de 2/s de Resend), así que el bucle vive acá: se ve el avance en
     vivo y el botón "Detener" corta entre tandas sin dejar a nadie a medias
     — cada cliente enviado queda marcado en el momento. `confirmed` lo pasa
     quien ya preguntó con su propio ConfirmDialog. */
  const sendLoyaltyCards = async ({ onlyPhone = null, again = false, includeInstalled = false, testEmail = null, confirmed = false }) => {
    const bulk = !onlyPhone
    if (bulk && !confirmed && !window.confirm("Se le va a enviar el correo con su tarjeta de fidelidad a todos los clientes con correo que todavía no la tienen. ¿Seguimos?")) return
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

  /* "Tarjeta": pide al backend el link personal del cliente (/tarjeta?t=…,
     token opaco: no lleva su teléfono escrito) y abre WhatsApp con el mensaje
     listo. La tarjeta es la del programa de Pimp Studio — una sola, sirve en
     los dos locales. Acepta un cliente o { phone, name } (desde una reserva). */
  const sendWalletCard = async (client) => {
    if (!client?.phone) return
    const key = clientKey(client)
    setWalletSendingId(key)
    try {
      const res = await fetch(`/api/clients?mode=wallet-share-link&phone=${encodeURIComponent(client.phone)}`, { headers: authHeaders() })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.url) {
        pushToast("⚠️", data?.error || "No se pudo generar la tarjeta. Intenta de nuevo.", 6000)
        return
      }
      const href = waHref(client.phone, waWalletShareMessage(client.name || data.name, data.url))
      if (href) window.open(href, "_blank", "noopener,noreferrer")
    } catch {
      pushToast("⚠️", "No se pudo generar la tarjeta. Revisa tu conexión.", 6000)
    } finally {
      setWalletSendingId(null)
    }
  }

  const clientKey = (c) => c.id ?? c.phone
  // Optimista, pero ya no a ciegas: si el servidor rechaza la ficha (400) se
  // vuelve a la versión anterior y se avisa. Sin red queda el cambio local,
  // como antes. ClientModal valida las mismas reglas primero: esto es la red
  // de seguridad.
  const saveClient = async (updated) => {
    const k = clientKey(updated)
    const before = clients.find((c) => clientKey(c) === k)
    setClients((list) => list.map((c) => clientKey(c) === k ? { ...c, ...updated } : c))
    setSelectedClient((c) => (c && clientKey(c) === k ? { ...c, ...updated } : c))
    try {
      const res = await fetch("/api/clients", { method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(updated) })
      if (isJson(res)) {
        const json = await res.json()
        if (!res.ok || json.ok === false) {
          if (before) {
            setClients((list) => list.map((c) => clientKey(c) === k ? before : c))
            setSelectedClient((c) => (c && clientKey(c) === k ? before : c))
          }
          pushToast("⚠️", json.error || "No se pudo guardar el cliente.", 6000)
        }
      }
    } catch { /* sin red: queda el cambio local, como antes */ }
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
      if (isJson(res)) {
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
  // Devuelve si el servidor aceptó el cambio (AgendaTab corta la selección
  // múltiple en el primer false y recarga la grilla).
  const toggleSlot = async (dayKey, slot, state) => {
    if (state === "booked" || !agendaReady) return false
    if (!canBlockAgenda) { setAgendaError("No tienes permiso para bloquear horas."); return false }
    // Una hora que ya pasó, o un día cuya disponibilidad no se pudo leer, no
    // se gestiona: bloquearla no cambia nada y habilitarla sería inventar.
    const current = slotsFor(dayKey).find((item) => item.slot === slot)
    if (!current?.state) { setAgendaError("La disponibilidad de ese día no se pudo leer. Toca Actualizar e inténtalo de nuevo."); return false }
    if (current.past) { setAgendaError("Esa hora ya pasó: no se puede bloquear ni habilitar."); return false }
    const busyKey = `${dayKey}-${slot}`
    setAgendaBusy(busyKey)
    setAgendaError("")
    const method = state === "blocked" ? "DELETE" : "POST"
    const body = JSON.stringify({ barberId: agendaBarber, date: dayKey, slot, reason: "Bloqueado desde agenda interna" })
    const key = localBlockKey(agendaBarber, dayKey, slot)
    const localBlocks = readLocalBlocks()
    if (state === "blocked") delete localBlocks[key]
    else localBlocks[key] = { barberId: agendaBarber, date: dayKey, slot }
    writeLocalBlocks(localBlocks)
    setAvailability((cur) => ({
      ...cur,
      [dayKey]: (cur[dayKey] || []).map((item) => item.slot === slot ? { ...item, available: state === "blocked", state: state === "blocked" ? "free" : "blocked" } : item),
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
      // Se revierte solo esta hora: en la selección múltiple (serie) la foto
      // de `availability` del render ya quedó vieja y desharía en pantalla
      // los cambios anteriores que sí se guardaron.
      setAvailability((cur) => ({
        ...cur,
        [dayKey]: (cur[dayKey] || []).map((item) => item.slot === slot ? { ...item, available: state === "free", state } : item),
      }))
      setAgendaError(res?.status === 401 || res?.status === 403
        ? "Tu sesión expiró. Vuelve a iniciar sesión para editar la agenda."
        : "No se pudo guardar el cambio en el servidor. Revisa tu conexión e inténtalo de nuevo.")
      setAgendaBusy("")
      return false
    }
    setAgendaBusy("")
    return true
  }

  // Bloquea/habilita varios horarios de una sola vez (mañana, tarde, día completo
  // o la semana entera). Actualiza la UI al instante y dispara los requests en
  // paralelo (antes iban uno por uno, en serie, lo que multiplicaba la espera
  // por la cantidad de horarios tocados). Las horas que ya pasaron y los días
  // sin disponibilidad leída quedan fuera.
  const bulkAgenda = async (scope, mode) => {
    if (!agendaReady) return
    if (!canBlockAgenda) { setAgendaError("No tienes permiso para bloquear horas."); return }
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
      const dayAvailability = slotsFor(dayKey)
      nextAvailability[dayKey] = dayAvailability.map((item) => {
        if (!slotsInScope.includes(item.slot) || !item.state || item.state === "booked" || item.past) return item
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
  // semana siguiente. `free` cuenta también las horas ya pasadas de hoy: el
  // KPI mide la capacidad de la semana y se compara con la anterior (donde
  // nada es "past"). `manageable`/`freeNow` son el corte accionable — lo que
  // todavía se puede bloquear o habilitar — y es lo que miran los botones.
  const weekStats = weekDays.reduce((acc, d) => {
    const daySlots = slotsFor(d.key)
    acc.booked += daySlots.filter((s) => s.state === "booked").length
    acc.free += daySlots.filter((s) => s.state === "free").length
    acc.blocked += daySlots.filter((s) => s.state === "blocked").length
    acc.manageable += daySlots.filter((s) => s.state && !s.past).length
    acc.freeNow += daySlots.filter((s) => s.state === "free" && !s.past).length
    return acc
  }, { booked: 0, free: 0, blocked: 0, manageable: 0, freeNow: 0 })

  // La agenda del barbero se administra semana por semana, y hacia adelante
  // llega hasta AGENDA_MAX_KEY (siempre alcanza la ventana reservable del
  // cliente, MAX_LEAD_DAYS). Cambiar de semana reubica el día seleccionado si
  // el actual no pertenece a la semana nueva.
  const goToWeek = (offset) => {
    const wd = buildWeek(offset)
    setWeekOffset(offset)
    if (!wd.some((d) => d.key === agendaDayKey)) setAgendaDayKey(wd[0].key)
  }

  // Offset de semana de una fecha arbitraria, por diferencia de lunes.
  const weekOffsetOf = (iso) => {
    const mondayOf = (value) => {
      const d = new Date(`${value}T00:00:00`)
      const dow = d.getDay() || 7
      d.setDate(d.getDate() - dow + 1)
      d.setHours(0, 0, 0, 0)
      return d
    }
    return Math.round((mondayOf(iso) - mondayOf(isoDate(new Date()))) / (7 * 86400000))
  }

  // Deslizar la franja de días: ±1 día, cruzando de semana si hace falta.
  // Hacia atrás sin tope; hacia adelante hasta AGENDA_MAX_KEY.
  const shiftAgendaDay = (delta) => {
    if (!agendaDayKey) return
    const d = new Date(`${agendaDayKey}T00:00:00`)
    d.setDate(d.getDate() + delta)
    const key = isoDate(d)
    if (key > AGENDA_MAX_KEY()) return
    setWeekOffset(weekOffsetOf(key))
    setAgendaDayKey(key)
  }
  const handleAgendaDaySwipeEnd = (_event, info) => {
    const { offset, velocity } = info || {}
    if (!offset || !velocity) return
    if (Math.abs(offset.x) > 60 || Math.abs(velocity.x) > 500) shiftAgendaDay(offset.x < 0 ? 1 : -1)
  }

  // Date-picker de Agenda: cualquier fecha pasada es elegible (para revisar
  // semanas ya transcurridas); hacia adelante el tope es AGENDA_MAX_KEY.
  // Cubre siempre la ventana reservable del cliente (MAX_LEAD_DAYS): el tope
  // anterior era el domingo de la semana siguiente, que un viernes/sábado/domingo
  // cae a +9/+8/+7 y dejaba días reservables que el barbero no podía abrir acá.
  const pickCalendarDay = (key) => {
    setCalOpen(false)
    if (key > AGENDA_MAX_KEY()) { pushToast("📅", `Fecha fuera del rango reservable (${MAX_LEAD_DAYS} días)`); return }
    setWeekOffset(weekOffsetOf(key))
    setAgendaDayKey(key)
  }

  if (!barber) return null

  /* Contexto del panel para las pestañas (src/pages/panel/*Tab.jsx y los
     componentes que reciben `ctx`): cada una toma de acá lo que necesita. Es
     el contrato congelado del rediseño — está completo (estado, derivados y
     acciones) para que portar una pestaña no obligue a tocar este archivo.
     authHeaders viaja como función: en PimpStudio, ConfigPanel la llamaba sin
     recibirla y el ReferenceError dejaba el panel en negro al abrir Config
     (d4466e2). scopeAll / scopeBarberId / scopeBarber son constantes: acá hay
     un solo barbero, y existen para que el código portado resuelva sin
     ramas de equipo. Tiene que seguir siendo un objeto literal sin spreads
     (lo lee scratchpad/sync/tools/ctx-contract.mjs). */
  const dash = {
    // Sesión y armazón
    admin,
    authHeaders,
    barber,
    barberOf,
    barbers,
    canBlockAgenda,
    canCharge,
    canEditServices,
    canViewFinance,
    configSection,
    dayLabel,
    dockItems,
    dockShortcuts,
    has,
    logout,
    mainRef,
    myPhoto,
    nav,
    navSettings,
    navigate,
    personalNav,
    pushToast,
    refreshAll,
    refreshing,
    scopeAll: false,
    scopeBarber: null,
    scopeBarberId: "all",
    searchParams,
    setBarber,
    setConfigSection,
    setDockShortcuts,
    setNavSettings,
    setRefreshing,
    setTab,
    setToasts,
    tab,
    toasts,
    visibleNav,
    // Reservas
    applyClientLoyalty,
    askForCharge,
    bookings: bookingsView,
    chargeSheet,
    createBooking,
    deleteBooking,
    detail,
    editBookingPrice,
    ensurePastBookings,
    goToDayInReservas,
    goToPendingInReservas,
    inboxFocus,
    loyaltyForBooking,
    newBookingOpen,
    pastRangeEpoch,
    redeemFreeCut,
    rescheduleBooking,
    scheduleForClient,
    sendWalletCard,
    setBookings,
    setDetail,
    setInboxFocus,
    setNewBookingOpen,
    setPastRangeEpoch,
    settleCharge,
    updateBookingStatus,
    visibleBookings,
    walletSendingId,
    // Agenda
    agendaBarber,
    agendaBookings,
    agendaBusy,
    agendaDayKey,
    agendaError,
    agendaQuery,
    agendaReady,
    agendaReqRef,
    agendaView,
    availability,
    availabilityOf,
    bookingForSlot,
    bulkAgenda,
    calOpen,
    dragRef,
    goToWeek,
    handleAgendaDaySwipeEnd,
    loadAgenda,
    normalizeSlots,
    pickCalendarDay,
    prevWeekStats,
    setAgendaBarber,
    setAgendaBusy,
    setAgendaDayKey,
    setAgendaError,
    setAgendaQuery,
    setAgendaView,
    setAvailability,
    setCalOpen,
    setPrevWeekStats,
    setWeekOffset,
    shiftAgendaDay,
    slotsFor,
    svcMinByName,
    toggleSlot,
    weekDays,
    weekOffset,
    weekOffsetOf,
    weekStats,
    // Plata
    avgTicket,
    bookedAhead,
    cancelRate,
    cashData,
    cashDay,
    collectedOf,
    completedBookings,
    createExpense,
    deleteExpense,
    expenseBudgets,
    expenses,
    exportCSV,
    financeMovementModal,
    financePeriod,
    financeSort,
    isEarned,
    loadCash,
    loadOnlineOrders,
    loadProductSales,
    loadSellable,
    manualExpenseTotal,
    manualIncomeTotal,
    marginTotal,
    monthExpensesTotal,
    monthKeyNow,
    nearRewardClients,
    onlineMonthTotal,
    onlineOrders,
    onlineOrdersError,
    onlineOrdersLoading,
    onlineRevenueTotal,
    onlineSummary,
    openCashRow,
    periodStartKey,
    productRevenueTotal,
    productSales,
    ranking,
    registerSale,
    revenueByDate,
    revenueByService,
    revenuePerHour,
    revenueTotal,
    scopedManualMovements,
    sellProductsFor,
    sellable,
    serviceRevenueTotal,
    setCashData,
    setCashDay,
    setExpenseBudgets,
    setExpenses,
    setFinanceMovementModal,
    setFinancePeriod,
    setFinanceSort,
    sortedFinanceRows,
    stalePending,
    todayKeyNow,
    toggleFinanceSort,
    updateExpense,
    voidSale,
    // Clientes
    activeClients,
    clientActivityOf,
    clientEditing,
    clientFilter,
    clientHistory,
    clientKey,
    clientQuery,
    clientSort,
    clientStatsOf,
    clients,
    createClient,
    deleteClient,
    filteredClients,
    inactiveClients,
    loadClients,
    newClientOpen,
    newClientsCount,
    openClient,
    recurringPct,
    saveClient,
    selectedClient,
    setClientEditing,
    setClientFilter,
    setClientHistory,
    setClientQuery,
    setClientSort,
    setClients,
    setNewClientOpen,
    setSelectedClient,
    sortedClients,
    toggleClientSort,
    topClients,
    upsertClientLocal,
    // Marketing
    audienceCount,
    campaignAudience,
    campaignConfirming,
    campaignError,
    campaignMessage,
    campaignSending,
    campaignSentNote,
    cardProgress,
    cardSending,
    cardStopRef,
    cardTestEmail,
    cardTestPhone,
    loadWalletCampaigns,
    sendLoyaltyCards,
    sendWalletCampaign,
    setCampaignAudience,
    setCampaignConfirming,
    setCampaignError,
    setCampaignMessage,
    setCampaignSending,
    setCampaignSentNote,
    setCardTestEmail,
    setCardTestPhone,
    setWalletCampaigns,
    setWalletStats,
    walletCampaigns,
    walletStats,
    // Servicios y Essentials
    deleteProduct,
    deleteService,
    deleteSvc,
    editProductId,
    editSvcId,
    essentialsView,
    productDraft,
    productOpen,
    productUploading,
    products,
    removeProduct,
    saveProduct,
    saveService,
    serviceDraft,
    serviceOpen,
    services,
    setDeleteProduct,
    setDeleteSvc,
    setEditProductId,
    setEditSvcId,
    setEssentialsView,
    setProductDraft,
    setProductOpen,
    setProductUploading,
    setProducts,
    setServiceDraft,
    setServiceOpen,
    setServices,
    setStockBefore,
    stockBefore,
    uploadProductPhoto,
  }

  const pickClient = (c) => { setTab("clientes"); openClient(c) }
  const pickBooking = (b) => { setTab("reservas"); setInboxFocus({ day: b.date, ts: Date.now() }) }

  return (
    <PanelShell
      tab={tab}
      setTab={setTab}
      nav={visibleNav}
      dockItems={dockItems}
      barber={barber}
      photo={myPhoto}
      onLogout={logout}
      onNewBooking={() => setNewBookingOpen(true)}
    >
      {/* Cada pestaña dibuja su propio título grande (ModuleHeader; Resumen,
          su saludo), así que la barra muestra el título solo al bajar. Sin
          onScroll acá: la barra escucha el scroller por su cuenta y solo se
          redibuja ella al cruzar el umbral (ver useScrolledPast en
          components/panel/Shell.jsx). */}
      <main ref={mainRef} className="dashboard-main">
        <PanelTopbar
          title={nav.find((n) => n[0] === tab)?.[2] || 'Panel'}
          barber={barber}
          photo={myPhoto}
          onLogout={logout}
          onSettings={() => setTab("config")}
          navigate={navigate}
          onRefresh={refreshAll}
          refreshing={refreshing}
          scrollRef={mainRef}
          search={<GlobalSearch clients={clients} bookings={bookingsView} onPickClient={pickClient} onPickBooking={pickBooking} />}
          searchButton={<GlobalSearch variant="button" clients={clients} bookings={bookingsView} onPickClient={pickClient} onPickBooking={pickBooking} />}
        />

        {apiError && (
          <InlineAlert
            tone="error"
            title="No se pudieron cargar las reservas"
            action={{ label: refreshing ? "Actualizando…" : "Reintentar", onClick: refreshAll }}
            onClose={() => setApiError("")}
          >
            {apiError}
          </InlineAlert>
        )}

        {/* RESUMEN */}
        {tab === "resumen" && (
          <div style={{ display: "grid", gap: "1.1rem" }}>
            <BookingSyncIssues />
            <DashboardResumen bookings={bookingsView} barbers={barbers} expenses={expenses} clients={clients} todaySlots={slotsFor(todayKeyNow)} walletStats={walletStats} onNewBooking={() => setNewBookingOpen(true)} onGoToPending={goToPendingInReservas} onGoToMarketing={() => setTab("marketing")} ctx={dash} />
          </div>
        )}

        {/* AGENDA */}
        {tab === "agenda" && agendaDayKey && <AgendaTab ctx={dash} />}

        {/* RESERVAS */}
        {tab === "reservas" && (
          <BookingsInbox
            bookings={bookingsView}
            onEnsureRange={ensurePastBookings}
            rangeEpoch={pastRangeEpoch}
            barbers={barbers}
            barber={barber}
            admin={admin}
            teamScope={admin}
            isAdmin={admin}
            clients={clients}
            slotsPerDay={AGENDA_SLOTS.length}
            onStatus={(bk, status) => updateBookingStatus(bk, status)}
            onDelete={deleteBooking}
            onReschedule={FEATURES.reschedule ? rescheduleBooking : undefined}
            onRedeemFreeCut={redeemFreeCut}
            onEditPrice={FEATURES.priceEdit && admin ? editBookingPrice : undefined}
            onSellProducts={FEATURES.sales ? sellProductsFor : undefined}
            onNewBooking={() => setNewBookingOpen(true)}
            focus={inboxFocus}
            ctx={dash}
          />
        )}

        {/* CAJA — arqueo del día (FEATURES.cash) */}
        {tab === "caja" && <CajaTab ctx={dash} />}

        {/* FINANZAS */}
        {tab === "finanzas" && <FinanzasTab ctx={dash} />}

        {/* CLIENTES */}
        {tab === "clientes" && <ClientesTab ctx={dash} />}

        {/* INSCRIPCIONES */}
        {tab === "inscripciones" && <InscripcionesTab ctx={dash} />}

        {/* PEDIDOS */}
        {tab === "pedidos" && admin && <PedidosTab ctx={dash} />}

        {/* SERVICIOS */}
        {tab === "servicios" && <ServiciosTab ctx={dash} />}

        {/* ESSENTIALS (tienda de clientes) */}
        {tab === "essentials" && <EssentialsTab ctx={dash} />}

        {/* GASTOS — solo los gastos: los ingresos manuales comparten endpoint
            pero no entran en las categorías ni en los presupuestos. */}
        {tab === "gastos" && admin && (
          <ExpensesModule
            expenses={expenses.filter((e) => (e.kind || "gasto") === "gasto")}
            budgets={expenseBudgets}
            onCreate={createExpense}
            onUpdate={updateExpense}
            onDelete={deleteExpense}
            ctx={dash}
          />
        )}

        {/* MODAL NUEVA RESERVA (accesible desde cualquier pestaña: hero, dock, inbox) */}
        <NewBookingModal
          open={newBookingOpen}
          onClose={() => { setNewBookingOpen(false); setNewBookingPrefill(null) }}
          clients={clients}
          services={services}
          barbers={barbers}
          defaultBarberId={agendaBarber || 6}
          agendaSlots={AGENDA_SLOTS}
          prefill={newBookingPrefill}
          onCreate={async (draft) => {
            const result = await createBooking(draft)
            if (result?.ok) pushToast("✓", result.charging ? `Reserva de ${draft.client} creada: cóbrala para completarla` : `Reserva de ${draft.client} confirmada`)
            // Lo que no salió aunque la reserva sí (la hoja de cobro ya cubre
            // el caso "en curso", así que ahí no se repite).
            if (result?.ok && result.notice && !result.charging) pushToast("⚠️", result.notice, 8000)
            return result
          }}
          ctx={dash}
        />

        {/* HOJA DE COBRO — se abre sola al completar una reserva (FEATURES.charge) */}
        <ChargeSheet
          open={Boolean(chargeSheet)}
          booking={chargeSheet?.booking || null}
          mode={chargeSheet?.mode || "cobrar"}
          loyalty={chargeSheet?.loyalty || null}
          products={sellable}
          onClose={() => settleCharge(null)}
          onSubmit={(payment) => settleCharge(payment)}
        />

        {/* MOVIMIENTO MANUAL DE FINANZAS: gasto o ingreso (admin) */}
        <FinanceMovementSheet
          open={Boolean(financeMovementModal)}
          movement={financeMovementModal}
          barbers={[]}
          onClose={() => setFinanceMovementModal(null)}
          onSave={saveFinanceMovement}
          onDelete={async (expense) => { await deleteExpense(expense); setFinanceMovementModal(null) }}
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
          ctx={dash}
        />

        {/* TOASTS */}
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
          ctx={dash}
        />

        {/* AJUSTES */}
        {tab === "config" && <ConfigTab ctx={dash} />}

        {/* MARKETING */}
        {tab === "marketing" && <MarketingTab ctx={dash} />}
      </main>

      {/* Instalar el panel en la pantalla de inicio. Va acá y no en el login
          porque el arranque en standalone entra directo a /panel: este es el
          único punto donde el "aún no está instalada" es confiable. */}
      <InstallPrompt audience="barber" open={installOpen} onClose={closeInstall} />
    </PanelShell>
  )
}
