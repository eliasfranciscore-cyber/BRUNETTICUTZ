/* ACADEMY — sesión del miembro en el navegador
   ------------------------------------------------------------------
   La Academy vive en el MISMO origen que el panel (pimpstudio.cl/academy o
   brunetticutz.cl/cursos, y <sitio>/panel), así que las dos sesiones comparten localStorage. Por
   eso este módulo solo toca sus propias claves (`ps_academy_*`) y nunca
   `ps_barber*` ni `ps_user`: cerrar sesión en la Academy no puede sacar al
   barbero del panel, y al revés (SPEC §0.1, §7.2).

   Todo con try/catch: Safari en modo privado o con el storage bloqueado lanza
   al leer o escribir, y eso no puede tumbar la página. */

export const TOKEN_KEY = 'ps_academy_token'
export const MEMBER_KEY = 'ps_academy_member'
// Marca persistente de "este navegador ya entró alguna vez a la Academy":
// sobrevive al cierre de sesión (el catálogo la usa para ofrecer "Entrar").
export const SEEN_KEY = 'ps_academy_seen'

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || '' } catch { return '' }
}

export function getMember() {
  try {
    const raw = localStorage.getItem(MEMBER_KEY)
    if (!raw) return null
    const m = JSON.parse(raw)
    return m && typeof m === 'object' ? m : null
  } catch {
    return null
  }
}

export function setSession(token, member) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, String(token))
    if (member && typeof member === 'object') localStorage.setItem(MEMBER_KEY, JSON.stringify(member))
    localStorage.setItem(SEEN_KEY, '1')
  } catch { /* sin storage: la sesión dura lo que dure la pestaña */ }
}

// Solo actualiza el perfil guardado (p. ej. después de `me`), sin tocar el token.
export function setStoredMember(member) {
  try {
    if (member && typeof member === 'object') localStorage.setItem(MEMBER_KEY, JSON.stringify(member))
  } catch { /* sin storage */ }
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(MEMBER_KEY)
  } catch { /* sin storage */ }
}

export function hasSession() {
  return Boolean(getToken())
}

export function wasSeen() {
  try { return localStorage.getItem(SEEN_KEY) === '1' } catch { return false }
}

/* Carga útil del token SIN verificar (la firma la verifica el servidor). Solo
   sirve para decisiones de interfaz: saber si el token es de "cambio de
   contraseña obligatorio" (pwc) o si ya venció, y ahorrarse un viaje al
   servidor que igual respondería 401/403. Formato: m1.<base64url(json)>.<mac>.
   Los tokens del mock de desarrollo (mockm.<id>.<ts>) no se pueden leer: null. */
export function tokenPayload(token = getToken()) {
  try {
    const parts = String(token || '').split('.')
    if (parts.length !== 3 || parts[0] !== 'm1') return null
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    while (b64.length % 4) b64 += '='
    const json = decodeURIComponent(
      Array.from(atob(b64), (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
    )
    const p = JSON.parse(json)
    return p && typeof p === 'object' ? p : null
  } catch {
    return null
  }
}

// ¿El token ya venció según su propio `exp` (segundos)? Sin payload legible → false.
export function isTokenExpired(token = getToken()) {
  const p = tokenPayload(token)
  if (!p || !Number.isFinite(Number(p.exp))) return false
  return Number(p.exp) * 1000 <= Date.now()
}

// Sesión de "crea tu contraseña": el token lo dice (pwc) o el perfil guardado.
export function isPwcSession() {
  const p = tokenPayload()
  if (p && p.pwc) return true
  const m = getMember()
  return Boolean(m && m.mustChangePassword)
}

export function authHeaders() {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}
