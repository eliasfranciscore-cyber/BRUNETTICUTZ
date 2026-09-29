import React, { useEffect, useState } from 'react'
import { Sheet, Button, Field, InlineAlert, SkeletonRows, Chip } from '../panel/index.js'
import { useAcademy } from '../../academy/context.js'
import { academyApi } from '../../academy/api.js'
import { useAcademyQuery } from '../../academy/useQuery.js'
import { CREDENTIALS_TEXT, errorText, cx } from './MemberCard.jsx'
import '../../styles/academy/miembros.css'

/* ============================================================
   INVITAR (staff): crea la cuenta, le da los cursos elegidos y manda las
   credenciales (admin-invite → claimAndSendCredentials). Es la forma de
   dar acceso sin pasar por Mercado Pago (alumnos presenciales, regalos,
   compras antiguas de BrunettiCutz).
   ============================================================ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const EMPTY = { name: '', email: '', courseIds: [], cohortId: '' }

export default function InviteSheet({ open, onClose, onInvited }) {
  const { toast } = useAcademy()
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState('')
  const [result, setResult] = useState(null)

  const courses = useAcademyQuery('mi:courses', () => academyApi('courses'), { enabled: Boolean(open), refetchOnFocus: false })
  const cohorts = useAcademyQuery('mi:cohorts', () => academyApi('cohorts'), { enabled: Boolean(open), refetchOnFocus: false })

  useEffect(() => {
    if (open) return
    // Al cerrar se limpia todo: una segunda invitación no hereda la primera.
    const t = setTimeout(() => { setForm(EMPTY); setErrors({}); setFailure(''); setResult(null) }, 220)
    return () => clearTimeout(t)
  }, [open])

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const toggleCourse = (id) => setForm((f) => ({
    ...f,
    courseIds: f.courseIds.includes(id) ? f.courseIds.filter((x) => x !== id) : [...f.courseIds, id],
  }))

  const validate = () => {
    const e = {}
    const name = form.name.trim()
    const email = form.email.trim()
    if (!name) e.name = 'Escribe el nombre.'
    else if (name.length > 80) e.name = 'Máximo 80 caracteres.'
    if (!EMAIL_RE.test(email) || email.length > 120) e.email = 'Escribe un correo válido.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const submit = async (ev) => {
    ev?.preventDefault?.()
    if (sending || !validate()) return
    setSending(true)
    setFailure('')
    try {
      const body = {
        name: form.name.trim(),
        email: form.email.trim(),
        courseIds: form.courseIds.map(Number),
      }
      if (form.cohortId) body.cohortId = Number(form.cohortId)
      const res = await academyApi('admin-invite', { method: 'POST', body })
      setResult(res || {})
      onInvited?.(res)
      toast?.(res?.created === false ? 'Acceso actualizado' : 'Invitación enviada')
    } catch (e) {
      setFailure(e?.status === 429 ? 'Llegaste al límite de invitaciones de hoy. Vuelve a intentarlo mañana.' : errorText(e, 'No se pudo enviar la invitación.'))
    } finally {
      setSending(false)
    }
  }

  const courseList = courses.data?.courses || []
  const cohortList = cohorts.data?.cohorts || []
  const cohortsForForm = cohortList.filter((c) => !c.archivedAt)

  const footer = result ? (
    <>
      <Button variant="secondary" onClick={() => { setForm(EMPTY); setResult(null); setErrors({}) }}>Invitar a otra persona</Button>
      <Button variant="primary" onClick={onClose}>Listo</Button>
    </>
  ) : (
    <>
      <Button variant="secondary" onClick={onClose} disabled={sending}>Cancelar</Button>
      <button type="submit" form="aca-invite-form" className={cx('aca-mi-invite-btn', sending && 'is-loading')} disabled={sending}>
        {sending ? 'Enviando…' : 'Invitar'}
      </button>
    </>
  )

  return (
    <Sheet open={open} onClose={onClose} title="Invitar a la Academy" subtitle="Le llega un correo con su usuario y una contraseña temporal" size="md" icon="mail" footer={footer} dismissible={!sending}>
      {result ? (
        <div className="aca-invite-result">
          <InlineAlert tone="success" title={result.created === false ? 'Esta persona ya tenía cuenta' : 'Invitación enviada'}>
            {CREDENTIALS_TEXT[result.credentials] || 'Listo: la cuenta quedó con acceso.'}
          </InlineAlert>
          {result.member && (
            <p className="aca-mi-muted">
              {result.member.name} · {result.member.email}
              {Array.isArray(result.member.grants) && result.member.grants.length > 0 && (
                <> · {result.member.grants.filter((g) => g.state === 'activa').length} {result.member.grants.filter((g) => g.state === 'activa').length === 1 ? 'curso' : 'cursos'}</>
              )}
            </p>
          )}
        </div>
      ) : (
        <form id="aca-invite-form" className="aca-mi-form" onSubmit={submit} noValidate>
          {failure && <InlineAlert tone="error">{failure}</InlineAlert>}
          <Field label="Nombre" error={errors.name} htmlFor="aca-inv-name">
            <input
              id="aca-inv-name"
              className="aca-mi-input"
              value={form.name}
              maxLength={80}
              autoComplete="off"
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Nombre y apellido"
            />
          </Field>
          <Field label="Correo" error={errors.email} htmlFor="aca-inv-email">
            <input
              id="aca-inv-email"
              className="aca-mi-input"
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={form.email}
              maxLength={120}
              onChange={(e) => set({ email: e.target.value })}
              placeholder="alumno@correo.cl"
            />
          </Field>

          <Field label="Cursos" hint="Las credenciales se envían cuando la persona tiene al menos un curso activo.">
            {courses.loading && !courses.data ? (
              <SkeletonRows rows={2} />
            ) : courses.error && !courses.data ? (
              <InlineAlert tone="error" action={{ label: 'Reintentar', onClick: courses.refetch }}>No se pudieron cargar los cursos.</InlineAlert>
            ) : courseList.length === 0 ? (
              <p className="aca-mi-muted">Todavía no hay cursos creados.</p>
            ) : (
              <div className="aca-mi-checklist" role="group" aria-label="Cursos">
                {courseList.map((c) => {
                  const id = Number(c.id)
                  const on = form.courseIds.includes(id)
                  return (
                    <label key={c.id} className={cx('aca-mi-checkrow', on && 'is-on')}>
                      <input type="checkbox" checked={on} onChange={() => toggleCourse(id)} />
                      <span className="aca-mi-checkrow-title">{c.title}</span>
                      {c.published === false && <Chip tone="muted">Borrador</Chip>}
                    </label>
                  )
                })}
              </div>
            )}
          </Field>
          {!form.courseIds.length && courseList.length > 0 && (
            <InlineAlert tone="warn">Sin cursos, la cuenta se crea pero no le llega la contraseña.</InlineAlert>
          )}

          <Field label="Grupo" optional htmlFor="aca-inv-cohort">
            <select
              id="aca-inv-cohort"
              className="aca-mi-input"
              value={form.cohortId}
              onChange={(e) => set({ cohortId: e.target.value })}
              disabled={cohorts.loading && !cohorts.data}
            >
              <option value="">Sin grupo</option>
              {cohortsForForm.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </form>
      )}
    </Sheet>
  )
}

export { InviteSheet }
