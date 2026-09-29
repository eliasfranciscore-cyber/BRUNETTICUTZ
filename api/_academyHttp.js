/* ACADEMY — Piezas compartidas de los handlers
   ------------------------------------------------------------------
   HttpError, niveles/puntos, proyecciones de miembro (MemberMini,
   MemberPublic), ajustes con defaults y utilidades de parámetros.

   Reglas del driver de Neon que este archivo respeta (y que cualquiera que
   copie de acá tiene que respetar):
     - todo lo interpolado con ${...} viaja como PARÁMETRO: no se pueden
       anidar fragmentos sql`...` ni interpolar nombres de columna;
     - arreglos como ${ids}::int[], JSON como ${JSON.stringify(v)}::jsonb;
     - fechas hacia el JSON sin milisegundos (Safari/iOS):
         to_char(col AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
       escrito LITERAL en cada consulta (ver isoSql, que solo documenta).
   Prefijo `_`: no cuenta como función serverless. */

import { safeUrl, isImageUrl, parseYouTubeId } from "./_academyText.js"
import { HOST } from "./_academyHost.js"

/* Error con status HTTP que el router traduce a { ok:false, error, code }.
   `extra` (opcional) se mezcla en la respuesta, p. ej. { retryAfter: 60 }
   — el router además pone la cabecera Retry-After si viene. */
export class HttpError extends Error {
  constructor(status, message, code, extra) {
    super(message)
    this.name = "HttpError"
    this.status = Number(status) || 500
    this.code = code || undefined
    this.extra = extra && typeof extra === "object" ? extra : undefined
  }
}

/* Respuesta JSON directa (para handlers que escriben la suya, p. ej. un
   stream o un 429 con cabeceras propias). El router ya cubre el caso normal. */
export function sendJson(res, status, body, cache = "private, no-store") {
  res.setHeader("Cache-Control", cache)
  return res.status(status).json(body)
}

/* ── Niveles ────────────────────────────────────────────────────────────────
   Puntos = "me gusta" recibidos de OTROS miembros (uno propio no cuenta, y de
   todos modos la API no deja darse like a uno mismo). Umbrales de Skool:
   nivel 1 desde 0, nivel 2 desde 5, … nivel 9 desde 33015. */
export const LEVEL_THRESHOLDS = [0, 5, 20, 65, 155, 515, 2015, 8015, 33015]

export function levelFor(points) {
  const p = Math.max(0, Math.floor(Number(points) || 0))
  let idx = 0
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i -= 1) {
    if (p >= LEVEL_THRESHOLDS[i]) { idx = i; break }
  }
  const currentMin = LEVEL_THRESHOLDS[idx]
  const nextMin = idx + 1 < LEVEL_THRESHOLDS.length ? LEVEL_THRESHOLDS[idx + 1] : null
  const pointsToNext = nextMin === null ? 0 : nextMin - p
  const progress = nextMin === null ? 1 : Math.min(1, Math.max(0, (p - currentMin) / (nextMin - currentMin)))
  return { level: idx + 1, points: p, currentMin, nextMin, pointsToNext, progress }
}

/* SOLO DOCUMENTACIÓN: la expresión para fechas en el JSON. No se interpola
   (el driver la mandaría como texto): se copia literal en el SQL. */
export function isoSql(col) {
  return `to_char(${col} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`
}

const STAFF_ROLES = ["propietario", "admin", "moderador"]
export function isStaffRole(role) {
  return STAFF_ROLES.includes(role)
}
export function isAdminRole(role) {
  return role === "propietario" || role === "admin"
}

/* Puntos de varios miembros en UNA consulta → Map(id → puntos); los que no
   tienen likes quedan en 0. */
export async function pointsFor(sql, ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))]
  const map = new Map(list.map((id) => [id, 0]))
  if (!list.length) return map
  const rows = await sql`
    SELECT author_id, count(*)::int AS points
    FROM academy_likes
    WHERE author_id = ANY(${list}::int[]) AND author_id <> member_id
    GROUP BY 1
  `
  for (const r of rows) map.set(Number(r.author_id), Number(r.points) || 0)
  return map
}

/* Fila → { id, handle, name, avatarUrl, level, role }. Acepta columnas en
   snake_case (SELECT pelado) o camelCase (alias). `points` puede venir en la
   fila o aparte. El avatar vuelve a pasar por safeUrl al salir: si algún día
   se colara algo raro en la base, no llega a un src. */
export function memberMini(row, points) {
  if (!row) return null
  const pts = points ?? row.points ?? 0
  const avatar = row.avatarUrl ?? row.avatar_url ?? null
  return {
    id: Number(row.id),
    handle: row.handle || null,
    name: row.name || "Miembro",
    avatarUrl: avatar && isImageUrl(avatar) ? safeUrl(avatar) : null,
    level: levelFor(pts).level,
    role: row.role || "miembro",
  }
}

/* Links del perfil: solo las 4 llaves conocidas y cada valor otra vez por
   safeUrl (defensa en profundidad: ya se validaron al guardar). */
export function cleanLinks(links) {
  const out = {}
  const src = links && typeof links === "object" && !Array.isArray(links) ? links : {}
  for (const key of ["instagram", "tiktok", "whatsapp", "web"]) {
    const u = safeUrl(src[key])
    if (u) out[key] = u
  }
  return out
}

/* ── Preferencias del miembro (SPEC §2.1) ──────────────────────────────── */
export const DEFAULT_PREFS = Object.freeze({
  notif: { push: true, email: true, likes: true, comments: true, mentions: true, follows: true, events: true },
  chat: { enabled: true, previews: false },
  privacy: { hideActivity: false, hideOnline: false },
  onboarding: { dismissed: false, done: [] },
})

/* prefs de la base (parcial o vacío) → objeto completo con defaults. */
export function normalizePrefs(p) {
  const src = p && typeof p === "object" && !Array.isArray(p) ? p : {}
  const pick = (obj, key, def) => (obj && typeof obj[key] === "boolean" ? obj[key] : def)
  const notif = {}
  for (const [k, v] of Object.entries(DEFAULT_PREFS.notif)) notif[k] = pick(src.notif, k, v)
  const out = {
    notif,
    chat: { enabled: pick(src.chat, "enabled", true), previews: pick(src.chat, "previews", false) },
    privacy: { hideActivity: pick(src.privacy, "hideActivity", false), hideOnline: pick(src.privacy, "hideOnline", false) },
    onboarding: {
      dismissed: pick(src.onboarding, "dismissed", false),
      done: Array.isArray(src.onboarding?.done) ? src.onboarding.done.filter((x) => typeof x === "string").slice(0, 20) : [],
    },
  }
  if (typeof src.tz === "string" && src.tz) out.tz = src.tz
  if (["claro", "oscuro", "auto"].includes(src.theme)) out.theme = src.theme
  return out
}

/* ── MemberPublic ───────────────────────────────────────────────────────────
   MemberMini + { bio, location, links, joinedAt, lastSeenAt, online, points }.
   NUNCA email, teléfono, origen ni prefs. La privacidad se respeta salvo
   para uno mismo: hideActivity oculta lastSeenAt, hideOnline apaga online.
   La fila necesita: id, handle, name, avatar_url, role, bio, location, links,
   prefs, joined_at (ISO), last_seen_at (ISO), online_raw (bool), points. */
export function memberPublicFromRow(row, viewer) {
  if (!row) return null
  const self = Boolean(viewer && Number(viewer.id) === Number(row.id))
  const prefs = normalizePrefs(row.prefs)
  const points = Number(row.points) || 0
  return {
    ...memberMini(row, points),
    bio: row.bio || null,
    location: row.location || null,
    links: cleanLinks(row.links),
    joinedAt: row.joined_at ?? row.joinedAt ?? null,
    lastSeenAt: !self && prefs.privacy.hideActivity ? null : (row.last_seen_at ?? row.lastSeenAt ?? null),
    online: !self && prefs.privacy.hideOnline ? false : Boolean(row.online_raw ?? row.online),
    points,
  }
}

/* Varios MemberPublic en una sola ida a la base → Map(id → MemberPublic).
   `viewer` = ctx.member (o null). Incluye a cualquier estado (un autor
   cancelado sigue apareciendo en sus posts); filtrar activos es cosa de
   quien lista miembros. */
export async function publicMemberRows(sql, ids, viewer) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))]
  const map = new Map()
  if (!list.length) return map
  const rows = await sql`
    SELECT m.id, m.handle, m.name, m.avatar_url, m.role, m.bio, m.location, m.links, m.prefs,
           to_char(m.joined_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS joined_at,
           to_char(m.last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_seen_at,
           (m.last_sync_at IS NOT NULL AND m.last_sync_at > NOW() - interval '90 seconds') AS online_raw,
           COALESCE(p.points, 0)::int AS points
    FROM academy_members m
    LEFT JOIN (
      SELECT author_id, count(*)::int AS points
      FROM academy_likes
      WHERE author_id = ANY(${list}::int[]) AND author_id <> member_id
      GROUP BY author_id
    ) p ON p.author_id = m.id
    WHERE m.id = ANY(${list}::int[])
  `
  for (const r of rows) map.set(Number(r.id), memberPublicFromRow(r, viewer))
  return map
}

/* Grupos (cohortes) activos de un miembro → [ids]. */
export async function memberCohortIds(sql, memberId) {
  const id = Number(memberId)
  if (!Number.isInteger(id) || id <= 0) return []
  const rows = await sql`
    SELECT cm.cohort_id
    FROM academy_cohort_members cm
    JOIN academy_cohorts c ON c.id = cm.cohort_id
    WHERE cm.member_id = ${id} AND c.archived_at IS NULL
    ORDER BY cm.cohort_id
  `
  return rows.map((r) => Number(r.cohort_id))
}

/* ── Ajustes del grupo (SPEC §2.2) ──────────────────────────────────────── */
export const DEFAULT_SETTINGS = Object.freeze({
  group: {
    // Nombre, iniciales, color y links por defecto: los del sitio
    // (api/_academyHost.js). El dueño los cambia en Ajustes.
    name: HOST.brand.name,
    description: "",
    coverUrl: null,
    iconUrl: null,
    initials: HOST.brand.initials,
    color: HOST.brand.color,
    links: (HOST.defaultLinks || []).map((l) => ({ title: l.title, url: l.url })),
    rules: [],
    media: [],
  },
  levels: { names: ["Aprendiz", "Ayudante", "Barbero", "Barbero Pro", "Fader", "Estilista", "Maestro", "Leyenda", "Élite"] },
  plugins: {
    minPostLevel: null,
    minChatLevel: null,
    autoDm: { enabled: true, text: "¡Hola #NOMBRE#! Bienvenido a #GRUPO#. Cualquier duda, escríbeme por acá." },
    welcomeVideoId: null,
  },
  tabs: { comunidad: true, calendario: true, clasificacion: true },
  sync: { enabled: true },
  autoprovision: true,
})

const isPlainObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v)

/* Mezcla profunda: los objetos se combinan llave a llave, los arreglos y los
   valores simples REEMPLAZAN (una lista de reglas guardada no se "suma" a la
   de defaults). `undefined` no pisa nada. La usa admin-settings para aplicar
   un POST parcial sobre lo guardado. */
export function mergeSettings(base, patch) {
  if (!isPlainObject(patch)) return structuredClone(base)
  const out = isPlainObject(base) ? structuredClone(base) : {}
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || k === "__proto__" || k === "constructor" || k === "prototype") continue
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? mergeSettings(out[k], v) : structuredClone(v)
  }
  return out
}

/* Forma mínima garantizada al leer: lo guardado lo valida admin-settings al
   escribir, pero una fila editada a mano no debe romper el front. */
function shapeSettings(s) {
  const out = mergeSettings(DEFAULT_SETTINGS, s)
  const names = Array.isArray(out.levels?.names) ? out.levels.names : []
  out.levels = { names: DEFAULT_SETTINGS.levels.names.map((def, i) => (typeof names[i] === "string" && names[i].trim() ? names[i].trim().slice(0, 20) : def)) }
  const g = out.group
  g.name = typeof g.name === "string" && g.name.trim() ? g.name.trim().slice(0, 60) : DEFAULT_SETTINGS.group.name
  g.description = typeof g.description === "string" ? g.description.slice(0, 4000) : ""
  g.initials = typeof g.initials === "string" && g.initials.trim() ? g.initials.trim().slice(0, 3) : DEFAULT_SETTINGS.group.initials
  g.color = typeof g.color === "string" && /^#[0-9a-fA-F]{6}$/.test(g.color) ? g.color : DEFAULT_SETTINGS.group.color
  g.coverUrl = g.coverUrl && isImageUrl(g.coverUrl) ? safeUrl(g.coverUrl) : null
  g.iconUrl = g.iconUrl && isImageUrl(g.iconUrl) ? safeUrl(g.iconUrl) : null
  g.links = (Array.isArray(g.links) ? g.links : [])
    .map((l) => ({ title: typeof l?.title === "string" ? l.title.slice(0, 60) : "", url: safeUrl(l?.url) }))
    .filter((l) => l.title && l.url)
    .slice(0, 5)
  g.rules = (Array.isArray(g.rules) ? g.rules : [])
    .map((r) => (typeof r === "string" ? { title: r } : r))
    .filter((r) => r && typeof r.title === "string" && r.title.trim())
    .map((r) => ({ title: r.title.slice(0, 120), ...(typeof r.body === "string" ? { body: r.body.slice(0, 1000) } : {}) }))
    .slice(0, 20)
  g.media = (Array.isArray(g.media) ? g.media : [])
    .map((m) => {
      if (m?.kind === "youtube") {
        const videoId = parseYouTubeId(String(m.videoId || ""))
        return videoId ? { kind: "youtube", videoId } : null
      }
      if (m?.kind === "image" && isImageUrl(m.url)) return { kind: "image", url: safeUrl(m.url) }
      return null
    })
    .filter(Boolean)
    .slice(0, 12)
  const lvl = (v) => (Number.isInteger(v) && v >= 1 && v <= 9 ? v : null)
  out.plugins.minPostLevel = lvl(out.plugins.minPostLevel)
  out.plugins.minChatLevel = lvl(out.plugins.minChatLevel)
  out.plugins.welcomeVideoId = out.plugins.welcomeVideoId ? parseYouTubeId(String(out.plugins.welcomeVideoId)) : null
  const dm = isPlainObject(out.plugins.autoDm) ? out.plugins.autoDm : {}
  out.plugins.autoDm = {
    enabled: dm.enabled !== false,
    text: typeof dm.text === "string" && dm.text.trim() ? dm.text.slice(0, 1000) : DEFAULT_SETTINGS.plugins.autoDm.text,
  }
  for (const k of ["comunidad", "calendario", "clasificacion"]) out.tabs[k] = out.tabs[k] !== false
  out.sync = { enabled: out.sync?.enabled !== false }
  out.autoprovision = out.autoprovision !== false
  return out
}

/* Caché por instancia, 60 s: los ajustes se leen en casi todos los modos y
   cambian una vez al mes. invalidateSettings() lo borra (admin-settings al
   guardar). En otra instancia tibia el cambio tarda como mucho 60 s. */
const SETTINGS_TTL_MS = 60 * 1000
let settingsCache = null

export function invalidateSettings() {
  settingsCache = null
}

/* getSettings(sql, { strict }) → ajustes completos.
   Con strict=false (lo normal) un error de base devuelve los defaults — no
   son datos de demo, son la configuración de fábrica — y NO se cachea, para
   reintentar en el próximo request. strict=true relanza el error (para
   admin-settings, que no debe mostrarle defaults al dueño como si fueran lo
   guardado). */
export async function getSettings(sql, { strict = false } = {}) {
  if (settingsCache && Date.now() - settingsCache.at < SETTINGS_TTL_MS) return structuredClone(settingsCache.value)
  try {
    const [row] = await sql`SELECT settings FROM academy_settings WHERE id = 1`
    const value = shapeSettings(row?.settings)
    settingsCache = { at: Date.now(), value }
    return structuredClone(value)
  } catch (err) {
    if (strict) throw err
    console.error("[academy:settings] usando defaults:", err?.code || err?.message || err)
    return shapeSettings(null)
  }
}

/* ── Parámetros ─────────────────────────────────────────────────────────── */
export function intParam(v, { min = 1, max = 2147483647 } = {}) {
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) return null
  return n
}

export function boolParam(v) {
  return v === true || v === 1 || v === "1" || v === "true"
}

export function pageParam(v, maxPage = 1000) {
  return intParam(v, { min: 1, max: maxPage }) || 1
}

/* Cursor opaco: base64url de un JSON chico. Se decodifica con try/catch y
   quien lo usa valida cada campo (lo manda el cliente). */
export function encodeCursor(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url")
}
export function decodeCursor(s) {
  if (typeof s !== "string" || !s || s.length > 500) return null
  try {
    const v = JSON.parse(Buffer.from(s, "base64url").toString("utf8"))
    return isPlainObject(v) ? v : null
  } catch {
    return null
  }
}

/* Trabajo después de responder. En Vercel, lo que sigue corriendo tras
   `res.json()` no está garantizado: la instancia se puede congelar. Si el
   runtime expone waitUntil (el contexto de request de Vercel, lo mismo que
   usa @vercel/functions por dentro), se registra ahí y se devuelve true; si
   no, false — y quien llama debe esperar el trabajo ANTES de responder. */
export function runInBackground(promise) {
  try {
    const ctx = globalThis[Symbol.for("@vercel/request-context")]?.get?.()
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(Promise.resolve(promise).catch((err) => console.error("[academy:bg]", err?.message || err)))
      return true
    }
  } catch {
    // Sin contexto de Vercel (tests, local): el llamador espera.
  }
  return false
}

/* Código de error de Postgres (NeonDbError trae .code). */
export function pgCode(err) {
  return err && typeof err.code === "string" ? err.code : null
}
