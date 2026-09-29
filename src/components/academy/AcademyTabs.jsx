import React, { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAcademy } from '../../academy/context.js'
import { r } from '../../academy/routes.js'
import '../../styles/academy/app.css'

/* ============================================================
   Pestañas bajo la barra (las 6 de Skool): Comunidad · Cursos ·
   Calendario · Miembros · Clasificación · Acerca de. La activa va en
   negrita con subrayado de 3 px. En el celular la fila scrollea de lado y
   la activa se trae a la vista.

   El dueño puede apagar Comunidad, Calendario y Clasificación
   (settings.tabs); Cursos, Miembros y Acerca de siempre están.
   ============================================================ */

const cx = (...p) => p.filter(Boolean).join(' ')

export const ACADEMY_TABS = [
  { id: 'comunidad', label: 'Comunidad', to: r.comunidad, toggle: true },
  { id: 'cursos', label: 'Cursos', to: r.cursos },
  { id: 'calendario', label: 'Calendario', to: r.calendario, toggle: true },
  { id: 'miembros', label: 'Miembros', to: r.miembros },
  { id: 'clasificacion', label: 'Clasificación', to: r.clasificacion, toggle: true },
  { id: 'acerca', label: 'Acerca de', to: r.acerca },
]

export function visibleTabs(group) {
  const flags = (group && group.tabs) || {}
  return ACADEMY_TABS.filter((t) => !t.toggle || flags[t.id] !== false)
}

export function activeTabId(pathname) {
  const p = String(pathname || '')
  const hit = ACADEMY_TABS.find((t) => p === t.to || p.startsWith(`${t.to}/`))
  return hit ? hit.id : null
}

export default function AcademyTabs() {
  const { group } = useAcademy()
  const { pathname } = useLocation()
  const tabs = visibleTabs(group)
  const active = activeTabId(pathname)
  const rowRef = useRef(null)

  useEffect(() => {
    const el = rowRef.current?.querySelector('.is-active')
    if (!el || !rowRef.current) return
    const row = rowRef.current
    // Solo si hace falta (fila con scroll): sin mover la página entera.
    if (el.offsetLeft < row.scrollLeft || el.offsetLeft + el.offsetWidth > row.scrollLeft + row.clientWidth) {
      row.scrollTo({ left: Math.max(0, el.offsetLeft - 16), behavior: 'smooth' })
    }
  }, [active])

  return (
    <nav className="aca-tabs" aria-label="Secciones de la Academy">
      <div className="aca-tabs-row" ref={rowRef}>
        {tabs.map((t) => (
          <Link
            key={t.id}
            to={t.to}
            className={cx('aca-tab', active === t.id && 'is-active')}
            aria-current={active === t.id ? 'page' : undefined}
            data-label={t.label}
          >
            {/* data-label reserva el ancho en negrita (::before invisible):
                la fila no salta al cambiar de pestaña. */}
            <span>{t.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  )
}

export { AcademyTabs }
