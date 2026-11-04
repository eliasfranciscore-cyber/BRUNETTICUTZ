/* Consentimiento para las cookies de medición (Ley 21.719)
   ------------------------------------------------------------------
   El píxel de Meta solo se carga con un "sí" explícito: sin respuesta, o
   con un "no", public/pixel.js no pide nada a Facebook. La respuesta vive
   en este navegador (localStorage.cookie_consent = {ads, v, at}) y vale
   12 meses; después se vuelve a preguntar. public/pixel.js lee la misma
   clave con la misma regla, y escucha el evento CONSENT_EVENT para
   cargarse (o apagarse) en el momento en que la persona responde, sin
   recargar la página.

   Mismo archivo en pimpstudio.cl. Lo necesario para que el sitio funcione
   (sesión, carrito, tema) no depende de esto. */

export const CONSENT_KEY = 'cookie_consent'
export const CONSENT_EVENT = 'cookie-consent'
const OPEN_EVENT = 'cookie-consent-open'
const VERSION = 1
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000

// {ads: true|false, v, at} o null si nunca respondió (o la respuesta venció).
export function readConsent() {
  try {
    const c = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null')
    if (!c || typeof c.ads !== 'boolean' || c.v !== VERSION) return null
    if (!(Date.now() - Date.parse(c.at) < MAX_AGE_MS)) return null
    return c
  } catch {
    return null
  }
}

export function saveConsent(ads) {
  const c = { ads: !!ads, v: VERSION, at: new Date().toISOString() }
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify(c)) } catch { /* sin storage: vale solo para esta página */ }
  if (!c.ads) clearPixelCookies()
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: c }))
  return c
}

// "Preferencias de cookies" (pie de página, /privacidad): vuelve a abrir el aviso.
export function openConsent() {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

export function onOpenConsent(fn) {
  window.addEventListener(OPEN_EVENT, fn)
  return () => window.removeEventListener(OPEN_EVENT, fn)
}

/* Al retirar el consentimiento se borran las cookies propias que deja el
   píxel en este dominio (_fbp, _fbc). Meta las crea en el dominio raíz
   (.brunetticutz.cl), así que se prueban las dos variantes. */
function clearPixelCookies() {
  try {
    const host = window.location.hostname
    const root = host.split('.').slice(-2).join('.')
    for (const name of ['_fbp', '_fbc']) {
      for (const domain of ['', host, `.${root}`]) {
        document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ''}`
      }
    }
  } catch {
    // sin cookies accesibles no hay nada que borrar
  }
}
