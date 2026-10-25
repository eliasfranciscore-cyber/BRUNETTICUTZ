/* BRUNETTI — Medición de las páginas de venta (Meta Pixel + UTM)
   ------------------------------------------------------------------
   public/pixel.js carga el píxel y marca un PageView por cada carga dura de
   página. Lo que pasa DENTRO del SPA (llegar a /metodo desde el home, pedir
   la lección, ir a pagar) no recarga nada: lo marca track() desde la
   página. Sin píxel (bloqueador, /cursos/…, desarrollo) no hace nada.

   UTM: el anuncio o la publicación que trajo a la persona viene en la URL
   de aterrizaje (?utm_source=…&utm_campaign=… o ?fbclid=…). Se guarda en
   sessionStorage al primer aterrizaje de la visita, para que siga ahí
   cuando la persona pide la lección en otra página o varios clics después,
   y se manda junto con el lead (columna enrollments.utm). */

const UTM_KEY = 'bc_utm'
const UTM_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']

export function track(event, params) {
  try {
    if (typeof window !== 'undefined' && typeof window.fbq === 'function') {
      if (params) window.fbq('track', event, params)
      else window.fbq('track', event)
    }
  } catch {
    // la medición nunca rompe la página
  }
}

/* Se llama una vez al arrancar (src/main.jsx). La primera fuente de la
   visita gana: navegar después a otra página con otros parámetros no la
   pisa. */
export function captureUtm() {
  try {
    if (sessionStorage.getItem(UTM_KEY)) return
    const q = new URLSearchParams(window.location.search)
    const parts = UTM_PARAMS.filter((k) => q.get(k)).map((k) => `${k}=${q.get(k).slice(0, 60)}`)
    if (q.get('fbclid')) parts.push('fbclid')
    if (!parts.length) return
    sessionStorage.setItem(UTM_KEY, `${window.location.pathname} · ${parts.join(' · ')}`)
  } catch {
    // sin storage: el lead se guarda igual, sin utm
  }
}

/* "/metodo · utm_source=instagram · utm_campaign=metodo" o null. */
export function readUtm() {
  try { return sessionStorage.getItem(UTM_KEY) || null } catch { return null }
}
