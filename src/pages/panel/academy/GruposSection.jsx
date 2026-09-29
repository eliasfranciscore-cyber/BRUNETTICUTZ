import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '../../../academy/Icon.jsx'
import { isImageUrl } from '../../../academy/url.js'
import { r } from '../../../academy/routes.js'
import {
  ActionMenu, Avatar, Button, Card, Chip, ConfirmDialog, Field, InlineAlert, List, ListRow, Note, SearchField,
  SectionLabel, Sheet, Toolbar, ToggleRow,
} from '../../../components/panel/index.js'
import { errorText, useAdminLoad, useDebounced } from './adminApi.js'
import { CoverField, LoadBlock, fmtDay } from './ui.jsx'

/* ============================================================
   Grupos = salas / generaciones (academy_cohorts), cada una con su chat.
   · La lista sale de `cohorts` (modo de miembro: el panel lo pide con el
     token de propietario en memoria, que como staff ve todos).
   · Cupos y "ventas abiertas" se completan con el catálogo público cuando
     `cohorts` no los trae.
   · Quién está en cada grupo sale de admin-members?cohortId=… (modo admin).
   ============================================================ */

export default function GruposSection({ api, ctx, reloadKey }) {
  const toast = ctx.pushToast
  const cohorts = useAdminLoad(async () => {
    const [mine, catalog] = await Promise.all([
      api.memberCall('cohorts'),
      // El catálogo es público y best-effort: solo completa cupos/ventas.
      api.call('catalog').catch(() => ({ cohorts: [] })),
    ])
    const extra = new Map((catalog.cohorts || []).map((c) => [c.id, c]))
    return (mine.cohorts || []).map((c) => {
      const cat = extra.get(c.id) || {}
      return {
        ...c,
        seats: c.seats ?? cat.seats ?? null,
        seatsLeft: c.seatsLeft ?? cat.seatsLeft ?? null,
        salesOpen: c.salesOpen ?? cat.salesOpen ?? false,
        courseSlug: c.course?.slug ?? cat.courseSlug ?? null,
        // `cohorts` no trae cupos/ventas y el catálogo tampoco lo listó: la
        // hoja de edición avisa antes de que un guardado los pise.
        partial: !('seats' in c) && !extra.has(c.id),
      }
    })
  }, [reloadKey])
  const courses = useAdminLoad(async () => (await api.call('admin-courses')).courses || [], [reloadKey])

  const [edit, setEdit] = useState(null)        // cohort | {} (nuevo) | null
  const [members, setMembers] = useState(null)  // cohort | null
  const [archive, setArchive] = useState(null)
  const [busy, setBusy] = useState(false)

  const courseBySlug = useMemo(() => new Map((courses.data || []).map((c) => [c.slug, c])), [courses.data])
  const list = (cohorts.data || []).filter((c) => !c.archivedAt)

  const openChat = (c) => api.openAcademy(r.group(c.id)).catch((err) => toast('⚠', errorText(err), 5000))

  const doArchive = async () => {
    setBusy(true)
    try {
      await api.call('admin-cohort-archive', { method: 'POST', body: { id: archive.id } })
      toast('✓', `${archive.name} archivado`)
      setArchive(null)
      cohorts.reload({ silent: true })
    } catch (err) {
      toast('⚠', errorText(err), 6000)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pn-stack is-lg">
      <Toolbar>
        <span className="pn-muted">Cada grupo tiene su sala y su chat dentro de la Academy.</span>
        <span className="pn-toolbar-spacer" />
        <Button variant="primary" icon="plus" onClick={() => setEdit({})}>Nuevo grupo</Button>
      </Toolbar>

      <LoadBlock
        loading={cohorts.loading}
        error={cohorts.error}
        onRetry={cohorts.reload}
        empty={list.length === 0}
        emptyIcon="users"
        emptyTitle="Todavía no hay grupos"
        emptyText="Crea una generación (p. ej. «Barbería Básico · Octubre») para juntar a sus alumnos en una sala con chat propio."
        emptyAction={{ label: 'Nuevo grupo', icon: 'plus', onClick: () => setEdit({}) }}
      >
        <Card flush>
          <List>
            {list.map((c) => {
              const course = c.course || (c.courseSlug ? courseBySlug.get(c.courseSlug) : null)
              const meta = [
                course?.title,
                c.startsOn ? `parte el ${fmtDay(c.startsOn)}` : null,
                `${c.memberCount ?? 0} ${c.memberCount === 1 ? 'miembro' : 'miembros'}${c.seats ? ` de ${c.seats} cupos` : ''}`,
              ].filter(Boolean).join(' · ')
              return (
                <ListRow
                  key={c.id}
                  onClick={() => setEdit(c)}
                  lead={<span className="pn-thumb">{c.coverUrl && isImageUrl(c.coverUrl) ? <img src={c.coverUrl} alt="" loading="lazy" /> : <Icon name="users" size={18} />}</span>}
                  title={c.name}
                  subtitle={meta}
                  subtitleWrap
                  trailing={c.salesOpen ? <Chip tone="accent" icon="cart">En venta</Chip> : null}
                  actions={(
                    <ActionMenu
                      small
                      title={c.name}
                      items={[
                        { label: 'Editar', icon: 'pencil', onClick: () => setEdit(c) },
                        { label: 'Miembros', icon: 'users', onClick: () => setMembers(c) },
                        { label: 'Abrir sala y chat', icon: 'link', hint: 'En la Academy, como propietario', onClick: () => openChat(c) },
                        { label: 'Archivar', icon: 'box', danger: true, onClick: () => setArchive(c) },
                      ]}
                    />
                  )}
                />
              )
            })}
          </List>
        </Card>
      </LoadBlock>

      <CohortSheet
        open={Boolean(edit)}
        cohort={edit && edit.id ? edit : null}
        courses={courses}
        courseBySlug={courseBySlug}
        api={api}
        onClose={() => setEdit(null)}
        onMembers={(c) => { setEdit(null); setTimeout(() => setMembers(c), 220) }}
        onSaved={(saved, wasNew) => {
          toast('✓', wasNew ? 'Grupo creado' : 'Grupo guardado')
          setEdit(null)
          cohorts.reload({ silent: true })
          if (wasNew && saved?.id) setTimeout(() => setMembers(saved), 220)
        }}
      />

      <CohortMembersSheet
        open={Boolean(members)}
        cohort={members}
        api={api}
        toast={toast}
        onClose={() => setMembers(null)}
        onChanged={() => cohorts.reload({ silent: true })}
      />

      <ConfirmDialog
        open={Boolean(archive)}
        tone="danger"
        title={`¿Archivar ${archive?.name || 'este grupo'}?`}
        message="Deja de aparecer en la Academy y en el catálogo. Sus miembros y sus cursos no cambian."
        confirmLabel="Archivar"
        busy={busy}
        onCancel={() => setArchive(null)}
        onConfirm={doArchive}
      />
    </div>
  )
}

/* ---------------- Crear / editar grupo ---------------- */

function CohortSheet({ open, cohort, courses, courseBySlug, api, onClose, onSaved, onMembers }) {
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!open) return
    setErr('')
    const courseId = cohort?.courseId ?? (cohort?.course?.slug ? courseBySlug.get(cohort.course.slug)?.id : null) ?? (cohort?.courseSlug ? courseBySlug.get(cohort.courseSlug)?.id : null)
    setDraft({
      name: cohort?.name || '',
      description: cohort?.description || '',
      coverUrl: cohort?.coverUrl || '',
      courseId: courseId ? String(courseId) : '',
      startsOn: cohort?.startsOn ? String(cohort.startsOn).slice(0, 10) : '',
      seats: cohort?.seats ? String(cohort.seats) : '',
      salesOpen: Boolean(cohort?.salesOpen),
    })
  }, [open, cohort]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!draft) return <Sheet open={false} onClose={onClose} />

  const patch = (p) => { setDraft((d) => ({ ...d, ...p })); setErr('') }
  const seats = draft.seats ? Number(draft.seats) : null
  const seatsErr = draft.seats && (!Number.isInteger(seats) || seats < 1 || seats > 500) ? 'Entre 1 y 500' : null
  const selectedCourse = (courses.data || []).find((c) => String(c.id) === draft.courseId)
  const sellWarn = draft.salesOpen && (!selectedCourse || !selectedCourse.pricePresencial || !draft.startsOn)
  const canSave = draft.name.trim() && !seatsErr && !saving

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    setErr('')
    try {
      const out = await api.call('admin-cohort-save', {
        method: 'POST',
        body: {
          id: cohort?.id,
          name: draft.name.trim().slice(0, 80),
          description: draft.description.trim(),
          coverUrl: draft.coverUrl.trim() || null,
          courseId: draft.courseId ? Number(draft.courseId) : null,
          startsOn: draft.startsOn || null,
          seats,
          salesOpen: draft.salesOpen,
        },
      })
      onSaved(out.cohort, !cohort)
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
      title={cohort ? 'Editar grupo' : 'Nuevo grupo'}
      subtitle={cohort ? cohort.name : 'Una sala con chat propio dentro de la Academy'}
      icon="users"
      size="md"
      headActions={cohort ? <Button size="sm" icon="users" onClick={() => onMembers(cohort)}>Miembros</Button> : undefined}
      footer={(
        <>
          <Button onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" onClick={save} disabled={!canSave} loading={saving}>{cohort ? 'Guardar' : 'Crear grupo'}</Button>
        </>
      )}
    >
      <div className="pn-stack is-lg">
        <Field label="Nombre" hint="Ej.: «Barbería Básico · Octubre 2026»">
          <input className="input" value={draft.name} maxLength={80} onChange={(e) => patch({ name: e.target.value })} />
        </Field>
        <Field label="Descripción" optional>
          <textarea className="input" rows={3} maxLength={1000} value={draft.description} onChange={(e) => patch({ description: e.target.value })} />
        </Field>
        <CoverField value={draft.coverUrl} onChange={(v) => patch({ coverUrl: v })} kind="portada" api={api} />
        <Field label="Curso" optional hint="Si es una generación presencial, el curso que se vende con este grupo.">
          <select className="input" value={draft.courseId} onChange={(e) => patch({ courseId: e.target.value })} disabled={courses.loading}>
            <option value="">Sin curso</option>
            {(courses.data || []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </Field>
        {courses.error && <InlineAlert tone="warn" action={{ label: 'Reintentar', onClick: () => courses.reload() }}>{errorText(courses.error)}</InlineAlert>}
        <div className="pn-form-row">
          <Field label="Parte el" optional>
            <input className="input" type="date" value={draft.startsOn} onChange={(e) => patch({ startsOn: e.target.value })} />
          </Field>
          <Field label="Cupos" optional error={seatsErr} hint="Vacío = sin tope">
            <input className="input" inputMode="numeric" value={draft.seats} onChange={(e) => patch({ seats: e.target.value.replace(/[^\d]/g, '') })} />
          </Field>
        </div>
        <Card flush>
          <List>
            <ToggleRow
              title="Ventas abiertas (presencial)"
              description="En el catálogo, quien compra el curso presencial puede elegir esta generación."
              checked={draft.salesOpen}
              onChange={(v) => patch({ salesOpen: v })}
            />
          </List>
        </Card>
        {sellWarn && <InlineAlert tone="warn">Para venderse necesita un curso con precio presencial y una fecha de inicio.</InlineAlert>}
        {cohort?.partial && (
          <Note>No pudimos leer los cupos ni si tenía ventas abiertas: revísalos antes de guardar.</Note>
        )}
        {err && <InlineAlert tone="error">{err}</InlineAlert>}
      </div>
    </Sheet>
  )
}

/* ---------------- Miembros de un grupo ---------------- */

function CohortMembersSheet({ open, cohort, api, toast, onClose, onChanged }) {
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 350)
  const [pending, setPending] = useState(null) // id que se está agregando/quitando

  const current = useAdminLoad(async () => {
    if (!open || !cohort?.id) return []
    return (await api.call('admin-members', { query: { cohortId: cohort.id, all: 1 } })).members || []
  }, [open, cohort?.id])

  const search = useAdminLoad(async () => {
    if (!open || dq.length < 2) return []
    return (await api.call('admin-members', { query: { q: dq, status: 'activo', page: 1 } })).members || []
  }, [open, dq])

  useEffect(() => { if (open) setQ('') }, [open])

  const inGroup = new Set((current.data || []).map((m) => m.id))

  const change = async (member, add) => {
    setPending(member.id)
    try {
      await api.call('admin-cohort-members', { method: 'POST', body: { cohortId: cohort.id, [add ? 'add' : 'remove']: [member.id] } })
      toast('✓', add ? `${member.name} agregado al grupo` : `${member.name} salió del grupo`)
      await current.reload({ silent: true })
      onChanged()
    } catch (err) {
      toast('⚠', errorText(err), 5000)
    } finally {
      setPending(null)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Miembros del grupo"
      subtitle={cohort?.name}
      icon="users"
      size="md"
    >
      <div className="pn-stack is-lg">
        <div className="pn-stack">
          <SectionLabel>Agregar</SectionLabel>
          <SearchField value={q} onChange={setQ} placeholder="Busca por nombre o correo" />
          {dq.length >= 2 && (
            search.loading ? <p className="pn-muted">Buscando…</p> : search.error ? (
              <InlineAlert tone="error" action={{ label: 'Reintentar', onClick: () => search.reload() }}>{errorText(search.error)}</InlineAlert>
            ) : (search.data || []).length === 0 ? <p className="pn-muted">Nadie activo coincide con «{dq}».</p> : (
              <Card flush>
                <List>
                  {search.data.map((m) => (
                    <ListRow
                      key={m.id}
                      lead={<Avatar src={m.avatarUrl} name={m.name} size={32} />}
                      title={m.name}
                      subtitle={m.email}
                      trailing={inGroup.has(m.id)
                        ? <Chip tone="ok" icon="check">En el grupo</Chip>
                        : <Button size="sm" icon="plus" loading={pending === m.id} onClick={() => change(m, true)}>Agregar</Button>}
                    />
                  ))}
                </List>
              </Card>
            )
          )}
        </div>

        <div className="pn-stack">
          <SectionLabel>En el grupo{current.data ? ` · ${current.data.length}` : ''}</SectionLabel>
          <LoadBlock
            loading={current.loading}
            error={current.error}
            onRetry={current.reload}
            rows={3}
            empty={(current.data || []).length === 0}
            emptyIcon="users"
            emptyTitle="Nadie todavía"
            emptyText="Busca arriba para agregar miembros. Quien compra la generación presencial entra solo."
          >
            <Card flush>
              <List>
                {(current.data || []).map((m) => (
                  <ListRow
                    key={m.id}
                    lead={<Avatar src={m.avatarUrl} name={m.name} size={32} />}
                    title={m.name}
                    subtitle={m.email}
                    trailing={<Button size="sm" variant="plain" loading={pending === m.id} onClick={() => change(m, false)}>Quitar</Button>}
                  />
                ))}
              </List>
            </Card>
          </LoadBlock>
        </div>
      </div>
    </Sheet>
  )
}
