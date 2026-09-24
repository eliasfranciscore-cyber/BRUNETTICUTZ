import React, { useMemo, useState } from 'react'
import { CLP, fmtDate, santiagoDateKey } from '../../data.js'
import { waHref } from '../../whatsapp.js'
import {
  ModuleHeader, KpiGrid, FilterChips, SearchField, Card, DataTable, Avatar, Chip, Button,
  List, ListRow, EmptyState, SkeletonRows, InlineAlert, Sheet, useIsPhone,
} from '../../components/panel/index.js'
import '../../styles/panel/online.css'

/* ============================================================
   PEDIDOS — pagos web confirmados por Mercado Pago (Cursos, Workshop y
   Essentials). Solo BrunettiCutz, solo admin.
   Lee `ctx.onlineOrders`, la misma lista que Dashboard pide a
   /api/mp-payments?panel=1 al entrar y en cada Actualizar (y que usan el
   KPI "Ventas online" de Finanzas y Resumen y la línea online de Caja): acá
   no hay un segundo fetch. A diferencia de Inscripciones, que también trae
   la lista de espera y las consultas sin pago, acá solo hay plata que entró.
   ============================================================ */

/* Origen de cada fila: el color es el de cada módulo en el sitio público
   (tokens --pn-online-* de styles/panel/online.css, con su versión clara). */
export const ORIGIN = {
  cursos: { label: 'Cursos', color: 'var(--pn-online-cursos)' },
  workshop: { label: 'Workshop', color: 'var(--pn-online-workshop)' },
  essentials: { label: 'Essentials', color: 'var(--pn-online-essentials)' },
}
const ORIGIN_KEYS = Object.keys(ORIGIN)

export function OriginChip({ type }) {
  const meta = ORIGIN[type]
  if (!meta) return <Chip tone="muted">{type || '—'}</Chip>
  return <Chip tone={type}>{meta.label}</Chip>
}

/* Nombre con teléfono y correo, con el avatar de iniciales en dorado. La usan
   Pedidos e Inscripciones en la tabla de escritorio. */
export function PersonCell({ name, phone, email }) {
  const contact = [phone ? `+56 ${phone}` : null, email || null].filter(Boolean).join(' · ')
  return (
    <div className="pn-online-who">
      <Avatar name={name} size={32} accent />
      <div className="pn-online-who-text">
        <strong>{name || 'Sin nombre'}</strong>
        {contact && <span>{contact}</span>}
      </div>
    </div>
  )
}

/* `created_at` es un instante (timestamptz), no un día: se lleva al día de
   Santiago antes de formatear, o un pago de las 22:00 de Chile saldría con
   la fecha de mañana (en UTC ya es otro día). El año solo si no es este. */
export function fmtStamp(value) {
  const key = santiagoDateKey(value)
  if (!key) return '—'
  return fmtDate(key, key.slice(0, 4) === santiagoDateKey().slice(0, 4) ? 'dm' : 'dmy')
}

const TIME_CL = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false })
function fmtTime(value) {
  const d = value ? new Date(value) : null
  return d && !Number.isNaN(d.getTime()) ? TIME_CL.format(d) : ''
}

// Qué se pagó: Essentials trae los productos ("2× Cera mate…"); el Workshop,
// su edición; un Curso no trae detalle.
export function orderDetail(o) {
  if (o?.type === 'workshop') return o.detail ? `Edición ${o.detail}` : 'Cupo en el Workshop'
  if (o?.type === 'cursos') return o.detail || 'Inscripción al curso'
  return o?.detail || '—'
}

const amountOf = (o) => Number(o?.amount || 0)
const stampMs = (value) => { const t = new Date(value || 0).getTime(); return Number.isNaN(t) ? 0 : t }
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

const waOrderMessage = (o) => {
  const first = String(o?.name || '').trim().split(' ')[0] || 'Hola'
  const what = o?.type === 'essentials' ? 'tu pedido de Essentials'
    : o?.type === 'workshop' ? 'tu cupo en el Workshop'
      : 'tu inscripción al curso'
  return `Hola ${first}, te escribimos de Brunetti por ${what} 💈`
}

/* Detalle de un pedido: lo que la fila no alcanza a mostrar en el celular
   (teléfono, correo, hora del pago) y los dos atajos para escribirle. */
function OrderSheet({ order, onClose }) {
  const [last, setLast] = useState(order)
  if (order && order !== last) setLast(order)
  const o = order || last
  if (!o) return null
  const wa = waHref(o.phone, waOrderMessage(o))
  const time = fmtTime(o.created_at)
  return (
    <Sheet
      open={Boolean(order)}
      onClose={onClose}
      size="sm"
      lead={<Avatar name={o.name} size={44} accent />}
      title={o.name || 'Pedido'}
      subtitle={`${ORIGIN[o.type]?.label || o.type} · ${fmtStamp(o.created_at)}${time ? ` · ${time}` : ''}`}
      footer={(
        <>
          <Button variant="secondary" icon="mail" disabled={!o.email} onClick={() => { if (o.email) window.location.href = `mailto:${o.email}` }}>Correo</Button>
          <Button variant="primary" icon="whatsapp" disabled={!wa} onClick={() => wa && window.open(wa, '_blank', 'noopener,noreferrer')}>WhatsApp</Button>
        </>
      )}
    >
      <List className="pn-online-sheet-list">
        <ListRow title="Monto" value={CLP(amountOf(o))} />
        <ListRow title="Origen" trailing={<OriginChip type={o.type} />} />
        <ListRow title="Detalle" subtitle={orderDetail(o)} subtitleWrap />
        <ListRow title="Teléfono" subtitle={o.phone ? `+56 ${o.phone}` : 'Sin teléfono'} />
        <ListRow title="Correo" subtitle={o.email || 'Sin correo'} subtitleWrap />
      </List>
    </Sheet>
  )
}

/* Pestaña «pedidos» del panel interno. Recibe en `ctx` el estado y las
   acciones de Dashboard (ver el objeto `dash` de Dashboard.jsx). */
export default function PedidosTab({ ctx }) {
  const {
    admin,
    onlineOrders,
    onlineOrdersLoading,
    onlineOrdersError,
    loadOnlineOrders,
    onlineMonthTotal,
    monthKeyNow,
  } = ctx
  const isPhone = useIsPhone()
  const [filter, setFilter] = useState('todos') // todos | cursos | workshop | essentials
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)

  // Más nuevo primero: el servidor junta dos tablas (inscripciones y
  // shop_orders) y ya las ordena, pero no cuesta asegurarlo acá.
  const rows = useMemo(
    () => (Array.isArray(onlineOrders) ? onlineOrders : [])
      .slice()
      .sort((a, b) => stampMs(b.created_at) - stampMs(a.created_at)),
    [onlineOrders],
  )

  const byType = useMemo(() => {
    const out = Object.fromEntries(ORIGIN_KEYS.map((k) => [k, { count: 0, total: 0 }]))
    for (const o of rows) {
      if (!out[o.type]) continue
      out[o.type].count += 1
      out[o.type].total += amountOf(o)
    }
    return out
  }, [rows])

  const total = rows.reduce((n, o) => n + amountOf(o), 0)
  // "Este mes" es la misma cifra que el KPI "Ventas online del mes" de
  // Finanzas y Resumen (resumen del servidor cuando lo hay); la cuenta sale
  // de la lista, con el día de Santiago.
  const monthKey = monthKeyNow || santiagoDateKey().slice(0, 7)
  const monthRows = rows.filter((o) => santiagoDateKey(o.created_at).startsWith(monthKey))
  const monthTotal = Number.isFinite(Number(onlineMonthTotal)) && onlineMonthTotal != null
    ? Number(onlineMonthTotal)
    : monthRows.reduce((n, o) => n + amountOf(o), 0)

  const q = query.trim().toLowerCase()
  const filtered = rows.filter((o) => {
    if (filter !== 'todos' && o.type !== filter) return false
    if (!q) return true
    return o.name?.toLowerCase().includes(q)
      || String(o.phone || '').includes(q)
      || o.email?.toLowerCase().includes(q)
      || String(o.detail || '').toLowerCase().includes(q)
  })
  // El pie suma lo que se está viendo (filtro + búsqueda), no el total.
  const filteredTotal = filtered.reduce((n, o) => n + amountOf(o), 0)
  const filtering = filter !== 'todos' || Boolean(q)
  const clearFilters = () => { setFilter('todos'); setQuery('') }

  if (!admin) {
    return (
      <div className="pn-page">
        <ModuleHeader title="Pedidos" subtitle="Pagos confirmados por Mercado Pago" />
        <Card>
          <EmptyState icon="lock" title="Solo para administración" text="Los pedidos web los ve el administrador de Brunetti." />
        </Card>
      </div>
    )
  }

  // Primera carga: cifras en "—", no en $0.
  const firstLoad = onlineOrdersLoading && !rows.length
  const kpis = [
    { id: 'total', label: 'Total recaudado', icon: 'wallet', value: firstLoad ? null : total, format: CLP, hint: firstLoad ? undefined : plural(rows.length, 'pedido', 'pedidos') },
    { id: 'mes', label: 'Este mes', icon: 'calendar', value: firstLoad ? null : monthTotal, format: CLP, hint: firstLoad ? undefined : plural(monthRows.length, 'pedido', 'pedidos') },
    ...ORIGIN_KEYS.map((k) => ({ id: k, label: ORIGIN[k].label, color: ORIGIN[k].color, value: firstLoad ? null : byType[k].count, hint: firstLoad ? undefined : CLP(byType[k].total) })),
  ]

  const columns = [
    { key: 'who', label: 'Cliente', render: (o) => <PersonCell name={o.name} phone={o.phone} email={o.email} /> },
    { key: 'detail', label: 'Detalle', className: 'pn-online-detail', render: (o) => orderDetail(o) },
    { key: 'origin', label: 'Origen', render: (o) => <OriginChip type={o.type} /> },
    { key: 'amount', label: 'Monto', num: true, strong: true, render: (o) => CLP(amountOf(o)) },
    { key: 'date', label: 'Fecha', muted: true, nowrap: true, render: (o) => fmtStamp(o.created_at) },
  ]
  const countLabel = plural(filtered.length, 'pedido', 'pedidos')
  const footer = filtered.length
    ? columns.map((c) => (c.key === 'who' ? `Total · ${countLabel}` : c.key === 'amount' ? CLP(filteredTotal) : ''))
    : undefined

  return (
    <div className="pn-page">
      <ModuleHeader title="Pedidos" subtitle="Pagos confirmados por Mercado Pago" />

      {onlineOrdersError && (
        <InlineAlert
          tone="error"
          title="No se pudieron cargar los pedidos"
          action={loadOnlineOrders ? { label: onlineOrdersLoading ? 'Cargando…' : 'Reintentar', onClick: () => loadOnlineOrders() } : undefined}
        >
          {rows.length ? `${onlineOrdersError} Lo que ves es la última lista que llegó.` : onlineOrdersError}
        </InlineAlert>
      )}

      <KpiGrid items={kpis} className="pn-online-kpis" />

      <div className="pn-stack">
        <SearchField value={query} onChange={setQuery} placeholder="Nombre, teléfono o producto" ariaLabel="Buscar pedidos" />
        <FilterChips
          ariaLabel="Filtrar por origen"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'todos', label: 'Todos', count: rows.length },
            ...ORIGIN_KEYS.map((k) => ({ value: k, label: ORIGIN[k].label, count: byType[k].count })),
          ]}
        />
      </div>

      <Card flush>
        {firstLoad ? <SkeletonRows rows={4} /> : (
          <>
            <DataTable
              ariaLabel="Pedidos"
              columns={columns}
              rows={filtered}
              rowKey={(o) => `${o.type}-${o.id}`}
              onRowClick={(o) => setSelected(o)}
              footer={footer}
              mobile={(o) => ({
                title: o.name || 'Sin nombre',
                subtitle: orderDetail(o),
                value: CLP(amountOf(o)),
                meta: fmtStamp(o.created_at),
                children: <span className="pn-row-chips"><OriginChip type={o.type} /></span>,
                chevron: true,
              })}
              empty={filtering ? (
                <EmptyState
                  compact
                  icon="search"
                  title="No hay pedidos que coincidan"
                  text="Prueba con otro nombre o cambia el filtro."
                  action={{ label: 'Ver todos', icon: 'close', onClick: clearFilters }}
                />
              ) : (
                <EmptyState
                  icon="box"
                  title="Todavía no hay pedidos"
                  text="Cuando alguien pague un Curso, el Workshop o productos de Essentials en brunetticutz.cl, el pago aparece acá apenas Mercado Pago lo confirma."
                />
              )}
            />
            {isPhone && filtered.length > 0 && (
              <div className="pn-online-foot" role="status">
                <span>Total · {countLabel}</span>
                <strong>{CLP(filteredTotal)}</strong>
              </div>
            )}
          </>
        )}
      </Card>

      <OrderSheet order={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
