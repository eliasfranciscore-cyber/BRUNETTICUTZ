/* ACADEMY — Texto y URLs (funciones puras)
   ------------------------------------------------------------------
   Todo lo que entra a la Academy escrito por un miembro (links, avatar,
   videos, textos) pasa por acá ANTES de guardarse. La Academy comparte origen
   con el panel (pimpstudio.cl/academy y pimpstudio.cl/panel), y el token del
   barbero admin vive en localStorage de ese mismo origen: un solo
   `javascript:` guardado como link y renderizado como href alcanzaría para
   robarlo. Por eso la regla es doble — safeUrl() al guardar (acá) y al
   pintar (src/academy/url.js, espejo exacto de esta función).

   Sin imports del proyecto salvo api/_academyHost.js (datos puros del
   sitio: la ruta base de la Academy y su dominio), que no importa nada: la
   usan el backend, el mock de desarrollo y los tests, y un archivo puro no
   puede cerrar ciclos.
   Prefijo `_`: no cuenta como función serverless (tope 12 del plan Hobby). */

import { HOST } from "./_academyHost.js"

/* Rutas relativas que SÍ se aceptan como link: solo destinos propios que
   tiene sentido enlazar desde un post o un evento. Cualquier otra ruta
   relativa (`/api/...`, `/panel`) se rechaza: un link a /api con parámetros
   armados es una forma de hacerle hacer GETs a otro miembro con un toque. */
const RELATIVE_OK = [`${HOST.basePath}/`, "/assets/", "/reservar"]
const MAX_URL = 2000

// Espacios, controles y barra invertida: ningún link legítimo los necesita
// sin codificar, y la barra invertida es la que usan los navegadores para
// convertir `/\evil.com` en un link a otro dominio.
const BAD_URL_CHARS = /[\s\u0000-\u001f\u007f\\]/

/* safeUrl(u) → string normalizado o null.
   Algoritmo (src/academy/url.js lo repite paso a paso; si cambia uno, cambia
   el otro):
     1. No es string, o vacío tras trim, o > 2000 chars → null.
     2. Contiene espacios/controles/`\` → null.
     3. Empieza con "/": se acepta tal cual solo si empieza con la ruta de
        la Academy (HOST.basePath + "/", p. ej. /academy/), /assets/ o
        /reservar, y no con "//" ni contiene "/../" → si no, null.
     4. Si no, tiene que parsear con new URL() y ser http: o https:, sin
        usuario/contraseña embebidos y con host. http se sube a https.
        Devuelve url.href (host en minúsculas, ruta normalizada).
     5. Todo lo demás (javascript:, data:, mailto:, relativo sin "/") → null. */
export function safeUrl(u) {
  if (typeof u !== "string") return null
  const s = u.trim()
  if (!s || s.length > MAX_URL) return null
  if (BAD_URL_CHARS.test(s)) return null
  if (s.startsWith("/")) {
    if (s.startsWith("//")) return null
    if (s.includes("/../") || s.endsWith("/..")) return null
    return RELATIVE_OK.some((p) => s.startsWith(p)) ? s : null
  }
  let url
  try {
    url = new URL(s)
  } catch {
    return null
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  if (url.username || url.password) return null
  if (!url.hostname) return null
  url.protocol = "https:"
  return url.href
}

/* Imágenes solo del Blob del proyecto (*.public.blob.vercel-storage.com) o de
   /assets/ propios. Una imagen remota arbitraria sirve para rastrear quién
   abre un post (pixel) y el CSP estricto de /academy la bloquearía igual. */
export function isBlobUrl(u) {
  if (typeof u !== "string" || !u) return false
  try {
    const url = new URL(u.trim())
    return url.protocol === "https:" && !url.username && !url.password && url.hostname.endsWith(".public.blob.vercel-storage.com")
  } catch {
    return false
  }
}

export function isImageUrl(u) {
  if (isBlobUrl(u)) return true
  if (typeof u !== "string") return false
  const s = u.trim()
  return s.startsWith("/assets/") && !s.startsWith("//") && !s.includes("..") && !BAD_URL_CHARS.test(s) && s.length <= MAX_URL
}

/* Id de YouTube (11 caracteres) desde un id pelado o las URLs que la gente
   copia: youtu.be/ID, watch?v=ID, /embed/ID, /shorts/ID, /live/ID, /v/ID, en
   youtube.com, m.youtube.com, music.youtube.com y youtube-nocookie.com.
   Cualquier otra cosa → null: el id termina en un src de iframe, así que no
   se deja pasar nada que no sea exactamente el formato. */
const YT_ID = /^[A-Za-z0-9_-]{11}$/
const YT_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"])
export function parseYouTubeId(input) {
  if (typeof input !== "string") return null
  const s = input.trim()
  if (!s || s.length > 300) return null
  if (YT_ID.test(s)) return s
  let url
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
  } catch {
    return null
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  const host = url.hostname.toLowerCase()
  let id = null
  if (host === "youtu.be" || host === "www.youtu.be") {
    id = url.pathname.split("/")[1] || null
  } else if (YT_HOSTS.has(host)) {
    if (url.pathname === "/watch") id = url.searchParams.get("v")
    else {
      const m = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname)
      id = m ? m[1] : null
    }
  }
  return id && YT_ID.test(id) ? id : null
}

/* Texto libre de un miembro: se recorta, se sacan los caracteres de control
   (menos el salto de línea; el tab pasa a espacio) y los de dirección de
   texto (U+202A–U+202E, U+2066–U+2069), que sirven para disfrazar un link o
   un nombre invirtiendo cómo se lee. Más de 2 líneas en blanco seguidas se
   dejan en 2, y se corta a `max` caracteres sin partir un emoji. */
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f​‎‏‪-‮⁦-⁩﻿]/g
export function cleanText(s, max) {
  if (s === null || s === undefined) return ""
  let t = String(s).replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(CONTROL, "")
  t = t.replace(/\n{4,}/g, "\n\n\n").trim()
  if (Number.isFinite(max) && max >= 0) {
    const chars = Array.from(t)
    if (chars.length > max) t = chars.slice(0, max).join("").trim()
  }
  return t
}

/* Versión de una línea (nombres, títulos, ubicación): los saltos pasan a
   espacio y los espacios repetidos se juntan. */
export function cleanLine(s, max) {
  return cleanText(String(s ?? "").replace(/\s*\n\s*/g, " ").replace(/ {2,}/g, " "), max)
}

/* "Barbería · Nivel Básico" → "barberia-nivel-basico" (≤ 40). */
export function slugify(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "")
}

/* Escape HTML para los correos (y cualquier HTML que se arme en el
   servidor). En el front no hace falta: React escapa solo. */
export function esc(s) {
  if (s === null || s === undefined) return ""
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/* Celda CSV segura para Excel/Sheets: una celda que empieza con = + - @ (o
   tab/CR) se ejecuta como fórmula al abrir el archivo — un nombre de miembro
   como `=HYPERLINK(...)` se convertiría en un link en la planilla del dueño.
   Se antepone ' y siempre va entre comillas. */
export function csvCell(v) {
  let s = v === null || v === undefined ? "" : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

/* @menciones de un texto → handles únicos en minúsculas (máx. 10). Se exige
   que la @ no venga pegada a una palabra, para no leer un correo
   (juan@gmail.com) como una mención a "gmail". */
export function extractMentions(text) {
  if (typeof text !== "string" || !text) return []
  const out = new Set()
  const re = /(^|[^A-Za-z0-9_.@-])@([a-z0-9-]{3,40})(?![a-z0-9-])/gi
  let m
  while ((m = re.exec(text)) && out.size < 10) out.add(m[2].toLowerCase())
  return [...out]
}

/* juan.perez@gmail.com → ju***@gmail.com. Para mostrar "te mandamos el
   acceso a …" sin exponer el correo completo en una página pública. */
export function maskEmail(email) {
  const s = String(email ?? "").trim()
  const at = s.lastIndexOf("@")
  if (at < 1) return ""
  const local = s.slice(0, at)
  const domain = s.slice(at + 1)
  const keep = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2)
  return `${keep}***@${domain}`
}

/* Correo normalizado + validado. Devuelve "" si no sirve.
   El TLD `.invalid` (RFC 2606) se rechaza: es el que usa me-delete para las
   cuentas anonimizadas ("deleted-<id>@invalid"), y un correo real con ese
   dominio chocaría con ellas. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
export function normalizeEmail(email) {
  const s = String(email ?? "").trim().toLowerCase()
  if (!s || s.length > 120 || !EMAIL_RE.test(s)) return ""
  if (/\.invalid$/.test(s)) return ""
  return s
}

/* Correo sintético del propietario creado desde el panel sin email de
   barbero (owner-session): owner-<id>@<dominio del sitio>. No lleva a
   nadie, así que el cron no le manda correos (isSyntheticOwnerEmail). */
const OWNER_EMAIL_DOMAIN = (() => {
  try { return new URL(HOST.defaultSiteUrl).hostname.replace(/^www\./, "").toLowerCase() } catch { return "invalid" }
})()
export function syntheticOwnerEmail(barberId) {
  return `owner-${barberId}@${OWNER_EMAIL_DOMAIN}`
}
export function isSyntheticOwnerEmail(email) {
  const e = String(email ?? "").trim().toLowerCase()
  const at = e.lastIndexOf("@")
  return at > 0 && /^owner-\d+$/.test(e.slice(0, at)) && e.slice(at + 1) === OWNER_EMAIL_DOMAIN
}
