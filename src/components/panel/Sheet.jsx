import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../ui.jsx'
import { Button } from './kit.jsx'
import { useIsPhone, useTopLayerEscape, useVisualViewportVars } from './hooks.js'

/* ============================================================
   Sheet — el ÚNICO modal del panel.
   Celular (≤640): hoja inferior pegada al borde; se cierra arrastrando la
   manija o el encabezado hacia abajo, tocando el fondo o con la X.
   Tablet/escritorio: diálogo centrado (Escape y fondo cierran).
   Encabezado y pie quedan fijos; solo el cuerpo scrollea, así "Guardar"
   nunca se pierde bajo un formulario largo ni bajo el teclado de iOS.

   Antes convivían cuatro formatos (hoja flotante, diálogo, cajón lateral
   estirado a 100% de alto y dos overlays hechos a mano): esto los reemplaza.
   ============================================================ */

const EXIT_MS = 190
const cx = (...p) => p.filter(Boolean).join(' ')

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  icon,
  lead,
  headActions,
  size = 'md',
  footer,
  footerStack,
  footerClassName,
  children,
  bodyClassName,
  className,
  dismissible = true,
  full = false,
  hideClose = false,
  headBorder = false,
  alert = false,
  ariaLabel,
  initialFocusRef,
}) {
  const isPhone = useIsPhone()
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)
  const rootRef = useRef(null)
  const sheetRef = useRef(null)
  const lastFocus = useRef(null)
  const drag = useRef(null)

  useEffect(() => {
    if (open) {
      setMounted(true)
      setClosing(false)
      return undefined
    }
    if (!mounted) return undefined
    setClosing(true)
    const t = setTimeout(() => { setMounted(false); setClosing(false) }, EXIT_MS)
    return () => clearTimeout(t)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const requestClose = useCallback(() => { if (dismissible) onClose?.() }, [dismissible, onClose])
  useTopLayerEscape(open, requestClose)
  useVisualViewportVars(rootRef, mounted && isPhone)

  // Foco: al abrir entra a la hoja (o al campo pedido); al cerrar vuelve a
  // donde estaba, para que el teclado y VoiceOver no queden perdidos.
  useEffect(() => {
    if (!open) return undefined
    lastFocus.current = document.activeElement
    const t = setTimeout(() => {
      const target = initialFocusRef?.current || sheetRef.current
      target?.focus?.({ preventScroll: true })
    }, 30)
    return () => {
      clearTimeout(t)
      const prev = lastFocus.current
      if (prev && typeof prev.focus === 'function' && document.contains(prev)) prev.focus({ preventScroll: true })
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Arrastrar para cerrar (solo celular, solo desde manija/encabezado para no
     pelear con el scroll del cuerpo). Se mueve el nodo directo por estilo,
     sin re-render por cada pixel. */
  const onDragStart = (e) => {
    if (!isPhone || alert || !dismissible) return
    if (e.target.closest('button, a, input, select, textarea')) return
    drag.current = { y: e.clientY, t: performance.now(), dy: 0, id: e.pointerId }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    if (sheetRef.current) sheetRef.current.style.transition = 'none'
  }
  const onDragMove = (e) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    d.dy = Math.max(0, e.clientY - d.y)
    if (sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${d.dy}px)`
      sheetRef.current.style.setProperty('--pn-drag', `${d.dy}px`)
    }
  }
  const onDragEnd = (e) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    const el = sheetRef.current
    const velocity = d.dy / Math.max(1, performance.now() - d.t)
    if (d.dy > 110 || (d.dy > 36 && velocity > 0.55)) {
      requestClose()
      return
    }
    if (el) {
      el.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1)'
      el.style.transform = ''
    }
  }

  if (!mounted || typeof document === 'undefined') return null

  const hasHead = !alert && (title || subtitle || icon || lead || headActions || !hideClose)
  const dragProps = { onPointerDown: onDragStart, onPointerMove: onDragMove, onPointerUp: onDragEnd, onPointerCancel: onDragEnd }

  return createPortal(
    <div ref={rootRef} className={cx('pn-sheet-root', alert && 'is-alert', closing && 'is-closing')}>
      <button type="button" className="pn-sheet-scrim" aria-label="Cerrar" tabIndex={-1} onClick={requestClose} />
      <div
        ref={sheetRef}
        className={cx('pn-sheet', `pn-sheet--${size}`, full && 'is-full', closing && 'is-closing', className)}
        role={alert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-label={ariaLabel || (typeof title === 'string' ? title : undefined)}
        tabIndex={-1}
      >
        {!alert && <div className="pn-sheet-grab" aria-hidden="true" {...dragProps} />}
        {hasHead && (
          <div className={cx('pn-sheet-head', headBorder && 'has-border')} {...dragProps}>
            {lead ? <div className="pn-sheet-head-lead">{lead}</div> : icon ? <span className="pn-sheet-head-icon"><Icon name={icon} size={18} /></span> : null}
            <div className="pn-sheet-titles">
              {title && <h2 className="pn-sheet-title">{title}</h2>}
              {subtitle && <p className="pn-sheet-sub">{subtitle}</p>}
            </div>
            <div className="pn-sheet-head-actions">
              {headActions}
              {!hideClose && (
                <button type="button" className="pn-icon-btn is-sm" aria-label="Cerrar" onClick={requestClose}>
                  <Icon name="close" size={16} />
                </button>
              )}
            </div>
          </div>
        )}
        {alert ? children : (
          <div className={cx('pn-sheet-body', !footer && 'is-last', bodyClassName)}>{children}</div>
        )}
        {footer && !alert && (
          <div className={cx('pn-sheet-foot', footerStack && 'is-stack', footerClassName)}>{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/* Confirmación: alerta centrada (también en el celular). La acción peligrosa
   va en rojo lleno solo acá, nunca como botón suelto en una pantalla. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'default',
  icon,
  busy,
  onConfirm,
  onCancel,
  children,
}) {
  const danger = tone === 'danger'
  return (
    <Sheet open={open} onClose={busy ? undefined : onCancel} alert ariaLabel={typeof title === 'string' ? title : undefined} dismissible={!busy}>
      <div className="pn-confirm">
        {(icon || danger) && (
          <span className={cx('pn-confirm-icon', danger && 'is-danger')}><Icon name={icon || 'alert'} size={20} /></span>
        )}
        {title && <h2 className="pn-confirm-title">{title}</h2>}
        {message && <p className="pn-confirm-msg">{message}</p>}
        {children}
        <div className="pn-confirm-actions">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button variant={danger ? 'danger-solid' : 'primary'} onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
        </div>
      </div>
    </Sheet>
  )
}
