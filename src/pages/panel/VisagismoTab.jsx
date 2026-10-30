import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ModuleHeader, FilterChips, SearchField, Card, DataTable, Chip, Button, Field, Sheet,
  EmptyState, SkeletonRows, InlineAlert, ConfirmDialog, ActionMenu, useIsPhone,
} from '../../components/panel/index.js'
import { Icon } from '../../components/ui.jsx'
import { FACE_SHAPES } from '../../data/estilo.js'
import ESTILO from '../../data/content/estilo.json'
import { photoToJpeg } from './visagismoPhoto.js'
import '../../styles/panel/visagismo.css'

/* ============================================================
   VISAGISMO — brief de visagismo para un cliente atendido.
   Bruno elige al cliente (por defecto, los atendidos AYER), marca su forma
   de rostro, el corte ideal, los tips y las fotos del antes y el después; el
   servidor arma el PDF (api/_visagismoPdf.js) y lo manda por correo adjunto.
   Backend: /api/clients?mode=visagismo (api/_visagismo.js).
   Los textos de cada forma de rostro salen de lo mismo que usa /style:
   src/data/estilo.js (silueta, tips) + src/data/content/estilo.json (textos
   editables). El brief guarda una COPIA de lo que se mandó.
   Fase 2 (todavía no): las autoevaluaciones pagadas de la web caen en esta
   misma lista con source = 'autoevaluacion'.
   ============================================================ */

const API = '/api/clients?mode=visagismo'
const isJson = (res) => Boolean(res?.headers?.get('content-type')?.includes('application/json'))
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// La forma de rostro completa: silueta y tips del .js, textos del .json
// (lo que se edita con `npm run edit`), emparejados por índice como en /style.
const SHAPES = FACE_SHAPES.map((s, i) => {
  const t = ESTILO.faceShapes?.[i] || {}
  return {
    ...s,
    ...t,
    best: s.best.map((b, j) => ({ ...b, ...(t.best?.[j] || {}) })),
    tips: s.tips || [],
  }
})
const shapeById = (id) => SHAPES.find((s) => s.id === id) || null
const snapshotOf = (s) => (s ? {
  id: s.id, name: s.name, tagline: s.tagline, traits: s.traits, diagnosis: s.diagnosis,
  goal: s.goal, avoid: s.avoid, path: s.path,
  best: s.best.map(({ name, note, img }) => ({ name, note, img })),
} : null)

/* Diseños del PDF (THEMES en api/_visagismoPdf.js). `swatch` solo dibuja la
   muestra del selector, no el PDF. Plata es el oficial (DEFAULT_THEME allá). */
const DEFAULT_THEME = 'plata'
const THEMES = [
  { id: 'plata', label: 'Plata', hint: 'Oficial · perla y cromo', swatch: 'linear-gradient(160deg, #ffffff 0%, #e4e3df 70%)', ink: '#6c7179' },
  { id: 'oro', label: 'Oro', hint: 'Negro y oro', swatch: 'linear-gradient(160deg, #2a2216 0%, #0b0a08 60%)', ink: '#e3c477' },
  { id: 'morado', label: 'Morado', hint: 'Violeta Workshop', swatch: 'linear-gradient(160deg, #3b1666 0%, #0c0613 65%)', ink: '#c7a1fa' },
]

function yesterdayKey() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const d = new Date(`${today}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
const fmtDay = (key) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(key || ''))
  if (!m) return ''
  return new Intl.DateTimeFormat('es-CL', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])))
}
const fmtStamp = (v) => {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'short' }).format(d)
}

const emptyDraft = (from = {}) => ({
  id: null,
  bookingId: from.bookingId ?? null,
  name: from.name || '',
  phone: from.phone || '',
  email: from.email || '',
  visitDate: from.visitDate || from.date || yesterdayKey(),
  faceShape: null,
  shape: null,
  cutName: '',
  cutNote: '',
  cutImg: null,
  theme: DEFAULT_THEME,
  tips: [],
  notes: '',
  beforeUrl: null,
  afterUrl: null,
  status: 'borrador',
  source: 'panel',
})

function FaceGlyph({ path }) {
  return <svg viewBox="0 0 100 120" aria-hidden="true"><path d={path} /></svg>
}

function StatusChip({ brief }) {
  if (brief.source === 'autoevaluacion') return <Chip tone="info" icon="sparkles">Autoevaluación</Chip>
  return brief.status === 'enviado'
    ? <Chip tone="ok" icon="check">Enviado</Chip>
    : <Chip tone="warn" dot>Borrador</Chip>
}

/* Pestaña «visagismo» del panel interno. Recibe en `ctx` el estado y las
   acciones de Dashboard (ver el objeto `dash` de Dashboard.jsx). */
export default function VisagismoTab({ ctx }) {
  const { authHeaders, clients, pushToast, searchParams } = ctx
  const toast = (icon, msg, ms) => pushToast?.(icon, msg, ms)
  const isPhone = useIsPhone()

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [filter, setFilter] = useState('todos')
  const [query, setQuery] = useState('')
  const [picking, setPicking] = useState(false)
  const [draft, setDraft] = useState(null)

  const load = useCallback(async () => {
    setLoadError('')
    try {
      const res = await fetch(API, { headers: authHeaders() })
      const json = isJson(res) ? await res.json() : null
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'No se pudo cargar la lista.')
      setRows(json.briefs || [])
    } catch (err) {
      setLoadError(err.message || 'No se pudo cargar la lista.')
    } finally {
      setLoading(false)
    }
  }, [authHeaders])

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Deep link desde el detalle de una reserva: ?tab=visagismo&visBooking=<id>&visDate=<día>.
  // Abre el brief de esa reserva si ya existe; si no, uno nuevo con sus datos.
  const handledLink = useRef('')
  useEffect(() => {
    const bookingId = Number(searchParams?.get?.('visBooking'))
    if (!bookingId || loading || handledLink.current === String(bookingId)) return
    handledLink.current = String(bookingId)
    const existing = rows.find((r) => r.bookingId === bookingId)
    if (existing) { setDraft({ ...existing }); return }
    const date = searchParams.get('visDate') || yesterdayKey()
    fetch(`${API}&candidates=1&date=${encodeURIComponent(date)}`, { headers: authHeaders() })
      .then((res) => (isJson(res) ? res.json() : null))
      .then((json) => {
        const b = json?.bookings?.find((x) => x.bookingId === bookingId)
        if (b) setDraft(emptyDraft({ ...b, visitDate: b.date }))
        else setPicking(true)
      })
      .catch(() => setPicking(true))
  }, [searchParams, loading, rows]) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => ({
    todos: rows.length,
    borrador: rows.filter((r) => r.source !== 'autoevaluacion' && r.status !== 'enviado').length,
    enviado: rows.filter((r) => r.status === 'enviado').length,
    autoevaluacion: rows.filter((r) => r.source === 'autoevaluacion').length,
  }), [rows])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (filter === 'borrador' && (r.status === 'enviado' || r.source === 'autoevaluacion')) return false
      if (filter === 'enviado' && r.status !== 'enviado') return false
      if (filter === 'autoevaluacion' && r.source !== 'autoevaluacion') return false
      if (!q) return true
      return [r.name, r.phone, r.email, r.shape?.name, r.cutName].some((v) => String(v || '').toLowerCase().includes(q))
    })
  }, [rows, filter, query])

  const upsertRow = (brief) => setRows((list) => {
    const rest = list.filter((r) => r.id !== brief.id)
    return [brief, ...rest]
  })

  const columns = [
    { key: 'name', label: 'Cliente', strong: true, render: (r) => r.name || 'Sin nombre' },
    { key: 'shape', label: 'Rostro', render: (r) => r.shape?.name || '—' },
    { key: 'cut', label: 'Corte', render: (r) => r.cutName || '—' },
    { key: 'visit', label: 'Visita', nowrap: true, muted: true, render: (r) => fmtDay(r.visitDate) || fmtStamp(r.createdAt) },
    { key: 'status', label: 'Estado', render: (r) => <StatusChip brief={r} /> },
  ]

  return (
    <div className="pn-page">
      <ModuleHeader
        title="Visagismo"
        subtitle={loading ? 'Cargando…' : plural(rows.length, 'brief', 'briefs')}
        primary={(
          <Button variant="primary" icon="plus" aria-label="Nuevo brief" title="Nuevo brief" onClick={() => setPicking(true)}>
            {isPhone ? null : 'Nuevo brief'}
          </Button>
        )}
      />

      {loadError && (
        <InlineAlert tone="warn" title="No se pudieron cargar los briefs" action={{ label: 'Reintentar', onClick: load }} onClose={() => setLoadError('')}>
          {loadError}
        </InlineAlert>
      )}

      <div className="pn-stack">
        <SearchField value={query} onChange={setQuery} placeholder="Nombre, teléfono, rostro o corte" ariaLabel="Buscar briefs" />
        <FilterChips
          ariaLabel="Filtrar por estado"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'todos', label: 'Todos', count: counts.todos },
            { value: 'borrador', label: 'Borradores', count: counts.borrador },
            { value: 'enviado', label: 'Enviados', count: counts.enviado },
            ...(counts.autoevaluacion ? [{ value: 'autoevaluacion', label: 'Autoevaluaciones', count: counts.autoevaluacion }] : []),
          ]}
        />
      </div>

      <Card flush>
        {loading ? <SkeletonRows rows={4} /> : (
          <DataTable
            ariaLabel="Briefs de visagismo"
            columns={columns}
            rows={filtered}
            onRowClick={(r) => setDraft({ ...r })}
            mobile={(r) => ({
              title: r.name || 'Sin nombre',
              subtitle: [r.shape?.name, r.cutName].filter(Boolean).join(' · ') || 'Sin diagnóstico todavía',
              meta: fmtDay(r.visitDate) || fmtStamp(r.createdAt),
              children: <span className="pn-row-chips"><StatusChip brief={r} /></span>,
              chevron: true,
            })}
            empty={rows.length ? (
              <EmptyState compact icon="search" title="No hay briefs que coincidan" text="Prueba con otro nombre o cambia el filtro."
                action={{ label: 'Ver todos', icon: 'close', onClick: () => { setFilter('todos'); setQuery('') } }} />
            ) : (
              <EmptyState
                icon="sparkles"
                title="Todavía no hay briefs"
                text="Arma el brief de visagismo de un cliente que atendiste: su tipo de rostro, el corte ideal, tus tips y las fotos del antes y el después. Le llega por correo en PDF."
                action={{ label: 'Nuevo brief', icon: 'plus', onClick: () => setPicking(true) }}
              />
            )}
          />
        )}
      </Card>

      <ClientPicker
        open={picking}
        onClose={() => setPicking(false)}
        authHeaders={authHeaders}
        clients={clients}
        rows={rows}
        onPick={(from) => {
          setPicking(false)
          const existing = from.briefId ? rows.find((r) => r.id === from.briefId) : null
          setDraft(existing ? { ...existing } : emptyDraft(from))
        }}
      />

      <BriefEditor
        draft={draft}
        setDraft={setDraft}
        authHeaders={authHeaders}
        toast={toast}
        onSaved={upsertRow}
        onDeleted={(id) => setRows((list) => list.filter((r) => r.id !== id))}
      />
    </div>
  )
}

/* ---------- Elegir cliente: los atendidos de un día (ayer) u otro de la ficha ---------- */
function ClientPicker({ open, onClose, authHeaders, clients, onPick }) {
  const [date, setDate] = useState(yesterdayKey())
  const [list, setList] = useState(null)
  const [error, setError] = useState('')
  const [other, setOther] = useState('')

  useEffect(() => {
    if (!open) return
    let live = true
    setList(null)
    setError('')
    fetch(`${API}&candidates=1&date=${encodeURIComponent(date)}`, { headers: authHeaders() })
      .then(async (res) => {
        const json = isJson(res) ? await res.json() : null
        if (!res.ok || !json?.ok) throw new Error(json?.error || 'No se pudieron cargar las atenciones.')
        if (live) setList(json.bookings || [])
      })
      .catch((err) => { if (live) { setError(err.message); setList([]) } })
    return () => { live = false }
  }, [open, date]) // eslint-disable-line react-hooks/exhaustive-deps

  const matches = useMemo(() => {
    const q = other.trim().toLowerCase()
    if (q.length < 2) return []
    return (clients || []).filter((c) => [c.name, c.phone, c.email].some((v) => String(v || '').toLowerCase().includes(q))).slice(0, 8)
  }, [other, clients])

  return (
    <Sheet open={open} onClose={onClose} title="Nuevo brief" subtitle="¿Para quién es?" icon="sparkles" size="md">
      <div className="pn-stack is-lg">
        <Field label="Atendidos el día" htmlFor="vis-date" hint={date === yesterdayKey() ? 'Ayer' : fmtDay(date)}>
          <input id="vis-date" className="input" type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </Field>

        {error && <InlineAlert tone="warn">{error}</InlineAlert>}
        {list === null ? <SkeletonRows rows={3} /> : list.length === 0 ? (
          <p className="pn-vis-muted">No hay atenciones completadas ese día.</p>
        ) : (
          <ul className="pn-vis-pick" aria-label="Atenciones del día">
            {list.map((b) => (
              <li key={b.bookingId}>
                <button type="button" onClick={() => onPick({ ...b, visitDate: b.date })}>
                  <span className="pn-vis-pick-main">
                    <strong>{b.name || 'Sin nombre'}</strong>
                    <span>{b.time} · {b.service}{b.serviceId === 10 ? ' ★' : ''}</span>
                  </span>
                  {b.briefId
                    ? <Chip tone={b.briefStatus === 'enviado' ? 'ok' : 'warn'}>{b.briefStatus === 'enviado' ? 'Enviado' : 'Borrador'}</Chip>
                    : <Icon name="chevronRight" size={16} />}
                </button>
              </li>
            ))}
          </ul>
        )}

        <Field label="Otro cliente" htmlFor="vis-other" hint="Busca en tu lista de clientes">
          <SearchField value={other} onChange={setOther} placeholder="Nombre o teléfono" ariaLabel="Buscar cliente" />
        </Field>
        {matches.length > 0 && (
          <ul className="pn-vis-pick" aria-label="Clientes">
            {matches.map((c) => (
              <li key={c.id ?? c.phone}>
                <button type="button" onClick={() => onPick({ name: c.name, phone: c.phone, email: c.email, visitDate: yesterdayKey() })}>
                  <span className="pn-vis-pick-main">
                    <strong>{c.name || 'Sin nombre'}</strong>
                    <span>{c.phone ? `+56 ${c.phone}` : c.email}</span>
                  </span>
                  <Icon name="chevronRight" size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="plain" icon="pencil" onClick={() => onPick({})}>Empezar en blanco</Button>
      </div>
    </Sheet>
  )
}

/* ---------- Editor del brief ---------- */
function BriefEditor({ draft, setDraft, authHeaders, toast, onSaved, onDeleted }) {
  const open = Boolean(draft)
  const last = useRef(draft)
  if (draft) last.current = draft
  const d = draft || last.current || emptyDraft()

  const [busy, setBusy] = useState('') // '' | save | before | after | preview | send | delete
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [confirmSend, setConfirmSend] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [newTip, setNewTip] = useState('')

  useEffect(() => { if (open) { setError(''); setDirty(false); setNewTip('') } }, [open, draft?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => { setDraft((cur) => ({ ...cur, ...patch })); setDirty(true) }
  const shape = shapeById(d.faceShape || d.shape?.id)

  const pickShape = (s) => {
    // Al elegir otra forma se precargan su corte y sus tips, salvo que Bruno
    // ya haya escrito algo propio (no se le pisa).
    const prev = shapeById(d.faceShape)
    const prevTips = prev?.tips || []
    const tipsUntouched = d.tips.length === 0 || (d.tips.length === prevTips.length && d.tips.every((t, i) => t === prevTips[i]))
    const cutUntouched = !d.cutName || (prev && prev.best.some((b) => b.name === d.cutName))
    set({
      faceShape: s.id,
      shape: snapshotOf(s),
      ...(tipsUntouched ? { tips: [...s.tips] } : {}),
      ...(cutUntouched ? { cutName: s.best[0]?.name || '', cutNote: s.best[0]?.note || '', cutImg: s.best[0]?.img || null } : {}),
    })
  }

  const payload = () => ({
    bookingId: d.bookingId, name: d.name, phone: d.phone, email: d.email, visitDate: d.visitDate,
    shape: shape ? snapshotOf(shape) : d.shape, cutName: d.cutName, cutNote: d.cutNote, cutImg: d.cutImg,
    theme: d.theme || DEFAULT_THEME, tips: d.tips, notes: d.notes,
  })

  async function call(url, opts) {
    const res = await fetch(url, opts)
    const json = isJson(res) ? await res.json() : null
    if (!res.ok || !json?.ok) throw new Error(json?.error || 'No se pudo completar. Intenta de nuevo.')
    return json
  }

  // Guarda y devuelve el brief guardado (crea el borrador la primera vez).
  async function save({ quiet = false } = {}) {
    if (!d.name.trim() && !d.phone.trim()) throw new Error('Falta el nombre o el teléfono del cliente.')
    if (d.id && !dirty) return d
    const json = await call(d.id ? `${API}&id=${d.id}` : API, {
      method: d.id ? 'PATCH' : 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload()),
    })
    setDraft((cur) => ({ ...cur, ...json.brief, faceShape: json.brief.faceShape }))
    setDirty(false)
    onSaved(json.brief)
    if (!quiet) toast('✓', 'Brief guardado')
    return json.brief
  }

  const run = (kind, fn) => async (...args) => {
    setBusy(kind)
    setError('')
    try { await fn(...args) } catch (err) { setError(err.message || 'Algo falló.') } finally { setBusy('') }
  }

  const onSave = run('save', () => save())

  const onPhoto = (slot, file) => run(slot, async () => {
    if (!file) return
    const dataUrl = await photoToJpeg(file)
    const saved = await save({ quiet: true })
    const json = await call(`${API}&upload=1`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ id: saved.id, slot, dataUrl }),
    })
    setDraft((cur) => ({ ...cur, id: json.brief.id, beforeUrl: json.brief.beforeUrl, afterUrl: json.brief.afterUrl }))
    onSaved(json.brief)
  })()

  // La vista previa necesita el header de sesión: se baja como blob y se
  // abre en otra pestaña. La ventana se abre ANTES del await (si no, Safari
  // la bloquea por no venir directo del toque).
  const onPreview = run('preview', async () => {
    const win = window.open('', '_blank')
    try {
      const saved = await save({ quiet: true })
      const res = await fetch(`${API}&id=${saved.id}&pdf=1`, { headers: authHeaders() })
      if (!res.ok) {
        const json = isJson(res) ? await res.json() : null
        throw new Error(json?.error || 'No se pudo armar el PDF.')
      }
      const url = URL.createObjectURL(await res.blob())
      if (win) win.location.href = url
      else {
        const a = document.createElement('a')
        a.href = url
        a.download = `Brief-visagismo-${saved.id}.pdf`
        a.click()
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      win?.close()
      throw err
    }
  })

  const onSend = run('send', async () => {
    const saved = await save({ quiet: true })
    const json = await call(`${API}&id=${saved.id}&send=1`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ email: d.email }),
    })
    setConfirmSend(false)
    onSaved(json.brief)
    toast('✉️', `Brief enviado a ${json.brief.sentTo}`, 4000)
    setDraft(null)
  })

  const onDelete = run('delete', async () => {
    await call(`${API}&id=${d.id}`, { method: 'DELETE', headers: authHeaders() })
    setConfirmDel(false)
    onDeleted(d.id)
    toast('🗑️', 'Brief eliminado')
    setDraft(null)
  })

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(d.email || '').trim())
  const canSend = emailOk && Boolean(shape || d.shape?.name)
  const close = () => { if (!busy) setDraft(null) }
  const tipsList = d.tips || []

  return (
    <>
      <Sheet
        open={open}
        onClose={close}
        dismissible={!busy}
        size="lg"
        icon="sparkles"
        title={d.id ? `Brief · ${d.name || 'cliente'}` : 'Nuevo brief'}
        subtitle={d.status === 'enviado' ? `Enviado ${fmtStamp(d.sentAt)} a ${d.sentTo || d.email}` : (d.visitDate ? `Visita del ${fmtDay(d.visitDate)}` : null)}
        headActions={d.id ? (
          <ActionMenu label="Más opciones" items={[{ label: 'Eliminar brief', icon: 'trash', danger: true, onClick: () => setConfirmDel(true) }]} />
        ) : null}
        footer={(
          <>
            <Button variant="secondary" icon="eye" onClick={onPreview} loading={busy === 'preview'} disabled={Boolean(busy)}>
              Vista previa
            </Button>
            <Button variant="secondary" onClick={onSave} loading={busy === 'save'} disabled={Boolean(busy) || (d.id && !dirty)}>
              Guardar
            </Button>
            <Button variant="primary" icon="send" onClick={() => setConfirmSend(true)} disabled={Boolean(busy) || !canSend}
              title={canSend ? undefined : 'Falta el correo o la forma de rostro'}>
              {d.status === 'enviado' ? 'Reenviar' : 'Enviar'}
            </Button>
          </>
        )}
      >
        <div className="pn-form pn-vis-form">
          {error && <InlineAlert tone="error" onClose={() => setError('')}>{error}</InlineAlert>}

          {/* 1. Cliente */}
          <section className="pn-vis-sec">
            <h3 className="pn-vis-h">Cliente</h3>
            <div className="pn-form-row">
              <Field label="Nombre" htmlFor="vis-name">
                <input id="vis-name" className="input" value={d.name} maxLength={200} onChange={(e) => set({ name: e.target.value })} placeholder="Nombre del cliente" />
              </Field>
              <Field label="Teléfono" htmlFor="vis-phone" optional>
                <input id="vis-phone" className="input" inputMode="tel" value={d.phone || ''} maxLength={15} onChange={(e) => set({ phone: e.target.value })} placeholder="9 1234 5678" />
              </Field>
            </div>
            <div className="pn-form-row">
              <Field label="Correo" htmlFor="vis-email" error={d.email && !emailOk ? 'Revisa el correo' : null} hint={!d.email ? 'Se necesita para enviarle el PDF' : null}>
                <input id="vis-email" className="input" type="email" inputMode="email" value={d.email || ''} maxLength={300} onChange={(e) => set({ email: e.target.value })} placeholder="cliente@correo.com" />
              </Field>
              <Field label="Día de la visita" htmlFor="vis-visit">
                <input id="vis-visit" className="input" type="date" value={d.visitDate || ''} onChange={(e) => set({ visitDate: e.target.value })} />
              </Field>
            </div>
          </section>

          {/* Diseño del PDF */}
          <section className="pn-vis-sec">
            <h3 className="pn-vis-h">Diseño del PDF</h3>
            <div className="pn-vis-themes" role="radiogroup" aria-label="Diseño del PDF">
              {THEMES.map((t) => {
                const on = (d.theme || DEFAULT_THEME) === t.id
                return (
                  <button key={t.id} type="button" role="radio" aria-checked={on} className={`pn-vis-theme${on ? ' is-on' : ''}`} onClick={() => set({ theme: t.id })}>
                    <span className="pn-vis-theme-swatch" style={{ background: t.swatch, color: t.ink, borderColor: t.ink }} aria-hidden="true">
                      <span className="pn-vis-theme-word">B</span>
                    </span>
                    <span className="pn-vis-theme-txt"><strong>{t.label}</strong><span>{t.hint}</span></span>
                  </button>
                )
              })}
            </div>
          </section>

          {/* 2. Forma de rostro */}
          <section className="pn-vis-sec">
            <h3 className="pn-vis-h">Tipo de rostro</h3>
            <div className="pn-vis-shapes" role="radiogroup" aria-label="Forma de rostro">
              {SHAPES.map((s) => {
                const on = (d.faceShape || d.shape?.id) === s.id
                return (
                  <button key={s.id} type="button" role="radio" aria-checked={on} className={`pn-vis-shape${on ? ' is-on' : ''}`} onClick={() => pickShape(s)}>
                    <FaceGlyph path={s.path} />
                    <span>{s.name}</span>
                  </button>
                )
              })}
            </div>
            {shape && (
              <div className="pn-vis-diag">
                <p className="pn-vis-tag">{shape.tagline}</p>
                <p>{shape.diagnosis}</p>
                <p className="pn-vis-muted"><b>Objetivo:</b> {shape.goal} · <b>Evita:</b> {shape.avoid}</p>
              </div>
            )}
          </section>

          {/* 3. Corte */}
          <section className="pn-vis-sec">
            <h3 className="pn-vis-h">Corte ideal</h3>
            {shape && (
              <div className="pn-vis-cuts" role="radiogroup" aria-label="Cortes sugeridos">
                {shape.best.map((b) => {
                  const on = d.cutName === b.name
                  return (
                    <button key={b.name} type="button" role="radio" aria-checked={on} className={`pn-vis-cut${on ? ' is-on' : ''}`}
                      onClick={() => set({ cutName: b.name, cutNote: b.note, cutImg: b.img })}>
                      <img src={b.img} alt="" loading="lazy" />
                      <span>{b.name}</span>
                    </button>
                  )
                })}
              </div>
            )}
            <div className="pn-form-row">
              <Field label="Nombre del corte" htmlFor="vis-cut">
                <input id="vis-cut" className="input" value={d.cutName || ''} maxLength={200} onChange={(e) => set({ cutName: e.target.value })} placeholder="Ej: Pompadour con fade bajo" />
              </Field>
              <Field label="Por qué te queda" htmlFor="vis-cutnote" optional>
                <input id="vis-cutnote" className="input" value={d.cutNote || ''} maxLength={600} onChange={(e) => set({ cutNote: e.target.value })} placeholder="Una línea para el cliente" />
              </Field>
            </div>
          </section>

          {/* 4. Tips */}
          <section className="pn-vis-sec">
            <h3 className="pn-vis-h">Tips</h3>
            {tipsList.length === 0 && <p className="pn-vis-muted">Elige la forma de rostro para precargar tips, o escribe los tuyos.</p>}
            <ol className="pn-vis-tips">
              {tipsList.map((t, i) => (
                <li key={i}>
                  <textarea className="input" rows={2} value={t} maxLength={300} aria-label={`Tip ${i + 1}`}
                    onChange={(e) => set({ tips: tipsList.map((x, j) => (j === i ? e.target.value : x)) })} />
                  <button type="button" className="pn-vis-x" aria-label={`Quitar tip ${i + 1}`} onClick={() => set({ tips: tipsList.filter((_, j) => j !== i) })}>
                    <Icon name="close" size={14} />
                  </button>
                </li>
              ))}
            </ol>
            {tipsList.length < 12 && (
              <div className="pn-vis-addtip">
                <input className="input" value={newTip} maxLength={300} placeholder="Agregar un tip" aria-label="Nuevo tip"
                  onChange={(e) => setNewTip(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && newTip.trim()) { e.preventDefault(); set({ tips: [...tipsList, newTip.trim()] }); setNewTip('') } }} />
                <Button variant="secondary" icon="plus" disabled={!newTip.trim()} onClick={() => { set({ tips: [...tipsList, newTip.trim()] }); setNewTip('') }}>Agregar</Button>
              </div>
            )}
          </section>

          {/* 5. Fotos */}
          <section className="pn-vis-sec">
            <h3 className="pn-vis-h">Antes y después</h3>
            <div className="pn-vis-photos">
              {[['before', 'Antes', d.beforeUrl], ['after', 'Después', d.afterUrl]].map(([slot, label, url]) => (
                <label key={slot} className={`pn-vis-photo${url ? ' has-img' : ''}`}>
                  {url ? <img src={url} alt={label} /> : <Icon name="camera" size={26} />}
                  <span className="pn-vis-photo-tag">{busy === slot ? 'Subiendo…' : url ? `${label} · cambiar` : `Foto ${label.toLowerCase()}`}</span>
                  <input type="file" accept="image/*" disabled={Boolean(busy)}
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onPhoto(slot, f) }} />
                </label>
              ))}
            </div>
          </section>

          {/* 6. Nota */}
          <section className="pn-vis-sec">
            <h3 className="pn-vis-h">Nota personal</h3>
            <Field htmlFor="vis-notes" optional label="Un cierre tuyo para el cliente">
              <textarea id="vis-notes" className="input" rows={3} value={d.notes || ''} maxLength={1500} onChange={(e) => set({ notes: e.target.value })}
                placeholder="Ej: Quedaste increíble. La próxima probamos un poco más de textura arriba." />
            </Field>
          </section>
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmSend}
        icon="send"
        title={d.status === 'enviado' ? 'Reenviar el brief' : 'Enviar el brief'}
        message={`Le llega a ${String(d.email || '').trim()} un correo con el PDF adjunto.`}
        confirmLabel="Enviar"
        busy={busy === 'send'}
        onConfirm={onSend}
        onCancel={() => setConfirmSend(false)}
      />
      <ConfirmDialog
        open={confirmDel}
        tone="danger"
        title="Eliminar brief"
        message="Se borra el borrador y sus datos. Un correo ya enviado no se puede recuperar."
        confirmLabel="Eliminar"
        busy={busy === 'delete'}
        onConfirm={onDelete}
        onCancel={() => setConfirmDel(false)}
      />
    </>
  )
}
