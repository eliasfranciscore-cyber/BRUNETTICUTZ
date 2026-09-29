/* ACADEMY — Comunidad (feed, publicaciones, comentarios, likes,
   encuestas, seguir, reportes, miembros, perfil, clasificación, búsqueda)
   ------------------------------------------------------------------
   Lo despacha api/_academy.js (MODE_OWNERS). Cada modo recibe
   ctx = { sql, req, res, query, body, member, admin, ip } con la sesión ya
   validada por el router y devuelve un objeto (el router arma {ok:true,...}).

   VISIBILIDAD, la regla que no se negocia: un post se ve si no está borrado
   y su categoría no es de un Grupo, o el miembro está en ese Grupo, o es
   staff (propietario/admin/moderador). Esa condición va DENTRO del SQL de
   cada lectura y escritura por id (post, like, comentario, encuesta, seguir,
   reportar, búsqueda, perfil): un id adivinado de un Grupo ajeno responde
   404, igual que uno que no existe. No hay un "cargo el post y después miro":
   el driver de Neon no anida fragmentos, así que el predicado se repite
   literal en cada query, siempre con el mismo alias `c` para la categoría.

   Contadores (like_count, comment_count) se tocan en el MISMO statement que
   el like o el comentario (CTE), para que un doble clic o dos pestañas no los
   descuadren. Los puntos NO son un contador: se cuentan desde academy_likes
   (1 like de otro miembro = 1 punto), así un "ya no me gusta" o un contenido
   borrado se corrigen solos.

   Nada de datos de demo acá: un error de base es un 500 del router.
   ================================================================ */

import {
  HttpError,
  LEVEL_THRESHOLDS,
  levelFor,
  pointsFor,
  getSettings,
  isStaffRole,
  publicMemberRows,
  memberMini,
} from "./_academyHttp.js"
import { safeUrl, isImageUrl, parseYouTubeId, cleanText, extractMentions } from "./_academyText.js"
import { notify, notifyMany, memberMinis } from "./_academyNotify.js"
import { HOST } from "./_academyHost.js"

// Ruta base de la Academy en este sitio ("/academy"); ver api/_academyHost.js.
const BASE = HOST.basePath

// Import perezoso: _academyCourses.js es de otro dueño y trae su propia
// lógica de acceso; si no carga, solo fallan los modos que lo necesitan.
const loadCourses = () => import("./_academyCourses.js")

const FEED_PAGE = 20
const MEMBERS_PAGE = 30
const MAX_CATEGORIES = 10
const MAX_PINNED = 3
const VIDEO_RE = /^[A-Za-z0-9_-]{11}$/
const NUM_RE = /^-?\d{1,20}(\.\d{1,9})?$/
const DEFAULT_LEVEL_NAMES = ["Aprendiz", "Ayudante", "Barbero", "Barbero Pro", "Fader", "Estilista", "Maestro", "Leyenda", "Élite"]

// sort → [clave de orden, ventana en días | null]
const SORTS = {
  default: ["act", null],
  nuevos: ["new", null],
  "top-dia": ["top", 1],
  "top-semana": ["top", 7],
  "top-mes": ["top", 30],
  "top-ano": ["top", 365],
  "top-año": ["top", 365],
  "top-siempre": ["top", null],
  "no-leidos": ["act", null],
}
const CATEGORY_SORT = { default: "default", nuevos: "nuevos", top: "top-semana" }

/* ── Utilidades ─────────────────────────────────────────────────────────── */

function toId(v) {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null
}

const isAdminRole = (role) => role === "propietario" || role === "admin"

// En los modos de miembro ctx.member siempre existe. En los modos admin/mod
// puede entrar un barbero admin sin fila de miembro (ctx.admin sin memberId).
function viewerOf(ctx) {
  if (ctx.member) return ctx.member
  if (ctx.admin) return { id: ctx.admin.memberId ?? null, role: ctx.admin.role || "admin", prefs: {} }
  return { id: null, role: null, prefs: {} }
}

function actorOf(ctx) {
  return {
    memberId: ctx.member?.id ?? ctx.admin?.memberId ?? null,
    role: ctx.member?.role ?? ctx.admin?.role ?? null,
  }
}

function clip(s, n) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim()
  if (!t) return null
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t
}

function excerptOf(body) {
  const t = String(body || "").replace(/\s+/g, " ").trim()
  return t.length > 220 ? `${t.slice(0, 219).trimEnd()}…` : t
}

function text(v, max) {
  return cleanText(String(v ?? ""), max) || ""
}

// El título es una línea: los saltos de línea se vuelven espacios.
function cleanTitle(v) {
  return text(v, 160).replace(/\s*\n+\s*/g, " ").trim()
}

// ILIKE con los comodines del usuario escapados: buscar "100%" no debe
// devolver todo, ni "_" calzar con cualquier letra.
function likePattern(q) {
  return `%${String(q).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`
}

function encodeCursor(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url")
}

function decodeCursor(raw) {
  if (!raw || typeof raw !== "string" || raw.length > 300) return null
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
    return v && typeof v === "object" ? v : null
  } catch {
    return null
  }
}

function pointsOf(map, id) {
  if (!map || typeof map.get !== "function") return 0
  return Number(map.get(id) ?? map.get(String(id)) ?? 0) || 0
}

function isoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
}

function levelNames(settings) {
  const names = Array.isArray(settings?.levels?.names) ? settings.levels.names : []
  return DEFAULT_LEVEL_NAMES.map((d, i) => String(names[i] || "").trim() || d)
}

/* Límite en memoria por instancia caliente, contra el spam de un miembro
   (publicar 50 posts seguidos). NO usa la tabla rate_limits a propósito:
   rateLimit() hace CREATE TABLE IF NOT EXISTS en cada llamada, y la regla es
   cero DDL en caminos calientes. Es best-effort (otra instancia empieza de
   cero), suficiente para frenar un script torpe; el staff no tiene límite. */
const localHits = new Map()
function underLimit(key, max, windowMs) {
  const now = Date.now()
  const recent = (localHits.get(key) || []).filter((t) => now - t < windowMs)
  if (recent.length >= max) {
    localHits.set(key, recent)
    return false
  }
  recent.push(now)
  localHits.set(key, recent)
  if (localHits.size > 5000) {
    for (const [k, v] of localHits) if (!v.length || now - v[v.length - 1] > 3600e3) localHits.delete(k)
  }
  return true
}

/* ── Contenido del usuario: validación al guardar ──────────────────────── */

// Imágenes: solo del Blob del proyecto o /assets/. Una URL cualquiera sería
// un pixel de rastreo (o algo peor) servido en el mismo origen que el panel.
function cleanAttachments(list) {
  if (list == null) return []
  if (!Array.isArray(list)) throw new HttpError(400, "Adjuntos inválidos")
  if (list.length > 4) throw new HttpError(400, "Puedes adjuntar hasta 4 imágenes")
  return list.map((a) => {
    const url = safeUrl(a?.url)
    if (!url || !isImageUrl(url)) throw new HttpError(400, "Una de las imágenes no es válida")
    return { kind: "image", url, w: dim(a?.w), h: dim(a?.h) }
  })
}

function dim(v) {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n > 0 && n <= 20000 ? n : null
}

// Al proyectar se vuelve a filtrar: defensa en profundidad por si una fila
// vieja o escrita a mano trae algo raro.
function outAttachments(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const a of list) {
    const url = safeUrl(a?.url)
    if (url && isImageUrl(url)) out.push({ kind: "image", url, w: dim(a?.w), h: dim(a?.h) })
  }
  return out
}

function cleanPoll(poll) {
  const options = Array.isArray(poll?.options) ? poll.options : null
  if (!options) throw new HttpError(400, "La encuesta necesita opciones")
  const clean = options.map((o) => text(typeof o === "string" ? o : o?.text, 80).replace(/\s*\n+\s*/g, " ").trim())
  if (clean.length < 2 || clean.length > 10) throw new HttpError(400, "La encuesta lleva entre 2 y 10 opciones")
  if (clean.some((o) => !o)) throw new HttpError(400, "Hay una opción de la encuesta vacía")
  return { options: clean.map((t) => ({ text: t })) }
}

function samePoll(a, b) {
  const norm = (p) => (p && Array.isArray(p.options) ? p.options.map((o) => String(o?.text ?? "")) : null)
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b))
}

function pollOut(poll, counts, myVote) {
  if (!poll || !Array.isArray(poll.options)) return null
  const c = counts && typeof counts === "object" ? counts : {}
  const options = poll.options.map((o, i) => ({ text: String(o?.text ?? ""), votes: Number(c[String(i)]) || 0 }))
  return {
    options,
    total: options.reduce((n, o) => n + o.votes, 0),
    myVote: Number.isInteger(myVote) ? myVote : null,
  }
}

/* @menciones → ids de miembros activos. El handle automático es
   '<slug>-<id>', puede pasar de 40 caracteres, por eso el tope es 60. */
async function resolveMentions(sql, raw) {
  let handles = []
  try {
    handles = extractMentions(String(raw || "")) || []
  } catch {
    handles = []
  }
  handles = [...new Set(handles.map((h) => String(h).replace(/^@/, "").toLowerCase()))]
    .filter((h) => /^[a-z0-9-]{1,60}$/.test(h))
    .slice(0, 20)
  if (!handles.length) return []
  const rows = await sql`
    SELECT id FROM academy_members
     WHERE handle = ANY(${handles}::text[]) AND status = 'activo' AND deleted_at IS NULL
  `
  return rows.map((r) => r.id)
}

/* ── Tarjetas de publicación ────────────────────────────────────────────── */

async function postCardRows(sql, ids, viewer) {
  const list = [...new Set(ids.map(toId).filter(Boolean))]
  if (!list.length) return []
  const me = viewer?.id ?? null
  const staff = isStaffRole(viewer?.role)
  return sql`
    SELECT p.id, p.author_id, p.category_id, c.name AS category_name, c.emoji AS category_emoji,
           p.title, p.body, p.attachments, p.video_id, p.poll,
           (p.pinned_at IS NOT NULL) AS pinned, p.comments_locked, p.like_count, p.comment_count,
           to_char(p.last_comment_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_comment_at,
           to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
           to_char(p.edited_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS edited_at,
           EXISTS (SELECT 1 FROM academy_likes l
                    WHERE l.member_id = ${me}::int AND l.target_type = 'post' AND l.target_id = p.id) AS liked,
           EXISTS (SELECT 1 FROM academy_follows f
                    WHERE f.member_id = ${me}::int AND f.target_type = 'post' AND f.target_id = p.id) AS following,
           (r.read_at IS NULL OR (p.last_comment_at IS NOT NULL AND p.last_comment_at > r.read_at)) AS unread,
           CASE WHEN p.poll IS NULL THEN NULL ELSE (
             SELECT COALESCE(jsonb_object_agg(v.option_idx::text, v.n), '{}'::jsonb)
               FROM (SELECT option_idx, count(*)::int AS n FROM academy_poll_votes
                      WHERE post_id = p.id GROUP BY option_idx) v
           ) END AS poll_counts,
           (SELECT option_idx FROM academy_poll_votes WHERE post_id = p.id AND member_id = ${me}::int) AS my_vote,
           (SELECT COALESCE(jsonb_agg(x.author_id ORDER BY x.last DESC), '[]'::jsonb)
              FROM (SELECT author_id, max(created_at) AS last FROM academy_comments
                     WHERE post_id = p.id AND deleted_at IS NULL
                     GROUP BY author_id ORDER BY 2 DESC LIMIT 4) x) AS commenter_ids
      FROM academy_posts p
      LEFT JOIN academy_categories c ON c.id = p.category_id
      LEFT JOIN academy_post_reads r ON r.member_id = ${me}::int AND r.post_id = p.id
     WHERE p.id = ANY(${list}::int[]) AND p.deleted_at IS NULL
       AND (c.cohort_id IS NULL OR ${staff}::boolean
            OR EXISTS (SELECT 1 FROM academy_cohort_members vcm
                        WHERE vcm.cohort_id = c.cohort_id AND vcm.member_id = ${me}::int))
  `
}

function cardMemberIds(rows) {
  const ids = []
  for (const r of rows) {
    ids.push(r.author_id)
    if (Array.isArray(r.commenter_ids)) ids.push(...r.commenter_ids)
  }
  return ids
}

function buildCard(r, minis) {
  return {
    id: r.id,
    author: minis.get(r.author_id) || null,
    category: r.category_id && r.category_name
      ? { id: r.category_id, name: r.category_name, emoji: r.category_emoji || null }
      : null,
    title: r.title,
    excerpt: excerptOf(r.body),
    body: r.body || "",
    attachments: outAttachments(r.attachments),
    videoId: VIDEO_RE.test(r.video_id || "") ? r.video_id : null,
    poll: pollOut(r.poll, r.poll_counts, r.my_vote),
    pinned: !!r.pinned,
    commentsLocked: !!r.comments_locked,
    likeCount: r.like_count || 0,
    liked: !!r.liked,
    commentCount: r.comment_count || 0,
    lastCommentAt: r.last_comment_at || null,
    commenters: (Array.isArray(r.commenter_ids) ? r.commenter_ids : []).map((id) => minis.get(id)).filter(Boolean),
    createdAt: r.created_at,
    editedAt: r.edited_at || null,
    unread: !!r.unread,
    following: !!r.following,
  }
}

// Tarjetas en el orden de `ids`; las que el miembro no puede ver no salen.
async function postCards(sql, ids, viewer) {
  const rows = await postCardRows(sql, ids, viewer)
  if (!rows.length) return []
  const minis = await memberMinis(sql, cardMemberIds(rows))
  const byId = new Map(rows.map((r) => [r.id, buildCard(r, minis)]))
  return ids.map((id) => byId.get(toId(id))).filter(Boolean)
}

/* ── Comentarios ────────────────────────────────────────────────────────── */

function buildComments(rows, minis) {
  // Un comentario borrado solo se deja (vacío) si todavía tiene respuestas
  // vivas, para no dejar huérfano el hilo. Las respuestas borradas se van.
  const liveReplies = new Set()
  for (const r of rows) if (r.parent_id && !r.deleted) liveReplies.add(r.parent_id)
  const out = []
  for (const r of rows) {
    if (r.deleted && (r.parent_id || !liveReplies.has(r.id))) continue
    out.push({
      id: r.id,
      postId: r.post_id ?? null,
      lessonId: r.lesson_id ?? null,
      parentId: r.parent_id ?? null,
      author: r.deleted ? null : minis.get(r.author_id) || null,
      body: r.deleted ? "" : r.body,
      likeCount: r.like_count || 0,
      liked: !!r.liked,
      createdAt: r.created_at,
      editedAt: r.edited_at || null,
      deleted: !!r.deleted,
    })
  }
  return out
}

async function lessonCommentRows(sql, lessonId, viewer) {
  return sql`
    SELECT cm.id, cm.post_id, cm.lesson_id, cm.parent_id, cm.author_id, cm.body, cm.like_count,
           (cm.deleted_at IS NOT NULL) AS deleted,
           to_char(cm.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
           to_char(cm.edited_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS edited_at,
           EXISTS (SELECT 1 FROM academy_likes l
                    WHERE l.member_id = ${viewer.id}::int AND l.target_type = 'comment' AND l.target_id = cm.id) AS liked
      FROM academy_comments cm
     WHERE cm.lesson_id = ${lessonId}::int
     ORDER BY cm.created_at ASC, cm.id ASC
     LIMIT 1000
  `
}

/* Carga el destino de un like/reporte/encuesta con la visibilidad incluida.
   Devuelve { authorId, postId, lessonId, preview, routeExtra } o lanza 404
   (inexistente o invisible: misma respuesta, no se filtra qué existe). */
async function loadTarget(sql, viewer, type, id) {
  const staff = isStaffRole(viewer.role)
  if (type === "post") {
    const [p] = await sql`
      SELECT p.id, p.author_id, p.title
        FROM academy_posts p
        LEFT JOIN academy_categories c ON c.id = p.category_id
       WHERE p.id = ${id}::int AND p.deleted_at IS NULL
         AND (c.cohort_id IS NULL OR ${staff}::boolean
              OR EXISTS (SELECT 1 FROM academy_cohort_members vcm
                          WHERE vcm.cohort_id = c.cohort_id AND vcm.member_id = ${viewer.id}::int))
    `
    if (!p) throw new HttpError(404, "Publicación no encontrada")
    return { authorId: p.author_id, postId: p.id, lessonId: null, preview: p.title, routeExtra: {} }
  }
  if (type === "comment") {
    const [cm] = await sql`
      SELECT cm.id, cm.author_id, cm.body, cm.post_id, cm.lesson_id,
             ls.slug AS lesson_slug, co.slug AS course_slug,
             (cm.post_id IS NULL OR EXISTS (
               SELECT 1 FROM academy_posts p
                 LEFT JOIN academy_categories c ON c.id = p.category_id
                WHERE p.id = cm.post_id AND p.deleted_at IS NULL
                  AND (c.cohort_id IS NULL OR ${staff}::boolean
                       OR EXISTS (SELECT 1 FROM academy_cohort_members vcm
                                   WHERE vcm.cohort_id = c.cohort_id AND vcm.member_id = ${viewer.id}::int)))) AS visible
        FROM academy_comments cm
        LEFT JOIN academy_lessons ls ON ls.id = cm.lesson_id
        LEFT JOIN academy_courses co ON co.id = ls.course_id
       WHERE cm.id = ${id}::int AND cm.deleted_at IS NULL
    `
    if (!cm || !cm.visible) throw new HttpError(404, "Comentario no encontrado")
    if (cm.lesson_id) {
      const { canAccessLesson } = await loadCourses()
      if (!(await canAccessLesson(sql, viewer, cm.lesson_id))) {
        throw new HttpError(403, "No tienes acceso a esta lección", "locked")
      }
    }
    return {
      authorId: cm.author_id,
      postId: cm.post_id ?? null,
      lessonId: cm.lesson_id ?? null,
      preview: clip(cm.body, 140),
      routeExtra: cm.lesson_id ? { courseSlug: cm.course_slug, lessonSlug: cm.lesson_slug } : {},
    }
  }
  throw new HttpError(400, "Tipo de contenido inválido")
}

/* Predicado exportado por si otro módulo necesita la misma regla (p. ej. un
   proxy de archivos). Mismo SQL que en todas las lecturas de este archivo. */
export async function canSeePost(sql, member, postId) {
  const id = toId(postId)
  if (!id || !member) return false
  const staff = isStaffRole(member.role)
  const [row] = await sql`
    SELECT 1 AS ok
      FROM academy_posts p
      LEFT JOIN academy_categories c ON c.id = p.category_id
     WHERE p.id = ${id}::int AND p.deleted_at IS NULL
       AND (c.cohort_id IS NULL OR ${staff}::boolean
            OR EXISTS (SELECT 1 FROM academy_cohort_members vcm
                        WHERE vcm.cohort_id = c.cohort_id AND vcm.member_id = ${member.id ?? null}::int))
  `
  return !!row
}

/* ── Proyecciones de miembros ───────────────────────────────────────────── */

// Respaldo local de MemberPublic (§4.3) por si publicMemberRows no trae una
// fila (p. ej. si filtra por activos y un admin mira la pestaña Expulsado).
// Nunca email, teléfono, source ni prefs.
function publicFromRow(r, viewer) {
  const points = Number(r.points) || 0
  const mini = memberMini({ ...r, points }) || {}
  const self = viewer?.id != null && viewer.id === r.id
  const privacy = (r.prefs && r.prefs.privacy) || {}
  const links = r.links && typeof r.links === "object" && !Array.isArray(r.links) ? r.links : {}
  const avatar = safeUrl(mini.avatarUrl ?? r.avatar_url)
  return {
    ...mini,
    avatarUrl: avatar && isImageUrl(avatar) ? avatar : null,
    bio: r.bio || null,
    location: r.location || null,
    links,
    joinedAt: r.joined_at || null,
    lastSeenAt: privacy.hideActivity === true && !self ? null : r.last_seen_at || null,
    online: privacy.hideOnline === true && !self ? false : !!r.online_raw,
    points,
  }
}

async function publicProjection(sql, rows, viewer) {
  if (!rows.length) return []
  let map = null
  try {
    map = await publicMemberRows(sql, rows.map((r) => r.id), viewer)
  } catch (err) {
    console.error("[academy:community] publicMemberRows:", err?.message || err)
  }
  if (map && !(map instanceof Map) && typeof map === "object") {
    map = new Map(Object.entries(map).map(([k, v]) => [Number(k), v]))
  }
  return rows.map((r) => (map && map.get(r.id)) || publicFromRow(r, viewer))
}

// MemberAdmin = MemberPublic + datos de cuenta, cursos y Grupos. Solo para
// propietario/admin: los moderadores (como en Skool) no ven correos.
async function adminProjection(sql, rows, publicList) {
  const ids = rows.map((r) => r.id)
  const [grants, cohorts] = ids.length
    ? await Promise.all([
        sql`
          SELECT g.member_id, g.id, g.course_id, co.title AS course_title, g.state, g.source
            FROM academy_grants g
            JOIN academy_courses co ON co.id = g.course_id
           WHERE g.member_id = ANY(${ids}::int[])
           ORDER BY g.created_at, g.id
        `,
        sql`
          SELECT cm.member_id, ch.id, ch.name
            FROM academy_cohort_members cm
            JOIN academy_cohorts ch ON ch.id = cm.cohort_id
           WHERE cm.member_id = ANY(${ids}::int[]) AND ch.archived_at IS NULL
           ORDER BY ch.name
        `,
      ])
    : [[], []]
  const byMember = (list, map) => {
    const m = new Map()
    for (const x of list) {
      if (!m.has(x.member_id)) m.set(x.member_id, [])
      m.get(x.member_id).push(map(x))
    }
    return m
  }
  const g = byMember(grants, (x) => ({ id: x.id, courseId: x.course_id, courseTitle: x.course_title, state: x.state, source: x.source }))
  const c = byMember(cohorts, (x) => ({ id: x.id, name: x.name }))
  return rows.map((r, i) => ({
    ...publicList[i],
    email: r.email,
    phone: r.phone || null,
    status: r.status,
    source: r.source,
    lastLoginAt: r.last_login_at || null,
    credentialsSentAt: r.credentials_sent_at || null,
    mustChangePassword: !!r.must_change_password,
    grants: g.get(r.id) || [],
    cohorts: c.get(r.id) || [],
  }))
}

/* ── Avisos de una publicación nueva ────────────────────────────────────── */

async function fanOutNewPost(sql, { postId, actorId, title, body, adminsOnly }) {
  try {
    const skip = new Set([actorId])
    const mentioned = (await resolveMentions(sql, `${title}\n${body}`)).filter((id) => !skip.has(id))
    if (mentioned.length) {
      await notifyMany(sql, mentioned, {
        kind: "mencion", actorId, targetType: "post", targetId: postId, preview: title,
        groupKey: `mencion:post:${postId}`, requirePostId: postId,
      })
      mentioned.forEach((id) => skip.add(id))
    }
    if (adminsOnly) {
      // Categoría de anuncios: le llega a todos, solo en la campana (sin
      // push) para no despertar 300 teléfonos por cada anuncio.
      const all = await sql`SELECT id FROM academy_members WHERE status = 'activo' AND deleted_at IS NULL`
      const ids = all.map((r) => r.id).filter((id) => !skip.has(id))
      if (ids.length) {
        await notifyMany(sql, ids, {
          kind: "anuncio", actorId, targetType: "post", targetId: postId, preview: title,
          groupKey: `anuncio:post:${postId}`, push: false, requirePostId: postId,
        })
      }
      return
    }
    const followers = await sql`
      SELECT member_id AS id FROM academy_follows WHERE target_type = 'miembro' AND target_id = ${actorId}::int
    `
    const ids = followers.map((r) => r.id).filter((id) => !skip.has(id))
    if (ids.length) {
      await notifyMany(sql, ids, {
        kind: "post_seguido", actorId, targetType: "post", targetId: postId, preview: title,
        groupKey: `post_seguido:${postId}`, requirePostId: postId,
      })
    }
  } catch (err) {
    console.error("[academy:post-save] avisos:", err?.message || err)
  }
}

/* ── Modos ──────────────────────────────────────────────────────────────── */

async function feed(ctx) {
  const { sql, query } = ctx
  const viewer = viewerOf(ctx)
  const me = viewer.id
  const staff = isStaffRole(viewer.role)
  const categoryId = toId(query.category ?? query.categoryId)
  const followingOnly = String(query.filter || "") === "siguiendo"

  // Promise.resolve: la query de Neon es un thenable perezoso; así se ejecuta
  // una sola vez aunque se espere en dos lugares.
  const catsPromise = Promise.resolve(sql`
    SELECT c.id, c.name, c.emoji, c.position, c.write_role, c.default_sort, c.cohort_id
      FROM academy_categories c
     WHERE c.cohort_id IS NULL OR ${staff}::boolean
        OR EXISTS (SELECT 1 FROM academy_cohort_members vcm
                    WHERE vcm.cohort_id = c.cohort_id AND vcm.member_id = ${me}::int)
     ORDER BY c.position, c.id
  `)

  let sort = SORTS[query.sort] ? String(query.sort) : null
  if (!sort) {
    // Sin orden explícito, manda el orden por defecto de la categoría.
    const cats = await catsPromise
    const cat = categoryId ? cats.find((c) => c.id === categoryId) : null
    sort = (cat && CATEGORY_SORT[cat.default_sort]) || "default"
  }
  const [key, days] = SORTS[sort]
  const unreadOnly = sort === "no-leidos"

  const cur = decodeCursor(query.cursor)
  const curOk = cur && cur.s === sort && NUM_RE.test(String(cur.k)) && toId(cur.id)
  const curK = curOk ? String(cur.k) : null
  const curId = curOk ? toId(cur.id) : null

  /* Keyset por (clave, id): la clave depende del orden (actividad, fecha o
     likes) y viaja como texto numérico con microsegundos, así una página
     nunca repite ni se salta posts aunque entren comentarios nuevos. Los
     fijados salen aparte (solo en la primera página) y nunca en la lista. */
  const idsPromise = sql`
    SELECT p.id,
           (CASE ${key}::text WHEN 'top' THEN p.like_count::numeric
                              WHEN 'new' THEN extract(epoch FROM p.created_at)::numeric
                              ELSE extract(epoch FROM p.last_activity_at)::numeric END)::text AS k
      FROM academy_posts p
      LEFT JOIN academy_categories c ON c.id = p.category_id
      LEFT JOIN academy_post_reads r ON r.member_id = ${me}::int AND r.post_id = p.id
     WHERE p.deleted_at IS NULL AND p.pinned_at IS NULL
       AND (c.cohort_id IS NULL OR ${staff}::boolean
            OR EXISTS (SELECT 1 FROM academy_cohort_members vcm
                        WHERE vcm.cohort_id = c.cohort_id AND vcm.member_id = ${me}::int))
       AND (${categoryId}::int IS NULL OR p.category_id = ${categoryId}::int)
       AND (${days}::int IS NULL OR p.created_at >= NOW() - make_interval(days => ${days}::int))
       AND (NOT ${unreadOnly}::boolean OR r.read_at IS NULL
            OR (p.last_comment_at IS NOT NULL AND p.last_comment_at > r.read_at))
       AND (NOT ${followingOnly}::boolean OR EXISTS (
             SELECT 1 FROM academy_follows f
              WHERE f.member_id = ${me}::int
                AND ((f.target_type = 'post' AND f.target_id = p.id)
                     OR (f.target_type = 'miembro' AND f.target_id = p.author_id))))
       AND (${curK}::numeric IS NULL OR
            ((CASE ${key}::text WHEN 'top' THEN p.like_count::numeric
                                WHEN 'new' THEN extract(epoch FROM p.created_at)::numeric
                                ELSE extract(epoch FROM p.last_activity_at)::numeric END), p.id)
            < (${curK}::numeric, ${curId}::int))
     ORDER BY (CASE ${key}::text WHEN 'top' THEN p.like_count::numeric
                                 WHEN 'new' THEN extract(epoch FROM p.created_at)::numeric
                                 ELSE extract(epoch FROM p.last_activity_at)::numeric END) DESC,
              p.id DESC
     LIMIT ${FEED_PAGE + 1}::int
  `
  const pinnedPromise = curK
    ? Promise.resolve([])
    : sql`
        SELECT p.id
          FROM academy_posts p
          LEFT JOIN academy_categories c ON c.id = p.category_id
         WHERE p.deleted_at IS NULL AND p.pinned_at IS NOT NULL
           AND (c.cohort_id IS NULL OR ${staff}::boolean
                OR EXISTS (SELECT 1 FROM academy_cohort_members vcm
                            WHERE vcm.cohort_id = c.cohort_id AND vcm.member_id = ${me}::int))
           AND (${categoryId}::int IS NULL OR p.category_id = ${categoryId}::int)
         ORDER BY p.pinned_at DESC
         LIMIT ${MAX_PINNED}::int
      `

  const [cats, idRows, pinnedRows] = await Promise.all([catsPromise, idsPromise, pinnedPromise])
  const pageRows = idRows.slice(0, FEED_PAGE)
  const pinnedIds = pinnedRows.map((r) => r.id)
  const pageIds = pageRows.map((r) => r.id)
  const cards = await postCards(sql, [...pinnedIds, ...pageIds], viewer)
  const byId = new Map(cards.map((c) => [c.id, c]))
  const last = pageRows[pageRows.length - 1]

  return {
    pinned: pinnedIds.map((id) => byId.get(id)).filter(Boolean),
    posts: pageIds.map((id) => byId.get(id)).filter(Boolean),
    nextCursor: idRows.length > FEED_PAGE && last ? encodeCursor({ s: sort, k: last.k, id: last.id }) : null,
    sort,
    categories: cats.map((c) => ({
      id: c.id,
      name: c.name,
      emoji: c.emoji || null,
      position: c.position,
      writeRole: c.write_role,
      defaultSort: c.default_sort,
      cohortId: c.cohort_id ?? null,
    })),
  }
}

async function postDetail(ctx) {
  const { sql, query } = ctx
  const viewer = viewerOf(ctx)
  const id = toId(query.id)
  if (!id) throw new HttpError(400, "Publicación inválida")
  const staff = isStaffRole(viewer.role)

  // Tarjeta, comentarios y "leído" en paralelo; los tres llevan la regla de
  // visibilidad adentro, así que un post ajeno no marca nada ni filtra nada.
  const [rows, commentRows] = await Promise.all([
    postCardRows(sql, [id], viewer),
    sql`
      SELECT cm.id, cm.post_id, cm.lesson_id, cm.parent_id, cm.author_id, cm.body, cm.like_count,
             (cm.deleted_at IS NOT NULL) AS deleted,
             to_char(cm.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
             to_char(cm.edited_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS edited_at,
             EXISTS (SELECT 1 FROM academy_likes l
                      WHERE l.member_id = ${viewer.id}::int AND l.target_type = 'comment' AND l.target_id = cm.id) AS liked
        FROM academy_comments cm
        JOIN academy_posts p ON p.id = cm.post_id
        LEFT JOIN academy_categories c ON c.id = p.category_id
       WHERE cm.post_id = ${id}::int AND p.deleted_at IS NULL
         AND (c.cohort_id IS NULL OR ${staff}::boolean
              OR EXISTS (SELECT 1 FROM academy_cohort_members vcm
                          WHERE vcm.cohort_id = c.cohort_id AND vcm.member_id = ${viewer.id}::int))
       ORDER BY cm.created_at ASC, cm.id ASC
       LIMIT 1000
    `,
    sql`
      INSERT INTO academy_post_reads (member_id, post_id, read_at)
      SELECT ${viewer.id}::int, p.id, NOW()
        FROM academy_posts p
        LEFT JOIN academy_categories c ON c.id = p.category_id
       WHERE p.id = ${id}::int AND p.deleted_at IS NULL
         AND (c.cohort_id IS NULL OR ${staff}::boolean
              OR EXISTS (SELECT 1 FROM academy_cohort_members vcm
                          WHERE vcm.cohort_id = c.cohort_id AND vcm.member_id = ${viewer.id}::int))
      ON CONFLICT (member_id, post_id) DO UPDATE SET read_at = NOW()
    `,
  ])
  if (!rows.length) throw new HttpError(404, "Publicación no encontrada")
  const minis = await memberMinis(sql, [...cardMemberIds(rows), ...commentRows.map((r) => r.author_id)])
  const post = buildCard(rows[0], minis)
  // Recién abierta: ya no es "no leída" para quien la está mirando.
  post.unread = false
  return { post, comments: buildComments(commentRows, minis) }
}

async function postSave(ctx) {
  const { sql, body } = ctx
  const me = viewerOf(ctx)
  const staff = isStaffRole(me.role)
  const admin = isAdminRole(me.role)
  const id = toId(body.id)

  const title = cleanTitle(body.title)
  if (!title) throw new HttpError(400, "Escribe un título")
  const bodyText = text(body.body, 10000)
  const attachments = cleanAttachments(body.attachments)
  const videoRaw = body.video ?? body.videoId
  let videoId = null
  if (videoRaw) {
    videoId = parseYouTubeId(String(videoRaw))
    if (!videoId || !VIDEO_RE.test(videoId)) throw new HttpError(400, "El enlace de YouTube no es válido")
  }
  const pollGiven = body.poll !== undefined
  const poll = body.poll ? cleanPoll(body.poll) : null

  // Estado actual (solo al editar).
  let current = null
  if (id) {
    const [row] = await sql`
      SELECT p.id, p.author_id, p.category_id, p.poll,
             EXISTS (SELECT 1 FROM academy_poll_votes v WHERE v.post_id = p.id) AS has_votes
        FROM academy_posts p
        LEFT JOIN academy_categories c ON c.id = p.category_id
       WHERE p.id = ${id}::int AND p.deleted_at IS NULL
         AND (c.cohort_id IS NULL OR ${staff}::boolean
              OR EXISTS (SELECT 1 FROM academy_cohort_members vcm
                          WHERE vcm.cohort_id = c.cohort_id AND vcm.member_id = ${me.id}::int))
    `
    if (!row) throw new HttpError(404, "Publicación no encontrada")
    if (row.author_id !== me.id && !staff) throw new HttpError(403, "Solo el autor puede editar esta publicación")
    current = row
  }

  const categoryId = body.categoryId === undefined && current ? current.category_id : toId(body.categoryId)
  const categoryChanged = !current || categoryId !== current.category_id
  let category = null
  if (categoryId) {
    const [cat] = await sql`
      SELECT c.id, c.write_role, c.cohort_id,
             (c.cohort_id IS NULL OR ${staff}::boolean
              OR EXISTS (SELECT 1 FROM academy_cohort_members vcm
                          WHERE vcm.cohort_id = c.cohort_id AND vcm.member_id = ${me.id}::int)) AS visible
        FROM academy_categories c
       WHERE c.id = ${categoryId}::int
    `
    if (!cat || !cat.visible) throw new HttpError(400, "Esa categoría no existe")
    // Skool: en una categoría "solo admins" nadie más publica NI mueve posts.
    if (categoryChanged && cat.write_role === "admins" && !admin) {
      throw new HttpError(403, "Solo los administradores pueden publicar en esa categoría", "categoria")
    }
    category = cat
  } else if (categoryChanged) {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM academy_categories`
    if (n > 0) throw new HttpError(400, "Elige una categoría")
  }

  let postId = id
  if (!current) {
    if (!staff) {
      if (!underLimit(`post:${me.id}`, 10, 10 * 60e3)) {
        throw new HttpError(429, "Estás publicando muy seguido. Espera unos minutos.")
      }
      const settings = await getSettings(sql)
      const minLevel = Number(settings?.plugins?.minPostLevel) || 0
      if (minLevel > 1) {
        const pts = pointsOf(await pointsFor(sql, [me.id]), me.id)
        if (levelFor(pts).level < minLevel) {
          throw new HttpError(403, `Necesitas llegar al Nivel ${minLevel} para publicar. Mientras, comenta y ayuda a otros: cada me gusta suma un punto.`, "level")
        }
      }
    }
    /* Post, auto-seguimiento del autor y "leído" del autor en un solo
       statement: si algo falla, no queda un post que su autor no sigue ni
       uno que le aparece como no leído. */
    const [row] = await sql`
      WITH p AS (
        INSERT INTO academy_posts (author_id, category_id, title, body, attachments, video_id, poll)
        VALUES (${me.id}, ${categoryId}, ${title}, ${bodyText}, ${JSON.stringify(attachments)}::jsonb,
                ${videoId}, ${poll ? JSON.stringify(poll) : null}::jsonb)
        RETURNING id
      ), f AS (
        INSERT INTO academy_follows (member_id, target_type, target_id)
        SELECT ${me.id}::int, 'post', id FROM p
        ON CONFLICT DO NOTHING
      ), r AS (
        INSERT INTO academy_post_reads (member_id, post_id, read_at)
        SELECT ${me.id}::int, id, NOW() FROM p
        ON CONFLICT DO NOTHING
      )
      SELECT id FROM p
    `
    postId = row.id
    await fanOutNewPost(sql, {
      postId, actorId: me.id, title, body: bodyText,
      adminsOnly: category?.write_role === "admins",
    })
  } else {
    // Una encuesta con votos no se toca: cambiar las opciones reasignaría
    // votos ya emitidos a otra respuesta.
    const pollChange = pollGiven && !samePoll(poll, current.poll)
    if (pollChange && current.has_votes) {
      throw new HttpError(409, "La encuesta ya tiene votos y no se puede cambiar")
    }
    const rows = await sql`
      UPDATE academy_posts
         SET category_id = ${categoryId}::int,
             title = ${title},
             body = ${bodyText},
             attachments = ${JSON.stringify(attachments)}::jsonb,
             video_id = ${videoId}::text,
             poll = CASE WHEN ${pollChange}::boolean THEN ${poll ? JSON.stringify(poll) : null}::jsonb ELSE poll END,
             edited_at = NOW(),
             updated_at = NOW()
       WHERE id = ${id}::int AND deleted_at IS NULL
         AND NOT (${pollChange}::boolean AND EXISTS (SELECT 1 FROM academy_poll_votes v WHERE v.post_id = ${id}::int))
      RETURNING id
    `
    // Entró un voto entre la lectura y el UPDATE: mismo 409.
    if (!rows.length) throw new HttpError(409, "La encuesta ya tiene votos y no se puede cambiar")
    try {
      const mentioned = (await resolveMentions(sql, `${title}\n${bodyText}`)).filter((x) => x !== me.id)
      if (mentioned.length) {
        await notifyMany(sql, mentioned, {
          kind: "mencion", actorId: me.id, targetType: "post", targetId: id, preview: title,
          groupKey: `mencion:post:${id}`, requirePostId: id,
        })
      }
    } catch (err) {
      console.error("[academy:post-save] menciones:", err?.message || err)
    }
  }

  const [post] = await postCards(sql, [postId], me)
  if (!post) throw new HttpError(404, "Publicación no encontrada")
  return { post }
}

async function postDelete(ctx) {
  const { sql, body } = ctx
  const me = viewerOf(ctx)
  const id = toId(body.id)
  if (!id) throw new HttpError(400, "Publicación inválida")
  const staff = isStaffRole(me.role)
  // Borrado lógico + limpieza de los avisos que apuntaban a él (y a sus
  // comentarios), en el mismo statement que valida autor/staff.
  const rows = await sql`
    WITH d AS (
      UPDATE academy_posts p SET deleted_at = NOW(), pinned_at = NULL, updated_at = NOW()
       WHERE p.id = ${id}::int AND p.deleted_at IS NULL
         AND (p.author_id = ${me.id}::int OR ${staff}::boolean)
      RETURNING p.id
    ), n AS (
      DELETE FROM academy_notifications
       WHERE (target_type = 'post' AND target_id IN (SELECT id FROM d))
          OR (target_type = 'comment' AND parent_id IN (SELECT id FROM d))
    )
    SELECT id FROM d
  `
  if (!rows.length) throw new HttpError(404, "Publicación no encontrada")
  return {}
}

async function editComment(sql, me, id, bodyText) {
  const staff = isStaffRole(me.role)
  const rows = await sql`
    UPDATE academy_comments cm
       SET body = ${bodyText}, edited_at = NOW(), updated_at = NOW()
     WHERE cm.id = ${id}::int AND cm.deleted_at IS NULL
       AND (cm.author_id = ${me.id}::int OR ${staff}::boolean)
       AND (cm.post_id IS NULL OR EXISTS (
             SELECT 1 FROM academy_posts p
               LEFT JOIN academy_categories c ON c.id = p.category_id
              WHERE p.id = cm.post_id AND p.deleted_at IS NULL
                AND (c.cohort_id IS NULL OR ${staff}::boolean
                     OR EXISTS (SELECT 1 FROM academy_cohort_members vcm
                                 WHERE vcm.cohort_id = c.cohort_id AND vcm.member_id = ${me.id}::int))))
    RETURNING cm.id, cm.post_id, cm.lesson_id, cm.parent_id, cm.author_id, cm.like_count,
              to_char(cm.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
              to_char(cm.edited_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS edited_at,
              EXISTS (SELECT 1 FROM academy_likes l
                       WHERE l.member_id = ${me.id}::int AND l.target_type = 'comment' AND l.target_id = cm.id) AS liked
  `
  const row = rows[0]
  if (!row) throw new HttpError(404, "Comentario no encontrado")
  try {
    const mentioned = (await resolveMentions(sql, bodyText)).filter((x) => x !== me.id && x !== row.author_id)
    if (mentioned.length && row.post_id) {
      await notifyMany(sql, mentioned, {
        kind: "mencion", actorId: me.id, targetType: "comment", targetId: row.id, parentId: row.post_id,
        preview: clip(bodyText, 140), groupKey: `mencion:comment:${row.id}`, requirePostId: row.post_id,
      })
    }
  } catch (err) {
    console.error("[academy:comment-save] menciones:", err?.message || err)
  }
  const minis = await memberMinis(sql, [row.author_id])
  return {
    comment: {
      id: row.id, postId: row.post_id ?? null, lessonId: row.lesson_id ?? null, parentId: row.parent_id ?? null,
      author: minis.get(row.author_id) || null, body: bodyText, likeCount: row.like_count || 0,
      liked: !!row.liked, createdAt: row.created_at, editedAt: row.edited_at || null, deleted: false,
    },
  }
}

async function commentSave(ctx) {
  const { sql, body } = ctx
  const me = viewerOf(ctx)
  const staff = isStaffRole(me.role)
  let bodyText = text(body.body, 5000).trim()
  if (!bodyText) throw new HttpError(400, "Escribe un comentario")

  const editId = toId(body.id)
  if (editId) return editComment(sql, me, editId, bodyText)

  let postId = toId(body.postId)
  let lessonId = toId(body.lessonId)
  const parentId = toId(body.parentId)

  /* Dos niveles, como Skool: responder a una respuesta cuelga del
     comentario raíz y antepone @handle de a quién se le responde, para que
     el hilo se siga entendiendo sin un tercer nivel de sangría. */
  let topParentId = null
  const replyTargets = []
  if (parentId) {
    const [p] = await sql`
      SELECT c.id, c.post_id, c.lesson_id, c.parent_id, c.author_id,
             (c.deleted_at IS NOT NULL) AS deleted, m.handle AS author_handle
        FROM academy_comments c
        JOIN academy_members m ON m.id = c.author_id
       WHERE c.id = ${parentId}::int
    `
    if (!p || p.deleted) throw new HttpError(404, "Ese comentario ya no existe")
    if ((postId && p.post_id !== postId) || (lessonId && p.lesson_id !== lessonId)) {
      throw new HttpError(400, "El comentario no pertenece a esa publicación")
    }
    postId = p.post_id ?? null
    lessonId = p.lesson_id ?? null
    if (p.parent_id) {
      topParentId = p.parent_id
      const [top] = await sql`SELECT author_id FROM academy_comments WHERE id = ${p.parent_id}::int`
      if (top) replyTargets.push(top.author_id)
      replyTargets.push(p.author_id)
      const tag = p.author_handle ? `@${p.author_handle}` : null
      if (tag && p.author_id !== me.id && !bodyText.toLowerCase().startsWith(tag.toLowerCase())) {
        bodyText = text(`${tag} ${bodyText}`, 5000)
      }
    } else {
      topParentId = p.id
      replyTargets.push(p.author_id)
    }
  }
  if (!postId === !lessonId) throw new HttpError(400, "Indica dónde va el comentario")

  if (!staff && !underLimit(`comment:${me.id}`, 30, 5 * 60e3)) {
    throw new HttpError(429, "Estás comentando muy seguido. Espera un momento.")
  }

  if (postId) {
    const [info] = await sql`
      SELECT p.id, p.author_id, p.title, p.comments_locked
        FROM academy_posts p
        LEFT JOIN academy_categories c ON c.id = p.category_id
       WHERE p.id = ${postId}::int AND p.deleted_at IS NULL
         AND (c.cohort_id IS NULL OR ${staff}::boolean
              OR EXISTS (SELECT 1 FROM academy_cohort_members vcm
                          WHERE vcm.cohort_id = c.cohort_id AND vcm.member_id = ${me.id}::int))
    `
    if (!info) throw new HttpError(404, "Publicación no encontrada")
    if (info.comments_locked && !staff) {
      throw new HttpError(409, "Los comentarios están desactivados en esta publicación", "locked")
    }

    /* Comentario + contadores del post + "leído" del que comenta, en UN
       statement. Las condiciones (visible, no bloqueado, padre raíz del
       mismo post) se repiten adentro: entre la lectura de arriba y esto
       alguien pudo apagar los comentarios o borrar el post. */
    const [ins] = await sql`
      WITH p AS (
        SELECT p.id
          FROM academy_posts p
          LEFT JOIN academy_categories c ON c.id = p.category_id
         WHERE p.id = ${postId}::int AND p.deleted_at IS NULL
           AND (NOT p.comments_locked OR ${staff}::boolean)
           AND (c.cohort_id IS NULL OR ${staff}::boolean
                OR EXISTS (SELECT 1 FROM academy_cohort_members vcm
                            WHERE vcm.cohort_id = c.cohort_id AND vcm.member_id = ${me.id}::int))
           AND (${topParentId}::int IS NULL OR EXISTS (
                 SELECT 1 FROM academy_comments pc
                  WHERE pc.id = ${topParentId}::int AND pc.post_id = p.id AND pc.parent_id IS NULL))
      ), ins AS (
        INSERT INTO academy_comments (post_id, parent_id, author_id, body)
        SELECT id, ${topParentId}::int, ${me.id}::int, ${bodyText}::text FROM p
        RETURNING id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
      ), up AS (
        UPDATE academy_posts
           SET comment_count = comment_count + 1, last_comment_at = NOW(), last_activity_at = NOW()
         WHERE id = ${postId}::int AND EXISTS (SELECT 1 FROM ins)
        RETURNING id
      ), rd AS (
        INSERT INTO academy_post_reads (member_id, post_id, read_at)
        SELECT ${me.id}::int, id, NOW() FROM p WHERE EXISTS (SELECT 1 FROM ins)
        ON CONFLICT (member_id, post_id) DO UPDATE SET read_at = NOW()
      )
      SELECT id, created_at FROM ins
    `
    if (!ins) throw new HttpError(409, "No se pudo publicar el comentario. Recarga la publicación.")

    try {
      const done = new Set([me.id])
      const preview = clip(bodyText, 140)
      const replies = [...new Set(replyTargets)].filter((x) => x && !done.has(x))
      if (replies.length) {
        await notifyMany(sql, replies, {
          kind: "respuesta", actorId: me.id, targetType: "comment", targetId: ins.id, parentId: postId,
          preview, requirePostId: postId,
        })
        replies.forEach((x) => done.add(x))
      }
      if (!done.has(info.author_id)) {
        await notify(sql, {
          memberId: info.author_id, kind: "comentario", actorId: me.id, targetType: "comment",
          targetId: ins.id, parentId: postId, preview, requirePostId: postId,
        })
        done.add(info.author_id)
      }
      const mentioned = (await resolveMentions(sql, bodyText)).filter((x) => !done.has(x))
      if (mentioned.length) {
        await notifyMany(sql, mentioned, {
          kind: "mencion", actorId: me.id, targetType: "comment", targetId: ins.id, parentId: postId,
          preview, groupKey: `mencion:comment:${ins.id}`, requirePostId: postId,
        })
        mentioned.forEach((x) => done.add(x))
      }
      const followers = await sql`
        SELECT member_id AS id FROM academy_follows WHERE target_type = 'post' AND target_id = ${postId}::int
      `
      const rest = followers.map((r) => r.id).filter((x) => !done.has(x))
      if (rest.length) {
        // Una sola fila no leída por post seguido, aunque entren 30 comentarios.
        await notifyMany(sql, rest, {
          kind: "actividad", actorId: me.id, targetType: "post", targetId: postId, preview: info.title,
          groupKey: `actividad:post:${postId}`, requirePostId: postId,
        })
      }
    } catch (err) {
      console.error("[academy:comment-save] avisos:", err?.message || err)
    }

    const minis = await memberMinis(sql, [me.id])
    return {
      comment: {
        id: ins.id, postId, lessonId: null, parentId: topParentId, author: minis.get(me.id) || null,
        body: bodyText, likeCount: 0, liked: false, createdAt: ins.created_at, editedAt: null, deleted: false,
      },
    }
  }

  // Comentario de lección: el acceso lo decide el módulo de cursos.
  const { canAccessLesson } = await loadCourses()
  if (!(await canAccessLesson(sql, me, lessonId))) {
    throw new HttpError(403, "No tienes acceso a esta lección", "locked")
  }
  const [ins] = await sql`
    INSERT INTO academy_comments (lesson_id, parent_id, author_id, body)
    SELECT ${lessonId}::int, ${topParentId}::int, ${me.id}::int, ${bodyText}::text
     WHERE ${topParentId}::int IS NULL OR EXISTS (
           SELECT 1 FROM academy_comments pc
            WHERE pc.id = ${topParentId}::int AND pc.lesson_id = ${lessonId}::int AND pc.parent_id IS NULL)
    RETURNING id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
  `
  if (!ins) throw new HttpError(409, "No se pudo publicar el comentario. Recarga la lección.")

  try {
    const [where] = await sql`
      SELECT l.slug AS lesson_slug, co.slug AS course_slug
        FROM academy_lessons l JOIN academy_courses co ON co.id = l.course_id
       WHERE l.id = ${lessonId}::int
    `
    const extra = where ? { courseSlug: where.course_slug, lessonSlug: where.lesson_slug } : {}
    const preview = clip(bodyText, 140)
    const done = new Set([me.id])
    const replies = [...new Set(replyTargets)].filter((x) => x && !done.has(x))
    if (replies.length) {
      await notifyMany(sql, replies, {
        kind: "respuesta", actorId: me.id, targetType: "comment", targetId: ins.id, preview, extra,
      })
      replies.forEach((x) => done.add(x))
    }
    // Una mención en una lección solo avisa a quien puede abrir esa lección:
    // si no, la vista previa filtraría contenido de un curso pagado.
    const mentioned = (await resolveMentions(sql, bodyText)).filter((x) => !done.has(x)).slice(0, 10)
    if (mentioned.length) {
      const rows = await sql`
        SELECT id, role, status, prefs FROM academy_members WHERE id = ANY(${mentioned}::int[])
      `
      const allowed = []
      for (const m of rows) {
        try {
          if (await canAccessLesson(sql, m, lessonId)) allowed.push(m.id)
        } catch {
          /* sin acceso verificable → no se avisa */
        }
      }
      if (allowed.length) {
        await notifyMany(sql, allowed, {
          kind: "mencion", actorId: me.id, targetType: "comment", targetId: ins.id, preview,
          groupKey: `mencion:comment:${ins.id}`, extra,
        })
      }
    }
  } catch (err) {
    console.error("[academy:comment-save] avisos lección:", err?.message || err)
  }

  const minis = await memberMinis(sql, [me.id])
  return {
    comment: {
      id: ins.id, postId: null, lessonId, parentId: topParentId, author: minis.get(me.id) || null,
      body: bodyText, likeCount: 0, liked: false, createdAt: ins.created_at, editedAt: null, deleted: false,
    },
  }
}

async function commentDelete(ctx) {
  const { sql, body } = ctx
  const me = viewerOf(ctx)
  const id = toId(body.id)
  if (!id) throw new HttpError(400, "Comentario inválido")
  const staff = isStaffRole(me.role)
  const rows = await sql`
    WITH d AS (
      UPDATE academy_comments SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = ${id}::int AND deleted_at IS NULL
         AND (author_id = ${me.id}::int OR ${staff}::boolean)
      RETURNING id, post_id
    ), u AS (
      UPDATE academy_posts SET comment_count = GREATEST(comment_count - 1, 0)
       WHERE id IN (SELECT post_id FROM d WHERE post_id IS NOT NULL)
    ), n AS (
      DELETE FROM academy_notifications
       WHERE target_type = 'comment' AND target_id IN (SELECT id FROM d)
    )
    SELECT id FROM d
  `
  if (!rows.length) throw new HttpError(404, "Comentario no encontrado")
  return {}
}

async function lessonComments(ctx) {
  const { sql, query } = ctx
  const me = viewerOf(ctx)
  const lessonId = toId(query.lessonId)
  if (!lessonId) throw new HttpError(400, "Lección inválida")
  const { canAccessLesson } = await loadCourses()
  if (!(await canAccessLesson(sql, me, lessonId))) {
    throw new HttpError(403, "No tienes acceso a esta lección", "locked")
  }
  const rows = await lessonCommentRows(sql, lessonId, me)
  const minis = await memberMinis(sql, rows.map((r) => r.author_id))
  return { comments: buildComments(rows, minis) }
}

async function like(ctx) {
  const { sql, body } = ctx
  const me = viewerOf(ctx)
  const tt = body.targetType === "post" || body.targetType === "comment" ? body.targetType : null
  const tid = toId(body.targetId)
  if (!tt || !tid) throw new HttpError(400, "Contenido inválido")
  const want = body.like !== false
  const target = await loadTarget(sql, me, tt, tid)
  if (target.authorId === me.id) {
    throw new HttpError(400, tt === "post" ? "No puedes darle me gusta a tu propia publicación" : "No puedes darle me gusta a tu propio comentario")
  }
  const groupKey = `like:${tt}:${tid}`

  if (want) {
    /* Like + contador en el mismo statement. prior_points sale de la foto
       previa al INSERT (mismo statement), así que es el puntaje del autor
       ANTES de este like: sirve para detectar si este like lo sube de nivel. */
    const [r] = await sql`
      WITH ins AS (
        INSERT INTO academy_likes (member_id, target_type, target_id, author_id)
        VALUES (${me.id}, ${tt}, ${tid}, ${target.authorId})
        ON CONFLICT (member_id, target_type, target_id) DO NOTHING
        RETURNING target_id
      ), up AS (
        UPDATE academy_posts SET like_count = like_count + 1
         WHERE ${tt}::text = 'post' AND id = ${tid}::int AND EXISTS (SELECT 1 FROM ins)
        RETURNING like_count
      ), uc AS (
        UPDATE academy_comments SET like_count = like_count + 1
         WHERE ${tt}::text = 'comment' AND id = ${tid}::int AND EXISTS (SELECT 1 FROM ins)
        RETURNING like_count
      )
      SELECT (SELECT count(*) FROM ins)::int AS changed,
             COALESCE((SELECT like_count FROM up), (SELECT like_count FROM uc),
                      CASE WHEN ${tt}::text = 'post'
                           THEN (SELECT like_count FROM academy_posts WHERE id = ${tid}::int)
                           ELSE (SELECT like_count FROM academy_comments WHERE id = ${tid}::int) END, 0)::int AS like_count,
             (SELECT count(*) FROM academy_likes l
               WHERE l.author_id = ${target.authorId}::int AND l.member_id <> l.author_id)::int AS prior_points
    `
    if (r.changed) {
      await notify(sql, {
        memberId: target.authorId, kind: "like", actorId: me.id, targetType: tt, targetId: tid,
        parentId: target.postId && tt === "comment" ? target.postId : null,
        preview: target.preview, groupKey, requirePostId: target.postId, extra: target.routeExtra,
      })
      const before = levelFor(r.prior_points).level
      const after = levelFor(r.prior_points + 1).level
      if (after > before) {
        try {
          const names = levelNames(await getSettings(sql))
          // target_id = nivel alcanzado; group_key lo vuelve idempotente
          // (like, ya no, like de nuevo en el umbral no repite el aviso).
          await notify(sql, {
            memberId: target.authorId, kind: "nivel", targetId: after, groupKey: `nivel:${after}`,
            extra: { level: after, levelName: names[after - 1] },
          })
        } catch (err) {
          console.error("[academy:like] nivel:", err?.message || err)
        }
      }
    }
    return { likeCount: r.like_count, liked: true }
  }

  /* Quitar el like. Si la fila agrupada no leída mostraba a este actor, se
     pasa al like anterior que quede; si no queda ninguno, se borra (no tiene
     sentido "A nadie le gustó tu publicación"). */
  const [r] = await sql`
    WITH del AS (
      DELETE FROM academy_likes
       WHERE member_id = ${me.id}::int AND target_type = ${tt}::text AND target_id = ${tid}::int
      RETURNING target_id
    ), up AS (
      UPDATE academy_posts SET like_count = GREATEST(like_count - 1, 0)
       WHERE ${tt}::text = 'post' AND id = ${tid}::int AND EXISTS (SELECT 1 FROM del)
      RETURNING like_count
    ), uc AS (
      UPDATE academy_comments SET like_count = GREATEST(like_count - 1, 0)
       WHERE ${tt}::text = 'comment' AND id = ${tid}::int AND EXISTS (SELECT 1 FROM del)
      RETURNING like_count
    ), others AS (
      SELECT member_id FROM academy_likes
       WHERE target_type = ${tt}::text AND target_id = ${tid}::int AND member_id <> ${me.id}::int
       ORDER BY created_at DESC LIMIT 1
    ), nd AS (
      DELETE FROM academy_notifications
       WHERE member_id = ${target.authorId}::int AND group_key = ${groupKey}::text AND read_at IS NULL
         AND actor_id = ${me.id}::int AND EXISTS (SELECT 1 FROM del) AND NOT EXISTS (SELECT 1 FROM others)
    ), nu AS (
      UPDATE academy_notifications SET actor_id = (SELECT member_id FROM others)
       WHERE member_id = ${target.authorId}::int AND group_key = ${groupKey}::text AND read_at IS NULL
         AND actor_id = ${me.id}::int AND EXISTS (SELECT 1 FROM del) AND EXISTS (SELECT 1 FROM others)
    )
    SELECT COALESCE((SELECT like_count FROM up), (SELECT like_count FROM uc),
                    CASE WHEN ${tt}::text = 'post'
                         THEN (SELECT like_count FROM academy_posts WHERE id = ${tid}::int)
                         ELSE (SELECT like_count FROM academy_comments WHERE id = ${tid}::int) END, 0)::int AS like_count
  `
  return { likeCount: r.like_count, liked: false }
}

async function pollVote(ctx) {
  const { sql, body } = ctx
  const me = viewerOf(ctx)
  const postId = toId(body.postId)
  if (!postId) throw new HttpError(400, "Encuesta inválida")
  await loadTarget(sql, me, "post", postId)

  if (body.optionIdx === null) {
    await sql`DELETE FROM academy_poll_votes WHERE post_id = ${postId}::int AND member_id = ${me.id}::int`
  } else {
    const idx = Number(body.optionIdx)
    if (!Number.isInteger(idx) || idx < 0 || idx > 9) throw new HttpError(400, "Esa opción no existe")
    // El índice se valida contra la encuesta ACTUAL en el mismo statement.
    const rows = await sql`
      INSERT INTO academy_poll_votes (post_id, member_id, option_idx)
      SELECT p.id, ${me.id}::int, ${idx}::int
        FROM academy_posts p
       WHERE p.id = ${postId}::int AND p.deleted_at IS NULL AND p.poll IS NOT NULL
         AND ${idx}::int < jsonb_array_length(COALESCE(p.poll->'options', '[]'::jsonb))
      ON CONFLICT (post_id, member_id) DO UPDATE SET option_idx = EXCLUDED.option_idx, created_at = NOW()
      RETURNING option_idx
    `
    if (!rows.length) throw new HttpError(400, "Esa opción no existe")
  }

  const [p] = await sql`
    SELECT p.poll,
           (SELECT COALESCE(jsonb_object_agg(v.option_idx::text, v.n), '{}'::jsonb)
              FROM (SELECT option_idx, count(*)::int AS n FROM academy_poll_votes
                     WHERE post_id = p.id GROUP BY option_idx) v) AS poll_counts,
           (SELECT option_idx FROM academy_poll_votes WHERE post_id = p.id AND member_id = ${me.id}::int) AS my_vote
      FROM academy_posts p WHERE p.id = ${postId}::int
  `
  return { poll: pollOut(p?.poll, p?.poll_counts, p?.my_vote) }
}

async function follow(ctx) {
  const { sql, body } = ctx
  const me = viewerOf(ctx)
  const tt = body.targetType === "post" || body.targetType === "miembro" ? body.targetType : null
  const tid = toId(body.targetId)
  if (!tt || !tid) throw new HttpError(400, "Destino inválido")
  const want = body.follow !== false

  if (tt === "post") {
    await loadTarget(sql, me, "post", tid)
  } else {
    if (tid === me.id) throw new HttpError(400, "No puedes seguirte a ti mismo")
    const [t] = await sql`
      SELECT m.id,
             EXISTS (SELECT 1 FROM academy_blocks b
                      WHERE (b.blocker_id = m.id AND b.blocked_id = ${me.id}::int)
                         OR (b.blocker_id = ${me.id}::int AND b.blocked_id = m.id)) AS blocked
        FROM academy_members m
       WHERE m.id = ${tid}::int AND m.status = 'activo' AND m.deleted_at IS NULL
    `
    if (!t) throw new HttpError(404, "Miembro no encontrado")
    if (want && t.blocked) throw new HttpError(403, "No puedes seguir a este miembro")
  }

  if (want) {
    const rows = await sql`
      INSERT INTO academy_follows (member_id, target_type, target_id)
      VALUES (${me.id}, ${tt}, ${tid})
      ON CONFLICT (member_id, target_type, target_id) DO NOTHING
      RETURNING target_id
    `
    if (rows.length && tt === "miembro") {
      // group_key por seguidor: seguir/dejar/seguir no repite el aviso.
      await notify(sql, {
        memberId: tid, kind: "seguidor", actorId: me.id, targetType: "miembro", targetId: me.id,
        groupKey: `seguidor:${me.id}`, extra: { handle: me.handle },
      })
    }
  } else {
    await sql`
      DELETE FROM academy_follows
       WHERE member_id = ${me.id}::int AND target_type = ${tt}::text AND target_id = ${tid}::int
    `
  }
  return { following: want }
}

async function report(ctx) {
  const { sql, body } = ctx
  const me = viewerOf(ctx)
  const TYPES = ["post", "comment", "message", "miembro"]
  const tt = TYPES.includes(body.targetType) ? body.targetType : null
  const tid = toId(body.targetId)
  if (!tt || !tid) throw new HttpError(400, "Contenido inválido")
  const reason = text(body.reason, 500).trim()
  if (!underLimit(`report:${me.id}`, 10, 3600e3)) {
    throw new HttpError(429, "Ya enviaste varios reportes. Inténtalo más tarde.")
  }

  // Solo se reporta lo que uno puede ver: un mensaje, si eres parte del chat.
  let parentId = null
  let routeExtra = {}
  if (tt === "post" || tt === "comment") {
    const t = await loadTarget(sql, me, tt, tid)
    parentId = tt === "comment" ? t.postId : null
    routeExtra = t.routeExtra
  } else if (tt === "message") {
    const [m] = await sql`
      SELECT msg.id
        FROM academy_messages msg
        JOIN academy_chat_members cm ON cm.chat_id = msg.chat_id AND cm.member_id = ${me.id}::int
       WHERE msg.id = ${tid}::int AND msg.deleted_at IS NULL
    `
    if (!m) throw new HttpError(404, "Mensaje no encontrado")
  } else {
    if (tid === me.id) throw new HttpError(400, "No puedes reportarte a ti mismo")
    const [m] = await sql`SELECT id, handle FROM academy_members WHERE id = ${tid}::int AND deleted_at IS NULL`
    if (!m) throw new HttpError(404, "Miembro no encontrado")
    routeExtra = { handle: m.handle }
  }

  // Idempotente: el mismo miembro no abre dos reportes del mismo contenido.
  const rows = await sql`
    INSERT INTO academy_reports (reporter_id, target_type, target_id, reason)
    SELECT ${me.id}::int, ${tt}::text, ${tid}::int, ${reason || null}::text
     WHERE NOT EXISTS (
           SELECT 1 FROM academy_reports
            WHERE reporter_id = ${me.id}::int AND target_type = ${tt}::text
              AND target_id = ${tid}::int AND status = 'abierto')
    RETURNING id
  `
  if (rows.length) {
    try {
      const staffRows = await sql`
        SELECT id FROM academy_members
         WHERE status = 'activo' AND deleted_at IS NULL AND role IN ('propietario', 'admin', 'moderador')
      `
      // Un mensaje privado no tiene ruta para el staff (no es parte del chat):
      // el aviso lleva solo el motivo; el detalle está en admin-reports.
      await notifyMany(sql, staffRows.map((r) => r.id), {
        kind: "reporte", actorId: me.id,
        targetType: tt === "message" ? null : tt, targetId: tt === "message" ? null : tid,
        parentId, preview: reason ? clip(reason, 140) : null, groupKey: `reporte:${rows[0].id}`,
        extra: routeExtra,
      })
    } catch (err) {
      console.error("[academy:report] avisos:", err?.message || err)
    }
  }
  return {}
}

async function members(ctx) {
  const { sql, query } = ctx
  const me = viewerOf(ctx)
  const admin = isAdminRole(me.role)
  const PUBLIC_TABS = ["miembros", "admins", "en-linea"]
  const ADMIN_TABS = ["activos", "cancelando", "cancelado", "expulsado"]
  let tab = String(query.tab || "miembros")
  if (ADMIN_TABS.includes(tab) && !admin) throw new HttpError(403, "Solo los administradores pueden ver esa lista")
  if (!PUBLIC_TABS.includes(tab) && !ADMIN_TABS.includes(tab)) tab = "miembros"

  const q = String(query.q ?? "").trim().slice(0, 80)
  const pattern = q ? likePattern(q) : null
  const levelRaw = toId(query.level)
  const level = levelRaw && levelRaw <= 9 ? levelRaw : null
  const minPts = level ? LEVEL_THRESHOLDS[level - 1] : null
  const maxPts = level && level < 9 ? LEVEL_THRESHOLDS[level] : null
  const cohortId = admin ? toId(query.cohortId) : null
  const sort = ["nuevos", "actividad", "puntos"].includes(query.sort) ? query.sort : "nuevos"
  const page = Math.max(1, Math.min(10000, parseInt(query.page, 10) || 1))
  const offset = (page - 1) * MEMBERS_PAGE

  /* "Cancelando" es de suscripciones y acá se paga una sola vez: siempre 0.
     Ordenar por actividad respeta "ocultar actividad" (el oculto va al final
     para los demás), y "En línea" respeta "ocultar En línea". */
  const listPromise = tab === "cancelando"
    ? Promise.resolve([])
    : sql`
        SELECT m.id, m.handle, m.name, m.avatar_url, m.avatar_url AS "avatarUrl", m.role, m.status, m.source,
               m.bio, m.location, m.links, m.prefs, m.email, m.phone, m.must_change_password,
               to_char(m.joined_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS joined_at,
               to_char(m.last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_seen_at,
               to_char(m.last_login_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_login_at,
               to_char(m.credentials_sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS credentials_sent_at,
               (m.last_sync_at IS NOT NULL AND m.last_sync_at > NOW() - interval '90 seconds') AS online_raw,
               COALESCE(pt.n, 0)::int AS points,
               count(*) OVER ()::int AS total
          FROM academy_members m
          LEFT JOIN LATERAL (
            SELECT count(*) AS n FROM academy_likes l WHERE l.author_id = m.id AND l.member_id <> m.id
          ) pt ON true
         WHERE m.deleted_at IS NULL
           AND CASE ${tab}::text
                 WHEN 'admins' THEN m.status = 'activo' AND m.role IN ('propietario', 'admin', 'moderador')
                 WHEN 'en-linea' THEN m.status = 'activo'
                      AND m.last_sync_at > NOW() - interval '90 seconds'
                      AND (COALESCE(m.prefs->'privacy'->>'hideOnline', 'false') <> 'true' OR m.id = ${me.id}::int)
                 WHEN 'cancelado' THEN m.status = 'cancelado'
                 WHEN 'expulsado' THEN m.status = 'expulsado'
                 ELSE m.status = 'activo'
               END
           AND (${pattern}::text IS NULL
                OR m.name ILIKE ${pattern}::text ESCAPE '\\'
                OR m.handle ILIKE ${pattern}::text ESCAPE '\\'
                OR (${admin}::boolean AND m.email_norm ILIKE ${pattern}::text ESCAPE '\\'))
           AND (${minPts}::int IS NULL OR COALESCE(pt.n, 0) >= ${minPts}::int)
           AND (${maxPts}::int IS NULL OR COALESCE(pt.n, 0) < ${maxPts}::int)
           AND (${cohortId}::int IS NULL OR EXISTS (
                 SELECT 1 FROM academy_cohort_members cm
                  WHERE cm.cohort_id = ${cohortId}::int AND cm.member_id = m.id))
         ORDER BY
           CASE WHEN ${sort}::text = 'puntos' THEN COALESCE(pt.n, 0) END DESC NULLS LAST,
           CASE WHEN ${sort}::text = 'actividad' THEN
             CASE WHEN ${admin}::boolean OR m.id = ${me.id}::int
                       OR COALESCE(m.prefs->'privacy'->>'hideActivity', 'false') <> 'true'
                  THEN m.last_seen_at END
           END DESC NULLS LAST,
           m.joined_at DESC, m.id DESC
         LIMIT ${MEMBERS_PAGE}::int OFFSET ${offset}::int
      `
  const countsPromise = sql`
    SELECT count(*) FILTER (WHERE status = 'activo')::int AS miembros,
           count(*) FILTER (WHERE status = 'activo' AND role IN ('propietario', 'admin', 'moderador'))::int AS admins,
           count(*) FILTER (WHERE status = 'activo' AND last_sync_at > NOW() - interval '90 seconds'
                            AND (COALESCE(prefs->'privacy'->>'hideOnline', 'false') <> 'true' OR id = ${me.id}::int))::int AS en_linea,
           count(*) FILTER (WHERE status = 'cancelado')::int AS cancelado,
           count(*) FILTER (WHERE status = 'expulsado')::int AS expulsado
      FROM academy_members
     WHERE deleted_at IS NULL
  `
  const [rows, countRows] = await Promise.all([listPromise, countsPromise])
  const c = countRows[0] || {}

  const publicList = await publicProjection(sql, rows, me)
  const list = admin ? await adminProjection(sql, rows, publicList) : publicList
  const total = rows[0]?.total || 0
  const counts = { miembros: c.miembros || 0, admins: c.admins || 0, enLinea: c.en_linea || 0 }
  if (admin) {
    counts.activos = c.miembros || 0
    counts.cancelando = 0
    counts.cancelado = c.cancelado || 0
    counts.expulsado = c.expulsado || 0
  }
  return { members: list, total, page, pages: Math.ceil(total / MEMBERS_PAGE), counts }
}

async function memberProfile(ctx) {
  const { sql, query } = ctx
  const me = viewerOf(ctx)
  const admin = isAdminRole(me.role)
  const staff = isStaffRole(me.role)
  const handle = String(query.handle ?? "").trim().toLowerCase().replace(/^@/, "").slice(0, 80)
  const byId = toId(query.id)
  if (!handle && !byId) throw new HttpError(400, "Miembro inválido")

  const [row] = await sql`
    SELECT m.id, m.handle, m.name, m.avatar_url, m.avatar_url AS "avatarUrl", m.role, m.status,
           m.bio, m.location, m.links, m.prefs,
           to_char(m.joined_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS joined_at,
           to_char(m.last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_seen_at,
           (m.last_sync_at IS NOT NULL AND m.last_sync_at > NOW() - interval '90 seconds') AS online_raw,
           (SELECT count(*) FROM academy_likes l WHERE l.author_id = m.id AND l.member_id <> m.id)::int AS points
      FROM academy_members m
     WHERE m.deleted_at IS NULL
       AND ((${handle}::text <> '' AND m.handle = ${handle}::text) OR m.id = ${byId}::int)
     LIMIT 1
  `
  // Un expulsado o cancelado no tiene perfil público (solo lo ve un admin).
  if (!row || (row.status !== "activo" && !admin)) throw new HttpError(404, "Miembro no encontrado")
  const id = row.id
  const isMe = id === me.id

  const [statRows, activityRows, recentRows, myPts, settings, projected] = await Promise.all([
    sql`
      SELECT
        (SELECT count(*) FROM academy_posts p
           LEFT JOIN academy_categories c ON c.id = p.category_id
          WHERE p.author_id = ${id}::int AND p.deleted_at IS NULL
            AND (c.cohort_id IS NULL OR ${staff}::boolean
                 OR EXISTS (SELECT 1 FROM academy_cohort_members vcm
                             WHERE vcm.cohort_id = c.cohort_id AND vcm.member_id = ${me.id}::int)))::int AS posts,
        (SELECT count(*) FROM academy_comments WHERE author_id = ${id}::int AND deleted_at IS NULL)::int AS comments,
        (SELECT count(*) FROM academy_follows f JOIN academy_members fm ON fm.id = f.member_id
          WHERE f.target_type = 'miembro' AND f.target_id = ${id}::int
            AND fm.status = 'activo' AND fm.deleted_at IS NULL)::int AS followers,
        (SELECT count(*) FROM academy_follows f JOIN academy_members fm ON fm.id = f.target_id
          WHERE f.member_id = ${id}::int AND f.target_type = 'miembro'
            AND fm.status = 'activo' AND fm.deleted_at IS NULL)::int AS following,
        EXISTS (SELECT 1 FROM academy_follows
                 WHERE member_id = ${me.id}::int AND target_type = 'miembro' AND target_id = ${id}::int) AS is_following,
        EXISTS (SELECT 1 FROM academy_blocks b
                 WHERE (b.blocker_id = ${me.id}::int AND b.blocked_id = ${id}::int)
                    OR (b.blocker_id = ${id}::int AND b.blocked_id = ${me.id}::int)) AS blocked
    `,
    /* Mapa de actividad: 365 días en hora de Santiago (como la agenda del
       local, no UTC como Skool). Cuenta publicar, comentar, dar like y votar. */
    sql`
      WITH s AS (
        SELECT ((NOW() AT TIME ZONE 'America/Santiago')::date - 364) AS start
      ), lo AS (
        SELECT ((SELECT start FROM s)::timestamp AT TIME ZONE 'America/Santiago') AS t
      ), d AS (
        SELECT created_at FROM academy_posts WHERE author_id = ${id}::int AND created_at >= (SELECT t FROM lo)
        UNION ALL
        SELECT created_at FROM academy_comments WHERE author_id = ${id}::int AND created_at >= (SELECT t FROM lo)
        UNION ALL
        SELECT created_at FROM academy_likes WHERE member_id = ${id}::int AND created_at >= (SELECT t FROM lo)
        UNION ALL
        SELECT created_at FROM academy_poll_votes WHERE member_id = ${id}::int AND created_at >= (SELECT t FROM lo)
      ), g AS (
        SELECT to_char((created_at AT TIME ZONE 'America/Santiago')::date, 'YYYY-MM-DD') AS day, count(*)::int AS n
          FROM d GROUP BY 1
      )
      SELECT to_char((SELECT start FROM s), 'YYYY-MM-DD') AS start,
             COALESCE((SELECT jsonb_object_agg(day, n) FROM g), '{}'::jsonb) AS days
    `,
    sql`
      SELECT p.id
        FROM academy_posts p
        LEFT JOIN academy_categories c ON c.id = p.category_id
       WHERE p.author_id = ${id}::int AND p.deleted_at IS NULL
         AND (c.cohort_id IS NULL OR ${staff}::boolean
              OR EXISTS (SELECT 1 FROM academy_cohort_members vcm
                          WHERE vcm.cohort_id = c.cohort_id AND vcm.member_id = ${me.id}::int))
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT 5
    `,
    pointsFor(sql, [me.id]),
    getSettings(sql),
    publicProjection(sql, [row], me),
  ])

  const st = statRows[0] || {}
  const act = activityRows[0] || {}
  const start = /^\d{4}-\d{2}-\d{2}$/.test(act.start || "") ? act.start : new Date().toISOString().slice(0, 10)
  const days = act.days && typeof act.days === "object" ? act.days : {}
  const hidden = !isMe && row.prefs?.privacy?.hideActivity === true
  const [y, mo, d] = start.split("-").map(Number)
  const base = Date.UTC(y, mo - 1, d)
  const counts = []
  for (let i = 0; i < 365; i++) {
    const key = new Date(base + i * 86400000).toISOString().slice(0, 10)
    counts.push(hidden ? 0 : Number(days[key]) || 0)
  }

  // canChat es una pista para la UI; la regla real la aplica chat-start.
  const minChat = Number(settings?.plugins?.minChatLevel) || 0
  let canChat = !isMe && row.status === "activo" && !st.blocked
    && row.prefs?.chat?.enabled !== false && me.prefs?.chat?.enabled !== false
  if (canChat && minChat > 1 && !staff && !isStaffRole(row.role)) {
    if (levelFor(pointsOf(myPts, me.id)).level < minChat) canChat = false
  }

  return {
    member: projected[0],
    stats: {
      posts: st.posts || 0,
      comments: st.comments || 0,
      followers: st.followers || 0,
      following: st.following || 0,
      likesReceived: Number(row.points) || 0,
    },
    activity: hidden ? { startDate: start, counts, hidden: true } : { startDate: start, counts },
    recent: await postCards(sql, recentRows.map((r) => r.id), me),
    isFollowing: !!st.is_following,
    canChat,
    isMe,
  }
}

/* Clasificación: se calcula al leer y se guarda 5 minutos en la instancia
   caliente. Skool también muestra tablas "de hace un rato" (con su fecha de
   actualización), y a este tamaño no justifica un cron ni una tabla más. Lo
   único que se lee en vivo es el puntaje propio del que mira. */
let leaderboardCache = { at: 0, data: null }
const LEADERBOARD_TTL = 5 * 60e3

async function leaderboardData(sql) {
  if (leaderboardCache.data && Date.now() - leaderboardCache.at < LEADERBOARD_TTL) return leaderboardCache.data

  const [win, dist, levelCourses] = await Promise.all([
    // Ventanas por día calendario de Santiago: 7 días = hoy + 6 anteriores.
    // Propietario y admins no compiten (regla de Skool); moderadores sí.
    sql`
      SELECT l.author_id AS id,
             count(*) FILTER (WHERE l.created_at >= ((date_trunc('day', NOW() AT TIME ZONE 'America/Santiago')
                                                      - interval '6 days') AT TIME ZONE 'America/Santiago'))::int AS p7,
             count(*) FILTER (WHERE l.created_at >= ((date_trunc('day', NOW() AT TIME ZONE 'America/Santiago')
                                                      - interval '29 days') AT TIME ZONE 'America/Santiago'))::int AS p30,
             count(*)::int AS pall
        FROM academy_likes l
        JOIN academy_members m ON m.id = l.author_id
       WHERE l.member_id <> l.author_id
         AND m.status = 'activo' AND m.deleted_at IS NULL
         AND m.role NOT IN ('propietario', 'admin')
       GROUP BY l.author_id
    `,
    // Reparto por nivel sobre TODOS los activos, dueño incluido (Skool lo
    // cuenta: con un solo miembro, el Nivel 1 dice 100%).
    sql`
      SELECT COALESCE(x.n, 0)::int AS points, count(*)::int AS members
        FROM academy_members m
        LEFT JOIN (SELECT author_id, count(*) AS n FROM academy_likes
                    WHERE member_id <> author_id GROUP BY author_id) x ON x.author_id = m.id
       WHERE m.status = 'activo' AND m.deleted_at IS NULL
       GROUP BY 1
    `,
    sql`
      SELECT id, title, unlock_level FROM academy_courses
       WHERE access = 'nivel' AND published AND unlock_level IS NOT NULL
       ORDER BY position, id
    `,
  ])

  const board = (key) => {
    const sorted = win.filter((r) => r[key] > 0).sort((a, b) => b[key] - a[key] || a.id - b.id)
    const ranks = new Map(sorted.map((r, i) => [r.id, i + 1]))
    return { top: sorted.slice(0, 10), ranks }
  }
  const b7 = board("p7")
  const b30 = board("p30")
  const ball = board("pall")
  const minis = await memberMinis(sql, [...b7.top, ...b30.top, ...ball.top].map((r) => r.id))
  const rowsFor = (b, key) =>
    b.top.map((r, i) => ({ rank: i + 1, member: minis.get(r.id) || null, points: r[key] })).filter((x) => x.member)

  const perLevel = new Array(9).fill(0)
  let total = 0
  for (const r of dist) {
    const lvl = Math.min(9, Math.max(1, levelFor(r.points).level))
    perLevel[lvl - 1] += r.members
    total += r.members
  }

  const data = {
    boards: { d7: rowsFor(b7, "p7"), d30: rowsFor(b30, "p30"), all: rowsFor(ball, "pall") },
    ranks: { d7: b7.ranks, d30: b30.ranks, all: ball.ranks },
    pct: perLevel.map((n) => (total ? Math.round((n * 100) / total) : 0)),
    courses: levelCourses,
    updatedAt: isoNow(),
  }
  leaderboardCache = { at: Date.now(), data }
  return data
}

async function leaderboard(ctx) {
  const { sql } = ctx
  const me = viewerOf(ctx)
  const [data, settings, pts] = await Promise.all([leaderboardData(sql), getSettings(sql), pointsFor(sql, [me.id])])
  const names = levelNames(settings)
  const points = pointsOf(pts, me.id)
  const info = levelFor(points)
  const excluded = isAdminRole(me.role)
  const minPost = Number(settings?.plugins?.minPostLevel) || 0
  const minChat = Number(settings?.plugins?.minChatLevel) || 0

  const levels = LEVEL_THRESHOLDS.map((minPoints, i) => {
    const level = i + 1
    const unlocks = data.courses
      .filter((c) => c.unlock_level === level)
      .map((c) => ({ kind: "curso", label: c.title }))
    if (minPost === level && level > 1) unlocks.push({ kind: "publicar", label: "Publicar en la comunidad" })
    if (minChat === level && level > 1) unlocks.push({ kind: "chat", label: "Chatear con otros miembros" })
    return { level, name: names[i], minPoints, pct: data.pct[i] || 0, unlocks }
  })

  return {
    me: {
      level: info.level,
      levelName: names[info.level - 1],
      points,
      pointsToNext: info.pointsToNext ?? 0,
      progress: info.progress ?? 0,
      rank7: excluded ? null : data.ranks.d7.get(me.id) ?? null,
      rank30: excluded ? null : data.ranks.d30.get(me.id) ?? null,
      rankAll: excluded ? null : data.ranks.all.get(me.id) ?? null,
    },
    levels,
    boards: data.boards,
    updatedAt: data.updatedAt,
  }
}

async function search(ctx) {
  const { sql, query } = ctx
  const me = viewerOf(ctx)
  const staff = isStaffRole(me.role)
  const q = String(query.q ?? "").trim()
  if (q.length < 2) throw new HttpError(400, "Escribe al menos 2 letras para buscar")
  const TYPES = ["todo", "publicaciones", "miembros", "lecciones"]
  const type = TYPES.includes(query.type) ? query.type : "todo"
  const pattern = likePattern(q.slice(0, 80))
  const out = { posts: [], members: [], lessons: [] }
  const tasks = []

  if (type === "todo" || type === "publicaciones") {
    tasks.push((async () => {
      const rows = await sql`
        SELECT p.id
          FROM academy_posts p
          LEFT JOIN academy_categories c ON c.id = p.category_id
         WHERE p.deleted_at IS NULL
           AND (c.cohort_id IS NULL OR ${staff}::boolean
                OR EXISTS (SELECT 1 FROM academy_cohort_members vcm
                            WHERE vcm.cohort_id = c.cohort_id AND vcm.member_id = ${me.id}::int))
           AND (p.title ILIKE ${pattern}::text ESCAPE '\\' OR p.body ILIKE ${pattern}::text ESCAPE '\\')
         ORDER BY p.last_activity_at DESC, p.id DESC
         LIMIT 20
      `
      out.posts = await postCards(sql, rows.map((r) => r.id), me)
    })())
  }

  if (type === "todo" || type === "miembros") {
    tasks.push((async () => {
      const rows = await sql`
        SELECT m.id, m.handle, m.name, m.avatar_url, m.avatar_url AS "avatarUrl", m.role, m.status,
               m.bio, m.location, m.links, m.prefs,
               to_char(m.joined_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS joined_at,
               to_char(m.last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_seen_at,
               (m.last_sync_at IS NOT NULL AND m.last_sync_at > NOW() - interval '90 seconds') AS online_raw,
               (SELECT count(*) FROM academy_likes l WHERE l.author_id = m.id AND l.member_id <> m.id)::int AS points
          FROM academy_members m
         WHERE m.status = 'activo' AND m.deleted_at IS NULL
           AND (m.name ILIKE ${pattern}::text ESCAPE '\\' OR m.handle ILIKE ${pattern}::text ESCAPE '\\')
         ORDER BY m.name, m.id
         LIMIT 20
      `
      out.members = await publicProjection(sql, rows, me)
    })())
  }

  if (type === "todo" || type === "lecciones") {
    tasks.push((async () => {
      // Solo lecciones de cursos a los que el miembro tiene acceso: ni el
      // título de una lección de un curso bloqueado aparece acá.
      const { accessibleCourseIds } = await loadCourses()
      const ids = ((await accessibleCourseIds(sql, me)) || []).map(toId).filter(Boolean)
      if (!ids.length) return
      const drafts = isAdminRole(me.role)
      const rows = await sql`
        SELECT l.slug, l.title, co.slug AS course_slug, co.title AS course_title
          FROM academy_lessons l
          JOIN academy_courses co ON co.id = l.course_id
         WHERE l.course_id = ANY(${ids}::int[])
           AND (l.published OR ${drafts}::boolean)
           AND (l.title ILIKE ${pattern}::text ESCAPE '\\' OR l.body ILIKE ${pattern}::text ESCAPE '\\')
         ORDER BY co.position, co.id, l.position, l.id
         LIMIT 20
      `
      out.lessons = rows.map((r) => ({ courseSlug: r.course_slug, courseTitle: r.course_title, slug: r.slug, title: r.title }))
    })())
  }

  await Promise.all(tasks)
  return out
}

async function groupCard(ctx) {
  const { sql } = ctx
  const me = viewerOf(ctx)
  const [settings, countRows, avatarRows] = await Promise.all([
    getSettings(sql),
    sql`
      SELECT count(*) FILTER (WHERE status = 'activo')::int AS members,
             count(*) FILTER (WHERE status = 'activo' AND last_sync_at > NOW() - interval '90 seconds'
                              AND (COALESCE(prefs->'privacy'->>'hideOnline', 'false') <> 'true' OR id = ${me.id}::int))::int AS online,
             count(*) FILTER (WHERE status = 'activo' AND role IN ('propietario', 'admin', 'moderador'))::int AS admins
        FROM academy_members
       WHERE deleted_at IS NULL
    `,
    sql`
      SELECT id FROM academy_members
       WHERE status = 'activo' AND deleted_at IS NULL
       ORDER BY (role IN ('propietario', 'admin')) DESC, joined_at DESC, id DESC
       LIMIT 8
    `,
  ])
  const minis = await memberMinis(sql, avatarRows.map((r) => r.id))
  const g = settings?.group || {}
  const c = countRows[0] || {}
  const cover = safeUrl(g.coverUrl)
  const links = (Array.isArray(g.links) ? g.links : [])
    .map((l) => ({ title: String(l?.title || "").slice(0, 60), url: safeUrl(l?.url) }))
    .filter((l) => l.title && l.url)
    .slice(0, 5)
  const rules = (Array.isArray(g.rules) ? g.rules : [])
    .map((r) => ({ title: String(typeof r === "string" ? r : r?.title || "").slice(0, 120) }))
    .filter((r) => r.title)
  return {
    name: g.name || HOST.brand.name,
    description: g.description || "",
    coverUrl: cover && isImageUrl(cover) ? cover : null,
    url: HOST.brand.groupUrlLabel,
    initials: g.initials || HOST.brand.initials,
    color: /^#[0-9a-fA-F]{3,8}$/.test(String(g.color || "")) ? g.color : HOST.brand.color,
    counts: { members: c.members || 0, online: c.online || 0, admins: c.admins || 0 },
    avatars: avatarRows.map((r) => minis.get(r.id)).filter(Boolean),
    links,
    rules,
  }
}

function categoryOut(c) {
  return {
    id: c.id,
    name: c.name,
    emoji: c.emoji || null,
    position: c.position,
    writeRole: c.write_role,
    defaultSort: c.default_sort,
    cohortId: c.cohort_id ?? null,
  }
}

async function adminCategorySave(ctx) {
  const { sql, body } = ctx
  const id = toId(body.id)
  const name = text(body.name, 30).replace(/\s+/g, " ").trim()
  if (!name) throw new HttpError(400, "Escribe el nombre de la categoría")
  const emojiGiven = body.emoji !== undefined
  const emoji = text(body.emoji, 8).trim() || null
  const writeRole = body.writeRole === "admins" ? "admins" : body.writeRole === "miembros" || !id ? "miembros" : null
  const defaultSort = ["default", "nuevos", "top"].includes(body.defaultSort) ? body.defaultSort : !id ? "default" : null
  const posNum = Number(body.position)
  const position = body.position != null && Number.isInteger(posNum) ? Math.max(0, Math.min(1000, posNum)) : null
  const cohortGiven = body.cohortId !== undefined
  const cohortId = toId(body.cohortId)
  if (cohortId) {
    const [ch] = await sql`SELECT id FROM academy_cohorts WHERE id = ${cohortId}::int`
    if (!ch) throw new HttpError(400, "Ese grupo no existe")
  }

  if (!id) {
    // El tope de 10 (Skool) va en el mismo INSERT, no en una lectura previa.
    const rows = await sql`
      INSERT INTO academy_categories (name, emoji, position, write_role, default_sort, cohort_id)
      SELECT ${name}::text, ${emoji}::text,
             COALESCE(${position}::int, (SELECT COALESCE(max(position), -1) + 1 FROM academy_categories)),
             ${writeRole}::text, ${defaultSort}::text, ${cohortId}::int
       WHERE (SELECT count(*) FROM academy_categories) < ${MAX_CATEGORIES}::int
      RETURNING id, name, emoji, position, write_role, default_sort, cohort_id
    `
    if (!rows.length) throw new HttpError(409, `Puedes tener hasta ${MAX_CATEGORIES} categorías`)
    return { category: categoryOut(rows[0]) }
  }

  const rows = await sql`
    UPDATE academy_categories
       SET name = ${name},
           emoji = CASE WHEN ${emojiGiven}::boolean THEN ${emoji}::text ELSE emoji END,
           position = COALESCE(${position}::int, position),
           write_role = COALESCE(${writeRole}::text, write_role),
           default_sort = COALESCE(${defaultSort}::text, default_sort),
           cohort_id = CASE WHEN ${cohortGiven}::boolean THEN ${cohortId}::int ELSE cohort_id END
     WHERE id = ${id}::int
    RETURNING id, name, emoji, position, write_role, default_sort, cohort_id
  `
  if (!rows.length) throw new HttpError(404, "Categoría no encontrada")
  return { category: categoryOut(rows[0]) }
}

async function adminCategoryDelete(ctx) {
  const { sql, body } = ctx
  const id = toId(body.id)
  const moveTo = toId(body.moveTo)
  if (!id) throw new HttpError(400, "Categoría inválida")
  if (moveTo === id) throw new HttpError(400, "Elige otra categoría para mover las publicaciones")
  const [info] = await sql`
    SELECT (SELECT count(*) FROM academy_categories WHERE id = ${id}::int)::int AS found,
           (SELECT count(*) FROM academy_posts WHERE category_id = ${id}::int AND deleted_at IS NULL)::int AS posts,
           (SELECT count(*) FROM academy_categories WHERE id = ${moveTo}::int)::int AS dest
  `
  if (!info?.found) throw new HttpError(404, "Categoría no encontrada")
  if (moveTo && !info.dest) throw new HttpError(400, "La categoría de destino no existe")
  // Como en Skool: borrar una categoría con publicaciones obliga a moverlas.
  if (info.posts > 0 && !moveTo) throw new HttpError(400, "Elige a qué categoría mover las publicaciones")
  // Dos statements en transacción (no un CTE): el DELETE dispara el
  // ON DELETE SET NULL sobre las mismas filas que mueve el UPDATE.
  await sql.transaction([
    sql`UPDATE academy_posts SET category_id = ${moveTo}::int, updated_at = NOW()
         WHERE category_id = ${id}::int AND ${moveTo}::int IS NOT NULL`,
    sql`DELETE FROM academy_categories WHERE id = ${id}::int`,
  ])
  return {}
}

async function adminPin(ctx) {
  const { sql, body } = ctx
  const postId = toId(body.postId)
  if (!postId) throw new HttpError(400, "Publicación inválida")
  const pinned = body.pinned !== false
  if (pinned) {
    const rows = await sql`
      UPDATE academy_posts SET pinned_at = NOW()
       WHERE id = ${postId}::int AND deleted_at IS NULL AND pinned_at IS NULL
         AND (SELECT count(*) FROM academy_posts WHERE pinned_at IS NOT NULL AND deleted_at IS NULL) < ${MAX_PINNED}::int
      RETURNING id
    `
    if (!rows.length) {
      const [p] = await sql`
        SELECT (pinned_at IS NOT NULL) AS pinned FROM academy_posts WHERE id = ${postId}::int AND deleted_at IS NULL
      `
      if (!p) throw new HttpError(404, "Publicación no encontrada")
      if (!p.pinned) throw new HttpError(409, `Solo puedes fijar ${MAX_PINNED} publicaciones. Quita una antes de fijar otra.`)
    }
    return {}
  }
  const rows = await sql`
    UPDATE academy_posts SET pinned_at = NULL WHERE id = ${postId}::int AND deleted_at IS NULL RETURNING id
  `
  if (!rows.length) throw new HttpError(404, "Publicación no encontrada")
  return {}
}

async function adminPostModerate(ctx) {
  const { sql, body } = ctx
  const actor = actorOf(ctx)
  const postId = toId(body.postId)
  const action = String(body.action || "")
  if (!postId) throw new HttpError(400, "Publicación inválida")

  if (action === "lock" || action === "unlock") {
    const rows = await sql`
      UPDATE academy_posts SET comments_locked = ${action === "lock"}::boolean, updated_at = NOW()
       WHERE id = ${postId}::int AND deleted_at IS NULL RETURNING id
    `
    if (!rows.length) throw new HttpError(404, "Publicación no encontrada")
    return {}
  }
  if (action === "move") {
    const categoryId = toId(body.categoryId)
    if (!categoryId) throw new HttpError(400, "Elige la categoría de destino")
    const [cat] = await sql`SELECT id, write_role FROM academy_categories WHERE id = ${categoryId}::int`
    if (!cat) throw new HttpError(400, "Esa categoría no existe")
    if (cat.write_role === "admins" && !isAdminRole(actor.role)) {
      throw new HttpError(403, "Solo los administradores pueden mover publicaciones a esa categoría")
    }
    const rows = await sql`
      UPDATE academy_posts SET category_id = ${categoryId}::int, updated_at = NOW()
       WHERE id = ${postId}::int AND deleted_at IS NULL RETURNING id
    `
    if (!rows.length) throw new HttpError(404, "Publicación no encontrada")
    return {}
  }
  if (action === "delete") {
    const rows = await sql`
      WITH d AS (
        UPDATE academy_posts SET deleted_at = NOW(), pinned_at = NULL, updated_at = NOW()
         WHERE id = ${postId}::int AND deleted_at IS NULL
        RETURNING id
      ), n AS (
        DELETE FROM academy_notifications
         WHERE (target_type = 'post' AND target_id IN (SELECT id FROM d))
            OR (target_type = 'comment' AND parent_id IN (SELECT id FROM d))
      )
      SELECT id FROM d
    `
    if (!rows.length) throw new HttpError(404, "Publicación no encontrada")
    return {}
  }
  throw new HttpError(400, "Acción inválida")
}

async function adminReports(ctx) {
  const { sql, query } = ctx
  const STATUSES = ["abierto", "resuelto", "descartado", "todos"]
  const status = STATUSES.includes(query.status) ? query.status : "abierto"
  const rows = await sql`
    SELECT r.id, r.reporter_id, r.target_type, r.target_id, r.reason, r.status,
           to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
           p.title AS post_title,
           cm.body AS comment_body, cm.post_id AS comment_post_id,
           ls.slug AS lesson_slug, co.slug AS course_slug,
           msg.body AS message_body,
           tm.name AS member_name, tm.handle AS member_handle
      FROM academy_reports r
      LEFT JOIN academy_posts p ON r.target_type = 'post' AND p.id = r.target_id
      LEFT JOIN academy_comments cm ON r.target_type = 'comment' AND cm.id = r.target_id
      LEFT JOIN academy_lessons ls ON ls.id = cm.lesson_id
      LEFT JOIN academy_courses co ON co.id = ls.course_id
      LEFT JOIN academy_messages msg ON r.target_type = 'message' AND msg.id = r.target_id
      LEFT JOIN academy_members tm ON r.target_type = 'miembro' AND tm.id = r.target_id
     WHERE (${status}::text = 'todos' OR r.status = ${status}::text)
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT 100
  `
  const minis = await memberMinis(sql, rows.map((r) => r.reporter_id))
  const seg = (s) => encodeURIComponent(String(s))
  return {
    reports: rows.map((r) => {
      let preview = null
      let route = null
      if (r.target_type === "post") {
        preview = clip(r.post_title, 140)
        route = `${BASE}/comunidad/${r.target_id}`
      } else if (r.target_type === "comment") {
        preview = clip(r.comment_body, 140)
        route = r.comment_post_id
          ? `${BASE}/comunidad/${r.comment_post_id}?comentario=${r.target_id}`
          : r.lesson_slug && r.course_slug
            ? `${BASE}/cursos/${seg(r.course_slug)}/${seg(r.lesson_slug)}?comentario=${r.target_id}`
            : null
      } else if (r.target_type === "message") {
        // Solo el mensaje reportado, nunca el resto del chat.
        preview = clip(r.message_body, 140)
      } else if (r.target_type === "miembro") {
        preview = r.member_name || null
        route = r.member_handle ? `${BASE}/perfil/${seg(r.member_handle)}` : null
      }
      return {
        id: r.id,
        reporter: minis.get(r.reporter_id) || null,
        targetType: r.target_type,
        targetId: r.target_id,
        reason: r.reason || null,
        status: r.status,
        createdAt: r.created_at,
        preview,
        route,
      }
    }),
  }
}

async function adminReportResolve(ctx) {
  const { sql, body } = ctx
  const actor = actorOf(ctx)
  const id = toId(body.id)
  const status = body.status === "resuelto" || body.status === "descartado" ? body.status : null
  if (!id || !status) throw new HttpError(400, "Reporte inválido")
  const [rep] = await sql`SELECT id, target_type, target_id FROM academy_reports WHERE id = ${id}::int`
  if (!rep) throw new HttpError(404, "Reporte no encontrado")
  const deleteContent = body.deleteContent === true && status === "resuelto"
  const tt = rep.target_type
  const tid = rep.target_id

  const queries = [
    // Si se borra el contenido, se cierran también los otros reportes
    // abiertos del mismo contenido (ya no hay nada que revisar).
    sql`
      UPDATE academy_reports
         SET status = ${status}::text, resolved_by = ${actor.memberId}::int, resolved_at = NOW()
       WHERE id = ${id}::int
          OR (${deleteContent}::boolean AND status = 'abierto'
              AND target_type = ${tt}::text AND target_id = ${tid}::int)
    `,
  ]
  if (deleteContent && tt === "post") {
    queries.push(sql`
      WITH d AS (
        UPDATE academy_posts SET deleted_at = NOW(), pinned_at = NULL, updated_at = NOW()
         WHERE id = ${tid}::int AND deleted_at IS NULL RETURNING id
      ), n AS (
        DELETE FROM academy_notifications
         WHERE (target_type = 'post' AND target_id IN (SELECT id FROM d))
            OR (target_type = 'comment' AND parent_id IN (SELECT id FROM d))
      )
      SELECT id FROM d
    `)
  } else if (deleteContent && tt === "comment") {
    queries.push(sql`
      WITH d AS (
        UPDATE academy_comments SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = ${tid}::int AND deleted_at IS NULL RETURNING id, post_id
      ), u AS (
        UPDATE academy_posts SET comment_count = GREATEST(comment_count - 1, 0)
         WHERE id IN (SELECT post_id FROM d WHERE post_id IS NOT NULL)
      ), n AS (
        DELETE FROM academy_notifications WHERE target_type = 'comment' AND target_id IN (SELECT id FROM d)
      )
      SELECT id FROM d
    `)
  } else if (deleteContent && tt === "message") {
    queries.push(sql`UPDATE academy_messages SET deleted_at = NOW() WHERE id = ${tid}::int AND deleted_at IS NULL`)
  }
  // Un miembro no se "borra" desde un reporte: para eso está expulsar
  // (admin-member-update), que además corta su sesión.
  await sql.transaction(queries)
  return {}
}

export const handlers = {
  feed,
  post: postDetail,
  "post-save": postSave,
  "post-delete": postDelete,
  "comment-save": commentSave,
  "comment-delete": commentDelete,
  "lesson-comments": lessonComments,
  like,
  "poll-vote": pollVote,
  follow,
  report,
  members,
  member: memberProfile,
  leaderboard,
  search,
  "group-card": groupCard,
  "admin-category-save": adminCategorySave,
  "admin-category-delete": adminCategoryDelete,
  "admin-pin": adminPin,
  "admin-post-moderate": adminPostModerate,
  "admin-reports": adminReports,
  "admin-report-resolve": adminReportResolve,
}
