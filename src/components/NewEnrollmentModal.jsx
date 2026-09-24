import React, { useEffect, useRef, useState } from 'react'
import { cleanPhone } from '../data.js'
import { Sheet, Button, Field, InlineAlert, useIsPhone } from './panel/index.js'

/**
 * NewEnrollmentModal — alta manual de inscripciones (Cursos/Workshop) desde
 * el panel. Reusa la misma validación que api/enrollments.js (POST).
 *
 * Props: { open, onClose, onCreate(draft) }
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMPTY = { name: '', phone: '', email: '', source: 'workshop', edition: '', level: '', message: '' }

export default function NewEnrollmentModal({ open, onClose, onCreate = () => {} }) {
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const isPhone = useIsPhone()
  const nameRef = useRef(null)

  useEffect(() => {
    if (open) { setForm(EMPTY); setError(''); setSaving(false) }
  }, [open])

  const set = (k) => (e) => {
    const v = e.target.value
    setForm((f) => ({ ...f, [k]: v }))
    if (error) setError('')
  }
  const isWorkshop = form.source === 'workshop'

  const submit = async () => {
    if (saving) return
    const name = form.name.trim()
    const phone = cleanPhone(form.phone)
    const email = form.email.trim().toLowerCase()
    if (!name) return setError('Nombre requerido.')
    if (phone.length !== 9) return setError('El teléfono debe tener 9 dígitos.')
    if (!EMAIL_RE.test(email)) return setError('Correo inválido.')
    setError('')
    setSaving(true)
    try {
      await onCreate({
        name, phone, email, source: form.source,
        edition: isWorkshop ? (form.edition.trim() || null) : null,
        level: isWorkshop ? null : (form.level.trim() || null),
        message: form.message.trim() || null,
      })
      onClose()
    } catch (err) {
      setError(err?.message || 'No se pudo guardar la inscripción.')
      setSaving(false)
    }
  }
  const onEnter = (e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }

  return (
    <Sheet
      open={open}
      onClose={saving ? undefined : onClose}
      title="Nueva inscripción"
      subtitle="Se guarda igual que si viniera de la página pública — el inscrito también queda como cliente."
      icon="sparkles"
      size="sm"
      initialFocusRef={isPhone ? undefined : nameRef}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" icon="check" onClick={submit} loading={saving}>
            {saving ? 'Guardando…' : 'Crear inscripción'}
          </Button>
        </>
      )}
    >
      <div className="pn-stack">
        <Field label="Origen">
          <select className="input" value={form.source} onChange={set('source')}>
            <option value="workshop">Workshop</option>
            <option value="cursos">Cursos</option>
          </select>
        </Field>
        <Field label="Nombre">
          <input ref={nameRef} className="input" value={form.name} onChange={set('name')} onKeyDown={onEnter} placeholder="Nombre y apellido" autoComplete="off" />
        </Field>
        <Field label="Teléfono" hint="9 dígitos, sin +56">
          <input className="input" value={form.phone} onChange={set('phone')} onKeyDown={onEnter} inputMode="tel" placeholder="9 1234 5678" autoComplete="off" />
        </Field>
        <Field label="Correo">
          <input className="input" value={form.email} onChange={set('email')} onKeyDown={onEnter} inputMode="email" placeholder="correo@ejemplo.com" autoComplete="off" autoCapitalize="off" />
        </Field>
        {isWorkshop
          ? <Field label="Edición"><input className="input" value={form.edition} onChange={set('edition')} onKeyDown={onEnter} placeholder="30 de agosto" /></Field>
          : <Field label="Nivel"><input className="input" value={form.level} onChange={set('level')} onKeyDown={onEnter} placeholder="Estoy empezando" /></Field>}
        <Field label="Mensaje" optional>
          <textarea className="input" rows={2} value={form.message} onChange={set('message')} />
        </Field>

        {error && <InlineAlert tone="error">{error}</InlineAlert>}
      </div>
    </Sheet>
  )
}
