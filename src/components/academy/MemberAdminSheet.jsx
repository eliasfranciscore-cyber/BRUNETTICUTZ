import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '../../academy/Icon.jsx'
import {
  Sheet, ConfirmDialog, Button, Chip, SectionLabel, List, ListRow, Segmented, Field, InlineAlert, Note, SkeletonRows,
} from '../panel/index.js'
import MemberAvatar from './MemberAvatar.jsx'
import { useAcademy } from '../../academy/context.js'
import { academyApi } from '../../academy/api.js'
import { useAcademyQuery } from '../../academy/useQuery.js'
import {
  CREDENTIALS_TEXT, GRANT_STATE, ROLE_LABEL, SOURCE_LABEL, STATUS_LABEL, errorText, fmtDay, fmtDayTime,
} from './MemberCard.jsx'
import '../../styles/academy/miembros.css'

/* ============================================================
   Hoja de administración de un miembro (⋯ en la tarjeta).
   Reglas de permisos (§5.6): el rol y el correo los cambia solo el
   propietario; nadie asigna "propietario"; un admin no toca filas de
   propietario/admin. El servidor las vuelve a validar: acá solo se evita
   ofrecer botones que igual van a responder 403.
   ============================================================ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export default function MemberAdminSheet({ open, member, onClose, onChanged }) {
  const { me, isOwner, isAdmin, toast } = useAcademy()
  const [local, setLocal] = useState(member || null)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState(null) // { tone, text }
  const [confirm, setConfirm] = useState(null) // { kind, ... }
  const [purge, setPurge] = useState(false)
  const [reason, setReason] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [grantCourse, setGrantCourse] = useState('')
  const [addCohort, setAddCohort] = useState('')

  useEffect(() => { if (member) setLocal(member) }, [member])
  useEffect(() => {
    if (!open) return
    setNotice(null); setConfirm(null); setGrantCourse(''); setAddCohort(''); setNewEmail('')
  }, [open, member?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const courses = useAcademyQuery('mi:courses', () => academyApi('courses'), { enabled: Boolean(open), refetchOnFocus: false })
  const cohorts = useAcademyQuery('mi:cohorts', () => academyApi('cohorts'), { enabled: Boolean(open), refetchOnFocus: false })

  const m = local
  const viewerIsOwner = Boolean(isOwner)
  const viewerIsAdmin = Boolean(isAdmin || isOwner)
  const isSelf = m && me && Number(me.id) === Number(m.id)
  const targetProtected = m && (m.role === 'propietario' || (!viewerIsOwner && m.role === 'admin'))
  const canEdit = Boolean(m && viewerIsAdmin && !isSelf && !targetProtected)

  const grants = Array.isArray(m?.grants) ? m.grants : []
  const memberCohorts = Array.isArray(m?.cohorts) ? m.cohorts : []
  const activeCourseIds = useMemo(
    () => new Set(grants.filter((g) => g.state !== 'revocada').map((g) => Number(g.courseId))),
    [grants],
  )
  const courseList = (courses.data?.courses || []).filter((c) => !activeCourseIds.has(Number(c.id)))
  const cohortIds = new Set(memberCohorts.map((c) => Number(c.id)))
  const cohortList = (cohorts.data?.cohorts || []).filter((c) => !cohortIds.has(Number(c.id)))

  const run = async (key, fn, { success, after } = {}) => {
    setBusy(key)
    setNotice(null)
    try {
      const res = await fn()
      if (res?.member) setLocal((prev) => ({ ...prev, ...res.member }))
      after?.(res)
      if (success) {
        const text = typeof success === 'function' ? success(res) : success
        setNotice({ tone: 'success', text })
      }
      onChanged?.()
      return res
    } catch (e) {
      setNotice({ tone: 'error', text: errorText(e) })
      return null
    } finally {
      setBusy('')
    }
  }

  if (!m) return null

  const resend = () => run('resend', () => academyApi('admin-resend-access', { method: 'POST', body: { id: m.id } }), {
    success: (res) => CREDENTIALS_TEXT[res?.credentials] || 'Listo: le reenviamos el acceso.',
  })
  const passwordLink = () => run('pwlink', () => academyApi('admin-password-link', { method: 'POST', body: { id: m.id } }), {
    success: `Le enviamos a ${m.email || 'su correo'} un enlace para crear una contraseña nueva (vence en 30 minutos).`,
  })
  const changeRole = (role) => run('role', () => academyApi('admin-member-update', { method: 'POST', body: { id: m.id, role } }), {
    success: `Ahora es ${ROLE_LABEL[role] || role}.`,
    after: () => setLocal((prev) => ({ ...prev, role })),
  })
  const grant = () => {
    const courseId = Number(grantCourse)
    if (!courseId) return
    const course = (courses.data?.courses || []).find((c) => Number(c.id) === courseId)
    run('grant', () => academyApi('admin-grant', { method: 'POST', body: { memberId: m.id, courseId } }), {
      success: `Le diste acceso a ${course?.title || 'el curso'}.`,
      after: (res) => {
        setGrantCourse('')
        setLocal((prev) => ({
          ...prev,
          grants: [
            ...(prev.grants || []).filter((g) => Number(g.courseId) !== courseId),
            { id: res?.grant?.id, courseId, courseTitle: course?.title || 'Curso', state: res?.grant?.state || 'activa', source: 'manual' },
          ],
        }))
      },
    })
  }
  const revoke = (g) => run('revoke', () => academyApi('admin-revoke', {
    method: 'POST',
    body: { grantId: g.id, reason: reason.trim() || 'Revocado desde la Academy' },
  }), {
    success: `Quitaste el acceso a ${g.courseTitle || 'el curso'}.`,
    after: () => {
      setConfirm(null); setReason('')
      setLocal((prev) => ({ ...prev, grants: (prev.grants || []).map((x) => (x.id === g.id ? { ...x, state: 'revocada' } : x)) }))
    },
  })
  const cohortChange = (cohort, add) => run(add ? 'cohort-add' : `cohort-rm-${cohort.id}`, () => academyApi('admin-cohort-members', {
    method: 'POST',
    body: add ? { cohortId: cohort.id, add: [m.id] } : { cohortId: cohort.id, remove: [m.id] },
  }), {
    success: add ? `Lo agregaste al grupo ${cohort.name}.` : `Lo quitaste del grupo ${cohort.name}.`,
    after: () => {
      setAddCohort('')
      setLocal((prev) => ({
        ...prev,
        cohorts: add
          ? [...(prev.cohorts || []), { id: cohort.id, name: cohort.name }]
          : (prev.cohorts || []).filter((c) => Number(c.id) !== Number(cohort.id)),
      }))
    },
  })
  const setStatus = (status) => run('status', () => academyApi('admin-member-update', {
    method: 'POST',
    body: status === 'expulsado' ? { id: m.id, status, purgeRecent: purge } : { id: m.id, status },
  }), {
    success: status === 'expulsado'
      ? (purge ? 'Lo expulsaste y borramos lo que publicó en los últimos 7 días.' : 'Lo expulsaste: ya no puede entrar a la Academy.')
      : 'Reactivaste su cuenta.',
    after: () => { setConfirm(null); setPurge(false); setLocal((prev) => ({ ...prev, status })) },
  })
  const transferEmail = () => {
    const email = newEmail.trim()
    if (!EMAIL_RE.test(email) || email.length > 120) {
      setNotice({ tone: 'error', text: 'Escribe un correo válido.' })
      return
    }
    run('email', () => academyApi('admin-member-update', { method: 'POST', body: { id: m.id, email } }), {
      success: `Cambiamos el correo a ${email}. Le enviamos credenciales nuevas y cerramos sus sesiones.`,
      after: () => { setConfirm(null); setNewEmail(''); setLocal((prev) => ({ ...prev, email })) },
    })
  }

  const roleOptions = [
    { value: 'miembro', label: 'Miembro' },
    { value: 'moderador', label: 'Moderador' },
    { value: 'admin', label: 'Admin' },
  ]

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        size="md"
        lead={<MemberAvatar member={m} size={44} />}
        title={m.name}
        subtitle={m.email || (m.handle ? `@${m.handle}` : undefined)}
        bodyClassName="aca-mas"
      >
        {notice && (
          <InlineAlert tone={notice.tone} onClose={() => setNotice(null)} className="aca-mas-notice">{notice.text}</InlineAlert>
        )}

        <div className="aca-mas-facts">
          <Chip tone={m.status === 'activo' ? 'ok' : m.status === 'expulsado' ? 'bad' : 'warn'} dot>{STATUS_LABEL[m.status] || m.status || 'Activo'}</Chip>
          <Chip tone="muted">{ROLE_LABEL[m.role] || 'Miembro'}</Chip>
          {m.source && <Chip tone="muted">{SOURCE_LABEL[m.source] || m.source}</Chip>}
          {m.mustChangePassword && <Chip tone="warn">Aún no crea su contraseña</Chip>}
        </div>
        <dl className="aca-mas-dl">
          {m.phone && (<><dt>Teléfono</dt><dd>+56 {m.phone}</dd></>)}
          {m.joinedAt && (<><dt>Se unió</dt><dd>{fmtDay(m.joinedAt)}</dd></>)}
          {m.homeSiteLabel && (<><dt>Se registró en</dt><dd>{m.homeSiteLabel}</dd></>)}
          <dt>Último ingreso</dt><dd>{m.lastLoginAt ? fmtDayTime(m.lastLoginAt) : 'Nunca'}</dd>
          <dt>Correo de acceso</dt><dd>{m.credentialsSentAt ? `Enviado el ${fmtDayTime(m.credentialsSentAt)}` : 'Sin enviar'}</dd>
        </dl>

        {targetProtected && (
          <Note icon="shield">
            {m.role === 'propietario'
              ? 'Esta es la cuenta del propietario: nadie puede cambiarla desde acá.'
              : 'Solo el propietario puede modificar a otro administrador.'}
          </Note>
        )}
        {isSelf && <Note icon="info">Esta es tu cuenta. Tus datos se cambian en Ajustes.</Note>}

        {canEdit && (
          <>
            <SectionLabel>Acceso</SectionLabel>
            <div className="aca-mas-actions">
              <Button icon="send" loading={busy === 'resend'} onClick={resend}>Reenviar acceso</Button>
              <Button icon="key" loading={busy === 'pwlink'} onClick={passwordLink}>Enviar enlace de contraseña</Button>
            </div>

            {viewerIsOwner && (
              <>
                <SectionLabel>Rol</SectionLabel>
                <Segmented
                  options={roleOptions}
                  value={m.role || 'miembro'}
                  onChange={(role) => setConfirm({ kind: 'role', role })}
                  ariaLabel="Rol en la Academy"
                  full
                />
                <p className="aca-mi-hint">Los moderadores revisan reportes y moderan publicaciones. Los admins además gestionan miembros, cursos y ajustes.</p>
              </>
            )}
          </>
        )}

        <SectionLabel>Cursos</SectionLabel>
        {grants.length ? (
          <List>
            {grants.map((g) => {
              const st = GRANT_STATE[g.state] || { label: g.state, tone: 'muted' }
              return (
                <ListRow
                  key={g.id || g.courseId}
                  lead={<span className="aca-mas-ico"><Icon name="book" size={16} /></span>}
                  title={g.courseTitle || `Curso ${g.courseId}`}
                  subtitle={SOURCE_LABEL[g.source] || (g.source === 'manual' ? 'Entregado a mano' : g.source)}
                  dim={g.state === 'revocada'}
                  trailing={<Chip tone={st.tone}>{st.label}</Chip>}
                  actions={canEdit && g.state !== 'revocada' && g.id ? (
                    <Button size="sm" variant="danger" onClick={() => { setReason(''); setConfirm({ kind: 'revoke', grant: g }) }}>Quitar</Button>
                  ) : null}
                />
              )
            })}
          </List>
        ) : (
          <p className="aca-mi-muted">No tiene cursos.</p>
        )}
        {canEdit && (
          courses.loading && !courses.data ? <SkeletonRows rows={1} /> : courseList.length > 0 && (
            <div className="aca-mas-add">
              <select className="aca-mi-input" value={grantCourse} onChange={(e) => setGrantCourse(e.target.value)} aria-label="Curso para dar acceso">
                <option value="">Elegir curso…</option>
                {courseList.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}{c.published === false ? ' (borrador)' : ''}</option>
                ))}
              </select>
              <Button variant="primary" icon="plus" disabled={!grantCourse} loading={busy === 'grant'} onClick={grant}>Dar acceso</Button>
            </div>
          )
        )}

        <SectionLabel>Grupos</SectionLabel>
        {memberCohorts.length ? (
          <List>
            {memberCohorts.map((c) => (
              <ListRow
                key={c.id}
                lead={<span className="aca-mas-ico"><Icon name="users" size={16} /></span>}
                title={c.name}
                actions={canEdit ? (
                  <Button size="sm" variant="plain" loading={busy === `cohort-rm-${c.id}`} onClick={() => cohortChange(c, false)}>Quitar</Button>
                ) : null}
              />
            ))}
          </List>
        ) : (
          <p className="aca-mi-muted">No está en ningún grupo.</p>
        )}
        {canEdit && cohortList.length > 0 && (
          <div className="aca-mas-add">
            <select className="aca-mi-input" value={addCohort} onChange={(e) => setAddCohort(e.target.value)} aria-label="Grupo para agregar">
              <option value="">Elegir grupo…</option>
              {cohortList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Button
              icon="plus"
              disabled={!addCohort}
              loading={busy === 'cohort-add'}
              onClick={() => {
                const c = cohortList.find((x) => String(x.id) === String(addCohort))
                if (c) cohortChange(c, true)
              }}
            >
              Agregar
            </Button>
          </div>
        )}

        {canEdit && viewerIsOwner && (
          <>
            <SectionLabel>Correo de la cuenta</SectionLabel>
            <p className="aca-mi-hint">Cambiar el correo transfiere la cuenta: se borra la contraseña actual, se cierran sus sesiones y le llegan credenciales nuevas al correo nuevo.</p>
            <div className="aca-mas-add">
              <input
                className="aca-mi-input"
                type="email"
                inputMode="email"
                autoComplete="off"
                placeholder="nuevo@correo.cl"
                value={newEmail}
                maxLength={120}
                onChange={(e) => setNewEmail(e.target.value)}
                aria-label="Correo nuevo"
              />
              <Button disabled={!newEmail.trim()} onClick={() => setConfirm({ kind: 'email' })}>Cambiar</Button>
            </div>
          </>
        )}

        {canEdit && (
          <>
            <SectionLabel>Membresía</SectionLabel>
            {m.status === 'activo' || !m.status ? (
              <Button variant="danger" icon="shield" onClick={() => { setPurge(false); setConfirm({ kind: 'ban' }) }}>Expulsar de la Academy</Button>
            ) : (
              <Button variant="success" icon="refresh" loading={busy === 'status'} onClick={() => setConfirm({ kind: 'reactivate' })}>Reactivar cuenta</Button>
            )}
          </>
        )}
      </Sheet>

      <ConfirmDialog
        open={confirm?.kind === 'ban'}
        tone="danger"
        title={`¿Expulsar a ${m.name}?`}
        message="Pierde el acceso a la Academy, se cierran sus sesiones y no puede volver a comprar con este correo. Puedes reactivarlo después."
        confirmLabel="Expulsar"
        busy={busy === 'status'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => setStatus('expulsado')}
      >
        <label className="aca-mi-check">
          <input type="checkbox" checked={purge} onChange={(e) => setPurge(e.target.checked)} />
          <span>Borrar también sus publicaciones y comentarios de los últimos 7 días</span>
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm?.kind === 'reactivate'}
        title={`¿Reactivar a ${m.name}?`}
        message="Vuelve a entrar con su contraseña y recupera los cursos que tenga activos."
        confirmLabel="Reactivar"
        busy={busy === 'status'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => setStatus('activo')}
      />

      <ConfirmDialog
        open={confirm?.kind === 'role'}
        title="¿Cambiar el rol?"
        message={confirm?.role ? `${m.name} pasará a ser ${ROLE_LABEL[confirm.role]}.` : ''}
        confirmLabel="Cambiar rol"
        busy={busy === 'role'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { const role = confirm.role; setConfirm(null); changeRole(role) }}
      />

      <ConfirmDialog
        open={confirm?.kind === 'revoke'}
        tone="danger"
        title="¿Quitar el acceso al curso?"
        message={confirm?.grant ? `${m.name} deja de ver ${confirm.grant.courseTitle || 'el curso'}. Si era su único curso, su cuenta queda cancelada.` : ''}
        confirmLabel="Quitar acceso"
        busy={busy === 'revoke'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => revoke(confirm.grant)}
      >
        <Field label="Motivo" optional>
          <input className="aca-mi-input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: reembolso por transferencia" />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm?.kind === 'email'}
        tone="danger"
        title="¿Transferir la cuenta a otro correo?"
        message={`La cuenta de ${m.name} pasará a ${newEmail.trim()}. Su contraseña actual deja de servir.`}
        confirmLabel="Transferir"
        busy={busy === 'email'}
        onCancel={() => setConfirm(null)}
        onConfirm={transferEmail}
      />
    </>
  )
}

export { MemberAdminSheet }
