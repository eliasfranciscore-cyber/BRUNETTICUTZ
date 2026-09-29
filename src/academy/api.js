/* ACADEMY — cliente HTTP del miembro
   ------------------------------------------------------------------
   Único punto por el que el front habla con /api/academy?mode=… (y con el
   checkout del host, CHECKOUT en hostConfig.js, para comprar un curso).
   Reglas (SPEC §7.2):

   - Manda `Authorization: Bearer <ps_academy_token>`. Nunca el token del
     barbero: el panel usa el suyo propio (ctx.authHeaders) para lo suyo.
   - NUNCA cae a datos de demostración. Detrás de una sesión de miembro hay
     contenido pagado: si la API no responde, se muestra un error, no un
     curso inventado.
   - Una respuesta que no es JSON es "API no disponible" (503). En producción
     una ruta /api desconocida devuelve el index.html con 200 (el rewrite del
     SPA), y el patrón viejo `.json().catch(()=>{})` lo escondía.
   - 401 `code:'auth'` → la sesión ya no sirve: se borra y se manda a
     <base>/ingreso (salvo en las propias páginas de acceso, que muestran su
     error). 403 `password_change_required` → <base>/crear-contrasena. Las
     dos son navegaciones duras: <base>/(.+) tiene su propio CSP. */

import { getToken, clearSession } from './session.js'
import { r, AUTH_PATHS, isBasePath, isUnderBase } from './routes.js'
import { CHECKOUT } from './hostConfig.js'

export class ApiError extends Error {
  constructor(status, code, message, data) {
    super(message || 'Error')
    this.name = 'ApiError'
    this.status = status
    this.code = code || null
    this.data = data || null
    // 429: cuántos segundos esperar (login y límites de subida lo mandan).
    this.retryAfter = data && Number.isFinite(Number(data.retryAfter)) ? Number(data.retryAfter) : null
  }
}

// Páginas donde un 401 es parte del flujo (credenciales malas, token vencido)
// y NO debe mandar a otra parte.
const AUTH_PAGES = AUTH_PATHS
// Modos públicos: su 401 es "credenciales incorrectas", no "sesión vencida".
const PUBLIC_MODES = new Set(['login', 'password-reset-request', 'password-reset-confirm', 'email-change-confirm', 'about', 'catalog'])

const DEFAULT_MSG = {
  0: 'Sin conexión. Revisa tu internet e intenta de nuevo.',
  400: 'Revisa los datos e intenta de nuevo.',
  401: 'Tu sesión terminó. Vuelve a entrar.',
  403: 'No tienes acceso a esto.',
  404: 'No encontramos lo que buscabas.',
  409: 'No se pudo completar la acción.',
  413: 'El archivo es demasiado grande.',
  429: 'Demasiados intentos. Espera un momento e intenta de nuevo.',
  500: 'Algo falló de nuestro lado. Intenta de nuevo en un rato.',
  502: 'Un servicio externo no respondió. Intenta de nuevo en un rato.',
  503: 'La Academy no está disponible en este momento. Intenta de nuevo en un rato.',
}

function defaultMessage(status) {
  return DEFAULT_MSG[status] || (status >= 500 ? DEFAULT_MSG[500] : DEFAULT_MSG[400])
}

function currentPath() {
  try { return window.location.pathname || '' } catch { return '' }
}

function onAuthPage() {
  const p = currentPath()
  return isBasePath(p) || AUTH_PAGES.some((a) => p === a || p.startsWith(a + '/'))
}

// Una sola redirección aunque fallen varias peticiones a la vez.
let redirecting = false
function hardRedirect(url) {
  if (redirecting) return
  redirecting = true
  try { window.location.assign(url) } catch { /* sin window (tests) */ }
}

function loginUrlWithNext() {
  const p = currentPath()
  let next = ''
  try {
    if (isUnderBase(p) && !onAuthPage()) next = p + (window.location.search || '')
  } catch { /* sin window */ }
  return r.login(next)
}

function buildQuery(params) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue
    qs.set(k, Array.isArray(v) ? v.join(',') : String(v))
  }
  return qs.toString()
}

// URL de un modo (útil para <a download> o para armar enlaces al proxy de archivos).
export function academyUrl(mode, query = {}) {
  const rest = buildQuery(query)
  return `/api/academy?mode=${encodeURIComponent(mode)}${rest ? `&${rest}` : ''}`
}

async function parseResponse(res) {
  const type = res.headers.get('content-type') || ''
  if (!type.includes('application/json')) {
    throw new ApiError(503, 'unavailable', DEFAULT_MSG[503])
  }
  let body
  try {
    body = await res.json()
  } catch {
    throw new ApiError(503, 'unavailable', DEFAULT_MSG[503])
  }
  if (!body || typeof body !== 'object') throw new ApiError(503, 'unavailable', DEFAULT_MSG[503])
  if (!res.ok || body.ok === false) {
    const status = res.ok ? 400 : res.status
    throw new ApiError(status, body.code || null, body.error || defaultMessage(status), body)
  }
  const { ok, ...data } = body // eslint-disable-line no-unused-vars
  return data
}

async function request(url, { method = 'GET', body, keepalive = false, headers = {}, signal, timeoutMs } = {}) {
  const init = { method, headers: { Accept: 'application/json', ...headers }, credentials: 'same-origin', cache: 'no-store' }
  if (body !== undefined && method !== 'GET') {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  if (keepalive) init.keepalive = true

  // Timeout propio (salvo keepalive: esa petición tiene que sobrevivir al
  // cierre de la página). La subida de una foto de 2 MB por 3G puede tardar.
  let timer = null
  let timedOut = false
  const ctl = typeof AbortController !== 'undefined' && !keepalive ? new AbortController() : null
  if (ctl) {
    const ms = timeoutMs || (method === 'GET' ? 25000 : 60000)
    timer = setTimeout(() => { timedOut = true; ctl.abort() }, ms)
    if (signal) {
      if (signal.aborted) ctl.abort()
      else signal.addEventListener('abort', () => ctl.abort(), { once: true })
    }
    init.signal = ctl.signal
  } else if (signal) {
    init.signal = signal
  }

  let res
  try {
    res = await fetch(url, init)
  } catch (e) {
    if (timer) clearTimeout(timer)
    if (timedOut) throw new ApiError(0, 'timeout', 'La conexión tardó demasiado. Intenta de nuevo.')
    if (e && e.name === 'AbortError') throw new ApiError(0, 'aborted', 'Cancelado')
    throw new ApiError(0, 'network', DEFAULT_MSG[0])
  }
  if (timer) clearTimeout(timer)
  return parseResponse(res)
}

/* academyApi('feed', { query: { sort: 'nuevos' } })
   academyApi('post-save', { method: 'POST', body: {...} })
   → los datos de la respuesta sin `ok`, o lanza ApiError {status, code, message}. */
export async function academyApi(mode, { method = 'GET', query = {}, body, keepalive = false, signal, timeoutMs } = {}) {
  const token = getToken()
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  try {
    return await request(academyUrl(mode, query), { method, body, keepalive, headers, signal, timeoutMs })
  } catch (err) {
    if (err instanceof ApiError && !keepalive) {
      if (err.status === 401 && (err.code === 'auth' || !err.code) && !PUBLIC_MODES.has(mode)) {
        clearSession()
        if (!onAuthPage()) hardRedirect(loginUrlWithNext())
      } else if (err.status === 403 && err.code === 'password_change_required') {
        if (currentPath() !== r.crearContrasena) hardRedirect(r.crearContrasena)
      }
    }
    throw err
  }
}

/* Compra de un curso: POST <CHECKOUT.path> {kind:'course', …} → {ref, total, initPoint}.
   (PimpStudio: /api/checkout · BrunettiCutz: /api/mp-payments) */
export async function checkoutApi(body) {
  return request(CHECKOUT.path, { method: 'POST', body: { kind: 'course', ...(body || {}) } })
}

/* Estado de una compra: GET CHECKOUT.statusUrl('aca-…') →
   {kind:'course', status, course:{slug,title}, modality, total, emailMasked}. */
export async function checkoutStatus(ref) {
  return request(CHECKOUT.statusUrl(String(ref || '')))
}
