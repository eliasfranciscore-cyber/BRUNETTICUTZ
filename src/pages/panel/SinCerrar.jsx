import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CLP, fmtDate, santiagoDateKey } from '../../data.js'
import { FEATURES } from '../../features.js'
import { PAYMENT_LABELS } from '../../components/ChargeSheet.jsx'
import {
  Card, List, ListRow, Button, Chip, EmptyState, InlineAlert, Note, Sheet, ConfirmDialog,
  SectionLabel, SkeletonRows, Time,
} from '../../components/panel/index.js'
import '../../styles/panel/sin-cerrar.css'

/* "Sin cerrar": lo que quedó abierto en la caja. Dos listas:

   1. Sin cerrar — atenciones de días ANTERIORES que nunca se cobraron ni se
      marcaron como inasistencia (siguen pendientes, confirmadas o en curso).
      Mientras sigan así no suman estrella al cliente ni entran en la caja.
        · Cobrar  → ctx.updateBookingStatus(bk, 'completada'): la misma hoja de
                    cobro de siempre, que es la que suma la estrella (y ya
                    muestra el aviso de la estrella: acá no se repite).
        · No vino → PATCH cancelada + noShow (inasistencia; no es un estado
                    nuevo porque la app de iOS no lo sabría leer). Con
                    FEATURES.noShow en false se manda como cancelada común.

   2. Pago por confirmar — atenciones completadas sin medio de pago: las que
      se completaron solas una hora después de iniciarse (autocompletar,
      api/_bookingLife.js) y las que se completaron desde la app de iOS o el
      panel de Pimp Studio, que no mandan cobro. Ya cuentan como ingreso y el
      cliente ya sumó su estrella; lo único que falta es decir por qué medio
      pagó, para que el arqueo de Caja cuadre. El sistema no inventa ese medio.
        · Confirmar pago → la misma hoja de cobro (modo 'confirmar') con el
                    monto precargado; guarda con el PATCH "completada" de
                    siempre. Como ya estaba completada, el servidor lo trata
                    como corrección: no suma otra estrella ni reenvía el
                    correo. Ver confirmAutoPayment.

   Datos: GET /api/bookings?mode=unclosed[&summary=1] →
   { ok, count, items, toConfirm, toConfirmCount } (solo admin; acá hay un
   solo barbero, así que no hay filtro ni etiqueta de barbero).

   Tres piezas: el aviso del Resumen, la tarjeta de Caja y la hoja con la
   lista completa, que abren las dos. Todo apagado con FEATURES.unclosed. */

const EMPTY = { count: 0, items: [], toConfirm: [], toConfirmCount: 0 }

function useUnclosed(ctx, { summary = false, enabled = true } = {}) {
  const on = Boolean(enabled && FEATURES.unclosed)
  const [state, setState] = useState({ loading: on, error: null, ...EMPTY })
  // La última respuesta que se pidió es la que vale: una recarga lenta no pisa
  // a otra más nueva.
  const reqRef = useRef(0)
  const load = useCallback(async () => {
    if (!FEATURES.unclosed || !ctx?.authHeaders) return
    const req = ++reqRef.current
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const res = await fetch(`/api/bookings?mode=unclosed${summary ? '&summary=1' : ''}`, { headers: ctx.authHeaders() })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'No se pudieron cargar las atenciones sin cerrar.')
      if (req !== reqRef.current) return
      const items = Array.isArray(data.items) ? data.items : []
      const toConfirm = Array.isArray(data.toConfirm) ? data.toConfirm : []
      setState({
        loading: false, error: null,
        count: Number(data.count ?? items.length) || 0,
        items,
        toConfirm,
        toConfirmCount: Number(data.toConfirmCount ?? toConfirm.length) || 0,
      })
    } catch (err) {
      if (req !== reqRef.current) return
      setState((s) => ({ ...s, loading: false, error: err?.message || 'No se pudieron cargar las atenciones sin cerrar.' }))
    }
  }, [summary]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (on) load() }, [on, load])
  // Quita una fila ya cerrada (o un pago ya confirmado) sin volver a pedir todo.
  const remove = useCallback((booking, kind = 'unclosed') => setState((s) => (kind === 'confirm'
    ? {
        ...s,
        toConfirmCount: Math.max(0, s.toConfirmCount - 1),
        toConfirm: s.toConfirm.filter((it) => String(it.id) !== String(booking.id)),
      }
    : {
        ...s,
        count: Math.max(0, s.count - 1),
        items: s.items.filter((it) => String(it.id) !== String(booking.id)),
      })), [])
  return { ...state, reload: load, remove }
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/* "3 sin cerrar · 2 pagos por confirmar" (o solo la parte que exista). La
   forma larga nombra las sin cerrar como "atenciones de días anteriores". */
function summaryLine(count, toConfirm, { long = false } = {}) {
  const parts = []
  if (count) parts.push(long && !toConfirm ? `${plural(count, 'atención', 'atenciones')} de días anteriores` : `${count} sin cerrar`)
  if (toConfirm) parts.push(plural(toConfirm, 'pago por confirmar', 'pagos por confirmar'))
  return parts.join(' · ')
}

/* Confirmar el pago de una atención completada sin cobro. Lo comparten la
   hoja, la tarjeta de Caja y las filas "Por confirmar" del arqueo del día.
   Firma: confirmAutoPayment(ctx, booking) → { ok, charge } | { cancelled } | { error }.
   Es la misma hoja de cobro en modo 'confirmar', con el monto precargado con
   el precio (que es lo que ya cuenta como ingreso); el medio lo elige la
   persona. El PATCH es el de siempre y, como la reserva ya estaba completada,
   el servidor lo trata como corrección: no suma otra estrella ni reenvía el
   correo (ver api/_bookingLife.js). Los productos que se agreguen en la hoja
   se registran como venta aparte. Con FEATURES.charge en false,
   ctx.askForCharge resuelve null y esto devuelve { cancelled: true } sin tocar
   nada. */
export async function confirmAutoPayment(ctx, booking) {
  if (!ctx?.askForCharge || !ctx?.authHeaders) return { error: 'No se pudo abrir la hoja de cobro.' }
  const payment = await ctx.askForCharge(
    { ...booking, paidAmount: null, paymentMethod: null, paymentRef: null },
    'confirmar',
    ctx.loyaltyForBooking?.(booking) || null,
  )
  if (!payment) return { cancelled: true }
  const { products, applyLoyaltyDiscount, ...charge } = payment
  const res = await fetch('/api/bookings', {
    method: 'PATCH',
    headers: ctx.authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id: booking.id, status: 'completada', ...charge }),
  }).catch(() => null)
  const data = res ? await res.json().catch(() => ({})) : {}
  if (!res || !res.ok) return { error: data.error || 'No se pudo confirmar el pago. Revisa la conexión e intenta de nuevo.' }
  // Si esa reserva está cargada en el panel (Reservas, Agenda, Finanzas), que
  // se vea cobrada con su medio.
  ctx.setBookings?.((list) => list.map((it) => (String(it.id) === String(booking.id)
    ? { ...it, status: 'completada', paidAmount: charge.paidAmount, paymentMethod: charge.paymentMethod, paymentRef: charge.paymentRef || null, paymentPending: false }
    : it)))
  // Productos: SIEMPRE después de guardar el servicio y en su propio request
  // (dos plata distintas, ver registerSale en Dashboard.jsx). Si la venta
  // falla, el pago del servicio ya quedó bien: se avisa y no se deshace.
  if (Array.isArray(products) && products.length && ctx.registerSale) {
    const sale = await ctx.registerSale({
      bookingId: booking.id, products, paymentMethod: charge.paymentMethod,
      paymentRef: charge.paymentRef, applyLoyaltyDiscount,
    })
    if (!sale?.ok) {
      ctx.pushToast?.('⚠️', `Pago confirmado. ${sale?.error || 'No se pudo registrar la venta de productos.'}`)
      return { ok: true, charge }
    }
  }
  ctx.pushToast?.('✓', `Pago confirmado · ${PAYMENT_LABELS[charge.paymentMethod] || charge.paymentMethod} ${CLP(charge.paidAmount)}`)
  return { ok: true, charge }
}

function UnclosedRow({ booking, canCharge, busy, onCharge, onNoShow, prefix }) {
  return (
    <ListRow
      lead={<Time value={booking.time} />}
      title={booking.client || 'Cliente'}
      subtitle={[prefix, booking.service, booking.status === 'en curso' ? 'quedó en curso' : null].filter(Boolean).join(' · ')}
      value={CLP(booking.price || 0)}
      subtitleWrap
      className="pn-sc-row"
    >
      <span className="pn-sc-actions">
        {canCharge && (
          <Button variant="primary" size="sm" icon="cash" loading={busy === 'charge'} disabled={Boolean(busy)} onClick={() => onCharge(booking)}>
            Cobrar
          </Button>
        )}
        <Button variant="secondary" size="sm" disabled={Boolean(busy)} loading={busy === 'noshow'} onClick={() => onNoShow(booking)}>
          No vino
        </Button>
      </span>
    </ListRow>
  )
}

/* Fila de un pago por confirmar. Sin permiso de cobro no hay nada que hacer
   desde acá: queda el aviso para que lo confirme quien cobra. */
function ConfirmRow({ booking, canCharge, busy, onConfirm, todayKey }) {
  const when = booking.date === todayKey ? 'Hoy' : fmtDate(booking.date, 'dm')
  return (
    <ListRow
      lead={<Time value={booking.time} />}
      title={booking.client || 'Cliente'}
      subtitle={[when, booking.service, booking.autoCompleted ? 'se completó sola' : null].filter(Boolean).join(' · ')}
      value={CLP(booking.price || 0)}
      subtitleWrap
      className="pn-sc-row"
    >
      <span className="pn-sc-actions">
        {canCharge ? (
          <Button variant="primary" size="sm" icon="check" loading={busy === 'confirm'} disabled={Boolean(busy)} onClick={() => onConfirm(booking)}>
            Confirmar pago
          </Button>
        ) : (
          <Chip tone="warn" icon="clock">Por confirmar</Chip>
        )}
      </span>
    </ListRow>
  )
}

/* Lógica de cierre compartida por la hoja y la tarjeta de Caja. */
function useClosing(ctx, remove, onConfirmed) {
  const [busyId, setBusyId] = useState(null) // { id, kind }
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(null) // reserva a marcar "No vino"

  const charge = async (booking) => {
    if (busyId || !ctx?.updateBookingStatus) return
    setError('')
    setBusyId({ id: booking.id, kind: 'charge' })
    const r = await ctx.updateBookingStatus(booking, 'completada')
    setBusyId(null)
    if (!r || r.cancelled) return
    if (r.error) { setError(typeof r.error === 'string' ? r.error : 'No se pudo cobrar.'); return }
    remove(booking)
    // updateBookingStatus ya avisa la estrella nueva ("3/10 estrellas"); solo
    // sin ese aviso (puente caído, corrección) se confirma el cobro acá.
    if (!(r.loyalty && r.loyalty.earned !== false)) ctx.pushToast?.('✓', `Cobrada · ${booking.client || 'Cliente'}`)
  }

  const confirmPayment = async (booking) => {
    if (busyId) return
    setError('')
    setBusyId({ id: booking.id, kind: 'confirm' })
    const r = await confirmAutoPayment(ctx, booking)
    setBusyId(null)
    if (r.cancelled) return
    if (r.error) { setError(r.error); return }
    remove(booking, 'confirm')
    onConfirmed?.(booking)
  }

  const markNoShow = async () => {
    const booking = confirm
    if (!booking || !ctx?.authHeaders) return
    setError('')
    setBusyId({ id: booking.id, kind: 'noshow' })
    const noShow = FEATURES.noShow ? { noShow: true } : {}
    const res = await fetch('/api/bookings', {
      method: 'PATCH',
      headers: ctx.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ id: booking.id, status: 'cancelada', ...noShow }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusyId(null)
    setConfirm(null)
    if (!res || !res.ok) { setError(data.error || 'No se pudo marcar. Revisa la conexión e intenta de nuevo.'); return }
    remove(booking)
    // Si esa reserva está cargada en el panel (Reservas, Agenda), que se vea cancelada.
    ctx.setBookings?.((items) => items.map((it) => (String(it.id) === String(booking.id) ? { ...it, status: 'cancelada', ...noShow } : it)))
    if (data.loyalty) ctx.applyClientLoyalty?.(booking.phone, data.loyalty)
    ctx.pushToast?.('✓', `Reserva de ${booking.client} marcada como «No vino»`)
  }

  const busyFor = (booking) => (busyId && String(busyId.id) === String(booking.id) ? busyId.kind : null)

  const confirmDialog = (
    <ConfirmDialog
      open={Boolean(confirm)}
      tone="danger"
      title="¿No vino?"
      message={confirm ? `${confirm.client || 'Cliente'} · ${fmtDate(confirm.date, 'short')} a las ${confirm.time}. Queda cancelada como inasistencia: no suma estrella ni entra en la caja.` : ''}
      confirmLabel="Sí, no vino"
      cancelLabel="Volver"
      icon="user"
      busy={Boolean(busyId)}
      onConfirm={markNoShow}
      onCancel={() => setConfirm(null)}
    />
  )
  return { charge, confirmPayment, askNoShow: setConfirm, busyFor, error, clearError: () => setError(''), confirmDialog }
}

/* Hoja con las dos listas completas: primero los pagos por confirmar (un
   toque cada uno), después las sin cerrar agrupadas por día. */
export function SinCerrarSheet({ open, onClose, ctx, onChanged }) {
  const data = useUnclosed(ctx, { enabled: open })
  const removeAndNotify = useCallback((booking, kind) => { data.remove(booking, kind); onChanged?.() }, [data.remove, onChanged]) // eslint-disable-line react-hooks/exhaustive-deps
  const closing = useClosing(ctx, removeAndNotify)
  const todayKey = santiagoDateKey()

  const days = useMemo(() => {
    const map = new Map()
    for (const it of data.items) { if (!map.has(it.date)) map.set(it.date, []); map.get(it.date).push(it) }
    return [...map.entries()]
  }, [data.items])

  if (!FEATURES.unclosed) return null
  const total = data.count + data.toConfirmCount
  const both = data.toConfirm.length > 0 && data.items.length > 0
  const canCharge = ctx?.canCharge !== false

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Sin cerrar"
      subtitle={data.loading && !total ? 'Cargando…' : total ? summaryLine(data.count, data.toConfirmCount, { long: true }) : 'Todo cerrado'}
      icon="clock"
      size="lg"
    >
      <div className="pn-stack">
        {closing.error && <InlineAlert tone="error" onClose={closing.clearError}>{closing.error}</InlineAlert>}
        {data.error ? (
          <InlineAlert tone="error" action={{ label: 'Reintentar', onClick: data.reload }}>{data.error}</InlineAlert>
        ) : data.loading && !data.items.length && !data.toConfirm.length ? (
          <SkeletonRows rows={4} />
        ) : total === 0 ? (
          <EmptyState icon="checkCircle" title="No queda nada sin cerrar" text="Todas las atenciones de días anteriores están cobradas o marcadas como no asistidas, y no hay pagos por confirmar." />
        ) : (
          <>
            {data.toConfirm.length > 0 && (
              <section className="pn-sc-block" aria-label="Pago por confirmar">
                <header className="pn-sc-block-head">
                  <h3 className="pn-sc-block-title">Pago por confirmar <span className="pn-sc-count">{data.toConfirmCount || data.toConfirm.length}</span></h3>
                  <p className="pn-sc-block-hint">
                    Quedaron completadas sin medio de pago. Ya cuentan como ingreso y el cliente ya sumó su estrella; falta decir cómo se pagaron para que la caja cuadre.
                  </p>
                </header>
                <div className="pn-card is-flush pn-sc-group">
                  <List>
                    {data.toConfirm.map((bk) => (
                      <ConfirmRow
                        key={bk.id}
                        booking={bk}
                        canCharge={canCharge}
                        todayKey={todayKey}
                        busy={closing.busyFor(bk)}
                        onConfirm={closing.confirmPayment}
                      />
                    ))}
                  </List>
                </div>
              </section>
            )}

            {data.items.length > 0 && (
              <section className="pn-sc-block" aria-label="Sin cerrar">
                {both && (
                  <header className="pn-sc-block-head">
                    <h3 className="pn-sc-block-title">Sin cerrar <span className="pn-sc-count">{data.count || data.items.length}</span></h3>
                  </header>
                )}
                <Note icon="info">
                  Si el cliente vino, cóbrala; si no, márcala «No vino». Hasta cerrarlas no suman estrella ni entran en la caja.
                </Note>
                {days.map(([date, rows]) => (
                  <section key={date} className="pn-sc-day">
                    <SectionLabel>{fmtDate(date, 'short')} · {rows.length}</SectionLabel>
                    <div className="pn-card is-flush pn-sc-group">
                      <List>
                        {rows.map((bk) => (
                          <UnclosedRow
                            key={bk.id}
                            booking={bk}
                            canCharge={canCharge}
                            busy={closing.busyFor(bk)}
                            onCharge={closing.charge}
                            onNoShow={closing.askNoShow}
                          />
                        ))}
                      </List>
                    </div>
                  </section>
                ))}
                {data.items.length >= 500 && (
                  <Note icon="info">Se muestran las 500 más recientes: al cerrarlas aparecen las anteriores.</Note>
                )}
              </section>
            )}
          </>
        )}
      </div>
      {closing.confirmDialog}
    </Sheet>
  )
}

/* Aviso del Resumen: una línea con los dos números y "Revisar". Aparece solo
   si hay algo pendiente y desaparece al cerrar lo último. */
export function SinCerrarNotice({ ctx }) {
  const summary = useUnclosed(ctx, { summary: true })
  const [open, setOpen] = useState(false)
  if (!FEATURES.unclosed) return null
  // Mientras recarga conserva el número anterior: sin esto el aviso
  // parpadearía cada vez que se cierra una fila. La hoja sigue montada aunque
  // ya no quede nada, para que se vea el "todo cerrado" en vez de cortarse.
  const count = summary.count
  const toConfirm = summary.toConfirmCount
  const sheet = <SinCerrarSheet open={open} onClose={() => setOpen(false)} ctx={ctx} onChanged={summary.reload} />
  if (summary.error || (!count && !toConfirm)) return sheet
  const title = count && toConfirm
    ? summaryLine(count, toConfirm)
    : count
      ? `${plural(count, 'atención pasada', 'atenciones pasadas')} sin cerrar`
      : summaryLine(0, toConfirm)
  const body = count && toConfirm
    ? 'Las sin cerrar no suman estrella ni entran en la caja hasta cerrarlas. Los pagos por confirmar ya cuentan como ingreso: falta decir cómo se pagaron.'
    : count
      ? 'No suman estrella ni entran en la caja hasta cerrarlas.'
      : 'Ya cuentan como ingreso: falta confirmar cómo se pagaron para que la caja cuadre.'
  return (
    <>
      <InlineAlert
        tone="warn"
        icon="clock"
        className="pn-sc-notice"
        title={title}
        action={{ label: 'Revisar', onClick: () => setOpen(true) }}
      >
        {body}
      </InlineAlert>
      {sheet}
    </>
  )
}

/* Tarjeta de Caja: lo más reciente a la vista y el resto en la hoja.
   Los pagos por confirmar del MISMO día que está mirando Caja no se repiten
   acá: ya salen abajo, en el arqueo del día, con su propio botón.
   `refreshKey` (opcional): cuando cambia, la tarjeta vuelve a pedir la lista
   (Caja lo sube después de cobrar desde el arqueo una fila de un día pasado). */
export function SinCerrarCard({ ctx, preview = 3, onChanged, refreshKey }) {
  const data = useUnclosed(ctx)
  const [open, setOpen] = useState(false)
  const removeAndNotify = useCallback((booking, kind) => { data.remove(booking, kind); onChanged?.() }, [data.remove, onChanged]) // eslint-disable-line react-hooks/exhaustive-deps
  const closing = useClosing(ctx, removeAndNotify)
  const todayKey = santiagoDateKey()
  const cashDay = ctx?.cashDay
  const otherConfirm = useMemo(() => data.toConfirm.filter((it) => it.date !== cashDay), [data.toConfirm, cashDay])
  const lastRefreshKey = useRef(refreshKey)
  useEffect(() => {
    if (lastRefreshKey.current === refreshKey) return
    lastRefreshKey.current = refreshKey
    data.reload()
  }, [refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!FEATURES.unclosed) return null
  // Lo que falta confirmar de OTROS días: el conteo del servidor menos los del
  // día que está a la vista (que salen en el arqueo).
  const sameDayConfirm = data.toConfirm.length - otherConfirm.length
  const otherConfirmCount = Math.max(0, (data.toConfirmCount || data.toConfirm.length) - sameDayConfirm)
  const total = data.count + otherConfirmCount
  const closeSheet = () => { setOpen(false); data.reload(); onChanged?.() }
  if (data.error || (!data.loading && total === 0)) {
    return <SinCerrarSheet open={open} onClose={closeSheet} ctx={ctx} />
  }
  const rows = [
    ...otherConfirm.map((bk) => ({ kind: 'confirm', bk })),
    ...data.items.map((bk) => ({ kind: 'unclosed', bk })),
  ].slice(0, preview)
  const canCharge = ctx?.canCharge !== false
  return (
    <Card
      title="Sin cerrar"
      subtitle={data.loading && !total ? 'Cargando…' : summaryLine(data.count, otherConfirmCount, { long: true })}
      action={total > preview ? <Button variant="plain" size="sm" iconRight="chevronRight" onClick={() => setOpen(true)}>Ver todas</Button> : null}
      flush
      className="pn-sc-card"
    >
      {data.loading && !data.items.length && !data.toConfirm.length ? <SkeletonRows rows={2} /> : (
        <>
          {closing.error && <div className="pn-sc-card-alert"><InlineAlert tone="error" onClose={closing.clearError}>{closing.error}</InlineAlert></div>}
          <List>
            {rows.map(({ kind, bk }) => (kind === 'confirm' ? (
              <ConfirmRow
                key={`c${bk.id}`}
                booking={bk}
                canCharge={canCharge}
                todayKey={todayKey}
                busy={closing.busyFor(bk)}
                onConfirm={closing.confirmPayment}
              />
            ) : (
              <UnclosedRow
                key={`u${bk.id}`}
                booking={bk}
                prefix={fmtDate(bk.date, 'dm')}
                canCharge={canCharge}
                busy={closing.busyFor(bk)}
                onCharge={closing.charge}
                onNoShow={closing.askNoShow}
              />
            )))}
          </List>
          {total > preview && (
            <div className="pn-sc-more">
              <Button variant="secondary" size="sm" block onClick={() => setOpen(true)}>
                Ver las {total}
              </Button>
            </div>
          )}
        </>
      )}
      {closing.confirmDialog}
      <SinCerrarSheet open={open} onClose={closeSheet} ctx={ctx} />
    </Card>
  )
}
