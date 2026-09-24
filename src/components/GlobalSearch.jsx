import React, { useState, useMemo, useRef, useEffect } from 'react'
import { CLP, bookingUid, fmtDate } from '../data.js'
import { Sheet, SearchField, ListRow, List, StatusBadge, Avatar, EmptyState, SectionLabel, IconButton } from './panel/index.js'

/**
 * GlobalSearch — buscador global del panel.
 *
 * Busca sobre los datos YA cargados en memoria (clientes + reservas; el GET
 * interno de bookings trae LIMIT 160, de ahí el aviso del pie). No pega a la
 * API: es autocompletar puro con debounce de 150ms.
 *
 * Dos presentaciones con la misma lógica:
 *  · escritorio (`variant="field"`): campo en la barra superior + desplegable
 *  · celular (`variant="button"`): ícono de lupa en la barra que abre una hoja
 *    a pantalla completa. Antes en el celular la búsqueda global no existía.
 *
 * Props:
 *  clients, bookings          // datos en memoria
 *  onPickClient(client)       // → setTab("clientes") + openClient(client)
 *  onPickBooking(booking)     // → setTab("reservas") + setInboxFocus({day, ts})
 */

// fmtDate llega desde src/data.js; si todavía no existe (build parcial), la
// fecha cruda sigue siendo legible.
const prettyDay = (key) => {
  try { return typeof fmtDate === 'function' ? fmtDate(key, 'short') : key } catch { return key }
}

function useSearch(raw, clients, bookings) {
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQ(raw.trim().toLowerCase()), 150)
    return () => clearTimeout(t)
  }, [raw])
  const clientHits = useMemo(() => {
    if (!q) return []
    return clients.filter((c) => `${c.name || ''} ${c.phone || ''}`.toLowerCase().includes(q)).slice(0, 5)
  }, [q, clients])
  const bookingHits = useMemo(() => {
    if (!q) return []
    return bookings
      .filter((b) => `${b.client || ''} ${b.phone || ''} ${b.service || ''} ${b.date || ''}`.toLowerCase().includes(q))
      .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
      .slice(0, 8)
  }, [q, bookings])
  return { q, clientHits, bookingHits }
}

function Results({ raw, clientHits, bookingHits, onClient, onBooking, active }) {
  if (!raw.trim()) {
    return <EmptyState icon="search" title="Busca un cliente o una reserva" text="Por nombre, teléfono, servicio o fecha." />
  }
  if (!clientHits.length && !bookingHits.length) {
    return <EmptyState icon="search" title="Sin resultados" text={`No hay coincidencias para “${raw.trim()}”.`} />
  }
  return (
    <>
      {clientHits.length > 0 && <SectionLabel>Clientes</SectionLabel>}
      {clientHits.length > 0 && (
        <List>
          {clientHits.map((c, i) => (
            <ListRow
              key={`c-${c.id ?? c.phone}`}
              className={active === i ? 'is-active' : undefined}
              lead={<Avatar name={c.name} size={36} />}
              title={c.name || 'Cliente'}
              subtitle={c.phone || 'Sin teléfono'}
              chevron
              onClick={() => onClient(c)}
            />
          ))}
        </List>
      )}
      {bookingHits.length > 0 && <SectionLabel>Reservas</SectionLabel>}
      {bookingHits.length > 0 && (
        <List>
          {bookingHits.map((b, i) => (
            <ListRow
              key={bookingUid(b)}
              className={active === clientHits.length + i ? 'is-active' : undefined}
              lead={<span className="pn-time">{b.time}<small>{prettyDay(b.date)}</small></span>}
              title={b.client || 'Reserva'}
              subtitle={b.service || '—'}
              trailing={<StatusBadge status={b.status} />}
              meta={b.price ? CLP(b.price) : null}
              onClick={() => onBooking(b)}
            />
          ))}
        </List>
      )}
      <p className="pn-muted" style={{ fontSize: 'var(--pn-fs-xs)', margin: '14px 4px 0' }}>Busca en los datos cargados (últimas reservas).</p>
    </>
  )
}

export default function GlobalSearch({ clients = [], bookings = [], onPickClient = () => {}, onPickBooking = () => {}, variant = 'field' }) {
  const [raw, setRaw] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const { q, clientHits, bookingHits } = useSearch(raw, clients, bookings)
  const flat = useMemo(() => [
    ...clientHits.map((c) => ({ type: 'client', item: c })),
    ...bookingHits.map((b) => ({ type: 'booking', item: b })),
  ], [clientHits, bookingHits])
  useEffect(() => { setActive(0) }, [q])

  // Cierre por click afuera (solo el desplegable de escritorio).
  useEffect(() => {
    if (!open || variant !== 'field') return undefined
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open, variant])

  const pick = (entry) => {
    if (!entry) return
    if (entry.type === 'client') onPickClient(entry.item)
    else onPickBooking(entry.item)
    setOpen(false)
    setRaw('')
    inputRef.current?.blur()
  }

  if (variant === 'button') {
    return (
      <>
        <IconButton icon="search" label="Buscar" className="pn-topbar-search-btn" onClick={() => setOpen(true)} />
        <Sheet open={open} onClose={() => { setOpen(false); setRaw('') }} title="Buscar" size="md" full initialFocusRef={inputRef}>
          <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--pn-card)', paddingBottom: 10 }}>
            <SearchField inputRef={inputRef} value={raw} onChange={setRaw} placeholder="Cliente, teléfono o servicio" />
          </div>
          <Results
            raw={raw}
            clientHits={clientHits}
            bookingHits={bookingHits}
            onClient={(c) => pick({ type: 'client', item: c })}
            onBooking={(b) => pick({ type: 'booking', item: b })}
          />
        </Sheet>
      </>
    )
  }

  const showPanel = open && q.length > 0
  const onKeyDown = (e) => {
    if (!showPanel) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, flat.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(flat[active]) }
    else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
  }

  return (
    <div className="global-search pn-gsearch" ref={wrapRef}>
      <SearchField
        inputRef={inputRef}
        value={raw}
        onChange={(v) => { setRaw(v); setOpen(true) }}
        onKeyDown={onKeyDown}
        placeholder="Buscar cliente o reserva…"
        ariaLabel="Búsqueda global"
      />
      {showPanel && (
        <div className="pn-menu pn-gsearch-pop" role="listbox" onFocus={() => setOpen(true)}>
          <Results
            raw={raw}
            clientHits={clientHits}
            bookingHits={bookingHits}
            active={active}
            onClient={(c) => pick({ type: 'client', item: c })}
            onBooking={(b) => pick({ type: 'booking', item: b })}
          />
        </div>
      )}
    </div>
  )
}
