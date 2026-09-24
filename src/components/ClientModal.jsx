import React, { useEffect, useRef, useState } from 'react'
import { Icon } from './ui.jsx'
import { CLP, cleanPhone, fmtDate, santiagoDateKey } from '../data.js'
import { FEATURES } from '../features.js'
import { waHref as buildWaHref, waMessages } from '../whatsapp.js'
import {
  Sheet, ConfirmDialog, ActionMenu, Avatar, KpiGrid, List, ListRow, EmptyState,
  Field, Button, IconButton, Chip, ProgressBar, SectionLabel,
} from './panel/index.js'
import { StatusChip } from '../pages/panel/BookingDetailSheet.jsx'
import '../styles/panel/clientes.css'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/* "tiene hora hoy" / "tiene hora el 26 sep": `nextVisit` puede ser hoy
   mismo (una hora de la tarde que todavía no llega). */
const nextVisitLabel = (iso, today) => (String(iso).slice(0, 10) === today ? 'hoy' : `el ${fmtDate(iso, 'dm')}`)

const STATUS_META = {
  activo: { label: 'Activo', icon: 'checkCircle' },
  nuevo: { label: 'Nuevo', icon: 'spark' },
  inactivo: { label: 'Inactivo', icon: 'clock' },
}

const formOf = (c) => ({
  name: c?.name || '',
  phone: c?.phone || '',
  email: c?.email || '',
  status: c?.status || 'activo',
  profession: c?.profession || '',
})

/**
 * ClientModal — ficha del cliente, en la hoja única del panel (`Sheet`).
 * Muestra KPIs, fidelidad e historial; gestiona editar datos, WhatsApp
 * directo, agendar, mandar la tarjeta y eliminar (admin, con confirmación).
 *
 * Props:
 *  client, history, startEditing
 *  onClose, onSave(updated), onDelete(client), onSchedule(client)
 *  ctx — el `dash` del panel: se usan `admin`, `sendWalletCard`,
 *        `walletSendingId` y `clientKey` (todos opcionales).
 */
export default function ClientModal({ client, history = [], startEditing = false, onClose, onSave, onDelete, onSchedule, ctx = {} }) {
  const { sendWalletCard, walletSendingId, clientKey, admin } = ctx || {}
  /* La hoja se sigue dibujando con el último cliente mientras se anima al
     cerrar (Dashboard pone `selectedClient` en null de una): así "Agendar"
     y la X cierran con su animación en vez de desaparecer de golpe. */
  const lastRef = useRef(client)
  if (client) lastRef.current = client
  const c = client || lastRef.current
  const keyOf = (x) => (x ? (clientKey ? clientKey(x) : (x.id ?? x.phone)) : null)
  const key = keyOf(client)

  const [editing, setEditing] = useState(Boolean(startEditing))
  const [confirmDel, setConfirmDel] = useState(false)
  const [form, setForm] = useState(() => formOf(client))
  const [errors, setErrors] = useState({})

  // Se reinicia al abrir OTRO cliente, no cada vez que la ficha abierta se
  // refresca (guardar actualiza `selectedClient` y no debe volver a editar).
  useEffect(() => {
    if (!client) return
    setForm(formOf(client))
    setEditing(Boolean(startEditing))
    setConfirmDel(false)
    setErrors({})
  }, [key, startEditing]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!c) return null

  const waHref = buildWaHref(c.phone, waMessages.saludo({ client: c.name }))
  /* Respaldo con el historial solo si la lista no trajo la cifra (un backend
     viejo o sin API). `??`, no `||`: un 0 que manda el servidor es un 0. El
     historial trae horas futuras y canceladas, que no son visitas: se corta
     en hoy (Santiago). */
  const today = santiagoDateKey()
  const pastHistory = (history || []).filter((h) => h.status !== 'cancelada' && String(h.date || '') <= today)
  const visits = Number(c.visits ?? pastHistory.length) || 0
  const totalSpent = c.totalSpent ?? pastHistory
    .filter((h) => h.status === 'completada')
    .reduce((s, h) => s + Number(h.paidAmount ?? h.price ?? 0), 0)
  const lastVisitKey = 'lastVisit' in c ? (c.lastVisit || null) : (pastHistory[0]?.date || null)
  const sendingWallet = walletSendingId != null && walletSendingId === keyOf(c)
  const loyalty = c.loyalty || null

  const set = (k) => (e) => {
    const v = e.target.value
    setForm((f) => ({ ...f, [k]: v }))
    if (errors[k]) setErrors((er) => ({ ...er, [k]: undefined }))
  }
  /* Misma regla que POST /api/clients (validateClient): nombre, 9 dígitos y
     un correo válido. Sin esto el cambio se veía guardado acá y el servidor
     lo rechazaba en silencio: al recargar volvía el dato viejo. */
  const save = () => {
    const name = form.name.trim()
    const phone = cleanPhone(form.phone)
    const email = form.email.trim().toLowerCase()
    const next = {}
    if (!name) next.name = 'Escribe el nombre.'
    if (phone.length !== 9) next.phone = 'Debe tener 9 dígitos.'
    if (!EMAIL_RE.test(email)) next.email = email ? 'Ese correo no es válido.' : 'Hace falta un correo para guardar la ficha.'
    if (Object.keys(next).length) { setErrors(next); return }
    onSave?.({
      ...c,
      name,
      phone,
      email,
      status: form.status,
      // Ficha conocida → lo que quede en el campo es lo que se guarda,
      // incluido vaciarlo a propósito ('' = borrar la profesión).
      ...(FEATURES.profession ? { profession: form.profession.trim() } : {}),
    })
    setEditing(false)
  }
  const onEnter = (e) => { if (e.key === 'Enter') { e.preventDefault(); save() } }

  const noVisitsNote = [
    'Sin visitas todavía',
    c.nextVisit ? `tiene hora ${nextVisitLabel(c.nextVisit, today)}` : null,
    c.walletHasPass ? 'ya tiene la tarjeta en Wallet' : null,
    c.createdAt ? `se registró el ${fmtDate(c.createdAt, 'dmy')}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <>
      <Sheet
        open={Boolean(client)}
        onClose={onClose}
        size="md"
        lead={<Avatar name={c.name} size={44} accent />}
        title={c.name || 'Cliente'}
        subtitle={`+56 ${c.phone || '—'}${c.email ? ` · ${c.email}` : ''}`}
        headActions={!editing && admin && onDelete ? (
          <ActionMenu
            title={c.name}
            items={[{ label: 'Eliminar cliente', icon: 'trash', danger: true, onClick: () => setConfirmDel(true) }]}
          />
        ) : null}
        footer={editing ? (
          <>
            <Button variant="secondary" onClick={() => { setEditing(false); setForm(formOf(c)); setErrors({}) }}>Cancelar</Button>
            <Button variant="primary" icon="check" onClick={save}>Guardar</Button>
          </>
        ) : (
          <>
            {/* WhatsApp va como ícono: con los tres rótulos a la vez
                ("WhatsApp"/"Editar"/"Agendar") no entran en una fila de 375 px
                sin recortar texto, y es el más reconocible sin palabra. */}
            <IconButton
              icon="whatsapp"
              label="Escribir por WhatsApp"
              disabled={!waHref}
              onClick={() => waHref && window.open(waHref, '_blank', 'noopener,noreferrer')}
            />
            <Button variant="secondary" icon="pencil" onClick={() => setEditing(true)}>Editar</Button>
            <Button variant="primary" icon="calendar" onClick={() => onSchedule?.(c)}>Agendar</Button>
          </>
        )}
      >
        {editing ? (
          <div className="pn-clientes-form">
            <Field label="Nombre" error={errors.name}>
              <input className="input" value={form.name} onChange={set('name')} onKeyDown={onEnter} placeholder="Nombre y apellido" autoComplete="off" />
            </Field>
            <Field label="Teléfono" hint="9 dígitos, sin +56" error={errors.phone}>
              <input className="input" value={form.phone} onChange={set('phone')} onKeyDown={onEnter} inputMode="tel" placeholder="9 1234 5678" autoComplete="off" />
            </Field>
            <Field label="Correo" error={errors.email}>
              <input className="input" value={form.email} onChange={set('email')} onKeyDown={onEnter} inputMode="email" placeholder="correo@ejemplo.com" autoComplete="off" autoCapitalize="off" />
            </Field>
            {FEATURES.profession && (
              <Field label="Profesión" optional>
                <input className="input" value={form.profession} onChange={set('profession')} onKeyDown={onEnter} placeholder="Ej: Ingeniero, Estudiante" maxLength={80} />
              </Field>
            )}
            <Field label="Estado" className="pn-field-full">
              <select className="input" value={form.status} onChange={set('status')}>
                <option value="activo">Activo</option>
                <option value="nuevo">Nuevo</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </Field>
          </div>
        ) : (
          <div className="pn-stack is-lg">
            {(FEATURES.profession && c.profession) || (visits === 0) || c.nextVisit ? (
              <div className="pn-clientes-facts">
                {FEATURES.profession && c.profession && <p className="pn-clientes-profession">{c.profession}</p>}
                {visits === 0
                  ? <p className="pn-muted pn-clientes-fact">{noVisitsNote}</p>
                  : c.nextVisit && <Chip tone="info" icon="calendar">Tiene hora {nextVisitLabel(c.nextVisit, today)}</Chip>}
              </div>
            ) : null}

            <KpiGrid items={[
              { id: 'visits', icon: 'scissors', label: 'Visitas', value: visits },
              { id: 'total', icon: 'wallet', label: 'Total gastado', value: Number(totalSpent) || 0, format: CLP },
              { id: 'last', icon: 'clock', label: 'Última visita', value: lastVisitKey ? fmtDate(lastVisitKey, 'dm') : '—' },
              // Cuarto KPI a propósito: en el celular la grilla es de 2
              // columnas y 3 tarjetas dejan un hueco al lado de "Última visita".
              { id: 'status', icon: (STATUS_META[c.status]?.icon || 'user'), label: 'Estado', value: STATUS_META[c.status]?.label || '—', animate: false },
            ]}
            />

            {loyalty && (
              <div className="pn-clientes-loyalty">
                <div className="pn-between">
                  <span className="pn-clientes-loyalty-label"><Icon name="star" size={13} /> Tarjeta de fidelidad</span>
                  <span className="pn-num pn-clientes-loyalty-count">{loyalty.stars}/{loyalty.goal}</span>
                </div>
                <ProgressBar value={loyalty.stars} max={loyalty.goal} label="Estrellas de fidelidad" />
                <div className="pn-hstack">
                  {loyalty.freeCutReady ? (
                    <Chip tone="ok" icon="gift">Corte gratis listo</Chip>
                  ) : (
                    <>
                      {loyalty.productDiscountReady && <Chip tone="info" icon="percent">{loyalty.productDiscountPct}% en productos</Chip>}
                      <span className="pn-clientes-loyalty-hint">
                        Le {loyalty.cutsToFreeCut === 1 ? 'falta 1 corte' : `faltan ${loyalty.cutsToFreeCut} cortes`} para el corte gratis
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}

            {!c.walletHasPass && sendWalletCard && (
              <Button variant="secondary" icon="wallet" block loading={sendingWallet} onClick={() => sendWalletCard(c)}>
                {sendingWallet ? 'Generando el link…' : 'Enviar tarjeta por WhatsApp'}
              </Button>
            )}

            <div>
              <SectionLabel>Historial de reservas</SectionLabel>
              {(history || []).length === 0 ? (
                <EmptyState
                  compact
                  icon="calendar"
                  title="Sin historial todavía"
                  text="Este cliente aún no tiene reservas registradas. Con Agendar le tomas una hora."
                />
              ) : (
                <List>
                  {history.map((item) => {
                    const cancelled = item.status === 'cancelada'
                    return (
                      <ListRow
                        key={item.id || `${item.date}-${item.time}`}
                        title={item.service || 'Servicio'}
                        subtitle={`${fmtDate(item.date, 'short')}${item.time ? ` · ${item.time}` : ''}`}
                        value={CLP(item.paidAmount ?? item.price)}
                        meta={item.status && item.status !== 'completada' ? <StatusChip bk={item} /> : null}
                        dim={cancelled}
                      />
                    )
                  })}
                </List>
              )}
            </div>
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={confirmDel}
        onCancel={() => setConfirmDel(false)}
        onConfirm={() => { setConfirmDel(false); onDelete?.(c) }}
        tone="danger"
        icon="trash"
        title={`¿Eliminar a ${c.name || 'este cliente'}?`}
        message="Se quitará de tu lista de clientes junto con su historial de reservas. Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
      />
    </>
  )
}
