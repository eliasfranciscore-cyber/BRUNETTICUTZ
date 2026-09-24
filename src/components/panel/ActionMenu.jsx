import React, { useCallback, useRef, useState } from 'react'
import { Icon } from '../ui.jsx'
import { Sheet } from './Sheet.jsx'
import { useIsPhone, useOutsideClose, useTopLayerEscape } from './hooks.js'

const cx = (...p) => p.filter(Boolean).join(' ')

/* Menú "···" para las acciones secundarias de una pantalla o de un registro.
   Escritorio: popover anclado al botón. Celular: hoja de acciones con filas
   grandes. Lo destructivo va siempre al final, separado y en rojo — nunca
   como botón rojo suelto al alcance del pulgar.

   items: [{ label, icon, onClick, danger, disabled, hint, hidden }] */
export function ActionMenu({ items = [], label = 'Más opciones', title, icon = 'more', align = 'end', small, className }) {
  const isPhone = useIsPhone()
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)
  const close = useCallback(() => setOpen(false), [])
  useOutsideClose(wrap, open && !isPhone, close)
  useTopLayerEscape(open && !isPhone, close)

  const visible = items.filter((i) => i && !i.hidden)
  if (!visible.length) return null
  const normal = visible.filter((i) => !i.danger)
  const danger = visible.filter((i) => i.danger)

  const run = (item) => {
    setOpen(false)
    // Se deja cerrar el menú antes de abrir lo que dispare la acción (otra
    // hoja, una confirmación): si no, las dos capas se animan a la vez.
    setTimeout(() => item.onClick?.(), isPhone ? 200 : 0)
  }
  const renderItem = (item) => (
    <button
      key={item.label}
      type="button"
      role="menuitem"
      className={cx('pn-menu-item', item.danger && 'is-danger')}
      disabled={item.disabled}
      onClick={() => run(item)}
    >
      {item.icon && <Icon name={item.icon} size={17} />}
      <span>
        {item.label}
        {item.hint && <small>{item.hint}</small>}
      </span>
    </button>
  )
  const list = (
    <>
      {normal.map(renderItem)}
      {normal.length > 0 && danger.length > 0 && <div className="pn-menu-sep" role="separator" />}
      {danger.map(renderItem)}
    </>
  )

  return (
    <div className={cx('pn-menu-wrap', className)} ref={wrap}>
      <button
        type="button"
        className={cx('pn-icon-btn', small && 'is-sm')}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name={icon} size={small ? 16 : 18} />
      </button>
      {open && !isPhone && (
        <div className={cx('pn-menu', align === 'start' && 'is-start')} role="menu">{list}</div>
      )}
      {isPhone && (
        <Sheet open={open} onClose={close} title={title || label} size="sm" bodyClassName="is-flush">
          <div className="pn-actsheet" role="menu">{list}</div>
        </Sheet>
      )}
    </div>
  )
}
