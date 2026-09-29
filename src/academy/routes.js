/* ACADEMY — rutas del front (un solo lugar para armarlas)
   ------------------------------------------------------------------
   Todas salen de ACADEMY_BASE (src/academy/hostConfig.js): '/academy' en
   PimpStudio, '/cursos' en BrunettiCutz. Ningún archivo compartido escribe
   la base a mano — usa r.path('/lo-que-sea') o uno de los constructores.

   Los parámetros van con encodeURIComponent: un handle o un slug nunca puede
   romper la ruta ni colar un "../". Las rutas de miembro viven bajo
   <base>/(.+), que tiene su propio CSP estricto; entrar a ellas DESDE
   AFUERA de la app (catálogo, panel, página de gracias) es navegación dura
   (window.location.assign), ver SPEC §7.1. */

import { ACADEMY_BASE } from './hostConfig.js'

const enc = (v) => encodeURIComponent(String(v ?? ''))

// Base normalizada: una barra al inicio y ninguna al final ('/academy').
const BASE = `/${String(ACADEMY_BASE || '/academy').replace(/^\/+|\/+$/g, '')}`

/* path('/comunidad') → '/academy/comunidad' · path('') o path('/') → '/academy'.
   Acepta la subruta con o sin barra inicial y respeta una barra final
   (path('/grupos/') → '/academy/grupos/', útil para startsWith). */
function path(sub = '') {
  const s = String(sub ?? '')
  if (!s || s === '/') return BASE
  return BASE + (s.startsWith('/') ? s : `/${s}`)
}

function buscar(q, type) {
  const qs = new URLSearchParams()
  if (q) qs.set('q', String(q))
  if (type && type !== 'todo') qs.set('type', String(type))
  const s = qs.toString()
  return `${path('/buscar')}${s ? `?${s}` : ''}`
}

const withNext = (url, next) => (next ? `${url}?next=${encodeURIComponent(String(next))}` : url)

export const r = {
  // --- constructores ---
  base: () => BASE,
  path,
  login: (next) => withNext(path('/ingreso'), next),
  createPassword: () => path('/crear-contrasena'),
  reset: () => path('/restablecer'),
  confirmEmail: () => path('/confirmar-correo'),
  gracias: (ref) => (ref ? `${path('/gracias')}?ref=${enc(ref)}` : path('/gracias')),
  search: (q, type) => buscar(q, type),
  buscar,
  post: (id) => path(`/comunidad/${enc(id)}`),
  course: (slug) => path(`/cursos/${enc(slug)}`),
  lesson: (course, lesson) => path(`/cursos/${enc(course)}/${enc(lesson)}`),
  profile: (handle) => path(`/perfil/${enc(handle)}`),
  group: (id) => path(`/grupos/${enc(id)}`),
  chat: (id) => path(`/chat/${enc(id)}`),
  // Compra de un curso bloqueado: ancla del catálogo público (navegación
  // dura). El destino real lo decide el host: catalogHref() de host.jsx.
  buy: (catalogId) => (catalogId ? `${BASE}#curso-${enc(catalogId)}` : BASE),

  // --- rutas fijas (strings) ---
  catalog: BASE,
  home: path('/comunidad'),
  comunidad: path('/comunidad'),
  cursos: path('/cursos'),
  calendario: path('/calendario'),
  miembros: path('/miembros'),
  clasificacion: path('/clasificacion'),
  acerca: path('/acerca'),
  ajustes: path('/ajustes'),
  reglas: path('/reglas'),
  ingreso: path('/ingreso'),
  crearContrasena: path('/crear-contrasena'),
  restablecer: path('/restablecer'),
  confirmarCorreo: path('/confirmar-correo'),
}

// Páginas de acceso: ahí un 401 es parte del flujo y `?next=` nunca apunta a ellas.
export const AUTH_PATHS = [r.ingreso, r.crearContrasena, r.restablecer, r.confirmarCorreo, path('/gracias')]

// ¿Es la raíz de la Academy (el catálogo / la landing pública)?
export function isBasePath(p) {
  return p === BASE || p === `${BASE}/`
}

// ¿Está dentro de la Academy (<base>/algo)?
export function isUnderBase(p) {
  return typeof p === 'string' && p.startsWith(`${BASE}/`)
}

export default r
