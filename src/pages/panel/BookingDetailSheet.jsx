import React, { useEffect, useMemo, useRef, useState } from 'react'
import { CLP, cleanPhone, isoDate, buildWeek, bookingUid, fmtDate, santiagoDateKey } from '../../data.js'
import { waLinkForBooking } from '../../whatsapp.js'
import { FEATURES } from '../../features.js'
import { Icon } from '../../components/ui.jsx'
import { PAYMENT_LABELS } from '../../components/ChargeSheet.jsx'
import {
  Sheet, ConfirmDialog, ActionMenu, Button, IconButton, Chip, StatusBadge, Avatar, List, ListRow,
  Field, ProgressBar, InlineAlert, ChoiceGrid, BOOKING_STATUS,
} from '../../components/panel/index.js'
import { confirmAutoPayment } from './SinCerrar.jsx'
import '../../styles/panel/reservas.css'

/* ============================================================
   BookingDetailModal — la ÚNICA hoja de detalle de una reserva.

   La usan dos lugares con contratos distintos:
   - BookingsInbox (Reservas): pasa todo explícito (onStatus, onReschedule,
     onCancel, onNoShow, onDelete, onEditPrice, onRedeem, onSellProducts,
     loyalty, prevStatus…) porque ya trae esa lógica con sus avisos y el
     "Deshacer".
   - Agenda, vía Dashboard.jsx (`<BookingDetailModal booking={detail}
     clients onClose onConfirm onCancel onRedeemFreeCut ctx={dash} />`):
     solo trae Confirmar, Cancelar (que además recarga la agenda) y el canje.
     Todo lo que no llega como prop se resuelve contra `ctx` (el mismo
     objeto `dash`), así cambiar de estado, cobrar, reagendar, "No vino",
     eliminar, editar el precio, canjear, vender productos y mandar la
     tarjeta de Wallet funcionan igual desde los dos lugares.

   Encabezado/pie fijos y "arrastrar para cerrar" los da `Sheet`; acá solo
   vive el contenido y la resolución props ↔ ctx. Hay un solo barbero
   (Brunetti), así que no hay fila de barbero ni selector de barbero al
   reagendar. */

// Próximo estado natural al avanzar una reserva con un toque (acción rápida
// de Reservas y primaria de esta hoja). Se exportan para que BookingsInbox
// use exactamente el mismo rótulo/ícono/estado, sin un segundo mapa que se
// pueda desalinear. Con la hoja de cobro, "en curso" se cierra cobrando.
export const NEXT_LABEL = { pendiente: 'Confirmar', confirmada: 'Iniciar atención', 'en curso': FEATURES.charge ? 'Cobrar' : 'Completar' }
export const NEXT_SHORT = { pendiente: 'Confirmar', confirmada: 'Iniciar', 'en curso': FEATURES.charge ? 'Cobrar' : 'Completar' }
export const NEXT_ICON = { pendiente: 'check', confirmada: 'scissors', 'en curso': FEATURES.charge ? 'cash' : 'check' }
export const NEXT_STATUS = { pendiente: 'confirmada', confirmada: 'en curso', 'en curso': 'completada' }
const STATUS_OPTIONS = ['pendiente', 'confirmada', 'en curso', 'completada', 'cancelada']

export function barberShortOf(bk, barbers) {
  const b = (barbers || []).find((x) => Number(x.id) === Number(bk?.barberId))
  return b?.short || b?.name || bk?.barber || 'tu barbero'
}

// Hora actual en Chile ("HH:MM"), para saber si una cita ya empezó aunque el
// navegador esté en otra zona.
const SANTIAGO_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/* ¿Ya llegó la hora de la cita? (día anterior, o hoy con la hora pasada). */
export function hasStarted(bk) {
  if (!bk?.date) return false
  const today = santiagoDateKey()
  if (bk.date < today) return true
  if (bk.date > today) return false
  return String(bk.time || '').slice(0, 5) <= SANTIAGO_TIME.format(new Date())
}

/* "No vino" solo tiene sentido con la cita ya empezada y sin cerrar: una
   futura se cancela, una completada ya se atendió. */
export function canMarkNoShow(bk) {
  return FEATURES.noShow && ['pendiente', 'confirmada', 'en curso'].includes(bk?.status) && hasStarted(bk)
}

/* Atención completada sola (autocompletar) que todavía no dice cómo se pagó. */
export function isPaymentPending(bk) {
  return FEATURES.autoComplete && FEATURES.charge && bk?.status === 'completada' && bk?.paymentPending === true
}

// "No vino" es la MISMA cancelada para la plata (sigue contando como tal en
// filtros y contadores) — solo se ve distinta. No es un estado nuevo (la app
// de iOS no lo leería): es `status:'cancelada'` + `noShow:true`, así que
// StatusBadge (que solo mira `status`) no alcanza.
export function StatusChip({ bk, large }) {
  if (bk?.status === 'cancelada' && bk?.noShow) return <Chip tone="muted" dot large={large}>No vino</Chip>
  return <StatusBadge status={bk?.status} large={large} />
}

/* Reagendar: elige día y hora nuevos contra la disponibilidad real de la
   agenda. Vive acá porque la usan la hoja de detalle y el "···" de cada
   tarjeta de Reservas, con el mismo `onSubmit`. */
export function RescheduleSheet({ open, booking, onClose, onSubmit }) {
  const [day, setDay] = useState(() => booking?.date || isoDate())
  const [slot, setSlot] = useState('')
  const [slots, setSlots] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!open) return
    setDay(booking?.date && booking.date >= isoDate() ? booking.date : isoDate())
    setSlot(booking?.time || '')
    setBusy(false); setErr(''); setConfirming(false)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // 4 semanas hacia adelante alcanza de sobra: el cliente reserva con pocos
  // días de anticipación y un reagendamiento manual rara vez va más lejos.
  const days = useMemo(() => [0, 1, 2, 3].flatMap((o) => buildWeek(o)), [])
  const minDay = isoDate()
  const maxDay = days[days.length - 1]?.key || minDay
  const barberId = booking?.barberId

  useEffect(() => {
    if (!open || barberId == null) return undefined
    let alive = true
    setSlots(null)
    // excludeBookingId: que la propia reserva no tape sus horarios (el
    // servidor igual vuelve a chequear el choque al guardar: 409/422).
    const params = new URLSearchParams({ barberId: String(barberId), date: day })
    if (booking?.serviceId) params.set('serviceId', String(booking.serviceId))
    if (booking?.id != null) params.set('excludeBookingId', String(booking.id))
    fetch(`/api/availability?${params}`)
      .then((r) => (r.headers.get('content-type')?.includes('application/json') ? r.json() : Promise.reject(new Error('offline'))))
      .then((data) => { if (alive) setSlots(Array.isArray(data?.slots) ? data.slots : []) })
      .catch(() => { if (alive) setSlots([]) })
    return () => { alive = false }
  }, [open, barberId, day, booking?.serviceId, booking?.id])

  if (!booking) return null

  // El horario actual de esta reserva puede salir "ocupado" (por ella misma),
  // pero tiene que poder elegirse: mover solo el día es el caso más común.
  const isFree = (s) => {
    if (day === booking.date && s.slot === booking.time) return true
    return s.available
  }

  const submit = async () => {
    if (!slot) { setErr('Elige un horario.'); return }
    setBusy(true); setErr('')
    const result = await onSubmit(booking, { date: day, time: slot, barberId: Number(barberId) })
    setBusy(false)
    if (result?.error) { setConfirming(false); setErr(typeof result.error === 'string' ? result.error : 'No se pudo reagendar.'); return }
    onClose()
  }

  const unchanged = day === booking.date && slot === booking.time
  const first = String(booking.client || '').trim().split(' ')[0] || 'el cliente'

  return (
    <Sheet
      open={open}
      onClose={busy ? undefined : onClose}
      title="Reagendar hora"
      subtitle={`${booking.client} · ${booking.service}`}
      icon="reschedule"
      size="sm"
      footer={confirming ? (
        <>
          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>Volver</Button>
          <Button variant="primary" icon="check" onClick={submit} loading={busy}>Sí, mover</Button>
        </>
      ) : (
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" icon="check" onClick={() => setConfirming(true)} disabled={!slot || unchanged}>Mover la hora</Button>
        </>
      )}
    >
      <div className="pn-stack">
        {confirming ? (
          <InlineAlert tone="info">
            <b>¿Mover la cita al {fmtDate(day, 'long')} a las {slot}?</b>
            <div>Si {first} dejó su correo, le llega el aviso con la hora nueva.</div>
          </InlineAlert>
        ) : (
          <>
            <Field label="Día">
              {/* input nativo: en iOS abre la rueda de fechas en vez de una
                  lista larga. */}
              <input
                type="date" className="input" value={day} min={minDay} max={maxDay}
                onChange={(e) => { if (e.target.value) { setDay(e.target.value); setSlot('') } }}
              />
            </Field>
            <Field label="Horario">
              {slots === null ? (
                <p className="pn-muted">Cargando horarios…</p>
              ) : slots.length === 0 ? (
                <p className="pn-muted">Sin horarios para ese día.</p>
              ) : (
                <ChoiceGrid
                  ariaLabel="Horario"
                  value={slot}
                  onChange={setSlot}
                  cols={3}
                  options={slots.map((s) => ({ value: s.slot, label: s.slot, disabled: !isFree(s) }))}
                />
              )}
            </Field>
          </>
        )}
        {err && <InlineAlert tone="error">{err}</InlineAlert>}
      </div>
    </Sheet>
  )
}

export function BookingDetailModal(props) {
  // Mientras `booking` exista se usan las props tal cual llegan; apenas se
  // cierra (booking pasa a null) se sigue dibujando con la ÚLTIMA versión
  // conocida, para que la animación de cierre del Sheet no muestre una hoja
  // vacía a medio desvanecer.
  const frozen = useRef(props)
  if (props.booking) frozen.current = props
  const p = props.booking ? props : frozen.current
  const {
    onClose, ctx,
    clients: clientsProp, barbers: barbersProp,
    canEditPrice: canEditPriceProp, loyalty: loyaltyProp, prevStatus,
    onStatus, onComplete, onReschedule, onCancel, onNoShow, onDelete, onEditPrice, onRedeem, onRedeemFreeCut,
    onSellProducts, onConfirm,
  } = p
  const isOpen = Boolean(props.booking)

  // Se re-resuelve contra ctx.bookings por id: si un cambio de estado lo
  // dispara esta misma hoja (p. ej. desde Agenda, donde `booking` es una
  // copia fija), el chip y las acciones siguientes quedan al día. Además
  // ctx.bookings trae la tarjeta de Wallet y la profesión del cliente.
  const bk = useMemo(() => {
    const base = p.booking
    if (!base) return null
    const live = ctx?.bookings?.find?.((b) => bookingUid(b) === bookingUid(base))
    return live || base
  }, [p.booking, ctx?.bookings])

  const [editingPrice, setEditingPrice] = useState(false)
  const [priceDraft, setPriceDraft] = useState('')
  const [priceBusy, setPriceBusy] = useState(false)
  const [priceErr, setPriceErr] = useState('')
  const [rescheduling, setRescheduling] = useState(false)
  const [confirmKind, setConfirmKind] = useState(null) // null | 'cancel' | 'noshow' | 'delete'
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [statusPickerOpen, setStatusPickerOpen] = useState(false)
  const [payBusy, setPayBusy] = useState(false)

  useEffect(() => {
    if (!bk) return
    setPriceDraft(String(bk.price ?? ''))
    setEditingPrice(false); setPriceErr('')
  }, [bk?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!bk) return null

  const clients = clientsProp ?? ctx?.clients ?? []
  const barbers = barbersProp ?? ctx?.barbers ?? []
  const admin = Boolean(ctx?.admin)
  const editPriceFn = onEditPrice || ctx?.editBookingPrice
  const canEditPrice = FEATURES.priceEdit && Boolean(editPriceFn) && (canEditPriceProp ?? admin)
  const canCharge = ctx?.canCharge !== false
  const sellFn = onSellProducts || (FEATURES.sales && canCharge ? ctx?.sellProductsFor : undefined)
  const rescheduleFn = onReschedule || (FEATURES.reschedule ? ctx?.rescheduleBooking : undefined)
  const loyalty = loyaltyProp !== undefined ? loyaltyProp : (ctx?.loyaltyForBooking ? ctx.loyaltyForBooking(bk) : null)

  const short = barberShortOf(bk, barbers)
  const waStatus = bk.status === 'cancelada' ? 'cancelada' : bk.status === 'pendiente' ? 'default' : bk.status
  const cancelable = bk.status !== 'cancelada' && bk.status !== 'completada'
  const noShowable = canMarkNoShow(bk)
  const payPending = isPaymentPending(bk)
  const price = Number(bk.price || 0)
  const paid = bk.status === 'completada' && bk.paidAmount != null
  const canCorrect = paid && FEATURES.charge && canCharge && admin && typeof ctx?.openCashRow === 'function'

  const clientMatch = clients.find((c) => c.phone && cleanPhone(c.phone) === cleanPhone(bk.phone))
  /* `visits` cuenta solo reservas no canceladas y ya ocurridas: esta reserva
     entra si es de hoy o antes, no si es futura. Recurrente = al menos una
     visita además de esta. */
  const todayKey = santiagoDateKey()
  const countsThis = bk.status !== 'cancelada' && String(bk.date || '') <= todayKey ? 1 : 0
  const visits = Number(clientMatch?.visits || 0)
  const isRecurring = clientMatch && visits - countsThis >= 1

  const requestClose = () => onClose?.()

  // --- Acciones, con respaldo en ctx cuando quien abre la hoja no trae su
  //     propio handler (la hoja abierta desde Agenda). ---
  const doConfirm = () => (onStatus ? onStatus(bk, 'confirmada') : onConfirm ? onConfirm(bk) : ctx?.updateBookingStatus?.(bk, 'confirmada'))
  const doAdvance = (next) => (onStatus ? onStatus(bk, next) : ctx?.updateBookingStatus?.(bk, next))
  // Completar pasa por la hoja de cobro (ctx.updateBookingStatus → askForCharge).
  const doComplete = () => (onComplete ? onComplete(bk) : doAdvance('completada'))
  const doCancel = () => (onCancel ? onCancel(bk) : ctx?.updateBookingStatus?.(bk, 'cancelada'))
  const doNoShow = async () => {
    if (onNoShow) return onNoShow(bk)
    const result = await ctx?.updateBookingStatus?.(bk, 'cancelada', { noShow: true })
    if (result?.error) { ctx?.pushToast?.('⚠️', result.error, 6000); return result }
    ctx?.pushToast?.('✓', `Reserva de ${bk.client} marcada como «No vino»`)
    // Igual que al cancelar desde Agenda: el horario queda libre en la grilla.
    ctx?.loadAgenda?.()
    return result
  }
  const doRevert = () => doAdvance(prevStatus || 'pendiente')
  const doReschedule = (b, patch) => {
    if (onReschedule) return onReschedule(b, patch)
    if (!rescheduleFn) return Promise.resolve({ error: 'Reagendar no está disponible.' })
    return rescheduleFn(b, patch).then((r) => {
      if (r?.ok) ctx?.pushToast?.('✓', `Hora de ${b.client} movida al ${fmtDate(patch.date, 'short')} a las ${patch.time}`)
      return r
    })
  }
  const doDelete = () => (onDelete ? onDelete(bk) : ctx?.deleteBooking?.(bk))
  // Canje: el de Brunetti (ctx.redeemFreeCut) pregunta antes con su propio
  // confirm y deja la reserva en $0.
  const doRedeem = () => {
    const fn = onRedeem || onRedeemFreeCut || ctx?.redeemFreeCut
    return fn?.(bk)
  }
  const doConfirmPayment = async () => {
    setPayBusy(true)
    const result = ctx ? await confirmAutoPayment(ctx, bk) : { error: 'No disponible.' }
    setPayBusy(false)
    if (result?.error) ctx?.pushToast?.('⚠️', result.error, 6000)
  }

  const savePrice = async () => {
    const n = Number(priceDraft)
    if (priceDraft === '' || !Number.isFinite(n) || n < 0) { setPriceErr('Precio inválido'); return }
    setPriceBusy(true); setPriceErr('')
    const result = editPriceFn ? await editPriceFn(bk, Math.round(n)) : { error: 'No disponible.' }
    setPriceBusy(false)
    if (result?.error) { setPriceErr(typeof result.error === 'string' ? result.error : 'No se pudo actualizar.'); return }
    setEditingPrice(false)
  }

  const openWhatsApp = () => {
    const href = waLinkForBooking(bk, short, waStatus)
    if (href) window.open(href, '_blank', 'noopener,noreferrer')
  }

  const sendingWallet = ctx?.walletSendingId != null && ctx.walletSendingId === bk.phone
  const sendWallet = () => ctx?.sendWalletCard?.({ phone: bk.phone, name: bk.client })

  const runConfirm = async (fn) => {
    setConfirmBusy(true)
    await fn()
    setConfirmBusy(false)
    setConfirmKind(null)
    requestClose()
  }

  const primaryAction = NEXT_STATUS[bk.status] ? {
    label: NEXT_LABEL[bk.status], icon: NEXT_ICON[bk.status],
    onClick: bk.status === 'en curso' ? doComplete : bk.status === 'confirmada' ? () => doAdvance('en curso') : doConfirm,
  } : payPending ? {
    label: 'Confirmar pago', icon: 'cash', onClick: doConfirmPayment, loading: payBusy,
  } : null

  const secondaryAction =
    bk.status === 'completada' && sellFn ? { label: 'Agregar productos', icon: 'cart', onClick: () => { sellFn(bk); requestClose() } } :
    bk.status === 'cancelada' ? { label: bk.noShow ? 'Deshacer «No vino»' : 'Revertir cancelación', icon: 'reschedule', onClick: doRevert } :
    (bk.status === 'pendiente' || bk.status === 'confirmada') && rescheduleFn ? { label: 'Reagendar', icon: 'reschedule', onClick: () => setRescheduling(true) } :
    null

  // "Cambiar estado" es el salto libre entre los 5 estados (p. ej. deshacer
  // una "completada"): la primaria solo avanza al siguiente estado natural.
  const pickStatus = (s) => {
    if (s !== bk.status) (s === 'cancelada' ? doCancel() : doAdvance(s))
    setStatusPickerOpen(false)
  }
  const menuItems = [
    { label: 'Cambiar estado', icon: 'refresh', onClick: () => setStatusPickerOpen(true) },
    canCorrect && { label: 'Corregir cobro', icon: 'cash', hint: 'Monto, medio o comprobante', onClick: () => ctx.openCashRow(bk) },
    noShowable && { label: 'No vino', icon: 'user', danger: true, onClick: () => setConfirmKind('noshow') },
    cancelable && { label: 'Cancelar reserva', icon: 'close', danger: true, onClick: () => setConfirmKind('cancel') },
    { label: 'Eliminar reserva definitivamente', icon: 'trash', danger: true, onClick: () => setConfirmKind('delete') },
  ]

  const paymentLabel = paid
    ? [CLP(Number(bk.paidAmount || 0)), PAYMENT_LABELS[bk.paymentMethod] || bk.paymentMethod].filter(Boolean).join(' · ')
    : null

  return (
    <>
      <Sheet
        open={isOpen}
        onClose={requestClose}
        lead={<Avatar name={bk.client} size={40} accent />}
        title={bk.client}
        subtitle={`${fmtDate(bk.date, 'short')} · ${bk.time}`}
        headActions={<ActionMenu items={menuItems} title={bk.client} />}
        size="md"
        footer={(
          <>
            <div className="pn-foot-start pn-hstack">
              <IconButton icon="whatsapp" label="Enviar WhatsApp" onClick={openWhatsApp} />
              {/* Con primaria de por medio, la secundaria va de ícono junto al
                  de WhatsApp: tres botones de texto en 390 px cortaban
                  "Iniciar atención". Sin primaria sí lleva rótulo. */}
              {secondaryAction && primaryAction && (
                <IconButton icon={secondaryAction.icon} label={secondaryAction.label} onClick={secondaryAction.onClick} />
              )}
            </div>
            {secondaryAction && !primaryAction && (
              <Button variant="secondary" icon={secondaryAction.icon} onClick={secondaryAction.onClick}>{secondaryAction.label}</Button>
            )}
            {primaryAction && (
              <Button variant="primary" icon={primaryAction.icon} onClick={primaryAction.onClick} loading={primaryAction.loading}>{primaryAction.label}</Button>
            )}
          </>
        )}
      >
        <div className="pn-stack">
          <div className="pn-hstack">
            <StatusChip bk={bk} large />
            {payPending && <Chip tone="warn" icon="cash">Pago por confirmar</Chip>}
            <Chip tone="muted">{isRecurring ? `Cliente recurrente · ${visits} ${visits === 1 ? 'visita' : 'visitas'}` : 'Cliente nuevo'}</Chip>
          </div>

          {payPending && (
            <InlineAlert tone="warn">
              Se completó sola al terminar la hora. Confirma cómo pagó para que entre bien en la caja.
            </InlineAlert>
          )}

          <List>
            {bk.status === 'cancelada' && bk.noShow && <ListRow title="Asistencia" value="Marcada como no vino" />}
            <ListRow title="Servicio" value={bk.service} />
            <ListRow title="Teléfono" value={bk.phone ? `+56 ${bk.phone}` : '—'} />
            {bk.profession && <ListRow title="Profesión" value={bk.profession} />}
            <ListRow
              title="Total"
              value={canEditPrice && editingPrice ? (
                <span className="pn-reservas-priceedit">
                  <input
                    className="input" type="number" min={0} inputMode="numeric" value={priceDraft}
                    aria-label="Precio nuevo"
                    onChange={(e) => setPriceDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') savePrice() }}
                    autoFocus
                  />
                  <IconButton icon="check" label="Guardar precio" small onClick={savePrice} disabled={priceBusy} />
                  <IconButton icon="close" label="Cancelar edición" small plain onClick={() => { setEditingPrice(false); setPriceDraft(String(bk.price ?? '')); setPriceErr('') }} disabled={priceBusy} />
                </span>
              ) : (
                <span className="pn-reservas-price">
                  {CLP(price)}
                  {canEditPrice && <IconButton icon="pencil" label="Editar precio" small plain onClick={() => setEditingPrice(true)} />}
                </span>
              )}
            />
            {paymentLabel && (
              <ListRow
                title="Cobro"
                subtitle={bk.paymentRef ? `N.º ${bk.paymentRef}` : undefined}
                value={<span className="pn-reservas-paid">{paymentLabel}</span>}
              />
            )}
            {loyalty && (
              <ListRow
                title="Estrellas"
                value={<span className="pn-reservas-stars"><Icon name="star" size={13} /> {loyalty.stars}/{loyalty.goal}</span>}
              >
                <ProgressBar value={loyalty.stars} max={loyalty.goal} label="Estrellas de fidelidad" />
              </ListRow>
            )}
            <ListRow
              lead={<Icon name="wallet" size={18} />}
              title="Tarjeta Wallet"
              subtitle={bk.walletHasPass ? 'Ya tiene la tarjeta' : 'Todavía no la agrega'}
              trailing={(
                <Button variant="secondary" icon="wallet" loading={sendingWallet} onClick={sendWallet}>
                  {bk.walletHasPass ? 'Reenviar' : 'Enviar'}
                </Button>
              )}
            />
          </List>
          {priceErr && <InlineAlert tone="error">{priceErr}</InlineAlert>}

          {/* Beneficios de fidelidad: visibles justo donde se cobra, o no se
              aplican nunca. */}
          {bk.freeCut ? (
            <InlineAlert tone="success" icon="gift">Corte gratis aplicado</InlineAlert>
          ) : loyalty?.freeCutReady && price > 0 && bk.status !== 'cancelada' && bk.status !== 'completada' ? (
            <div className="pn-reservas-loyalty">
              <b>🎁 Corte #{loyalty.goal} — va gratis</b>
              <p>{String(bk.client || '').split(' ')[0]} completó sus {loyalty.goal} estrellas.</p>
              <Button variant="primary" block icon="gift" onClick={doRedeem}>Canjear corte gratis</Button>
            </div>
          ) : !loyalty?.freeCutReady && loyalty?.productDiscountReady ? (
            <InlineAlert tone="info" icon="percent">
              <b>{loyalty.productDiscountPct}% dcto en productos</b>
              <div>Ofrécele productos de cuidado capilar con descuento en esta visita.</div>
            </InlineAlert>
          ) : null}
        </div>
      </Sheet>

      <Sheet open={statusPickerOpen} onClose={() => setStatusPickerOpen(false)} title="Cambiar estado" icon="refresh" size="sm">
        <ChoiceGrid
          ariaLabel="Estado"
          value={bk.status}
          onChange={pickStatus}
          cols={2}
          options={STATUS_OPTIONS.map((s) => ({ value: s, label: BOOKING_STATUS[s]?.label || s }))}
        />
      </Sheet>

      {rescheduleFn && (
        <RescheduleSheet
          open={rescheduling}
          booking={bk}
          onClose={() => setRescheduling(false)}
          onSubmit={doReschedule}
        />
      )}

      <ConfirmDialog
        open={confirmKind === 'cancel'}
        tone="danger"
        icon="close"
        title="¿Cancelar esta reserva?"
        message={`La hora de ${bk.client} (${bk.time} · ${fmtDate(bk.date, 'short')}) va a quedar cancelada.`}
        confirmLabel="Sí, cancelar"
        cancelLabel="Volver"
        busy={confirmBusy}
        onCancel={() => setConfirmKind(null)}
        onConfirm={() => runConfirm(doCancel)}
      />
      <ConfirmDialog
        open={confirmKind === 'noshow'}
        tone="danger"
        icon="user"
        title="¿No vino?"
        message={`La hora de ${bk.client} (${bk.time} · ${fmtDate(bk.date, 'short')}) queda cancelada como inasistencia. No suma estrella ni entra en la caja.`}
        confirmLabel="Sí, no vino"
        cancelLabel="Volver"
        busy={confirmBusy}
        onCancel={() => setConfirmKind(null)}
        onConfirm={() => runConfirm(doNoShow)}
      />
      <ConfirmDialog
        open={confirmKind === 'delete'}
        tone="danger"
        icon="trash"
        title="¿Eliminar esta reserva?"
        message={`Vas a borrar por completo la hora de ${bk.client} (${bk.time} · ${fmtDate(bk.date, 'short')}). Esta acción no se puede deshacer.`}
        confirmLabel="Sí, eliminar"
        cancelLabel="Volver"
        busy={confirmBusy}
        onCancel={() => setConfirmKind(null)}
        onConfirm={() => runConfirm(doDelete)}
      />
    </>
  )
}
