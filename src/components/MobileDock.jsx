import React, { useState } from 'react'
import { Icon } from './ui.jsx'
import { Sheet, Button, SectionLabel } from './panel/index.js'

/**
 * Dock flotante del panel (celular/tablet): 4 accesos elegidos por el barbero
 * (Ajustes → Navegación y accesos) con ícono Y rótulo, más "Menú" al centro,
 * que abre la hoja con todos los módulos agrupados igual que el menú lateral.
 * Antes los accesos eran solo íconos, y Finanzas, Caja y Gastos compartían
 * el mismo dibujo: en el celular no se distinguían.
 */
export default function MobileDock({ tab, setTab, nav, groups = [], shortcuts: shortcutItems, onNewBooking }) {
  const [sheetOpen, setSheetOpen] = useState(false)

  // Atajos configurables. Respaldo: los cuatro de siempre.
  const findKey = (key) => nav.find((n) => n[0] === key)
  const shortcuts = (shortcutItems && shortcutItems.length
    ? shortcutItems
    : ['resumen', 'agenda', 'reservas', 'clientes'].map(findKey)
  ).filter(Boolean).slice(0, 4)

  const goto = (id) => { setTab(id); setSheetOpen(false) }
  const dockButton = ([id, ic, label]) => (
    <button
      key={id}
      type="button"
      className={`mobile-dock-item ${tab === id ? 'is-active' : ''}`}
      onClick={() => goto(id)}
      aria-current={tab === id ? 'page' : undefined}
    >
      <Icon name={ic} size={21} />
      <span className="pn-dock-label">{label}</span>
    </button>
  )

  const grouped = groups
    .map(([gid, glabel]) => [gid, glabel, nav.filter((n) => n[3] === gid)])
    .filter(([, , items]) => items.length)
  const loose = nav.filter((n) => !groups.some(([gid]) => gid === n[3]))

  const tile = ([id, ic, label]) => (
    <button key={id} type="button" className={`pn-dock-tile ${tab === id ? 'is-active' : ''}`} onClick={() => goto(id)} aria-current={tab === id ? 'page' : undefined}>
      <span className="pn-dock-tile-icon"><Icon name={ic} size={19} /></span>
      {label}
    </button>
  )

  return (
    <>
      <nav className="mobile-dock" aria-label="Acceso rápido">
        {shortcuts.slice(0, 2).map(dockButton)}
        <button
          type="button"
          className="mobile-dock-center"
          onClick={() => setSheetOpen(true)}
          aria-label="Abrir el menú con todos los módulos"
          aria-expanded={sheetOpen}
        >
          <Icon name="grid" size={21} />
          <span className="pn-dock-label">Menú</span>
        </button>
        {shortcuts.slice(2, 4).map(dockButton)}
      </nav>

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Menú"
        subtitle="Todos los módulos del panel"
        size="md"
      >
        {onNewBooking && (
          <Button variant="primary" size="lg" block icon="plus" onClick={() => { setSheetOpen(false); setTimeout(onNewBooking, 200) }}>
            Nueva reserva
          </Button>
        )}
        {grouped.map(([gid, glabel, items]) => (
          <div className="pn-dock-group" key={gid}>
            <SectionLabel>{glabel}</SectionLabel>
            <div className="pn-dock-grid">{items.map(tile)}</div>
          </div>
        ))}
        {loose.length > 0 && (
          <div className="pn-dock-group">
            <SectionLabel>Cuenta</SectionLabel>
            <div className="pn-dock-grid">{loose.map(tile)}</div>
          </div>
        )}
      </Sheet>
    </>
  )
}
