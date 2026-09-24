import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { mergeEnrollments, removeLocalEnrollment } from '../../enrollmentsStore.js'
import EnrollmentModal from '../../components/EnrollmentModal.jsx'
import NewEnrollmentModal from '../../components/NewEnrollmentModal.jsx'
import {
  ModuleHeader, KpiGrid, FilterChips, SearchField, Card, DataTable, Chip, Button,
  EmptyState, SkeletonRows, InlineAlert, ConfirmDialog, useIsPhone,
} from '../../components/panel/index.js'
import { ORIGIN, OriginChip, PersonCell, fmtStamp } from './PedidosTab.jsx'
import '../../styles/panel/online.css'

/* ============================================================
   INSCRIPCIONES — lista unificada de Cursos + Workshop (solo BrunettiCutz).
   Trae /api/enrollments (sesión interna) combinado con el respaldo local de
   enrollmentsStore (lo que se inscribió desde /cursos o /workshop en este
   equipo), así que también aparecen la lista de espera y las consultas sin
   pago. Los pagos confirmados, con monto, están en Pedidos.
   ============================================================ */

/* Pagada = la fila la escribió el webhook de Mercado Pago, que deja
   "Pago MercadoPago <id> · $<monto>" en `message` (api/mp-payments.js). Es el
   mismo criterio con que Pedidos y el correo de detalles del Workshop eligen
   a quién contar. */
const isPaid = (e) => String(e?.message || '').startsWith('Pago MercadoPago')

// Lo que se pidió: el nivel del curso y/o la edición del Workshop. La lista
// de espera ya viene rotulada ("Próxima edición · lista de espera"): no se le
// antepone "Edición".
const editionLabel = (ed) => {
  const text = String(ed || '').trim()
  if (!text) return null
  return /espera|edici[oó]n/i.test(text) ? text.charAt(0).toUpperCase() + text.slice(1) : `Edición ${text}`
}
const detailOf = (e) => [e?.level, editionLabel(e?.edition)].filter(Boolean).join(' · ')

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const isJson = (res) => Boolean(res?.headers?.get('content-type')?.includes('application/json'))

/* Pestaña «inscripciones» del panel interno. Recibe en `ctx` el estado y las
   acciones de Dashboard (ver el objeto `dash` de Dashboard.jsx). */
export default function InscripcionesTab({ ctx }) {
  const {
    authHeaders,
    clients,
    createClient,
    pushToast,
    refreshing,
  } = ctx
  const toast = (icon, msg, ms) => pushToast?.(icon, msg, ms)
  const isPhone = useIsPhone()

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [filter, setFilter] = useState('todos') // todos | cursos | workshop
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)
  const [creating, setCreating] = useState(false)
  // Correo de detalles del Workshop: null | { phase: 'checking'|'ready'|'sending', recipients, skipped }
  const [details, setDetails] = useState(null)
  const loadReq = useRef(0)

  /* Combina lo del backend con el respaldo local (inscripciones hechas desde
     Cursos/Workshop), para que aparezcan aunque /api no esté disponible. Sin
     API (desarrollo sin mock) no hay aviso: quedan las locales, como siempre.
     Un error de verdad del servidor (sesión, base de datos) sí se avisa. */
  const loadEnrollments = useCallback(async () => {
    const req = ++loadReq.current
    let serverRows = []
    let error = ''
    try {
      const res = await fetch('/api/enrollments', { headers: authHeaders() })
      if (!isJson(res)) throw new Error('api unavailable')
      const d = await res.json()
      if (!res.ok || d?.ok === false) error = d?.error || 'No se pudieron cargar las inscripciones.'
      serverRows = Array.isArray(d?.enrollments) ? d.enrollments : []
    } catch {
      // sin API: solo el respaldo local
    }
    if (req !== loadReq.current) return
    setRows(mergeEnrollments(serverRows))
    setLoadError(error)
    setLoading(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadEnrollments() }, [loadEnrollments])

  // "Actualizar" de la barra superior (refreshAll) no conoce esta lista: al
  // empezar un refresco se vuelve a pedir también acá.
  const wasRefreshing = useRef(Boolean(refreshing))
  useEffect(() => {
    if (refreshing && !wasRefreshing.current) loadEnrollments()
    wasRefreshing.current = Boolean(refreshing)
  }, [refreshing, loadEnrollments])

  const saveEnrollment = async (updated) => {
    setRows((list) => list.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)))
    setSelected((r) => (r && r.id === updated.id ? { ...r, ...updated } : r))
    try {
      const res = await fetch(`/api/enrollments?id=${updated.id}`, {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(updated),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok === false) throw new Error(data?.error || 'No se pudo guardar')
    } catch (err) {
      console.error('saveEnrollment:', err?.message)
      toast('⚠️', 'No se pudo guardar la inscripción en el servidor', 6000)
    }
  }

  const deleteEnrollment = async (enrollment) => {
    setRows((list) => list.filter((r) => r.id !== enrollment.id))
    setSelected(null)
    /* Borrar también la copia del respaldo local: si no, mergeEnrollments la
       vuelve a mostrar al recargar aunque la fila ya no exista en Neon. */
    removeLocalEnrollment(enrollment)
    /* Las inscripciones que solo viven en localStorage (id `local-…`) no
       tienen fila que borrar en el backend. */
    if (!Number(enrollment.id)) return
    fetch(`/api/enrollments?id=${enrollment.id}`, { method: 'DELETE', headers: authHeaders() })
      .then((res) => { if (!res.ok) toast('⚠️', 'No se pudo eliminar en el servidor. Toca Actualizar para revisar.', 6000) })
      .catch(() => {})
  }

  const createEnrollment = async (draft) => {
    const res = await fetch('/api/enrollments', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(draft),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data?.ok === false) throw new Error(data?.error || 'No se pudo guardar la inscripción.')
    setRows((list) => [{ id: data.id, ...draft, created_at: new Date().toISOString() }, ...list])
    toast('✓', `Inscripción de ${draft.name} guardada`)
  }

  /* Correo con la ubicación y el horario del día a quienes ya tienen cupo en
     el Workshop. Primero pregunta al backend a quiénes les llegaría (dryRun),
     confirma con el barbero y recién ahí manda: son correos a clientes
     reales. Quien ya lo recibió queda fuera (details_sent_at). */
  const startWorkshopDetails = async () => {
    if (details) return
    setDetails({ phase: 'checking', recipients: [], skipped: 0 })
    // La revisión es una consulta: si se cuelga, no deja la confirmación
    // trabada (el envío de verdad no se corta, eso sí).
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 15000) : null
    try {
      const res = await fetch('/api/enrollments?job=workshop-details', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ dryRun: true }),
        signal: ctrl?.signal,
      })
      const preview = await res.json()
      if (!res.ok || preview?.ok === false) throw new Error(preview?.error || `HTTP ${res.status}`)
      const list = preview?.recipients || []
      if (!list.length) {
        setDetails(null)
        toast('✉️', preview?.skipped ? 'Ya se les había enviado a todos' : 'No hay a quién enviarle')
        return
      }
      setDetails({ phase: 'ready', recipients: list, skipped: Number(preview?.skipped || 0) })
    } catch (err) {
      console.error('sendWorkshopDetails:', err?.message)
      setDetails(null)
      toast('⚠️', 'No se pudo enviar')
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  const confirmWorkshopDetails = async () => {
    if (details?.phase !== 'ready') return
    setDetails((d) => (d ? { ...d, phase: 'sending' } : d))
    try {
      const res = await fetch('/api/enrollments?job=workshop-details', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ whenLabel: null }),
      })
      const out = await res.json()
      if (!res.ok || out?.ok === false) throw new Error(out?.error || `HTTP ${res.status}`)
      const okCount = out?.sent?.length || 0
      const badCount = out?.failed?.length || 0
      toast(badCount ? '⚠️' : '✉️', badCount ? `Enviados ${okCount}, fallaron ${badCount}` : `Correo enviado a ${okCount}`)
      if (badCount) console.error('workshop-details fallidos:', out.failed)
    } catch (err) {
      console.error('sendWorkshopDetails:', err?.message)
      toast('⚠️', 'No se pudo enviar')
    } finally {
      setDetails(null)
    }
  }

  const counts = useMemo(() => {
    const c = { todos: rows.length, cursos: 0, workshop: 0, paid: 0, paidCursos: 0, paidWorkshop: 0 }
    for (const r of rows) {
      const paid = isPaid(r)
      if (paid) c.paid += 1
      if (r.source === 'cursos') { c.cursos += 1; if (paid) c.paidCursos += 1 }
      else if (r.source === 'workshop') { c.workshop += 1; if (paid) c.paidWorkshop += 1 }
    }
    return c
  }, [rows])

  const q = query.trim().toLowerCase()
  const filtered = rows.filter((r) => {
    if (filter !== 'todos' && r.source !== filter) return false
    if (q) return r.name?.toLowerCase().includes(q) || r.phone?.includes(q) || r.email?.toLowerCase().includes(q)
    return true
  })
  const filtering = filter !== 'todos' || Boolean(q)
  const clearFilters = () => { setFilter('todos'); setQuery('') }

  // Mientras llega la primera carga, las cifras van en "—" y no en 0: un
  // "Ninguna pagada todavía" en ese momento sería falso.
  const firstLoad = loading && !rows.length
  const kpis = [
    { id: 'total', label: 'Inscripciones', icon: 'sparkles', value: firstLoad ? null : counts.todos, hint: firstLoad ? undefined : counts.paid ? plural(counts.paid, 'pagada', 'pagadas') : 'Ninguna pagada todavía' },
    { id: 'cursos', label: 'Cursos', color: ORIGIN.cursos.color, value: firstLoad ? null : counts.cursos, hint: firstLoad ? undefined : plural(counts.paidCursos, 'pagada', 'pagadas') },
    { id: 'workshop', label: 'Workshop', color: ORIGIN.workshop.color, value: firstLoad ? null : counts.workshop, hint: firstLoad ? undefined : plural(counts.paidWorkshop, 'cupo pagado', 'cupos pagados') },
  ]

  const originCell = (r) => (
    <span className="pn-online-chips">
      <OriginChip type={r.source} />
      {isPaid(r) && <Chip tone="ok" icon="check">Pagada</Chip>}
    </span>
  )

  const columns = [
    { key: 'who', label: 'Cliente', render: (r) => <PersonCell name={r.name} phone={r.phone} email={r.email} /> },
    { key: 'detail', label: 'Detalle', className: 'pn-online-detail', render: (r) => detailOf(r) || '—' },
    { key: 'origin', label: 'Origen', render: originCell },
    { key: 'date', label: 'Fecha', muted: true, nowrap: true, render: (r) => fmtStamp(r.created_at) },
  ]

  // La confirmación se sigue viendo mientras se anima al cerrarse: con lo
  // último que mostró, no con un "0 personas" de un cuadro ya vacío.
  const lastDetails = useRef(null)
  if (details) lastDetails.current = details
  const shownDetails = details || lastDetails.current
  const n = shownDetails?.recipients?.length || 0
  const skipped = shownDetails?.skipped || 0
  const skippedNote = skipped === 1
    ? ' 1 persona ya lo recibió y no se le vuelve a mandar.'
    : skipped > 1 ? ` ${skipped} personas ya lo recibieron y no se les vuelve a mandar.` : ''
  const detailsMessage = shownDetails?.phase === 'checking'
    ? 'Revisando quiénes tienen su cupo pagado…'
    : `Se manda un correo con la ubicación y el horario del día a ${plural(n, 'persona', 'personas')}.${skippedNote}`

  return (
    <div className="pn-page">
      <ModuleHeader
        title="Inscripciones"
        subtitle={firstLoad ? 'Cargando…' : plural(rows.length, 'inscripción', 'inscripciones')}
        primary={(
          /* En el celular, solo el "+": "Inscripciones" + "··· + Inscripción"
             no caben en 375 px y el encabezado se partía en dos filas. */
          <Button variant="primary" icon="plus" aria-label="Nueva inscripción" title="Nueva inscripción" onClick={() => setCreating(true)}>
            {isPhone ? null : 'Inscripción'}
          </Button>
        )}
        actions={[
          {
            label: 'Enviar detalles del Workshop',
            icon: 'mail',
            hint: 'Ubicación y horario a quienes pagaron su cupo',
            disabled: Boolean(details),
            onClick: startWorkshopDetails,
          },
        ]}
      />

      {loadError && (
        <InlineAlert
          tone="warn"
          title="No se pudieron cargar las inscripciones"
          action={{ label: 'Reintentar', onClick: loadEnrollments }}
          onClose={() => setLoadError('')}
        >
          {loadError} Por ahora ves solo las guardadas en este equipo.
        </InlineAlert>
      )}

      <KpiGrid items={kpis} cols={3} className="pn-online-kpis" />

      <div className="pn-stack">
        <SearchField value={query} onChange={setQuery} placeholder="Nombre, teléfono o correo" ariaLabel="Buscar inscripciones" />
        <FilterChips
          ariaLabel="Filtrar por origen"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'todos', label: 'Todas', count: counts.todos },
            { value: 'cursos', label: 'Cursos', count: counts.cursos },
            { value: 'workshop', label: 'Workshop', count: counts.workshop },
          ]}
        />
      </div>

      <Card flush>
        {firstLoad ? <SkeletonRows rows={4} /> : (
          <DataTable
            ariaLabel="Inscripciones"
            columns={columns}
            rows={filtered}
            rowKey={(r) => `${r.source}-${r.id}`}
            onRowClick={(r) => setSelected(r)}
            // Sin avatar en el celular: el ancho se lo llevan los chips de
            // origen y "Pagada", que así caben en una sola línea.
            mobile={(r) => ({
              title: r.name || 'Sin nombre',
              subtitle: detailOf(r) || (r.phone ? `+56 ${r.phone}` : r.email),
              meta: fmtStamp(r.created_at),
              children: <span className="pn-row-chips">{originCell(r)}</span>,
              chevron: true,
            })}
            empty={filtering ? (
              <EmptyState
                compact
                icon="search"
                title="No hay inscripciones que coincidan"
                text="Prueba con otro nombre o cambia el filtro."
                action={{ label: 'Ver todas', icon: 'close', onClick: clearFilters }}
              />
            ) : (
              <EmptyState
                icon="sparkles"
                title="Todavía no hay inscripciones"
                text="Las inscripciones a los Cursos y al Workshop que lleguen por brunetticutz.cl aparecen acá, pagadas o en lista de espera."
                action={{ label: 'Nueva inscripción', icon: 'plus', onClick: () => setCreating(true) }}
              />
            )}
          />
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(details)}
        icon="mail"
        title="Enviar detalles del Workshop"
        message={detailsMessage}
        confirmLabel={n ? `Enviar a ${n}` : 'Enviar'}
        busy={details?.phase === 'checking' || details?.phase === 'sending'}
        onConfirm={confirmWorkshopDetails}
        onCancel={() => setDetails(null)}
      >
        {n > 0 && (
          <ul className="pn-online-recipients" aria-label="Destinatarios">
            {shownDetails.recipients.map((r) => (
              <li key={r.id ?? r.email}>
                <strong>{r.name}</strong>
                <span>{r.email}</span>
              </li>
            ))}
          </ul>
        )}
      </ConfirmDialog>

      {selected && (
        <EnrollmentModal
          enrollment={selected}
          clients={clients || []}
          onClose={() => setSelected(null)}
          onSave={saveEnrollment}
          onDelete={deleteEnrollment}
          onCreateClient={createClient}
        />
      )}

      <NewEnrollmentModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={createEnrollment}
      />
    </div>
  )
}
