import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ModuleHeader, Segmented, FilterChips, SearchField, Card, DataTable, Button, Field, Sheet, KpiGrid,
  EmptyState, SkeletonRows, InlineAlert, Chip, ChoiceGrid, useIsPhone,
} from '../../components/panel/index.js'
import { Icon } from '../../components/ui.jsx'
import { MODALITIES } from '../../imagen/vocab.js'
import {
  API, makeCall, plural, yesterdayKey, todayKey, fmtDay, fmtStamp, StatusChip, PaymentChip, modalityLabel,
} from './imagen/shared.jsx'
import ConsultationSheet from './imagen/ConsultationSheet.jsx'
import '../../styles/panel/imagen.css'

const CatalogView = lazy(() => import('./imagen/CatalogView.jsx'))
const SettingsView = lazy(() => import('./imagen/SettingsView.jsx'))

/* ============================================================
   IMAGE STUDIO — asesorías de imagen (Brunetti Image Studio).
   El ciclo del documento de Image Studio: la asesoría se vende (web o
   local), el cliente completa su ficha y fotos, Bruno registra el
   diagnóstico, el sistema sugiere (reglas, api/_imagenRules.js), Bruno
   aprueba / edita / descarta y genera el informe PDF versionado, que se
   manda por correo o WhatsApp.
   Vistas: Asesorías (lista + ficha), Catálogo (productos que se pueden
   recomendar) y Ajustes (precio y venta en línea de cada modalidad).
   Backend: /api/clients?mode=imagen (api/_imagen.js).
   ============================================================ */

const FILTERS = [
  { value: 'activas', label: 'En curso', match: (r) => !['entregada', 'cancelada', 'pago_pendiente'].includes(r.status) },
  { value: 'en_revision', label: 'Por revisar', match: (r) => r.status === 'en_revision' },
  { value: 'datos_pendientes', label: 'Datos pendientes', match: (r) => r.status === 'datos_pendientes' },
  { value: 'informe_listo', label: 'Informe listo', match: (r) => r.status === 'informe_listo' },
  { value: 'entregada', label: 'Entregadas', match: (r) => r.status === 'entregada' },
  { value: 'pago_pendiente', label: 'Pago pendiente', match: (r) => r.status === 'pago_pendiente' },
  { value: 'todas', label: 'Todas', match: () => true },
]

/* Pestaña «imagen» del panel interno. Recibe en `ctx` el estado y las
   acciones de Dashboard (ver el objeto `dash` de Dashboard.jsx). */
export default function ImagenTab({ ctx }) {
  const { authHeaders, clients, pushToast, searchParams } = ctx
  const toast = (icon, msg, ms) => pushToast?.(icon, msg, ms)
  const call = useMemo(() => makeCall(authHeaders), [authHeaders])
  const isPhone = useIsPhone()

  const [view, setView] = useState('asesorias')
  const [rows, setRows] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [filter, setFilter] = useState('activas')
  const [query, setQuery] = useState('')
  const [picking, setPicking] = useState(false)
  const [openId, setOpenId] = useState(null)

  const load = useCallback(async () => {
    setLoadError('')
    try {
      const json = await call(API)
      setRows(json.consultations || [])
      setStats(json.stats || null)
    } catch (err) {
      setLoadError(err.message || 'No se pudo cargar la lista.')
    } finally {
      setLoading(false)
    }
  }, [call])

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Deep links: ?tab=imagen&imgId=<asesoría> (ficha del cliente) o
  // &imgBooking=<reserva>&imgDate=<día> (detalle de una reserva): abre la
  // asesoría de esa reserva o crea una con sus datos.
  const handledLink = useRef('')
  useEffect(() => {
    if (loading) return
    const linkId = Number(searchParams?.get?.('imgId'))
    const bookingId = Number(searchParams?.get?.('imgBooking'))
    const key = `${linkId}|${bookingId}`
    if ((!linkId && !bookingId) || handledLink.current === key) return
    handledLink.current = key
    if (linkId) { setOpenId(linkId); return }
    const date = searchParams.get('imgDate') || yesterdayKey()
    call(`${API}&candidates=1&date=${encodeURIComponent(date)}`)
      .then((json) => {
        const b = json.bookings?.find((x) => x.bookingId === bookingId)
        if (!b) { setPicking(true); return }
        if (b.consultationId) setOpenId(b.consultationId)
        else createFrom({ ...b, visitDate: b.date })
      })
      .catch(() => setPicking(true))
  }, [searchParams, loading]) // eslint-disable-line react-hooks/exhaustive-deps

  async function createFrom(from) {
    try {
      const json = await call(API, {
        method: 'POST',
        body: { bookingId: from.bookingId ?? null, name: from.name || '', phone: from.phone || '', email: from.email || '', visitDate: from.visitDate || null, modality: from.modality || 'presencial' },
      })
      setPicking(false)
      setRows((list) => [summaryOf(json.consultation), ...list])
      setOpenId(json.consultation.id)
    } catch (err) {
      toast('⚠️', err.message, 4000)
    }
  }

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.value, rows.filter(f.match).length])), [rows])
  const filtered = useMemo(() => {
    const f = FILTERS.find((x) => x.value === filter) || FILTERS[0]
    const q = query.trim().toLowerCase()
    return rows.filter((r) => f.match(r) && (!q || [r.name, r.phone, r.email, r.faceName].some((v) => String(v || '').toLowerCase().includes(q))))
  }, [rows, filter, query])

  const onChanged = (c) => setRows((list) => {
    if (!c) return list
    const row = summaryOf(c, list.find((r) => r.id === c.id))
    return [row, ...list.filter((r) => r.id !== c.id)]
  })

  const sug = stats?.suggestions
  const decided = sug ? sug.approved + sug.edited + sug.discarded : 0
  const pct = (n) => (decided ? `${Math.round((n / decided) * 100)}%` : '—')
  const kpis = stats ? [
    { id: 'review', label: 'Por revisar', value: stats.toReview, icon: 'eye', hint: 'Datos recibidos' },
    { id: 'delivered', label: 'Entregadas', value: stats.delivered, icon: 'checkCircle', hint: stats.active ? `de ${plural(stats.active, 'pagada', 'pagadas')}` : undefined },
    { id: 'sug', label: 'Sugerencias aprobadas', value: decided ? `${pct(sug.approved + sug.edited)}` : '—', icon: 'sparkles', hint: decided ? `${pct(sug.edited)} editadas · ${pct(sug.discarded)} descartadas` : 'Todavía sin decidir', animate: false },
    { id: 'time', label: 'Datos → informe', value: stats.hoursToReport != null ? `${stats.hoursToReport} h` : '—', icon: 'clock', hint: 'Promedio', animate: false },
  ] : []

  const columns = [
    { key: 'name', label: 'Cliente', strong: true, render: (r) => r.name || 'Sin nombre' },
    { key: 'modality', label: 'Modalidad', render: (r) => modalityLabel(r.modality) },
    { key: 'face', label: 'Rostro', muted: true, render: (r) => r.faceName || '—' },
    { key: 'date', label: 'Fecha', nowrap: true, muted: true, render: (r) => fmtDay(r.visitDate) || fmtStamp(r.createdAt) },
    { key: 'pay', label: 'Pago', render: (r) => <PaymentChip c={r} /> },
    { key: 'status', label: 'Estado', render: (r) => <StatusChip status={r.status} /> },
  ]

  return (
    <div className="pn-page">
      <ModuleHeader
        title="Image Studio"
        subtitle={view === 'asesorias' ? (loading ? 'Cargando…' : `Asesorías de imagen · ${plural(rows.length, 'registrada', 'registradas')}`) : view === 'catalogo' ? 'Productos que puedes recomendar' : 'Precio y venta de cada modalidad'}
        primary={view === 'asesorias' ? (
          <Button variant="primary" icon="plus" aria-label="Nueva asesoría" title="Nueva asesoría" onClick={() => setPicking(true)}>
            {isPhone ? null : 'Nueva asesoría'}
          </Button>
        ) : null}
      />

      <Segmented
        ariaLabel="Vista de Image Studio"
        value={view}
        onChange={setView}
        options={[
          { value: 'asesorias', label: 'Asesorías', icon: 'sparkles' },
          { value: 'catalogo', label: 'Catálogo', icon: 'box' },
          { value: 'ajustes', label: 'Ajustes', icon: 'settings' },
        ]}
      />

      {view === 'asesorias' && (
        <>
          {loadError && (
            <InlineAlert tone="warn" title="No se pudieron cargar las asesorías" action={{ label: 'Reintentar', onClick: load }} onClose={() => setLoadError('')}>
              {loadError}
            </InlineAlert>
          )}
          {kpis.length > 0 && <KpiGrid items={kpis} storageKey="imagen" />}
          <div className="pn-stack">
            <SearchField value={query} onChange={setQuery} placeholder="Nombre, teléfono o rostro" ariaLabel="Buscar asesorías" />
            <FilterChips ariaLabel="Filtrar por estado" value={filter} onChange={setFilter}
              options={FILTERS.map((f) => ({ value: f.value, label: f.label, count: counts[f.value] }))} />
          </div>
          <Card flush>
            {loading ? <SkeletonRows rows={4} /> : (
              <DataTable
                ariaLabel="Asesorías de imagen"
                columns={columns}
                rows={filtered}
                onRowClick={(r) => setOpenId(r.id)}
                mobile={(r) => ({
                  title: r.name || 'Sin nombre',
                  subtitle: [modalityLabel(r.modality), r.faceName].filter(Boolean).join(' · '),
                  meta: fmtDay(r.visitDate) || fmtStamp(r.createdAt),
                  children: <span className="pn-row-chips"><StatusChip status={r.status} /><PaymentChip c={r} /></span>,
                  chevron: true,
                })}
                empty={rows.length ? (
                  <EmptyState compact icon="search" title="No hay asesorías que coincidan" text="Prueba con otro nombre o cambia el filtro."
                    action={{ label: 'Ver todas', icon: 'close', onClick: () => { setFilter('todas'); setQuery('') } }} />
                ) : (
                  <EmptyState
                    icon="sparkles"
                    title="Todavía no hay asesorías"
                    text="Crea la asesoría de un cliente que atendiste, o activa la venta en línea en Ajustes: las que se pagan en /asesoria llegan acá solas."
                    action={{ label: 'Nueva asesoría', icon: 'plus', onClick: () => setPicking(true) }}
                  />
                )}
              />
            )}
          </Card>
        </>
      )}

      {view !== 'asesorias' && (
        <Suspense fallback={<SkeletonRows rows={4} />}>
          {view === 'catalogo' ? <CatalogView call={call} authHeaders={authHeaders} toast={toast} /> : <SettingsView authHeaders={authHeaders} toast={toast} />}
        </Suspense>
      )}

      <NewConsultation open={picking} onClose={() => setPicking(false)} call={call} clients={clients} onPick={createFrom} />

      <ConsultationSheet
        id={openId}
        onClose={() => setOpenId(null)}
        call={call}
        authHeaders={authHeaders}
        toast={toast}
        onChanged={onChanged}
        onDeleted={(id) => { setRows((list) => list.filter((r) => r.id !== id)); setOpenId(null) }}
      />
    </div>
  )
}

// Fila de la lista a partir de una asesoría completa (después de guardar).
function summaryOf(c, prev = {}) {
  return {
    ...prev,
    id: c.id, name: c.name, phone: c.phone, email: c.email, modality: c.modality, status: c.status,
    paymentStatus: c.paymentStatus, price: c.price, paidAmount: c.paidAmount, visitDate: c.visitDate, source: c.source,
    faceName: c.diagnosis?.face?.name || null, createdAt: c.createdAt, updatedAt: c.updatedAt,
  }
}

/* ---------- Nueva asesoría: los atendidos de un día (ayer) u otro cliente ---------- */
function NewConsultation({ open, onClose, call, clients, onPick }) {
  const [date, setDate] = useState(yesterdayKey())
  const [modality, setModality] = useState('presencial')
  const [list, setList] = useState(null)
  const [error, setError] = useState('')
  const [other, setOther] = useState('')

  useEffect(() => {
    if (!open) return
    let live = true
    setList(null)
    setError('')
    call(`${API}&candidates=1&date=${encodeURIComponent(date)}`)
      .then((json) => { if (live) setList(json.bookings || []) })
      .catch((err) => { if (live) { setError(err.message); setList([]) } })
    return () => { live = false }
  }, [open, date]) // eslint-disable-line react-hooks/exhaustive-deps

  const matches = useMemo(() => {
    const q = other.trim().toLowerCase()
    if (q.length < 2) return []
    return (clients || []).filter((c) => [c.name, c.phone, c.email].some((v) => String(v || '').toLowerCase().includes(q))).slice(0, 8)
  }, [other, clients])

  return (
    <Sheet open={open} onClose={onClose} title="Nueva asesoría" subtitle="¿Para quién es?" icon="sparkles" size="md">
      <div className="pn-stack is-lg">
        <Field label="Modalidad">
          <ChoiceGrid ariaLabel="Modalidad" value={modality} onChange={setModality} cols={2}
            options={MODALITIES.map((m) => ({ value: m.id, label: m.label, icon: m.id === 'online' ? 'globe' : 'scissors' }))} />
        </Field>
        <Field label="Atendidos el día" htmlFor="img-date" hint={date === yesterdayKey() ? 'Ayer' : fmtDay(date)}>
          <input id="img-date" className="input" type="date" value={date} max={todayKey()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </Field>
        {error && <InlineAlert tone="warn">{error}</InlineAlert>}
        {list === null ? <SkeletonRows rows={3} /> : list.length === 0 ? (
          <p className="pn-img-muted">No hay atenciones completadas ese día.</p>
        ) : (
          <ul className="pn-img-pick" aria-label="Atenciones del día">
            {list.map((b) => (
              <li key={b.bookingId}>
                <button type="button" onClick={() => onPick({ ...b, visitDate: b.date, modality })}>
                  <span className="pn-img-pick-main">
                    <strong>{b.name || 'Sin nombre'}</strong>
                    <span>{b.time} · {b.service}{b.serviceId === 10 ? ' ★' : ''}</span>
                  </span>
                  {b.consultationId ? <StatusChip status={b.consultationStatus} /> : <Icon name="chevronRight" size={16} />}
                </button>
              </li>
            ))}
          </ul>
        )}
        <Field label="Otro cliente" htmlFor="img-other" hint="Busca en tu lista de clientes">
          <SearchField value={other} onChange={setOther} placeholder="Nombre o teléfono" ariaLabel="Buscar cliente" />
        </Field>
        {matches.length > 0 && (
          <ul className="pn-img-pick" aria-label="Clientes">
            {matches.map((c) => (
              <li key={c.id ?? c.phone}>
                <button type="button" onClick={() => onPick({ name: c.name, phone: c.phone, email: c.email, visitDate: todayKey(), modality })}>
                  <span className="pn-img-pick-main">
                    <strong>{c.name || 'Sin nombre'}</strong>
                    <span>{c.phone ? `+56 ${c.phone}` : c.email}</span>
                  </span>
                  <Icon name="chevronRight" size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="plain" icon="pencil" onClick={() => onPick({ modality, visitDate: todayKey() })}>Empezar en blanco</Button>
        <p className="pn-img-muted"><Chip tone="info">Online</Chip> Las que se pagan en la web aparecen solas en la lista.</p>
      </div>
    </Sheet>
  )
}
