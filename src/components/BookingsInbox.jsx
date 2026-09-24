import React, { useState, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { Icon } from './ui.jsx'
import { CLP, isoDate, buildWeek, cleanPhone, bookingUid, fmtDate, fmtRange } from '../data.js'
import { waHref, waMessages, waRescheduledMessage } from '../whatsapp.js'
import {
  ModuleHeader, Toolbar, Segmented, FilterChips, SearchField, Sheet, ActionMenu, ChoiceGrid, Field,
  Button, IconButton, Chip, Avatar, Time, List, ListRow, EmptyState, PeriodNav, CalendarSheet,
  useIsPhone, useStoredFlag,
} from './panel/index.js'
import {
  BookingDetailModal, RescheduleSheet, NEXT_STATUS, NEXT_LABEL, NEXT_SHORT, NEXT_ICON, barberShortOf, StatusChip,
  canMarkNoShow, isPaymentPending,
} from '../pages/panel/BookingDetailSheet.jsx'
import { confirmAutoPayment } from '../pages/panel/SinCerrar.jsx'
import '../styles/panel/reservas.css'

const cx = (...parts) => parts.filter(Boolean).join(' ')

/**
 * BookingsInbox — Reservas del panel.
 *
 * Celular: tarjetas de partida (con la acción principal, WhatsApp y "···"
 * afuera, sin entrar al detalle) o, si se prefiere, una lista compacta
 * (hora · cliente/servicio · estado · acción rápida). Escritorio: tarjetas.
 * Tocar una reserva abre la hoja de detalle única (BookingDetailModal, la
 * misma que usa Agenda).
 *
 * El admin (Bruno) ve todas las reservas; con un solo barbero no hay filtro
 * por barbero (aparece solo si algún día hay más de uno).
 */

const FILTERS = ['Todas', 'Pendientes', 'Confirmadas', 'En curso', 'Completadas', 'Canceladas']
const FILTER_MAP = { Pendientes: 'pendiente', Confirmadas: 'confirmada', 'En curso': 'en curso', Completadas: 'completada', Canceladas: 'cancelada' }
const SCOPES = [['dia', 'Hoy'], ['semana', 'Semana'], ['todas', 'Todas']]

// Lunes (00:00 local) de la semana de una fecha "YYYY-MM-DD".
const mondayOf = (iso) => {
  const d = new Date(`${iso}T00:00:00`)
  const dow = d.getDay() || 7
  d.setDate(d.getDate() - dow + 1)
  d.setHours(0, 0, 0, 0)
  return d
}
const weekOffsetOf = (iso) => Math.round((mondayOf(iso) - mondayOf(isoDate())) / (7 * 86400000))

/* La vista del celular recordada por navegador. Antes (vista vieja) se
   guardaba en `ps_res_view` = 'cards' | 'lista': si alguien había elegido la
   lista, se respeta la primera vez. */
const initialCardsView = (() => {
  try { return localStorage.getItem('ps_res_view') !== 'lista' } catch { return true }
})()

/* Acciones del "···" de una reserva, las mismas en la fila y en la tarjeta. */
function rowMenuItems(bk, { withWhatsApp, reschedulable, walletSending, onWhatsApp, onSendWallet, onReschedule, onNoShow, onQuickCancel }) {
  const cancelable = bk.status !== 'cancelada' && bk.status !== 'completada'
  return [
    withWhatsApp && { label: 'Enviar WhatsApp', icon: 'whatsapp', onClick: () => onWhatsApp(bk) },
    { label: bk.walletHasPass ? 'Reenviar tarjeta Wallet' : 'Enviar tarjeta Wallet', icon: 'wallet', hint: bk.walletHasPass ? 'Ya tiene la tarjeta' : undefined, onClick: () => onSendWallet(bk), disabled: walletSending },
    reschedulable && { label: 'Reagendar', icon: 'reschedule', onClick: () => onReschedule(bk) },
    canMarkNoShow(bk) && { label: 'No vino', icon: 'user', danger: true, onClick: () => onNoShow(bk) },
    cancelable && { label: 'Cancelar reserva', icon: 'close', danger: true, onClick: () => onQuickCancel(bk) },
  ]
}

/* Fila compacta del celular: hora · cliente/servicio, estado y UNA acción
   rápida (la que corresponda al estado) + "···" para el resto. Barbero,
   teléfono y precio quedan en la hoja de detalle. */
function BookingRow({ bk, showDate, onOpen, onQuickAdvance, onConfirmPayment, menu }) {
  const next = NEXT_STATUS[bk.status]
  const payPending = isPaymentPending(bk)
  return (
    <ListRow
      lead={<Time value={bk.time} sub={showDate ? fmtDate(bk.date, 'dm') : undefined} />}
      title={bk.client}
      subtitle={bk.service}
      onClick={() => onOpen(bk)}
      dim={bk.status === 'cancelada'}
      actions={<ActionMenu items={menu} label="Más opciones" title={bk.client} small />}
    >
      <span className="pn-reservas-rowfoot">
        <span className="pn-hstack">
          <StatusChip bk={bk} />
          {payPending && <Chip tone="warn" icon="cash">Por confirmar</Chip>}
        </span>
        {next ? (
          <Button variant="secondary" size="sm" icon={NEXT_ICON[bk.status]} onClick={(e) => { e.stopPropagation(); onQuickAdvance(bk) }}>
            {NEXT_SHORT[bk.status]}
          </Button>
        ) : payPending ? (
          <Button variant="secondary" size="sm" icon="cash" onClick={(e) => { e.stopPropagation(); onConfirmPayment(bk) }}>
            Confirmar
          </Button>
        ) : null}
      </span>
    </ListRow>
  )
}

/* Tarjeta: de partida en el celular (selector Tarjetas | Lista) y siempre en
   escritorio. Botones EXTERNOS de 44 px: la acción principal según el
   estado, WhatsApp y un "···" con lo demás — nada de eso exige entrar al
   detalle. `compact` ajusta el aire en el celular (ver reservas.css). */
function BookingCard({ bk, showBarber, showDate, barbers, loyalty, compact, onOpen, onQuickAdvance, onConfirmPayment, onWhatsApp, menu }) {
  const next = NEXT_STATUS[bk.status]
  const payPending = isPaymentPending(bk)
  // El aviso del corte gratis va en las que todavía se pueden canjear (no en
  // las ya cerradas: el saldo es del cliente, no de esa reserva).
  const freeCutReady = loyalty?.freeCutReady && !bk.freeCut && Number(bk.price || 0) > 0 && !['cancelada', 'completada'].includes(bk.status)
  return (
    <div
      className={cx('pn-reservas-card', compact && 'is-compact', bk.status === 'cancelada' && 'is-dim')}
      role="button" tabIndex={0} aria-label={`Ver detalle de ${bk.client}`}
      onClick={() => onOpen(bk)}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(bk) }}
    >
      <div className="pn-reservas-card-top">
        <Time value={bk.time} sub={showDate ? fmtDate(bk.date, 'short') : undefined} />
        <StatusChip bk={bk} />
      </div>
      {payPending && <Chip tone="warn" icon="cash">Pago por confirmar</Chip>}
      {freeCutReady && <Chip tone="accent" icon="gift">Corte gratis disponible</Chip>}
      {bk.freeCut && <Chip tone="accent" icon="gift">Corte gratis aplicado</Chip>}
      <div className="pn-reservas-card-client">
        <Avatar name={bk.client} />
        <div className="pn-reservas-card-clienttext">
          <b>{bk.client}</b>
          <span>{bk.service}</span>
        </div>
      </div>
      {showBarber && <div className="pn-reservas-card-row"><span>Barbero</span><b>{barberShortOf(bk, barbers)}</b></div>}
      <div className="pn-reservas-card-row"><span>Total</span><b className="pn-num">{CLP(Number(bk.price || 0))}</b></div>
      <div className="pn-reservas-card-actions" onClick={(e) => e.stopPropagation()}>
        {next ? (
          <Button variant="primary" size="sm" icon={NEXT_ICON[bk.status]} onClick={() => onQuickAdvance(bk)}>{NEXT_LABEL[bk.status]}</Button>
        ) : payPending ? (
          <Button variant="primary" size="sm" icon="cash" onClick={() => onConfirmPayment(bk)}>Confirmar pago</Button>
        ) : (
          <span className="pn-reservas-card-actions-spacer" />
        )}
        <IconButton icon="whatsapp" label="Enviar WhatsApp" onClick={() => onWhatsApp(bk)} />
        <ActionMenu items={menu} label="Más opciones" title={bk.client} small />
      </div>
    </div>
  )
}

/* Hoja de filtro: estado (con contador, el mismo de las chips de arriba,
   para quien prefiera un blanco más grande) y barbero solo si hay más de
   uno. */
function FilterSheet({ open, onClose, filter, setFilter, countFor, multiBarber, barbers, barberFilter, setBarberFilter }) {
  return (
    <Sheet open={open} onClose={onClose} title="Filtrar reservas" icon="filter" size="sm" footer={<Button variant="primary" block onClick={onClose}>Listo</Button>}>
      <div className="pn-stack is-lg">
        <Field label="Estado">
          <ChoiceGrid
            ariaLabel="Estado"
            value={filter}
            onChange={setFilter}
            cols={2}
            options={FILTERS.map((f) => ({ value: f, label: `${f} (${countFor(f)})` }))}
          />
        </Field>
        {multiBarber && (
          <Field label="Barbero">
            <ChoiceGrid
              ariaLabel="Barbero"
              value={String(barberFilter)}
              onChange={setBarberFilter}
              cols={2}
              options={[{ value: 'all', label: 'Todos' }, ...barbers.filter((b) => b.active !== false).map((b) => ({ value: String(b.id), label: b.name }))]}
            />
          </Field>
        )}
      </div>
    </Sheet>
  )
}

/* Aviso con "Deshacer" (cancelar y "No vino" son reversibles: la acción
   rápida de la tarjeta avisa en vez de pedir confirmación; la hoja de
   detalle sí confirma, por ser la vía "deliberada"). Ofrece además avisarle
   al cliente por WhatsApp con el mensaje ya escrito. */
function UndoToast({ toast, onUndo, onClose }) {
  if (!toast) return null
  return createPortal((
    <div className="pn-reservas-toast" role="status">
      <span>{toast.message}</span>
      <div className="pn-reservas-toast-actions">
        {toast.waHref && (
          <a href={toast.waHref} target="_blank" rel="noopener noreferrer"><Icon name="whatsapp" size={13} /> Avisar</a>
        )}
        {toast.prev ? (
          <button type="button" onClick={onUndo}>Deshacer</button>
        ) : (
          <button type="button" onClick={onClose} aria-label="Cerrar aviso">OK</button>
        )}
      </div>
    </div>
  ), document.body)
}

export default function BookingsInbox({
  bookings = [], barbers = [], barber, admin = false, teamScope, isAdmin, clients = [],
  onStatus = () => {}, onDelete = () => {}, onReschedule, onRedeemFreeCut, onEditPrice, onNewBooking,
  onEnsureRange, rangeEpoch = 0, focus, onSellProducts, ctx,
}) {
  const isPhone = useIsPhone()
  const seeAll = teamScope ?? admin
  const canEditPrice = Boolean(isAdmin ?? admin)
  const [filter, setFilter] = useState('Todas')
  const [dateScope, setDateScope] = useState('dia')
  const [barberFilter, setBarberFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [detailId, setDetailId] = useState(null)
  const [toast, setToast] = useState(null)
  const prevStatus = useRef({})
  const toastTimer = useRef(null)
  // Celular: tarjetas de partida; la lista es una preferencia secundaria.
  // En escritorio siempre tarjetas, sin selector.
  const [cardsView, setCardsView] = useStoredFlag('pn_reservas_cards', initialCardsView)
  const [reschedulingBk, setReschedulingBk] = useState(null)

  const [weekOffset, setWeekOffset] = useState(0)
  const [selectedDay, setSelectedDay] = useState(() => isoDate())
  const [calOpen, setCalOpen] = useState(false)
  const [slideKey, setSlideKey] = useState(0) // re-dispara la animación al cambiar de día

  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const todayKey = isoDate()
  // Mismo identificador que usa la hoja de detalle (bookingUid, data.js):
  // un String, así que el deep-link (?bookingId=) se compara como String.
  const idOf = (b) => bookingUid(b)
  const multiBarber = barbers.length > 1
  const searching = query.trim().length > 0
  const byBarber = (list) => (seeAll && multiBarber && barberFilter !== 'all'
    ? list.filter((b) => Number(b.barberId) === Number(barberFilter))
    : list)

  // Alcance base: el admin ve todas; un barbero, solo las suyas (cualquier
  // fecha, para poder navegar por días). El recorte por día va más abajo.
  const mine = useMemo(() => (
    seeAll ? bookings : bookings.filter((b) => Number(b.barberId) === Number(barber?.id))
  ), [bookings, seeAll, barber])

  // Conteo de reservas activas por día (tira de la semana y calendario).
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

  // Al navegar a una semana pasada se piden sus reservas por rango: pueden
  // no estar entre las últimas que el panel carga al abrir. rangeEpoch cambia
  // tras una recarga manual (que reemplaza la lista): sin volver a pedir, la
  // semana pasada que se está viendo quedaría vacía.
  useEffect(() => { onEnsureRange?.(weekKeys[0], weekKeys[6]) }, [weekKeys, rangeEpoch]) // eslint-disable-line react-hooks/exhaustive-deps

  // Rango de fechas rápido (Hoy / Semana / Todas) para la lista.
  const scopeList = useMemo(() => {
    let list = mine
    if (dateScope === 'dia') list = list.filter((b) => b.date === selectedDay)
    else if (dateScope === 'semana') list = list.filter((b) => weekKeys.includes(b.date))
    return byBarber(list)
  }, [mine, dateScope, selectedDay, weekKeys, seeAll, multiBarber, barberFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  const countFor = (f) => (f === 'Todas'
    ? scopeList.filter((b) => b.status !== 'cancelada').length
    : scopeList.filter((b) => b.status === FILTER_MAP[f]).length)

  // Lista visible: búsqueda en todas las fechas, o el rango elegido.
  const visible = useMemo(() => {
    const byTime = (a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)
    if (searching) {
      const q = query.trim().toLowerCase()
      return byBarber(mine.filter((b) => `${b.client || ''} ${b.phone || ''} ${b.service || ''}`.toLowerCase().includes(q))).sort(byTime)
    }
    const list = filter !== 'Todas'
      ? scopeList.filter((b) => b.status === FILTER_MAP[filter])
      : scopeList.filter((b) => b.status !== 'cancelada')
    return [...list].sort(byTime)
  }, [searching, query, mine, scopeList, filter, seeAll, multiBarber, barberFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // Resumen de la semana visible (subtítulo del encabezado).
  const isToday = selectedDay === todayKey
  const weekCount = weekKeys.reduce((s, k) => s + (countsByDay[k] || 0), 0)
  const weekLabel = weekOffset === 0 ? 'esta semana'
    : weekOffset === 1 ? 'la próx. semana'
    : weekOffset === -1 ? 'la semana pasada'
    : weekOffset < 0 ? `hace ${-weekOffset} semanas`
    : `en ${weekOffset} semanas`
  const weekRevenue = mine
    .filter((b) => b.status !== 'cancelada' && weekKeys.includes(b.date))
    .reduce((s, b) => s + Number(b.price || 0), 0)

  // La reserva del detalle se resuelve en vivo desde props, para reflejar
  // cada cambio (y para abrirse sola cuando llega la de un deep-link).
  const detailBk = detailId != null ? bookings.find((b) => idOf(b) === detailId) || null : null

  // --- Navegación de días -------------------------------------------------
  const selectDay = (key) => { setSelectedDay(key); setSlideKey((k) => k + 1); setDateScope('dia') }
  const goToWeek = (offset) => {
    setWeekOffset(offset)
    const wd = buildWeek(offset)
    if (!wd.some((d) => d.key === selectedDay)) {
      setSelectedDay(wd[0].key)
      setSlideKey((k) => k + 1)
    }
  }
  const shiftDay = (delta) => {
    const d = new Date(`${selectedDay}T00:00:00`)
    d.setDate(d.getDate() + delta)
    const key = isoDate(d)
    selectDay(key)
    if (!weekDays.some((x) => x.key === key)) setWeekOffset((o) => o + (delta > 0 ? 1 : -1))
  }
  const goHoy = () => { setDateScope('dia'); selectDay(todayKey); setWeekOffset(0) }
  const pickFromCalendar = (key) => {
    selectDay(key)
    setWeekOffset(weekOffsetOf(key))
  }

  /* El calendario pide las reservas del mes visible SEMANA POR SEMANA (y no
     el mes de una): así usa las mismas claves de caché que las flechas de
     semana, y una semana ya vista por cualquiera de los dos caminos no se
     vuelve a pedir. Devuelve la promesa solo si algo fue a la red, para que
     el calendario muestre "cargando…" nada más cuando corresponde. */
  const ensureMonth = (fromKey, toKey) => {
    if (!onEnsureRange) return undefined
    const pending = []
    const start = mondayOf(fromKey)
    const end = new Date(`${toKey}T00:00:00`)
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 7)) {
      const sunday = new Date(d)
      sunday.setDate(d.getDate() + 6)
      const p = onEnsureRange(isoDate(d), isoDate(sunday))
      if (p && typeof p.then === 'function') pending.push(p)
    }
    return pending.length ? Promise.all(pending) : undefined
  }

  // Foco externo (búsqueda global, Resumen, notificación push o la campana):
  // salta a una fecha ARBITRARIA. `ts` re-dispara focos repetidos.
  useEffect(() => {
    if (!focus?.day) return
    setWeekOffset(weekOffsetOf(focus.day))
    setSelectedDay(focus.day)
    setDateScope(focus.scope || 'dia')
    if (focus.filter) setFilter(focus.filter)
    setSlideKey((k) => k + 1)
    setQuery(''); setSearchOpen(false)
    // Deep-link a una reserva puntual: idOf devuelve un String, así que el
    // id de la URL (que llega como número) se compara como String.
    if (focus.bookingId != null) setDetailId(String(focus.bookingId))
    // Se consume una sola vez: si no se limpia acá, un remonte de esta
    // pestaña (se desmonta al salir de "Reservas") vuelve a leer el mismo
    // foco viejo y el día elegido por búsqueda queda pegado para siempre.
    ctx?.setInboxFocus?.(null)
  }, [focus?.day, focus?.ts]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Deslizar (celular): cambia de día, en tarjetas y en lista por igual ---
  // Con el mouse, soltar un arrastre encima de una tarjeta también dispara
  // su click (y framer-motion avisa el fin del arrastre recién en el cuadro
  // siguiente): mientras se arrastra, y un instante después, no se abre el
  // detalle.
  const swipe = useRef({ active: false, at: 0 })
  const handleDaySwipeStart = () => { swipe.current = { active: true, at: Date.now() } }
  const handleDaySwipeEnd = (_event, info) => {
    swipe.current = { active: false, at: Date.now() }
    if (searching || dateScope !== 'dia') return
    const { offset, velocity } = info
    if (Math.abs(offset.x) > 60 || Math.abs(velocity.x) > 500) shiftDay(offset.x < 0 ? 1 : -1)
  }

  // Estrellas del cliente de una reserva: se cruzan por teléfono con la
  // lista de clientes que el panel ya tiene (mismo dato que
  // ctx.loyaltyForBooking), sin pedirle nada extra a la API.
  const loyaltyByPhone = useMemo(() => {
    const m = new Map()
    for (const c of clients) {
      if (c.loyalty && c.phone) m.set(cleanPhone(c.phone), c.loyalty)
    }
    return m
  }, [clients])
  const loyaltyOf = (bk) => (bk?.phone ? loyaltyByPhone.get(cleanPhone(bk.phone)) || null : null)

  const showToast = (next, ms = 15000) => {
    clearTimeout(toastTimer.current)
    setToast(next)
    toastTimer.current = setTimeout(() => setToast(null), ms)
  }
  const closeToast = () => { clearTimeout(toastTimer.current); setToast(null) }

  // Cancelar: reversible → aviso con "Deshacer", sin confirmación previa (la
  // hoja de detalle sí confirma, por el "···").
  const cancelWithUndo = (bk) => {
    const prev = bk.status === 'cancelada' ? 'pendiente' : bk.status
    prevStatus.current[idOf(bk)] = prev
    onStatus(bk, 'cancelada')
    showToast({
      id: idOf(bk),
      prev,
      message: `Reserva de ${bk.client} cancelada`,
      waHref: waHref(bk.phone, waMessages.cancelada(bk)),
    })
  }

  // "No vino": cancelada + no_show (no es un estado nuevo). Va por
  // ctx.updateBookingStatus porque onStatus solo lleva (reserva, estado).
  const markNoShow = (bk) => (ctx?.updateBookingStatus
    ? ctx.updateBookingStatus(bk, 'cancelada', { noShow: true })
    : onStatus(bk, 'cancelada', { noShow: true }))
  const noShowWithUndo = async (bk) => {
    const prev = bk.status
    prevStatus.current[idOf(bk)] = prev
    showToast({ id: idOf(bk), prev, message: `Reserva de ${bk.client} marcada como «No vino»` })
    const result = await markNoShow(bk)
    if (result?.error) {
      closeToast()
      ctx?.pushToast?.('⚠️', result.error, 6000)
    }
    return result
  }

  // Reagendar: persiste vía PATCH y, si sale bien, ofrece el WhatsApp con el
  // horario NUEVO para que el cliente confirme el cambio. Es el `onSubmit`
  // que usan la hoja de detalle y el "···" de la tarjeta.
  const submitReschedule = async (bk, patch) => {
    if (!onReschedule) return { error: 'Reagendar no está disponible.' }
    const result = await onReschedule(bk, patch)
    if (result?.error) return result
    const nextBarber = multiBarber ? barbers.find((x) => Number(x.id) === Number(patch.barberId)) : null
    showToast({
      id: idOf(bk),
      message: `Hora de ${bk.client} movida al ${fmtDate(patch.date, 'short')} a las ${patch.time}`,
      waHref: waHref(bk.phone, waRescheduledMessage({
        client: bk.client, date: patch.date, time: patch.time,
        barber: nextBarber ? (nextBarber.short || nextBarber.name) : undefined,
      })),
    })
    return result
  }
  const undoToast = () => {
    if (!toast) return
    // El aviso de reagendar no trae `prev`: ahí no hay nada que deshacer.
    if (toast.prev) {
      const bk = bookings.find((b) => idOf(b) === toast.id)
      if (bk) onStatus(bk, toast.prev)
    }
    closeToast()
  }
  // Avanzar con un toque. "en curso" → completada abre la hoja de cobro
  // (ctx.updateBookingStatus → askForCharge); la estrella la avisa el panel.
  const onQuickAdvance = (bk) => { const next = NEXT_STATUS[bk.status]; if (next) onStatus(bk, next) }
  // Pago de una atención que se completó sola: la hoja de cobro en modo
  // 'confirmar' (confirmAutoPayment, compartida con "Sin cerrar" y Caja).
  const confirmPayment = async (bk) => {
    if (!ctx) return
    const result = await confirmAutoPayment(ctx, bk)
    if (result?.error) ctx.pushToast?.('⚠️', result.error, 6000)
  }
  const confirmDeleteAndClose = (bk) => {
    onDelete(bk)
    if (detailId != null && idOf(bk) === detailId) setDetailId(null)
  }
  const sendWallet = (bk) => ctx?.sendWalletCard?.({ phone: bk.phone, name: bk.client })
  // WhatsApp de la tarjeta/fila: mensaje según el estado (textos de Brunetti,
  // src/whatsapp.js).
  const openWhatsApp = (bk) => {
    const situation = bk.status === 'pendiente' ? 'default' : bk.status
    const href = waHref(bk.phone, (waMessages[situation] || waMessages.default)(bk, barberShortOf(bk, barbers)))
    if (href) window.open(href, '_blank', 'noopener,noreferrer')
  }
  const openDetail = (bk) => {
    // (un "arrastrando" de más de 3 s se da por perdido: el div pudo
    // desmontarse sin avisar el fin)
    const since = Date.now() - swipe.current.at
    if (since < (swipe.current.active ? 3000 : 250)) return
    setDetailId(idOf(bk))
  }
  const menuFor = (bk, withWhatsApp) => rowMenuItems(bk, {
    withWhatsApp,
    reschedulable: Boolean(onReschedule) && (bk.status === 'pendiente' || bk.status === 'confirmada'),
    walletSending: ctx?.walletSendingId != null && ctx.walletSendingId === bk.phone,
    onWhatsApp: openWhatsApp,
    onSendWallet: sendWallet,
    onReschedule: setReschedulingBk,
    onNoShow: noShowWithUndo,
    onQuickCancel: cancelWithUndo,
  })

  // " para hoy", " para el martes 29 de septiembre", " esta semana" o nada.
  const whenText = dateScope === 'semana' ? ` ${weekLabel}`
    : dateScope === 'todas' ? ''
    : isToday ? ' para hoy' : ` para el ${fmtDate(selectedDay, 'long')}`
  const showBarber = seeAll && multiBarber
  // Con más de un día en pantalla (Semana, Todas o una búsqueda) cada
  // reserva lleva su fecha; en "Hoy" sobra.
  const showDate = searching || dateScope !== 'dia'
  const closeSearch = () => { setQuery(''); setSearchOpen(false) }
  const emptyTitle = searching
    ? `Sin resultados para "${query.trim()}"`
    : `Sin reservas${filter !== 'Todas' ? ` ${filter.toLowerCase()}` : ''}${whenText}.`

  return (
    <div className="pn-page pn-reservas">
      <ModuleHeader
        title="Reservas"
        subtitle={`${weekCount} ${weekCount === 1 ? 'reserva' : 'reservas'} ${weekLabel} · ${CLP(weekRevenue)}`}
        primary={onNewBooking ? { label: 'Reserva', icon: 'plus', onClick: onNewBooking } : undefined}
        actions={[
          { label: 'Calendario', icon: 'calendar', onClick: () => setCalOpen(true) },
          isPhone && { label: cardsView ? 'Ver como lista' : 'Ver como tarjetas', icon: cardsView ? 'list' : 'grid', onClick: () => setCardsView(!cardsView) },
        ].filter(Boolean)}
      />

      <Toolbar>
        {searchOpen ? (
          <>
            <SearchField value={query} onChange={setQuery} placeholder="Buscar en todas las fechas" autoFocus className="pn-grow" />
            <IconButton icon="close" label="Cerrar búsqueda" onClick={closeSearch} />
          </>
        ) : (
          <>
            <Segmented
              ariaLabel="Rango de fechas"
              options={SCOPES.map(([v, l]) => ({ value: v, label: l }))}
              // "Hoy" es el rótulo de dateScope 'dia', pero acá también se
              // llega al enfocar un día puntual desde la búsqueda (no
              // necesariamente hoy): sin esto el segmentado marcaba "Hoy"
              // mientras la nota de abajo decía "Mostrando el 23 de septiembre".
              value={dateScope === 'dia' && !isToday ? null : dateScope}
              onChange={(v) => (v === 'dia' ? goHoy() : setDateScope(v))}
            />
            <div className="pn-toolbar-spacer" />
            <IconButton icon="search" label="Buscar" onClick={() => setSearchOpen(true)} />
            <IconButton icon="filter" label="Filtrar" onClick={() => setFilterOpen(true)} />
          </>
        )}
      </Toolbar>

      {/* Chips de estado con contador: son el KPI de estado y el filtro a la vez. */}
      {!searching && (
        <FilterChips
          ariaLabel="Filtrar por estado"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({ value: f, label: f, count: countFor(f) }))}
        />
      )}

      {/* La tira de semana (con sus flechas) solo aparece con "Semana": para
          "Hoy" no hace falta y para "Todas" no aplica. */}
      {!searching && dateScope === 'semana' && (
        <div className="pn-reservas-week">
          <PeriodNav
            label={fmtRange(weekKeys[0], weekKeys[6])}
            sublabel={weekLabel}
            onPrev={() => goToWeek(weekOffset - 1)}
            onNext={() => goToWeek(weekOffset + 1)}
            onLabelClick={() => setCalOpen(true)}
            prevLabel="Semana anterior"
            nextLabel="Semana siguiente"
          />
          <div className="pn-reservas-daystrip" role="group" aria-label="Día de la semana">
            {weekDays.map((d) => {
              const n = countsByDay[d.key] || 0
              const isActive = d.key === selectedDay
              const isTdy = d.key === todayKey
              return (
                <button key={d.key} type="button" className={cx('pn-reservas-day', isActive && 'is-active', isTdy && 'is-today')} aria-pressed={isActive} onClick={() => selectDay(d.key)}>
                  <span>{isTdy ? 'Hoy' : d.dow}</span>
                  <b>{d.num}</b>
                  <i>{n > 0 ? n : ''}</i>
                </button>
              )
            })}
          </div>
        </div>
      )}
      {!searching && dateScope === 'dia' && !isToday && (
        <p className="pn-muted pn-reservas-note">
          <Icon name="calendar" size={12} /> Mostrando el {fmtDate(selectedDay, 'long')}.
          <button type="button" className="pn-reservas-notelink" onClick={goHoy}>Volver a hoy</button>
        </p>
      )}
      {searching && <p className="pn-muted pn-reservas-note"><Icon name="search" size={12} /> {visible.length} resultado{visible.length === 1 ? '' : 's'} en todas las fechas</p>}

      <motion.div
        key={slideKey}
        className="pn-reservas-swipe"
        drag={searching || dateScope !== 'dia' ? false : 'x'}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.5}
        dragDirectionLock
        onDragStart={handleDaySwipeStart}
        onDragEnd={handleDaySwipeEnd}
      >
        {visible.length === 0 ? (
          <EmptyState
            compact
            icon={searching ? 'search' : 'calendar'}
            title={emptyTitle}
            action={!searching && onNewBooking ? { label: 'Nueva reserva', icon: 'plus', onClick: onNewBooking } : undefined}
          />
        ) : isPhone && !cardsView ? (
          <List>
            {visible.map((bk) => (
              <BookingRow
                key={idOf(bk)} bk={bk} showDate={showDate}
                onOpen={openDetail} onQuickAdvance={onQuickAdvance} onConfirmPayment={confirmPayment}
                menu={menuFor(bk, true)}
              />
            ))}
          </List>
        ) : (
          <div className={cx('pn-reservas-cards', isPhone && 'is-compact')}>
            {visible.map((bk) => (
              <BookingCard
                key={idOf(bk)} bk={bk} barbers={barbers} showBarber={showBarber} showDate={showDate} loyalty={loyaltyOf(bk)} compact={isPhone}
                onOpen={openDetail} onQuickAdvance={onQuickAdvance} onConfirmPayment={confirmPayment}
                onWhatsApp={openWhatsApp} menu={menuFor(bk, false)}
              />
            ))}
          </div>
        )}
      </motion.div>

      <CalendarSheet
        open={calOpen}
        onClose={() => setCalOpen(false)}
        value={selectedDay}
        onChange={pickFromCalendar}
        counts={countsByDay}
        onMonthChange={ensureMonth}
        title="Calendario de reservas"
        subtitle="Toca un día para ver sus reservas"
      />

      <FilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        filter={filter}
        setFilter={setFilter}
        countFor={countFor}
        multiBarber={seeAll && multiBarber}
        barbers={barbers}
        barberFilter={barberFilter}
        setBarberFilter={setBarberFilter}
      />

      <BookingDetailModal
        booking={detailBk}
        onClose={() => setDetailId(null)}
        ctx={ctx}
        clients={clients}
        barbers={barbers}
        canEditPrice={canEditPrice}
        loyalty={loyaltyOf(detailBk)}
        prevStatus={detailBk ? prevStatus.current[idOf(detailBk)] : undefined}
        onStatus={onStatus}
        onReschedule={onReschedule ? submitReschedule : undefined}
        onCancel={cancelWithUndo}
        onNoShow={noShowWithUndo}
        onDelete={confirmDeleteAndClose}
        onEditPrice={onEditPrice}
        onRedeem={onRedeemFreeCut}
        onSellProducts={onSellProducts}
      />

      {/* Reagendar rápido desde el "···" de la tarjeta/fila, sin abrir el
          detalle: misma hoja y mismo onSubmit que usa el detalle. */}
      {onReschedule && (
        <RescheduleSheet
          open={Boolean(reschedulingBk)}
          booking={reschedulingBk}
          onClose={() => setReschedulingBk(null)}
          onSubmit={submitReschedule}
        />
      )}

      <UndoToast toast={toast} onUndo={undoToast} onClose={closeToast} />
    </div>
  )
}
