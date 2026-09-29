/* ACADEMY — URLs seguras (espejo exacto de api/_academyText.js)
   ------------------------------------------------------------------
   La Academy comparte origen con el panel: el token del barbero admin vive en
   el localStorage de pimpstudio.cl. Un solo `javascript:` pintado como href
   alcanza para robarlo (React 18 no bloquea esos href, solo avisa en dev). Por
   eso la regla es doble: safeUrl() al guardar (servidor) y al pintar (acá).

   ESM puro, sin JSX ni import.meta.env: lo importa también el mock de
   desarrollo desde Node (SPEC §13). Si cambia el algoritmo en el servidor,
   cambia acá — son el mismo paso a paso. La base de la Academy ('/academy'
   o '/cursos') sale de hostConfig.js, igual que en el servidor sale de
   api/_academyHost.js (HOST.basePath). */

import { ACADEMY_BASE } from './hostConfig.js'

// Base normalizada ('/academy'), igual que en routes.js.
const BASE = `/${String(ACADEMY_BASE || '/academy').replace(/^\/+|\/+$/g, '')}`
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Rutas relativas aceptadas como link: solo destinos propios. `/api/...` o
// `/panel` quedan fuera — un link a /api armado sirve para hacerle hacer un
// GET a otro miembro con un toque.
const RELATIVE_OK = [`${BASE}/`, '/assets/', '/reservar']
const MAX_URL = 2000

// Espacios, controles y barra invertida: `/\evil.com` es un link a otro dominio.
const BAD_URL_CHARS = /[\s\u0000-\u001f\u007f\\]/

// rel obligatorio en todo link escrito por un miembro (SPEC §0.2).
export const UGC_REL = 'noopener noreferrer nofollow ugc'

/* safeUrl(u) → string normalizado o null.
     1. No es string, o vacío tras trim, o > 2000 chars → null.
     2. Contiene espacios/controles/`\` → null.
     3. Empieza con "/": se acepta tal cual solo si empieza con <base>/,
        /assets/ o /reservar, y no con "//" ni contiene "/../".
     4. Si no, tiene que parsear con new URL() y ser http: o https:, sin
        usuario/contraseña y con host. http se sube a https. Devuelve url.href.
     5. Todo lo demás (javascript:, data:, mailto:, relativo sin "/") → null. */
export function safeUrl(u) {
  if (typeof u !== 'string') return null
  const s = u.trim()
  if (!s || s.length > MAX_URL) return null
  if (BAD_URL_CHARS.test(s)) return null
  if (s.startsWith('/')) {
    if (s.startsWith('//')) return null
    if (s.includes('/../') || s.endsWith('/..')) return null
    return RELATIVE_OK.some((p) => s.startsWith(p)) ? s : null
  }
  let url
  try {
    url = new URL(s)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password) return null
  if (!url.hostname) return null
  url.protocol = 'https:'
  return url.href
}

// Imágenes: solo el Blob del proyecto o /assets/ propios. Una imagen remota
// arbitraria sirve de pixel de rastreo, y el CSP de la Academy la bloquea igual.
export function isBlobUrl(u) {
  if (typeof u !== 'string' || !u) return false
  try {
    const url = new URL(u.trim())
    return url.protocol === 'https:' && !url.username && !url.password && url.hostname.endsWith('.public.blob.vercel-storage.com')
  } catch {
    return false
  }
}

export function isImageUrl(u) {
  if (isBlobUrl(u)) return true
  if (typeof u !== 'string') return false
  const s = u.trim()
  return s.startsWith('/assets/') && !s.startsWith('//') && !s.includes('..') && !BAD_URL_CHARS.test(s) && s.length <= MAX_URL
}

/* Adjuntos PRIVADOS del chat: el servidor los sirve por su proxy
   `/api/academy?mode=file&id=<uploadId>` (exige la sesión del miembro, así que
   un <img src> directo no sirve: hay que pedirlo con fetch + Authorization y
   pintar un blob:). Esto solo valida la forma exacta de esa URL. */
export function isChatFileUrl(u) {
  return typeof u === 'string' && /^\/api\/academy\?mode=file&id=\d{1,12}$/.test(u.trim())
}

// Vista previa local (objeto creado en ESTE navegador por URL.createObjectURL
// o el dataURL que devolvió compressImage). Nunca viene del servidor.
export function isLocalPreviewUrl(u) {
  if (typeof u !== 'string') return false
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(u)) return true
  try {
    return u.startsWith('blob:') && typeof window !== 'undefined' && new URL(u).origin === window.location.origin
  } catch {
    return false
  }
}

/* "Barbería · Nivel Básico" → "barberia-nivel-basico" (≤ 40). Igual al servidor. */
export function slugify(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
}

// ¿Link interno de la Academy? (se abre con el router, sin pestaña nueva).
const ACADEMY_PATH_RE = new RegExp(`^${escapeRe(BASE)}\\/[A-Za-z0-9/_\\-?=&%.#]*$`)
export function isAcademyPath(u) {
  return typeof u === 'string' && ACADEMY_PATH_RE.test(u) && !u.startsWith('//') && !u.includes('/../')
}

/* @menciones → handles únicos en minúsculas (máx. 10). Misma regex que el
   servidor: la @ no puede venir pegada a una palabra (juan@gmail.com no es
   una mención a "gmail"). */
export function extractMentions(text) {
  if (typeof text !== 'string' || !text) return []
  const out = new Set()
  const re = /(^|[^A-Za-z0-9_.@-])@([a-z0-9-]{3,40})(?![a-z0-9-])/gi
  let m
  while ((m = re.exec(text)) && out.size < 10) out.add(m[2].toLowerCase())
  return [...out]
}
