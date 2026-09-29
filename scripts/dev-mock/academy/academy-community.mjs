/* Mock de Academy — Comunidad + Notificaciones (SPEC §5.3).

   Espejo de api/_academyCommunity.js y api/_academyNotify.js: feed,
   publicaciones, comentarios (dos niveles), me gusta, encuestas, seguir,
   reportes, Miembros, perfil, Clasificación, búsqueda, tarjeta del grupo,
   categorías, fijar/moderar y la campana de notificaciones.

   Lo importante no son los datos sino las REGLAS: una publicación de una
   categoría privada de un Grupo, una borrada o un comentario de una lección
   bloqueada no se ve acá tampoco, así un intento de IDOR se puede probar en
   dev (`npm run dev:mock`) y da lo mismo que en producción (404/403 con el
   mismo código).

   Solo Node: lo carga scripts/dev-mock/index.mjs (nunca src/). El estado
   vive en ctx.state con los nombres de columna del DDL (§2) y las
   respuestas van en camelCase como las del backend real; el router del mock
   envuelve el objeto que devolvemos en `{ ok:true, ... }`.

   Las ayudas genéricas (errores, fechas sin milisegundos, zona horaria,
   texto, ajustes) se exportan desde acá para que academy-chat.mjs y
   academy-events.mjs no las dupliquen (y no haya imports circulares: este
   archivo no importa a los otros dos). */

// Ayudas compartidas del mock (MOCK-CORE): proyecciones de miembro, niveles,
// visibilidad, notify, ids, y las reglas de URL/YouTube que ya prefieren las
// de src/academy (SPEC §13). Si el router pasa `ctx.lib`, se usa ese; si no,
// este mismo módulo. `import *` no revienta si algún día falta un nombre:
// para las reglas de texto hay copia local de respaldo más abajo.
import * as LIB from './lib.mjs'

// El lib vigente para este ctx.
export const L = (ctx) => ctx?.lib || LIB

export const SANTIAGO = 'America/Santiago'
const DAY = 86400000
const PAGE_FEED = 20
const PAGE_MEMBERS = 30
const PAGE_NOTIF = 20
const ONLINE_MS = 90_000
const MAX_CATEGORIES = 10
const MAX_PINNED = 3

/* ══ Ayudas genéricas (exportadas) ═════════════════════════════════════════ */

// Error con el mismo contrato que el backend: el router lo traduce a
// `{ok:false, error, code}` con ese status.
export function fail(ctx, status, message, code, extra) {
  const E = L(ctx).HttpError || ctx?.HttpError
  if (typeof E === 'function') throw new E(status, message, code, extra)
  const err = new Error(message)
  err.status = status
  err.code = code
  err.extra = extra
  throw err
}

// Tabla del estado como arreglo (si un fixture no la trae, nace vacía).
export function rows(state, table) {
  if (!Array.isArray(state[table])) state[table] = []
  return state[table]
}

// Borra filas EN el mismo arreglo (no lo reemplaza): así nadie que tenga
// una referencia a state.<tabla> queda mirando una copia vieja.
export function removeWhere(state, table, pred) {
  const list = rows(state, table)
  let n = 0
  for (let i = list.length - 1; i >= 0; i--) {
    if (pred(list[i])) { list.splice(i, 1); n++ }
  }
  return n
}

export function toInt(v) {
  if (v == null || v === '' || typeof v === 'boolean') return null
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  return Number.isSafeInteger(n) ? n : null
}

export function toBool(v, dflt = false) {
  if (v === undefined || v === null) return dflt
  if (typeof v === 'string') return v === 'true' || v === '1'
  return !!v
}

export const has = (obj, key) => !!obj && Object.prototype.hasOwnProperty.call(obj, key)

export function msOf(v) {
  if (v == null || v === '') return null
  const t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v)
  return Number.isFinite(t) ? t : null
}

// Fechas en JSON SIEMPRE sin milisegundos (Safari/iOS, SPEC §0.7).
export function toIso(v) {
  const t = msOf(v)
  return t == null ? null : new Date(Math.floor(t / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function nowIso(ctx) {
  const v = typeof L(ctx).nowIso === 'function' ? L(ctx).nowIso() : null
  return toIso(v) || toIso(Date.now())
}

// El contador lo lleva lib.nextId (state.seq.<tabla>); el respaldo solo
// existe por si alguien llama estas ayudas sin lib.
export function nextIdOf(ctx, table) {
  if (typeof L(ctx).nextId === 'function') return L(ctx).nextId(ctx.state, table)
  const st = ctx.state
  if (!st.seq) st.seq = {}
  const max = rows(st, table).reduce((a, r) => Math.max(a, Number(r.id) || 0), 0)
  st.seq[table] = Math.max(Number(st.seq[table]) || 0, max) + 1
  return st.seq[table]
}

export const cut = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

// Mismo criterio que cleanText del backend: sin caracteres de control
// (salvo \n), sin más de dos líneas en blanco seguidas, recortado.
export function cleanText(s, max = 5000) {
  if (s == null) return ''
  let t = String(s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
  t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim()
  return t.length > max ? t.slice(0, max).trim() : t
}

export function extractMentions(text) {
  const out = new Set()
  const re = /(^|[^A-Za-z0-9_@.-])@([a-z0-9-]{3,40})(?![a-z0-9-])/gi
  let m
  const s = String(text || '')
  while ((m = re.exec(s)) && out.size < 10) out.add(m[2].toLowerCase())
  return [...out]
}

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function viaLib(fn, fallback, arg) {
  if (typeof fn === 'function') {
    try { return fn(arg) } catch { /* algo del navegador: cae a la copia local */ }
  }
  return fallback(arg)
}

function localSafeUrl(u) {
  if (typeof u !== 'string') return null
  const s = u.trim()
  if (!s || s.length > 2000 || /[\s\\<>"]/.test(s)) return null
  if (s.startsWith('/')) {
    if (s.startsWith('//')) return null
    return /^\/(academy\/|assets\/|reservar(?:[/?#]|$))/.test(s) ? s : null
  }
  let url
  try { url = new URL(s) } catch { return null }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!url.hostname || url.username || url.password) return null
  url.protocol = 'https:'
  return url.toString()
}

function localIsBlob(u) {
  try {
    const url = new URL(String(u))
    return url.protocol === 'https:' && url.hostname.endsWith('.public.blob.vercel-storage.com')
  } catch { return false }
}

function localIsImageUrl(u) {
  if (typeof u !== 'string') return false
  const s = u.trim()
  if (localIsBlob(s)) return true
  return /^\/assets\/[A-Za-z0-9._\-/]+$/.test(s) && !s.includes('..') && !s.includes('//')
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/
function localParseYouTubeId(input) {
  if (typeof input !== 'string') return null
  const s = input.trim()
  if (YT_ID.test(s)) return s
  let url
  try { url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`) } catch { return null }
  const host = url.hostname.replace(/^(www|m|music)\./, '')
  let id = null
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0]
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v')
    else {
      const m = url.pathname.match(/^\/(embed|shorts|live|v)\/([^/?#]+)/)
      if (m) id = m[2]
    }
  }
  return id && YT_ID.test(id) ? id : null
}

export const safeUrl = (u) => viaLib(LIB.safeUrl, localSafeUrl, u) || null
export const isImageUrl = (u) => !!viaLib(LIB.isImageUrl, localIsImageUrl, u)
export const parseYouTubeId = (u) => {
  const id = viaLib(LIB.parseYouTubeId, localParseYouTubeId, u)
  return typeof id === 'string' && YT_ID.test(id) ? id : null
}

/* ── Ajustes del grupo (SPEC §2.2, con defaults) ── */
export const DEFAULT_LEVEL_NAMES = ['Aprendiz', 'Ayudante', 'Barbero', 'Barbero Pro', 'Fader', 'Estilista', 'Maestro', 'Leyenda', 'Élite']
const DEFAULT_SETTINGS = {
  group: {
    name: LIB.HOST.brand.name, description: '', coverUrl: null, iconUrl: null, initials: LIB.HOST.brand.initials, color: LIB.HOST.brand.color,
    links: LIB.HOST.defaultLinks.map((l) => ({ ...l })), rules: [], media: [],
  },
  levels: { names: DEFAULT_LEVEL_NAMES },
  plugins: { minPostLevel: null, minChatLevel: null, autoDm: { enabled: true, text: '¡Hola #NOMBRE#! Bienvenido a #GRUPO#. Cualquier duda, escríbeme por acá.' }, welcomeVideoId: null },
  tabs: { comunidad: true, calendario: true, clasificacion: true },
  sync: { enabled: true },
  autoprovision: true,
}

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
function deepMerge(base, extra) {
  if (!isPlain(extra)) return base
  for (const [k, v] of Object.entries(extra)) {
    base[k] = isPlain(v) && isPlain(base[k]) ? deepMerge({ ...base[k] }, v) : v
  }
  return base
}

export function settingsOf(state) {
  let raw = rows(state, 'academy_settings')[0]?.settings
  if (typeof raw === 'string') { try { raw = JSON.parse(raw) } catch { raw = {} } }
  return deepMerge(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), raw || {})
}

export function levelNameFor(state, level) {
  const names = settingsOf(state).levels?.names
  return (Array.isArray(names) && names[level - 1]) || DEFAULT_LEVEL_NAMES[level - 1] || `Nivel ${level}`
}

// Umbrales sacados del mismo levelFor que usa el resto del mock (así no hay
// dos tablas que puedan separarse); el arreglo fijo es el de SPEC §4.2.
export function levelThresholds(ctx) {
  const out = [0]
  let p = 0
  for (let i = 0; i < 12 && out.length < 9; i++) {
    const info = L(ctx).levelFor?.(p)
    if (!info || info.nextMin == null || info.nextMin <= p) break
    out.push(info.nextMin)
    p = info.nextMin
  }
  return out.length === 9 ? out : [0, 5, 20, 65, 155, 515, 2015, 8015, 33015]
}

/* ── Miembros, roles y bloqueos ── */
const STAFF_ROLES = ['propietario', 'admin', 'moderador']
const ADMIN_ROLES = ['propietario', 'admin']

export const memberRow = (state, id) => (id == null ? null : rows(state, 'academy_members').find((m) => m.id === Number(id)) || null)
export const isActive = (m) => !!m && m.status === 'activo' && !m.deleted_at
export const staffRow = (row) => !!row && STAFF_ROLES.includes(row.role)
export const adminRow = (row) => !!row && ADMIN_ROLES.includes(row.role)
// ctx.admin lo arma el router para modos admin/mod (también por token de
// barbero, sin fila de miembro); un moderador nunca cuenta como admin.
export const ctxIsStaff = (ctx) => !!ctx.admin || staffRow(ctx.member)
export const ctxIsAdmin = (ctx) => (!!ctx.admin && ctx.admin.role !== 'moderador') || adminRow(ctx.member)
export const actorId = (ctx) => ctx.member?.id ?? ctx.admin?.memberId ?? null

export function needMember(ctx) {
  if (!ctx.member) fail(ctx, 401, 'Sesión de Academy requerida', 'auth')
  return ctx.member
}
export function needStaff(ctx) {
  if (!ctxIsStaff(ctx)) fail(ctx, 403, 'No tienes permiso para hacer esto', 'forbidden')
}
export function needAdmin(ctx) {
  if (!ctxIsAdmin(ctx)) fail(ctx, 403, 'No tienes permiso para hacer esto', 'forbidden')
}

export const pointsOfM = (ctx, id) => Number(L(ctx).pointsOf(ctx.state, id)) || 0
export const levelOfM = (ctx, id) => L(ctx).levelFor(pointsOfM(ctx, id))?.level || 1
export const mini = (ctx, id) => (id == null ? null : L(ctx).memberMini(ctx.state, id) || null)
// Grupos vigentes del miembro (el lib excluye los archivados): la misma
// lista que usan canSeePost y canSeeEvent, para que categorías, posts y
// eventos privados digan lo mismo.
export function cohortIdsOfM(ctx, memberId) {
  if (typeof L(ctx).cohortIdsOf === 'function') return L(ctx).cohortIdsOf(ctx.state, memberId) || []
  const live = new Set(rows(ctx.state, 'academy_cohorts').filter((c) => !c.archived_at).map((c) => c.id))
  return rows(ctx.state, 'academy_cohort_members').filter((r) => r.member_id === memberId && live.has(r.cohort_id)).map((r) => r.cohort_id)
}

// Proyecciones del lib. memberPublic recibe `{viewer}` como opciones; el
// objeto lleva además id/role del que mira, por si alguna versión lo
// espera como fila (así sirve para las dos firmas).
const viewerOpt = (viewer) => (viewer ? { viewer, id: viewer.id, memberId: viewer.id, role: viewer.role } : {})
export const publicOf = (ctx, id, viewer) => L(ctx).memberPublic(ctx.state, id, viewerOpt(viewer)) || null
export const adminOf = (ctx, id, viewer) => L(ctx).memberAdmin(ctx.state, id, viewerOpt(viewer)) || null

export const isBlocked = (state, a, b) =>
  rows(state, 'academy_blocks').some((r) => (r.blocker_id === a && r.blocked_id === b) || (r.blocker_id === b && r.blocked_id === a))

// "En línea" = sync en los últimos 90 s, salvo que el miembro lo oculte.
export const isOnline = (m) => isActive(m) && !m.prefs?.privacy?.hideOnline && (msOf(m.last_sync_at) || 0) > Date.now() - ONLINE_MS

// Reglas de chat directo compartidas por `member.canChat`, chat-start y
// chat-send. null = se puede. El bloqueo da un 403 genérico a propósito
// (no revela quién bloqueó a quién).
export function dmBlockReason(ctx, me, other) {
  const st = ctx.state
  const generic = { status: 403, message: 'No puedes chatear con este miembro', code: 'forbidden' }
  if (!me || !other || !isActive(other) || other.id === me.id) return generic
  if (isBlocked(st, me.id, other.id)) return generic
  if (other.prefs?.chat?.enabled === false) return { status: 403, message: `${other.name} tiene el chat apagado`, code: 'chat_off' }
  if (me.prefs?.chat?.enabled === false) return { status: 403, message: 'Tienes el chat apagado. Actívalo en Ajustes', code: 'chat_off' }
  const min = toInt(settingsOf(st).plugins?.minChatLevel)
  // Con el staff siempre se puede hablar: si no, el AutoDM de bienvenida
  // ("escríbeme por acá") llegaría a alguien que no puede contestarlo.
  if (min && !staffRow(me) && !staffRow(other) && levelOfM(ctx, me.id) < min) {
    return { status: 403, message: `Necesitas llegar al nivel ${min} para chatear`, code: 'level' }
  }
  return null
}

/* ── Zona horaria sin librerías (Intl), igual que AT TIME ZONE ── */
const DTF = new Map()
function dtf(tz) {
  let f = DTF.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    })
    DTF.set(tz, f)
  }
  return f
}

export function validTz(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false
  try { dtf(tz); return true } catch { return false }
}

// Hora de pared de un instante en `tz`.
export function wallParts(ms, tz) {
  const p = {}
  for (const { type, value } of dtf(tz).formatToParts(new Date(ms))) p[type] = value
  return { y: +p.year, m: +p.month, d: +p.day, H: +p.hour % 24, M: +p.minute, S: +p.second }
}

export function tzOffsetMs(ms, tz) {
  const w = wallParts(ms, tz)
  return Date.UTC(w.y, w.m - 1, w.d, w.H, w.M, w.S) - Math.floor(ms / 1000) * 1000
}

// Hora de pared en `tz` → instante UTC, resolviendo los cambios de horario
// como Postgres: en el hueco (se adelanta el reloj) usa el offset de ANTES
// del cambio; en la hora repetida (se atrasa) usa el de DESPUÉS.
export function wallToUtc(y, m, d, H, M, S, tz) {
  const guess = Date.UTC(y, m - 1, d, H, M, S)
  const before = tzOffsetMs(guess - 36 * 3600e3, tz)
  const after = tzOffsetMs(guess + 36 * 3600e3, tz)
  const offsets = [...new Set([before, tzOffsetMs(guess, tz), after])]
  const valid = offsets.map((o) => guess - o).filter((t) => tzOffsetMs(t, tz) === guess - t)
  if (valid.length === 1) return valid[0]
  if (valid.length > 1) return guess - after
  return guess - before
}

// Días desde 1970 para una fecha local (aritmética de calendario sin DST).
export const dayNum = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / DAY)
export function dayParts(n) {
  const dt = new Date(n * DAY)
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }
}
export const isoWeekday = (n) => ((new Date(n * DAY).getUTCDay() + 6) % 7) + 1
export const dayKey = (n) => new Date(n * DAY).toISOString().slice(0, 10)
export function dayOfKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''))
  if (!m) return null
  const n = dayNum(+m[1], +m[2], +m[3])
  return dayKey(n) === key ? n : null
}
export function dayOfInstant(ms, tz) {
  const w = wallParts(ms, tz)
  return dayNum(w.y, w.m, w.d)
}
export const startOfDay = (n, tz) => {
  const p = dayParts(n)
  return wallToUtc(p.y, p.m, p.d, 0, 0, 0, tz)
}
export const dateKeyIn = (ms, tz) => dayKey(dayOfInstant(ms, tz))

/* ── Cursores opacos ── */
export const encodeCursor = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
export function decodeCursor(c) {
  if (!c || typeof c !== 'string' || c.length > 200) return null
  try { return JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) } catch { return null }
}

export function pageOf(list, page, size) {
  const total = list.length
  const pages = Math.max(1, Math.ceil(total / size))
  const p = Math.max(1, toInt(page) || 1)
  return { items: list.slice((p - 1) * size, p * size), total, page: p, pages }
}

const byNewest = (a, b) => (msOf(b.created_at) || 0) - (msOf(a.created_at) || 0) || b.id - a.id
const byOldest = (a, b) => (msOf(a.created_at) || 0) - (msOf(b.created_at) || 0) || a.id - b.id

/* ══ Notificaciones (espejo de _academyNotify.js) ═════════════════════════ */

// Familia de preferencia que apaga cada tipo (prefs.notif.<familia>).
const FAMILY = {
  like: 'likes', comentario: 'comments', respuesta: 'comments', actividad: 'comments',
  mencion: 'mentions', seguidor: 'follows', post_seguido: 'follows', evento: 'events',
}

// Una notificación para un miembro, con las mismas exclusiones que
// notifyMany: nunca al propio actor, nunca entre bloqueados, nunca a quien
// apagó esa familia. Los me gusta se agrupan: si ya hay una fila sin leer
// con la misma group_key se actualiza (actor y hora) en vez de crear otra.
export function notifyMember(ctx, memberId, p) {
  const st = ctx.state
  const target = memberRow(st, memberId)
  if (!isActive(target)) return false
  const actor = p.actorId ?? null
  if (actor != null && actor === target.id) return false
  if (actor != null && isBlocked(st, target.id, actor)) return false
  const fam = FAMILY[p.kind]
  if (fam && target.prefs?.notif?.[fam] === false) return false
  const now = nowIso(ctx)
  if (p.groupKey) {
    const open = rows(st, 'academy_notifications').find((n) => n.member_id === target.id && n.group_key === p.groupKey && !n.read_at)
    if (open) {
      open.actor_id = actor
      if (p.preview != null) open.preview = p.preview
      open.created_at = now
      return true
    }
  }
  const payload = {
    memberId: target.id, kind: p.kind, actorId: actor, targetType: p.targetType ?? null, targetId: p.targetId ?? null,
    parentId: p.parentId ?? null, preview: p.preview ?? null, groupKey: p.groupKey ?? null,
  }
  if (typeof L(ctx).notify === 'function') {
    L(ctx).notify(st, payload)
  } else {
    rows(st, 'academy_notifications').push({
      id: nextIdOf(ctx, 'academy_notifications'), member_id: target.id, kind: p.kind, actor_id: actor,
      target_type: payload.targetType, target_id: payload.targetId, parent_id: payload.parentId,
      preview: payload.preview, group_key: payload.groupKey, read_at: null, created_at: now,
    })
  }
  return true
}

export function notifyMany(ctx, memberIds, payload, skip = new Set()) {
  let n = 0
  for (const id of new Set(memberIds)) {
    if (skip.has(id)) continue
    if (notifyMember(ctx, id, payload)) { skip.add(id); n++ }
  }
  return n
}

const commentRow = (st, id) => rows(st, 'academy_comments').find((c) => c.id === id) || null
const postRow = (st, id) => rows(st, 'academy_posts').find((p) => p.id === id) || null
const categoryRow = (st, id) => rows(st, 'academy_categories').find((c) => c.id === id) || null

function lessonRoute(st, lessonId) {
  const lesson = rows(st, 'academy_lessons').find((l) => l.id === lessonId)
  const course = lesson && rows(st, 'academy_courses').find((c) => c.id === lesson.course_id)
  return lesson && course ? `${LIB.HOST.base}/cursos/${encodeURIComponent(course.slug)}/${encodeURIComponent(lesson.slug)}` : `${LIB.HOST.base}/cursos`
}

// Ruta relativa calculada en el servidor (el front nunca arma una URL con
// datos de la fila). Con el estado a mano resolvemos slugs y handles.
export function routeOf(ctx, n) {
  const st = ctx.state
  const type = n.target_type ?? n.targetType
  const id = n.target_id ?? n.targetId
  const parent = n.parent_id ?? n.parentId
  const kind = n.kind
  if (kind === 'nivel') return `${LIB.HOST.base}/clasificacion`
  switch (type) {
    case 'post': return `${LIB.HOST.base}/comunidad/${id}`
    case 'comment': {
      const c = commentRow(st, id)
      if (c?.lesson_id != null) return lessonRoute(st, c.lesson_id)
      const postId = c?.post_id ?? parent
      return postId != null ? `${LIB.HOST.base}/comunidad/${postId}` : `${LIB.HOST.base}/comunidad`
    }
    case 'lesson': return lessonRoute(st, id)
    case 'event': return `${LIB.HOST.base}/calendario?evento=${id}`
    case 'miembro': {
      const m = memberRow(st, id)
      return m?.handle ? `${LIB.HOST.base}/perfil/${encodeURIComponent(m.handle)}` : `${LIB.HOST.base}/miembros`
    }
    case 'chat': return `${LIB.HOST.base}/chat/${id}`
    case 'curso': {
      const c = rows(st, 'academy_courses').find((x) => x.id === id)
      return c ? `${LIB.HOST.base}/cursos/${encodeURIComponent(c.slug)}` : `${LIB.HOST.base}/cursos`
    }
    case 'grupo': return `${LIB.HOST.base}/grupos/${id}`
    default: {
      const r = typeof L(ctx).routeFor === 'function' ? L(ctx).routeFor(st, { targetType: type, targetId: id, parentId: parent }) : null
      return typeof r === 'string' && r.startsWith(LIB.HOST.base) ? r : `${LIB.HOST.base}/comunidad`
    }
  }
}

// Texto en español (§8.1). Va plano, sin marcas de negrita: el front
// resalta el nombre con `actor.name` (nunca interpretamos HTML ni markdown).
export function notificationText(ctx, n) {
  const st = ctx.state
  const actor = memberRow(st, n.actor_id)?.name || 'Alguien'
  const type = n.target_type
  const what = type === 'comment' ? 'tu comentario' : 'tu publicación'
  switch (n.kind) {
    case 'like': {
      const likers = rows(st, 'academy_likes').filter((l) => l.target_type === type && l.target_id === n.target_id && l.member_id !== n.member_id).length
      const others = Math.max(0, likers - 1)
      return others > 0 ? `A ${actor} y ${others} más les gustó ${what}` : `A ${actor} le gustó ${what}`
    }
    case 'comentario': return `${actor} comentó en tu publicación`
    case 'respuesta': return `${actor} respondió tu comentario`
    case 'mencion': return `${actor} te mencionó`
    case 'post_seguido': return `${actor} (siguiendo) publicó`
    case 'actividad': return 'Hay actividad nueva en una publicación que sigues'
    case 'anuncio': return `${actor} publicó un anuncio`
    case 'seguidor': return `${actor} empezó a seguirte`
    case 'evento': return n.preview || 'Tienes un evento próximo'
    case 'nivel': {
      if (/^Nivel \d/.test(n.preview || '')) return `¡Subiste al ${n.preview}!`
      const lv = levelOfM(ctx, n.member_id)
      return `¡Subiste al Nivel ${lv} · ${levelNameFor(st, lv)}!`
    }
    case 'bienvenida': return `¡Bienvenido a ${settingsOf(st).group?.name || LIB.HOST.brand.name}!`
    case 'curso': {
      const c = rows(st, 'academy_courses').find((x) => x.id === n.target_id)
      return `Tienes acceso a ${c?.title || n.preview || 'un curso nuevo'}`
    }
    case 'grupo': {
      const c = rows(st, 'academy_cohorts').find((x) => x.id === n.target_id)
      return `Te agregaron al grupo ${c?.name || n.preview || ''}`.trim()
    }
    case 'reporte': return 'Nuevo reporte de contenido'
    case 'miembro_nuevo': return `${actor} se unió a la Academy`
    default: return n.preview || 'Tienes una notificación nueva'
  }
}

function notificationShape(ctx, n) {
  return {
    id: n.id,
    kind: n.kind,
    actor: n.actor_id != null ? mini(ctx, n.actor_id) : null,
    targetType: n.target_type ?? null,
    targetId: n.target_id ?? null,
    parentId: n.parent_id ?? null,
    route: routeOf(ctx, n),
    text: notificationText(ctx, n),
    preview: n.kind === 'evento' ? null : n.preview ?? null,
    createdAt: toIso(n.created_at),
    read: !!n.read_at,
  }
}

const unreadNotifCount = (st, memberId) =>
  rows(st, 'academy_notifications').filter((n) => n.member_id === memberId && !n.read_at).length
export { unreadNotifCount }

/* ══ Visibilidad ══════════════════════════════════════════════════════════ */

export function visibleCategories(ctx, viewer) {
  const st = ctx.state
  const mine = viewer ? new Set(cohortIdsOfM(ctx, viewer.id)) : new Set()
  const staff = staffRow(viewer) || (!viewer && ctxIsStaff(ctx))
  return rows(st, 'academy_categories')
    .filter((c) => c.cohort_id == null || staff || mine.has(c.cohort_id))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id)
}

const categoryShape = (c) => ({
  id: c.id, name: c.name, emoji: c.emoji ?? null, writeRole: c.write_role || 'miembros', cohortId: c.cohort_id ?? null,
  position: c.position ?? 0, defaultSort: c.default_sort || 'default',
})

// canSeePost del lib + la regla de la categoría privada otra vez acá
// (defensa en profundidad: si una de las dos dice que no, es no).
export function canSeePostRow(ctx, viewer, post) {
  if (!post || post.deleted_at || !viewer) return false
  if (typeof L(ctx).canSeePost === 'function' && !L(ctx).canSeePost(ctx.state, viewer, post)) return false
  const cat = post.category_id != null ? categoryRow(ctx.state, post.category_id) : null
  if (cat && cat.cohort_id != null && !staffRow(viewer) && !cohortIdsOfM(ctx, viewer.id).includes(cat.cohort_id)) return false
  return true
}

// Acceso a una lección (§5.2), local y completo: staff ve todo (también
// borradores); el resto necesita curso publicado + lección publicada y,
// según `access`, estar activo / tener el nivel / tener la compra activa.
export function lessonAccessible(ctx, viewer, lessonId) {
  const st = ctx.state
  const lesson = rows(st, 'academy_lessons').find((l) => l.id === lessonId)
  if (!lesson || !viewer) return false
  const course = rows(st, 'academy_courses').find((c) => c.id === lesson.course_id)
  if (!course) return false
  if (adminRow(viewer)) return true
  if (!isActive(viewer) || !course.published || !lesson.published) return false
  const granted = rows(st, 'academy_grants').some((g) => g.member_id === viewer.id && g.course_id === course.id && g.state === 'activa')
  if (course.access === 'abierto') return true
  if (course.access === 'nivel') return granted || (course.unlock_level != null && levelOfM(ctx, viewer.id) >= course.unlock_level)
  return granted
}

function canSeeCommentTarget(ctx, viewer, c) {
  if (!c) return false
  if (c.post_id != null) return canSeePostRow(ctx, viewer, postRow(ctx.state, c.post_id))
  return lessonAccessible(ctx, viewer, c.lesson_id)
}

/* ══ Proyecciones ═════════════════════════════════════════════════════════ */

function parseJson(v, dflt) {
  if (typeof v !== 'string') return v ?? dflt
  try { return JSON.parse(v) } catch { return dflt }
}

function pollOf(ctx, post, viewerId) {
  const p = parseJson(post.poll, null)
  if (!p || !Array.isArray(p.options) || !p.options.length) return null
  const votes = rows(ctx.state, 'academy_poll_votes').filter((v) => v.post_id === post.id)
  const mine = votes.find((v) => v.member_id === viewerId)
  return {
    options: p.options.map((o, i) => ({ text: String(typeof o === 'string' ? o : o?.text ?? ''), votes: votes.filter((v) => v.option_idx === i).length })),
    total: votes.length,
    myVote: mine ? mine.option_idx : null,
  }
}

function isUnread(st, viewerId, post) {
  if (viewerId == null || post.author_id === viewerId) return false
  const read = rows(st, 'academy_post_reads').find((r) => r.member_id === viewerId && r.post_id === post.id)
  return !read || (msOf(read.read_at) || 0) < (msOf(post.last_activity_at) || 0)
}

function attachmentsOf(post) {
  const list = parseJson(post.attachments, [])
  return (Array.isArray(list) ? list : [])
    .filter((a) => a && isImageUrl(a.url))
    .map((a) => ({ kind: 'image', url: safeUrl(a.url) || a.url, w: toInt(a.w), h: toInt(a.h) }))
}

export function postCard(ctx, viewer, post) {
  const st = ctx.state
  const vid = viewer?.id ?? null
  const cat = post.category_id != null ? categoryRow(st, post.category_id) : null
  const comments = rows(st, 'academy_comments').filter((c) => c.post_id === post.id && !c.deleted_at).sort(byNewest)
  const commenters = []
  for (const c of comments) {
    if (!commenters.includes(c.author_id)) commenters.push(c.author_id)
    if (commenters.length >= 4) break
  }
  return {
    id: post.id,
    author: mini(ctx, post.author_id),
    category: cat ? { id: cat.id, name: cat.name, emoji: cat.emoji ?? null } : null,
    title: post.title,
    excerpt: cut(post.body, 220),
    body: post.body || '',
    attachments: attachmentsOf(post),
    videoId: post.video_id && YT_ID.test(post.video_id) ? post.video_id : null,
    poll: pollOf(ctx, post, vid),
    pinned: !!post.pinned_at,
    commentsLocked: !!post.comments_locked,
    likeCount: post.like_count || 0,
    liked: vid != null && rows(st, 'academy_likes').some((l) => l.member_id === vid && l.target_type === 'post' && l.target_id === post.id),
    commentCount: post.comment_count || 0,
    lastCommentAt: toIso(post.last_comment_at),
    commenters: commenters.map((id) => mini(ctx, id)).filter(Boolean),
    createdAt: toIso(post.created_at),
    editedAt: toIso(post.edited_at),
    unread: isUnread(st, vid, post),
    following: vid != null && rows(st, 'academy_follows').some((f) => f.member_id === vid && f.target_type === 'post' && f.target_id === post.id),
  }
}

// Comentario borrado = hueco en el hilo: sin cuerpo ni autor real (solo
// se lista si todavía tiene respuestas vivas colgando).
const DELETED_AUTHOR = { id: null, handle: null, name: 'Eliminado', avatarUrl: null, level: null, role: null }

function commentShape(ctx, viewer, c) {
  const base = { id: c.id, postId: c.post_id ?? null, lessonId: c.lesson_id ?? null, parentId: c.parent_id ?? null }
  if (c.deleted_at) {
    return { ...base, author: DELETED_AUTHOR, body: '', likeCount: 0, liked: false, createdAt: toIso(c.created_at), editedAt: null, deleted: true }
  }
  const vid = viewer?.id ?? null
  return {
    ...base,
    author: mini(ctx, c.author_id),
    body: c.body || '',
    likeCount: c.like_count || 0,
    liked: vid != null && rows(ctx.state, 'academy_likes').some((l) => l.member_id === vid && l.target_type === 'comment' && l.target_id === c.id),
    createdAt: toIso(c.created_at),
    editedAt: toIso(c.edited_at),
    deleted: false,
  }
}

function commentsFor(ctx, viewer, { postId = null, lessonId = null }) {
  const all = rows(ctx.state, 'academy_comments').filter((c) => (postId != null ? c.post_id === postId : c.lesson_id === lessonId))
  const liveParents = new Set(all.filter((c) => !c.deleted_at && c.parent_id != null).map((c) => c.parent_id))
  return all.filter((c) => !c.deleted_at || liveParents.has(c.id)).sort(byOldest).map((c) => commentShape(ctx, viewer, c))
}

function upsertRead(ctx, memberId, postId) {
  const now = nowIso(ctx)
  const list = rows(ctx.state, 'academy_post_reads')
  const r = list.find((x) => x.member_id === memberId && x.post_id === postId)
  if (r) r.read_at = now
  else list.push({ member_id: memberId, post_id: postId, read_at: now })
}

function ensureFollow(ctx, memberId, targetType, targetId) {
  const list = rows(ctx.state, 'academy_follows')
  if (list.some((f) => f.member_id === memberId && f.target_type === targetType && f.target_id === targetId)) return false
  list.push({ member_id: memberId, target_type: targetType, target_id: targetId, created_at: nowIso(ctx) })
  return true
}

function memberIdsByHandles(st, handles) {
  if (!handles.length) return []
  const set = new Set(handles)
  return rows(st, 'academy_members').filter((m) => m.handle && set.has(String(m.handle).toLowerCase()) && isActive(m)).map((m) => m.id)
}

const followersOfMember = (st, id) =>
  rows(st, 'academy_follows').filter((f) => f.target_type === 'miembro' && f.target_id === id).map((f) => f.member_id)
const followersOfPost = (st, id) =>
  rows(st, 'academy_follows').filter((f) => f.target_type === 'post' && f.target_id === id).map((f) => f.member_id)
const activeMembers = (st) => rows(st, 'academy_members').filter(isActive)

/* ══ Publicaciones (compartido con los bots de academy-chat.mjs) ══════════ */

// Inserta la publicación y dispara sus notificaciones, con una sola por
// persona y por prioridad: mención > anuncio > post de alguien que sigues.
export function createPost(ctx, author, { categoryId = null, title, body = '', attachments = [], videoId = null, poll = null }) {
  const st = ctx.state
  const now = nowIso(ctx)
  const post = {
    id: nextIdOf(ctx, 'academy_posts'), author_id: author.id, category_id: categoryId, title, body,
    attachments, video_id: videoId, poll, pinned_at: null, comments_locked: false, like_count: 0, comment_count: 0,
    last_activity_at: now, last_comment_at: null, edited_at: null, deleted_at: null, created_at: now, updated_at: now,
  }
  rows(st, 'academy_posts').push(post)
  ensureFollow(ctx, author.id, 'post', post.id)
  upsertRead(ctx, author.id, post.id)

  const done = new Set([author.id])
  const payload = (kind) => ({ kind, actorId: author.id, targetType: 'post', targetId: post.id, parentId: null, preview: cut(title, 140) })
  const canSee = (id) => canSeePostRow(ctx, memberRow(st, id), post)
  notifyMany(ctx, memberIdsByHandles(st, extractMentions(body)).filter(canSee), payload('mencion'), done)
  const cat = categoryId != null ? categoryRow(st, categoryId) : null
  if (cat && cat.write_role === 'admins') {
    notifyMany(ctx, activeMembers(st).map((m) => m.id).filter(canSee), payload('anuncio'), done)
  }
  notifyMany(ctx, followersOfMember(st, author.id).filter(canSee), payload('post_seguido'), done)
  return post
}

/* ══ Handlers ═════════════════════════════════════════════════════════════ */

const SORTS = ['default', 'nuevos', 'top-dia', 'top-semana', 'top-mes', 'top-ano', 'top-siempre', 'no-leidos']
const TOP_DAYS = { 'top-dia': 1, 'top-semana': 7, 'top-mes': 30, 'top-ano': 365, 'top-siempre': null }
const CATEGORY_SORT = { default: 'default', nuevos: 'nuevos', top: 'top-siempre' }

function feed(ctx) {
  const me = needMember(ctx)
  const st = ctx.state
  const q = ctx.query || {}
  const cats = visibleCategories(ctx, me)
  let cat = null
  if (q.category != null && q.category !== '' && q.category !== 'todas') {
    // Una categoría privada ajena responde igual que una inexistente.
    cat = cats.find((c) => c.id === toInt(q.category)) || null
    if (!cat) fail(ctx, 404, 'Categoría no encontrada', 'not_found')
  }
  let sort = String(q.sort || '')
  if (!SORTS.includes(sort)) sort = cat ? CATEGORY_SORT[cat.default_sort] || 'default' : 'default'

  let visible = rows(st, 'academy_posts').filter((p) => canSeePostRow(ctx, me, p))
  if (cat) visible = visible.filter((p) => p.category_id === cat.id)

  const cur = decodeCursor(q.cursor)
  const offset = cur && Number.isSafeInteger(cur.o) && cur.o >= 0 ? cur.o : 0
  // Fijadas: solo en la primera página y respetando la categoría elegida; no
  // se repiten en la lista principal.
  const pinnedAll = visible.filter((p) => p.pinned_at).sort((a, b) => (msOf(b.pinned_at) || 0) - (msOf(a.pinned_at) || 0))
  const pinnedIds = new Set(pinnedAll.map((p) => p.id))
  let list = visible.filter((p) => !pinnedIds.has(p.id))

  if (q.filter === 'siguiendo') {
    const fPosts = new Set(rows(st, 'academy_follows').filter((f) => f.member_id === me.id && f.target_type === 'post').map((f) => f.target_id))
    const fMembers = new Set(rows(st, 'academy_follows').filter((f) => f.member_id === me.id && f.target_type === 'miembro').map((f) => f.target_id))
    list = list.filter((p) => fPosts.has(p.id) || fMembers.has(p.author_id))
  }
  const byActivity = (a, b) => (msOf(b.last_activity_at) || 0) - (msOf(a.last_activity_at) || 0) || b.id - a.id
  if (sort === 'nuevos') list.sort(byNewest)
  else if (sort in TOP_DAYS) {
    const days = TOP_DAYS[sort]
    if (days) {
      const from = Date.now() - days * DAY
      list = list.filter((p) => (msOf(p.created_at) || 0) >= from)
    }
    list.sort((a, b) => (b.like_count || 0) - (a.like_count || 0) || byNewest(a, b))
  } else if (sort === 'no-leidos') {
    list = list.filter((p) => isUnread(st, me.id, p)).sort(byActivity)
  } else list.sort(byActivity)

  const page = list.slice(offset, offset + PAGE_FEED)
  return {
    pinned: offset === 0 ? pinnedAll.slice(0, MAX_PINNED).map((p) => postCard(ctx, me, p)) : [],
    posts: page.map((p) => postCard(ctx, me, p)),
    nextCursor: offset + PAGE_FEED < list.length ? encodeCursor({ o: offset + PAGE_FEED }) : null,
    categories: cats.map(categoryShape),
  }
}

function getPost(ctx) {
  const me = needMember(ctx)
  const post = postRow(ctx.state, toInt(ctx.query?.id))
  if (!canSeePostRow(ctx, me, post)) fail(ctx, 404, 'Publicación no encontrada', 'not_found')
  upsertRead(ctx, me.id, post.id)
  return { post: postCard(ctx, me, post), comments: commentsFor(ctx, me, { postId: post.id }) }
}

function postSave(ctx) {
  const me = needMember(ctx)
  const st = ctx.state
  const b = ctx.body || {}
  const id = toInt(b.id)
  const existing = id != null ? postRow(st, id) : null
  if (id != null && !canSeePostRow(ctx, me, existing)) fail(ctx, 404, 'Publicación no encontrada', 'not_found')
  if (existing && existing.author_id !== me.id && !staffRow(me)) fail(ctx, 403, 'Solo el autor puede editar esta publicación', 'forbidden')

  if (!existing && !staffRow(me)) {
    const min = toInt(settingsOf(st).plugins?.minPostLevel)
    if (min && levelOfM(ctx, me.id) < min) fail(ctx, 403, `Necesitas llegar al nivel ${min} para publicar`, 'level')
  }

  const title = cleanText(b.title, 160).replace(/\n+/g, ' ')
  if (!title) fail(ctx, 400, 'Escribe un título', 'invalid')
  const body = cleanText(b.body, 20000)

  const cats = visibleCategories(ctx, me)
  let categoryId = b.categoryId == null || b.categoryId === '' ? null : toInt(b.categoryId)
  if (b.categoryId != null && b.categoryId !== '' && categoryId == null) fail(ctx, 400, 'Esa categoría no existe', 'invalid')
  if (categoryId == null && existing) categoryId = existing.category_id
  if (categoryId == null && cats.length) fail(ctx, 400, 'Elige una categoría', 'invalid')
  const cat = categoryId != null ? cats.find((c) => c.id === categoryId) : null
  if (categoryId != null && !cat) fail(ctx, 400, 'Esa categoría no existe', 'invalid')
  const categoryChanged = !existing || existing.category_id !== categoryId
  if (cat && categoryChanged && cat.write_role === 'admins' && !adminRow(me)) {
    fail(ctx, 403, 'Solo los administradores pueden publicar en esta categoría', 'forbidden')
  }

  let attachments = existing ? parseJson(existing.attachments, []) : []
  if (b.attachments !== undefined && b.attachments !== null) {
    if (!Array.isArray(b.attachments)) fail(ctx, 400, 'Adjuntos no válidos', 'invalid')
    if (b.attachments.length > 4) fail(ctx, 400, 'Puedes subir hasta 4 imágenes', 'invalid')
    attachments = b.attachments.map((a) => {
      const url = typeof a === 'string' ? a : a?.url
      if (!isImageUrl(url)) fail(ctx, 400, 'Esa imagen no es válida', 'bad_image')
      const dim = (v) => { const n = toInt(v); return n != null && n > 0 && n <= 10000 ? n : null }
      return { kind: 'image', url: safeUrl(url) || String(url).trim(), w: dim(a?.w), h: dim(a?.h) }
    })
  }

  let videoId = existing ? existing.video_id ?? null : null
  if (b.video !== undefined) {
    const raw = String(b.video ?? '').trim()
    if (!raw) videoId = null
    else {
      videoId = parseYouTubeId(raw)
      if (!videoId) fail(ctx, 400, 'El enlace de YouTube no es válido', 'bad_video')
    }
  }

  let poll = existing ? parseJson(existing.poll, null) : null
  if (b.poll !== undefined) {
    // Una encuesta con votos queda congelada: cambiarla alteraría lo votado.
    const hasVotes = !!existing && rows(st, 'academy_poll_votes').some((v) => v.post_id === existing.id)
    if (!hasVotes) {
      if (!b.poll) poll = null
      else {
        const opts = Array.isArray(b.poll.options) ? b.poll.options.map((o) => cleanText(typeof o === 'string' ? o : o?.text, 80).replace(/\n+/g, ' ')).filter(Boolean) : []
        if (opts.length < 2 || opts.length > 10) fail(ctx, 400, 'La encuesta necesita entre 2 y 10 opciones', 'invalid')
        poll = { options: opts.map((text) => ({ text })) }
      }
    }
  }

  if (existing) {
    const before = new Set(extractMentions(existing.body))
    const now = nowIso(ctx)
    Object.assign(existing, { title, body, category_id: categoryId, attachments, video_id: videoId, poll, edited_at: now, updated_at: now })
    const fresh = extractMentions(body).filter((h) => !before.has(h))
    const canSee = (mid) => canSeePostRow(ctx, memberRow(st, mid), existing)
    notifyMany(ctx, memberIdsByHandles(st, fresh).filter(canSee), {
      kind: 'mencion', actorId: me.id, targetType: 'post', targetId: existing.id, parentId: null, preview: cut(title, 140),
    }, new Set([existing.author_id, me.id]))
    return { post: postCard(ctx, me, existing) }
  }

  const post = createPost(ctx, me, { categoryId, title, body, attachments, videoId, poll })
  return { post: postCard(ctx, me, post) }
}

function postDelete(ctx) {
  const me = needMember(ctx)
  const post = postRow(ctx.state, toInt(ctx.body?.id))
  if (!canSeePostRow(ctx, me, post)) fail(ctx, 404, 'Publicación no encontrada', 'not_found')
  if (post.author_id !== me.id && !staffRow(me)) fail(ctx, 403, 'No puedes eliminar esta publicación', 'forbidden')
  const now = nowIso(ctx)
  post.deleted_at = now
  post.pinned_at = null
  post.updated_at = now
  return {}
}

function commentSave(ctx) {
  const me = needMember(ctx)
  const st = ctx.state
  const b = ctx.body || {}
  const body = cleanText(b.body, 5000)
  if (!body) fail(ctx, 400, 'Escribe un comentario', 'invalid')
  const now = nowIso(ctx)

  const id = toInt(b.id)
  if (id != null) {
    const c = commentRow(st, id)
    if (!c || c.deleted_at || !canSeeCommentTarget(ctx, me, c)) fail(ctx, 404, 'Comentario no encontrado', 'not_found')
    if (c.author_id !== me.id) fail(ctx, 403, 'Solo el autor puede editar este comentario', 'forbidden')
    const before = new Set(extractMentions(c.body))
    Object.assign(c, { body, edited_at: now, updated_at: now })
    const fresh = extractMentions(body).filter((h) => !before.has(h))
    const canSee = (mid) => canSeeCommentTarget(ctx, memberRow(st, mid), c)
    notifyMany(ctx, memberIdsByHandles(st, fresh).filter(canSee), {
      kind: 'mencion', actorId: me.id, targetType: 'comment', targetId: c.id, parentId: c.post_id ?? null, preview: cut(body, 140),
    }, new Set([me.id]))
    return { comment: commentShape(ctx, me, c) }
  }

  const postId = toInt(b.postId)
  const lessonId = toInt(b.lessonId)
  if ((postId == null) === (lessonId == null)) fail(ctx, 400, 'Falta la publicación o la lección', 'invalid')
  let post = null
  if (postId != null) {
    post = postRow(st, postId)
    if (!canSeePostRow(ctx, me, post)) fail(ctx, 404, 'Publicación no encontrada', 'not_found')
    if (post.comments_locked) fail(ctx, 409, 'Los comentarios de esta publicación están cerrados', 'comments_locked')
  } else {
    if (!rows(st, 'academy_lessons').some((l) => l.id === lessonId)) fail(ctx, 404, 'Lección no encontrada', 'not_found')
    if (!lessonAccessible(ctx, me, lessonId)) fail(ctx, 403, 'Esta lección está bloqueada', 'locked')
  }

  let replyTo = null
  if (b.parentId != null && b.parentId !== '') {
    replyTo = commentRow(st, toInt(b.parentId))
    const sameTarget = replyTo && (postId != null ? replyTo.post_id === postId : replyTo.lesson_id === lessonId)
    if (!replyTo || replyTo.deleted_at || !sameTarget) fail(ctx, 400, 'El comentario al que respondes ya no existe', 'invalid')
  }

  const c = {
    id: nextIdOf(ctx, 'academy_comments'), post_id: postId, lesson_id: lessonId,
    // Dos niveles: responder a una respuesta cuelga del comentario raíz.
    parent_id: replyTo ? replyTo.parent_id ?? replyTo.id : null,
    author_id: me.id, body, like_count: 0, edited_at: null, deleted_at: null, created_at: now, updated_at: now,
  }
  rows(st, 'academy_comments').push(c)
  if (post) {
    post.comment_count = (post.comment_count || 0) + 1
    post.last_comment_at = now
    post.last_activity_at = now
    post.updated_at = now
    // Lo que acabo de comentar no me aparece como "no leído".
    upsertRead(ctx, me.id, post.id)
  }

  // Una notificación por persona: mención > respuesta > comentario > actividad.
  const done = new Set([me.id])
  const payload = (kind) => ({ kind, actorId: me.id, targetType: 'comment', targetId: c.id, parentId: post?.id ?? null, preview: cut(body, 140) })
  const canSee = (mid) => canSeeCommentTarget(ctx, memberRow(st, mid), c)
  notifyMany(ctx, memberIdsByHandles(st, extractMentions(body)).filter(canSee), payload('mencion'), done)
  if (replyTo) notifyMany(ctx, [replyTo.author_id].filter(canSee), payload('respuesta'), done)
  if (post) {
    notifyMany(ctx, [post.author_id].filter(canSee), payload('comentario'), done)
    notifyMany(ctx, followersOfPost(st, post.id).filter(canSee), payload('actividad'), done)
  }
  return { comment: commentShape(ctx, me, c) }
}

function commentDelete(ctx) {
  const me = needMember(ctx)
  const st = ctx.state
  const c = commentRow(st, toInt(ctx.body?.id))
  if (!c || c.deleted_at || !canSeeCommentTarget(ctx, me, c)) fail(ctx, 404, 'Comentario no encontrado', 'not_found')
  if (c.author_id !== me.id && !staffRow(me)) fail(ctx, 403, 'No puedes eliminar este comentario', 'forbidden')
  softDeleteComment(ctx, c)
  return {}
}

function softDeleteComment(ctx, c) {
  const now = nowIso(ctx)
  c.deleted_at = now
  c.updated_at = now
  const post = c.post_id != null ? postRow(ctx.state, c.post_id) : null
  if (post) post.comment_count = Math.max(0, (post.comment_count || 0) - 1)
}

function lessonComments(ctx) {
  const me = needMember(ctx)
  const lessonId = toInt(ctx.query?.lessonId)
  if (lessonId == null || !rows(ctx.state, 'academy_lessons').some((l) => l.id === lessonId)) fail(ctx, 404, 'Lección no encontrada', 'not_found')
  if (!lessonAccessible(ctx, me, lessonId)) fail(ctx, 403, 'Esta lección está bloqueada', 'locked')
  return { comments: commentsFor(ctx, me, { lessonId }) }
}

function like(ctx) {
  const me = needMember(ctx)
  const st = ctx.state
  const b = ctx.body || {}
  const tt = b.targetType
  const tid = toInt(b.targetId)
  if (!['post', 'comment'].includes(tt) || tid == null) fail(ctx, 400, 'Solicitud no válida', 'invalid')
  const want = toBool(b.like, true)
  let target
  if (tt === 'post') {
    target = postRow(st, tid)
    if (!canSeePostRow(ctx, me, target)) fail(ctx, 404, 'Publicación no encontrada', 'not_found')
  } else {
    target = commentRow(st, tid)
    if (!target || target.deleted_at || !canSeeCommentTarget(ctx, me, target)) fail(ctx, 404, 'Comentario no encontrado', 'not_found')
  }
  if (target.author_id === me.id) fail(ctx, 400, 'No puedes darle me gusta a tu propio contenido', 'own')

  const likes = rows(st, 'academy_likes')
  const idx = likes.findIndex((l) => l.member_id === me.id && l.target_type === tt && l.target_id === tid)
  if (want && idx < 0) {
    const before = levelOfM(ctx, target.author_id)
    likes.push({ member_id: me.id, target_type: tt, target_id: tid, author_id: target.author_id, created_at: nowIso(ctx) })
    target.like_count = (target.like_count || 0) + 1
    notifyMember(ctx, target.author_id, {
      kind: 'like', actorId: me.id, targetType: tt, targetId: tid, parentId: tt === 'comment' ? target.post_id ?? null : null,
      preview: tt === 'post' ? cut(target.title, 140) : cut(target.body, 140), groupKey: `like:${tt}:${tid}`,
    })
    const after = levelOfM(ctx, target.author_id)
    if (after > before) {
      const preview = `Nivel ${after} · ${levelNameFor(st, after)}`
      const dup = rows(st, 'academy_notifications').some((n) => n.member_id === target.author_id && n.kind === 'nivel' && n.preview === preview)
      if (!dup) notifyMember(ctx, target.author_id, { kind: 'nivel', actorId: null, targetType: 'miembro', targetId: target.author_id, preview })
    }
  } else if (!want && idx >= 0) {
    likes.splice(idx, 1)
    target.like_count = Math.max(0, (target.like_count || 0) - 1)
  }
  return { likeCount: target.like_count || 0, liked: want }
}

function pollVote(ctx) {
  const me = needMember(ctx)
  const st = ctx.state
  const post = postRow(st, toInt(ctx.body?.postId))
  if (!canSeePostRow(ctx, me, post)) fail(ctx, 404, 'Publicación no encontrada', 'not_found')
  const poll = pollOf(ctx, post, me.id)
  if (!poll) fail(ctx, 400, 'Esta publicación no tiene encuesta', 'invalid')
  const idx = toInt(ctx.body?.optionIdx)
  if (idx == null || idx < 0 || idx >= poll.options.length) fail(ctx, 400, 'Opción no válida', 'invalid')
  const votes = rows(st, 'academy_poll_votes')
  const mine = votes.find((v) => v.post_id === post.id && v.member_id === me.id)
  if (mine) mine.option_idx = idx
  else votes.push({ post_id: post.id, member_id: me.id, option_idx: idx, created_at: nowIso(ctx) })
  return { poll: pollOf(ctx, post, me.id) }
}

function follow(ctx) {
  const me = needMember(ctx)
  const st = ctx.state
  const b = ctx.body || {}
  const tt = b.targetType
  const tid = toInt(b.targetId)
  if (!['post', 'miembro'].includes(tt) || tid == null) fail(ctx, 400, 'Solicitud no válida', 'invalid')
  if (tt === 'post' && !canSeePostRow(ctx, me, postRow(st, tid))) fail(ctx, 404, 'Publicación no encontrada', 'not_found')
  if (tt === 'miembro') {
    if (tid === me.id) fail(ctx, 400, 'No puedes seguirte a ti mismo', 'invalid')
    if (!isActive(memberRow(st, tid))) fail(ctx, 404, 'Miembro no encontrado', 'not_found')
  }
  const want = toBool(b.follow, true)
  const list = rows(st, 'academy_follows')
  const idx = list.findIndex((f) => f.member_id === me.id && f.target_type === tt && f.target_id === tid)
  if (want && idx < 0) {
    list.push({ member_id: me.id, target_type: tt, target_id: tid, created_at: nowIso(ctx) })
    if (tt === 'miembro') notifyMember(ctx, tid, { kind: 'seguidor', actorId: me.id, targetType: 'miembro', targetId: me.id, preview: null })
  } else if (!want && idx >= 0) list.splice(idx, 1)
  return { following: want }
}

function chatMemberOf(st, chatId, memberId) {
  return rows(st, 'academy_chat_members').some((r) => r.chat_id === chatId && r.member_id === memberId)
}

function report(ctx) {
  const me = needMember(ctx)
  const st = ctx.state
  const b = ctx.body || {}
  const tt = b.targetType
  const tid = toInt(b.targetId)
  if (!['post', 'comment', 'message', 'miembro'].includes(tt) || tid == null) fail(ctx, 400, 'Solicitud no válida', 'invalid')
  // Solo se reporta lo que uno puede ver: reportar no sirve para sondear ids.
  let ok = false
  let notifTarget = { targetType: null, targetId: null, parentId: null }
  if (tt === 'post') {
    ok = canSeePostRow(ctx, me, postRow(st, tid))
    notifTarget = { targetType: 'post', targetId: tid, parentId: null }
  } else if (tt === 'comment') {
    const c = commentRow(st, tid)
    ok = !!c && !c.deleted_at && canSeeCommentTarget(ctx, me, c)
    notifTarget = { targetType: 'comment', targetId: tid, parentId: c?.post_id ?? null }
  } else if (tt === 'message') {
    const m = rows(st, 'academy_messages').find((x) => x.id === tid)
    ok = !!m && !m.deleted_at && chatMemberOf(st, m.chat_id, me.id)
  } else {
    const m = memberRow(st, tid)
    ok = !!m && !m.deleted_at && m.id !== me.id
    notifTarget = { targetType: 'miembro', targetId: tid, parentId: null }
  }
  if (!ok) fail(ctx, 404, 'No encontrado', 'not_found')

  const list = rows(st, 'academy_reports')
  const dup = list.some((r) => r.reporter_id === me.id && r.target_type === tt && r.target_id === tid && r.status === 'abierto')
  if (dup) return {}
  const reason = cleanText(b.reason, 500) || null
  list.push({
    id: nextIdOf(ctx, 'academy_reports'), reporter_id: me.id, target_type: tt, target_id: tid, reason,
    status: 'abierto', resolved_by: null, resolved_at: null, created_at: nowIso(ctx),
  })
  // Al staff le llega sin actor: el reporte es anónimo para los demás.
  const staffIds = activeMembers(st).filter(staffRow).map((m) => m.id)
  notifyMany(ctx, staffIds, { kind: 'reporte', actorId: null, ...notifTarget, preview: reason ? cut(reason, 140) : null }, new Set([me.id]))
  return {}
}

const MEMBER_TABS = ['miembros', 'admins', 'en-linea']
const ADMIN_TABS = ['activos', 'cancelando', 'cancelado', 'expulsado']

function members(ctx) {
  const me = needMember(ctx)
  const st = ctx.state
  const q = ctx.query || {}
  const admin = adminRow(me)
  const tab = String(q.tab || 'miembros')
  if (![...MEMBER_TABS, ...ADMIN_TABS].includes(tab)) fail(ctx, 400, 'Pestaña no válida', 'invalid')
  if (ADMIN_TABS.includes(tab) && !admin) fail(ctx, 403, 'No tienes permiso para ver esta lista', 'forbidden')

  const all = rows(st, 'academy_members').filter((m) => !m.deleted_at)
  const active = all.filter(isActive)
  const sets = {
    miembros: active,
    admins: active.filter(staffRow),
    'en-linea': active.filter(isOnline),
    activos: active,
    cancelando: [],
    cancelado: all.filter((m) => m.status === 'cancelado'),
    expulsado: all.filter((m) => m.status === 'expulsado'),
  }
  let list = sets[tab].slice()

  const needle = fold(String(q.q || '').trim()).slice(0, 80)
  if (needle) {
    list = list.filter((m) => fold(m.name).includes(needle) || fold(m.handle).includes(needle) ||
      (!!m.bio && fold(m.bio).includes(needle)) || (admin && fold(m.email).includes(needle)))
  }
  const level = toInt(q.level)
  if (level != null) list = list.filter((m) => levelOfM(ctx, m.id) === level)
  const cohortId = toInt(q.cohortId)
  if (cohortId != null && admin) {
    const inCohort = new Set(rows(st, 'academy_cohort_members').filter((r) => r.cohort_id === cohortId).map((r) => r.member_id))
    list = list.filter((m) => inCohort.has(m.id))
  }

  const sort = ['nuevos', 'actividad', 'puntos'].includes(q.sort) ? q.sort : 'nuevos'
  // "Actividad" respeta la privacidad: quien oculta su actividad ordena como
  // si nunca hubiera entrado (salvo para un admin).
  const seen = (m) => (m.prefs?.privacy?.hideActivity && !admin && m.id !== me.id ? 0 : msOf(m.last_seen_at) || 0)
  if (sort === 'actividad') list.sort((a, b) => seen(b) - seen(a) || b.id - a.id)
  else if (sort === 'puntos') list.sort((a, b) => pointsOfM(ctx, b.id) - pointsOfM(ctx, a.id) || a.id - b.id)
  else list.sort((a, b) => (msOf(b.joined_at) || 0) - (msOf(a.joined_at) || 0) || b.id - a.id)

  const pg = pageOf(list, q.page, PAGE_MEMBERS)
  const project = (m) => (admin ? adminOf(ctx, m.id, me) : publicOf(ctx, m.id, me))
  const counts = { miembros: sets.miembros.length, admins: sets.admins.length, enLinea: sets['en-linea'].length }
  if (admin) Object.assign(counts, { activos: sets.activos.length, cancelando: 0, cancelado: sets.cancelado.length, expulsado: sets.expulsado.length })
  return { members: pg.items.map(project).filter(Boolean), total: pg.total, page: pg.page, pages: pg.pages, counts }
}

function activityOf(ctx, memberId) {
  const st = ctx.state
  const today = dayOfInstant(Date.now(), SANTIAGO)
  const first = today - 364
  const counts = new Array(365).fill(0)
  const bump = (v) => {
    const t = msOf(v)
    if (t == null) return
    const i = dayOfInstant(t, SANTIAGO) - first
    if (i >= 0 && i < 365) counts[i]++
  }
  // Igual que Skool: publicaciones + comentarios + me gusta + votos.
  for (const p of rows(st, 'academy_posts')) if (p.author_id === memberId && !p.deleted_at) bump(p.created_at)
  for (const c of rows(st, 'academy_comments')) if (c.author_id === memberId && !c.deleted_at) bump(c.created_at)
  for (const l of rows(st, 'academy_likes')) if (l.member_id === memberId) bump(l.created_at)
  for (const v of rows(st, 'academy_poll_votes')) if (v.member_id === memberId) bump(v.created_at)
  return { startDate: dayKey(first), counts }
}

function member(ctx) {
  const me = needMember(ctx)
  const st = ctx.state
  const handle = String(ctx.query?.handle || '').trim().toLowerCase()
  const row = handle ? rows(st, 'academy_members').find((m) => String(m.handle || '').toLowerCase() === handle) : null
  // Un expulsado/cancelado solo lo ve un admin; un borrado, nadie.
  if (!row || row.deleted_at || (!isActive(row) && !adminRow(me))) fail(ctx, 404, 'Miembro no encontrado', 'not_found')
  const isMe = row.id === me.id
  const follows = rows(st, 'academy_follows')
  const visiblePosts = rows(st, 'academy_posts').filter((p) => p.author_id === row.id && canSeePostRow(ctx, me, p))
  // Con "ocultar actividad" el mapa llega en ceros (misma forma, el front
  // no necesita otro caso) salvo para uno mismo.
  const hidden = !isMe && !!row.prefs?.privacy?.hideActivity
  const activity = hidden
    ? { startDate: dayKey(dayOfInstant(Date.now(), SANTIAGO) - 364), counts: new Array(365).fill(0), hidden: true }
    : activityOf(ctx, row.id)
  return {
    member: publicOf(ctx, row.id, me),
    stats: {
      posts: visiblePosts.length,
      comments: rows(st, 'academy_comments').filter((c) => c.author_id === row.id && !c.deleted_at).length,
      followers: follows.filter((f) => f.target_type === 'miembro' && f.target_id === row.id).length,
      following: follows.filter((f) => f.member_id === row.id && f.target_type === 'miembro').length,
      likesReceived: pointsOfM(ctx, row.id),
    },
    activity,
    recent: visiblePosts.sort(byNewest).slice(0, 5).map((p) => postCard(ctx, me, p)),
    isFollowing: follows.some((f) => f.member_id === me.id && f.target_type === 'miembro' && f.target_id === row.id),
    canChat: !isMe && !dmBlockReason(ctx, me, row),
    isMe,
  }
}

function leaderboard(ctx) {
  const me = needMember(ctx)
  const st = ctx.state
  const active = activeMembers(st)
  // Propietario y admins tienen nivel pero no compiten (moderadores sí).
  const eligible = active.filter((m) => !adminRow(m))
  const eligibleIds = new Set(eligible.map((m) => m.id))
  const today = dayOfInstant(Date.now(), SANTIAGO)
  const windowPoints = (days) => {
    const from = startOfDay(today - (days - 1), SANTIAGO)
    const pts = new Map()
    for (const l of rows(st, 'academy_likes')) {
      if (l.member_id === l.author_id || !eligibleIds.has(l.author_id)) continue
      if ((msOf(l.created_at) || 0) < from) continue
      pts.set(l.author_id, (pts.get(l.author_id) || 0) + 1)
    }
    return pts
  }
  const allPts = new Map(eligible.map((m) => [m.id, pointsOfM(ctx, m.id)]))
  const board = (pts) => [...pts.entries()]
    .filter(([, p]) => p > 0)
    .sort((a, b) => b[1] - a[1] || String(memberRow(st, a[0])?.name).localeCompare(String(memberRow(st, b[0])?.name)) || a[0] - b[0])
    .map(([id, points], i) => ({ rank: i + 1, id, points }))
  const b7 = board(windowPoints(7))
  const b30 = board(windowPoints(30))
  const bAll = board(allPts)
  const rankIn = (b) => b.find((r) => r.id === me.id)?.rank ?? null
  const top = (b) => b.slice(0, 10).map((r) => ({ rank: r.rank, member: mini(ctx, r.id), points: r.points }))

  const thresholds = levelThresholds(ctx)
  const settings = settingsOf(st)
  const perLevel = new Array(9).fill(0)
  for (const m of active) perLevel[Math.min(9, Math.max(1, levelOfM(ctx, m.id))) - 1]++
  const total = active.length || 1
  const courses = rows(st, 'academy_courses')
  const minChat = toInt(settings.plugins?.minChatLevel)
  const minPost = toInt(settings.plugins?.minPostLevel)
  const levels = thresholds.map((minPoints, i) => {
    const level = i + 1
    const unlocks = courses
      .filter((c) => c.published && c.access === 'nivel' && c.unlock_level === level)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((c) => ({ kind: 'curso', label: c.title }))
    if (minChat === level) unlocks.push({ kind: 'chat', label: 'Chatear con miembros' })
    if (minPost === level) unlocks.push({ kind: 'publicar', label: 'Publicar en la comunidad' })
    return { level, name: levelNameFor(st, level), minPoints, pct: Math.round((perLevel[i] / total) * 100), unlocks }
  })

  const info = L(ctx).levelFor(pointsOfM(ctx, me.id)) || {}
  const excluded = !eligibleIds.has(me.id)
  return {
    me: {
      level: info.level || 1,
      levelName: levelNameFor(st, info.level || 1),
      points: info.points ?? pointsOfM(ctx, me.id),
      pointsToNext: info.pointsToNext ?? null,
      progress: info.progress ?? 0,
      rank7: excluded ? null : rankIn(b7),
      rank30: excluded ? null : rankIn(b30),
      rankAll: excluded ? null : rankIn(bAll),
    },
    levels,
    boards: { d7: top(b7), d30: top(b30), all: top(bAll) },
    updatedAt: nowIso(ctx),
  }
}

function notifications(ctx) {
  const me = needMember(ctx)
  const q = ctx.query || {}
  let list = rows(ctx.state, 'academy_notifications').filter((n) => n.member_id === me.id)
  const unread = list.filter((n) => !n.read_at).length
  if (q.filter === 'no-leidas') list = list.filter((n) => !n.read_at)
  list.sort((a, b) => b.id - a.id)
  const cursor = toInt(q.cursor)
  if (cursor != null) list = list.filter((n) => n.id < cursor)
  const page = list.slice(0, PAGE_NOTIF)
  return {
    notifications: page.map((n) => notificationShape(ctx, n)),
    unread,
    nextCursor: list.length > PAGE_NOTIF ? String(page[page.length - 1].id) : null,
  }
}

function notificationsRead(ctx) {
  const me = needMember(ctx)
  const b = ctx.body || {}
  const all = b.all === true
  const ids = Array.isArray(b.ids) ? new Set(b.ids.slice(0, 500).map(toInt).filter((x) => x != null)) : null
  if (!all && !ids) fail(ctx, 400, 'Faltan las notificaciones a marcar', 'invalid')
  const now = nowIso(ctx)
  // Solo las propias: un id ajeno en la lista simplemente no calza.
  for (const n of rows(ctx.state, 'academy_notifications')) {
    if (n.member_id === me.id && !n.read_at && (all || ids.has(n.id))) n.read_at = now
  }
  return { unread: unreadNotifCount(ctx.state, me.id) }
}

function search(ctx) {
  const me = needMember(ctx)
  const st = ctx.state
  const q = ctx.query || {}
  const raw = String(q.q || '').trim()
  if (raw.length < 2) fail(ctx, 400, 'Escribe al menos 2 caracteres', 'invalid')
  const needle = fold(raw).slice(0, 80)
  const type = ['todo', 'publicaciones', 'miembros', 'lecciones'].includes(q.type) ? q.type : 'todo'
  const want = (t) => type === 'todo' || type === t
  const posts = want('publicaciones')
    ? rows(st, 'academy_posts')
      .filter((p) => canSeePostRow(ctx, me, p) && (fold(p.title).includes(needle) || fold(p.body).includes(needle)))
      .sort((a, b) => (msOf(b.last_activity_at) || 0) - (msOf(a.last_activity_at) || 0))
      .slice(0, 20).map((p) => postCard(ctx, me, p))
    : []
  const membersOut = want('miembros')
    ? activeMembers(st)
      .filter((m) => fold(m.name).includes(needle) || fold(m.handle).includes(needle) || (!!m.bio && fold(m.bio).includes(needle)))
      .slice(0, 20).map((m) => publicOf(ctx, m.id, me)).filter(Boolean)
    : []
  const lessons = want('lecciones')
    ? rows(st, 'academy_lessons')
      .filter((l) => fold(l.title).includes(needle) && lessonAccessible(ctx, me, l.id))
      .slice(0, 20)
      .map((l) => {
        const c = rows(st, 'academy_courses').find((x) => x.id === l.course_id)
        return { courseSlug: c?.slug ?? null, courseTitle: c?.title ?? null, slug: l.slug, title: l.title }
      })
    : []
  return { posts, members: membersOut, lessons }
}

function groupCard(ctx) {
  needMember(ctx)
  const st = ctx.state
  const g = settingsOf(st).group || {}
  const active = activeMembers(st)
  const recent = active.slice().sort((a, b) => (msOf(b.last_seen_at) || 0) - (msOf(a.last_seen_at) || 0) || a.id - b.id)
  const links = (Array.isArray(g.links) ? g.links : [])
    .map((l) => ({ title: cleanText(l?.title, 60), url: safeUrl(l?.url) }))
    .filter((l) => l.title && l.url)
    .slice(0, 5)
  const rules = (Array.isArray(g.rules) ? g.rules : [])
    .map((r) => ({ title: cleanText(typeof r === 'string' ? r : r?.title, 120) }))
    .filter((r) => r.title)
  return {
    name: g.name || LIB.HOST.brand.name,
    description: g.description || '',
    coverUrl: g.coverUrl && isImageUrl(g.coverUrl) ? g.coverUrl : null,
    url: LIB.HOST.brand.groupUrlLabel,
    initials: g.initials || LIB.HOST.brand.initials,
    color: g.color || LIB.HOST.brand.color,
    counts: { members: active.length, online: active.filter(isOnline).length, admins: active.filter(staffRow).length },
    avatars: recent.slice(0, 8).map((m) => mini(ctx, m.id)).filter(Boolean),
    links,
    rules,
  }
}

function adminCategorySave(ctx) {
  needAdmin(ctx)
  const st = ctx.state
  const b = ctx.body || {}
  const list = rows(st, 'academy_categories')
  const id = toInt(b.id)
  const existing = id != null ? list.find((c) => c.id === id) : null
  if (id != null && !existing) fail(ctx, 404, 'Categoría no encontrada', 'not_found')
  if (!existing && list.length >= MAX_CATEGORIES) fail(ctx, 409, `Puedes tener hasta ${MAX_CATEGORIES} categorías`, 'limit')

  const pick = (key, parse, dflt) => (has(b, key) ? parse(b[key]) : existing ? existing[dflt[0]] : dflt[1])
  const name = cleanText(pick('name', (v) => v, ['name', '']), 30).replace(/\n+/g, ' ')
  if (!name) fail(ctx, 400, 'Ponle un nombre a la categoría', 'invalid')
  const emoji = pick('emoji', (v) => (v == null ? null : cleanText(v, 8) || null), ['emoji', null])
  const position = pick('position', (v) => toInt(v) ?? 0, ['position', list.length])
  const writeRole = pick('writeRole', (v) => v, ['write_role', 'miembros'])
  if (!['miembros', 'admins'].includes(writeRole)) fail(ctx, 400, 'Permiso de publicación no válido', 'invalid')
  const defaultSort = pick('defaultSort', (v) => v, ['default_sort', 'default'])
  if (!['default', 'nuevos', 'top'].includes(defaultSort)) fail(ctx, 400, 'Orden no válido', 'invalid')
  const cohortId = pick('cohortId', (v) => (v == null || v === '' ? null : toInt(v)), ['cohort_id', null])
  if (has(b, 'cohortId') && b.cohortId != null && b.cohortId !== '' && cohortId == null) fail(ctx, 400, 'Ese grupo no existe', 'invalid')
  if (cohortId != null && !rows(st, 'academy_cohorts').some((c) => c.id === cohortId)) fail(ctx, 400, 'Ese grupo no existe', 'invalid')

  const fields = { name, emoji, position, write_role: writeRole, default_sort: defaultSort, cohort_id: cohortId }
  let cat = existing
  if (cat) Object.assign(cat, fields)
  else {
    cat = { id: nextIdOf(ctx, 'academy_categories'), ...fields, created_at: nowIso(ctx) }
    list.push(cat)
  }
  return { category: categoryShape(cat) }
}

function adminCategoryDelete(ctx) {
  needAdmin(ctx)
  const st = ctx.state
  const b = ctx.body || {}
  const list = rows(st, 'academy_categories')
  const id = toInt(b.id)
  const idx = list.findIndex((c) => c.id === id)
  if (idx < 0) fail(ctx, 404, 'Categoría no encontrada', 'not_found')
  const moveTo = b.moveTo == null || b.moveTo === '' ? null : toInt(b.moveTo)
  if (moveTo != null && (moveTo === id || !list.some((c) => c.id === moveTo))) fail(ctx, 400, 'Elige otra categoría para mover las publicaciones', 'invalid')
  for (const p of rows(st, 'academy_posts')) if (p.category_id === id) p.category_id = moveTo
  list.splice(idx, 1)
  return {}
}

function adminPin(ctx) {
  needAdmin(ctx)
  const st = ctx.state
  const post = postRow(st, toInt(ctx.body?.postId))
  if (!post || post.deleted_at) fail(ctx, 404, 'Publicación no encontrada', 'not_found')
  if (toBool(ctx.body?.pinned, true)) {
    if (post.pinned_at) return {}
    const pinned = rows(st, 'academy_posts').filter((p) => p.pinned_at && !p.deleted_at).length
    if (pinned >= MAX_PINNED) fail(ctx, 409, `Solo puedes fijar ${MAX_PINNED} publicaciones`, 'pin_limit')
    post.pinned_at = nowIso(ctx)
  } else post.pinned_at = null
  return {}
}

function adminPostModerate(ctx) {
  needStaff(ctx)
  const st = ctx.state
  const b = ctx.body || {}
  const post = postRow(st, toInt(b.postId))
  if (!post || post.deleted_at) fail(ctx, 404, 'Publicación no encontrada', 'not_found')
  const now = nowIso(ctx)
  switch (b.action) {
    case 'lock': post.comments_locked = true; break
    case 'unlock': post.comments_locked = false; break
    case 'move': {
      const cid = toInt(b.categoryId)
      if (cid == null || !categoryRow(st, cid)) fail(ctx, 400, 'Esa categoría no existe', 'invalid')
      post.category_id = cid
      break
    }
    case 'delete': post.deleted_at = now; post.pinned_at = null; break
    default: fail(ctx, 400, 'Acción no válida', 'invalid')
  }
  post.updated_at = now
  return {}
}

function reportTarget(ctx, r) {
  const st = ctx.state
  switch (r.target_type) {
    case 'post': {
      const p = postRow(st, r.target_id)
      return { preview: p ? cut(p.title, 140) : '', route: `${LIB.HOST.base}/comunidad/${r.target_id}` }
    }
    case 'comment': {
      const c = commentRow(st, r.target_id)
      return { preview: c ? cut(c.body, 140) : '', route: routeOf(ctx, { target_type: 'comment', target_id: r.target_id, parent_id: c?.post_id ?? null }) }
    }
    case 'message': {
      const m = rows(st, 'academy_messages').find((x) => x.id === r.target_id)
      return { preview: m ? cut(m.body, 140) : '', route: m ? `${LIB.HOST.base}/chat/${m.chat_id}` : `${LIB.HOST.base}/comunidad` }
    }
    default: {
      const m = memberRow(st, r.target_id)
      return { preview: m ? m.name : '', route: routeOf(ctx, { target_type: 'miembro', target_id: r.target_id }) }
    }
  }
}

function adminReports(ctx) {
  needStaff(ctx)
  const status = ['abierto', 'resuelto', 'descartado', 'todos'].includes(ctx.query?.status) ? ctx.query.status : 'abierto'
  const list = rows(ctx.state, 'academy_reports')
    .filter((r) => status === 'todos' || r.status === status)
    .sort((a, b) => b.id - a.id)
    .slice(0, 200)
  return {
    reports: list.map((r) => ({
      id: r.id, reporter: mini(ctx, r.reporter_id), targetType: r.target_type, targetId: r.target_id, reason: r.reason ?? null,
      status: r.status, createdAt: toIso(r.created_at), ...reportTarget(ctx, r),
    })),
  }
}

function adminReportResolve(ctx) {
  needStaff(ctx)
  const st = ctx.state
  const b = ctx.body || {}
  const list = rows(st, 'academy_reports')
  const r = list.find((x) => x.id === toInt(b.id))
  if (!r) fail(ctx, 404, 'Reporte no encontrado', 'not_found')
  if (!['resuelto', 'descartado'].includes(b.status)) fail(ctx, 400, 'Estado no válido', 'invalid')
  const now = nowIso(ctx)
  const deleteContent = b.status === 'resuelto' && b.deleteContent === true
  if (deleteContent) {
    if (r.target_type === 'post') {
      const p = postRow(st, r.target_id)
      if (p && !p.deleted_at) Object.assign(p, { deleted_at: now, pinned_at: null, updated_at: now })
    } else if (r.target_type === 'comment') {
      const c = commentRow(st, r.target_id)
      if (c && !c.deleted_at) softDeleteComment(ctx, c)
    } else if (r.target_type === 'message') {
      const m = rows(st, 'academy_messages').find((x) => x.id === r.target_id)
      if (m && !m.deleted_at) m.deleted_at = now
    }
  }
  const by = actorId(ctx) ?? ctx.admin?.barberId ?? null
  // Borrado el contenido, los demás reportes abiertos del mismo objetivo
  // quedan resueltos con él (no tiene sentido revisarlos otra vez).
  for (const x of list) {
    const same = x === r || (deleteContent && x.status === 'abierto' && x.target_type === r.target_type && x.target_id === r.target_id)
    if (same) Object.assign(x, { status: b.status, resolved_by: by, resolved_at: now })
  }
  return {}
}

export const handlers = {
  feed,
  post: getPost,
  'post-save': postSave,
  'post-delete': postDelete,
  'comment-save': commentSave,
  'comment-delete': commentDelete,
  'lesson-comments': lessonComments,
  like,
  'poll-vote': pollVote,
  follow,
  report,
  members,
  member,
  leaderboard,
  search,
  'group-card': groupCard,
  'admin-category-save': adminCategorySave,
  'admin-category-delete': adminCategoryDelete,
  'admin-pin': adminPin,
  'admin-post-moderate': adminPostModerate,
  'admin-reports': adminReports,
  'admin-report-resolve': adminReportResolve,
  // _academyNotify.js
  notifications,
  'notifications-read': notificationsRead,
}
