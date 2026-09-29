import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { setSession } from '../../../academy/session.js'
import { compressImage } from '../../../academy/upload.js'
import { r } from '../../../academy/routes.js'

/* ============================================================
   Cliente de /api/academy para la pestaña Academy del PANEL.

   Por qué no se usa academyApi() de src/academy/api.js: ese cliente manda el
   token de MIEMBRO (ps_academy_token) y, ante un 401, borra la sesión de la
   Academy y salta a /academy/ingreso. Acá el que llama es el barbero admin con
   su propio token (ctx.authHeaders → ps_barber_token), y un 401 tiene que
   quedarse en el panel como un aviso, no sacarlo de la pantalla.

   Dos tipos de llamada:
   · call(mode, …)       → con el token del barbero (modos admin-* y owner-session).
   · memberCall(mode, …) → con un token de miembro del PROPIETARIO, pedido con
     owner-session y guardado SOLO en memoria. Hace falta para los pocos modos
     que el SPEC dejó con auth de miembro y que el panel necesita leer
     (`cohorts`, `upload`). Nunca se escribe en localStorage desde acá: el
     único momento en que el panel deja una sesión de Academy guardada es
     "Abrir Academy", que es justamente pedir entrar como propietario.

   Jamás se inventan datos: una respuesta que no es JSON (el `npm run dev`
   sin mock devuelve index.html) o un error de la base es un error visible.
   ============================================================ */

export class AdminApiError extends Error {
  constructor(status, message, code) {
    super(message)
    this.name = 'AdminApiError'
    this.status = status
    this.code = code || null
  }
}

const GENERIC = {
  0: 'Sin conexión. Revisa tu internet e intenta de nuevo.',
  401: 'Tu sesión del panel venció. Vuelve a iniciar sesión.',
  403: 'Tu cuenta no tiene permiso para esto.',
  404: 'No encontrado.',
  409: 'No se pudo: hay un conflicto con otro dato.',
  429: 'Demasiados intentos seguidos. Espera un momento.',
  503: 'La Academy todavía no está disponible en este servidor.',
}

export function errorText(err) {
  if (!err) return ''
  if (err instanceof AdminApiError) return err.message || GENERIC[err.status] || 'Algo salió mal.'
  return err.message || 'Algo salió mal.'
}

async function request(headers, mode, { method = 'GET', query = {}, body } = {}) {
  const qs = new URLSearchParams({ mode })
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null || v === '') continue
    qs.set(k, String(v))
  }
  const hasBody = body !== undefined && method !== 'GET'
  let res
  try {
    res = await fetch(`/api/academy?${qs.toString()}`, {
      method,
      headers: headers(hasBody ? { 'Content-Type': 'application/json' } : {}),
      body: hasBody ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    })
  } catch {
    throw new AdminApiError(0, GENERIC[0], 'network')
  }
  const type = res.headers.get('content-type') || ''
  // Un index.html (SPA fallback de Vite o de Vercel ante una ruta que no
  // existe) no es "vacío": es que la API no está. Nunca se lee como datos.
  if (!type.includes('application/json')) {
    throw new AdminApiError(503, 'La API de Academy no responde. Si estás en local, usa el modo mock (VITE_DEV_MOCKS=1).', 'unavailable')
  }
  let data = null
  try { data = await res.json() } catch { data = null }
  if (!data || typeof data !== 'object') throw new AdminApiError(res.status || 500, 'Respuesta inválida del servidor.', 'invalid')
  if (!res.ok || data.ok === false) {
    throw new AdminApiError(res.status, data.error || GENERIC[res.status] || 'Algo salió mal.', data.code)
  }
  const { ok, ...rest } = data // eslint-disable-line no-unused-vars
  return rest
}

/* Hook con la API de la pestaña. `ctx.authHeaders` es una función que
   Dashboard vuelve a crear en cada render: se guarda en un ref para que la
   API sea estable (si fuera dependencia, cada render del panel reharía todas
   las cargas). */
export function useAcademyAdmin(ctx) {
  const hdr = useRef(ctx?.authHeaders)
  hdr.current = ctx?.authHeaders
  const owner = useRef(null) // { token, member, at }

  return useMemo(() => {
    const barberHeaders = (extra = {}) => (typeof hdr.current === 'function' ? hdr.current(extra) : extra)

    const call = (mode, opts) => request(barberHeaders, mode, opts)

    /* owner-session: token de miembro del propietario. Se reutiliza 10 min
       en memoria (vive 30 días, pero así un cambio de rol o de cuenta en el
       servidor se nota pronto). */
    const ownerSession = async ({ fresh = false } = {}) => {
      const cached = owner.current
      if (!fresh && cached && Date.now() - cached.at < 10 * 60 * 1000) return cached
      const data = await call('owner-session', { method: 'POST', body: {} })
      if (!data?.token) throw new AdminApiError(503, 'No se pudo abrir la sesión de propietario.', 'owner')
      owner.current = { token: data.token, member: data.member || null, at: Date.now() }
      return owner.current
    }

    const memberCall = async (mode, opts) => {
      const run = async (fresh) => {
        const { token } = await ownerSession({ fresh })
        return request((extra = {}) => ({ ...extra, Authorization: `Bearer ${token}` }), mode, opts)
      }
      try {
        return await run(false)
      } catch (err) {
        // Token viejo (sv cambió, se cerró sesión en todos lados): uno nuevo y
        // un solo reintento.
        if (err instanceof AdminApiError && err.status === 401) return run(true)
        throw err
      }
    }

    /* Entrar a la Academy como propietario. Navegación DURA a propósito:
       /academy/* tiene su propio CSP estricto y un documento conserva el CSP
       con el que cargó (SPEC §7.1). */
    const openAcademy = async (path = r.path('/comunidad')) => {
      const { token, member } = await ownerSession({ fresh: true })
      setSession(token, member)
      window.location.assign(path)
    }

    /* Subir una imagen (portada de curso o de grupo) como el propietario.
       El modo `upload` exige sesión de miembro; los kinds curso/portada son
       solo de staff, que el propietario es. */
    const uploadImage = async (kind, file) => {
      const dataUrl = await compressImage(file, { max: 1280, quality: 0.82 })
      const data = await memberCall('upload', { method: 'POST', body: { kind, dataUrl, private: false } })
      if (!data?.upload?.url) throw new AdminApiError(500, 'La imagen no se pudo subir.', 'upload')
      return data.upload
    }

    return { call, memberCall, ownerSession, openAcademy, uploadImage }
  }, [])
}

/* Carga con estados (loading / error / data) sin caché global: cada sección
   del panel pide lo suyo al montarse, al tocar "Reintentar" y cuando el
   panel termina un "Actualizar" (reloadKey). No hay sondeo. */
export function useAdminLoad(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const seq = useRef(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  const reload = useCallback(async ({ silent = false } = {}) => {
    const id = ++seq.current
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const data = await loaderRef.current()
      if (id === seq.current) setState({ data, error: null, loading: false })
      return data
    } catch (error) {
      if (id === seq.current) setState((s) => ({ data: silent ? s.data : null, error, loading: false }))
      return null
    }
  }, [])

  useEffect(() => { reload() }, deps) // eslint-disable-line react-hooks/exhaustive-deps

  const setData = useCallback((fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })), [])
  return { ...state, reload, setData }
}

/* Debounce simple para búsquedas (no dispara una consulta por tecla). */
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
