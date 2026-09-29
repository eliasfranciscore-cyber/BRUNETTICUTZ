import React, { useEffect, useRef, useState } from 'react'
import { ModuleHeader, Segmented, EmptyState } from '../../components/panel/index.js'
import { r } from '../../academy/routes.js'
import { ACADEMY_BRAND } from '../../academy/hostConfig.js'
import { useAcademyAdmin, errorText } from './academy/adminApi.js'
import ResumenSection from './academy/ResumenSection.jsx'
import MiembrosSection from './academy/MiembrosSection.jsx'
import CursosSection from './academy/CursosSection.jsx'
import GruposSection from './academy/GruposSection.jsx'
import PedidosSection from './academy/PedidosSection.jsx'
import AjustesSection from './academy/AjustesSection.jsx'
import '../../styles/panel/academy.css'

/* ============================================================
   Pestaña «academy» del panel interno (solo administradores: el filtro de
   módulos de Dashboard la deja fuera para cualquier otro, y el backend
   vuelve a exigir admin verificado contra la base en cada modo admin-*).

   Es la trastienda de Pimp Studio Academy: miembros y accesos, cursos y
   lecciones, grupos (generaciones con chat), pedidos de Mercado Pago y
   ajustes. Lo que se hace DENTRO de la comunidad (publicar, moderar, crear
   eventos) se hace en la Academy (r.base()) entrando con "Abrir Academy".

   Del contexto del panel usa solo: authHeaders, pushToast, admin, barber y
   refreshing (ver el objeto `dash` en Dashboard.jsx).
   ============================================================ */

const SECTIONS = [
  { value: 'resumen', label: 'Resumen', icon: 'grid' },
  { value: 'miembros', label: 'Miembros', icon: 'users' },
  { value: 'cursos', label: 'Cursos', icon: 'book' },
  { value: 'grupos', label: 'Grupos', icon: 'users' },
  { value: 'pedidos', label: 'Pedidos', icon: 'receipt' },
  { value: 'ajustes', label: 'Ajustes', icon: 'settings' },
]
const SECTION_KEY = 'pn_academy_section'

function readSection() {
  try {
    const v = localStorage.getItem(SECTION_KEY)
    return SECTIONS.some((s) => s.value === v) ? v : 'resumen'
  } catch {
    return 'resumen'
  }
}

export default function AcademyTab({ ctx }) {
  const { admin, pushToast, refreshing } = ctx
  const api = useAcademyAdmin(ctx)
  const [section, setSectionState] = useState(readSection)
  const [opening, setOpening] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const setSection = (v) => {
    setSectionState(v)
    try { localStorage.setItem(SECTION_KEY, v) } catch { /* sin storage: solo en memoria */ }
  }

  // "Actualizar" del panel (refreshAll): cuando `refreshing` pasa de true a
  // false, la sección visible vuelve a pedir sus datos. Así no hace falta
  // tocar refreshAll en Dashboard.
  const wasRefreshing = useRef(refreshing)
  useEffect(() => {
    if (wasRefreshing.current && !refreshing) setReloadKey((k) => k + 1)
    wasRefreshing.current = refreshing
  }, [refreshing])

  const openAcademy = async () => {
    if (opening) return
    setOpening(true)
    try {
      await api.openAcademy(r.path('/comunidad'))
      // No se apaga `opening`: la página se va.
    } catch (err) {
      setOpening(false)
      const msg = err?.status === 403
        ? 'Tu sesión del panel es antigua. Cierra sesión y vuelve a entrar para abrir la Academy.'
        : errorText(err)
      pushToast?.('⚠', msg, 6000)
    }
  }

  if (!admin) {
    return (
      <div className="pn-page">
        <ModuleHeader title="Academy" />
        <EmptyState icon="lock" title="Solo para administradores" text="La Academy la gestiona un administrador del panel." />
      </div>
    )
  }

  const common = { api, ctx, reloadKey }

  return (
    <div className="pn-page pn-aca">
      <ModuleHeader
        title="Academy"
        subtitle={`Comunidad, cursos y alumnos · ${ACADEMY_BRAND.groupUrlLabel}`}
        primary={{ label: 'Abrir Academy', icon: 'graduation', onClick: openAcademy, loading: opening }}
        actions={[
          { label: 'Ver catálogo público', icon: 'eye', onClick: () => window.open(r.base(), '_blank', 'noopener') },
          {
            label: 'Copiar enlace del catálogo',
            icon: 'link',
            onClick: async () => {
              try {
                await navigator.clipboard.writeText(`${window.location.origin}${r.base()}`)
                pushToast?.('✓', 'Enlace copiado')
              } catch {
                pushToast?.('⚠', 'No se pudo copiar el enlace', 4000)
              }
            },
          },
        ]}
      />

      <Segmented
        scroll
        ariaLabel="Secciones de Academy"
        value={section}
        onChange={setSection}
        options={SECTIONS}
        className="pn-aca-tabs"
      />

      {section === 'resumen' && <ResumenSection {...common} onGo={setSection} />}
      {section === 'miembros' && <MiembrosSection {...common} />}
      {section === 'cursos' && <CursosSection {...common} />}
      {section === 'grupos' && <GruposSection {...common} />}
      {section === 'pedidos' && <PedidosSection {...common} />}
      {section === 'ajustes' && <AjustesSection {...common} />}
    </div>
  )
}
