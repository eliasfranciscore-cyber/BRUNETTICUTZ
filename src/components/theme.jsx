import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { useLocation } from 'react-router-dom'

/* ============================================================
   Tema claro/oscuro global.
   - Por defecto es AUTOMÁTICO por la hora de Santiago de Chile: claro de
     07:00 a 18:59 y oscuro el resto. Se re-evalúa cada 10 min y cada vez que
     la app vuelve a primer plano (una PWA en iOS congela los timers mientras
     está en segundo plano: sin esto, al abrirla a las 19:30 seguía clara).
   - Tocar el botón de tema o elegir Claro/Oscuro en Ajustes deja una
     elección manual (ps_theme_manual) que manda sobre el automático, hasta
     que se vuelva a encender "Automático" en Ajustes → Apariencia. Las
     elecciones manuales que ya existían se respetan: acá no hay un reinicio
     de una sola vez que las borre (PimpStudio sí lo hizo).
   - Escribe data-theme en <html>, que activa los tokens
     [data-theme="light"] / [data-theme="dark"] del CSS.
   ============================================================ */

const ThemeCtx = createContext({ theme: 'dark', toggle: () => {}, manual: false, auto: true, useAuto: () => {}, setAuto: () => {}, setTheme: () => {} })

/* Hora actual en Santiago (maneja DST automáticamente vía Intl). */
function santiagoHour() {
  try {
    const h = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: 'numeric', hour12: false }).format(new Date())
    return parseInt(h, 10) % 24
  } catch {
    return new Date().getHours()
  }
}
function autoTheme() {
  const h = santiagoHour()
  return h >= 7 && h < 19 ? 'light' : 'dark'
}

export function ThemeProvider({ children }) {
  const [manual, setManual] = useState(() => {
    try { return localStorage.getItem('ps_theme_manual') === '1' } catch { return false }
  })
  const [theme, setTheme] = useState(() => {
    try {
      if (localStorage.getItem('ps_theme_manual') === '1') return localStorage.getItem('ps_theme') || 'dark'
    } catch {}
    return autoTheme()
  })

  // Aplica el tema al documento y persiste.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    const bg = theme === 'light' ? '#f7f3ea' : '#080807'
    // CLAVE para iOS Safari: NO re-lee <meta theme-color> al cambiar `content` →
    // las safe-areas (notch/barra) se quedan del color anterior hasta recargar.
    // Solución: ELIMINAR y RECREAR el meta en cada cambio para forzar el repintado
    // EN VIVO de las barras al togglear claro/oscuro.
    try {
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove())
      const meta = document.createElement('meta')
      meta.setAttribute('name', 'theme-color')
      meta.setAttribute('content', bg)
      document.head.appendChild(meta)
    } catch {}
    // iOS también muestrea el background-color de <html>/<body> para teñir las
    // barras: lo forzamos al color del tema (full-screen sin bandas del tema contrario).
    try {
      document.documentElement.style.backgroundColor = bg
      if (document.body) document.body.style.backgroundColor = bg
    } catch {}
    try { localStorage.setItem('ps_theme', theme) } catch {}
  }, [theme])

  // Modo automático: re-evalúa por hora de Santiago mientras no haya elección
  // manual — cada 10 min y al volver a primer plano.
  useEffect(() => {
    if (manual) return undefined
    const apply = () => setTheme(autoTheme())
    apply()
    const id = setInterval(apply, 10 * 60 * 1000)
    const onVisible = () => { if (document.visibilityState === 'visible') apply() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', apply)
    window.addEventListener('pageshow', apply)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', apply)
      window.removeEventListener('pageshow', apply)
    }
  }, [manual])

  const toggle = useCallback(() => {
    setManual(true)
    try { localStorage.setItem('ps_theme_manual', '1') } catch {}
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  // Volver al automático (por hora de Santiago).
  const useAuto = useCallback(() => {
    setManual(false)
    try { localStorage.removeItem('ps_theme_manual') } catch {}
    setTheme(autoTheme())
  }, [])

  // Elegir un tema a mano (Ajustes → Apariencia): apaga el automático.
  const chooseTheme = useCallback((t) => {
    if (t !== 'light' && t !== 'dark') return
    setManual(true)
    try { localStorage.setItem('ps_theme_manual', '1') } catch {}
    setTheme(t)
  }, [])

  // Interruptor "Automático" de Ajustes → Apariencia.
  const setAuto = useCallback((on) => {
    if (on) {
      setManual(false)
      try { localStorage.removeItem('ps_theme_manual') } catch {}
      setTheme(autoTheme())
    } else {
      setManual(true)
      try { localStorage.setItem('ps_theme_manual', '1') } catch {}
    }
  }, [])

  return <ThemeCtx.Provider value={{ theme, toggle, manual, auto: !manual, useAuto, setAuto, setTheme: chooseTheme }}>{children}</ThemeCtx.Provider>
}

export function useTheme() { return useContext(ThemeCtx) }

/* Toggle de ícono (usado en el panel interno). */
export function ThemeToggle({ className = '' }) {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Activar modo claro' : 'Activar modo oscuro'}
      data-tip={isDark ? 'Modo claro' : 'Modo oscuro'}
      className={`theme-toggle ${className}`}
    >
      {isDark ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>
        </svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4"/>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
        </svg>
      )}
    </button>
  )
}

/* Toggle tipo "pill" flotante para el sitio público (Home/Cursos/Workshop).
   Estilo deslizante sol/luna (adaptado del componente solicitado a JSX puro). */
function MoonIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>
    </svg>
  )
}
function SunIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4"/>
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
    </svg>
  )
}

export function FloatingThemeToggle() {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'
  // Acento por módulo: el toggle vive fuera de los wrappers .cursos-page/.wks,
  // así que derivamos la clase desde la ruta para teñirlo del color del módulo.
  const { pathname } = useLocation()
  const moduleClass = pathname.startsWith('/workshop') ? 'ftt-workshop' : pathname.startsWith('/cursos') ? 'ftt-cursos' : ''
  return (
    <button
      type="button"
      onClick={toggle}
      role="switch"
      aria-checked={!isDark}
      aria-label={isDark ? 'Activar modo claro' : 'Activar modo oscuro'}
      title={isDark ? 'Modo claro' : 'Modo oscuro'}
      className={`float-theme-toggle ${isDark ? 'is-dark' : 'is-light'} ${moduleClass}`}
    >
      <span className="ftt-track">
        <span className="ftt-side ftt-side-moon"><MoonIcon /></span>
        <span className="ftt-side ftt-side-sun"><SunIcon /></span>
        <span className="ftt-knob">{isDark ? <MoonIcon /> : <SunIcon />}</span>
      </span>
    </button>
  )
}
