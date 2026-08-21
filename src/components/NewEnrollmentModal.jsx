import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './ui.jsx'
import { cleanPhone } from '../data.js'

/**
 * NewEnrollmentModal — alta manual de inscripciones (Cursos/Workshop) desde
 * el panel. Reusa la misma validación que api/enrollments.js (POST).
 *
 * Props: { open, onClose, onCreate(draft) }
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function NewEnrollmentModal({ open, onClose, onCreate = () => {} }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', source: 'workshop', edition: '', level: '', message: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) { setForm({ name: '', phone: '', email: '', source: 'workshop', edition: '', level: '', message: '' }); setError(''); setSaving(false) }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const isWorkshop = form.source === 'workshop'

  const submit = async () => {
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

  return createPortal((
    <div className="psn-modal" role="dialog" aria-modal="true">
      <button className="psn-scrim" aria-label="Cerrar" onClick={onClose} />
      <div className="psn-modal-card psn-newbk">
        <button className="psn-close" onClick={onClose} aria-label="Cerrar"><Icon name="close" size={17} /></button>
        <h3><Icon name="user" size={20} /> Nueva inscripción</h3>
        <p className="psn-role">Se guarda igual que si viniera de la página pública — el inscrito también queda como cliente.</p>

        <div className="psn-client-edit">
          <div className="field"><label>Origen</label>
            <select className="input" value={form.source} onChange={set('source')}>
              <option value="workshop">Workshop</option>
              <option value="cursos">Cursos</option>
            </select>
          </div>
          <div className="field"><label>Nombre</label><input className="input" value={form.name} onChange={set('name')} placeholder="Nombre y apellido" autoFocus /></div>
          <div className="field"><label>Teléfono</label><input className="input" value={form.phone} onChange={set('phone')} inputMode="tel" placeholder="9 1234 5678" /></div>
          <div className="field"><label>Correo</label><input className="input" value={form.email} onChange={set('email')} inputMode="email" placeholder="correo@ejemplo.com" /></div>
          {isWorkshop
            ? <div className="field"><label>Edición</label><input className="input" value={form.edition} onChange={set('edition')} placeholder="30 de agosto" /></div>
            : <div className="field"><label>Nivel</label><input className="input" value={form.level} onChange={set('level')} placeholder="Estoy empezando" /></div>}
          <div className="field"><label>Mensaje <span style={{ color: 'var(--muted-2)' }}>(opcional)</span></label><textarea className="input" rows={2} value={form.message} onChange={set('message')} /></div>
        </div>

        {error && <p className="psn-newbk-err"><Icon name="close" size={13} /> {error}</p>}

        <div className="psn-confirm-actions">
          <button className="btn btn-ghost btn-block" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-gold btn-block" onClick={submit} disabled={saving}>
            {saving ? 'Guardando…' : 'Crear inscripción'}
          </button>
        </div>
      </div>
    </div>
  ), document.body)
}
