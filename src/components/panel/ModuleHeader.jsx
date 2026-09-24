import React, { isValidElement } from 'react'
import { Button } from './kit.jsx'
import { ActionMenu } from './ActionMenu.jsx'

/* Encabezado de módulo — el mismo en las 12 pestañas.
   Título grande (se colapsa a la barra superior al hacer scroll), subtítulo o
   estado, y a la derecha como mucho: "···" con lo secundario + UNA acción
   primaria. Antes había cinco patrones distintos y cinco módulos sin título.

   primary: { label, icon, onClick, disabled, loading } o un nodo propio
   actions: items de ActionMenu (se agrupan en "···")
   secondary: nodo opcional junto a la primaria (p. ej. un botón de vista) */
export function ModuleHeader({ title, subtitle, meta, primary, actions, secondary, className }) {
  const hasActions = primary || secondary || (actions && actions.some((a) => a && !a.hidden))
  return (
    <header className={['pn-mh', className].filter(Boolean).join(' ')}>
      <div className="pn-mh-text">
        <h1 className="pn-mh-title">{title}</h1>
        {(subtitle || meta) && (
          <div className="pn-mh-sub">
            {subtitle && <span>{subtitle}</span>}
            {meta}
          </div>
        )}
      </div>
      {hasActions && (
        <div className="pn-mh-actions">
          {secondary}
          {actions && <ActionMenu items={actions} title={typeof title === 'string' ? title : undefined} />}
          {primary && (isValidElement(primary) ? primary : (
            <Button
              variant="primary"
              icon={primary.icon}
              onClick={primary.onClick}
              disabled={primary.disabled}
              loading={primary.loading}
            >
              {primary.label}
            </Button>
          ))}
        </div>
      )}
    </header>
  )
}

/* Fila de controles bajo el encabezado (período, filtros, búsqueda). */
export function Toolbar({ children, stackOnPhone, className }) {
  return <div className={['pn-toolbar', stackOnPhone && 'is-stack-mobile', className].filter(Boolean).join(' ')}>{children}</div>
}
