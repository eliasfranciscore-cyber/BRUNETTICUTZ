import React, { useMemo, useState } from 'react'
import { downloadCsv } from '../../../academy/csv.js'
import { r } from '../../../academy/routes.js'
import {
  Avatar, Button, Card, Chip, ChoiceGrid, ConfirmDialog, DataTable, Field, FilterChips,
  InlineAlert, List, ListRow, Note, SearchField, SectionLabel, Sheet, Toolbar, ToggleRow, ActionMenu,
} from '../../../components/panel/index.js'
import { errorText, useAdminLoad, useDebounced } from './adminApi.js'
import {
  GRANT_STATE, LoadBlock, MEMBER_STATUS, ROLE_LABEL, SOURCE_LABEL, StatusChip, accessState, credentialsText,
  fmtWhen, todayStamp,
} from './ui.jsx'

/* Miembros de la Academy (admin-members). Tabla en escritorio, lista en el
   celular. Todas las acciones pasan por el backend, que es quien decide los
   permisos finos (p. ej. cambiar rol o correo = solo propietario): acá se
   ofrecen y, si el servidor dice que no, se muestra su mensaje. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const STATUS_FILTERS = [
  { value: '', label: 'Todos' },
  { value: 'activo', label: 'Activos' },
  { value: 'cancelado', label: 'Cancelados' },
  { value: 'expulsado', label: 'Expulsados' },
]

export default function MiembrosSection({ api, ctx, reloadKey }) {
  const toast = ctx.pushToast
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 350)
  const [status, setStatus] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [sheet, setSheet] = useState(null)      // { type, member }
  const [confirm, setConfirm] = useState(null)  // { type, member }
  const [busy, setBusy] = useState(false)

  const list = useAdminLoad(async () => {
    const data = await api.call('admin-members', { query: { status, q: dq.length >= 2 ? dq : '', page: 1 } })
    return { members: data.members || [], total: data.total ?? (data.members || []).length, counts: data.counts || {}, page: 1 }
  }, [status, dq, reloadKey])

  // Cursos y grupos para "Invitar" y "Dar curso". Se piden una vez; si
  // fallan, esas hojas lo dicen en vez de ofrecer una lista vacía.
  const courses = useAdminLoad(async () => (await api.call('admin-courses')).courses || [], [reloadKey])
  const cohorts = useAdminLoad(async () => (await api.memberCall('cohorts')).cohorts || [], [reloadKey])

  const members = list.data?.members || []
  const total = list.data?.total || 0
  const counts = list.data?.counts || {}

  const loadMore = async () => {
    if (loadingMore || !list.data) return
    setLoadingMore(true)
    try {
      const next = list.data.page + 1
      const data = await api.call('admin-members', { query: { status, q: dq.length >= 2 ? dq : '', page: next } })
      const incoming = data.members || []
      list.setData((d) => {
        const seen = new Set(d.members.map((m) => m.id))
        return { ...d, members: [...d.members, ...incoming.filter((m) => !seen.has(m.id))], page: next, total: data.total ?? d.total }
      })
    } catch (err) {
      toast('⚠', errorText(err), 5000)
    } finally {
      setLoadingMore(false)
    }
  }

  // Reemplaza una fila con lo que devolvió el servidor (o recarga en silencio
  // si la respuesta no trae el miembro).
  const applyMember = (member) => {
    if (member?.id) {
      list.setData((d) => (d ? { ...d, members: d.members.map((m) => (m.id === member.id ? { ...m, ...member } : m)) } : d))
      setSheet((s) => (s && s.member?.id === member.id ? { ...s, member: { ...s.member, ...member } } : s))
    } else {
      list.reload({ silent: true })
    }
  }

  const run = async (fn, okMsg) => {
    setBusy(true)
    try {
      const out = await fn()
      if (okMsg) toast('✓', typeof okMsg === 'function' ? okMsg(out) : okMsg, 4500)
      return out
    } catch (err) {
      toast('⚠', errorText(err), 6000)
      return null
    } finally {
      setBusy(false)
    }
  }

  const resendAccess = (m) => run(
    () => api.call('admin-resend-access', { method: 'POST', body: { id: m.id } }),
    (out) => credentialsText(out?.credentials) || `Acceso reenviado a ${m.email}`,
  ).then((out) => { if (out) list.reload({ silent: true }) })

  const passwordLink = (m) => run(
    () => api.call('admin-password-link', { method: 'POST', body: { id: m.id } }),
    `Enviamos un enlace para crear contraseña a ${m.email}`,
  )

  const setMemberStatus = async (m, next, extra = {}) => {
    const out = await run(
      () => api.call('admin-member-update', { method: 'POST', body: { id: m.id, status: next, ...extra } }),
      next === 'expulsado' ? `${m.name} quedó expulsado` : `${m.name} quedó activo otra vez`,
    )
    if (out) { applyMember(out.member); setConfirm(null) }
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const data = await api.call('admin-members', { query: { all: 1, status, q: dq.length >= 2 ? dq : '' } })
      const rows = data.members || []
      const head = ['ID', 'Nombre', 'Correo', 'Teléfono', 'Usuario', 'Rol', 'Estado', 'Origen', 'Se unió', 'Último ingreso', 'Nivel', 'Puntos', 'Cursos', 'Grupos']
      const body = rows.map((m) => [
        m.id, m.name, m.email, m.phone || '', m.handle || '', ROLE_LABEL[m.role] || m.role, MEMBER_STATUS[m.status]?.label || m.status,
        SOURCE_LABEL[m.source] || m.source || '', fmtWhen(m.joinedAt), m.lastLoginAt ? fmtWhen(m.lastLoginAt) : '',
        m.level ?? '', m.points ?? '',
        (m.grants || []).filter((g) => g.state === 'activa').map((g) => g.courseTitle).join(' | '),
        (m.cohorts || []).map((c) => c.name).join(' | '),
      ])
      // downloadCsv pasa cada celda por csvCell (anti fórmulas de Excel) y
      // agrega el BOM para las tildes.
      downloadCsv([head, ...body], `academy-miembros-${todayStamp()}.csv`)
      toast('✓', `${rows.length} ${rows.length === 1 ? 'miembro exportado' : 'miembros exportados'}`)
    } catch (err) {
      toast('⚠', errorText(err), 5000)
    } finally {
      setExporting(false)
    }
  }

  const actionsFor = (m) => {
    const locked = m.role === 'propietario'
    const activeGrants = (m.grants || []).filter((g) => g.state === 'activa')
    return [
      { label: 'Ver detalle', icon: 'eye', onClick: () => setSheet({ type: 'detail', member: m }) },
      { label: 'Reenviar acceso', icon: 'mail', hint: 'Contraseña temporal o enlace nuevo', onClick: () => resendAccess(m), hidden: locked || m.status !== 'activo' },
      { label: 'Enlace de contraseña', icon: 'key', onClick: () => passwordLink(m), hidden: locked || m.status !== 'activo' },
      { label: 'Dar curso', icon: 'gift', onClick: () => setSheet({ type: 'grant', member: m }), hidden: m.status === 'expulsado' },
      { label: 'Revocar curso', icon: 'lock', onClick: () => setSheet({ type: 'revoke', member: m }), hidden: activeGrants.length === 0 },
      { label: 'Cambiar rol', icon: 'shield', hint: 'Solo el propietario', onClick: () => setSheet({ type: 'role', member: m }), hidden: locked },
      { label: 'Cambiar correo', icon: 'pencil', hint: 'Transfiere la cuenta', onClick: () => setSheet({ type: 'email', member: m }), hidden: locked },
      { label: 'Reactivar', icon: 'refresh', onClick: () => setConfirm({ type: 'reactivar', member: m }), hidden: locked || m.status === 'activo' },
      { label: 'Expulsar', icon: 'close', danger: true, onClick: () => setConfirm({ type: 'expulsar', member: m, purge: false }), hidden: locked || m.status === 'expulsado' },
    ]
  }

  const statusOptions = STATUS_FILTERS.map((o) => ({
    ...o,
    count: typeof counts[o.value || 'total'] === 'number' ? counts[o.value || 'total'] : undefined,
  }))

  return (
    <div className="pn-stack is-lg">
      <Toolbar stackOnPhone>
        <SearchField value={q} onChange={setQ} placeholder="Buscar por nombre o correo" className="pn-aca-search" />
        <FilterChips ariaLabel="Estado" value={status} onChange={setStatus} options={statusOptions} />
        <span className="pn-toolbar-spacer" />
        <div className="pn-hstack">
          <Button icon="download" onClick={exportCsv} loading={exporting}>Exportar CSV</Button>
          <Button variant="primary" icon="plus" onClick={() => setSheet({ type: 'invite' })}>Invitar</Button>
        </div>
      </Toolbar>

      <LoadBlock
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        empty={members.length === 0}
        emptyIcon="users"
        emptyTitle={dq || status ? 'Nadie coincide con ese filtro' : 'Todavía no hay miembros'}
        emptyText={dq || status ? 'Prueba con otro nombre o cambia el estado.' : 'Cada compra crea su cuenta sola. También puedes invitar a alguien a mano.'}
        emptyAction={dq || status ? undefined : { label: 'Invitar', icon: 'plus', onClick: () => setSheet({ type: 'invite' }) }}
      >
        <Card flush>
          <DataTable
            ariaLabel="Miembros de la Academy"
            rows={members}
            rowKey={(m) => m.id}
            rowDim={(m) => m.status !== 'activo'}
            onRowClick={(m) => setSheet({ type: 'detail', member: m })}
            columns={[
              {
                key: 'name', label: 'Miembro',
                render: (m) => (
                  <span className="pn-aca-person">
                    <Avatar src={m.avatarUrl} name={m.name} size={32} />
                    <span>
                      <b>{m.name}</b>
                      <small>{m.email}</small>
                    </span>
                  </span>
                ),
              },
              { key: 'role', label: 'Rol', nowrap: true, render: (m) => (m.role === 'miembro' ? <span className="pn-muted">Miembro</span> : <Chip tone="info">{ROLE_LABEL[m.role] || m.role}</Chip>) },
              { key: 'status', label: 'Estado', nowrap: true, render: (m) => <StatusChip map={MEMBER_STATUS} value={m.status} /> },
              { key: 'grants', label: 'Cursos', render: (m) => grantsSummary(m) },
              { key: 'access', label: 'Acceso', muted: true, render: (m) => accessState(m) },
              { key: 'joined', label: 'Se unió', nowrap: true, muted: true, render: (m) => fmtWhen(m.joinedAt) },
              {
                key: 'actions', label: '', className: 'pn-aca-cell-actions',
                render: (m) => <span onClick={(e) => e.stopPropagation()}><ActionMenu small items={actionsFor(m)} title={m.name} /></span>,
              },
            ]}
            mobile={(m) => ({
              lead: <Avatar src={m.avatarUrl} name={m.name} size={36} />,
              title: m.role !== 'miembro' ? `${m.name} · ${ROLE_LABEL[m.role] || m.role}` : m.name,
              subtitle: `${m.email} · ${MEMBER_STATUS[m.status]?.label || m.status}`,
              chevron: false,
              actions: <ActionMenu small items={actionsFor(m)} title={m.name} />,
            })}
          />
        </Card>
        <div className="pn-between">
          <span className="pn-muted">{members.length} de {total}</span>
          {members.length < total && (
            <Button variant="plain" onClick={loadMore} loading={loadingMore} iconRight="chevronDown">Cargar más</Button>
          )}
        </div>
      </LoadBlock>

      <InviteSheet
        open={sheet?.type === 'invite'}
        onClose={() => setSheet(null)}
        api={api}
        courses={courses}
        cohorts={cohorts}
        onDone={(out) => {
          setSheet(null)
          toast('✓', `${out.created === false ? 'Ya era miembro: le sumamos los cursos. ' : ''}${credentialsText(out.credentials)}`, 6000)
          list.reload({ silent: true })
        }}
      />

      <MemberSheet
        open={sheet?.type === 'detail'}
        member={sheet?.type === 'detail' ? sheet.member : null}
        onClose={() => setSheet(null)}
        actions={sheet?.member ? actionsFor(sheet.member).filter((a) => a.label !== 'Ver detalle') : []}
        onRevokeGrant={(g) => setSheet({ type: 'revoke', member: sheet.member, grantId: g.id })}
        onOpenProfile={(m) => api.openAcademy(r.profile(m.handle)).catch((err) => toast('⚠', errorText(err), 5000))}
      />

      <GrantSheet
        open={sheet?.type === 'grant'}
        member={sheet?.member}
        courses={courses}
        busy={busy}
        onClose={() => setSheet(null)}
        onSubmit={async (courseId) => {
          const out = await run(() => api.call('admin-grant', { method: 'POST', body: { memberId: sheet.member.id, courseId } }), 'Curso agregado')
          if (out) { setSheet(null); list.reload({ silent: true }) }
        }}
      />

      <RevokeSheet
        open={sheet?.type === 'revoke'}
        member={sheet?.member}
        initialGrantId={sheet?.grantId}
        busy={busy}
        onClose={() => setSheet(null)}
        onSubmit={async (grantId, reason) => {
          const out = await run(() => api.call('admin-revoke', { method: 'POST', body: { grantId, reason } }), 'Acceso al curso revocado')
          if (out) { setSheet(null); list.reload({ silent: true }) }
        }}
      />

      <RoleSheet
        open={sheet?.type === 'role'}
        member={sheet?.member}
        busy={busy}
        onClose={() => setSheet(null)}
        onSubmit={async (role) => {
          const out = await run(() => api.call('admin-member-update', { method: 'POST', body: { id: sheet.member.id, role } }), `Ahora es ${ROLE_LABEL[role]}`)
          if (out) { applyMember(out.member); setSheet(null) }
        }}
      />

      <EmailSheet
        open={sheet?.type === 'email'}
        member={sheet?.member}
        busy={busy}
        onClose={() => setSheet(null)}
        onSubmit={async (email) => {
          const out = await run(() => api.call('admin-member-update', { method: 'POST', body: { id: sheet.member.id, email } }), `Cuenta transferida a ${email}. Le enviamos sus credenciales.`)
          if (out) { applyMember(out.member); setSheet(null) }
        }}
      />

      <ConfirmDialog
        open={confirm?.type === 'expulsar'}
        tone="danger"
        title={`¿Expulsar a ${confirm?.member?.name || ''}?`}
        message="Se cierra su sesión en todos sus dispositivos y no podrá volver a entrar ni comprar con ese correo."
        confirmLabel="Expulsar"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => setMemberStatus(confirm.member, 'expulsado', { purgeRecent: Boolean(confirm.purge) })}
      >
        <div className="pn-aca-confirm-extra">
          <ToggleRow
            title="Borrar lo que publicó los últimos 7 días"
            description="Publicaciones y comentarios. Útil si entró a hacer spam."
            checked={Boolean(confirm?.purge)}
            onChange={(v) => setConfirm((c) => ({ ...c, purge: v }))}
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm?.type === 'reactivar'}
        title={`¿Reactivar a ${confirm?.member?.name || ''}?`}
        message="Vuelve a entrar con su contraseña de siempre. Sus cursos revocados siguen revocados: dáselos de nuevo si corresponde."
        confirmLabel="Reactivar"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => setMemberStatus(confirm.member, 'activo')}
      />
    </div>
  )
}

function grantsSummary(m) {
  const active = (m.grants || []).filter((g) => g.state === 'activa')
  if (!active.length) return <span className="pn-muted">—</span>
  const names = active.map((g) => g.courseTitle).filter(Boolean)
  return <span className="pn-aca-clamp" title={names.join('\n')}>{names.length === 1 ? names[0] : `${names.length} cursos`}</span>
}

/* ---------- Hojas ---------- */

function InviteSheet({ open, onClose, api, courses, cohorts, onDone }) {
  const [draft, setDraft] = useState({ name: '', email: '', courseIds: [], cohortId: '' })
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const patch = (p) => { setDraft((d) => ({ ...d, ...p })); setErr('') }

  React.useEffect(() => { if (open) { setDraft({ name: '', email: '', courseIds: [], cohortId: '' }); setErr('') } }, [open])

  const email = draft.email.trim()
  const emailOk = EMAIL_RE.test(email) && email.length <= 120
  const canSubmit = draft.name.trim().length > 0 && emailOk && !saving

  const submit = async () => {
    if (!canSubmit) return
    setSaving(true)
    setErr('')
    try {
      const out = await api.call('admin-invite', {
        method: 'POST',
        body: {
          name: draft.name.trim().slice(0, 80),
          email,
          courseIds: draft.courseIds,
          cohortId: draft.cohortId ? Number(draft.cohortId) : undefined,
        },
      })
      onDone(out)
    } catch (e) {
      setErr(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  const toggleCourse = (id, on) => patch({ courseIds: on ? [...new Set([...draft.courseIds, id])] : draft.courseIds.filter((x) => x !== id) })
  const courseList = courses.data || []
  const cohortList = (cohorts.data || []).filter((c) => !c.archivedAt)

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Invitar a la Academy"
      subtitle="Le llega un correo con su usuario y una contraseña temporal"
      icon="mail"
      size="md"
      footer={(
        <>
          <Button onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit} loading={saving}>Invitar</Button>
        </>
      )}
    >
      <div className="pn-stack is-lg">
        <div className="pn-form-row">
          <Field label="Nombre">
            <input className="input" value={draft.name} maxLength={80} onChange={(e) => patch({ name: e.target.value })} autoComplete="off" />
          </Field>
          <Field label="Correo" error={email && !emailOk ? 'Revisa el correo' : null}>
            <input className="input" type="email" inputMode="email" autoCapitalize="off" autoCorrect="off" value={draft.email} maxLength={120} onChange={(e) => patch({ email: e.target.value })} />
          </Field>
        </div>

        <div className="pn-stack">
          <SectionLabel>Cursos que recibe</SectionLabel>
          {courses.loading ? <p className="pn-muted">Cargando cursos…</p> : courses.error ? (
            <InlineAlert tone="warn" action={{ label: 'Reintentar', onClick: () => courses.reload() }}>{errorText(courses.error)}</InlineAlert>
          ) : courseList.length === 0 ? (
            <p className="pn-muted">No hay cursos todavía: se puede invitar solo a la comunidad.</p>
          ) : (
            <Card flush>
              <List>
                {courseList.map((c) => (
                  <ToggleRow
                    key={c.id}
                    title={c.title}
                    description={c.published ? undefined : 'Borrador (no lo verá hasta que lo publiques)'}
                    checked={draft.courseIds.includes(c.id)}
                    onChange={(v) => toggleCourse(c.id, v)}
                  />
                ))}
              </List>
            </Card>
          )}
        </div>

        <Field label="Grupo" optional hint="Lo agrega a la sala y al chat de esa generación.">
          {cohorts.error ? (
            <InlineAlert tone="warn" action={{ label: 'Reintentar', onClick: () => cohorts.reload() }}>{errorText(cohorts.error)}</InlineAlert>
          ) : (
            <select className="input" value={draft.cohortId} onChange={(e) => patch({ cohortId: e.target.value })} disabled={cohorts.loading}>
              <option value="">Sin grupo</option>
              {cohortList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </Field>

        {err && <InlineAlert tone="error">{err}</InlineAlert>}
        <Note>Si el correo ya tiene cuenta, no se crea otra: se le suman los cursos y se le avisa.</Note>
      </div>
    </Sheet>
  )
}

function MemberSheet({ open, member, onClose, actions, onRevokeGrant, onOpenProfile }) {
  // Se recuerda el último miembro para que la hoja no quede vacía mientras
  // se anima al cerrarse.
  const last = React.useRef(member)
  if (member) last.current = member
  const m = member || last.current
  if (!m) return null
  const grants = m.grants || []
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={m.name}
      subtitle={m.email}
      lead={<Avatar src={m.avatarUrl} name={m.name} size={40} />}
      size="md"
      headActions={actions.length ? <ActionMenu items={actions} title={m.name} /> : undefined}
    >
      <div className="pn-stack is-lg">
        <div className="pn-hstack">
          <StatusChip map={MEMBER_STATUS} value={m.status} />
          <Chip tone={m.role === 'miembro' ? 'muted' : 'info'}>{ROLE_LABEL[m.role] || m.role}</Chip>
          {m.level ? <Chip tone="muted">Nivel {m.level} · {m.points ?? 0} pts</Chip> : null}
          {m.mustChangePassword && <Chip tone="warn">Contraseña temporal</Chip>}
        </div>

        <Card flush>
          <List>
            <ListRow title="Usuario" value={m.handle ? `@${m.handle}` : '—'} />
            <ListRow title="Teléfono" value={m.phone ? `+56 ${m.phone}` : '—'} />
            <ListRow title="Origen" value={SOURCE_LABEL[m.source] || m.source || '—'} />
            <ListRow title="Se unió" value={fmtWhen(m.joinedAt)} />
            <ListRow title="Acceso" value={accessState(m)} />
            {m.lastSeenAt && <ListRow title="Visto por última vez" value={fmtWhen(m.lastSeenAt)} />}
          </List>
        </Card>

        <div className="pn-stack">
          <SectionLabel>Cursos</SectionLabel>
          {grants.length === 0 ? <p className="pn-muted">Sin cursos: solo la comunidad.</p> : (
            <Card flush>
              <List>
                {grants.map((g) => (
                  <ListRow
                    key={g.id}
                    title={g.courseTitle || `Curso ${g.courseId}`}
                    subtitle={SOURCE_LABEL[g.source] || g.source}
                    trailing={(
                      <span className="pn-hstack">
                        <StatusChip map={GRANT_STATE} value={g.state} />
                        {g.state === 'activa' && <Button size="sm" variant="plain" onClick={() => onRevokeGrant(g)}>Revocar</Button>}
                      </span>
                    )}
                  />
                ))}
              </List>
            </Card>
          )}
        </div>

        {(m.cohorts || []).length > 0 && (
          <div className="pn-stack">
            <SectionLabel>Grupos</SectionLabel>
            <div className="pn-hstack">{m.cohorts.map((c) => <Chip key={c.id} tone="muted" icon="users">{c.name}</Chip>)}</div>
          </div>
        )}

        {m.handle && m.status === 'activo' && (
          <Button icon="link" onClick={() => onOpenProfile(m)}>Ver su perfil en la Academy</Button>
        )}
      </div>
    </Sheet>
  )
}

function GrantSheet({ open, member, courses, busy, onClose, onSubmit }) {
  const [courseId, setCourseId] = useState('')
  React.useEffect(() => { if (open) setCourseId('') }, [open])
  const owned = useMemo(() => new Set((member?.grants || []).filter((g) => g.state === 'activa').map((g) => g.courseId)), [member])
  const options = (courses.data || []).filter((c) => !owned.has(c.id))
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Dar curso"
      subtitle={member ? `${member.name} · acceso de por vida, sin cobro` : undefined}
      icon="gift"
      size="sm"
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" disabled={!courseId || busy} loading={busy} onClick={() => onSubmit(Number(courseId))}>Dar acceso</Button>
        </>
      )}
    >
      <div className="pn-stack">
        {courses.error ? <InlineAlert tone="error" action={{ label: 'Reintentar', onClick: () => courses.reload() }}>{errorText(courses.error)}</InlineAlert> : (
          <Field label="Curso">
            <select className="input" value={courseId} onChange={(e) => setCourseId(e.target.value)} disabled={courses.loading}>
              <option value="">{courses.loading ? 'Cargando…' : options.length ? 'Elige un curso' : 'Ya tiene todos los cursos'}</option>
              {options.map((c) => <option key={c.id} value={c.id}>{c.title}{c.published ? '' : ' (borrador)'}</option>)}
            </select>
          </Field>
        )}
      </div>
    </Sheet>
  )
}

function RevokeSheet({ open, member, initialGrantId, busy, onClose, onSubmit }) {
  const active = (member?.grants || []).filter((g) => g.state === 'activa')
  const [grantId, setGrantId] = useState('')
  const [reason, setReason] = useState('')
  React.useEffect(() => {
    if (!open) return
    setGrantId(initialGrantId ? String(initialGrantId) : (active.length === 1 ? String(active[0].id) : ''))
    setReason('')
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const ok = grantId && reason.trim().length >= 3 && !busy
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Revocar curso"
      subtitle={member?.name}
      icon="lock"
      size="sm"
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="danger-solid" disabled={!ok} loading={busy} onClick={() => onSubmit(Number(grantId), reason.trim())}>Revocar</Button>
        </>
      )}
    >
      <div className="pn-stack is-lg">
        <Field label="Curso">
          <select className="input" value={grantId} onChange={(e) => setGrantId(e.target.value)}>
            <option value="">Elige un curso</option>
            {active.map((g) => <option key={g.id} value={g.id}>{g.courseTitle || `Curso ${g.courseId}`}</option>)}
          </select>
        </Field>
        <Field label="Motivo" hint="Queda en el registro. Ej.: reembolso por transferencia, error de invitación.">
          <textarea className="input" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Note icon="alert">Esto no devuelve plata en Mercado Pago. Si no le queda otro curso activo, su cuenta pasa a Cancelado.</Note>
      </div>
    </Sheet>
  )
}

function RoleSheet({ open, member, busy, onClose, onSubmit }) {
  const [role, setRole] = useState('miembro')
  React.useEffect(() => { if (open && member) setRole(member.role === 'propietario' ? 'admin' : member.role) }, [open, member])
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Cambiar rol"
      subtitle={member?.name}
      icon="shield"
      size="sm"
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" disabled={busy || role === member?.role} loading={busy} onClick={() => onSubmit(role)}>Guardar</Button>
        </>
      )}
    >
      <div className="pn-stack is-lg">
        <ChoiceGrid
          ariaLabel="Rol"
          value={role}
          onChange={setRole}
          options={[
            { value: 'admin', label: 'Admin', icon: 'shield' },
            { value: 'moderador', label: 'Moderador', icon: 'eye' },
            { value: 'miembro', label: 'Miembro', icon: 'user' },
          ]}
        />
        <p className="pn-muted">
          {role === 'admin' && 'Ve todos los cursos, gestiona miembros, eventos y ajustes de la comunidad.'}
          {role === 'moderador' && 'Puede ocultar publicaciones y comentarios, revisar reportes y crear eventos.'}
          {role === 'miembro' && 'Participa en la comunidad y ve los cursos que tiene.'}
        </p>
        <Note>Solo el propietario de la Academy puede cambiar roles.</Note>
      </div>
    </Sheet>
  )
}

function EmailSheet({ open, member, busy, onClose, onSubmit }) {
  const [email, setEmail] = useState('')
  const [again, setAgain] = useState('')
  React.useEffect(() => { if (open) { setEmail(''); setAgain('') } }, [open])
  const e = email.trim()
  const ok = EMAIL_RE.test(e) && e.length <= 120 && e.toLowerCase() === again.trim().toLowerCase() && e.toLowerCase() !== String(member?.email || '').toLowerCase()
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Cambiar correo"
      subtitle={member ? `Hoy: ${member.email}` : undefined}
      icon="mail"
      size="sm"
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="danger-solid" disabled={!ok || busy} loading={busy} onClick={() => onSubmit(e)}>Transferir cuenta</Button>
        </>
      )}
    >
      <div className="pn-stack is-lg">
        <Field label="Correo nuevo">
          <input className="input" type="email" inputMode="email" autoCapitalize="off" autoCorrect="off" value={email} onChange={(ev) => setEmail(ev.target.value)} />
        </Field>
        <Field label="Repite el correo" error={again && e.toLowerCase() !== again.trim().toLowerCase() ? 'No coinciden' : null}>
          <input className="input" type="email" inputMode="email" autoCapitalize="off" autoCorrect="off" value={again} onChange={(ev) => setAgain(ev.target.value)} />
        </Field>
        <InlineAlert tone="warn" title="Es una transferencia de cuenta">
          Se borra su contraseña, se cierran sus sesiones y al correo nuevo le llega una contraseña temporal. Úsalo cuando
          alguien compró con un correo mal escrito, no para cambios de rutina (eso lo hace el miembro desde Ajustes).
        </InlineAlert>
      </div>
    </Sheet>
  )
}
