import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Icon } from '../../academy/Icon.jsx'
import { useAcademy } from '../../academy/context.js'
import { r } from '../../academy/routes.js'
import { ACADEMY_BRAND } from '../../academy/hostConfig.js'
import { GroupTile } from './GroupSwitcher.jsx'
import '../../styles/academy/app.css'

/* ============================================================
   Riel izquierdo (solo escritorio ≥1100 px, fijo de 72 px), como el de
   Skool: brújula (→ catálogo público), el grupo activo con la barrita negra
   a la izquierda y debajo las salas de Grupos (generaciones) del miembro.

   La brújula es un <a href>: el catálogo tiene otro CSP (SPEC §7.1).
   ============================================================ */

const cx = (...p) => p.filter(Boolean).join(' ')

export default function LeftRail() {
  const { group, me } = useAcademy()
  const { pathname } = useLocation()
  const cohorts = Array.isArray(me?.cohorts) ? me.cohorts : []
  const inGroupRoom = pathname.startsWith(r.path('/grupos/'))
  const name = group?.name || ACADEMY_BRAND.name

  return (
    <nav className="aca-rail" aria-label="Grupos">
      <a className="aca-rail-item is-compass" href={r.catalog} title="Explorar cursos" aria-label="Explorar cursos">
        <span className="aca-rail-tile"><Icon name="compass" size={22} /></span>
      </a>
      <Link
        to={r.home}
        className={cx('aca-rail-item', !inGroupRoom && 'is-active')}
        title={name}
        aria-label={name}
        aria-current={!inGroupRoom ? 'true' : undefined}
      >
        <GroupTile group={group} size={48} />
      </Link>
      {cohorts.length > 0 && <span className="aca-rail-sep" aria-hidden="true" />}
      {cohorts.map((c) => {
        const active = pathname === r.group(c.id) || pathname.startsWith(`${r.group(c.id)}/`)
        return (
          <Link
            key={c.id}
            to={r.group(c.id)}
            className={cx('aca-rail-item', active && 'is-active')}
            title={c.name}
            aria-label={`Grupo ${c.name}`}
            aria-current={active ? 'true' : undefined}
          >
            <GroupTile group={{ name: c.name }} size={48} className="is-cohort" />
          </Link>
        )
      })}
    </nav>
  )
}

export { LeftRail }
