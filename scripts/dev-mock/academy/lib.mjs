/* Ayudas compartidas del mock de Academy (scripts/dev-mock/academy, código
   compartido entre PimpStudio y BrunettiCutz: docs/academy/PORTABLE.md). Solo
   Node, solo `VITE_DEV_MOCKS=1`: nada de esto llega al bundle (vite.config.js
   carga el plugin con un import dinámico que esbuild no empaqueta).

   Lo propio de cada sitio (base de rutas, checkout, marca, barbero del
   panel, cursos de fixtures) viene de ./host.mjs (MOCK_HOST) y queda en
   `HOST`, que createAcademyMock({ base, checkoutPath }) puede ajustar.

   Por qué existe: los handlers del mock (academy-core.mjs de MOCK-CORE y
   academy-community/chat/events.mjs de MOCK-SOCIAL) tienen que aplicar las
   MISMAS reglas que el backend real (docs/academy/SPEC.md §3–§5): quién ve
   qué curso, qué publicación, qué evento, cómo se calcula el nivel. Si cada
   archivo las reimplementa, el mock deja de servir para probar IDOR y
   visibilidad. Viven acá, una sola vez.

   ── Convención de argumentos ─────────────────────────────────────────────
   Toda ayuda que lee datos recibe `state` como PRIMER argumento
   (p. ej. `memberMini(state, row)`). Por tolerancia, si el primer argumento
   no es un estado (no tiene `academy_members`), se usa el estado vigente que
   index.mjs fija en cada request con `setCurrentState()` — así también
   funcionan las firmas "reales" del SPEC (`memberMini(row)`,
   `canSeeEvent(member, event)`, `routeFor({targetType,...})`).
   `member` puede ser la fila (snake_case) o `ctx.member` / `ctx.admin`:
   basta con que traiga `id` o `memberId` y `role`.

   ── Estado (fixtures.mjs → createState()) ────────────────────────────────
   state.<tabla>   arrays de filas con EXACTAMENTE las columnas del DDL
                   (§2, snake_case). Timestamps = strings ISO sin ms
                   ('2026-09-28T21:40:00Z', ver nowIso()); DATE = 'YYYY-MM-DD'.
   state.seq.<tabla>  último id usado (usar nextId(state, tabla)).
   state.outbox    correos "enviados" [{id, kind, to, subject, text, data, createdAt}]
   state.barbers   [{id, name, code, email, admin}]  (barbero del panel)
   state.notifications  alertas del panel (tabla `notifications` real)
   state.mock      contadores internos del mock (no son tablas):
                   sessions Map(token→{memberId, sv, pwc, exp}), loginFails,
                   blobs Map(uploadId→{buffer, contentType}), rate, mpPayments,
                   alwaysOnline [memberId] (index.mjs les refresca last_sync_at).

   ── ctx que recibe cada handler (index.mjs → buildCtx + gate) ────────────
   { state, st (alias), mode, method, req, res, query, q (alias), body, ip,
     token, now (Date),
     member: null | { id, role, status, sessionVersion, mustChangePassword,
                      name, handle, prefs, lastSeenAt, row }   // row = fila viva
     admin:  null | { memberId|null, barberId|null, role }      // modos admin/mod/owner
     barber: null | { id, name, admin:true },
     log(...args) }
   Un handler devuelve un objeto → 200 {ok:true, ...obj} (Cache-Control
   private, no-store; `__cache` lo reemplaza y se borra). Para errores:
   `throw new HttpError(status, mensaje, code?, extra?)` → {ok:false, error,
   code, ...extra}. Si ya escribió la respuesta (p. ej. `file`), devuelve
   undefined. Cada archivo academy-*.mjs exporta
   `export const handlers = { 'modo': async (ctx) => ({...}) }` y, opcional,
   `export function setup({ getState, log })` (bots de DEV_MOCK_BOTS).

   ── Exportaciones ────────────────────────────────────────────────────────
   Errores / tiempo / ids
     HttpError(status, message, code?, extra?)
     nowIso(date?) → 'YYYY-MM-DDTHH:MM:SSZ'     isoAgo(ms) → nowIso(now-ms)
     santiagoDateKey(date?) → 'YYYY-MM-DD' en America/Santiago
     zonedToUtc('YYYY-MM-DD', 'HH:MM', tz) → Date    zonedParts(date, tz) → {dateKey, time, weekday 1..7}
     MIN, HOUR, DAY (ms)
     nextId(state, table) → int
     paginate(list, {page=1, perPage=30}) → {items, total, page, pages}
     pageByCursor(list, {cursor, limit=20}) → {items, nextCursor}  (cursor opaco)
   Niveles y puntos (§4.2)
     LEVEL_THRESHOLDS, DEFAULT_LEVEL_NAMES
     levelFor(points) → {level, points, currentMin, nextMin|null, pointsToNext, progress}
     pointsOf(state, memberId, {since?}) → likes recibidos de otros (since = ISO)
     levelOf(state, memberId) → int
     levelNameOf(state, level) → nombre según settings.levels.names
   Miembros (§4.3)
     memberById(state, id), memberByHandle(state, handle), memberByEmail(state, email)
     memberMini(state, rowOrId) → {id, handle, name, avatarUrl, level, role}
     memberPublic(state, rowOrId, {viewer?}) → MemberMini + {bio, location, links,
       joinedAt, lastSeenAt|null, online, points}
     memberAdmin(state, rowOrId) → MemberPublic + {email, phone, status, source,
       lastLoginAt, credentialsSentAt, mustChangePassword, grants, cohorts}
     meOf(state, rowOrId) → Me
     isOnline(state, row), mergePrefs(prefs)
     isStaff(member)  propietario|admin|moderador     isAdmin(member)  propietario|admin
     cohortIdsOf(state, memberId) → int[] (grupos no archivados)
     activeGrantCourseIds(state, memberId) → int[]
     isBlocked(state, aId, bId) → bloqueo en cualquier dirección
   Acceso (§5.2, §5.3, §5.5)
     canAccessCourse(state, member, course) → {ok, reason: null|'compra'|'nivel'|'borrador'}
     canAccessLesson(state, member, lessonOrId) → boolean
     orderedLessons(state, courseId, {includeDrafts}) → lecciones en orden de lectura
     canSeePost(state, member, post) → boolean
     canSeeEvent(state, member, event) → boolean   eventLockReason(...) → null|'nivel'|'grupo'
   Notificaciones (§5.3, §8.1)
     notify(state, {memberId, kind, actorId, targetType, targetId, parentId,
       preview, groupKey}) → fila | null  (se salta al propio actor, bloqueos y
       prefs.notif apagadas; con groupKey reusa la fila no leída)
     notifyMany(state, memberIds, payload) → filas
     notificationText(kind, actorName, extra) → texto en español
     routeFor(state, {targetType, targetId, parentId, extra}) → '<HOST.base>/...'
   Texto / URLs (mismo comportamiento que src/academy/{url,youtube}.js; si
   esos archivos existen y cargan en Node, se usan ellos)
     safeUrl, isBlobUrl, isImageUrl, parseYouTubeId, slugify, cleanText,
     extractMentions, emailNorm, EMAIL_RE, maskEmail
   Ajustes
     DEFAULT_SETTINGS, DEFAULT_PREFS, settingsOf(state) (con defaults), deepMerge
   Host (./host.mjs)
     HOST (MOCK_HOST vigente; se lee en cada request), configureHost({ base, checkoutPath })
   Sesiones / puertas (usadas por index.mjs y academy-core.mjs)
     MODES (modo → {file, auth, methods}), issueMemberToken(state, row, {pwc}),
     readBearer(req), resolveToken(state, token), buildCtx(...), gate(ctx, auth),
     setCurrentState(state), outbox(state, entry)
*/

import crypto from 'node:crypto'
import { MOCK_HOST } from './host.mjs'

/* ── Host (PORTABLE.md §2) ───────────────────────────────────────────────
   Un solo objeto vivo: los handlers leen HOST.base / HOST.brand en cada
   request, así createAcademyMock({ base, checkoutPath }) lo cambia sin
   recargar módulos. La marca y los fixtures se leen al cargar. */
export const HOST = { ...MOCK_HOST, brand: { ...MOCK_HOST.brand } }
export function configureHost({ base, checkoutPath } = {}) {
  if (typeof base === 'string' && base.startsWith('/')) HOST.base = base.replace(/\/+$/, '')
  if (typeof checkoutPath === 'string' && checkoutPath.startsWith('/')) HOST.checkoutPath = checkoutPath.replace(/\/+$/, '')
  return HOST
}

/* ── Lógica pura compartida con el front ─────────────────────────────────
   El SPEC (§13) pide que el mock use las MISMAS funciones que el cliente
   (src/academy/levels.js, url.js, youtube.js). Las escribe FE-CORE en
   paralelo, así que se intentan cargar y, si no existen o no corren en Node
   (usan window, import.meta.env…), queda la copia local idéntica al SPEC. */
async function tryImport(rel) {
  try { return await import(new URL(rel, import.meta.url).href) } catch { return null }
}
const feLevels = await tryImport('../../../src/academy/levels.js')
const feUrl = await tryImport('../../../src/academy/url.js')
const feYoutube = await tryImport('../../../src/academy/youtube.js')

// Envuelve la versión del front: si revienta en Node, cae a la local.
function prefer(ext, local) {
  if (typeof ext !== 'function') return local
  return (...args) => { try { return ext(...args) } catch { return local(...args) } }
}

/* ── Errores, tiempo, ids ────────────────────────────────────────────── */
export class HttpError extends Error {
  constructor(status, message, code, extra) {
    super(message)
    this.status = status
    this.code = code || undefined
    this.extra = extra || undefined
  }
}

// Sin milisegundos: Safari/iOS parsean mal algunos formatos (SPEC §0.7).
export const nowIso = (d = new Date()) => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z')
export const isoAgo = (ms) => nowIso(new Date(Date.now() - ms))
export const MIN = 60_000
export const HOUR = 60 * MIN
export const DAY = 24 * HOUR

export function santiagoDateKey(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(d))
  const get = (t) => parts.find((p) => p.type === t)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

/* Hora de pared en una zona ↔ instante UTC, sin librerías. Chile cambia de
   horario (2026-09-06 y abril): calcular el offset con Intl en el instante
   mismo evita el clásico corrimiento de una hora en las repeticiones. */
function tzOffsetMs(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date)
  const g = (t) => Number(parts.find((p) => p.type === t)?.value)
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(date.getTime() / 1000) * 1000
}
// ('2026-10-07', '19:00', 'America/Santiago') → Date (instante UTC)
export function zonedToUtc(dateKey, hhmm = '00:00', tz = 'America/Santiago') {
  const [y, m, d] = String(dateKey).split('-').map(Number)
  const [h, mi] = String(hhmm).split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h || 0, mi || 0)
  let t = guess - tzOffsetMs(new Date(guess), tz)
  t = guess - tzOffsetMs(new Date(t), tz)
  return new Date(t)
}
// Date → {dateKey, time 'HH:MM', weekday 1=lunes…7=domingo} en la zona pedida
export function zonedParts(date, tz = 'America/Santiago') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(new Date(date))
  const g = (t) => parts.find((p) => p.type === t)?.value
  const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[g('weekday')]
  return { dateKey: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}`, weekday: wd }
}

let CURRENT = null
export function setCurrentState(state) { CURRENT = state }
const isState = (x) => Boolean(x && typeof x === 'object' && Array.isArray(x.academy_members))
// (state, ...rest) o (...rest) con el estado vigente.
function withState(args) {
  if (isState(args[0])) return args
  if (!CURRENT) throw new Error('dev-mock: no hay estado vigente (llama setCurrentState)')
  return [CURRENT, ...args]
}

export function nextId(...a) {
  const [state, table] = withState(a)
  state.seq ||= {}
  if (state.seq[table] == null) {
    state.seq[table] = (state[table] || []).reduce((m, r) => Math.max(m, Number(r.id) || 0), 0)
  }
  state.seq[table] += 1
  return state.seq[table]
}

export function paginate(list, { page = 1, perPage = 30 } = {}) {
  const total = list.length
  const pages = Math.max(1, Math.ceil(total / perPage))
  const p = Math.min(Math.max(1, Number.parseInt(page, 10) || 1), pages)
  return { items: list.slice((p - 1) * perPage, p * perPage), total, page: p, pages }
}

// Cursor opaco = offset en base64url. Suficiente para el mock: las listas se
// recalculan en cada request y el orden es estable.
export function pageByCursor(list, { cursor, limit = 20 } = {}) {
  let offset = 0
  if (cursor) {
    try { offset = Math.max(0, Number.parseInt(Buffer.from(String(cursor), 'base64url').toString('utf8').replace(/^o:/, ''), 10) || 0) } catch { offset = 0 }
  }
  const items = list.slice(offset, offset + limit)
  const next = offset + limit < list.length ? Buffer.from(`o:${offset + limit}`).toString('base64url') : null
  return { items, nextCursor: next }
}

/* ── Texto y URLs (§4.1) ─────────────────────────────────────────────── */
function localSafeUrl(u) {
  if (typeof u !== 'string') return null
  const s = u.trim()
  if (!s || s.length > 2000 || /[\s<>"'`\\]/.test(s)) return null
  if (s.startsWith('/')) {
    if (s.startsWith('//')) return null
    return /^\/(academy\/|assets\/|reservar(?:[/?#]|$))/.test(s) && !s.includes('..') ? s : null
  }
  let url
  try { url = new URL(s) } catch { return null }
  if (url.protocol === 'http:') url.protocol = 'https:'
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) return null
  return url.toString()
}
function localIsBlobUrl(u) {
  try {
    const url = new URL(String(u))
    return url.protocol === 'https:' && url.hostname.endsWith('.public.blob.vercel-storage.com')
  } catch { return false }
}
function localIsImageUrl(u) {
  if (typeof u !== 'string') return false
  if (/^\/assets\/[^\s]+$/.test(u) && !u.includes('..') && !u.startsWith('//')) return true
  return localIsBlobUrl(u)
}
const YT_ID = /^[A-Za-z0-9_-]{11}$/
function localParseYouTubeId(input) {
  if (typeof input !== 'string') return null
  const s = input.trim()
  if (!s) return null
  if (YT_ID.test(s)) return s
  let url
  try { url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`) } catch { return null }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '')
  let id = null
  if (host === 'youtu.be') id = url.pathname.split('/')[1]
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v')
    else {
      const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/)
      if (m) id = m[1]
    }
  }
  return id && YT_ID.test(id) ? id : null
}
function localSlugify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '')
}

export const safeUrl = prefer(feUrl?.safeUrl, localSafeUrl)
export const isBlobUrl = prefer(feUrl?.isBlobUrl, localIsBlobUrl)
export const isImageUrl = prefer(feUrl?.isImageUrl, localIsImageUrl)
export const parseYouTubeId = prefer(feYoutube?.parseYouTubeId, localParseYouTubeId)
export const slugify = prefer(feUrl?.slugify || feYoutube?.slugify, localSlugify)

export function cleanText(s, max = 5000) {
  if (s == null) return ''
  return String(s).replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim().slice(0, max)
}
export function extractMentions(text) {
  const out = new Set()
  for (const m of String(text || '').matchAll(/(^|[^a-z0-9_])@([a-z0-9-]{3,40})/gi)) out.add(m[2].toLowerCase())
  return [...out]
}
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
export const emailNorm = (e) => String(e || '').trim().toLowerCase()
export function maskEmail(email) {
  const [user, domain] = String(email || '').split('@')
  if (!domain) return ''
  return `${user.slice(0, 2)}${'*'.repeat(Math.max(1, Math.min(6, user.length - 2)))}@${domain}`
}

/* ── Ajustes (§2.1, §2.2) ─────────────────────────────────────────────── */
export const DEFAULT_LEVEL_NAMES = (Array.isArray(feLevels?.DEFAULT_LEVEL_NAMES) && feLevels.DEFAULT_LEVEL_NAMES.length === 9)
  ? [...feLevels.DEFAULT_LEVEL_NAMES]
  : ['Aprendiz', 'Ayudante', 'Barbero', 'Barbero Pro', 'Fader', 'Estilista', 'Maestro', 'Leyenda', 'Élite']

export const DEFAULT_SETTINGS = Object.freeze({
  group: {
    name: HOST.brand.name, description: '', coverUrl: null, iconUrl: null, initials: HOST.brand.initials, color: HOST.brand.color,
    links: HOST.defaultLinks.map((l) => ({ ...l })),
    rules: [], media: [],
  },
  levels: { names: DEFAULT_LEVEL_NAMES },
  plugins: {
    minPostLevel: null, minChatLevel: null,
    autoDm: { enabled: true, text: '¡Hola #NOMBRE#! Bienvenido a #GRUPO#. Cualquier duda, escríbeme por acá.' },
    welcomeVideoId: null,
  },
  tabs: { comunidad: true, calendario: true, clasificacion: true },
  sync: { enabled: true },
  autoprovision: true,
})

export const DEFAULT_PREFS = Object.freeze({
  tz: 'America/Santiago',
  notif: { push: true, email: true, likes: true, comments: true, mentions: true, follows: true, events: true },
  chat: { enabled: true, previews: false },
  privacy: { hideActivity: false, hideOnline: false },
  onboarding: { dismissed: false, done: [] },
})

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v)
// Mezcla profunda: los arrays y escalares de `patch` reemplazan; los objetos se mezclan.
export function deepMerge(base, patch) {
  const out = Array.isArray(base) ? [...base] : { ...(base || {}) }
  if (!isPlain(patch)) return out
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    out[k] = isPlain(v) && isPlain(out[k]) ? deepMerge(out[k], v) : (isPlain(v) ? deepMerge({}, v) : (Array.isArray(v) ? [...v] : v))
  }
  return out
}
export const mergePrefs = (prefs) => deepMerge(DEFAULT_PREFS, prefs || {})

export function settingsOf(...a) {
  const [state] = withState(a)
  const row = state.academy_settings?.[0]
  return deepMerge(DEFAULT_SETTINGS, row?.settings || {})
}

/* ── Niveles (§4.2) ───────────────────────────────────────────────────── */
const validThresholds = (t) => Array.isArray(t) && t.length === 9 && t.every((n, i) => Number.isFinite(n) && (i === 0 || n > t[i - 1]))
export const LEVEL_THRESHOLDS = validThresholds(feLevels?.LEVEL_THRESHOLDS)
  ? [...feLevels.LEVEL_THRESHOLDS]
  : [0, 5, 20, 65, 155, 515, 2015, 8015, 33015]

export function levelFor(points) {
  const p = Math.max(0, Math.floor(Number(points) || 0))
  let level = 1
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) if (p >= LEVEL_THRESHOLDS[i]) level = i + 1
  const currentMin = LEVEL_THRESHOLDS[level - 1]
  const nextMin = level < LEVEL_THRESHOLDS.length ? LEVEL_THRESHOLDS[level] : null
  return {
    level, points: p, currentMin, nextMin,
    pointsToNext: nextMin == null ? 0 : nextMin - p,
    progress: nextMin == null ? 1 : Math.min(1, (p - currentMin) / (nextMin - currentMin)),
  }
}

// Puntos = likes recibidos de OTROS (un auto-like no suma, §4.2 pointsFor).
export function pointsOf(...a) {
  const [state, memberId, { since } = {}] = withState(a)
  const id = Number(memberId)
  let n = 0
  for (const l of state.academy_likes) {
    if (l.author_id === id && l.member_id !== id && (!since || l.created_at >= since)) n++
  }
  return n
}
export const levelOf = (...a) => { const [state, id] = withState(a); return levelFor(pointsOf(state, id)).level }
export function levelNameOf(...a) {
  const [state, level] = withState(a)
  const names = settingsOf(state).levels?.names || DEFAULT_LEVEL_NAMES
  return names[Math.min(9, Math.max(1, Number(level) || 1)) - 1] || DEFAULT_LEVEL_NAMES[0]
}

/* ── Miembros (§4.3) ──────────────────────────────────────────────────── */
export const memberById = (...a) => { const [state, id] = withState(a); return state.academy_members.find((m) => m.id === Number(id)) || null }
export const memberByHandle = (...a) => { const [state, h] = withState(a); const k = String(h || '').toLowerCase(); return state.academy_members.find((m) => m.handle === k) || null }
export const memberByEmail = (...a) => { const [state, e] = withState(a); const k = emailNorm(e); return state.academy_members.find((m) => m.email_norm === k) || null }
const rowOf = (state, x) => (x && typeof x === 'object' ? (x.row || (x.email_norm !== undefined ? x : memberById(state, x.id ?? x.memberId))) : memberById(state, x))
const idOf = (m) => (m == null ? null : Number(m.memberId ?? m.id))
const roleOf = (m) => m?.role || null

export const isStaff = (m) => ['propietario', 'admin', 'moderador'].includes(roleOf(m))
export const isAdmin = (m) => ['propietario', 'admin'].includes(roleOf(m))

export function isOnline(...a) {
  const [, row] = withState(a)
  return Boolean(row?.last_sync_at && Date.parse(row.last_sync_at) > Date.now() - 90_000)
}

export function memberMini(...a) {
  const [state, x] = withState(a)
  const row = rowOf(state, x)
  if (!row) return null
  return {
    id: row.id, handle: row.handle, name: row.name, avatarUrl: row.avatar_url || null,
    level: levelFor(pointsOf(state, row.id)).level, role: row.role,
  }
}

export function memberPublic(...a) {
  const [state, x, { viewer } = {}] = withState(a)
  const row = rowOf(state, x)
  if (!row) return null
  const prefs = mergePrefs(row.prefs)
  const self = viewer != null && idOf(viewer) === row.id
  const points = pointsOf(state, row.id)
  return {
    id: row.id, handle: row.handle, name: row.name, avatarUrl: row.avatar_url || null,
    level: levelFor(points).level, role: row.role,
    bio: row.bio || null, location: row.location || null, links: row.links || {},
    joinedAt: row.joined_at,
    lastSeenAt: prefs.privacy.hideActivity && !self ? null : (row.last_seen_at || null),
    online: prefs.privacy.hideOnline && !self ? false : isOnline(state, row),
    points,
  }
}

export function cohortIdsOf(...a) {
  const [state, memberId] = withState(a)
  const id = Number(memberId)
  const live = new Set(state.academy_cohorts.filter((c) => !c.archived_at).map((c) => c.id))
  return state.academy_cohort_members.filter((cm) => cm.member_id === id && live.has(cm.cohort_id)).map((cm) => cm.cohort_id)
}

export function activeGrantCourseIds(...a) {
  const [state, memberId] = withState(a)
  const id = Number(memberId)
  return [...new Set(state.academy_grants.filter((g) => g.member_id === id && g.state === 'activa').map((g) => g.course_id))]
}

export function isBlocked(...a) {
  const [state, x, y] = withState(a)
  const p = Number(x); const q = Number(y)
  return state.academy_blocks.some((b) => (b.blocker_id === p && b.blocked_id === q) || (b.blocker_id === q && b.blocked_id === p))
}

export function memberAdmin(...a) {
  const [state, x] = withState(a)
  const row = rowOf(state, x)
  if (!row) return null
  const courseTitle = (id) => state.academy_courses.find((c) => c.id === id)?.title || 'Curso eliminado'
  return {
    ...memberPublic(state, row),
    email: row.email, phone: row.phone || null, status: row.status, source: row.source,
    lastLoginAt: row.last_login_at || null, credentialsSentAt: row.credentials_sent_at || null,
    mustChangePassword: Boolean(row.must_change_password), bannedAt: row.banned_at || null,
    grants: state.academy_grants.filter((g) => g.member_id === row.id)
      .map((g) => ({ id: g.id, courseId: g.course_id, courseTitle: courseTitle(g.course_id), state: g.state, source: g.source })),
    cohorts: state.academy_cohort_members.filter((cm) => cm.member_id === row.id)
      .map((cm) => state.academy_cohorts.find((c) => c.id === cm.cohort_id)).filter(Boolean)
      .map((c) => ({ id: c.id, name: c.name })),
  }
}

export function meOf(...a) {
  const [state, x] = withState(a)
  const row = rowOf(state, x)
  if (!row) return null
  const pub = memberPublic(state, row, { viewer: row })
  const info = levelFor(pub.points)
  const cohorts = cohortIdsOf(state, row.id).map((id) => state.academy_cohorts.find((c) => c.id === id))
    .filter(Boolean).map((c) => ({ id: c.id, name: c.name, chatId: c.chat_id ?? null }))
  return {
    ...pub,
    email: row.email, prefs: mergePrefs(row.prefs), mustChangePassword: Boolean(row.must_change_password),
    cohorts, courseIds: activeGrantCourseIds(state, row.id),
    isOwner: row.role === 'propietario', isAdmin: isAdmin(row), isModerator: isStaff(row),
    points: pub.points, levelInfo: { ...info, name: levelNameOf(state, info.level) },
  }
}

/* ── Acceso a cursos y lecciones (§5.2) ───────────────────────────────── */
const courseOf = (state, c) => (c && typeof c === 'object' ? c : state.academy_courses.find((x) => x.id === Number(c) || x.slug === c) || null)

export function canAccessCourse(...a) {
  const [state, member, c] = withState(a)
  const course = courseOf(state, c)
  if (!course) return { ok: false, reason: 'borrador' }
  if (isAdmin(member)) return { ok: true, reason: null }
  if (!course.published) return { ok: false, reason: 'borrador' }
  const mid = idOf(member)
  if (mid == null) return { ok: false, reason: course.access === 'nivel' ? 'nivel' : 'compra' }
  if (course.access === 'abierto') return { ok: true, reason: null }
  const granted = state.academy_grants.some((g) => g.member_id === mid && g.course_id === course.id && g.state === 'activa')
  if (granted) return { ok: true, reason: null }
  if (course.access === 'nivel') {
    return levelFor(pointsOf(state, mid)).level >= Number(course.unlock_level || 99) ? { ok: true, reason: null } : { ok: false, reason: 'nivel' }
  }
  return { ok: false, reason: 'compra' }
}

// Orden de lectura: secciones por posición (sus lecciones por posición) y al
// final las lecciones sin sección, igual que la barra lateral de la lección.
export function orderedLessons(...a) {
  const [state, courseId, { includeDrafts = false } = {}] = withState(a)
  const cid = Number(courseId)
  const byPos = (x, y) => (x.position - y.position) || (x.id - y.id)
  const sections = state.academy_sections.filter((s) => s.course_id === cid).sort(byPos)
  const lessons = state.academy_lessons.filter((l) => l.course_id === cid && (includeDrafts || l.published))
  const out = []
  for (const s of sections) out.push(...lessons.filter((l) => l.section_id === s.id).sort(byPos))
  const known = new Set(sections.map((s) => s.id))
  out.push(...lessons.filter((l) => l.section_id == null || !known.has(l.section_id)).sort(byPos))
  return out
}

export function canAccessLesson(...a) {
  const [state, member, l] = withState(a)
  const lesson = l && typeof l === 'object' ? l : state.academy_lessons.find((x) => x.id === Number(l))
  if (!lesson) return false
  const course = courseOf(state, lesson.course_id)
  if (!canAccessCourse(state, member, course).ok) return false
  return Boolean(lesson.published) || isAdmin(member)
}

/* ── Visibilidad de comunidad y eventos (§5.3, §5.5) ─────────────────── */
export function canSeePost(...a) {
  const [state, member, p] = withState(a)
  const post = p && typeof p === 'object' ? p : state.academy_posts.find((x) => x.id === Number(p))
  if (!post || post.deleted_at) return false
  const cat = post.category_id == null ? null : state.academy_categories.find((c) => c.id === post.category_id)
  if (!cat || cat.cohort_id == null) return true
  if (isStaff(member)) return true
  const mid = idOf(member)
  return mid != null && cohortIdsOf(state, mid).includes(Number(cat.cohort_id))
}

export function eventLockReason(...a) {
  const [state, member, event, opts = {}] = withState(a)
  const access = event?.access || { type: 'todos' }
  if (!access.type || access.type === 'todos' || isStaff(member)) return null
  const mid = idOf(member)
  if (access.type === 'nivel') {
    const level = opts.level ?? (mid == null ? 1 : levelOf(state, mid))
    return level >= Number(access.level || 1) ? null : 'nivel'
  }
  if (access.type === 'grupo') {
    const ids = opts.cohortIds ?? (mid == null ? [] : cohortIdsOf(state, mid))
    return ids.includes(Number(access.cohortId)) ? null : 'grupo'
  }
  return null
}
export const canSeeEvent = (...a) => eventLockReason(...a) === null

/* ── Notificaciones (§5.3, §8.1) ──────────────────────────────────────── */
const NOTIF_FAMILY = { like: 'likes', comentario: 'comments', respuesta: 'comments', actividad: 'comments', mencion: 'mentions', seguidor: 'follows', post_seguido: 'follows', evento: 'events' }

export function notify(...a) {
  const [state, n] = withState(a)
  const memberId = Number(n?.memberId)
  const target = memberById(state, memberId)
  if (!target || target.status !== 'activo' || target.deleted_at) return null
  if (n.actorId != null && Number(n.actorId) === memberId) return null
  if (n.actorId != null && isBlocked(state, memberId, n.actorId)) return null
  const family = NOTIF_FAMILY[n.kind]
  if (family && mergePrefs(target.prefs).notif[family] === false) return null
  if (n.groupKey) {
    const open = state.academy_notifications.find((r) => r.member_id === memberId && r.group_key === n.groupKey && !r.read_at)
    if (open) {
      Object.assign(open, { actor_id: n.actorId ?? open.actor_id, preview: n.preview ?? open.preview, created_at: nowIso() })
      return open
    }
  }
  const row = {
    id: nextId(state, 'academy_notifications'), member_id: memberId, kind: String(n.kind),
    actor_id: n.actorId == null ? null : Number(n.actorId), target_type: n.targetType || null,
    target_id: n.targetId == null ? null : Number(n.targetId), parent_id: n.parentId == null ? null : Number(n.parentId),
    preview: n.preview == null ? null : String(n.preview).slice(0, 200), group_key: n.groupKey || null,
    read_at: null, created_at: nowIso(),
  }
  state.academy_notifications.push(row)
  return row
}
export function notifyMany(...a) {
  const [state, ids, payload] = withState(a)
  return [...new Set((ids || []).map(Number))].map((memberId) => notify(state, { ...payload, memberId })).filter(Boolean)
}

export function notificationText(kind, actorName, extra = {}) {
  const who = actorName || 'Alguien'
  const more = Number(extra.others) > 0 ? ` y ${extra.others} más` : ''
  const what = extra.targetType === 'comment' ? 'tu comentario' : 'tu publicación'
  switch (kind) {
    case 'like': return more ? `A ${who}${more} les gustó ${what}` : `A ${who} le gustó ${what}`
    case 'comentario': return `${who} comentó en tu publicación`
    case 'respuesta': return `${who} respondió tu comentario`
    case 'mencion': return `${who} te mencionó`
    case 'post_seguido': return `${who} (siguiendo) publicó`
    case 'actividad': return 'Hay actividad nueva en una publicación que sigues'
    case 'anuncio': return `${who} publicó un anuncio`
    case 'seguidor': return `${who} empezó a seguirte`
    case 'evento': return extra.text || `Próximo evento: ${extra.title || 'evento'}`
    case 'nivel': return `¡Subiste al Nivel ${extra.level || ''}${extra.levelName ? ` · ${extra.levelName}` : ''}!`
    case 'bienvenida': return `¡Bienvenido a ${extra.groupName || HOST.brand.name}!`
    case 'curso': return `Tienes acceso a ${extra.courseTitle || 'un curso nuevo'}`
    case 'grupo': return `Te agregaron al grupo ${extra.cohortName || ''}`.trim()
    case 'reporte': return 'Nuevo reporte de contenido'
    case 'miembro_nuevo': return `${who} se unió a la Academy`
    default: return 'Tienes una notificación nueva'
  }
}

export function routeFor(...a) {
  // Tolera la firma real routeFor({targetType,...}) sin estado.
  const hasState = isState(a[0])
  const state = hasState ? a[0] : CURRENT
  const { targetType, targetId, parentId, extra = {} } = (hasState ? a[1] : a[0]) || {}
  const id = Number(targetId)
  switch (targetType) {
    case 'post': return `${HOST.base}/comunidad/${id}`
    case 'comment': {
      const c = state?.academy_comments.find((x) => x.id === id)
      if (c?.lesson_id) {
        const lesson = state.academy_lessons.find((l) => l.id === c.lesson_id)
        const course = lesson && state.academy_courses.find((k) => k.id === lesson.course_id)
        if (lesson && course) return `${HOST.base}/cursos/${course.slug}/${lesson.slug}`
      }
      const postId = parentId ?? c?.post_id
      return postId ? `${HOST.base}/comunidad/${Number(postId)}` : `${HOST.base}/comunidad`
    }
    case 'lesson': {
      const lesson = state?.academy_lessons.find((l) => l.id === id)
      const course = lesson && state.academy_courses.find((k) => k.id === lesson.course_id)
      if (lesson && course) return `${HOST.base}/cursos/${course.slug}/${lesson.slug}`
      return extra.courseSlug && extra.lessonSlug ? `${HOST.base}/cursos/${extra.courseSlug}/${extra.lessonSlug}` : `${HOST.base}/cursos`
    }
    case 'curso': {
      const course = state?.academy_courses.find((k) => k.id === id)
      return course ? `${HOST.base}/cursos/${course.slug}` : `${HOST.base}/cursos`
    }
    case 'event': return `${HOST.base}/calendario?evento=${id}`
    case 'miembro': {
      const m = state && memberById(state, id)
      return m?.handle ? `${HOST.base}/perfil/${m.handle}` : (extra.handle ? `${HOST.base}/perfil/${extra.handle}` : `${HOST.base}/miembros`)
    }
    case 'chat': return `${HOST.base}/chat/${id}`
    case 'grupo': return `${HOST.base}/grupos/${id}`
    default: return `${HOST.base}/comunidad`
  }
}

/* ── Correo simulado ──────────────────────────────────────────────────── */
// Nada sale a Resend: queda en state.outbox (GET /api/__mock/outbox) y en la
// consola del dev server, que es donde se lee la contraseña temporal.
export function outbox(...a) {
  const [state, entry] = withState(a)
  const row = { id: nextId(state, 'outbox'), createdAt: nowIso(), ...entry }
  state.outbox.unshift(row)
  const extra = entry.data?.tempPassword ? ` · contraseña temporal ${entry.data.tempPassword}` : (entry.data?.url ? ` · ${entry.data.url}` : '')
  console.log(`  ✉ Mock Academy · ${entry.kind} → ${entry.to}${extra}`)
  return row
}

/* ── Sesiones del mock ────────────────────────────────────────────────── */
/* Formatos (SPEC §13): miembro 'mockm.<id>.<ts>', barbero 'mockb.<id>.<ts>'
   o el 'dev-token' del respaldo local de BarberLogin. El mapa
   state.mock.sessions guarda sv/pwc/exp de cada token emitido para imitar
   session_version (cerrar sesión en todos lados, cambio de contraseña) y el
   token corto de "debes crear tu contraseña". Un token que no está en el mapa
   (quedó en localStorage de antes de reiniciar el mock) se acepta con la
   versión vigente: en desarrollo no vale la pena desloguear por un reinicio. */
export const MEMBER_TTL = 30 * DAY
export const PWC_TTL = 15 * MIN

export function issueMemberToken(...a) {
  const [state, row, { pwc } = {}] = withState(a)
  const ts = Date.now()
  let token = `mockm.${row.id}.${ts}`
  while (state.mock.sessions.has(token)) token = `mockm.${row.id}.${ts + Math.floor(Math.random() * 1000) + 1}`
  const isPwc = pwc ?? Boolean(row.must_change_password)
  state.mock.sessions.set(token, { memberId: row.id, sv: row.session_version, pwc: isPwc, iat: ts, exp: ts + (isPwc ? PWC_TTL : MEMBER_TTL) })
  return token
}

export function readBearer(req) {
  const h = String(req?.headers?.authorization || '')
  const m = h.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : ''
}

// → {kind:'member', memberId, sv, pwc, iat, exp} | {kind:'barber', barberId, legacy} | null
export function resolveToken(...a) {
  const [state, token] = withState(a)
  if (!token) return null
  if (token === 'dev-token') return { kind: 'barber', barberId: state.barbers[0]?.id ?? 1, legacy: true }
  let m = token.match(/^mockb\.(\d+)\.(\d+)$/)
  if (m) return { kind: 'barber', barberId: Number(m[1]), legacy: false }
  // El token del panel de OTRO mock del repo (MOCK_HOST.panelBarberId).
  const hostBarber = typeof HOST.panelBarberId === 'function' ? HOST.panelBarberId(token) : null
  if (Number.isInteger(hostBarber)) return { kind: 'barber', barberId: hostBarber, legacy: false }
  m = token.match(/^mockm\.(\d+)\.(\d+)$/)
  if (!m) return null
  const known = state.mock.sessions.get(token)
  if (known) return { kind: 'member', ...known }
  const row = memberById(state, Number(m[1]))
  const iat = Number(m[2])
  return { kind: 'member', memberId: Number(m[1]), sv: row?.session_version ?? 0, pwc: Boolean(row?.must_change_password), iat, exp: iat + MEMBER_TTL }
}

/* ── Tabla de modos (§5, §16 MODE_OWNERS) ─────────────────────────────── */
const G = ['GET']
const P = ['POST']
const def = (file, auth, methods) => ({ file, auth, methods })
export const MODES = Object.freeze({
  // _academyAccount.js
  login: def('core', 'public', P), 'password-change': def('core', 'pwc', P),
  'password-reset-request': def('core', 'public', P), 'password-reset-confirm': def('core', 'public', P),
  me: def('core', 'pwc', G), 'me-update': def('core', 'member', P), 'email-change': def('core', 'member', P),
  'email-change-confirm': def('core', 'public', P), 'logout-all': def('core', 'pwc', P), 'me-export': def('core', 'member', G),
  'me-delete': def('core', 'member', P), about: def('core', 'public', G), 'owner-session': def('core', 'owner', P),
  idle: def('core', 'member', P),
  // _academyCourses.js
  courses: def('core', 'member', G), course: def('core', 'member', G), lesson: def('core', 'member', G),
  'lesson-progress': def('core', 'member', P), catalog: def('core', 'public', G), 'admin-courses': def('core', 'admin', G),
  'admin-course-save': def('core', 'admin', P), 'admin-course-delete': def('core', 'admin', P),
  'admin-section-save': def('core', 'admin', P), 'admin-section-delete': def('core', 'admin', P),
  'admin-lesson-save': def('core', 'admin', P), 'admin-lesson-delete': def('core', 'admin', P),
  'admin-reorder': def('core', 'admin', P), 'admin-seed': def('core', 'admin', P), upload: def('core', 'member', P),
  // _academyAdmin.js
  'admin-members': def('core', 'admin', G), 'admin-invite': def('core', 'admin', P), 'admin-member-update': def('core', 'admin', P),
  'admin-resend-access': def('core', 'admin', P), 'admin-password-link': def('core', 'admin', P), 'admin-grant': def('core', 'admin', P),
  'admin-revoke': def('core', 'admin', P), 'admin-orders': def('core', 'admin', G), 'admin-verify-order': def('core', 'admin', P),
  'admin-import-grant': def('core', 'admin', P), 'admin-settings': def('core', 'admin', ['GET', 'POST']), 'admin-stats': def('core', 'admin', G),
  // _academyCommunity.js
  feed: def('community', 'member', G), post: def('community', 'member', G), 'post-save': def('community', 'member', P),
  'post-delete': def('community', 'member', P), 'comment-save': def('community', 'member', P), 'comment-delete': def('community', 'member', P),
  'lesson-comments': def('community', 'member', G), like: def('community', 'member', P), 'poll-vote': def('community', 'member', P),
  follow: def('community', 'member', P), report: def('community', 'member', P), members: def('community', 'member', G),
  member: def('community', 'member', G), leaderboard: def('community', 'member', G), search: def('community', 'member', G),
  'group-card': def('community', 'member', G), 'admin-category-save': def('community', 'admin', P),
  'admin-category-delete': def('community', 'admin', P), 'admin-pin': def('community', 'admin', P),
  'admin-post-moderate': def('community', 'mod', P), 'admin-reports': def('community', 'mod', G),
  'admin-report-resolve': def('community', 'mod', P),
  // _academyNotify.js (en el mock, dentro de academy-community.mjs)
  notifications: def('community', 'member', G), 'notifications-read': def('community', 'member', P),
  // _academyChat.js
  chats: def('chat', 'member', G), chat: def('chat', 'member', G), 'chat-start': def('chat', 'member', P),
  'chat-send': def('chat', 'member', P), 'chat-read': def('chat', 'member', P), 'chats-read-all': def('chat', 'member', P),
  'chat-mute': def('chat', 'member', P), 'chat-mark-unread': def('chat', 'member', P), block: def('chat', 'member', P),
  blocks: def('chat', 'member', G), sync: def('chat', 'member', G), 'push-subscribe': def('chat', 'member', P),
  'push-unsubscribe': def('chat', 'pwc', P), cohorts: def('chat', 'member', G), cohort: def('chat', 'member', G),
  file: def('chat', 'member', G), 'admin-cohort-save': def('chat', 'admin', P), 'admin-cohort-members': def('chat', 'admin', P),
  'admin-cohort-archive': def('chat', 'admin', P),
  // _academyEvents.js
  events: def('events', 'member', G), event: def('events', 'member', G),
  'admin-event-save': def('events', 'mod', P), 'admin-event-delete': def('events', 'mod', P),
})

/* ── ctx y puertas de acceso (§3.4, §3.5) ─────────────────────────────── */
export function buildCtx({ state, req, res, mode, query = {}, body = {}, ip = '127.0.0.1' }) {
  const token = readBearer(req)
  return {
    state, st: state, mode, method: String(req?.method || 'GET').toUpperCase(), req, res,
    query, q: query, body, ip, token, now: new Date(),
    member: null, admin: null, barber: null,
    log: (...args) => console.log(`  [mock:${mode}]`, ...args),
  }
}

const authError = () => new HttpError(401, 'Sesión de Academy requerida', 'auth')

function memberFromToken(ctx, { allowPwc }) {
  const { state } = ctx
  const tok = resolveToken(state, ctx.token)
  if (!tok || tok.kind !== 'member') throw authError()
  const row = memberById(state, tok.memberId)
  if (!row || row.status !== 'activo' || row.deleted_at || row.session_version !== tok.sv || Date.now() > tok.exp) throw authError()
  if ((row.must_change_password || tok.pwc) && !allowPwc) {
    throw new HttpError(403, 'Tienes que crear tu contraseña para seguir.', 'password_change_required')
  }
  ctx.tokenInfo = tok
  ctx.member = {
    id: row.id, role: row.role, status: row.status, sessionVersion: row.session_version,
    mustChangePassword: Boolean(row.must_change_password || tok.pwc), name: row.name, handle: row.handle,
    prefs: mergePrefs(row.prefs), lastSeenAt: row.last_seen_at || null, row,
  }
  return ctx.member
}

function barberFromToken(ctx) {
  const tok = resolveToken(ctx.state, ctx.token)
  if (!tok || tok.kind !== 'barber') return null
  const b = ctx.state.barbers.find((x) => x.id === tok.barberId) || null
  if (!b || !b.admin) return null
  ctx.barber = { id: b.id, name: b.name, admin: true, legacy: tok.legacy }
  return ctx.barber
}

function staffGate(ctx, roles) {
  const tok = resolveToken(ctx.state, ctx.token)
  if (!tok) throw authError()
  if (tok.kind === 'member') {
    const m = memberFromToken(ctx, { allowPwc: false })
    if (!roles.includes(m.role)) throw new HttpError(403, 'No tienes permiso para hacer esto.', 'forbidden')
    ctx.admin = { memberId: m.id, barberId: m.row.barber_id ?? null, role: m.role }
    return
  }
  const b = barberFromToken(ctx)
  if (!b) throw new HttpError(403, 'Solo un administrador puede hacer esto.', 'forbidden')
  const owner = ctx.state.academy_members.find((m) => m.barber_id === b.id && ['propietario', 'admin'].includes(m.role) && !m.deleted_at)
  ctx.admin = { memberId: owner?.id ?? null, barberId: b.id, role: owner?.role === 'propietario' ? 'propietario' : 'admin' }
}

// Aplica la puerta del modo; lanza HttpError si no pasa. Deja ctx.member / ctx.admin / ctx.barber.
export function gate(ctx, auth) {
  switch (auth) {
    case 'public': return
    case 'member': memberFromToken(ctx, { allowPwc: false }); return
    case 'pwc': memberFromToken(ctx, { allowPwc: true }); return
    case 'admin': staffGate(ctx, ['propietario', 'admin']); return
    case 'mod': staffGate(ctx, ['propietario', 'admin', 'moderador']); return
    case 'owner': {
      const tok = resolveToken(ctx.state, ctx.token)
      if (!tok) throw authError()
      const b = barberFromToken(ctx)
      if (!b) throw new HttpError(403, 'Esto se abre desde el panel del administrador.', 'forbidden')
      ctx.admin = { memberId: null, barberId: b.id, role: 'propietario' }
      return
    }
    default: throw new HttpError(500, `Puerta desconocida: ${auth}`)
  }
}

// Hash de "token de un solo uso" (reset / cambio de correo), igual que el real:
// en la tabla solo queda el SHA-256, nunca el token.
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
