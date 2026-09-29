import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../../academy/Icon.jsx'
import { CLP } from '../../../data.js'
import { isImageUrl, safeUrl } from '../../../academy/url.js'
import { parseYouTubeId, thumbUrl } from '../../../academy/youtube.js'
import { r } from '../../../academy/routes.js'
import { ACADEMY_BRAND } from '../../../academy/hostConfig.js'
import { buildSeedPayload } from '../../../academy/host.jsx'
import {
  ActionMenu, Button, Card, Chip, ConfirmDialog, Field, IconButton, InlineAlert, List, ListRow, Note,
  Segmented, Sheet, Toolbar, ToggleRow,
} from '../../../components/panel/index.js'
import { errorText, useAdminLoad } from './adminApi.js'
import { ACCESS_LABEL, CoverField, LoadBlock, ReorderButtons, moneyProblem, moveItem, parseMoney, slugify } from './ui.jsx'

/* ============================================================
   Cursos: catálogo de la Academy (admin-courses) y su contenido.
   Curso → secciones → lecciones. Una lección es un video de YouTube (no
   listado) + texto + recursos; nace en borrador y se publica cuando tiene
   video o texto. El orden se cambia con ↑↓ (admin-reorder); no hay
   arrastrar-y-soltar a propósito: en el iPhone se pelea con el scroll.
   ============================================================ */

// "pimpstudio.cl" (hostConfig) para la pista de la dirección del curso.
const SITE_HOST = String(ACADEMY_BRAND.siteUrl || '').replace(/^https?:\/\//, '').replace(/\/+$/, '')

/* "Cargar cursos iniciales": el cuerpo de admin-seed lo arma cada sitio
   (host.jsx → buildSeedPayload, async). `existingSlugs` solo sirve para el
   resumen que ve el barbero antes de confirmar (el servidor igual salta los
   que existen). */
function seedSummary(payload, existingSlugs = []) {
  const all = payload?.courses || []
  const skip = new Set(existingSlugs)
  const fresh = all.filter((c) => !skip.has(c.slug))
  const sections = fresh.reduce((n, c) => n + (c.sections || []).length, 0)
  const lessons = fresh.reduce((n, c) => n + (c.sections || []).reduce((k, s) => k + (s.lessons || []).length, 0), 0)
  return { total: all.length, courses: fresh.length, skipped: all.length - fresh.length, sections, lessons }
}

/* "los 8 programas del catálogo y el Método Brunetti": qué trae la carga
   inicial, dicho a partir del mismo payload (los del catálogo traen catalogId). */
function seedLabel(payload) {
  const all = payload?.courses || []
  const fromCatalog = all.filter((c) => c.catalogId).length
  const parts = [
    fromCatalog === 1 ? 'el programa del catálogo' : fromCatalog ? `los ${fromCatalog} programas del catálogo` : null,
    ...all.filter((c) => !c.catalogId).map((c) => `el ${c.title}`),
  ].filter(Boolean)
  if (!parts.length) return 'los cursos iniciales'
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}` : parts[0]
}

const byPos = (a, b) => (Number(a.position ?? 0) - Number(b.position ?? 0)) || (Number(a.id) - Number(b.id))

/* La API puede mandar las lecciones dentro de cada sección o planas en el
   curso (con sectionId): se aceptan las dos formas. */
function normCourse(c) {
  const flat = Array.isArray(c.lessons) ? c.lessons : []
  const sections = (c.sections || []).slice().sort(byPos).map((s) => ({
    ...s,
    lessons: (Array.isArray(s.lessons) ? s.lessons : flat.filter((l) => Number(l.sectionId) === Number(s.id))).slice().sort(byPos),
  }))
  const known = new Set(sections.map((s) => Number(s.id)))
  const unsectioned = (Array.isArray(c.unsectioned) ? c.unsectioned : flat.filter((l) => !l.sectionId || !known.has(Number(l.sectionId)))).slice().sort(byPos)
  const all = [...sections.flatMap((s) => s.lessons), ...unsectioned]
  return { ...c, sections, unsectioned, lessonCount: all.length, publishedCount: all.filter((l) => l.published).length }
}

function fmtDuration(sec) {
  const s = Number(sec)
  if (!Number.isFinite(s) || s <= 0) return ''
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

/* "12:30" → 750 · "1:02:03" → 3723 · "12" (minutos) → 720 · "" → null ·
   cualquier otra cosa → NaN (error visible). */
function parseDuration(v) {
  const t = String(v || '').trim()
  if (!t) return null
  if (/^\d{1,3}$/.test(t)) return Number(t) * 60
  let m = /^(\d{1,3}):([0-5]\d)$/.exec(t)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  m = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(t)
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
  return NaN
}

export default function CursosSection({ api, ctx, reloadKey }) {
  const toast = ctx.pushToast
  const list = useAdminLoad(async () => (await api.call('admin-courses')).courses || [], [reloadKey])
  const courses = useMemo(() => (list.data || []).map(normCourse).sort(byPos), [list.data])
  const [openId, setOpenId] = useState(null)       // id | 'new' | null
  const [seedOpen, setSeedOpen] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [reordering, setReordering] = useState(false)

  const openCourse = openId && openId !== 'new' ? courses.find((c) => c.id === openId) || null : null

  // El payload inicial lo arma el sitio (puede cargar su catálogo aparte).
  const [seed, setSeed] = useState(null)
  const [seedFailed, setSeedFailed] = useState(false)
  useEffect(() => {
    let alive = true
    Promise.resolve()
      .then(() => buildSeedPayload())
      .then((p) => { if (alive) setSeed(p && Array.isArray(p.courses) ? p : { courses: [] }) })
      .catch(() => { if (alive) setSeedFailed(true) })
    return () => { alive = false }
  }, [])
  const summary = useMemo(() => seedSummary(seed, courses.map((c) => c.slug)), [seed, courses])
  // "Programa del catálogo": los cursos de la carga inicial que vienen del catálogo público.
  const catalog = useMemo(
    () => (seed?.courses || []).filter((c) => c.catalogId).map((c) => ({ id: c.catalogId, name: c.title })),
    [seed],
  )

  const runSeed = async () => {
    if (!seed) { setSeedOpen(false); return }
    setSeeding(true)
    try {
      const out = await api.call('admin-seed', { method: 'POST', body: seed })
      const c = out.created || {}
      setSeedOpen(false)
      toast('✓', c.courses ? `Creamos ${c.courses} cursos, ${c.sections || 0} secciones y ${c.lessons || 0} lecciones en borrador` : 'Ya estaban todos cargados', 6000)
      list.reload({ silent: true })
    } catch (err) {
      toast('⚠', errorText(err), 6000)
    } finally {
      setSeeding(false)
    }
  }

  const reorderCourses = async (index, delta) => {
    const next = moveItem(courses, index, delta)
    if (next === courses || reordering) return
    setReordering(true)
    list.setData(next.map((c, i) => ({ ...c, position: i })))
    try {
      await api.call('admin-reorder', { method: 'POST', body: { type: 'course', ids: next.map((c) => c.id) } })
    } catch (err) {
      toast('⚠', errorText(err), 5000)
      list.reload({ silent: true })
    } finally {
      setReordering(false)
    }
  }

  return (
    <div className="pn-stack is-lg">
      <Toolbar>
        <span className="pn-muted">{courses.length ? `${courses.length} ${courses.length === 1 ? 'curso' : 'cursos'}` : ''}</span>
        <span className="pn-toolbar-spacer" />
        <div className="pn-hstack">
          <Button icon="download" onClick={() => setSeedOpen(true)} disabled={list.loading || Boolean(list.error)}>Cargar cursos iniciales</Button>
          <Button variant="primary" icon="plus" onClick={() => setOpenId('new')}>Nuevo curso</Button>
        </div>
      </Toolbar>

      <LoadBlock
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        empty={courses.length === 0}
        emptyIcon="book"
        emptyTitle="Todavía no hay cursos"
        emptyText={`Carga ${seedLabel(seed)} con un toque (quedan en borrador), o crea uno desde cero.`}
        emptyAction={{ label: 'Cargar cursos iniciales', icon: 'download', onClick: () => setSeedOpen(true) }}
      >
        <Card flush>
          <List>
            {courses.map((c, i) => (
              <ListRow
                key={c.id}
                onClick={() => setOpenId(c.id)}
                lead={<span className="pn-thumb">{c.coverUrl && isImageUrl(c.coverUrl) ? <img src={c.coverUrl} alt="" loading="lazy" /> : <Icon name="book" size={18} />}</span>}
                title={c.title}
                subtitle={`${c.sections.length} ${c.sections.length === 1 ? 'sección' : 'secciones'} · ${c.lessonCount} lecciones (${c.publishedCount} publicadas) · ${ACCESS_LABEL[c.access] || c.access}${c.access === 'nivel' && c.unlockLevel ? ` ${c.unlockLevel}` : ''}`}
                subtitleWrap
                trailing={(
                  <span className="pn-aca-chips">
                    {c.published ? <Chip tone="ok" dot>Publicado</Chip> : <Chip tone="muted" dot>Borrador</Chip>}
                    {c.salesOpen && <Chip tone="accent" icon="cart">En venta</Chip>}
                    {c.priceOnline ? <span className="pn-num pn-aca-price">{CLP(c.priceOnline)}</span> : null}
                  </span>
                )}
                actions={(
                  <ReorderButtons
                    label={c.title}
                    disableUp={i === 0 || reordering}
                    disableDown={i === courses.length - 1 || reordering}
                    onUp={() => reorderCourses(i, -1)}
                    onDown={() => reorderCourses(i, 1)}
                  />
                )}
              />
            ))}
          </List>
        </Card>
      </LoadBlock>

      <CourseSheet
        open={Boolean(openId)}
        isNew={openId === 'new'}
        course={openCourse}
        courses={courses}
        catalog={catalog}
        api={api}
        toast={toast}
        onClose={() => setOpenId(null)}
        onSaved={(saved, wasNew) => {
          list.reload({ silent: true })
          if (wasNew && saved?.id) setOpenId(saved.id)
        }}
        onDeleted={() => { setOpenId(null); list.reload({ silent: true }) }}
        patchCourse={(id, fn) => list.setData((rows) => (rows || []).map((c) => (c.id === id ? fn(c) : c)))}
        reload={() => list.reload({ silent: true })}
      />

      <ConfirmDialog
        open={seedOpen}
        icon="book"
        title="Cargar cursos iniciales"
        message={!seed
          ? (seedFailed ? 'No se pudieron preparar los cursos iniciales. Recarga la página e intenta de nuevo.' : 'Preparando los cursos iniciales…')
          : summary.courses
          ? `Se crean ${summary.courses} cursos con ${summary.sections} secciones y ${summary.lessons} lecciones, todo en borrador y sin precio.${summary.skipped ? ` ${summary.skipped} ya existen y se saltan.` : ''} Después agregas los videos y publicas.`
          : 'Los cursos iniciales ya están cargados. Si aprietas igual, no se duplica nada.'}
        confirmLabel="Cargar"
        busy={seeding || (!seed && !seedFailed)}
        onCancel={() => setSeedOpen(false)}
        onConfirm={runSeed}
      />
    </div>
  )
}

/* ---------------- Hoja del curso ---------------- */

const EMPTY_COURSE = {
  title: '', subtitle: '', description: '', coverUrl: '', slug: '', catalogId: '',
  published: false, access: 'compra', unlockLevel: '', priceOnline: '', pricePresencial: '', salesOpen: false,
}

function toDraft(c) {
  if (!c) return { ...EMPTY_COURSE }
  return {
    title: c.title || '',
    subtitle: c.subtitle || '',
    description: c.description || '',
    coverUrl: c.coverUrl || '',
    slug: c.slug || '',
    catalogId: c.catalogId || '',
    published: Boolean(c.published),
    access: c.access || 'compra',
    unlockLevel: c.unlockLevel ? String(c.unlockLevel) : '',
    priceOnline: c.priceOnline != null ? String(c.priceOnline) : '',
    pricePresencial: c.pricePresencial != null ? String(c.pricePresencial) : '',
    salesOpen: Boolean(c.salesOpen),
  }
}

function CourseSheet({ open, isNew, course, courses, catalog = [], api, toast, onClose, onSaved, onDeleted, patchCourse, reload }) {
  const [view, setView] = useState('datos')
  const [draft, setDraft] = useState(EMPTY_COURSE)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const lastKey = useRef(null)

  // El borrador se reinicia al abrir otro curso, no cada vez que la lista se
  // recarga (eso borraría lo que el barbero está escribiendo).
  useEffect(() => {
    if (!open) { lastKey.current = null; return }
    const key = isNew ? 'new' : course?.id
    if (key === lastKey.current || (key === undefined)) return
    lastKey.current = key
    setDraft(toDraft(isNew ? null : course))
    setErr('')
    setView('datos')
  }, [open, isNew, course])

  const patch = (p) => { setDraft((d) => ({ ...d, ...p })); setErr('') }
  const priceOnline = parseMoney(draft.priceOnline)
  const pricePresencial = parseMoney(draft.pricePresencial)
  const pOnlineErr = moneyProblem(priceOnline)
  const pPresErr = moneyProblem(pricePresencial)
  const slug = isNew ? (draft.slug.trim() || slugify(draft.title)) : draft.slug
  const slugTaken = isNew && slug && courses.some((c) => c.slug === slug)
  const levelOk = draft.access !== 'nivel' || (Number(draft.unlockLevel) >= 2 && Number(draft.unlockLevel) <= 9)
  const dirty = isNew || !course || JSON.stringify(toDraft(course)) !== JSON.stringify(draft)
  const canSave = draft.title.trim() && !pOnlineErr && !pPresErr && levelOk && !slugTaken && (!isNew || /^[a-z0-9-]{3,40}$/.test(slug)) && !saving
  const cannotSell = draft.salesOpen && (!draft.published || (priceOnline === null && pricePresencial === null))

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    setErr('')
    try {
      const body = {
        id: isNew ? undefined : course.id,
        slug: isNew ? slug : undefined,
        title: draft.title.trim().slice(0, 120),
        subtitle: draft.subtitle.trim() || null,
        description: draft.description.trim(),
        coverUrl: draft.coverUrl.trim() || null,
        position: isNew ? courses.length : course.position,
        published: draft.published,
        access: draft.access,
        unlockLevel: draft.access === 'nivel' ? Number(draft.unlockLevel) : null,
        priceOnline,
        pricePresencial,
        salesOpen: draft.salesOpen,
        catalogId: draft.catalogId || null,
      }
      const out = await api.call('admin-course-save', { method: 'POST', body })
      toast('✓', isNew ? 'Curso creado' : 'Curso guardado')
      lastKey.current = isNew ? out.course?.id : lastKey.current
      if (out.course) setDraft(toDraft(out.course))
      onSaved(out.course, isNew)
      if (isNew) setView('contenido')
    } catch (e) {
      setErr(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    setDeleting(true)
    try {
      const out = await api.call('admin-course-delete', { method: 'POST', body: { id: course.id } })
      setConfirmDelete(false)
      toast('✓', out.archived ? 'Tenía pedidos: quedó despublicado en vez de borrarse' : 'Curso eliminado', 5000)
      onDeleted()
    } catch (e) {
      toast('⚠', errorText(e), 6000)
    } finally {
      setDeleting(false)
    }
  }

  const title = isNew ? 'Nuevo curso' : (course?.title || 'Curso')

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={title}
        subtitle={isNew ? 'Se crea en borrador' : course ? `/${course.slug}` : undefined}
        icon="book"
        size="lg"
        headActions={!isNew && course ? (
          <ActionMenu
            title={course.title}
            items={[
              { label: 'Ver en la Academy', icon: 'eye', onClick: () => api.openAcademy(r.course(course.slug)).catch((e) => toast('⚠', errorText(e), 5000)) },
              { label: 'Eliminar curso', icon: 'trash', danger: true, onClick: () => setConfirmDelete(true) },
            ]}
          />
        ) : undefined}
        footer={view === 'datos' ? (
          <>
            <Button onClick={onClose} disabled={saving}>{dirty && !isNew ? 'Descartar' : 'Cerrar'}</Button>
            <Button variant="primary" onClick={save} disabled={!canSave || (!dirty && !isNew)} loading={saving}>{isNew ? 'Crear curso' : 'Guardar'}</Button>
          </>
        ) : undefined}
      >
        <div className="pn-stack is-lg">
          {!isNew && (
            <Segmented
              full
              ariaLabel="Sección del curso"
              value={view}
              onChange={setView}
              options={[
                { value: 'datos', label: 'Datos', icon: 'pencil' },
                { value: 'contenido', label: 'Contenido', icon: 'list', count: course?.lessonCount },
              ]}
            />
          )}

          {view === 'datos' ? (
            <div className="pn-stack is-lg">
              <Field label="Título">
                <input className="input" value={draft.title} maxLength={120} onChange={(e) => patch({ title: e.target.value })} />
              </Field>
              {isNew && (
                <Field label="Dirección" hint={`${SITE_HOST}${r.path('/cursos')}/${slug || '…'}`} error={slugTaken ? 'Ya hay un curso con esa dirección' : (slug && !/^[a-z0-9-]{3,40}$/.test(slug) ? 'Solo minúsculas, números y guiones (3 a 40)' : null)}>
                  <input className="input" value={draft.slug} placeholder={slugify(draft.title) || 'barberia-basico'} onChange={(e) => patch({ slug: slugify(e.target.value) })} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
                </Field>
              )}
              <Field label="Subtítulo" optional>
                <input className="input" value={draft.subtitle} maxLength={160} onChange={(e) => patch({ subtitle: e.target.value })} />
              </Field>
              <Field label="Descripción" optional hint="Texto simple; los saltos de línea se respetan.">
                <textarea className="input" rows={4} maxLength={4000} value={draft.description} onChange={(e) => patch({ description: e.target.value })} />
              </Field>
              <CoverField value={draft.coverUrl} onChange={(v) => patch({ coverUrl: v })} kind="curso" api={api} />

              <div className="pn-form-row">
                <Field label="Precio online" optional error={pOnlineErr} hint="Vacío = no se vende online">
                  <input className="input" inputMode="numeric" placeholder="$0" value={draft.priceOnline} onChange={(e) => patch({ priceOnline: e.target.value.replace(/[^\d.]/g, '') })} />
                </Field>
                <Field label="Precio presencial" optional error={pPresErr} hint="Vacío = no se vende presencial">
                  <input className="input" inputMode="numeric" placeholder="$0" value={draft.pricePresencial} onChange={(e) => patch({ pricePresencial: e.target.value.replace(/[^\d.]/g, '') })} />
                </Field>
              </div>

              <div className="pn-form-row">
                <Field label="Acceso">
                  <select className="input" value={draft.access} onChange={(e) => patch({ access: e.target.value })}>
                    <option value="compra">Se compra (pago único)</option>
                    <option value="abierto">Abierto a todos los miembros</option>
                    <option value="nivel">Se desbloquea por nivel</option>
                  </select>
                </Field>
                {draft.access === 'nivel' ? (
                  <Field label="Nivel que lo desbloquea" error={!levelOk ? 'Elige un nivel' : null}>
                    <select className="input" value={draft.unlockLevel} onChange={(e) => patch({ unlockLevel: e.target.value })}>
                      <option value="">Elige</option>
                      {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>Nivel {n}</option>)}
                    </select>
                  </Field>
                ) : (
                  <Field label="Programa del catálogo" optional hint={`Une este curso con su ficha en ${r.base()}.`}>
                    <select className="input" value={draft.catalogId} onChange={(e) => patch({ catalogId: e.target.value })}>
                      <option value="">Ninguno</option>
                      {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Field>
                )}
              </div>

              <Card flush>
                <List>
                  <ToggleRow title="Publicado" description="Los miembros lo ven en Cursos. En borrador solo lo ve el staff." checked={draft.published} onChange={(v) => patch({ published: v })} />
                  <ToggleRow title="Ventas abiertas" description={`Aparece con botón de pago en el catálogo ${r.base()}.`} checked={draft.salesOpen} onChange={(v) => patch({ salesOpen: v })} />
                </List>
              </Card>
              {cannotSell && <InlineAlert tone="warn">Para venderse tiene que estar publicado y tener al menos un precio.</InlineAlert>}
              {err && <InlineAlert tone="error">{err}</InlineAlert>}
            </div>
          ) : course ? (
            <ContentEditor course={course} api={api} toast={toast} patchCourse={patchCourse} reload={reload} />
          ) : null}
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmDelete}
        tone="danger"
        title="¿Eliminar este curso?"
        message="Se borran sus secciones, lecciones y el avance de los alumnos. Si ya tiene pedidos no se borra: queda despublicado."
        confirmLabel="Eliminar"
        busy={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={doDelete}
      />
    </>
  )
}

/* ---------------- Editor de secciones y lecciones ---------------- */

function ContentEditor({ course, api, toast, patchCourse, reload }) {
  const [sectionSheet, setSectionSheet] = useState(null)   // { section|null }
  const [lessonSheet, setLessonSheet] = useState(null)     // { lesson|null, sectionId }
  const [confirm, setConfirm] = useState(null)             // { kind:'section'|'lesson', item }
  const [busy, setBusy] = useState(false)

  const reorder = async (type, ids, apply) => {
    if (busy) return
    setBusy(true)
    patchCourse(course.id, apply)
    try {
      await api.call('admin-reorder', { method: 'POST', body: { type, ids } })
    } catch (err) {
      toast('⚠', errorText(err), 5000)
    } finally {
      setBusy(false)
      reload()
    }
  }

  const moveSection = (index, delta) => {
    const next = moveItem(course.sections, index, delta)
    if (next === course.sections) return
    const pos = new Map(next.map((s, i) => [s.id, i]))
    reorder('section', next.map((s) => s.id), (c) => ({ ...c, sections: (c.sections || []).map((s) => ({ ...s, position: pos.get(s.id) ?? s.position })) }))
  }

  const moveLesson = (lessons, index, delta) => {
    const next = moveItem(lessons, index, delta)
    if (next === lessons) return
    const pos = new Map(next.map((l, i) => [l.id, i]))
    const bump = (l) => (pos.has(l.id) ? { ...l, position: pos.get(l.id) } : l)
    reorder('lesson', next.map((l) => l.id), (c) => ({
      ...c,
      lessons: Array.isArray(c.lessons) ? c.lessons.map(bump) : c.lessons,
      unsectioned: Array.isArray(c.unsectioned) ? c.unsectioned.map(bump) : c.unsectioned,
      sections: (c.sections || []).map((s) => (Array.isArray(s.lessons) ? { ...s, lessons: s.lessons.map(bump) } : s)),
    }))
  }

  const doDelete = async () => {
    const { kind, item } = confirm
    setBusy(true)
    try {
      await api.call(kind === 'section' ? 'admin-section-delete' : 'admin-lesson-delete', { method: 'POST', body: { id: item.id } })
      toast('✓', kind === 'section' ? 'Sección eliminada' : 'Lección eliminada')
      setConfirm(null)
      reload()
    } catch (err) {
      toast('⚠', errorText(err), 6000)
    } finally {
      setBusy(false)
    }
  }

  const groups = [
    ...course.sections.map((s) => ({ section: s, lessons: s.lessons })),
    ...(course.unsectioned.length ? [{ section: null, lessons: course.unsectioned }] : []),
  ]

  return (
    <div className="pn-stack is-lg">
      <div className="pn-between">
        <span className="pn-muted">{course.lessonCount} lecciones · {course.publishedCount} publicadas</span>
        <Button size="sm" icon="plus" onClick={() => setSectionSheet({ section: null })}>Sección</Button>
      </div>

      {groups.length === 0 && (
        <Note icon="info">Empieza creando una sección (por ejemplo "Módulo 1 · Bienvenida") y después agrégale lecciones.</Note>
      )}

      {groups.map(({ section, lessons }, gi) => (
        <Card
          key={section ? section.id : 'none'}
          flush
          className="pn-aca-section"
          title={section ? section.title : 'Sin sección'}
          subtitle={`${lessons.length} ${lessons.length === 1 ? 'lección' : 'lecciones'}`}
          action={(
            <span className="pn-hstack">
              {section && (
                <ReorderButtons
                  label={section.title}
                  disableUp={gi === 0 || busy}
                  disableDown={gi === course.sections.length - 1 || busy}
                  onUp={() => moveSection(gi, -1)}
                  onDown={() => moveSection(gi, 1)}
                />
              )}
              <IconButton small plain icon="plus" label="Agregar lección" onClick={() => setLessonSheet({ lesson: null, sectionId: section?.id ?? null, position: lessons.length })} />
              {section && (
                <ActionMenu
                  small
                  title={section.title}
                  items={[
                    { label: 'Renombrar', icon: 'pencil', onClick: () => setSectionSheet({ section }) },
                    { label: 'Eliminar sección', icon: 'trash', danger: true, onClick: () => setConfirm({ kind: 'section', item: section }) },
                  ]}
                />
              )}
            </span>
          )}
        >
          {lessons.length === 0 ? (
            <button type="button" className="pn-aca-add-lesson" onClick={() => setLessonSheet({ lesson: null, sectionId: section?.id ?? null, position: 0 })}>
              <Icon name="plus" size={15} /> Agregar la primera lección
            </button>
          ) : (
            <List>
              {lessons.map((l, li) => (
                <ListRow
                  key={l.id}
                  onClick={() => setLessonSheet({ lesson: l, sectionId: l.sectionId ?? section?.id ?? null })}
                  lead={(
                    <span className="pn-thumb pn-aca-lesson-thumb">
                      {l.videoId && /^[A-Za-z0-9_-]{11}$/.test(l.videoId) ? <img src={thumbUrl(l.videoId)} alt="" loading="lazy" /> : <Icon name={l.body ? 'list' : 'play'} size={16} />}
                    </span>
                  )}
                  title={l.title}
                  titleWrap
                  subtitle={[l.videoId ? 'Video' : (l.body ? 'Solo texto' : 'Sin video'), fmtDuration(l.durationSec), (l.resources || []).length ? `${l.resources.length} recursos` : ''].filter(Boolean).join(' · ')}
                  trailing={l.published ? <Chip tone="ok" dot>Publicada</Chip> : <Chip tone="muted" dot>Borrador</Chip>}
                  actions={(
                    <ReorderButtons
                      label={l.title}
                      disableUp={li === 0 || busy}
                      disableDown={li === lessons.length - 1 || busy}
                      onUp={() => moveLesson(lessons, li, -1)}
                      onDown={() => moveLesson(lessons, li, 1)}
                    />
                  )}
                />
              ))}
            </List>
          )}
        </Card>
      ))}

      <SectionSheet
        open={Boolean(sectionSheet)}
        section={sectionSheet?.section}
        onClose={() => setSectionSheet(null)}
        onSubmit={async (title) => {
          const s = sectionSheet?.section
          try {
            await api.call('admin-section-save', { method: 'POST', body: { id: s?.id, courseId: course.id, title, position: s ? s.position : course.sections.length } })
            toast('✓', s ? 'Sección renombrada' : 'Sección creada')
            setSectionSheet(null)
            reload()
            return null
          } catch (err) {
            return errorText(err)
          }
        }}
      />

      <LessonSheet
        open={Boolean(lessonSheet)}
        lesson={lessonSheet?.lesson}
        sectionId={lessonSheet?.sectionId}
        position={lessonSheet?.position}
        course={course}
        api={api}
        toast={toast}
        onClose={() => setLessonSheet(null)}
        onSaved={() => { setLessonSheet(null); reload() }}
        onDelete={(l) => setConfirm({ kind: 'lesson', item: l })}
      />

      <ConfirmDialog
        open={Boolean(confirm)}
        tone="danger"
        title={confirm?.kind === 'section' ? '¿Eliminar esta sección?' : '¿Eliminar esta lección?'}
        message={confirm?.kind === 'section'
          ? 'Sus lecciones no se borran: quedan en "Sin sección".'
          : 'Se borran también sus comentarios y el avance de los alumnos en ella.'}
        confirmLabel="Eliminar"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={doDelete}
      />
    </div>
  )
}

function SectionSheet({ open, section, onClose, onSubmit }) {
  const [title, setTitle] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) { setTitle(section?.title || ''); setErr('') } }, [open, section])
  const submit = async () => {
    if (!title.trim() || saving) return
    setSaving(true)
    const e = await onSubmit(title.trim().slice(0, 120))
    setSaving(false)
    if (e) setErr(e)
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={section ? 'Renombrar sección' : 'Nueva sección'}
      icon="list"
      size="sm"
      footer={(
        <>
          <Button onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" onClick={submit} disabled={!title.trim()} loading={saving}>Guardar</Button>
        </>
      )}
    >
      <div className="pn-stack">
        <Field label="Título" hint='Ej.: "Módulo 2 · El Protocolo Pre-Corte"'>
          <input className="input" value={title} maxLength={120} onChange={(e) => { setTitle(e.target.value); setErr('') }} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
        </Field>
        {err && <InlineAlert tone="error">{err}</InlineAlert>}
      </div>
    </Sheet>
  )
}

/* ---------------- Hoja de la lección ---------------- */

const MAX_RESOURCES = 10

function LessonSheet({ open, lesson, sectionId, position, course, api, toast, onClose, onSaved, onDelete }) {
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!open) return
    setErr('')
    setDraft({
      title: lesson?.title || '',
      sectionId: lesson ? (lesson.sectionId ?? sectionId ?? '') : (sectionId ?? ''),
      video: lesson?.videoId ? `https://youtu.be/${lesson.videoId}` : '',
      duration: lesson?.durationSec ? fmtDuration(lesson.durationSec) : '',
      body: lesson?.body || '',
      resources: (lesson?.resources || []).map((r) => ({ title: r.title || '', url: r.url || '' })),
      published: Boolean(lesson?.published),
    })
  }, [open, lesson, sectionId])

  if (!draft) return <Sheet open={false} onClose={onClose} />

  const patch = (p) => { setDraft((d) => ({ ...d, ...p })); setErr('') }
  const videoInput = draft.video.trim()
  const videoId = videoInput ? parseYouTubeId(videoInput) : null
  const videoErr = videoInput && !videoId ? 'No reconocemos ese enlace de YouTube. Pega el enlace del video (youtu.be/… o youtube.com/watch?v=…).' : null
  const durationSec = parseDuration(draft.duration)
  const durationErr = Number.isNaN(durationSec) ? 'Usa minutos (12) o mm:ss (12:30)' : null
  const resourceErrs = draft.resources.map((r) => {
    if (!r.title.trim() && !r.url.trim()) return null
    if (!r.title.trim()) return 'Falta el nombre'
    if (!safeUrl(r.url.trim())) return 'Enlace inválido (debe empezar con https://)'
    return null
  })
  const canPublish = Boolean(videoId) || draft.body.trim().length > 0
  const canSave = draft.title.trim() && !videoErr && !durationErr && resourceErrs.every((e) => !e) && !saving

  const setResource = (i, p) => patch({ resources: draft.resources.map((r, k) => (k === i ? { ...r, ...p } : r)) })

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    setErr('')
    try {
      const resources = draft.resources
        .filter((r) => r.title.trim() && r.url.trim())
        .map((r) => ({ title: r.title.trim().slice(0, 120), url: safeUrl(r.url.trim()) }))
      await api.call('admin-lesson-save', {
        method: 'POST',
        body: {
          id: lesson?.id,
          courseId: course.id,
          sectionId: draft.sectionId === '' || draft.sectionId === null ? null : Number(draft.sectionId),
          title: draft.title.trim().slice(0, 160),
          video: videoId || '',
          durationSec: durationSec ?? null,
          body: draft.body,
          resources,
          published: draft.published && canPublish,
          position: lesson ? lesson.position : (position ?? 0),
        },
      })
      toast('✓', lesson ? 'Lección guardada' : 'Lección creada')
      onSaved()
    } catch (e) {
      setErr(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={lesson ? 'Editar lección' : 'Nueva lección'}
      subtitle={course.title}
      icon="play"
      size="md"
      headActions={lesson ? (
        <ActionMenu
          title={lesson.title}
          items={[
            { label: 'Ver en la Academy', icon: 'eye', hidden: !lesson.slug, onClick: () => api.openAcademy(r.lesson(course.slug, lesson.slug)).catch((e) => toast('⚠', errorText(e), 5000)) },
            { label: 'Eliminar lección', icon: 'trash', danger: true, onClick: () => { onClose(); setTimeout(() => onDelete(lesson), 220) } },
          ]}
        />
      ) : undefined}
      footer={(
        <>
          <Button onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" onClick={save} disabled={!canSave} loading={saving}>{lesson ? 'Guardar' : 'Crear lección'}</Button>
        </>
      )}
    >
      <div className="pn-stack is-lg">
        <Field label="Título">
          <input className="input" value={draft.title} maxLength={160} onChange={(e) => patch({ title: e.target.value })} />
        </Field>

        <Field label="Sección">
          <select className="input" value={draft.sectionId ?? ''} onChange={(e) => patch({ sectionId: e.target.value })}>
            <option value="">Sin sección</option>
            {course.sections.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </Field>

        <Field label="Video de YouTube" optional error={videoErr} hint="Súbelo a YouTube como «No listado» y pega acá el enlace.">
          <input className="input" value={draft.video} inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="https://youtu.be/…" onChange={(e) => patch({ video: e.target.value })} />
        </Field>
        {videoId && (
          <div className="pn-aca-video">
            <img src={thumbUrl(videoId)} alt="Miniatura del video" loading="lazy" />
            <div>
              <b>Video reconocido</b>
              <small className="pn-num">{videoId}</small>
              <a href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noopener noreferrer">Abrir en YouTube</a>
            </div>
          </div>
        )}

        <Field label="Duración" optional error={durationErr} hint="Minutos (12) o mm:ss (12:30). Se muestra en la lista de lecciones.">
          <input className="input" value={draft.duration} inputMode="numeric" placeholder="12:30" onChange={(e) => patch({ duration: e.target.value })} />
        </Field>

        <Field label="Texto de la lección" optional hint="Texto simple: los enlaces https:// se vuelven clicables solos.">
          <textarea className="input" rows={6} maxLength={20000} value={draft.body} onChange={(e) => patch({ body: e.target.value })} />
        </Field>

        <div className="pn-stack">
          <div className="pn-between">
            <span className="pn-field-label">Recursos</span>
            <Button size="sm" variant="plain" icon="plus" disabled={draft.resources.length >= MAX_RESOURCES} onClick={() => patch({ resources: [...draft.resources, { title: '', url: '' }] })}>Agregar</Button>
          </div>
          {draft.resources.length === 0 ? <p className="pn-muted">PDF, guías o enlaces de apoyo (Drive, Dropbox…).</p> : (
            <div className="pn-stack">
              {draft.resources.map((r, i) => (
                <div key={i} className="pn-aca-resource">
                  <input className="input" placeholder="Nombre (ej.: Guía de la clase)" value={r.title} maxLength={120} onChange={(e) => setResource(i, { title: e.target.value })} />
                  <input className="input" placeholder="https://…" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={r.url} onChange={(e) => setResource(i, { url: e.target.value })} />
                  <IconButton small plain icon="trash" label="Quitar recurso" onClick={() => patch({ resources: draft.resources.filter((_, k) => k !== i) })} />
                  {resourceErrs[i] && <span className="pn-field-error">{resourceErrs[i]}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        <Card flush>
          <List>
            <ToggleRow
              title="Publicada"
              description={canPublish ? 'La ven los miembros con acceso al curso.' : 'Para publicarla necesita un video o texto.'}
              checked={draft.published && canPublish}
              disabled={!canPublish}
              onChange={(v) => patch({ published: v })}
            />
          </List>
        </Card>

        {err && <InlineAlert tone="error">{err}</InlineAlert>}
      </div>
    </Sheet>
  )
}
