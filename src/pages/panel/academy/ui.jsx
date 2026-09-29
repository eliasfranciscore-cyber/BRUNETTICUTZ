import React, { useRef, useState } from 'react'
import { Icon } from '../../../academy/Icon.jsx'
import { fmtDate } from '../../../data.js'
import { isImageUrl, slugify } from '../../../academy/url.js'
import {
  Button, Chip, EmptyState, Field, InlineAlert, SkeletonRows,
} from '../../../components/panel/index.js'
import { errorText } from './adminApi.js'

/* Piezas chicas compartidas por las secciones de la pestaña Academy. */

const cx = (...p) => p.filter(Boolean).join(' ')

/* Estados de una carga: esqueleto → error con "Reintentar" → vacío → datos.
   Toda lectura de la pestaña pasa por acá; ninguna cae a datos de demo. */
export function LoadBlock({ loading, error, onRetry, empty, emptyIcon = 'spark', emptyTitle, emptyText, emptyAction, rows = 4, children }) {
  if (loading) return <SkeletonRows rows={rows} />
  if (error) {
    return (
      <InlineAlert tone="error" title="No se pudo cargar" action={onRetry ? { label: 'Reintentar', onClick: () => onRetry() } : undefined}>
        {errorText(error)}
      </InlineAlert>
    )
  }
  if (empty) return <EmptyState icon={emptyIcon} title={emptyTitle} text={emptyText} action={emptyAction} />
  return children
}

/* Fechas: la API manda instantes ISO en UTC ("…Z"); se muestran en hora de
   Santiago (fmtDate de data.js ya lo hace cuando recibe un Date). */
export function fmtWhen(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return fmtDate(d, 'dmy')
}

export function fmtWhenTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const time = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  return `${fmtDate(d, 'dm')} · ${time}`
}

/* "2026-10-05" (fecha de calendario, sin zona) → "5 oct 2026". */
export function fmtDay(key) {
  if (!key) return '—'
  return fmtDate(String(key).slice(0, 10), 'dmy')
}

export const ROLE_LABEL = { propietario: 'Propietario', admin: 'Admin', moderador: 'Moderador', miembro: 'Miembro' }

export const MEMBER_STATUS = {
  activo: { label: 'Activo', tone: 'ok' },
  cancelado: { label: 'Cancelado', tone: 'muted' },
  expulsado: { label: 'Expulsado', tone: 'bad' },
}

export const SOURCE_LABEL = { pago: 'Compra', invitacion: 'Invitación', propietario: 'Propietario', puente: 'BrunettiCutz', manual: 'Manual' }

export const ORDER_STATUS = {
  pendiente: { label: 'Pendiente', tone: 'warn' },
  pagada: { label: 'Pagada', tone: 'ok' },
  revision: { label: 'En revisión', tone: 'bad' },
  reembolsada: { label: 'Reembolsada', tone: 'muted' },
  anulada: { label: 'Anulada', tone: 'muted' },
}

export const GRANT_STATE = {
  activa: { label: 'Activo', tone: 'ok' },
  revision: { label: 'En revisión', tone: 'warn' },
  revocada: { label: 'Revocado', tone: 'muted' },
}

export const ACCESS_LABEL = { compra: 'Se compra', abierto: 'Abierto a todos', nivel: 'Por nivel' }

export function StatusChip({ map, value }) {
  const meta = map[value] || { label: value || '—', tone: 'muted' }
  return <Chip tone={meta.tone} dot>{meta.label}</Chip>
}

/* Qué pasó con las credenciales de un miembro, en palabras del barbero. */
export function credentialsText(value) {
  switch (value) {
    case 'enviadas': return 'Le enviamos su usuario y contraseña temporal por correo.'
    case 'pendientes': return 'La cuenta quedó lista; el correo con la contraseña sale apenas haya cupo de envío.'
    case 'cuenta_existente': return 'Ya tenía contraseña: le avisamos por correo que tiene acceso.'
    case 'no_aplica': return 'No hacía falta enviar credenciales.'
    default: return 'Listo.'
  }
}

export function accessState(m) {
  if (!m) return '—'
  if (m.lastLoginAt) return `Entró ${fmtWhen(m.lastLoginAt)}`
  if (m.mustChangePassword && m.credentialsSentAt) return `Credenciales enviadas ${fmtWhen(m.credentialsSentAt)}`
  if (m.credentialsSentAt) return `Correo enviado ${fmtWhen(m.credentialsSentAt)}`
  return 'Aún no entra'
}

// Mismo slug que el backend (espejo de api/_academyText.js).
export { slugify }

/* Mueve un elemento del arreglo `delta` posiciones (−1 arriba, +1 abajo). */
export function moveItem(list, index, delta) {
  const next = list.slice()
  const to = index + delta
  if (to < 0 || to >= next.length) return list
  const [item] = next.splice(index, 1)
  next.splice(to, 0, item)
  return next
}

export function ReorderButtons({ onUp, onDown, disableUp, disableDown, label = 'elemento' }) {
  return (
    <span className="pn-aca-reorder" onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={onUp} disabled={disableUp} aria-label={`Subir ${label}`} title="Subir">
        <Icon name="chevronUp" size={15} />
      </button>
      <button type="button" onClick={onDown} disabled={disableDown} aria-label={`Bajar ${label}`} title="Bajar">
        <Icon name="chevronDown" size={15} />
      </button>
    </span>
  )
}

/* Número opcional de un input de texto: '' → null; con puntos de miles se
   limpian ("45.000" → 45000). */
export function parseMoney(v) {
  const digits = String(v ?? '').replace(/[^\d]/g, '')
  return digits ? Number(digits) : null
}

export function moneyProblem(v) {
  if (v === null) return null
  if (v < 1000) return 'Mínimo $1.000'
  if (v > 10000000) return 'Máximo $10.000.000'
  return null
}

/* Portada: URL + vista previa + "Subir imagen".
   La vista previa solo se dibuja si la URL es del Blob del proyecto o de
   /assets/ (isImageUrl): el CSP de /academy/* no deja cargar otras, así que
   una URL de afuera se vería rota para los miembros aunque acá se viera bien. */
export function CoverField({ label = 'Portada', value, onChange, kind = 'curso', api, hint, ratio = 'wide' }) {
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const url = String(value || '').trim()
  const valid = !url || isImageUrl(url)

  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !api?.uploadImage) return
    setBusy(true)
    setErr('')
    try {
      const up = await api.uploadImage(kind, file)
      onChange(up.url)
    } catch (error) {
      setErr(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Field
      label={label}
      optional
      error={err || (!valid ? 'Esa URL no se va a ver en la Academy: usa una imagen subida acá o una ruta /assets/…' : null)}
      hint={hint || 'Sube una imagen (se comprime sola) o pega la URL de una ya subida.'}
    >
      <div className={cx('pn-aca-cover', ratio === 'square' && 'is-square')}>
        <span className="pn-aca-cover-preview">
          {url && valid ? <img src={url} alt="" loading="lazy" /> : <Icon name="image" size={22} />}
        </span>
        <div className="pn-aca-cover-controls">
          <input className="input" value={value || ''} placeholder="https://…public.blob.vercel-storage.com/…" onChange={(e) => onChange(e.target.value)} inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          <div className="pn-hstack">
            <Button size="sm" icon="upload" onClick={() => fileRef.current?.click()} loading={busy}>Subir imagen</Button>
            {url && <Button size="sm" variant="plain" onClick={() => onChange('')}>Quitar</Button>}
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pick} />
        </div>
      </div>
    </Field>
  )
}

export function todayStamp() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return parts
}
