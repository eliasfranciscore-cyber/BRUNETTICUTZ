import React, { useMemo, useState } from 'react'
import { CLP, fmtDate, isoDate, santiagoDateKey } from '../../data.js'
import { FEATURES } from '../../features.js'
import { PAYMENT_LABELS } from '../../components/ChargeSheet.jsx'
import {
  ModuleHeader, Toolbar, PeriodNav, CalendarSheet, Card, Kpi, StackedBar, DataTable, List, ListRow,
  Time, Chip, Button, EmptyState, InlineAlert, ConfirmDialog, Skeleton,
} from '../../components/panel/index.js'
import { SinCerrarCard, confirmAutoPayment } from './SinCerrar.jsx'
import '../../styles/panel/online.css'
import '../../styles/panel/caja.css'

/* Pestaña «Caja» — arqueo del día.

   Qué entró por cada medio de pago, qué falta por cobrar y el detalle de cada
   reserva, venta de producto y venta online del día. Los datos vienen de
   GET /api/bookings?mode=cash&date=, ya cargados por Dashboard.jsx en
   `ctx.cashData` (undefined = cargando, null = error; se recarga solo al
   entrar a la pestaña y al cambiar de día, ver `loadCash`). El servidor manda
   el arqueo ya calculado (summarizeCash en api/_money.js): acá no se rehace
   ninguna cuenta, solo se ordena.

   Acá hay un solo barbero: sin columna Barbero ni "Cobró".

   Dos Mercado Pago distintos:
     · `mercadopago` — cobrado en el mesón (el QR o el link del celular).
     · `online`      — lo que entró por la web con Checkout Pro: pedidos de
                       Essentials e inscripciones de Cursos y Workshop. Va en
                       su propia línea "Online (web)" y en su propia tarjeta,
                       de solo lectura, con "Ver pedidos".
   `collected` ("Cobrado") suma los dos, más los productos del mesón.

   "Por confirmar": atenciones completadas sin medio de pago (se completaron
   solas a la hora de iniciarse, o desde la app de iOS o el panel de Pimp
   Studio). Ya cuentan como ingreso pero no como cobrado: van en el desglose
   rayado, aparte, y tienen su propia lista con "Confirmar pago", que abre la
   hoja de cobro con el monto precargado (confirmAutoPayment). */

// Un color por medio de pago, derivado de los tokens semánticos (y de dos
// propios de Caja, --pn-caja-mp y --pn-caja-online, en caja.css): se reutiliza
// en la barra apilada, en la leyenda y en el chip de cada fila, así los tres
// hablan el mismo idioma visual. Mercado Pago no va en --pn-warn como en Pimp
// Studio: acá la transferencia es dorada (--pn-accent) y los dos se confundían.
const METHOD_COLOR = {
  efectivo: 'var(--pn-ok)',
  tarjeta: 'var(--pn-info)',
  transferencia: 'var(--pn-accent)',
  mercadopago: 'var(--pn-caja-mp)',
  cortesia: 'var(--pn-text-3)',
  online: 'var(--pn-caja-online)',
  // Rayado: es plata que cuenta pero cuyo medio todavía no se sabe.
  pendiente: 'repeating-linear-gradient(135deg, var(--pn-warn) 0 3px, var(--pn-warn-soft) 3px 6px)',
}
const METHOD_TONE = { efectivo: 'ok', tarjeta: 'info', transferencia: 'accent', mercadopago: 'mp', cortesia: 'muted' }
// En la leyenda el Mercado Pago del mesón se nombra así para no confundirlo
// con la línea online, que también se paga con Mercado Pago.
const LEGEND_LABEL = { pendiente: 'Por confirmar', online: 'Online (web)', mercadopago: 'Mercado Pago (mesón)' }
const methodLabel = (id) => LEGEND_LABEL[id] || PAYMENT_LABELS[id] || id
// Orden del desglose: los medios del mesón (de mayor a menor), después lo
// online y al final lo por confirmar, que no es un medio sino lo que falta.
const METHOD_RANK = { online: 1, pendiente: 2 }

const ONLINE_TYPE = { cursos: 'Cursos', workshop: 'Workshop', essentials: 'Essentials' }

const SANTIAGO_TIME = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false })
function timeOf(value) {
  const d = value ? new Date(value) : null
  return d && !Number.isNaN(d.getTime()) ? SANTIAGO_TIME.format(d) : '—'
}

function MethodChip({ method, pending, legacy }) {
  if (pending) return <Chip tone="warn" icon="clock">Por confirmar</Chip>
  if (legacy) return <Chip tone="muted" title="Completada antes de que se registrara el medio de pago">Sin registro</Chip>
  if (!method) return <Chip tone="warn">Sin cobrar</Chip>
  return <Chip tone={METHOD_TONE[method] || 'muted'}>{PAYMENT_LABELS[method] || method}</Chip>
}

// Se opera en componentes locales (no UTC) para no correr el día por el huso
// de Chile, igual que isoDate().
function shiftDay(dateKey, delta) {
  const [y, m, d] = String(dateKey).split('-').map(Number)
  const dt = new Date(y || 1970, (m || 1) - 1, d || 1)
  dt.setDate(dt.getDate() + delta)
  return isoDate(dt)
}

/* Completada de antes de que el panel registrara el cobro: sin monto, sin
   medio y sin "por confirmar" (no tiene completed_at). El servidor no la
   cuenta en el arqueo (no sabe si ni cómo se pagó); acá va aparte y tocarla
   permite anotar el medio con la misma hoja de cobro. */
const isLegacy = (b) => b.status === 'completada' && b.paidAmount == null && !b.paymentPending

/* `action` = { label, icon, run } para el botón de la celda del monto
   ("Cobrar" o "Confirmar pago"). En las listas pendientes (`pending`) el
   comprobante siempre diría "—": no se muestra. */
const bookingColumns = ({ action, pending = false } = {}) => [
  { key: 'time', label: 'Hora', nowrap: true, render: (b) => b.time },
  { key: 'client', label: 'Cliente', render: (b) => b.client || '—' },
  { key: 'service', label: 'Servicio', muted: true, render: (b) => b.service },
  { key: 'method', label: 'Medio', render: (b) => <MethodChip method={b.paymentMethod} pending={b.paymentPending && b.paidAmount == null} legacy={isLegacy(b)} /> },
  ...(pending ? [] : [{ key: 'ref', label: 'Comprobante', muted: true, render: (b) => b.paymentRef || '—' }]),
  {
    key: 'amount', label: 'Monto', num: true, strong: true,
    render: (b) => (
      <span className="pn-caja-amount-cell">
        {CLP(b.paidAmount ?? b.price)}
        {b.paidAmount == null && !isLegacy(b) && action && (
          <Button variant="secondary" size="sm" icon={action.icon} onClick={(e) => { e.stopPropagation(); action.run(b) }}>{action.label}</Button>
        )}
      </span>
    ),
  },
]

// En "Por cobrar" y "Por confirmar" el chip del medio y la flecha sobran (ya
// está el botón, que es la única acción posible). El botón va DEBAJO del
// nombre, como en la tarjeta "Sin cerrar" de arriba: al costado, con la hora y
// el monto, no le dejaba ancho al cliente. "Cobradas" sí lleva la flecha (no
// tiene botón propio: tocarla corrige el cobro) y el medio de pago sí es dato
// nuevo ahí.
const mobileBookingRow = ({ action } = {}) => (b) => {
  const legacy = isLegacy(b)
  const pending = b.paidAmount == null && !legacy
  const withAction = Boolean(pending && action)
  return {
    lead: <Time value={b.time} />,
    title: b.client || '—',
    subtitle: b.service,
    subtitleWrap: withAction,
    value: CLP(b.paidAmount ?? b.price),
    trailing: pending ? null : <MethodChip method={b.paymentMethod} legacy={legacy} />,
    chevron: !pending,
    className: withAction ? 'pn-caja-row' : undefined,
    children: withAction ? (
      <span className="pn-caja-row-actions" onClick={(e) => e.stopPropagation()}>
        <Button variant="secondary" size="sm" icon={action.icon} onClick={() => action.run(b)}>{action.label}</Button>
      </span>
    ) : undefined,
  }
}

const saleColumns = ({ onVoid } = {}) => [
  { key: 'detail', label: 'Productos', render: (v) => v.detail },
  { key: 'client', label: 'Cliente', muted: true, render: (v) => v.client || 'Venta en mesón' },
  { key: 'method', label: 'Medio', render: (v) => <MethodChip method={v.paymentMethod} /> },
  { key: 'ref', label: 'Comprobante', muted: true, render: (v) => v.paymentRef || '—' },
  {
    key: 'amount', label: 'Monto', num: true, strong: true,
    render: (v) => (
      <span className="pn-caja-amount-cell">
        {CLP(v.total)}
        {onVoid && (
          <Button variant="plain" size="sm" icon="trash" onClick={(e) => { e.stopPropagation(); onVoid(v) }}>Anular</Button>
        )}
      </span>
    ),
  },
]

// Sin ícono de producto acá (a diferencia de Essentials): esta fila ya
// necesita monto + medio + flecha, y el nombre del producto ("1× Aceite para
// barba") es justo lo que no puede quedar recortado.
const mobileSaleRow = (canVoid) => (v) => ({
  title: v.detail,
  subtitle: v.client || 'Venta en mesón',
  value: CLP(v.total),
  trailing: <MethodChip method={v.paymentMethod} />,
  chevron: canVoid,
})

export default function CajaTab({ ctx }) {
  const {
    admin, bookings, canCharge, cashData, cashDay, has, loadCash, onlineOrders,
    openCashRow, pushToast, setCashDay, setTab, voidSale,
  } = ctx || {}

  const [calOpen, setCalOpen] = useState(false)
  const [voidTarget, setVoidTarget] = useState(null)
  const [voidBusy, setVoidBusy] = useState(false)
  const [confirmBusy, setConfirmBusy] = useState(null)
  // Sube cuando se cobra desde el arqueo una fila de un día pasado: esa fila
  // también estaba en la tarjeta "Sin cerrar", que así vuelve a pedir la lista.
  const [unclosedKey, setUnclosedKey] = useState(0)

  const todayKey = santiagoDateKey()
  const day = cashDay || todayKey
  const isToday = day === todayKey
  const canVoid = Boolean(admin && FEATURES.sales && voidSale)
  const reload = () => loadCash?.(day)

  const view = useMemo(() => {
    if (!cashData) return null
    const rows = Array.isArray(cashData.bookings) ? cashData.bookings : []
    const confirmRows = rows.filter((b) => b.paidAmount == null && b.paymentPending)
    const pendingRows = rows.filter((b) => b.paidAmount == null && !b.paymentPending && b.status !== 'completada')
    const paidRows = rows.filter((b) => b.paidAmount != null)
    const legacyRows = rows.filter(isLegacy)

    // Online: lo manda el mismo arqueo (`online` + byMethod.online). Con un
    // servidor que todavía no lo trajera, sale de los pedidos web ya cargados
    // en el panel (?panel=1), por su día en hora de Chile, y se suma acá.
    const serverOnline = Array.isArray(cashData.online)
    const onlineRows = serverOnline
      ? cashData.online
      : (Array.isArray(onlineOrders) ? onlineOrders : []).filter((o) => santiagoDateKey(o.created_at) === day)
    const onlineSum = onlineRows.reduce((n, o) => n + (Number(o.amount) || 0), 0)
    const onlineTotal = serverOnline ? Number(cashData.onlineCollected ?? cashData.byMethod?.online ?? onlineSum) || 0 : onlineSum
    const collected = (Number(cashData.collected) || 0) + (serverOnline ? 0 : onlineTotal)

    const byMethod = { ...(cashData.byMethod || {}), online: onlineTotal }
    const cortesias = paidRows.filter((b) => b.paymentMethod === 'cortesia').length
    const methodTotal = Object.values(byMethod).reduce((s, v) => s + (Number(v) || 0), 0)
    const methods = Object.entries(byMethod)
      .map(([id, amount]) => [id, Number(amount) || 0])
      // El servidor manda todos los medios, también los que quedaron en 0. La
      // cortesía es $0 a propósito: se muestra si hubo alguna ese día.
      .filter(([id, amount]) => amount > 0 || (id === 'cortesia' && cortesias > 0))
      .sort((a, b) => (METHOD_RANK[a[0]] || 0) - (METHOD_RANK[b[0]] || 0) || b[1] - a[1])
      .map(([id, amount]) => ({
        id,
        label: id === 'cortesia' && cortesias ? `${methodLabel(id)} · ${cortesias}` : methodLabel(id),
        amount,
        pct: methodTotal ? Math.round((amount / methodTotal) * 100) : 0,
        color: METHOD_COLOR[id] || 'var(--pn-text-3)',
      }))

    // Las ventas del arqueo traen las líneas pero no el nombre del cliente: se
    // busca por la reserva (la del día o, si la venta fue sobre una atención
    // de otro día, la que ya esté cargada en el panel).
    const bookingById = new Map()
    for (const b of Array.isArray(bookings) ? bookings : []) bookingById.set(String(b.id), b)
    for (const b of rows) bookingById.set(String(b.id), b)
    const saleRows = (Array.isArray(cashData.sales) ? cashData.sales : [])
      .filter((s) => !s.status || s.status === 'pagada')
      .map((s) => {
        const items = Array.isArray(s.items) ? s.items : []
        const booking = s.bookingId != null ? bookingById.get(String(s.bookingId)) : null
        return {
          ...s,
          total: Number(s.total) || 0,
          detail: s.detail || items.map((it) => `${it.qty}× ${it.name}`).join(', ') || 'Producto',
          client: s.client || booking?.client || null,
        }
      })

    const toConfirmTotal = Number(cashData.toConfirm ?? confirmRows.reduce((n, b) => n + Number(b.price || 0), 0)) || 0
    const servicesVal = Number(cashData.servicesCollected ?? cashData.collected) || 0
    return {
      confirmRows, pendingRows, paidRows, legacyRows, onlineRows, onlineTotal, collected, methods, methodTotal,
      hasPendiente: Number(byMethod.pendiente) > 0, saleRows, toConfirmTotal, servicesVal,
      // "Servicios" solo si de verdad hay otra plata ese día (productos u
      // online): si no, repetiría el mismo número que "Cobrado".
      showServices: servicesVal !== collected,
    }
  }, [cashData, onlineOrders, bookings, day])

  // Confirmar el medio de una atención completada sin cobro: la misma hoja de
  // cobro, con el monto precargado (ver confirmAutoPayment en SinCerrar.jsx).
  const confirmRow = async (row) => {
    if (canCharge === false) { pushToast?.('⚠️', 'No tienes permiso para registrar cobros.'); return }
    if (confirmBusy) return
    setConfirmBusy(row.id)
    const r = await confirmAutoPayment(ctx, row)
    setConfirmBusy(null)
    if (r.error) { pushToast?.('⚠️', r.error); return }
    if (r.ok) reload()
  }
  // Cobrar o corregir una fila (openCashRow de Dashboard.jsx ya recarga el
  // arqueo). Si la fila es de un día pasado sin cerrar, también estaba arriba.
  const chargeRow = async (row) => {
    if (!openCashRow) return
    await openCashRow(row)
    if (row.paidAmount == null && row.date && row.date < todayKey) setUnclosedKey((k) => k + 1)
  }
  const confirmAction = canCharge !== false ? { label: 'Confirmar pago', icon: 'check', run: confirmRow } : null
  const chargeAction = openCashRow ? { label: 'Cobrar', icon: 'cash', run: chargeRow } : null

  const confirmVoidSale = async () => {
    if (!voidTarget || !voidSale) return
    setVoidBusy(true)
    // voidSale avisa el resultado y recarga la caja, el stock vendible y las
    // ventas de Finanzas.
    const r = await voidSale(voidTarget, { confirmed: true })
    setVoidBusy(false)
    if (r?.ok) setVoidTarget(null)
  }

  if (has && !has('caja')) return null

  const kpis = view ? [
    view.showServices && <Kpi key="services" label="Servicios" value={view.servicesVal} format={CLP} />,
    <Kpi
      key="products"
      label="Productos"
      value={Number(cashData.productsCollected) || 0}
      format={CLP}
      hint={cashData.productsCount ? `${cashData.productsCount} unidad${cashData.productsCount === 1 ? '' : 'es'}` : undefined}
    />,
    view.onlineTotal > 0 && (
      <Kpi key="online" label="Online (web)" value={view.onlineTotal} format={CLP} hint={`${view.onlineRows.length} pedido${view.onlineRows.length === 1 ? '' : 's'}`} />
    ),
    view.confirmRows.length > 0 && (
      <Kpi key="confirm" label="Por confirmar" value={view.toConfirmTotal} format={CLP} hint={`${view.confirmRows.length} atenci${view.confirmRows.length === 1 ? 'ón' : 'ones'}`} />
    ),
    <Kpi key="pending" label="Por cobrar" value={Number(cashData.pending) || 0} format={CLP} hint={view.pendingRows.length ? `${view.pendingRows.length} reserva${view.pendingRows.length === 1 ? '' : 's'}` : undefined} />,
  ].filter(Boolean) : []

  const heroHint = view ? [
    view.onlineTotal > 0 && view.collected !== view.onlineTotal ? `Incluye ${CLP(view.onlineTotal)} online` : null,
    view.toConfirmTotal > 0 ? `${CLP(view.toConfirmTotal)} por confirmar aparte` : null,
  ].filter(Boolean).join(' · ') : ''

  return (
    <div className="pn-page pn-caja">
      <ModuleHeader
        title="Caja"
        subtitle={isToday ? `Hoy, ${fmtDate(day, 'short')}` : fmtDate(day, 'long')}
      />

      {/* 2 a la vista y no 3: con muchas pendientes, 3 filas empujaban el arqueo del día fuera de la pantalla. */}
      <SinCerrarCard ctx={ctx} preview={2} onChanged={reload} refreshKey={unclosedKey} />

      <Toolbar>
        <PeriodNav
          label={fmtDate(day, 'short')}
          onPrev={() => setCashDay?.(shiftDay(day, -1))}
          onNext={() => setCashDay?.(shiftDay(day, 1))}
          onLabelClick={() => setCalOpen(true)}
          prevLabel="Día anterior"
          nextLabel="Día siguiente"
        />
        {!isToday && (
          <Button variant="plain" size="sm" className="pn-period-today" onClick={() => setCashDay?.(todayKey)}>Hoy</Button>
        )}
      </Toolbar>
      <CalendarSheet open={calOpen} onClose={() => setCalOpen(false)} value={day} onChange={(key) => setCashDay?.(key)} title="Elegir día" />

      {cashData === undefined ? (
        <Card><div className="pn-caja-skel"><Skeleton height={64} /><Skeleton height={120} /><Skeleton height={160} /></div></Card>
      ) : !view ? (
        <InlineAlert tone="error" title="No se pudo cargar la caja de este día" action={{ label: 'Reintentar', onClick: reload }}>
          Revisa la conexión e intenta de nuevo.
        </InlineAlert>
      ) : (
        <>
          <Card className="pn-caja-summary">
            <Kpi hero icon="wallet" label="Cobrado" value={view.collected} format={CLP} hint={heroHint || undefined} />
            <div className={`pn-caja-summary-row is-${kpis.length}`}>{kpis}</div>
          </Card>

          <Card title="Por medio de pago">
            {view.methods.length === 0 ? (
              <EmptyState compact icon="wallet" title="Todavía no se ha cobrado nada este día" />
            ) : (
              <div className="pn-caja-methods">
                <StackedBar parts={view.methods.map((m) => ({ key: m.id, label: m.label, value: m.amount, color: m.color }))} label="Cobrado por medio de pago" />
                <div className="pn-legend pn-caja-methods-legend">
                  {view.methods.map((m) => (
                    <div key={m.id} className="pn-caja-methods-row">
                      <span className="pn-legend-dot" style={{ '--c': m.color }} />
                      <span className="pn-caja-methods-label">{m.label}</span>
                      <span className="pn-caja-methods-pct pn-muted">{m.pct}%</span>
                      <b>{CLP(m.amount)}</b>
                    </div>
                  ))}
                </div>
                <div className="pn-caja-methods-total pn-between">
                  <span className="pn-muted">{view.hasPendiente ? 'Total del día' : 'Total cobrado'}</span>
                  <b>{CLP(view.methodTotal)}</b>
                </div>
              </div>
            )}
          </Card>

          {view.confirmRows.length > 0 && (
            <Card
              title="Por confirmar"
              subtitle={`${view.confirmRows.length} ${view.confirmRows.length === 1 ? 'completada' : 'completadas'} sin medio de pago`}
              flush
              className="pn-caja-confirm"
            >
              <DataTable
                columns={bookingColumns({ action: confirmAction, pending: true })}
                rows={view.confirmRows}
                mobile={mobileBookingRow({ action: confirmAction })}
                onRowClick={confirmAction ? confirmRow : undefined}
                rowDim={(b) => confirmBusy === b.id}
                ariaLabel="Por confirmar"
              />
            </Card>
          )}

          <Card title="Por cobrar" subtitle={view.pendingRows.length ? `${view.pendingRows.length} reserva${view.pendingRows.length === 1 ? '' : 's'}` : undefined} flush>
            <DataTable
              columns={bookingColumns({ action: chargeAction, pending: true })}
              rows={view.pendingRows}
              mobile={mobileBookingRow({ action: chargeAction })}
              onRowClick={chargeAction ? chargeRow : undefined}
              empty={<EmptyState compact icon="checkCircle" title={isToday ? 'Por ahora todo está cobrado' : 'No quedó nada pendiente ese día'} />}
              ariaLabel="Por cobrar"
            />
          </Card>

          <Card
            title="Cobradas"
            subtitle={view.paidRows.length ? `${view.paidRows.length} ${view.paidRows.length === 1 ? 'atención cobrada' : 'atenciones cobradas'}` : undefined}
            flush
          >
            <DataTable
              columns={bookingColumns()}
              rows={view.paidRows}
              mobile={mobileBookingRow()}
              onRowClick={chargeAction ? chargeRow : undefined}
              empty={<EmptyState compact icon="wallet" title={isToday ? 'Todavía no hay cobros este día' : 'No hubo cobros este día'} />}
              ariaLabel="Cobradas"
            />
          </Card>

          {view.legacyRows.length > 0 && (
            <Card
              title="Sin registro de pago"
              subtitle={`${view.legacyRows.length} · completadas antes de anotar el medio; no entran al arqueo`}
              flush
              className="pn-caja-legacy"
            >
              <DataTable
                columns={bookingColumns()}
                rows={view.legacyRows}
                mobile={mobileBookingRow()}
                onRowClick={chargeAction ? chargeRow : undefined}
                ariaLabel="Sin registro de pago"
              />
            </Card>
          )}

          {FEATURES.sales && view.saleRows.length > 0 && (
            <Card title="Ventas de producto" subtitle={`${view.saleRows.length} venta${view.saleRows.length === 1 ? '' : 's'} en el mesón`} flush>
              <DataTable
                columns={saleColumns({ onVoid: canVoid ? setVoidTarget : null })}
                rows={view.saleRows}
                mobile={mobileSaleRow(canVoid)}
                onRowClick={canVoid ? (sale) => setVoidTarget(sale) : undefined}
                ariaLabel="Ventas de producto"
              />
            </Card>
          )}

          {view.onlineRows.length > 0 && (
            <Card
              title="Ventas online"
              subtitle={`${view.onlineRows.length} ${view.onlineRows.length === 1 ? 'pagada' : 'pagadas'} por la web con Mercado Pago`}
              action={setTab && (!has || has('pedidos'))
                ? <Button variant="plain" size="sm" iconRight="chevronRight" onClick={() => setTab('pedidos')}>Ver pedidos</Button>
                : null}
              flush
              className="pn-caja-online"
            >
              <List>
                {view.onlineRows.map((o) => (
                  <ListRow
                    key={`${o.type}-${o.id}`}
                    lead={<Time value={timeOf(o.created_at)} />}
                    title={o.name || 'Cliente web'}
                    subtitle={o.detail || undefined}
                    subtitleWrap
                    value={CLP(o.amount)}
                    trailing={<Chip tone={ONLINE_TYPE[o.type] ? o.type : 'muted'}>{ONLINE_TYPE[o.type] || o.type}</Chip>}
                  />
                ))}
              </List>
            </Card>
          )}
        </>
      )}

      <ConfirmDialog
        open={Boolean(voidTarget)}
        tone="danger"
        icon="trash"
        title="¿Anular esta venta?"
        message={voidTarget ? `Se anula la venta de ${CLP(voidTarget.total)} (${voidTarget.detail}) y el stock vuelve a la bodega.` : ''}
        confirmLabel="Anular venta"
        busy={voidBusy}
        onConfirm={confirmVoidSale}
        onCancel={() => setVoidTarget(null)}
      />
    </div>
  )
}
