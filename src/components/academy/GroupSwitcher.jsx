import React, { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../academy/Icon.jsx'
import { Sheet, useIsPhone } from '../panel/index.js'
import { useOutsideClose, useTopLayerEscape } from '../panel/hooks.js'
import { useAcademy } from '../../academy/context.js'
import { isImageUrl } from '../../academy/url.js'
import { r } from '../../academy/routes.js'
import { ACADEMY_BRAND, ACADEMY_LINKS } from '../../academy/hostConfig.js'
import '../../styles/academy/app.css'

/* ============================================================
   Selector del grupo (arriba a la izquierda, como Skool):
   [PA] Pimp Studio Academy ⌃⌄  → menú con los atajos al sitio y los
   Grupos (generaciones) del miembro. Nombre, iniciales y enlaces por
   defecto salen del host (hostConfig.js: ACADEMY_BRAND / ACADEMY_LINKS).

   Los destinos fuera de <base>/(.+) (inicio, reservar, catálogo, panel)
   son <a href> de verdad, no el router: esas páginas tienen OTRO CSP y el
   de un documento queda fijo al cargarlo (SPEC §7.1).
   ============================================================ */

const cx = (...p) => p.filter(Boolean).join(' ')
const HEX = /^#[0-9a-f]{3,8}$/i
// "pimpstudio.cl" para "Ir a …" (del siteUrl del host, sin protocolo ni barra).
const SITE_LABEL = String(ACADEMY_BRAND.siteUrl || '').replace(/^https?:\/\//, '').replace(/\/+$/, '')
const LINKS = {
  home: ACADEMY_LINKS?.home || '/',
  booking: ACADEMY_LINKS?.booking || '/reservar',
  panel: ACADEMY_LINKS?.panel || '/panel?tab=academy',
}

export function groupInitials(group) {
  const raw = String(group?.initials || '').trim()
  if (raw) return Array.from(raw).slice(0, 2).join('').toUpperCase()
  const name = String(group?.name || '').trim()
  // Sin nombre: las iniciales del host ('PA').
  if (!name) return Array.from(String(ACADEMY_BRAND.initials || 'A')).slice(0, 2).join('').toUpperCase()
  const words = name.split(/\s+/).filter(Boolean)
  return ((Array.from(words[0] || 'P')[0] || '') + (Array.from(words[words.length - 1] || 'A')[0] || '')).toUpperCase()
}

/* Tile cuadrado con el ícono del grupo (imagen permitida) o sus iniciales. */
export function GroupTile({ group, size = 40, className }) {
  const icon = group?.iconUrl && isImageUrl(group.iconUrl) ? group.iconUrl : null
  const color = HEX.test(String(group?.color || '')) ? group.color : null
  return (
    <span
      className={cx('aca-gtile', className)}
      style={{ '--gt-s': `${size}px`, ...(color && !icon ? { '--gt-bg': color } : {}) }}
      aria-hidden="true"
    >
      {icon ? <img src={icon} alt="" decoding="async" /> : groupInitials(group)}
    </span>
  )
}

export default function GroupSwitcher() {
  const { group, me, isAdmin } = useAcademy()
  const navigate = useNavigate()
  const isPhone = useIsPhone()
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)
  const close = useCallback(() => setOpen(false), [])
  useOutsideClose(wrap, open && !isPhone, close)
  useTopLayerEscape(open && !isPhone, close)

  const name = group?.name || ACADEMY_BRAND.name
  const cohorts = Array.isArray(me?.cohorts) ? me.cohorts : []

  const go = (to) => {
    setOpen(false)
    navigate(to)
  }

  const items = (
    <>
      <a className="pn-menu-item" role="menuitem" href={LINKS.home}>
        <Icon name="globe" size={17} />
        <span>Ir a {SITE_LABEL}</span>
      </a>
      <a className="pn-menu-item" role="menuitem" href={LINKS.booking}>
        <Icon name="scissors" size={17} />
        <span>Reservar hora</span>
      </a>
      <a className="pn-menu-item" role="menuitem" href={r.catalog}>
        <Icon name="compass" size={17} />
        <span>Catálogo de cursos</span>
      </a>
      {isAdmin && (
        <a className="pn-menu-item" role="menuitem" href={LINKS.panel}>
          <Icon name="settings" size={17} />
          <span>
            Abrir panel
            <small>Miembros, cursos, pedidos y ajustes</small>
          </span>
        </a>
      )}
      <div className="pn-menu-sep" role="separator" />
      <div className="aca-menu-label">Tus grupos</div>
      <button type="button" className="pn-menu-item" role="menuitem" onClick={() => go(r.home)}>
        <GroupTile group={group} size={24} />
        <span>{name}</span>
      </button>
      {cohorts.map((c) => (
        <button key={c.id} type="button" className="pn-menu-item" role="menuitem" onClick={() => go(r.group(c.id))}>
          <GroupTile group={{ name: c.name }} size={24} className="is-cohort" />
          <span>{c.name}</span>
        </button>
      ))}
      {!cohorts.length && <p className="aca-menu-note">Cuando te sumen a una generación, su sala aparece acá.</p>}
    </>
  )

  return (
    <div className="aca-switcher pn-menu-wrap" ref={wrap}>
      <button
        type="button"
        className={cx('aca-switcher-btn', open && 'is-open')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={name}
      >
        <GroupTile group={group} size={isPhone ? 34 : 40} />
        <span className="aca-switcher-name">{name}</span>
        <Icon name="chevronsUpDown" size={18} />
      </button>
      {open && !isPhone && (
        <div className="pn-menu is-start aca-menu aca-switcher-menu" role="menu">{items}</div>
      )}
      {isPhone && (
        <Sheet open={open} onClose={close} title={name} size="sm" bodyClassName="is-flush">
          <div className="pn-actsheet aca-actsheet" role="menu">{items}</div>
        </Sheet>
      )}
    </div>
  )
}

export { GroupSwitcher }
