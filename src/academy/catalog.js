import { useEffect, useState } from 'react'
import { academyApi } from './api.js'

/* Catálogo público de la Academy (GET <api>/academy?mode=catalog), compartido
   por la vitrina (src/pages/academy/Vitrina.jsx) y el teaser del home de
   PimpStudio. Código compartido con BrunettiCutz (scripts/academy-sync.mjs):
   la base es una sola, así que los dos sitios muestran los mismos cursos.

   Una sola petición por visita: pasar del home a /academy reutiliza la misma
   promesa durante un minuto (el servidor igual la cachea 5 min en el borde).
   Un error no se guarda, para que la siguiente página vuelva a intentar. */

const TTL_MS = 60_000
let cached = null // { at, promise }

export function fetchAcademyCatalog() {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.promise
  const promise = academyApi('catalog').catch((err) => {
    if (cached?.promise === promise) cached = null
    throw err
  })
  cached = { at: Date.now(), promise }
  return promise
}

const LOADING = { status: 'loading', courses: [], cohorts: [], checkoutEnabled: false }
const FALLBACK = { status: 'fallback', courses: [], cohorts: [], checkoutEnabled: false }

/* status: 'loading' | 'ready' | 'fallback' (sin API o con la base caída:
   nada publicado, nada a la venta). */
export function useAcademyCatalog() {
  const [state, setState] = useState(LOADING)
  useEffect(() => {
    let alive = true
    fetchAcademyCatalog()
      .then((data) => {
        if (!alive) return
        setState({
          status: data.fallback ? 'fallback' : 'ready',
          courses: Array.isArray(data.courses) ? data.courses : [],
          cohorts: Array.isArray(data.cohorts) ? data.cohorts : [],
          checkoutEnabled: Boolean(data.checkoutEnabled) && !data.fallback,
        })
      })
      .catch(() => { if (alive) setState(FALLBACK) })
    return () => { alive = false }
  }, [])
  return state
}

/* Cuántos cursos publicó un admin (Panel → Academy → Cursos). Con 0 la web
   dice "Próximamente" en vez de mostrar el catálogo. */
export const publishedCount = (catalog) => catalog.courses.filter((d) => d.published).length
