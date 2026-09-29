import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import LevelBadge from './LevelBadge.jsx'
import { isImageUrl } from '../../academy/url.js'
import { r } from '../../academy/routes.js'
import '../../styles/academy/app.css'

/* Avatar de un miembro: foto (solo si es del Blob del proyecto o de /assets,
   SPEC §0.2) o iniciales, con el número de nivel abajo a la derecha como en
   Skool. `member` es un MemberMini/MemberPublic: { id, handle, name,
   avatarUrl, level, role }. Un miembro eliminado (null) se ve como "·".

   Props: size (px), showLevel, link (envuelve en un link al perfil),
   online (puntito verde), className. */

const TONES = 6
function toneFor(seed) {
  const s = String(seed ?? '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % TONES
}

export function memberInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '·'
  const first = Array.from(parts[0])[0] || ''
  const second = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] || '' : ''
  return (first + second).toUpperCase()
}

export default function MemberAvatar({ member, size = 40, showLevel = true, link = false, online = false, className, title }) {
  const url = member?.avatarUrl || null
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [url])

  const name = member?.name || 'Miembro'
  const src = !failed && url && isImageUrl(url) ? url : null
  const level = member?.level
  const badge = showLevel && level && size >= 24
  const badgeSize = Math.max(14, Math.min(40, Math.round(size * 0.4)))

  const inner = (
    <span
      className={['aca-avatar', className].filter(Boolean).join(' ')}
      style={{ '--s': `${size}px` }}
      title={title}
      aria-hidden={link ? 'true' : undefined}
    >
      <span className="aca-avatar-face" data-tone={toneFor(member?.id ?? name)}>
        {src
          ? <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
          : <span className="aca-avatar-initials" aria-hidden="true">{member ? memberInitials(name) : '·'}</span>}
      </span>
      {badge && <LevelBadge level={level} size={badgeSize} className="aca-avatar-lvl" />}
      {online && <span className="aca-avatar-online" title="En línea" />}
    </span>
  )

  if (link && member?.handle) {
    return (
      <Link to={r.profile(member.handle)} className="aca-avatar-link" aria-label={`Perfil de ${name}`}>
        {inner}
      </Link>
    )
  }
  return inner
}

export { MemberAvatar }
