import React, { useEffect, useState } from 'react'
import { CLP, cleanPhone } from '../data.js'
import { waHref as buildWaHref } from '../whatsapp.js'
import {
  Sheet, ConfirmDialog, ActionMenu, Avatar, List, ListRow, SearchField,
  Field, Button, IconButton, Chip, InlineAlert,
} from './panel/index.js'
import { OriginChip, fmtStamp } from '../pages/panel/PedidosTab.jsx'

/* Pagada = mismo criterio que Pedidos e Inscripciones: el webhook de Mercado
   Pago (api/mp-payments.js) deja "Pago MercadoPago <id> · $<monto>" en
   `message`. La columna `amount` no siempre llega en el GET (ver ese
   archivo), así que el monto se saca del propio mensaje cuando falta. */
const isPaid = (e) => String(e?.message || '').startsWith('Pago MercadoPago')
const PAYMENT_RE = /^Pago MercadoPago\s+(\S+)\s*·\s*\$\s*([\d.,]+)/i
function parsePayment(message) {
  const m = String(message || '').match(PAYMENT_RE)
  if (!m) return null
  const amount = Number(m[2].replace(/[.,]/g, ''))
  return { paymentId: m[1], amount: Number.isFinite(amount) ? amount : null }
}

// Lo que se pidió: el nivel del curso y/o la edición del Workshop, igual que
// en la tabla de InscripcionesTab.
const editionLabel = (ed) => {
  const text = String(ed || '').trim()
  if (!text) return null
  return /espera|edici[oó]n/i.test(text) ? text.charAt(0).toUpperCase() + text.slice(1) : `Edición ${text}`
}
const detailOf = (e) => [e?.level, editionLabel(e?.edition)].filter(Boolean).join(' · ') || '—'

const formOf = (e) => ({
  name: e?.name || '',
  phone: e?.phone || '',
  email: e?.email || '',
  edition: e?.edition || '',
  level: e?.level || '',
  message: e?.message || '',
})

/**
 * EnrollmentModal — detalle de una inscripción (Cursos/Workshop), en la
 * hoja única del panel (`Sheet`). Mismo patrón que ClientModal: ver, editar,
 * WhatsApp directo y eliminar (con confirmación).
 *
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
  const [form, setForm] = useState(() => formOf(enrollment))
  const [clientQuery, setClientQuery] = useState('')
  const [creatingClient, setCreatingClient] = useState(false)
  const [clientMsg, setClientMsg] = useState('')

  useEffect(() => {
    setForm(formOf(enrollment))
    setEditing(false)
    setConfirmDel(false)
    setClientQuery('')
    setClientMsg('')
  }, [enrollment])

  if (!enrollment) return null
  const e = enrollment

  const first = (e.name || '').split(' ')[0] || 'Hola'
  const phoneDigits = cleanPhone(e.phone)
  const waHref = buildWaHref(e.phone, `Hola ${first}, te escribimos de Brunetti 💈`)
  const isWorkshop = e.source === 'workshop'
  const paid = isPaid(e)
  const payment = parsePayment(e.message)
  const amount = e.amount != null ? Number(e.amount) : (payment?.amount ?? null)

  const matchedClient = clients.find((c) => cleanPhone(c.phone) === phoneDigits && phoneDigits.length === 9)

  const q = clientQuery.trim().toLowerCase()
  const searchResults = q
    ? clients.filter((c) => c.name?.toLowerCase().includes(q) || c.phone?.includes(q) || c.email?.toLowerCase().includes(q)).slice(0, 6)
    : []

  const set = (k) => (ev) => setForm((f) => ({ ...f, [k]: ev.target.value }))

  const save = () => {
    if (!form.name.trim()) return
    onSave({
      ...e,
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
      await onCreateClient({ name: e.name, phone: phoneDigits, email: e.email })
      setClientMsg('Cliente creado.')
    } catch (err) {
      setClientMsg(err?.message || 'No se pudo crear el cliente.')
    } finally {
      setCreatingClient(false)
    }
  }

  return (
    <>
      <Sheet
        open={Boolean(enrollment)}
        onClose={onClose}
        size="md"
        lead={<Avatar name={e.name} size={44} accent />}
        title={e.name || 'Inscripción'}
        subtitle={`+56 ${e.phone || '—'}${e.email ? ` · ${e.email}` : ''}`}
        headActions={!editing && onDelete ? (
          <ActionMenu
            title={e.name}
            items={[{ label: 'Eliminar inscripción', icon: 'trash', danger: true, onClick: () => setConfirmDel(true) }]}
          />
        ) : null}
        footer={editing ? (
          <>
            <Button variant="secondary" onClick={() => { setEditing(false); setForm(formOf(e)) }}>Cancelar</Button>
            <Button variant="primary" icon="check" onClick={save}>Guardar</Button>
          </>
        ) : (
          <>
            <IconButton
              icon="whatsapp"
              label="Escribir por WhatsApp"
              disabled={!waHref}
              onClick={() => waHref && window.open(waHref, '_blank', 'noopener,noreferrer')}
            />
            <Button variant="secondary" icon="pencil" onClick={() => setEditing(true)}>Editar</Button>
          </>
        )}
      >
        {editing ? (
          <div className="pn-stack">
            <Field label="Nombre">
              <input className="input" value={form.name} onChange={set('name')} placeholder="Nombre y apellido" autoComplete="off" />
            </Field>
            <Field label="Teléfono" hint="9 dígitos, sin +56">
              <input className="input" value={form.phone} onChange={set('phone')} inputMode="tel" placeholder="9 1234 5678" autoComplete="off" />
            </Field>
            <Field label="Correo">
              <input className="input" value={form.email} onChange={set('email')} inputMode="email" placeholder="correo@ejemplo.com" autoComplete="off" autoCapitalize="off" />
            </Field>
            {isWorkshop
              ? <Field label="Edición"><input className="input" value={form.edition} onChange={set('edition')} placeholder="30 de agosto" /></Field>
              : <Field label="Nivel"><input className="input" value={form.level} onChange={set('level')} placeholder="Estoy empezando" /></Field>}
            <Field label="Mensaje" optional>
              <textarea className="input" rows={3} value={form.message} onChange={set('message')} />
            </Field>
          </div>
        ) : (
          <div className="pn-stack is-lg">
            <div className="pn-online-chips">
              <OriginChip type={e.source} />
              {paid && <Chip tone="ok" icon="check">Pagada</Chip>}
            </div>

            <List>
              {paid && amount != null && <ListRow title="Monto" value={CLP(amount)} />}
              <ListRow title="Origen" trailing={<OriginChip type={e.source} />} />
              <ListRow title="Detalle" subtitle={detailOf(e)} subtitleWrap />
              <ListRow title="Teléfono" subtitle={e.phone ? `+56 ${e.phone}` : 'Sin teléfono'} />
              <ListRow title="Correo" subtitle={e.email || 'Sin correo'} subtitleWrap />
              <ListRow title="Inscrito" value={fmtStamp(e.created_at)} />
              {paid && payment?.paymentId && <ListRow title="Pago" subtitle={`Mercado Pago · ${payment.paymentId}`} subtitleWrap />}
              {!paid && e.message && <ListRow title="Mensaje" subtitle={e.message} subtitleWrap />}
            </List>

            <div className="pn-stack">
              <SearchField value={clientQuery} onChange={setClientQuery} placeholder="Buscar en tus clientes…" ariaLabel="Buscar en tus clientes" />
              {searchResults.length > 0 && (
                <List>
                  {searchResults.map((c) => (
                    <ListRow key={c.id || c.phone} title={c.name} subtitle={`${c.phone} · ${c.email || 'sin correo'}`} />
                  ))}
                </List>
              )}

              {matchedClient ? (
                <InlineAlert tone="info" icon="user">Ya está registrado como cliente.</InlineAlert>
              ) : (
                <Button variant="secondary" icon="user" block loading={creatingClient} onClick={createClientNow}>
                  {creatingClient ? 'Creando…' : 'Crear cliente con estos datos'}
                </Button>
              )}
              {clientMsg && <InlineAlert tone={matchedClient || clientMsg === 'Cliente creado.' ? 'success' : 'error'}>{clientMsg}</InlineAlert>}
            </div>
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={confirmDel}
        onCancel={() => setConfirmDel(false)}
        onConfirm={() => { setConfirmDel(false); onDelete(e) }}
        tone="danger"
        icon="trash"
        title={`¿Eliminar la inscripción de ${e.name}?`}
        message="Se quitará de la lista de inscripciones. Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
      />
    </>
  )
}
