import React, { useEffect, useMemo, useRef, useState } from 'react'
import { cleanPhone } from '../data.js'
import { FEATURES } from '../features.js'
import { Sheet, Button, Field, InlineAlert, useIsPhone } from './panel/index.js'

/**
 * NewClientModal — alta manual de clientes desde el panel.
 *
 * El POST /api/clients es un upsert por teléfono y EXIGE email válido
 * (validateClient en api/clients.js), así que replicamos aquí la misma regla:
 * nombre + teléfono de 9 dígitos + email con formato válido. Si el teléfono ya
 * existe entre los clientes cargados, avisamos que se actualizará (no se crea
 * duplicado).
 *
 * `onCreate(draft)` es `createClient` de Dashboard: LANZA un Error con el
 * mensaje del servidor cuando la validación falla (Inscripciones depende de
 * ese contrato), y acá ese mensaje se muestra sin cerrar la hoja.
 *
 * Props: { open, onClose, clients, onCreate(draft), ctx? } — de `ctx` solo se
 * usa `pushToast` (opcional) para confirmar el alta.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMPTY = { name: '', phone: '', email: '', profession: '' }

export default function NewClientModal({ open, onClose, clients = [], onCreate = () => {}, ctx }) {
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const isPhone = useIsPhone()
  const nameRef = useRef(null)

  useEffect(() => {
    if (open) { setForm(EMPTY); setError(''); setSaving(false) }
  }, [open])

  const phone = cleanPhone(form.phone)
  const existing = useMemo(
    () => (phone.length === 9 ? (clients || []).find((c) => cleanPhone(c.phone) === phone) : null),
    [clients, phone],
  )

  const set = (k) => (e) => {
    const v = e.target.value
    setForm((f) => ({ ...f, [k]: v }))
    if (error) setError('')
  }

  const submit = async () => {
    if (saving) return
    const name = form.name.trim()
    const email = form.email.trim().toLowerCase()
    const profession = form.profession.trim()
    if (!name) return setError('Nombre requerido.')
    if (phone.length !== 9) return setError('El teléfono debe tener 9 dígitos.')
    if (!EMAIL_RE.test(email)) return setError('Correo inválido.')
    setError('')
    setSaving(true)
    try {
      // profession va omitido (no vacío) cuando no se escribió nada: si el
      // teléfono ya pertenece a un cliente existente, el servidor conserva su
      // profesión guardada en vez de borrarla con un valor en blanco — este
      // formulario no conoce el dato previo de ese cliente para mostrarlo.
      await onCreate({ name, phone, email, ...(FEATURES.profession && profession ? { profession } : {}) })
      ctx?.pushToast?.('✓', existing ? `${name}: ficha actualizada` : `${name} quedó en tus clientes`)
      onClose?.()
    } catch (err) {
      setError(err?.message || 'No se pudo guardar el cliente.')
      setSaving(false)
    }
  }
  const onEnter = (e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }

  return (
    <Sheet
      open={open}
      onClose={saving ? undefined : onClose}
      title="Nuevo cliente"
      subtitle="El teléfono funciona como identificador único."
      icon="user"
      size="sm"
      // En escritorio el cursor entra directo al nombre; en el celular no,
      // para no levantar el teclado mientras la hoja todavía sube.
      initialFocusRef={isPhone ? undefined : nameRef}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" icon="check" onClick={submit} loading={saving}>
            {existing ? 'Actualizar' : 'Crear cliente'}
          </Button>
        </>
      )}
    >
      <div className="pn-stack">
        <Field label="Nombre">
          <input ref={nameRef} className="input" value={form.name} onChange={set('name')} onKeyDown={onEnter} placeholder="Nombre y apellido" autoComplete="off" />
        </Field>
        <Field label="Teléfono" hint="9 dígitos, sin +56">
          <input className="input" value={form.phone} onChange={set('phone')} onKeyDown={onEnter} inputMode="tel" placeholder="9 1234 5678" autoComplete="off" />
        </Field>
        <Field label="Correo">
          <input className="input" value={form.email} onChange={set('email')} onKeyDown={onEnter} inputMode="email" placeholder="correo@ejemplo.com" autoComplete="off" autoCapitalize="off" />
        </Field>
        {FEATURES.profession && (
          <Field label="Profesión" optional>
            <input className="input" value={form.profession} onChange={set('profession')} onKeyDown={onEnter} placeholder="Ej: Ingeniero, Estudiante" maxLength={80} />
          </Field>
        )}

        {existing && <InlineAlert tone="info">Ya existe {existing.name || 'un cliente'} con ese teléfono: se actualizará.</InlineAlert>}
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
      </div>
    </Sheet>
  )
}
