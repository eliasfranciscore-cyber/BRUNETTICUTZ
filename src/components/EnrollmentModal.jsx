import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './ui.jsx'
import { cleanPhone } from '../data.js'

/**
 * EnrollmentModal — detalle de una inscripción (Cursos/Workshop) en modal.
 * Mismo patrón que ClientModal: ver, editar, WhatsApp directo y eliminar.
 * Suma un buscador de clientes y la opción de crear al inscrito como
 * cliente si todavía no está en la lista — la inscripción ya lo guarda como
 * cliente en el backend (upsert por teléfono), esto solo lo hace visible y
 * accionable desde el panel.
 *
 * Props:
 *  enrollment, clients, onClose, onSave(updated), onDelete(enrollment), onCreateClient(draft)
 */
export default function EnrollmentModal({ enrollment, clients = [], onClose, onSave, onDelete, onCreateClient }) {
  const [editing, setEditing] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', email: '', edition: '', level: '', message: '' })
  const [clientQuery, setClientQuery] = useState('')
  const [creatingClient, setCreatingClient] = useState(false)
  const [clientMsg, setClientMsg] = useState('')

  useEffect(() => {
    setForm({
      name: enrollment?.name || '',
      phone: enrollment?.phone || '',
      email: enrollment?.email || '',
      edition: enrollment?.edition || '',
      level: enrollment?.level || '',
      message: enrollment?.message || '',
    })
    setEditing(false)
    setConfirmDel(false)
    setClientQuery('')
    setClientMsg('')
  }, [enrollment])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') (confirmDel ? setConfirmDel(false) : onClose()) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmDel, onClose])

  if (!enrollment) return null

  const first = (enrollment.name || '').split(' ')[0] || 'Hola'
  const phoneDigits = cleanPhone(enrollment.phone)
  const waHref = `https://wa.me/56${phoneDigits}?text=${encodeURIComponent(`Hola ${first}, te escribimos de Brunetti 💈`)}`
  const isWorkshop = enrollment.source === 'workshop'

  const matchedClient = clients.find((c) => cleanPhone(c.phone) === phoneDigits && phoneDigits.length === 9)

  const q = clientQuery.trim().toLowerCase()
  const searchResults = q
    ? clients.filter((c) => c.name?.toLowerCase().includes(q) || c.phone?.includes(q) || c.email?.toLowerCase().includes(q)).slice(0, 6)
    : []

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const save = () => {
    if (!form.name.trim()) return
    onSave({
      ...enrollment,
      name: form.name.trim(),
      phone: cleanPhone(form.phone),
      email: form.email.trim().toLowerCase(),
      edition: form.edition.trim() || null,
      level: form.level.trim() || null,
      message: form.message.trim() || null,
    })
    setEditing(false)
  }

  const createClientNow = async () => {
    setCreatingClient(true)
    setClientMsg('')
    try {
      await onCreateClient({ name: enrollment.name, phone: phoneDigits, email: enrollment.email })
      setClientMsg('Cliente creado.')
    } catch (err) {
      setClientMsg(err?.message || 'No se pudo crear el cliente.')
    } finally {
      setCreatingClient(false)
    }
  }

  const badge = isWorkshop
    ? { background: 'rgba(136,56,216,0.18)', color: '#b483f3', border: '1px solid rgba(136,56,216,0.35)' }
    : { background: 'rgba(11,18,158,0.18)', color: '#6b74f0', border: '1px solid rgba(107,116,240,0.35)' }

  const fmtDate = (iso) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  return createPortal((
    <div className="psn-modal" role="dialog" aria-modal="true">
      <button className="psn-scrim" aria-label="Cerrar" onClick={onClose} />
      <div className="psn-modal-card psn-client-modal">
        <button className="psn-close" onClick={onClose} aria-label="Cerrar"><Icon name="close" size={17} /></button>

        <div className="psn-client-profile">
          <div className="psn-client-avatar">{(enrollment.name || 'C')[0]?.toUpperCase()}</div>
          <div style={{ minWidth: 0 }}>
            <h3 className="font-display">{enrollment.name}</h3>
            <span className="psn-client-sub">+56 {enrollment.phone || '—'}</span>
            <span className="psn-client-sub">{enrollment.email || 'sin correo'}</span>
          </div>
        </div>

        {editing ? (
          <div className="psn-client-edit">
            <div className="field"><label>Nombre</label><input className="input" value={form.name} onChange={set('name')} placeholder="Nombre y apellido" /></div>
            <div className="field"><label>Teléfono</label><input className="input" value={form.phone} onChange={set('phone')} inputMode="tel" placeholder="9 1234 5678" /></div>
            <div className="field"><label>Correo</label><input className="input" value={form.email} onChange={set('email')} inputMode="email" placeholder="correo@ejemplo.com" /></div>
            {isWorkshop
              ? <div className="field"><label>Edición</label><input className="input" value={form.edition} onChange={set('edition')} placeholder="30 de agosto" /></div>
              : <div className="field"><label>Nivel</label><input className="input" value={form.level} onChange={set('level')} placeholder="Estoy empezando" /></div>}
            <div className="field"><label>Mensaje</label><textarea className="input" rows={3} value={form.message} onChange={set('message')} /></div>
            <div className="psn-confirm-actions">
              <button className="btn btn-ghost btn-block" onClick={() => setEditing(false)}>Cancelar</button>
              <button className="btn btn-gold btn-block" onClick={save}><Icon name="check" size={15} /> Guardar</button>
            </div>
          </div>
        ) : (
          <>
            <div className="psn-client-kpis">
              <div><span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 999, ...badge }}>{isWorkshop ? 'Workshop' : 'Cursos'}</span></div>
              {enrollment.edition && <div><strong>{enrollment.edition}</strong><span>Edición</span></div>}
              {enrollment.level && <div><strong>{enrollment.level}</strong><span>Nivel</span></div>}
              <div><strong>{fmtDate(enrollment.created_at)}</strong><span>Inscrito</span></div>
            </div>

            {enrollment.message && (
              <div className="psn-client-history">
                <div className="psn-client-hrow" style={{ gridTemplateColumns: '1fr' }}>{enrollment.message}</div>
              </div>
            )}

            <div className="psn-actions">
              <div className="psn-confirm-actions">
                <button className="btn btn-dark btn-block" onClick={() => setEditing(true)}><Icon name="user" size={15} /> Editar</button>
                <a className="btn btn-wa btn-block" href={waHref} target="_blank" rel="noopener noreferrer"><Icon name="whatsapp" size={15} /> WhatsApp</a>
              </div>

              <div className="client-search">
                <Icon name="user" size={15} />
                <input value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} placeholder="Buscar en tus clientes…" />
              </div>
              {searchResults.length > 0 && (
                <div className="psn-client-history">
                  {searchResults.map((c) => (
                    <div key={c.id || c.phone} className="psn-client-hrow">
                      <div style={{ minWidth: 0 }}>
                        <div className="svc">{c.name}</div>
                        <div className="meta">{c.phone} · {c.email || 'sin correo'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {matchedClient ? (
                <p className="psn-newbk-err" style={{ color: 'var(--gold-lt)' }}>
                  <Icon name="user" size={13} /> Ya está registrado como cliente.
                </p>
              ) : (
                <button className="btn btn-dark btn-block" onClick={createClientNow} disabled={creatingClient}>
                  <Icon name="user" size={15} /> {creatingClient ? 'Creando…' : 'Crear cliente con estos datos'}
                </button>
              )}
              {clientMsg && <p className="psn-newbk-err">{clientMsg}</p>}

              <button className="btn btn-danger btn-block" onClick={() => setConfirmDel(true)}><Icon name="close" size={15} /> Eliminar inscripción</button>
            </div>
          </>
        )}
      </div>

      {confirmDel && (
        <div className="psn-modal psn-modal-top" role="alertdialog" aria-modal="true">
          <button className="psn-scrim" aria-label="Cerrar" onClick={() => setConfirmDel(false)} />
          <div className="psn-modal-card psn-confirm">
            <span className="psn-confirm-ic"><Icon name="close" size={22} /></span>
            <h3 className="font-display">¿Eliminar la inscripción de {enrollment.name}?</h3>
            <p>Se quitará de la lista de inscripciones. Esta acción no se puede deshacer.</p>
            <div className="psn-confirm-actions">
              <button className="btn btn-ghost btn-block" onClick={() => setConfirmDel(false)}>Volver</button>
              <button className="btn btn-danger btn-block" onClick={() => { onDelete(enrollment); setConfirmDel(false) }}>Sí, eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  ), document.body)
}
