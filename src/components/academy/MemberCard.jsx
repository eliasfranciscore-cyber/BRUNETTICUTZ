import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../academy/Icon.jsx'
import { Button, IconButton, Chip } from '../panel/index.js'
import MemberAvatar from './MemberAvatar.jsx'
import { useAcademy } from '../../academy/context.js'
import { academyApi } from '../../academy/api.js'
import { safeUrl } from '../../academy/url.js'
import { r } from '../../academy/routes.js'
import '../../styles/academy/miembros.css'

/* ============================================================
   Tarjeta de miembro (pestaña Miembros, como la captura 3 de Skool) y los
   helpers que comparten las piezas de FE-MIEMBROS (perfil, ajustes, hojas
   de administración). Viven acá y no en src/academy/ porque ese directorio
   es de FE-CORE: cada agente edita solo sus archivos.
   ============================================================ */

export const cx = (...p) => p.filter(Boolean).join(' ')
export const TZ_DEFAULT = 'America/Santiago'

export const ROLE_LABEL = { propietario: 'Propietario', admin: 'Admin', moderador: 'Moderador', miembro: 'Miembro' }
export const STATUS_LABEL = { activo: 'Activo', cancelado: 'Cancelado', expulsado: 'Expulsado' }
export const SOURCE_LABEL = { pago: 'Compró un curso', invitacion: 'Invitado', propietario: 'Propietario', puente: 'Alumno de BrunettiCutz' }
export const GRANT_STATE = {
  activa: { label: 'Activa', tone: 'ok' },
  revision: { label: 'En revisión', tone: 'warn' },
  revocada: { label: 'Revocada', tone: 'muted' },
}

/* Resultado de `claimAndSendCredentials` (§6.4) tal como lo devuelven
   admin-invite y admin-resend-access. */
export const CREDENTIALS_TEXT = {
  enviadas: 'Le enviamos un correo con su usuario y una contraseña temporal (válida por 72 horas).',
  pendientes: 'La cuenta quedó lista. El correo con la contraseña temporal sale apenas haya cupo de envío; se reintenta solo.',
  cuenta_existente: 'Ya tenía una cuenta con contraseña: le avisamos por correo que tiene acceso nuevo.',
  no_aplica: 'No había credenciales que enviar: la cuenta ya tiene contraseña o no tiene cursos activos. Si olvidó su contraseña, envíale un enlace.',
}

export function plural(n, one, many) {
  return Number(n) === 1 ? one : many
}

export function errorText(e, fallback = 'Algo salió mal. Inténtalo de nuevo.') {
  if (!e) return fallback
  if (e.status === 429) return e.message || 'Demasiados intentos. Espera un momento y vuelve a intentarlo.'
  if (e.status === 503 || e.code === 'unavailable') return 'La Academy no está disponible en este momento. Inténtalo en unos minutos.'
  return e.message || fallback
}

/* Fecha corta es-CL ("19 may 2026"). Una fecha sin hora (YYYY-MM-DD) se
   formatea en UTC para que no se corra un día hacia atrás en Chile. */
export function fmtDay(iso, tz = TZ_DEFAULT) {
  if (!iso) return ''
  const s = String(iso)
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s)
  const d = dateOnly ? new Date(`${s}T12:00:00Z`) : new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  const opts = { day: 'numeric', month: 'short', year: 'numeric', timeZone: dateOnly ? 'UTC' : tz }
  try { return new Intl.DateTimeFormat('es-CL', opts).format(d) } catch {
    return new Intl.DateTimeFormat('es-CL', { ...opts, timeZone: 'UTC' }).format(d)
  }
}

export function fmtDayTime(iso, tz = TZ_DEFAULT) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const opts = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }
  try { return new Intl.DateTimeFormat('es-CL', opts).format(d) } catch {
    return new Intl.DateTimeFormat('es-CL', { ...opts, timeZone: 'UTC' }).format(d)
  }
}

/* "hace 5 min", "hace 3 h", "hace 2 días"… para "Activo hace X". */
export function sinceText(iso, now = Date.now()) {
  const t = Date.parse(iso || '')
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, (now - t) / 1000)
  if (s < 60) return 'hace un momento'
  const m = Math.floor(s / 60)
  if (m < 60) return `hace ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  if (d < 30) return d === 1 ? 'hace 1 día' : `hace ${d} días`
  const mo = Math.floor(d / 30)
  if (mo < 12) return mo === 1 ? 'hace 1 mes' : `hace ${mo} meses`
  const y = Math.floor(d / 365)
  return y <= 1 ? 'hace 1 año' : `hace ${y} años`
}

/* ---------- Enlaces del perfil ({instagram, tiktok, whatsapp, web}) ---------- */
export const LINK_KEYS = ['instagram', 'tiktok', 'whatsapp', 'web']
export const LINK_META = {
  instagram: { label: 'Instagram', icon: 'instagram', placeholder: '@tuusuario o instagram.com/tuusuario' },
  tiktok: { label: 'TikTok', icon: 'play', placeholder: '@tuusuario' },
  whatsapp: { label: 'WhatsApp', icon: 'whatsapp', placeholder: '9 1234 5678' },
  web: { label: 'Sitio web', icon: 'globe', placeholder: 'tusitio.cl' },
}

/* Convierte lo que escribió el miembro (un @usuario, un número o una URL) en
   una URL https segura. '' = vacío (borrar el enlace), null = no válido.
   Todo termina en safeUrl(): un "javascript:…" nunca llega a un href. */
export function toLinkUrl(kind, raw) {
  const v = String(raw || '').trim()
  if (!v) return ''
  if (kind === 'instagram') {
    const h = v.replace(/^@/, '')
    if (/^[A-Za-z0-9._]{1,30}$/.test(h)) return safeUrl(`https://www.instagram.com/${h}`)
  }
  if (kind === 'tiktok') {
    const h = v.replace(/^@/, '')
    if (/^[A-Za-z0-9._]{2,24}$/.test(h)) return safeUrl(`https://www.tiktok.com/@${h}`)
  }
  if (kind === 'whatsapp' && !/[a-z]/i.test(v)) {
    const digits = v.replace(/\D/g, '')
    if (digits.length >= 8 && digits.length <= 15) {
      return safeUrl(`https://wa.me/${digits.length === 9 ? `56${digits}` : digits}`)
    }
    return null
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`
  return safeUrl(withScheme) || null
}

export function memberLinks(links) {
  if (!links || typeof links !== 'object') return []
  return LINK_KEYS
    .map((k) => {
      const href = toLinkUrl(k, links[k])
      return href ? { key: k, href, ...LINK_META[k] } : null
    })
    .filter(Boolean)
}

export const EXTERNAL_REL = 'noopener noreferrer nofollow ugc'

/* Descarga local (CSV, JSON de "mis datos"). Blob + <a download>: no toca
   la red ni la CSP. */
export function downloadBlob(filename, content, type = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function todayStamp() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ_DEFAULT }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

export function roleTag(role) {
  return role && role !== 'miembro' && ROLE_LABEL[role] ? `(${ROLE_LABEL[role]})` : null
}

/* Estado de presencia: "En línea ahora" (last_sync_at < 90 s, lo calcula el
   servidor) o "Activo hace X" (last_seen_at). Los dos respetan la
   privacidad del miembro: el servidor manda null/false si los ocultó. */
export function Presence({ member, className }) {
  if (member?.online) {
    return (
      <span className={cx('aca-mi-presence is-online', className)}>
        <span className="aca-mi-dot" aria-hidden="true" />En línea ahora
      </span>
    )
  }
  if (member?.lastSeenAt) {
    const txt = sinceText(member.lastSeenAt)
    if (!txt) return null
    return (
      <span className={cx('aca-mi-presence', className)}>
        <Icon name="clock" size={16} />Activo {txt}
      </span>
    )
  }
  return null
}

/* Botón Seguir/Siguiendo. `initial` puede venir vacío en el listado de
   miembros (MemberPublic no trae si lo sigo): el POST es idempotente, así
   que un "Seguir" sobre alguien que ya sigo no rompe nada. */
export function FollowButton({ memberId, initial = false, size = 'sm', onChange, block }) {
  const { toast } = useAcademy()
  const [following, setFollowing] = useState(Boolean(initial))
  const [busy, setBusy] = useState(false)
  useEffect(() => { setFollowing(Boolean(initial)) }, [initial, memberId])
  const toggle = async () => {
    if (busy) return
    const next = !following
    setBusy(true)
    setFollowing(next)
    try {
      const res = await academyApi('follow', { method: 'POST', body: { targetType: 'miembro', targetId: memberId, follow: next } })
      const value = typeof res?.following === 'boolean' ? res.following : next
      setFollowing(value)
      onChange?.(value)
    } catch (e) {
      setFollowing(!next)
      toast?.(errorText(e, 'No se pudo actualizar el seguimiento'), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button
      size={size}
      block={block}
      variant="secondary"
      className={cx('aca-mi-follow', following && 'is-on')}
      icon={following ? 'check' : 'plus'}
      onClick={toggle}
      disabled={busy}
      aria-pressed={following}
    >
      {following ? 'Siguiendo' : 'Seguir'}
    </Button>
  )
}

/* ---------- Tarjeta ---------- */
export default function MemberCard({ member: m, adminView = false, onManage }) {
  const { me, openChat } = useAcademy()
  if (!m) return null
  const isMe = me && Number(me.id) === Number(m.id)
  const tag = roleTag(m.role)
  const profile = m.handle ? r.profile(m.handle) : null
  const NameTag = profile ? Link : 'span'
  const nameProps = profile ? { to: profile } : {}
  const inactive = adminView && m.status && m.status !== 'activo'

  return (
    <article className={cx('aca-mcard', inactive && 'is-inactive')}>
      <NameTag {...nameProps} className="aca-mcard-avatar" aria-label={profile ? `Ver perfil de ${m.name}` : undefined}>
        <MemberAvatar member={m} size={56} />
      </NameTag>

      <div className="aca-mcard-main">
        <div className="aca-mcard-head">
          <div className="aca-mcard-id">
            <div className="aca-mcard-nameline">
              <NameTag {...nameProps} className="aca-mcard-name">{m.name}</NameTag>
              {tag && <span className="aca-mi-role">{tag}</span>}
              {isMe && <Chip tone="muted">Tú</Chip>}
              {inactive && <Chip tone={m.status === 'expulsado' ? 'bad' : 'warn'}>{STATUS_LABEL[m.status] || m.status}</Chip>}
            </div>
            {m.handle && <div className="aca-mcard-handle">@{m.handle}</div>}
            {adminView && m.email && <div className="aca-mcard-email">{m.email}</div>}
          </div>

          <div className="aca-mcard-actions">
            {!isMe && (
              <>
                <Button size="sm" icon="message" onClick={() => openChat?.({ memberId: m.id })}>Chat</Button>
                <FollowButton memberId={m.id} initial={m.following ?? m.isFollowing} />
              </>
            )}
            {adminView && onManage && (
              <IconButton icon="more" label={`Administrar a ${m.name}`} small onClick={() => onManage(m)} />
            )}
          </div>
        </div>

        {m.bio && <p className="aca-mcard-bio">{m.bio}</p>}

        <ul className="aca-mcard-meta">
          {(m.online || m.lastSeenAt) && <li><Presence member={m} /></li>}
          {adminView && m.source && (
            <li><span className="aca-mi-meta-item"><Icon name="key" size={16} />{SOURCE_LABEL[m.source] || m.source}</span></li>
          )}
          {!adminView && m.location && (
            <li><span className="aca-mi-meta-item"><Icon name="pin" size={16} />{m.location}</span></li>
          )}
          {m.joinedAt && (
            <li><span className="aca-mi-meta-item"><Icon name="calendar" size={16} />Se unió el {fmtDay(m.joinedAt)}</span></li>
          )}
          <li><span className="aca-mi-meta-item"><Icon name="refresh" size={16} />Acceso de por vida</span></li>
        </ul>
      </div>
    </article>
  )
}

export { MemberCard }
