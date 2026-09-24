import React, { useEffect, useState } from 'react'
import { Icon } from '../../components/ui.jsx'
import { CLP, fmtDate, santiagoDateKey } from '../../data.js'
import ClientModal from '../../components/ClientModal.jsx'
import {
  ModuleHeader, Card, DataTable, Avatar, FilterChips, SearchField, Note, EmptyState, Chip, Button,
  ActionMenu, useIsPhone,
} from '../../components/panel/index.js'
import '../../styles/panel/clientes.css'

const cx = (...p) => p.filter(Boolean).join(' ')

/* Cuántas filas se dibujan de una vez. La lista trae hasta 1.500 clientes y
   dibujarlos todos juntos se nota en el iPhone; el resto queda a un toque
   ("Ver más"). Buscar y filtrar siguen siendo sobre la lista completa. */
const PAGE = 120

/* Los criterios de orden de siempre (clientSort en Dashboard.jsx): mismo
   criterio dos veces invierte el orden, uno distinto parte en su orden por
   defecto (nombre A–Z; lo demás de mayor a menor). */
const SORTS = [
  { key: 'name', label: 'Nombre', icon: 'user', asc: 'A–Z', desc: 'Z–A' },
  { key: 'visits', label: 'Visitas', icon: 'scissors', asc: 'de menos a más', desc: 'de más a menos' },
  { key: 'totalSpent', label: 'Total', icon: 'wallet', asc: 'de menor a mayor', desc: 'de mayor a menor' },
  { key: 'lastVisit', label: 'Última visita', icon: 'clock', asc: 'la más antigua primero', desc: 'la más reciente primero' },
]

/* Pestaña «clientes» del panel interno. Recibe en `ctx` el estado y las
   acciones de Dashboard que usa (ver el objeto `dash` que arma Dashboard.jsx).
   Incluye la ficha del cliente (ClientModal). */
export default function ClientesTab({ ctx }) {
  const {
    activeClients,
    clientEditing,
    clientFilter,
    clientHistory,
    clientKey,
    clientQuery,
    clientSort,
    clients,
    deleteClient,
    inactiveClients,
    openClient,
    saveClient,
    scheduleForClient,
    clientStatsOf: statsOfCtx,
    selectedClient,
    sendWalletCard,
    setClientFilter,
    setClientQuery,
    setNewClientOpen,
    setSelectedClient,
    sortedClients,
    toggleClientSort,
    topClients,
    walletSendingId,
  } = ctx
  const isPhone = useIsPhone()
  const [limit, setLimit] = useState(PAGE)
  // Una búsqueda, un filtro o un orden nuevo vuelven a partir desde arriba.
  useEffect(() => { setLimit(PAGE) }, [clientQuery, clientFilter, clientSort?.key, clientSort?.dir])

  // Las cifras de cada fila salen de la misma función con que Dashboard
  // filtra y ordena (clientStatsOf): lo que se ve y lo que cuentan los chips
  // no se contradicen.
  const statsOf = statsOfCtx || ((c) => ({ visits: Number(c?.visits || 0), totalSpent: Number(c?.totalSpent || 0), lastVisit: c?.lastVisit || null }))
  const keyOf = (c) => (clientKey ? clientKey(c) : (c.id ?? c.phone))

  /* Qué decir de alguien sin visitas. Con "0 visitas · $0 · sin visitas" la
     fila parecía un error de datos: son personas que reservaron por primera
     vez (la hora todavía no llega), se registraron o sacaron la tarjeta sin
     haber venido nunca. */
  const today = santiagoDateKey()
  const noVisitsLabel = (c) => {
    if (c.nextVisit) return `Sin visitas · tiene hora ${String(c.nextVisit).slice(0, 10) === today ? 'hoy' : `el ${fmtDate(c.nextVisit, 'dm')}`}`
    if (c.walletHasPass) return 'Sin visitas · tiene la tarjeta Wallet'
    if (c.createdAt) return `Sin visitas · se registró el ${fmtDate(c.createdAt, 'dm')}`
    return 'Sin visitas todavía'
  }
  const lastLabel = (c) => {
    const st = statsOf(c)
    if (st.lastVisit) return fmtDate(st.lastVisit, 'dm')
    return st.visits ? '—' : noVisitsLabel(c)
  }

  const total = (clients || sortedClients || []).length
  const filtering = Boolean(String(clientQuery || '').trim()) || clientFilter !== 'all'
  const filterValue = clientFilter === 'all' ? null : clientFilter
  const handleFilterChange = (v) => setClientFilter((f) => (f === v ? 'all' : v))
  const list = sortedClients || []
  const rows = list.slice(0, limit)
  const rest = list.length - rows.length

  /* "Tarjeta": el link personal de la tarjeta de fidelidad por WhatsApp. Solo
     a quien todavía no la tiene agregada: a los demás no hay nada que
     ofrecerles. `stop` evita que el toque (o el Enter) abra además la ficha. */
  const stop = (e) => e.stopPropagation()
  const cardButton = (c, { compact = false } = {}) => {
    if (c.walletHasPass || !sendWalletCard) return null
    const sending = walletSendingId != null && walletSendingId === keyOf(c)
    return (
      <Button
        size="sm"
        variant="secondary"
        icon="wallet"
        loading={sending}
        className={cx('pn-clientes-card-btn', compact && 'is-compact')}
        title="Enviar la tarjeta de fidelidad por WhatsApp"
        aria-label={`Enviar la tarjeta de fidelidad a ${c.name || 'este cliente'} por WhatsApp`}
        onClick={(e) => { e.stopPropagation(); sendWalletCard(c) }}
      >
        Tarjeta
      </Button>
    )
  }

  const loyaltyChips = (c) => {
    const l = c.loyalty
    if (!l) return null
    if (l.freeCutReady) return <Chip tone="ok" icon="gift">Corte gratis</Chip>
    if (!Number(l.stars)) return null
    return <Chip tone="accent" icon="star" title={`${l.stars} de ${l.goal} estrellas`}>{l.stars}/{l.goal}</Chip>
  }

  // Encabezados que ordenan (escritorio). En el celular, el mismo orden va en
  // el menú "Ordenar" junto al botón de nuevo cliente.
  const sortHead = (key, label) => {
    const on = clientSort?.key === key
    const meta = SORTS.find((s) => s.key === key)
    return (
      <button
        type="button"
        className={cx('pn-clientes-sort', on && 'is-on')}
        onClick={() => toggleClientSort?.(key)}
        title={on ? `Ordenado ${meta?.[clientSort.dir] || ''} · toca para invertir` : `Ordenar por ${label.toLowerCase()}`}
      >
        <span>{label}</span>
        <Icon name={on && clientSort.dir === 'asc' ? 'chevronUp' : 'chevronDown'} size={12} />
      </button>
    )
  }
  const sortItems = SORTS.map((s) => {
    const on = clientSort?.key === s.key
    return {
      label: `Ordenar por ${s.label.toLowerCase()}`,
      icon: on ? 'check' : s.icon,
      hint: on ? `${s[clientSort.dir]} · toca para invertir` : undefined,
      onClick: () => toggleClientSort?.(s.key),
    }
  })

  return (
    <div className="pn-page">
      <ModuleHeader
        title="Clientes"
        subtitle={`${total} ${total === 1 ? 'cliente' : 'clientes'}`}
        secondary={isPhone && toggleClientSort ? (
          <ActionMenu items={sortItems} label="Ordenar" title="Ordenar clientes" icon="filter" />
        ) : null}
        primary={{ label: 'Cliente', icon: 'plus', onClick: () => setNewClientOpen(true) }}
      />

      <div className="pn-stack">
        <SearchField
          value={clientQuery}
          onChange={setClientQuery}
          placeholder="Nombre, teléfono o correo"
          ariaLabel="Buscar clientes"
        />
        <FilterChips
          ariaLabel="Filtrar clientes"
          value={filterValue}
          onChange={handleFilterChange}
          options={[
            { value: 'active', label: 'Activos', icon: 'user', count: activeClients.length },
            { value: 'inactive', label: 'Inactivos 30+', icon: 'clock', count: inactiveClients.length },
            { value: 'top', label: 'Más activos', icon: 'star', count: topClients.length },
          ]}
        />
        <Note>Teléfono como identificador: dos clientes con el mismo número son la misma persona.</Note>
      </div>

      <Card flush>
        <DataTable
          ariaLabel="Clientes"
          columns={[
            {
              key: 'client',
              label: sortHead('name', 'Cliente'),
              render: (c) => (
                <div className="pn-clientes-cell">
                  <Avatar name={c.name} size={32} />
                  <div className="pn-clientes-cell-text">
                    <strong>{c.name || 'Sin nombre'}</strong>
                    <span>+56 {c.phone}{c.profession ? ` · ${c.profession}` : ''}</span>
                  </div>
                </div>
              ),
            },
            { key: 'visits', label: sortHead('visits', 'Visitas'), num: true, render: (c) => statsOf(c).visits },
            { key: 'total', label: sortHead('totalSpent', 'Total'), num: true, strong: true, render: (c) => CLP(statsOf(c).totalSpent) },
            { key: 'last', label: sortHead('lastVisit', 'Última visita'), muted: true, render: lastLabel },
            { key: 'stars', label: 'Fidelidad', nowrap: true, render: (c) => loyaltyChips(c) || <span className="pn-muted">—</span> },
            {
              key: 'actions',
              label: <span className="pn-clientes-sr">Acciones</span>,
              className: 'pn-clientes-actions',
              render: (c) => <span className="pn-clientes-actions-in" onClick={stop} onKeyDown={stop}>{cardButton(c)}</span>,
            },
          ]}
          rows={rows}
          rowKey={keyOf}
          onRowClick={(c) => openClient(c)}
          mobile={(c) => {
            const st = statsOf(c)
            const chips = loyaltyChips(c)
            return {
              lead: <Avatar name={c.name} size={40} />,
              title: c.name || 'Sin nombre',
              subtitle: `+56 ${c.phone}${c.profession ? ` · ${c.profession}` : ''}`,
              children: (
                <span className="pn-clientes-stats">
                  {st.visits
                    ? `${st.visits} ${st.visits === 1 ? 'visita' : 'visitas'} · ${CLP(st.totalSpent)}${st.lastVisit ? ` · ${fmtDate(st.lastVisit, 'dm')}` : ''}`
                    : noVisitsLabel(c)}
                  {chips && <span className="pn-row-chips">{chips}</span>}
                </span>
              ),
              actions: cardButton(c, { compact: true }),
              chevron: true,
            }
          }}
          empty={(
            <EmptyState
              icon="users"
              title={filtering ? 'Sin resultados' : 'Todavía no hay clientes'}
              text={filtering ? 'Prueba con otro nombre, teléfono o quita el filtro.' : 'Se agregan solos al reservar, o créalos a mano.'}
              action={{ label: 'Nuevo cliente', icon: 'plus', onClick: () => setNewClientOpen(true) }}
            />
          )}
        />
      </Card>

      {rest > 0 && (
        <div className="pn-clientes-more">
          <span>Mostrando {rows.length} de {list.length}</span>
          <Button variant="secondary" size="sm" icon="chevronDown" onClick={() => setLimit((n) => n + PAGE)}>
            Ver {Math.min(PAGE, rest)} más
          </Button>
        </div>
      )}

      <ClientModal
        client={selectedClient}
        history={clientHistory}
        startEditing={clientEditing}
        onClose={() => setSelectedClient(null)}
        onSave={saveClient}
        onDelete={deleteClient}
        onSchedule={scheduleForClient}
        ctx={ctx}
      />
    </div>
  )
}
