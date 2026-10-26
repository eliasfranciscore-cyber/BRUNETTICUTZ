import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

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

/* Deslizar para cambiar de día (franja de Agenda, lista de Reservas). En el
   iPhone el dedo casi nunca queda quieto al tocar: se corre unos px, y
   framer-motion ya lo cuenta como arrastre (su umbral es de 3 px). Cuando el
   fin del arrastre miraba solo la velocidad (> 500 px/s), esos px en un par
   de cuadros bastaban para mover el día: tocar el martes en la franja
   terminaba en el día siguiente al que ya estaba elegido. Un deslizamiento
   pide recorrido horizontal de verdad y que mande el eje X; menos que eso es
   un toque. */
export const SWIPE_MIN_PX = 32
export function isDaySwipe(info) {
  const { offset, velocity } = info || {}
  if (!offset || !velocity) return false
  const dx = Math.abs(offset.x)
  if (dx < SWIPE_MIN_PX || dx < Math.abs(offset.y || 0)) return false
  return dx > 60 || Math.abs(velocity.x) > 500
}

/* Botones dentro de algo que se desliza (los días de la franja de Agenda,
   las tarjetas de Reservas):
   el click llega ANTES que el fin del arrastre, así que el botón no puede
   esperar a saber si hubo deslizamiento. Mira cuánto se corrió el puntero
   desde que bajó: si fue un deslizamiento, el click no elige nada y el día
   lo cambia el deslizamiento. Un click de teclado (detail 0) siempre vale. */
export function useSwipeTapGuard() {
  const start = useRef(null)
  const onPointerDownCapture = useCallback((e) => { start.current = { x: e.clientX, y: e.clientY } }, [])
  const wasSwipe = useCallback((e) => {
    const s = start.current
    if (!s || !e || e.detail === 0) return false
    return Math.abs(e.clientX - s.x) >= SWIPE_MIN_PX
  }, [])
  return { onPointerDownCapture, wasSwipe }
}

/* Alto del status bar cuando iOS no lo informa. La PWA instalada con
   `black-translucent` dibuja la página DEBAJO del status bar, y el shell del
   panel se corre env(safe-area-inset-top) para que la barra superior quede
   libre. En iOS 26.1+ ese env() llega en 0 en algunas versiones aunque la
   página siga debajo del status bar (WebKit 301994/317153): la barra superior
   quedaba bajo el status bar y su velo difuminado, que tapaba los botones y
   se quedaba con los toques. Se detecta ese caso (app instalada, vertical,
   página a pantalla completa y env() en 0) y se publica un alto de respaldo
   en --pn-safe-top-fallback (panel.css lo combina con env() en --pn-safe-top).
   Con el status bar fuera de la página (sin black-translucent) innerHeight es
   menor que la pantalla y el respaldo queda en 0. */
function statusBarFallback() {
  const standalone = window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches
  if (!standalone || !window.screen) return 0
  const { width, height } = window.screen
  if (window.innerWidth !== width || window.innerHeight < height) return 0
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none'
  document.body.appendChild(probe)
  const inset = probe.getBoundingClientRect().height
  probe.remove()
  if (inset > 0) return 0
  // iPad: 24 · iPhone con notch o Dynamic Island: hasta 62 · resto: 20.
  // Pasarse por unos px solo deja una franja del color de fondo.
  return width >= 600 ? 24 : height >= 780 ? 62 : 20
}
export function useStatusBarFallback() {
  useLayoutEffect(() => {
    const root = document.documentElement
    const apply = () => root.style.setProperty('--pn-safe-top-fallback', `${statusBarFallback()}px`)
    apply()
    window.addEventListener('resize', apply)
    return () => {
      window.removeEventListener('resize', apply)
      root.style.removeProperty('--pn-safe-top-fallback')
    }
  }, [])
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
