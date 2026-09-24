import React, { useState } from 'react'
import { CLP, CLPk, fmtRange, fmtDate, bookingUid, santiagoDateKey } from '../../data.js'
import { FEATURES } from '../../features.js'
import { Icon } from '../../components/ui.jsx'
import { PAYMENT_LABELS } from '../../components/ChargeSheet.jsx'
import {
  ModuleHeader, Toolbar, Segmented, Card, KpiGrid, ProgressBar, DataTable, StatusBadge, Chip, Button,
  List, ListRow, EmptyState, ActionMenu, InlineAlert, Skeleton, useIsPhone,
} from '../../components/panel/index.js'
import { metaFor } from './FinanceMovementSheet.jsx'
import { isoDate } from './shared.jsx'
import '../../styles/panel/finanzas.css'
import '../../styles/panel/online.css'

/* Pestaña «Finanzas» del panel interno, sobre las primitivas del kit
   (src/components/panel/). Recibe en `ctx` el estado y las acciones de
   Dashboard (ver `const dash = {` en Dashboard.jsx, de solo lectura).

   El período (Semana/Mes/Año) es "desde el lunes / el día 1 / el 1 de enero
   hasta hoy": Dashboard lo calcula así (`periodStartKey`) y NO es una
   ventana móvil ni un calendario paginable, así que el control es un
   segmentado simple y el rango exacto va como subtítulo, sin flechas que
   sugieran una navegación que los datos no tienen.

   Cuentas (todas vienen hechas de Dashboard):
     Cobrado      = revenueTotal (servicios cobrados + mesón) + ingresos manuales
     Ventas online = onlineRevenueTotal (Cursos, Workshop y Essentials por la web)
     Gastos       = manualExpenseTotal (gastos DEL PERÍODO, no del mes)
     Margen       = marginTotal = Cobrado + Ventas online − Gastos
   El pie de "Movimientos" suma las filas que se ven (lo cobrado de cada
   atención), no `revenueTotal`, que además trae el mesón. */

const SORT_LABELS = { date: 'Fecha', client: 'Cliente', service: 'Servicio', price: 'Monto' }

const ONLINE_TYPES = [
  { id: 'cursos', label: 'Cursos' },
  { id: 'workshop', label: 'Workshop' },
  { id: 'essentials', label: 'Essentials' },
]

// Montos con signo legible: "−$12.000" y no "$-12.000".
const signedCLP = (n) => (Number(n) < 0 ? `−${CLP(-Number(n))}` : CLP(n))
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

function SortTh({ label, active, dir, onClick }) {
  return (
    <button type="button" className="pn-fin-sortth" onClick={onClick} aria-label={`Ordenar por ${label.toLowerCase()}`}>
      {label}
      {active && <Icon name={dir === 'asc' ? 'chevronUp' : 'chevronDown'} size={12} />}
    </button>
  )
}

/* Barras de "Ingresos por día", con los tokens del panel (se leen igual en
   claro y en oscuro). La última barra, la más reciente, va en dorado. */
function FinBars({ data }) {
  const max = Math.max(1, ...data.map((d) => d.v))
  return (
    <div className="pn-fin-bars" role="img" aria-label={`Ingresos de los últimos ${data.length} días con movimiento`}>
      {data.map((d, i) => (
        <div key={d.key} className={`pn-fin-bar${i === data.length - 1 ? ' is-last' : ''}`} title={`${fmtDate(d.key, 'dm')}: ${CLP(d.v)}`}>
          <span className="pn-fin-bar-val">{d.v ? CLPk(d.v) : '$0'}</span>
          <span className="pn-fin-bar-track"><i style={{ height: `${Math.max(3, (d.v / max) * 100)}%` }} /></span>
          <span className="pn-fin-bar-lbl">{d.d}</span>
        </div>
      ))}
    </div>
  )
}

const MANUAL_PREVIEW = 8

export default function FinanzasTab({ ctx }) {
  const {
    admin,
    avgTicket,
    bookedAhead,
    cancelRate,
    collectedOf,
    completedBookings,
    exportCSV,
    financePeriod,
    financeSort,
    goToPendingInReservas,
    has,
    manualExpenseTotal,
    manualIncomeTotal,
    marginTotal,
    nearRewardClients,
    onlineOrders,
    onlineOrdersError,
    onlineOrdersLoading,
    onlineRevenueTotal,
    onlineSummary,
    periodStartKey,
    productRevenueTotal,
    revenueByService,
    revenuePerHour,
    revenueTotal,
    scopedManualMovements,
    serviceRevenueTotal,
    setDetail,
    setFinanceMovementModal,
    setFinancePeriod,
    setNewBookingOpen,
    setTab,
    sortedFinanceRows,
    stalePending,
    todayKeyNow,
    toggleFinanceSort,
  } = ctx

  const isPhone = useIsPhone()
  const [manualOpen, setManualOpen] = useState(false)

  const today = todayKeyNow || isoDate(new Date())
  const rangeLabel = fmtRange(periodStartKey, today)
  const collected = (b) => (typeof collectedOf === 'function' ? collectedOf(b) : Number(b?.paidAmount ?? b?.price ?? 0))
  const canOpen = (id) => (typeof has === 'function' ? has(id) : true)
  const rows = Array.isArray(sortedFinanceRows) ? sortedFinanceRows : []
  const rowsTotal = rows.reduce((s, b) => s + collected(b), 0)
  const manual = Array.isArray(scopedManualMovements) ? scopedManualMovements : []
  const pending = Array.isArray(stalePending) ? stalePending : []
  const nearReward = Array.isArray(nearRewardClients) ? nearRewardClients : []
  const serviceBase = Number(serviceRevenueTotal ?? revenueTotal) || 0

  /* Ingresos por día: los últimos 7 días CON cobro, en orden. Se arma acá
     desde las mismas atenciones de la tabla (completedBookings): la lista
     del servidor viene de la más nueva a la más vieja, y cortarla antes de
     ordenar dejaba fuera justo los días recientes. */
  const byDay = new Map()
  for (const b of completedBookings || []) {
    if (!b?.date) continue
    byDay.set(b.date, (byDay.get(b.date) || 0) + collected(b))
  }
  const dailyRevenue = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-7)
    // "13/9": en el celular caben siete rótulos sin cortarse ("13 sep" no).
    .map(([key, v]) => ({ key, d: `${Number(key.slice(8, 10))}/${Number(key.slice(5, 7))}`, v }))

  /* Ventas online del período por origen. Del resumen del servidor
     (?panel=1&summary=1) cuando es del período que se está viendo; si no,
     de la lista de pedidos filtrada por el día de Santiago — el mismo
     criterio con que Dashboard arma `onlineRevenueTotal`. */
  const online = (() => {
    const byType = Object.fromEntries(ONLINE_TYPES.map((t) => [t.id, { total: 0, count: 0 }]))
    const fromServer = Boolean(onlineSummary && onlineSummary.from === periodStartKey && onlineSummary.byType)
    if (fromServer) {
      for (const t of ONLINE_TYPES) {
        const b = onlineSummary.byType[t.id]
        if (b) byType[t.id] = { total: Number(b.total) || 0, count: Number(b.count) || 0 }
      }
    } else {
      for (const o of Array.isArray(onlineOrders) ? onlineOrders : []) {
        const k = santiagoDateKey(o?.created_at)
        if (!k || k < periodStartKey || k > today || !byType[o.type]) continue
        byType[o.type].total += Number(o.amount) || 0
        byType[o.type].count += 1
      }
    }
    const count = ONLINE_TYPES.reduce((s, t) => s + byType[t.id].count, 0)
    return { byType, count, fromServer }
  })()
  const onlineTotal = Number(onlineRevenueTotal) || 0
  const onlineLoading = Boolean(onlineOrdersLoading) && !online.fromServer && !(onlineOrders || []).length
  const onlineFailed = Boolean(onlineOrdersError) && !online.fromServer

  const kpis = [
    {
      id: 'cobrado', label: 'Cobrado', value: (Number(revenueTotal) || 0) + (admin ? Number(manualIncomeTotal) || 0 : 0), format: CLP, icon: 'wallet',
      title: admin ? 'Servicios cobrados, ventas en el mesón e ingresos manuales del período' : 'Servicios cobrados y ventas en el mesón del período',
    },
    admin && {
      id: 'online', label: 'Ventas online', value: onlineTotal, format: CLP, icon: 'box',
      title: 'Cursos, Workshop y Essentials pagados por la web con Mercado Pago',
      onClick: canOpen('pedidos') ? () => setTab('pedidos') : undefined,
    },
    admin && {
      // En el celular, a dos columnas, los rótulos largos se cortan: ahí van
      // cortos (el período ya está en el subtítulo).
      id: 'gastos', label: isPhone ? 'Gastos' : 'Gastos del período', title: 'Gastos anotados en el período', value: Number(manualExpenseTotal) || 0, format: CLP, icon: 'receipt',
      onClick: canOpen('gastos') ? () => setTab('gastos') : undefined,
    },
    admin && {
      id: 'margen', label: 'Margen', value: Number(marginTotal) || 0, format: signedCLP, icon: 'trend',
      title: 'Cobrado + ventas online − gastos del período',
    },
    FEATURES.unclosed && { id: 'agendado', label: isPhone ? 'Agendado' : 'Agendado a futuro', value: Number(bookedAhead) || 0, format: CLP, icon: 'calendar', title: 'Reservas de hoy en adelante que todavía no se cobran' },
    { id: 'ticket', label: 'Ticket promedio', value: Number(avgTicket) || 0, format: CLP, icon: 'cash' },
    { id: 'servicios', label: 'Servicios', value: (completedBookings || []).length, icon: 'scissors' },
    FEATURES.sales && { id: 'productos', label: isPhone ? 'Productos' : 'Productos en el mesón', title: 'Productos vendidos en el mesón en el período', value: Number(productRevenueTotal) || 0, format: CLP, icon: 'cart' },
    revenuePerHour != null && { id: 'porhora', label: 'Ingreso por hora', value: revenuePerHour, format: CLP, icon: 'clock' },
    cancelRate != null && { id: 'cancel', label: 'Cancelación', value: cancelRate, suffix: '%', icon: 'close' },
  ]

  const methodOf = (b) => (b.paymentMethod ? PAYMENT_LABELS[b.paymentMethod] || b.paymentMethod : '')
  const pendingChip = <Chip tone="warn" dot>Por confirmar</Chip>

  const financeColumns = [
    {
      key: 'date',
      nowrap: true,
      label: <SortTh label="Fecha" active={financeSort.key === 'date'} dir={financeSort.dir} onClick={() => toggleFinanceSort('date')} />,
      render: (b) => <>{fmtDate(b.date, 'dm')} <small>{b.time}</small></>,
    },
    {
      key: 'client',
      label: <SortTh label="Cliente" active={financeSort.key === 'client'} dir={financeSort.dir} onClick={() => toggleFinanceSort('client')} />,
    },
    {
      key: 'service',
      label: <SortTh label="Servicio" active={financeSort.key === 'service'} dir={financeSort.dir} onClick={() => toggleFinanceSort('service')} />,
    },
    FEATURES.charge && {
      key: 'method',
      label: 'Medio',
      muted: true,
      render: (b) => (b.paymentPending ? pendingChip : methodOf(b) || '—'),
    },
    // Con "Sin cerrar" solo las completadas cuentan como ingreso: la columna
    // de estado diría "Completada" en todas las filas.
    !FEATURES.unclosed && { key: 'status', label: 'Estado', render: (b) => <StatusBadge status={b.status} /> },
    {
      key: 'price',
      label: <SortTh label="Cobrado" active={financeSort.key === 'price'} dir={financeSort.dir} onClick={() => toggleFinanceSort('price')} />,
      num: true, strong: true, render: (b) => CLP(collected(b)),
    },
  ].filter(Boolean)

  const sortMenu = Object.entries(SORT_LABELS).map(([k, label]) => ({
    label: financeSort.key === k ? `${label} (${financeSort.dir === 'asc' ? 'A-Z / menor primero' : 'Z-A / mayor primero'})` : label,
    icon: financeSort.key === k ? 'check' : undefined,
    onClick: () => toggleFinanceSort(k),
  }))

  const financeFooter = rows.length
    ? financeColumns.map((c) => (c.key === 'price' ? CLP(rowsTotal) : c.key === 'date' ? 'Total' : ''))
    : undefined

  const manualSorted = [...manual].sort((a, b) => (b.date || '').localeCompare(a.date || '') || Number(b.id || 0) - Number(a.id || 0))
  const manualShown = manualOpen ? manualSorted : manualSorted.slice(0, MANUAL_PREVIEW)

  return (
    <div className="pn-page">
      <ModuleHeader
        title="Finanzas"
        subtitle={rangeLabel}
        primary={admin ? { label: 'Movimiento', icon: 'plus', onClick: () => setFinanceMovementModal({ kind: 'gasto' }) } : undefined}
        actions={[{ label: 'Exportar CSV', icon: 'download', onClick: () => exportCSV('Finanzas'), disabled: !rows.length }]}
      />

      <Toolbar>
        <Segmented
          ariaLabel="Período"
          value={financePeriod}
          onChange={setFinancePeriod}
          options={[{ value: 'semana', label: 'Semana' }, { value: 'mes', label: 'Mes' }, { value: 'año', label: 'Año' }]}
        />
      </Toolbar>

      <KpiGrid items={kpis} visible={4} cols={4} storageKey="finanzas" />

      {(pending.length > 0 || nearReward.length > 0) && (
        <div className="pn-fin-flags">
          {pending.length > 0 && (
            <button type="button" className="pn-fin-flag is-warn" onClick={() => goToPendingInReservas?.()}>
              <b>{pending.length}</b>
              <span>{pending.length === 1 ? 'reserva lleva' : 'reservas llevan'} más de 24 h sin confirmar</span>
              <Icon name="chevronRight" size={16} />
            </button>
          )}
          {nearReward.length > 0 && (
            <div className="pn-fin-flag">
              <b>{nearReward.length}</b>
              <span>{nearReward.length === 1 ? 'cliente está' : 'clientes están'} a un corte de un beneficio</span>
            </div>
          )}
        </div>
      )}

      <div className="pn-cols pn-cols--2">
        <Card title="Ingresos por día" subtitle={dailyRevenue.length ? 'Los últimos días con cobros' : undefined}>
          {dailyRevenue.length
            ? <FinBars data={dailyRevenue} />
            : <EmptyState compact icon="chart" title="Sin cobros en este período" />}
        </Card>
        <Card title="Ingresos por servicio">
          {!(revenueByService || []).length ? (
            <EmptyState compact icon="scissors" title="Sin servicios cobrados en este período" />
          ) : (
            <div className="pn-stack">
              {revenueByService.slice(0, 5).map((item) => {
                const p = Math.round((item.total / Math.max(1, serviceBase)) * 100)
                return (
                  <div key={item.name} className="pn-fin-svcrow">
                    <div className="pn-fin-svcrow-head"><span>{item.name}</span><b>{CLP(item.total)} · {p}%</b></div>
                    <ProgressBar value={p} max={100} color="var(--pn-accent)" label={`${item.name}: ${p}%`} />
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      {admin && (
        <Card
          title="Ventas online"
          subtitle={online.count ? `${plural(online.count, 'pago', 'pagos')} por la web en el período` : 'Cursos, Workshop y Essentials pagados por la web'}
          action={canOpen('pedidos') ? (
            <Button variant="plain" size="sm" iconRight="chevronRight" onClick={() => setTab('pedidos')}>Ver pedidos</Button>
          ) : null}
        >
          {onlineFailed && <InlineAlert tone="warn">{onlineOrdersError}</InlineAlert>}
          {onlineLoading ? (
            <div className="pn-fin-grid is-3" aria-busy="true" aria-label="Cargando ventas online">
              {ONLINE_TYPES.map((t) => <Skeleton key={t.id} height={84} radius={12} />)}
            </div>
          ) : !onlineFailed && (
            <div className="pn-fin-grid is-3">
              {ONLINE_TYPES.map((t) => {
                const b = online.byType[t.id]
                return (
                  <div key={t.id} className={`pn-fin-bcard${b.count ? '' : ' is-empty'}`}>
                    <span className="pn-fin-bcard-name"><Chip tone={t.id}>{t.label}</Chip></span>
                    <span className="pn-fin-bcard-val">{CLP(b.total)}</span>
                    <span className="pn-fin-bcard-meta">{b.count ? plural(b.count, 'pago', 'pagos') : 'Sin pagos en el período'}</span>
                    <ProgressBar value={b.total} max={Math.max(1, onlineTotal)} color="var(--pn-accent)" label={`${t.label}: ${CLP(b.total)}`} />
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      )}

      {/* Los gastos e ingresos que se anotan a mano (no son reservas): los
          suma el margen de arriba. Tocar uno lo edita. Solo admin, como la
          API de gastos. */}
      {admin && FEATURES.manualIncome && (
        <Card
          title="Movimientos manuales"
          subtitle={`+${CLP(manualIncomeTotal)} ingresos · −${CLP(manualExpenseTotal)} gastos`}
          flush
        >
          {!manualSorted.length ? (
            <EmptyState
              compact
              icon="wallet"
              title="Sin gastos ni ingresos anotados en este período"
              action={{ label: 'Registrar movimiento', icon: 'plus', onClick: () => setFinanceMovementModal({ kind: 'gasto' }) }}
            />
          ) : (
            <>
              <List>
                {manualShown.map((m) => {
                  const isIn = m.kind === 'ingreso'
                  const meta = metaFor(isIn ? 'ingreso' : 'gasto', m.category)
                  return (
                    <ListRow
                      key={m.id}
                      lead={<span className="pn-fin-cat-ic" style={{ '--c': meta.color }}><Icon name={meta.icon} size={16} /></span>}
                      title={m.detail || m.category}
                      titleWrap
                      subtitle={`${fmtDate(m.date, 'dm')} · ${m.category || 'Otros'}`}
                      value={<span className={`pn-fin-amt${isIn ? ' is-in' : ''}`}>{isIn ? '+' : '−'}{CLP(m.amount)}</span>}
                      chevron
                      ariaLabel={`Editar ${isIn ? 'ingreso' : 'gasto'}: ${m.detail || m.category}`}
                      onClick={() => setFinanceMovementModal({ kind: isIn ? 'ingreso' : 'gasto', initial: m })}
                    />
                  )
                })}
              </List>
              {manualSorted.length > MANUAL_PREVIEW && (
                <div className="pn-fin-more">
                  <Button variant="plain" size="sm" iconRight={manualOpen ? 'chevronUp' : 'chevronDown'} onClick={() => setManualOpen((v) => !v)}>
                    {manualOpen ? 'Ver menos' : `Ver los ${manualSorted.length}`}
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      )}

      <Card
        title="Movimientos"
        subtitle={`${plural(rows.length, 'atención cobrada', 'atenciones cobradas')} en el período`}
        action={rows.length > 1 ? <ActionMenu items={sortMenu} label="Ordenar" icon="filter" small /> : null}
        flush
      >
        <DataTable
          columns={financeColumns}
          rows={rows}
          rowKey={bookingUid}
          footer={financeFooter}
          onRowClick={typeof setDetail === 'function' ? (b) => setDetail(b) : undefined}
          ariaLabel="Atenciones cobradas en el período"
          empty={(
            <EmptyState
              compact
              icon="wallet"
              title="Sin movimientos en este período"
              action={{ label: 'Nueva reserva', icon: 'calendar', onClick: () => setNewBookingOpen(true) }}
            />
          )}
          mobile={(b) => ({
            title: b.client,
            subtitle: [b.service, FEATURES.charge && !b.paymentPending ? methodOf(b) : ''].filter(Boolean).join(' · '),
            meta: `${fmtDate(b.date, 'dm')} · ${b.time}`,
            value: CLP(collected(b)),
            trailing: b.paymentPending ? pendingChip : (!FEATURES.unclosed ? <StatusBadge status={b.status} /> : null),
          })}
        />
        {isPhone && rows.length > 0 && (
          <div className="pn-fin-foot">
            <span>Total del período</span>
            <b>{CLP(rowsTotal)}</b>
          </div>
        )}
      </Card>
    </div>
  )
}
