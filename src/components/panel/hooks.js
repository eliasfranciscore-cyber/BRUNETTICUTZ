import { useEffect, useRef, useState } from 'react'

/* Hooks compartidos por las primitivas del panel (src/components/panel/). */

// Mismos cortes que src/styles/panel.css: ≤640 celular, ≤1024 dock.
export const PHONE_QUERY = '(max-width: 640px)'
export const DOCK_QUERY = '(max-width: 1024px)'

export function useMediaQuery(query) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false)
  const [matches, setMatches] = useState(get)
  useEffect(() => {
    if (!window.matchMedia) return undefined
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener?.('change', onChange)
    return () => mql.removeEventListener?.('change', onChange)
  }, [query])
  return matches
}

export const useIsPhone = () => useMediaQuery(PHONE_QUERY)

/* Pila de capas abiertas (hojas, confirmaciones, menús). Escape cierra SOLO la
   de arriba: con una confirmación encima de una hoja, un Escape no debe
   cerrar las dos. */
const layerStack = []
export function useTopLayerEscape(active, onEscape) {
  // El callback va en un ref: si fuera dependencia del efecto, cada render
  // del padre volvería a apilar la capa y la reordenaría por encima de una
  // confirmación abierta después.
  const cb = useRef(onEscape)
  cb.current = onEscape
  useEffect(() => {
    if (!active) return undefined
    const id = Symbol('layer')
    layerStack.push(id)
    const onKey = (e) => {
      if (e.key !== 'Escape' || layerStack[layerStack.length - 1] !== id) return
      e.stopPropagation()
      cb.current?.()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      const i = layerStack.indexOf(id)
      if (i >= 0) layerStack.splice(i, 1)
    }
  }, [active])
}

/* En iOS el teclado NO achica el viewport de layout: un `position: fixed;
   bottom: 0` queda detrás del teclado y el botón "Guardar" de una hoja
   desaparece justo cuando hace falta. El visualViewport sí se achica; se
   publica su alto y desplazamiento como variables CSS en el nodo raíz de la
   hoja (ver .pn-sheet-root en panel.css). */
export function useVisualViewportVars(ref, active) {
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    const el = ref.current
    if (!active || !vv || !el) return undefined
    const apply = () => {
      el.style.setProperty('--pn-vvh', `${Math.round(vv.height)}px`)
      el.style.setProperty('--pn-vvt', `${Math.round(vv.offsetTop)}px`)
    }
    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
    }
  }, [ref, active])
}

/* Cierra al tocar fuera del nodo (menús en escritorio). */
export function useOutsideClose(ref, active, onClose) {
  useEffect(() => {
    if (!active) return undefined
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose?.() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown, { passive: true })
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [ref, active, onClose])
}

/* Preferencia chica por navegador (p. ej. "Ver más" abierto en los KPI).
   localStorage puede no existir o lanzar (modo privado, Safari con storage
   bloqueado): siempre con try/catch y un valor por defecto. */
export function useStoredFlag(key, initial = false) {
  const [value, setValue] = useState(() => {
    if (!key) return initial
    try { const raw = localStorage.getItem(key); return raw == null ? initial : raw === '1' } catch { return initial }
  })
  const set = (next) => {
    setValue(next)
    if (!key) return
    try { localStorage.setItem(key, next ? '1' : '0') } catch { /* sin storage: queda solo en memoria */ }
  }
  return [value, set]
}
